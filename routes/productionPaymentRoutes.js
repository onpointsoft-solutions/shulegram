const express = require('express');
const router = express.Router();
const ProductionPaymentController = require('../controllers/productionPaymentController');
const { authenticateApiKey } = require('../middleware/auth');
const { validate, validateParams, schemas } = require('../middleware/validation');
const { rateLimiters } = require('../middleware/security');

/**
 * Production-ready payment routes with security and validation
 */

// Apply payment-specific rate limiting to all payment routes
router.use(rateLimiters.payments);

// Apply API key authentication to all routes except webhook
router.use(authenticateApiKey);

/**
 * POST /api/payments/mpesa
 * Initialize MPesa payment
 */
router.post('/mpesa', 
  validate(schemas.mpesaPayment),
  ProductionPaymentController.initializeMpesaPayment
);

/**
 * GET /api/payments/verify/:reference
 * Verify payment transaction
 */
router.get('/verify/:reference',
  validateParams(schemas.paymentReference),
  ProductionPaymentController.verifyPayment
);

/**
 * GET /api/payments/status/:reference
 * Get payment status from database
 */
router.get('/status/:reference',
  validateParams(schemas.paymentReference),
  ProductionPaymentController.getPaymentStatus
);

/**
 * POST /api/payments/validate-phone
 * Validate phone number format
 */
router.post('/validate-phone',
  validate(schemas.phoneValidation),
  ProductionPaymentController.validatePhone
);

module.exports = router;
