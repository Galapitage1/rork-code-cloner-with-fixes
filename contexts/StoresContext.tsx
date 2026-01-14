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
      } catch {
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
      
      // CRITICAL STEP 4: Update local state immediately
      // Filter out deleted products for UI
      const activeProducts = updatedProducts.filter((p: StoreProduct) => !p.deleted);
      setStoreProducts(activeProducts);
      console.log('[StoresContext] ✓ UI updated with', activeProducts.length, 'active products');
      
      console.log('[StoresContext] ✓✓✓ Deletion complete for:', productToDelete.name);
      console.log('[StoresContext] Note: Sync will happen automatically on next sync cycle');
      console.log('[StoresContext] ========================================');
    } catch (error) {
      console.error('[StoresContext] ========================================');
      console.error('[StoresContext] ❌ CRITICAL ERROR during deletion:', error);
      console.error('[StoresContext] ========================================');
      throw error;
    }
  }, [storeProducts]);

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
      } catch {
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
      } catch {
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
      
      // CRITICAL: Read FRESH data from AsyncStorage before syncing
      // This ensures we sync the latest data including any deletions
      console.log('[StoresContext] syncAll: Reading fresh data from AsyncStorage...');
      const [storeProductsData, suppliersData, grnsData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.STORE_PRODUCTS),
        AsyncStorage.getItem(STORAGE_KEYS.SUPPLIERS),
        AsyncStorage.getItem(STORAGE_KEYS.GRNS),
      ]);
      
      const freshStoreProducts = storeProductsData ? JSON.parse(storeProductsData) : storeProducts;
      const freshSuppliers = suppliersData ? JSON.parse(suppliersData) : suppliers;
      const freshGRNs = grnsData ? JSON.parse(grnsData) : grns;
      
      console.log('[StoresContext] syncAll: Syncing fresh data to server...');
      const [syncedStoreProducts, syncedSuppliers, syncedGRNs] = await Promise.all([
        syncData('storeProducts', freshStoreProducts, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }),
        syncData('suppliers', freshSuppliers, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' }),
        syncData('grns', freshGRNs, currentUser.id),
      ]);

      await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(syncedStoreProducts));
      await AsyncStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(syncedSuppliers));
      await AsyncStorage.setItem(STORAGE_KEYS.GRNS, JSON.stringify(syncedGRNs));

      const filteredProducts = (syncedStoreProducts as any[]).filter(p => !p?.deleted);
      
      setStoreProducts(filteredProducts);
      setSuppliers((syncedSuppliers as any[]).filter(s => !s?.deleted));
      setGRNs((syncedGRNs as any[]).filter(g => !g?.deleted));
      
      setLastSyncTime(Date.now());
      console.log('[StoresContext] syncAll: Complete - synced', filteredProducts.length, 'active store products');
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
      }, 300000);
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

  const removeDuplicateStoreProducts = useCallback(async () => {
    console.log('[StoresContext] ========================================');
    console.log('[StoresContext] removeDuplicateStoreProducts: Starting...');
    
    try {
      console.log('[StoresContext] STEP 1: Reading fresh data from AsyncStorage...');
      const storedData = await AsyncStorage.getItem(STORAGE_KEYS.STORE_PRODUCTS);
      const freshStoreProducts: StoreProduct[] = storedData ? JSON.parse(storedData) : [];
      console.log('[StoresContext] Total products in storage:', freshStoreProducts.length);
      
      const activeProducts = freshStoreProducts.filter(p => !p.deleted);
      console.log('[StoresContext] Active products (not deleted):', activeProducts.length);
      
      console.log('[StoresContext] STEP 2: Identifying duplicates by name + unit...');
      const seen = new Map<string, StoreProduct>();
      const duplicates: string[] = [];
      
      activeProducts.forEach(product => {
        const key = `${product.name.toLowerCase().trim()}_${product.unit.toLowerCase().trim()}`;
        const existing = seen.get(key);
        
        if (existing) {
          console.log(`[StoresContext] Found duplicate: "${product.name}" (${product.unit})`);
          console.log(`[StoresContext]   - Existing ID: ${existing.id}, timestamp: ${existing.updatedAt || existing.createdAt}`);
          console.log(`[StoresContext]   - Duplicate ID: ${product.id}, timestamp: ${product.updatedAt || product.createdAt}`);
          
          const existingTime = existing.updatedAt || existing.createdAt || 0;
          const productTime = product.updatedAt || product.createdAt || 0;
          
          if (productTime > existingTime) {
            console.log(`[StoresContext]   - Keeping newer product (${product.id}), marking older as duplicate`);
            duplicates.push(existing.id);
            seen.set(key, product);
          } else {
            console.log(`[StoresContext]   - Keeping older product (${existing.id}), marking newer as duplicate`);
            duplicates.push(product.id);
          }
        } else {
          seen.set(key, product);
        }
      });
      
      console.log('[StoresContext] Total duplicates found:', duplicates.length);
      
      if (duplicates.length === 0) {
        console.log('[StoresContext] No duplicates to remove');
        console.log('[StoresContext] ========================================');
        return {
          duplicatesRemoved: 0,
          remainingCount: activeProducts.length,
        };
      }
      
      console.log('[StoresContext] STEP 3: Marking duplicates as deleted...');
      const now = Date.now();
      const updatedProducts = freshStoreProducts.map(p => {
        if (duplicates.includes(p.id)) {
          console.log(`[StoresContext] Marking as deleted: "${p.name}" (${p.unit}) - ID: ${p.id}`);
          return { ...p, deleted: true as const, updatedAt: now };
        }
        return p;
      });
      
      console.log('[StoresContext] STEP 4: Saving to AsyncStorage...');
      await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(updatedProducts));
      console.log('[StoresContext] ✓ Saved to AsyncStorage');
      
      console.log('[StoresContext] STEP 5: Updating local state...');
      const remainingActive = updatedProducts.filter(p => !p.deleted);
      setStoreProducts(remainingActive);
      console.log('[StoresContext] ✓ Updated state with', remainingActive.length, 'active products');
      
      console.log('[StoresContext] STEP 6: Syncing to server...');
      if (currentUser?.id) {
        try {
          const synced = await syncData('storeProducts', updatedProducts, currentUser.id, { 
            isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' 
          });
          await AsyncStorage.setItem(STORAGE_KEYS.STORE_PRODUCTS, JSON.stringify(synced));
          const syncedActive = (synced as any[]).filter(p => !p?.deleted);
          setStoreProducts(syncedActive);
          console.log('[StoresContext] ✓ Synced to server, final count:', syncedActive.length);
        } catch (syncError) {
          console.log('[StoresContext] Sync failed (will retry on next auto-sync):', syncError);
        }
      }
      
      console.log('[StoresContext] ✓✓✓ Duplicate removal complete');
      console.log('[StoresContext] ========================================');
      
      return {
        duplicatesRemoved: duplicates.length,
        remainingCount: remainingActive.length,
      };
    } catch (error) {
      console.error('[StoresContext] ========================================');
      console.error('[StoresContext] ❌ CRITICAL ERROR during duplicate removal:', error);
      console.error('[StoresContext] ========================================');
      throw error;
    }
  }, [currentUser]);

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
    removeDuplicateStoreProducts,
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
    removeDuplicateStoreProducts,
  ]);
});
