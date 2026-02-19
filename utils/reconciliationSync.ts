import AsyncStorage from '@react-native-async-storage/async-storage';

export type KitchenStockReport = {
  id: string;
  outlet: string;
  date: string;
  timestamp: number;
  reconsolidatedAt: string;
  products: {
    productId: string;
    productName: string;
    unit: string;
    quantityWhole: number;
    quantitySlices: number;
  }[];
  updatedAt: number;
  deleted?: boolean;
};

export type SalesReport = {
  id: string;
  outlet: string;
  date: string;
  timestamp: number;
  reconsolidatedAt: string;
  salesData: {
    productId: string;
    productName: string;
    unit: string;
    soldWhole: number;
    soldSlices: number;
    sourceUnit?: 'whole' | 'slices' | 'aggregate';
  }[];
  rawConsumption: {
    rawProductId: string;
    rawName: string;
    rawUnit: string;
    consumedWhole: number;
    consumedSlices: number;
  }[];
  updatedAt: number;
  deleted?: boolean;
};

const STORAGE_KEYS = {
  KITCHEN_STOCK_REPORTS: '@reconciliation_kitchen_stock_reports',
  SALES_REPORTS: '@reconciliation_sales_reports',
  LAST_SYNC: '@reconciliation_last_sync',
};

const BASE_URL = 'https://tracker.tecclk.com';
const SYNC_ENDPOINT = {
  KITCHEN_STOCK: 'reconciliation_kitchen_stock',
  SALES: 'reconciliation_sales',
};

async function readReportsFromStorage<T>(key: string): Promise<T[]> {
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    console.warn(`[RECONCILIATION SYNC] Invalid JSON in ${key}, resetting storage`, error);
    await AsyncStorage.removeItem(key).catch(() => {});
    return [];
  }
}

function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const lower = message.toLowerCase();
  return lower.includes('quota') || lower.includes('exceeded');
}

function sortReportsForCache<T extends { date?: string; updatedAt?: number }>(reports: T[]): T[] {
  return [...reports].sort((a, b) => {
    const dateCompare = (b.date || '').localeCompare(a.date || '');
    if (dateCompare !== 0) return dateCompare;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function filterReportsByRetentionWindow<T extends { date?: string; updatedAt?: number; deleted?: boolean }>(
  reports: T[],
  daysToKeep: number,
): T[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const deletedCutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);

  return reports.filter((report) => {
    if (report.deleted) {
      return (report.updatedAt || 0) >= deletedCutoff;
    }

    if (!report.date) {
      return true;
    }

    return report.date >= cutoffDateStr;
  });
}

async function writeReportsWithBestEffortCache<T extends { date?: string; updatedAt?: number; deleted?: boolean }>(
  key: string,
  reports: T[],
  label: string,
): Promise<void> {
  const sortedReports = sortReportsForCache(reports);

  try {
    await AsyncStorage.setItem(key, JSON.stringify(sortedReports));
    return;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }

    console.warn(`[RECONCILIATION SYNC] ${label} exceeded storage quota, applying adaptive local cache retention`);
  }

  const retentionWindows = [365, 180, 120, 90, 60, 45, 30, 14, 7];
  for (const days of retentionWindows) {
    const reduced = filterReportsByRetentionWindow(sortedReports, days);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(reduced));
      console.warn(`[RECONCILIATION SYNC] Cached ${label} with last ${days} days (${reduced.length}/${sortedReports.length} records)`);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }
    }
  }

  // Last-resort: cache only the newest small slice, but do not fail reconciliation.
  const minimal = sortedReports.slice(0, 20);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(minimal));
    console.warn(`[RECONCILIATION SYNC] Cached minimal ${label} (${minimal.length} records) due to storage quota`);
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }
    // Targeted cleanup: clear only this reconciliation cache key, then retry tiny cache.
    // This avoids clearing unrelated app data.
    console.warn(`[RECONCILIATION SYNC] ${label} still exceeds quota; clearing only ${key} and retrying minimal cache`);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Ignore cleanup errors; continue with best effort.
    }

    const tiny = sortedReports.slice(0, 5);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(tiny));
      console.warn(`[RECONCILIATION SYNC] Rebuilt ${label} cache with tiny set (${tiny.length} records)`);
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) {
        throw retryError;
      }
      console.warn(`[RECONCILIATION SYNC] Could not cache ${label} locally after targeted cleanup; relying on server data`);
    }
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function saveKitchenStockReportToServer(report: KitchenStockReport): Promise<boolean> {
  try {
    const url = `${BASE_URL}/Tracker/api/sync.php?endpoint=${SYNC_ENDPOINT.KITCHEN_STOCK}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([report]),
    });
    
    return response.ok;
  } catch {
    return false;
  }
}

export async function saveSalesReportToServer(report: SalesReport): Promise<boolean> {
  try {
    const url = `${BASE_URL}/Tracker/api/sync.php?endpoint=${SYNC_ENDPOINT.SALES}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([report]),
    });
    
    return response.ok;
  } catch {
    return false;
  }
}

