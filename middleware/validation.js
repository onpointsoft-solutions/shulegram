const Joi = require('joi');

/**
 * Validation schemas for payment endpoints
 */
const schemas = {
  // MPesa payment validation
  mpesaPayment: Joi.object({
    phone: Joi.string()
      .pattern(/^2547\d{8}$/)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be in format 2547XXXXXXXX (12 digits)',
        'any.required': 'Phone number is required'
      }),
    amount: Joi.number()
      .integer()
      .positive()
      .min(1)
      .max(1000000) // Max 1M KES
      .required()
      .messages({
        'number.base': 'Amount must be a number',
        'number.integer': 'Amount must be an integer',
        'number.positive': 'Amount must be positive',
        'number.min': 'Amount must be at least 1 KES',
        'number.max': 'Amount cannot exceed 1,000,000 KES',
        'any.required': 'Amount is required'
      }),
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Valid email address is required',
        'any.required': 'Email is required'
      }),
    bookingId: Joi.string()
      .alphanum()
      .min(3)
      .max(50)
      .required()
      .messages({
        'string.alphanum': 'Booking ID must contain only letters and numbers',
        'string.min': 'Booking ID must be at least 3 characters',
        'string.max': 'Booking ID cannot exceed 50 characters',
        'any.required': 'Booking ID is required'
      }),
    metadata: Joi.object({
      payment_type: Joi.string()
        .valid('booking_fee', 'escrow', 'tuition')
        .default('booking_fee'),
      userId: Joi.string()
        .optional(),
      description: Joi.string()
        .optional(),
      custom_fields: Joi.object()
        .optional()
    }).optional()
  }),

  // Payment verification
  paymentReference: Joi.object({
    reference: Joi.string()
      .required()
      .messages({
        'any.required': 'Payment reference is required'
      })
  }),

  // Phone validation
  phoneValidation: Joi.object({
    phone: Joi.string()
      .pattern(/^(0|254|\+254)?7\d{8}$/)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be in Kenyan format (07XXXXXXXX, 2547XXXXXXXX, or +2547XXXXXXXX)',
        'any.required': 'Phone number is required'
      })
  })
};

/**
 * Validation middleware factory
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
        requestId: req.requestId
      });
    }

    // Replace request body with validated and sanitized data
    req.body = value;
    next();
  };
};

/**
 * Parameter validation middleware
 */
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        success: false,
        message: 'Parameter validation failed',
        errors,
        requestId: req.requestId
      });
    }

    req.params = value;
    next();
  };
};

module.exports = {
  validate,
  validateParams,
  schemas
};
