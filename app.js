const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration
const PORT = process.env.PORT || 3001;
const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE || 'http://localhost:8000/api';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Store active connections and last known problems
let activeConnections = new Set();
let lastKnownProblems = new Set(); // Track problems by machine to detect new ones

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
  
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  try {
    const response = await axios.post(`${LARAVEL_API_BASE}/validate-token`, {
      token: token
    });
    
    if (response.data.valid) {
      socket.user = response.data.user;
      next();
    } else {
      next(new Error('Invalid token'));
    }
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

// Auth Middleware
async function requireAuth(req, res, next) {
  const token = req.session.token || req.cookies.auth_token;
  
  if (!token) {
    return res.redirect('/login');
  }
  
  try {
    // Validate token dengan Laravel API
    const response = await axios.post(`${LARAVEL_API_BASE}/validate-token`, {
      token: token
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (response.data.valid) {
      req.user = response.data.user;
      next();
    } else {
      // Token tidak valid, hapus session dan redirect ke login
      req.session.destroy();
      res.clearCookie('auth_token');
      return res.redirect('/login');
    }
  } catch (error) {
    console.error('Token validation error:', error.message);
    // Jika ada error validasi, anggap tidak terautentikasi
    req.session.destroy();
    res.clearCookie('auth_token');
    return res.redirect('/login');
  }
}

// Routes
app.get('/', requireAuth, (req, res) => {
  res.render('dashboard/index', {
    title: 'IoT Monitoring Dashboard',
    machines: ['Mesin 1', 'Mesin 2', 'Mesin 3', 'Mesin 4', 'Mesin 5'],
    user: req.user
  });
});

app.get('/analytics', requireAuth, (req, res) => {
  // Pastikan hanya admin yang bisa mengakses halaman ini
  if (req.user.role !== 'admin') {
    return res.status(403).send('Akses Ditolak'); // atau redirect ke halaman utama
  }

  res.render('dashboard/analytics', {
    title: 'Analytics Dashboard',
    user: req.user
  });
});


// Auth Routes - Login Page
app.get('/login', (req, res) => {
    // Jika sudah login, redirect ke dashboard
    const token = req.session.token || req.cookies.auth_token;
    if (token) {
        return res.redirect('/');
    }
    
    res.render('auth/login', {
        title: 'Login - Andon Dashboard'
    });
});

// Auth Routes - Handle Login POST
app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username dan password harus diisi'
        });
    }
    
    try {
        // Perbaikan: sesuaikan dengan route Laravel
        const response = await axios.post(`${LARAVEL_API_BASE}/login`, {
            username: username,
            password: password
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data.success) {
            // Simpan token di session dan cookie
            req.session.token = response.data.token;
            res.cookie('auth_token', response.data.token, { 
                maxAge: 24 * 60 * 60 * 1000, // 24 jam
                httpOnly: false,
                secure: false,
                sameSite: 'lax' 
            });
            
            res.json({
                success: true,
                token: response.data.token,
                message: 'Login berhasil'
            });
        } else {
            res.status(401).json({
                success: false,
                message: response.data.message || 'Username atau password salah'
            });
        }
    } catch (error) {
        console.error('Login error:', error.message);
        
        // Log detail error untuk debugging
        if (error.response) {
            console.error('Error status:', error.response.status);
            console.error('Error data:', error.response.data);
            console.error('Trying URL:', `${LARAVEL_API_BASE}/auth/login`);
        }
        
        if (error.response && error.response.status === 401) {
            res.status(401).json({
                success: false,
                message: 'Username atau password salah'
            });
        } else if (error.response && error.response.status === 404) {
            res.status(500).json({
                success: false,
                message: 'Login endpoint tidak ditemukan. Periksa konfigurasi Laravel API.'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Server error. Silakan coba lagi.'
            });
        }
    }
});

// Auth Routes - Token dari Laravel (untuk redirect)
app.get('/auth', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.redirect('/login');
    }
    
    // Simpan token di session dan cookie
    req.session.token = token;
    res.cookie('auth_token', token, { 
        maxAge: 24 * 60 * 60 * 1000, // 24 jam
        httpOnly: false 
    });
    
    res.redirect('/');
});

// Logout Route
app.post('/logout', async (req, res) => {
    const token = req.session.token || req.cookies.auth_token;
    
    if (token) {
        try {
            // Logout di Laravel API - PERBAIKAN URL
            await axios.post(`${LARAVEL_API_BASE}/logout`, {
                token: token
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.error('Laravel logout error:', error.message);
            // Lanjutkan logout meskipun ada error di Laravel
        }
    }
    
    // Hapus session dan cookie
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.clearCookie('auth_token');
        res.redirect('/login');
    });
});

