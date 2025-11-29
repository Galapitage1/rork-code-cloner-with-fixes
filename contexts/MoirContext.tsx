import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';

import { syncData } from '@/utils/syncData';

export interface MoirUser {
  id: string;
  name: string;
  phoneNumber?: string;
  emergencyPhoneNumber?: string;
  emergencyPerson?: string;
  allergies?: string;
  medication?: string;
  otherDetails?: string;
  createdAt: number;
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
}

export interface MoirRecord {
  id: string;
  userId: string;
  userName: string;
  timestamp: number;
  date: string;
  time: string;
  createdAt: number;
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
  isAdminRecord?: boolean;
}

export interface MoirLocation {
  id: string;
  userId: string;
  userName: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  createdAt: number;
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
}

const STORAGE_KEYS = {
  MOIR_USERS: '@moir_users',
  MOIR_RECORDS: '@moir_records',
  MOIR_LOCATIONS: '@moir_locations',
  MOIR_CURRENT_USER: '@moir_current_user',
  MOIR_LOCATION_TRACKING: '@moir_location_tracking',
  MOIR_RADIUS_METERS: '@moir_radius_meters',
};

function deduplicateUsers(usersArray: MoirUser[]): MoirUser[] {
  const usersByName = new Map<string, MoirUser>();
  
  usersArray.forEach(user => {
    const lowerName = user.name.toLowerCase().trim();
    const existing = usersByName.get(lowerName);
    
    if (!existing) {
      usersByName.set(lowerName, user);
    } else {
      if (user.updatedAt > existing.updatedAt) {
        usersByName.set(lowerName, user);
      }
    }
  });
  
  return Array.from(usersByName.values());
}

