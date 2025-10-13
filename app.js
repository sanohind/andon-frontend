const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const moment = require('moment-timezone');
require('dotenv').config();

// Set timezone untuk Node.js
process.env.TZ = 'Asia/Jakarta';

// Konfigurasi moment-timezone untuk konsistensi
moment.tz.setDefault('Asia/Jakarta');

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
// const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE || 'http://be-andon.ns1.sanoh.co.id/api';

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
      socket.user = {
        ...response.data.user,
        line_name: response.data.user.line_name // PASTIKAN INI ADA
      };
      
      console.log('🔐 Socket user authenticated:', {
        id: socket.user.id,
        role: socket.user.role,
        line_name: socket.user.line_name
      });
      
      next();
    } else {
      next(new Error('Invalid token'));
    }
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

// Auth Middleware untuk halaman web
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
      req.user.token = token;
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

// Auth Middleware untuk API endpoints - mengembalikan JSON response
async function requireAuthAPI(req, res, next) {
  const token = req.session.token || req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
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
      req.user.token = token;
      next();
    } else {
      // Token tidak valid
      req.session.destroy();
      res.clearCookie('auth_token');
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
  } catch (error) {
    console.error('Token validation error:', error.message);
    // Jika ada error validasi, anggap tidak terautentikasi
    req.session.destroy();
    res.clearCookie('auth_token');
    return res.status(500).json({
      success: false,
      message: 'Authentication service error'
    });
  }
}

// Routes
app.get('/', requireAuth, async (req, res) => {
  try {
    // Panggil endpoint baru yang sudah terfilter
    const dashboardDataResponse = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`, {
        headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });

    const machinesGroupedByLine = dashboardDataResponse.data.data.machine_statuses_by_line;

    res.render('dashboard/index', {
        title: 'IoT Monitoring Dashboard',
        machinesByLine: machinesGroupedByLine, // <-- Kirim data terkelompok ke EJS
        user: req.user, // <-- Kirim objek user lengkap untuk filtering di EJS
        globalStats: { /* Nanti bisa diisi dari data dashboardDataResponse jika ada */ },
        moment: moment
    });
  } catch (error) {
    console.error('Error fetching dashboard data on initial load:', error.message);
    res.status(500).render('error', {
        title: 'Error', // <-- TAMBAHKAN INI
        message: 'Failed to load dashboard data. Please try again later.',
        user: req.user || { name: 'Guest' } // Menambahkan user agar header tidak error
    });
  }
});

app.get('/analytics', requireAuth, (req, res) => {
  // Pastikan hanya admin yang bisa mengakses halaman ini
  if (!['admin', 'manager'].includes(req.user.role)) {
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
app.get('/api/dashboard/status', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
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

app.get('/api/dashboard/problem/:id', requireAuthAPI, async (req, res) => {
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
app.patch('/api/dashboard/problem/:id/status', requireAuthAPI, async (req, res) => {
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

app.get('/api/dashboard/stats', requireAuthAPI, async (req, res) => {
  try {
    // === AWAL DARI PERBAIKAN ===
    
    let requestUrl = `${LARAVEL_API_BASE}/dashboard/stats`;

    // Cek apakah ada query parameter yang dikirim oleh klien (misalnya, ?line_name=Support)
    const queryParams = new URLSearchParams(req.query).toString();
    
    if (queryParams) {
      // Jika ada, tambahkan ke URL
      requestUrl += `?${queryParams}`;
    }

    // Gunakan URL yang sudah lengkap
    const response = await axios.get(requestUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}`, 
        'Accept': 'application/json'
      }
    });
    // === AKHIR DARI PERBAIKAN ===
    
    res.json(response.data);

  } catch (error) {
    console.error('Error fetching stats:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch stats'
    });
  }
});