export async function getKitchenStockReportsFromServer(): Promise<KitchenStockReport[]> {
  try {
    const url = `${BASE_URL}/Tracker/api/get.php?endpoint=${SYNC_ENDPOINT.KITCHEN_STOCK}`;
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      return [];
    }
    
    return await response.json();
  } catch {
    return [];
  }
}

export async function getSalesReportsFromServer(): Promise<SalesReport[]> {
  try {
    const url = `${BASE_URL}/Tracker/api/get.php?endpoint=${SYNC_ENDPOINT.SALES}`;
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      return [];
    }
    
    return await response.json();
  } catch {
    return [];
  }
}

export async function saveKitchenStockReportLocally(report: KitchenStockReport): Promise<void> {
  try {
    const reports = await readReportsFromStorage<KitchenStockReport>(STORAGE_KEYS.KITCHEN_STOCK_REPORTS);
    
    const existingIndex = reports.findIndex(r => r.outlet === report.outlet && r.date === report.date);
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      const hasChanges =
        JSON.stringify(existing.products) !== JSON.stringify(report.products) ||
        (existing.deleted || false) !== (report.deleted || false);
      
      if (hasChanges) {
        reports[existingIndex] = report;
      } else {
        return;
      }
    } else {
      reports.push(report);
    }
    
    await writeReportsWithBestEffortCache(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, reports, 'kitchen reports');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to save kitchen stock report locally: ${reason}`);
  }
}

export async function saveSalesReportLocally(report: SalesReport): Promise<void> {
  try {
    const reports = await readReportsFromStorage<SalesReport>(STORAGE_KEYS.SALES_REPORTS);
    
    const existingIndex = reports.findIndex(r => r.outlet === report.outlet && r.date === report.date);
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      const hasChanges = 
        JSON.stringify(existing.salesData) !== JSON.stringify(report.salesData) ||
        JSON.stringify(existing.rawConsumption) !== JSON.stringify(report.rawConsumption) ||
        (existing.deleted || false) !== (report.deleted || false);
      
      if (hasChanges) {
        reports[existingIndex] = report;
      } else {
        return;
      }
    } else {
      reports.push(report);
    }
    
    await writeReportsWithBestEffortCache(STORAGE_KEYS.SALES_REPORTS, reports, 'sales reports');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to save sales report locally: ${reason}`);
  }
}

export async function getLocalKitchenStockReports(): Promise<KitchenStockReport[]> {
  try {
    return await readReportsFromStorage<KitchenStockReport>(STORAGE_KEYS.KITCHEN_STOCK_REPORTS);
  } catch {
    return [];
  }
}

export async function getLocalSalesReports(): Promise<SalesReport[]> {
  try {
    return await readReportsFromStorage<SalesReport>(STORAGE_KEYS.SALES_REPORTS);
  } catch {
    return [];
  }
}

