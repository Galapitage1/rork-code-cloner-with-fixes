const CACHE_NAME = 'moir-v1';
const SYNC_TAG = 'moir-sync';

self.addEventListener('install', (event) => {
  console.log('MOIR Service Worker: Installing');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('MOIR Service Worker: Activating');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('sync', (event) => {
  console.log('MOIR Service Worker: Sync event triggered', event.tag);
  
  if (event.tag === SYNC_TAG) {
    event.waitUntil(performBackgroundSync());
  }
});

self.addEventListener('periodicsync', (event) => {
  console.log('MOIR Service Worker: Periodic sync event triggered', event.tag);
  
  if (event.tag === 'moir-background-sync') {
    event.waitUntil(performBackgroundSync());
  }
});

async function performBackgroundSync() {
  try {
    console.log('MOIR Service Worker: Performing background sync');

    const clients = await self.clients.matchAll({ type: 'window' });
    
    if (clients && clients.length > 0) {
      clients[0].postMessage({
        type: 'SYNC_REQUEST',
        timestamp: Date.now(),
      });
      console.log('MOIR Service Worker: Sync request sent to client');
    } else {
      console.log('MOIR Service Worker: No clients found, performing sync in SW');
    }

    return Promise.resolve();
  } catch (error) {
    console.error('MOIR Service Worker: Sync failed', error);
    return Promise.reject(error);
  }
}

self.addEventListener('message', (event) => {
  console.log('MOIR Service Worker: Message received', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
