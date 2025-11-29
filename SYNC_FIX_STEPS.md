# Quick Fix for Sync Issues

## What I Fixed
1. ✅ Created `.env` file with correct sync URL
2. ✅ Created `public/Tracker/data/` folder with security files
3. ✅ Updated environment configuration

## What You Need to Do

### Option 1: Build and Deploy from GitHub (Recommended)
Since files are already integrated with GitHub:

1. Commit the changes:
```bash
git add .
git commit -m "Fix sync configuration and create data folder"
git push
```

2. Wait for GitHub Actions to build and deploy automatically

3. The data folder will be created on your server at:
   `/domains/tracker.tecclk.com/public_html/Tracker/data/`

### Option 2: Manually Create Data Folder
If GitHub Actions doesn't create the folder, manually create it on your server:

**Using cPanel File Manager:**
1. Login to cPanel
2. Go to File Manager
3. Navigate to `/domains/tracker.tecclk.com/public_html/Tracker/`
4. Create new folder called `data`
5. Upload the `.htaccess` file from `public/Tracker/data/.htaccess`

**Using FTP/SFTP:**
1. Connect to your server
2. Navigate to `/domains/tracker.tecclk.com/public_html/Tracker/`
3. Create folder `data`
4. Set permissions to 755

## Test After Setup

1. Go to https://tracker.tecclk.com/stock-check
2. Login as admin
3. Go to Settings → Multi-Device Sync
4. Click **"Sync Now"**
   - Should show "Success" message
5. Click **"Share Code"**
   - Should generate and show a code
   - If it asks to sync first, that's normal - just sync first

## Why This Fixes It

The app needs:
- ✅ `EXPO_PUBLIC_FILE_SYNC_URL` environment variable → Now set in `.env`
- ✅ `Tracker/data/` folder on server → Now created
- ✅ Write permissions → Set to 755 (standard)

Your sync PHP files (`sync.php` and `get.php`) save data as JSON files in the `data` folder. Without this folder, sync fails silently.

## Verification

After syncing successfully, you should see JSON files created in:
`/domains/tracker.tecclk.com/public_html/Tracker/data/`

Files like:
- products.json
- users.json
- stockChecks.json
- requests.json
- outlets.json
- messages.json
- customers.json
- recipes.json

Each file contains your synced data in JSON format.
