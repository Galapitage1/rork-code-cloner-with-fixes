import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StockProvider, useStock } from '@/contexts/StockContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

import { CustomerProvider } from '@/contexts/CustomerContext';
import { RecipeProvider } from '@/contexts/RecipeContext';
import { ProductUsageProvider } from '@/contexts/ProductUsageContext';
import { OrderProvider } from '@/contexts/OrderContext';
import { StoresProvider, useStores } from '@/contexts/StoresContext';
import { ProductionProvider, useProduction } from '@/contexts/ProductionContext';
import { ActivityLogProvider, useActivityLog } from '@/contexts/ActivityLogContext';
import { MoirProvider } from '@/contexts/MoirContext';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { loadInitialDataIfNeeded } from '@/utils/initialDataLoader';
import { performCleanupOnLogin } from '@/utils/storageCleanup';


SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product-conversions" options={{ headerShown: true }} />
      <Stack.Screen name="production-requests" options={{ title: 'Production Requests' }} />
      <Stack.Screen name="logs" options={{ title: 'Activity Logs' }} />
      <Stack.Screen name="moir" options={{ headerShown: false }} />
      <Stack.Screen name="campaigns" options={{ title: 'Campaign Manager' }} />
      <Stack.Screen name="products" options={{ title: 'Products Management' }} />
    </Stack>
  );
}

function RecipesProviderLayer({ children }: { children: React.ReactNode }) {
  const { products } = useStock();
  const { currentUser } = useAuth();
  return (
    <RecipeProvider currentUser={currentUser} products={products}>
      {children}
    </RecipeProvider>
  );
}

function UserSync({ children }: { children: React.ReactNode }) {
  const { currentUser, hasLoadedInitialData, setHasLoadedInitialData } = useAuth();
  const { setUser: setStoresUser } = useStores();
  const { setUser: setProductionUser } = useProduction();
  const { setUser: setActivityLogUser } = useActivityLog();
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(false);
  
  useEffect(() => {
    if (currentUser) {
      setStoresUser(currentUser);
      setProductionUser(currentUser);
      setActivityLogUser(currentUser);
    }
  }, [currentUser, setStoresUser, setProductionUser, setActivityLogUser]);

  useEffect(() => {
    async function loadData() {
      if (!currentUser || hasLoadedInitialData) return;

      try {
        setIsLoadingInitialData(true);
        console.log('[UserSync] Loading initial data for user:', currentUser.username);
        
        await loadInitialDataIfNeeded(currentUser.id);
        
        console.log('[UserSync] Performing cleanup on login...');
        await performCleanupOnLogin();
        
        setHasLoadedInitialData(true);
        console.log('[UserSync] Initial data load complete');
      } catch (error) {
        console.error('[UserSync] Failed to load initial data:', error);
      } finally {
        setIsLoadingInitialData(false);
      }
    }

    loadData();
  }, [currentUser, hasLoadedInitialData, setHasLoadedInitialData]);

  if (currentUser && isLoadingInitialData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading your data...</Text>
      </View>
    );
  }
  
  return <>{children}</>;
}

function AppProviders({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  
  return (
    <StockProvider currentUser={currentUser}>
      <CustomerProvider currentUser={currentUser}>
        <OrderProvider currentUser={currentUser}>
          <ProductUsageProvider>
            <RecipesProviderLayer>
              {children}
            </RecipesProviderLayer>
          </ProductUsageProvider>
        </OrderProvider>
      </CustomerProvider>
    </StockProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: '#fff',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <AuthProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <MoirProvider>
          <StoresProvider>
            <ProductionProvider>
              <ActivityLogProvider>
                <UserSync>
                  <AppProviders>
                    <UpdatePrompt />
                    <RootLayoutNav />
                  </AppProviders>
                </UserSync>
              </ActivityLogProvider>
            </ProductionProvider>
          </StoresProvider>
        </MoirProvider>
      </GestureHandlerRootView>
    </AuthProvider>
  );
}
