import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_RORK_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return 'http://localhost:8081';
};

const baseUrl = getBaseUrl();
console.log('[tRPC] Base URL configured:', baseUrl);

const MAX_RETRIES = 3;

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: `${baseUrl}/api/trpc`,
      transformer: undefined,
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      fetch: async (url, options) => {
        console.log('[tRPC] Request to:', url);
        
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(url, {
              ...options,
              headers: {
                ...options?.headers,
                'Accept': 'application/json',
              },
              signal: controller.signal,
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              console.error('[tRPC] HTTP error:', response.status, response.statusText);
              const text = await response.text();
              console.error('[tRPC] Response body:', text.substring(0, 500));
            }
            
            return response;
          } catch (error) {
            if (attempt < MAX_RETRIES) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
              console.warn(`[tRPC] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.error('[tRPC] Fetch error after all retries:', error);
              throw error;
            }
          }
        }
        
        throw new Error('Max retries exceeded');
      },
    }),
  ],
});