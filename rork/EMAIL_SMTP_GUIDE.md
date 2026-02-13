# Email Campaign SMTP Setup Guide

## Overview
The email campaigns feature now supports sending emails directly via SMTP using your own email server credentials. The system is built securely with backend processing to protect your credentials.

## How It Works

### Architecture
1. **Frontend (app/campaigns.tsx)**: Collects campaign data, validates input, and sends requests to backend
2. **Backend (backend/trpc/routes/campaigns/send-email/route.ts)**: Handles SMTP connection and secure email sending using nodemailer
3. **Settings (app/(tabs)/settings.tsx)**: Stores SMTP credentials locally

### Security Features
- SMTP credentials are only sent from client to backend at the time of sending
- Backend handles all SMTP communication, keeping credentials secure
- No credentials exposed in client-side code or logs

## Setup Instructions

### 1. Configure SMTP Settings
Go to Settings page and configure your SMTP details:
- **SMTP Host**: Your mail server hostname (e.g., smtp.gmail.com, smtp.office365.com)
- **SMTP Port**: Usually 587 (TLS) or 465 (SSL)
- **SMTP Username**: Your email account username
- **SMTP Password**: Your email account password or app-specific password

#### Common SMTP Providers:
- **Gmail**: 
  - Host: smtp.gmail.com
  - Port: 587
  - Enable "Less secure app access" or use App Password
  
- **Office 365**:
  - Host: smtp.office365.com
  - Port: 587
  
- **Outlook/Hotmail**:
  - Host: smtp-mail.outlook.com
  - Port: 587

### 2. Create Email Campaign
1. Go to Campaigns page
2. Select "Email Campaign"
3. Fill in:
   - Sender Email
   - Sender Name
   - Subject
   - Message (text or HTML)
   - Attachments (optional)
4. Select recipients from customer list
5. Click "Send"

### 3. Monitor Results
After sending, you'll receive a summary showing:
- Total emails sent successfully
- Number of failures
- Error details for failed emails (up to 5 shown)

## Technical Details

### Backend Endpoint
- **Route**: `/api/trpc/campaigns.sendEmail`
- **Method**: tRPC mutation
- **Input**:
  ```typescript
  {
    smtpConfig: {
      host: string;
      port: number;
      auth: {
        user: string;
        pass: string;
      };
    };
    from: {
      email: string;
      name: string;
    };
    subject: string;
    content: string;
    format: "text" | "html";
    recipients: Array<{
      id: string;
      name: string;
      email: string;
    }>;
    attachments?: Array<{
      name: string;
      content: string; // base64
      contentType: string;
    }>;
  }
  ```

### Features
- ✅ Plain text and HTML email support
- ✅ File attachments support
- ✅ Bulk sending with individual error tracking
- ✅ SMTP connection verification before sending
- ✅ Secure credential handling
- ✅ Cross-platform support (iOS, Android, Web)

## Troubleshooting

### "SMTP Not Configured" Error
- Ensure all SMTP settings are filled in the Settings page
- Settings are stored locally and persist across sessions

### Connection Failures
- Verify SMTP host and port are correct
- Check if your email provider requires app-specific passwords
- Ensure firewall/network allows SMTP connections
- Some providers require enabling "less secure apps" or similar settings

### Attachment Issues
- Attachments are converted to base64 before sending
- Large files may take time to process
- Check file size limits of your SMTP provider

## Future Enhancements
- Email templates
- Scheduled campaigns
- Campaign analytics
- Email tracking (opens, clicks)
- Unsubscribe management
