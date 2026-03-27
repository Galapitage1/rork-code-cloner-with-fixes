import AsyncStorage from '@react-native-async-storage/async-storage';

const JSONBIN_BASE_URL = 'https://api.jsonbin.io/v3/b';
const SYNC_KEY = process.env.EXPO_PUBLIC_JSONBIN_KEY || '';
const FILE_SYNC_BASE = (typeof window !== 'undefined' ? (window as any).EXPO_FILE_SYNC_URL : undefined) || process.env.EXPO_PUBLIC_FILE_SYNC_URL || '';

export const DEVICE_ID_KEY = '@device_id';
const BIN_ID_KEY = '@jsonbin_bin_id';
const CENTRAL_BIN_MAP_KEY = '@central_bin_map';

let deviceId: string | null = null;
let centralBinMap: Record<string, string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  
  let stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!stored) {
    stored = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, stored);
  }
  
  deviceId = stored;
  return stored;
}

export async function getCentralBinMap(): Promise<Record<string, string>> {
  if (centralBinMap) return centralBinMap;
  
  const stored = await AsyncStorage.getItem(CENTRAL_BIN_MAP_KEY);
  if (stored) {
    try {
      centralBinMap = JSON.parse(stored);
      return centralBinMap || {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function setCentralBinMap(map: Record<string, string>): Promise<void> {
  centralBinMap = map;
  await AsyncStorage.setItem(CENTRAL_BIN_MAP_KEY, JSON.stringify(map));
}

export async function getBinId(key: string): Promise<string | null> {
  const centralMap = await getCentralBinMap();
  if (centralMap[key]) {
    return centralMap[key];
  }
  return await AsyncStorage.getItem(`${BIN_ID_KEY}_${key}`);
}

export async function setBinId(key: string, binId: string): Promise<void> {
  const centralMap = await getCentralBinMap();
  centralMap[key] = binId;
  await setCentralBinMap(centralMap);
  await AsyncStorage.setItem(`${BIN_ID_KEY}_${key}`, binId);
}

function cleanDataForSync<T>(data: T): T {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (error) {
    console.error('cleanDataForSync: Failed to clean data', error);
    throw new Error('Data contains non-serializable values');
  }
}

export function mergeData<T extends { id: string; updatedAt?: number }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  
  local.forEach(item => merged.set(item.id, item));
  
  remote.forEach(item => {
    const existing = merged.get(item.id);
    if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
      merged.set(item.id, item);
    }
  });
  
  // Filter out items marked as deleted during merge
  const result = Array.from(merged.values());
  return result.filter((item: any) => !item.deleted);
}

export async function instantSync<T extends { id: string; updatedAt?: number }>(
  endpoint: string,
  localData: T[],
  userId?: string,
  options?: { isDefaultAdminDevice?: boolean }
): Promise<T[]> {
  console.log(`[INSTANT SYNC] ${endpoint}: Starting instant sync...`);
  
  if (FILE_SYNC_BASE) {
    try {
      console.log(`[INSTANT SYNC] ${endpoint}: Step 1 - Fetching from server...`);
      const url = FILE_SYNC_BASE.replace(/\/$/, '') + `/get.php?endpoint=${encodeURIComponent(endpoint)}`;
      const getRes = await fetch(url);
      
      let remoteData: T[] = [];
      if (getRes.ok) {
        const responseText = await getRes.text();
        try {
          const parsed = JSON.parse(responseText);
          remoteData = Array.isArray(parsed) ? parsed : [];
          console.log(`[INSTANT SYNC] ${endpoint}: Got ${remoteData.length} items from server`);
        } catch {
          console.error(`[INSTANT SYNC] ${endpoint}: Invalid JSON from server, using empty array`);
          remoteData = [];
        }
      } else {
        console.log(`[INSTANT SYNC] ${endpoint}: Server fetch failed, using local data only`);
      }
      
      console.log(`[INSTANT SYNC] ${endpoint}: Step 2 - Merging ${localData.length} local with ${remoteData.length} remote items...`);
      const merged = mergeData(localData, remoteData);
      console.log(`[INSTANT SYNC] ${endpoint}: Merged result: ${merged.length} items`);
      
      console.log(`[INSTANT SYNC] ${endpoint}: Step 3 - Uploading merged data to server...`);
      const currentDeviceId = await getDeviceId();
      const dataWithMetadata = merged.map(item => ({
        ...item,
        updatedAt: item.updatedAt || Date.now(),
        deviceId: currentDeviceId,
      }));
      const cleaned = cleanDataForSync(dataWithMetadata);

      const syncUrl = FILE_SYNC_BASE.replace(/\/$/, '') + `/sync.php?endpoint=${encodeURIComponent(endpoint)}`;
      const res = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleaned),
      });
      
      if (!res.ok) {
        console.error(`[INSTANT SYNC] ${endpoint}: File-sync upload failed ${res.status}`);
        return merged as T[];
      }
      
      const responseText = await res.text();
      let serverMerged: any;
      try {
        serverMerged = JSON.parse(responseText);
      } catch {
        console.error(`[INSTANT SYNC] ${endpoint}: Invalid JSON response from upload`);
        return merged as T[];
      }
      
      console.log(`[INSTANT SYNC] ${endpoint}: Success - fetch, merge, upload complete`);
      return Array.isArray(serverMerged) ? (serverMerged as T[]) : (merged as T[]);
    } catch (e) {
      console.error(`[INSTANT SYNC] ${endpoint}: Error`, e);
      return localData;
    }
  }

  if (!SYNC_KEY) {
    console.log(`[INSTANT SYNC] ${endpoint}: No JSONBIN key configured`);
    return localData;
  }

  try {
    if (!Array.isArray(localData)) {
      console.error(`[INSTANT SYNC] ${endpoint}: localData is not an array`);
      return [];
    }
    
    let binId: string | null = await getBinId(endpoint);
    const protectedEndpoints = new Set(['products', 'users', 'outlets']);
    const isProtected = protectedEndpoints.has(endpoint);
    const isDefaultAdminDevice = options?.isDefaultAdminDevice === true;
    
    // Step 1: Fetch from server
    let remoteData: T[] = [];
    if (binId) {
      console.log(`[INSTANT SYNC] ${endpoint}: Step 1 - Fetching from server...`);
      try {
        const getResponse = await fetch(`${JSONBIN_BASE_URL}/${binId}/latest`, {
          headers: {
            'X-Master-Key': SYNC_KEY,
          },
        });
        
        if (getResponse.ok) {
          const responseText = await getResponse.text();
          try {
            const getResult = JSON.parse(responseText);
            if (getResult.record) {
              if (Array.isArray(getResult.record)) {
                remoteData = getResult.record;
              } else if (typeof getResult.record === 'string') {
                try {
                  const parsed = JSON.parse(getResult.record);
                  remoteData = Array.isArray(parsed) ? parsed : [];
                } catch {
                  remoteData = [];
                }
              }
            }
            console.log(`[INSTANT SYNC] ${endpoint}: Got ${remoteData.length} items from server`);
          } catch {
            console.error(`[INSTANT SYNC] ${endpoint}: Failed to parse server response`);
          }
        } else {
          console.log(`[INSTANT SYNC] ${endpoint}: Server fetch failed ${getResponse.status}`);
        }
      } catch (fetchError) {
        console.error(`[INSTANT SYNC] ${endpoint}: Error fetching from server:`, fetchError);
      }
    } else {
      console.log(`[INSTANT SYNC] ${endpoint}: No bin ID yet, will create after merge`);
    }
    
    // Step 2: Merge
    console.log(`[INSTANT SYNC] ${endpoint}: Step 2 - Merging ${localData.length} local with ${remoteData.length} remote items...`);
    const merged = mergeData(localData, remoteData);
    console.log(`[INSTANT SYNC] ${endpoint}: Merged result: ${merged.length} items`);
    
    const currentDeviceId = await getDeviceId();
    const dataWithMetadata = merged.map(item => ({
      ...item,
      updatedAt: item.updatedAt || Date.now(),
      deviceId: currentDeviceId,
    }));
    const cleanedData = cleanDataForSync(dataWithMetadata);
    
    // Step 3: Upload
    if (!binId) {
      if (isProtected && !isDefaultAdminDevice) {
        console.log(`[INSTANT SYNC] ${endpoint}: Skip creating bin for protected endpoint from non-admin device`);
        return cleanedData as T[];
      }
      console.log(`[INSTANT SYNC] ${endpoint}: Step 3 - Creating new bin...`);
      const createResponse = await fetch(JSONBIN_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': SYNC_KEY,
        },
        body: JSON.stringify(cleanedData),
      });
      
      if (createResponse.ok) {
        const createResult = await createResponse.json();
        const newBinId: string = createResult.metadata.id;
        if (newBinId && typeof newBinId === 'string') {
          binId = newBinId;
          await setBinId(endpoint, newBinId);
          console.log(`[INSTANT SYNC] ${endpoint}: Created bin ${binId}`);
        } else {
          console.log(`[INSTANT SYNC] ${endpoint}: No bin ID in response`);
          return cleanedData as T[];
        }
      } else {
        console.log(`[INSTANT SYNC] ${endpoint}: Failed to create bin`);
        return cleanedData as T[];
      }
    } else {
      if (isProtected && !isDefaultAdminDevice) {
        console.log(`[INSTANT SYNC] ${endpoint}: Protected endpoint, skipping remote update`);
        return cleanedData as T[];
      }

      console.log(`[INSTANT SYNC] ${endpoint}: Step 3 - Uploading ${cleanedData.length} merged items...`);
      const updateResponse = await fetch(`${JSONBIN_BASE_URL}/${binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': SYNC_KEY,
        },
        body: JSON.stringify(cleanedData),
      });
      
      if (!updateResponse.ok) {
        console.error(`[INSTANT SYNC] ${endpoint}: Failed to update remote ${updateResponse.status}`);
      } else {
        console.log(`[INSTANT SYNC] ${endpoint}: Successfully uploaded ${cleanedData.length} items`);
      }
    }
    
    console.log(`[INSTANT SYNC] ${endpoint}: Success - fetch, merge, upload complete`);
    return cleanedData as T[];
  } catch (error) {
    console.error(`[INSTANT SYNC] ${endpoint}: Failed`, error);
    return localData;
  }
}

export async function backgroundSync<T extends { id: string; updatedAt?: number }>(
  endpoint: string,
  userId?: string,
  options?: { isDefaultAdminDevice?: boolean }
): Promise<T[] | null> {
  console.log(`[BACKGROUND SYNC] ${endpoint}: Starting...`);
  
  if (!SYNC_KEY && !FILE_SYNC_BASE) {
    console.log(`[BACKGROUND SYNC] ${endpoint}: No sync configured`);
    return null;
  }

  try {
    if (FILE_SYNC_BASE) {
      const url = FILE_SYNC_BASE.replace(/\/$/, '') + `/get.php?endpoint=${encodeURIComponent(endpoint)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        console.error(`[BACKGROUND SYNC] ${endpoint}: File-sync get failed ${res.status}`);
        return null;
      }
      
      const responseText = await res.text();
      try {
        const data = JSON.parse(responseText);
        console.log(`[BACKGROUND SYNC] ${endpoint}: Got ${Array.isArray(data) ? data.length : 0} items`);
        return Array.isArray(data) ? (data as T[]) : null;
      } catch {
        console.error(`[BACKGROUND SYNC] ${endpoint}: Invalid JSON response`);
        return null;
      }
    }

    const binId = await getBinId(endpoint);
    if (!binId) {
      console.log(`[BACKGROUND SYNC] ${endpoint}: No bin ID`);
      return null;
    }

    console.log(`[BACKGROUND SYNC] ${endpoint}: Fetching from remote...`);
    const getResponse = await fetch(`${JSONBIN_BASE_URL}/${binId}/latest`, {
      headers: {
        'X-Master-Key': SYNC_KEY,
      },
    });
    
    if (!getResponse.ok) {
      console.log(`[BACKGROUND SYNC] ${endpoint}: Failed to fetch ${getResponse.status}`);
      return null;
    }
    
    const responseText = await getResponse.text();
    let getResult: any;
    try {
      getResult = JSON.parse(responseText);
    } catch {
      console.error(`[BACKGROUND SYNC] ${endpoint}: Failed to parse response`);
      return null;
    }
    
    let remoteData: any[] = [];
    if (getResult.record) {
      if (Array.isArray(getResult.record)) {
        remoteData = getResult.record;
      } else if (typeof getResult.record === 'string') {
        try {
          const parsed = JSON.parse(getResult.record);
          remoteData = Array.isArray(parsed) ? parsed : [];
        } catch {
          console.log(`[BACKGROUND SYNC] ${endpoint}: Remote data corrupted`);
          remoteData = [];
        }
      }
    }
    
    console.log(`[BACKGROUND SYNC] ${endpoint}: Got ${remoteData.length} items from remote`);
    return remoteData as T[];
  } catch (error) {
    console.error(`[BACKGROUND SYNC] ${endpoint}: Failed`, error);
    return null;
  }
}

