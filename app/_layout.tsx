import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { StockProvider, useStock } from '@/contexts/StockContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';


import { CustomerProvider } from '@/contexts/CustomerContext';
import { RecipeProvider } from '@/contexts/RecipeContext';
import { ProductUsageProvider } from '@/contexts/ProductUsageContext';
import { OrderProvider } from '@/contexts/OrderContext';
import { StoresProvider, useStores } from '@/contexts/StoresContext';
import { ProductionProvider, useProduction } from '@/contexts/ProductionContext';
import { ActivityLogProvider, useActivityLog } from '@/contexts/ActivityLogContext';
import { MoirProvider } from '@/contexts/MoirContext';
import { ProductTrackerProvider } from '@/contexts/ProductTrackerContext';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { loadInitialDataIfNeeded } from '@/utils/initialDataLoader';
import { performCleanupOnLogin } from '@/utils/storageCleanup';


SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const pathname = usePathname();
  const { currentUser } = useAuth();

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && currentUser && pathname && pathname !== '/' && pathname !== '/login') {
      localStorage.setItem('app-reload-path', pathname);
      console.log('[RootLayoutNav] Saved path for reload:', pathname);
    }
  }, [pathname, currentUser]);

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
  const { setUser: setStoresUser, reloadFromStorage: reloadStoresFromStorage } = useStores();
  const { setUser: setProductionUser } = useProduction();
  const { setUser: setActivityLogUser } = useActivityLog();
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('Loading...');
  const loadingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  
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
        console.log('[UserSync] → Loading initial data for user:', currentUser.username);
        
        loadingTimeoutRef.current = setTimeout(() => {
          console.log('[UserSync] → Loading taking too long, showing UI anyway');
          setIsLoadingInitialData(false);
        }, 3000);
        
        const loadPromise = loadInitialDataIfNeeded(currentUser.id, (status) => {
          console.log('[UserSync] →', status);
          setLoadingStatus(status);
        });
        
        const reloadPromise = loadPromise.then(async () => {
          console.log('[UserSync] → Reloading data from storage...');
          setLoadingStatus('Refreshing...');
          await reloadStoresFromStorage();
        });
        
        Promise.all([loadPromise, reloadPromise]).then(() => {
          console.log('[UserSync] → Performing cleanup...');
          performCleanupOnLogin().catch(e => console.log('[UserSync] Cleanup error:', e));
          
          setHasLoadedInitialData(true);
          setLoadingStatus('Complete!');
          console.log('[UserSync] ✓ Initial data load complete');
          
          if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
          }
          setTimeout(() => {
            setIsLoadingInitialData(false);
          }, 300);
        }).catch(error => {
          console.error('[UserSync] ✗ Failed to load initial data:', error);
          setLoadingStatus('Error loading data');
          if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
          }
          setTimeout(() => {
            setIsLoadingInitialData(false);
          }, 1000);
        });
      } catch (error) {
        console.error('[UserSync] ✗ Failed to load initial data:', error);
        setLoadingStatus('Error loading data');
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
        setTimeout(() => {
          setIsLoadingInitialData(false);
        }, 1000);
      }
    }

    loadData();
    
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [currentUser, hasLoadedInitialData, setHasLoadedInitialData, reloadStoresFromStorage]);

  if (currentUser && isLoadingInitialData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{loadingStatus}</Text>
      </View>
    );
  }
  
  return <>{children}</>;
}

function AppProviders({ children }: { children: React.ReactNode }) {
  const { currentUser, enableReceivedAutoLoad } = useAuth();
  
  return (
    <StockProvider currentUser={currentUser} enableReceivedAutoLoad={enableReceivedAutoLoad}>
      <CustomerProvider currentUser={currentUser}>
        <OrderProvider currentUser={currentUser}>
          <ProductUsageProvider>
            <RecipesProviderLayer>
              <ProductTrackerProvider>
                {children}
              </ProductTrackerProvider>
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

const queryClient = new QueryClient();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
  );
}
