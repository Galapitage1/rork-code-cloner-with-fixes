import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

const inMemoryStore = new Map<string, any[]>();

function getStoreKey(userId: string, dataType: string): string {
  return `${userId}:${dataType}`;
}

export const getDataProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataType: z.string(),
  }))
  .query(async ({ input }) => {
    const { userId, dataType } = input;

    console.log(`[tRPC get] ${dataType}: Fetching data for user ${userId}`);

    const storeKey = getStoreKey(userId, dataType);
    
    try {
      const data = inMemoryStore.get(storeKey) || [];
      console.log(`[tRPC get] ${dataType}: Retrieved ${data.length} items for user ${userId}`);
      
      return data;
    } catch (error) {
      console.error(`[tRPC get] Error getting ${dataType}:`, error);
      throw new Error(`Failed to get ${dataType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
