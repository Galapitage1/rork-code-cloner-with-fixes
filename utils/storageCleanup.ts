import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_CLEANUP_KEY = '@last_storage_cleanup';
const STORAGE_SIZE_LIMIT_MB = 4;
const STORAGE_SIZE_LIMIT_BYTES = STORAGE_SIZE_LIMIT_MB * 1024 * 1024;
const RETENTION_DAYS = 7; // Keep only last 7 days locally, server has everything

export async function getStorageSize(): Promise<number> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    let totalSize = 0;
    
    for (const key of allKeys) {
      const value = await AsyncStorage.getItem(key);
      if (value) {
        totalSize += new Blob([value]).size;
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('getStorageSize: Error calculating storage size', error);
    return 0;
  }
}

export async function shouldCleanupToday(): Promise<boolean> {
  try {
    const lastCleanup = await AsyncStorage.getItem(LAST_CLEANUP_KEY);
    if (!lastCleanup) {
      return true;
    }
    
    const lastCleanupDate = new Date(parseInt(lastCleanup));
    const today = new Date();
    
    lastCleanupDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    return lastCleanupDate.getTime() !== today.getTime();
  } catch (error) {
    console.error('shouldCleanupToday: Error checking cleanup date', error);
    return true;
  }
}

export async function cleanupOldData(): Promise<void> {
  try {
    console.log('[STORAGE CLEANUP] Starting cleanup...');
    
    const allKeys = await AsyncStorage.getAllKeys();
    const keysToRemove: string[] = [];
    
    const currentDate = Date.now();
    const retentionDaysAgo = currentDate - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const retentionDaysAgoStr = new Date(retentionDaysAgo).toISOString().split('T')[0];
    
    // Special handling for stock checks - clean up old ones
    const stockChecksKey = '@stock_app_stock_checks';
    if (allKeys.includes(stockChecksKey)) {
      try {
        const stockChecksData = await AsyncStorage.getItem(stockChecksKey);
        if (stockChecksData) {
          const stockChecks = JSON.parse(stockChecksData);
          if (Array.isArray(stockChecks)) {
            const filtered = stockChecks.filter((check: any) => {
              if (check.deleted) return false;
              if (!check.date) return true;
              return check.date >= retentionDaysAgoStr;
            });
            
            if (filtered.length !== stockChecks.length) {
              await AsyncStorage.setItem(stockChecksKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] Cleaned ${stockChecks.length - filtered.length} old stock checks (older than ${RETENTION_DAYS} days)`);
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] Error cleaning stock checks:', error);
      }
    }
    
    // Clean up other keys
    const preservedKeys = [
      LAST_CLEANUP_KEY,
      stockChecksKey,
      '@stock_app_outlets',
      '@stock_app_current_user',
      '@stock_app_users',
      '@stock_app_show_page_tabs',
      '@stock_app_currency',
    ];
    
    for (const key of allKeys) {
      if (preservedKeys.includes(key) ||
          key.startsWith('@jsonbin_') || 
          key.startsWith('@device_id') ||
          key.startsWith('@central_bin_map')) {
        continue;
      }
      
      try {
        const value = await AsyncStorage.getItem(key);
        if (!value) continue;
        
        const parsed = JSON.parse(value);
        
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((item: any) => {
            if (item.deleted) return false;
            if (item.updatedAt && item.updatedAt < retentionDaysAgo) {
              return false;
            }
            if (item.date) {
              const itemDate = new Date(item.date).getTime();
              if (itemDate < retentionDaysAgo) {
                return false;
              }
            }
            return true;
          });
          
          if (filtered.length === 0 && !key.startsWith('@stock_app_')) {
            keysToRemove.push(key);
          } else if (filtered.length !== parsed.length) {
            await AsyncStorage.setItem(key, JSON.stringify(filtered));
            console.log(`[STORAGE CLEANUP] Cleaned ${parsed.length - filtered.length} items from ${key}`);
          }
        }
      } catch (parseError) {
        continue;
      }
    }
    
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      console.log(`[STORAGE CLEANUP] Removed ${keysToRemove.length} empty keys`);
    }
    
    await AsyncStorage.setItem(LAST_CLEANUP_KEY, Date.now().toString());
    
    const finalSize = await getStorageSize();
    const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);
    console.log(`[STORAGE CLEANUP] Complete. Current storage size: ${finalSizeMB}MB`);
    
  } catch (error) {
    console.error('[STORAGE CLEANUP] Error during cleanup:', error);
  }
}

export async function clearCacheIfNeeded(): Promise<boolean> {
  try {
    const storageSize = await getStorageSize();
    const storageSizeMB = (storageSize / (1024 * 1024)).toFixed(2);
    
    console.log(`[STORAGE CHECK] Current storage size: ${storageSizeMB}MB`);
    
    if (storageSize > STORAGE_SIZE_LIMIT_BYTES) {
      console.log(`[STORAGE CHECK] Storage limit exceeded (${storageSizeMB}MB > ${STORAGE_SIZE_LIMIT_MB}MB). Cleaning up...`);
      await cleanupOldData();
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[STORAGE CHECK] Error checking storage:', error);
    return false;
  }
}

export async function performDailyCleanup(): Promise<void> {
  try {
    const shouldCleanup = await shouldCleanupToday();
    
    if (shouldCleanup) {
      console.log('[DAILY CLEANUP] Performing daily cleanup...');
      await cleanupOldData();
    } else {
      console.log('[DAILY CLEANUP] Already cleaned today');
      await clearCacheIfNeeded();
    }
  } catch (error) {
    console.error('[DAILY CLEANUP] Error:', error);
  }
}
