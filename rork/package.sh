#!/bin/bash

# Complete Build and Package Script
# This builds the app and creates a ready-to-upload ZIP file

echo "🚀 Building and packaging app..."
echo ""

# Run the build
./build.sh

# Check if build was successful
if [ $? -ne 0 ]; then
  echo "❌ Build failed!"
  exit 1
fi

echo ""
echo "📦 Creating deployment package..."

# Create the zip file
cd dist
zip -r ../tracker-app.zip .
cd ..

echo ""
echo "✅ Package created successfully!"
echo ""
echo "📄 File: tracker-app.zip"
echo "📊 Size: $(du -h tracker-app.zip | cut -f1)"
echo ""
echo "Next steps:"
echo "1. Upload tracker-app.zip to your server"
echo "2. Extract it: unzip tracker-app.zip -d /path/to/public_html"
echo "3. Set permissions: chmod 777 /path/to/public_html/Tracker/data"
