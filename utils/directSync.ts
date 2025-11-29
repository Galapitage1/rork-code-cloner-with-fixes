import { trpcClient } from '@/lib/trpc';

export interface SyncOptions {
  userId: string;
  dataType: string;
}

export async function saveToServer<T extends { id: string; updatedAt?: number }>(
  data: T[],
  options: SyncOptions
): Promise<T[]> {
  console.log(`[DirectSync] Saving ${data.length} ${options.dataType} items to server...`);
  
  try {
    const result = await trpcClient.data.save.mutate({
      userId: options.userId,
      dataType: options.dataType,
      data,
    });
    
    console.log(`[DirectSync] Successfully saved ${result.length} ${options.dataType} items`);
    return result as T[];
  } catch (error) {
    console.error(`[DirectSync] Failed to save ${options.dataType}:`, error);
    return data;
  }
}

export async function getFromServer<T>(
  options: SyncOptions
): Promise<T[]> {
  console.log(`[DirectSync] Fetching ${options.dataType} from server...`);
  
  try {
    const result = await trpcClient.data.get.query({
      userId: options.userId,
      dataType: options.dataType,
    });
    
    console.log(`[DirectSync] Retrieved ${result.length} ${options.dataType} items`);
    return result as T[];
  } catch (error) {
    console.error(`[DirectSync] Failed to fetch ${options.dataType}:`, error);
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
