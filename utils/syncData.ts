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
    const remoteData = await getFromServer<T>({
      userId,
      dataType,
    });
    
    const merged = mergeData(localData, remoteData);
    
    const saved = await saveToServer(merged, {
      userId,
      dataType,
    });
    
    return saved;
  } catch (error) {
    return localData;
  }
}
