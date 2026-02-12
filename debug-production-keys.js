require('dotenv').config();
const axios = require('axios');

console.log('=== Production Paystack Key Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('API_SECRET:', process.env.API_SECRET ? 'SET' : 'NOT SET');

// Check which keys are being used
const isProduction = process.env.NODE_ENV === 'production';
const PAYSTACK_SECRET_KEY = isProduction 
  ? process.env.PAYSTACK_SECRET_KEY 
  : process.env.PAYSTACK_TEST_SECRET_KEY;

console.log('Environment Mode:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('Secret Key Loaded:', PAYSTACK_SECRET_KEY ? 'YES' : 'NO');

if (PAYSTACK_SECRET_KEY) {
  console.log('Key Format:', PAYSTACK_SECRET_KEY.substring(0, 8) + '...' + PAYSTACK_SECRET_KEY.substring(PAYSTACK_SECRET_KEY.length - 4));
  console.log('Key Length:', PAYSTACK_SECRET_KEY.length);
  console.log('Starts with sk_test_:', PAYSTACK_SECRET_KEY.startsWith('sk_test_'));
  console.log('Starts with sk_live_:', PAYSTACK_SECRET_KEY.startsWith('sk_live_'));
  
  // Test the key with Paystack API
  console.log('\n=== Testing Paystack API ===');
  axios.get('https://api.paystack.co/transaction', {
    headers: {
      'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    params: { perPage: 1 }
  })
  .then(response => {
    console.log('✅ SUCCESS: Paystack API key is valid');
    console.log('Response Status:', response.status);
    console.log('Response Message:', response.data.message);
  })
  .catch(error => {
    console.log('❌ FAILED: Paystack API key is invalid');
    console.log('Error Status:', error.response?.status);
    console.log('Error Message:', error.response?.data?.message);
    
    if (error.response?.status === 401) {
      console.log('\n🔍 Diagnosis:');
      console.log('- The Paystack key is invalid or expired');
      console.log('- Check if you have the correct live key');
      console.log('- Verify the key is set correctly in production environment');
    }
  });
} else {
  console.log('❌ ERROR: No Paystack secret key found in environment');
}

console.log('=====================================');
