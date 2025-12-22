import { useState, useEffect, useCallback, useMemo, useRef, ReactNode, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Customer } from '@/types';
import { saveToServer, getFromServer, mergeData } from '@/utils/directSync';

const CUSTOMERS_KEY = '@stock_app_customers';
const CUSTOMERS_META_KEY = '@stock_app_customers_meta';

type CustomerContextType = {
  customers: Customer[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  addCustomer: (customerData: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
  importCustomers: (customerDataList: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[]) => Promise<number>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  searchCustomers: (query: string) => Customer[];
  syncCustomers: (silent?: boolean) => Promise<void>;
  clearAllCustomers: () => Promise<void>;
};

const CustomerCtx = createContext<CustomerContextType | null>(null);

export function useCustomers() {
  const context = useContext(CustomerCtx);
  if (!context) {
    throw new Error('useCustomers must be used within CustomerProvider');
  }
  return context;
}

export function CustomerProvider({ children, currentUser }: { children: ReactNode; currentUser: { id: string } | null }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);

  const loadCustomers = useCallback(async () => {
    if (!currentUser) {
      setIsLoading(false);
      return;
    }
    
    try {
      console.log('[CustomerContext] Loading customers from server...');
      const remoteData = await getFromServer<Customer>({ userId: currentUser.id, dataType: 'customers' });
      const activeCustomers = remoteData.filter((customer: Customer) => customer.deleted !== true);
      setCustomers(activeCustomers);
      console.log('[CustomerContext] Loaded', activeCustomers.length, 'customers from server');
      
      const meta = {
        count: activeCustomers.length,
        lastLoaded: Date.now()
      };
      await AsyncStorage.setItem(CUSTOMERS_META_KEY, JSON.stringify(meta));
      
      await AsyncStorage.removeItem(CUSTOMERS_KEY);
    } catch (error) {
      console.error('Error loading customers from server:', error);
      try {
        const stored = await AsyncStorage.getItem(CUSTOMERS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const activeCustomers = parsed.filter((customer: Customer) => customer.deleted !== true);
            setCustomers(activeCustomers);
            console.log('[CustomerContext] Loaded', activeCustomers.length, 'customers from legacy cache');
          }
        }
      } catch (cacheError) {
        console.error('Error loading from cache:', cacheError);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);



  const saveCustomers = useCallback(async (newCustomers: Customer[]) => {
    try {
      setCustomers(newCustomers);
      console.log('saveCustomers: Updated state with', newCustomers.length, 'customers');
    } catch (error) {
      console.error('Error saving customers:', error);
    }
  }, []);

  const addCustomer = useCallback(async (customerData: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
    if (!currentUser) return;

    const newCustomer: Customer = {
      ...customerData,
      id: `customer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: currentUser.id,
    };

    const updated = [...customers, newCustomer];
    await saveCustomers(updated);
  }, [currentUser, customers, saveCustomers]);

  const importCustomers = useCallback(async (customerDataList: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[]) => {
    if (!currentUser) return 0;

    console.log('[CustomerContext] importCustomers: Starting import of', customerDataList.length, 'customers');
    console.log('[CustomerContext] importCustomers: Current customers count before import:', customers.length);

    const now = Date.now();
    const newCustomers: Customer[] = customerDataList.map((customerData, index) => ({
      ...customerData,
      id: `customer_${now + index}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now + index,
      updatedAt: now + index,
      createdBy: currentUser.id,
    }));

    const updated = [...customers, ...newCustomers];
    console.log('[CustomerContext] importCustomers: Total customers after merge:', updated.length);
    
    console.log('[CustomerContext] importCustomers: Syncing to server...');
    try {
      const synced = await saveToServer(updated, { userId: currentUser.id, dataType: 'customers' });
      setCustomers(synced.filter(c => c.deleted !== true));
      console.log('[CustomerContext] importCustomers: Synced to server successfully');
    } catch (error) {
      console.error('[CustomerContext] importCustomers: Failed to sync to server:', error);
      await saveCustomers(updated);
    }
    
    return newCustomers.length;
  }, [currentUser, customers, saveCustomers]);

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    const updated = customers.map(customer =>
      customer.id === id
        ? { ...customer, ...updates, updatedAt: Date.now() }
        : customer
    );
    await saveCustomers(updated);
  }, [customers, saveCustomers]);

  const deleteCustomer = useCallback(async (id: string) => {
    console.log('CustomerContext deleteCustomer: Marking customer as deleted', id);
    const updated = customers.map(customer =>
      customer.id === id
        ? { ...customer, deleted: true, updatedAt: Date.now() }
        : customer
    );
    const activeCustomers = updated.filter(c => c.deleted !== true);
    console.log('CustomerContext deleteCustomer: Customers after marking deleted', activeCustomers.length);
    
    try {
      setCustomers(activeCustomers);
      await saveToServer(updated, { userId: currentUser?.id || '', dataType: 'customers' });
      console.log('CustomerContext deleteCustomer: Synced to server');
    } catch (error) {
      console.error('CustomerContext deleteCustomer: Failed', error);
      throw error;
    }
  }, [customers, currentUser]);

  const searchCustomers = useCallback((query: string): Customer[] => {
    if (!query.trim()) return customers;

    const lowerQuery = query.toLowerCase();
    return customers.filter(customer =>
      customer.name.toLowerCase().includes(lowerQuery) ||
      customer.email?.toLowerCase().includes(lowerQuery) ||
      customer.phone?.includes(query) ||
      customer.company?.toLowerCase().includes(lowerQuery)
    );
  }, [customers]);

  const syncInProgressRef = useRef(false);

  const syncCustomers = useCallback(async (silent: boolean = false) => {
    if (!currentUser) {
      return;
    }
    
    if (syncInProgressRef.current) {
      return;
    }
    
    try {
      syncInProgressRef.current = true;
      if (!silent) {
        setIsSyncing(true);
      }
      
      console.log('[CustomerContext] Starting sync for customers...');
      const remoteData = await getFromServer<Customer>({ userId: currentUser.id, dataType: 'customers' });
      const merged = mergeData(customers, remoteData);
      const synced = await saveToServer(merged, { userId: currentUser.id, dataType: 'customers' });
      
      const activeCustomers = synced.filter(customer => customer.deleted !== true);
      setCustomers(activeCustomers);
      setLastSyncTime(Date.now());
      console.log('[CustomerContext] Sync complete. Synced', activeCustomers.length, 'customers');
    } catch (error) {
      console.error('CustomerContext syncCustomers: Failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, customers]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        syncCustomers(true).catch((e) => console.log('Customers auto-sync error', e));
      }, 10000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [currentUser, syncCustomers]);

  const clearAllCustomers = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(CUSTOMERS_KEY);
      await AsyncStorage.removeItem(CUSTOMERS_META_KEY);
      setCustomers([]);
    } catch (error) {
      console.error('Failed to clear customers:', error);
      throw error as Error;
    }
  }, []);

  const value = useMemo(() => ({
    customers,
    isLoading,
    isSyncing,
    lastSyncTime,
    addCustomer,
    importCustomers,
    updateCustomer,
    deleteCustomer,
    searchCustomers,
    syncCustomers,
    clearAllCustomers,
  }), [customers, isLoading, isSyncing, lastSyncTime, addCustomer, importCustomers, updateCustomer, deleteCustomer, searchCustomers, syncCustomers, clearAllCustomers]);

  return <CustomerCtx.Provider value={value}>{children}</CustomerCtx.Provider>;
}
