import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ProductionRequest, ApprovedProduction } from '@/types';
import { syncData } from '@/utils/syncData';

const STORAGE_KEYS = {
  PRODUCTION_REQUESTS: '@stock_app_production_requests',
  APPROVED_PRODUCTIONS: '@stock_app_approved_productions',
};

export const [ProductionProvider, useProduction] = createContextHook(() => {
  const [productionRequests, setProductionRequests] = useState<ProductionRequest[]>([]);
  const [approvedProductions, setApprovedProductions] = useState<ApprovedProduction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [currentUser, setCurrentUser] = useState<{ id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null>(null);
  const syncInProgressRef = useRef(false);

  const loadFromAsyncStorage = useCallback(async () => {
    try {
      const [requestsData, approvalsData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.PRODUCTION_REQUESTS),
        AsyncStorage.getItem(STORAGE_KEYS.APPROVED_PRODUCTIONS),
      ]);

      console.log('[ProductionContext] Loading from AsyncStorage...');

      if (requestsData) {
        try {
          const parsed = JSON.parse(requestsData);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((r: any) => !r?.deleted);
            console.log(`[ProductionContext] Loaded ${filtered.length} production requests`);
            setProductionRequests(filtered);
          }
        } catch (parseError) {
          console.error('[ProductionContext] Failed to parse production requests:', parseError);
          await AsyncStorage.removeItem(STORAGE_KEYS.PRODUCTION_REQUESTS);
          setProductionRequests([]);
        }
      }

      if (approvalsData) {
        try {
          const parsed = JSON.parse(approvalsData);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter((a: any) => !a?.deleted);
            console.log(`[ProductionContext] Loaded ${filtered.length} approved productions`);
            setApprovedProductions(filtered);
          }
        } catch (parseError) {
          console.error('[ProductionContext] Failed to parse approved productions:', parseError);
          await AsyncStorage.removeItem(STORAGE_KEYS.APPROVED_PRODUCTIONS);
          setApprovedProductions([]);
        }
      }
    } catch (error) {
      console.error('[ProductionContext] Failed to load production data:', error);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        await loadFromAsyncStorage();
      } catch (error) {
        console.error('[ProductionContext] Failed to load production data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [loadFromAsyncStorage]);

  const setUser = useCallback((user: { id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null) => {
    console.log('[ProductionContext] Setting user:', user?.username);
    setCurrentUser(user);
  }, []);

  const saveProductionRequests = useCallback(async (requests: ProductionRequest[]) => {
    try {
      console.log(`[ProductionContext] Saving ${requests.length} production requests to AsyncStorage`);
      const requestsWithTimestamp = requests.map(r => ({
        ...r,
        updatedAt: r.updatedAt || Date.now(),
      }));
      
      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCTION_REQUESTS, JSON.stringify(requestsWithTimestamp));
      const filtered = requestsWithTimestamp.filter(r => !r.deleted);
      console.log(`[ProductionContext] Updated state with ${filtered.length} active requests`);
      setProductionRequests(filtered);

      try {
        if (currentUser?.id) {
          console.log('[ProductionContext] Syncing production requests to server...');
          const synced = await syncData('productionRequests', requestsWithTimestamp, currentUser.id);
          await AsyncStorage.setItem(STORAGE_KEYS.PRODUCTION_REQUESTS, JSON.stringify(synced));
          setProductionRequests((synced as any[]).filter(r => !r?.deleted));
          console.log('[ProductionContext] Sync complete');
        }
      } catch (e) {
        console.log('[ProductionContext] Sync failed, will retry later');
      }
    } catch (error) {
      console.error('[ProductionContext] Failed to save production requests:', error);
      throw error;
    }
  }, [currentUser]);

  const saveApprovedProductions = useCallback(async (approvals: ApprovedProduction[]) => {
    try {
      console.log(`[ProductionContext] Saving ${approvals.length} approved productions to AsyncStorage`);
      const approvalsWithTimestamp = approvals.map(a => ({
        ...a,
        updatedAt: a.updatedAt || Date.now(),
      }));
      
      await AsyncStorage.setItem(STORAGE_KEYS.APPROVED_PRODUCTIONS, JSON.stringify(approvalsWithTimestamp));
      const filtered = approvalsWithTimestamp.filter(a => !a.deleted);
      setApprovedProductions(filtered);

      try {
        if (currentUser?.id) {
          console.log('[ProductionContext] Syncing approved productions to server...');
          const synced = await syncData('approvedProductions', approvalsWithTimestamp, currentUser.id);
          await AsyncStorage.setItem(STORAGE_KEYS.APPROVED_PRODUCTIONS, JSON.stringify(synced));
          setApprovedProductions((synced as any[]).filter(a => !a?.deleted));
          console.log('[ProductionContext] Sync complete');
        }
      } catch (e) {
        console.log('[ProductionContext] Sync failed, will retry later');
      }
    } catch (error) {
      console.error('[ProductionContext] Failed to save approved productions:', error);
      throw error;
    }
  }, [currentUser]);

  const addProductionRequest = useCallback(async (request: ProductionRequest) => {
    console.log('[ProductionContext] Adding production request:', request.date);
    const updatedRequests = [...productionRequests, request];
    await saveProductionRequests(updatedRequests);
  }, [productionRequests, saveProductionRequests]);

  const updateProductionRequest = useCallback(async (requestId: string, updates: Partial<ProductionRequest>) => {
    console.log('[ProductionContext] Updating production request:', requestId);
    const updatedRequests = productionRequests.map(r =>
      r.id === requestId ? { ...r, ...updates, updatedAt: Date.now() } : r
    );
    await saveProductionRequests(updatedRequests);
  }, [productionRequests, saveProductionRequests]);

  const deleteProductionRequest = useCallback(async (requestId: string) => {
    console.log('[ProductionContext] Deleting production request:', requestId);
    const updatedRequests = productionRequests.map(r =>
      r.id === requestId ? { ...r, deleted: true as const, updatedAt: Date.now() } : r
    );
    await saveProductionRequests(updatedRequests as any);
  }, [productionRequests, saveProductionRequests]);

  const approveProductionRequest = useCallback(async (approval: ApprovedProduction) => {
    console.log('[ProductionContext] Approving production request:', approval.requestId);
    
    const updatedRequests = productionRequests.map(r =>
      r.id === approval.requestId ? { ...r, status: 'approved' as const, updatedAt: Date.now() } : r
    );
    await saveProductionRequests(updatedRequests as any);
    
    const updatedApprovals = [...approvedProductions, approval];
    await saveApprovedProductions(updatedApprovals);
  }, [productionRequests, saveProductionRequests, approvedProductions, saveApprovedProductions]);

  const syncAll = useCallback(async (silent: boolean = false) => {
    if (!currentUser || syncInProgressRef.current) {
      return;
    }
    
    try {
      syncInProgressRef.current = true;
      if (!silent) {
        setIsSyncing(true);
      }
      
      const [syncedRequests, syncedApprovals] = await Promise.all([
        syncData('productionRequests', productionRequests, currentUser.id),
        syncData('approvedProductions', approvedProductions, currentUser.id),
      ]);

      await AsyncStorage.setItem(STORAGE_KEYS.PRODUCTION_REQUESTS, JSON.stringify(syncedRequests));
      await AsyncStorage.setItem(STORAGE_KEYS.APPROVED_PRODUCTIONS, JSON.stringify(syncedApprovals));

      const filteredRequests = (syncedRequests as any[]).filter(r => !r?.deleted);
      const filteredApprovals = (syncedApprovals as any[]).filter(a => !a?.deleted);
      
      setProductionRequests(filteredRequests);
      setApprovedProductions(filteredApprovals);
      
      setLastSyncTime(Date.now());
    } catch (error) {
      console.error('[ProductionContext] syncAll: Failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, productionRequests, approvedProductions]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        syncAll(true).catch((e) => console.log('[ProductionContext] Auto-sync error', e));
      }, 10000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentUser, syncAll]);

  const getSortedRequests = useCallback(() => {
    const pending = productionRequests.filter(r => r.status === 'pending').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const approved = productionRequests.filter(r => r.status === 'approved').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return [...pending, ...approved];
  }, [productionRequests]);

  return useMemo(() => ({
    productionRequests,
    approvedProductions,
    isLoading,
    isSyncing,
    lastSyncTime,
    addProductionRequest,
    updateProductionRequest,
    deleteProductionRequest,
    approveProductionRequest,
    syncAll,
    setUser,
    getSortedRequests,
  }), [
    productionRequests,
    approvedProductions,
    isLoading,
    isSyncing,
    lastSyncTime,
    addProductionRequest,
    updateProductionRequest,
    deleteProductionRequest,
    approveProductionRequest,
    syncAll,
    setUser,
    getSortedRequests,
  ]);
});
