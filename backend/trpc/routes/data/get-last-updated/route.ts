import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
        const lastModifiedPath = path.join(DATA_DIR, `${userId}_${dataType}_lastModified.txt`);
        
        if (fs.existsSync(lastModifiedPath)) {
          const lastModified = fs.readFileSync(lastModifiedPath, 'utf-8');
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
