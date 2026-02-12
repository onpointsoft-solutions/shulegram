const { sanitizeForLogging, generateRequestId } = require('./security');

/**
 * Structured logging middleware
 */
const requestLogger = (req, res, next) => {
  // Generate unique request ID
  req.requestId = generateRequestId();
  res.setHeader('x-request-id', req.requestId);

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Log request
  console.log('=== REQUEST START ===');
  console.log('Request ID:', req.requestId);
  console.log('Timestamp:', timestamp);
  console.log('Method:', req.method);
  console.log('URL:', req.originalUrl);
  console.log('IP:', req.ip);
  console.log('User-Agent:', req.get('User-Agent'));
  console.log('Content-Type:', req.get('Content-Type'));
  console.log('Content-Length:', req.get('Content-Length'));
  
  // Log headers (sanitized)
  if (process.env.NODE_ENV === 'development') {
    console.log('Headers:', sanitizeForLogging(req.headers));
  }
  
  // Log body (sanitized and only for non-sensitive endpoints)
  if (req.body && Object.keys(req.body).length > 0) {
    const isSensitiveEndpoint = req.originalUrl.includes('/webhook') || 
                               req.originalUrl.includes('/auth');
    
    if (!isSensitiveEndpoint) {
      console.log('Body:', sanitizeForLogging(req.body));
    }
  }
  
  console.log('=====================');

  // Override res.json to log responses
  const originalJson = res.json;
  res.json = function(data) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('=== RESPONSE END ===');
    console.log('Request ID:', req.requestId);
    console.log('Timestamp:', new Date().toISOString());
    console.log('Status:', res.statusCode);
    console.log('Duration:', `${duration}ms`);
    
    // Log response data (sanitized)
    if (process.env.NODE_ENV === 'development') {
      console.log('Response:', sanitizeForLogging(data));
    }
    
    console.log('===================');

    return originalJson.call(this, data);
  };

  // Handle response finish for non-JSON responses
  res.on('finish', () => {
    const endTime = Date.now();
    const duration = endTime - startTime;

    if (!res.headersSent) {
      console.log('=== RESPONSE END ===');
      console.log('Request ID:', req.requestId);
      console.log('Timestamp:', new Date().toISOString());
      console.log('Status:', res.statusCode);
      console.log('Duration:', `${duration}ms`);
      console.log('===================');
    }
  });

  next();
};

/**
 * Payment transaction logger
 */
const paymentLogger = {
  log: (level, message, data = {}) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'payment-api',
      message,
      ...sanitizeForLogging(data)
    };

    console.log(JSON.stringify(logEntry));
  },

  paymentInitiated: (reference, data) => {
    paymentLogger.log('INFO', 'Payment initiated', {
      event: 'payment_initiated',
      reference,
      ...data
    });
  },

  paymentSuccess: (reference, data) => {
    paymentLogger.log('INFO', 'Payment successful', {
      event: 'payment_success',
      reference,
      ...data
    });
  },

  paymentFailed: (reference, error, data) => {
    paymentLogger.log('ERROR', 'Payment failed', {
      event: 'payment_failed',
      reference,
      error: error.message,
      ...data
    });
  },

  webhookReceived: (event, reference) => {
    paymentLogger.log('INFO', 'Webhook received', {
      event: 'webhook_received',
      eventType: event,
      reference
    });
  },

  webhookProcessed: (event, reference, status) => {
    paymentLogger.log('INFO', 'Webhook processed', {
      event: 'webhook_processed',
      eventType: event,
      reference,
      status
    });
  },

  apiCall: (method, url, status, duration, requestId) => {
    paymentLogger.log('INFO', 'API call completed', {
      event: 'api_call',
      method,
      url,
      status,
      duration,
      requestId
    });
  },

  thirdPartyCall: (service, method, url, status, duration, requestId) => {
    paymentLogger.log('INFO', 'Third-party API call', {
      event: 'third_party_call',
      service,
      method,
      url,
      status,
      duration,
      requestId
    });
  },

  securityEvent: (event, details) => {
    paymentLogger.log('WARN', 'Security event', {
      event: 'security_event',
      securityEvent: event,
      ...sanitizeForLogging(details)
    });
  }
};

/**
 * Performance monitoring
 */
const performanceMonitor = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

    // Log slow requests (> 1 second)
    if (duration > 1000) {
      paymentLogger.log('WARN', 'Slow request detected', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        duration: `${duration.toFixed(2)}ms`
      });
    }

    // Track API metrics
    paymentLogger.apiCall(req.method, req.originalUrl, res.statusCode, duration, req.requestId);
  });

  next();
};

module.exports = {
  requestLogger,
  paymentLogger,
  performanceMonitor
};
