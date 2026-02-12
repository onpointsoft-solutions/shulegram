require('dotenv').config();
const axios = require('axios');

// Allow command line argument to test live keys: node test-paystack-key.js live
const testLive = process.argv[2] === 'live';
const isProduction = testLive || process.env.NODE_ENV === 'production';

const PAYSTACK_SECRET_KEY = isProduction 
  ? process.env.PAYSTACK_SECRET_KEY 
  : process.env.PAYSTACK_TEST_SECRET_KEY;

const PAYSTACK_PUBLIC_KEY = isProduction
  ? process.env.PAYSTACK_PUBLIC_KEY
  : process.env.PAYSTACK_TEST_PUBLIC_KEY;

console.log('=== Testing Paystack API Key ===');
console.log('Environment:', isProduction ? 'PRODUCTION (LIVE)' : 'DEVELOPMENT (TEST)');
console.log('Secret Key loaded:', PAYSTACK_SECRET_KEY ? 'YES' : 'NO');
console.log('Public Key loaded:', PAYSTACK_PUBLIC_KEY ? 'YES' : 'NO');

if (!PAYSTACK_SECRET_KEY) {
  console.error('❌ No secret key found in environment variables');
  process.exit(1);
}

console.log('Key format:', PAYSTACK_SECRET_KEY.substring(0, 8) + '...' + PAYSTACK_SECRET_KEY.substring(PAYSTACK_SECRET_KEY.length - 4));
console.log('Key length:', PAYSTACK_SECRET_KEY.length);
console.log('Starts with sk_test_:', PAYSTACK_SECRET_KEY.startsWith('sk_test_'));
console.log('Starts with sk_live_:', PAYSTACK_SECRET_KEY.startsWith('sk_live_'));

// Check for common issues
if (PAYSTACK_SECRET_KEY.includes(' ')) {
  console.error('❌ ERROR: Key contains spaces!');
}
if (PAYSTACK_SECRET_KEY.includes('"') || PAYSTACK_SECRET_KEY.includes("'")) {
  console.error('❌ ERROR: Key contains quotes!');
}

console.log('\n=== Testing API Connection ===');

// Test the key with a simple API call
axios.get('https://api.paystack.co/transaction', {
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  },
  params: {
    perPage: 1
  }
})
.then(response => {
  console.log('✅ SUCCESS! API key is valid');
  console.log('Response status:', response.status);
  console.log('Response message:', response.data.message);
})
.catch(error => {
  console.error('❌ FAILED! API key test failed');
  console.error('Status:', error.response?.status);
  console.error('Error:', error.response?.data?.message || error.message);
  
  if (error.response?.status === 401) {
    console.error('\n🔍 Diagnosis: Invalid API key');
    console.error('Please check:');
    console.error('1. Copy the FULL secret key from Paystack dashboard');
    console.error('2. Make sure it starts with sk_test_ (for test mode)');
    console.error('3. No extra spaces or quotes in .env file');
    console.error('4. Format in .env should be: PAYSTACK_TEST_SECRET_KEY=sk_test_xxxxx');
  }
  
  process.exit(1);
});
