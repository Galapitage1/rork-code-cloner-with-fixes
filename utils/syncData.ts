import { saveToServer, getFromServer, mergeData, getDeltaFromServer, saveDeltaToServer } from './directSync';
import AsyncStorage from '@react-native-async-storage/async-storage';

async function getLastSyncTimestamp(dataType: string, userId: string): Promise<number> {
  try {
    const key = `@last_sync_${dataType}_${userId}`;
    const stored = await AsyncStorage.getItem(key);
    return stored ? parseInt(stored, 10) : 0;
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
  options?: { minDays?: number; isDefaultAdminDevice?: boolean; fetchOnly?: boolean; includeDeleted?: boolean; [key: string]: unknown }
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
      const changedItems = isFirstSync 
        ? localData 
        : localData.filter(item => (item.updatedAt || 0) > lastSyncTime);
      
      if (changedItems.length > 0) {
        if (isFirstSync) {
          console.log(`syncData [${dataType}]: First sync - pushing ${changedItems.length} items to server`);
          await saveToServer(changedItems, { userId, dataType });
        } else {
          console.log(`syncData [${dataType}]: Delta sync - pushing ${changedItems.length} changed items to server`);
          await saveDeltaToServer(changedItems, { userId, dataType });
        }
      } else {
        console.log(`syncData [${dataType}]: No changed items to push`);
      }
    }
    
    // CRITICAL: When fetchOnly is true (cache cleared), fetch ALL data including deleted items
    // Use minDays: 90 to ensure we get full 90-day history from server
    // Set includeDeleted: true to restore deleted items that may have been lost
    const shouldIncludeDeleted = options?.fetchOnly || options?.includeDeleted;
    const effectiveMinDays = options?.fetchOnly ? Math.max(options?.minDays || 90, 90) : options?.minDays;
    
    const remoteChanges = isFirstSync || options?.fetchOnly
      ? await getFromServer<T>({ userId, dataType, minDays: effectiveMinDays, includeDeleted: shouldIncludeDeleted })
      : await getDeltaFromServer<T>({ userId, dataType, since: lastSyncTime });
    
    console.log(`syncData [${dataType}]: Fetched ${remoteChanges.length} items from server (includeDeleted: ${shouldIncludeDeleted}, minDays: ${effectiveMinDays || 'default'})`);
    
    if (remoteChanges.length > 0) {
      // CRITICAL: When fetchOnly, server data takes priority over empty local data
      // This prevents cache-cleared device from losing data
      if (options?.fetchOnly && localData.length === 0) {
        console.log(`syncData [${dataType}]: FETCH-ONLY with empty local - using server data directly (${remoteChanges.length} items)`);
        const now = Date.now();
        await setLastSyncTimestamp(dataType, userId, now);
        return remoteChanges;
      }
      
      const merged = mergeData(localData, remoteChanges, { protectedIds });
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
