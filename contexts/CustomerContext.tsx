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
  deleteDuplicatesByPhone: () => Promise<{ duplicatesFound: number; duplicatesDeleted: number }>;
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
      const remoteData = await getFromServer<Customer>({ userId: currentUser.id, dataType: 'customers' });
      const activeCustomers = remoteData.filter((customer: Customer) => customer.deleted !== true);
      setCustomers(activeCustomers);
      
      const meta = {
        count: activeCustomers.length,
        lastLoaded: Date.now()
      };
      await AsyncStorage.setItem(CUSTOMERS_META_KEY, JSON.stringify(meta));
      
      await AsyncStorage.removeItem(CUSTOMERS_KEY);
    } catch {
      try {
        const stored = await AsyncStorage.getItem(CUSTOMERS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const activeCustomers = parsed.filter((customer: Customer) => customer.deleted !== true);
            setCustomers(activeCustomers);
          }
        }
      } catch {
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
    } catch {
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

    const now = Date.now();
    const newCustomers: Customer[] = customerDataList.map((customerData, index) => ({
      ...customerData,
      id: `customer_${now + index}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now + index,
      updatedAt: now + index,
      createdBy: currentUser.id,
    }));

    const updated = [...customers, ...newCustomers];
    try {
      const synced = await saveToServer(updated, { userId: currentUser.id, dataType: 'customers' });
      setCustomers(synced.filter(c => c.deleted !== true));
    } catch {
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
    const updated = customers.map(customer =>
      customer.id === id
        ? { ...customer, deleted: true, updatedAt: Date.now() }
        : customer
    );
    const activeCustomers = updated.filter(c => c.deleted !== true);
    try {
      setCustomers(activeCustomers);
      await saveToServer(updated, { userId: currentUser?.id || '', dataType: 'customers' });
    } catch (error) {
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
      
      const remoteData = await getFromServer<Customer>({ userId: currentUser.id, dataType: 'customers' });
      const merged = mergeData(customers, remoteData);
      const synced = await saveToServer(merged, { userId: currentUser.id, dataType: 'customers' });
      
      const activeCustomers = synced.filter(customer => customer.deleted !== true);
      setCustomers(activeCustomers);
      setLastSyncTime(Date.now());
    } catch (error) {
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



  const deleteDuplicatesByPhone = useCallback(async () => {
    if (!currentUser) {
      return { duplicatesFound: 0, duplicatesDeleted: 0 };
    }

    const phoneMap = new Map<string, Customer[]>();
    
    customers.forEach(customer => {
      if (customer.phone && customer.phone.trim()) {
        const normalizedPhone = customer.phone.trim();
        if (!phoneMap.has(normalizedPhone)) {
          phoneMap.set(normalizedPhone, []);
        }
        phoneMap.get(normalizedPhone)!.push(customer);
      }
    });

    const duplicateGroups = Array.from(phoneMap.values()).filter(group => group.length > 1);
    const duplicatesFound = duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0);

    if (duplicatesFound === 0) {
      return { duplicatesFound: 0, duplicatesDeleted: 0 };
    }

    const idsToDelete = new Set<string>();
    duplicateGroups.forEach(group => {
      const sorted = [...group].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      sorted.slice(1).forEach(customer => idsToDelete.add(customer.id));
    });

    const updated = customers.map(customer =>
      idsToDelete.has(customer.id)
        ? { ...customer, deleted: true, updatedAt: Date.now() }
        : customer
    );

    const activeCustomers = updated.filter(c => c.deleted !== true);
    try {
      setCustomers(activeCustomers);
      await saveToServer(updated, { userId: currentUser.id, dataType: 'customers' });
      return { duplicatesFound, duplicatesDeleted: idsToDelete.size };
    } catch (error) {
      throw error;
    }
  }, [customers, currentUser]);

  const clearAllCustomers = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(CUSTOMERS_KEY);
      await AsyncStorage.removeItem(CUSTOMERS_META_KEY);
      setCustomers([]);
    } catch (error) {
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
    deleteDuplicatesByPhone,
    searchCustomers,
    syncCustomers,
    clearAllCustomers,
  }), [customers, isLoading, isSyncing, lastSyncTime, addCustomer, importCustomers, updateCustomer, deleteCustomer, deleteDuplicatesByPhone, searchCustomers, syncCustomers, clearAllCustomers]);

  return <CustomerCtx.Provider value={value}>{children}</CustomerCtx.Provider>;
}
