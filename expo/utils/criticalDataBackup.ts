import AsyncStorage from '@react-native-async-storage/async-storage';
import { writeAsStringAsync } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

type CriticalBackupReason = 'before_cleanup' | 'before_server_cleanup' | 'manual_export' | string;

type CriticalBackupPayload = {
  id: string;
  reason: CriticalBackupReason;
  createdAt: number;
  local: {
    stockChecks: any[];
    requests: any[];
    approvedRequests: any[];
  };
  server: {
    stockChecks: any[];
    requests: any[];
  };
};

export type CriticalBackupResult = {
  id: string;
  createdAt: number;
  fileName: string;
  fileUri?: string;
  localStockChecks: number;
  localRequests: number;
  localApprovedRequests: number;
  serverStockChecks: number;
  serverRequests: number;
};

const BACKUP_MANIFEST_KEY = '@critical_data_backups_manifest';
const BACKUP_RECORD_PREFIX = '@critical_data_backup_';
const STOCK_CHECKS_KEY = '@stock_app_stock_checks';
const REQUESTS_KEY = '@stock_app_requests';
const MAX_BACKUP_RECORDS = 10;

function createBackupId() {
  return `critical_${Date.now()}`;
}

function createFileName(id: string) {
  return `${id}.json`;
}

function safeParseArray(raw: string | null): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isApprovedRequest(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const status = String(item.status || item.requestStatus || '').toLowerCase();
  return item.approved === true || status === 'approved';
}

function isActiveRecord(item: any): boolean {
  return Boolean(item) && typeof item === 'object' && item.deleted !== true;
}

function getTrackerBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://tracker.tecclk.com';
}

async function fetchServerCollection(endpoint: string): Promise<any[]> {
  try {
    const response = await fetch(`${getTrackerBaseUrl()}/Tracker/api/get.php?endpoint=${encodeURIComponent(endpoint)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function buildBackupPayload(reason: CriticalBackupReason): Promise<CriticalBackupPayload> {
  const id = createBackupId();
  const createdAt = Date.now();
  const [stockChecksRaw, requestsRaw, serverStockChecks, serverRequests] = await Promise.all([
    AsyncStorage.getItem(STOCK_CHECKS_KEY),
    AsyncStorage.getItem(REQUESTS_KEY),
    fetchServerCollection('stockChecks'),
    fetchServerCollection('requests'),
  ]);

  const localStockChecks = safeParseArray(stockChecksRaw).filter(isActiveRecord);
  const localRequests = safeParseArray(requestsRaw).filter(isActiveRecord);
  const approvedRequests = localRequests.filter(isApprovedRequest);

  return {
    id,
    reason,
    createdAt,
    local: {
      stockChecks: localStockChecks,
      requests: localRequests,
      approvedRequests,
    },
    server: {
      stockChecks: serverStockChecks.filter(isActiveRecord),
      requests: serverRequests.filter(isActiveRecord),
    },
  };
}

async function persistBackup(payload: CriticalBackupPayload): Promise<void> {
  const manifestRaw = await AsyncStorage.getItem(BACKUP_MANIFEST_KEY);
  const manifest = safeParseArray(manifestRaw);
  const nextEntry = {
    id: payload.id,
    reason: payload.reason,
    createdAt: payload.createdAt,
    localStockChecks: payload.local.stockChecks.length,
    localRequests: payload.local.requests.length,
    localApprovedRequests: payload.local.approvedRequests.length,
    serverStockChecks: payload.server.stockChecks.length,
    serverRequests: payload.server.requests.length,
  };
  const nextManifest = [nextEntry, ...manifest].slice(0, MAX_BACKUP_RECORDS);

  await AsyncStorage.multiSet([
    [BACKUP_RECORD_PREFIX + payload.id, JSON.stringify(payload)],
    [BACKUP_MANIFEST_KEY, JSON.stringify(nextManifest)],
  ]);
}

function summarize(payload: CriticalBackupPayload, fileUri?: string): CriticalBackupResult {
  return {
    id: payload.id,
    createdAt: payload.createdAt,
    fileName: createFileName(payload.id),
    fileUri,
    localStockChecks: payload.local.stockChecks.length,
    localRequests: payload.local.requests.length,
    localApprovedRequests: payload.local.approvedRequests.length,
    serverStockChecks: payload.server.stockChecks.length,
    serverRequests: payload.server.requests.length,
  };
}

function downloadJson(fileName: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function saveAutomaticCriticalDataBackup(reason: CriticalBackupReason): Promise<CriticalBackupResult> {
  const payload = await buildBackupPayload(reason);
  await persistBackup(payload);
  return summarize(payload);
}

export async function exportCriticalDataBackup(reason: CriticalBackupReason): Promise<CriticalBackupResult> {
  const payload = await buildBackupPayload(reason);
  await persistBackup(payload);

  const fileName = createFileName(payload.id);
  const json = JSON.stringify(payload, null, 2);

  if (Platform.OS === 'web') {
    downloadJson(fileName, json);
    return summarize(payload);
  }

  const docDir = (FileSystem as any).documentDirectory;
  if (!docDir) {
    throw new Error('Document directory not available');
  }

  const fileUri = `${docDir}${fileName}`;
  await writeAsStringAsync(fileUri, json, { encoding: 'utf8' as any });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Export Critical Backup',
      UTI: 'public.json',
    });
  }

  return summarize(payload, fileUri);
}
