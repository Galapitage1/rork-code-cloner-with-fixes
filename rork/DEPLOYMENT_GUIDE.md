# Complete Deployment & Embedding Guide for TECC Tracker

## Overview
This guide will help you:
1. Build and deploy your app to **tracker.tecclk.com** (your subdomain)
2. Embed it on **www.tecclk.com** (your Wix website)
3. Enable data sync across all devices

---

## Part 1: Build Your App for Web

### Step 1: Install Dependencies
On your computer, open a terminal in your project folder and run:
```bash
bun install
```

### Step 2: Build the App
Run this command to create a web version of your app:
```bash
npx expo export -p web
```

This creates a `dist` folder with all your app files.

---

## Part 2: Upload to Your Subdomain Hosting

### Step 3: Prepare Your Subdomain
1. Log in to your hosting control panel (where you manage tracker.tecclk.com)
2. Find the folder for `tracker.tecclk.com` (usually `/public_html/tracker/` or similar)
3. Make sure it's empty or back up any existing files

### Step 4: Upload Files
Upload the **entire contents** of the `dist` folder to your subdomain:

**From your computer:**
```
dist/
  ├── index.html
  ├── _expo/
  ├── assets/
  └── other files...
```

**Upload to tracker.tecclk.com root folder (not in a subfolder)**

### Step 5: Configure Your Server

#### Option A: If you have .htaccess (Apache)
Create or edit `.htaccess` file in the tracker.tecclk.com root folder:

```apache
# Enable CORS
<IfModule mod_headers.c>
  Header set Access-Control-Allow-Origin "*"
  Header set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
  Header set Access-Control-Allow-Headers "Content-Type, Authorization"
  Header set Content-Security-Policy "frame-ancestors *"
</IfModule>

# Enable rewriting
RewriteEngine On

# Redirect all requests to index.html for single-page app
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ /index.html [L,QSA]
```

#### Option B: If you use Nginx
Add to your server configuration:

```nginx
server {
    listen 80;
    server_name tracker.tecclk.com;
    root /var/www/tracker.tecclk.com;
    
    index index.html;
    
    # CORS headers
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    add_header Content-Security-Policy "frame-ancestors *" always;
    
    # Single-page app routing
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Step 6: Enable SSL (HTTPS)
**Important: Your app MUST use HTTPS to work properly**

1. In your hosting control panel, find SSL/TLS settings
2. Select "**Get automatic certificate from ACME Provider**" (Let's Encrypt)
3. Follow the prompts to enable SSL for tracker.tecclk.com
4. Wait 5-10 minutes for the certificate to be issued

Your app should now be accessible at: `https://tracker.tecclk.com`

---

## Part 3: Set Up Data Sync

Your app uses two sync methods:

### Option A: File-Based Sync (Recommended - Already Set Up)

You already have PHP sync files in `public/Tracker/api/`:
- `sync.php` - Handles data syncing
- `get.php` - Retrieves data

**Make sure these files are uploaded to:**
```
tracker.tecclk.com/Tracker/api/sync.php
tracker.tecclk.com/Tracker/api/get.php
```

### Option B: JSONBin.io Sync (Cloud-Based Backup)

For additional cloud backup, get a free JSONBin.io API key:

1. Go to https://jsonbin.io
2. Create a free account
3. Get your Master API Key

Then create a `.env` file in your project:
```
EXPO_PUBLIC_JSONBIN_KEY=your_api_key_here
EXPO_PUBLIC_FILE_SYNC_URL=https://tracker.tecclk.com/Tracker/api/
```

Rebuild and redeploy after adding this.

---

## Part 4: Embed on Your Wix Website

### Step 7: Create Embed Code

You'll add this HTML code to your Wix page. Here's the code:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TECC Tracker</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    html, body {
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    
    #app-container {
      width: 100%;
      height: 100%;
      min-height: 600px;
    }
    
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }

    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: Arial, sans-serif;
      color: #666;
    }
  </style>
</head>
<body>
  <div id="app-container">
    <div class="loading">Loading TECC Tracker...</div>
    <iframe 
      src="https://tracker.tecclk.com"
      allow="camera; geolocation; microphone; clipboard-read; clipboard-write; fullscreen"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
      onload="document.querySelector('.loading').style.display='none'"
    ></iframe>
  </div>
