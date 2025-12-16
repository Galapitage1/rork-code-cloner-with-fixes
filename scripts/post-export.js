#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const __filename = fileURLToPath(import.meta.url || 'file://' + __filename);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, '..', 'dist');
const htaccessSource = path.join(__dirname, '..', '.htaccess');
const htaccessDest = path.join(distPath, '.htaccess');

if (fs.existsSync(distPath) && fs.existsSync(htaccessSource)) {
  try {
    fs.copyFileSync(htaccessSource, htaccessDest);
    console.log('✅ .htaccess file copied to dist folder');
    console.log('   This fixes the 404 error on page refresh');
  } catch (error) {
    console.error('❌ Failed to copy .htaccess:', error.message);
    process.exit(1);
  }
} else {
  if (!fs.existsSync(distPath)) {
    console.log('⚠️  dist folder not found - run expo export first');
  }
  if (!fs.existsSync(htaccessSource)) {
    console.log('⚠️  .htaccess file not found in project root');
  }
}