app.get('/api/dashboard/analytics', requireAuthAPI, async (req, res) => {
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

// Endpoint untuk detailed forward analytics
app.get('/api/dashboard/analytics/detailed-forward', requireAuthAPI, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/analytics/detailed-forward`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      },
      params: {
        start_date,
        end_date
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching detailed forward analytics:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch detailed forward analytics',
      error: error.message 
    });
  }
});

app.get('/plc-monitoring', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Akses Ditolak');
  }
  res.render('dashboard/plc-monitoring', {
    title: 'PLC Monitoring',
    user: req.user
  });
});

// Rute proxy API untuk mengambil data dari Laravel
app.get('/api/dashboard/plc-status', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/plc-status`, {
      headers: { 'Authorization': `Bearer ${req.user.token || req.session.token}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch PLC status' });
  }
});

app.get('/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Akses Ditolak');
  }
  try {
    // Gunakan token khusus dari .env untuk mengambil data
    const response = await axios.get(`${LARAVEL_API_BASE}/users`, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    res.render('dashboard/users', {
      title: 'User Management',
      user: req.user,
      userList: response.data // Kirim daftar user ke halaman
    });
  } catch (error) {
    console.error("Error dari Axios saat mengambil /users:", error.response?.data || error.message);
    res.status(500).send('Gagal mengambil data pengguna. Periksa log server.');
  }
});

// RUTE PROXY API UNTUK MENAMBAH PENGGUNA BARU
app.post('/api/users', requireAuthAPI, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses Ditolak' });
  }
  try {
    // Gunakan token khusus dari .env untuk mengirim data
    const response = await axios.post(`${LARAVEL_API_BASE}/users`, req.body, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    res.status(201).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { message: 'Server error' });
  }
});

// Update user
app.put('/api/users/:id', requireAuthAPI, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses Ditolak' });
  }
  try {
    // Gunakan method override untuk menghindari blokir PUT oleh proxy/server
    const response = await axios.post(
      `${LARAVEL_API_BASE}/users/${req.params.id}`,
      req.body,
      {
        headers: {
          'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}`,
          'X-HTTP-Method-Override': 'PUT',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Update user proxy error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { message: 'Server error' });
  }
});

// Delete user
app.delete('/api/users/:id', requireAuthAPI, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses Ditolak' });
  }
  try {
    // Gunakan method override untuk menghindari blokir DELETE oleh proxy/server
    const response = await axios.post(
      `${LARAVEL_API_BASE}/users/${req.params.id}`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}`,
          'X-HTTP-Method-Override': 'DELETE',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Delete user proxy error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { message: 'Server error' });
  }
});

// RUTE UNTUK MENYAJIKAN HALAMAN MANAJEMEN MEJA (HANYA ADMIN)
app.get('/inspect-tables', requireAuth, async (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).send('Akses Ditolak');
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/inspection-tables`, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    res.render('dashboard/inspect-tables', {
      title: 'Manage Inspect Tables',
      user: req.user,
      tableList: response.data
    });
  } catch (error) {
    res.status(500).send('Gagal mengambil data meja inspect.');
  }
});

// RUTE PROXY API UNTUK MANAJEMEN MEJA
app.post('/api/inspect-tables', requireAuthAPI, async (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Akses Ditolak' });
  try {
    const response = await axios.post(`${LARAVEL_API_BASE}/inspection-tables`, req.body, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    res.status(201).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data);
  }
});

app.put('/api/inspect-tables/:id', requireAuthAPI, async (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Akses Ditolak' });
  try {
    const response = await axios.put(`${LARAVEL_API_BASE}/inspection-tables/${req.params.id}`, req.body, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data);
  }
});

