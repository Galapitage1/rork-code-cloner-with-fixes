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
  allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
}));

app.post("/api/sync", async (c) => {
  try {
    const body = await c.req.json();
    const { userId, dataType, data } = body;
    
    if (!userId || !dataType) {
      return c.json({ error: 'Missing userId or dataType' }, 400);
    }
    
    const key = `${userId}:${dataType}`;
    console.log(`[Sync] Saving ${dataType} for user ${userId}, items: ${data?.length || 0}`);
    
    if (data && Array.isArray(data)) {
      dataStore.set(key, data);
    }
    
    const stored = dataStore.get(key) || [];
    return c.json({ success: true, data: stored });
  } catch (error: any) {
    console.error('[Sync] Error:', error);
    return c.json({ error: error?.message || 'Sync failed' }, 500);
  }
});

app.get("/api/sync", async (c) => {
  try {
    const userId = c.req.query('userId');
    const dataType = c.req.query('dataType');
    
    if (!userId || !dataType) {
      return c.json({ error: 'Missing userId or dataType' }, 400);
    }
    
    const key = `${userId}:${dataType}`;
    const data = dataStore.get(key) || [];
    console.log(`[Sync] Getting ${dataType} for user ${userId}, items: ${data.length}`);
    
    return c.json({ success: true, data });
  } catch (error: any) {
    console.error('[Sync] Error:', error);
    return c.json({ error: error?.message || 'Get failed' }, 500);
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