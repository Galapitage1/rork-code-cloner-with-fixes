# 🚀 Quick Start: Deploy Your Updated App

Your changes ARE in the code. This guide will help you build and upload correctly.

## What Changed?

1. ✅ Home page now says "WELCOME TO THE ENGLISH CAKE COMPANY"
2. ✅ Live inventory data stays visible during sync  
3. ✅ Discrepancies calculated from visible values

## 🎯 Deploy in 3 Steps

### Step 1: Make Scripts Executable (One Time Only)

```bash
chmod +x verify-changes.sh
chmod +x deploy-prep.sh
chmod +x build.sh
chmod +x package.sh
```

### Step 2: Build & Package

```bash
./deploy-prep.sh
```

This will:
- Clean old builds
- Build fresh 
- Verify changes are included
- Create `tracker-app.zip`

**Wait for "DEPLOYMENT PACKAGE READY!" message**

### Step 3: Upload to Server

1. **Extract the ZIP on your iMac:**
   ```bash
   mkdir upload-folder
   unzip tracker-app.zip -d upload-folder
   ```

2. **Open FileZilla** and connect to your server

3. **Go to public_html** (or wherever your app lives)

4. **Delete old files** (but keep `Tracker/data` folder if you want your data)

5. **Upload everything** from `upload-folder/`
   - Make sure to enable "Show hidden files" in FileZilla
   - You should see `.htaccess` being uploaded
   - All folders: `_expo`, `assets`, `Tracker`
   - All files: `index.html`, etc.

6. **Set folder permissions:**
   - Right-click `Tracker/data` → Permissions → `777`

7. **Clear browser cache** (CRITICAL!)
   - Chrome/Edge: `Cmd+Shift+Delete` → Clear cached files
   - OR use Incognito mode: `Cmd+Shift+N`

8. **Visit your site** - Changes should now be live! 🎉

## 🔍 Troubleshooting

### Check if changes are in source code:
```bash
./verify-changes.sh
```

### Changes not showing on website?

**Most common issue: Browser cache**
- Open your site in Incognito/Private mode
- If it works there, it's just cache

**Second most common: Old files not deleted**
- Make sure you deleted ALL old files from server before uploading
- Don't just overwrite - delete first, then upload

**Third: .htaccess not uploaded**
- FileZilla might hide it by default
- Go to FileZilla → Server → Force showing hidden files
- Check that `.htaccess` is in your server's public_html

### Build failed?

Check that you're in the project directory:
```bash
pwd  # Should show path ending in your project name
ls   # Should show app.json, package.json, etc.
```

### Upload failed?

- Check server credentials in FileZilla
- Make sure you have write permissions
- Check disk space on server

## 📱 Test Locally First (Optional)

```bash
# After deploy-prep.sh, test locally:
cd dist
python3 -m http.server 8000

# Open browser to: http://localhost:8000
# Check that changes are there
```

If changes show locally but not on server → Upload issue
If changes don't show locally → Build issue

## 🆘 Still Having Issues?

Check these files I created for detailed help:
- `DIRECT_UPLOAD_GUIDE.md` - Detailed step-by-step guide
- Run `./verify-changes.sh` - Confirms changes are in code

---

**Remember:** Always clear browser cache or use Incognito after uploading!
