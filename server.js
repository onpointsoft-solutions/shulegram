const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bodyParser = require('body-parser');
require('dotenv').config();

const { initializeFirebase } = require('./config/firebase');
const paymentRoutes = require('./routes/paymentRoutes');
const frontendRoutes = require('./routes/frontendRoutes');
const { authenticateApiKey } = require('./middleware/auth');
const apiLogger = require('./middleware/apiLogger');
const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase
initializeFirebase();

// Configure CSP
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "https://cdnjs.cloudflare.com"
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
      "https://cdnjs.cloudflare.com"
    ],
    imgSrc: [
      "'self'",
      "data:",
      "https://images.unsplash.com",
      "https://*.unsplash.com",
      "https://res.cloudinary.com"
    ],
    fontSrc: [
      "'self'",
      "data:",
      "https://fonts.gstatic.com",
      "https://cdnjs.cloudflare.com"
    ],
    connectSrc: ["'self'"],
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameAncestors: ["'none'"],
  },
  reportOnly: process.env.NODE_ENV === 'development'
};

// Middleware
app.use(helmet({
  contentSecurityPolicy: cspConfig
}));
// Enhanced CORS configuration for Postman and development
const { getCorsConfig } = require('./middleware/cors-dev');
app.use(getCorsConfig());
app.use(express.json()); // Parse JSON bodies
app.use(apiLogger); // Comprehensive API logging
app.use(morgan('dev'));
// Enhanced request logging (for debugging)
app.use((req, res, next) => {
  console.log('\n=== Incoming Request ===');
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  if (Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, (key, value) => {
      // Mask sensitive fields
      const sensitiveFields = ['password', 'token', 'authorization', 'cardNumber', 'cvv'];
      if (sensitiveFields.includes(key)) return '***MASKED***';
      return value;
    }, 2));
  }
  if (Object.keys(req.query).length > 0) {
    console.log('Query:', JSON.stringify(req.query, null, 2));
  }
  console.log('========================\n');
  next();
});

app.use(morgan('dev')); // Additional HTTP request logging
app.use(bodyParser.json()); // Parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the frontend build directory
const frontendPath = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendPath));

// API Routes
app.use('/api/payments', authenticateApiKey, paymentRoutes);

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Frontend Routes (must be after API routes)
app.use('/', frontendRoutes);

// Health check endpoint (kept for backward compatibility)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'ShulePearl Payment Backend API',
    version: '1.0.0',
    status: 'running'
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Payment routes (protected with API key, except webhook)
app.use('/api/payments/webhook', paymentRoutes); // Webhook doesn't need API key
app.use('/api/payments', authenticateApiKey, paymentRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 ShulePearl Payment Backend Server                ║
║                                                        ║
║   Status: Running                                      ║
║   Port: ${PORT}                                           ║
║   Environment: ${process.env.NODE_ENV || 'development'}                              ║
║                                                        ║
║   M-Pesa Payment Endpoints:                            ║
║   - POST /api/payments/initialize                     ║
║   - GET  /api/payments/verify/:reference              ║
║   - POST /api/payments/mpesa                          ║
║   - POST /api/payments/mpesa/direct                   ║
║   - POST /api/payments/retry/:reference               ║
║   - POST /api/payments/cancel/:reference              ║
║   - GET  /api/payments/status/:reference              ║
║   - GET  /api/payments/history/:userId               ║
║   - POST /api/payments/validate-phone                ║
║   - POST /api/payments/release-escrow                 ║
║   - POST /api/payments/webhook                        ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
