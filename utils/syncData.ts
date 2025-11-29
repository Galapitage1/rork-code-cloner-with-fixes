import { saveToServer, getFromServer, mergeData } from './directSync';

export async function syncData<T extends { id: string; updatedAt?: number }>(
  dataType: string,
  localData: T[],
  userId?: string,
  _options?: Record<string, unknown>
): Promise<T[]> {
  if (!userId) {
    console.warn(`[syncData] No userId provided for ${dataType}, returning local data`);
    return localData;
  }

  try {
    console.log(`[syncData] ${dataType}: Starting sync...`);
    
    const remoteData = await getFromServer<T>({
      userId,
      dataType,
    });
    
    const merged = mergeData(localData, remoteData);
    
    const saved = await saveToServer(merged, {
      userId,
      dataType,
    });
    
    console.log(`[syncData] ${dataType}: Sync complete. Synced`, saved.length, 'items');
    return saved;
  } catch (error) {
    console.error(`[syncData] ${dataType}: Sync failed:`, error);
    return localData;
  }
}
