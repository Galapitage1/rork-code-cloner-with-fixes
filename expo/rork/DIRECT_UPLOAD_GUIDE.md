# Direct Upload to Server Guide

## ✅ Your Changes ARE in the Code

The following updates have been confirmed in your code:
1. ✅ Home page title changed to "WELCOME TO THE ENGLISH CAKE COMPANY" 
2. ✅ Live inventory discrepancy calculations use visible values
3. ✅ Data persists during sync cycles

## 🔧 Problem: Files Not Updating on Server

The issue is likely one of these:
1. **Browser cache** - Your browser is showing old files
2. **Build not running** - The export command didn't run successfully
3. **Upload incomplete** - Not all files were uploaded via FileZilla

## 📋 Step-by-Step: Build and Upload Correctly

### Step 1: Clean Everything
```bash
# Open Terminal on your iMac
cd /path/to/your/project

# Delete old build
rm -rf dist
rm -f tracker-app.zip
```

### Step 2: Build Fresh
```bash
# Run the package script
./package.sh
```

**Wait for it to complete!** You should see:
- "Building web app..."
- "Copying PHP sync files..."
- "Copying .htaccess..."
- "Running post-export script..."
- "Package created successfully!"

If you see any errors, STOP and report them.

### Step 3: Verify the ZIP File
```bash
# Check the ZIP was created
ls -lh tracker-app.zip

# You should see a file that's several MB in size
```

### Step 4: Extract and Check Contents
```bash
# Create a temp folder to verify
mkdir temp-check
unzip tracker-app.zip -d temp-check

# Look inside
ls -la temp-check/

# You should see:
# - _expo/
# - assets/
# - Tracker/
# - index.html
# - .htaccess
# - Various .js and .css files
```

### Step 5: Upload via FileZilla

1. **Connect to your server** via FileZilla

2. **Navigate to your public_html folder** (or wherever your app lives)

3. **DELETE the old installation first**:
   - Select ALL files in the web directory
   - Delete them (but keep the Tracker/data folder if you want to preserve data)

4. **Upload the NEW files**:
   - Drag the CONTENTS of the `dist` folder (not the dist folder itself)
   - Make sure ALL files upload including:
     - .htaccess (this is hidden, make sure FileZilla shows hidden files)
     - All _expo folders
     - All assets
     - Tracker folder

5. **Set Permissions**:
   - Right-click on `Tracker/data` folder
   - Set permissions to 777 (read/write/execute for all)

### Step 6: Clear Browser Cache

**VERY IMPORTANT:** Your browser caches the old app aggressively.

**Chrome/Edge:**
1. Press `Ctrl+Shift+Delete` (Windows) or `Cmd+Shift+Delete` (Mac)
2. Select "Cached images and files"
3. Choose "All time"
4. Click "Clear data"

**Or use Incognito/Private mode:**
- Chrome: `Ctrl+Shift+N` (Windows) or `Cmd+Shift+N` (Mac)
- Safari: `Cmd+Shift+N`

### Step 7: Test

1. Go to your website URL in incognito mode
2. You should now see:
   - "WELCOME TO THE ENGLISH CAKE COMPANY" on the home page
   - Live inventory data persisting correctly

## 🚨 Still Not Working?

### Check 1: Verify Build Worked
```bash
# Check if home.tsx content is in the built files
cd dist
grep -r "WELCOME TO THE ENGLISH CAKE COMPANY" .

# You should see it in some .js files
```

### Check 2: Verify Upload Worked
1. Use your browser to check these URLs directly:
   - `https://yoursite.com/.htaccess` (should download or show 403)
   - `https://yoursite.com/_expo/` (should show file listing)

### Check 3: Check for Errors
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Refresh the page
4. Look for any red errors

## 📱 Alternative: Build on iMac, Test Locally First

```bash
# After building, test locally
cd dist
python3 -m http.server 8000

# Open browser to http://localhost:8000
# Verify changes are there before uploading
```

If changes show locally but not on server, it's an upload/cache issue.
If changes don't show locally, there's a build issue.

## 🎯 Quick Checklist

- [ ] Ran `./package.sh` successfully
- [ ] Verified tracker-app.zip exists and is several MB
- [ ] Extracted zip to check contents are there
- [ ] Deleted old files from server
- [ ] Uploaded ALL files from dist/ folder via FileZilla
- [ ] Set Tracker/data permissions to 777
- [ ] Cleared browser cache or used incognito mode
- [ ] Can see "WELCOME TO THE ENGLISH CAKE COMPANY" on home page

## 💡 Pro Tip

Add this to your routine every time you upload:
1. Build → `./package.sh`
2. Upload → FileZilla
3. Test → Incognito browser

This ensures you always see the latest version without cache issues.
