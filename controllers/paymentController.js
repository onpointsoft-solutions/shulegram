const { paystackApi, PAYSTACK_WEBHOOK_SECRET } = require('../config/paystack');
const { getDatabase } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Initialize a payment transaction
 * POST /api/payments/initialize
 */
const initializePayment = async (req, res) => {
  const startTime = Date.now();
  const { email, amount, bookingId, metadata } = req.body;
  
  try {
    // Log API request
    logger.api.request(
      'POST',
      '/api/payments/initialize',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown'
    );

    // Validate input
    if (!email || !amount || !bookingId) {
      const error = 'Missing required fields: email, amount, bookingId';
      logger.api.error('POST', '/api/payments/initialize', error, 400);
      return res.status(400).json({
        success: false,
        message: error
      });
    }

    // Convert amount to kobo (Paystack uses smallest currency unit)
    const amountInKobo = Math.round(amount * 100);

    // Generate unique reference using UUID
    const reference = `booking_${uuidv4().replace(/-/g, '')}`;

    // Log payment initialization
    logger.payment.init(reference, { email, amount, bookingId });

    // Prepare payment data
    const paymentData = {
      email,
      amount: amountInKobo,
      reference,
      currency: 'KES', // Kenyan Shillings
      channels: ['mobile_money', 'card'], // Allow both MPesa and card
      metadata: {
        booking_id: bookingId,
        ...metadata
      }
    };

    // Initialize payment with Paystack
    const response = await paystackApi.post('/transaction/initialize', paymentData);

    if (response.data.status) {
      // Log transaction to Firebase
      const db = getDatabase();
      const transactionData = {
        reference,
        bookingId,
        email,
        amount: amount,
        status: 'pending',
        createdAt: Date.now(),
        metadata,
        paymentMethod: 'unknown', // Will be updated when payment is completed
        source: 'api'
      };

      logger.firebase.write('payment-transactions', reference, 'create');
      await db.ref(`payment-transactions/${reference}`).set(transactionData);

      const responseTime = Date.now() - startTime;
      logger.performance.timing('payment_initialize', responseTime, { reference, amount });
      logger.api.response('POST', '/api/payments/initialize', 200, responseTime);

      return res.status(200).json({
        success: true,
        message: 'Payment initialized successfully',
        data: {
          reference: response.data.data.reference,
          access_code: response.data.data.access_code,
          authorization_url: response.data.data.authorization_url
        }
      });
    } else {
      const error = response.data.message || 'Failed to initialize payment';
      logger.payment.failed(reference, error, { amount, bookingId });
      const responseTime = Date.now() - startTime;
      logger.api.error('POST', '/api/payments/initialize', error, 400);
      
      return res.status(400).json({
        success: false,
        message: 'Failed to initialize payment',
        error: error
      });
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.response?.data?.message || error.message;
    
    logger.error(error, { 
      operation: 'initializePayment', 
      email, 
      amount, 
      bookingId,
      responseTime 
    });
    
    logger.api.error('POST', '/api/payments/initialize', errorMessage, 500);
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: errorMessage
    });
  }
};

