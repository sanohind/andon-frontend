const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
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
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Store active connections
let activeConnections = new Set();

// Routes
app.get('/', (req, res) => {
  res.render('dashboard/index', {
    title: 'IoT Monitoring Dashboard',
    machines: ['Mesin 1', 'Mesin 2', 'Mesin 3', 'Mesin 4', 'Mesin 5']
  });
});

// API Routes - Proxy to Laravel backend
app.get('/api/dashboard/status', async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`);
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

app.get('/api/dashboard/problem/:id', async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}`);
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
app.patch('/api/dashboard/problem/:id/status', async (req, res) => {
  try {
    const response = await axios.patch(`${LARAVEL_API_BASE}/dashboard/problem/${req.params.id}/status`, req.body);
    
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

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/stats`);
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

// Function to fetch and emit dashboard data
async function fetchAndEmitDashboardData(socket = null) {
  try {
    const response = await axios.get(`${LARAVEL_API_BASE}/dashboard/status`);
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
    
    // Emit error to clients
    if (socket) {
      socket.emit('error', { message: 'Failed to fetch dashboard data' });
    } else {
      io.emit('error', { message: 'Failed to fetch dashboard data' });
    }
  }
}

// Auto refresh dashboard data every 5 seconds
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