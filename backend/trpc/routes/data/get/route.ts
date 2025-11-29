import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const getDataProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    dataType: z.string(),
  }))
  .query(async ({ input }) => {
    const { userId, dataType } = input;

    console.log(`[tRPC get] ${dataType}: Fetching data for user ${userId}`);

    const filePath = path.join(DATA_DIR, `${userId}_${dataType}.json`);
    
    try {
      if (!fs.existsSync(filePath)) {
        console.log(`[tRPC get] ${dataType}: No data found for user ${userId}`);
        return [];
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      console.log(`[tRPC get] ${dataType}: Retrieved ${Array.isArray(parsed) ? parsed.length : 0} items for user ${userId}`);
      
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error(`[tRPC get] Error getting ${dataType}:`, error);
      return [];
    }
  });
