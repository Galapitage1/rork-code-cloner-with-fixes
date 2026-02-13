# MOIR Background Sync Implementation

## Overview

Background syncing has been implemented for the MOIR (Members On-site Instant Register) system to ensure that location data and MOIR data continue to sync even when the browser is minimized on mobile devices.

## How It Works

### 1. **Background Sync Manager** (`utils/moirBackgroundSync.ts`)

The background sync manager handles:
- **Location tracking** - Collects user location every 60 seconds
- **Data synchronization** - Syncs MOIR users, records, and locations with the server
- **Service Worker integration** - Uses Web APIs for true background processing on web
- **Visibility API** - Detects when the app is hidden/visible and triggers syncs accordingly

### 2. **Service Worker** (`public/moir-sw.js`)

The service worker enables:
- **Background Sync API** - Syncs data even when the tab is in the background
- **Periodic Background Sync** - Attempts to sync every 60 seconds (where supported)
- **Message passing** - Communicates with the main app thread

### 3. **Platform Support**

#### **Web (Browser)**
- Uses Page Visibility API to detect when browser is minimized
- Service Worker provides background sync capabilities
- Geolocation API for location tracking
- **Limitations**: 
  - True background sync depends on browser support
  - Some mobile browsers may throttle background tabs
  - iOS Safari has limited Service Worker support

#### **Mobile (React Native)**
- Uses native location tracking APIs
- Background location updates via expo-location
- More reliable than web implementation
- **Limitations**:
  - Requires location permissions
  - Battery usage considerations

## Features

### Location Tracking
- Automatic location updates every 60 seconds
- Works when app is in foreground and background (with permissions)
- Batches location data to reduce server requests
- Only sends new location if >5 minutes have passed since last update for the same user

### Data Synchronization
- Syncs MOIR users, records, and locations
- Automatic deduplication of users by name
- Handles conflicts by keeping the newest data
- Silent syncing to avoid UI disruptions

### Wake Lock Support
- Prevents screen from sleeping during active tracking (web only)
- Improves reliability of background sync

## Usage

The background sync is automatically initialized when:
1. A user logs in (either regular user or admin)
2. Location tracking is enabled
3. Location permissions are granted

It stops when:
- User logs out
- Location tracking is disabled
- App is closed

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Service Worker | ✅ | ✅ | ⚠️ Limited | ✅ |
| Background Sync | ✅ | ❌ | ❌ | ✅ |
| Periodic Sync | ✅ | ❌ | ❌ | ✅ |
| Visibility API | ✅ | ✅ | ✅ | ✅ |

⚠️ **Note**: iOS Safari has limited Service Worker support and may not fully support background sync.

## Implementation Details

### MoirContext Integration

The `MoirContext` has been updated to:
1. Initialize the background sync manager when a user logs in
2. Pass user information and sync interval (60 seconds)
3. Handle callbacks for location updates and sync completion
4. Reload data when background sync completes

### Key Changes
- Removed duplicate 60-second interval timers
- Consolidated all background syncing into one manager
- Added proper cleanup on logout/unmount

## Testing

To test background sync:

1. **Web**: 
   - Open DevTools → Application → Service Workers
   - Check if `moir-sw.js` is registered
   - Minimize the browser window
   - Check console logs for "Background sync" messages

2. **Mobile**:
   - Enable location permissions
   - Log in as a user
   - Minimize the app
   - Check if location continues to update in the admin view

## Future Improvements

1. **Battery optimization** - Adaptive sync intervals based on battery level
2. **Network awareness** - Reduce sync frequency on slow connections
3. **Offline queue** - Store failed syncs and retry when online
4. **Push notifications** - Alert admin when users are outside radius (requires notification permission)
5. **WebSocket support** - Real-time updates instead of polling

## Troubleshooting

### Service Worker not registering
- Check if HTTPS is enabled (required for Service Workers)
- Verify `public/moir-sw.js` exists and is accessible
- Check browser console for registration errors

### Location not updating
- Verify location permissions are granted
- Check if location tracking is enabled in settings
- Ensure device has GPS/location services enabled

### Background sync not working
- Check browser compatibility
- Verify Service Worker is active
- Test with browser in foreground first
- Check for battery saver modes that may throttle background tabs

## Privacy Considerations

- Location data is only collected when user explicitly enables tracking
- Location data is only visible to admin users
- Users can disable tracking at any time
- No location data is collected when user is logged out
