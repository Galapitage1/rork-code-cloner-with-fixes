import { useState, useEffect, useCallback, useMemo, ReactNode, createContext, useContext, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerOrder } from '@/types';
import { saveToServer, getFromServer, mergeData } from '@/utils/directSync';

const ORDERS_KEY = '@stock_app_orders';

type OrderContextType = {
  orders: CustomerOrder[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  addOrder: (orderData: Omit<CustomerOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => Promise<void>;
  updateOrder: (id: string, updates: Partial<CustomerOrder>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  fulfillOrder: (id: string, fulfilledBy: string) => Promise<void>;
  getActiveOrders: () => CustomerOrder[];
  getFulfilledOrders: () => CustomerOrder[];
  syncOrders: (silent?: boolean) => Promise<void>;
  clearAllOrders: () => Promise<void>;
};

const OrderCtx = createContext<OrderContextType | null>(null);

export function useOrders() {
  const context = useContext(OrderCtx);
  if (!context) {
    throw new Error('useOrders must be used within OrderProvider');
  }
  return context;
}

export function OrderProvider({ children, currentUser }: { children: ReactNode; currentUser: { id: string } | null }) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const syncOrdersRef = useRef<(() => Promise<void>) | null>(null);
  const syncInProgressRef = useRef<boolean>(false);

  const loadOrders = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(ORDERS_KEY);
      if (stored) {
        try {
          const trimmed = stored.trim();
          if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              const activeOrders = parsed.filter(order => !order.deleted);
              setOrders(activeOrders);
            } else {
              console.error('Orders data is not an array');
              await AsyncStorage.removeItem(ORDERS_KEY);
              setOrders([]);
            }
          } else {
            console.error('Orders data is not valid JSON:', stored);
            await AsyncStorage.removeItem(ORDERS_KEY);
            setOrders([]);
          }
        } catch (parseError) {
          console.error('Failed to parse orders data:', parseError);
          console.error('Raw data:', stored);
          await AsyncStorage.removeItem(ORDERS_KEY);
          setOrders([]);
        }
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const saveOrders = useCallback(async (newOrders: CustomerOrder[], immediate: boolean = true) => {
    try {
      const allOrders = await AsyncStorage.getItem(ORDERS_KEY);
      const existingOrders = allOrders ? JSON.parse(allOrders) : [];
      const deletedOrders = existingOrders.filter((o: CustomerOrder) => o.deleted);
      const ordersWithDeleted = [...newOrders, ...deletedOrders];
      
      console.log('OrderContext saveOrders: Saving to AsyncStorage...', { activeCount: newOrders.length, deletedCount: deletedOrders.length });
      await AsyncStorage.setItem(ORDERS_KEY, JSON.stringify(ordersWithDeleted));
      setOrders(newOrders);
      console.log('OrderContext saveOrders: Saved locally');
      
      if (immediate && currentUser && syncOrdersRef.current) {
        console.log('OrderContext saveOrders: Triggering immediate sync to server...');
        syncOrdersRef.current().catch(e => console.error('OrderContext saveOrders: Immediate sync failed:', e));
      }
    } catch (error) {
      console.error('Error saving orders:', error);
    }
  }, [currentUser]);

  const addOrder = useCallback(async (orderData: Omit<CustomerOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => {
    if (!currentUser) return;

    const newOrder: CustomerOrder = {
      ...orderData,
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
    };

    const updated = [...orders, newOrder];
    await saveOrders(updated);
  }, [currentUser, orders, saveOrders]);

  const updateOrder = useCallback(async (id: string, updates: Partial<CustomerOrder>) => {
    const updated = orders.map(order =>
      order.id === id
        ? { ...order, ...updates, updatedAt: Date.now() }
        : order
    );
    await saveOrders(updated);
  }, [orders, saveOrders]);

  const deleteOrder = useCallback(async (id: string) => {
    console.log('OrderContext deleteOrder: Starting delete for', id);
    
    try {
      const allOrders = await AsyncStorage.getItem(ORDERS_KEY);
      const existingOrders: CustomerOrder[] = allOrders ? JSON.parse(allOrders) : [];
      
      const updated = existingOrders.map(order =>
        order.id === id
          ? { ...order, deleted: true, updatedAt: Date.now() }
          : order
      );
      
      console.log('OrderContext deleteOrder: Saving marked-as-deleted to storage...');
      await AsyncStorage.setItem(ORDERS_KEY, JSON.stringify(updated));
      
      const activeOrders = updated.filter(o => o.deleted !== true);
      setOrders(activeOrders);
      console.log('OrderContext deleteOrder: Saved locally');
      
      if (currentUser && syncOrdersRef.current) {
        console.log('OrderContext deleteOrder: Triggering immediate sync to server...');
        syncOrdersRef.current().catch(e => console.error('OrderContext deleteOrder: Immediate sync failed:', e));
      }
    } catch (error) {
      console.error('OrderContext deleteOrder: Failed', error);
      throw error;
    }
  }, [currentUser]);

  const fulfillOrder = useCallback(async (id: string, fulfilledBy: string) => {
    const updated = orders.map(order =>
      order.id === id
        ? { 
            ...order, 
            status: 'fulfilled' as const, 
            fulfilledAt: Date.now(), 
            fulfilledBy, 
            updatedAt: Date.now() 
          }
        : order
    );
    await saveOrders(updated);
  }, [orders, saveOrders]);

  const getActiveOrders = useCallback((): CustomerOrder[] => {
    return orders.filter(order => order.status === 'active').sort((a, b) => {
      const dateTimeA = new Date(`${a.orderDate}T${a.orderTime}`).getTime();
      const dateTimeB = new Date(`${b.orderDate}T${b.orderTime}`).getTime();
      return dateTimeA - dateTimeB;
    });
  }, [orders]);

  const getFulfilledOrders = useCallback((): CustomerOrder[] => {
    return orders.filter(order => order.status === 'fulfilled').sort((a, b) => {
      return (b.fulfilledAt || 0) - (a.fulfilledAt || 0);
    });
  }, [orders]);

  const syncOrders = useCallback(async (silent: boolean = false) => {
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
      
      const allOrders = await AsyncStorage.getItem(ORDERS_KEY);
      const ordersToSync: CustomerOrder[] = allOrders ? JSON.parse(allOrders) : [];
      
      console.log('[OrderContext] Starting sync for orders...');
      const remoteData = await getFromServer<CustomerOrder>({ userId: currentUser.id, dataType: 'orders' });
      const merged = mergeData(ordersToSync, remoteData);
      const synced = await saveToServer(merged, { userId: currentUser.id, dataType: 'orders' });
      
      await AsyncStorage.setItem(ORDERS_KEY, JSON.stringify(synced));
      
      const activeOrders = synced.filter(order => order.deleted !== true);
      setOrders(activeOrders);
      setLastSyncTime(Date.now());
      console.log('[OrderContext] Sync complete. Synced', activeOrders.length, 'orders');
    } catch (error) {
      console.error('OrderContext syncOrders: Failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser]);

  useEffect(() => {
    syncOrdersRef.current = syncOrders;
  }, [syncOrders]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      console.log('OrderContext: Setting up auto-sync interval (10 seconds)');
      interval = setInterval(() => {
        if (!syncInProgressRef.current && syncOrdersRef.current) {
          syncOrdersRef.current().catch((e) => console.log('Orders auto-sync error', e));
        }
      }, 10000);
    }
    return () => {
      if (interval) {
        console.log('OrderContext: Clearing auto-sync interval');
        clearInterval(interval);
      }
    };
  }, [currentUser]);

  const clearAllOrders = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(ORDERS_KEY);
      setOrders([]);
    } catch (error) {
      console.error('Failed to clear orders:', error);
      throw error as Error;
    }
  }, []);

  const value = useMemo(() => ({
    orders,
    isLoading,
    isSyncing,
    lastSyncTime,
    addOrder,
    updateOrder,
    deleteOrder,
    fulfillOrder,
    getActiveOrders,
    getFulfilledOrders,
    syncOrders,
    clearAllOrders,
  }), [orders, isLoading, isSyncing, lastSyncTime, addOrder, updateOrder, deleteOrder, fulfillOrder, getActiveOrders, getFulfilledOrders, syncOrders, clearAllOrders]);

  return <OrderCtx.Provider value={value}>{children}</OrderCtx.Provider>;
}
