const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
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
const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE || 'http://localhost:8000';
const LARAVEL_AUTH_URL = process.env.LARAVEL_AUTH_URL || 'http://localhost:8000';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dashboard-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set true jika menggunakan HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 jam
    }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Store active connections
let activeConnections = new Set();

// Auth middleware
const requireAuth = async (req, res, next) => {
    const token = req.session.token || req.cookies.auth_token;
    
    if (!token) {
        return res.redirect(`${LARAVEL_AUTH_URL}/login`);
    }

    try {
        const response = await axios.post(`${LARAVEL_API_BASE}/api/auth/validate-token`, {
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
            req.session.token = null;
            res.clearCookie('auth_token');
            return res.redirect(`${LARAVEL_AUTH_URL}/login`);
        }
    } catch (error) {
        console.error('Auth validation error:', error.message);
        req.session.token = null;
        res.clearCookie('auth_token');
        return res.redirect(`${LARAVEL_AUTH_URL}/login`);
    }
};

// Auth Routes
app.get('/auth', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.redirect(`${LARAVEL_AUTH_URL}/login`);
    }
    
    // Simpan token di session dan cookie
    req.session.token = token;
    res.cookie('auth_token', token, { 
        maxAge: 24 * 60 * 60 * 1000, // 24 jam
        httpOnly: true 
    });
    
    res.redirect('/');
});

app.post('/logout', requireAuth, async (req, res) => {
    const token = req.session.token || req.cookies.auth_token;
    
    try {
        // Beritahu Laravel untuk hapus token
        await axios.post(`${LARAVEL_API_BASE}/api/auth/logout`, {
            token: token
        });
    } catch (error) {
        console.error('Logout error:', error.message);
    }
    
    // Clear session dan cookie
    req.session.destroy();
    res.clearCookie('auth_token');
    
    res.redirect(`${LARAVEL_AUTH_URL}/login`);
});

// Dashboard Routes (Protected)
app.get('/', requireAuth, (req, res) => {
    res.render('dashboard/index', {
        title: 'IoT Monitoring Dashboard',
        machines: ['Mesin 1', 'Mesin 2', 'Mesin 3', 'Mesin 4', 'Mesin 5'],
        user: req.user // Pass user data to template
    });
});

