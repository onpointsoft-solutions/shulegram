# Payment API Testing with cURL

## Prerequisites
1. Start the server: `node server.js`
2. Server should be running on `http://localhost:3000`
3. **Get your API key from `.env` file** - Look for `API_SECRET` value
4. Add `-H "x-api-key: YOUR_API_SECRET"` to all requests

**Important:** All API endpoints (except webhook) require the `x-api-key` header for authentication.

---

## 1. Initialize Payment (General)

```bash
curl -X POST http://localhost:3000/api/payments/initialize ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"email\":\"test@example.com\",\"amount\":1000,\"bookingId\":\"booking123\",\"metadata\":{\"payment_type\":\"booking_fee\",\"userId\":\"user123\"}}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Payment initialized successfully",
  "data": {
    "reference": "booking_xxxxx",
    "access_code": "xxxxx",
    "authorization_url": "https://checkout.paystack.com/xxxxx"
  }
}
```

---

## 2. MPesa Payment (Recommended)

### Test Mode (uses test phone number automatically)
```bash
curl -X POST http://localhost:3000/api/payments/mpesa ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"phone\":\"0708374176\",\"amount\":500,\"email\":\"test@example.com\",\"bookingId\":\"booking123\",\"metadata\":{\"payment_type\":\"booking_fee\",\"userId\":\"user123\"}}"
```

### Production Mode (real phone number)
```bash
curl -X POST http://localhost:3000/api/payments/mpesa ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: sk_test_b6d2f668ab3b6c79f11e91a619052d37395e26a6" ^
  -d "{\"phone\":\"254702502952\",\"amount\":1000,\"email\":\"parent@example.com\",\"bookingId\":\"booking123\",\"metadata\":{\"payment_type\":\"booking_fee\",\"userId\":\"user123\"}}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Payment initialized. Please check your phone for STK push.",
  "data": {
    "reference": "init_xxxxx",
    "status": "pending",
    "checkout_url": "https://checkout.paystack.com/xxxxx",
    "display_text": "Check your phone for payment prompt"
  }
}
```

---

## 3. Direct MPesa Charge

```bash
curl -X POST http://localhost:3000/api/payments/mpesa/direct ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"phone\":\"254712345678\",\"amount\":1000,\"email\":\"test@example.com\",\"bookingId\":\"booking123\",\"metadata\":{\"payment_type\":\"escrow\"}}"
```

---

## 4. Verify Payment

Replace `PAYMENT_REFERENCE` with the reference from step 1 or 2:

```bash
curl -X GET http://localhost:3000/api/payments/verify/PAYMENT_REFERENCE ^
  -H "x-api-key: YOUR_API_SECRET"
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/payments/verify/booking_abc123xyz ^
  -H "x-api-key: YOUR_API_SECRET"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "status": "success",
    "amount": 1000,
    "reference": "booking_abc123xyz",
    "paid_at": "2026-02-12T14:00:00.000Z",
    "channel": "mobile_money"
  }
}
```

---

## 5. Get Payment Status

```bash
curl -X GET http://localhost:3000/api/payments/status/PAYMENT_REFERENCE ^
  -H "x-api-key: YOUR_API_SECRET"
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/payments/status/booking_abc123xyz ^
  -H "x-api-key: YOUR_API_SECRET"
```

---

## 6. Validate Phone Number

```bash
curl -X POST http://localhost:3000/api/payments/validate-phone ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"phone\":\"0712345678\"}"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "formatted": "254712345678",
    "original": "0712345678"
  }
}
```

---

## 7. Get Payment History

```bash
curl -X GET http://localhost:3000/api/payments/history/user123 ^
  -H "x-api-key: YOUR_API_SECRET"
```

---

## 8. Retry Failed Payment

```bash
curl -X POST http://localhost:3000/api/payments/retry/PAYMENT_REFERENCE ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"phone\":\"254712345678\",\"email\":\"test@example.com\"}"
```

---

## 9. Cancel Payment

```bash
curl -X POST http://localhost:3000/api/payments/cancel/PAYMENT_REFERENCE ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"reason\":\"User cancelled\"}"
```

---

## 10. Release Escrow Payment

```bash
curl -X POST http://localhost:3000/api/payments/release-escrow ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: YOUR_API_SECRET" ^
  -d "{\"bookingId\":\"booking123\",\"teacherPhone\":\"254712345678\",\"amount\":1000}"
```

---

## Complete Test Flow

### Step-by-Step Test (Copy and paste each command)

**1. Start the server:**
```bash
node server.js
```

**2. Initialize MPesa payment:**
```bash
curl -X POST http://localhost:3000/api/payments/mpesa -H "Content-Type: application/json" -H "x-api-key: YOUR_API_SECRET" -d "{\"phone\":\"0708374176\",\"amount\":500,\"email\":\"test@example.com\",\"bookingId\":\"test123\",\"metadata\":{\"payment_type\":\"booking_fee\"}}"
```

**3. Copy the reference from the response, then verify:**
```bash
curl -X GET http://localhost:3000/api/payments/verify/YOUR_REFERENCE_HERE -H "x-api-key: YOUR_API_SECRET"
```

**4. Check payment status:**
```bash
curl -X GET http://localhost:3000/api/payments/status/YOUR_REFERENCE_HERE -H "x-api-key: YOUR_API_SECRET"
```

---

## Testing with Postman (Alternative)

If you prefer a GUI, import these as Postman requests:

**Base URL:** `http://localhost:3000`

### Collection:
1. **POST** `/api/payments/mpesa` - MPesa Payment
2. **GET** `/api/payments/verify/:reference` - Verify Payment
3. **GET** `/api/payments/status/:reference` - Payment Status
4. **POST** `/api/payments/validate-phone` - Validate Phone

---

## Notes

- **Test Mode**: Uses Paystack test phone `254708374176`
- **Production Mode**: Uses real phone numbers
- **Amounts**: Test mode accepts 100-1000 KES, Production accepts any amount
- **Phone Format**: Accepts `0712345678`, `254712345678`, or `+254712345678`
- **Booking Fee**: Unlocks negotiation features
- **Escrow**: Holds payment until service completion

---

## Troubleshooting

### Error: "Invalid key"
- Check your `.env` file has correct Paystack keys
- Run: `node test-paystack-key.js`

### Error: "Missing required fields"
- Ensure all required fields are in the request body
- Check JSON formatting

### Error: "Invalid phone number"
- Phone must be Kenyan format: 254XXXXXXXXX (12 digits)
- Or start with 0 (10 digits): 0XXXXXXXXX

### Payment stuck in "pending"
- Check Paystack dashboard for transaction status
- Verify webhook is configured (for automatic updates)
- Manually verify using the verify endpoint
