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
  options?: { minDays?: number; isDefaultAdminDevice?: boolean; fetchOnly?: boolean; [key: string]: unknown }
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
    if (options?.fetchOnly) {
      console.log(`syncData [${dataType}]: FETCH-ONLY mode - skipping push to server to prevent data loss`);
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
    
    const remoteChanges = isFirstSync
      ? await getFromServer<T>({ userId, dataType, minDays: options?.minDays })
      : await getDeltaFromServer<T>({ userId, dataType, since: lastSyncTime });
    
    if (remoteChanges.length > 0) {
      const merged = mergeData(localData, remoteChanges, { protectedIds });
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      return merged;
    } else {
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      return localData;
    }
  } catch {
    return localData;
  }
}
