import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFromServer } from './directSync';
import { syncAllReconciliationData } from './reconciliationSync';

type RestoreConfig = {
  storageKey: string;
  includeDeleted: boolean;
  minDays?: number;
  priority?: boolean;
};

const RESTORE_CONFIG: Record<string, RestoreConfig> = {
  users: { storageKey: '@stock_app_users', includeDeleted: true, minDays: 3650, priority: true },
  outlets: { storageKey: '@stock_app_outlets', includeDeleted: true, minDays: 3650, priority: true },
  products: { storageKey: '@stock_app_products', includeDeleted: true, minDays: 3650, priority: true },
  productConversions: { storageKey: '@stock_app_product_conversions', includeDeleted: true, minDays: 3650 },
  customers: { storageKey: '@stock_app_customers', includeDeleted: true, minDays: 3650 },
  recipes: { storageKey: '@stock_app_recipes', includeDeleted: true, minDays: 3650 },
  linkedProducts: { storageKey: '@stock_app_linked_products', includeDeleted: true, minDays: 3650 },
  storeProducts: { storageKey: '@stock_app_store_products', includeDeleted: true, minDays: 3650 },
  suppliers: { storageKey: '@stock_app_suppliers', includeDeleted: true, minDays: 3650 },
  stockChecks: { storageKey: '@stock_app_stock_checks', includeDeleted: true, minDays: 45 },
  requests: { storageKey: '@stock_app_requests', includeDeleted: true, minDays: 45 },
  inventoryStocks: { storageKey: '@stock_app_inventory_stocks', includeDeleted: true, minDays: 3650 },
  salesDeductions: { storageKey: '@stock_app_sales_deductions', includeDeleted: true, minDays: 45 },
  reconcileHistory: { storageKey: '@stock_app_reconcile_history', includeDeleted: true, minDays: 45 },
  liveInventorySnapshots: { storageKey: '@stock_app_live_inventory_snapshots', includeDeleted: true, minDays: 45 },
  orders: { storageKey: '@stock_app_orders', includeDeleted: true, minDays: 45 },
  grns: { storageKey: '@stock_app_grns', includeDeleted: true, minDays: 45 },
  productionRequests: { storageKey: '@stock_app_production_requests', includeDeleted: true, minDays: 45 },
  approvedProductions: { storageKey: '@stock_app_approved_productions', includeDeleted: true, minDays: 45 },
  activityLogs: { storageKey: '@stock_app_activity_logs', includeDeleted: true, minDays: 45 },
  leave_types: { storageKey: '@leave_types', includeDeleted: true, minDays: 3650 },
  leave_requests: { storageKey: '@leave_requests', includeDeleted: true, minDays: 3650 },
  staff_leave_balances: { storageKey: '@staff_leave_balances', includeDeleted: true, minDays: 3650 },
  hr_staff_members: { storageKey: '@hr_staff_members', includeDeleted: true, minDays: 3650 },
  hr_attendance_imports: { storageKey: '@hr_attendance_imports', includeDeleted: true, minDays: 45 },
  hr_payroll_month_sheets: { storageKey: '@hr_payroll_month_sheets', includeDeleted: true, minDays: 3650 },
  hr_loan_records: { storageKey: '@hr_loan_records', includeDeleted: true, minDays: 3650 },
  hr_service_charge_month_entries: { storageKey: '@hr_service_charge_month_entries', includeDeleted: true, minDays: 45 },
};

const DATA_TYPES_TO_LOAD = Object.keys(RESTORE_CONFIG);

const RECONCILIATION_STORAGE_KEYS = [
  '@reconciliation_kitchen_stock_reports',
  '@reconciliation_sales_reports',
] as const;

async function hasLocalData(dataType: string): Promise<boolean> {
  const config = RESTORE_CONFIG[dataType];
  if (!config?.storageKey) return false;

  try {
    const data = await AsyncStorage.getItem(config.storageKey);
    if (!data) return false;

    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed.length > 0;
    }
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed).length > 0;
    }
    return !!parsed;
  } catch {
    return false;
  }
}

async function fetchAndStoreDataType(userId: string, dataType: string): Promise<void> {
  const config = RESTORE_CONFIG[dataType];
  if (!config?.storageKey) return;

  const data = await getFromServer({
    userId,
    dataType,
    minDays: config.minDays,
    includeDeleted: config.includeDeleted,
  });

  await AsyncStorage.setItem(config.storageKey, JSON.stringify(data));
}

async function getMissingDataTypes(): Promise<string[]> {
  const missingTypes: string[] = [];
  for (const dataType of DATA_TYPES_TO_LOAD) {
    const hasData = await hasLocalData(dataType);
    if (!hasData) {
      missingTypes.push(dataType);
    }
  }
  return missingTypes;
}

async function areReconciliationCachesMissing(): Promise<boolean> {
  try {
    const values = await Promise.all(RECONCILIATION_STORAGE_KEYS.map((key) => AsyncStorage.getItem(key)));
    return values.some((value) => {
      if (!value) return true;
      try {
        const parsed = JSON.parse(value);
        return !Array.isArray(parsed) || parsed.length === 0;
      } catch {
        return true;
      }
    });
  } catch {
    return true;
  }
}

async function restoreMissingDataTypes(
  userId: string,
  missingTypes: string[],
  onProgress?: (status: string) => void,
): Promise<void> {
  if (missingTypes.length === 0) return;

  const priorityTypes = missingTypes.filter((dataType) => RESTORE_CONFIG[dataType]?.priority);
  if (priorityTypes.length > 0) {
    onProgress?.(`Loading ${priorityTypes.join(', ')}...`);
    await Promise.all(priorityTypes.map(async (dataType) => {
      try {
        await fetchAndStoreDataType(userId, dataType);
      } catch {
      }
    }));
  }

  const remainingTypes = missingTypes.filter((dataType) => !RESTORE_CONFIG[dataType]?.priority);
  const total = remainingTypes.length;
  const batchSize = 4;

  for (let i = 0; i < remainingTypes.length; i += batchSize) {
    const batch = remainingTypes.slice(i, i + batchSize);
    const loaded = i + batch.length;
    onProgress?.(`Loading data... (${loaded}/${total})`);

    await Promise.all(batch.map(async (dataType) => {
      try {
        await fetchAndStoreDataType(userId, dataType);
      } catch {
      }
    }));
  }
}

export async function loadInitialDataIfNeeded(userId: string, onProgress?: (status: string) => void): Promise<void> {
  try {
    onProgress?.('Checking local data...');

    const missingTypes = await getMissingDataTypes();
    const reconciliationMissing = await areReconciliationCachesMissing();

    if (missingTypes.length === 0 && !reconciliationMissing) {
      onProgress?.('Data already loaded');
      return;
    }

    await restoreMissingDataTypes(userId, missingTypes, onProgress);

    if (reconciliationMissing) {
      onProgress?.('Loading reconciliation data...');
      await syncAllReconciliationData(45).catch(() => {});
    }

    onProgress?.('Complete!');
  } catch {
    onProgress?.('Error loading data');
  }
}

export async function forceReloadAllData(userId: string): Promise<void> {
  try {
    const missingTypes = await getMissingDataTypes();
    await restoreMissingDataTypes(userId, missingTypes);

    const reconciliationMissing = await areReconciliationCachesMissing();
    if (reconciliationMissing) {
      await syncAllReconciliationData(45).catch(() => {});
    }
  } catch {
  }
}