app.delete('/api/inspect-tables/:id', requireAuthAPI, async (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ message: 'Akses Ditolak' });
  try {
    const response = await axios.delete(`${LARAVEL_API_BASE}/inspection-tables/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data);
  }
});

app.get('/api/machine-status/:name', requireAuthAPI, async (req, res) => {
    try {
        const machineName = req.params.name;
        // Asumsi ada endpoint di Laravel yang bisa memberikan status untuk mesin tertentu
        // Ganti URL ini sesuai dengan endpoint Laravel Anda
        const response = await axios.get(`${LARAVEL_API_BASE}/machine-status/${encodeURIComponent(machineName)}`, {
            headers: { 'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}` }
        });
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching status for machine ${req.params.name}:`, error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { message: 'Failed to fetch machine status' });
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
        // Ambil data mentah dari backend tanpa filtering (karena filtering dilakukan di Node.js)
        const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`, {
            headers: {
                'Authorization': `Bearer ${process.env.LARAVEL_API_TOKEN}`,
                'Accept': 'application/json'
            }
        });
        const data = response.data;

        if (data.success && data.data) {
            // Ambil data mentah dari backend
            const rawActiveProblems = data.data.active_problems || [];
            const newProblems = [];

            const currentProblemKeys = new Set();
            rawActiveProblems.forEach(problem => {
                const problemKey = createProblemKey(problem);
                currentProblemKeys.add(problemKey);

                if (!lastKnownProblems.has(problemKey)) {
                    newProblems.push(problem);
                    console.log('🚨 New problem detected:', problem);
                }
            });

            lastKnownProblems.clear();
            currentProblemKeys.forEach(key => lastKnownProblems.add(key));

            const dataToEmit = {
                machine_statuses_by_line: data.data.machine_statuses_by_line,
                active_problems: rawActiveProblems,
                new_problems: newProblems
            };

            // Emit dashboardUpdate dengan filtering berdasarkan user role
            if (socket && socket.user) {
                // Untuk single socket dengan user info, kirim data yang sudah difilter
                const filteredData = filterDataForUser(socket.user, dataToEmit);
                socket.emit('dashboardUpdate', { success: true, data: filteredData });
            } else {
                // Untuk broadcast ke semua client, filter untuk setiap user
                io.sockets.sockets.forEach((clientSocket) => {
                    if (clientSocket.user) {
                        const filteredData = filterDataForUser(clientSocket.user, dataToEmit);
                        clientSocket.emit('dashboardUpdate', { success: true, data: filteredData });
                    }
                });
            }

            // PERBAIKAN: Filter dan kirim notifikasi berdasarkan user line
            newProblems.forEach(problem => {
                // Format timestamp dengan timezone Asia/Jakarta yang konsisten
                let formattedTimestamp;
                if (problem.timestamp) {
                    // Jika timestamp sudah dalam format yang benar, gunakan langsung
                    if (typeof problem.timestamp === 'string' && problem.timestamp.includes(' ')) {
                        formattedTimestamp = moment.tz(problem.timestamp, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
                    } else {
                        // Jika timestamp dalam format ISO, konversi ke Asia/Jakarta
                        formattedTimestamp = moment.tz(problem.timestamp, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
                    }
                } else {
                    // Jika tidak ada timestamp, gunakan waktu sekarang
                    formattedTimestamp = moment.tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
                }

                const notification = {
                    id: problem.id,
                    machine: problem.tipe_mesin || problem.machine || 'Unknown Machine',
                    machine_name: problem.tipe_mesin || problem.machine_name || 'Unknown Machine',
                    problem_type: problem.tipe_problem || problem.problem_type || 'Unknown Problem',
                    problemType: problem.tipe_problem || problem.problemType || 'Unknown Problem',
                    line_name: problem.line_name || problem.line || 'N/A',
                    severity: problem.severity || 'medium',
                    timestamp: formattedTimestamp,
                    description: problem.description || 'No description available',
                    recommended_action: problem.recommended_action || 'No action recommended'
                };

                // PERBAIKAN: Kirim notifikasi hanya ke user yang sesuai
                if (socket && socket.user) {
                    // Untuk single socket dengan user info
                    if (shouldSendNotificationToUser(socket.user, notification)) {
                        socket.emit('newProblem', notification);
                    }
                } else {
                    // Untuk broadcast ke semua client, filter berdasarkan user
                    io.sockets.sockets.forEach((clientSocket) => {
                        if (clientSocket.user && shouldSendNotificationToUser(clientSocket.user, notification)) {
                            clientSocket.emit('newProblem', notification);
                        }
                    });
                }
            });

        } else {
            console.error('API response was not successful or data is missing:', data);
            const errorMsg = { message: 'Failed to fetch dashboard data: API response issue' };
            if (socket) {
                socket.emit('error', errorMsg);
            } else {
                io.emit('error', errorMsg);
            }
        }

    } catch (error) {
        console.error('Error fetching dashboard data from Laravel API:', error.message);
        const errorMsg = { message: 'Failed to fetch dashboard data from server' };
        
        if (socket) {
            socket.emit('error', errorMsg);
        } else {
            io.emit('error', errorMsg);
        }
    }
}

