import { trpcClient } from '@/lib/trpc';
import { checkServerHealth } from './connectionStatus';

export interface SyncOptions {
  userId: string;
  dataType: string;
}

let syncFailureCount = 0;
const MAX_FAILURES_BEFORE_PAUSE = 5;
let isPaused = false;
let pauseUntil = 0;

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

export async function saveToServer<T extends { id: string; updatedAt?: number }>(
  data: T[],
  options: SyncOptions
): Promise<T[]> {
  if (!shouldAttemptSync()) {
    console.log(`[DirectSync] Sync paused, skipping save for ${options.dataType}`);
    return data;
  }
  
  const isHealthy = await checkServerHealth();
  if (!isHealthy) {
    console.log(`[DirectSync] Server unhealthy, skipping save for ${options.dataType}`);
    recordFailure();
    return data;
  }
  
  console.log(`[DirectSync] Saving ${data.length} ${options.dataType} items to server...`);
  
  try {
    const result = await trpcClient.data.save.mutate({
      userId: options.userId,
      dataType: options.dataType,
      data,
    });
    
    console.log(`[DirectSync] Successfully saved ${result.length} ${options.dataType} items`);
    recordSuccess();
    return result as T[];
  } catch (error: any) {
    console.error(`[DirectSync] Failed to save ${options.dataType}:`, error?.message || error);
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
  
  const isHealthy = await checkServerHealth();
  if (!isHealthy) {
    console.log(`[DirectSync] Server unhealthy, skipping fetch for ${options.dataType}`);
    recordFailure();
    return [];
  }
  
  console.log(`[DirectSync] Fetching ${options.dataType} from server...`);
  
  try {
    const result = await trpcClient.data.get.query({
      userId: options.userId,
      dataType: options.dataType,
    });
    
    console.log(`[DirectSync] Retrieved ${result.length} ${options.dataType} items`);
    recordSuccess();
    return result as T[];
  } catch (error: any) {
    console.error(`[DirectSync] Failed to fetch ${options.dataType}:`, error?.message || error);
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
