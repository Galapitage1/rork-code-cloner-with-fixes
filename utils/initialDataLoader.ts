import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFromServer } from './directSync';

const DATA_TYPES_TO_LOAD = [
  'outlets',
  'products',
  'stockChecks',
  'requests',
  'productConversions',
  'inventoryStocks',
  'salesDeductions',
  'reconcileHistory',
  'storeProducts',
  'suppliers',
  'grns',
  'productionRequests',
  'approvedProductions',
  'activityLogs',
  'customers',
  'orders',
  'recipes',
  'linkedProducts',
];

const STORAGE_KEY_MAP: Record<string, string> = {
  users: '@stock_app_users',
  outlets: '@stock_app_outlets',
  products: '@stock_app_products',
  stockChecks: '@stock_app_stock_checks',
  requests: '@stock_app_requests',
  productConversions: '@stock_app_product_conversions',
  inventoryStocks: '@stock_app_inventory_stocks',
  salesDeductions: '@stock_app_sales_deductions',
  reconcileHistory: '@stock_app_reconcile_history',
  storeProducts: '@stock_app_store_products',
  suppliers: '@stock_app_suppliers',
  grns: '@stock_app_grns',
  productionRequests: '@stock_app_production_requests',
  approvedProductions: '@stock_app_approved_productions',
  activityLogs: '@stock_app_activity_logs',
  customers: '@stock_app_customers',
  orders: '@stock_app_orders',
  recipes: '@stock_app_recipes',
  linkedProducts: '@stock_app_linked_products',
};

async function hasLocalData(dataType: string): Promise<boolean> {
  const storageKey = STORAGE_KEY_MAP[dataType];
  if (!storageKey) return false;

  try {
    const data = await AsyncStorage.getItem(storageKey);
    if (!data) return false;

    const parsed = JSON.parse(data);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export async function loadInitialDataIfNeeded(userId: string, onProgress?: (status: string) => void): Promise<void> {
  try {
    onProgress?.('Checking local data...');

    const hasOutlets = await hasLocalData('outlets');
    const hasProducts = await hasLocalData('products');
    const hasUsers = await hasLocalData('users');

    if (hasOutlets && hasProducts && hasUsers) {
      onProgress?.('Data already loaded');
      return;
    }

    const priorityTypes = ['users', 'outlets'];
    onProgress?.('Loading users and outlets...');
    
    await Promise.all(priorityTypes.map(async (dataType) => {
      try {
        const data = await getFromServer({ userId, dataType });
        const storageKey = STORAGE_KEY_MAP[dataType];
        if (storageKey) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(data));
        }
      } catch {
      }
    }));

    const remainingTypes = DATA_TYPES_TO_LOAD.filter(t => !priorityTypes.includes(t));
    
    const total = remainingTypes.length;
    const batchSize = 5;
    
    for (let i = 0; i < remainingTypes.length; i += batchSize) {
      const batch = remainingTypes.slice(i, i + batchSize);
      const loaded = i + batch.length;
      onProgress?.(`Loading data... (${loaded}/${total})`);
      
      await Promise.all(batch.map(async (dataType) => {
        try {
          const data = await getFromServer({ userId, dataType });
          const storageKey = STORAGE_KEY_MAP[dataType];
          if (storageKey) {
            await AsyncStorage.setItem(storageKey, JSON.stringify(data));
          }
        } catch {
        }
      }));
    }

    onProgress?.('Complete!');
  } catch {
    onProgress?.('Error loading data');
  }
}

export async function forceReloadAllData(userId: string): Promise<void> {
  try {
    for (const dataType of DATA_TYPES_TO_LOAD) {
      try {
        const data = await getFromServer({ userId, dataType });
        const storageKey = STORAGE_KEY_MAP[dataType];
        if (storageKey) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(data));
        }
      } catch {
      }
    }
  } catch {
  }
}