export async function syncKitchenStockReports(): Promise<void> {
  try {
    console.log('\n[RECONCILIATION SYNC] Starting kitchen stock reports sync...');
    
    const [localReports, serverReports] = await Promise.all([
      getLocalKitchenStockReports(),
      getKitchenStockReportsFromServer(),
    ]);
    
    console.log('[RECONCILIATION SYNC] Local reports:', localReports.length);
    console.log('[RECONCILIATION SYNC] Server reports:', serverReports.length);
    
    // Log any conflicts before merging
    localReports.forEach(local => {
      const server = serverReports.find(sr => sr.outlet === local.outlet && sr.date === local.date);
      if (server && server.updatedAt !== local.updatedAt) {
        console.log(`[RECONCILIATION SYNC] Conflict for ${local.outlet} ${local.date}:`);
        console.log(`  Local updatedAt: ${new Date(local.updatedAt).toISOString()}`);
        console.log(`  Server updatedAt: ${new Date(server.updatedAt).toISOString()}`);
        console.log(`  Will keep: ${local.updatedAt > server.updatedAt ? 'LOCAL' : 'SERVER'}`);
      }
    });
    
    const merged = mergeReports(localReports, serverReports);
    console.log('[RECONCILIATION SYNC] Merged reports:', merged.length);
    
    await writeReportsWithBestEffortCache(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, merged, 'kitchen reports');
    
    const changedReports = merged.filter(r => {
      const serverReport = serverReports.find(sr => sr.outlet === r.outlet && sr.date === r.date);
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    console.log('[RECONCILIATION SYNC] Reports to push to server:', changedReports.length);
    
    if (changedReports.length > 0) {
      for (const report of changedReports) {
        console.log(`[RECONCILIATION SYNC] Pushing report to server: ${report.outlet} ${report.date}`);
        await saveKitchenStockReportToServer(report);
      }
    }
    
    console.log('[RECONCILIATION SYNC] Kitchen stock reports sync complete\n');
  } catch (error) {
    console.error('[RECONCILIATION SYNC] Failed to sync kitchen stock reports:', error);
  }
}

export async function syncSalesReports(): Promise<void> {
  try {
    console.log('\n[RECONCILIATION SYNC] Starting sales reports sync...');
    
    const [localReports, serverReports] = await Promise.all([
      getLocalSalesReports(),
      getSalesReportsFromServer(),
    ]);
    
    console.log('[RECONCILIATION SYNC] Local reports:', localReports.length);
    console.log('[RECONCILIATION SYNC] Server reports:', serverReports.length);
    
    // Log any conflicts before merging
    localReports.forEach(local => {
      const server = serverReports.find(sr => sr.outlet === local.outlet && sr.date === local.date);
      if (server && server.updatedAt !== local.updatedAt) {
        console.log(`[RECONCILIATION SYNC] Conflict for ${local.outlet} ${local.date}:`);
        console.log(`  Local updatedAt: ${new Date(local.updatedAt).toISOString()}`);
        console.log(`  Server updatedAt: ${new Date(server.updatedAt).toISOString()}`);
        console.log(`  Will keep: ${local.updatedAt > server.updatedAt ? 'LOCAL' : 'SERVER'}`);
        
        // Log sample sold data to see differences
        if (local.salesData?.length > 0 && server.salesData?.length > 0) {
          const localSample = local.salesData[0];
          const serverSample = server.salesData.find(sd => sd.productId === localSample.productId);
          if (serverSample) {
            console.log(`  Sample product ${localSample.productName}:`);
            console.log(`    Local: ${localSample.soldWhole}W/${localSample.soldSlices}S`);
            console.log(`    Server: ${serverSample.soldWhole}W/${serverSample.soldSlices}S`);
          }
        }
      }
    });
    
    const merged = mergeReports(localReports, serverReports);
    console.log('[RECONCILIATION SYNC] Merged reports:', merged.length);
    
    await writeReportsWithBestEffortCache(STORAGE_KEYS.SALES_REPORTS, merged, 'sales reports');
    
    const changedReports = merged.filter(r => {
      const serverReport = serverReports.find(sr => sr.outlet === r.outlet && sr.date === r.date);
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    console.log('[RECONCILIATION SYNC] Reports to push to server:', changedReports.length);
    
    if (changedReports.length > 0) {
      for (const report of changedReports) {
        console.log(`[RECONCILIATION SYNC] Pushing report to server: ${report.outlet} ${report.date}`);
        await saveSalesReportToServer(report);
      }
    }
    
    console.log('[RECONCILIATION SYNC] Sales reports sync complete\n');
  } catch (error) {
    console.error('[RECONCILIATION SYNC] Failed to sync sales reports:', error);
  }
}

function mergeReports<T extends { outlet: string; date: string; updatedAt: number; deleted?: boolean }>(
  local: T[],
  server: T[]
): T[] {
  const merged = new Map<string, T>();
  
  local.forEach(report => {
    const key = `${report.outlet}-${report.date}`;
    merged.set(key, report);
  });
  
  server.forEach(report => {
    const key = `${report.outlet}-${report.date}`;
    const existing = merged.get(key);
    
    if (!existing || report.updatedAt > existing.updatedAt) {
      merged.set(key, report);
    }
  });
  
  return Array.from(merged.values()).filter(r => !r.deleted);
}

export async function syncAllReconciliationData(): Promise<void> {
  await Promise.all([
    syncKitchenStockReports(),
    syncSalesReports(),
  ]);
  
  await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, Date.now().toString());
}

export async function getKitchenStockReportsByOutletAndDateRange(
  outlet: string,
  startDate: string,
  endDate: string
): Promise<KitchenStockReport[]> {
  try {
    const localReports = await getLocalKitchenStockReports();
    const localOutletReports = localReports.filter(r => r.outlet === outlet && !r.deleted);
    const oldestLocalDate = localOutletReports.length > 0
      ? localOutletReports.reduce((min, r) => (r.date < min ? r.date : min), localOutletReports[0].date)
      : null;

    const shouldFetchFromServer = !oldestLocalDate || oldestLocalDate > startDate;
    if (!shouldFetchFromServer) {
      return localOutletReports.filter(r => r.date >= startDate && r.date <= endDate);
    }

    const serverReports = await getKitchenStockReportsFromServer();
    const merged = mergeReports(localReports, serverReports);

    // Best-effort cache update; if storage quota is reached we still return server-backed data.
    await writeReportsWithBestEffortCache(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, merged, 'kitchen reports');

    return merged.filter(r => r.outlet === outlet && r.date >= startDate && r.date <= endDate && !r.deleted);
  } catch {
    const localReports = await getLocalKitchenStockReports();
    return localReports.filter(
      r => r.outlet === outlet && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  }
}

export async function getSalesReportsByOutletAndDateRange(
  outlet: string,
  startDate: string,
  endDate: string
): Promise<SalesReport[]> {
  try {
    const localReports = await getLocalSalesReports();
    const localOutletReports = localReports.filter(r => r.outlet === outlet && !r.deleted);
    const oldestLocalDate = localOutletReports.length > 0
      ? localOutletReports.reduce((min, r) => (r.date < min ? r.date : min), localOutletReports[0].date)
      : null;

    const shouldFetchFromServer = !oldestLocalDate || oldestLocalDate > startDate;
    if (!shouldFetchFromServer) {
      return localOutletReports.filter(r => r.date >= startDate && r.date <= endDate);
    }

    const serverReports = await getSalesReportsFromServer();
    const merged = mergeReports(localReports, serverReports);

    // Best-effort cache update; if storage quota is reached we still return server-backed data.
    await writeReportsWithBestEffortCache(STORAGE_KEYS.SALES_REPORTS, merged, 'sales reports');

    return merged.filter(r => r.outlet === outlet && r.date >= startDate && r.date <= endDate && !r.deleted);
  } catch {
    const localReports = await getLocalSalesReports();
    return localReports.filter(
      r => r.outlet === outlet && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  }
}
