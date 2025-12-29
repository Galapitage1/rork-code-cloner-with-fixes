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
    const { smtpConfig } = body;

    const results: any = {
      smtp: { success: false, message: '' },
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

app.post("/api/test-whatsapp-connection", async (c) => {
  try {
    console.log('[WhatsApp Test] Starting connection test...');
    const body = await c.req.json();
    const { accessToken, phoneNumberId } = body;

    if (!accessToken || !phoneNumberId) {
      return c.json({ success: false, error: 'Missing access token or phone number ID' }, 400);
    }

    console.log('[WhatsApp Test] Testing with phoneNumberId:', phoneNumberId);
    
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    console.log('[WhatsApp Test] API Response Status:', response.status);
    console.log('[WhatsApp Test] API Response Data:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      const errorMsg = data.error?.message || data.error?.error_user_msg || 'Failed to verify WhatsApp configuration';
      console.error('[WhatsApp Test] API Error:', errorMsg);
      throw new Error(errorMsg);
    }

    return c.json({
      success: true,
      message: `WhatsApp Business API connected successfully. Phone: ${data.display_phone_number || phoneNumberId}`,
      data,
    });
  } catch (error: any) {
    console.error('[WhatsApp Test] Error:', error);
    return c.json({ success: false, error: error?.message || 'WhatsApp connection test failed' }, 500);
  }
});

app.post("/api/send-whatsapp", async (c) => {
  try {
    console.log('[WhatsApp] Starting send whatsapp request...');
    const body = await c.req.json();
    const { accessToken, phoneNumberId, message, recipients } = body;

    if (!accessToken || !phoneNumberId || !message || !recipients) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const recipient of recipients) {
      try {
        if (!recipient.phone) {
          results.failed++;
          results.errors.push(`${recipient.name}: No phone number`);
          continue;
        }

        let phone = recipient.phone.trim();
        
        phone = phone.replace(/[^0-9+]/g, '');
        
        if (phone.startsWith('0')) {
          phone = '94' + phone.substring(1);
        } else if (phone.startsWith('+')) {
          phone = phone.substring(1);
        } else if (!phone.startsWith('94')) {
          phone = '94' + phone;
        }

        console.log(`[WhatsApp] Sending to ${recipient.name} (${phone})...`);

        const response = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: phone,
              type: 'text',
              text: {
                preview_url: false,
                body: message,
              },
            }),
          }
        );

        const data = await response.json();

        if (!response.ok || data.error) {
          throw new Error(data.error?.message || 'Failed to send message');
        }

        results.success++;
        console.log(`[WhatsApp] Sent to ${recipient.name}:`, data);

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        results.failed++;
        results.errors.push(`${recipient.name}: ${error.message}`);
        console.error(`[WhatsApp] Failed to send to ${recipient.name}:`, error);
      }
    }

    return c.json({ success: true, results });
  } catch (error: any) {
    console.error('[WhatsApp] Unexpected error:', error);
    return c.json({ success: false, error: error?.message || 'WhatsApp send failed' }, 500);
  }
});

const smsTokenStore = new Map<string, { access_token: string; expires_at: number }>();

async function getOrRefreshSMSToken(settings: { esms_username: string; esms_password: string }): Promise<string> {
  const tokenKey = `sms_token_${settings.esms_username}`;
  const cached = smsTokenStore.get(tokenKey);
  
  if (cached && cached.expires_at > Date.now()) {
    console.log('[SMS] Using cached token');
    return cached.access_token;
  }

  console.log('[SMS] Refreshing token...');
  const response = await fetch('https://e-sms.dialog.lk/api/v2/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: settings.esms_username,
      password: settings.esms_password,
    }),
  });

  const data = await response.json();
  
  if (!response.ok || !data.token) {
    console.error('[SMS] Token refresh failed:', data);
    throw new Error(data.message || 'Failed to authenticate with eSMS');
  }

  const expires_at = Date.now() + (data.expiration || 3600) * 1000;
  smsTokenStore.set(tokenKey, {
    access_token: data.token,
    expires_at,
  });

  console.log('[SMS] Token refreshed successfully');
  return data.token;
}

