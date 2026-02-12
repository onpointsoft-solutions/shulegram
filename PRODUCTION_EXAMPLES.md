# Production-Ready M-Pesa Payment API Examples

## Environment Setup

### Required Environment Variables

```bash
# Server Configuration
NODE_ENV=production
PORT=3000
API_SECRET=AasShulePearl-2050

# Paystack Configuration (PRODUCTION)
PAYSTACK_SECRET_KEY=sk_live_YOUR_LIVE_SECRET_KEY_HERE
PAYSTACK_PUBLIC_KEY=pk_live_your_live_public_key
PAYSTACK_WEBHOOK_SECRET=whsec_your_webhook_secret

# CORS Configuration
FRONTEND_URL=https://shulegram.co.ke

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

## API Endpoints

### 1. Initialize MPesa Payment

**Request:**
```bash
curl -X POST https://backend.shulegram.co.ke/api/payments/mpesa \
  -H "Content-Type: application/json" \
  -H "x-api-key: AasShulePearl-2050" \
  -d '{
    "phone": "254702502952",
    "amount": 1000,
    "email": "customer@example.com",
    "bookingId": "booking123",
    "metadata": {
      "payment_type": "booking_fee",
      "userId": "user123"
    }
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Payment initiated successfully",
  "data": {
    "reference": "mpesa_abc123def456",
    "status": "pending",
    "amount": 1000,
    "currency": "KES",
    "phone": "254702****52",
    "checkout_url": "https://checkout.paystack.com/abc123",
    "display_text": "Please check your phone for MPesa prompt"
  },
  "requestId": "A1B2C3D4E5F6"
}
```

**Validation Error Response (400):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "phone",
      "message": "Phone number must be in format 2547XXXXXXXX (12 digits)",
      "value": "0712345678"
    }
  ],
  "requestId": "A1B2C3D4E5F6"
}
```

**Invalid API Key Response (401):**
```json
{
  "success": false,
  "message": "Invalid API key",
  "requestId": "A1B2C3D4E5F6"
}
```

**Rate Limit Response (429):**
```json
{
  "success": false,
  "message": "Too many payment attempts, please try again later.",
  "requestId": "RATE_LIMIT_EXCEEDED"
}
```

### 2. Verify Payment

**Request:**
```bash
curl -X GET https://backend.shulegram.co.ke/api/payments/verify/mpesa_abc123def456 \
  -H "x-api-key: AasShulePearl-2050"
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "status": "success",
    "amount": 1000,
    "reference": "mpesa_abc123def456",
    "paid_at": "2026-02-12T14:30:00.000Z",
    "channel": "mobile_money"
  },
  "requestId": "A1B2C3D4E5F6"
}
```

### 3. Get Payment Status

**Request:**
```bash
curl -X GET https://backend.shulegram.co.ke/api/payments/status/mpesa_abc123def456 \
  -H "x-api-key: AasShulePearl-2050"
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "reference": "mpesa_abc123def456",
    "bookingId": "booking123",
    "email": "customer@example.com",
    "phone": "254702****52",
    "amount": 1000,
    "status": "success",
    "paymentMethod": "mpesa",
    "createdAt": 1644678600000,
    "verifiedAt": 1644678800000,
    "environment": "production"
  },
  "requestId": "A1B2C3D4E5F6"
}
```

### 4. Validate Phone Number

**Request:**
```bash
curl -X POST https://backend.shulegram.co.ke/api/payments/validate-phone \
  -H "Content-Type: application/json" \
  -H "x-api-key: AasShulePearl-2050" \
  -d '{
    "phone": "0712345678"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "formatted": "254712345678",
    "original": "0712345678",
    "network": "Safaricom"
  },
  "requestId": "A1B2C3D4E5F6"
}
```

### 5. Health Check

**Request:**
```bash
curl https://backend.shulegram.co.ke/health
```

**Success Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-12T14:30:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "1.0.0",
  "requestId": "A1B2C3D4E5F6",
  "services": {
    "database": "connected",
    "payments": "connected"
  }
}
```

**Degraded Response (503):**
```json
{
  "status": "degraded",
  "timestamp": "2026-02-12T14:30:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "1.0.0",
  "requestId": "A1B2C3D4E5F6",
  "services": {
    "database": "disconnected",
    "payments": "connected"
  }
}
```

## Error Handling Examples

### Malformed JSON (400)
```json
{
  "success": false,
  "message": "Invalid JSON format in request body",
  "requestId": "A1B2C3D4E5F6"
}
```

### Request Too Large (413)
```json
{
  "success": false,
  "message": "Request entity too large",
  "requestId": "A1B2C3D4E5F6"
}
```

### Service Unavailable (503)
```json
{
  "success": false,
  "message": "Payment service temporarily unavailable",
  "requestId": "A1B2C3D4E5F6"
}
```

### Internal Server Error (500)
```json
{
  "success": false,
  "message": "Internal server error",
  "requestId": "A1B2C3D4E5F6"
}
```

## Security Features

### Rate Limiting
- **General API**: 100 requests per 15 minutes per IP
- **Payment endpoints**: 10 requests per minute per IP
- **Webhooks**: 1000 requests per minute per IP

### Request Size Limits
- **Maximum request body**: 10KB
- **JSON parsing**: Graceful error handling

### Security Headers
- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options
- X-Content-Type-Options
- Referrer Policy

### Input Validation
- Phone numbers: `^2547\d{8}$` format
- Amounts: Positive integers (1-1,000,000 KES)
- Emails: Valid email format
- Booking IDs: Alphanumeric (3-50 characters)

### Logging
- Structured JSON logging
- Request IDs for tracing
- Sanitized logs (no sensitive data)
- Performance monitoring
- Security event logging

## Deployment Configuration

### Nginx Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name backend.shulegram.co.ke;

    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # Proxy to Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Health check bypass
    location /health {
        proxy_pass http://localhost:3000;
        access_log off;
    }
}
```

### Cloudflare Configuration
- **Web Application Firewall (WAF)**: Enabled
- **DDoS Protection**: Enabled
- **Rate Limiting**: 100 requests per minute
- **SSL/TLS**: Full (Strict)
- **Caching**: Disabled for API endpoints
- **Page Rules**: Bypass cache for `/api/*`

### Environment Separation
```bash
# Production (.env.production)
NODE_ENV=production
PAYSTACK_SECRET_KEY=sk_live_*
FRONTEND_URL=https://shulegram.co.ke

# Development (.env.development)  
NODE_ENV=development
PAYSTACK_TEST_SECRET_KEY=sk_test_*
FRONTEND_URL=http://localhost:3000
```

## Monitoring and Alerting

### Key Metrics
- Request rate and response times
- Error rates by endpoint
- Payment success/failure rates
- Third-party API response times
- Database connectivity

### Alerts
- High error rates (>5%)
- Slow response times (>2s)
- Payment service failures
- Database connectivity issues
- Security events (rate limiting, invalid API keys)

### Log Examples
```json
{
  "timestamp": "2026-02-12T14:30:00.000Z",
  "level": "INFO",
  "service": "payment-api",
  "message": "Payment initiated",
  "event": "payment_initiated",
  "reference": "mpesa_abc123",
  "phone": "254702****52",
  "amount": 1000,
  "requestId": "A1B2C3D4E5F6"
}
```

This production-ready API is suitable for deployment behind Nginx/Cloudflare with HTTPS and includes comprehensive security, validation, error handling, and monitoring features.
