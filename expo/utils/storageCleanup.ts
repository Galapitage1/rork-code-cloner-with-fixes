import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveAutomaticCriticalDataBackup } from '@/utils/criticalDataBackup';

const LAST_CLEANUP_KEY = '@last_storage_cleanup';
const STORAGE_SIZE_LIMIT_MB = 4;
const STORAGE_SIZE_LIMIT_BYTES = STORAGE_SIZE_LIMIT_MB * 1024 * 1024;
const RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_DAYS = 1;

const DATA_LIMITS = {
  MAX_STOCK_CHECKS: 200,
  MAX_SALES_DEDUCTIONS: 200,
  MAX_RECONCILE_HISTORY: 100,
  MAX_ACTIVITY_LOGS: 500,
  MAX_KITCHEN_REPORTS: 100,
  MAX_SALES_REPORTS: 100,
};

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

    try {
      const backup = await saveAutomaticCriticalDataBackup('before_cleanup');
      console.log(
        `[STORAGE CLEANUP] Backup saved before cleanup (${backup.id}) - local checks:${backup.localStockChecks}, local requests:${backup.localRequests}, approved:${backup.localApprovedRequests}, server checks:${backup.serverStockChecks}, server requests:${backup.serverRequests}`,
      );
    } catch (backupError) {
      console.warn('[STORAGE CLEANUP] Backup before cleanup failed (continuing cleanup):', backupError);
    }
    
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
              // Keep FULL non-deleted stock check history.
              // Removing historical checks causes random-looking disappearances in History.
              if (!check || typeof check !== 'object') return false;
              if (check.deleted) return false;
              return true;
            });
            
            if (filtered.length !== stockChecks.length) {
              await AsyncStorage.setItem(stockChecksKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Removed ${stockChecks.length - filtered.length} invalid/deleted stock checks (full active history preserved)`);
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
      '@stock_app_sales_deductions',
      '@stock_app_reconcile_history',
      '@reconciliation_kitchen_stock_reports',
      '@reconciliation_sales_reports',
      '@reconciliation_pending_kitchen_stock_reports',
      '@reconciliation_pending_sales_reports',
      '@reconciliation_last_sync',
      '@kitchen_stock_reports',
      '@sales_reports',
      '@stock_app_outlets',
      '@stock_app_current_user',
      '@stock_app_users',
      '@stock_app_show_page_tabs',
      '@stock_app_currency',
      '@stock_app_products',
      '@stock_app_customers',
      '@stock_app_orders',
      '@stock_app_product_conversions',
      '@stock_app_recipes',
      '@stock_app_linked_products',
      '@stock_app_store_products',
      '@stock_app_live_inventory_snapshots',
      '@stock_app_suppliers',
      '@stock_app_grns',
      '@leave_types',
      '@leave_requests',
      '@staff_leave_balances',
      '@leave_balance_security',
      '@hr_staff_members',
      '@hr_attendance_imports',
      '@hr_payroll_month_sheets',
      '@hr_security_settings',
      '@hr_fingerprint_portal_settings',
      '@hr_holiday_calendar_settings',
      '@hr_loan_records',
      '@hr_service_charge_settings',
      '@hr_service_charge_month_entries',
      '@campaign_settings',
      '@permanent_settings_lock',
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
              if (!req || typeof req !== 'object') return false;
              if (req.deleted) return false;
              return true;
            });
            
            if (filtered.length !== requests.length) {
              await AsyncStorage.setItem(requestsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Removed ${requests.length - filtered.length} deleted/invalid requests (full active history preserved)`);
              totalItemsCleaned += requests.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning requests:', error);
      }
    }
    
    const salesDeductionsKey = '@stock_app_sales_deductions';
    if (allKeys.includes(salesDeductionsKey)) {
      try {
        const deductionsData = await AsyncStorage.getItem(salesDeductionsKey);
        if (deductionsData) {
          const deductions = JSON.parse(deductionsData);
          if (Array.isArray(deductions)) {
            const filtered = deductions.filter((d: any) => {
              if (!d || typeof d !== 'object') return false;
              if (d.deleted) return false;
              return true;
            });
            
            if (filtered.length !== deductions.length) {
              await AsyncStorage.setItem(salesDeductionsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Removed ${deductions.length - filtered.length} deleted/invalid sales deductions (full active history preserved)`);
              totalItemsCleaned += deductions.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning sales deductions:', error);
      }
    }
    
    const reconcileHistoryKey = '@stock_app_reconcile_history';
    if (allKeys.includes(reconcileHistoryKey)) {
      try {
        const historyData = await AsyncStorage.getItem(reconcileHistoryKey);
        if (historyData) {
          const history = JSON.parse(historyData);
          if (Array.isArray(history)) {
            const filtered = history.filter((h: any) => {
              if (!h || typeof h !== 'object') return false;
              if (h.deleted) return false;
              return true;
            });
            
            if (filtered.length !== history.length) {
              await AsyncStorage.setItem(reconcileHistoryKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Removed ${history.length - filtered.length} deleted/invalid reconcile history items (full active history preserved)`);
              totalItemsCleaned += history.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning reconcile history:', error);
      }
    }
    
    const kitchenReportsKey = '@kitchen_stock_reports';
    if (allKeys.includes(kitchenReportsKey)) {
      try {
        const reportsData = await AsyncStorage.getItem(kitchenReportsKey);
        if (reportsData) {
          const reports = JSON.parse(reportsData);
          if (Array.isArray(reports)) {
            const filtered = reports.filter((r: any) => {
              if (!r || typeof r !== 'object') return false;
              if (r.deleted) return false;
              return true;
            });
            
            if (filtered.length !== reports.length) {
              await AsyncStorage.setItem(kitchenReportsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Removed ${reports.length - filtered.length} deleted/invalid kitchen reports (full active history preserved)`);
              totalItemsCleaned += reports.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning kitchen reports:', error);
      }
    }
    
    const salesReportsKey = '@sales_reports';
    if (allKeys.includes(salesReportsKey)) {
      try {
        const reportsData = await AsyncStorage.getItem(salesReportsKey);
        if (reportsData) {
          const reports = JSON.parse(reportsData);
          if (Array.isArray(reports)) {
            const filtered = reports.filter((r: any) => {
              if (!r || typeof r !== 'object') return false;
              if (r.deleted) return false;
              return true;
            });
            
            if (filtered.length !== reports.length) {
              await AsyncStorage.setItem(salesReportsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Removed ${reports.length - filtered.length} deleted/invalid sales reports (full active history preserved)`);
              totalItemsCleaned += reports.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning sales reports:', error);
      }
    }
    
    const activityLogsKey = '@stock_app_activity_logs';
    if (allKeys.includes(activityLogsKey)) {
      try {
        const logsData = await AsyncStorage.getItem(activityLogsKey);
        if (logsData) {
          const logs = JSON.parse(logsData);
          if (Array.isArray(logs)) {
            let filtered = logs.filter((log: any) => {
              if (log.deleted) return false;
              if (!log.createdAt && !log.date) return true;
              const itemDate = log.createdAt || new Date(log.date).getTime();
              return itemDate >= retentionDaysAgo;
            });
            
            if (filtered.length > DATA_LIMITS.MAX_ACTIVITY_LOGS) {
              filtered = filtered
                .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
                .slice(0, DATA_LIMITS.MAX_ACTIVITY_LOGS);
            }
            
            if (filtered.length !== logs.length) {
              await AsyncStorage.setItem(activityLogsKey, JSON.stringify(filtered));
              console.log(`[STORAGE CLEANUP] ✓ Cleaned ${logs.length - filtered.length} activity logs (limit: ${DATA_LIMITS.MAX_ACTIVITY_LOGS})`);
              totalItemsCleaned += logs.length - filtered.length;
            }
          }
        }
      } catch (error) {
        console.error('[STORAGE CLEANUP] ✗ Error cleaning activity logs:', error);
      }
    }
    
    // IMPORTANT: Do not limit stock checks by count.
    // Full stock check history is required for history reliability and live inventory traceability.
    
    for (const key of allKeys) {
      if (preservedKeys.includes(key) ||
          key.startsWith('@reconciliation_') ||
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
      } catch {
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
    console.log(`[STORAGE CLEANUP]   - General data retention: ${RETENTION_DAYS} days`);
    console.log('[STORAGE CLEANUP]   - Requests: full active history preserved (only deleted/invalid removed)');
    
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
