import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY = '@stock_app_product_usage';

interface ProductUsageData {
  [userId: string]: {
    [productId: string]: {
      searchCount: number;
      usageCount: number;
      lastUsed: number;
    };
  };
}

export const [ProductUsageProvider, useProductUsage] = createContextHook(() => {
  const [usageData, setUsageData] = useState<ProductUsageData>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await AsyncStorage.getItem(STORAGE_KEY);
        if (data) {
          const parsed = JSON.parse(data);
          setUsageData(parsed);
        }
      } catch (error) {
        console.error('Failed to load product usage data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const saveUsageData = useCallback(async (data: ProductUsageData) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setUsageData(data);
    } catch (error) {
      console.error('Failed to save product usage data:', error);
    }
  }, []);

  const trackSearch = useCallback(async (userId: string, productId: string) => {
    const newData = { ...usageData };
    if (!newData[userId]) {
      newData[userId] = {};
    }
    if (!newData[userId][productId]) {
      newData[userId][productId] = { searchCount: 0, usageCount: 0, lastUsed: Date.now() };
    }
    newData[userId][productId].searchCount += 1;
    newData[userId][productId].lastUsed = Date.now();
    await saveUsageData(newData);
  }, [usageData, saveUsageData]);

  const trackUsage = useCallback(async (userId: string, productId: string) => {
    const newData = { ...usageData };
    if (!newData[userId]) {
      newData[userId] = {};
    }
    if (!newData[userId][productId]) {
      newData[userId][productId] = { searchCount: 0, usageCount: 0, lastUsed: Date.now() };
    }
    newData[userId][productId].usageCount += 1;
    newData[userId][productId].lastUsed = Date.now();
    await saveUsageData(newData);
  }, [usageData, saveUsageData]);

  const deleteUserData = useCallback(async (userId: string) => {
    const newData = { ...usageData };
    delete newData[userId];
    await saveUsageData(newData);
  }, [usageData, saveUsageData]);

  const getProductScore = useCallback((userId: string, productId: string): number => {
    if (!usageData[userId] || !usageData[userId][productId]) {
      return 0;
    }
    const data = usageData[userId][productId];
    return data.searchCount + (data.usageCount * 2);
  }, [usageData]);

  const getSortedProducts = useCallback(<T extends { id: string; name: string; category?: string }>(
    userId: string,
    products: T[]
  ): T[] => {
    return products.sort((a, b) => {
      const scoreA = getProductScore(userId, a.id);
      const scoreB = getProductScore(userId, b.id);
      
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      
      if (a.category && b.category && a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      
      return a.name.localeCompare(b.name);
    });
  }, [getProductScore]);

  return useMemo(() => ({
    isLoading,
    trackSearch,
    trackUsage,
    deleteUserData,
    getProductScore,
    getSortedProducts,
  }), [isLoading, trackSearch, trackUsage, deleteUserData, getProductScore, getSortedProducts]);
});
