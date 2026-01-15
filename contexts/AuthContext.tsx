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
    let isMounted = true;
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        performDailyCleanup().catch(() => {});
        
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
              await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            }
          } catch {
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
          } catch {
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
      } catch {
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
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
    } catch {
    } finally {
      syncInProgressRef.current = false;
    }
  }, [initialUsersSynced, users, currentUser]);

  useEffect(() => {
    if (!isLoading && !currentUser) {
      backgroundSyncUsers().catch(() => {});
    }
  }, [isLoading, currentUser, backgroundSyncUsers]);

  const login = useCallback(async (username: string): Promise<User | null> => {
    try {
      const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      
      if (user) {
        await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
        setCurrentUser(user);
        setInitialSyncComplete(false);
        setHasLoadedInitialData(false);
        return user;
      }
      
      return null;
    } catch (error) {
      throw error;
    }
  }, [users]);

  const logout = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      setCurrentUser(null);
    } catch (error) {
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
      
      const activeUsers = (synced as any[]).filter(u => !u?.deleted);
      
      const hasChanges = JSON.stringify(users) !== JSON.stringify(activeUsers);
      
      if (hasChanges) {
        await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(synced));
        setUsers(activeUsers);
        
        if (currentUser && synced.find((u: User) => u.id === currentUser.id)) {
          const updatedCurrentUser = synced.find((u: User) => u.id === currentUser.id);
          if (updatedCurrentUser) {
            const currentUserChanged = JSON.stringify(currentUser) !== JSON.stringify(updatedCurrentUser);
            if (currentUserChanged) {
              await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(updatedCurrentUser));
              setCurrentUser(updatedCurrentUser);
            }
          }
        }
      }
      
      setLastSyncTime(Date.now());
    } catch (error) {
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

      const updatedUsers = [...users, newUser];
      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      setUsers(updatedUsers);

      try {
        await syncUsers(updatedUsers);
      } catch {
      }

      return newUser;
    } catch (error) {
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
      } catch {
      }
    } catch (error) {
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
      } catch {
      }
    } catch (error) {
      throw error;
    }
  }, [users, currentUser, syncUsers]);



  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        syncUsers(undefined, true).catch(() => {});
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentUser, syncUsers]);

  const clearAllAuthData = useCallback(async () => {
    try {
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
    } catch (error) {
      throw error;
    }
  }, []);

  const clearAllUsers = useCallback(async () => {
    try {
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
        } catch {
        }
      }

      await AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([defaultAdmin, tempUser]));
    } catch (error) {
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
      throw error;
    }
  }, []);

  const updateCurrency = useCallback(async (currencyCode: string) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CURRENCY, JSON.stringify(currencyCode));
      setCurrency(currencyCode);
    } catch (error) {
      throw error;
    }
  }, []);

  const toggleEnableReceivedAutoLoad = useCallback(async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ENABLE_RECEIVED_AUTO_LOAD, JSON.stringify(value));
      setEnableReceivedAutoLoad(value);
    } catch (error) {
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