/**
 * Verify payment transaction
 * GET /api/payments/verify/:reference
 */
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    // Verify payment with Paystack
    const response = await paystackApi.get(`/transaction/verify/${reference}`);

    if (response.data.status) {
      const paymentData = response.data.data;
      const db = getDatabase();

      // Update transaction in Firebase
      await db.ref(`payment-transactions/${reference}`).update({
        status: paymentData.status,
        verifiedAt: Date.now(),
        gateway_response: paymentData.gateway_response,
        paid_at: paymentData.paid_at,
        channel: paymentData.channel
      });

      // If payment successful, update booking
      if (paymentData.status === 'success') {
        const bookingId = paymentData.metadata.booking_id;
        const paymentType = paymentData.metadata.payment_type || 'booking';

        if (paymentType === 'booking_fee') {
          // Get current booking data
          const bookingSnapshot = await db.ref(`tuition-bookings/${bookingId}`).once('value');
          const currentBooking = bookingSnapshot.val() || {};
          
          // Update with negotiation unlock
          await db.ref(`tuition-bookings/${bookingId}`).update({
            ...currentBooking,
            bookingFeePaid: true,
            bookingFeeReference: reference,
            bookingFeePaidAt: Date.now(),
            status: 'negotiating',
            negotiationUnlocked: true,
            negotiationUnlockedAt: new Date().toISOString(),
            negotiation: {
              status: 'ready',
              unlockedBy: paymentData.metadata.userId || paymentData.customer.email,
              unlockedAt: new Date().toISOString(),
              messages: [],
              offers: [],
              lastActivity: new Date().toISOString()
            }
          });
          
          // Log the unlock event
          await db.ref(`tuition-bookings/${bookingId}/activityLog`).push().set({
            action: 'negotiation_unlocked',
            timestamp: new Date().toISOString(),
            paymentReference: reference,
            amount: paymentData.amount / 100,
            triggeredBy: 'payment_verification',
            details: {
              previousStatus: currentBooking.status || 'pending',
              newStatus: 'negotiating',
              paymentGateway: 'paystack'
            }
          });
          
          console.log(`✅ Negotiation unlocked via verification for booking ${bookingId}`);
          
        } else if (paymentType === 'escrow') {
          await db.ref(`tuition-bookings/${bookingId}`).update({
            escrowPaid: true,
            escrowAmount: paymentData.amount / 100,
            escrowReference: reference,
            escrowPaidAt: Date.now(),
            escrowStatus: 'held'
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        data: {
          status: paymentData.status,
          amount: paymentData.amount / 100,
          reference: paymentData.reference,
          paid_at: paymentData.paid_at,
          channel: paymentData.channel
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
  } catch (error) {
    console.error('Payment verification error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.response?.data?.message || error.message
    });
  }
};

/**
 * Process MPesa payment with proper STK Push
 * POST /api/payments/mpesa
 */
const processMpesaPayment = async (req, res) => {
  try {
    const { phone, amount, email, bookingId, metadata } = req.body;

    if (!phone || !amount || !email || !bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: phone, amount, email, bookingId'
      });
    }

    // Check if we're in test mode (Paystack test key starts with 'sk_test_')
    const isTestMode = process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_');
    
    // For test mode, use Paystack's test MPesa number and email
    let formattedPhone;
    let paymentEmail = email;
    
    if (isTestMode) {
      console.log('Test mode detected - using test credentials');
      formattedPhone = '254708374176'; // Paystack's test MPesa number
      paymentEmail = 'test@example.com'; // Must use test email for Paystack test mode
    } else {
      // Format phone number for production (ensure it starts with 254)
      formattedPhone = phone.replace(/\s+/g, '');
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '254' + formattedPhone.substring(1);
      } else if (formattedPhone.startsWith('+254')) {
        formattedPhone = formattedPhone.substring(1);
      } else if (!formattedPhone.startsWith('254')) {
        formattedPhone = '254' + formattedPhone;
      }

      // Validate phone number format (should be 12 digits: 254XXXXXXXXX)
      if (!/^254\d{9}$/.test(formattedPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format. Should be 254XXXXXXXXX'
        });
      }
    }

    // For test mode, we must use specific test amounts (100, 200, 300... 1000 KES)
    const testAmounts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const safeAmount = isTestMode ? 
      testAmounts[Math.floor(Math.random() * testAmounts.length)] : 
      amount;
      
    const amountInKobo = Math.round(safeAmount * 100);
    
    // Generate unique references using UUID
    const timestamp = Date.now();
    const initReference = `init_${uuidv4()}`;
    const chargeReference = `chg_${uuidv4()}`;
    console.log('=== MPesa Payment Request ===');
    console.log('Test Mode:', isTestMode ? 'YES' : 'NO');
    console.log('Init Reference:', initReference);
    console.log('Charge Reference:', chargeReference);
    console.log('Phone:', isTestMode ? `${formattedPhone} (test number)` : formattedPhone);
    console.log('Amount:', safeAmount, 'KES (', amountInKobo, 'kobo)');

    // Step 1: Initialize transaction
    const protocol = req.protocol || 'https';
    const host = req.get('host') || 'your-domain.com';
    const callbackUrl = `${protocol}://${host}/api/payments/webhook`;
    
    const initData = {
      email: paymentEmail, // Use test email in test mode
      amount: amountInKobo,
      reference: initReference,
      currency: 'KES',
      channels: ['mobile_money'],
      callback_url: callbackUrl,
      metadata: {
        booking_id: bookingId,
        payment_method: 'mpesa',
        ...metadata
      }
    };

    console.log('Step 1: Initializing transaction...');
    const initResponse = await paystackApi.post('/transaction/initialize', initData);
    console.log('Init response:', JSON.stringify(initResponse.data, null, 2));

    if (!initResponse.data.status) {
      console.error('Initialization failed:', initResponse.data.message);
      return res.status(400).json({
        success: false,
        message: 'Failed to initialize payment',
        error: initResponse.data.message
      });
    }

    // In test mode, we only need to initialize the transaction
    // The STK push will be handled by Paystack's test environment
    if (isTestMode) {
      console.log('Test mode - skipping direct charge, using checkout URL');
      const checkoutUrl = `https://checkout.paystack.com/${initResponse.data.data.access_code}`;
      
      // Log transaction to Firebase
      const db = getDatabase();
      await db.ref(`payment-transactions/${initReference}`).set({
        reference: initReference,
        bookingId,
        email: paymentEmail,
        phone: formattedPhone,
        amount: safeAmount,
        status: 'pending',
        paymentMethod: 'mpesa',
        checkoutUrl,
        createdAt: Date.now(),
        metadata
      });

      return res.status(200).json({
        success: true,
        message: 'Payment initialized. Please check your phone for STK push.',
        data: {
          reference: initReference,
          status: 'pending',
          checkout_url: checkoutUrl,
          display_text: 'Check your phone for payment prompt'
        }
      });
    }

    // Production flow - direct charge with STK push
    const paystackPhone = '+' + formattedPhone;
    const chargeData = {
      email: paymentEmail,
      amount: amountInKobo,
      reference: chargeReference,
      mobile_money: {
        phone: paystackPhone,
        provider: 'mpesa'
      },
      metadata: {
        booking_id: bookingId,
        payment_method: 'mpesa',
        ...metadata
      }
    };
    
    console.log('Formatted phone for Paystack:', paystackPhone);

    console.log('Step 2: Charging mobile money...');
    const chargeResponse = await paystackApi.post('/charge', chargeData);
    console.log('Charge response:', JSON.stringify(chargeResponse.data, null, 2));

    // Log transaction to Firebase
    const db = getDatabase();
    await db.ref(`payment-transactions/${chargeReference}`).set({
      reference: chargeReference,
      initReference,
      bookingId,
      email,
      phone: formattedPhone,
      amount: amount,
      status: chargeResponse.data.status === true ? 'pending' : 'failed',
      paymentMethod: 'mpesa',
      createdAt: Date.now(),
      chargeResponse: chargeResponse.data,
      metadata
    });

    // Check charge response status
    const responseStatus = chargeResponse.data.status;
    const responseData = chargeResponse.data.data;

    if (responseStatus === 'success' || responseStatus === true) {
      console.log('✅ MPesa STK push sent successfully');
      return res.status(200).json({
        success: true,
        message: 'MPesa STK push sent. Please check your phone to complete payment.',
        data: {
          reference: responseData?.reference || reference,
          status: responseData?.status || 'pending',
          display_text: responseData?.display_text || 'Check your phone for payment prompt'
        }
      });
    } else if (responseStatus === 'send_otp' || responseStatus === 'pending') {
      console.log('⏳ Payment pending - awaiting user action');
      return res.status(200).json({
        success: true,
        message: 'Payment pending. Check your phone for prompt.',
        data: {
          reference,
          status: 'pending'
        }
      });
    } else {
      console.error('❌ Charge failed:', chargeResponse.data.message);
      return res.status(400).json({
        success: false,
        message: chargeResponse.data.message || 'Failed to initiate MPesa payment',
        error: chargeResponse.data
      });
    }
  } catch (error) {
    console.error('=== MPesa Payment Error ===');
    console.error('Error message:', error.message);
    
    // Log detailed error for debugging
    if (error.response?.data) {
      console.error('Paystack error details:', JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    });
  }
};

