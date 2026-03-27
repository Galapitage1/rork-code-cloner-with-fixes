# Multi-Device Sync Setup Guide

This app now includes automatic multi-device sync functionality. Your data (products, messages, customers, stock checks, requests, and outlets) will automatically sync across all your devices every 30 seconds.

## Features

✅ **Automatic Sync**: Data syncs every 30 seconds in the background
✅ **Manual Sync**: Click "Sync Now" button in Settings to sync immediately  
✅ **Conflict Resolution**: Automatically merges data from different devices based on timestamps
✅ **Offline Support**: Works offline and syncs when connection is restored
✅ **Multi-User**: Each user has their own sync profile

## Setup Instructions

### Step 1: Get a FREE JSONBin API Key

1. Go to https://jsonbin.io/
2. Click "Sign Up" (top right)
3. Sign up with your email (it's free!)
4. After logging in, go to your dashboard
5. Copy your API key (looks like: `$2a$10$...`)

### Step 2: Configure the App

#### Option A: Using .env file (Recommended for Development)

1. Copy `.env.example` to `.env` in your project root:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and paste your API key:
   ```
   EXPO_PUBLIC_JSONBIN_KEY=your_actual_api_key_here
   ```

3. Restart your development server

#### Option B: Using Netlify Environment Variables (For Production)

1. Go to your Netlify dashboard
2. Select your site (tecclk)
3. Go to "Site settings" → "Environment variables"
4. Click "Add a variable"
5. Add:
   - **Key**: `EXPO_PUBLIC_JSONBIN_KEY`
   - **Value**: Your JSONBin API key
6. Click "Save"
7. Redeploy your site

### Step 3: Test the Sync

1. **Open the app on Device 1**:
   - Login as any user
   - Add a product or send a message

2. **Open the app on Device 2** (or another browser):
   - Login with the same user
   - Wait 30 seconds or click "Sync Now" in Settings
   - You should see the data from Device 1!

3. **Make changes on Device 2**:
   - Add another product
   - Go back to Device 1
   - Wait 30 seconds or click "Sync Now"
   - The new product appears!

## Connecting Multiple Devices with Sync Code

After you've set up sync on your first device, you can easily connect other devices:

### Step 1: Generate Sync Code (Device 1)
1. Login to the app on your first device
2. Tap "Sync Now" to upload your data to the cloud
3. Go to Settings → Multi-Device Sync
4. Tap "Share Code" button
5. Copy the sync code

### Step 2: Import Sync Code (Device 2)
1. Open the app on your second device
2. Login with any user account
3. Go to Settings → Multi-Device Sync  
4. Tap "Enter Code" button
5. Paste the sync code
6. Tap "Import & Sync"
7. Tap "Sync Now" to download data from Device 1

Now both devices will share the same data and sync automatically!

## How It Works

1. **Auto-Sync**: Every 30 seconds, the app:
   - Checks for remote changes
   - Uploads local changes
   - Merges data intelligently

2. **Manual Sync**: Click "Sync Now" in Settings to:
   - Force an immediate sync
   - Useful when you know another device made changes

3. **Sync Status**: The Settings page shows:
   - **Sync Status**: Currently syncing or idle
   - **Last Synced**: When the last sync occurred
   - **Cloud Icon**: Active during sync

4. **Sync Code**: Share your sync configuration:
   - Generate a code to share with other devices
   - Import a code to connect to existing data
   - All devices with the same code share data

## Troubleshooting

### Sync Not Working?

1. **Check API Key**:
   - Make sure `EXPO_PUBLIC_JSONBIN_KEY` is set correctly
   - Restart your app after setting the key

2. **Check Console**:
   - Open browser DevTools (F12)
   - Look for "Sync" messages in console
   - Any errors will be logged there

3. **Check Network**:
   - Make sure you have internet connection
   - JSONBin.io must be accessible

4. **Try Manual Sync**:
   - Go to Settings
   - Click "Sync Now"
   - Check if it works

### Common Issues

**"Sync disabled: No JSONBIN key configured"**
- Your API key is not set
- Follow Step 2 again

**"Failed to create bin"**
- Your API key might be invalid
- Check if you copied the full key

**Sync says "Never"**
- You haven't synced yet
- Click "Sync Now" to do first sync
- After that, auto-sync will start

**"No Sync Configuration" when clicking Share Code**
- You need to sync your data first
- Tap "Sync Now" to upload data to the cloud
- This creates the sync configuration
- Then you can share the code

**"Invalid sync code" when importing**
- Make sure you copied the entire code
- The code should be a long string of random characters
- Try copying again from the source device

## Data Storage

- Each data type (products, messages, etc.) gets its own "bin" on JSONBin
- Bins are automatically created on first sync
- Each user gets their own set of bins
- Maximum 100KB per bin on free plan (plenty for this app!)

## Privacy & Security

- Data is stored on JSONBin.io servers
- Only you have the API key to access your data
- Keep your API key secret!
- Don't commit `.env` to git (it's already in `.gitignore`)

## Embedding the App

To embed the app on your website (like www.tecclk.com), use the provided `embed-example.html`:

```html
<iframe 
  src="https://tecclk.netlify.app"
  allow="camera; geolocation; microphone; clipboard-read; clipboard-write"
  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
  style="width: 100%; height: 100vh; border: none;"
></iframe>
```

Make sure to set the environment variable on Netlify as described in Option B above.

## Need Help?

If sync isn't working:
1. Check the browser console for errors
2. Verify your API key is correct
3. Make sure you restarted the app after setting the key
4. Try "Sync Now" manually first

Enjoy your multi-device sync! 🎉
