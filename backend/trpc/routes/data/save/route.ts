import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

const dataSchema = z.object({
  id: z.string(),
  updatedAt: z.number().optional(),
  deleted: z.boolean().optional(),
}).passthrough();

const inMemoryStore = new Map<string, any[]>();
const lastModifiedStore = new Map<string, number>();

function getStoreKey(userId: string, dataType: string): string {
  return `${userId}:${dataType}`;
}

export const saveDataProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataType: z.string(),
    data: z.array(dataSchema),
  }))
  .mutation(async ({ input }) => {
    const { userId, dataType, data } = input;

    console.log(`[tRPC save] ${dataType}: Saving ${data.length} items for user ${userId}`);

    const storeKey = getStoreKey(userId, dataType);
    
    try {
      let existing: any[] = inMemoryStore.get(storeKey) || [];

      const merged = new Map<string, any>();
      
      existing.forEach((item: any) => merged.set(item.id, item));
      
      data.forEach((item) => {
        const existingItem = merged.get(item.id);
        if (!existingItem || (item.updatedAt || 0) > (existingItem.updatedAt || 0)) {
          merged.set(item.id, item);
        }
      });

      const result = Array.from(merged.values());
      
      inMemoryStore.set(storeKey, result);
      lastModifiedStore.set(storeKey, Date.now());
      
      console.log(`[tRPC save] ${dataType}: Saved ${result.length} items to server`);
      
      return result;
    } catch (error) {
      console.error(`[tRPC save] Error saving ${dataType}:`, error);
      throw new Error(`Failed to save ${dataType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
