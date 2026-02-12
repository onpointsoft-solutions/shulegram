const cors = require('cors');

/**
 * Development CORS configuration - allows everything for testing
 */
const devCorsConfig = cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Requested-With', 'Origin', 'Accept'],
  exposedHeaders: ['x-request-id', 'x-total-count'],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
});

/**
 * Production CORS configuration - restricted but allows Postman
 */
const prodCorsConfig = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'https://shulegram.co.ke',
      'https://shulegram.co.ke',
      'https://www.shulegram.co.ke',
      'https://backend.shulegram.co.ke',
      // Development origins
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3005',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3005',
      // Postman and testing tools
      'chrome-extension://*',
      'moz-extension://*'
    ];
    
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = allowed.replace('*', '.*');
        return new RegExp(pattern).test(origin);
      }
      return allowed === origin || origin.endsWith('.shulegram.co.ke');
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Requested-With'],
  exposedHeaders: ['x-request-id', 'x-total-count'],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
});

/**
 * Get CORS configuration based on environment
 */
const getCorsConfig = () => {
  return process.env.NODE_ENV === 'production' ? prodCorsConfig : devCorsConfig;
};

module.exports = {
  devCorsConfig,
  prodCorsConfig,
  getCorsConfig
};
