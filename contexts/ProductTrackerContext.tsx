import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback } from 'react';
import { ProductTrackerData, ProductTrackerMovement, Product, StockCheck, ProductRequest, SalesReconciliationHistory, ProductConversion } from '@/types';

const STORAGE_KEY = '@stock_app_product_tracker_data';

interface ProductTrackerContextValue {
  trackerData: ProductTrackerData[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  refreshTrackerData: (outlet: string, startDate: string, endDate: string) => Promise<void>;
  syncTrackerData: () => Promise<void>;
}

export const [ProductTrackerProvider, useProductTracker] = createContextHook((): ProductTrackerContextValue => {
  const [trackerData, setTrackerData] = useState<ProductTrackerData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);

  const loadTrackerDataFromStorage = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setTrackerData(parsed);
      }
    } catch (error) {
      console.error('Error loading tracker data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveTrackerDataToStorage = useCallback(async (data: ProductTrackerData[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setTrackerData(data);
    } catch (error) {
      console.error('Error saving tracker data:', error);
    }
  }, []);

  const calculateMovements = useCallback((
    outlet: string,
    date: string,
    products: Product[],
    stockChecks: StockCheck[],
    requests: ProductRequest[],
    reconcileHistory: SalesReconciliationHistory[],
    productConversions: ProductConversion[]
  ): ProductTrackerMovement[] => {
    const movements: ProductTrackerMovement[] = [];
    
    const menuAndRawProducts = products.filter(p => 
      !p.deleted && 
      (p.type === 'menu' || (p.type === 'raw' && p.salesBasedRawCalc))
    );

    const conversionMap = new Map<string, ProductConversion>();
    productConversions.forEach(conv => {
      if (!conv.deleted) {
        conversionMap.set(`${conv.fromProductId}-${conv.toProductId}`, conv);
      }
    });

    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);
    const prevDateStr = previousDate.toISOString().split('T')[0];

    const previousStockCheck = stockChecks.find(sc => 
      !sc.deleted && 
      sc.outlet === outlet && 
      sc.doneDate === prevDateStr
    );

    const currentStockCheck = stockChecks.find(sc => 
      !sc.deleted && 
      sc.outlet === outlet && 
      sc.doneDate === date
    );

    const approvedRequestsForDate = requests.filter(r => 
      !r.deleted && 
      r.status === 'approved' && 
      r.doneDate === date && 
      (outlet === 'ALL' ? true : r.toOutlet === outlet)
    );

    const reconcileForDate = reconcileHistory.find(rh => 
      !rh.deleted && 
      rh.outlet === outlet && 
      rh.date === date
    );

    menuAndRawProducts.forEach(product => {
      const hasConversion = Array.from(conversionMap.values()).some(
        conv => conv.fromProductId === product.id || conv.toProductId === product.id
      );

      let openingWhole = 0;
      let openingSlices = 0;

      if (previousStockCheck) {
        const prevCount = previousStockCheck.counts.find(c => c.productId === product.id);
        if (prevCount) {
          openingWhole = prevCount.quantity || 0;
        }
      }

      let receivedWhole = 0;
      let receivedSlices = 0;

      if (outlet === 'Production' || outlet === 'ALL') {
        const sentRequests = requests.filter(r => 
          !r.deleted && 
          r.status === 'approved' && 
          r.doneDate === date && 
          r.fromOutlet === 'Production' &&
          r.productId === product.id
        );
        sentRequests.forEach(req => {
          receivedWhole += req.quantity || 0;
        });
      } else {
        approvedRequestsForDate.forEach(req => {
          if (req.productId === product.id) {
            receivedWhole += req.quantity || 0;
          }
        });
      }

      let wastageWhole = 0;
      let wastageSlices = 0;

      if (currentStockCheck) {
        const count = currentStockCheck.counts.find(c => c.productId === product.id);
        if (count) {
          wastageWhole = count.wastage || 0;
        }
      }

      let soldWhole = 0;
      let soldSlices = 0;

      if (reconcileForDate) {
        const saleData = reconcileForDate.salesData?.find(sd => sd.productId === product.id);
        if (saleData) {
          soldWhole = saleData.sold || 0;
        }

        if (reconcileForDate.rawConsumption && product.type === 'raw') {
          const rawConsumption = reconcileForDate.rawConsumption.find(rc => rc.rawProductId === product.id);
          if (rawConsumption) {
            soldWhole = rawConsumption.consumed || 0;
          }
        }
      }

      let currentWhole = 0;
      let currentSlices = 0;

      if (currentStockCheck) {
        const count = currentStockCheck.counts.find(c => c.productId === product.id);
        if (count) {
          currentWhole = count.quantity || 0;
        }
      }

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      const nextDateStr = nextDate.toISOString().split('T')[0];

      const nextStockCheck = stockChecks.find(sc => 
        !sc.deleted && 
        sc.outlet === outlet && 
        sc.doneDate === nextDateStr
      );

      let nextDayOpening = 0;
      if (nextStockCheck) {
        const nextCount = nextStockCheck.counts.find(c => c.productId === product.id);
        if (nextCount && nextCount.openingStock !== undefined) {
          nextDayOpening = nextCount.openingStock;
        }
      }

      const discrepancyWhole = nextDayOpening - currentWhole;
      const discrepancySlices = 0;

      movements.push({
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        hasConversion,
        openingWhole,
        openingSlices,
        receivedWhole,
        receivedSlices,
        wastageWhole,
        wastageSlices,
        soldWhole,
        soldSlices,
        currentWhole,
        currentSlices,
        discrepancyWhole,
        discrepancySlices,
      });
    });

    return movements.filter(m => 
      m.openingWhole !== 0 || 
      m.receivedWhole !== 0 || 
      m.wastageWhole !== 0 || 
      m.soldWhole !== 0 || 
      m.currentWhole !== 0
    );
  }, []);

  const refreshTrackerData = useCallback(async (outlet: string, startDate: string, endDate: string) => {
    setIsLoading(true);
    try {
      const [productsStr, stockChecksStr, requestsStr, reconcileHistoryStr, conversionsStr] = await Promise.all([
        AsyncStorage.getItem('@stock_app_products'),
        AsyncStorage.getItem('@stock_app_stock_checks'),
        AsyncStorage.getItem('@stock_app_requests'),
        AsyncStorage.getItem('@stock_app_reconcile_history'),
        AsyncStorage.getItem('@stock_app_product_conversions'),
      ]);

      const products: Product[] = productsStr ? JSON.parse(productsStr) : [];
      const stockChecks: StockCheck[] = stockChecksStr ? JSON.parse(stockChecksStr) : [];
      const requests: ProductRequest[] = requestsStr ? JSON.parse(requestsStr) : [];
      const reconcileHistory: SalesReconciliationHistory[] = reconcileHistoryStr ? JSON.parse(reconcileHistoryStr) : [];
      const productConversions: ProductConversion[] = conversionsStr ? JSON.parse(conversionsStr) : [];

      const newTrackerData: ProductTrackerData[] = [];

      const start = new Date(startDate);
      const end = new Date(endDate);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        const movements = calculateMovements(
          outlet,
          dateStr,
          products,
          stockChecks,
          requests,
          reconcileHistory,
          productConversions
        );

        newTrackerData.push({
          outlet,
          date: dateStr,
          movements,
          timestamp: Date.now(),
        });
      }

      await saveTrackerDataToStorage(newTrackerData);
    } catch (error) {
      console.error('Error refreshing tracker data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [calculateMovements, saveTrackerDataToStorage]);

  const syncTrackerData = useCallback(async () => {
    setIsSyncing(true);
    try {
      await loadTrackerDataFromStorage();
      setLastSyncTime(Date.now());
    } catch (error) {
      console.error('Error syncing tracker data:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [loadTrackerDataFromStorage]);

  useEffect(() => {
    loadTrackerDataFromStorage();
  }, [loadTrackerDataFromStorage]);

  return {
    trackerData,
    isLoading,
    isSyncing,
    lastSyncTime,
    refreshTrackerData,
    syncTrackerData,
  };
});
