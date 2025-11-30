import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback, useMemo, useRef, ReactNode, createContext, useContext } from 'react';
import { Product, StockCheck, StockCount, ProductRequest, Outlet, ProductConversion, InventoryStock, SalesDeduction, SalesReconciliationHistory } from '@/types';
import { syncData } from '@/utils/syncData';

const STORAGE_KEYS = {
  PRODUCTS: '@stock_app_products',
  STOCK_CHECKS: '@stock_app_stock_checks',
  REQUESTS: '@stock_app_requests',
  OUTLETS: '@stock_app_outlets',
  SHOW_PRODUCT_LIST: '@stock_app_show_product_list',
  PRODUCT_CONVERSIONS: '@stock_app_product_conversions',
  INVENTORY_STOCKS: '@stock_app_inventory_stocks',
  SALES_DEDUCTIONS: '@stock_app_sales_deductions',
  VIEW_MODE: '@stock_app_view_mode',
  RECONCILE_HISTORY: '@stock_app_reconcile_history',
  SYNC_PAUSED: '@stock_app_sync_paused',
};

type StockContextType = {
  products: Product[];
  stockChecks: StockCheck[];
  requests: ProductRequest[];
  outlets: Outlet[];
  productConversions: ProductConversion[];
  inventoryStocks: InventoryStock[];
  salesDeductions: SalesDeduction[];
  reconcileHistory: SalesReconciliationHistory[];
  isLoading: boolean;
  currentStockCounts: Map<string, number>;
  showProductList: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  viewMode: 'search' | 'button';
  isSyncPaused: boolean;
  toggleSyncPause: () => Promise<void>;
  importProducts: (newProducts: Product[]) => Promise<number>;
  addProduct: (product: Product) => Promise<void>;
  updateProduct: (productId: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  saveStockCheck: (stockCheck: StockCheck, skipInventoryUpdate?: boolean) => Promise<void>;
  deleteStockCheck: (checkId: string) => Promise<void>;
  updateStockCheck: (checkId: string, newCounts: StockCount[], newOutlet?: string, outletChanged?: boolean) => Promise<void>;
  addRequest: (request: ProductRequest) => Promise<void>;
  updateRequestStatus: (requestId: string, status: ProductRequest['status']) => Promise<void>;
  deleteRequest: (requestId: string) => Promise<void>;
  updateRequest: (requestId: string, updates: Partial<ProductRequest>) => Promise<void>;
  addRequestsToDate: (date: string, newRequests: ProductRequest[]) => Promise<void>;
  addOutlet: (outlet: Outlet) => Promise<void>;
  updateOutlet: (outletId: string, updates: Partial<Outlet>) => Promise<void>;
  deleteOutlet: (outletId: string) => Promise<void>;
  addProductConversion: (conversion: ProductConversion) => Promise<void>;
  addProductConversionsBulk: (conversions: ProductConversion[]) => Promise<void>;
  updateProductConversion: (conversionId: string, updates: Partial<ProductConversion>) => Promise<void>;
  deleteProductConversion: (conversionId: string) => Promise<void>;
  getConversionFactor: (fromProductId: string, toProductId: string) => number | null;
  updateInventoryStock: (productId: string, updates: Partial<InventoryStock>) => Promise<void>;
  addInventoryStock: (stock: InventoryStock) => Promise<void>;
  deductInventoryFromApproval: (request: ProductRequest) => Promise<{ success: boolean; message?: string }>;
  deductInventoryFromSales: (outletName: string, productId: string, salesDate: string, wholeDeducted: number, slicesDeducted: number) => Promise<void>;
  addReconcileHistory: (history: SalesReconciliationHistory) => Promise<void>;
  deleteReconcileHistory: (historyId: string) => Promise<void>;
  clearAllReconcileHistory: () => Promise<void>;
  clearAllInventory: () => Promise<void>;
  clearAllProductConversions: () => Promise<void>;
  getLowStockItems: () => { product: Product; currentStock: number; minStock: number; }[];
  getTodayStockCheck: () => StockCheck | undefined;
  clearAllData: () => Promise<void>;
  clearAllProducts: () => Promise<void>;
  clearAllOutlets: () => Promise<void>;
  deleteUserStockChecks: (userId: string) => Promise<void>;
  deleteAllStockChecks: () => Promise<void>;
  deleteAllRequests: () => Promise<void>;
  toggleShowProductList: (value: boolean) => Promise<void>;
  setViewMode: (mode: 'search' | 'button') => Promise<void>;
  syncAll: (silent?: boolean) => Promise<void>;
};

const StockContext = createContext<StockContextType | null>(null);

export function useStock() {
  const context = useContext(StockContext);
  if (!context) {
    throw new Error('useStock must be used within StockProvider');
  }
  return context;
}

export function StockProvider({ children, currentUser }: { children: ReactNode; currentUser: { id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [stockChecks, setStockChecks] = useState<StockCheck[]>([]);
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [productConversions, setProductConversions] = useState<ProductConversion[]>([]);
  const [inventoryStocks, setInventoryStocks] = useState<InventoryStock[]>([]);
  const [salesDeductions, setSalesDeductions] = useState<SalesDeduction[]>([]);
  const [reconcileHistory, setReconcileHistory] = useState<SalesReconciliationHistory[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentStockCounts, setCurrentStockCounts] = useState<Map<string, number>>(new Map());
  const [showProductList, setShowProductList] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [serverTimestamps, setServerTimestamps] = useState<Record<string, number>>({});
  const [viewMode, setViewModeState] = useState<'search' | 'button'>('search');
  const [isSyncPaused, setIsSyncPaused] = useState<boolean>(false);

  const syncAllRef = useRef<(() => Promise<void>) | null>(null);
  const syncInProgressRef = useRef<boolean>(false);

  const toggleSyncPause = useCallback(async () => {
    const newPausedState = !isSyncPaused;
    setIsSyncPaused(newPausedState);
    await AsyncStorage.setItem(STORAGE_KEYS.SYNC_PAUSED, JSON.stringify(newPausedState));
    console.log('StockContext: Sync', newPausedState ? 'paused' : 'resumed');
  }, [isSyncPaused]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        console.log('StockContext loadData: PAUSING automatic sync to prevent data loss');
        syncInProgressRef.current = true;
        
        // Clean up old sales deductions on startup
        try {
          const storedSalesDeductions = await AsyncStorage.getItem(STORAGE_KEYS.SALES_DEDUCTIONS);
          if (storedSalesDeductions) {
            const parsed = JSON.parse(storedSalesDeductions);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const ninetyDaysAgo = new Date();
              ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
              const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
              
              const recentDeductions = parsed.filter((d: any) => d.salesDate >= ninetyDaysAgoStr).slice(0, 300);
              if (recentDeductions.length < parsed.length) {
                console.log('StockContext loadData: Cleaned up', parsed.length - recentDeductions.length, 'old sales deductions');
                await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, JSON.stringify(recentDeductions));
              }
            }
          }
        } catch (cleanupError) {
          console.error('StockContext loadData: Failed to cleanup old sales deductions:', cleanupError);
        }
        
        const [productsData, stockChecksData, requestsData, outletsData, showProductListData, conversionsData, inventoryData, salesDeductionsData, viewModeData, reconcileHistoryData, syncPausedData] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.PRODUCTS),
          AsyncStorage.getItem(STORAGE_KEYS.STOCK_CHECKS),
          AsyncStorage.getItem(STORAGE_KEYS.REQUESTS),
          AsyncStorage.getItem(STORAGE_KEYS.OUTLETS),
          AsyncStorage.getItem(STORAGE_KEYS.SHOW_PRODUCT_LIST),
          AsyncStorage.getItem(STORAGE_KEYS.PRODUCT_CONVERSIONS),
          AsyncStorage.getItem(STORAGE_KEYS.INVENTORY_STOCKS),
          AsyncStorage.getItem(STORAGE_KEYS.SALES_DEDUCTIONS),
          AsyncStorage.getItem(STORAGE_KEYS.VIEW_MODE),
          AsyncStorage.getItem(STORAGE_KEYS.RECONCILE_HISTORY),
          AsyncStorage.getItem(STORAGE_KEYS.SYNC_PAUSED),
        ]);

        if (productsData) {
          try {
            const trimmed = productsData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setProducts(parsed.filter((p: any) => !p?.deleted));
                console.log('StockContext loadData: Loaded', parsed.length, 'products from local storage');
              } else {
                console.error('Products data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCTS);
              }
            } else {
              console.error('Products data is not valid JSON:', productsData);
              await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCTS);
            }
          } catch (parseError) {
            console.error('Failed to parse products data:', parseError);
            console.error('Raw data:', productsData);
            await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCTS);
            setProducts([]);
          }
        }
        if (stockChecksData) {
          try {
            const trimmed = stockChecksData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const checks = JSON.parse(trimmed);
              if (Array.isArray(checks)) {
                const activeChecks = checks.filter((c: any) => !c?.deleted);
                setStockChecks(activeChecks);
                
                if (activeChecks.length > 0) {
                  const sortedChecks = [...activeChecks].sort((a: StockCheck, b: StockCheck) => b.timestamp - a.timestamp);
                  const latestCheck = sortedChecks[0];
                  
                  const stockMap = new Map<string, number>();
                  if (latestCheck.counts && Array.isArray(latestCheck.counts)) {
                    latestCheck.counts.forEach((count: StockCount) => {
                      stockMap.set(count.productId, count.quantity);
                    });
                  }
                  
                  setCurrentStockCounts(stockMap);
                }
              } else {
                console.error('Stock checks data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.STOCK_CHECKS);
              }
            } else {
              console.error('Stock checks data is not valid JSON:', stockChecksData);
              await AsyncStorage.removeItem(STORAGE_KEYS.STOCK_CHECKS);
            }
          } catch (parseError) {
            console.error('Failed to parse stock checks data:', parseError);
            console.error('Raw data:', stockChecksData);
            await AsyncStorage.removeItem(STORAGE_KEYS.STOCK_CHECKS);
            setStockChecks([]);
          }
        }
        if (requestsData) {
          try {
            const trimmed = requestsData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setRequests(parsed.filter((r: any) => !r?.deleted));
              } else {
                console.error('Requests data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.REQUESTS);
              }
            } else {
              console.error('Requests data is not valid JSON:', requestsData);
              await AsyncStorage.removeItem(STORAGE_KEYS.REQUESTS);
            }
          } catch (parseError) {
            console.error('Failed to parse requests data:', parseError);
            console.error('Raw data:', requestsData);
            await AsyncStorage.removeItem(STORAGE_KEYS.REQUESTS);
            setRequests([]);
          }
        }
        if (outletsData) {
          try {
            const trimmed = outletsData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setOutlets(parsed.filter((o: any) => !o?.deleted));
              } else {
                console.error('Outlets data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.OUTLETS);
              }
            } else {
              console.error('Outlets data is not valid JSON:', outletsData);
              await AsyncStorage.removeItem(STORAGE_KEYS.OUTLETS);
            }
          } catch (parseError) {
            console.error('Failed to parse outlets data:', parseError);
            console.error('Raw data:', outletsData);
            await AsyncStorage.removeItem(STORAGE_KEYS.OUTLETS);
            setOutlets([]);
          }
        }
        if (showProductListData !== null) {
          try {
            setShowProductList(showProductListData === 'true');
          } catch (parseError) {
            console.error('Failed to parse show product list setting:', parseError);
            setShowProductList(true);
          }
        }
        if (viewModeData !== null) {
          try {
            setViewModeState(viewModeData === 'button' ? 'button' : 'search');
          } catch (parseError) {
            console.error('Failed to parse view mode setting:', parseError);
            setViewModeState('search');
          }
        }
        if (syncPausedData !== null) {
          try {
            const parsedSyncPaused = JSON.parse(syncPausedData);
            setIsSyncPaused(parsedSyncPaused);
          } catch (parseError) {
            console.error('Failed to parse sync paused setting:', parseError);
            setIsSyncPaused(false);
          }
        }
        if (conversionsData) {
          try {
            const trimmed = conversionsData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setProductConversions(parsed.filter((c: any) => !c?.deleted));
              } else {
                console.error('Conversions data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCT_CONVERSIONS);
              }
            } else {
              console.error('Conversions data is not valid JSON:', conversionsData);
              await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCT_CONVERSIONS);
            }
          } catch (parseError) {
            console.error('Failed to parse conversions data:', parseError);
            console.error('Raw data:', conversionsData);
            await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCT_CONVERSIONS);
            setProductConversions([]);
          }
        }
        if (inventoryData) {
          try {
            const trimmed = inventoryData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setInventoryStocks(parsed.filter((i: any) => !i?.deleted));
              } else {
                console.error('Inventory data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.INVENTORY_STOCKS);
              }
            } else {
              console.error('Inventory data is not valid JSON:', inventoryData);
              await AsyncStorage.removeItem(STORAGE_KEYS.INVENTORY_STOCKS);
            }
          } catch (parseError) {
            console.error('Failed to parse inventory data:', parseError);
            console.error('Raw data:', inventoryData);
            await AsyncStorage.removeItem(STORAGE_KEYS.INVENTORY_STOCKS);
            setInventoryStocks([]);
          }
        }
        if (salesDeductionsData) {
          try {
            const trimmed = salesDeductionsData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setSalesDeductions(parsed.filter((s: any) => !s?.deleted));
              } else {
                console.error('Sales deductions data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.SALES_DEDUCTIONS);
              }
            } else {
              console.error('Sales deductions data is not valid JSON:', salesDeductionsData);
              await AsyncStorage.removeItem(STORAGE_KEYS.SALES_DEDUCTIONS);
            }
          } catch (parseError) {
            console.error('Failed to parse sales deductions data:', parseError);
            console.error('Raw data:', salesDeductionsData);
            await AsyncStorage.removeItem(STORAGE_KEYS.SALES_DEDUCTIONS);
            setSalesDeductions([]);
          }
        }
        if (reconcileHistoryData) {
          try {
            const trimmed = reconcileHistoryData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setReconcileHistory(parsed.filter((r: any) => !r?.deleted));
              } else {
                console.error('Reconcile history data is not an array');
                await AsyncStorage.removeItem(STORAGE_KEYS.RECONCILE_HISTORY);
              }
            } else {
              console.error('Reconcile history data is not valid JSON:', reconcileHistoryData);
              await AsyncStorage.removeItem(STORAGE_KEYS.RECONCILE_HISTORY);
            }
          } catch (parseError) {
            console.error('Failed to parse reconcile history data:', parseError);
            console.error('Raw data:', reconcileHistoryData);
            await AsyncStorage.removeItem(STORAGE_KEYS.RECONCILE_HISTORY);
            setReconcileHistory([]);
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
        
        // Get fresh products data for syncing after loading
        const freshProductsData = await AsyncStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (freshProductsData && currentUser?.id) {
          try {
            const parsedProducts = JSON.parse(freshProductsData);
            if (Array.isArray(parsedProducts) && parsedProducts.length > 0) {
              console.log('StockContext loadData: Products loaded -', parsedProducts.length, 'items');
              console.log('StockContext loadData: SYNCING OUT to server to preserve local product data...');
              
              syncData('products', parsedProducts, currentUser.id, { 
                isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' 
              }).then((syncedProducts) => {
                console.log('StockContext loadData: ✓ Products synced OUT to server successfully');
                console.log('StockContext loadData: Server now has latest product data including selling prices');
                
                AsyncStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(syncedProducts)).then(() => {
                  console.log('StockContext loadData: ✓ Synced products saved back to local storage');
                });
                
                setProducts((syncedProducts as any[]).filter((p: any) => !p?.deleted));
              }).catch((syncError) => {
                console.error('StockContext loadData: Failed to sync products OUT:', syncError);
              }).finally(() => {
                console.log('StockContext loadData: RESUMING automatic sync');
                syncInProgressRef.current = false;
              });
            } else {
              console.log('StockContext loadData: No products to sync, resuming sync');
              syncInProgressRef.current = false;
            }
          } catch (parseError) {
            console.error('StockContext loadData: Failed to parse products for sync:', parseError);
            syncInProgressRef.current = false;
          }
        } else {
          console.log('StockContext loadData: No products data or no user logged in, resuming sync');
          syncInProgressRef.current = false;
        }
      }
    };

    loadData();
  }, [currentUser]);



  const saveProducts = useCallback(async (newProducts: Product[]) => {
    try {
      const productsWithTimestamp = newProducts.map(p => ({
        ...p,
        showInStock: p.showInStock !== undefined ? p.showInStock : true,
        updatedAt: p.updatedAt || Date.now(),
      }));
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(productsWithTimestamp));
      setProducts(productsWithTimestamp.filter(p => !p.deleted));
      console.log('saveProducts: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to save products:', error);
      throw error;
    }
  }, []);

  const importProducts = useCallback(async (newProducts: Product[]) => {
    console.log('[importProducts] Importing', newProducts.length, 'products');
    newProducts.forEach(p => {
      console.log('[importProducts] Product:', p.name, 'Type:', p.type, 'sellingPrice:', p.sellingPrice);
    });
    
    const existingProductsMap = new Map(
      products.map(p => [`${p.name.toLowerCase()}_${p.unit.toLowerCase()}`, p])
    );
    
    const productsToAdd: Product[] = [];
    
    newProducts.forEach(newProduct => {
      const key = `${newProduct.name.toLowerCase()}_${newProduct.unit.toLowerCase()}`;
      const existingProduct = existingProductsMap.get(key);
      
      if (existingProduct) {
        console.log(`Product "${newProduct.name}" with unit "${newProduct.unit}" already exists, skipping...`);
        return;
      }
      
      productsToAdd.push(newProduct);
    });
    
    console.log('[importProducts] Adding', productsToAdd.length, 'new products');
    const updatedProducts = [...products, ...productsToAdd];
    
    await saveProducts(updatedProducts);
    return productsToAdd.length;
  }, [products, saveProducts]);

  const addProduct = useCallback(async (product: Product) => {
    const updatedProducts = [...products, product];
    await saveProducts(updatedProducts);
  }, [products, saveProducts]);

  const updateProduct = useCallback(async (productId: string, updates: Partial<Product>) => {
    console.log('[StockContext] updateProduct: Starting update for product', productId);
    console.log('[StockContext] updateProduct: Updates object:', JSON.stringify(updates, null, 2));
    
    const updatedProducts = products.map(p =>
      p.id === productId ? { ...p, ...updates, updatedAt: Date.now() } : p
    );
    
    console.log('[StockContext] updateProduct: Saving', updatedProducts.length, 'products to AsyncStorage');
    await saveProducts(updatedProducts);
    
    console.log('[StockContext] updateProduct: Triggering immediate sync to preserve changes');
    if (currentUser && syncAllRef.current && !syncInProgressRef.current) {
      try {
        await syncData('products', updatedProducts, currentUser.id, { 
          isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' 
        });
        console.log('[StockContext] updateProduct: ✓ Successfully synced product update to server');
      } catch (syncError) {
        console.error('[StockContext] updateProduct: Sync failed, but product is saved locally:', syncError);
      }
    }
    
    console.log('[StockContext] updateProduct: Complete');
  }, [products, saveProducts, currentUser]);

  const deleteProduct = useCallback(async (productId: string) => {
    const updatedProducts = products.map(p => p.id === productId ? { ...p, deleted: true as const, updatedAt: Date.now() } : p);
    await saveProducts(updatedProducts as any);
  }, [products, saveProducts]);

  const getConversionFactor = useCallback((fromProductId: string, toProductId: string): number | null => {
    const conversion = productConversions.find(
      c => c.fromProductId === fromProductId && c.toProductId === toProductId
    );
    return conversion ? conversion.conversionFactor : null;
  }, [productConversions]);

  const getProductPairForInventory = useCallback((productId: string) => {
    const fromConversion = productConversions.find(c => c.fromProductId === productId);
    const toConversion = productConversions.find(c => c.toProductId === productId);
    
    if (fromConversion) {
      return { wholeProductId: productId, slicesProductId: fromConversion.toProductId };
    }
    if (toConversion) {
      return { wholeProductId: toConversion.fromProductId, slicesProductId: productId };
    }
    return null;
  }, [productConversions]);

  const saveInventoryStocks = useCallback(async (stocks: InventoryStock[]) => {
    try {
      const stocksWithTimestamp = stocks.map(s => ({ ...s, updatedAt: s.updatedAt || Date.now() }));
      console.log('saveInventoryStocks: Saving', stocksWithTimestamp.length, 'stocks to AsyncStorage');
      await AsyncStorage.setItem(STORAGE_KEYS.INVENTORY_STOCKS, JSON.stringify(stocksWithTimestamp));
      console.log('saveInventoryStocks: Setting state with', stocksWithTimestamp.filter(s => !s.deleted).length, 'active stocks');
      setInventoryStocks(stocksWithTimestamp.filter(s => !s.deleted));
      console.log('saveInventoryStocks: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to save inventory stocks:', error);
      throw error;
    }
  }, []);

  const addInventoryStock = useCallback(async (stock: InventoryStock) => {
    const updated = [...inventoryStocks, stock];
    await saveInventoryStocks(updated);
  }, [inventoryStocks, saveInventoryStocks]);

  const saveStockCheck = useCallback(async (stockCheck: StockCheck, skipInventoryUpdate = false) => {
    try {
      console.log('\n=== saveStockCheck START ===');
      console.log('Stock check ID:', stockCheck.id);
      console.log('Outlet:', stockCheck.outlet);
      console.log('Date:', stockCheck.date);
      console.log('replaceAllInventory flag:', stockCheck.replaceAllInventory);
      console.log('skipInventoryUpdate:', skipInventoryUpdate);
      
      const checkWithTimestamp = {
        ...stockCheck,
        updatedAt: stockCheck.updatedAt || Date.now(),
      };
      
      const existingIndex = stockChecks.findIndex(c => c.id === stockCheck.id);
      let updatedChecks: StockCheck[];
      
      if (existingIndex >= 0) {
        console.log('saveStockCheck: Updating existing stock check with ID:', stockCheck.id);
        updatedChecks = [
          ...stockChecks.slice(0, existingIndex),
          checkWithTimestamp,
          ...stockChecks.slice(existingIndex + 1),
        ];
      } else {
        console.log('saveStockCheck: Adding new stock check with ID:', stockCheck.id);
        updatedChecks = [...stockChecks, checkWithTimestamp];
      }
      
      // CRITICAL: Sync OUT first before updating local storage
      console.log('saveStockCheck: Syncing to server BEFORE updating local storage...');
      if (currentUser?.id && syncAllRef.current && !syncInProgressRef.current) {
        try {
          await syncData('stockChecks', updatedChecks, currentUser.id);
          console.log('saveStockCheck: Successfully synced to server');
        } catch (syncError) {
          console.error('saveStockCheck: Sync failed, but continuing with local update:', syncError);
        }
      }
      
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(updatedChecks));
      setStockChecks(updatedChecks);
      
      const stockMap = new Map<string, number>();
      stockCheck.counts.forEach((count: StockCount) => {
        stockMap.set(count.productId, count.quantity);
      });
      
      setCurrentStockCounts(stockMap);

      if (!skipInventoryUpdate) {
        console.log('\n=== INVENTORY UPDATE START ===');
        console.log('saveStockCheck: Stock check saved for date:', stockCheck.date);
        console.log('saveStockCheck: Outlet:', stockCheck.outlet);
        console.log('saveStockCheck: replaceAllInventory flag:', stockCheck.replaceAllInventory);
        
        const outlet = outlets.find(o => o.name === stockCheck.outlet);
        console.log('saveStockCheck: Outlet found:', !!outlet, 'Type:', outlet?.outletType);
        
        // Check if Replace All Inventory is enabled (super admin feature)
        if (stockCheck.replaceAllInventory && outlet) {
          console.log('\n=== REPLACE ALL INVENTORY MODE (Super Admin) ===');
          console.log('This will REPLACE ALL inventory for outlet:', stockCheck.outlet);
          console.log('With current stock values from this stock check');
          console.log('Number of products in stock check:', stockCheck.counts.length);
          
          // Read fresh inventory from AsyncStorage to ensure we have the latest data
          console.log('Reading fresh inventory data from storage before replacement...');
          const freshInventoryData = await AsyncStorage.getItem(STORAGE_KEYS.INVENTORY_STOCKS);
          const freshInventory = freshInventoryData ? JSON.parse(freshInventoryData) : inventoryStocks;
          console.log('Fresh inventory stocks count:', freshInventory.length);
          
          await handleReplaceAllInventory(stockCheck, outlet, freshInventory);
          
          console.log('=== REPLACE ALL INVENTORY COMPLETE ===\n');
        } else if (outlet && outlet.outletType === 'production') {
          console.log('Stock check for PRODUCTION outlet:', outlet.name);
          console.log('Stock check counts:', stockCheck.counts.length);
          console.log('Updating inventory from production stock check...');
          
          let updatedInventoryStocks = [...inventoryStocks];
          console.log('Current inventory stocks count:', updatedInventoryStocks.length);
          
          const salesOutlets = outlets.filter(o => o.outletType === 'sales');
          
          // Find if this is an update to an existing stock check
          const existingCheck = stockChecks.find(c => c.id === stockCheck.id);
          
          // Group counts by product pair to handle both whole and slices together
          const productPairUpdates = new Map<string, { wholeQty: number; slicesQty: number }>();
          
          for (const count of stockCheck.counts) {
            console.log('\n=== Processing count for product:', count.productId, '===');
            console.log('Quantity (current stock):', count.quantity);
            console.log('Opening stock:', count.openingStock);
            console.log('Received stock:', count.receivedStock);
            console.log('Wastage:', count.wastage);
            
            const productPair = getProductPairForInventory(count.productId);
            if (!productPair) {
              console.log('No product pair found for product ID:', count.productId, '- this is a Production Stock (Other Units) product');
              console.log('Skipping inventory update for non-conversion product');
              continue;
            }
            
            console.log('Found product pair - whole:', productPair.wholeProductId, 'slices:', productPair.slicesProductId);
            
            const conversionFactor = getConversionFactor(productPair.wholeProductId, productPair.slicesProductId) || 10;
            console.log('Conversion factor:', conversionFactor);
            
            const isWholeProduct = count.productId === productPair.wholeProductId;
            const currentStockQuantity = count.quantity;
            
            console.log('Current stock quantity (what to SET inventory to):', currentStockQuantity);
            
            // Get or create the update entry for this product pair
            const wholeProductId = productPair.wholeProductId;
            let pairUpdate = productPairUpdates.get(wholeProductId);
            if (!pairUpdate) {
              pairUpdate = { wholeQty: 0, slicesQty: 0 };
              productPairUpdates.set(wholeProductId, pairUpdate);
            }
            
            // Use the current stock quantity directly (it already includes opening + received - wastage)
            if (isWholeProduct) {
              const wholePart = Math.floor(currentStockQuantity);
              const slicesPart = Math.round((currentStockQuantity % 1) * conversionFactor);
              pairUpdate.wholeQty += wholePart;
              pairUpdate.slicesQty += slicesPart;
              console.log('Using whole product quantity - whole:', wholePart, 'slices:', slicesPart);
            } else {
              const totalSlices = Math.round(currentStockQuantity);
              pairUpdate.slicesQty += totalSlices;
              console.log('Using slices product quantity - slices:', totalSlices);
            }
            
            console.log('Current accumulated for pair - whole:', pairUpdate.wholeQty, 'slices:', pairUpdate.slicesQty);
          }
          
          // Now apply all the accumulated updates
          for (const [wholeProductId, pairUpdate] of productPairUpdates.entries()) {
            console.log('\n=== Applying accumulated update for product pair:', wholeProductId, '===');
            
            const conversionFactor = (() => {
              const productPair = getProductPairForInventory(wholeProductId);
              if (productPair) {
                return getConversionFactor(productPair.wholeProductId, productPair.slicesProductId) || 10;
              }
              return 10;
            })();
            
            // Normalize slices to whole
            let finalWhole = pairUpdate.wholeQty;
            let finalSlices = pairUpdate.slicesQty;
            
            if (finalSlices >= conversionFactor) {
              const extraWhole = Math.floor(finalSlices / conversionFactor);
              finalWhole += extraWhole;
              finalSlices = Math.round(finalSlices % conversionFactor);
            }
            
            console.log('Final amounts to SET inventory to - whole:', finalWhole, 'slices:', finalSlices);
            
            const existingInvIndex = updatedInventoryStocks.findIndex(inv => inv.productId === wholeProductId);
            
            if (existingInvIndex >= 0) {
              const existingInv = updatedInventoryStocks[existingInvIndex];
              console.log('Existing inventory - old whole:', existingInv.productionWhole, 'old slices:', existingInv.productionSlices);
              console.log('REPLACING with new amounts - whole:', finalWhole, 'slices:', finalSlices);
              
              const updatedInv = {
                ...existingInv,
                productionWhole: finalWhole,
                productionSlices: finalSlices,
                updatedAt: Date.now(),
              };
              updatedInventoryStocks = [
                ...updatedInventoryStocks.slice(0, existingInvIndex),
                updatedInv,
                ...updatedInventoryStocks.slice(existingInvIndex + 1)
              ];
              console.log('REPLACED inventory successfully - inventory now shows ONLY the current stock from this check');
            } else {
              console.log('Creating new inventory entry');
              const newInv: InventoryStock = {
                id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                productId: wholeProductId,
                productionWhole: finalWhole,
                productionSlices: finalSlices,
                outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
                updatedAt: Date.now(),
              };
              updatedInventoryStocks = [...updatedInventoryStocks, newInv];
              console.log('Created new inventory entry');
            }
          }
          
          // STEP 7: Deduct auto-filled received amounts from Prod.Req columns
          console.log('\n=== DEDUCTING AUTO-FILLED RECEIVED FROM PROD.REQ ===');
          for (const count of stockCheck.counts) {
            if (count.autoFilledReceivedFromProdReq && count.autoFilledReceivedFromProdReq > 0) {
              console.log('Product:', count.productId, 'has autoFilledReceivedFromProdReq:', count.autoFilledReceivedFromProdReq);
              
              const productPair = getProductPairForInventory(count.productId);
              const existingInvIndex = updatedInventoryStocks.findIndex(inv => {
                if (productPair) {
                  return inv.productId === productPair.wholeProductId;
                }
                return inv.productId === count.productId;
              });
              
              if (existingInvIndex >= 0) {
                const existingInv = updatedInventoryStocks[existingInvIndex];
                const updatedInv = { ...existingInv };
                
                if (productPair) {
                  // Product with conversion - deduct from prodsReqWhole
                  const oldProdsReqWhole = updatedInv.prodsReqWhole || 0;
                  updatedInv.prodsReqWhole = Math.max(0, oldProdsReqWhole - count.autoFilledReceivedFromProdReq);
                  console.log('Deducted', count.autoFilledReceivedFromProdReq, 'from prodsReqWhole. Old:', oldProdsReqWhole, 'New:', updatedInv.prodsReqWhole);
                } else {
                  // Product without conversion - deduct from productionRequest
                  const oldProductionRequest = updatedInv.productionRequest || 0;
                  updatedInv.productionRequest = Math.max(0, oldProductionRequest - count.autoFilledReceivedFromProdReq);
                  console.log('Deducted', count.autoFilledReceivedFromProdReq, 'from productionRequest. Old:', oldProductionRequest, 'New:', updatedInv.productionRequest);
                }
                
                updatedInv.updatedAt = Date.now();
                updatedInventoryStocks = [
                  ...updatedInventoryStocks.slice(0, existingInvIndex),
                  updatedInv,
                  ...updatedInventoryStocks.slice(existingInvIndex + 1)
                ];
              } else {
                console.log('WARNING: Inventory stock not found for product', count.productId);
              }
            }
          }
          console.log('=== FINISHED DEDUCTING FROM PROD.REQ ===\n');
          

          
          console.log('Saving', updatedInventoryStocks.length, 'inventory stocks...');
          await saveInventoryStocks(updatedInventoryStocks);
          console.log('Inventory stocks saved successfully - stock amounts overwritten from production stock check');
          
          // STEP 8: Add to next day's Prods.req column for live inventory
          console.log('\n=== ADDING TO NEXT DAY PRODS.REQ ===');
          const stockCheckDateObj = new Date(stockCheck.date);
          const nextDay = new Date(stockCheckDateObj);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          console.log('Production stock check date:', stockCheck.date);
          console.log('Next day date for Prods.req:', nextDayStr);
          
          for (const count of stockCheck.counts) {
            const productPair = getProductPairForInventory(count.productId);
            if (!productPair) {
              console.log('Skipping non-conversion product:', count.productId, 'for Prods.req');
              continue;
            }
            
            const wholeProductId = productPair.wholeProductId;
            const conversionFactor = getConversionFactor(productPair.wholeProductId, productPair.slicesProductId) || 10;
            
            // Get the current stock quantity (what was produced)
            const currentStockQuantity = count.quantity;
            
            // Convert to whole and slices
            let prodsReqWhole = 0;
            let prodsReqSlices = 0;
            
            const isWholeProduct = count.productId === productPair.wholeProductId;
            if (isWholeProduct) {
              prodsReqWhole = Math.floor(currentStockQuantity);
              prodsReqSlices = Math.round((currentStockQuantity % 1) * conversionFactor);
            } else {
              const totalSlices = Math.round(currentStockQuantity);
              prodsReqWhole = Math.floor(totalSlices / conversionFactor);
              prodsReqSlices = Math.round(totalSlices % conversionFactor);
            }
            
            console.log(`Product ${wholeProductId}: Adding ${prodsReqWhole}W + ${prodsReqSlices}S to next day Prods.req`);
            
            // Update the inventory stock with the next day's Prods.req
            const invStockIndex = updatedInventoryStocks.findIndex(inv => inv.productId === wholeProductId);
            if (invStockIndex >= 0) {
              const currentInvStock = updatedInventoryStocks[invStockIndex];
              const currentProdsReqWhole = currentInvStock.prodsReqWhole || 0;
              const currentProdsReqSlices = currentInvStock.prodsReqSlices || 0;
              
              console.log(`Current Prods.req: ${currentProdsReqWhole}W + ${currentProdsReqSlices}S`);
              
              // Add to existing Prods.req
              let newProdsReqWhole = currentProdsReqWhole + prodsReqWhole;
              let newProdsReqSlices = currentProdsReqSlices + prodsReqSlices;
              
              // Normalize slices
              if (newProdsReqSlices >= conversionFactor) {
                const extraWhole = Math.floor(newProdsReqSlices / conversionFactor);
                newProdsReqWhole += extraWhole;
                newProdsReqSlices = Math.round(newProdsReqSlices % conversionFactor);
              }
              
              console.log(`New Prods.req: ${newProdsReqWhole}W + ${newProdsReqSlices}S`);
              
              updatedInventoryStocks[invStockIndex] = {
                ...currentInvStock,
                prodsReqWhole: newProdsReqWhole,
                prodsReqSlices: newProdsReqSlices,
                updatedAt: Date.now(),
              };
            } else {
              console.log('WARNING: Inventory stock not found for product', wholeProductId, 'when adding to Prods.req');
            }
          }
          
          console.log('Saving updated inventory stocks with Prods.req...');
          await saveInventoryStocks(updatedInventoryStocks);
          console.log('=== FINISHED ADDING TO NEXT DAY PRODS.REQ ===\n');
        } else if (outlet) {
          console.log('Stock check for NON-PRODUCTION outlet:', outlet.name, 'type:', outlet.outletType);
          console.log('Inventory will NOT be updated - sales outlet stocks are updated when requests are approved');
        }
        
        console.log('=== INVENTORY UPDATE COMPLETE ===\n');
      } else {
        console.log('saveStockCheck: skipInventoryUpdate=true, not updating inventory');
      }

      console.log('=== saveStockCheck COMPLETE ===\n');

      console.log('saveStockCheck: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to save stock check:', error);
      throw error;
    }
  }, [stockChecks, currentUser, outlets, inventoryStocks, saveInventoryStocks, addInventoryStock, getConversionFactor, getProductPairForInventory, products]);

  const handleReplaceAllInventory = useCallback(async (
    stockCheck: StockCheck,
    outlet: Outlet,
    currentInventoryStocks: InventoryStock[]
  ) => {
    console.log('handleReplaceAllInventory: Processing replace all inventory');
    console.log('handleReplaceAllInventory: Outlet:', outlet.name, 'Type:', outlet.outletType);
    console.log('handleReplaceAllInventory: Stock check counts:', stockCheck.counts.length);
    console.log('handleReplaceAllInventory: This will REPLACE ALL inventory for this outlet');
    console.log('handleReplaceAllInventory: Including setting products to 0 if not in stock check');
    console.log('handleReplaceAllInventory: Will also CREATE inventory entries for products that don\'t exist yet');
    
    let updatedInventoryStocks = [...currentInventoryStocks];
    
    // CRITICAL: Get all sales outlets for initialization
    const salesOutlets = outlets.filter(o => o.outletType === 'sales');
    
    // Create a map of all current stock values from the stock check (use Current Stock Auto-calculated)
    const stockCheckQuantities = new Map<string, number>();
    stockCheck.counts.forEach(count => {
      // CRITICAL: Use Current Stock from count.quantity which is the EDITED value
      // When editing in History with "Replace All Inventory", count.quantity contains the Current Stock value
      const currentStock = count.quantity;
      
      stockCheckQuantities.set(count.productId, currentStock);
      const product = products.find(p => p.id === count.productId);
      console.log('Stock check entry:', product?.name, 'Current Stock (from quantity):', currentStock);
    });
    
    if (outlet.outletType === 'production') {
      console.log('handleReplaceAllInventory: Replacing PRODUCTION inventory');
      
      // First, create inventory entries for products with conversions that don't exist yet
      console.log('handleReplaceAllInventory: Checking for missing inventory entries...');
      const existingInventoryProductIds = new Set(updatedInventoryStocks.map(inv => inv.productId));
      
      stockCheck.counts.forEach(count => {
        const productPair = getProductPairForInventory(count.productId);
        if (productPair) {
          const wholeProductId = productPair.wholeProductId;
          if (!existingInventoryProductIds.has(wholeProductId)) {
            const wholeProduct = products.find(p => p.id === wholeProductId);
            console.log('handleReplaceAllInventory: Creating NEW inventory entry for', wholeProduct?.name, '(product was not in inventory)');
            
            const salesOutlets = outlets.filter(o => o.outletType === 'sales');
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: wholeProductId,
              productionWhole: 0,
              productionSlices: 0,
              outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
            existingInventoryProductIds.add(wholeProductId);
            console.log('handleReplaceAllInventory: ✓ Created inventory entry for', wholeProduct?.name);
          }
        }
      });
      
      // Process ALL products with conversions in inventory
      for (const invStock of updatedInventoryStocks) {
        const productPair = getProductPairForInventory(invStock.productId);
        if (productPair) {
          const wholeProductId = productPair.wholeProductId;
          const slicesProductId = productPair.slicesProductId;
          
          // Get quantities from stock check (0 if not present)
          const wholeQty = stockCheckQuantities.get(wholeProductId) || 0;
          const slicesQty = stockCheckQuantities.get(slicesProductId) || 0;
          
          const conversionFactor = getConversionFactor(wholeProductId, slicesProductId) || 10;
          
          let newWhole = Math.floor(wholeQty);
          let newSlices = Math.round((wholeQty % 1) * conversionFactor) + Math.round(slicesQty);
          
          // Normalize slices to whole
          if (newSlices >= conversionFactor) {
            const extraWhole = Math.floor(newSlices / conversionFactor);
            newWhole += extraWhole;
            newSlices = Math.round(newSlices % conversionFactor);
          }
          
          // Update the inventory stock - ALWAYS update to match stock check (even if 0)
          const invIndex = updatedInventoryStocks.findIndex(inv => inv.productId === wholeProductId);
          if (invIndex >= 0) {
            const existingInv = updatedInventoryStocks[invIndex];
            const wholeProduct = products.find(p => p.id === wholeProductId);
            console.log('Replace All: REPLACING', wholeProduct?.name, 'production stock - whole:', newWhole, 'slices:', newSlices, '(was whole:', existingInv.productionWhole, 'slices:', existingInv.productionSlices, ')');
            
            updatedInventoryStocks[invIndex] = {
              ...existingInv,
              productionWhole: newWhole,
              productionSlices: newSlices,
              updatedAt: Date.now(),
            };
          } else {
            // Create new inventory entry if it doesn't exist
            const wholeProduct = products.find(p => p.id === wholeProductId);
            console.log('Replace All: Creating new inventory for', wholeProduct?.name, '- whole:', newWhole, 'slices:', newSlices);
            
            const salesOutlets = outlets.filter(o => o.outletType === 'sales');
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: wholeProductId,
              productionWhole: newWhole,
              productionSlices: newSlices,
              outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
          }
        }
      }
      
      // ALSO process products WITHOUT conversions (Production Stock Other Units)
      console.log('handleReplaceAllInventory: Processing products WITHOUT conversions...');
      const productsWithConversions = new Set<string>();
      productConversions.forEach(conv => {
        productsWithConversions.add(conv.fromProductId);
        productsWithConversions.add(conv.toProductId);
      });
      
      // Create inventory entries for products WITHOUT conversions that don't exist yet
      // IMPORTANT: For production outlets, add with 0 for production, then set value
      // This ensures proper initialization for products that never existed in inventory
      stockCheck.counts.forEach(count => {
        if (!productsWithConversions.has(count.productId)) {
          const product = products.find(p => p.id === count.productId);
          const invIndex = updatedInventoryStocks.findIndex(inv => inv.productId === count.productId);
          
          if (invIndex === -1) {
            // Product doesn't exist in inventory - CREATE IT with 0 first
            console.log('handleReplaceAllInventory: Creating NEW inventory entry for', product?.name, '(no conversion, not in inventory)');
            console.log('handleReplaceAllInventory: Initializing with 0 for production outlet, then will set actual value');
            
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: count.productId,
              productionWhole: 0, // Initialize with 0
              productionSlices: 0,
              outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
            console.log('handleReplaceAllInventory: ✓ Created inventory entry for', product?.name, 'with 0 values');
          }
        }
      });
      
      // Get all products from stock check that don't have conversions
      stockCheck.counts.forEach(count => {
        if (!productsWithConversions.has(count.productId)) {
          const product = products.find(p => p.id === count.productId);
          // CRITICAL: Use count.quantity which is the EDITED Current Stock value
          const currentStock = count.quantity;
          
          console.log('Replace All: Product without conversion:', product?.name, 'currentStock:', currentStock);
          
          // Find or create inventory stock for this product
          const invIndex = updatedInventoryStocks.findIndex(inv => inv.productId === count.productId);
          
          if (invIndex >= 0) {
            // Update existing
            const existingInv = updatedInventoryStocks[invIndex];
            console.log('Replace All: REPLACING production stock for', product?.name, '- new qty:', currentStock, '(was:', existingInv.productionWhole, ')');
            
            updatedInventoryStocks[invIndex] = {
              ...existingInv,
              productionWhole: currentStock,
              productionSlices: 0,
              updatedAt: Date.now(),
            };
          } else {
            // Create new inventory entry
            console.log('Replace All: Creating new inventory for', product?.name, '- qty:', currentStock);
            
            const salesOutlets = outlets.filter(o => o.outletType === 'sales');
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: count.productId,
              productionWhole: currentStock,
              productionSlices: 0,
              outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
          }
        }
      });
      
      // CRITICAL: Set to 0 for ALL products NOT in the stock check
      // This includes both products with conversions AND products without conversions
      console.log('handleReplaceAllInventory: Setting products NOT in stock check to 0...');
      updatedInventoryStocks.forEach((invStock, index) => {
        // For products WITH conversions
        if (productsWithConversions.has(invStock.productId)) {
          const productPair = getProductPairForInventory(invStock.productId);
          if (productPair) {
            const wholeProductId = productPair.wholeProductId;
            const slicesProductId = productPair.slicesProductId;
            
            // Check if BOTH whole and slices are NOT in stock check
            const hasWhole = stockCheckQuantities.has(wholeProductId);
            const hasSlices = stockCheckQuantities.has(slicesProductId);
            
            if (!hasWhole && !hasSlices) {
              // Neither whole nor slices in stock check - set production to 0
              const product = products.find(p => p.id === wholeProductId);
              console.log('Replace All: Setting', product?.name, 'production to 0 (not in stock check)');
              
              updatedInventoryStocks[index] = {
                ...invStock,
                productionWhole: 0,
                productionSlices: 0,
                updatedAt: Date.now(),
              };
            }
          }
        } else {
          // For products WITHOUT conversions (Production Stock Other Units)
          if (!stockCheckQuantities.has(invStock.productId)) {
            // Not in stock check, set to 0
            const product = products.find(p => p.id === invStock.productId);
            console.log('Replace All: Setting', product?.name, 'to 0 (not in stock check)');
            
            updatedInventoryStocks[index] = {
              ...invStock,
              productionWhole: 0,
              productionSlices: 0,
              updatedAt: Date.now(),
            };
          }
        }
      });
      console.log('handleReplaceAllInventory: Finished setting missing products to 0');
    } else if (outlet.outletType === 'sales') {
      console.log('handleReplaceAllInventory: Replacing SALES outlet inventory for:', outlet.name);
      
      // Create inventory entries for products with conversions that don't exist yet
      console.log('handleReplaceAllInventory: Checking for missing inventory entries for sales outlet...');
      const existingInventoryProductIds = new Set(updatedInventoryStocks.map(inv => inv.productId));
      
      stockCheck.counts.forEach(count => {
        const productPair = getProductPairForInventory(count.productId);
        if (productPair) {
          const wholeProductId = productPair.wholeProductId;
          if (!existingInventoryProductIds.has(wholeProductId)) {
            const wholeProduct = products.find(p => p.id === wholeProductId);
            console.log('handleReplaceAllInventory: Creating NEW inventory entry for', wholeProduct?.name, '(product was not in inventory)');
            
            const salesOutlets = outlets.filter(o => o.outletType === 'sales');
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: wholeProductId,
              productionWhole: 0,
              productionSlices: 0,
              outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
            existingInventoryProductIds.add(wholeProductId);
            console.log('handleReplaceAllInventory: ✓ Created inventory entry for', wholeProduct?.name);
          }
        }
      });
      
      // Process ALL products with conversions in inventory
      for (const invStock of updatedInventoryStocks) {
        const productPair = getProductPairForInventory(invStock.productId);
        if (productPair) {
          const wholeProductId = productPair.wholeProductId;
          const slicesProductId = productPair.slicesProductId;
          
          // Get quantities from stock check (0 if not present)
          const wholeQty = stockCheckQuantities.get(wholeProductId) || 0;
          const slicesQty = stockCheckQuantities.get(slicesProductId) || 0;
          
          const conversionFactor = getConversionFactor(wholeProductId, slicesProductId) || 10;
          
          let newWhole = Math.floor(wholeQty);
          let newSlices = Math.round((wholeQty % 1) * conversionFactor) + Math.round(slicesQty);
          
          // Normalize slices to whole
          if (newSlices >= conversionFactor) {
            const extraWhole = Math.floor(newSlices / conversionFactor);
            newWhole += extraWhole;
            newSlices = Math.round(newSlices % conversionFactor);
          }
          
          // Find or create outlet stock entry
          const outletStockIndex = invStock.outletStocks.findIndex(os => os.outletName === outlet.name);
          const updatedOutletStocks = [...invStock.outletStocks];
          
          if (outletStockIndex >= 0) {
            const wholeProduct = products.find(p => p.id === wholeProductId);
            console.log('Replace All: REPLACING', wholeProduct?.name, 'outlet stock for', outlet.name, '- whole:', newWhole, 'slices:', newSlices, '(was whole:', updatedOutletStocks[outletStockIndex].whole, 'slices:', updatedOutletStocks[outletStockIndex].slices, ')');
            
            updatedOutletStocks[outletStockIndex] = {
              ...updatedOutletStocks[outletStockIndex],
              whole: newWhole,
              slices: newSlices,
            };
          } else {
            const wholeProduct = products.find(p => p.id === wholeProductId);
            console.log('Replace All: Creating new outlet stock for', wholeProduct?.name, 'at', outlet.name, '- whole:', newWhole, 'slices:', newSlices);
            
            updatedOutletStocks.push({
              outletName: outlet.name,
              whole: newWhole,
              slices: newSlices,
            });
          }
          
          // Update the inventory stock with the new outlet stocks
          const invIndex = updatedInventoryStocks.findIndex(inv => inv.productId === wholeProductId);
          if (invIndex >= 0) {
            updatedInventoryStocks[invIndex] = {
              ...updatedInventoryStocks[invIndex],
              outletStocks: updatedOutletStocks,
              updatedAt: Date.now(),
            };
          }
        }
      }
      
      // ALSO process products WITHOUT conversions for sales outlets (Production Stock Other Units)
      console.log('handleReplaceAllInventory: Processing products WITHOUT conversions for sales outlet...');
      const productsWithConversions = new Set<string>();
      productConversions.forEach(conv => {
        productsWithConversions.add(conv.fromProductId);
        productsWithConversions.add(conv.toProductId);
      });
      
      console.log('handleReplaceAllInventory: Products with conversions:', productsWithConversions.size);
      console.log('handleReplaceAllInventory: Stock check counts:', stockCheck.counts.length);
      console.log('handleReplaceAllInventory: Current inventory stocks:', updatedInventoryStocks.length);
      
      // CRITICAL: First, create inventory entries for products WITHOUT conversions that don't exist yet
      // This is needed for sales outlets to add products with 0 for production first
      stockCheck.counts.forEach(count => {
        const hasConversion = productsWithConversions.has(count.productId);
        if (!hasConversion) {
          const invIndex = updatedInventoryStocks.findIndex(inv => inv.productId === count.productId);
          if (invIndex === -1) {
            const product = products.find(p => p.id === count.productId);
            console.log('handleReplaceAllInventory: Creating NEW inventory entry for sales outlet -', product?.name, '(no conversion, not in inventory)');
            console.log('handleReplaceAllInventory: Initializing with 0 for production outlet first');
            
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: count.productId,
              productionWhole: 0, // Initialize with 0 for production
              productionSlices: 0,
              outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
            console.log('handleReplaceAllInventory: ✓ Created inventory entry with 0 for production outlet for', product?.name);
          }
        }
      });
      
      // Now process all products from stock check that don't have conversions
      stockCheck.counts.forEach(count => {
        const hasConversion = productsWithConversions.has(count.productId);
        const product = products.find(p => p.id === count.productId);
        console.log('handleReplaceAllInventory: Processing count - product:', product?.name, 'id:', count.productId, 'hasConversion:', hasConversion, 'qty:', count.quantity);
        
        if (!hasConversion) {
          const qty = count.quantity || 0;
          
          console.log('Replace All: Product WITHOUT conversion for sales outlet:', product?.name, 'qty:', qty);
          
          // Find inventory stock for this product (should exist now after creation step above)
          let invIndex = updatedInventoryStocks.findIndex(inv => inv.productId === count.productId);
          console.log('Replace All: Looking for inventory with productId:', count.productId, 'found at index:', invIndex);
          
          if (invIndex >= 0) {
            // Update existing
            const existingInv = updatedInventoryStocks[invIndex];
            const outletStockIndex = existingInv.outletStocks.findIndex(os => os.outletName === outlet.name);
            const updatedOutletStocks = [...existingInv.outletStocks];
            
            console.log('Replace All: Found existing inventory, outlet stock index:', outletStockIndex, 'outlet stocks count:', existingInv.outletStocks.length);
            
            if (outletStockIndex >= 0) {
              const oldWhole = updatedOutletStocks[outletStockIndex].whole;
              console.log('Replace All: REPLACING outlet stock for', product?.name, 'at', outlet.name, '- new qty:', qty, '(was:', oldWhole, ')');
              
              updatedOutletStocks[outletStockIndex] = {
                ...updatedOutletStocks[outletStockIndex],
                whole: qty,
                slices: 0,
              };
            } else {
              console.log('Replace All: Creating new outlet stock entry for', product?.name, 'at', outlet.name, '- qty:', qty);
              
              updatedOutletStocks.push({
                outletName: outlet.name,
                whole: qty,
                slices: 0,
              });
            }
            
            updatedInventoryStocks[invIndex] = {
              ...existingInv,
              outletStocks: updatedOutletStocks,
              updatedAt: Date.now(),
            };
            console.log('Replace All: ✓ Updated existing inventory stock for', product?.name);
          } else {
            // Create new inventory entry
            console.log('Replace All: No inventory entry exists - Creating NEW inventory entry for', product?.name, 'at', outlet.name, '- qty:', qty);
            
            // Get all sales outlets to initialize empty stocks for them
            const allSalesOutlets = outlets.filter(o => o.outletType === 'sales');
            console.log('Replace All: Initializing outlet stocks for', allSalesOutlets.length, 'sales outlets');
            
            const outletStocks = allSalesOutlets.map(o => {
              const isCurrentOutlet = o.name === outlet.name;
              console.log('Replace All: Outlet', o.name, 'is current:', isCurrentOutlet, 'qty:', isCurrentOutlet ? qty : 0);
              return {
                outletName: o.name,
                whole: isCurrentOutlet ? qty : 0,
                slices: 0,
              };
            });
            
            const newInv: InventoryStock = {
              id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: count.productId,
              productionWhole: 0,
              productionSlices: 0,
              outletStocks: outletStocks,
              updatedAt: Date.now(),
            };
            updatedInventoryStocks.push(newInv);
            console.log('Replace All: ✓ Created new inventory entry with', outletStocks.length, 'outlet stocks for', product?.name);
            
            // Update invIndex since we just added a new item
            invIndex = updatedInventoryStocks.length - 1;
          }
        }
      });
      
      console.log('handleReplaceAllInventory: Finished processing stock check counts');
      console.log('handleReplaceAllInventory: Now setting products NOT in stock check to 0...');
      
      // CRITICAL: Set to 0 for ALL products WITHOUT conversions NOT in the stock check
      for (let index = 0; index < updatedInventoryStocks.length; index++) {
        const invStock = updatedInventoryStocks[index];
        if (!productsWithConversions.has(invStock.productId)) {
          // This is a product without conversions (Production Stock Other Units)
          if (!stockCheckQuantities.has(invStock.productId)) {
            // Not in stock check, set outlet stock to 0
            const product = products.find(p => p.id === invStock.productId);
            console.log('Replace All: Setting', product?.name, 'to 0 at', outlet.name, '(not in stock check)');
            
            const outletStockIndex = invStock.outletStocks.findIndex(os => os.outletName === outlet.name);
            const updatedOutletStocks = [...invStock.outletStocks];
            
            if (outletStockIndex >= 0) {
              updatedOutletStocks[outletStockIndex] = {
                ...updatedOutletStocks[outletStockIndex],
                whole: 0,
                slices: 0,
              };
              
              updatedInventoryStocks[index] = {
                ...invStock,
                outletStocks: updatedOutletStocks,
                updatedAt: Date.now(),
              };
            } else {
              // Create outlet stock entry if it doesn't exist and set to 0
              console.log('Replace All: Creating outlet stock entry (set to 0) for', product?.name, 'at', outlet.name);
              updatedOutletStocks.push({
                outletName: outlet.name,
                whole: 0,
                slices: 0,
              });
              
              updatedInventoryStocks[index] = {
                ...invStock,
                outletStocks: updatedOutletStocks,
                updatedAt: Date.now(),
              };
            }
          }
        }
      }
      
      console.log('handleReplaceAllInventory: Finished setting products without conversions to 0');
      console.log('handleReplaceAllInventory: Updated inventory stocks count:', updatedInventoryStocks.length);
      
      // CRITICAL: Set to 0 for ALL products NOT in the stock check for sales outlets
      console.log('handleReplaceAllInventory: Setting products with conversions to 0 if not in stock check...');
      updatedInventoryStocks.forEach((invStock, index) => {
        if (productsWithConversions.has(invStock.productId)) {
          const productPair = getProductPairForInventory(invStock.productId);
          if (productPair) {
            const wholeProductId = productPair.wholeProductId;
            const slicesProductId = productPair.slicesProductId;
            
            // Check if BOTH whole and slices are NOT in stock check
            const hasWhole = stockCheckQuantities.has(wholeProductId);
            const hasSlices = stockCheckQuantities.has(slicesProductId);
            
            if (!hasWhole && !hasSlices) {
              // Neither whole nor slices in stock check - set outlet stock to 0
              const product = products.find(p => p.id === wholeProductId);
              console.log('Replace All: Setting', product?.name, 'to 0 at', outlet.name, '(not in stock check)');
              
              const outletStockIndex = invStock.outletStocks.findIndex(os => os.outletName === outlet.name);
              const updatedOutletStocks = [...invStock.outletStocks];
              
              if (outletStockIndex >= 0) {
                updatedOutletStocks[outletStockIndex] = {
                  ...updatedOutletStocks[outletStockIndex],
                  whole: 0,
                  slices: 0,
                };
                
                updatedInventoryStocks[index] = {
                  ...invStock,
                  outletStocks: updatedOutletStocks,
                  updatedAt: Date.now(),
                };
              } else {
                // Create outlet stock entry if it doesn't exist
                console.log('Replace All: Creating outlet stock entry (set to 0) for', product?.name, 'at', outlet.name);
                updatedOutletStocks.push({
                  outletName: outlet.name,
                  whole: 0,
                  slices: 0,
                });
                
                updatedInventoryStocks[index] = {
                  ...invStock,
                  outletStocks: updatedOutletStocks,
                  updatedAt: Date.now(),
                };
              }
            }
          }
        }
      });
    }
    
    console.log('handleReplaceAllInventory: Saving updated inventory stocks...');
    await saveInventoryStocks(updatedInventoryStocks);
    console.log('handleReplaceAllInventory: Successfully replaced all inventory for', outlet.name);
  }, [products, outlets, getProductPairForInventory, getConversionFactor, saveInventoryStocks, productConversions]);

  const addRequest = useCallback(async (request: ProductRequest) => {
    try {
      const requestWithTimestamp = {
        ...request,
        updatedAt: request.updatedAt || Date.now(),
      };
      const updatedRequests = [...requests, requestWithTimestamp];
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(updatedRequests));
      setRequests(updatedRequests);

      console.log('addRequest: Saved locally, syncing immediately...');
      if (currentUser && syncAllRef.current && !syncInProgressRef.current) {
        syncAllRef.current().catch(e => console.error('addRequest: Sync failed', e));
      }
    } catch (error) {
      console.error('Failed to add request:', error);
      throw error;
    }
  }, [requests, currentUser]);

  const updateRequestStatus = useCallback(async (
    requestId: string,
    status: ProductRequest['status']
  ) => {
    try {
      const updatedRequests = requests.map(r =>
        r.id === requestId ? { ...r, status, updatedAt: Date.now() } : r
      );
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(updatedRequests));
      setRequests(updatedRequests);

      console.log('updateRequestStatus: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to update request status:', error);
      throw error;
    }
  }, [requests, currentUser]);

  const deleteRequest = useCallback(async (requestId: string) => {
    console.log('========================================');
    console.log('StockContext deleteRequest: ENTER - Starting deletion for', requestId);
    try {
      const allRequests = await AsyncStorage.getItem(STORAGE_KEYS.REQUESTS);
      console.log('StockContext deleteRequest: Retrieved from storage');
      const existingRequests: ProductRequest[] = allRequests ? JSON.parse(allRequests) : [];
      
      console.log('StockContext deleteRequest: Total requests in storage:', existingRequests.length);
      const requestToDelete = existingRequests.find(r => r.id === requestId);
      
      if (!requestToDelete) {
        console.log('StockContext deleteRequest: ERROR - Request not found in storage!');
        throw new Error('Request not found');
      }
      
      console.log('StockContext deleteRequest: Found request to delete:', {
        id: requestToDelete.id,
        productId: requestToDelete.productId,
        status: requestToDelete.status,
        deleted: requestToDelete.deleted
      });
      
      console.log('StockContext deleteRequest: Marking request as deleted...');
      const updatedRequests = existingRequests.map(r => 
        r.id === requestId ? { ...r, deleted: true as const, updatedAt: Date.now() } : r
      );
      
      const deletedCount = updatedRequests.filter(r => r.deleted).length;
      const activeCount = updatedRequests.filter(r => !r.deleted).length;
      console.log('StockContext deleteRequest: After marking - deleted:', deletedCount, 'active:', activeCount);
      
      console.log('StockContext deleteRequest: Saving to AsyncStorage...');
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(updatedRequests));
      console.log('StockContext deleteRequest: ✓ Saved to local storage');
      
      console.log('StockContext deleteRequest: Filtering active requests for UI...');
      const activeRequests = updatedRequests.filter(r => !r.deleted);
      console.log('StockContext deleteRequest: Updating React state with', activeRequests.length, 'active requests');
      setRequests(activeRequests);
      console.log('StockContext deleteRequest: ✓ React state updated');

      console.log('StockContext deleteRequest: Triggering immediate sync...');
      if (currentUser && syncAllRef.current && !syncInProgressRef.current) {
        console.log('StockContext deleteRequest: Calling syncAll...');
        syncAllRef.current().catch(e => console.error('StockContext deleteRequest: Sync error', e));
      } else {
        console.log('StockContext deleteRequest: Sync skipped - currentUser:', !!currentUser, 'syncAllRef:', !!syncAllRef.current, 'syncInProgress:', syncInProgressRef.current);
      }
      
      console.log('StockContext deleteRequest: ✓✓✓ COMPLETE - request successfully deleted');
      console.log('========================================');
    } catch (error) {
      console.error('========================================');
      console.error('StockContext deleteRequest: ❌ FAILED - Error:', error);
      console.error('========================================');
      throw error;
    }
  }, [currentUser]);

  const updateRequest = useCallback(async (requestId: string, updates: Partial<ProductRequest>) => {
    try {
      const updatedRequests = requests.map(r =>
        r.id === requestId ? { ...r, ...updates, updatedAt: Date.now() } : r
      );
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(updatedRequests));
      setRequests(updatedRequests);

      console.log('updateRequest: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to update request:', error);
      throw error;
    }
  }, [requests]);

  const addRequestsToDate = useCallback(async (date: string, newRequests: ProductRequest[]) => {
    try {
      const updatedRequests = [...requests, ...newRequests];
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(updatedRequests));
      setRequests(updatedRequests);

      console.log('addRequestsToDate: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to add requests:', error);
      throw error;
    }
  }, [requests]);

  const deleteStockCheck = useCallback(async (checkId: string) => {
    try {
      console.log('\n=== deleteStockCheck START ===');
      console.log('Deleting stock check ID:', checkId);
      
      const updatedChecks = stockChecks.map(c => 
        c.id === checkId ? { ...c, deleted: true as const, updatedAt: Date.now() } : c
      );
      
      // CRITICAL: Sync OUT first before updating local storage
      console.log('deleteStockCheck: Syncing deletion to server BEFORE updating local storage...');
      if (currentUser?.id) {
        try {
          await syncData('stockChecks', updatedChecks, currentUser.id);
          console.log('deleteStockCheck: Successfully synced deletion to server');
        } catch (syncError) {
          console.error('deleteStockCheck: Sync failed, but continuing with local deletion:', syncError);
        }
      }
      
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(updatedChecks));
      const activeChecks = updatedChecks.filter(c => !c.deleted);
      setStockChecks(activeChecks);

      console.log('deleteStockCheck: Deleted locally and synced to server');
      
      if (activeChecks.length > 0) {
        const sortedChecks = [...activeChecks].sort((a: StockCheck, b: StockCheck) => b.timestamp - a.timestamp);
        const latestCheck = sortedChecks[0];
        
        const stockMap = new Map<string, number>();
        latestCheck.counts.forEach((count: StockCount) => {
          stockMap.set(count.productId, count.quantity);
        });
        
        setCurrentStockCounts(stockMap);
      } else {
        setCurrentStockCounts(new Map());
      }
      
      console.log('=== deleteStockCheck COMPLETE ===\n');
    } catch (error) {
      console.error('Failed to delete stock check:', error);
      throw error;
    }
  }, [stockChecks, currentUser]);

  const updateStockCheck = useCallback(async (checkId: string, newCounts: StockCount[], newOutlet?: string, outletChanged?: boolean, replaceAllInventory?: boolean) => {
    try {
      console.log('\n=== updateStockCheck START ===');
      console.log('Updating stock check ID:', checkId);
      
      const originalCheck = stockChecks.find(c => c.id === checkId);
      if (!originalCheck) {
        console.log('updateStockCheck: Stock check not found:', checkId);
        return;
      }
      
      console.log('Original outlet:', originalCheck.outlet);
      console.log('New outlet:', newOutlet);
      console.log('replaceAllInventory flag (from param):', replaceAllInventory);
      console.log('replaceAllInventory flag (original):', originalCheck.replaceAllInventory);
      
      // CRITICAL: Read fresh data from AsyncStorage to prevent race conditions
      console.log('updateStockCheck: Reading fresh stock checks from storage to prevent data loss...');
      const storedChecks = await AsyncStorage.getItem(STORAGE_KEYS.STOCK_CHECKS);
      const freshStockChecks = storedChecks ? JSON.parse(storedChecks) : stockChecks;
      console.log('updateStockCheck: Using', freshStockChecks.length, 'stock checks from storage');
      
      const updatedChecks = freshStockChecks.map((check: StockCheck) =>
        check.id === checkId ? { ...check, counts: newCounts, outlet: newOutlet !== undefined ? newOutlet : check.outlet, replaceAllInventory: replaceAllInventory !== undefined ? replaceAllInventory : check.replaceAllInventory, updatedAt: Date.now() } : check
      );
      
      // CRITICAL: Sync OUT first before updating local storage
      console.log('updateStockCheck: Syncing update to server BEFORE updating local storage...');
      if (currentUser?.id) {
        try {
          await syncData('stockChecks', updatedChecks, currentUser.id);
          console.log('updateStockCheck: Successfully synced update to server');
        } catch (syncError) {
          console.error('updateStockCheck: Sync failed, but continuing with local update:', syncError);
        }
      }
      
      // Batch state and storage updates
      console.log('updateStockCheck: Updating local storage and state...');
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(updatedChecks));
      setStockChecks(updatedChecks);
      
      console.log('updateStockCheck: Stock check updated for date:', originalCheck.date);
      console.log('updateStockCheck: Next day will use this closing stock as opening stock (including product conversions)');
      console.log('updateStockCheck: Live inventory will calculate propagation on-demand for performance')

      // Handle Replace All Inventory if the flag is ON
      if (replaceAllInventory) {
        console.log('\n=== UPDATE: REPLACE ALL INVENTORY MODE ===');
        const updatedCheck = updatedChecks.find((c: StockCheck) => c.id === checkId);
        if (updatedCheck) {
          const outlet = outlets.find(o => o.name === (newOutlet || originalCheck.outlet));
          if (outlet) {
            console.log('Calling handleReplaceAllInventory for outlet:', outlet.name);
            await handleReplaceAllInventory(updatedCheck, outlet, inventoryStocks);
            console.log('=== UPDATE: REPLACE ALL INVENTORY COMPLETE ===\n');
          }
        }
      } else if (outletChanged && originalCheck && newOutlet && originalCheck.outlet !== newOutlet) {
        console.log('updateStockCheck: Outlet changed from', originalCheck.outlet, 'to', newOutlet);
        console.log('updateStockCheck: Moving stock quantities to new outlet in inventory');
        
        let updatedInventoryStocks = [...inventoryStocks];
        
        for (const count of newCounts) {
          const productPair = getProductPairForInventory(count.productId);
          if (!productPair) {
            console.log('updateStockCheck: Product', count.productId, 'not in inventory system, skipping');
            continue;
          }
          
          const invStock = updatedInventoryStocks.find(s => s.productId === productPair.wholeProductId);
          if (!invStock) {
            console.log('updateStockCheck: Inventory stock not found for product', productPair.wholeProductId, ', skipping');
            continue;
          }
          
          const conversionFactor = getConversionFactor(productPair.wholeProductId, productPair.slicesProductId) || 10;
          const isWholeProduct = count.productId === productPair.wholeProductId;
          
          let wholeToMove = 0;
          let slicesToMove = 0;
          
          if (isWholeProduct) {
            wholeToMove = Math.floor(count.quantity);
            slicesToMove = Math.round((count.quantity % 1) * conversionFactor);
          } else {
            const totalSlices = Math.round(count.quantity);
            wholeToMove = Math.floor(totalSlices / conversionFactor);
            slicesToMove = Math.round(totalSlices % conversionFactor);
          }
          
          console.log('updateStockCheck: Moving', wholeToMove, 'whole +', slicesToMove, 'slices from', originalCheck.outlet, 'to', newOutlet);
          
          const oldOutletStock = invStock.outletStocks.find(o => o.outletName === originalCheck.outlet);
          if (oldOutletStock) {
            let totalSlicesInOldOutlet = oldOutletStock.whole * conversionFactor + oldOutletStock.slices;
            const totalSlicesToMove = wholeToMove * conversionFactor + slicesToMove;
            
            totalSlicesInOldOutlet -= totalSlicesToMove;
            
            if (totalSlicesInOldOutlet < 0) totalSlicesInOldOutlet = 0;
            
            oldOutletStock.whole = Math.floor(totalSlicesInOldOutlet / conversionFactor);
            oldOutletStock.slices = Math.round(totalSlicesInOldOutlet % conversionFactor);
            console.log('updateStockCheck: Updated old outlet', originalCheck.outlet, '- whole:', oldOutletStock.whole, 'slices:', oldOutletStock.slices);
          }
          
          const newOutletStock = invStock.outletStocks.find(o => o.outletName === newOutlet);
          if (newOutletStock) {
            newOutletStock.whole += wholeToMove;
            newOutletStock.slices += slicesToMove;
            
            if (newOutletStock.slices >= conversionFactor) {
              const extraWhole = Math.floor(newOutletStock.slices / conversionFactor);
              newOutletStock.whole += extraWhole;
              newOutletStock.slices = Math.round(newOutletStock.slices % conversionFactor);
            }
            console.log('updateStockCheck: Updated new outlet', newOutlet, '- whole:', newOutletStock.whole, 'slices:', newOutletStock.slices);
          } else {
            invStock.outletStocks.push({
              outletName: newOutlet,
              whole: wholeToMove,
              slices: slicesToMove,
            });
            console.log('updateStockCheck: Created new outlet stock for', newOutlet, '- whole:', wholeToMove, 'slices:', slicesToMove);
          }
        }
        
        await saveInventoryStocks(updatedInventoryStocks);
        console.log('updateStockCheck: Inventory stocks updated successfully');
      }

      console.log('updateStockCheck: Saved locally, will sync on next interval');
      
      const sortedChecks = [...updatedChecks].sort((a: StockCheck, b: StockCheck) => b.timestamp - a.timestamp);
      if (sortedChecks.length > 0 && sortedChecks[0].id === checkId) {
        const stockMap = new Map<string, number>();
        newCounts.forEach((count: StockCount) => {
          stockMap.set(count.productId, count.quantity);
        });
        setCurrentStockCounts(stockMap);
      }
    } catch (error) {
      console.error('Failed to update stock check:', error);
      throw error;
    }
  }, [stockChecks, inventoryStocks, getProductPairForInventory, getConversionFactor, saveInventoryStocks, currentUser]);

  const getLowStockItems = useCallback(() => {
    return products
      .filter(p => p.minStock !== undefined)
      .map(product => {
        const currentStock = currentStockCounts.get(product.id) || 0;
        return {
          product,
          currentStock,
          minStock: product.minStock!,
        };
      })
      .filter(item => item.currentStock < item.minStock);
  }, [products, currentStockCounts]);

  const getTodayStockCheck = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    return stockChecks.find(check => check.date === today);
  }, [stockChecks]);

  const addOutlet = useCallback(async (outlet: Outlet) => {
    try {
      const outletWithTimestamp = {
        ...outlet,
        updatedAt: outlet.updatedAt || Date.now(),
      };
      const updatedOutlets = [...outlets, outletWithTimestamp];
      await AsyncStorage.setItem(STORAGE_KEYS.OUTLETS, JSON.stringify(updatedOutlets));
      setOutlets(updatedOutlets.filter(o => !o.deleted));

      console.log('addOutlet: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to add outlet:', error);
      throw error;
    }
  }, [outlets, currentUser]);

  const updateOutlet = useCallback(async (outletId: string, updates: Partial<Outlet>) => {
    try {
      const updatedOutlets = outlets.map(o =>
        o.id === outletId ? { ...o, ...updates, updatedAt: Date.now() } : o
      );
      await AsyncStorage.setItem(STORAGE_KEYS.OUTLETS, JSON.stringify(updatedOutlets));
      setOutlets(updatedOutlets.filter(o => !o.deleted));

      console.log('updateOutlet: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to update outlet:', error);
      throw error;
    }
  }, [outlets, currentUser]);

  const deleteOutlet = useCallback(async (outletId: string) => {
    try {
      const updatedOutlets = outlets.map(o => o.id === outletId ? { ...o, deleted: true as const, updatedAt: Date.now() } : o);
      await AsyncStorage.setItem(STORAGE_KEYS.OUTLETS, JSON.stringify(updatedOutlets));
      setOutlets(updatedOutlets.filter(o => !o.deleted));

      console.log('deleteOutlet: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to delete outlet:', error);
      throw error;
    }
  }, [outlets, currentUser]);

  const clearAllData = useCallback(async () => {
    try {
      console.log('clearAllData: Starting...');
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.PRODUCTS),
        AsyncStorage.removeItem(STORAGE_KEYS.STOCK_CHECKS),
        AsyncStorage.removeItem(STORAGE_KEYS.REQUESTS),
        AsyncStorage.removeItem(STORAGE_KEYS.OUTLETS),
      ]);
      setProducts([]);
      setStockChecks([]);
      setRequests([]);
      setOutlets([]);
      setCurrentStockCounts(new Map());
      console.log('clearAllData: Complete');
    } catch (error) {
      console.error('Failed to clear data:', error);
      throw error;
    }
  }, []);

  const clearAllProducts = useCallback(async () => {
    try {
      console.log('clearAllProducts: Starting...');
      const allDeletedProducts = products.map(p => ({ ...p, deleted: true as const, updatedAt: Date.now() }));
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(allDeletedProducts));
      setProducts([]);

      if (currentUser?.id) {
        syncData('products', allDeletedProducts, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }).catch(syncError => {
          console.error('clearAllProducts: Sync failed', syncError);
        });
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCTS);
      console.log('clearAllProducts: Complete');
    } catch (error) {
      console.error('Failed to clear all products:', error);
      throw error;
    }
  }, [products, currentUser]);

  const clearAllProductConversions = useCallback(async () => {
    try {
      console.log('clearAllProductConversions: Starting...');
      const allDeletedConversions = productConversions.map(c => ({ ...c, deleted: true as const, updatedAt: Date.now() }));
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCT_CONVERSIONS, JSON.stringify(allDeletedConversions));
      setProductConversions([]);

      if (currentUser?.id) {
        syncData('productConversions', allDeletedConversions, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }).catch(syncError => {
          console.error('clearAllProductConversions: Sync failed', syncError);
        });
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCT_CONVERSIONS);
      console.log('clearAllProductConversions: Complete');
    } catch (error) {
      console.error('Failed to clear all product conversions:', error);
      throw error;
    }
  }, [productConversions, currentUser]);

  const clearAllOutlets = useCallback(async () => {
    try {
      console.log('clearAllOutlets: Starting...');
      const allDeletedOutlets = outlets.map(o => ({ ...o, deleted: true as const, updatedAt: Date.now() }));
      await AsyncStorage.setItem(STORAGE_KEYS.OUTLETS, JSON.stringify(allDeletedOutlets));
      setOutlets([]);

      if (currentUser?.id) {
        syncData('outlets', allDeletedOutlets, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }).catch(syncError => {
          console.error('clearAllOutlets: Sync failed', syncError);
        });
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.OUTLETS);
      console.log('clearAllOutlets: Complete');
    } catch (error) {
      console.error('Failed to clear all outlets:', error);
      throw error;
    }
  }, [outlets, currentUser]);

  const deleteAllStockChecks = useCallback(async () => {
    try {
      console.log('deleteAllStockChecks: Starting...');
      const allDeletedStockChecks = stockChecks.map(c => ({ ...c, deleted: true as const, updatedAt: Date.now() }));
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(allDeletedStockChecks));
      setStockChecks([]);
      setCurrentStockCounts(new Map());

      if (currentUser?.id) {
        syncData('stockChecks', allDeletedStockChecks, currentUser.id).catch(syncError => {
          console.error('deleteAllStockChecks: Sync failed', syncError);
        });
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.STOCK_CHECKS);
      console.log('deleteAllStockChecks: Complete');
    } catch (error) {
      console.error('Failed to delete all stock checks:', error);
      throw error;
    }
  }, [stockChecks, currentUser]);

  const deleteAllRequests = useCallback(async () => {
    try {
      console.log('deleteAllRequests: Starting...');
      const allDeletedRequests = requests.map(r => ({ ...r, deleted: true as const, updatedAt: Date.now() }));
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(allDeletedRequests));
      setRequests([]);

      if (currentUser?.id) {
        syncData('requests', allDeletedRequests, currentUser.id).catch(syncError => {
          console.error('deleteAllRequests: Sync failed', syncError);
        });
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.REQUESTS);
      console.log('deleteAllRequests: Complete');
    } catch (error) {
      console.error('Failed to delete all requests:', error);
      throw error;
    }
  }, [requests, currentUser]);

  const deleteUserStockChecks = useCallback(async (userId: string) => {
    try {
      const updatedChecks = stockChecks.filter(check => check.completedBy !== userId);
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(updatedChecks));
      setStockChecks(updatedChecks);
      
      if (updatedChecks.length > 0) {
        const sortedChecks = [...updatedChecks].sort((a: StockCheck, b: StockCheck) => b.timestamp - a.timestamp);
        const latestCheck = sortedChecks[0];
        
        const stockMap = new Map<string, number>();
        latestCheck.counts.forEach((count: StockCount) => {
          stockMap.set(count.productId, count.quantity);
        });
        
        setCurrentStockCounts(stockMap);
      } else {
        setCurrentStockCounts(new Map());
      }
    } catch (error) {
      console.error('Failed to delete user stock checks:', error);
      throw error;
    }
  }, [stockChecks]);

  const toggleShowProductList = useCallback(async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SHOW_PRODUCT_LIST, value ? 'true' : 'false');
      setShowProductList(value);
    } catch (error) {
      console.error('Failed to save show product list setting:', error);
      throw error;
    }
  }, []);

  const setViewMode = useCallback(async (mode: 'search' | 'button') => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
      setViewModeState(mode);
    } catch (error) {
      console.error('Failed to save view mode setting:', error);
      throw error;
    }
  }, []);

  const saveProductConversions = useCallback(async (conversions: ProductConversion[]) => {
    try {
      const conversionsWithTimestamp = conversions.map(c => ({
        ...c,
        updatedAt: c.updatedAt || Date.now(),
      }));
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCT_CONVERSIONS, JSON.stringify(conversionsWithTimestamp));
      setProductConversions(conversionsWithTimestamp.filter(c => !c.deleted));

      console.log('saveProductConversions: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to save product conversions:', error);
      throw error;
    }
  }, [currentUser]);

  const addProductConversion = useCallback(async (conversion: ProductConversion) => {
    const updatedConversions = [...productConversions, conversion];
    await saveProductConversions(updatedConversions);
  }, [productConversions, saveProductConversions]);

  const addProductConversionsBulk = useCallback(async (conversions: ProductConversion[]) => {
    const updatedConversions = [...productConversions, ...conversions];
    await saveProductConversions(updatedConversions);
  }, [productConversions, saveProductConversions]);

  const updateProductConversion = useCallback(async (conversionId: string, updates: Partial<ProductConversion>) => {
    const updatedConversions = productConversions.map(c =>
      c.id === conversionId ? { ...c, ...updates, updatedAt: Date.now() } : c
    );
    await saveProductConversions(updatedConversions);
  }, [productConversions, saveProductConversions]);

  const deleteProductConversion = useCallback(async (conversionId: string) => {
    const updatedConversions = productConversions.map(c =>
      c.id === conversionId ? { ...c, deleted: true as const, updatedAt: Date.now() } : c
    );
    await saveProductConversions(updatedConversions as any);
  }, [productConversions, saveProductConversions]);

  const updateInventoryStock = useCallback(async (productId: string, updates: Partial<InventoryStock>) => {
    const updated = inventoryStocks.map(s => 
      s.productId === productId ? { ...s, ...updates, updatedAt: Date.now() } : s
    );
    await saveInventoryStocks(updated);
  }, [inventoryStocks, saveInventoryStocks]);

  const deductInventoryFromApproval = useCallback(async (request: ProductRequest): Promise<{ success: boolean; message?: string }> => {
    try {
      console.log('deductInventoryFromApproval: Starting for request', request.id, 'product', request.productId, 'qty', request.quantity);
      const product = products.find(p => p.id === request.productId);
      if (!product) {
        console.log('deductInventoryFromApproval: Product not found');
        return { success: false, message: 'Product not found' };
      }

      console.log('deductInventoryFromApproval: Product found:', product.name, product.unit);
      console.log('deductInventoryFromApproval: From outlet:', request.fromOutlet, 'To outlet:', request.toOutlet);

      const fromOutlet = outlets.find(o => o.name === request.fromOutlet);
      const toOutlet = outlets.find(o => o.name === request.toOutlet);
      
      if (!fromOutlet) {
        console.log('deductInventoryFromApproval: From outlet not found');
        return { success: false, message: `Outlet "${request.fromOutlet}" not found` };
      }
      
      if (!toOutlet) {
        console.log('deductInventoryFromApproval: To outlet not found');
        return { success: false, message: `Outlet "${request.toOutlet}" not found` };
      }

      console.log('deductInventoryFromApproval: From outlet type:', fromOutlet.outletType, 'To outlet type:', toOutlet.outletType);

      const productPair = getProductPairForInventory(request.productId);
      
      if (!productPair) {
        console.log('deductInventoryFromApproval: No product pair found - This is a Production Stock (Other Units) product');
        
        const isSalesToSalesTransfer = fromOutlet.outletType === 'sales' && toOutlet.outletType === 'sales';
        console.log('deductInventoryFromApproval: Is sales-to-sales transfer:', isSalesToSalesTransfer);
        
        let totalAvailableQty = 0;
        const sourceStockChecks: { check: StockCheck; availableQty: number }[] = [];
        
        if (isSalesToSalesTransfer) {
          console.log('deductInventoryFromApproval: Checking stock in FROM sales outlet:', request.fromOutlet);
          
          const fromOutletStockChecks = stockChecks.filter(c => c.outlet === request.fromOutlet);
          console.log('deductInventoryFromApproval: Found', fromOutletStockChecks.length, 'stock checks for FROM sales outlet');
          
          fromOutletStockChecks.forEach(check => {
            const count = check.counts.find(c => c.productId === request.productId);
            if (count) {
              const receivedStock = count.receivedStock || 0;
              const wastage = count.wastage || 0;
              const currentQty = count.quantity || 0;
              
              const netStock = Math.max(receivedStock - wastage, currentQty);
              console.log('deductInventoryFromApproval: Stock check', check.id, '- receivedStock:', receivedStock, 'wastage:', wastage, 'quantity:', currentQty, 'netStock:', netStock);
              
              if (netStock > 0) {
                totalAvailableQty += netStock;
                sourceStockChecks.push({ check, availableQty: netStock });
              }
            }
          });
          
          console.log('deductInventoryFromApproval: Total available qty in FROM sales outlet:', totalAvailableQty);
          
          if (totalAvailableQty < request.quantity) {
            return { success: false, message: `Insufficient stock in "${request.fromOutlet}". Available: ${totalAvailableQty} ${product.unit}, Requested: ${request.quantity} ${product.unit}` };
          }
        } else {
          console.log('deductInventoryFromApproval: Transfer from production outlet');
          
          if (fromOutlet.outletType !== 'production') {
            console.log('deductInventoryFromApproval: From outlet is not a production outlet');
            return { success: false, message: `"${request.fromOutlet}" is not a production outlet (Stores/Kitchen)` };
          }
          
          const productionOutletNames = outlets.filter(o => o.outletType === 'production').map(o => o.name);
          const allProductionStockChecks = stockChecks.filter(c => productionOutletNames.includes(c.outlet || ''));
          
          console.log('deductInventoryFromApproval: Found', allProductionStockChecks.length, 'production stock checks');
          
          allProductionStockChecks.forEach(check => {
            const count = check.counts.find(c => c.productId === request.productId);
            if (count) {
              const receivedStock = count.receivedStock || 0;
              const wastage = count.wastage || 0;
              const currentQty = count.quantity || 0;
              
              const netStock = Math.max(receivedStock - wastage, currentQty);
              console.log('deductInventoryFromApproval: Stock check', check.id, 'outlet', check.outlet, '- receivedStock:', receivedStock, 'wastage:', wastage, 'quantity:', currentQty, 'netStock:', netStock);
              
              if (netStock > 0) {
                totalAvailableQty += netStock;
                sourceStockChecks.push({ check, availableQty: netStock });
              }
            }
          });
          
          console.log('deductInventoryFromApproval: Total available qty in Stores/Kitchen:', totalAvailableQty);
          
          if (totalAvailableQty < request.quantity) {
            return { success: false, message: `Insufficient stock in Stores/Kitchen. Available: ${totalAvailableQty} ${product.unit}, Requested: ${request.quantity} ${product.unit}` };
          }
        }

        console.log('deductInventoryFromApproval: Sufficient stock available - proceeding with approval');
        let remainingToDeduct = request.quantity;
        
        const sortedSourceStockChecks = sourceStockChecks.sort((a, b) => b.check.timestamp - a.check.timestamp);
        
        for (const { check, availableQty } of sortedSourceStockChecks) {
          if (remainingToDeduct <= 0) break;
          
          const countIndex = check.counts.findIndex(c => c.productId === request.productId);
          if (countIndex === -1) continue;
          
          const count = check.counts[countIndex];
          const receivedStock = count.receivedStock || 0;
          const wastage = count.wastage || 0;
          const currentQty = count.quantity || 0;
          const netStock = Math.max(receivedStock - wastage, currentQty);
          
          if (netStock <= 0) continue;
          
          const deductAmount = Math.min(netStock, remainingToDeduct);
          
          const updatedCounts = [...check.counts];
          
          if (receivedStock > 0) {
            updatedCounts[countIndex] = {
              ...count,
              receivedStock: Math.max(0, receivedStock - deductAmount),
              wastage: wastage,
              quantity: Math.max(0, (receivedStock - deductAmount) - wastage),
            };
          } else {
            updatedCounts[countIndex] = {
              ...count,
              quantity: Math.max(0, currentQty - deductAmount),
            };
          }
          
          await updateStockCheck(check.id, updatedCounts);
          remainingToDeduct -= deductAmount;
          
          console.log('deductInventoryFromApproval: Deducted', deductAmount, 'from', check.outlet, '- remaining to deduct:', remainingToDeduct);
        }
        
        console.log('deductInventoryFromApproval: Moving', request.quantity, 'to outlet', request.toOutlet);
        
        const requestDate = request.requestDate || new Date(request.requestedAt).toISOString().split('T')[0];
        console.log('deductInventoryFromApproval: Using request date:', requestDate);
        const targetOutletCheck = stockChecks.find(c => c.outlet === request.toOutlet && c.date === requestDate);
        
        if (targetOutletCheck) {
          console.log('deductInventoryFromApproval: Found existing stock check for target outlet');
          const targetCountIndex = targetOutletCheck.counts.findIndex(c => c.productId === request.productId);
          const updatedTargetCounts = [...targetOutletCheck.counts];
          
          if (targetCountIndex >= 0) {
            const existingCount = updatedTargetCounts[targetCountIndex];
            updatedTargetCounts[targetCountIndex] = {
              ...existingCount,
              quantity: existingCount.quantity + request.quantity,
              receivedStock: (existingCount.receivedStock || 0) + request.quantity,
            };
          } else {
            updatedTargetCounts.push({
              productId: request.productId,
              quantity: request.quantity,
              receivedStock: request.quantity,
              openingStock: 0,
            });
          }
          
          await updateStockCheck(targetOutletCheck.id, updatedTargetCounts);
          console.log('deductInventoryFromApproval: Updated target outlet stock check for date:', requestDate);
        } else {
          console.log('deductInventoryFromApproval: No existing stock check for target outlet on', requestDate, '- creating one');
          const newStockCheck: StockCheck = {
            id: `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            date: requestDate,
            outlet: request.toOutlet,
            counts: [{
              productId: request.productId,
              quantity: request.quantity,
              receivedStock: request.quantity,
              openingStock: 0,
            }],
            timestamp: Date.now(),
            completedBy: 'AUTO',
          };
          await saveStockCheck(newStockCheck, true);
          console.log('deductInventoryFromApproval: Created new stock check for target outlet on', requestDate);
        }
        
        console.log('deductInventoryFromApproval: Successfully moved', request.quantity, product.unit, 'from', request.fromOutlet, 'to', request.toOutlet);
        return { success: true };
      }

      console.log('deductInventoryFromApproval: Product pair found:', productPair);
      console.log('deductInventoryFromApproval: This is a General Inventory product with unit conversion');
      
      const invStock = inventoryStocks.find(s => s.productId === productPair.wholeProductId);
      if (!invStock) {
        console.log('deductInventoryFromApproval: Product not found in inventory');
        return { success: false, message: 'Product not found in inventory' };
      }

      const conversion = productConversions.find(
        c => c.fromProductId === productPair.wholeProductId && c.toProductId === productPair.slicesProductId
      );
      const conversionFactor = conversion?.conversionFactor || 10;
      console.log('deductInventoryFromApproval: Conversion factor:', conversionFactor);
      
      // Check if this is a sales-to-sales transfer
      const isSalesToSalesTransfer = fromOutlet.outletType === 'sales' && toOutlet.outletType === 'sales';
      const fromOutletStock = invStock.outletStocks.find(os => os.outletName === request.fromOutlet);
      let sourceWhole = 0;
      let sourceSlices = 0;
      let sourceLabel = '';
      
      if (isSalesToSalesTransfer) {
        // Transfer between sales outlets - check FROM sales outlet stock
        if (!fromOutletStock) {
          console.log('deductInventoryFromApproval: FROM sales outlet has no inventory stock entry');
          return { success: false, message: `Sales outlet "${request.fromOutlet}" has no stock available` };
        }
        sourceWhole = fromOutletStock.whole;
        sourceSlices = fromOutletStock.slices;
        sourceLabel = `sales outlet "${request.fromOutlet}"`;
        console.log('deductInventoryFromApproval: Transfer between sales outlets - From outlet stock - whole:', sourceWhole, 'slices:', sourceSlices);
      } else {
        // Transfer from production to sales - check production stock
        sourceWhole = invStock.productionWhole;
        sourceSlices = invStock.productionSlices;
        sourceLabel = 'Stores/Kitchen';
        console.log('deductInventoryFromApproval: Transfer from production - Production stock - whole:', sourceWhole, 'slices:', sourceSlices);
      }
      
      let totalSourceSlices = sourceWhole * conversionFactor + sourceSlices;
      console.log('deductInventoryFromApproval: Total available slices in', sourceLabel, ':', totalSourceSlices);
      
      const isWholeProduct = request.productId === productPair.wholeProductId;
      let requestedTotalSlices = 0;
      let requestedWhole = 0;
      let requestedSlices = 0;
      
      if (isWholeProduct) {
        requestedWhole = Math.floor(request.quantity);
        requestedSlices = Math.round((request.quantity % 1) * conversionFactor);
        requestedTotalSlices = requestedWhole * conversionFactor + requestedSlices;
        console.log('deductInventoryFromApproval: Request is for WHOLE - quantity:', request.quantity, '-> whole:', requestedWhole, 'slices:', requestedSlices, 'total slices:', requestedTotalSlices);
      } else {
        requestedTotalSlices = Math.round(request.quantity);
        requestedWhole = Math.floor(requestedTotalSlices / conversionFactor);
        requestedSlices = Math.round(requestedTotalSlices % conversionFactor);
        console.log('deductInventoryFromApproval: Request is for SLICES - quantity:', request.quantity, '-> whole:', requestedWhole, 'slices:', requestedSlices, 'total slices:', requestedTotalSlices);
      }

      if (totalSourceSlices < requestedTotalSlices) {
        return { success: false, message: `Insufficient inventory in ${sourceLabel}. Available: ${Math.floor(totalSourceSlices / conversionFactor)} whole + ${Math.round(totalSourceSlices % conversionFactor)} slices, Requested: ${requestedWhole} whole + ${requestedSlices} slices` };
      }

      let remainingSlices = totalSourceSlices - requestedTotalSlices;
      const newSourceWhole = Math.floor(remainingSlices / conversionFactor);
      const newSourceSlices = Math.round(remainingSlices % conversionFactor);
      console.log('deductInventoryFromApproval: After deduction from', sourceLabel, '- whole:', newSourceWhole, 'slices:', newSourceSlices);

      // Get the actual current stock for this outlet from a stock check if it exists
      console.log('deductInventoryFromApproval: Getting current stock for outlet:', request.toOutlet);
      
      // First check if there's a manual stock entry for this outlet
      let manualStockWhole = 0;
      let manualStockSlices = 0;
      let hasManualStock = false;
      
      if (toOutlet && toOutlet.outletType === 'sales') {
        // For sales outlets, check if there's a stock check with manual entry
        const latestStockCheck = stockChecks
          .filter(check => check.outlet === request.toOutlet)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        
        if (latestStockCheck) {
          const wholeCount = latestStockCheck.counts.find(c => c.productId === productPair.wholeProductId);
          const slicesCount = latestStockCheck.counts.find(c => c.productId === productPair.slicesProductId);
          
          if (wholeCount || slicesCount) {
            manualStockWhole = wholeCount?.quantity || 0;
            manualStockSlices = slicesCount?.quantity || 0;
            hasManualStock = true;
            console.log('deductInventoryFromApproval: Found manual stock entry - whole:', manualStockWhole, 'slices:', manualStockSlices);
          }
        }
      }
      
      let currentWhole = 0;
      let currentSlices = 0;
      
      if (hasManualStock) {
        // Use manual stock as the base
        currentWhole = Math.floor(manualStockWhole);
        currentSlices = Math.round(manualStockSlices);
        console.log('deductInventoryFromApproval: Using manual stock as base - whole:', currentWhole, 'slices:', currentSlices);
      } else {
        // Use inventory stock as the base
        const outletStock = invStock.outletStocks.find(os => os.outletName === request.toOutlet);
        currentWhole = outletStock?.whole || 0;
        currentSlices = outletStock?.slices || 0;
        console.log('deductInventoryFromApproval: Using inventory stock as base - whole:', currentWhole, 'slices:', currentSlices);
      }
      
      // Convert current stock to total slices
      let currentTotalSlices = currentWhole * conversionFactor + currentSlices;
      console.log('deductInventoryFromApproval: Current total slices:', currentTotalSlices);
      
      // Add the new request quantity (convert to slices)
      let addedSlices = 0;
      if (isWholeProduct) {
        const addWhole = Math.floor(request.quantity);
        const addSlices = Math.round((request.quantity % 1) * conversionFactor);
        addedSlices = addWhole * conversionFactor + addSlices;
        console.log('deductInventoryFromApproval: Adding from request:', addWhole, 'whole +', addSlices, 'slices =', addedSlices, 'total slices');
      } else {
        addedSlices = Math.round(request.quantity);
        console.log('deductInventoryFromApproval: Adding from request:', addedSlices, 'slices');
      }
      
      // New total = current stock + request quantity
      let newTotalSlices = currentTotalSlices + addedSlices;
      console.log('deductInventoryFromApproval: New total slices:', newTotalSlices, '=', currentTotalSlices, '+', addedSlices);
      
      // Convert back to whole and slices - THIS IS THE CURRENT STOCK
      currentWhole = Math.floor(newTotalSlices / conversionFactor);
      currentSlices = Math.round(newTotalSlices % conversionFactor);
      
      console.log('deductInventoryFromApproval: FINAL CURRENT STOCK - whole:', currentWhole, 'slices:', currentSlices);
      
      const updatedOutletStocks = [...invStock.outletStocks];
      const toOutletIndex = updatedOutletStocks.findIndex(o => o.outletName === request.toOutlet);
      
      if (toOutletIndex >= 0) {
        console.log('deductInventoryFromApproval: Setting outlet stock to CURRENT STOCK (not adding)');
        console.log('deductInventoryFromApproval: This is the actual stock in the outlet after receiving the request');
        updatedOutletStocks[toOutletIndex] = {
          ...updatedOutletStocks[toOutletIndex],
          whole: currentWhole,
          slices: currentSlices,
        };
      } else {
        console.log('deductInventoryFromApproval: Creating new outlet stock entry with CURRENT STOCK');
        updatedOutletStocks.push({
          outletName: request.toOutlet,
          whole: currentWhole,
          slices: currentSlices,
        });
      }

      console.log('deductInventoryFromApproval: Updating inventory stock');
      
      // Update the source (either production or from sales outlet)
      if (isSalesToSalesTransfer) {
        // Update the FROM sales outlet stock (reduce it)
        const fromOutletIndex = updatedOutletStocks.findIndex(o => o.outletName === request.fromOutlet);
        if (fromOutletIndex >= 0) {
          updatedOutletStocks[fromOutletIndex] = {
            ...updatedOutletStocks[fromOutletIndex],
            whole: newSourceWhole,
            slices: newSourceSlices,
          };
          console.log('deductInventoryFromApproval: Reduced FROM sales outlet stock to - whole:', newSourceWhole, 'slices:', newSourceSlices);
        }
        
        await updateInventoryStock(productPair.wholeProductId, {
          ...invStock,
          outletStocks: updatedOutletStocks,
          updatedAt: Date.now(),
        });
        console.log('deductInventoryFromApproval: Updated inventory - sales to sales transfer complete');
      } else {
        // Update production stock (reduce it)
        await updateInventoryStock(productPair.wholeProductId, {
          ...invStock,
          productionWhole: newSourceWhole,
          productionSlices: newSourceSlices,
          outletStocks: updatedOutletStocks,
          updatedAt: Date.now(),
        });
        console.log('deductInventoryFromApproval: Updated inventory - production to sales transfer complete');
      }
      
      // Also update stock checks for the target outlet to show received stock in live inventory
      const requestDate = request.requestDate || new Date(request.requestedAt).toISOString().split('T')[0];
      console.log('deductInventoryFromApproval: Updating stock check for target outlet on date:', requestDate);
      const targetOutletCheck = stockChecks.find(c => c.outlet === request.toOutlet && c.date === requestDate);
      
      if (targetOutletCheck) {
        console.log('deductInventoryFromApproval: Found existing stock check for target outlet');
        const wholeCountIndex = targetOutletCheck.counts.findIndex(c => c.productId === productPair.wholeProductId);
        const slicesCountIndex = targetOutletCheck.counts.findIndex(c => c.productId === productPair.slicesProductId);
        const updatedTargetCounts = [...targetOutletCheck.counts];
        
        // Update whole product count
        if (wholeCountIndex >= 0) {
          const existingCount = updatedTargetCounts[wholeCountIndex];
          updatedTargetCounts[wholeCountIndex] = {
            ...existingCount,
            receivedStock: (existingCount.receivedStock || 0) + requestedWhole,
            quantity: (existingCount.quantity || 0) + requestedWhole,
          };
        } else if (requestedWhole > 0) {
          updatedTargetCounts.push({
            productId: productPair.wholeProductId,
            quantity: requestedWhole,
            receivedStock: requestedWhole,
            openingStock: 0,
          });
        }
        
        // Update slices product count
        if (slicesCountIndex >= 0) {
          const existingCount = updatedTargetCounts[slicesCountIndex];
          updatedTargetCounts[slicesCountIndex] = {
            ...existingCount,
            receivedStock: (existingCount.receivedStock || 0) + requestedSlices,
            quantity: (existingCount.quantity || 0) + requestedSlices,
          };
        } else if (requestedSlices > 0) {
          updatedTargetCounts.push({
            productId: productPair.slicesProductId,
            quantity: requestedSlices,
            receivedStock: requestedSlices,
            openingStock: 0,
          });
        }
        
        await updateStockCheck(targetOutletCheck.id, updatedTargetCounts);
        console.log('deductInventoryFromApproval: Updated target outlet stock check with whole:', requestedWhole, 'slices:', requestedSlices);
      } else {
        console.log('deductInventoryFromApproval: No existing stock check for target outlet on', requestDate, '- creating one');
        const newCounts: StockCount[] = [];
        
        if (requestedWhole > 0) {
          newCounts.push({
            productId: productPair.wholeProductId,
            quantity: requestedWhole,
            receivedStock: requestedWhole,
            openingStock: 0,
          });
        }
        
        if (requestedSlices > 0) {
          newCounts.push({
            productId: productPair.slicesProductId,
            quantity: requestedSlices,
            receivedStock: requestedSlices,
            openingStock: 0,
          });
        }
        
        if (newCounts.length > 0) {
          const newStockCheck: StockCheck = {
            id: `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            date: requestDate,
            outlet: request.toOutlet,
            counts: newCounts,
            timestamp: Date.now(),
            completedBy: 'AUTO',
          };
          await saveStockCheck(newStockCheck, true);
          console.log('deductInventoryFromApproval: Created new stock check for target outlet with whole:', requestedWhole, 'slices:', requestedSlices);
        }
      }
      
      console.log('deductInventoryFromApproval: Success - moved', requestedWhole, 'whole +', requestedSlices, 'slices from Stores/Kitchen to', request.toOutlet);
      return { success: true };
    } catch (error) {
      console.error('Deduct inventory error:', error);
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [inventoryStocks, products, getConversionFactor, getProductPairForInventory, productConversions, updateInventoryStock, outlets, stockChecks, updateStockCheck]);

  const saveSalesDeductions = useCallback(async (deductions: SalesDeduction[]) => {
    try {
      const deductionsWithTimestamp = deductions.map(d => ({ ...d, updatedAt: d.updatedAt || Date.now() }));
      
      // Aggressive cleanup: Only keep last 90 days of data
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
      
      console.log('saveSalesDeductions: Filtering deductions older than', ninetyDaysAgoStr);
      const recentDeductions = deductionsWithTimestamp.filter(d => d.salesDate >= ninetyDaysAgoStr);
      
      if (recentDeductions.length < deductionsWithTimestamp.length) {
        console.log('saveSalesDeductions: Removed', deductionsWithTimestamp.length - recentDeductions.length, 'old deductions (older than 90 days)');
      }
      
      // Further limit to prevent quota errors
      const MAX_DEDUCTIONS = 300;
      const sortedDeductions = recentDeductions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const limitedDeductions = sortedDeductions.slice(0, MAX_DEDUCTIONS);
      
      if (limitedDeductions.length < recentDeductions.length) {
        console.log('saveSalesDeductions: Keeping only latest', MAX_DEDUCTIONS, 'items (reduced from', recentDeductions.length, ') to prevent storage quota issues');
      }
      
      try {
        const dataToSave = JSON.stringify(limitedDeductions);
        const sizeInKB = Math.round(dataToSave.length / 1024);
        console.log('saveSalesDeductions: Saving', limitedDeductions.length, 'items, size:', sizeInKB, 'KB');
        
        await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, dataToSave);
        setSalesDeductions(limitedDeductions.filter(d => !d.deleted));
      } catch (storageError: any) {
        if (storageError?.message?.includes('QuotaExceeded') || storageError?.message?.includes('quota')) {
          console.warn('saveSalesDeductions: Still exceeding quota, reducing to 100 items');
          const drasticallyReducedDeductions = sortedDeductions.slice(0, 100);
          await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, JSON.stringify(drasticallyReducedDeductions));
          setSalesDeductions(drasticallyReducedDeductions.filter(d => !d.deleted));
        } else {
          throw storageError;
        }
      }
      
      console.log('saveSalesDeductions: Saved successfully');
    } catch (error) {
      console.error('Failed to save sales deductions:', error);
      throw error;
    }
  }, [currentUser]);

  const deductInventoryFromSales = useCallback(async (outletName: string, productId: string, salesDate: string, wholeDeducted: number, slicesDeducted: number) => {
    try {
      console.log('=== deductInventoryFromSales START ===');
      console.log('Outlet:', outletName, 'Product:', productId, 'Date:', salesDate);
      console.log('Deduction amounts - Whole:', wholeDeducted, 'Slices:', slicesDeducted);
      
      // CRITICAL: Pause sync during this operation to prevent race conditions
      const wasSyncing = syncInProgressRef.current;
      syncInProgressRef.current = true;
      console.log('deductInventoryFromSales: Paused background sync to prevent data loss');
      
      // CRITICAL: Always read fresh data from AsyncStorage to prevent race conditions
      // This ensures we don't lose data if sync is happening simultaneously
      const storedDeductions = await AsyncStorage.getItem(STORAGE_KEYS.SALES_DEDUCTIONS);
      const currentSalesDeductions = storedDeductions ? JSON.parse(storedDeductions).filter((d: any) => !d.deleted) : [];
      console.log('deductInventoryFromSales: Current sales deductions count (from storage):', currentSalesDeductions.length);
      
      const existingDeduction = currentSalesDeductions.find(
        (d: SalesDeduction) => d.outletName === outletName && d.productId === productId && d.salesDate === salesDate && !d.deleted
      );
      
      if (existingDeduction) {
        console.log('deductInventoryFromSales: Found existing deduction record');
        console.log('  Existing - Whole:', existingDeduction.wholeDeducted, 'Slices:', existingDeduction.slicesDeducted);
        console.log('  New (from reconciliation) - Whole:', wholeDeducted, 'Slices:', slicesDeducted);
        
        // Check if quantities have changed
        const hasChanged = existingDeduction.wholeDeducted !== wholeDeducted || 
                          existingDeduction.slicesDeducted !== slicesDeducted;
        
        if (hasChanged) {
          console.log('deductInventoryFromSales: ✓ Quantities CHANGED during reconciliation - updating records');
          console.log('deductInventoryFromSales: This will update BOTH Inventory Section AND Live Inventory sold columns');
          
          // Calculate the difference for inventory adjustment
          const wholeDiff = wholeDeducted - existingDeduction.wholeDeducted;
          const slicesDiff = slicesDeducted - existingDeduction.slicesDeducted;
          console.log('deductInventoryFromSales: Adjustment needed - Whole:', wholeDiff, 'Slices:', slicesDiff);
          
          // Update inventory stock with the difference (can be positive or negative)
          const invStock = inventoryStocks.find(s => s.productId === productId);
          if (invStock) {
            console.log('deductInventoryFromSales: Adjusting Inventory Section for product:', productId);
            
            const outletStock = invStock.outletStocks.find(o => o.outletName === outletName);
            if (outletStock) {
              const productPair = getProductPairForInventory(productId);
              if (productPair) {
                const conversionFactor = getConversionFactor(productPair.wholeProductId, productPair.slicesProductId) || 10;
                let totalSlices = outletStock.whole * conversionFactor + outletStock.slices;
                const adjustmentSlices = wholeDiff * conversionFactor + slicesDiff;
                
                console.log('deductInventoryFromSales: Inventory before adjustment - Whole:', outletStock.whole, 'Slices:', outletStock.slices);
                console.log('deductInventoryFromSales: Applying adjustment of', adjustmentSlices, 'slices');
                
                totalSlices -= adjustmentSlices;
                
                outletStock.whole = Math.floor(totalSlices / conversionFactor);
                outletStock.slices = Math.round(totalSlices % conversionFactor);

                await updateInventoryStock(productId, invStock);
                console.log('deductInventoryFromSales: Inventory after adjustment - Whole:', outletStock.whole, 'Slices:', outletStock.slices);
                console.log('deductInventoryFromSales: ✓ Inventory Section updated');
              }
            }
          }
          
          // CRITICAL: ALWAYS update the sales deduction record to match the reconciliation
          // This ensures Live Inventory's sold column shows the ACTUAL sold quantities from the reconciliation report
          const updatedDeductions = currentSalesDeductions.map((d: SalesDeduction) => 
            d.id === existingDeduction.id 
              ? { ...d, wholeDeducted, slicesDeducted, updatedAt: Date.now() }
              : d
          );
          
          // CRITICAL: Save to AsyncStorage and sync OUT immediately
          console.log('deductInventoryFromSales: Saving updated deduction to AsyncStorage...');
          const deductionsWithTimestamp = updatedDeductions.map((d: SalesDeduction) => ({ ...d, updatedAt: d.updatedAt || Date.now() }));
          await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, JSON.stringify(deductionsWithTimestamp));
          setSalesDeductions(deductionsWithTimestamp.filter((d: SalesDeduction) => !d.deleted));
          console.log('deductInventoryFromSales: ✓ Saved to AsyncStorage');
          
          // CRITICAL: Sync OUT to server immediately
          if (currentUser?.id) {
            console.log('deductInventoryFromSales: Syncing OUT updated deduction to server...');
            try {
              await syncData('salesDeductions', deductionsWithTimestamp, currentUser.id);
              console.log('deductInventoryFromSales: ✓ Synced OUT to server successfully');
            } catch (syncError) {
              console.error('deductInventoryFromSales: Sync OUT failed:', syncError);
            }
          }
          
          console.log('deductInventoryFromSales: ✓ Sales deduction record UPDATED with new sold quantities from reconciliation');
          console.log('deductInventoryFromSales: ✓ Live Inventory sold column will now show:', wholeDeducted, 'whole +', slicesDeducted, 'slices');
        } else {
          console.log('deductInventoryFromSales: Sold quantities unchanged from previous reconciliation');
          console.log('deductInventoryFromSales: Live Inventory already shows correct sold values');
        }
        
        // Resume background sync
        syncInProgressRef.current = wasSyncing;
        console.log('deductInventoryFromSales: Resumed background sync');
        
        console.log('=== deductInventoryFromSales END (existing record processed) ===');
        return;
      }

      console.log('deductInventoryFromSales: First time reconciling this sale date - creating new records');
      
      // Deduct from inventory stock on first reconciliation (for Inventory Section)
      const invStock = inventoryStocks.find(s => s.productId === productId);
      if (invStock) {
        console.log('deductInventoryFromSales: Deducting from Inventory Section (first time) for product:', productId);
        
        const outletStock = invStock.outletStocks.find(o => o.outletName === outletName);
        if (!outletStock) {
          console.log('deductInventoryFromSales: Outlet not found in inventory, skipping Inventory Section update');
        } else {
          const productPair = getProductPairForInventory(productId);
          if (!productPair) {
            console.log('deductInventoryFromSales: No product pair found, skipping Inventory Section deduction');
          } else {
            const conversionFactor = getConversionFactor(productPair.wholeProductId, productPair.slicesProductId) || 10;
            let totalSlices = outletStock.whole * conversionFactor + outletStock.slices;
            const deductedSlices = wholeDeducted * conversionFactor + slicesDeducted;
            
            console.log('deductInventoryFromSales: Inventory Section before - Whole:', outletStock.whole, 'Slices:', outletStock.slices, 'Total slices:', totalSlices);
            console.log('deductInventoryFromSales: Deducting slices:', deductedSlices);
            
            totalSlices -= deductedSlices;
            
            outletStock.whole = Math.floor(totalSlices / conversionFactor);
            outletStock.slices = Math.round(totalSlices % conversionFactor);

            await updateInventoryStock(productId, invStock);
            console.log('deductInventoryFromSales: Inventory Section after - Whole:', outletStock.whole, 'Slices:', outletStock.slices);
          }
        }
      } else {
        console.log('deductInventoryFromSales: Product not in General Inventory (Production Stock Other Units), tracking deduction only');
      }

      // Create sales deduction record (for Live Inventory)
      const deduction: SalesDeduction = {
        id: `deduct-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        outletName,
        productId,
        salesDate,
        loadDate: new Date().toISOString().split('T')[0],
        wholeDeducted,
        slicesDeducted,
        updatedAt: Date.now(),
      };
      
      const updatedDeductions = [...currentSalesDeductions, deduction];
      
      // CRITICAL: Save to local AsyncStorage FIRST
      console.log('deductInventoryFromSales: Saving to AsyncStorage...');
      const deductionsWithTimestamp = updatedDeductions.map(d => ({ ...d, updatedAt: d.updatedAt || Date.now() }));
      await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, JSON.stringify(deductionsWithTimestamp));
      setSalesDeductions(deductionsWithTimestamp.filter(d => !d.deleted));
      console.log('deductInventoryFromSales: ✓ Saved to AsyncStorage');
      
      // CRITICAL: Immediately sync OUT to server BEFORE resuming background sync
      if (currentUser?.id) {
        console.log('deductInventoryFromSales: Syncing OUT to server to preserve sold data...');
        try {
          await syncData('salesDeductions', deductionsWithTimestamp, currentUser.id);
          console.log('deductInventoryFromSales: ✓ Synced OUT to server successfully');
        } catch (syncError) {
          console.error('deductInventoryFromSales: Sync OUT failed:', syncError);
        }
      }
      
      // Resume background sync
      syncInProgressRef.current = wasSyncing;
      console.log('deductInventoryFromSales: Resumed background sync');
      
      console.log('deductInventoryFromSales: ✓ Created sales deduction record for Live Inventory');
      console.log('=== deductInventoryFromSales END (new record) ===');
    } catch (error) {
      console.error('deductInventoryFromSales: Error:', error);
      // Note: wasSyncing is out of scope here in catch block, so we just disable the pause
      syncInProgressRef.current = false;
    }
  }, [inventoryStocks, getConversionFactor, getProductPairForInventory, updateInventoryStock, currentUser]);

  const saveReconcileHistory = useCallback(async (history: SalesReconciliationHistory[]) => {
    try {
      const historyWithTimestamp = history.map(h => ({ ...h, updatedAt: h.updatedAt || Date.now() }));
      
      const MAX_HISTORY_ITEMS = 30;
      const sortedHistory = historyWithTimestamp.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      const limitedHistory = sortedHistory.slice(0, MAX_HISTORY_ITEMS);
      
      if (limitedHistory.length < historyWithTimestamp.length) {
        console.log('saveReconcileHistory: Keeping only latest', MAX_HISTORY_ITEMS, 'items (reduced from', historyWithTimestamp.length, ') to prevent storage quota issues');
      }
      
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.RECONCILE_HISTORY, JSON.stringify(limitedHistory));
        setReconcileHistory(limitedHistory.filter(h => !h.deleted));
      } catch (storageError: any) {
        if (storageError?.message?.includes('QuotaExceeded') || storageError?.message?.includes('quota')) {
          console.warn('saveReconcileHistory: Still exceeding quota with', MAX_HISTORY_ITEMS, 'items, reducing to 10');
          const drasticallyReducedHistory = sortedHistory.slice(0, 10);
          await AsyncStorage.setItem(STORAGE_KEYS.RECONCILE_HISTORY, JSON.stringify(drasticallyReducedHistory));
          setReconcileHistory(drasticallyReducedHistory.filter(h => !h.deleted));
        } else {
          throw storageError;
        }
      }
      
      console.log('saveReconcileHistory: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('Failed to save reconcile history:', error);
      throw error;
    }
  }, [currentUser]);

  const addReconcileHistory = useCallback(async (history: SalesReconciliationHistory) => {
    const updated = [...reconcileHistory, history];
    await saveReconcileHistory(updated);
  }, [reconcileHistory, saveReconcileHistory]);

  const deleteReconcileHistory = useCallback(async (historyId: string) => {
    const updated = reconcileHistory.map(h => 
      h.id === historyId ? { ...h, deleted: true as const, updatedAt: Date.now() } : h
    );
    await saveReconcileHistory(updated as any);
  }, [reconcileHistory, saveReconcileHistory]);

  const clearAllReconcileHistory = useCallback(async () => {
    try {
      console.log('clearAllReconcileHistory: Starting...');
      const deletedHistory = reconcileHistory.map(h => ({
        ...h,
        deleted: true as const,
        updatedAt: Date.now(),
      }));
      
      await AsyncStorage.setItem(STORAGE_KEYS.RECONCILE_HISTORY, JSON.stringify(deletedHistory));
      setReconcileHistory([]);
      
      if (currentUser?.id) {
        syncData('reconcileHistory', deletedHistory, currentUser.id).catch(syncError => {
          console.log('clearAllReconcileHistory: Sync failed, clearing data locally anyway');
        });
      }
      
      await AsyncStorage.removeItem(STORAGE_KEYS.RECONCILE_HISTORY);
      console.log('clearAllReconcileHistory: Complete');
    } catch (error) {
      console.error('Failed to clear reconcile history:', error);
      throw error;
    }
  }, [reconcileHistory, currentUser]);

  const clearAllInventory = useCallback(async () => {
    try {
      console.log('clearAllInventory: Starting...');
      console.log('Current inventory stocks count:', inventoryStocks.length);
      console.log('Current stock checks count:', stockChecks.length);
      
      const productionOutletNames = outlets.filter(o => o.outletType === 'production').map(o => o.name);
      const stockChecksFromProduction = stockChecks.filter(c => productionOutletNames.includes(c.outlet || ''));
      const otherStockChecks = stockChecks.filter(c => !productionOutletNames.includes(c.outlet || ''));
      
      console.log('Clearing', stockChecksFromProduction.length, 'production stock checks');
      console.log('Keeping', otherStockChecks.length, 'non-production stock checks');
      
      console.log('Marking', inventoryStocks.length, 'inventory stocks as deleted');
      const deletedInventoryStocks = inventoryStocks.map(inv => ({
        ...inv,
        deleted: true as const,
        updatedAt: Date.now(),
      }));
      
      const deletedSalesDeductions = salesDeductions.map(sd => ({
        ...sd,
        deleted: true as const,
        updatedAt: Date.now(),
      }));
      
      const deletedProductionStockChecks = stockChecksFromProduction.map(sc => ({
        ...sc,
        deleted: true as const,
        updatedAt: Date.now(),
      }));
      
      const allStockChecks = [...otherStockChecks, ...deletedProductionStockChecks];
      
      await AsyncStorage.setItem(STORAGE_KEYS.INVENTORY_STOCKS, JSON.stringify(deletedInventoryStocks));
      await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, JSON.stringify(deletedSalesDeductions));
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(allStockChecks));
      
      setInventoryStocks([]);
      setSalesDeductions([]);
      setStockChecks(otherStockChecks);
      
      if (otherStockChecks.length > 0) {
        const sortedChecks = [...otherStockChecks].sort((a, b) => b.timestamp - a.timestamp);
        const latestCheck = sortedChecks[0];
        const stockMap = new Map<string, number>();
        if (latestCheck.counts && Array.isArray(latestCheck.counts)) {
          latestCheck.counts.forEach((count: StockCount) => {
            stockMap.set(count.productId, count.quantity);
          });
        }
        setCurrentStockCounts(stockMap);
      } else {
        setCurrentStockCounts(new Map());
      }
      
      if (currentUser?.id) {
        console.log('Syncing deleted items to server...');
        Promise.all([
          syncData('inventoryStocks', deletedInventoryStocks, currentUser.id),
          syncData('salesDeductions', deletedSalesDeductions, currentUser.id),
          syncData('stockChecks', allStockChecks, currentUser.id),
        ]).then(() => {
          console.log('Sync complete');
        }).catch(syncError => {
          console.log('clearAllInventory: Sync failed, clearing data locally anyway');
        });
      }
      
      await AsyncStorage.removeItem(STORAGE_KEYS.INVENTORY_STOCKS);
      await AsyncStorage.removeItem(STORAGE_KEYS.SALES_DEDUCTIONS);
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(otherStockChecks));
      console.log('Local storage cleared successfully');
      
      console.log('clearAllInventory: Complete - inventory stocks count:', 0);
    } catch (error) {
      console.error('Failed to clear inventory:', error);
      try {
        await AsyncStorage.removeItem(STORAGE_KEYS.INVENTORY_STOCKS);
        await AsyncStorage.removeItem(STORAGE_KEYS.SALES_DEDUCTIONS);
        setInventoryStocks([]);
        setSalesDeductions([]);
      } catch (storageError) {
        console.error('Failed to clear AsyncStorage:', storageError);
      }
      throw error;
    }
  }, [currentUser, inventoryStocks, stockChecks, outlets, salesDeductions]);

  const syncAll = useCallback(async (silent: boolean = false) => {
    if (!currentUser) {
      return;
    }

    if (syncInProgressRef.current) {
      console.log('StockContext syncAll: Sync already in progress, skipping');
      return;
    }
    
    try {
      syncInProgressRef.current = true;
      if (!silent) {
        setIsSyncing(true);
      }
      
      console.log('StockContext syncAll: Starting', silent ? 'background' : 'manual', 'sync...');
      console.log('StockContext syncAll: Reading all data from AsyncStorage for sync...');
      const [productsData, stockChecksData, requestsData, outletsData, conversionsData, inventoryData, salesDeductionsData, reconcileHistoryData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.PRODUCTS),
        AsyncStorage.getItem(STORAGE_KEYS.STOCK_CHECKS),
        AsyncStorage.getItem(STORAGE_KEYS.REQUESTS),
        AsyncStorage.getItem(STORAGE_KEYS.OUTLETS),
        AsyncStorage.getItem(STORAGE_KEYS.PRODUCT_CONVERSIONS),
        AsyncStorage.getItem(STORAGE_KEYS.INVENTORY_STOCKS),
        AsyncStorage.getItem(STORAGE_KEYS.SALES_DEDUCTIONS),
        AsyncStorage.getItem(STORAGE_KEYS.RECONCILE_HISTORY),
      ]);
      
      const productsToSync = productsData ? JSON.parse(productsData) : [];
      let stockChecksToSync = stockChecksData ? JSON.parse(stockChecksData) : [];
      let requestsToSync = requestsData ? JSON.parse(requestsData) : [];
      const outletsToSync = outletsData ? JSON.parse(outletsData) : [];
      const conversionsToSync = conversionsData ? JSON.parse(conversionsData) : [];
      const inventoryToSync = inventoryData ? JSON.parse(inventoryData) : [];
      const salesDeductionsToSync = salesDeductionsData ? JSON.parse(salesDeductionsData) : [];
      const reconcileHistoryToSync = reconcileHistoryData ? JSON.parse(reconcileHistoryData) : [];
      
      // CLEANUP: Remove stock checks older than 7 days during sync (server keeps everything)
      // CRITICAL: Keep deleted items for 30 days to prevent resurrection by old devices
      if (stockChecksToSync.length > 0 && silent) {
        const RETENTION_DAYS = 7;
        const DELETED_RETENTION_DAYS = 30; // Keep deleted items longer to prevent resurrection
        const retentionDaysAgo = new Date();
        retentionDaysAgo.setDate(retentionDaysAgo.getDate() - RETENTION_DAYS);
        const retentionDaysAgoStr = retentionDaysAgo.toISOString().split('T')[0];
        
        const deletedRetentionTime = Date.now() - (DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        
        const originalCount = stockChecksToSync.length;
        stockChecksToSync = stockChecksToSync.filter((check: any) => {
          // Keep deleted items for 30 days to prevent old devices from resurrecting them
          if (check.deleted) {
            const deletedAt = check.updatedAt || 0;
            if (deletedAt > deletedRetentionTime) {
              console.log('StockContext syncAll: Keeping deleted stock check', check.id, 'for sync (prevents resurrection)');
              return true;
            }
            return false;
          }
          if (!check.date) return true;
          return check.date >= retentionDaysAgoStr;
        });
        
        if (originalCount > stockChecksToSync.length) {
          console.log('StockContext syncAll: Cleaned up', originalCount - stockChecksToSync.length, 'old stock checks (older than', RETENTION_DAYS, 'days active OR', DELETED_RETENTION_DAYS, 'days deleted) from local storage');
          console.log('StockContext syncAll: Server still has all historical data');
        }
      }
      
      // CLEANUP: Remove old requests during sync
      // CRITICAL: Keep deleted items for 30 days to prevent resurrection by old devices
      if (requestsToSync.length > 0 && silent) {
        const RETENTION_DAYS = 7;
        const DELETED_RETENTION_DAYS = 30; // Keep deleted items longer to prevent resurrection
        const retentionDaysAgo = new Date();
        retentionDaysAgo.setDate(retentionDaysAgo.getDate() - RETENTION_DAYS);
        const retentionDaysAgoTime = retentionDaysAgo.getTime();
        
        const deletedRetentionTime = Date.now() - (DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        
        const originalCount = requestsToSync.length;
        requestsToSync = requestsToSync.filter((request: any) => {
          // Keep deleted items for 30 days to prevent old devices from resurrecting them
          if (request.deleted) {
            const deletedAt = request.updatedAt || 0;
            if (deletedAt > deletedRetentionTime) {
              console.log('StockContext syncAll: Keeping deleted request', request.id, 'for sync (prevents resurrection)');
              return true;
            }
            return false;
          }
          if (!request.requestedAt) return true;
          return request.requestedAt >= retentionDaysAgoTime;
        });
        
        if (originalCount > requestsToSync.length) {
          console.log('StockContext syncAll: Cleaned up', originalCount - requestsToSync.length, 'old requests (older than', RETENTION_DAYS, 'days active OR', DELETED_RETENTION_DAYS, 'days deleted) from local storage');
          console.log('StockContext syncAll: Server still has all historical data');
        }
      }
      
      console.log('StockContext syncAll: Syncing all data including product conversions and reconcile history...');
      console.log('StockContext syncAll: Data to sync - products:', productsToSync.length, 'stockChecks:', stockChecksToSync.length, 'requests:', requestsToSync.length, 'outlets:', outletsToSync.length, 'conversions:', conversionsToSync.length, 'inventory:', inventoryToSync.length, 'salesDeductions:', salesDeductionsToSync.length, 'reconcileHistory:', reconcileHistoryToSync.length);
      console.log('StockContext syncAll: This is a', silent ? 'BACKGROUND' : 'MANUAL', 'sync - will', silent ? 'merge with server data preserving local data' : 'fetch from server and merge');
      
      const syncResults = await Promise.allSettled([
        syncData('products', productsToSync, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }),
        syncData('stockChecks', stockChecksToSync, currentUser.id),
        syncData('requests', requestsToSync, currentUser.id),
        syncData('outlets', outletsToSync, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }),
        syncData('productConversions', conversionsToSync, currentUser.id),
        syncData('inventoryStocks', inventoryToSync, currentUser.id),
        syncData('salesDeductions', salesDeductionsToSync, currentUser.id),
        syncData('reconcileHistory', reconcileHistoryToSync, currentUser.id),
      ]);
      
      const syncedProducts = syncResults[0].status === 'fulfilled' ? syncResults[0].value : productsToSync;
      const syncedStockChecks = syncResults[1].status === 'fulfilled' ? syncResults[1].value : stockChecksToSync;
      let syncedRequests = syncResults[2].status === 'fulfilled' ? syncResults[2].value : requestsToSync;
      
      // CLEANUP: After sync, keep only recent data locally (7 days)
      // CRITICAL: Keep deleted items for 30 days to prevent resurrection by old devices
      if (silent) {
        const RETENTION_DAYS = 7;
        const DELETED_RETENTION_DAYS = 30;
        const retentionDaysAgo = new Date();
        retentionDaysAgo.setDate(retentionDaysAgo.getDate() - RETENTION_DAYS);
        const retentionDaysAgoTime = retentionDaysAgo.getTime();
        
        const deletedRetentionTime = Date.now() - (DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        
        syncedRequests = (syncedRequests as any[]).filter((request: any) => {
          // Keep deleted items for 30 days
          if (request.deleted) {
            const deletedAt = request.updatedAt || 0;
            return deletedAt > deletedRetentionTime;
          }
          if (!request.requestedAt) return true;
          return request.requestedAt >= retentionDaysAgoTime;
        });
      }
      const syncedOutlets = syncResults[3].status === 'fulfilled' ? syncResults[3].value : outletsToSync;
      const syncedConversions = syncResults[4].status === 'fulfilled' ? syncResults[4].value : conversionsToSync;
      const syncedInventory = syncResults[5].status === 'fulfilled' ? syncResults[5].value : inventoryToSync;
      const syncedSalesDeductions = syncResults[6].status === 'fulfilled' ? syncResults[6].value : salesDeductionsToSync;
      const syncedReconcileHistory = syncResults[7].status === 'fulfilled' ? syncResults[7].value : reconcileHistoryToSync;
      
      const failedSyncs = syncResults.filter((r, i) => {
        if (r.status === 'rejected') {
          const labels = ['products', 'stockChecks', 'requests', 'outlets', 'conversions', 'inventory', 'salesDeductions', 'reconcileHistory'];
          console.error('StockContext syncAll: Failed to sync', labels[i], ':', r.reason);
          return true;
        }
        return false;
      });
      
      if (failedSyncs.length > 0) {
        console.log('StockContext syncAll: Some syncs failed, but continuing with successful data');
      }

      console.log('StockContext syncAll: Synced stock checks count:', (syncedStockChecks as any[]).length);
      console.log('StockContext syncAll: Current stock checks in memory:', stockChecks.length);
      
      // CRITICAL: Use timestamp comparison to prevent overwriting newer local data with older synced data
      const preservedStockChecks = stockChecks.filter(localCheck => {
        const syncedVersion = (syncedStockChecks as any[]).find((s: any) => s.id === localCheck.id);
        if (!syncedVersion) return true;
        
        const keepLocal = (localCheck.updatedAt || 0) > (syncedVersion.updatedAt || 0);
        if (keepLocal) {
          console.log('StockContext syncAll: Preserving newer local stock check', localCheck.id);
        }
        return keepLocal;
      });
      
      const mergedStockChecks = [...(syncedStockChecks as any[])].map((syncedCheck: any) => {
        const localVersion = preservedStockChecks.find(lc => lc.id === syncedCheck.id);
        return localVersion || syncedCheck;
      });
      
      preservedStockChecks.forEach(localCheck => {
        if (!mergedStockChecks.find((mc: any) => mc.id === localCheck.id)) {
          mergedStockChecks.push(localCheck);
        }
      });
      
      console.log('StockContext syncAll: Final merged stock checks count:', mergedStockChecks.length);

      console.log('StockContext syncAll: Saving to storage (silent)...');
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(syncedProducts));
      await AsyncStorage.setItem(STORAGE_KEYS.STOCK_CHECKS, JSON.stringify(mergedStockChecks));
      await AsyncStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(syncedRequests));
      await AsyncStorage.setItem(STORAGE_KEYS.OUTLETS, JSON.stringify(syncedOutlets));
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCT_CONVERSIONS, JSON.stringify(syncedConversions));
      await AsyncStorage.setItem(STORAGE_KEYS.INVENTORY_STOCKS, JSON.stringify(syncedInventory));
      await AsyncStorage.setItem(STORAGE_KEYS.SALES_DEDUCTIONS, JSON.stringify(syncedSalesDeductions));
      
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.RECONCILE_HISTORY, JSON.stringify(syncedReconcileHistory));
      } catch (quotaError: any) {
        if (quotaError?.message?.includes('QuotaExceeded') || quotaError?.message?.includes('quota')) {
          console.warn('StockContext syncAll: Reconcile history exceeded quota, trimming to 20 items');
          const sortedHistory = (syncedReconcileHistory as any[]).sort((a, b) => (b.loadDate || '').localeCompare(a.loadDate || ''));
          const trimmedHistory = sortedHistory.slice(0, 20);
          await AsyncStorage.setItem(STORAGE_KEYS.RECONCILE_HISTORY, JSON.stringify(trimmedHistory));
        } else {
          throw quotaError;
        }
      }
      
      // CRITICAL: For 60-second background sync, preserve inventory and sales data to prevent data loss
      // Manual sync (not silent) will also use smart merging to preserve local data
      console.log('StockContext syncAll: SMART MERGE - Preserving all local data with newer timestamps');
      console.log('StockContext syncAll: Current inventory count:', inventoryStocks.length);
      console.log('StockContext syncAll: Current sales deductions count:', salesDeductions.length);
      console.log('StockContext syncAll: CRITICAL - Ensuring sales deductions are preserved during sync');
      console.log('StockContext syncAll: salesDeductions sample:', salesDeductions.slice(0, 3).map(d => ({ id: d.id, date: d.salesDate, productId: d.productId, whole: d.wholeDeducted, slices: d.slicesDeducted })));
      console.log('StockContext syncAll: Current stock checks count:', stockChecks.length);
      console.log('StockContext syncAll: Current requests count:', requests.length);
      console.log('StockContext syncAll: Current product conversions count:', productConversions.length);
      console.log('StockContext syncAll: Current outlets count:', outlets.length);
      console.log('StockContext syncAll: Current products count:', products.length);
      
      // CRITICAL FIX: Always use smart merging to prevent data loss
      // This applies to BOTH manual and background syncs
      const mergeByTimestamp = <T extends { id: string; updatedAt?: number }>(existing: T[], synced: any[], label: string): T[] => {
        console.log(`StockContext syncAll: Merging ${label} - existing:`, existing.length, 'synced:', Array.isArray(synced) ? synced.length : 0);
        
        // If synced is empty or not an array, keep existing to prevent data loss
        if (!Array.isArray(synced) || synced.length === 0) {
          console.log(`StockContext syncAll: ${label} - synced is empty, preserving all ${existing.length} existing items`);
          return existing;
        }
        
        const merged = new Map<string, T>();
        
        // First, add all existing items
        existing.forEach(item => merged.set(item.id, item));
        console.log(`StockContext syncAll: ${label} - added ${existing.length} existing items to merge map`);
        
        // Then, only update if synced item is newer OR if item doesn't exist locally
        let addedFromServer = 0;
        let keptLocal = 0;
        let updated = 0;
        
        (synced as T[]).forEach(item => {
          const existingItem = merged.get(item.id);
          if (!existingItem) {
            merged.set(item.id, item);
            addedFromServer++;
          } else if ((item.updatedAt || 0) > (existingItem.updatedAt || 0)) {
            merged.set(item.id, item);
            updated++;
          } else {
            keptLocal++;
          }
        });
        
        console.log(`StockContext syncAll: ${label} - merge complete:`, {
          addedFromServer,
          updated,
          keptLocal,
          totalAfterMerge: merged.size
        });
        
        const result = Array.from(merged.values());
        console.log(`StockContext syncAll: ${label} - final count:`, result.length);
        return result;
      };
      
      // ALWAYS merge with timestamp-based logic to prevent data loss
      const finalInventory = mergeByTimestamp(inventoryStocks, syncedInventory, 'inventory');
      
      // CRITICAL: Sales deductions must ALWAYS be preserved during sync
      // They contain the ACTUAL sold data from reconciliation reports
      console.log('StockContext syncAll: CRITICAL - Merging sales deductions');
      console.log('  Local sales deductions:', salesDeductions.length);
      console.log('  Synced sales deductions:', Array.isArray(syncedSalesDeductions) ? syncedSalesDeductions.length : 'not array');
      const finalSalesDeductions = mergeByTimestamp(salesDeductions, syncedSalesDeductions, 'salesDeductions');
      console.log('  Final sales deductions after merge:', finalSalesDeductions.length);
      
      // VERIFY: Log a few sales deductions to confirm they're preserved
      if (finalSalesDeductions.length > 0) {
        console.log('  Sample sales deductions after merge:', (finalSalesDeductions as any[]).slice(0, 3).map(d => ({
          id: d.id,
          outlet: d.outletName,
          date: d.salesDate,
          productId: d.productId,
          whole: d.wholeDeducted,
          slices: d.slicesDeducted,
          deleted: d.deleted
        })));
      } else {
        console.warn('  WARNING: No sales deductions after merge! This will cause sold column to be empty!');
      }
      const finalStockChecks = mergeByTimestamp(stockChecks, mergedStockChecks, 'stockChecks');
      const finalRequests = mergeByTimestamp(requests, syncedRequests as any[], 'requests');
      const finalConversions = mergeByTimestamp(productConversions, syncedConversions, 'productConversions');
      const finalOutlets = mergeByTimestamp(outlets, syncedOutlets, 'outlets');
      const finalProducts = mergeByTimestamp(products, syncedProducts, 'products');
      
      console.log('StockContext syncAll: After smart merge - all data preserved with server updates applied');
      console.log('StockContext syncAll: After smart merge - all data preserved with server updates applied');
      console.log('StockContext syncAll: Final counts - inventory:', finalInventory.length, 'sales:', finalSalesDeductions.length, '← CRITICAL FOR LIVE INVENTORY', 'stockChecks:', finalStockChecks.length, 'requests:', finalRequests.length, 'conversions:', finalConversions.length, 'outlets:', finalOutlets.length, 'products:', finalProducts.length);
      
      // Batch all state updates together to prevent multiple re-renders
      const activeProducts = (finalProducts as any[]).filter(p => !p?.deleted);
      const activeStockChecks = (finalStockChecks as any[]).filter((c: any) => !c?.deleted);
      const activeRequests = (finalRequests as any[]).filter(r => !r?.deleted);
      const activeOutlets = (finalOutlets as any[]).filter(o => !o?.deleted);
      const activeConversions = (finalConversions as any[]).filter(c => !c?.deleted);
      const activeInventory = (finalInventory as any[]).filter(i => !i?.deleted);
      const activeSalesDeductions = (finalSalesDeductions as any[]).filter(d => !d?.deleted);
      const activeReconcileHistory = (syncedReconcileHistory as any[]).filter(h => !h?.deleted);
      
      console.log('StockContext syncAll: Active (non-deleted) counts:');
      console.log('  - products:', activeProducts.length);
      console.log('  - stockChecks:', activeStockChecks.length);
      console.log('  - requests:', activeRequests.length);
      console.log('  - outlets:', activeOutlets.length);
      console.log('  - productConversions:', activeConversions.length);
      console.log('  - inventory:', activeInventory.length);
      console.log('  - salesDeductions:', activeSalesDeductions.length, '← SOLD DATA FOR LIVE INVENTORY');
      if (activeSalesDeductions.length === 0 && salesDeductions.length > 0) {
        console.error('  ❌ CRITICAL ERROR: Sales deductions were LOST during sync!');
        console.error('  Before sync:', salesDeductions.length, 'After sync:', activeSalesDeductions.length);
        console.error('  This will cause Live Inventory sold column to be EMPTY!');
      }
      console.log('  - reconcileHistory:', activeReconcileHistory.length);
      
      let newStockMap = new Map<string, number>();
      if (activeStockChecks.length > 0) {
        const sortedChecks = [...activeStockChecks].sort((a: StockCheck, b: StockCheck) => b.timestamp - a.timestamp);
        const latestCheck = sortedChecks[0];
        if (latestCheck.counts && Array.isArray(latestCheck.counts)) {
          latestCheck.counts.forEach((count: StockCount) => {
            newStockMap.set(count.productId, count.quantity);
          });
        }
      }
      
      // CRITICAL: Always update state immediately to show synced data
      // React 18's automatic batching will batch all these updates together
      console.log('StockContext syncAll: Updating React state with merged data...');
      setProducts(activeProducts);
      setStockChecks(activeStockChecks);
      setRequests(activeRequests);
      setOutlets(activeOutlets);
      setProductConversions(activeConversions);
      setInventoryStocks(activeInventory);
      setSalesDeductions(activeSalesDeductions);
      setReconcileHistory(activeReconcileHistory);
      setCurrentStockCounts(newStockMap);
      setLastSyncTime(Date.now());
      console.log('StockContext syncAll: ✓ React state updated with all merged data');
      console.log('StockContext syncAll: Complete - synced all 8 data types including product conversions and reconcile history');
      console.log('StockContext syncAll: Final counts - products:', activeProducts.length, 'stockChecks:', activeStockChecks.length, 'requests:', activeRequests.length, 'outlets:', activeOutlets.length, 'conversions:', activeConversions.length, 'inventory:', activeInventory.length, 'salesDeductions:', activeSalesDeductions.length, 'reconcileHistory:', activeReconcileHistory.length);
    } catch (error) {
      console.error('StockContext syncAll: Failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, products, stockChecks, requests, outlets, productConversions, inventoryStocks, salesDeductions, reconcileHistory]);

  useEffect(() => {
    syncAllRef.current = syncAll;
  }, [syncAll]);

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let syncInterval: ReturnType<typeof setInterval> | undefined;
    let pollErrorCount = 0;
    
    if (currentUser && !isSyncPaused) {
      console.log('StockContext: Setting up smart sync system');
      console.log('StockContext: - Full sync every 60 seconds');
      
      const dataTypes = [
        'products',
        'stockChecks',
        'requests',
        'outlets',
        'productConversions',
        'inventoryStocks',
        'salesDeductions',
        'reconcileHistory'
      ];
      

      
      syncInterval = setInterval(() => {
        if (!syncInProgressRef.current) {
          console.log('[AUTO-SYNC] Running 60-second full sync cycle...');
          syncAll(true).catch((e) => console.log('[AUTO-SYNC] Stock auto-sync error', e));
        } else {
          console.log('[AUTO-SYNC] Skipping sync - another sync in progress');
        }
      }, 60000);
    } else {
      if (syncInterval) {
        console.log('StockContext: Clearing sync interval', isSyncPaused ? '(paused)' : '(logged out)');
        clearInterval(syncInterval);
        syncInterval = undefined;
      }
    }
    
    return () => {
      if (syncInterval) {
        console.log('StockContext: Cleaning up sync interval');
        clearInterval(syncInterval);
      }
    };
  }, [currentUser, isSyncPaused, syncAll, serverTimestamps]);

  const value = useMemo(() => ({
    products,
    stockChecks,
    requests,
    outlets,
    productConversions,
    inventoryStocks,
    salesDeductions,
    reconcileHistory,
    isLoading,
    currentStockCounts,
    showProductList,
    isSyncing,
    lastSyncTime,
    viewMode,
    importProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    saveStockCheck,
    deleteStockCheck,
    updateStockCheck,
    addRequest,
    updateRequestStatus,
    deleteRequest,
    updateRequest,
    addRequestsToDate,
    addOutlet,
    updateOutlet,
    deleteOutlet,
    addProductConversion,
    addProductConversionsBulk,
    updateProductConversion,
    deleteProductConversion,
    getConversionFactor,
    updateInventoryStock,
    addInventoryStock,
    deductInventoryFromApproval,
    deductInventoryFromSales,
    addReconcileHistory,
    deleteReconcileHistory,
    clearAllReconcileHistory,
    clearAllInventory,
    clearAllProductConversions,
    getLowStockItems,
    getTodayStockCheck,
    clearAllData,
    clearAllProducts,
    clearAllOutlets,
    deleteUserStockChecks,
    deleteAllStockChecks,
    deleteAllRequests,
    toggleShowProductList,
    setViewMode,
    syncAll,
    isSyncPaused,
    toggleSyncPause,
  }), [
    products,
    stockChecks,
    requests,
    outlets,
    productConversions,
    inventoryStocks,
    salesDeductions,
    reconcileHistory,
    isLoading,
    currentStockCounts,
    showProductList,
    isSyncing,
    lastSyncTime,
    viewMode,
    importProducts,
    addProduct,
    updateProduct,
    deleteProduct,
    saveStockCheck,
    deleteStockCheck,
    updateStockCheck,
    addRequest,
    updateRequestStatus,
    deleteRequest,
    updateRequest,
    addRequestsToDate,
    addOutlet,
    updateOutlet,
    deleteOutlet,
    addProductConversion,
    addProductConversionsBulk,
    updateProductConversion,
    deleteProductConversion,
    getConversionFactor,
    updateInventoryStock,
    addInventoryStock,
    deductInventoryFromApproval,
    deductInventoryFromSales,
    addReconcileHistory,
    deleteReconcileHistory,
    clearAllReconcileHistory,
    clearAllInventory,
    clearAllProductConversions,
    getLowStockItems,
    getTodayStockCheck,
    clearAllData,
    clearAllProducts,
    clearAllOutlets,
    deleteUserStockChecks,
    deleteAllStockChecks,
    deleteAllRequests,
    toggleShowProductList,
    setViewMode,
    isSyncPaused,
    toggleSyncPause,
    syncAll,
  ]);

  return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
}
