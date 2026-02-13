# Build and Deploy Guide

This guide shows you how to build and deploy your app directly from your iMac to your server.

## Prerequisites

- Bun installed on your iMac
- SSH/FTP access to your server
- PHP server with write permissions for the `Tracker/data` directory

## Build Process

### Option 1: Build and Package (Recommended)

Run this single command to build everything and create a deployment package:

```bash
npm run package
```

This will:
1. Build the web version of your app
2. Copy all necessary PHP files and configurations
3. Create a `tracker-app.zip` file ready for upload

### Option 2: Build Only

If you just want to build without creating a zip:

```bash
npm run build
```

This creates a `dist` folder with all your files.

## What Gets Built

The build process creates a `dist` folder containing:

- **Web app files** - Your compiled React Native Web app
- **PHP sync files** - `public/Tracker/api/sync.php` and `get.php`
- **.htaccess files** - For proper routing and security
- **Data directory** - Empty folder for storing sync data

## Deploy to Server

### Upload via ZIP (Easiest)

1. Build and package:
   ```bash
   npm run package
   ```

2. Upload `tracker-app.zip` to your server

3. Extract on your server:
   ```bash
   unzip tracker-app.zip -d /path/to/your/public_html
   ```

### Upload via FTP/SFTP

1. Build the project:
   ```bash
   npm run build
   ```

2. Upload the entire `dist` folder contents to your server's web root

### Upload via rsync (Fastest for updates)

```bash
npm run build
rsync -avz --delete dist/ user@yourserver.com:/path/to/public_html/
```

## Server Requirements

- **PHP 7.4+** with write permissions
- **Apache** with mod_rewrite enabled (or nginx with proper config)
- **Permissions**: The `Tracker/data` directory must be writable by PHP

Set permissions on your server:
```bash
chmod 755 Tracker/api
chmod 777 Tracker/data
```

## Verify Deployment

After uploading, test these URLs:

1. **Main app**: `https://yoursite.com/`
2. **Sync endpoint**: `https://yoursite.com/Tracker/api/sync.php`
3. **Get endpoint**: `https://yoursite.com/Tracker/api/get.php`

## No Build Needed?

**Important**: You cannot upload the source code directly and have it work. React Native Web apps need to be:
- Transpiled from TypeScript to JavaScript
- Bundled with all dependencies
- Optimized for production

This is why the `build` command is necessary. However, once built, you can upload and it will work immediately without any additional processing on the server.

## Quick Deploy Workflow

For regular updates after initial setup:

```bash
npm run package && scp tracker-app.zip user@server:/tmp/
ssh user@server "cd /path/to/public_html && unzip -o /tmp/tracker-app.zip && rm /tmp/tracker-app.zip"
```

## Troubleshooting

### 404 Errors on Refresh
Make sure `.htaccess` is present in your web root with the correct rewrite rules.

### Sync Not Working
1. Check `Tracker/data` directory permissions (should be 777)
2. Verify PHP error logs
3. Test the sync endpoint directly

### App Not Loading
1. Check browser console for errors
2. Verify all files uploaded correctly
3. Check server error logs
