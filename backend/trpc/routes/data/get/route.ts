import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

export const getDataProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataType: z.string(),
  }))
  .query(async ({ input, ctx }) => {
    const { userId, dataType } = input;

    console.log(`[tRPC get] ${dataType}: Fetching data for user ${userId}`);

    const kv = (ctx.env as any).KV;
    if (!kv) {
      console.error('[tRPC get] KV storage not available');
      return [];
    }

    const key = `${userId}:${dataType}`;
    
    try {
      const data = await kv.get(key);
      
      if (!data) {
        console.log(`[tRPC get] ${dataType}: No data found for user ${userId}`);
        return [];
      }

      const parsed = JSON.parse(data);
      console.log(`[tRPC get] ${dataType}: Retrieved ${parsed.length} items for user ${userId}`);
      
      return parsed;
    } catch (error) {
      console.error(`[tRPC get] Error getting ${dataType}:`, error);
      return [];
    }
  });