function filterDataForUser(user, data) {
    if (!user || !user.role) {
        return {
            machine_statuses_by_line: {},
            active_problems: [],
            new_problems: []
        };
    }

    let filteredActiveProblems = data.active_problems || [];
    let filteredMachineStatuses = data.machine_statuses_by_line || {};

    switch (user.role) {
        case 'admin':
        case 'manager':
            // Admin dan Manager melihat semua data
            return data;

        case 'leader':
            // Leader hanya melihat problem dari line mereka
            if (user.line_name) {
                filteredActiveProblems = filteredActiveProblems.filter(problem => 
                    problem.line_name == user.line_name
                );
                
                // Filter machine statuses untuk line yang sesuai
                const filteredMachineStatusesByLine = {};
                if (filteredMachineStatuses[user.line_name]) {
                    filteredMachineStatusesByLine[user.line_name] = filteredMachineStatuses[user.line_name];
                }
                filteredMachineStatuses = filteredMachineStatusesByLine;
            }
            break;

        case 'maintenance':
        case 'quality':
        case 'engineering':
            // Department users hanya melihat problem yang sudah di-forward ke mereka
            filteredActiveProblems = filteredActiveProblems.filter(problem => 
                problem.is_forwarded && problem.forwarded_to_role === user.role
            );
            
            // PERBAIKAN: Department users bisa melihat machine status problem jika ada problem yang sudah di-forward ke mereka
            filteredMachineStatuses = {};
            for (const lineNumber in data.machine_statuses_by_line) {
                filteredMachineStatuses[lineNumber] = data.machine_statuses_by_line[lineNumber].map(machine => {
                    // Cek apakah ada problem yang sudah di-forward ke user role ini untuk machine ini
                    const hasForwardedProblem = filteredActiveProblems.some(problem => 
                        problem.machine === machine.name && 
                        problem.line_name == machine.line_name &&
                        problem.is_forwarded && 
                        problem.forwarded_to_role === user.role
                    );
                    
                    if (hasForwardedProblem) {
                        // Jika ada problem yang sudah di-forward, tampilkan sebagai problem
                        return {
                            ...machine,
                            status: 'problem',
                            color: 'red',
                            problem_type: machine.problem_type,
                            timestamp: machine.timestamp
                        };
                    } else {
                        // Jika tidak ada problem yang di-forward, tampilkan sebagai normal
                        return {
                            ...machine,
                            status: 'normal',
                            color: 'green',
                            problem_type: null,
                            timestamp: null
                        };
                    }
                });
            }
            break;

        default:
            // Role tidak dikenal, tidak ada data
            filteredActiveProblems = [];
            filteredMachineStatuses = {};
    }

    return {
        machine_statuses_by_line: filteredMachineStatuses,
        active_problems: filteredActiveProblems,
        new_problems: [] // new_problems sudah difilter di shouldSendNotificationToUser
    };
}

function shouldSendNotificationToUser(user, notification) {
    if (!user || !user.role) return false;

    console.log(`🔍 Checking notification for user:`, {
        role: user.role,
        line: user.line_name,
        problemLine: notification.line_name,
        problemType: notification.problem_type,
        problemStatus: notification.problem_status
    });

    // Untuk forward problem notifications, gunakan logika yang berbeda
    if (notification.isForwarded) {
        switch (user.role) {
            case 'admin':
                return false; // Admin tidak menerima notifikasi popup

            case 'maintenance':
                return notification.forwarded_to_role === 'maintenance';

            case 'quality':
                return notification.forwarded_to_role === 'quality';

            case 'engineering':
                return notification.forwarded_to_role === 'engineering';

            case 'leader':
                // Leader tidak menerima notifikasi untuk problem yang sudah di-forward
                return false;

            default:
                return false;
        }
    }

    // Untuk problem baru (belum di-forward)
    switch (user.role) {
        case 'admin':
            return false; // Admin tidak menerima notifikasi popup

        case 'maintenance':
        case 'quality':
        case 'engineering':
            // Department users TIDAK PERNAH menerima notifikasi problem baru
            // Mereka hanya menerima notifikasi ketika problem di-forward ke mereka
            return false;

        case 'leader':
            // KUNCI: Filter berdasarkan line
            if (!user.line_name || !notification.line_name) {
                console.warn('⚠️ Missing line name data');
                return false;
            }
            
            const userLine = String(user.line_name).trim();
            const problemLine = String(notification.line_name).trim();
            
            console.log(`🔍 Leader line check: "${userLine}" vs "${problemLine}"`);
            return userLine === problemLine;

        default:
            return false;
    }
}

