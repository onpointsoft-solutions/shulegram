require('dotenv').config();
const axios = require('axios');

console.log('=== Production Environment Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('API_SECRET:', process.env.API_SECRET ? 'SET' : 'NOT SET');
console.log('PAYSTACK_SECRET_KEY:', process.env.PAYSTACK_SECRET_KEY ? 'SET' : 'NOT SET');
console.log('PAYSTACK_PUBLIC_KEY:', process.env.PAYSTACK_PUBLIC_KEY ? 'SET' : 'NOT SET');

// Test the actual key being used
const isProduction = process.env.NODE_ENV === 'production';
const PAYSTACK_SECRET_KEY = isProduction 
  ? process.env.PAYSTACK_SECRET_KEY 
  : process.env.PAYSTACK_TEST_SECRET_KEY;

console.log('Using key:', PAYSTACK_SECRET_KEY ? PAYSTACK_SECRET_KEY.substring(0, 8) + '...' : 'NONE');
console.log('Key length:', PAYSTACK_SECRET_KEY?.length || 0);
console.log('Starts with sk_live_: ', PAYSTACK_SECRET_KEY?.startsWith('sk_live_'));
console.log('=====================================');

// Test API call
if (PAYSTACK_SECRET_KEY) {
  axios.get('https://api.paystack.co/transaction', {
    headers: {
      'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    params: { perPage: 1 }
  })
  .then(response => {
    console.log('✅ API Test: SUCCESS');
    console.log('Status:', response.status);
  })
  .catch(error => {
    console.log('❌ API Test: FAILED');
    console.log('Status:', error.response?.status);
    console.log('Error:', error.response?.data?.message);
  });
}
