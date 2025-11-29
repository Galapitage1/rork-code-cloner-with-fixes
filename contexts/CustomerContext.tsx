import { useState, useEffect, useCallback, useMemo, useRef, ReactNode, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Customer } from '@/types';
import { syncData } from '@/utils/syncManager';

const CUSTOMERS_KEY = 'customers';

type CustomerContextType = {
  customers: Customer[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  addCustomer: (customerData: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
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
    try {
      const stored = await AsyncStorage.getItem(CUSTOMERS_KEY);
      if (stored) {
        try {
          const trimmed = stored.trim();
          if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              const activeCustomers = parsed.filter((customer: Customer) => customer.deleted !== true);
              setCustomers(activeCustomers);
            } else {
              console.error('Customers data is not an array');
              await AsyncStorage.removeItem(CUSTOMERS_KEY);
              setCustomers([]);
            }
          } else {
            console.error('Customers data is not valid JSON:', stored);
            await AsyncStorage.removeItem(CUSTOMERS_KEY);
            setCustomers([]);
          }
        } catch (parseError) {
          console.error('Failed to parse customers data:', parseError);
          console.error('Raw data:', stored);
          await AsyncStorage.removeItem(CUSTOMERS_KEY);
          setCustomers([]);
        }
      }
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);



  const saveCustomers = useCallback(async (newCustomers: Customer[]) => {
    try {
      const allCustomers = await AsyncStorage.getItem(CUSTOMERS_KEY);
      const existingCustomers = allCustomers ? JSON.parse(allCustomers) : [];
      const deletedCustomers = existingCustomers.filter((c: Customer) => c.deleted === true);
      const customersWithDeleted = [...newCustomers, ...deletedCustomers];
      
      await AsyncStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customersWithDeleted));
      setCustomers(newCustomers);
      console.log('saveCustomers: Saved locally, will sync on next interval');
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
      await AsyncStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
      setCustomers(activeCustomers);
      console.log('CustomerContext deleteCustomer: Saved locally, will sync on next interval');
    } catch (error) {
      console.error('CustomerContext deleteCustomer: Failed', error);
      throw error;
    }
  }, [customers]);

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
      const allCustomers = await AsyncStorage.getItem(CUSTOMERS_KEY);
      const customersToSync: Customer[] = allCustomers ? JSON.parse(allCustomers) : customers;
      const synced = await syncData<Customer>('customers', customersToSync, currentUser.id);
      await AsyncStorage.setItem(CUSTOMERS_KEY, JSON.stringify(synced));
      const activeCustomers = synced.filter(customer => customer.deleted !== true);
      setCustomers(activeCustomers);
      setLastSyncTime(Date.now());
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
    updateCustomer,
    deleteCustomer,
    searchCustomers,
    syncCustomers,
    clearAllCustomers,
  }), [customers, isLoading, isSyncing, lastSyncTime, addCustomer, updateCustomer, deleteCustomer, searchCustomers, syncCustomers, clearAllCustomers]);

  return <CustomerCtx.Provider value={value}>{children}</CustomerCtx.Provider>;
}