function normalizeMobile(mobile: string): string {
  let normalized = mobile.replace(/[^0-9]/g, '');
  
  if (normalized.startsWith('94')) {
    normalized = normalized.substring(2);
  } else if (normalized.startsWith('0')) {
    normalized = normalized.substring(1);
  }
  
  if (normalized.length === 9 && normalized.startsWith('7')) {
    return normalized;
  }
  
  throw new Error(`Invalid mobile number format: ${mobile}`);
}

app.post("/api/sms/test-login", async (c) => {
  try {
    console.log('[SMS Test] Starting login test...');
    const body = await c.req.json();
    const { esms_username, esms_password } = body;

    if (!esms_username || !esms_password) {
      return c.json({ success: false, error: 'Missing username or password' }, 400);
    }

    const token = await getOrRefreshSMSToken({ esms_username, esms_password });

    return c.json({
      success: true,
      message: 'Login successful',
      token_length: token.length,
    });
  } catch (error: any) {
    console.error('[SMS Test] Error:', error);
    return c.json({ success: false, error: error?.message || 'Login test failed' }, 500);
  }
});

app.post("/api/sms/send-test", async (c) => {
  try {
    console.log('[SMS Test] Starting test SMS send...');
    const body = await c.req.json();
    const { settings, mobile, message } = body;

    if (!settings || !mobile || !message) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const token = await getOrRefreshSMSToken(settings);
    const normalizedMobile = normalizeMobile(mobile);
    const transaction_id = Date.now();

    const payload: any = {
      msisdn: [{ mobile: normalizedMobile }],
      message,
      transaction_id,
      payment_method: settings.default_payment_method || 0,
    };

    if (settings.default_source_address) {
      payload.sourceAddress = settings.default_source_address;
    }

    console.log('[SMS Test] Sending with payload:', JSON.stringify(payload, null, 2));

    const response = await fetch('https://e-sms.dialog.lk/api/v2/sms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('[SMS Test] Response:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      throw new Error(data.comment || data.message || 'Failed to send test SMS');
    }

    return c.json({
      success: true,
      message: 'Test SMS sent successfully',
      data,
    });
  } catch (error: any) {
    console.error('[SMS Test] Error:', error);
    return c.json({ success: false, error: error?.message || 'Test SMS send failed' }, 500);
  }
});

