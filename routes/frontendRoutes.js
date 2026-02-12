const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Serve static files from the public directory
const publicPath = path.join(__dirname, '../public');

// Serve the main index.html for the root route
router.get('/', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  console.log('Serving index from:', indexPath);
  res.sendFile(indexPath);
});

// Serve static HTML files for legal pages
const staticPages = {
  '/terms-and-conditions': 'terms-and-conditions.html',
  '/child-protection-policy': 'child-protection-policy.html',
  '/privacy-policy': 'privacy-policy.html',
  '/data-protection': 'data-protection.html'
};

// Create routes for static pages
Object.entries(staticPages).forEach(([route, file]) => {
  const filePath = path.join(publicPath, file);
  
  // Check if file exists before creating route
  if (fs.existsSync(filePath)) {
    router.get(route, (req, res) => {
      res.sendFile(filePath);
    });
  } else {
    console.warn(`Warning: File not found for route ${route}: ${filePath}`);
  }
});

// Fallback to serve index.html for SPA routing (exclude API routes)
router.get('*', (req, res, next) => {
  // Don't intercept API routes
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return next();
  }
  
  const indexPath = path.join(publicPath, 'index.html');
  console.log('SPA fallback serving index from:', indexPath);
  res.sendFile(indexPath);
});

module.exports = router;
