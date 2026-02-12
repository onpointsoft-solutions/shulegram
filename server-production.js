const express = require('express');
require('dotenv').config();

// Import production middleware
const { 
  rateLimiters, 
  securityHeaders, 
  requestSizeLimit,
  generateRequestId,
  corsConfig 
} = require('./middleware/security');
const { 
  errorHandler, 
  asyncHandler, 
  notFoundHandler,
  jsonParser 
} = require('./middleware/errorHandler');
const { 
  requestLogger, 
  paymentLogger, 
  performanceMonitor 
} = require('./middleware/logging');

// Import Firebase and routes
const { initializeFirebase } = require('./config/firebase');
const productionPaymentRoutes = require('./routes/productionPaymentRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Validate environment
const validateEnvironment = () => {
  const required = ['NODE_ENV', 'API_SECRET', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    paymentLogger.log('ERROR', 'Missing required environment variables', {
      missing,
      nodeEnv: process.env.NODE_ENV
    });
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  // Environment separation validation
  const isProduction = process.env.NODE_ENV === 'production';
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  
  if (isProduction && secretKey.startsWith('sk_test_')) {
    throw new Error('Production environment cannot use test keys');
  }
  
  if (!isProduction && secretKey.startsWith('sk_live_')) {
    throw new Error('Development environment cannot use live keys');
  }
};

// Initialize services
try {
  validateEnvironment();
  initializeFirebase();
  
  paymentLogger.log('INFO', 'Production payment server initialized', {
    nodeEnv: process.env.NODE_ENV,
    port: PORT,
    timestamp: new Date().toISOString()
  });
} catch (error) {
  paymentLogger.log('ERROR', 'Server initialization failed', {
    error: error.message
  });
  process.exit(1);
}

// Security middleware
app.use(securityHeaders);
app.use(require('cors')(corsConfig));

// Request ID generation
app.use((req, res, next) => {
  req.requestId = generateRequestId();
  res.setHeader('x-request-id', req.requestId);
  next();
});

// Logging and monitoring
app.use(requestLogger);
app.use(performanceMonitor);

// Body parsing with size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Rate limiting
app.use(rateLimiters.api);

// Health check endpoint
app.get('/health', asyncHandler(async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: '1.0.0',
    requestId: req.requestId,
    services: {
      database: 'unknown',
      payments: 'unknown'
    }
  };

  // Check Firebase connectivity
  try {
    const { getDatabase } = require('./config/firebase');
    const db = getDatabase();
    await db.ref('.info/connected').once('value');
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'disconnected';
    health.status = 'degraded';
  }

  // Check Paystack connectivity
  try {
    const axios = require('axios');
    const response = await axios.get('https://api.paystack.co/', {
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      timeout: 5000
    });
    health.services.payments = 'connected';
  } catch (error) {
    health.services.payments = 'disconnected';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
}));

// API routes
app.use('/api/payments', productionPaymentRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = (signal) => {
  paymentLogger.log('INFO', `Received ${signal}, shutting down gracefully`);
  
  server.close(() => {
    paymentLogger.log('INFO', 'Server closed successfully');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    paymentLogger.log('ERROR', 'Forced shutdown due to timeout');
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  paymentLogger.log('ERROR', 'Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  paymentLogger.log('ERROR', 'Unhandled promise rejection', {
    reason: reason.toString(),
    promise: promise.toString()
  });
  process.exit(1);
});

// Start server
const server = app.listen(PORT, () => {
  paymentLogger.log('INFO', 'Production payment server started', {
    port: PORT,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });

  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 ShulePearl Production Payment API                 ║
║                                                        ║
║   Status: Running                                      ║
║   Port: ${PORT}                                           ║
║   Environment: ${process.env.NODE_ENV}                              ║
║   Request ID: Enabled                                   ║
║   Rate Limiting: Enabled                                ║
║   Security Headers: Enabled                            ║
║                                                        ║
║   Production Endpoints:                                 ║
║   - POST /api/payments/mpesa                           ║
║   - GET  /api/payments/verify/:reference              ║
║   - GET  /api/payments/status/:reference              ║
║   - POST /api/payments/validate-phone                ║
║   - GET  /health                                       ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
