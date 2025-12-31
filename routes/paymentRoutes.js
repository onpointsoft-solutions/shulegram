const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/paymentController');

// Payment routes
router.post('/initialize', initializePayment);
router.get('/verify/:reference', verifyPayment);
router.post('/mpesa', processMpesaPayment);
router.post('/mpesa/direct', processMpesaPaymentDirect);
router.post('/webhook', handleWebhook);
router.post('/release-escrow', releaseEscrow);
router.get('/status/:reference', getPaymentStatus);
router.post('/retry/:reference', retryMpesaPayment);
router.post('/cancel/:reference', cancelPayment);
router.get('/history/:userId', getTransactionHistory);
router.post('/validate-phone', validateMpesaNumber);
router.get('/negotiation-status/:bookingId', getNegotiationStatus);

module.exports = router;
