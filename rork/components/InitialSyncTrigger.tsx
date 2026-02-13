import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStock } from '@/contexts/StockContext';
import { useCustomers } from '@/contexts/CustomerContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useOrders } from '@/contexts/OrderContext';
import { useStores } from '@/contexts/StoresContext';
import { useProduction } from '@/contexts/ProductionContext';
import { useActivityLog } from '@/contexts/ActivityLogContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function InitialSyncTrigger() {
  const { currentUser, initialSyncComplete, setInitialSyncComplete } = useAuth();
  const { syncAll: syncStockAll } = useStock();
  const { syncCustomers } = useCustomers();
  const { syncRecipes } = useRecipes();
  const { syncOrders } = useOrders();
  const { syncAll: syncAllStores, setUser: setStoresUser } = useStores();
  const { syncAll: syncProduction, setUser: setProductionUser } = useProduction();
  const { syncLogs } = useActivityLog();
  
  const syncInProgressRef = useRef(false);

  const performInitialSync = useCallback(async () => {      
    if (!currentUser || initialSyncComplete || syncInProgressRef.current) {
      console.log('[InitialSyncTrigger] Skipping sync - user:', !!currentUser, 'complete:', initialSyncComplete, 'in progress:', syncInProgressRef.current);
      return;
    }

    console.log('[InitialSyncTrigger] Starting initial sync for user:', currentUser.username);
    syncInProgressRef.current = true;
    
    try {
      setStoresUser(currentUser);
      setProductionUser(currentUser);
      
      await syncCustomers(true);
      await syncRecipes(true);
      await syncOrders(true);
      await syncAllStores(true);
      await syncProduction(true);
      
      try {
        await syncLogs(true);
      } catch (e: any) {
        if (e?.message?.includes('quota')) {
          console.log('[InitialSyncTrigger] Storage quota exceeded for activity logs, clearing...');
          await AsyncStorage.setItem('@stock_app_activity_logs', JSON.stringify([]));
        }
      }
      
      await syncStockAll(true);

      console.log('[InitialSyncTrigger] All syncs complete');
      setInitialSyncComplete(true);
    } catch (error) {
      console.error('[InitialSyncTrigger] Sync error:', error);
    } finally {
      syncInProgressRef.current = false;
    }
  }, [currentUser, initialSyncComplete, setInitialSyncComplete, syncCustomers, syncRecipes, syncOrders, syncAllStores, syncProduction, syncLogs, syncStockAll, setStoresUser, setProductionUser]);

  useEffect(() => {
    if (currentUser && !initialSyncComplete) {
      console.log('[InitialSyncTrigger] User logged in, will start sync in 500ms');
      const timeout = setTimeout(() => {
        performInitialSync();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [currentUser, initialSyncComplete, performInitialSync]);

  return null;
}
