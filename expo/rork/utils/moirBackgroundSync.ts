import { Platform } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncData } from './syncManager';

export interface BackgroundSyncConfig {
  userId: string;
  userName: string;
  syncInterval: number;
  onLocationUpdate?: (location: any) => void;
  onSyncComplete?: () => void;
}

class MoirBackgroundSyncManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private config: BackgroundSyncConfig | null = null;
  private isRunning = false;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  private visibilityListener: (() => void) | null = null;

  async initialize(config: BackgroundSyncConfig) {
    console.log('MoirBackgroundSyncManager: Initializing with config', config);
    this.config = config;

    if (Platform.OS === 'web') {
      await this.initializeWebBackgroundSync();
    }

    this.start();
  }

  private async initializeWebBackgroundSync() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.log('MoirBackgroundSyncManager: Service Worker not supported');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/moir-sw.js', {
        scope: '/',
      });
      this.serviceWorkerRegistration = registration;
      console.log('MoirBackgroundSyncManager: Service Worker registered successfully');

      await this.setupMessageListener();

      if ('periodicSync' in registration) {
        try {
          await (registration as any).periodicSync.register('moir-background-sync', {
            minInterval: 60 * 1000,
          });
          console.log('MoirBackgroundSyncManager: Periodic Background Sync registered');
        } catch (error) {
          console.warn('MoirBackgroundSyncManager: Periodic sync not available:', error);
        }
      }
    } catch (error) {
      console.error('MoirBackgroundSyncManager: Failed to register service worker:', error);
    }

    this.setupVisibilityListener();
  }

  private setupVisibilityListener() {
    if (typeof document === 'undefined') return;

    this.visibilityListener = () => {
      console.log('MoirBackgroundSyncManager: Visibility changed:', document.visibilityState);
      
      if (document.visibilityState === 'visible') {
        console.log('MoirBackgroundSyncManager: App became visible, triggering immediate sync');
        this.performSync().catch(e => console.error('Visibility sync failed:', e));
      } else if (document.visibilityState === 'hidden') {
        console.log('MoirBackgroundSyncManager: App became hidden, scheduling background sync');
        if (this.serviceWorkerRegistration && 'sync' in this.serviceWorkerRegistration) {
          (this.serviceWorkerRegistration as any).sync.register('moir-sync')
            .then(() => console.log('MoirBackgroundSyncManager: Background sync scheduled'))
            .catch((e: Error) => console.error('Failed to schedule background sync:', e));
        }
      }
    };

    document.addEventListener('visibilitychange', this.visibilityListener);
  }

  private async setupMessageListener() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      console.log('MoirBackgroundSyncManager: Received message from service worker:', event.data);
      
      if (event.data.type === 'SYNC_REQUEST') {
        this.performSync().catch(e => console.error('SW sync request failed:', e));
      }
    });
  }

  start() {
    if (this.isRunning || !this.config) {
      console.log('MoirBackgroundSyncManager: Already running or no config');
      return;
    }

    console.log('MoirBackgroundSyncManager: Starting sync loop');
    this.isRunning = true;

    this.performSync();

    this.intervalId = setInterval(() => {
      console.log('MoirBackgroundSyncManager: Interval triggered');
      this.performSync();
    }, this.config.syncInterval);
  }

  stop() {
    console.log('MoirBackgroundSyncManager: Stopping sync loop');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  private async performSync() {
    if (!this.config) {
      console.log('MoirBackgroundSyncManager: No config, skipping sync');
      return;
    }

    try {
      console.log('MoirBackgroundSyncManager: Starting sync operation');

      await Promise.all([
        this.updateLocation(),
        this.syncAllMoirData(),
      ]);

      console.log('MoirBackgroundSyncManager: Sync complete');
      this.config.onSyncComplete?.();
    } catch (error) {
      console.error('MoirBackgroundSyncManager: Sync failed:', error);
    }
  }

  private async updateLocation() {
    if (!this.config) return;

    try {
      const trackingEnabled = await AsyncStorage.getItem('@moir_location_tracking');
      if (!trackingEnabled || JSON.parse(trackingEnabled) !== true) {
        console.log('MoirBackgroundSyncManager: Location tracking disabled');
        return;
      }

      console.log('MoirBackgroundSyncManager: Getting current location');
      
      let position;
      
      if (Platform.OS === 'web') {
        if (!navigator.geolocation) {
          console.log('MoirBackgroundSyncManager: Geolocation not supported');
          return;
        }

        position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        });
      } else {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('MoirBackgroundSyncManager: Location permission not granted');
          return;
        }

        position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      const now = Date.now();
      const newLocation = {
        id: `moir-location-${now}-${Math.random()}`,
        userId: this.config.userId,
        userName: this.config.userName,
        latitude: Platform.OS === 'web' ? position.coords.latitude : (position as any).coords.latitude,
        longitude: Platform.OS === 'web' ? position.coords.longitude : (position as any).coords.longitude,
        timestamp: now,
        createdAt: now,
        updatedAt: now,
      };

      console.log('MoirBackgroundSyncManager: New location created:', newLocation);

      const storedLocations = await AsyncStorage.getItem('@moir_locations');
      const currentLocations = storedLocations ? JSON.parse(storedLocations) : [];
      
      const recentLocations = currentLocations.filter((l: any) => 
        l.userId !== this.config!.userId || now - l.timestamp > 300000
      );
      const updatedLocations = [...recentLocations, newLocation];

      await AsyncStorage.setItem('@moir_locations', JSON.stringify(updatedLocations));
      console.log('MoirBackgroundSyncManager: Location saved to storage');

      await syncData('moir_locations', updatedLocations, 'moir-system')
        .then((synced) => {
          console.log('MoirBackgroundSyncManager: Location synced to server');
          AsyncStorage.setItem('@moir_locations', JSON.stringify(synced));
        })
        .catch(e => console.error('MoirBackgroundSyncManager: Location sync failed:', e));

      this.config.onLocationUpdate?.(newLocation);
    } catch (error) {
      console.error('MoirBackgroundSyncManager: Failed to update location:', error);
    }
  }

  private async syncAllMoirData() {
    try {
      console.log('MoirBackgroundSyncManager: Syncing all MOIR data');

      const [usersData, recordsData, locationsData] = await Promise.all([
        AsyncStorage.getItem('@moir_users'),
        AsyncStorage.getItem('@moir_records'),
        AsyncStorage.getItem('@moir_locations'),
      ]);

      const users = usersData ? JSON.parse(usersData) : [];
      const records = recordsData ? JSON.parse(recordsData) : [];
      const locations = locationsData ? JSON.parse(locationsData) : [];

      const [syncedUsers, syncedRecords, syncedLocations] = await Promise.all([
        syncData('moir_users', users, 'moir-system'),
        syncData('moir_records', records, 'moir-system'),
        syncData('moir_locations', locations, 'moir-system'),
      ]);

      await Promise.all([
        AsyncStorage.setItem('@moir_users', JSON.stringify(syncedUsers)),
        AsyncStorage.setItem('@moir_records', JSON.stringify(syncedRecords)),
        AsyncStorage.setItem('@moir_locations', JSON.stringify(syncedLocations)),
      ]);

      console.log('MoirBackgroundSyncManager: All MOIR data synced successfully');
    } catch (error) {
      console.error('MoirBackgroundSyncManager: Failed to sync MOIR data:', error);
    }
  }

  async requestWakeLock() {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      console.log('MoirBackgroundSyncManager: Wake Lock API not supported');
      return null;
    }

    try {
      const wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log('MoirBackgroundSyncManager: Wake Lock acquired');
      return wakeLock;
    } catch (error) {
      console.error('MoirBackgroundSyncManager: Failed to acquire wake lock:', error);
      return null;
    }
  }
}

export const moirBackgroundSyncManager = new MoirBackgroundSyncManager();
