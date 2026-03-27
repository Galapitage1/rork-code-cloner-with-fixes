import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { LogIn } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useStores } from '@/contexts/StoresContext';
import { forceReloadAllData } from '@/utils/initialDataLoader';
import Colors from '@/constants/colors';

export default function LoginScreen() {
  const [username, setUsername] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { login, isLoading: authLoading, users, syncUsers } = useAuth();
  const { syncAll: syncStoresData } = useStores();
  const router = useRouter();

  useEffect(() => {
    const loadUsersAndOutlets = async () => {
      if (!authLoading) {
        console.log('[LoginScreen] Loading latest users and outlets from server...');
        try {
          await Promise.all([
            syncUsers(undefined, true),
            syncStoresData(true),
          ]);
          console.log('[LoginScreen] Users and outlets synced successfully');
        } catch (error) {
          console.error('[LoginScreen] Failed to sync users and outlets:', error);
        }
      }
    };

    loadUsersAndOutlets();
  }, [authLoading, syncUsers, syncStoresData]);

  const handleLogin = async () => {
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter a username.');
      return;
    }

    if (authLoading) {
      Alert.alert('Please Wait', 'Authentication system is still loading. Please try again in a moment.');
      return;
    }

    try {
      setIsLoading(true);
      console.log('handleLogin: users available:', users.length);
      const user = await login(username.trim());
      
      if (user) {
        console.log('handleLogin: User logged in successfully');
        console.log('handleLogin: Triggering immediate full data reload from server...');
        
        try {
          await forceReloadAllData(user.id);
          console.log('handleLogin: Full data reload completed - all latest data synced from server');
        } catch (syncError) {
          console.error('handleLogin: Full data reload failed (non-critical):', syncError);
        }
        
        router.replace('/home' as any);
      } else {
        Alert.alert('Error', 'User not found. Please contact your administrator.');
      }
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Error', 'Failed to login. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.backgroundContainer}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Image
              source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/irnvdefvf4r08jqg0p373' }}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>Stock Check App</Text>
            <Text style={styles.subtitle}>Sign in to continue</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter your username"
                placeholderTextColor={Colors.light.muted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, (isLoading || authLoading) && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isLoading || authLoading}
            >
              {(isLoading || authLoading) ? (
                <ActivityIndicator color={Colors.light.card} />
              ) : (
                <>
                  <LogIn size={20} color={Colors.light.card} />
                  <Text style={styles.buttonText}>Sign In</Text>
                </>
              )}
            </TouchableOpacity>
          </View>


        </View>
        </SafeAreaView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backgroundContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center' as const,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center' as const,
  },
  header: {
    alignItems: 'center' as const,
    marginBottom: 48,
  },
  logo: {
    width: 200,
    height: 200,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.muted,
  },
  form: {
    gap: 24,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: Colors.light.text,
  },
  button: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.tint,
    paddingVertical: 16,
    borderRadius: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  footer: {
    marginTop: 32,
    alignItems: 'center' as const,
  },
  footerText: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  footerBold: {
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
});
