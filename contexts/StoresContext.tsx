import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StoreProduct, Supplier, GRN } from '@/types';
import { syncData } from '@/utils/syncData';

const STORAGE_KEYS = {
  STORE_PRODUCTS: '@stock_app_store_products',
  SUPPLIERS: '@stock_app_suppliers',
  GRNS: '@stock_app_grns',
};

export const [StoresProvider, useStores] = createContextHook(() => {
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [grns, setGRNs] = useState<GRN[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [currentUser, setCurrentUser] = useState<{ id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null>(null);
  const syncInProgressRef = useRef(false);

  const loadFromAsyncStorage = useCallback(async () => {
    try {
      const [storeProductsData, suppliersData, grnsData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.STORE_PRODUCTS),
        AsyncStorage.getItem(STORAGE_KEYS.SUPPLIERS),
        AsyncStorage.getItem(STORAGE_KEYS.GRNS),
      ]);

      console.log('[StoresContext] Loading from AsyncStorage...');

      if (storeProductsData) {
        try {
          const parsed = JSON.parse(storeProductsData);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((p: any) => !p?.deleted);
            console.log(`[StoresContext] Loaded ${filtered.length} store products`);
            setStoreProducts(filtered);
          }
        } catch (parseError) {
          console.error('[StoresContext] Failed to parse store products:', parseError);
          await AsyncStorage.removeItem(STORAGE_KEYS.STORE_PRODUCTS);
          setStoreProducts([]);
        }
      }

      if (suppliersData) {
        try {
          const parsed = JSON.parse(suppliersData);
          if (Array.isArray(parsed)) {
            setSuppliers(parsed.filter((s: any) => !s?.deleted));
          }
        } catch (parseError) {
          console.error('[StoresContext] Failed to parse suppliers:', parseError);
          await AsyncStorage.removeItem(STORAGE_KEYS.SUPPLIERS);
          setSuppliers([]);
        }
      }

      if (grnsData) {
        try {
          const parsed = JSON.parse(grnsData);
          if (Array.isArray(parsed)) {
            setGRNs(parsed.filter((g: any) => !g?.deleted));
          }
        } catch (parseError) {
          console.error('[StoresContext] Failed to parse GRNs:', parseError);
          await AsyncStorage.removeItem(STORAGE_KEYS.GRNS);
          setGRNs([]);
        }
      }
    } catch (error) {
      console.error('[StoresContext] Failed to load stores data:', error);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        await loadFromAsyncStorage();
      } catch (error) {
        console.error('[StoresContext] Failed to load stores data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [loadFromAsyncStorage]);

  const setUser = useCallback((user: { id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null) => {
    console.log('[StoresContext] Setting user:', user?.username);
    setCurrentUser(user);
  }, []);

  const saveStoreProducts = useCallback(async (products: StoreProduct[]) => {
    try {
      console.log(`[StoresContext] Saving ${products.length} store products to AsyncStorage`);
      const productsWithTimestamp = products.map(p => ({
        ...p,
        updatedAt: p.updatedAt || Date.now(),
      }));
      
      await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(productsWithTimestamp));
      const filtered = productsWithTimestamp.filter(p => !p.deleted);
      console.log(`[StoresContext] Updated state with ${filtered.length} active products`);
      setStoreProducts(filtered);

      try {
        if (currentUser?.id) {
          console.log('[StoresContext] Syncing products to server...');
          const synced = await syncData('storeProducts', productsWithTimestamp, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' });
          await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(synced));
          setStoreProducts((synced as any[]).filter(p => !p?.deleted));
          console.log('[StoresContext] Sync complete');
        }
      } catch (e) {
        console.log('[StoresContext] Sync failed, will retry later');
      }
    } catch (error) {
      console.error('[StoresContext] Failed to save store products:', error);
      throw error;
    }
  }, [currentUser]);

  const addStoreProduct = useCallback(async (product: StoreProduct) => {
    console.log('[StoresContext] Adding store product:', product.name);
    const updatedProducts = [...storeProducts, product];
    await saveStoreProducts(updatedProducts);
  }, [storeProducts, saveStoreProducts]);

  const updateStoreProduct = useCallback(async (productId: string, updates: Partial<StoreProduct>) => {
    console.log('[StoresContext] Updating store product:', productId, updates);
    const updatedProducts = storeProducts.map(p =>
      p.id === productId ? { ...p, ...updates, updatedAt: Date.now() } : p
    );
    await saveStoreProducts(updatedProducts);
  }, [storeProducts, saveStoreProducts]);

  const deleteStoreProduct = useCallback(async (productId: string) => {
    console.log('[StoresContext] ========================================');
    console.log('[StoresContext] deleteStoreProduct: Starting deletion for:', productId);
    
    try {
      // CRITICAL STEP 1: Read FRESH data from AsyncStorage to prevent race conditions
      console.log('[StoresContext] STEP 1: Reading fresh store products from AsyncStorage...');
      const storedData = await AsyncStorage.getItem(STORAGE_KEYS.STORE_PRODUCTS);
      const freshStoreProducts = storedData ? JSON.parse(storedData) : storeProducts;
      console.log('[StoresContext] Fresh store products count:', freshStoreProducts.length);
      
      const productToDelete = freshStoreProducts.find((p: StoreProduct) => p.id === productId);
      if (!productToDelete) {
        console.error('[StoresContext] ERROR: Product not found in storage:', productId);
        throw new Error('Product not found');
      }
      console.log('[StoresContext] Found product to delete:', productToDelete.name, '(', productToDelete.unit, ')');
      
      // CRITICAL STEP 2: Mark product as deleted with CURRENT timestamp
      // This timestamp is crucial for preventing resurrection during sync
      const now = Date.now();
      console.log('[StoresContext] STEP 2: Marking product as deleted with timestamp:', now);
      const updatedProducts = freshStoreProducts.map((p: StoreProduct) =>
        p.id === productId ? { ...p, deleted: true as const, updatedAt: now } : p
      );
      console.log('[StoresContext] Deletion timestamp:', now, '(', new Date(now).toISOString(), ')');
      
      // CRITICAL STEP 3: Immediately save to AsyncStorage
      console.log('[StoresContext] STEP 3: Saving deletion to AsyncStorage...');
      await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(updatedProducts));
      console.log('[StoresContext] ✓ Saved to AsyncStorage');
      
      // CRITICAL STEP 4: Sync OUT to server immediately BEFORE updating UI
      // This ensures the server has the deletion timestamp before any other operations
      if (currentUser?.id) {
        console.log('[StoresContext] STEP 4: Syncing deletion OUT to server (CRITICAL)...');
        console.log('[StoresContext] This sync will mark the product as deleted on the server');
        console.log('[StoresContext] Server will then propagate deletion to all other devices');
        try {
          const synced = await syncData('storeProducts', updatedProducts, currentUser.id, { 
            isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' 
          });
          console.log('[StoresContext] ✓ Server responded with', (synced as any[]).length, 'products');
          console.log('[StoresContext] ✓ Deletion synced successfully');
          
          // Save synced data back to AsyncStorage
          await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(synced));
          console.log('[StoresContext] ✓ Synced data saved back to AsyncStorage');
          
          // Filter out deleted products for UI
          const activeProducts = (synced as any[]).filter(p => !p?.deleted);
          setStoreProducts(activeProducts);
          console.log('[StoresContext] ✓ UI updated with', activeProducts.length, 'active products');
        } catch (syncError) {
          console.error('[StoresContext] ❌ Sync to server failed:', syncError);
          console.error('[StoresContext] Continuing with local deletion only');
          // Still update local state even if sync fails
          setStoreProducts(updatedProducts.filter((p: StoreProduct) => !p.deleted));
        }
      } else {
        console.log('[StoresContext] No user logged in, skipping server sync');
        setStoreProducts(updatedProducts.filter((p: StoreProduct) => !p.deleted));
      }
      
      console.log('[StoresContext] ✓✓✓ Deletion complete for:', productToDelete.name);
      console.log('[StoresContext] ========================================');
    } catch (error) {
      console.error('[StoresContext] ========================================');
      console.error('[StoresContext] ❌ CRITICAL ERROR during deletion:', error);
      console.error('[StoresContext] ========================================');
      throw error;
    }
  }, [storeProducts, currentUser]);

  const importStoreProducts = useCallback(async (newProducts: Omit<StoreProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[]) => {
    const existingProductsMap = new Map(
      storeProducts.map(p => [`${p.name.toLowerCase()}_${p.unit.toLowerCase()}`, p])
    );
    
    const productsToAdd: StoreProduct[] = [];
    let updatedCount = 0;
    let addedCount = 0;
    
    let updatedExistingProducts = [...storeProducts];
    
    newProducts.forEach(newProduct => {
      const key = `${newProduct.name.toLowerCase()}_${newProduct.unit.toLowerCase()}`;
      const existingProduct = existingProductsMap.get(key);
      
      if (existingProduct) {
        console.log(`[StoresContext] Updating existing: "${newProduct.name}" (${existingProduct.quantity} → ${newProduct.quantity})`);
        if (newProduct.costPerUnit !== undefined) {
          console.log(`[StoresContext] Updating costPerUnit: "${newProduct.name}" (${existingProduct.costPerUnit} → ${newProduct.costPerUnit})`);
        }
        updatedExistingProducts = updatedExistingProducts.map(p =>
          p.id === existingProduct.id
            ? { ...p, quantity: newProduct.quantity, minStockLevel: newProduct.minStockLevel, category: newProduct.category, costPerUnit: newProduct.costPerUnit, updatedAt: Date.now() }
            : p
        );
        updatedCount++;
        return;
      }
      
      const fullProduct: StoreProduct = {
        id: `store-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${addedCount}`,
        ...newProduct,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'imported',
      };
      
      productsToAdd.push(fullProduct);
      addedCount++;
    });
    
    const finalProducts = [...updatedExistingProducts, ...productsToAdd];
    
    await saveStoreProducts(finalProducts);
    return { added: addedCount, updated: updatedCount };
  }, [storeProducts, saveStoreProducts]);

  const saveSuppliers = useCallback(async (suppliersData: Supplier[]) => {
    try {
      const suppliersWithTimestamp = suppliersData.map(s => ({
        ...s,
        updatedAt: s.updatedAt || Date.now(),
      }));
      await AsyncStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(suppliersWithTimestamp));
      setSuppliers(suppliersWithTimestamp.filter(s => !s.deleted));

      try {
        if (currentUser?.id) {
          const synced = await syncData('suppliers', suppliersWithTimestamp, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' });
          await AsyncStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(synced));
          setSuppliers((synced as any[]).filter(s => !s?.deleted));
        }
      } catch (e) {
        console.log('[StoresContext] Suppliers sync failed, will retry later');
      }
    } catch (error) {
      console.error('[StoresContext] Failed to save suppliers:', error);
      throw error;
    }
  }, [currentUser]);

  const addSupplier = useCallback(async (supplier: Supplier) => {
    const updatedSuppliers = [...suppliers, supplier];
    await saveSuppliers(updatedSuppliers);
  }, [suppliers, saveSuppliers]);

  const updateSupplier = useCallback(async (supplierId: string, updates: Partial<Supplier>) => {
    const updatedSuppliers = suppliers.map(s =>
      s.id === supplierId ? { ...s, ...updates, updatedAt: Date.now() } : s
    );
    await saveSuppliers(updatedSuppliers);
  }, [suppliers, saveSuppliers]);

  const deleteSupplier = useCallback(async (supplierId: string) => {
    const updatedSuppliers = suppliers.map(s =>
      s.id === supplierId ? { ...s, deleted: true as const, updatedAt: Date.now() } : s
    );
    await saveSuppliers(updatedSuppliers as any);
  }, [suppliers, saveSuppliers]);

  const importSuppliers = useCallback(async (newSuppliers: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[]) => {
    const existingSuppliersMap = new Map(
      suppliers.map(s => [s.name.toLowerCase(), s])
    );
    
    const suppliersToAdd: Supplier[] = [];
    
    newSuppliers.forEach(newSupplier => {
      const key = newSupplier.name.toLowerCase();
      const existingSupplier = existingSuppliersMap.get(key);
      
      if (existingSupplier) {
        console.log(`[StoresContext] Supplier "${newSupplier.name}" already exists, skipping...`);
        return;
      }
      
      const fullSupplier: Supplier = {
        id: `supplier-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...newSupplier,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'imported',
      };
      
      suppliersToAdd.push(fullSupplier);
    });
    
    const updatedSuppliers = [...suppliers, ...suppliersToAdd];
    
    await saveSuppliers(updatedSuppliers);
    return suppliersToAdd.length;
  }, [suppliers, saveSuppliers]);

  const saveGRNs = useCallback(async (grnsData: GRN[]) => {
    try {
      const grnsWithTimestamp = grnsData.map(g => ({
        ...g,
        updatedAt: g.updatedAt || Date.now(),
      }));
      await AsyncStorage.setItem(STORAGE_KEYS.GRNS, JSON.stringify(grnsWithTimestamp));
      setGRNs(grnsWithTimestamp.filter(g => !g.deleted));

      try {
        if (currentUser?.id) {
          const synced = await syncData('grns', grnsWithTimestamp, currentUser.id);
          await AsyncStorage.setItem(STORAGE_KEYS.GRNS, JSON.stringify(synced));
          setGRNs((synced as any[]).filter(g => !g?.deleted));
        }
      } catch (e) {
        console.log('[StoresContext] GRNs sync failed, will retry later');
      }
    } catch (error) {
      console.error('[StoresContext] Failed to save GRNs:', error);
      throw error;
    }
  }, [currentUser]);

  const addGRN = useCallback(async (grn: GRN) => {
    const updatedGRNs = [...grns, grn];
    await saveGRNs(updatedGRNs);

    const updatedProducts = storeProducts.map(p => {
      const item = grn.items.find(i => i.storeProductId === p.id);
      if (item) {
        const updates: Partial<StoreProduct> = {
          quantity: p.quantity + item.quantity,
          updatedAt: Date.now(),
        };
        
        if (item.costPerUnit !== undefined && item.costPerUnit !== p.costPerUnit) {
          console.log(`[StoresContext] Updating costPerUnit for "${p.name}" from ${p.costPerUnit} to ${item.costPerUnit}`);
          updates.costPerUnit = item.costPerUnit;
        }
        
        return { ...p, ...updates };
      }
      return p;
    });
    
    await saveStoreProducts(updatedProducts);
  }, [grns, saveGRNs, storeProducts, saveStoreProducts]);

  const updateGRN = useCallback(async (grnId: string, updates: Partial<GRN>) => {
    const updatedGRNs = grns.map(g =>
      g.id === grnId ? { ...g, ...updates, updatedAt: Date.now() } : g
    );
    await saveGRNs(updatedGRNs);
  }, [grns, saveGRNs]);

  const deleteGRN = useCallback(async (grnId: string) => {
    const updatedGRNs = grns.map(g =>
      g.id === grnId ? { ...g, deleted: true as const, updatedAt: Date.now() } : g
    );
    await saveGRNs(updatedGRNs as any);
  }, [grns, saveGRNs]);

  const syncAll = useCallback(async (silent: boolean = false) => {
    if (!currentUser || syncInProgressRef.current) {
      return;
    }
    
    try {
      syncInProgressRef.current = true;
      if (!silent) {
        setIsSyncing(true);
      }
      
      const [syncedStoreProducts, syncedSuppliers, syncedGRNs] = await Promise.all([
        syncData('storeProducts', storeProducts, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }),
        syncData('suppliers', suppliers, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }),
        syncData('grns', grns, currentUser.id),
      ]);

      await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(syncedStoreProducts));
      await AsyncStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(syncedSuppliers));
      await AsyncStorage.setItem(STORAGE_KEYS.GRNS, JSON.stringify(syncedGRNs));

      const filteredProducts = (syncedStoreProducts as any[]).filter(p => !p?.deleted);
      
      setStoreProducts(filteredProducts);
      setSuppliers((syncedSuppliers as any[]).filter(s => !s?.deleted));
      setGRNs((syncedGRNs as any[]).filter(g => !g?.deleted));
      
      setLastSyncTime(Date.now());
    } catch (error) {
      console.error('[StoresContext] syncAll: Failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, storeProducts, suppliers, grns]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        syncAll(true).catch((e) => console.log('[StoresContext] Auto-sync error', e));
      }, 10000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentUser, syncAll]);

  const getLowStockStoreProducts = useCallback(() => {
    return storeProducts.filter(p => p.quantity < p.minStockLevel);
  }, [storeProducts]);

  const reloadFromStorage = useCallback(async () => {
    try {
      console.log('[StoresContext] Reloading all data from AsyncStorage...');
      await loadFromAsyncStorage();
      console.log('[StoresContext] ✓ Reload complete');
    } catch (error) {
      console.error('[StoresContext] Failed to reload from storage:', error);
    }
  }, [loadFromAsyncStorage]);

  return useMemo(() => ({
    storeProducts,
    suppliers,
    grns,
    isLoading,
    isSyncing,
    lastSyncTime,
    addStoreProduct,
    updateStoreProduct,
    deleteStoreProduct,
    importStoreProducts,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    importSuppliers,
    addGRN,
    updateGRN,
    deleteGRN,
    syncAll,
    setUser,
    getLowStockStoreProducts,
    reloadFromStorage,
  }), [
    storeProducts,
    suppliers,
    grns,
    isLoading,
    isSyncing,
    lastSyncTime,
    addStoreProduct,
    updateStoreProduct,
    deleteStoreProduct,
    importStoreProducts,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    importSuppliers,
    addGRN,
    updateGRN,
    deleteGRN,
    syncAll,
    setUser,
    getLowStockStoreProducts,
    reloadFromStorage,
  ]);
});
