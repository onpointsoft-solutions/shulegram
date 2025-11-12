# ShulePearl Payment Backend

Node.js backend server for handling Paystack payments with MPesa support and Firebase integration for the ShulePearl mobile app.

## Features

- ✅ Paystack payment initialization
- ✅ MPesa mobile money payments
- ✅ Payment verification
- ✅ Webhook handling for real-time payment updates
- ✅ Firebase integration for booking management
- ✅ Escrow payment system
- ✅ Secure API with authentication

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Paystack account (https://paystack.com)
- Firebase project with Realtime Database

## Installation

### 1. Install Dependencies

```bash
cd ~/Desktop/shulepearl-payment-backend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-firebase-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com

# Security
API_SECRET=your-random-secret-key-here

# Webhook
PAYSTACK_WEBHOOK_SECRET=your-paystack-webhook-secret
```

### 3. Get Paystack Credentials

1. Sign up at https://paystack.com
2. Go to **Settings** → **API Keys & Webhooks**
3. Copy your **Secret Key** and **Public Key**
4. Add them to your `.env` file

### 4. Get Firebase Credentials

1. Go to Firebase Console → **Project Settings** → **Service Accounts**
2. Click **Generate New Private Key**
3. Download the JSON file
4. Extract the values and add to `.env`:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY`
5. Get Database URL from **Realtime Database** section

### 5. Set Up Webhook

1. In Paystack Dashboard, go to **Settings** → **API Keys & Webhooks**
2. Add webhook URL: `https://your-server-url.com/api/payments/webhook`
3. Copy the webhook secret and add to `.env`

## Running the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### 1. Initialize Payment

**POST** `/api/payments/initialize`

**Headers:**
```
x-api-key: your-api-secret
Content-Type: application/json
```

**Body:**
```json
{
  "email": "parent@example.com",
  "amount": 500,
  "bookingId": "booking123",
  "metadata": {
    "payment_type": "escrow",
    "teacher_phone": "254712345678"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment initialized successfully",
  "data": {
    "reference": "booking_123_1234567890",
    "access_code": "abc123",
    "authorization_url": "https://checkout.paystack.com/abc123"
  }
}
```

### 2. Verify Payment

**GET** `/api/payments/verify/:reference`

**Headers:**
```
x-api-key: your-api-secret
```

**Response:**
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "status": "success",
    "amount": 500,
    "reference": "booking_123_1234567890",
    "paid_at": "2024-01-01T12:00:00Z",
    "channel": "mobile_money"
  }
}
```

### 3. Process MPesa Payment

**POST** `/api/payments/mpesa`

**Headers:**
```
x-api-key: your-api-secret
Content-Type: application/json
```

**Body:**
```json
{
  "phone": "254712345678",
  "email": "parent@example.com",
  "amount": 50,
  "bookingId": "booking123",
  "metadata": {
    "payment_type": "booking_fee"
  }
}
```

### 4. Release Escrow

**POST** `/api/payments/release-escrow`

**Headers:**
```
x-api-key: your-api-secret
Content-Type: application/json
```

**Body:**
```json
{
  "bookingId": "booking123",
  "teacherPhone": "254712345678",
  "amount": 500
}
```

### 5. Webhook (No authentication required)

**POST** `/api/payments/webhook`

Automatically called by Paystack when payment events occur.

## Deployment

### Option 1: Heroku

```bash
# Install Heroku CLI
# Login to Heroku
heroku login

# Create app
heroku create shulepearl-payment-backend

# Set environment variables
heroku config:set PAYSTACK_SECRET_KEY=sk_test_xxx
heroku config:set FIREBASE_PROJECT_ID=xxx
# ... set all other env variables

# Deploy
git push heroku main
```

### Option 2: Railway

1. Go to https://railway.app
2. Create new project from GitHub
3. Add environment variables in Railway dashboard
4. Deploy automatically

### Option 3: DigitalOcean App Platform

1. Go to https://cloud.digitalocean.com
2. Create new App
3. Connect GitHub repository
4. Add environment variables
5. Deploy

## Update Android App

Update the PaymentService in your Android app to use this backend:

```kotlin
companion object {
    private const val BACKEND_URL = "https://your-backend-url.com"
    private const val API_KEY = "your-api-secret"
}
```

## Testing

### Test with Paystack Test Cards

- **Successful payment:** 4084084084084081
- **Failed payment:** 4084080000000408

### Test MPesa

Use Paystack test mode with test phone numbers provided in their documentation.

## Security Notes

- ✅ Never commit `.env` file to Git
- ✅ Use strong API secrets
- ✅ Enable HTTPS in production
- ✅ Validate webhook signatures
- ✅ Rate limit API endpoints
- ✅ Monitor for suspicious activity

## Troubleshooting

### Firebase Connection Issues

- Verify private key format (should include `\n` for newlines)
- Check Firebase Database URL
- Ensure service account has proper permissions

### Paystack Payment Failures

- Verify secret key is correct
- Check if test mode is enabled
- Ensure amount is in correct format (kobo/cents)

### Webhook Not Receiving Events

- Verify webhook URL is publicly accessible
- Check webhook secret matches
- Test with Paystack webhook tester

## Support

For issues or questions:
- Email: support@shulepearl.app
- GitHub: https://github.com/your-repo

## License

MIT
