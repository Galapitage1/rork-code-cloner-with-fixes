import { saveToServer, getFromServer, mergeData, getDeltaFromServer, saveDeltaToServer } from './directSync';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DELTA_SYNC_SAFETY_WINDOW_MS = 10 * 60 * 1000;
const BACKGROUND_PULL_MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FUTURE_SYNC_SKEW_MS = 2 * 60 * 1000;

async function getLastSyncTimestamp(dataType: string, userId: string): Promise<number> {
  try {
    const key = `@last_sync_${dataType}_${userId}`;
    const stored = await AsyncStorage.getItem(key);
    const parsed = stored ? parseInt(stored, 10) : 0;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    const now = Date.now();
    // Self-heal broken clock scenarios that can block remote delta downloads forever.
    if (parsed > now + MAX_FUTURE_SYNC_SKEW_MS) {
      console.warn(`syncData [${dataType}]: Invalid future last-sync timestamp detected (${parsed}), resetting`);
      await AsyncStorage.removeItem(key).catch(() => {});
      return 0;
    }

    return Math.min(parsed, now);
  } catch {
    return 0;
  }
}

async function setLastSyncTimestamp(dataType: string, userId: string, timestamp: number): Promise<void> {
  try {
    const key = `@last_sync_${dataType}_${userId}`;
    await AsyncStorage.setItem(key, timestamp.toString());
  } catch {
  }
}

export async function syncData<T extends { id: string; updatedAt?: number; deleted?: boolean }>(
  dataType: string,
  localData: T[],
  userId?: string,
  options?: {
    minDays?: number;
    isDefaultAdminDevice?: boolean;
    fetchOnly?: boolean;
    includeDeleted?: boolean;
    pushOnly?: boolean;
    skipRemoteFetchIfRecent?: boolean;
    changedItems?: T[];
    [key: string]: unknown;
  }
): Promise<T[]> {
  if (!userId) {
    return localData;
  }

  try {
    const lastSyncTime = await getLastSyncTimestamp(dataType, userId);
    const isFirstSync = lastSyncTime === 0;
    
    let protectedIds: string[] = [];
    try {
      const permanentLock = await AsyncStorage.getItem('@permanent_settings_lock');
      if (permanentLock) {
        const parsed = JSON.parse(permanentLock);
        if (dataType === 'outlets' && parsed.outlets) {
          protectedIds = parsed.outlets;
        } else if (dataType === 'users' && parsed.users) {
          protectedIds = parsed.users;
        }
      }
    } catch {
      // No lock
    }
    
    // CRITICAL: When fetchOnly is true (cache was cleared), do NOT push local data to server
    // This prevents empty local data from overwriting existing server data
    // Also include deleted items so we can restore them
    if (options?.fetchOnly) {
      console.log(`syncData [${dataType}]: FETCH-ONLY mode - skipping push to server to prevent data loss`);
      console.log(`syncData [${dataType}]: Will fetch ALL server data including deleted items for restoration`);
    } else {
      const explicitlyChanged = Array.isArray(options?.changedItems)
        ? options.changedItems.filter(item => item && typeof item.id === 'string')
        : null;
      const changedItems = explicitlyChanged
        ? explicitlyChanged
        : (isFirstSync
          ? localData
          : localData.filter(item => (item.updatedAt || 0) > lastSyncTime));
      
      if (changedItems.length > 0) {
        if (isFirstSync && !options?.pushOnly && !explicitlyChanged) {
          console.log(`syncData [${dataType}]: First sync - pushing ${changedItems.length} items to server`);
          await saveToServer(changedItems, { userId, dataType });
        } else {
          console.log(`syncData [${dataType}]: Delta sync - pushing ${changedItems.length} changed items to server`);
          await saveDeltaToServer(changedItems, { userId, dataType });
        }
      } else {
        console.log(`syncData [${dataType}]: No changed items to push`);
      }

      // Push-only mode is used for immediate edit/add sync to reduce data usage.
      // Other-device updates are fetched by scheduled or manual sync cycles.
      if (options?.pushOnly) {
        const now = Date.now();
        await setLastSyncTimestamp(dataType, userId, now);
        return localData;
      }
    }
    
    // CRITICAL: When fetchOnly is true (cache cleared), fetch ALL data including deleted items
    // Use minDays: 90 to ensure we get full 90-day history from server
    // Set includeDeleted: true to restore deleted items that may have been lost
    const shouldIncludeDeleted = options?.fetchOnly || options?.includeDeleted;
    const effectiveMinDays = options?.fetchOnly ? Math.max(options?.minDays || 90, 90) : options?.minDays;

    if (
      options?.skipRemoteFetchIfRecent &&
      !isFirstSync &&
      !options?.fetchOnly &&
      !options?.pushOnly &&
      localData.length > 0
    ) {
      const now = Date.now();
      if ((now - lastSyncTime) < BACKGROUND_PULL_MIN_INTERVAL_MS) {
        console.log(
          `syncData [${dataType}]: Skipping remote pull (last sync ${(Math.round((now - lastSyncTime) / 1000))}s ago) to reduce bandwidth`
        );
        await setLastSyncTimestamp(dataType, userId, now);
        return localData;
      }
    }
    
    const shouldForceFullFetch = !isFirstSync && !options?.fetchOnly && !options?.pushOnly && localData.length === 0;
    const deltaSince = Math.max(0, lastSyncTime - DELTA_SYNC_SAFETY_WINDOW_MS);

    if (shouldForceFullFetch) {
      console.log(`syncData [${dataType}]: Local data empty with existing sync timestamp - forcing full fetch for self-healing`);
    }

    const remoteChanges = isFirstSync || options?.fetchOnly || shouldForceFullFetch
      ? await getFromServer<T>({ userId, dataType, minDays: effectiveMinDays, includeDeleted: shouldIncludeDeleted })
      : await getDeltaFromServer<T>({ userId, dataType, since: deltaSince });
    
    console.log(`syncData [${dataType}]: Fetched ${remoteChanges.length} items from server (includeDeleted: ${shouldIncludeDeleted}, minDays: ${effectiveMinDays || 'default'})`);
    
    if (options?.fetchOnly) {
      // In fetch-only mode, server is the source of truth regardless of local cache contents.
      // This avoids stale local IDs overriding canonical server IDs (especially for products).
      console.log(`syncData [${dataType}]: FETCH-ONLY - using server data directly (${remoteChanges.length} items)`);
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      return remoteChanges;
    }

    if (remoteChanges.length > 0) {
      const merged = mergeData(localData, remoteChanges, {
        protectedIds,
        dedupeByName: dataType === 'products',
      });
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      return merged;
    } else {
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      return localData;
    }
  } catch (error) {
    console.error(`syncData [${dataType}]: Error during sync:`, error);
    return localData;
  }
}
