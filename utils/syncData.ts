import { saveToServer, getFromServer, mergeData } from './directSync';

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
    console.log(`[syncData] ${dataType}: Starting sync - local items:`, localData.length);
    
    // Count local deletions and edits
    const localDeleted = localData.filter(item => item.deleted).length;
    const localActive = localData.filter(item => !item.deleted).length;
    console.log(`[syncData] ${dataType}: Local state - active:`, localActive, 'deleted:', localDeleted);
    
    // CRITICAL: Always sync OUT first to push local changes (including deletions) to server
    console.log(`[syncData] ${dataType}: STEP 1 - Syncing OUT all local data (including deletions) to server...`);
    const savedToServer = await saveToServer(localData, {
      userId,
      dataType,
    });
    console.log(`[syncData] ${dataType}: ✓ Synced OUT to server, got back:`, savedToServer.length, 'items');
    
    // STEP 2: Fetch from server to get other devices' updates
    console.log(`[syncData] ${dataType}: STEP 2 - Fetching from server to get other devices' updates...`);
    const remoteData = await getFromServer<T>({
      userId,
      dataType,
    });
    console.log(`[syncData] ${dataType}: ✓ Fetched from server:`, remoteData.length, 'items');
    
    // STEP 3: Merge with timestamp-based conflict resolution
    // This ensures newer timestamps always win (whether local or remote)
    console.log(`[syncData] ${dataType}: STEP 3 - Merging with timestamp-based conflict resolution...`);
    const merged = mergeData(savedToServer, remoteData);
    console.log(`[syncData] ${dataType}: ✓ Merge complete:`, merged.length, 'active items (deleted items filtered out)');
    
    // STEP 4: Save final merged result back to server
    // This ensures all devices converge to the same state
    console.log(`[syncData] ${dataType}: STEP 4 - Saving merged result back to server...`);
    const finalSaved = await saveToServer(merged, {
      userId,
      dataType,
    });
    console.log(`[syncData] ${dataType}: ✓ Sync complete -`, finalSaved.length, 'items');
    
    return finalSaved;
  } catch (error) {
    console.error(`[syncData] ${dataType}: Sync failed, returning local data:`, error);
    return localData;
  }
}
