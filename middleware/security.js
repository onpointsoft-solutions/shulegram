const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

/**
 * Rate limiting configurations
 */
const rateLimiters = {
  // General API rate limiting
  api: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      requestId: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.ip + ':' + (req.headers['x-forwarded-for'] || '');
    }
  }),

  // Strict rate limiting for payment endpoints
  payments: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 payment requests per minute
    message: {
      success: false,
      message: 'Too many payment attempts, please try again later.',
      requestId: 'PAYMENT_RATE_LIMIT_EXCEEDED'
    },
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  }),

  // Very strict rate limiting for webhook processing
  webhooks: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // Allow many webhooks (they're critical)
    message: {
      success: false,
      message: 'Webhook rate limit exceeded',
      requestId: 'WEBHOOK_RATE_LIMIT_EXCEEDED'
    }
  })
};

/**
 * Enhanced security headers for production
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.paystack.co"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      childSrc: ["'none'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production'
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

/**
 * Request size limiting
 */
const requestSizeLimit = (maxSize = '10kb') => {
  return (req, res, next) => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength && parseInt(contentLength) > 10240) { // 10KB
      return res.status(413).json({
        success: false,
        message: 'Request entity too large',
        requestId: req.requestId
      });
    }
    
    next();
  };
};

/**
 * Sanitize sensitive data from logs
 */
const sanitizeForLogging = (data) => {
  if (!data || typeof data !== 'object') return data;
  
  const sensitive = ['password', 'token', 'secret', 'key', 'authorization', 'cardNumber', 'cvv'];
  const sanitized = { ...data };
  
  const sanitizeValue = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(sanitizeValue);
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitive.some(sensitive => lowerKey.includes(sensitive))) {
          result[key] = '***MASKED***';
        } else if (typeof value === 'object') {
          result[key] = sanitizeValue(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    
    return obj;
  };
  
  return sanitizeValue(sanitized);
};

/**
 * Generate secure request ID
 */
const generateRequestId = () => {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
};

/**
 * IP whitelist for admin endpoints
 */
const ipWhitelist = (allowedIPs) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    
    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied from this IP',
        requestId: req.requestId
      });
    }
    
    next();
  };
};

/**
 * CORS configuration for production
 */
const corsConfig = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    // Allow exact match or subdomains
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
    
    // Check if origin is allowed or matches pattern
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        // Handle wildcard patterns
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
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
};

module.exports = {
  rateLimiters,
  securityHeaders,
  requestSizeLimit,
  sanitizeForLogging,
  generateRequestId,
  ipWhitelist,
  corsConfig
};
