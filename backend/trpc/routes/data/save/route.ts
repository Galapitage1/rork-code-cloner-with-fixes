import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

const dataSchema = z.object({
  id: z.string(),
  updatedAt: z.number().optional(),
  deleted: z.boolean().optional(),
}).passthrough();

export const saveDataProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataType: z.string(),
    data: z.array(dataSchema),
  }))
  .mutation(async ({ input, ctx }) => {
    const { userId, dataType, data } = input;

    console.log(`[tRPC save] ${dataType}: Saving ${data.length} items for user ${userId}`);

    const kv = (ctx.env as any).KV;
    if (!kv) {
      console.error('[tRPC save] KV storage not available');
      return data;
    }

    const key = `${userId}:${dataType}`;
    
    try {
      const existingData = await kv.get(key);
      let existing: any[] = [];
      
      if (existingData) {
        try {
          existing = JSON.parse(existingData);
        } catch (e) {
          console.error(`[tRPC save] Failed to parse existing data for ${key}:`, e);
          existing = [];
        }
      }

      const merged = new Map<string, any>();
      
      existing.forEach((item: any) => merged.set(item.id, item));
      
      data.forEach((item) => {
        const existingItem = merged.get(item.id);
        if (!existingItem || (item.updatedAt || 0) > (existingItem.updatedAt || 0)) {
          merged.set(item.id, item);
        }
      });

      const result = Array.from(merged.values());
      
      await kv.put(key, JSON.stringify(result));
      
      const lastModifiedKey = `${userId}:${dataType}:lastModified`;
      await kv.put(lastModifiedKey, Date.now().toString());
      
      console.log(`[tRPC save] ${dataType}: Saved ${result.length} items to server`);
      
      return result;
    } catch (error) {
      console.error(`[tRPC save] Error saving ${dataType}:`, error);
      return data;
    }
  });
