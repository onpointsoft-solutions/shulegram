const { paystackApi } = require('../config/paystack');
const { getDatabase } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

/**
 * Initialize a payment transaction
 * POST /api/payments/initialize
 */
const initializePayment = async (req, res) => {
  try {
    const { email, amount, bookingId, metadata } = req.body;

    // Validate input
    if (!email || !amount || !bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email, amount, bookingId'
      });
    }

    // Convert amount to kobo (Paystack uses smallest currency unit)
    const amountInKobo = Math.round(amount * 100);

    // Generate unique reference using UUID
    const reference = `booking_${uuidv4().replace(/-/g, '')}`;

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
      await db.ref(`payment-transactions/${reference}`).set({
        reference,
        bookingId,
        email,
        amount: amount,
        status: 'pending',
        createdAt: Date.now(),
        metadata
      });

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
      return res.status(400).json({
        success: false,
        message: 'Failed to initialize payment',
        error: response.data.message
      });
    }
  } catch (error) {
    console.error('Payment initialization error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.response?.data?.message || error.message
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
          await db.ref(`bookings/${bookingId}`).update({
            bookingFeePaid: true,
            bookingFeeReference: reference,
            bookingFeePaidAt: Date.now(),
            status: 'negotiating'
          });
        } else if (paymentType === 'escrow') {
          await db.ref(`bookings/${bookingId}`).update({
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
    if (!process.env.PAYSTACK_WEBHOOK_SECRET) {
      console.error('PAYSTACK_WEBHOOK_SECRET is not set');
      return false;
    }

    const crypto = require('crypto');
    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      console.error('No signature found in request headers');
      return false;
    }

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signature)
    );
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
};

/**
 * Webhook handler for Paystack events
 * POST /api/payments/webhook
 */
const handleWebhook = async (req, res) => {
  // Log incoming webhook for debugging
  console.log('=== Incoming Webhook ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    // Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      console.error('Webhook signature verification failed');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid webhook signature' 
      });
    }

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
          const bookingUpdate = {
            lastUpdated: new Date().toISOString(),
            status: metadata.payment_type === 'booking_fee' ? 'negotiating' : 'confirmed'
          };

          if (metadata.payment_type === 'booking_fee') {
            bookingUpdate.bookingFeePaid = true;
            bookingUpdate.bookingFeeReference = reference;
            bookingUpdate.bookingFeePaidAt = new Date().toISOString();
          } else if (metadata.payment_type === 'escrow') {
            bookingUpdate.escrowPaid = true;
            bookingUpdate.escrowAmount = amount / 100;
            bookingUpdate.escrowReference = reference;
            bookingUpdate.escrowPaidAt = new Date().toISOString();
            bookingUpdate.escrowStatus = 'held';
          }

          await bookingRef.update(bookingUpdate);
          console.log(`Booking ${bookingId} updated for ${metadata.payment_type} payment`);
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
    const bookingSnapshot = await db.ref(`bookings/${bookingId}`).once('value');
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
    await db.ref(`bookings/${bookingId}`).update({
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

module.exports = {
  initializePayment,
  verifyPayment,
  processMpesaPayment,
  processMpesaPaymentDirect,
  handleWebhook,
  releaseEscrow,
  getPaymentStatus
};