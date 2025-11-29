#!/bin/bash

# Build and Package Script for iMac
# This script builds your app and creates a deployment package

echo "🚀 Starting build process..."

# Step 1: Build the web app
echo "📦 Building web app..."
bunx expo export -p web

# Step 2: Copy PHP sync files
echo "📋 Copying PHP sync files..."
mkdir -p dist/Tracker/api
mkdir -p dist/Tracker/data
cp public/Tracker/api/sync.php dist/Tracker/api/
cp public/Tracker/api/get.php dist/Tracker/api/
cp public/Tracker/api/.htaccess dist/Tracker/api/
cp public/Tracker/data/.htaccess dist/Tracker/data/
touch dist/Tracker/data/.gitkeep

# Step 3: Copy .htaccess
echo "🔧 Copying .htaccess..."
cp .htaccess dist/.htaccess 2>/dev/null || cp htaccess dist/.htaccess 2>/dev/null || echo "⚠️  No .htaccess found"

# Step 4: Run post-export script if it exists
if [ -f "scripts/post-export.js" ]; then
  echo "🔨 Running post-export script..."
  node scripts/post-export.js
fi

echo "✅ Build complete! Files are in the 'dist' folder"
echo ""
echo "To create a deployment package, run:"
echo "  cd dist && zip -r ../tracker-app.zip . && cd .."
echo ""
echo "Or to deploy directly via rsync:"
echo "  rsync -avz --delete dist/ user@yourserver.com:/path/to/public_html/"
