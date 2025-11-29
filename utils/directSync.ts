export interface SyncOptions {
  userId: string;
  dataType: string;
}

let syncFailureCount = 0;
const MAX_FAILURES_BEFORE_PAUSE = 5;
let isPaused = false;
let pauseUntil = 0;
let backendAvailable: boolean | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60000;

function shouldAttemptSync(): boolean {
  if (!isPaused) return true;
  
  if (Date.now() > pauseUntil) {
    isPaused = false;
    syncFailureCount = 0;
    console.log('[DirectSync] Resuming sync after pause');
    return true;
  }
  
  return false;
}

function recordFailure(): void {
  syncFailureCount++;
  
  if (syncFailureCount >= MAX_FAILURES_BEFORE_PAUSE) {
    isPaused = true;
    pauseUntil = Date.now() + 60000;
    console.warn(`[DirectSync] Too many failures (${syncFailureCount}), pausing sync for 60 seconds`);
  }
}

function recordSuccess(): void {
  if (syncFailureCount > 0) {
    console.log('[DirectSync] Sync successful, resetting failure count');
  }
  syncFailureCount = 0;
  isPaused = false;
}

function getBaseUrl(): string {
  return 'https://tracker.tecclk.com';
}

async function checkBackendHealth(): Promise<boolean> {
  const now = Date.now();
  if (backendAvailable !== null && (now - lastHealthCheck) < HEALTH_CHECK_INTERVAL) {
    return backendAvailable;
  }

  try {
    const baseUrl = getBaseUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${baseUrl}/Tracker/api/get.php?endpoint=users`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      backendAvailable = true;
      lastHealthCheck = now;
      console.log('[DirectSync] Backend health check: healthy');
      return true;
    }
    
    backendAvailable = false;
    lastHealthCheck = now;
    console.warn('[DirectSync] Backend health check failed:', response.status);
    return false;
  } catch (error) {
    backendAvailable = false;
    lastHealthCheck = now;
    console.warn('[DirectSync] Backend not available:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
        cache: 'no-cache',
      };
      
      if (!fetchOptions.headers) {
        fetchOptions.headers = {};
      }
      
      (fetchOptions.headers as any)['Connection'] = 'keep-alive';
      (fetchOptions.headers as any)['Accept'] = 'application/json';
      
      const response = await fetch(url, fetchOptions);
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 404) {
        throw new Error(`Endpoint not found: ${url}`);
      }
      
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
      
    } catch (error: any) {
      lastError = error;
      
      if (error.name === 'AbortError') {
        console.log(`[DirectSync] Request timeout on attempt ${attempt + 1}`);
      } else if (error.message?.includes('ERR_HTTP2')) {
        console.log(`[DirectSync] HTTP/2 protocol error on attempt ${attempt + 1}`);
      } else {
        console.log(`[DirectSync] Attempt ${attempt + 1} failed:`, error.message);
      }
      
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[DirectSync] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

export async function saveToServer<T extends { id: string; updatedAt?: number }>(
  data: T[],
  options: SyncOptions
): Promise<T[]> {
  if (!shouldAttemptSync()) {
    console.log(`[DirectSync] Sync paused, skipping save for ${options.dataType}`);
    return data;
  }

  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    console.log(`[DirectSync] Backend unavailable, skipping save for ${options.dataType}`);
    return data;
  }
  
  console.log(`[DirectSync] Saving ${data.length} ${options.dataType} items to server...`);
  
  try {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/Tracker/api/sync.php?endpoint=${encodeURIComponent(options.dataType)}`;
    
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!Array.isArray(result)) {
      throw new Error('Invalid response format');
    }
    
    console.log(`[DirectSync] Successfully saved ${result.length} ${options.dataType} items`);
    recordSuccess();
    return result as T[];
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`[DirectSync] Failed to save ${options.dataType}: ${errorMsg}`);
    recordFailure();
    return data;
  }
}

export async function getFromServer<T>(
  options: SyncOptions
): Promise<T[]> {
  if (!shouldAttemptSync()) {
    console.log(`[DirectSync] Sync paused, skipping fetch for ${options.dataType}`);
    return [];
  }

  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    console.log(`[DirectSync] Backend unavailable, skipping fetch for ${options.dataType}`);
    return [];
  }
  
  console.log(`[DirectSync] Fetching ${options.dataType} from server...`);
  
  try {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/Tracker/api/get.php?endpoint=${encodeURIComponent(options.dataType)}`;
    
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!Array.isArray(result)) {
      throw new Error('Invalid response format');
    }
    
    console.log(`[DirectSync] Retrieved ${result.length} ${options.dataType} items`);
    recordSuccess();
    return result as T[];
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`[DirectSync] Failed to fetch ${options.dataType}: ${errorMsg}`);
    recordFailure();
    return [];
  }
}

export function mergeData<T extends { id: string; updatedAt?: number }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  
  local.forEach(item => merged.set(item.id, item));
  
  remote.forEach(item => {
    const existing = merged.get(item.id);
    if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
      merged.set(item.id, item);
    }
  });
  
  const result = Array.from(merged.values());
  return result.filter((item: any) => !item.deleted);
}
