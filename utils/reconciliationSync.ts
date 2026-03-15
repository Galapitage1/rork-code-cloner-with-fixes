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
  serviceChargeAmount?: number;
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
  PENDING_KITCHEN_STOCK_REPORTS: '@reconciliation_pending_kitchen_stock_reports',
  PENDING_SALES_REPORTS: '@reconciliation_pending_sales_reports',
  LAST_SYNC: '@reconciliation_last_sync',
};

const FALLBACK_BASE_URL = 'https://tracker.tecclk.com';
const SYNC_ENDPOINT = {
  KITCHEN_STOCK: 'reconciliation_kitchen_stock',
  SALES: 'reconciliation_sales',
};

function sanitizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_RORK_API_BASE_URL) {
    const envBase = sanitizeBaseUrl(process.env.EXPO_PUBLIC_RORK_API_BASE_URL);
    if (envBase) return envBase;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const originBase = sanitizeBaseUrl(window.location.origin);
    if (originBase) return originBase;
  }

  return FALLBACK_BASE_URL;
}

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

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

function normalizeOutletName(outlet: string | null | undefined): string {
  return String(outlet || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function reportKey(report: { outlet: string; date: string }): string {
  return `${normalizeOutletName(report.outlet)}__${report.date}`;
}

function dedupeLatestReports<T extends { outlet: string; date: string; updatedAt: number }>(reports: T[]): T[] {
  const latest = new Map<string, T>();
  for (const report of reports) {
    const key = reportKey(report);
    const existing = latest.get(key);
    if (!existing || (report.updatedAt || 0) >= (existing.updatedAt || 0)) {
      latest.set(key, report);
    }
  }
  return Array.from(latest.values());
}

async function writePendingReports<T extends { outlet: string; date: string; updatedAt: number }>(
  key: string,
  reports: T[],
): Promise<void> {
  const deduped = sortReportsForCache(dedupeLatestReports(reports));
  try {
    await AsyncStorage.setItem(key, JSON.stringify(deduped));
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.warn(`[RECONCILIATION SYNC] Failed to write pending queue ${key}:`, error);
      return;
    }

    console.warn(`[RECONCILIATION SYNC] Pending queue ${key} hit storage quota. Trimming local reconciliation caches and retrying...`);
    await trimLocalReconciliationCachesForPendingQueue();

    try {
      await AsyncStorage.setItem(key, JSON.stringify(deduped));
      console.warn(`[RECONCILIATION SYNC] Pending queue ${key} write succeeded after cache trim`);
      return;
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) {
        console.warn(`[RECONCILIATION SYNC] Failed to write pending queue ${key} after trim:`, retryError);
        return;
      }
    }

    // Last-resort: keep only a tiny pending subset so at least latest unsynced entries survive.
    const tiny = deduped.slice(0, 10);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(tiny));
      console.warn(`[RECONCILIATION SYNC] Pending queue ${key} reduced to tiny fallback (${tiny.length} items) due to quota`);
    } catch (tinyError) {
      console.warn(`[RECONCILIATION SYNC] Could not persist pending queue ${key} even after aggressive fallback:`, tinyError);
    }
  }
}

async function queuePendingReport<T extends { outlet: string; date: string; updatedAt: number }>(
  key: string,
  report: T,
): Promise<void> {
  const pending = await readReportsFromStorage<T>(key);
  const merged = dedupeLatestReports([...pending, report]);
  await writePendingReports(key, merged);
}

async function removePendingReportByVersion<T extends { outlet: string; date: string; updatedAt: number }>(
  key: string,
  report: T,
): Promise<void> {
  const pending = await readReportsFromStorage<T>(key);
  const targetOutlet = normalizeOutletName(report.outlet);
  const filtered = pending.filter((p) => {
    if (normalizeOutletName(p.outlet) !== targetOutlet || p.date !== report.date) return true;
    return (p.updatedAt || 0) > (report.updatedAt || 0);
  });
  await writePendingReports(key, filtered);
}

function pruneStalePendingReports<T extends { outlet: string; date: string; updatedAt: number }>(
  pending: T[],
  latestKnown: T[],
): T[] {
  const latestMap = new Map<string, T>();
  latestKnown.forEach((report) => latestMap.set(reportKey(report), report));
  return pending.filter((pendingReport) => {
    const latest = latestMap.get(reportKey(pendingReport));
    if (!latest) return true;
    return (pendingReport.updatedAt || 0) >= (latest.updatedAt || 0);
  });
}

