# Quick Start Checklist

Use this checklist to deploy your TECC Tracker step by step.

---

## ☐ Phase 1: Build the App (5 minutes)

```bash
# Run these commands in your project folder:
bun install
npx expo export -p web
```

**✓ Success:** You should see a `dist` folder created

---

## ☐ Phase 2: Upload to Hosting (10 minutes)

### Upload Files
1. ☐ Log in to your hosting control panel
2. ☐ Find the tracker.tecclk.com folder
3. ☐ Upload ALL files from the `dist` folder
4. ☐ Verify `index.html` is in the root (not in a subfolder)

### Configure Server
5. ☐ Copy `.htaccess` content from DEPLOYMENT_GUIDE.md
6. ☐ Create/edit `.htaccess` file on server
7. ☐ Save the file

### Enable SSL
8. ☐ Go to SSL/TLS settings in control panel
9. ☐ Select "Get automatic certificate from ACME Provider"
10. ☐ Wait 5-10 minutes for certificate

### Test Direct Access
11. ☐ Open https://tracker.tecclk.com in browser
12. ☐ App should load completely
13. ☐ Try logging in as "admin"

**✓ Success:** App works at https://tracker.tecclk.com

---

## ☐ Phase 3: Embed on Wix (5 minutes)

1. ☐ Open `wix-embed-code.html` file
2. ☐ Copy ALL the code (Ctrl+A, Ctrl+C)
3. ☐ Log in to Wix editor at www.tecclk.com
4. ☐ Go to the page where you want the tracker
5. ☐ Click **Add (+)** → **Embed Code** → **Embed HTML**
6. ☐ Paste the code
7. ☐ Set height to at least 800px
8. ☐ Position the embed on your page
9. ☐ Click **Publish**

### Test Embedded Version
10. ☐ Visit the published Wix page
11. ☐ App should load in the iframe
12. ☐ Test login and basic features

**✓ Success:** App works embedded on www.tecclk.com

---

## ☐ Phase 4: Set Up Data Sync (10 minutes)

### Verify Sync Files
1. ☐ Check that `Tracker/api/sync.php` exists on server
2. ☐ Check that `Tracker/api/get.php` exists on server
3. ☐ Test URL: https://tracker.tecclk.com/Tracker/api/sync.php
   - Should return an error message (that's normal without data)

### Set Up First Device
4. ☐ Open app on Device 1
5. ☐ Log in as "admin"
6. ☐ Go to Settings tab
7. ☐ Create some test data (add a product or customer)
8. ☐ Look for sync status in Settings

### Set Up Second Device
9. ☐ Open app on Device 2
10. ☐ Log in as "admin"
11. ☐ Wait 30 seconds
12. ☐ Check if test data appears

**✓ Success:** Data syncs between devices

---

## ☐ Phase 5: Final Testing (5 minutes)

### Desktop Testing
- ☐ Test on Chrome
- ☐ Test on Firefox or Safari
- ☐ Test all tabs (Products, Customers, Messages, etc.)
- ☐ Test uploading Excel files
- ☐ Test camera features

### Mobile Testing
- ☐ Open on mobile browser
- ☐ Check layout is responsive
- ☐ Test touch interactions
- ☐ Test camera on mobile

### Sync Testing
- ☐ Add item on Device 1
- ☐ Edit item on Device 2
- ☐ Verify changes appear on Device 1
- ☐ Test offline: close app, make changes, reopen

**✓ Success:** Everything works smoothly!

---

## ☐ Phase 6: Production Setup (5 minutes)

1. ☐ Go to Settings in the app
2. ☐ Change admin username (optional)
3. ☐ Create user accounts for your team
4. ☐ Add your outlets
5. ☐ Import/add your products
6. ☐ Add customer list
7. ☐ Configure recipes if needed

**✓ Success:** Ready for production use!

---

## Troubleshooting Checklist

### ❌ "This site can't be reached"
- ☐ Check DNS: ping tracker.tecclk.com from command line
- ☐ Wait 24 hours for DNS propagation
- ☐ Verify hosting account is active
- ☐ Check if folder name matches subdomain

### ❌ App loads but looks broken
- ☐ Check all files uploaded (especially `_expo` folder)
- ☐ Clear browser cache (Ctrl+Shift+Delete)
- ☐ Check browser console for errors (F12)
- ☐ Verify .htaccess is working

### ❌ SSL/HTTPS not working
- ☐ Wait 10 minutes after enabling SSL
- ☐ Force HTTPS in hosting settings
- ☐ Clear browser cache and retry
- ☐ Check certificate status in hosting panel

### ❌ Sync not working
- ☐ Check sync.php file permissions (755 or 777)
- ☐ Verify both devices are logged in
- ☐ Check internet connection on both devices
- ☐ Look for errors in browser console (F12)
- ☐ Verify CORS headers in .htaccess

### ❌ Wix embed blocked
- ☐ Check Content-Security-Policy header allows frames
- ☐ Try different Wix page template
- ☐ Use iframe element instead of embed code
- ☐ Contact Wix support about iframe restrictions

---

## File Locations Reference

### Your Computer
```
project-folder/
  ├── dist/              ← Upload this entire folder
  ├── wix-embed-code.html   ← Copy this code to Wix
  └── DEPLOYMENT_GUIDE.md   ← Full instructions
```

### Your Server (tracker.tecclk.com)
```
/public_html/tracker/  (or similar)
  ├── index.html       ← From dist folder
  ├── _expo/           ← From dist folder
  ├── assets/          ← From dist folder
  ├── .htaccess        ← Create this
  └── Tracker/
      └── api/
          ├── sync.php  ← Already exists
          └── get.php   ← Already exists
```

### Your Wix Site (www.tecclk.com)
```
Any page → Add Element → Embed HTML → Paste wix-embed-code.html
```

---

## Time Estimate

- **Build:** 5 min
- **Upload:** 10 min
- **SSL:** 10 min (mostly waiting)
- **Wix Embed:** 5 min
- **Sync Setup:** 10 min
- **Testing:** 5 min

**Total:** ~45 minutes

---

## Success Criteria

You're done when:
- ✅ https://tracker.tecclk.com loads your app
- ✅ www.tecclk.com shows embedded app
- ✅ Can log in on both URLs
- ✅ Data syncs between devices
- ✅ All features work (camera, uploads, etc.)

---

## Support Resources

- **Full Guide:** See DEPLOYMENT_GUIDE.md
- **Embed Code:** Use wix-embed-code.html
- **Sync API:** https://tracker.tecclk.com/Tracker/api/

---

**Ready to start? Begin with Phase 1! 🚀**
