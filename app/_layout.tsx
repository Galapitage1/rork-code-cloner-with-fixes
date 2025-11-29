import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { InitialSyncTrigger } from '@/components/InitialSyncTrigger';


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
  const { currentUser } = useAuth();
  const { setUser: setStoresUser } = useStores();
  const { setUser: setProductionUser } = useProduction();
  const { setUser: setActivityLogUser } = useActivityLog();
  
  useEffect(() => {
    if (currentUser) {
      setStoresUser(currentUser);
      setProductionUser(currentUser);
      setActivityLogUser(currentUser);
    }
  }, [currentUser, setStoresUser, setProductionUser, setActivityLogUser]);
  
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
                    <InitialSyncTrigger />
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
