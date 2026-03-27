# Multi-Device Sync Setup - FIXED

## Issue
The sync functionality wasn't working because the environment variable wasn't set and the data directory wasn't created on the server.

## Solution

### Step 1: Environment Variable (Already Done)
The `.env` file has been created with:
```
EXPO_PUBLIC_FILE_SYNC_URL=https://tracker.tecclk.com/Tracker/api
```

### Step 2: Create Data Directory on Your Server
**IMPORTANT**: You need to create a `data` folder in your hosting location.

On your server at `/domains/tracker.tecclk.com/public_html/`:

1. Create this directory structure:
```
/domains/tracker.tecclk.com/public_html/
  └── Tracker/
      ├── api/
      │   ├── .htaccess (already exists)
      │   ├── sync.php (already exists)
      │   └── get.php (already exists)
      └── data/  ← CREATE THIS FOLDER
```

2. Set proper permissions:
```bash
mkdir -p /domains/tracker.tecclk.com/public_html/Tracker/data
chmod 755 /domains/tracker.tecclk.com/public_html/Tracker/data
```

### Step 3: Rebuild and Deploy
After creating the data folder:

1. Commit your changes:
```bash
git add .env
git commit -m "Add sync configuration"
git push
```

2. The GitHub Actions will automatically rebuild and deploy

### Step 4: Test Sync
1. Open https://tracker.tecclk.com/stock-check
2. Login as admin
3. Go to Settings
4. Click "Sync Now" - you should see "Success" message
5. Click "Share Code" - it should generate a code

## How It Works

The sync system uses your server's PHP files (`sync.php` and `get.php`) to store data in JSON files inside the `Tracker/data/` folder.

When you sync:
- `sync.php` receives your app data and merges it with existing data
- Data is stored in files like `products.json`, `stockChecks.json`, etc.
- Each device syncs by reading and writing to these files

## Troubleshooting

### "Sync Required" message when clicking Share Code
This means no data has been synced yet. Click "Sync Now" first.

### "Failed to sync" error
Check:
1. The `Tracker/data/` folder exists on your server
2. The folder has write permissions (755 or 775)
3. You can access https://tracker.tecclk.com/Tracker/api/sync.php

### How to verify the data folder works
Create a test file to check:
```bash
# On your server
echo '[]' > /domains/tracker.tecclk.com/public_html/Tracker/data/test.json
```

If this works, syncing should work too.

## Files Synced
These JSON files will be created in `Tracker/data/`:
- `products.json` - Products list
- `stockChecks.json` - Stock check history
- `requests.json` - Product requests
- `outlets.json` - Outlet locations
- `users.json` - User accounts
- `messages.json` - Messages
- `customers.json` - Customer data
- `recipes.json` - Recipes

## Security
- The `.htaccess` file in `/Tracker/api/` already blocks direct access to `.json` files
- Only the PHP scripts can access the data folder
- HTTPS is enforced on your domain
