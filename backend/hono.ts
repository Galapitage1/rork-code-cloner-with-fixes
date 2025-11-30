import { Hono } from "hono";
import { cors } from "hono/cors";
import nodemailer from 'nodemailer';

const app = new Hono();

const dataStore = new Map<string, any[]>();

app.use("*", cors({
  origin: (origin) => {
    console.log('[CORS] Request from origin:', origin);
    return origin;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Connection'],
  exposeHeaders: ['Content-Type'],
  credentials: true,
  maxAge: 86400,
}));

app.use("*", async (c, next) => {
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
  await next();
  console.log(`[${new Date().toISOString()}] Response: ${c.res.status}`);
});

app.post("/api/sync", async (c) => {
  try {
    console.log('[Sync POST] Starting request processing...');
    
    let body;
    try {
      body = await c.req.json();
      console.log('[Sync POST] Body parsed:', { userId: body?.userId, dataType: body?.dataType, itemCount: body?.data?.length });
    } catch (parseError: any) {
      console.error('[Sync POST] JSON parse error:', parseError.message);
      return c.json({ success: false, error: 'Invalid JSON payload' }, 400);
    }
    
    const { userId, dataType, data } = body;
    
    if (!userId || !dataType) {
      console.error('[Sync POST] Missing required fields');
      return c.json({ success: false, error: 'Missing userId or dataType' }, 400);
    }
    
    const key = `${userId}:${dataType}`;
    console.log(`[Sync POST] Saving ${dataType} for user ${userId}, items: ${data?.length || 0}`);
    
    if (data && Array.isArray(data)) {
      dataStore.set(key, data);
      console.log(`[Sync POST] Successfully stored ${data.length} items for ${key}`);
    } else {
      console.log(`[Sync POST] No data provided, returning existing data`);
    }
    
    const stored = dataStore.get(key) || [];
    console.log(`[Sync POST] Returning ${stored.length} items`);
    return c.json({ success: true, data: stored });
  } catch (error: any) {
    console.error('[Sync POST] Unexpected error:', error);
    return c.json({ success: false, error: error?.message || 'Sync failed' }, 500);
  }
});

app.get("/api/sync", async (c) => {
  try {
    console.log('[Sync GET] Starting request processing...');
    const userId = c.req.query('userId');
    const dataType = c.req.query('dataType');
    
    console.log('[Sync GET] Query params:', { userId, dataType });
    
    if (!userId || !dataType) {
      console.error('[Sync GET] Missing required query params');
      return c.json({ success: false, error: 'Missing userId or dataType' }, 400);
    }
    
    const key = `${userId}:${dataType}`;
    const data = dataStore.get(key) || [];
    console.log(`[Sync GET] Getting ${dataType} for user ${userId}, items: ${data.length}`);
    
    return c.json({ success: true, data });
  } catch (error: any) {
    console.error('[Sync GET] Unexpected error:', error);
    return c.json({ success: false, error: error?.message || 'Get failed' }, 500);
  }
});



app.get("/", (c) => {
  return c.json({ status: "ok", message: "API is running" });
});

app.get("/api", (c) => {
  return c.json({ status: "ok", message: "API endpoint is working" });
});

app.get("/api/health", (c) => {
  return c.json({ status: "healthy", timestamp: Date.now() });
});

app.post("/api/test-email-connection", async (c) => {
  try {
    console.log('[Email Test] Starting connection test...');
    const body = await c.req.json();
    const { smtpConfig, imapConfig } = body;

    const results: any = {
      smtp: { success: false, message: '' },
      imap: { success: false, message: '' },
    };

    if (smtpConfig && smtpConfig.host && smtpConfig.username && smtpConfig.password) {
      try {
        console.log('[Email Test] Testing SMTP connection...');
        const transporter = nodemailer.createTransport({
          host: smtpConfig.host,
          port: parseInt(smtpConfig.port),
          secure: parseInt(smtpConfig.port) === 465,
          auth: {
            user: smtpConfig.username,
            pass: smtpConfig.password,
          },
        });

        await transporter.verify();
        results.smtp.success = true;
        results.smtp.message = 'SMTP connection successful';
        console.log('[Email Test] SMTP connection verified');
      } catch (error: any) {
        results.smtp.success = false;
        results.smtp.message = `SMTP Error: ${error.message}`;
        console.error('[Email Test] SMTP error:', error);
      }
    } else {
      results.smtp.message = 'SMTP settings incomplete';
    }

    if (imapConfig && imapConfig.host && imapConfig.username && imapConfig.password) {
      try {
        console.log('[Email Test] Testing IMAP connection...');
        const Imap = require('imap');
        
        const imap = new Imap({
          user: imapConfig.username,
          password: imapConfig.password,
          host: imapConfig.host,
          port: parseInt(imapConfig.port),
          tls: parseInt(imapConfig.port) === 993,
          tlsOptions: { rejectUnauthorized: false },
        });

        await new Promise((resolve, reject) => {
          imap.once('ready', () => {
            imap.end();
            resolve(true);
          });
          imap.once('error', (err: any) => {
            reject(err);
          });
          imap.connect();
        });

        results.imap.success = true;
        results.imap.message = 'IMAP connection successful';
        console.log('[Email Test] IMAP connection verified');
      } catch (error: any) {
        results.imap.success = false;
        results.imap.message = `IMAP Error: ${error.message}`;
        console.error('[Email Test] IMAP error:', error);
      }
    } else {
      results.imap.message = 'IMAP settings incomplete';
    }

    return c.json({ success: true, results });
  } catch (error: any) {
    console.error('[Email Test] Unexpected error:', error);
    return c.json({ success: false, error: error?.message || 'Connection test failed' }, 500);
  }
});

app.post("/api/send-email", async (c) => {
  try {
    console.log('[Email] Starting send email request...');
    const body = await c.req.json();
    const { smtpConfig, emailData, recipients } = body;

    if (!smtpConfig || !emailData || !recipients) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: parseInt(smtpConfig.port),
      secure: parseInt(smtpConfig.port) === 465,
      auth: {
        user: smtpConfig.username,
        pass: smtpConfig.password,
      },
    });

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const recipient of recipients) {
      try {
        const mailOptions = {
          from: `"${emailData.senderName}" <${emailData.senderEmail}>`,
          to: recipient.email,
          subject: emailData.subject,
          text: emailData.format === 'text' ? emailData.message : undefined,
          html: emailData.format === 'html' ? emailData.htmlContent : undefined,
          attachments: emailData.attachments || [],
        };

        await transporter.sendMail(mailOptions);
        results.success++;
        console.log(`[Email] Sent to ${recipient.email}`);
      } catch (error: any) {
        results.failed++;
        results.errors.push(`${recipient.name}: ${error.message}`);
        console.error(`[Email] Failed to send to ${recipient.email}:`, error);
      }
    }

    return c.json({ success: true, results });
  } catch (error: any) {
    console.error('[Email] Unexpected error:', error);
    return c.json({ success: false, error: error?.message || 'Email send failed' }, 500);
  }
});

app.notFound((c) => {
  console.log('[Hono] 404 Not Found:', c.req.url);
  return c.json({ error: 'Not Found', path: c.req.url }, 404);
});

app.onError((err, c) => {
  console.error('[Hono] Server Error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;