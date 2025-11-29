import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

export const getLastUpdatedProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataTypes: z.array(z.string()),
  }))
  .query(async ({ input, ctx }) => {
    const { userId, dataTypes } = input;

    const kv = (ctx.env as any).KV;
    if (!kv) {
      console.error('[tRPC getLastUpdated] KV storage not available');
      return {};
    }

    const result: Record<string, number> = {};
    
    try {
      for (const dataType of dataTypes) {
        const lastModifiedKey = `${userId}:${dataType}:lastModified`;
        const lastModified = await kv.get(lastModifiedKey);
        
        if (lastModified) {
          result[dataType] = parseInt(lastModified, 10);
        } else {
          result[dataType] = 0;
        }
      }
      
      return result;
    } catch (error) {
      console.error('[tRPC getLastUpdated] Error:', error);
      return {};
    }
  });