// Forward Problem Routes
app.post('/api/dashboard/problem/:id/forward', requireAuthAPI, async (req, res) => {
  try {
    // Validasi bahwa user adalah leader
    if (req.user.role !== 'leader') {
      return res.status(403).json({
        success: false,
        message: 'Hanya leader yang dapat melakukan forward problem.'
      });
    }

    const response = await axios.post(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}/forward`, req.body, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success) {
      // Broadcast forward notification ke user yang sesuai
      const forwardData = response.data.data;
      
      console.log(`📤 Broadcasting forward notification to role: ${forwardData.target_role}`);
      
      // Kirim notifikasi hanya ke user dengan role yang sesuai
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.user && clientSocket.user.role === forwardData.target_role) {
          console.log(`📧 Sending forward notification to user: ${clientSocket.user.name} (${clientSocket.user.role})`);
          
          // Format timestamp untuk forwarded problem
          let forwardedTimestamp;
          if (forwardData.forwarded_at) {
            forwardedTimestamp = moment.tz(forwardData.forwarded_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
          } else {
            forwardedTimestamp = moment.tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
          }

          clientSocket.emit('problemForwarded', {
            id: forwardData.problem_id,
            machine: forwardData.machine_name || 'Unknown Machine',
            machine_name: forwardData.machine_name || 'Unknown Machine',
            problem_type: forwardData.problem_type || 'Unknown Problem',
            problemType: forwardData.problem_type || 'Unknown Problem',
            line_name: forwardData.line_name || 'N/A',
            forwarded_by: forwardData.forwarded_by || 'Unknown User',
            message: forwardData.message || 'Problem has been forwarded',
            timestamp: forwardedTimestamp,
            severity: 'high', // Karena ini forwarded problem, set sebagai high priority
            target_role: forwardData.target_role || 'unknown'
          });
        }
      });
    }
    
    res.json(response.data);
  } catch (error) {
    console.error('Error forwarding problem:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to forward problem',
      error: error.message 
    });
  }
});

app.post('/api/dashboard/problem/:id/receive', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.post(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}/receive`, req.body, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success) {
      // Broadcast receive notification ke leader yang terkait
      const receiveData = response.data.data;
      
      console.log(`📥 Broadcasting receive notification to leaders`);
      
      // Kirim notifikasi ke leader yang terkait
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.user && clientSocket.user.role === 'leader') {
          console.log(`📧 Sending receive notification to leader: ${clientSocket.user.name}`);
          
          // Format timestamp untuk received problem
          let receivedTimestamp;
          if (receiveData.received_at) {
            receivedTimestamp = moment.tz(receiveData.received_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
          } else {
            receivedTimestamp = moment.tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
          }

          clientSocket.emit('problemReceived', {
            problem_id: receiveData.problem_id,
            received_by: receiveData.received_by || 'Unknown User',
            received_at: receivedTimestamp,
            message: 'Problem telah diterima oleh user terkait'
          });
        }
      });
    }
    
    res.json(response.data);
  } catch (error) {
    console.error('Error receiving problem:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to receive problem',
      error: error.message 
    });
  }
});