app.get('/logout', async (req, res) => {
    const token = req.session.token || req.cookies.auth_token;
    
    if (token) {
        try {
            // Logout di Laravel API - PERBAIKAN URL
            await axios.post(`${LARAVEL_API_BASE}/logout`, {
                token: token
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.error('Laravel logout error:', error.message);
            // Lanjutkan logout meskipun ada error di Laravel
        }
    }
    
    // Hapus session dan cookie
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.clearCookie('auth_token');
        res.redirect('/login');
    });
});

// Health check endpoint
app.get('/health-check', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes - Proxy to Laravel backend dengan Authorization header
app.get('/api/dashboard/status', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching dashboard status:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch dashboard status',
      error: error.message 
    });
  }
});

app.get('/api/dashboard/problem/:id', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching problem detail:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch problem detail',
      error: error.message 
    });
  }
});

// TAMBAH ROUTE INI - YANG HILANG!
app.patch('/api/dashboard/problem/:id/status', requireAuth, async (req, res) => {
  try {
    const response = await axios.patch(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}/status`, req.body, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    // Broadcast problem resolution to all connected clients
    io.emit('problemResolved', {
      problemId: req.params.id,
      status: req.body.status,
      timestamp: new Date().toISOString()
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error updating problem status:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update problem status',
      error: error.message 
    });
  }
});

app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/stats`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching stats:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch stats',
      error: error.message 
    });
  }
});

app.get('/api/dashboard/analytics', requireAuth, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/analytics`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      },
      params: { // Meneruskan query parameter ke Laravel
        start_date,
        end_date
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching analytics data:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch analytics data',
      error: error.message 
    });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  activeConnections.add(socket.id);

  // Send initial data when client connects
  fetchAndEmitDashboardData(socket);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    activeConnections.delete(socket.id);
  });

  // Handle manual refresh request
  socket.on('requestUpdate', () => {
    fetchAndEmitDashboardData(socket);
  });
});

// Helper function to create problem key for tracking
function createProblemKey(problem) {
  return `${problem.machine}-${problem.problem_type}-${problem.id}`;
}

// Function to fetch and emit dashboard data WITH problem detection
async function fetchAndEmitDashboardData(socket = null) {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    const data = response.data;

    if (data.success && data.data) {
      // Detect new problems by comparing with last known state
      const currentProblems = data.data.active_problems || [];
      const newProblems = [];

      // Create a set of current problem keys
      const currentProblemKeys = new Set();
      currentProblems.forEach(problem => {
        const problemKey = createProblemKey(problem);
        currentProblemKeys.add(problemKey);
        
        // If this problem key wasn't in our last known problems, it's new
        if (!lastKnownProblems.has(problemKey)) {
          newProblems.push(problem);
          console.log('🚨 New problem detected:', problem);
        }
      });

      // Update our tracking of known problems
      lastKnownProblems.clear();
      currentProblemKeys.forEach(key => lastKnownProblems.add(key));

      // Add new_problems to the data being sent to clients
      const enhancedData = {
        ...data,
        data: {
          ...data.data,
          new_problems: newProblems
        }
      };

      if (socket) {
        // Send to specific socket
        socket.emit('dashboardUpdate', enhancedData);
      } else {
        // Broadcast to all connected clients
        io.emit('dashboardUpdate', enhancedData);
      }

      // Emit individual new problem notifications
      newProblems.forEach(problem => {
        const notification = {
          id: problem.id,
          machine: problem.machine,
          machine_name: problem.machine, // Alias for compatibility
          problem_type: problem.problem_type,
          problemType: problem.problem_type, // Alias for compatibility
          severity: problem.severity,
          timestamp: problem.timestamp || new Date().toISOString(),
          description: problem.description,
          recommended_action: problem.recommended_action
        };

        if (socket) {
          socket.emit('newProblem', notification);
        } else {
          io.emit('newProblem', notification);
        }
      });

    }

  } catch (error) {
    console.error('Error fetching dashboard data:', error.message);
    
    // Emit error to clients
    if (socket) {
      socket.emit('error', { message: 'Failed to fetch dashboard data' });
    } else {
      io.emit('error', { message: 'Failed to fetch dashboard data' });
    }
  }
}

// Auto refresh dashboard data every 1 seconds with enhanced problem detection
setInterval(() => {
  if (activeConnections.size > 0) {
    fetchAndEmitDashboardData();
  }
}, 1000);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The requested page could not be found.',
    error: { status: 404 }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 IoT Dashboard Frontend running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Laravel API Base: ${LARAVEL_API_BASE}`);
  
  // Test connection to Laravel API
  axios.get(`${LARAVEL_API_BASE}/dashboard/status`)
    .then(() => {
      console.log('✅ Laravel API connection successful');
    })
    .catch((error) => {
      console.log('❌ Laravel API connection failed:', error.message);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});