/**
 * Alternative: Direct MPesa charge (bypasses initialize step)
 * POST /api/payments/mpesa-direct
 */
const processMpesaPaymentDirect = async (req, res) => {
  try {
    const { phone, amount, email, bookingId, metadata } = req.body;

    if (!phone || !amount || !email || !bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: phone, amount, email, bookingId'
      });
    }

    // Format phone number
    let formattedPhone = phone.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('+254')) {
      formattedPhone = formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith('254')) {
      formattedPhone = '254' + formattedPhone;
    }

    // Validate phone number
    if (!/^254\d{9}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Should be 254XXXXXXXXX'
      });
    }

    const amountInKobo = Math.round(amount * 100);
    // Generate a more unique reference with timestamp, random string, and counter
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const counter = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const reference = `mpesa_${bookingId}_${timestamp}_${randomString}_${counter}`;

    // Direct charge - Paystack expects phone with + prefix
    const paystackPhone = '+' + formattedPhone;
    
    const chargeData = {
      email,
      amount: amountInKobo,
      currency: 'KES',
      reference,
      mobile_money: {
        phone: paystackPhone,
        provider: 'mpesa'
      },
      metadata: {
        booking_id: bookingId,
        payment_method: 'mpesa',
        ...metadata
      }
    };

    console.log('Direct MPesa charge:', { 
      reference, 
      amount, 
      phone: paystackPhone 
    });

    const response = await paystackApi.post('/charge', chargeData);
    console.log('Direct charge response:', JSON.stringify(response.data, null, 2));

    // Log transaction
    const db = getDatabase();
    await db.ref(`payment-transactions/${reference}`).set({
      reference,
      bookingId,
      email,
      phone: paystackPhone,
      amount: amount,
      status: 'pending',
      paymentMethod: 'mpesa',
      createdAt: Date.now(),
      metadata
    });

    return res.status(200).json({
      success: true,
      message: 'MPesa payment initiated. Check your phone for the prompt.',
      data: {
        reference,
        status: response.data.data?.status || 'pending',
        display_text: response.data.data?.display_text
      }
    });

  } catch (error) {
    console.error('Direct MPesa error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    });
  }
};

