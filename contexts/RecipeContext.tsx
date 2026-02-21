import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, ReactNode, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { LinkedProductMapping, Product, Recipe } from '@/types';
import { saveToServer, getFromServer, mergeData } from '@/utils/directSync';

const STORAGE_KEY = '@stock_app_recipes';
const LINKED_PRODUCTS_STORAGE_KEY = '@stock_app_linked_products';
const QUOTA_RECOVERY_KEYS = [
  '@reconciliation_sales_reports',
  '@reconciliation_kitchen_stock_reports',
  '@stock_app_live_inventory_snapshots',
  '@stock_app_activity_logs',
] as const;

function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const lower = message.toLowerCase();
  return lower.includes('quota') || lower.includes('exceeded');
}

type RecipeContextType = {
  recipes: Recipe[];
  linkedProducts: LinkedProductMapping[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  addOrUpdateRecipe: (recipe: Recipe) => Promise<void>;
  batchAddOrUpdateRecipes: (recipes: Recipe[]) => Promise<void>;
  deleteRecipe: (menuProductId: string) => Promise<void>;
  getRecipeFor: (menuProductId: string) => Recipe | undefined;
  addOrUpdateLinkedProduct: (mapping: LinkedProductMapping) => Promise<void>;
  deleteLinkedProduct: (menuProductId: string) => Promise<void>;
  getLinkedProductFor: (menuProductId: string) => LinkedProductMapping | undefined;
  computeConsumption: (sales: { productId: string; sold: number }[]) => Map<string, number>;
  syncRecipes: (silent?: boolean) => Promise<void>;
};

const Ctx = createContext<RecipeContextType | null>(null);

export function useRecipes() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRecipes must be used within RecipeProvider');
  return ctx;
}

