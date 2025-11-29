let isServerAvailable = true;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000;

export async function checkServerHealth(): Promise<boolean> {
  const now = Date.now();
  
  if (now - lastCheckTime < CHECK_INTERVAL) {
    return isServerAvailable;
  }
  
  try {
    const baseUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 
                    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    isServerAvailable = response.ok;
    lastCheckTime = now;
    
    console.log('[ConnectionStatus] Server health check:', isServerAvailable ? 'OK' : 'Failed');
    
    return isServerAvailable;
  } catch (error) {
    console.log('[ConnectionStatus] Server health check failed:', error);
    isServerAvailable = false;
    lastCheckTime = now;
    return false;
  }
}

export function getServerStatus(): boolean {
  return isServerAvailable;
}

export function resetServerStatus(): void {
  isServerAvailable = true;
  lastCheckTime = 0;
}
