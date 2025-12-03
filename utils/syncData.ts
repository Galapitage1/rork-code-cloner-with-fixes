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
  } catch (error) {
    console.error(`[syncData] ${dataType}: Failed to save lastSync timestamp:`, error);
  }
}

export async function syncData<T extends { id: string; updatedAt?: number; deleted?: boolean }>(
  dataType: string,
  localData: T[],
  userId?: string,
  _options?: Record<string, unknown>
): Promise<T[]> {
  if (!userId) {
    return localData;
  }

  try {
    console.log(`[syncData] ${dataType}: Starting INCREMENTAL sync - local items:`, localData.length);
    
    const lastSyncTime = await getLastSyncTimestamp(dataType, userId);
    const isFirstSync = lastSyncTime === 0;
    
    if (isFirstSync) {
      console.log(`[syncData] ${dataType}: 🆕 FIRST SYNC - Using full sync`);
    } else {
      console.log(`[syncData] ${dataType}: ♻️ INCREMENTAL SYNC - Last sync:`, new Date(lastSyncTime).toISOString());
    }
    
    // CRITICAL: Load permanent settings lock
    let protectedIds: string[] = [];
    try {
      const permanentLock = await AsyncStorage.getItem('@permanent_settings_lock');
      if (permanentLock) {
        const parsed = JSON.parse(permanentLock);
        console.log(`[syncData] ${dataType}: Permanent settings lock loaded - saved at:`, new Date(parsed.savedAt).toISOString());
        
        // Map dataType to the protected IDs
        if (dataType === 'outlets' && parsed.outlets) {
          protectedIds = parsed.outlets;
          console.log(`[syncData] ${dataType}: 🔒 Protected outlets:`, protectedIds.length);
        } else if (dataType === 'users' && parsed.users) {
          protectedIds = parsed.users;
          console.log(`[syncData] ${dataType}: 🔒 Protected users:`, protectedIds.length);
        }
      }
    } catch {
      console.log(`[syncData] ${dataType}: No permanent settings lock found (this is normal)`);
    }
    
    // Count local deletions and edits
    const localDeleted = localData.filter(item => item.deleted).length;
    const localActive = localData.filter(item => !item.deleted).length;
    console.log(`[syncData] ${dataType}: Local state - active:`, localActive, 'deleted:', localDeleted);
    
    // INCREMENTAL: Only sync items changed since lastSyncTime
    const changedItems = isFirstSync 
      ? localData 
      : localData.filter(item => (item.updatedAt || 0) > lastSyncTime);
    
    console.log(`[syncData] ${dataType}: 📤 Uploading ${changedItems.length} changed items (out of ${localData.length} total)`);
    
    if (changedItems.length > 0) {
      console.log(`[syncData] ${dataType}: STEP 1 - Syncing OUT changed items to server...`);
      if (isFirstSync) {
        await saveToServer(changedItems, { userId, dataType });
      } else {
        await saveDeltaToServer(changedItems, { userId, dataType });
      }
      console.log(`[syncData] ${dataType}: ✓ Synced OUT ${changedItems.length} changed items`);
    } else {
      console.log(`[syncData] ${dataType}: ⏩ No local changes to upload`);
    }
    
    // STEP 2: Fetch ONLY changes from server since lastSyncTime
    console.log(`[syncData] ${dataType}: STEP 2 - Fetching changes from server...`);
    const remoteChanges = isFirstSync
      ? await getFromServer<T>({ userId, dataType })
      : await getDeltaFromServer<T>({ userId, dataType, since: lastSyncTime });
    
    console.log(`[syncData] ${dataType}: ✓ Fetched ${remoteChanges.length} changed items from server`);
    
    // STEP 3: Merge remote changes with local data
    if (remoteChanges.length > 0) {
      console.log(`[syncData] ${dataType}: STEP 3 - Merging ${remoteChanges.length} remote changes...`);
      const merged = mergeData(localData, remoteChanges, { protectedIds });
      const deletedInMerge = merged.filter(item => item.deleted).length;
      const activeInMerge = merged.length - deletedInMerge;
      console.log(`[syncData] ${dataType}: ✓ Merge complete:`, merged.length, 'total items (active:', activeInMerge, ', deleted:', deletedInMerge, ')');
      
      // Update lastSync timestamp
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      console.log(`[syncData] ${dataType}: ✓ Updated lastSync timestamp to`, new Date(now).toISOString());
      
      return merged;
    } else {
      console.log(`[syncData] ${dataType}: ⏩ No remote changes, keeping local data`);
      
      // Still update lastSync timestamp
      const now = Date.now();
      await setLastSyncTimestamp(dataType, userId, now);
      
      return localData;
    }
  } catch (error) {
    console.error(`[syncData] ${dataType}: Sync failed, returning local data:`, error);
    return localData;
  }
}
