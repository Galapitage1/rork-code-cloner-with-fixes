import { Hono } from "hono";
import { cors } from "hono/cors";

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

app.notFound((c) => {
  console.log('[Hono] 404 Not Found:', c.req.url);
  return c.json({ error: 'Not Found', path: c.req.url }, 404);
});

app.onError((err, c) => {
  console.error('[Hono] Server Error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;