function prunePendingAlreadySyncedToServer<T extends { outlet: string; date: string; updatedAt: number }>(
  pending: T[],
  serverReports: T[],
): T[] {
  const latestServerByKey = new Map<string, number>();
  for (const report of serverReports) {
    const key = reportKey(report);
    const updatedAt = report.updatedAt || 0;
    const existing = latestServerByKey.get(key);
    if (existing === undefined || updatedAt > existing) {
      latestServerByKey.set(key, updatedAt);
    }
  }

  return pending.filter((pendingReport) => {
    const serverUpdatedAt = latestServerByKey.get(reportKey(pendingReport));
    if (serverUpdatedAt === undefined) return true;
    return (pendingReport.updatedAt || 0) > serverUpdatedAt;
  });
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

function compactReportsWithoutHistoryLoss<T extends { outlet: string; date: string; updatedAt: number; deleted?: boolean }>(
  reports: T[],
): T[] {
  // Keep full active history. Only remove soft-deleted rows and duplicate outlet+date versions.
  const active = reports.filter((report) => !report.deleted);
  return sortReportsForCache(dedupeLatestReports(active));
}

async function trimLocalReconciliationCachesForPendingQueue(): Promise<void> {
  try {
    const [salesReports, kitchenReports] = await Promise.all([
      readReportsFromStorage<SalesReport>(STORAGE_KEYS.SALES_REPORTS),
      readReportsFromStorage<KitchenStockReport>(STORAGE_KEYS.KITCHEN_STOCK_REPORTS),
    ]);

    const trimmedSales = compactReportsWithoutHistoryLoss(salesReports);
    const trimmedKitchen = compactReportsWithoutHistoryLoss(kitchenReports);

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SALES_REPORTS, JSON.stringify(trimmedSales));
    } catch (salesTrimError) {
      console.warn('[RECONCILIATION SYNC] Failed to compact sales reports cache for pending queue write', salesTrimError);
    }

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, JSON.stringify(trimmedKitchen));
    } catch (kitchenTrimError) {
      console.warn('[RECONCILIATION SYNC] Failed to compact kitchen reports cache for pending queue write', kitchenTrimError);
    }
  } catch (error) {
    console.warn('[RECONCILIATION SYNC] Failed to trim reconciliation caches for pending queue write:', error);
  }
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

    console.warn(`[RECONCILIATION SYNC] ${label} exceeded storage quota, compacting without age-based history deletion`);
  }

  const compacted = compactReportsWithoutHistoryLoss(sortedReports as any);
  if (compacted.length !== sortedReports.length) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(compacted));
      console.warn(`[RECONCILIATION SYNC] Cached compact ${label} (${compacted.length}/${sortedReports.length} records)`);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }
    }
  }

  // Do not age-trim or cap historical reconciliation data.
  // If full cache cannot be persisted without deleting history, keep existing cache and rely on server reads.
  console.warn(`[RECONCILIATION SYNC] Could not cache full ${label} without deleting history; keeping existing local cache and relying on server fallback`);
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

async function postReportWithRetries(
  endpoint: string,
  payload: unknown,
  label: string,
  attempts = 3,
): Promise<boolean> {
  const url = buildApiUrl(`/Tracker/api/sync.php?endpoint=${endpoint}`);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        30000,
      );

      if (response.ok) {
        return true;
      }

      console.warn(`[RECONCILIATION SYNC] ${label} upload failed (attempt ${attempt}/${attempts}) with status ${response.status}`);
    } catch (error) {
      console.warn(`[RECONCILIATION SYNC] ${label} upload error (attempt ${attempt}/${attempts}):`, error);
    }

    if (attempt < attempts) {
      const waitMs = attempt * 1200;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  return false;
}

export async function saveKitchenStockReportToServer(report: KitchenStockReport): Promise<boolean> {
  return postReportWithRetries(SYNC_ENDPOINT.KITCHEN_STOCK, [report], 'Kitchen report');
}

export async function saveSalesReportToServer(report: SalesReport): Promise<boolean> {
  return postReportWithRetries(SYNC_ENDPOINT.SALES, [report], 'Sales report');
}

export async function queueKitchenStockReportForRetry(report: KitchenStockReport): Promise<void> {
  await queuePendingReport<KitchenStockReport>(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS, report);
}

export async function queueSalesReportForRetry(report: SalesReport): Promise<void> {
  await queuePendingReport<SalesReport>(STORAGE_KEYS.PENDING_SALES_REPORTS, report);
}

