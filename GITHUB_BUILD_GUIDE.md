# Build Your App Using GitHub (No Mac Terminal Needed!)

## ✅ **This is MUCH easier than building on your Mac**

Instead of dealing with Mac permissions, GitHub will build your app automatically in the cloud!

---

## 🚀 **Step-by-Step Instructions**

## 🤖 **Optional: Auto-Deploy to Server After Successful Workflow**

If you want GitHub Actions to upload to your server automatically (no manual FTP each time), configure one of these:

SSH mode (preferred):
- `DEPLOY_SSH_HOST`
- `DEPLOY_SSH_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_TARGET_PATH`
- Optional: `DEPLOY_SSH_PORT` (default `22`)
- Optional: `DEPLOY_POST_CMD`

FTP mode (fallback, if SSH key setup is not possible):
- `DEPLOY_FTP_HOST`
- `DEPLOY_FTP_USER`
- `DEPLOY_FTP_PASSWORD` (or legacy alias `GITHUBDEPLOY`)
- `DEPLOY_TARGET_PATH`

The workflow auto-selects SSH when SSH secrets exist. Otherwise, it uses FTP if FTP secrets exist.

Where to add:
1. GitHub repo → **Settings**
2. **Secrets and variables** → **Actions**
3. Add each value as a **New repository secret**

Once these are set, every successful run of **Build and Deploy App** will upload automatically.

### **Step 1: Push Your Code to GitHub**

1. Go to [GitHub.com](https://github.com)
2. Create a new repository (if you haven't already)
3. Upload all your project files to GitHub:
   - You can drag and drop files directly on GitHub's website
   - OR use GitHub Desktop app (easier than terminal)

### **Step 2: Enable GitHub Actions**

1. Go to your repository on GitHub
2. Click the **"Actions"** tab at the top
3. GitHub will automatically detect the workflow I just created
4. Click **"I understand my workflows, go ahead and enable them"**

### **Step 3: Trigger a Build**

**Option A: Automatic (when you push code)**
- Every time you push changes to GitHub, it builds automatically

**Option B: Manual (build on demand)**
1. Go to **Actions** tab
2. Click **"Build and Package App"** on the left
3. Click **"Run workflow"** button on the right
4. Click the green **"Run workflow"** button
5. Wait 3-5 minutes for the build to complete

### **Step 4: Download Your Built App**

1. After the build finishes, go to the **Actions** tab
2. Click on the latest successful build (green checkmark ✓)
3. Scroll down to **"Artifacts"** section
4. Download **"deployment-package"** (this is a ZIP file)
5. Extract the ZIP file on your computer

### **Step 5: Upload to Your Hosting**

Now use **FTP** to upload the files:

**Using FileZilla (Recommended):**
1. Download FileZilla from https://filezilla-project.org
2. Connect using these details:
   - **Host:** `sg-shared01-da.pvtwebs.com`
   - **Username:** `tecclkc1`
   - **Password:** `6nZ[fdY4VN*6z2`
   - **Port:** `21`

3. Navigate to: `/domains/tracker.tecclk.com/public_html/`
4. Upload **ALL files** from the extracted ZIP folder
5. Make sure you see these files:
   - `index.html`
   - `_expo/` folder
   - `assets/` folder

### **Step 6: Upload Sync API Files**

Also upload the PHP files for data syncing:
1. In FileZilla, create folder: `/domains/tracker.tecclk.com/public_html/Tracker/api/`
2. Upload these files from your project:
   - `public/Tracker/api/sync.php`
   - `public/Tracker/api/get.php`
   - `public/Tracker/api/.htaccess`

### **Step 7: Upload .htaccess for Routing**

1. Upload the `.htaccess` file to `/domains/tracker.tecclk.com/public_html/`
2. This makes sure your app routes work correctly

### **Step 8: Enable SSL Certificate**

1. Log in to your DirectAdmin panel: http://sg-shared01-da.pvtwebs.com/
2. Go to **SSL Certificates**
3. Select your subdomain: **tracker.tecclk.com**
4. Choose **"Get automatic certificate from ACME Provider"** (Let's Encrypt)
5. Click **"Generate Certificate"**
6. Wait 5-10 minutes

### **Step 9: Test Your App**

1. Open browser and go to: **https://tracker.tecclk.com**
2. Your app should load!
3. Try logging in as: **admin** (no password needed by default)

---

## 📱 **Next: Embed in Your Wix Site**

Once your app is working at https://tracker.tecclk.com, follow these steps to embed it:

1. Log in to Wix editor for www.tecclk.com
2. Add an **HTML iframe** element
3. Use this code:

```html
<iframe 
  src="https://tracker.tecclk.com" 
  width="100%" 
  height="800px" 
  frameborder="0"
  allow="camera; clipboard-read; clipboard-write"
  style="border: none; min-height: 600px;">
</iframe>
```

4. Publish your Wix site

---

## 🔄 **Making Updates Later**

**The beauty of GitHub Actions:**

1. Make changes to your code
2. Push to GitHub (or upload via GitHub website)
3. GitHub automatically rebuilds your app
4. Download the new build
5. Re-upload to your hosting via FTP

No terminal commands needed! 🎉

---

## 🆘 **Troubleshooting**

### Build fails on GitHub
- Check the "Actions" tab for error messages
- Usually means missing dependencies or syntax errors

### "tracker-app.zip" not appearing
- Wait for build to complete (green checkmark)
- Scroll to bottom of build page
- Click "Artifacts" section

### Can't connect with FileZilla
- Make sure you're using **Port 21** (FTP)
- Try using your server IP instead: `160.30.208.11`
- Check your internet firewall isn't blocking FTP

### App shows placeholder page
- Make sure files are in `/public_html/` not just `/domains/tracker.tecclk.com/`
- The full path should be: `/domains/tracker.tecclk.com/public_html/index.html`

### SSL certificate not working
- Wait 10-15 minutes after requesting
- Try visiting with `https://` (not `http://`)
- Contact your hosting support if it still fails

---

## ✅ **Summary**

You've now:
- ✅ Built your app using GitHub (no Mac terminal!)
- ✅ Downloaded the built files
- ✅ Uploaded to tracker.tecclk.com
- ✅ Enabled SSL
- ✅ Can embed in your Wix site

Your app is now live and will sync data across all devices! 🚀
