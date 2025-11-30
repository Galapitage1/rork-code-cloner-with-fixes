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
    return data;
  }

  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    return data;
  }
  
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
    return [];
  }

  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    return [];
  }
  
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
    
    recordSuccess();
    return result as T[];
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`[DirectSync] Failed to fetch ${options.dataType}: ${errorMsg}`);
    recordFailure();
    return [];
  }
}

export function mergeData<T extends { id: string; updatedAt?: number; deleted?: boolean }>(local: T[], remote: T[]): T[] {
  console.log('[mergeData] ========== TIMESTAMP-BASED MERGE START ==========');
  console.log('[mergeData] Merging data - local:', local.length, 'remote:', remote.length);
  const merged = new Map<string, T>();
  
  // CRITICAL: Normalize timestamps - treat missing/zero as oldest (epoch 0)
  const normalizeTimestamp = (ts?: number): number => {
    if (!ts || ts === 0) {
      console.log('[mergeData] ⚠️ Found item with NO TIMESTAMP (treating as oldest)');
      return 0; // Oldest possible timestamp
    }
    return ts;
  };
  
  // First, add all local items with their timestamps
  local.forEach(item => {
    // Ensure all items have timestamps
    const normalized = { ...item, updatedAt: normalizeTimestamp(item.updatedAt) };
    merged.set(item.id, normalized as T);
    if (item.deleted) {
      console.log('[mergeData] Local has DELETED item:', item.id, 'timestamp:', normalized.updatedAt);
    }
  });
  console.log('[mergeData] Added local items:', merged.size);
  
  // Then, only update with remote items if they have newer timestamps
  let remoteNewer = 0;
  let localNewer = 0;
  let remoteNew = 0;
  let deletionWins = 0;
  let staleDataBlocked = 0;
  
  remote.forEach(item => {
    const existing = merged.get(item.id);
    const remoteTime = normalizeTimestamp(item.updatedAt);
    const localTime = normalizeTimestamp(existing?.updatedAt);
    
    // CRITICAL FIX 1: Deletion always wins, regardless of timestamp
    // This prevents deleted items from coming back during sync
    if (existing && existing.deleted) {
      // Local has deleted this item - NEVER resurrect it, even if remote is newer
      console.log('[mergeData] ✓ DELETION PROTECTION - Preserving LOCAL DELETION:', item.id, 'localTime:', localTime, 'remoteTime:', remoteTime);
      console.log('[mergeData]   → Blocking stale device from re-syncing this deleted item');
      deletionWins++;
      // Keep existing (which is deleted)
      return;
    }
    
    if (item.deleted) {
      // Remote has deleted this item - apply the deletion
      console.log('[mergeData] ✓ Applying REMOTE DELETION:', item.id, 'marking local as deleted');
      const normalized = { ...item, updatedAt: normalizeTimestamp(item.updatedAt) };
      merged.set(item.id, normalized as T);
      deletionWins++;
      return;
    }
    
    // CRITICAL FIX 2: Reject data with missing/zero timestamps if we have newer data
    if (remoteTime === 0 && localTime > 0) {
      console.log('[mergeData] ⛔ BLOCKING STALE DATA from old device:', item.id);
      console.log('[mergeData]   → Remote has NO timestamp (0), but local has valid timestamp:', new Date(localTime).toISOString());
      console.log('[mergeData]   → This is likely from an old device that never got timestamps');
      staleDataBlocked++;
      return; // Keep local version, reject stale remote
    }
    
    if (!existing) {
      // Item exists on server but not locally - add it (only if not deleted)
      const normalized = { ...item, updatedAt: remoteTime };
      merged.set(item.id, normalized as T);
      remoteNew++;
      console.log('[mergeData] Adding NEW item from server:', item.id, 'timestamp:', remoteTime === 0 ? 'NONE (0)' : new Date(remoteTime).toISOString());
    } else if (remoteTime > localTime) {
      // Remote is NEWER - use remote version
      const normalized = { ...item, updatedAt: remoteTime };
      merged.set(item.id, normalized as T);
      remoteNewer++;
      console.log('[mergeData] ✓ Using REMOTE (newer):', item.id, 'remoteTime:', new Date(remoteTime).toISOString(), 'localTime:', new Date(localTime).toISOString());
    } else {
      // Local is NEWER or EQUAL - keep local version
      localNewer++;
      if (remoteTime === localTime) {
        console.log('[mergeData] ✓ Keeping LOCAL (equal timestamp):', item.id, 'time:', new Date(localTime).toISOString());
      } else {
        console.log('[mergeData] ✓ Keeping LOCAL (newer):', item.id, 'localTime:', new Date(localTime).toISOString(), 'remoteTime:', new Date(remoteTime).toISOString());
      }
    }
  });
  
  console.log('[mergeData] ========== MERGE STATISTICS ==========');
  console.log('[mergeData]   New from server:', remoteNew);
  console.log('[mergeData]   Remote was newer:', remoteNewer);
  console.log('[mergeData]   Local was newer:', localNewer);
  console.log('[mergeData]   Deletion wins:', deletionWins);
  console.log('[mergeData]   Stale data blocked:', staleDataBlocked, '← prevented resurrections');
  console.log('[mergeData]   Total merged items:', merged.size);
  
  const result = Array.from(merged.values());
  console.log('[mergeData] Total items before filtering:', result.length);
  
  // Filter out deleted items
  const active = result.filter((item: any) => !item.deleted);
  const deletedCount = result.length - active.length;
  console.log('[mergeData] Active items (not deleted):', active.length);
  console.log('[mergeData] Deleted items (filtered out):', deletedCount);
  console.log('[mergeData] ========== MERGE COMPLETE ==========');
  
  return active as T[];
}
