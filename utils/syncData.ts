import { saveToServer, getFromServer, mergeData } from './directSync';

export async function syncData<T extends { id: string; updatedAt?: number }>(
  dataType: string,
  localData: T[],
  userId?: string,
  _options?: Record<string, unknown>
): Promise<T[]> {
  if (!userId) {
    return localData;
  }

  try {
    console.log(`[syncData] ${dataType}: Starting sync - local items:`, localData.length);
    
    console.log(`[syncData] ${dataType}: STEP 1 - Syncing OUT local data to server first...`);
    const savedToServer = await saveToServer(localData, {
      userId,
      dataType,
    });
    console.log(`[syncData] ${dataType}: ✓ Synced OUT to server, got back:`, savedToServer.length, 'items');
    
    console.log(`[syncData] ${dataType}: STEP 2 - Fetching from server to get other devices' updates...`);
    const remoteData = await getFromServer<T>({
      userId,
      dataType,
    });
    console.log(`[syncData] ${dataType}: ✓ Fetched from server:`, remoteData.length, 'items');
    
    console.log(`[syncData] ${dataType}: STEP 3 - Merging with timestamp-based conflict resolution...`);
    const merged = mergeData(savedToServer, remoteData);
    console.log(`[syncData] ${dataType}: ✓ Merge complete:`, merged.length, 'items');
    
    console.log(`[syncData] ${dataType}: STEP 4 - Saving merged result back to server...`);
    const finalSaved = await saveToServer(merged, {
      userId,
      dataType,
    });
    console.log(`[syncData] ${dataType}: ✓ Sync complete -`, finalSaved.length, 'items on server');
    
    return finalSaved;
  } catch (error) {
    console.error(`[syncData] ${dataType}: Sync failed, returning local data:`, error);
    return localData;
  }
}