app.post("/api/sms/send-campaign", async (c) => {
  try {
    console.log('[SMS Campaign] Starting campaign send...');
    const body = await c.req.json();
    const { settings, message, recipients, source_address, payment_method } = body;

    if (!settings || !message || !recipients || recipients.length === 0) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    if (recipients.length > 1000) {
      return c.json({ success: false, error: 'Maximum 1000 recipients per campaign' }, 400);
    }

    let token = await getOrRefreshSMSToken(settings);
    const transaction_id = Date.now() + Math.floor(Math.random() * 1000);

    const normalizedRecipients = [];
    const invalidNumbers = [];

    for (const recipient of recipients) {
      try {
        const normalized = normalizeMobile(recipient.mobile);
        normalizedRecipients.push({ mobile: normalized, original: recipient.mobile });
      } catch {
        invalidNumbers.push(recipient.mobile);
      }
    }

    if (normalizedRecipients.length === 0) {
      return c.json({ success: false, error: 'No valid mobile numbers found' }, 400);
    }

    const payload: any = {
      msisdn: normalizedRecipients.map(r => ({ mobile: r.mobile })),
      message,
      transaction_id,
      payment_method: payment_method ?? settings.default_payment_method ?? 0,
    };

    if (source_address || settings.default_source_address) {
      payload.sourceAddress = source_address || settings.default_source_address;
    }

    if (settings.push_notification_url) {
      payload.push_notification_url = settings.push_notification_url;
    }

    console.log('[SMS Campaign] Sending to', normalizedRecipients.length, 'recipients');

    let response = await fetch('https://e-sms.dialog.lk/api/v2/sms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data = await response.json();

    if (data.errCode === 104 || (data.comment && data.comment.includes('already used'))) {
      console.log('[SMS Campaign] Transaction ID already used, retrying with new ID...');
      payload.transaction_id = Date.now() + Math.floor(Math.random() * 10000);
      
      response = await fetch('https://e-sms.dialog.lk/api/v2/sms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      data = await response.json();
    }

    if (data.errCode === 401 || (data.comment && data.comment.toLowerCase().includes('token'))) {
      console.log('[SMS Campaign] Token expired, refreshing and retrying...');
      token = await getOrRefreshSMSToken(settings);
      
      response = await fetch('https://e-sms.dialog.lk/api/v2/sms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      data = await response.json();
    }

    console.log('[SMS Campaign] Response:', JSON.stringify(data, null, 2));

    return c.json({
      success: response.ok && !data.errCode,
      data: {
        transaction_id: payload.transaction_id,
        campaign_id: data.data?.campaignId,
        campaign_cost: data.data?.campaignCost,
        wallet_balance: data.walletBalance,
        duplicates_removed: data.duplicatesRemoved,
        invalid_numbers: (data.invalidNumbers || 0) + invalidNumbers.length,
        mask_blocked_numbers: data.mask_blocked_numbers,
        status: data.status,
        comment: data.comment,
        errCode: data.errCode,
        recipients: normalizedRecipients,
        invalidNumbersList: invalidNumbers,
      },
    });
  } catch (error: any) {
    console.error('[SMS Campaign] Error:', error);
    return c.json({ success: false, error: error?.message || 'Campaign send failed' }, 500);
  }
});

app.post("/api/sms/check-status", async (c) => {
  try {
    console.log('[SMS Status] Checking campaign status...');
    const body = await c.req.json();
    const { settings, transaction_id } = body;

    if (!settings || !transaction_id) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    const token = await getOrRefreshSMSToken(settings);

    const response = await fetch('https://e-sms.dialog.lk/api/v2/sms/check-transaction', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transaction_id }),
    });

    const data = await response.json();
    console.log('[SMS Status] Response:', JSON.stringify(data, null, 2));

    return c.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('[SMS Status] Error:', error);
    return c.json({ success: false, error: error?.message || 'Status check failed' }, 500);
  }
});

app.get("/api/sms/dlr", async (c) => {
  try {
    const campaignId = c.req.query('campaignId');
    const msisdn = c.req.query('msisdn');
    const status = c.req.query('status');

    console.log('[SMS DLR] Delivery report:', { campaignId, msisdn, status });

    if (!campaignId || !msisdn || !status) {
      return c.json({ success: false, error: 'Missing required parameters' }, 400);
    }

    const event = {
      campaignId,
      msisdn,
      status: parseInt(status),
      timestamp: Date.now(),
      raw: c.req.url,
    };

    const dlrKey = `dlr_events`;
    const events = dataStore.get(dlrKey) || [];
    events.push(event);
    dataStore.set(dlrKey, events);

    console.log('[SMS DLR] Event stored:', event);

    return c.text('OK', 200);
  } catch (error: any) {
    console.error('[SMS DLR] Error:', error);
    return c.text('ERROR', 500);
  }
});

app.get("/api/sms/dlr-events", async (c) => {
  try {
    const campaignId = c.req.query('campaignId');
    const dlrKey = `dlr_events`;
    const allEvents = dataStore.get(dlrKey) || [];
    
    const events = campaignId 
      ? allEvents.filter((e: any) => e.campaignId === campaignId)
      : allEvents;

    return c.json({ success: true, events });
  } catch (error: any) {
    console.error('[SMS DLR Events] Error:', error);
    return c.json({ success: false, error: error?.message }, 500);
  }
});

app.onError((err, c) => {
  console.error('[Hono] Server Error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;