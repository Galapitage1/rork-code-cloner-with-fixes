import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const checkInProgressRef = useRef(false);
  const currentVersionRef = useRef<string | null>(null);
  const appBasePathRef = useRef<string>('');

  const normalizeVersion = (value: string | null | undefined): string => {
    if (!value) return '';
    try {
      const parsed = new URL(value, window.location.origin);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return value;
    }
  };

  const getHashFromHtml = (html: string): string => {
    const scriptMatch = html.match(/<script[^>]*src="([^"]*\/_expo\/static\/js\/web\/entry-[^"]+)"/i);
    if (!scriptMatch) return '';
    return normalizeVersion(scriptMatch[1]);
  };

  const getCurrentRuntimeVersion = (): string => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return '';
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const entryScript = scripts.find((script) => {
      const src = (script as HTMLScriptElement).src || '';
      return src.includes('/_expo/static/js/web/entry-');
    }) as HTMLScriptElement | undefined;
    return normalizeVersion(entryScript?.src || '');
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
        const currentRuntimeVersion = currentVersionRef.current || getCurrentRuntimeVersion();
        if (currentRuntimeVersion && remoteHash && currentRuntimeVersion !== remoteHash) {
          setUpdateAvailable(true);
          return;
        }

        const storedHash = normalizeVersion(localStorage.getItem('app-version-hash') || '');
        if (storedHash && remoteHash && storedHash !== remoteHash) {
          setUpdateAvailable(true);
        } else if (remoteHash && !storedHash) {
          localStorage.setItem('app-version-hash', remoteHash);
        }
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
  }, []);

  const reloadApp = async () => {
    if (Platform.OS === 'web') {
      setDismissed(true);
      setUpdateAvailable(false);
      
      try {
        localStorage.setItem('app-reload-path', window.location.pathname);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const indexUrl = `${appBasePathRef.current}/index.html?__reload_check=${Date.now()}`;
        const html = await fetch(indexUrl, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
          signal: controller.signal
        }).then(r => r.text());
        
        clearTimeout(timeoutId);
        
        const currentHash = getHashFromHtml(html);
        if (currentHash) {
          localStorage.setItem('app-version-hash', currentHash);
        }
        
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        
        await caches.keys().then(cacheNames => {
          return Promise.all(
            cacheNames.map(cacheName => caches.delete(cacheName))
          );
        });
        
        window.location.reload();
      } catch {
        window.location.reload();
      }
    }
  };

  const dismissUpdate = () => {
    setDismissed(true);
  };

  return { 
    updateAvailable: updateAvailable && !dismissed, 
    isChecking, 
    reloadApp,
    dismissUpdate 
  };
}
