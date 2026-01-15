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
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS);
    const reports: KitchenStockReport[] = stored ? JSON.parse(stored) : [];
    
    const existingIndex = reports.findIndex(r => r.outlet === report.outlet && r.date === report.date);
    
    if (existingIndex >= 0) {
      const existing = reports[existingIndex];
      const hasChanges = JSON.stringify(existing.products) !== JSON.stringify(report.products);
      
      if (hasChanges) {
        reports[existingIndex] = report;
      } else {
        return;
      }
    } else {
      reports.push(report);
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, JSON.stringify(reports));
  } catch {
    throw new Error('Failed to save kitchen stock report locally');
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
        reports[existingIndex] = report;
      } else {
        return;
      }
    } else {
      reports.push(report);
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.SALES_REPORTS, JSON.stringify(reports));
  } catch {
    throw new Error('Failed to save sales report locally');
  }
}

export async function getLocalKitchenStockReports(): Promise<KitchenStockReport[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function getLocalSalesReports(): Promise<SalesReport[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.SALES_REPORTS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function syncKitchenStockReports(): Promise<void> {
  try {
    const [localReports, serverReports] = await Promise.all([
      getLocalKitchenStockReports(),
      getKitchenStockReportsFromServer(),
    ]);
    
    const merged = mergeReports(localReports, serverReports);
    
    await AsyncStorage.setItem(STORAGE_KEYS.KITCHEN_STOCK_REPORTS, JSON.stringify(merged));
    
    const changedReports = merged.filter(r => {
      const serverReport = serverReports.find(sr => sr.outlet === r.outlet && sr.date === r.date);
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    if (changedReports.length > 0) {
      for (const report of changedReports) {
        await saveKitchenStockReportToServer(report);
      }
    }
  } catch {
  }
}

export async function syncSalesReports(): Promise<void> {
  try {
    const [localReports, serverReports] = await Promise.all([
      getLocalSalesReports(),
      getSalesReportsFromServer(),
    ]);
    
    const merged = mergeReports(localReports, serverReports);
    
    await AsyncStorage.setItem(STORAGE_KEYS.SALES_REPORTS, JSON.stringify(merged));
    
    const changedReports = merged.filter(r => {
      const serverReport = serverReports.find(sr => sr.outlet === r.outlet && sr.date === r.date);
      return !serverReport || r.updatedAt > (serverReport.updatedAt || 0);
    });
    
    if (changedReports.length > 0) {
      for (const report of changedReports) {
        await saveSalesReportToServer(report);
      }
    }
  } catch {
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
    const allReports = await getLocalKitchenStockReports();
    return allReports.filter(
      r => r.outlet === outlet && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  } catch {
    return [];
  }
}

export async function getSalesReportsByOutletAndDateRange(
  outlet: string,
  startDate: string,
  endDate: string
): Promise<SalesReport[]> {
  try {
    const allReports = await getLocalSalesReports();
    return allReports.filter(
      r => r.outlet === outlet && r.date >= startDate && r.date <= endDate && !r.deleted
    );
  } catch {
    return [];
  }
}
