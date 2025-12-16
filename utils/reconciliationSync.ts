import AsyncStorage from '@react-native-async-storage/async-storage';

export type KitchenStockReport = {
  id: string;
  outlet: string;
  date: string;
  timestamp: number;
  reconsolidatedAt: string;
  products: Array<{
    productId: string;
    productName: string;
    unit: string;
    quantityWhole: number;
    quantitySlices: number;
  }>;
  updatedAt: number;
  deleted?: boolean;
};

export type SalesReport = {
  id: string;
  outlet: string;
  date: string;
  timestamp: number;
  reconsolidatedAt: string;
  salesData: Array<{
    productId: string;
    productName: string;
    unit: string;
    soldWhole: number;
    soldSlices: number;
  }>;
  rawConsumption: Array<{
    rawProductId: string;
    rawName: string;
    rawUnit: string;
    consumedWhole: number;
    consumedSlices: number;
  }>;
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
    console.log('[ReconciliationSync] Saving kitchen stock report to server:', report.outlet, report.date);
    
    const url = `${BASE_URL}/Tracker/api/sync.php?endpoint=${SYNC_ENDPOINT.KITCHEN_STOCK}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([report]),
    });
    
    if (!response.ok) {
      console.error('[ReconciliationSync] Failed to save kitchen stock report:', response.status);
      return false;
    }
    
    console.log('[ReconciliationSync] ✓ Kitchen stock report saved to server');
    return true;
  } catch (error) {
    console.error('[ReconciliationSync] Error saving kitchen stock report:', error);
    return false;
  }
}

export async function saveSalesReportToServer(report: SalesReport): Promise<boolean> {
  try {
    console.log('[ReconciliationSync] Saving sales report to server:', report.outlet, report.date);
    
    const url = `${BASE_URL}/Tracker/api/sync.php?endpoint=${SYNC_ENDPOINT.SALES}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([report]),
    });
    
    if (!response.ok) {
      console.error('[ReconciliationSync] Failed to save sales report:', response.status);
      return false;
    }
    
    console.log('[ReconciliationSync] ✓ Sales report saved to server');
    return true;
  } catch (error) {
    console.error('[ReconciliationSync] Error saving sales report:', error);
    return false;
  }
}

export async function getKitchenStockReportsFromServer(): Promise<KitchenStockReport[]> {
  try {
    console.log('[ReconciliationSync] Fetching kitchen stock reports from server...');
    
    const url = `${BASE_URL}/Tracker/api/get.php?endpoint=${SYNC_ENDPOINT.KITCHEN_STOCK}`;
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error('[ReconciliationSync] Failed to fetch kitchen stock reports:', response.status);
      return [];
    }
    
    const reports = await response.json();
    console.log('[ReconciliationSync] ✓ Fetched', reports.length, 'kitchen stock reports from server');
    return reports;
  } catch (error) {
    console.error('[ReconciliationSync] Error fetching kitchen stock reports:', error);
    return [];
  }
}

export async function getSalesReportsFromServer(): Promise<SalesReport[]> {
  try {
    console.log('[ReconciliationSync] Fetching sales reports from server...');
    
    const url = `${BASE_URL}/Tracker/api/get.php?endpoint=${SYNC_ENDPOINT.SALES}`;
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error('[ReconciliationSync] Failed to fetch sales reports:', response.status);
      return [];
    }
    
    const reports = await response.json();
    console.log('[ReconciliationSync] ✓ Fetched', reports.length, 'sales reports from server');
    return reports;
  } catch (error) {
    console.error('[ReconciliationSync] Error fetching sales reports:', error);
    return [];
  }
}

export async function saveKitchenStockReportLocally(report: KitchenStockReport): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS);
    const reports: KitchenStockReport[] = stored ? JSON.parse(stored) : [];
    
    const existingIndex = reports.findIndex(r => r.outlet === report.outlet && r.date === report.date);
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      const hasChanges = JSON.stringify(existing.products) !== JSON.stringify(report.products);
      
      if (hasChanges) {
        console.log('[ReconciliationSync] Kitchen stock report has changes, updating locally');
        reports[existingIndex] = report;
      } else {
        console.log('[ReconciliationSync] Kitchen stock report unchanged, skipping local update');
        return;
      }
    } else {
      console.log('[ReconciliationSync] New kitchen stock report, saving locally');
      reports.push(report);
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, JSON.stringify(reports));
    console.log('[ReconciliationSync] ✓ Kitchen stock report saved locally');
  } catch (error) {
    console.error('[ReconciliationSync] Error saving kitchen stock report locally:', error);
    throw error;
  }
}