/**
 * Webhook handler for Paystack events
 * POST /api/payments/webhook
 */
/**
 * Verify Paystack webhook signature
 */
const verifyWebhookSignature = (req) => {
  try {
    if (!PAYSTACK_WEBHOOK_SECRET) {
      logger.webhook.signatureError('PAYSTACK_WEBHOOK_SECRET is not set');
      return false;
    }

    const crypto = require('crypto');
    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      logger.webhook.signatureError('No signature found in request headers');
      return false;
    }

    const hash = crypto
      .createHmac('sha512', PAYSTACK_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signature)
    );

    if (!isValid) {
      logger.webhook.signatureError('Signature verification failed - hash mismatch');
    }

    return isValid;
  } catch (error) {
    logger.webhook.signatureError(`Error verifying webhook signature: ${error.message}`);
    return false;
  }
};

/**
 * Webhook handler for Paystack events
 * POST /api/payments/webhook
 */
const handleWebhook = async (req, res) => {
  const startTime = Date.now();
  const { event, data } = req.body;
  const reference = data?.reference || 'unknown';

  // Log incoming webhook
  logger.webhook.incoming(event, reference);
  logger.debug(`=== Incoming Webhook ===`);
  logger.debug(`Headers: ${JSON.stringify(req.headers, null, 2)}`);
  logger.debug(`Body: ${JSON.stringify(req.body, null, 2)}`);

  try {
    // Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      logger.webhook.failed(event, 'Invalid webhook signature');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid webhook signature' 
      });
    }

    logger.webhook.verified(event, reference);

    console.log('✅ Webhook signature verified');

    const event = req.body;
    const db = getDatabase();

    console.log('=== Webhook Event Received ===');
    console.log('Event type:', event.event);
    console.log('Event data:', JSON.stringify(event.data, null, 2));

    // Handle different event types
    const { event: eventType, data } = event;
    const { reference, metadata = {}, amount, gateway_response } = data;
    
    if (!reference) {
      console.error('No reference found in webhook data');
      return res.status(400).json({ success: false, message: 'Missing reference' });
    }

    const transactionRef = db.ref(`payment-transactions/${reference}`);
    const transactionSnapshot = await transactionRef.once('value');
    
    if (!transactionSnapshot.exists()) {
      console.error(`Transaction not found: ${reference}`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const transaction = transactionSnapshot.val();
    const bookingId = metadata.booking_id || transaction.bookingId;
    
    // Common update data
    const updateData = {
      lastWebhookEvent: eventType,
      lastWebhookReceived: new Date().toISOString(),
      amount: amount ? amount / 100 : transaction.amount
    };

    switch (eventType) {
      case 'charge.success':
        console.log('✅ Payment successful:', reference);
        
        await transactionRef.update({
          ...updateData,
          status: 'success',
          completedAt: new Date().toISOString(),
          webhookReceived: true,
          metadata: { ...transaction.metadata, ...metadata }
        });

        // Update booking if bookingId exists
        if (bookingId) {
          const bookingRef = db.ref(`bookings/${bookingId}`);
          
          // Get current booking data to preserve existing fields
          const bookingSnapshot = await bookingRef.once('value');
          const currentBooking = bookingSnapshot.val() || {};
          
          const bookingUpdate = {
            ...currentBooking,
            lastUpdated: new Date().toISOString(),
            status: metadata.payment_type === 'booking_fee' ? 'negotiating' : 'confirmed'
          };

          if (metadata.payment_type === 'booking_fee') {
            // Unlock negotiation features
            bookingUpdate.bookingFeePaid = true;
            bookingUpdate.bookingFeeReference = reference;
            bookingUpdate.bookingFeePaidAt = new Date().toISOString();
            bookingUpdate.negotiationUnlocked = true;
            bookingUpdate.negotiationUnlockedAt = new Date().toISOString();
            
            // Initialize negotiation structure
            bookingUpdate.negotiation = {
              status: 'ready', // ready for negotiation to start
              unlockedBy: metadata.userId || transaction.email,
              unlockedAt: new Date().toISOString(),
              messages: [],
              offers: [],
              lastActivity: new Date().toISOString()
            };
            
            // Log negotiation unlock event
            await db.ref(`bookings/${bookingId}/activityLog`).push().set({
              action: 'negotiation_unlocked',
              timestamp: new Date().toISOString(),
              paymentReference: reference,
              amount: amount / 100,
              triggeredBy: 'payment_success',
              details: {
                previousStatus: currentBooking.status || 'pending',
                newStatus: 'negotiating',
                negotiationFeatures: ['messaging', 'offers', 'counter_offers']
              }
            });
            
            console.log(`✅ Negotiation unlocked for booking ${bookingId}`);
            
          } else if (metadata.payment_type === 'escrow') {
            bookingUpdate.escrowPaid = true;
            bookingUpdate.escrowAmount = amount / 100;
            bookingUpdate.escrowReference = reference;
            bookingUpdate.escrowPaidAt = new Date().toISOString();
            bookingUpdate.escrowStatus = 'held';
          }

          await bookingRef.update(bookingUpdate);
          console.log(`Booking ${bookingId} updated for ${metadata.payment_type} payment`);
          
          // Also update in tuition-bookings if that's the structure being used
          if (metadata.payment_type === 'booking_fee') {
            const tuitionBookingRef = db.ref(`tuition-bookings/${bookingId}`);
            await tuitionBookingRef.update({
              ...bookingUpdate,
              negotiationUnlocked: true,
              negotiationUnlockedAt: new Date().toISOString()
            });
            console.log(`Tuition booking ${bookingId} also updated`);
          }
        }
        break;

      case 'charge.failed':
        console.error('❌ Payment failed:', reference);
        await transactionRef.update({
          ...updateData,
          status: 'failed',
          failedAt: new Date().toISOString(),
          failureReason: gateway_response || 'Unknown error',
          metadata: { ...transaction.metadata, ...metadata }
        });
        break;

      case 'transfer.success':
        console.log('✅ Transfer successful:', reference);
        await transactionRef.update({
          ...updateData,
          transferStatus: 'success',
          transferCompletedAt: new Date().toISOString()
        });
        break;

      case 'transfer.failed':
        console.error('❌ Transfer failed:', reference);
        await transactionRef.update({
          ...updateData,
          transferStatus: 'failed',
          transferFailedAt: new Date().toISOString(),
          transferFailureReason: gateway_response || 'Unknown error'
        });
        break;

      case 'subscription.create':
      case 'subscription.disable':
      case 'subscription.not_renew':
        console.log(`ℹ️ Subscription event: ${eventType}`, reference);
        await transactionRef.update({
          ...updateData,
          subscriptionStatus: eventType.split('.')[1],
          lastSubscriptionEvent: new Date().toISOString()
        });
        break;

      default:
        console.log(`ℹ️ Unhandled webhook event: ${eventType}`);
        await transactionRef.update({
          ...updateData,
          notes: `Unhandled event type: ${eventType}`
        });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Release escrow payment to teacher
 * POST /api/payments/release-escrow
 */
const releaseEscrow = async (req, res) => {
  try {
    const { bookingId, teacherPhone, amount } = req.body;

    if (!bookingId || !teacherPhone || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: bookingId, teacherPhone, amount'
      });
    }

    const db = getDatabase();
    
    // Verify booking is completed by both parties
    const bookingSnapshot = await db.ref(`tuition-bookings/${bookingId}`).once('value');
    const booking = bookingSnapshot.val();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!booking.parentCompletedAt || !booking.teacherCompletedAt) {
      return res.status(400).json({
        success: false,
        message: 'Both parties must confirm completion before releasing escrow'
      });
    }

    if (booking.escrowStatus === 'released') {
      return res.status(400).json({
        success: false,
        message: 'Escrow has already been released'
      });
    }

    // In production, you would initiate a transfer to teacher's account here
    // For now, we'll just update the status
    await db.ref(`tuition-bookings/${bookingId}`).update({
      escrowStatus: 'released',
      paymentStatus: 'paid',
      paidAt: Date.now(),
      status: 'completed'
    });

    console.log(`✅ Escrow released: KSh ${amount} to teacher ${teacherPhone}`);

    return res.status(200).json({
      success: true,
      message: 'Escrow payment released successfully',
      data: {
        bookingId,
        amount,
        teacherPhone,
        releasedAt: Date.now()
      }
    });
  } catch (error) {
    console.error('Escrow release error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get payment status
 * GET /api/payments/status/:reference
 */
const getPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    const db = getDatabase();
    const snapshot = await db.ref(`payment-transactions/${reference}`).once('value');
    const transaction = snapshot.val();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Retry failed M-Pesa payment
 * POST /api/payments/retry/:reference
 */
const retryMpesaPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { phone, email } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    const db = getDatabase();
    const transactionRef = db.ref(`payment-transactions/${reference}`);
    const snapshot = await transactionRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const transaction = snapshot.val();
    
    if (transaction.status !== 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Only failed transactions can be retried'
      });
    }

    // Use provided phone/email or fallback to original
    const retryPhone = phone || transaction.phone;
    const retryEmail = email || transaction.email;

    // Create new retry reference
    const retryReference = `retry_${uuidv4()}`;
    
    // Update original transaction
    await transactionRef.update({
      status: 'retrying',
      retryReference,
      retryCount: (transaction.retryCount || 0) + 1,
      lastRetryAt: Date.now()
    });

    // Process retry using the direct M-Pesa method
    const retryData = {
      phone: retryPhone,
      email: retryEmail,
      amount: transaction.amount,
      bookingId: transaction.bookingId,
      metadata: {
        ...transaction.metadata,
        original_reference: reference,
        is_retry: true
      }
    };

    // Call the direct payment method with new reference
    const retryResult = await processMpesaPaymentDirect({
      body: retryData
    }, res);

    return res.status(200).json({
      success: true,
      message: 'Payment retry initiated',
      data: {
        originalReference: reference,
        newReference: retryReference,
        retryCount: (transaction.retryCount || 0) + 1
      }
    });

  } catch (error) {
    console.error('Retry payment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retry payment',
      error: error.message
    });
  }
};

