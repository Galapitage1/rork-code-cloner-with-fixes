import { saveToServer, getFromServer, mergeData } from './directSync';

export async function syncData<T extends { id: string; updatedAt?: number }>(
  endpoint: string,
  localData: T[],
  userId?: string,
  options?: any
): Promise<T[]> {
  if (!userId) {
    console.warn(`[syncData] No userId provided for ${endpoint}, returning local data`);
    return localData;
  }

  try {
    console.log(`[syncData] ${endpoint}: Starting sync...`);
    
    const remoteData = await getFromServer<T>({
      userId,
      dataType: endpoint,
    });
    
    const merged = mergeData(localData, remoteData);
    
    const saved = await saveToServer(merged, {
      userId,
      dataType: endpoint,
    });
    
    console.log(`[syncData] ${endpoint}: Sync complete`);
    return saved;
  } catch (error) {
    console.error(`[syncData] ${endpoint}: Sync failed:`, error);
    return localData;
  }
}
