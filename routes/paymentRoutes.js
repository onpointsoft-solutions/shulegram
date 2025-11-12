const express = require('express');
const router = express.Router();
const {
  initializePayment,
  verifyPayment,
  processMpesaPayment,
  handleWebhook,
  releaseEscrow
} = require('../controllers/paymentController');

// Payment routes
router.post('/initialize', initializePayment);
router.get('/verify/:reference', verifyPayment);
router.post('/mpesa', processMpesaPayment);
router.post('/webhook', handleWebhook);
router.post('/release-escrow', releaseEscrow);

module.exports = router;