/**
 * Cancel pending payment
 * POST /api/payments/cancel/:reference
 */
const cancelPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { reason } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    const db = getDatabase();
    const transactionRef = db.ref(`payment-transactions/${reference}`);
    const snapshot = await transactionRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const transaction = snapshot.val();
    
    if (transaction.status === 'success') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed payment'
      });
    }

    if (transaction.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Payment already cancelled'
      });
    }

    // Update transaction status
    await transactionRef.update({
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelReason: reason || 'User requested cancellation'
    });

    // Update booking if applicable
    if (transaction.bookingId) {
      const bookingRef = db.ref(`bookings/${transaction.bookingId}`);
      await bookingRef.update({
        lastUpdated: new Date().toISOString(),
        status: 'cancelled',
        cancelReason: reason || 'Payment cancelled'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment cancelled successfully',
      data: {
        reference,
        cancelledAt: Date.now()
      }
    });

  } catch (error) {
    console.error('Cancel payment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel payment',
      error: error.message
    });
  }
};

/**
 * Get transaction history for a user
 * GET /api/payments/history/:userId
 */
const getTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0, status } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const db = getDatabase();
    const transactionsRef = db.ref('payment-transactions')
      .orderByChild('email')
      .equalTo(userId)
      .limitToFirst(parseInt(limit));

    const snapshot = await transactionsRef.once('value');
    const transactions = snapshot.val() || {};

    // Filter by status if provided
    let filteredTransactions = Object.values(transactions);
    if (status) {
      filteredTransactions = filteredTransactions.filter(t => t.status === status);
    }

    // Sort by creation date (newest first)
    filteredTransactions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Apply offset
    const paginatedTransactions = filteredTransactions.slice(parseInt(offset));

    return res.status(200).json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        total: filteredTransactions.length,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('Get transaction history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction history',
      error: error.message
    });
  }
};

