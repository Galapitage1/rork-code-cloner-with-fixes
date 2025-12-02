import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { User, UserRole } from '@/types';
import { syncData } from '@/utils/syncData';
import { performDailyCleanup } from '@/utils/storageCleanup';

const STORAGE_KEYS = {
  CURRENT_USER: '@stock_app_current_user',
  USERS: '@stock_app_users',
  SHOW_PAGE_TABS: '@stock_app_show_page_tabs',
  CURRENCY: '@stock_app_currency',
  ENABLE_RECEIVED_AUTO_LOAD: '@stock_app_enable_received_auto_load',
};

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [initialUsersSynced, setInitialUsersSynced] = useState<boolean>(false);
  const [initialSyncComplete, setInitialSyncComplete] = useState<boolean>(false);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState<boolean>(false);
  const [showPageTabs, setShowPageTabs] = useState<boolean>(false);
  const [currency, setCurrency] = useState<string>('SLR');
  const [enableReceivedAutoLoad, setEnableReceivedAutoLoad] = useState<boolean>(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        performDailyCleanup().catch(e => console.log('[AUTH] Daily cleanup error:', e));
        
        const [currentUserData, usersData, showPageTabsData, currencyData, enableReceivedAutoLoadData] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.CURRENT_USER),
          AsyncStorage.getItem(STORAGE_KEYS.USERS),
          AsyncStorage.getItem(STORAGE_KEYS.SHOW_PAGE_TABS),
          AsyncStorage.getItem(STORAGE_KEYS.CURRENCY),
          AsyncStorage.getItem(STORAGE_KEYS.ENABLE_RECEIVED_AUTO_LOAD),
        ]);

        if (showPageTabsData) {
          try {
            const parsed = JSON.parse(showPageTabsData);
            setShowPageTabs(parsed);
          } catch {
            setShowPageTabs(false);
          }
        }

        if (currencyData) {
          try {
            const parsed = JSON.parse(currencyData);
            setCurrency(parsed);
          } catch {
            setCurrency('SLR');
          }
        }

        if (enableReceivedAutoLoadData) {
          try {
            const parsed = JSON.parse(enableReceivedAutoLoadData);
            setEnableReceivedAutoLoad(parsed);
          } catch {
            setEnableReceivedAutoLoad(true);
          }
        }

        if (currentUserData) {
          try {
            const trimmed = currentUserData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              setCurrentUser(parsed);
            } else {
              console.error('Current user data is not valid JSON:', currentUserData);
              await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            }
          } catch (parseError) {
            console.error('Failed to parse current user data:', parseError);
            await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
          }
        }

        if (usersData) {
          try {
            const trimmed = usersData.trim();
            if (trimmed && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                setUsers(parsed.filter((u: any) => !u?.deleted));
              } else {
                console.error('Users data is not an array');
                const defaultAdmin: User = {
                  id: 'admin-1',
                  username: 'admin',
                  role: 'superadmin',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                const tempUser: User = {
                  id: 'temp-1',
                  username: 'Temp',
                  role: 'user',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
                setUsers([defaultAdmin, tempUser]);
              }
            } else {
              console.error('Users data is not valid JSON:', usersData);
              const defaultAdmin: User = {
                id: 'admin-1',
                username: 'admin',
                role: 'superadmin',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              const tempUser: User = {
                id: 'temp-1',
                username: 'Temp',
                role: 'user',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
              setUsers([defaultAdmin, tempUser]);
            }
          } catch (parseError) {
            console.error('Failed to parse users data:', parseError);
            const defaultAdmin: User = {
              id: 'admin-1',
              username: 'admin',
              role: 'superadmin',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            const tempUser: User = {
              id: 'temp-1',
              username: 'Temp',
              role: 'user',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
            setUsers([defaultAdmin, tempUser]);
          }
        } else {
          const defaultAdmin: User = {
            id: 'admin-1',
            username: 'admin',
            role: 'superadmin',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const tempUser: User = {
            id: 'temp-1',
            username: 'Temp',
            role: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
          setUsers([defaultAdmin, tempUser]);
        }
      } catch (error) {
        console.error('Failed to load auth data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);



  const syncInProgressRef = useRef(false);

  const backgroundSyncUsers = useCallback(async () => {
    try {
      if (initialUsersSynced || syncInProgressRef.current) return;
      syncInProgressRef.current = true;
      const synced = await syncData('users', users, undefined, { isDefaultAdminDevice: currentUser?.username === 'admin' && currentUser?.role === 'superadmin' });
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(synced));
      setUsers((synced as any[]).filter(u => !u?.deleted));
      setLastSyncTime(Date.now());
      setInitialUsersSynced(true);
    } catch (error) {
      console.error('AuthContext: Background users sync failed:', error);
    } finally {
      syncInProgressRef.current = false;
    }
  }, [initialUsersSynced, users, currentUser]);

  useEffect(() => {
    if (!isLoading && !currentUser) {
      backgroundSyncUsers().catch(e => console.log('AuthContext: Background users sync error', e));
    }
  }, [isLoading, currentUser, backgroundSyncUsers]);

  const login = useCallback(async (username: string): Promise<User | null> => {
    try {
      console.log('Login attempt for username:', username);
      console.log('Available users:', users.map(u => ({ username: u.username, role: u.role })));
      const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      
      if (user) {
        console.log('User found:', user.username, 'Role:', user.role);
        await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
        setCurrentUser(user);
        setInitialSyncComplete(false);
        setHasLoadedInitialData(false);
        return user;
      }
      
      console.log('User not found for username:', username);
      return null;
    } catch (error) {
      console.error('Failed to login:', error);
      throw error;
    }
  }, [users]);

  const logout = useCallback(async () => {
    try {
      console.log('AuthContext: Logout starting...');
      await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      console.log('AuthContext: Removed current user from storage');
      setCurrentUser(null);
      console.log('AuthContext: State updated to null');
    } catch (error) {
      console.error('AuthContext: Logout error:', error);
      throw error;
    }
  }, []);

  const syncUsers = useCallback(async (usersToSync?: User[], silent: boolean = false) => {
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
      const dataToSync = usersToSync || users;
      const synced = await syncData('users', dataToSync, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' });
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(synced));
      setUsers((synced as any[]).filter(u => !u?.deleted));
      if (currentUser && synced.find((u: User) => u.id === currentUser.id)) {
        const updatedCurrentUser = synced.find((u: User) => u.id === currentUser.id);
        if (updatedCurrentUser) {
          await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(updatedCurrentUser));
          setCurrentUser(updatedCurrentUser);
        }
      }
      setLastSyncTime(Date.now());
    } catch (error) {
      console.error('Sync users failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, users]);
  const addUser = useCallback(async (username: string, role: UserRole) => {
    try {
      console.log('addUser: Starting, current users count:', users.length);
      const existingUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (existingUser) {
        throw new Error('User already exists');
      }

      const newUser: User = {
        id: `user-${Date.now()}`,
        username: username.trim(),
        role,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      console.log('addUser: Created new user:', newUser);
      const updatedUsers = [...users, newUser];
      console.log('addUser: Updated users array length:', updatedUsers.length);
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      console.log('addUser: Saved to AsyncStorage');
      setUsers(updatedUsers);
      console.log('addUser: Updated state');

      try {
        console.log('addUser: Starting sync with updated users...');
        await syncUsers(updatedUsers);
        console.log('addUser: Sync complete');
      } catch (e) {
        console.log('addUser: syncUsers failed, will retry later', e);
      }

      console.log('addUser: Returning new user');
      return newUser;
    } catch (error) {
      console.error('Failed to add user:', error);
      throw error;
    }
  }, [users, syncUsers]);

  const updateUser = useCallback(async (userId: string, updates: Partial<User>) => {
    try {
      const updatedUsers = users.map(u =>
        u.id === userId ? { ...u, ...updates, updatedAt: Date.now() } : u
      );
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      setUsers(updatedUsers.filter(u => !u.deleted));

      if (currentUser?.id === userId) {
        const updatedCurrentUser = { ...currentUser, ...updates, updatedAt: Date.now() };
        await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(updatedCurrentUser));
        setCurrentUser(updatedCurrentUser);
      }

      try {
        await syncUsers(updatedUsers);
      } catch (e) {
        console.log('updateUser: syncUsers failed, will retry later');
      }
    } catch (error) {
      console.error('Failed to update user:', error);
      throw error;
    }
  }, [users, currentUser, syncUsers]);

  const deleteUser = useCallback(async (userId: string) => {
    try {
      if (currentUser?.id === userId) {
        throw new Error('Cannot delete current user');
      }

      const updatedUsers = users.map(u => u.id === userId ? { ...u, deleted: true as const, updatedAt: Date.now() } : u);
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      setUsers(updatedUsers.filter(u => !u.deleted));

      try {
        await syncUsers(updatedUsers);
      } catch (e) {
        console.log('deleteUser: syncUsers failed, will retry later');
      }
    } catch (error) {
      console.error('Failed to delete user:', error);
      throw error;
    }
  }, [users, currentUser, syncUsers]);



  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        console.log('[AuthContext] Running silent 60-second sync...');
        syncUsers(undefined, true).catch(() => {});
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentUser, syncUsers]);

  const clearAllAuthData = useCallback(async () => {
    try {
      console.log('clearAllAuthData: Starting...');
      await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      
      const defaultAdmin: User = {
        id: 'admin-1',
        username: 'admin',
        role: 'superadmin',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const tempUser: User = {
        id: 'temp-1',
        username: 'Temp',
        role: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
      setCurrentUser(null);
      setUsers([defaultAdmin, tempUser]);
      setInitialUsersSynced(false);
      console.log('clearAllAuthData: Complete, admin user preserved');
    } catch (error) {
      console.error('Failed to clear auth data:', error);
      throw error;
    }
  }, []);

  const clearAllUsers = useCallback(async () => {
    try {
      console.log('clearAllUsers: Starting...');
      const allDeletedUsers = users
        .filter(u => u.id !== 'admin-1' && u.id !== 'temp-1')
        .map(u => ({ ...u, deleted: true as const, updatedAt: Date.now() }));

      const defaultAdmin: User = {
        id: 'admin-1',
        username: 'admin',
        role: 'superadmin',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const tempUser: User = {
        id: 'temp-1',
        username: 'Temp',
        role: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const finalUsers = [defaultAdmin, tempUser, ...allDeletedUsers];
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(finalUsers));
      setUsers([defaultAdmin, tempUser]);

      if (currentUser?.id) {
        try {
          await syncData('users', finalUsers, currentUser.id, { isDefaultAdminDevice: currentUser.username === 'admin' && currentUser.role === 'superadmin' });
        } catch (syncError) {
          console.error('clearAllUsers: Sync failed', syncError);
        }
      }

      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
      console.log('clearAllUsers: Complete, admin and temp users preserved');
    } catch (error) {
      console.error('Failed to clear all users:', error);
      throw error;
    }
  }, [users, currentUser]);

  const isAdmin = useMemo(() => currentUser?.role === 'admin' || currentUser?.role === 'superadmin', [currentUser]);
  const isSuperAdmin = useMemo(() => currentUser?.role === 'superadmin', [currentUser]);

  const toggleShowPageTabs = useCallback(async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SHOW_PAGE_TABS, JSON.stringify(value));
      setShowPageTabs(value);
    } catch (error) {
      console.error('Failed to update show page tabs setting:', error);
      throw error;
    }
  }, []);

  const updateCurrency = useCallback(async (currencyCode: string) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CURRENCY, JSON.stringify(currencyCode));
      setCurrency(currencyCode);
    } catch (error) {
      console.error('Failed to update currency setting:', error);
      throw error;
    }
  }, []);

  const toggleEnableReceivedAutoLoad = useCallback(async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ENABLE_RECEIVED_AUTO_LOAD, JSON.stringify(value));
      setEnableReceivedAutoLoad(value);
    } catch (error) {
      console.error('Failed to update enable received auto load setting:', error);
      throw error;
    }
  }, []);

  return useMemo(() => ({
    currentUser,
    users,
    isLoading,
    isAdmin,
    isSuperAdmin,
    isSyncing,
    lastSyncTime,
    initialSyncComplete,
    setInitialSyncComplete,
    hasLoadedInitialData,
    setHasLoadedInitialData,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    syncUsers,
    clearAllAuthData,
    clearAllUsers,
    showPageTabs,
    toggleShowPageTabs,
    currency,
    updateCurrency,
    enableReceivedAutoLoad,
    toggleEnableReceivedAutoLoad,
  }), [
    currentUser,
    users,
    isLoading,
    isAdmin,
    isSuperAdmin,
    isSyncing,
    lastSyncTime,
    initialSyncComplete,
    hasLoadedInitialData,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    syncUsers,
    clearAllAuthData,
    clearAllUsers,
    showPageTabs,
    toggleShowPageTabs,
    currency,
    updateCurrency,
    enableReceivedAutoLoad,
    toggleEnableReceivedAutoLoad,
  ]);
});
