const axios = require('axios');
require('dotenv').config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Create axios instance with Paystack config
const paystackApi = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Add request interceptor for logging
paystackApi.interceptors.request.use(
  config => {
    console.log('Paystack Request:', {
      method: config.method.toUpperCase(),
      url: config.url,
      data: config.data
    });
    return config;
  },
  error => {
    console.error('Paystack Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for logging
paystackApi.interceptors.response.use(
  response => {
    console.log('Paystack Response:', {
      status: response.status,
      url: response.config.url,
      data: response.data
    });
    return response;
  },
  error => {
    console.error('Paystack API Error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      config: {
        url: error.config?.url,
        method: error.config?.method
      }
    });
    return Promise.reject(error);
  }
);

module.exports = {
  paystackApi,
  PAYSTACK_SECRET_KEY
};
