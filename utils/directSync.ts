export interface SyncOptions {
  userId: string;
  dataType: string;
  minDays?: number;
}

export interface DeltaSyncOptions extends SyncOptions {
  since?: number;
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
    return true;
  }
  
  return false;
}

function recordFailure(): void {
  syncFailureCount++;
  
  if (syncFailureCount >= MAX_FAILURES_BEFORE_PAUSE) {
    isPaused = true;
    pauseUntil = Date.now() + 60000;

  }
}

function recordSuccess(): void {

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
      return true;
    }
    
    backendAvailable = false;
    lastHealthCheck = now;

    return false;
  } catch {
    backendAvailable = false;
    lastHealthCheck = now;
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
      
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
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
  } catch {
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
    // Add minDays parameter for stockChecks to request full history (40 days) after cache clear
    const minDaysParam = options.minDays ? `&minDays=${options.minDays}` : '';
    const url = `${baseUrl}/Tracker/api/get.php?endpoint=${encodeURIComponent(options.dataType)}${minDaysParam}`;
    
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
  } catch {
    recordFailure();
    return [];
  }
}

export async function getDeltaFromServer<T extends { updatedAt?: number }>(
  options: DeltaSyncOptions
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
    const since = options.since || 0;
    const url = `${baseUrl}/Tracker/api/get.php?endpoint=${encodeURIComponent(options.dataType)}&since=${since}`;
    
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
    
    const filtered = result.filter((item: T) => (item.updatedAt || 0) > since);
    
    recordSuccess();
    return filtered as T[];
  } catch {
    recordFailure();
    return [];
  }
}

export async function saveDeltaToServer<T extends { id: string; updatedAt?: number }>(
  data: T[],
  options: SyncOptions
): Promise<T[]> {
  if (data.length === 0) {
    return data;
  }
  
  if (!shouldAttemptSync()) {
    return data;
  }

  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    return data;
  }
  
  try {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/Tracker/api/sync.php?endpoint=${encodeURIComponent(options.dataType)}&delta=true`;
    

    
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
  } catch {
    recordFailure();
    return data;
  }
}

export function mergeData<T extends { id: string; updatedAt?: number; deleted?: boolean }>(local: T[], remote: T[], options?: { protectedIds?: string[] }): T[] {
  const merged = new Map<string, T>();
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  
  const normalizeTimestamp = (ts?: number): number => {
    if (!ts || ts === 0) {
      return 0;
    }
    return ts;
  };
  
  local.forEach(item => {
    if (seenIds.has(item.id)) {
      return;
    }
    seenIds.add(item.id);
    
    const itemName = (item as any).name;
    if (itemName) {
      seenNames.add(itemName.toLowerCase().trim());
    }
    
    const normalized = { ...item, updatedAt: normalizeTimestamp(item.updatedAt) };
    merged.set(item.id, normalized as T);
  });
  

  
  remote.forEach(item => {
    const itemName = (item as any).name;
    if (itemName) {
      const normalizedName = itemName.toLowerCase().trim();
      if (seenNames.has(normalizedName) && !seenIds.has(item.id)) {
        return;
      }
      seenNames.add(normalizedName);
    }
    
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
    } else {
      const existing = merged.get(item.id);
      const remoteTime = normalizeTimestamp(item.updatedAt);
      const existingTime = normalizeTimestamp(existing?.updatedAt);
      
      if (remoteTime <= existingTime) {
        return;
      }
    }
    
    const existing = merged.get(item.id);
    const remoteTime = normalizeTimestamp(item.updatedAt);
    const localTime = normalizeTimestamp(existing?.updatedAt);
    
    if (options?.protectedIds?.includes(item.id)) {
      return;
    }
    
    if (options?.protectedIds && options.protectedIds.length > 0) {
      if (!existing && !item.deleted) {
        return;
      }
    }
    
    if (existing && existing.deleted) {
      if (item.deleted) {
        if (remoteTime > localTime) {
          const normalized = { ...item, updatedAt: remoteTime };
          merged.set(item.id, normalized as T);
        }
        return;
      } else {
        const RESURRECTION_THRESHOLD = 5 * 60 * 1000;
        if (remoteTime > localTime + RESURRECTION_THRESHOLD) {
          const normalized = { ...item, updatedAt: remoteTime };
          merged.set(item.id, normalized as T);

        }
        return;
      }
    }
    
    if (item.deleted) {
      if (remoteTime >= localTime) {
        const normalized = { ...item, updatedAt: remoteTime };
        merged.set(item.id, normalized as T);
      }
      return;
    }
    
    if (remoteTime === 0 && localTime > 0) {
      return;
    }
    
    if (!existing) {
      const normalized = { ...item, updatedAt: remoteTime };
      merged.set(item.id, normalized as T);
    } else if (remoteTime > localTime) {
      const normalized = { ...item, updatedAt: remoteTime };
      merged.set(item.id, normalized as T);
    }
  });
  
  const result = Array.from(merged.values());
  
  return result as T[];
}
