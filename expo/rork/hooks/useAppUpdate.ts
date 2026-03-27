import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const checkInProgressRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const checkForUpdate = async () => {
      if (checkInProgressRef.current) return;
      
      try {
        checkInProgressRef.current = true;
        setIsChecking(true);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('/index.html', {
          headers: { 'Cache-Control': 'no-cache' },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          console.warn('Update check failed with status:', response.status);
          return;
        }
        
        const html = await response.text();
        const currentHash = getHashFromHtml(html);
        
        const storedHash = localStorage.getItem('app-version-hash');
        
        if (storedHash && storedHash !== currentHash) {
          console.log('App update detected:', { storedHash, currentHash });
          setUpdateAvailable(true);
        } else if (!storedHash) {
          localStorage.setItem('app-version-hash', currentHash);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('Update check timed out');
        } else {
          console.error('Error checking for updates:', error);
        }
      } finally {
        setIsChecking(false);
        checkInProgressRef.current = false;
      }
    };

    const getHashFromHtml = (html: string): string => {
      const scriptMatch = html.match(/<script[^>]*src="([^"]+)"/);
      return scriptMatch ? scriptMatch[1] : Date.now().toString();
    };

    const initialTimer = setTimeout(() => {
      checkForUpdate();
    }, 2000);

    const interval = setInterval(checkForUpdate, 10 * 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  const reloadApp = async () => {
    if (Platform.OS === 'web') {
      setDismissed(true);
      setUpdateAvailable(false);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const html = await fetch('/index.html', {
          headers: { 'Cache-Control': 'no-cache' },
          signal: controller.signal
        }).then(r => r.text());
        
        clearTimeout(timeoutId);
        
        const currentHash = getHashFromHtml(html);
        localStorage.setItem('app-version-hash', currentHash);
        
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
        
        window.location.href = window.location.origin + '/index.html';
      } catch (error) {
        console.error('Error updating app:', error);
        window.location.reload();
      }
    }
  };

  const getHashFromHtml = (html: string): string => {
    const scriptMatch = html.match(/<script[^>]*src="([^"]+)"/);
    return scriptMatch ? scriptMatch[1] : Date.now().toString();
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