</body>
</html>
```

### Step 8: Add to Wix

1. Log in to your Wix website editor (www.tecclk.com)
2. Go to the page where you want the tracker
3. Click **Add (+)** → **Embed Code** → **Embed HTML**
4. Choose "**Code**" option
5. Paste the HTML code from Step 7
6. Set the iframe size:
   - **Width:** 100% or custom (e.g., 1200px)
   - **Height:** 800px minimum (or use viewport height)
7. Click **Apply**
8. Position the embed on your page
9. **Publish** your Wix site

---

## Part 5: Data Sync Across Devices

### How Sync Works

The app automatically syncs data every 30 seconds and when:
- Users log in
- Data is created/updated
- App comes to foreground

**What Gets Synced:**
- ✅ Users
- ✅ Products  
- ✅ Outlets
- ✅ Recipes
- ✅ Customers
- ✅ Messages
- ✅ Stock Checks
- ✅ Requests
- ✅ Sales History

### Device Setup

**First Device (Admin Setup):**
1. Open the app on your primary device
2. Log in as **admin** (default username: "admin")
3. Go to Settings → Sync
4. The app will create sync bins automatically
5. Export the sync configuration (you'll get a code/QR)

**Additional Devices:**
1. Open the app
2. Go to Settings → Sync
3. Import sync configuration using code/QR from first device
4. Log in with your username
5. Data will automatically sync

---

## Testing Checklist

### ✅ Test Your Deployment

1. **Direct Access Test:**
   - Open `https://tracker.tecclk.com` in a browser
   - App should load and be fully functional
   - Try logging in as "admin"

2. **Embedded Access Test:**
   - Open your Wix page with the embed
   - App should load inside the iframe
   - Try all features (camera, file upload, etc.)

3. **Mobile Test:**
   - Open both URLs on a mobile device
   - Check that layout is responsive
   - Test touch interactions

4. **Multi-Device Sync Test:**
   - Add a customer on Device 1
   - Wait 30 seconds
   - Check if it appears on Device 2

---

## Troubleshooting

### "This site can't be reached"
- Check that tracker.tecclk.com DNS is properly configured
- Wait up to 24 hours for DNS propagation
- Verify files are uploaded to the correct folder

### App loads but looks broken
- Make sure all files from `dist` folder are uploaded
- Check that `_expo` and `assets` folders are present
- Clear browser cache and reload

### "Not Secure" warning
- Enable SSL certificate (see Step 6)
- Force HTTPS in your hosting settings
- Update Wix embed code to use `https://`

### Sync not working
- Check that `Tracker/api/sync.php` is accessible
- Verify file has write permissions (755 or 777)
- Check browser console for error messages
- Make sure CORS headers are set correctly

### Features not working in iframe
- Camera/Microphone: Check `allow` attribute includes permissions
- Downloads: Add `allow-downloads` to sandbox attribute
- Popups: Ensure `allow-popups` is in sandbox

### Wix embed issues
- If embed is blocked, try using Wix's "HTML iframe" element instead
- Some Wix templates have restrictions on custom HTML
- Try embedding on a blank page first to test

---

## Important Notes

1. **Always use HTTPS** - Required for cameras, location, etc.
2. **Keep sync.php secure** - Consider adding authentication
3. **Regular backups** - Export data regularly from Settings
4. **Test on all devices** - Desktop, tablet, mobile
5. **Monitor sync** - Check Settings → Sync for last sync time

---

## Quick Reference

| What | URL |
|------|-----|
| Standalone App | https://tracker.tecclk.com |
| Wix Website | https://www.tecclk.com |
| Sync API | https://tracker.tecclk.com/Tracker/api/ |
| Default Login | Username: admin, No password |

---

## Need Help?

If you encounter issues:
1. Check browser console (F12) for errors
2. Verify all files are uploaded correctly
3. Test direct URL before testing embed
4. Ensure SSL is enabled and working
5. Check file permissions on server

---

## Next Steps After Deployment

1. Change default admin password in Settings
2. Create user accounts for your team
3. Add your products and outlets
4. Set up customers and recipes
5. Start tracking stock and sales
6. Enable automatic backups

Your TECC Tracker is now live and accessible from anywhere! 🎉
