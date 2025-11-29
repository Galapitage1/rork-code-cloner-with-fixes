import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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
  .mutation(async ({ input }) => {
    const { userId, dataType, data } = input;

    console.log(`[tRPC save] ${dataType}: Saving ${data.length} items for user ${userId}`);

    const filePath = path.join(DATA_DIR, `${userId}_${dataType}.json`);
    const lastModifiedPath = path.join(DATA_DIR, `${userId}_${dataType}_lastModified.txt`);
    
    try {
      let existing: any[] = [];
      
      if (fs.existsSync(filePath)) {
        try {
          const existingData = fs.readFileSync(filePath, 'utf-8');
          existing = JSON.parse(existingData);
          if (!Array.isArray(existing)) existing = [];
        } catch (e) {
          console.error(`[tRPC save] Failed to parse existing data for ${userId}:${dataType}:`, e);
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
      
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
      fs.writeFileSync(lastModifiedPath, Date.now().toString());
      
      console.log(`[tRPC save] ${dataType}: Saved ${result.length} items to server`);
      
      return result;
    } catch (error) {
      console.error(`[tRPC save] Error saving ${dataType}:`, error);
      return data;
    }
  });