/**
 * Check if negotiation is unlocked for a booking
 * GET /api/payments/negotiation-status/:bookingId
 */
const getNegotiationStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    const db = getDatabase();
    
    // Check both possible locations
    const [bookingSnapshot, tuitionBookingSnapshot] = await Promise.all([
      db.ref(`bookings/${bookingId}`).once('value'),
      db.ref(`tuition-bookings/${bookingId}`).once('value')
    ]);

    const booking = bookingSnapshot.val();
    const tuitionBooking = tuitionBookingSnapshot.val();
    
    // Use whichever exists
    const bookingData = booking || tuitionBooking;

    if (!bookingData) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const isNegotiationUnlocked = bookingData.negotiationUnlocked || false;
    const negotiationData = bookingData.negotiation || null;
    const bookingFeePaid = bookingData.bookingFeePaid || false;

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        status: bookingData.status,
        negotiationUnlocked: isNegotiationUnlocked,
        bookingFeePaid: bookingFeePaid,
        negotiation: negotiationData,
        unlockedAt: bookingData.negotiationUnlockedAt || null,
        lastUpdated: bookingData.lastUpdated || null
      }
    });
  } catch (error) {
    console.error('Get negotiation status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Validate M-Pesa phone number
 * POST /api/payments/validate-phone
 */
const validateMpesaNumber = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Format phone number
    let formattedPhone = phone.replace(/\s+/g, '');
    
    // Remove any non-digit characters
    formattedPhone = formattedPhone.replace(/\D/g, '');
    
    // Handle different formats
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('+254')) {
      formattedPhone = formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('254')) {
      // Already in correct format
    } else if (formattedPhone.length === 9) {
      // Assume Kenya number without prefix
      formattedPhone = '254' + formattedPhone;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please use format: 254XXXXXXXXX or 07XXXXXXXXX'
      });
    }

    // Validate phone number format (should be 12 digits: 254XXXXXXXXX)
    if (!/^254\d{9}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Should be 254XXXXXXXXX'
      });
    }

    // Check if it's a valid Kenyan mobile prefix
    const validPrefixes = ['2547', '2541']; // 07XX and 01XX series
    const isValidPrefix = validPrefixes.some(prefix => formattedPhone.startsWith(prefix));
    
    if (!isValidPrefix) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Kenyan mobile number prefix'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Phone number is valid',
      data: {
        originalPhone: phone,
        formattedPhone: formattedPhone,
        country: 'Kenya',
        provider: formattedPhone.startsWith('2547') ? 'Safaricom MPesa' : 'Other Kenyan Mobile'
      }
    });

  } catch (error) {
    console.error('Validate phone error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to validate phone number',
      error: error.message
    });
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
  processMpesaPayment,
  processMpesaPaymentDirect,
  handleWebhook,
  releaseEscrow,
  getPaymentStatus,
  retryMpesaPayment,
  cancelPayment,
  getTransactionHistory,
  validateMpesaNumber,
  getNegotiationStatus
};