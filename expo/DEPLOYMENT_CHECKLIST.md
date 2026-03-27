# 📋 Deployment Checklist - Fix Sync Issue

## Quick Checklist

- [ ] **Step 1:** Commit and push changes
  ```bash
  git add .
  git commit -m "Fix sync configuration"
  git push
  ```

- [ ] **Step 2:** Wait for GitHub Actions (2-3 mins)
  - Visit: https://github.com/YOUR_USERNAME/YOUR_REPO/actions
  - Wait for green checkmark ✅

- [ ] **Step 3:** Download deployment package
  - Click on the latest workflow run
  - Scroll to "Artifacts" section
  - Download `deployment-package` (tracker-app.zip)

- [ ] **Step 4:** Upload to your hosting
  - Login to cPanel or use FTP
  - Navigate to: `/domains/tracker.tecclk.com/public_html/`
  - Delete old files (backup first if needed)
  - Upload and extract `tracker-app.zip`

- [ ] **Step 5:** Verify folder structure
  Check these folders exist:
  - [ ] `/public_html/Tracker/`
  - [ ] `/public_html/Tracker/api/`
  - [ ] `/public_html/Tracker/data/`

- [ ] **Step 6:** Set permissions on data folder
  ```bash
  chmod 755 /domains/tracker.tecclk.com/public_html/Tracker/data
  ```
  Or in cPanel: Right-click folder → Permissions → Set to 755

- [ ] **Step 7:** Test the app
  - [ ] Visit: https://tracker.tecclk.com/stock-check
  - [ ] Login as admin
  - [ ] Go to Settings

- [ ] **Step 8:** Test sync
  - [ ] Click "Sync Now" → Should show "Success"
  - [ ] Click "Share Code" → Should generate code
  - [ ] If "Sync Required" → Click "Sync Now" first, then try again

## 🎉 Success Indicators

When everything works, you'll see:
- ✅ "Sync Now" shows success message
- ✅ "Last Synced" shows "Just now"
- ✅ "Share Code" generates a long code in a modal
- ✅ JSON files appear in `Tracker/data/` folder on server

## ⚠️ If Sync Still Doesn't Work

### Check 1: Data folder exists
```bash
ls -la /domains/tracker.tecclk.com/public_html/Tracker/
```
Should show `data` folder

### Check 2: Data folder is writable
```bash
touch /domains/tracker.tecclk.com/public_html/Tracker/data/test.txt
```
Should create file without errors

### Check 3: PHP files are there
```bash
ls -la /domains/tracker.tecclk.com/public_html/Tracker/api/
```
Should show:
- sync.php
- get.php
- .htaccess

### Check 4: Environment variable is set
Open your deployed app and check browser console:
```javascript
// In browser console at https://tracker.tecclk.com/stock-check
console.log(process.env.EXPO_PUBLIC_FILE_SYNC_URL)
```
Should show: `https://tracker.tecclk.com/Tracker/api`

If it shows `undefined`, the .env file wasn't included in the build.

## 🔧 Manual Fix (If GitHub Actions Fails)

If GitHub Actions doesn't work, manually create the data folder:

### Via cPanel:
1. File Manager
2. Go to `/domains/tracker.tecclk.com/public_html/Tracker/`
3. Click "+ Folder"
4. Name it `data`
5. Right-click → Permissions → 755

### Via FTP/SFTP:
1. Connect to your server
2. Navigate to `/domains/tracker.tecclk.com/public_html/Tracker/`
3. Create folder `data`
4. Set permissions to 755

### Via SSH:
```bash
mkdir -p /domains/tracker.tecclk.com/public_html/Tracker/data
chmod 755 /domains/tracker.tecclk.com/public_html/Tracker/data
```

## 📞 Need Help?

If sync still doesn't work after following this checklist:
1. Check browser console for errors (F12 → Console tab)
2. Check server error logs in cPanel
3. Verify the PHP files are uploaded correctly
4. Make sure the environment variable is set

The most common issue is:
- ❌ Data folder doesn't exist → Create it
- ❌ Data folder isn't writable → chmod 755
- ❌ Wrong sync URL in .env → Should be `https://tracker.tecclk.com/Tracker/api`
