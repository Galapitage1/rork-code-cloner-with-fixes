import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, ReactNode, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Product, Recipe } from '@/types';
import { saveToServer, getFromServer, mergeData } from '@/utils/directSync';

const STORAGE_KEY = '@stock_app_recipes';
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
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  addOrUpdateRecipe: (recipe: Recipe) => Promise<void>;
  batchAddOrUpdateRecipes: (recipes: Recipe[]) => Promise<void>;
  deleteRecipe: (menuProductId: string) => Promise<void>;
  getRecipeFor: (menuProductId: string) => Recipe | undefined;
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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const syncInProgressRef = useRef(false);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          try {
            const trimmed = raw.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) setRecipes(parsed);
            }
          } catch {
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const save = useCallback(async (next: Recipe[]) => {
    const serialized = JSON.stringify(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
      setRecipes(next);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }
      console.warn('[RECIPES] Local recipe save exceeded quota. Clearing temporary caches and retrying...');
    }

    for (const key of QUOTA_RECOVERY_KEYS) {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Keep going; this is best-effort cleanup.
      }
    }

    try {
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
      setRecipes(next);
    } catch (retryError) {
      if (isQuotaExceededError(retryError)) {
        throw new Error('Unable to save recipes locally because device storage is full. Temporary caches were cleared, but more space is required. Run manual cleanup in Settings, then retry.');
      }
      throw retryError;
    }
  }, []);

  const addOrUpdateRecipe = useCallback(async (recipe: Recipe) => {
    const idx = recipes.findIndex(r => r.menuProductId === recipe.menuProductId);
    const next = [...recipes];
    const withTs = { ...recipe, updatedAt: Date.now() };
    if (idx >= 0) next[idx] = withTs; else next.push(withTs);
    await save(next);
  }, [recipes, save]);

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
    await save(next);
  }, [recipes, save]);

  const deleteRecipe = useCallback(async (menuProductId: string) => {
    const next = recipes.filter(r => r.menuProductId !== menuProductId);
    await save(next);
  }, [recipes, save]);

  const getRecipeFor = useCallback((menuProductId: string) => recipes.find(r => r.menuProductId === menuProductId), [recipes]);

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
      
      const remoteData = await getFromServer<Recipe>({ userId: currentUser.id, dataType: 'recipes' });
      const merged = mergeData(localRecipes, remoteData);
      const synced = await saveToServer(merged, { userId: currentUser.id, dataType: 'recipes' });
      
      await save(synced as Recipe[]);
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
  }, [currentUser, save]);



  const value = useMemo(() => ({
    recipes,
    isLoading,
    isSyncing,
    lastSyncTime,
    addOrUpdateRecipe,
    batchAddOrUpdateRecipes,
    deleteRecipe,
    getRecipeFor,
    computeConsumption,
    syncRecipes,
  }), [recipes, isLoading, isSyncing, lastSyncTime, addOrUpdateRecipe, batchAddOrUpdateRecipes, deleteRecipe, getRecipeFor, computeConsumption, syncRecipes]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