// API Routes - Proxy to Laravel backend (All Protected)
app.get('/api/dashboard/status', requireAuth, async (req, res) => {
    try {
        const response = await axios.get(`${LARAVEL_API_BASE}/api/dashboard/status`, {
            headers: {
                'Authorization': `Bearer ${req.session.token}`,
                'Accept': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching dashboard status:', error.message);
        
        // Jika unauthorized, redirect ke login
        if (error.response && error.response.status === 401) {
            req.session.token = null;
            res.clearCookie('auth_token');
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Please login again.',
                redirect: `${LARAVEL_AUTH_URL}/login`
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch dashboard status',
            error: error.message 
        });
    }
});

app.get('/api/dashboard/problem/:id', requireAuth, async (req, res) => {
    try {
        const response = await axios.get(`${LARAVEL_API_BASE}/api/dashboard/problem/${req.params.id}`, {
            headers: {
                'Authorization': `Bearer ${req.session.token}`,
                'Accept': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching problem detail:', error.message);
        
        if (error.response && error.response.status === 401) {
            req.session.token = null;
            res.clearCookie('auth_token');
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Please login again.',
                redirect: `${LARAVEL_AUTH_URL}/login`
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch problem detail',
            error: error.message 
        });
    }
});

app.patch('/api/dashboard/problem/:id/status', requireAuth, async (req, res) => {
    try {
        const response = await axios.patch(`${LARAVEL_API_BASE}/api/dashboard/problem/${req.params.id}/status`, req.body, {
            headers: {
                'Authorization': `Bearer ${req.session.token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        // Broadcast problem resolution to all connected clients
        io.emit('problemResolved', {
            problemId: req.params.id,
            status: req.body.status,
            timestamp: new Date().toISOString(),
            updatedBy: req.user.username
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Error updating problem status:', error.message);
        
        if (error.response && error.response.status === 401) {
            req.session.token = null;
            res.clearCookie('auth_token');
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Please login again.',
                redirect: `${LARAVEL_AUTH_URL}/login`
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update problem status',
            error: error.message 
        });
    }
});

app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    try {
        const response = await axios.get(`${LARAVEL_API_BASE}/api/dashboard/stats`, {
            headers: {
                'Authorization': `Bearer ${req.session.token}`,
                'Accept': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching stats:', error.message);
        
        if (error.response && error.response.status === 401) {
            req.session.token = null;
            res.clearCookie('auth_token');
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Please login again.',
                redirect: `${LARAVEL_AUTH_URL}/login`
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch stats',
            error: error.message 
        });
    }
});

// API endpoint untuk check auth status
app.get('/api/auth-status', requireAuth, (req, res) => {
    res.json({
        authenticated: true,
        user: req.user
    });
});

// Socket.IO connection handling with authentication
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token || socket.request.headers.cookie?.match(/auth_token=([^;]+)/)?.[1];
        
        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        // Validate token dengan Laravel
        const response = await axios.post(`${LARAVEL_API_BASE}/api/auth/validate-token`, {
            token: token
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (response.data.valid) {
            socket.user = response.data.user;
            socket.token = token;
            next();
        } else {
            next(new Error('Authentication error: Invalid token'));
        }
    } catch (error) {
        console.error('Socket authentication error:', error.message);
        next(new Error('Authentication error: Token validation failed'));
    }
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} (User: ${socket.user.username})`);
    activeConnections.add(socket.id);

    // Send initial data when client connects
    fetchAndEmitDashboardData(socket);

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id} (User: ${socket.user.username})`);
        activeConnections.delete(socket.id);
    });

    // Handle manual refresh request
    socket.on('requestUpdate', () => {
        fetchAndEmitDashboardData(socket);
    });

    // Join user to personal room for targeted messages
    socket.join(`user_${socket.user.id}`);
});

// Function to fetch and emit dashboard data (with authentication)
async function fetchAndEmitDashboardData(socket = null) {
    try {
        // Get token from socket if available, otherwise skip
        let token = null;
        if (socket && socket.token) {
            token = socket.token;
        } else if (activeConnections.size > 0) {
            // Get token from first active connection (fallback)
            const firstSocket = [...io.sockets.sockets.values()][0];
            if (firstSocket && firstSocket.token) {
                token = firstSocket.token;
            }
        }

        if (!token) {
            console.log('No valid token available for dashboard data fetch');
            return;
        }

        const response = await axios.get(`${LARAVEL_API_BASE}/api/dashboard/status`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        
        const data = response.data;

        if (socket) {
            // Send to specific socket
            socket.emit('dashboardUpdate', data);
        } else {
            // Broadcast to all connected clients
            io.emit('dashboardUpdate', data);
        }

        // Check for new problems and emit notifications
        /*if (data.success && data.data.new_problems && data.data.new_problems.length > 0) {
            const newProblems = data.data.new_problems;
            newProblems.forEach(problem => {
                io.emit('problemAlert', {
                    id: problem.id,
                    machine: problem.machine,
                    problemType: problem.problem_type,
                    message: problem.message,
                    severity: problem.severity,
                    timestamp: problem.timestamp
                });
            });
        }*/

    } catch (error) {
        console.error('Error fetching dashboard data:', error.message);
        
        // If unauthorized, emit auth error
        if (error.response && error.response.status === 401) {
            if (socket) {
                socket.emit('authError', { message: 'Session expired. Please login again.' });
            } else {
                io.emit('authError', { message: 'Session expired. Please login again.' });
            }
            return;
        }
        
        // Emit error to clients
        if (socket) {
            socket.emit('error', { message: 'Failed to fetch dashboard data' });
        } else {
            io.emit('error', { message: 'Failed to fetch dashboard data' });
        }
    }
}

// Auto refresh dashboard data every 1 second
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
    console.log(`🚀 IoT Dashboard with Authentication running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 Laravel API Base: ${LARAVEL_API_BASE}`);
    console.log(`🔐 Laravel Auth URL: ${LARAVEL_AUTH_URL}`);
    
    // Test connection to Laravel API
    axios.get(`${LARAVEL_API_BASE}/api/dashboard/status`)
        .then(() => {
            console.log('✅ Laravel API connection successful');
        })
        .catch((error) => {
            console.log('❌ Laravel API connection failed:', error.message);
            console.log('ℹ️  Note: API calls will be authenticated when users login');
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