export const [MoirProvider, useMoir] = createContextHook(() => {
  const [users, setUsers] = useState<MoirUser[]>([]);
  const [records, setRecords] = useState<MoirRecord[]>([]);
  const [locations, setLocations] = useState<MoirLocation[]>([]);
  const [currentUser, setCurrentUser] = useState<MoirUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [locationTrackingEnabled, setLocationTrackingEnabled] = useState<boolean>(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState<boolean>(false);
  const [radiusMeters, setRadiusMeters] = useState<number>(500);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [usersData, recordsData, locationsData, currentUserData, trackingData, radiusData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.MOIR_USERS),
        AsyncStorage.getItem(STORAGE_KEYS.MOIR_RECORDS),
        AsyncStorage.getItem(STORAGE_KEYS.MOIR_LOCATIONS),
        AsyncStorage.getItem(STORAGE_KEYS.MOIR_CURRENT_USER),
        AsyncStorage.getItem(STORAGE_KEYS.MOIR_LOCATION_TRACKING),
        AsyncStorage.getItem(STORAGE_KEYS.MOIR_RADIUS_METERS),
      ]);

      if (usersData) {
        const parsed = JSON.parse(usersData);
        setUsers(Array.isArray(parsed) ? parsed.filter((u: MoirUser) => !u.deleted) : []);
      }

      if (recordsData) {
        const parsed = JSON.parse(recordsData);
        setRecords(Array.isArray(parsed) ? parsed.filter((r: MoirRecord) => !r.deleted) : []);
      }

      if (locationsData) {
        const parsed = JSON.parse(locationsData);
        setLocations(Array.isArray(parsed) ? parsed.filter((l: MoirLocation) => !l.deleted) : []);
      }

      if (currentUserData) {
        setCurrentUser(JSON.parse(currentUserData));
      }

      if (trackingData) {
        setLocationTrackingEnabled(JSON.parse(trackingData));
      }

      if (radiusData) {
        setRadiusMeters(JSON.parse(radiusData));
      }

      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationPermissionGranted(status === 'granted');
    } catch (error) {
      console.error('Failed to load Moir data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const syncAllData = useCallback(async (silent: boolean = false, forceData?: { users?: MoirUser[], records?: MoirRecord[], locations?: MoirLocation[] }) => {
    try {
      if (!silent) setIsSyncing(true);

      const dataToSync = {
        users: forceData?.users ?? users,
        records: forceData?.records ?? records,
        locations: forceData?.locations ?? locations,
      };

      console.log('MoirContext syncAllData: Starting sync with', dataToSync.users.length, 'users');

      const [syncedUsers, syncedRecords, syncedLocations] = await Promise.all([
        syncData('moir_users', dataToSync.users, 'moir-system'),
        syncData('moir_records', dataToSync.records, 'moir-system'),
        syncData('moir_locations', dataToSync.locations, 'moir-system'),
      ]);

      console.log('MoirContext syncAllData: Synced', (syncedUsers as MoirUser[]).length, 'users from server');
      console.log('MoirContext syncAllData: Synced', (syncedLocations as MoirLocation[]).length, 'locations from server');

      const deduplicatedUsers = deduplicateUsers(syncedUsers as MoirUser[]);
      console.log('MoirContext syncAllData: After deduplication:', deduplicatedUsers.length, 'users');

      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_USERS, JSON.stringify(deduplicatedUsers));
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_RECORDS, JSON.stringify(syncedRecords));
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATIONS, JSON.stringify(syncedLocations));

      setUsers(deduplicatedUsers.filter(u => !u.deleted));
      setRecords((syncedRecords as MoirRecord[]).filter(r => !r.deleted));
      setLocations((syncedLocations as MoirLocation[]).filter(l => !l.deleted));
      
      console.log('MoirContext syncAllData: Sync complete');
    } catch (error) {
      console.error('Failed to sync Moir data:', error);
      if (!silent) throw error;
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, [users, records, locations]);

  const importUsersFromExcel = useCallback(async (usersData: {name: string; phoneNumber?: string; emergencyPhoneNumber?: string; emergencyPerson?: string; allergies?: string; medication?: string; otherDetails?: string}[]) => {
    try {
      console.log('importUsersFromExcel: Starting with', usersData.length, 'users');
      
      const existingUsersByName = new Map<string, MoirUser>();
      users.forEach(u => {
        existingUsersByName.set(u.name.toLowerCase().trim(), u);
      });
      
      const newUsers: MoirUser[] = [];
      const updatedExistingUsers: MoirUser[] = [];
      const usersToDelete: MoirUser[] = [];
      
      usersData.forEach((userData, index) => {
        const nameLower = userData.name.toLowerCase().trim();
        const existingUser = existingUsersByName.get(nameLower);
        
        if (existingUser) {
          const hasDataDifference = 
            (userData.phoneNumber && userData.phoneNumber !== existingUser.phoneNumber) ||
            (userData.emergencyPhoneNumber && userData.emergencyPhoneNumber !== existingUser.emergencyPhoneNumber) ||
            (userData.emergencyPerson && userData.emergencyPerson !== existingUser.emergencyPerson) ||
            (userData.allergies && userData.allergies !== existingUser.allergies) ||
            (userData.medication && userData.medication !== existingUser.medication) ||
            (userData.otherDetails && userData.otherDetails !== existingUser.otherDetails);
          
          if (hasDataDifference) {
            updatedExistingUsers.push({
              ...existingUser,
              phoneNumber: userData.phoneNumber || existingUser.phoneNumber,
              emergencyPhoneNumber: userData.emergencyPhoneNumber || existingUser.emergencyPhoneNumber,
              emergencyPerson: userData.emergencyPerson || existingUser.emergencyPerson,
              allergies: userData.allergies || existingUser.allergies,
              medication: userData.medication || existingUser.medication,
              otherDetails: userData.otherDetails || existingUser.otherDetails,
              updatedAt: Date.now(),
            });
          } else {
            updatedExistingUsers.push(existingUser);
          }
          existingUsersByName.delete(nameLower);
        } else {
          newUsers.push({
            id: `moir-user-${Date.now()}-${index}`,
            name: userData.name.trim(),
            phoneNumber: userData.phoneNumber,
            emergencyPhoneNumber: userData.emergencyPhoneNumber,
            emergencyPerson: userData.emergencyPerson,
            allergies: userData.allergies,
            medication: userData.medication,
            otherDetails: userData.otherDetails,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });
      
      existingUsersByName.forEach(user => {
        usersToDelete.push({ ...user, deleted: true as const, updatedAt: Date.now() });
      });
      
      console.log('importUsersFromExcel: New users:', newUsers.length, 'Updated users:', updatedExistingUsers.length, 'Deleted users:', usersToDelete.length);

      const allUsers = [...updatedExistingUsers, ...newUsers, ...usersToDelete];
      const activeUsers = [...updatedExistingUsers, ...newUsers];
      console.log('importUsersFromExcel: Total users to sync:', allUsers.length);
      
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_USERS, JSON.stringify(allUsers));
      console.log('importUsersFromExcel: Saved to AsyncStorage');
      
      setUsers(activeUsers);
      console.log('importUsersFromExcel: Updated state');
      
      console.log('importUsersFromExcel: Starting sync...');
      await syncAllData(true, { users: allUsers });
      console.log('importUsersFromExcel: Sync complete');
      
      console.log('importUsersFromExcel: Reloading data...');
      await loadData();
      console.log('importUsersFromExcel: Reload complete');
      
      return activeUsers.length;
    } catch (error) {
      console.error('importUsersFromExcel: Error:', error);
      throw error;
    }
  }, [users, syncAllData, loadData]);

  const loginUser = useCallback(async (userName: string) => {
    try {
      const user = users.find(u => u.name.toLowerCase() === userName.toLowerCase());
      if (user) {
        await AsyncStorage.setItem(STORAGE_KEYS.MOIR_CURRENT_USER, JSON.stringify(user));
        setCurrentUser(user);
        
        console.log('loginUser: Triggering immediate sync after login');
        syncAllData(true).catch(e => console.error('loginUser: Sync failed', e));
        
        return user;
      }
      return null;
    } catch (error) {
      console.error('Failed to login user:', error);
      throw error;
    }
  }, [users, syncAllData]);

  const logoutUser = useCallback(async () => {
    try {
      setCurrentUser(null);
      setLocationTrackingEnabled(false);
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.MOIR_CURRENT_USER),
        AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATION_TRACKING, JSON.stringify(false))
      ]);
    } catch (error) {
      console.error('Failed to logout user:', error);
      throw error;
    }
  }, []);

  const recordButtonPress = useCallback(async (userId: string, userName: string) => {
    try {
      console.log('MoirContext: recordButtonPress for admin - user:', userName);
      const now = Date.now();
      const date = new Date(now);
      const newRecord: MoirRecord = {
        id: `moir-record-${now}-${Math.random()}`,
        userId,
        userName,
        timestamp: now,
        date: date.toISOString().split('T')[0],
        time: date.toLocaleTimeString(),
        createdAt: now,
        updatedAt: now,
        isAdminRecord: true,
      };

      console.log('MoirContext: Created new record:', newRecord);
      
      const updatedRecords = [...records, newRecord];
      
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_RECORDS, JSON.stringify(updatedRecords));
      console.log('MoirContext: Saved immediately to AsyncStorage');
      
      setRecords(updatedRecords);
      console.log('MoirContext: Updated state');
      
      console.log('MoirContext: Syncing OUT to server...');
      syncData('moir_records', updatedRecords, 'moir-system')
        .then((syncedRecords) => {
          console.log('MoirContext: Sync complete, received', (syncedRecords as MoirRecord[]).length, 'records');
          AsyncStorage.setItem(STORAGE_KEYS.MOIR_RECORDS, JSON.stringify(syncedRecords));
          setRecords((syncedRecords as MoirRecord[]).filter(r => !r.deleted));
        })
        .catch((error) => {
          console.error('MoirContext: Sync failed:', error);
        });
      
      return newRecord;
    } catch (error) {
      console.error('Failed to record button press:', error);
      throw error;
    }
  }, [records]);

  const requestLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermissionGranted(status === 'granted');
      
      if (status === 'granted') {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        return { foreground: true, background: backgroundStatus === 'granted' };
      }
      
      return { foreground: false, background: false };
    } catch (error) {
      console.error('Failed to request location permission:', error);
      throw error;
    }
  }, []);

  const enableLocationTracking = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATION_TRACKING, JSON.stringify(true));
      setLocationTrackingEnabled(true);
    } catch (error) {
      console.error('Failed to enable location tracking:', error);
      throw error;
    }
  }, []);

  const disableLocationTracking = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATION_TRACKING, JSON.stringify(false));
      setLocationTrackingEnabled(false);
    } catch (error) {
      console.error('Failed to disable location tracking:', error);
      throw error;
    }
  }, []);

  const updateLocation = useCallback(async (userId: string, userName: string) => {
    if (!locationTrackingEnabled || !locationPermissionGranted) {
      console.log('MoirContext: Location update skipped - tracking not enabled or permission not granted');
      return;
    }

    try {
      console.log('MoirContext: Getting current location for user:', userName);
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const now = Date.now();
      const newLocation: MoirLocation = {
        id: `moir-location-${now}-${Math.random()}`,
        userId,
        userName,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
      };

      console.log('MoirContext: New location created:', newLocation);

      const storedLocations = await AsyncStorage.getItem(STORAGE_KEYS.MOIR_LOCATIONS);
      const currentLocations = storedLocations ? JSON.parse(storedLocations) : [];
      
      const recentLocations = currentLocations.filter((l: MoirLocation) => 
        l.userId !== userId || now - l.timestamp > 300000
      );
      const updatedLocations = [...recentLocations, newLocation];

      console.log('MoirContext: Saving location to storage and syncing to server...');
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATIONS, JSON.stringify(updatedLocations));
      setLocations(updatedLocations);
      
      syncData('moir_locations', updatedLocations, 'moir-system')
        .then((synced) => {
          console.log('MoirContext: Location synced successfully');
          AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATIONS, JSON.stringify(synced));
          setLocations((synced as MoirLocation[]).filter(l => !l.deleted));
        })
        .catch(e => console.error('MoirContext: Location sync failed:', e));
    } catch (error) {
      console.error('MoirContext: Failed to update location:', error);
    }
  }, [locationTrackingEnabled, locationPermissionGranted]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    if (!locationTrackingEnabled || !locationPermissionGranted) {
      console.log('MoirContext: Location tracking disabled or no permission');
      return;
    }

    console.log('MoirContext: Location tracking enabled for user:', currentUser.name);
    
    return () => {
      console.log('MoirContext: Cleanup');
    };
  }, [currentUser, locationTrackingEnabled, locationPermissionGranted, loadData]);



  const getLastSeenForUser = useCallback((userId: string): number | null => {
    const userRecords = records
      .filter(r => r.userId === userId && r.isAdminRecord === true)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return userRecords.length > 0 ? userRecords[0].timestamp : null;
  }, [records]);

  const getLatestLocationForUser = useCallback((userId: string): MoirLocation | null => {
    const userLocations = locations
      .filter(l => l.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return userLocations.length > 0 ? userLocations[0] : null;
  }, [locations]);

  const getAllLatestLocations = useCallback((): MoirLocation[] => {
    const latestByUser = new Map<string, MoirLocation>();
    
    locations
      .sort((a, b) => b.timestamp - a.timestamp)
      .forEach(location => {
        if (!latestByUser.has(location.userId)) {
          latestByUser.set(location.userId, location);
        }
      });

    return Array.from(latestByUser.values());
  }, [locations]);

  const updateRadiusMeters = useCallback(async (meters: number) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_RADIUS_METERS, JSON.stringify(meters));
      setRadiusMeters(meters);
    } catch (error) {
      console.error('Failed to update radius:', error);
      throw error;
    }
  }, []);

  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }, []);

  const getUsersOutsideRadius = useCallback((adminLocation: MoirLocation | null): { user: MoirUser; location: MoirLocation; distance: number }[] => {
    if (!adminLocation) return [];

    const usersOutside: { user: MoirUser; location: MoirLocation; distance: number }[] = [];
    const latestLocations = getAllLatestLocations();

    latestLocations.forEach(location => {
      if (location.userId === adminLocation.userId) return;

      const distance = calculateDistance(
        adminLocation.latitude,
        adminLocation.longitude,
        location.latitude,
        location.longitude
      );

      if (distance > radiusMeters) {
        const user = users.find(u => u.id === location.userId);
        if (user) {
          usersOutside.push({ user, location, distance });
        }
      }
    });

    return usersOutside;
  }, [users, radiusMeters, getAllLatestLocations, calculateDistance]);

  const clearAllUsers = useCallback(async () => {
    try {
      console.log('clearAllUsers: Starting with', users.length, 'users');
      
      const now = Date.now();
      const deletedUsers = users.map(u => ({ ...u, deleted: true as const, updatedAt: now }));
      const deletedRecords = records.map(r => ({ ...r, deleted: true as const, updatedAt: now }));
      const deletedLocations = locations.map(l => ({ ...l, deleted: true as const, updatedAt: now }));
      
      console.log('clearAllUsers: Marking all data as deleted and syncing to server...');
      await syncAllData(true, { 
        users: deletedUsers, 
        records: deletedRecords, 
        locations: deletedLocations 
      });
      console.log('clearAllUsers: Server data marked as deleted');
      
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.MOIR_USERS, JSON.stringify([])),
        AsyncStorage.setItem(STORAGE_KEYS.MOIR_RECORDS, JSON.stringify([])),
        AsyncStorage.setItem(STORAGE_KEYS.MOIR_LOCATIONS, JSON.stringify([])),
      ]);
      console.log('clearAllUsers: Cleared AsyncStorage');
      
      setUsers([]);
      setRecords([]);
      setLocations([]);
      console.log('clearAllUsers: Updated state to empty arrays');
    } catch (error) {
      console.error('clearAllUsers: Error:', error);
      throw error;
    }
  }, [users, records, locations, syncAllData]);

  const clearAllRecords = useCallback(async () => {
    try {
      console.log('clearAllRecords: Starting with', records.length, 'records');
      const deletedRecords = records.map(r => ({ ...r, deleted: true as const, updatedAt: Date.now() }));
      console.log('clearAllRecords: Marked all records as deleted');
      
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_RECORDS, JSON.stringify(deletedRecords));
      console.log('clearAllRecords: Saved deleted records to AsyncStorage');
      
      console.log('clearAllRecords: Starting sync...');
      await syncAllData(true, { records: deletedRecords });
      console.log('clearAllRecords: Sync complete');
      
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_RECORDS, JSON.stringify([]));
      console.log('clearAllRecords: Cleared AsyncStorage');
      setRecords([]);
      console.log('clearAllRecords: Updated state to empty array');
    } catch (error) {
      console.error('clearAllRecords: Error:', error);
      throw error;
    }
  }, [records, syncAllData]);

  const updateUserDetails = useCallback(async (userId: string, details: Partial<Pick<MoirUser, 'phoneNumber' | 'emergencyPhoneNumber' | 'emergencyPerson' | 'allergies' | 'medication' | 'otherDetails'>>) => {
    try {
      console.log('updateUserDetails: Updating user', userId);
      
      const updatedUsers = users.map(u => 
        u.id === userId 
          ? { ...u, ...details, updatedAt: Date.now() }
          : u
      );
      
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_USERS, JSON.stringify(updatedUsers));
      console.log('updateUserDetails: Saved to AsyncStorage');
      
      setUsers(updatedUsers);
      console.log('updateUserDetails: Updated state');
      
      console.log('updateUserDetails: Starting sync...');
      await syncAllData(true, { users: updatedUsers });
      console.log('updateUserDetails: Sync complete');
    } catch (error) {
      console.error('updateUserDetails: Error:', error);
      throw error;
    }
  }, [users, syncAllData]);

  const removeDuplicateUsers = useCallback(async () => {
    try {
      console.log('removeDuplicateUsers: Starting with', users.length, 'users');
      
      const seenNames = new Map<string, MoirUser>();
      const duplicatesToDelete: MoirUser[] = [];
      
      users.forEach(user => {
        const lowerName = user.name.toLowerCase().trim();
        const existing = seenNames.get(lowerName);
        
        if (existing) {
          if (user.createdAt < existing.createdAt) {
            duplicatesToDelete.push(existing);
            seenNames.set(lowerName, user);
          } else {
            duplicatesToDelete.push(user);
          }
        } else {
          seenNames.set(lowerName, user);
        }
      });
      
      console.log('removeDuplicateUsers: Found', duplicatesToDelete.length, 'duplicates');
      
      if (duplicatesToDelete.length === 0) {
        return { removed: 0, remaining: users.length };
      }
      
      const deletedDuplicates = duplicatesToDelete.map(u => ({ 
        ...u, 
        deleted: true as const, 
        updatedAt: Date.now() 
      }));
      
      const uniqueUsers = Array.from(seenNames.values());
      const allUsers = [...uniqueUsers, ...deletedDuplicates];
      
      await AsyncStorage.setItem(STORAGE_KEYS.MOIR_USERS, JSON.stringify(allUsers));
      console.log('removeDuplicateUsers: Saved to AsyncStorage');
      
      setUsers(uniqueUsers);
      console.log('removeDuplicateUsers: Updated state');
      
      console.log('removeDuplicateUsers: Starting sync...');
      await syncAllData(true, { users: allUsers });
      console.log('removeDuplicateUsers: Sync complete');
      
      return { removed: duplicatesToDelete.length, remaining: uniqueUsers.length };
    } catch (error) {
      console.error('removeDuplicateUsers: Error:', error);
      throw error;
    }
  }, [users, syncAllData]);

  return {
    users,
    records,
    locations,
    currentUser,
    isLoading,
    isSyncing,
    locationTrackingEnabled,
    locationPermissionGranted,
    importUsersFromExcel,
    loginUser,
    logoutUser,
    recordButtonPress,
    requestLocationPermission,
    enableLocationTracking,
    disableLocationTracking,
    updateLocation,
    syncAllData,
    getLastSeenForUser,
    getLatestLocationForUser,
    getAllLatestLocations,
    clearAllUsers,
    clearAllRecords,
    removeDuplicateUsers,
    updateUserDetails,
    radiusMeters,
    updateRadiusMeters,
    calculateDistance,
    getUsersOutsideRadius,
  };
});