export async function getPendingReconciliationUploadCounts(): Promise<{
  sales: number;
  kitchen: number;
  total: number;
}> {
  try {
    const [pendingSales, pendingKitchen] = await Promise.all([
      readReportsFromStorage<SalesReport>(STORAGE_KEYS.PENDING_SALES_REPORTS),
      readReportsFromStorage<KitchenStockReport>(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS),
    ]);

    const sales = dedupeLatestReports(pendingSales).length;
    const kitchen = dedupeLatestReports(pendingKitchen).length;
    return { sales, kitchen, total: sales + kitchen };
  } catch {
    return { sales: 0, kitchen: 0, total: 0 };
  }
}

export async function retryPendingReconciliationUploadsNow(): Promise<{
  before: { sales: number; kitchen: number; total: number };
  after: { sales: number; kitchen: number; total: number };
}> {
  const before = await getPendingReconciliationUploadCounts();
  await flushPendingReconciliationUploads();
  const after = await getPendingReconciliationUploadCounts();
  return { before, after };
}

export async function flushPendingReconciliationUploads(): Promise<{
  salesAttempted: number;
  salesUploaded: number;
  kitchenAttempted: number;
  kitchenUploaded: number;
}> {
  const [pendingSalesRaw, pendingKitchenRaw] = await Promise.all([
    readReportsFromStorage<SalesReport>(STORAGE_KEYS.PENDING_SALES_REPORTS),
    readReportsFromStorage<KitchenStockReport>(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS),
  ]);

  const pendingSales = dedupeLatestReports(pendingSalesRaw).sort(
    (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0)
  );
  const pendingKitchen = dedupeLatestReports(pendingKitchenRaw).sort(
    (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0)
  );

  let salesUploaded = 0;
  for (const report of pendingSales) {
    const ok = await saveSalesReportToServer(report);
    if (ok) {
      salesUploaded += 1;
      await removePendingReportByVersion(STORAGE_KEYS.PENDING_SALES_REPORTS, report);
    }
  }

  let kitchenUploaded = 0;
  for (const report of pendingKitchen) {
    const ok = await saveKitchenStockReportToServer(report);
    if (ok) {
      kitchenUploaded += 1;
      await removePendingReportByVersion(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS, report);
    }
  }

  return {
    salesAttempted: pendingSales.length,
    salesUploaded,
    kitchenAttempted: pendingKitchen.length,
    kitchenUploaded,
  };
}

