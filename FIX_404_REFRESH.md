# Fix for 404 Error on Page Refresh

## Problem
When you refresh a page in the app (like `/sales-upload` or `/settings`), you get a 404 error. This happens because the server doesn't know about these routes - they're handled by the client-side router.

## Solution

### ✅ Files Created
I've created a `.htaccess` file in the root directory that tells the server to redirect all routes to `index.html` so the client-side router can handle them.

### 📝 Deployment Steps

#### Option 1: For Netlify (Automatic)
Your `netlify.toml` already has the correct configuration. The 404 fix will work automatically when deployed to Netlify.

#### Option 2: For Apache Server (Manual)
When you build and deploy to your own server:

1. **Build the app:**
   ```bash
   npx expo export -p web
   ```

2. **Copy the .htaccess file to dist folder:**
   ```bash
   cp .htaccess dist/.htaccess
   ```

3. **Upload to your server:**
   - Upload everything from the `dist` folder to `tracker.tecclk.com`
   - Make sure `.htaccess` is included (you might need to show hidden files)

#### Option 3: Automated Build Script
To automate this, run these commands:

```bash
# Build and copy htaccess
npx expo export -p web && cp .htaccess dist/.htaccess

# Then upload the dist folder to your server
```

### 🔧 What the .htaccess File Does

The `.htaccess` file contains:
- **Rewrite rules** that redirect all non-file requests to `index.html`
- **CORS headers** to allow embedding in Wix
- **Security headers** for protection

### ✅ Testing

After deployment:
1. Open your app at `https://tracker.tecclk.com/sales-upload`
2. Refresh the page (F5 or Cmd+R)
3. The page should stay on the same route without 404 error

### 🔍 Troubleshooting

**If you still get 404 errors:**

1. **Check if .htaccess was uploaded:**
   - Look for `.htaccess` in your server's root folder
   - Enable "Show hidden files" in your FTP client
   
2. **Verify Apache mod_rewrite is enabled:**
   - Contact your hosting provider to enable `mod_rewrite`
   - Most modern hosts have it enabled by default

3. **Check file permissions:**
   - `.htaccess` should have permissions `644`
   
4. **For Nginx servers:**
   - `.htaccess` doesn't work with Nginx
   - Ask your host to add this to the server config:
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```

### 📱 Note About app.json
The `origin` setting in `app.json` is set to `https://rork.com/`. You may want to update this to your actual domain `https://tracker.tecclk.com` for better deep linking. However, this doesn't affect the 404 refresh issue.

---

## Summary

✅ `.htaccess` file created in root directory  
✅ Contains proper rewrite rules for SPA routing  
✅ Includes CORS and security headers  
✅ Ready to copy to `dist` folder after build  

**Next step:** Build your app and copy `.htaccess` to the `dist` folder before uploading to your server.
