const { sanitizeForLogging } = require('./security');

/**
 * Centralized error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'UNKNOWN';
  
  // Don't log in test environment
  if (process.env.NODE_ENV !== 'test') {
    console.error('=== ERROR LOG ===');
    console.error('Request ID:', requestId);
    console.error('Timestamp:', new Date().toISOString());
    console.error('Method:', req.method);
    console.error('URL:', req.originalUrl);
    console.error('IP:', req.ip);
    console.error('User-Agent:', req.get('User-Agent'));
    console.error('Headers:', sanitizeForLogging(req.headers));
    console.error('Body:', sanitizeForLogging(req.body));
    console.error('Query:', sanitizeForLogging(req.query));
    console.error('Error Name:', err.name);
    console.error('Error Message:', err.message);
    console.error('Error Stack:', err.stack);
    console.error('================');
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.details || [],
      requestId
    });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token',
      requestId
    });
  }

  if (err.name === 'SyntaxError' && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON format in request body',
      requestId
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Request entity too large',
      requestId
    });
  }

  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return res.status(503).json({
      success: false,
      message: 'Service temporarily unavailable',
      requestId
    });
  }

  // Paystack specific errors
  if (err.response?.data?.code === 'invalid_Key') {
    return res.status(500).json({
      success: false,
      message: 'Payment service configuration error',
      requestId
    });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    requestId,
    ...(process.env.NODE_ENV === 'development' && {
      error: err.message,
      stack: err.stack
    })
  });
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method
  });
};

/**
 * Graceful JSON parsing middleware
 */
const jsonParser = (req, res, next) => {
  if (req.headers['content-type']?.includes('application/json')) {
    let data = '';
    
    req.on('data', chunk => {
      data += chunk;
      
      // Prevent memory exhaustion
      if (data.length > 10240) { // 10KB limit
        return res.status(413).json({
          success: false,
          message: 'Request entity too large',
          requestId: req.requestId
        });
      }
    });
    
    req.on('end', () => {
      try {
        if (data) {
          req.body = JSON.parse(data);
        }
        next();
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON format in request body',
          requestId: req.requestId
        });
      }
    });
    
    req.on('error', (err) => {
      return res.status(400).json({
        success: false,
        message: 'Request parsing failed',
        requestId: req.requestId
      });
    });
  } else {
    next();
  }
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  jsonParser
};
