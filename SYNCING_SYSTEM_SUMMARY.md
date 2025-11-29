# Syncing System - How It Works

## Overview
The application uses a **multi-device syncing system** that allows data to be shared across devices and users in real-time.

## Syncing Architecture

### 1. **Local Storage (AsyncStorage)**
- All data is stored locally using React Native's AsyncStorage
- Each data type has its own storage key (e.g., `@stock_app_products`, `customer_orders`, `moir_users`)
- Deleted items are marked with `deleted: true` flag, not physically removed

### 2. **Remote Storage**
Two backend options are supported:
- **File-based sync** via PHP scripts (`public/Tracker/api/sync.php` and `get.php`)
- **JSONBin.io** cloud storage

### 3. **Sync Manager (`utils/syncManager.ts`)**
The core syncing logic handles:

#### **`instantSync(endpoint, localData)`** 
The main sync function that:
1. **Fetches** remote data from server
2. **Merges** local and remote data based on `updatedAt` timestamps (newer wins)
3. **Uploads** merged data back to server
4. Returns the merged dataset

#### **`backgroundSync(endpoint)`**
Fetches data from server without uploading:
- Used for pulling latest changes from other devices
- Returns remote data only

#### **`mergeData(local, remote)`**
Smart merge algorithm:
- Compares items by `id`
- Keeps the item with the newest `updatedAt` timestamp
- Filters out items marked as `deleted: true`

## How Syncing Works

### When Data is Created/Edited
**FIXED** ✅ Now triggers immediate sync:

```typescript
// Example from OrderContext
const addOrder = async (orderData) => {
  const newOrder = { ...orderData, updatedAt: Date.now() }
  const updated = [...orders, newOrder]
  
  // Save locally first
  await AsyncStorage.setItem(ORDERS_KEY, JSON.stringify(updated))
  setOrders(updated)
  
  // Immediately sync to server (NEW!)
  syncOrders(true).catch(e => console.error('Sync failed:', e))
}
```

**What happens:**
1. ✅ Data saved to local AsyncStorage immediately
2. ✅ React state updated immediately  
3. ✅ **Immediate sync to server** triggered (asynchronously)
4. ✅ Server data is merged and overwritten with the new data

### Automatic Background Sync (Every 60 Seconds)
All contexts have auto-sync enabled:

```typescript
useEffect(() => {
  let interval
  if (currentUser) {
    interval = setInterval(() => {
      syncOrders(true) // Silent sync
    }, 60000) // 60 seconds
  }
  return () => clearInterval(interval)
}, [currentUser])
```

**What happens every 60 seconds:**
1. ✅ Fetches latest data from server
2. ✅ Merges with local data (preserving both)
3. ✅ Uploads merged result back to server
4. ✅ Updates local state and AsyncStorage

### Manual Sync
Users can manually trigger sync via "Sync" buttons:

```typescript
await syncOrders(false) // silent = false shows loading indicator
```

## Multi-Device Behavior

### Scenario: Device A creates data, Device B syncs
1. **Device A** creates new order → immediately syncs to server
2. **Device B** auto-syncs (within 60 seconds) → pulls new order from server
3. Both devices now have the same data

### Scenario: Both devices edit same item
1. **Device A** edits order at 12:00:00 → `updatedAt: 1234567890000`
2. **Device B** edits same order at 12:00:05 → `updatedAt: 1234567895000`
3. Both sync to server
4. **Result:** Device B's version wins (newer `updatedAt` timestamp)

### Scenario: Device deletes, other device still has it
1. **Device A** deletes order → marks as `deleted: true`, syncs to server
2. **Device B** syncs → receives `deleted: true` flag
3. **Result:** Both devices filter out the deleted item from display

## Data Retention

### Deleted Items
- Kept for 7 days on server (for sync purposes)
- Automatically cleaned up after 7 days in `sync.php`:
```php
$cutoffTime = time() * 1000 - (7 * 24 * 60 * 60 * 1000);
```

### Old Stock Checks & Requests
- Local storage keeps only recent data (90-365 days depending on type)
- Server keeps full history
- Cleaned up during sync to prevent local storage bloat

## What Was Fixed

### ✅ OrderContext - Immediate Sync
- `addOrder()` now triggers immediate sync
- `updateOrder()` now triggers immediate sync  
- `deleteOrder()` now triggers immediate sync
- `fulfillOrder()` now triggers immediate sync

### Need to Fix (Other Contexts)
Other contexts need the same pattern applied:
- CustomerContext
- StockContext (products, stock checks, requests, outlets, etc.)
- ProductionContext
- RecipeContext
- StoresContext
- ActivityLogContext

## Testing Multi-Device Sync

### Test Plan
1. **Create on Device A** → verify shows on Device B within 60s
2. **Edit on both devices** → verify newer timestamp wins
3. **Delete on Device A** → verify removed on Device B
4. **Offline editing** → verify syncs when back online
5. **Conflict resolution** → verify no data loss

## Configuration

### Environment Variables
```env
EXPO_PUBLIC_FILE_SYNC_URL=https://your-server.com/Tracker/api/
EXPO_PUBLIC_JSONBIN_KEY=your-jsonbin-api-key
```

### Sync Intervals
- **Auto-sync:** 60 seconds (defined in each context)
- **Location tracking (MOIR):** 60 seconds
- **Background sync (web):** 60 seconds via Service Worker

## Troubleshooting

### Sync Not Working
1. Check server is accessible (`FILE_SYNC_URL` or `JSONBIN_KEY`)
2. Check console logs for sync errors
3. Verify `currentUser` is set (syncing requires authentication)
4. Check network connectivity

### Data Not Appearing on Other Device
1. Wait 60 seconds for auto-sync
2. Manually trigger sync button
3. Check if `updatedAt` timestamp is correct
4. Verify item is not marked `deleted: true`

### Data Loss
- Should never happen due to merge algorithm
- If occurs, check server logs
- Verify `updatedAt` timestamps are being set correctly