app.post('/api/dashboard/problem/:id/feedback-resolved', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.post(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}/feedback-resolved`, req.body, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success) {
      // Broadcast feedback resolved notification ke leader yang terkait
      const feedbackData = response.data.data;
      
      console.log(`📝 Broadcasting feedback resolved notification to leaders`);
      
      // Kirim notifikasi ke leader yang terkait
      io.sockets.sockets.forEach((clientSocket) => {
        if (clientSocket.user && clientSocket.user.role === 'leader') {
          console.log(`📧 Sending feedback resolved notification to leader: ${clientSocket.user.name}`);
          
          // Format timestamp untuk feedback resolved
          let feedbackTimestamp;
          if (feedbackData.feedback_at) {
            feedbackTimestamp = moment.tz(feedbackData.feedback_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
          } else {
            feedbackTimestamp = moment.tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
          }

          clientSocket.emit('problemFeedbackResolved', {
            problem_id: feedbackData.problem_id,
            feedback_by: feedbackData.feedback_by || 'Unknown User',
            feedback_at: feedbackTimestamp,
            message: feedbackData.message || 'Problem sudah selesai ditangani',
            notification: 'Problem sudah selesai ditangani, menunggu konfirmasi final dari leader'
          });
        }
      });
    }
    
    res.json(response.data);
  } catch (error) {
    console.error('Error feedback resolved problem:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to feedback resolved problem',
      error: error.message 
    });
  }
});

app.post('/api/dashboard/problem/:id/final-resolved', requireAuthAPI, async (req, res) => {
  try {
    // Validasi bahwa user adalah leader
    if (req.user.role !== 'leader') {
      return res.status(403).json({
        success: false,
        message: 'Hanya leader yang dapat melakukan final resolved problem.'
      });
    }

    const response = await axios.post(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}/final-resolved`, req.body, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success) {
      // Broadcast final resolved notification ke semua user
      const resolvedData = response.data.data;
      
      console.log(`✅ Broadcasting final resolved notification to all users`);
      
      // Format timestamp untuk final resolved
      let resolvedTimestamp;
      if (resolvedData.resolved_at) {
        resolvedTimestamp = moment.tz(resolvedData.resolved_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
      } else {
        resolvedTimestamp = moment.tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
      }

      // Kirim notifikasi ke semua user
      io.emit('problemFinalResolved', {
        problem_id: resolvedData.problem_id,
        resolved_by: resolvedData.resolved_by || 'Unknown User',
        resolved_at: resolvedTimestamp,
        duration_seconds: resolvedData.duration_seconds || 0,
        message: 'Problem telah diselesaikan secara final'
      });
    }
    
    res.json(response.data);
  } catch (error) {
    console.error('Error final resolved problem:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to final resolved problem',
      error: error.message 
    });
  }
});

app.get('/api/dashboard/forward-logs', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/forward-logs`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      },
      params: req.query
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching forward logs:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch forward logs',
      error: error.message 
    });
  }
});

app.get('/api/dashboard/forward-logs/:problemId', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/forward-logs/${req.params.problemId}`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching forward logs for problem:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch forward logs for problem',
      error: error.message 
    });
  }
});

// Ticketing Problem Routes - Proxy to Laravel backend
app.post('/api/dashboard/ticketing', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.post(`${LARAVEL_API_BASE}/dashboard/ticketing`, req.body, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error creating ticketing:', error.message);
    if (error.response) {
      // Laravel returned an error response
      res.status(error.response.status).json(error.response.data);
    } else {
      // Network or other error
      res.status(500).json({ 
        success: false, 
        message: 'Failed to create ticketing',
        error: error.message 
      });
    }
  }
});

app.get('/api/dashboard/ticketing/problem/:problemId', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/ticketing/problem/${req.params.problemId}`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching ticketing by problem:', error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch ticketing',
        error: error.message 
      });
    }
  }
});

app.get('/api/dashboard/ticketing/technicians', requireAuthAPI, async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/ticketing/technicians`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching technicians:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch technicians',
      error: error.message 
    });
  }
});

app.get('/api/dashboard/analytics/ticketing', requireAuthAPI, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/ticketing/data`, {
      headers: {
        'Authorization': `Bearer ${req.user.token || req.session.token}`,
        'Accept': 'application/json'
      },
      params: {
        start_date,
        end_date
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching ticketing analytics:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch ticketing analytics',
      error: error.message 
    });
  }
});

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
  axios.get(`${LARAVEL_API_BASE}/health-check`)
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