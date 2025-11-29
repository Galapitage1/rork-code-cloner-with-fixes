# Auto-Update Detection & 404 Fix Guide

## ✅ What's Been Added

### 1. Automatic Update Detection (Web Only)
Your app now automatically detects when a new version is deployed:
- **Checks every 5 minutes** for updates
- **Shows a blue banner** at the top when update is available
- **One-click reload** to get the latest version
- **Web only** - doesn't affect mobile users

### 2. 404 Refresh Fix
The `.htaccess` file is configured to fix 404 errors on page refresh.

---

## 🚀 How to Deploy (Fixing Both Issues)

### Quick Command (Recommended)
```bash
# Build the app and copy .htaccess automatically
npx expo export -p web && node scripts/post-export.js

# Upload the entire dist/ folder to your server
```

### Manual Steps
1. **Build the web app:**
   ```bash
   npx expo export -p web
   ```

2. **Copy .htaccess to dist:**
   ```bash
   cp .htaccess dist/.htaccess
   ```
   
   Or run the post-export script:
   ```bash
   node scripts/post-export.js
   ```

3. **Upload to server:**
   - Upload everything from `dist/` folder to your web server
   - Make sure `.htaccess` is included (enable "Show hidden files")
   - The file structure should be:
     ```
     your-server-root/
     ├── .htaccess          ← This fixes 404 on refresh
     ├── index.html
     ├── _expo/
     └── ...other files
     ```

---

## 🎯 How It Works

### Update Detection
1. When the app loads, it fetches `/index.html` and generates a hash from the script URLs
2. Stores this hash in `localStorage`
3. Every 5 minutes, checks if the hash has changed
4. If changed → shows update prompt
5. User clicks "Reload" → gets the new version

**Note:** The update banner only appears on web browsers. Mobile apps don't see it.

### 404 Fix
The `.htaccess` file tells Apache to:
1. Serve files that exist (images, JS, CSS) normally
2. For all other requests → serve `index.html`
3. Let the React Router handle the URL

This means:
- `yoursite.com/sales-upload` → works ✅
- Refresh on any page → works ✅
- Direct links → work ✅

---

## 🧪 Testing

### Test Update Detection (Local)
1. Start the app: `npm run start-web`
2. Open browser console
3. Run: `localStorage.setItem('app-version-hash', 'old-version')`
4. Refresh the page
5. You should see the update banner

### Test 404 Fix (Production)
After deploying:
1. Navigate to: `https://yoursite.com/sales-upload`
2. Press F5 to refresh
3. Should stay on `/sales-upload` without 404 error

---

## 🔧 Troubleshooting

### Update banner not showing
- Check browser console for errors
- Verify you're on web (not mobile app)
- Check localStorage: `localStorage.getItem('app-version-hash')`
- Clear cache and reload

### Still getting 404 on refresh
1. **Check .htaccess is uploaded:**
   - Enable "Show hidden files" in FTP client
   - Verify `.htaccess` exists on server
   
2. **Check Apache mod_rewrite is enabled:**
   - Contact hosting provider
   - Most hosts have it enabled by default
   
3. **Check file permissions:**
   - `.htaccess` should be `644`
   
4. **Using Nginx?**
   - `.htaccess` doesn't work on Nginx
   - Add to nginx config:
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```

### Update banner appears too often
- This shouldn't happen unless you're deploying very frequently
- The check only runs every 5 minutes
- Banner only shows when the hash actually changes

---

## 📝 Summary

**For Development:**
- No changes needed - continue using `npm run start-web`
- Update detection only works on deployed builds

**For Production Deployment:**
1. Run: `npx expo export -p web && node scripts/post-export.js`
2. Upload `dist/` folder to server (including `.htaccess`)
3. Users will automatically see update prompts when you deploy

**Benefits:**
- ✅ No more 404 errors on refresh
- ✅ Users automatically notified of updates
- ✅ One-click reload to get latest version
- ✅ Better user experience
- ✅ No manual "hard refresh" needed

---

## 🎨 Customizing the Update Banner

Edit `components/UpdatePrompt.tsx` to change:
- **Colors:** Modify `backgroundColor` in styles
- **Message:** Change the text in `<Text>` components
- **Position:** Change `top` to `bottom` in styles
- **Check interval:** Edit the `5 * 60 * 1000` (5 minutes) in `useAppUpdate.ts`

Example - Check every 2 minutes:
```typescript
// In hooks/useAppUpdate.ts
const interval = setInterval(checkForUpdate, 2 * 60 * 1000); // 2 minutes
```