export async function clearSyncData(endpoint: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${BIN_ID_KEY}_${endpoint}`);
    console.log(`Cleared sync data for ${endpoint}`);
  } catch (error) {
    console.error(`Failed to clear sync data for ${endpoint}:`, error);
  }
}

export async function clearAllSyncData(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const binKeys = allKeys.filter(key => key.startsWith(BIN_ID_KEY) || key === CENTRAL_BIN_MAP_KEY);
    await AsyncStorage.multiRemove(binKeys);
    centralBinMap = null;
    console.log('Cleared all sync data');
  } catch (error) {
    console.error('Failed to clear all sync data:', error);
  }
}

export async function clearDeviceId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
    deviceId = null;
    console.log('Cleared device id');
  } catch (error) {
    console.error('Failed to clear device id:', error);
  }
}

export async function importBinIds(binIds: Record<string, string>): Promise<void> {
  try {
    console.log('Importing bin IDs:', binIds);
    await setCentralBinMap(binIds);
    for (const [key, binId] of Object.entries(binIds)) {
      await AsyncStorage.setItem(`${BIN_ID_KEY}_${key}`, binId);
    }
    console.log('Bin IDs imported successfully');
  } catch (error) {
    console.error('Failed to import bin IDs:', error);
    throw error;
  }
}

export async function exportBinIds(): Promise<Record<string, string>> {
  try {
    console.log('exportBinIds: Starting export...');
    const centralMap = await getCentralBinMap();
    console.log('exportBinIds: Central map:', JSON.stringify(centralMap));
    
    const allKeys = await AsyncStorage.getAllKeys();
    console.log('exportBinIds: All storage keys count:', allKeys.length);
    
    const binKeys = allKeys.filter(key => key.startsWith(BIN_ID_KEY));
    console.log('exportBinIds: Found bin keys:', binKeys);
    
    const binIds: Record<string, string> = { ...centralMap };
    
    for (const key of binKeys) {
      const binId = await AsyncStorage.getItem(key);
      if (binId) {
        const endpoint = key.replace(`${BIN_ID_KEY}_`, '');
        binIds[endpoint] = binId;
        console.log(`exportBinIds: Found bin ID for ${endpoint}:`, binId.substring(0, 10) + '...');
      }
    }
    
    console.log('exportBinIds: Final bin IDs:', Object.keys(binIds));
    return binIds;
  } catch (error) {
    console.error('exportBinIds: Error:', error);
    return {};
  }
}

export async function syncData<T extends { id: string; updatedAt?: number }>(
  endpoint: string,
  localData: T[],
  userId?: string,
  options?: { isDefaultAdminDevice?: boolean }
): Promise<T[]> {
  return instantSync(endpoint, localData, userId, options);
}
