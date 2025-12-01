import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_CLEANUP_KEY = '@last_storage_cleanup';
const STORAGE_SIZE_LIMIT_MB = 6;
const STORAGE_SIZE_LIMIT_BYTES = STORAGE_SIZE_LIMIT_MB * 1024 * 1024;
const RETENTION_DAYS = 3;
const CLEANUP_INTERVAL_DAYS = 3;

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
      console.log('[STORAGE CLEANUP] No previous cleanup found, running cleanup now');
      return true;
    }
    
    const lastCleanupTime = parseInt(lastCleanup);
    const now = Date.now();
    const daysSinceLastCleanup = (now - lastCleanupTime) / (24 * 60 * 60 * 1000);
    
    console.log(`[STORAGE CLEANUP] Days since last cleanup: ${daysSinceLastCleanup.toFixed(2)}`);
    
    if (daysSinceLastCleanup >= CLEANUP_INTERVAL_DAYS) {
      console.log(`[STORAGE CLEANUP] ${CLEANUP_INTERVAL_DAYS} days passed, running cleanup now`);
      return true;
    }
    
    return false;
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
    
    console.log(`[STORAGE CLEANUP] Retention cutoff: Keep data newer than ${retentionDaysAgoStr}`);
    console.log(`[STORAGE CLEANUP] This will delete data older than ${RETENTION_DAYS} days`);
    
    const beforeSize = await getStorageSize();
    const beforeSizeMB = (beforeSize / (1024 * 1024)).toFixed(2);
    console.log(`[STORAGE CLEANUP] Storage before cleanup: ${beforeSizeMB}MB`);
    
    let totalItemsCleaned = 0;
    
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
              console.log(`[STORAGE CLEANUP] ✓ Cleaned ${stockChecks.length - filtered.length} old stock checks (older than ${RETENTION_DAYS} days)`);
              totalItemsCleaned += stockChecks.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning stock checks:', error);
      }
    }
    
    const preservedKeys = [
      LAST_CLEANUP_KEY,
      stockChecksKey,
      '@stock_app_outlets',
      '@stock_app_current_user',
      '@stock_app_users',
      '@stock_app_show_page_tabs',
      '@stock_app_currency',
      '@stock_app_products',
      '@stock_app_store_products',
      '@stock_app_suppliers',
      'customers',
    ];
    
    const requestsKey = '@stock_app_requests';
    if (allKeys.includes(requestsKey)) {
      try {
        const requestsData = await AsyncStorage.getItem(requestsKey);
        if (requestsData) {
          const requests = JSON.parse(requestsData);
          if (Array.isArray(requests)) {
            const filtered = requests.filter((req: any) => {
              if (req.deleted) return false;
              if (!req.requestedAt && !req.date) return true;
              const itemDate = req.requestedAt || new Date(req.date).getTime();
              return itemDate >= retentionDaysAgo;
            });
            
            if (filtered.length !== requests.length) {
              await AsyncStorage.setItem(requestsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Cleaned ${requests.length - filtered.length} old requests (older than ${RETENTION_DAYS} days)`);
              totalItemsCleaned += requests.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning requests:', error);
      }
    }
    
    const activityLogsKey = '@stock_app_activity_logs';
    if (allKeys.includes(activityLogsKey)) {
      try {
        const logsData = await AsyncStorage.getItem(activityLogsKey);
        if (logsData) {
          const logs = JSON.parse(logsData);
          if (Array.isArray(logs)) {
            const filtered = logs.filter((log: any) => {
              if (log.deleted) return false;
              if (!log.createdAt && !log.date) return true;
              const itemDate = log.createdAt || new Date(log.date).getTime();
              return itemDate >= retentionDaysAgo;
            });
            
            if (filtered.length !== logs.length) {
              await AsyncStorage.setItem(activityLogsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Cleaned ${logs.length - filtered.length} old activity logs (older than ${RETENTION_DAYS} days)`);
              totalItemsCleaned += logs.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning activity logs:', error);
      }
    }
    
    for (const key of allKeys) {
      if (preservedKeys.includes(key) ||
          key.startsWith('@jsonbin_') || 
          key.startsWith('@device_id') ||
          key.startsWith('@central_bin_map')) {
        continue;
      }
      
      try {
        const value = await AsyncStorage.getItem(key);
        if (!value) {
          keysToRemove.push(key);
          continue;
        }
        
        const parsed = JSON.parse(value);
        
        if (Array.isArray(parsed)) {
          const beforeCount = parsed.length;
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
          
          const cleaned = beforeCount - filtered.length;
          totalItemsCleaned += cleaned;
          
          if (filtered.length === 0) {
            keysToRemove.push(key);
          } else if (cleaned > 0) {
            await AsyncStorage.setItem(key, JSON.stringify(filtered));
            console.log(`[STORAGE CLEANUP] ✓ Cleaned ${cleaned} old items from ${key}`);
          }
        }
      } catch (parseError) {
        continue;
      }
    }
    
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      console.log(`[STORAGE CLEANUP] ✓ Removed ${keysToRemove.length} empty/invalid keys`);
    }
    
    await AsyncStorage.setItem(LAST_CLEANUP_KEY, Date.now().toString());
    
    const finalSize = await getStorageSize();
    const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);
    const savedMB = ((beforeSize - finalSize) / (1024 * 1024)).toFixed(2);
    console.log(`[STORAGE CLEANUP] ✓ Complete!`);
    console.log(`[STORAGE CLEANUP]   - Cleaned ${totalItemsCleaned} items`);
    console.log(`[STORAGE CLEANUP]   - Storage before: ${beforeSizeMB}MB`);
    console.log(`[STORAGE CLEANUP]   - Storage after: ${finalSizeMB}MB`);
    console.log(`[STORAGE CLEANUP]   - Space freed: ${savedMB}MB`);
    console.log(`[STORAGE CLEANUP]   - Next cleanup: in ${CLEANUP_INTERVAL_DAYS} days`);
    console.log(`[STORAGE CLEANUP]   - Keeping data from: ${retentionDaysAgoStr} onwards`);
    
  } catch (error) {
    console.error('[STORAGE CLEANUP] ✗ Error during cleanup:', error);
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
      console.log('[DAILY CLEANUP] Already cleaned today, checking storage limits...');
      await clearCacheIfNeeded();
    }
  } catch (error) {
    console.error('[DAILY CLEANUP] Error:', error);
  }
}

export async function performCleanupOnLogin(): Promise<void> {
  try {
    console.log('[LOGIN CLEANUP] Checking storage and cleaning up...');
    await clearCacheIfNeeded();
    
    const storageSize = await getStorageSize();
    const storageSizeMB = (storageSize / (1024 * 1024)).toFixed(2);
    console.log(`[LOGIN CLEANUP] Current storage: ${storageSizeMB}MB`);
  } catch (error) {
    console.error('[LOGIN CLEANUP] Error:', error);
  }
}
