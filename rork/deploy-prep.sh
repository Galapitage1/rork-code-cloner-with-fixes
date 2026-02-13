#!/bin/bash

# ========================================
# COMPLETE DEPLOYMENT PREPARATION
# ========================================
# This script will:
# 1. Clean old builds
# 2. Build fresh
# 3. Copy all necessary files
# 4. Create a ZIP ready for upload
# ========================================

set -e  # Exit on any error

echo ""
echo "🧹 Step 1: Cleaning old builds..."
rm -rf dist
rm -f tracker-app.zip
echo "   ✅ Clean complete"

echo ""
echo "📦 Step 2: Building web app..."
bunx expo export -p web

if [ ! -d "dist" ]; then
  echo "   ❌ ERROR: dist folder was not created!"
  echo "   The build failed. Check the error messages above."
  exit 1
fi
echo "   ✅ Build complete"

echo ""
echo "📋 Step 3: Copying additional files..."

# Create directories
mkdir -p dist/Tracker/api
mkdir -p dist/Tracker/data

# Copy PHP sync files
if [ -d "public/Tracker/api" ]; then
  cp public/Tracker/api/sync.php dist/Tracker/api/ 2>/dev/null || echo "   ⚠️  sync.php not found"
  cp public/Tracker/api/get.php dist/Tracker/api/ 2>/dev/null || echo "   ⚠️  get.php not found"
  cp public/Tracker/api/.htaccess dist/Tracker/api/ 2>/dev/null || echo "   ⚠️  api .htaccess not found"
else
  echo "   ⚠️  public/Tracker/api folder not found"
fi

if [ -d "public/Tracker/data" ]; then
  cp public/Tracker/data/.htaccess dist/Tracker/data/ 2>/dev/null || echo "   ⚠️  data .htaccess not found"
  touch dist/Tracker/data/.gitkeep
else
  echo "   ⚠️  public/Tracker/data folder not found"
fi

# Copy main .htaccess
if [ -f ".htaccess" ]; then
  cp .htaccess dist/.htaccess
  echo "   ✅ Copied .htaccess"
elif [ -f "htaccess" ]; then
  cp htaccess dist/.htaccess
  echo "   ✅ Copied htaccess (renamed to .htaccess)"
else
  echo "   ⚠️  No .htaccess file found"
fi

# Run post-export script
if [ -f "scripts/post-export.js" ]; then
  echo ""
  echo "🔨 Step 4: Running post-export script..."
  node scripts/post-export.js || echo "   ⚠️  Post-export script had issues"
fi

echo ""
echo "✅ All files prepared!"
echo ""

# Show what's in dist
echo "📁 Contents of dist folder:"
ls -lah dist/ | head -20
echo ""

# Verify key files
echo "🔍 Verifying key files..."
MISSING=0

if [ ! -f "dist/index.html" ]; then
  echo "   ❌ MISSING: index.html"
  MISSING=1
else
  echo "   ✅ index.html"
fi

if [ ! -f "dist/.htaccess" ]; then
  echo "   ⚠️  WARNING: .htaccess not found"
else
  echo "   ✅ .htaccess"
fi

if [ ! -d "dist/_expo" ]; then
  echo "   ❌ MISSING: _expo folder"
  MISSING=1
else
  echo "   ✅ _expo folder"
fi

if [ ! -d "dist/assets" ]; then
  echo "   ⚠️  WARNING: assets folder not found"
else
  echo "   ✅ assets folder"
fi

if [ $MISSING -eq 1 ]; then
  echo ""
  echo "❌ BUILD INCOMPLETE - Some critical files are missing!"
  echo "   Do NOT upload to server. Check error messages above."
  exit 1
fi

echo ""
echo "📦 Step 5: Creating ZIP file..."
cd dist
zip -r ../tracker-app.zip . -q

if [ $? -ne 0 ]; then
  echo "   ❌ Failed to create ZIP file"
  exit 1
fi

cd ..
echo "   ✅ ZIP created"

echo ""
echo "📊 Package info:"
echo "   File: tracker-app.zip"
echo "   Size: $(du -h tracker-app.zip | cut -f1)"
echo ""

# Check that home page change is in the build
echo "🔍 Verifying your changes are in the build..."
if grep -r "WELCOME TO THE ENGLISH CAKE COMPANY" dist/ > /dev/null 2>&1; then
  echo "   ✅ Home page title change CONFIRMED in build"
else
  echo "   ⚠️  WARNING: Home page title change NOT found in build"
  echo "   This might mean the build didn't pick up recent changes."
fi

echo ""
echo "================================================"
echo "✅✅✅ DEPLOYMENT PACKAGE READY! ✅✅✅"
echo "================================================"
echo ""
echo "Your file: tracker-app.zip"
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Open FileZilla and connect to your server"
echo ""
echo "2. Navigate to your public_html folder"
echo ""
echo "3. DELETE all old files (keep Tracker/data if you want to preserve data)"
echo ""
echo "4. Extract tracker-app.zip on your computer:"
echo "   - Right-click tracker-app.zip"
echo "   - Choose 'Extract All' or use: unzip tracker-app.zip -d upload-this"
echo ""
echo "5. Upload EVERYTHING from the extracted folder to your server"
echo "   (Make sure to show hidden files in FileZilla to see .htaccess)"
echo ""
echo "6. Set permissions for Tracker/data to 777"
echo ""
echo "7. Clear your browser cache or use Incognito mode to test"
echo ""
echo "8. Visit your site - you should see the changes!"
echo ""
echo "================================================"
