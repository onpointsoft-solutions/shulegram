const { paystackApi, PAYSTACK_SECRET_KEY, isProduction } = require('../config/paystack');
const { getDatabase } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');
const { paymentLogger } = require('../middleware/logging');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Production-ready MPesa payment controller
 */
class ProductionPaymentController {
  /**
   * Initialize MPesa payment
   * POST /api/payments/mpesa
   */
  static initializeMpesaPayment = asyncHandler(async (req, res) => {
    const { phone, amount, email, bookingId, metadata = {} } = req.body;
    const requestId = req.requestId;

    paymentLogger.paymentInitiated(requestId, {
      phone: phone.replace(/(\d{6})\d{4}(\d{2})/, '$1****$2'), // Mask phone
      amount,
      email,
      bookingId,
      metadata
    });

    // Validate environment separation
    if (isProduction && PAYSTACK_SECRET_KEY.startsWith('sk_test_')) {
      paymentLogger.securityEvent('production_with_test_keys', { requestId });
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        requestId
      });
    }

    if (!isProduction && PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
      paymentLogger.securityEvent('development_with_live_keys', { requestId });
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        requestId
      });
    }

    try {
      // Format phone number for Paystack
      const formattedPhone = '+' + phone;
      
      // Convert amount to kobo (Paystack uses smallest currency unit)
      const amountInKobo = Math.round(amount * 100);

      // Generate unique references
      const timestamp = Date.now();
      const initReference = `mpesa_${uuidv4().replace(/-/g, '')}`;
      const chargeReference = `chg_${uuidv4().replace(/-/g, '')}`;

      // Step 1: Initialize transaction
      const protocol = req.protocol;
      const host = req.get('host');
      const callbackUrl = `${protocol}://${host}/api/payments/webhook`;

      const initData = {
        email,
        amount: amountInKobo,
        reference: initReference,
        currency: 'KES',
        channels: ['mobile_money'],
        callback_url: callbackUrl,
        metadata: {
          booking_id: bookingId,
          payment_method: 'mpesa',
          user_id: metadata.userId,
          payment_type: metadata.payment_type || 'booking_fee',
          ...metadata
        }
      };

      const initStartTime = Date.now();
      const initResponse = await paystackApi.post('/transaction/initialize', initData);
      const initDuration = Date.now() - initStartTime;

      paymentLogger.thirdPartyCall(
        'paystack',
        'POST',
        '/transaction/initialize',
        initResponse.status,
        initDuration,
        requestId
      );

      if (!initResponse.data.status) {
        paymentLogger.paymentFailed(initReference, new Error(initResponse.data.message), {
          step: 'initialization',
          response: initResponse.data
        });
        
        return res.status(400).json({
          success: false,
          message: 'Failed to initialize payment',
          error: initResponse.data.message,
          requestId
        });
      }

      // Step 2: Charge mobile money (for production)
      let chargeResponse;
      if (isProduction) {
        const chargeData = {
          email,
          amount: amountInKobo,
          reference: chargeReference,
          mobile_money: {
            phone: formattedPhone,
            provider: 'mpesa'
          },
          metadata: initData.metadata
        };

        const chargeStartTime = Date.now();
        chargeResponse = await paystackApi.post('/charge', chargeData);
        const chargeDuration = Date.now() - chargeStartTime;

        paymentLogger.thirdPartyCall(
          'paystack',
          'POST',
          '/charge',
          chargeResponse.status,
          chargeDuration,
          requestId
        );
      }

      // Log transaction to Firebase asynchronously
      const transactionData = {
        reference: chargeReference || initReference,
        initReference,
        bookingId,
        email,
        phone: formattedPhone,
        amount,
        status: 'pending',
        paymentMethod: 'mpesa',
        createdAt: Date.now(),
        metadata: initData.metadata,
        requestId,
        environment: isProduction ? 'production' : 'test'
      };

      // Async Firebase logging (non-blocking)
      setImmediate(async () => {
        try {
          const db = getDatabase();
          await db.ref(`payment-transactions/${transactionData.reference}`).set(transactionData);
          paymentLogger.log('INFO', 'Transaction logged to Firebase', {
            reference: transactionData.reference
          });
        } catch (firebaseError) {
          paymentLogger.log('ERROR', 'Failed to log to Firebase', {
            reference: transactionData.reference,
            error: firebaseError.message
          });
        }
      });

      // Return immediate acknowledgment
      const responseData = {
        success: true,
        message: 'Payment initiated successfully',
        data: {
          reference: chargeReference || initReference,
          status: 'pending',
          amount,
          currency: 'KES',
          phone: phone.replace(/(\d{6})\d{4}(\d{2})/, '$1****$2'), // Mask phone in response
          checkout_url: initResponse.data.data?.authorization_url,
          display_text: 'Please check your phone for MPesa prompt'
        },
        requestId
      };

      paymentLogger.log('INFO', 'Payment initialization completed', {
        reference: transactionData.reference,
        requestId
      });

      res.status(200).json(responseData);

    } catch (error) {
      paymentLogger.paymentFailed(requestId, error, {
        step: 'payment_processing',
        phone: phone.replace(/(\d{6})\d{4}(\d{2})/, '$1****$2'),
        amount
      });

      // Handle specific Paystack errors
      if (error.response?.status === 401) {
        return res.status(500).json({
          success: false,
          message: 'Payment service configuration error',
          requestId
        });
      }

      if (error.response?.status === 429) {
        return res.status(429).json({
          success: false,
          message: 'Payment service temporarily busy, please try again',
          requestId
        });
      }

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return res.status(504).json({
          success: false,
          message: 'Payment service timeout, please try again',
          requestId
        });
      }

      throw error; // Let the error handler deal with other errors
    }
  });

  /**
   * Verify payment
   * GET /api/payments/verify/:reference
   */
  static verifyPayment = asyncHandler(async (req, res) => {
    const { reference } = req.params;
    const requestId = req.requestId;

    try {
      const verifyStartTime = Date.now();
      const response = await paystackApi.get(`/transaction/verify/${reference}`);
      const verifyDuration = Date.now() - verifyStartTime;

      paymentLogger.thirdPartyCall(
        'paystack',
        'GET',
        `/transaction/verify/${reference}`,
        response.status,
        verifyDuration,
        requestId
      );

      if (response.data.status) {
        const paymentData = response.data.data;

        // Async Firebase update
        setImmediate(async () => {
          try {
            const db = getDatabase();
            await db.ref(`payment-transactions/${reference}`).update({
              status: paymentData.status,
              verifiedAt: Date.now(),
              gateway_response: paymentData.gateway_response,
              paid_at: paymentData.paid_at,
              channel: paymentData.channel
            });

            paymentLogger.log('INFO', 'Payment verification updated in Firebase', {
              reference,
              status: paymentData.status
            });
          } catch (firebaseError) {
            paymentLogger.log('ERROR', 'Failed to update Firebase', {
              reference,
              error: firebaseError.message
            });
          }
        });

        return res.status(200).json({
          success: true,
          message: 'Payment verified successfully',
          data: {
            status: paymentData.status,
            amount: paymentData.amount / 100,
            reference: paymentData.reference,
            paid_at: paymentData.paid_at,
            channel: paymentData.channel
          },
          requestId
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed',
          requestId
        });
      }

    } catch (error) {
      paymentLogger.log('ERROR', 'Payment verification failed', {
        reference,
        error: error.message,
        requestId
      });

      if (error.response?.status === 404) {
        return res.status(404).json({
          success: false,
          message: 'Payment transaction not found',
          requestId
        });
      }

      throw error;
    }
  });

  /**
   * Get payment status
   * GET /api/payments/status/:reference
   */
  static getPaymentStatus = asyncHandler(async (req, res) => {
    const { reference } = req.params;
    const requestId = req.requestId;

    try {
      const db = getDatabase();
      const snapshot = await db.ref(`payment-transactions/${reference}`).once('value');
      const transaction = snapshot.val();

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
          requestId
        });
      }

      // Remove sensitive data from response
      const { phone: maskedPhone, ...safeTransaction } = transaction;
      if (maskedPhone) {
        safeTransaction.phone = maskedPhone.replace(/(\d{6})\d{4}(\d{2})/, '$1****$2');
      }

      return res.status(200).json({
        success: true,
        data: safeTransaction,
        requestId
      });

    } catch (error) {
      paymentLogger.log('ERROR', 'Failed to get payment status', {
        reference,
        error: error.message,
        requestId
      });

      throw error;
    }
  });

  /**
   * Validate phone number
   * POST /api/payments/validate-phone
   */
  static validatePhone = asyncHandler(async (req, res) => {
    const { phone } = req.body;
    const requestId = req.requestId;

    // Format phone number
    let formattedPhone = phone.replace(/\s+/g, '');
    
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('+254')) {
      formattedPhone = formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith('254')) {
      formattedPhone = '254' + formattedPhone;
    }

    const isValid = /^2547\d{8}$/.test(formattedPhone);

    return res.status(200).json({
      success: true,
      data: {
        isValid,
        formatted: formattedPhone,
        original: phone,
        network: formattedPhone.startsWith('25471') ? 'Safaricom' : 'Other'
      },
      requestId
    });
  });
}

module.exports = ProductionPaymentController;
