import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [dismissedHash, setDismissedHash] = useState<string | null>(null);
  const checkInProgressRef = useRef(false);
  const currentVersionRef = useRef<string | null>(null);
  const latestRemoteHashRef = useRef<string | null>(null);
  const appBasePathRef = useRef<string>('');

  const BUILD_HASH_STORAGE_KEY = 'tracker-build-hash';
  const extractBundleHash = (value: string | null | undefined): string => {
    const raw = String(value || '');
    const match = raw.match(/entry-([a-f0-9]+)\.js/i);
    return match?.[1]?.toLowerCase() || '';
  };

  const extractBundleVersion = (value: string | null | undefined): string => {
    const raw = String(value || '');
    const hash = extractBundleHash(raw);
    if (!hash) return '';

    let versionTag = '';
    try {
      const parsed = raw.includes('://')
        ? new URL(raw)
        : new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://tracker.tecclk.com');
      versionTag = parsed.searchParams.get('v') || parsed.searchParams.get('__v') || '';
    } catch {
      const fallbackMatch = raw.match(/[?&]v=([^&"']+)/i) || raw.match(/[?&]__v=([^&"']+)/i);
      versionTag = fallbackMatch?.[1] || '';
    }

    return versionTag ? `${hash}@${versionTag}` : hash;
  };

  const getHashFromHtml = (html: string): string => {
    const scriptMatch = html.match(/<script[^>]*src="([^"]*\/_expo\/static\/js\/web\/entry-[^"]+)"/i);
    if (!scriptMatch) return '';
    return extractBundleVersion(scriptMatch[1]);
  };

  const getCurrentRuntimeVersion = (): string => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return '';
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const entryScript = scripts.find((script) => {
      const src = (script as HTMLScriptElement).src || '';
      return src.includes('/_expo/static/js/web/entry-');
    }) as HTMLScriptElement | undefined;
    return extractBundleVersion(entryScript?.src || '');
  };

  const getAppBasePath = (): string => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return '';
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const entryScript = scripts.find((script) => {
      const src = (script as HTMLScriptElement).src || '';
      return src.includes('/_expo/static/js/web/entry-');
    }) as HTMLScriptElement | undefined;

    if (!entryScript?.src) return '';
    try {
      const parsed = new URL(entryScript.src, window.location.origin);
      const marker = '/_expo/static/js/web/entry-';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex < 0) return '';
      const prefix = parsed.pathname.slice(0, markerIndex).replace(/\/$/, '');
      return prefix;
    } catch {
      return '';
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const cleanupLegacyWebCachesOnce = async () => {
      if (typeof window === 'undefined') return;

      const cleanupKey = 'tracker-web-cache-cleanup';
      const cleanupVersion = '2026-03-07-v2';

      try {
        if (window.localStorage?.getItem(cleanupKey) === cleanupVersion) {
          return;
        }
      } catch {
        // Ignore localStorage read errors.
      }

      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
      } catch {
        // Ignore service worker cleanup errors.
      }

      try {
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map((name) => caches.delete(name)));
        }
      } catch {
        // Ignore cache cleanup errors.
      }

      try {
        window.localStorage?.removeItem('app-version-hash');
        window.localStorage?.setItem(cleanupKey, cleanupVersion);
      } catch {
        // Ignore localStorage write errors.
      }
    };

    const resetSyncTimestampsOnBuildChange = async () => {
      if (typeof window === 'undefined') return;
      const currentBuildHash = getCurrentRuntimeVersion();
      if (!currentBuildHash) return;

      let previousBuildHash = '';
      try {
        previousBuildHash = String(window.localStorage?.getItem(BUILD_HASH_STORAGE_KEY) || '');
      } catch {
        // Ignore localStorage read errors.
      }

      if (previousBuildHash === currentBuildHash) {
        return;
      }

      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const syncTimestampKeys = allKeys.filter((key) => key.startsWith('@last_sync_'));
        const extraKeys = ['@reconciliation_last_sync'];
        const keysToRemove = [...syncTimestampKeys, ...extraKeys];
        if (keysToRemove.length > 0) {
          await AsyncStorage.multiRemove(keysToRemove);
        }
      } catch {
        // Ignore AsyncStorage cleanup errors.
      }

      try {
        window.localStorage?.setItem(BUILD_HASH_STORAGE_KEY, currentBuildHash);
      } catch {
        // Ignore localStorage write errors.
      }
    };

    const checkForUpdate = async () => {
      if (checkInProgressRef.current) return;
      
      try {
        checkInProgressRef.current = true;
        setIsChecking(true);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const indexUrl = `${appBasePathRef.current}/index.html?__version_check=${Date.now()}`;
        const response = await fetch(indexUrl, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          return;
        }
        
        const html = await response.text();
        const remoteHash = getHashFromHtml(html);
        latestRemoteHashRef.current = remoteHash || null;

        const currentRuntimeVersion = getCurrentRuntimeVersion();
        if (currentRuntimeVersion) {
          currentVersionRef.current = currentRuntimeVersion;
          localStorage.setItem('app-version-hash', currentRuntimeVersion);
          try {
            window.localStorage?.setItem(BUILD_HASH_STORAGE_KEY, currentRuntimeVersion);
          } catch {
            // Ignore localStorage errors.
          }
        }

        if (!remoteHash || !currentRuntimeVersion) {
          setUpdateAvailable(false);
          return;
        }

        if (currentRuntimeVersion === remoteHash) {
          setUpdateAvailable(false);
          setDismissedHash(null);
          return;
        }

        if (dismissedHash && dismissedHash === remoteHash) {
          setUpdateAvailable(false);
          return;
        }

        setUpdateAvailable(true);
      } catch {
        // Silently handle update check errors
      } finally {
        setIsChecking(false);
        checkInProgressRef.current = false;
      }
    };

    appBasePathRef.current = getAppBasePath();
    currentVersionRef.current = getCurrentRuntimeVersion();
    if (currentVersionRef.current) {
      localStorage.setItem('app-version-hash', currentVersionRef.current);
    }

    void cleanupLegacyWebCachesOnce().finally(() => {
      currentVersionRef.current = getCurrentRuntimeVersion();
      if (currentVersionRef.current) {
        localStorage.setItem('app-version-hash', currentVersionRef.current);
      }
      void resetSyncTimestampsOnBuildChange().finally(() => {
        checkForUpdate();
      });
    });

    const initialTimer = setTimeout(() => {
      checkForUpdate();
    }, 2000);

    const interval = setInterval(checkForUpdate, 2 * 60 * 1000);
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };
    const onWindowFocus = () => {
      checkForUpdate();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onWindowFocus);
    }

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onWindowFocus);
      }
    };
  }, [dismissedHash]);

  const reloadApp = async () => {
    if (Platform.OS === 'web') {
      setDismissedHash(null);
      setUpdateAvailable(false);
      
      try {
        const basePath = appBasePathRef.current || '';
        const hardReloadUrl = `${basePath}/index.html?__force_reload=${Date.now()}`;
        localStorage.setItem('app-reload-path', window.location.pathname);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const indexUrl = `${basePath}/index.html?__reload_check=${Date.now()}`;
        const html = await fetch(indexUrl, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
          signal: controller.signal
        }).then(r => r.text());
        
        clearTimeout(timeoutId);
        
        const currentHash = getHashFromHtml(html);
        if (currentHash) {
          localStorage.setItem('app-version-hash', currentHash);
          try {
            window.localStorage?.setItem(BUILD_HASH_STORAGE_KEY, currentHash);
          } catch {
            // Ignore localStorage write errors.
          }
        }
        
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        
        if ('caches' in window) {
          await caches.keys().then(cacheNames => {
            return Promise.all(
              cacheNames.map(cacheName => caches.delete(cacheName))
            );
          });
        }

        window.location.replace(hardReloadUrl);
      } catch {
        const basePath = appBasePathRef.current || '';
        window.location.replace(`${basePath}/index.html?__force_reload=${Date.now()}`);
      }
    }
  };

  const dismissUpdate = () => {
    if (latestRemoteHashRef.current) {
      setDismissedHash(latestRemoteHashRef.current);
    }
    setUpdateAvailable(false);
  };

  return { 
    updateAvailable, 
    isChecking, 
    reloadApp,
    dismissUpdate 
  };
}
