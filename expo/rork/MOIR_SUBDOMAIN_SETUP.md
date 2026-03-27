# MOIR Tracking System - Subdomain Setup Guide

## Overview
The MOIR tracking system is now available as a standalone HTML page that can be deployed to a separate subdomain (e.g., `moir.yourdomain.com`).

## Features

### Admin Features
- Login with username and password (default: `admin` / `admin123`)
- Import users from Excel file
- View all users with last seen timestamps
- Click "Show Locations on Map" to see all user locations with names
- Record attendance for any user
- Clear all users

### User Features
- Simple login with just username (no password)
- Enable/disable location sharing
- View location sharing status
- Record own attendance
- Reminders to keep logged in for location tracking

## Files Created
- `public/moir-standalone.html` - The standalone MOIR tracking page

## How to Set Up

### Option 1: Upload to Subdomain (Recommended)

1. **Create a subdomain** on your hosting provider:
   - Go to your hosting control panel (cPanel, Plesk, etc.)
   - Create a new subdomain (e.g., `moir.yourdomain.com`)

2. **Upload the file**:
   - Copy `public/moir-standalone.html` to the root directory of your subdomain
   - Rename it to `index.html`

3. **Access the system**:
   - Open `https://moir.yourdomain.com` in your browser

### Option 2: Use as Part of Main Domain

1. **Upload to a directory**:
   - Create a folder like `/moir/` in your website root
   - Upload `moir-standalone.html` as `index.html`

2. **Access the system**:
   - Open `https://yourdomain.com/moir/` in your browser

### Option 3: Deploy to Netlify

1. **Create a new site on Netlify**:
   - Go to https://netlify.com
   - Drag and drop the `public/moir-standalone.html` file
   - Rename it to `index.html` before uploading

2. **Configure custom domain**:
   - In Netlify settings, add your custom subdomain
   - Update DNS records as instructed by Netlify

## Setting Up DNS for Subdomain

### For cPanel/WHM
1. Go to cPanel → Domains → Subdomains
2. Create subdomain: `moir`
3. Point to document root: `/public_html/moir/`

### For Cloudflare
1. Go to DNS settings
2. Add a new record:
   - Type: A or CNAME
   - Name: `moir`
   - Content: Your server IP or domain
   - Proxy status: Proxied (orange cloud)

### For Other DNS Providers
1. Add an A record or CNAME record
2. Name: `moir`
3. Points to: Your server IP or main domain

## Admin Instructions

### Importing Users from Excel

1. **Prepare your Excel file**:
   - Create an Excel file (.xlsx or .xls)
   - Put user names in the first column
   - First row can be a header (will be ignored) or data
   - Example:
     ```
     Name
     John Smith
     Jane Doe
     Bob Johnson
     ```

2. **Import users**:
   - Login as admin
   - Click the settings gear icon (⚙️)
   - Click "Import Users from Excel"
   - Select your Excel file
   - Users will be imported and synced

3. **Verify import**:
   - Check "Total users" count in settings
   - Logout and check if users appear in user login list

### Viewing User Locations on Map

1. Login as admin
2. Click "Show Locations on Map" button
3. A new window will open showing:
   - List of all users who shared their location
   - Their coordinates
   - Last update time
   - Links to view each location on Google Maps
4. Click any "View on Google Maps" link to open that location

## User Instructions

### For Users

1. **Login**:
   - Open the MOIR system
   - Select your name from the user list
   - Click to login

2. **Enable Location Sharing**:
   - Click "Enable Location Sharing"
   - Allow location permissions when prompted
   - Keep the page open in your browser

3. **Important Notes**:
   - ✅ Keep logged in for location tracking to work
   - ✅ Keep the browser tab open (can minimize browser)
   - ✅ Location updates every 60 seconds
   - ✅ You can disable sharing anytime

4. **Record Attendance**:
   - Click "Record My Attendance" button
   - Confirmation will appear

## Data Storage

The system stores data in the following files on your server:
- `moir_users.json` - List of all users
- `moir_records.json` - Attendance records
- `moir_locations.json` - Location tracking data

These files are automatically created and synced via the same API endpoint used by the main app.

## Security Notes

1. **Change Default Password**:
   - The default admin password is `admin123`
   - To change it, edit line 311 in `moir-standalone.html`:
     ```javascript
     if (username.toLowerCase() === 'admin' && password === 'YOUR_NEW_PASSWORD') {
     ```

2. **HTTPS Required**:
   - Location tracking requires HTTPS
   - Make sure your subdomain has SSL certificate installed
   - Most hosting providers offer free Let's Encrypt SSL

3. **Data Privacy**:
   - Location data is stored securely
   - Only admin can view all locations
   - Users can only see their own status

## Troubleshooting

### Location Tracking Not Working
- Make sure HTTPS is enabled
- Check browser location permissions
- Keep the browser tab open
- Check browser console for errors

### Excel Import Not Working
- Make sure file is .xlsx or .xls format
- Check that names are in first column
- Remove any empty rows
- Try with a simple test file first

### Users Not Syncing
- Check network connection
- Verify API endpoint is accessible
- Check browser console for errors
- Try manual refresh

### Admin Can't Login
- Check username and password (case-sensitive)
- Default is: admin / admin123
- Clear browser cache and try again

## Mobile Usage

The system is fully responsive and works on mobile devices:
- Users can login from their phones
- Location tracking works on mobile browsers
- Keep browser app open in background
- On iOS, location tracking works best in Safari

## Support

For technical support or issues:
1. Check browser console for errors
2. Verify all files are uploaded correctly
3. Ensure DNS is configured properly
4. Test with different browsers
5. Check server error logs if needed

## Future Enhancements

Potential improvements you can request:
- Custom admin password configuration
- Multiple admin accounts
- Email notifications for attendance
- Location history reports
- Geofencing alerts
- Export attendance data
- Dark mode toggle
