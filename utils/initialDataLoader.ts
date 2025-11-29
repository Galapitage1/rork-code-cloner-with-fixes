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
  customers: 'customers',
  orders: 'customer_orders',
  recipes: '@stock_app_recipes',
};

async function hasLocalData(dataType: string): Promise<boolean> {
  const storageKey = STORAGE_KEY_MAP[dataType];
  if (!storageKey) return false;

  try {
    const data = await AsyncStorage.getItem(storageKey);
    if (!data) return false;

    const parsed = JSON.parse(data);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch (error) {
    console.error(`[InitialDataLoader] Error checking local data for ${dataType}:`, error);
    return false;
  }
}

export async function loadInitialDataIfNeeded(userId: string): Promise<void> {
  try {
    console.log('[InitialDataLoader] Starting initial data check...');

    const hasOutlets = await hasLocalData('outlets');
    const hasProducts = await hasLocalData('products');

    if (hasOutlets && hasProducts) {
      console.log('[InitialDataLoader] Device already has core data, skipping initial load');
      return;
    }

    console.log('[InitialDataLoader] No local data found, loading from server...');

    const priorityTypes = ['outlets', 'users'];
    
    console.log('[InitialDataLoader] Loading critical data first (outlets, users)...');
    for (const dataType of priorityTypes) {
      try {
        console.log(`[InitialDataLoader] Loading ${dataType}...`);
        const data = await getFromServer({ userId, dataType });
        
        const storageKey = STORAGE_KEY_MAP[dataType];
        if (storageKey && data.length > 0) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(data));
          console.log(`[InitialDataLoader] Loaded ${data.length} ${dataType} items`);
        } else if (data.length === 0) {
          console.log(`[InitialDataLoader] No ${dataType} data on server`);
        }
      } catch (error) {
        console.error(`[InitialDataLoader] Failed to load ${dataType}:`, error);
      }
    }

    console.log('[InitialDataLoader] Loading remaining data...');
    const remainingTypes = DATA_TYPES_TO_LOAD.filter(t => !priorityTypes.includes(t));
    
    for (const dataType of remainingTypes) {
      try {
        console.log(`[InitialDataLoader] Loading ${dataType}...`);
        const data = await getFromServer({ userId, dataType });
        
        const storageKey = STORAGE_KEY_MAP[dataType];
        if (storageKey && data.length > 0) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(data));
          console.log(`[InitialDataLoader] Loaded ${data.length} ${dataType} items`);
        } else if (data.length === 0) {
          console.log(`[InitialDataLoader] No ${dataType} data on server`);
        }
      } catch (error) {
        console.error(`[InitialDataLoader] Failed to load ${dataType}:`, error);
      }
    }

    console.log('[InitialDataLoader] Initial data load complete');
  } catch (error) {
    console.error('[InitialDataLoader] Error during initial data load:', error);
  }
}

export async function forceReloadAllData(userId: string): Promise<void> {
  try {
    console.log('[InitialDataLoader] Force reloading all data from server...');

    for (const dataType of DATA_TYPES_TO_LOAD) {
      try {
        console.log(`[InitialDataLoader] Reloading ${dataType}...`);
        const data = await getFromServer({ userId, dataType });
        
        const storageKey = STORAGE_KEY_MAP[dataType];
        if (storageKey) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(data));
          console.log(`[InitialDataLoader] Reloaded ${data.length} ${dataType} items`);
        }
      } catch (error) {
        console.error(`[InitialDataLoader] Failed to reload ${dataType}:`, error);
      }
    }

    console.log('[InitialDataLoader] Force reload complete');
  } catch (error) {
    console.error('[InitialDataLoader] Error during force reload:', error);
  }
}
