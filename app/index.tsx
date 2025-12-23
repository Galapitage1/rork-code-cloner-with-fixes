import { Redirect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { ActivityIndicator, View, StyleSheet, Platform } from 'react-native';
import Colors from '@/constants/colors';
import { useEffect, useState } from 'react';

export default function Index() {
  const { currentUser, isLoading } = useAuth();
  const [redirectPath, setRedirectPath] = useState<string | null>(null);
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
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
      setShouldRedirect(true);
    }
  }, [isLoading, currentUser]);

  if (isLoading || !shouldRedirect) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
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
});
