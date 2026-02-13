import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, ReactNode, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Product, Recipe } from '@/types';
import { syncData } from '@/utils/syncManager';

const STORAGE_KEY = '@stock_app_recipes';

type RecipeContextType = {
  recipes: Recipe[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  addOrUpdateRecipe: (recipe: Recipe) => Promise<void>;
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
          } catch (e) {
            console.log('RecipeContext: failed to parse, clearing');
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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setRecipes(next);
    console.log('RecipeContext: Saved locally, will sync on next interval');
  }, []);

  const addOrUpdateRecipe = useCallback(async (recipe: Recipe) => {
    const idx = recipes.findIndex(r => r.menuProductId === recipe.menuProductId);
    const next = [...recipes];
    const withTs = { ...recipe, updatedAt: Date.now() };
    if (idx >= 0) next[idx] = withTs; else next.push(withTs);
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
      const synced = await syncData('recipes', recipes, currentUser.id);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(synced));
      setRecipes(synced as Recipe[]);
      setLastSyncTime(Date.now());
    } catch (e) {
      console.error('RecipeContext sync failed:', e);
      if (!silent) {
        throw e;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, recipes]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        syncRecipes(true).catch(err => console.log('Recipes auto-sync error', err));
      }, 60000);
    }
    return () => {
      if (interval) {
        console.log('RecipeContext: Clearing auto-sync interval');
        clearInterval(interval);
      }
    };
  }, [currentUser, isSyncing, syncRecipes]);

  const value = useMemo(() => ({
    recipes,
    isLoading,
    isSyncing,
    lastSyncTime,
    addOrUpdateRecipe,
    deleteRecipe,
    getRecipeFor,
    computeConsumption,
    syncRecipes,
  }), [recipes, isLoading, isSyncing, lastSyncTime, addOrUpdateRecipe, deleteRecipe, getRecipeFor, computeConsumption, syncRecipes]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
