const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Serve static files from the public directory
const publicPath = path.join(__dirname, '../public');

// Serve the main index.html for the root route
router.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'src/index.html'));
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

// Fallback to serve index.html for SPA routing
router.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'src/index.html'));
});

module.exports = router;
