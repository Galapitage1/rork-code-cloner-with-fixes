import { useState, useEffect, useCallback } from 'react';

interface BackendStatus {
  isAvailable: boolean;
  lastChecked: number | null;
  checking: boolean;
}

let globalBackendStatus: BackendStatus = {
  isAvailable: false,
  lastChecked: null,
  checking: false,
};

let statusListeners: Set<(status: BackendStatus) => void> = new Set();

function notifyListeners() {
  statusListeners.forEach(listener => listener({ ...globalBackendStatus }));
}

function getBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_RORK_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
  }
  
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  return 'http://localhost:8081';
}

export async function checkBackendStatus(): Promise<boolean> {
  if (globalBackendStatus.checking) {
    return globalBackendStatus.isAvailable;
  }

  try {
    globalBackendStatus.checking = true;
    notifyListeners();

    const baseUrl = getBaseUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      globalBackendStatus.isAvailable = data.status === 'healthy';
    } else {
      globalBackendStatus.isAvailable = false;
    }
  } catch {
    globalBackendStatus.isAvailable = false;
  } finally {
    globalBackendStatus.lastChecked = Date.now();
    globalBackendStatus.checking = false;
    notifyListeners();
  }

  return globalBackendStatus.isAvailable;
}

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>(globalBackendStatus);

  useEffect(() => {
    statusListeners.add(setStatus);
    
    if (globalBackendStatus.lastChecked === null && !globalBackendStatus.checking) {
      checkBackendStatus().catch(() => {});
    }

    return () => {
      statusListeners.delete(setStatus);
    };
  }, []);

  const refresh = useCallback(async () => {
    return await checkBackendStatus();
  }, []);

  return {
    ...status,
    refresh,
    baseUrl: getBaseUrl(),
  };
}

export function getBackendStatus(): BackendStatus {
  return { ...globalBackendStatus };
}
