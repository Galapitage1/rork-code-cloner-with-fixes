import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

const lastModifiedStore = new Map<string, number>();

function getStoreKey(userId: string, dataType: string): string {
  return `${userId}:${dataType}`;
}

export const getLastUpdatedProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataTypes: z.array(z.string()),
  }))
  .query(async ({ input }) => {
    const { userId, dataTypes } = input;

    const result: Record<string, number> = {};
    
    try {
      for (const dataType of dataTypes) {
        const storeKey = getStoreKey(userId, dataType);
        result[dataType] = lastModifiedStore.get(storeKey) || 0;
      }
      
      return result;
    } catch (error) {
      console.error('[tRPC getLastUpdated] Error:', error);
      return {};
    }
  });