export function RecipeProvider({ children, currentUser, products }: { children: ReactNode; currentUser: { id: string } | null; products: Product[] }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [linkedProducts, setLinkedProducts] = useState<LinkedProductMapping[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const syncInProgressRef = useRef(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [rawRecipes, rawLinkedProducts] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(LINKED_PRODUCTS_STORAGE_KEY),
        ]);

        if (rawRecipes) {
          try {
            const trimmed = rawRecipes.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) setRecipes(parsed);
            }
          } catch {
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        }

        if (rawLinkedProducts) {
          try {
            const trimmed = rawLinkedProducts.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setLinkedProducts(parsed.filter((item: LinkedProductMapping) => !item?.deleted));
              }
            }
          } catch {
            await AsyncStorage.removeItem(LINKED_PRODUCTS_STORAGE_KEY);
          }
        }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const persistWithQuotaRecovery = useCallback(async (key: string, serialized: string) => {
    try {
      await AsyncStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }
      console.warn(`[RECIPES] Local save exceeded quota for key ${key}. Clearing temporary caches and retrying...`);
    }

    for (const key of QUOTA_RECOVERY_KEYS) {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Keep going; this is best-effort cleanup.
      }
    }

    try {
      await AsyncStorage.setItem(key, serialized);
      return true;
    } catch (retryError) {
      if (isQuotaExceededError(retryError)) {
        throw new Error('Unable to save linked recipe data locally because device storage is full. Temporary caches were cleared, but more space is required. Run manual cleanup in Settings, then retry.');
      }
      throw retryError;
    }
  }, []);

  const saveRecipes = useCallback(async (next: Recipe[]) => {
    const serialized = JSON.stringify(next);
    await persistWithQuotaRecovery(STORAGE_KEY, serialized);
    setRecipes(next);
  }, [persistWithQuotaRecovery]);

  const saveLinkedProducts = useCallback(async (next: LinkedProductMapping[]) => {
    const withTimestamp = next.map((item) => ({ ...item, updatedAt: item.updatedAt || Date.now() }));
    const serialized = JSON.stringify(withTimestamp);
    await persistWithQuotaRecovery(LINKED_PRODUCTS_STORAGE_KEY, serialized);
    setLinkedProducts(withTimestamp.filter((item) => !item.deleted));
  }, [persistWithQuotaRecovery]);

  const addOrUpdateRecipe = useCallback(async (recipe: Recipe) => {
    const idx = recipes.findIndex(r => r.menuProductId === recipe.menuProductId);
    const next = [...recipes];
    const withTs = { ...recipe, updatedAt: Date.now() };
    if (idx >= 0) next[idx] = withTs; else next.push(withTs);
    await saveRecipes(next);
  }, [recipes, saveRecipes]);

  const batchAddOrUpdateRecipes = useCallback(async (newRecipes: Recipe[]) => {
    const next = [...recipes];
    newRecipes.forEach(recipe => {
      const withTs = { ...recipe, updatedAt: Date.now() };
      const idx = next.findIndex(r => r.menuProductId === recipe.menuProductId);
      if (idx >= 0) {
        next[idx] = withTs;
      } else {
        next.push(withTs);
      }
    });
    await saveRecipes(next);
  }, [recipes, saveRecipes]);

  const deleteRecipe = useCallback(async (menuProductId: string) => {
    const next = recipes.filter(r => r.menuProductId !== menuProductId);
    await saveRecipes(next);
  }, [recipes, saveRecipes]);

  const getRecipeFor = useCallback((menuProductId: string) => recipes.find(r => r.menuProductId === menuProductId), [recipes]);
  
  const addOrUpdateLinkedProduct = useCallback(async (mapping: LinkedProductMapping) => {
    const withTs: LinkedProductMapping = {
      ...mapping,
      id: mapping.id || `lnk-${mapping.menuProductId}`,
      updatedAt: Date.now(),
      deleted: false,
    };
    const existing = linkedProducts.filter(item => item.menuProductId !== withTs.menuProductId);
    const next = [...existing, withTs];
    await saveLinkedProducts(next);
  }, [linkedProducts, saveLinkedProducts]);

  const deleteLinkedProduct = useCallback(async (menuProductId: string) => {
    const existing = linkedProducts.find(item => item.menuProductId === menuProductId);
    const tombstone: LinkedProductMapping = {
      id: existing?.id || `lnk-${menuProductId}`,
      menuProductId,
      components: existing?.components || [],
      deleted: true,
      updatedAt: Date.now(),
    };
    const next = [
      ...linkedProducts.filter(item => item.menuProductId !== menuProductId),
      tombstone,
    ];
    await saveLinkedProducts(next);
  }, [linkedProducts, saveLinkedProducts]);

  const getLinkedProductFor = useCallback((menuProductId: string) => {
    return linkedProducts.find(item => item.menuProductId === menuProductId && !item.deleted);
  }, [linkedProducts]);

  const computeConsumption = useCallback((sales: { productId: string; sold: number }[]) => {
    const menuToRecipe = new Map<string, Recipe>();
    recipes.forEach(r => menuToRecipe.set(r.menuProductId, r));
    const totals = new Map<string, number>();
    sales.forEach(({ productId, sold }) => {
      const recipe = menuToRecipe.get(productId);
      if (!recipe || !Number.isFinite(sold) || sold <= 0) return;
      recipe.components.forEach(c => {
        const prev = totals.get(c.rawProductId) || 0;
        totals.set(c.rawProductId, prev + sold * c.quantityPerUnit);
      });
    });
    return totals;
  }, [recipes]);

  const syncRecipes = useCallback(async (silent: boolean = false) => {
    if (!currentUser?.id) return;
    if (syncInProgressRef.current) return;
    try {
      syncInProgressRef.current = true;
      if (!silent) {
        setIsSyncing(true);
      }
      
      const localRaw = await AsyncStorage.getItem(STORAGE_KEY);
      const localRecipes = localRaw ? JSON.parse(localRaw) : [];
      const localLinkedRaw = await AsyncStorage.getItem(LINKED_PRODUCTS_STORAGE_KEY);
      const localLinkedProducts = localLinkedRaw ? JSON.parse(localLinkedRaw) : [];
      
      const [remoteRecipes, remoteLinkedProducts] = await Promise.all([
        getFromServer<Recipe>({ userId: currentUser.id, dataType: 'recipes' }),
        getFromServer<LinkedProductMapping>({ userId: currentUser.id, dataType: 'linkedProducts' }),
      ]);
      const mergedRecipes = mergeData(localRecipes, remoteRecipes);
      const mergedLinkedProducts = mergeData(localLinkedProducts, remoteLinkedProducts);
      const [syncedRecipes, syncedLinkedProducts] = await Promise.all([
        saveToServer(mergedRecipes, { userId: currentUser.id, dataType: 'recipes' }),
        saveToServer(mergedLinkedProducts, { userId: currentUser.id, dataType: 'linkedProducts' }),
      ]);
      
      await Promise.all([
        saveRecipes(syncedRecipes as Recipe[]),
        saveLinkedProducts(syncedLinkedProducts as LinkedProductMapping[]),
      ]);
      setLastSyncTime(Date.now());
    } catch (e) {
      if (!silent) {
        throw e;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, saveLinkedProducts, saveRecipes]);



  const value = useMemo(() => ({
    recipes,
    linkedProducts,
    isLoading,
    isSyncing,
    lastSyncTime,
    addOrUpdateRecipe,
    batchAddOrUpdateRecipes,
    deleteRecipe,
    getRecipeFor,
    addOrUpdateLinkedProduct,
    deleteLinkedProduct,
    getLinkedProductFor,
    computeConsumption,
    syncRecipes,
  }), [recipes, linkedProducts, isLoading, isSyncing, lastSyncTime, addOrUpdateRecipe, batchAddOrUpdateRecipes, deleteRecipe, getRecipeFor, addOrUpdateLinkedProduct, deleteLinkedProduct, getLinkedProductFor, computeConsumption, syncRecipes]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
