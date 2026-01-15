import AsyncStorage from '@react-native-async-storage/async-storage';
import { StockCheck, ProductRequest, Product, Outlet, ProductConversion, InventoryStock } from '@/types';

const PENDING_SYNC_KEY = '@pending_sync_queue';

export type PendingOperation = 
  | { type: 'saveStockCheck'; data: StockCheck; userId: string; skipInventoryUpdate?: boolean }
  | { type: 'addRequest'; data: ProductRequest; userId: string }
  | { type: 'updateRequest'; requestId: string; updates: Partial<ProductRequest>; userId: string }
  | { type: 'updateRequestStatus'; requestId: string; status: string; userId: string }
  | { type: 'deleteRequest'; requestId: string; userId: string }
  | { type: 'addProduct'; data: Product; userId: string }
  | { type: 'updateProduct'; productId: string; updates: Partial<Product>; userId: string }
  | { type: 'deleteProduct'; productId: string; userId: string }
  | { type: 'addOutlet'; data: Outlet; userId: string }
  | { type: 'updateOutlet'; outletId: string; updates: Partial<Outlet>; userId: string }
  | { type: 'deleteOutlet'; outletId: string; userId: string }
  | { type: 'addProductConversion'; data: ProductConversion; userId: string }
  | { type: 'updateProductConversion'; conversionId: string; updates: Partial<ProductConversion>; userId: string }
  | { type: 'deleteProductConversion'; conversionId: string; userId: string }
  | { type: 'updateInventoryStock'; productId: string; updates: Partial<InventoryStock>; userId: string }
  | { type: 'deleteStockCheck'; checkId: string; userId: string }
  | { type: 'updateStockCheck'; checkId: string; newCounts: any[]; newOutlet?: string; outletChanged?: boolean; replaceAllInventory?: boolean; userId: string };

interface PendingQueueItem {
  id: string;
  operation: PendingOperation;
  timestamp: number;
  retryCount: number;
}

export async function addToPendingQueue(operation: PendingOperation): Promise<void> {
  try {

    
    const queue = await getPendingQueue();
    const newItem: PendingQueueItem = {
      id: `${operation.type}_${Date.now()}_${Math.random()}`,
      operation,
      timestamp: Date.now(),
      retryCount: 0,
    };
    
    queue.push(newItem);
    await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(queue));
    

  } catch {
  }
}

export async function getPendingQueue(): Promise<PendingQueueItem[]> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_SYNC_KEY);
    if (!stored) return [];
    
    const queue = JSON.parse(stored);
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

export async function removeFromQueue(itemId: string): Promise<void> {
  try {
    const queue = await getPendingQueue();
    const filtered = queue.filter(item => item.id !== itemId);
    await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(filtered));

  } catch {
  }
}

export async function updateRetryCount(itemId: string): Promise<void> {
  try {
    const queue = await getPendingQueue();
    const item = queue.find(i => i.id === itemId);
    if (item) {
      item.retryCount += 1;
      await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(queue));
    }
  } catch {
  }
}

export async function clearPendingQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_SYNC_KEY);

  } catch {
  }
}

export async function processPendingQueue(
  executor: (operation: PendingOperation) => Promise<boolean>
): Promise<{ success: number; failed: number; total: number }> {
  const queue = await getPendingQueue();
  
  if (queue.length === 0) {
    return { success: 0, failed: 0, total: 0 };
  }
  
  let success = 0;
  let failed = 0;
  
  for (const item of queue) {
    try {

      
      const result = await executor(item.operation);
      
      if (result) {
        await removeFromQueue(item.id);
        success++;

      } else {
        if (item.retryCount < 3) {
          await updateRetryCount(item.id);
          failed++;

        } else {
          await removeFromQueue(item.id);
          failed++;

        }
      }
    } catch {
      if (item.retryCount < 3) {
        await updateRetryCount(item.id);
      } else {
        await removeFromQueue(item.id);
      }
      failed++;
    }
  }
  
  return { success, failed, total: queue.length };
}

export async function hasPendingOperations(): Promise<boolean> {
  const queue = await getPendingQueue();
  return queue.length > 0;
}