export async function getKitchenStockReportsFromServer(minDays?: number): Promise<KitchenStockReport[]> {
  try {
    const minDaysParam = minDays ? `&minDays=${minDays}` : '';
    const url = buildApiUrl(`/Tracker/api/get.php?endpoint=${SYNC_ENDPOINT.KITCHEN_STOCK}${minDaysParam}`);
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

export async function getSalesReportsFromServer(minDays?: number): Promise<SalesReport[]> {
  try {
    const minDaysParam = minDays ? `&minDays=${minDays}` : '';
    const url = buildApiUrl(`/Tracker/api/get.php?endpoint=${SYNC_ENDPOINT.SALES}${minDaysParam}`);
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
    
    const targetOutlet = normalizeOutletName(report.outlet);
    const existingIndex = reports.findIndex(
      r => normalizeOutletName(r.outlet) === targetOutlet && r.date === report.date
    );
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      if ((existing.updatedAt || 0) > (report.updatedAt || 0)) {
        // Do not overwrite a newer local record with an older retry/import.
        return;
      }
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
    
    const targetOutlet = normalizeOutletName(report.outlet);
    const existingIndex = reports.findIndex(
      r => normalizeOutletName(r.outlet) === targetOutlet && r.date === report.date
    );
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      if ((existing.updatedAt || 0) > (report.updatedAt || 0)) {
        // Do not overwrite a newer local record with an older retry/import.
        return;
      }
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

export async function syncKitchenStockReports(minDays?: number): Promise<void> {
  try {
    console.log('\n[RECONCILIATION SYNC] Starting kitchen stock reports sync...');
    
    const [localReports, serverReports, pendingReports] = await Promise.all([
      getLocalKitchenStockReports(),
      getKitchenStockReportsFromServer(minDays),
      readReportsFromStorage<KitchenStockReport>(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS),
    ]);
    
    console.log('[RECONCILIATION SYNC] Local reports:', localReports.length);
    console.log('[RECONCILIATION SYNC] Server reports:', serverReports.length);
    const pendingAfterServerPrune = prunePendingAlreadySyncedToServer(pendingReports, serverReports);
    if (pendingAfterServerPrune.length !== pendingReports.length) {
      await writePendingReports(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS, pendingAfterServerPrune);
    }
    console.log('[RECONCILIATION SYNC] Pending reports:', pendingAfterServerPrune.length);
    
    // Log any conflicts before merging
    localReports.forEach(local => {
      const localOutlet = normalizeOutletName(local.outlet);
      const server = serverReports.find(
        sr => normalizeOutletName(sr.outlet) === localOutlet && sr.date === local.date
      );
      if (server && server.updatedAt !== local.updatedAt) {
        console.log(`[RECONCILIATION SYNC] Conflict for ${local.outlet} ${local.date}:`);
        console.log(`  Local updatedAt: ${new Date(local.updatedAt).toISOString()}`);
        console.log(`  Server updatedAt: ${new Date(server.updatedAt).toISOString()}`);
        console.log(`  Will keep: ${local.updatedAt > server.updatedAt ? 'LOCAL' : 'SERVER'}`);
      }
    });
    
    const localPlusPending = mergeReports(localReports, pendingAfterServerPrune);
    const merged = mergeReports(localPlusPending, serverReports);
    console.log('[RECONCILIATION SYNC] Merged reports:', merged.length);

    const prunedPending = pruneStalePendingReports(pendingAfterServerPrune, merged);
    if (prunedPending.length !== pendingAfterServerPrune.length) {
      await writePendingReports(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS, prunedPending);
    }
    
    await writeReportsWithBestEffortCache(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, merged, 'kitchen reports');
    
    const changedReports = merged.filter(r => {
      const reportOutlet = normalizeOutletName(r.outlet);
      const serverReport = serverReports.find(
        sr => normalizeOutletName(sr.outlet) === reportOutlet && sr.date === r.date
      );
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    console.log('[RECONCILIATION SYNC] Reports to push to server:', changedReports.length);
    
    if (changedReports.length > 0) {
      for (const report of changedReports) {
        console.log(`[RECONCILIATION SYNC] Pushing report to server: ${report.outlet} ${report.date}`);
        const ok = await saveKitchenStockReportToServer(report);
        if (ok) {
          await removePendingReportByVersion(STORAGE_KEYS.PENDING_KITCHEN_STOCK_REPORTS, report);
        } else {
          await queueKitchenStockReportForRetry(report);
        }
      }
    }
    
    console.log('[RECONCILIATION SYNC] Kitchen stock reports sync complete\n');
  } catch (error) {
    console.error('[RECONCILIATION SYNC] Failed to sync kitchen stock reports:', error);
  }
}

export async function syncSalesReports(minDays?: number): Promise<void> {
  try {
    console.log('\n[RECONCILIATION SYNC] Starting sales reports sync...');
    
    const [localReports, serverReports, pendingReports] = await Promise.all([
      getLocalSalesReports(),
      getSalesReportsFromServer(minDays),
      readReportsFromStorage<SalesReport>(STORAGE_KEYS.PENDING_SALES_REPORTS),
    ]);
    
    console.log('[RECONCILIATION SYNC] Local reports:', localReports.length);
    console.log('[RECONCILIATION SYNC] Server reports:', serverReports.length);
    const pendingAfterServerPrune = prunePendingAlreadySyncedToServer(pendingReports, serverReports);
    if (pendingAfterServerPrune.length !== pendingReports.length) {
      await writePendingReports(STORAGE_KEYS.PENDING_SALES_REPORTS, pendingAfterServerPrune);
    }
    console.log('[RECONCILIATION SYNC] Pending reports:', pendingAfterServerPrune.length);
    
    // Log any conflicts before merging
    const localPlusPending = mergeReports(localReports, pendingAfterServerPrune);

    localPlusPending.forEach(local => {
      const localOutlet = normalizeOutletName(local.outlet);
      const server = serverReports.find(
        sr => normalizeOutletName(sr.outlet) === localOutlet && sr.date === local.date
      );
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
    
    const merged = mergeReports(localPlusPending, serverReports);
    console.log('[RECONCILIATION SYNC] Merged reports:', merged.length);

    const prunedPending = pruneStalePendingReports(pendingAfterServerPrune, merged);
    if (prunedPending.length !== pendingAfterServerPrune.length) {
      await writePendingReports(STORAGE_KEYS.PENDING_SALES_REPORTS, prunedPending);
    }
    
    await writeReportsWithBestEffortCache(STORAGE_KEYS.SALES_REPORTS, merged, 'sales reports');
    
    const changedReports = merged.filter(r => {
      const reportOutlet = normalizeOutletName(r.outlet);
      const serverReport = serverReports.find(
        sr => normalizeOutletName(sr.outlet) === reportOutlet && sr.date === r.date
      );
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    console.log('[RECONCILIATION SYNC] Reports to push to server:', changedReports.length);
    
    if (changedReports.length > 0) {
      for (const report of changedReports) {
        console.log(`[RECONCILIATION SYNC] Pushing report to server: ${report.outlet} ${report.date}`);
        const ok = await saveSalesReportToServer(report);
        if (ok) {
          await removePendingReportByVersion(STORAGE_KEYS.PENDING_SALES_REPORTS, report);
        } else {
          await queueSalesReportForRetry(report);
        }
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
    const key = `${normalizeOutletName(report.outlet)}-${report.date}`;
    merged.set(key, report);
  });
  
  server.forEach(report => {
    const key = `${normalizeOutletName(report.outlet)}-${report.date}`;
    const existing = merged.get(key);
    
    if (!existing || report.updatedAt > existing.updatedAt) {
      merged.set(key, report);
    }
  });
  
  return Array.from(merged.values()).filter(r => !r.deleted);
}

export async function syncAllReconciliationData(minDays?: number): Promise<void> {
  await Promise.all([
    syncKitchenStockReports(minDays),
    syncSalesReports(minDays),
  ]);
  
  await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, Date.now().toString());
}

export async function getKitchenStockReportsByOutletAndDateRange(
  outlet: string,
  startDate: string,
  endDate: string,
  options?: {
    allowServerFetch?: boolean;
  }
): Promise<KitchenStockReport[]> {
  try {
    const localReports = dedupeLatestReports(await getLocalKitchenStockReports());
    const outletKey = normalizeOutletName(outlet);
    const localOutletReports = localReports.filter(
      r => normalizeOutletName(r.outlet) === outletKey && !r.deleted
    );
    const oldestLocalDate = localOutletReports.length > 0
      ? localOutletReports.reduce((min, r) => (r.date < min ? r.date : min), localOutletReports[0].date)
      : null;

    const allowServerFetch = options?.allowServerFetch !== false;
    const shouldFetchFromServer = allowServerFetch && (!oldestLocalDate || oldestLocalDate > startDate);
    if (!shouldFetchFromServer) {
      return localOutletReports.filter(r => r.date >= startDate && r.date <= endDate);
    }

    const serverReports = await getKitchenStockReportsFromServer();
    const merged = mergeReports(localReports, serverReports);

    // Best-effort cache update; if storage quota is reached we still return server-backed data.
    await writeReportsWithBestEffortCache(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, merged, 'kitchen reports');

    return merged.filter(
      r => normalizeOutletName(r.outlet) === outletKey && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  } catch {
    const localReports = dedupeLatestReports(await getLocalKitchenStockReports());
    return localReports.filter(
      r => normalizeOutletName(r.outlet) === normalizeOutletName(outlet) && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  }
}

export async function getSalesReportsByOutletAndDateRange(
  outlet: string,
  startDate: string,
  endDate: string,
  options?: {
    allowServerFetch?: boolean;
  }
): Promise<SalesReport[]> {
  try {
    const localReports = dedupeLatestReports(await getLocalSalesReports());
    const outletKey = normalizeOutletName(outlet);
    const localOutletReports = localReports.filter(
      r => normalizeOutletName(r.outlet) === outletKey && !r.deleted
    );
    const oldestLocalDate = localOutletReports.length > 0
      ? localOutletReports.reduce((min, r) => (r.date < min ? r.date : min), localOutletReports[0].date)
      : null;

    const allowServerFetch = options?.allowServerFetch !== false;
    const shouldFetchFromServer = allowServerFetch && (!oldestLocalDate || oldestLocalDate > startDate);
    if (!shouldFetchFromServer) {
      return localOutletReports.filter(r => r.date >= startDate && r.date <= endDate);
    }

    const serverReports = await getSalesReportsFromServer();
    const merged = mergeReports(localReports, serverReports);

    // Best-effort cache update; if storage quota is reached we still return server-backed data.
    await writeReportsWithBestEffortCache(STORAGE_KEYS.SALES_REPORTS, merged, 'sales reports');

    return merged.filter(
      r => normalizeOutletName(r.outlet) === outletKey && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  } catch {
    const localReports = dedupeLatestReports(await getLocalSalesReports());
    return localReports.filter(
      r => normalizeOutletName(r.outlet) === normalizeOutletName(outlet) && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  }
}
