import { Redirect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { ActivityIndicator, View, StyleSheet, Platform, Text } from 'react-native';
import Colors from '@/constants/colors';
import { useEffect, useState } from 'react';
import { useStores } from '@/contexts/StoresContext';

export default function Index() {
  const { currentUser, isLoading, syncUsers } = useAuth();
  const { syncAll: syncStoresData } = useStores();
  const [redirectPath, setRedirectPath] = useState<string | null>(null);
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [syncingData, setSyncingData] = useState(true);
  const [syncStatus, setSyncStatus] = useState('Loading...');

  useEffect(() => {
    let isMounted = true;
    
    const loadInitialData = async () => {
      if (!isLoading && !currentUser) {
        console.log('[Index] Loading usernames and outlets from server...');
        setSyncStatus('Loading usernames...');
        
        try {
          await Promise.all([
            syncUsers(undefined, true),
            syncStoresData(true),
          ]);
          console.log('[Index] Users and outlets synced successfully');
        } catch (error) {
          console.error('[Index] Failed to sync users and outlets:', error);
        } finally {
          if (isMounted) {
            setSyncingData(false);
          }
        }
      } else {
        setSyncingData(false);
      }
    };
    
    if (!isLoading) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const savedPath = localStorage.getItem('app-reload-path');
        if (savedPath && savedPath !== '/' && currentUser) {
          console.log('[Index] Restoring saved path:', savedPath);
          setRedirectPath(savedPath);
          localStorage.removeItem('app-reload-path');
        } else if (!currentUser) {
          localStorage.removeItem('app-reload-path');
        }
      }
      
      loadInitialData();
    }
    
    return () => {
      isMounted = false;
    };
  }, [isLoading, currentUser, syncUsers, syncStoresData]);
  
  useEffect(() => {
    if (!isLoading && !syncingData) {
      setShouldRedirect(true);
    }
  }, [isLoading, syncingData]);

  if (isLoading || syncingData || !shouldRedirect) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
        <Text style={styles.loadingText}>{syncStatus}</Text>
      </View>
    );
  }

  if (!currentUser) {
    return <Redirect href={"/login" as any} />
  }

  if (redirectPath) {
    return <Redirect href={redirectPath as any} />;
  }

  return <Redirect href={"/home" as any} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: Colors.light.muted,
  },
});