export async function saveSalesReportLocally(report: SalesReport): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.SALES_REPORTS);
    const reports: SalesReport[] = stored ? JSON.parse(stored) : [];
    
    const existingIndex = reports.findIndex(r => r.outlet === report.outlet && r.date === report.date);
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      const hasChanges = 
        JSON.stringify(existing.salesData) !== JSON.stringify(report.salesData) ||
        JSON.stringify(existing.rawConsumption) !== JSON.stringify(report.rawConsumption);
      
      if (hasChanges) {
        console.log('[ReconciliationSync] Sales report has changes, updating locally');
        reports[existingIndex] = report;
      } else {
        console.log('[ReconciliationSync] Sales report unchanged, skipping local update');
        return;
      }
    } else {
      console.log('[ReconciliationSync] New sales report, saving locally');
      reports.push(report);
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.SALES_REPORTS, JSON.stringify(reports));
    console.log('[ReconciliationSync] ✓ Sales report saved locally');
  } catch (error) {
    console.error('[ReconciliationSync] Error saving sales report locally:', error);
    throw error;
  }
}

export async function getLocalKitchenStockReports(): Promise<KitchenStockReport[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('[ReconciliationSync] Error getting local kitchen stock reports:', error);
    return [];
  }
}

export async function getLocalSalesReports(): Promise<SalesReport[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.SALES_REPORTS);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('[ReconciliationSync] Error getting local sales reports:', error);
    return [];
  }
}

export async function syncKitchenStockReports(): Promise<void> {
  try {
    console.log('[ReconciliationSync] ========== SYNCING KITCHEN STOCK REPORTS ==========');
    
    const [localReports, serverReports] = await Promise.all([
      getLocalKitchenStockReports(),
      getKitchenStockReportsFromServer(),
    ]);
    
    console.log('[ReconciliationSync] Local:', localReports.length, 'Server:', serverReports.length);
    
    const merged = mergeReports(localReports, serverReports);
    console.log('[ReconciliationSync] Merged:', merged.length);
    
    await AsyncStorage.setItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, JSON.stringify(merged));
    
    const changedReports = merged.filter(r => {
      const serverReport = serverReports.find(sr => sr.outlet === r.outlet && sr.date === r.date);
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    if (changedReports.length > 0) {
      console.log('[ReconciliationSync] Pushing', changedReports.length, 'changed kitchen stock reports to server');
      for (const report of changedReports) {
        await saveKitchenStockReportToServer(report);
      }
    }
    
    console.log('[ReconciliationSync] ✓ Kitchen stock reports synced');
  } catch (error) {
    console.error('[ReconciliationSync] Error syncing kitchen stock reports:', error);
  }
}

export async function syncSalesReports(): Promise<void> {
  try {
    console.log('[ReconciliationSync] ========== SYNCING SALES REPORTS ==========');
    
    const [localReports, serverReports] = await Promise.all([
      getLocalSalesReports(),
      getSalesReportsFromServer(),
    ]);
    
    console.log('[ReconciliationSync] Local:', localReports.length, 'Server:', serverReports.length);
    
    const merged = mergeReports(localReports, serverReports);
    console.log('[ReconciliationSync] Merged:', merged.length);
    
    await AsyncStorage.setItem(STORAGE_KEYS.SALES_REPORTS, JSON.stringify(merged));
    
    const changedReports = merged.filter(r => {
      const serverReport = serverReports.find(sr => sr.outlet === r.outlet && sr.date === r.date);
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    if (changedReports.length > 0) {
      console.log('[ReconciliationSync] Pushing', changedReports.length, 'changed sales reports to server');
      for (const report of changedReports) {
        await saveSalesReportToServer(report);
      }
    }
    
    console.log('[ReconciliationSync] ✓ Sales reports synced');
  } catch (error) {
    console.error('[ReconciliationSync] Error syncing sales reports:', error);
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
  console.log('[ReconciliationSync] ========== FULL RECONCILIATION SYNC START ==========');
  await Promise.all([
    syncKitchenStockReports(),
    syncSalesReports(),
  ]);
  
  await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, Date.now().toString());
  console.log('[ReconciliationSync] ========== FULL RECONCILIATION SYNC COMPLETE ==========');
}
