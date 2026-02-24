import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HRAttendanceImport, HRStaffMember } from '@/types';
import { syncData } from '@/utils/syncData';
import { createStaffFromPayrollTemplateRows, ParsedPayrollTemplateRow } from '@/utils/hrPayroll';

const HR_STAFF_KEY = '@hr_staff_members';
const HR_ATTENDANCE_IMPORTS_KEY = '@hr_attendance_imports';
const HR_QUOTA_RECOVERY_KEYS = [
  '@reconciliation_sales_reports',
  '@reconciliation_kitchen_stock_reports',
  '@stock_app_live_inventory_snapshots',
  '@stock_app_activity_logs',
] as const;

function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const lower = message.toLowerCase();
  return lower.includes('quota') || lower.includes('exceeded');
}

function compactStaffForStorage(rows: HRStaffMember[]): HRStaffMember[] {
  return rows.map((row) => {
    const compactDefaults: Record<string, string | number | null> = {};
    const defaults = row.payrollDefaults || {};
    Object.entries(defaults).forEach(([k, v]) => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string' && v.trim() === '') return;
      compactDefaults[k] = typeof v === 'string' ? v.trim() : v;
    });
    return {
      ...row,
      payrollDefaults: Object.keys(compactDefaults).length ? compactDefaults : undefined,
      notes: row.notes?.trim() || undefined,
    };
  });
}

async function clearQuotaRecoveryCaches() {
  for (const key of HR_QUOTA_RECOVERY_KEYS) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // best effort
    }
  }
}

type HRContextType = {
  staffMembers: HRStaffMember[];
  attendanceImports: HRAttendanceImport[];
  isLoading: boolean;
  isSyncing: boolean;
  addStaffMember: (input: Omit<HRStaffMember, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
  updateStaffMember: (id: string, updates: Partial<HRStaffMember>) => Promise<void>;
  deleteStaffMember: (id: string) => Promise<void>;
  importPayrollTemplateRows: (rows: ParsedPayrollTemplateRow[]) => Promise<number>;
  upsertAttendanceImport: (attendanceImport: HRAttendanceImport) => Promise<void>;
  deleteAttendanceImport: (id: string) => Promise<void>;
  getLatestAttendanceImportForMonth: (monthKey: string) => HRAttendanceImport | undefined;
  syncAll: (fetchOnly?: boolean) => Promise<void>;
};

const HRCtx = createContext<HRContextType | null>(null);

export function useHR() {
  const ctx = useContext(HRCtx);
  if (!ctx) throw new Error('useHR must be used within HRProvider');
  return ctx;
}

export function HRProvider({
  children,
  currentUser,
}: {
  children: ReactNode;
  currentUser: { id: string } | null;
}) {
  const [staffMembers, setStaffMembers] = useState<HRStaffMember[]>([]);
  const [attendanceImports, setAttendanceImports] = useState<HRAttendanceImport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgressRef = useRef(false);
  const initialFetchSyncedUserRef = useRef<string | null>(null);

  const loadLocal = useCallback(async () => {
    try {
      const [staffRaw, importsRaw] = await Promise.all([
        AsyncStorage.getItem(HR_STAFF_KEY),
        AsyncStorage.getItem(HR_ATTENDANCE_IMPORTS_KEY),
      ]);
      const parsedStaff: HRStaffMember[] = staffRaw ? JSON.parse(staffRaw) : [];
      const parsedImports: HRAttendanceImport[] = importsRaw ? JSON.parse(importsRaw) : [];
      setStaffMembers(parsedStaff.filter((s) => !s.deleted));
      setAttendanceImports(parsedImports.filter((i) => !i.deleted));
    } catch (error) {
      console.error('[HRContext] Failed to load local HR data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocal();
  }, [loadLocal]);

  const persistStaff = useCallback(async (allRows: HRStaffMember[]) => {
    const compactRows = compactStaffForStorage(allRows);
    const serialized = JSON.stringify(compactRows);
    try {
      await AsyncStorage.setItem(HR_STAFF_KEY, serialized);
      setStaffMembers(compactRows.filter((r) => !r.deleted));
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      console.warn('[HRContext] Staff storage exceeded quota, clearing temporary caches and retrying...');
    }

    await clearQuotaRecoveryCaches();

    try {
      await AsyncStorage.setItem(HR_STAFF_KEY, serialized);
      setStaffMembers(compactRows.filter((r) => !r.deleted));
      return;
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) throw retryError;
    }

    // Last resort: preserve core staff identity data without payroll defaults.
    const minimalRows = compactRows.map((row) => ({
      ...row,
      payrollDefaults: undefined,
    }));
    try {
      await AsyncStorage.setItem(HR_STAFF_KEY, JSON.stringify(minimalRows));
      setStaffMembers(minimalRows.filter((r) => !r.deleted));
      console.warn('[HRContext] Saved minimal staff cache without payrollDefaults due to storage quota');
      return;
    } catch (finalError) {
      if (isQuotaExceededError(finalError)) {
        throw new Error('Unable to save HR staff data locally because device storage is full. Run manual cleanup in Settings, then retry the payroll template import.');
      }
      throw finalError;
    }
  }, []);

  const persistAttendanceImports = useCallback(async (allRows: HRAttendanceImport[]) => {
    const sorted = [...allRows].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const tryWrite = async (rowsToWrite: HRAttendanceImport[]) => {
      await AsyncStorage.setItem(HR_ATTENDANCE_IMPORTS_KEY, JSON.stringify(rowsToWrite));
      setAttendanceImports(rowsToWrite.filter((r) => !r.deleted));
    };

    try {
      await tryWrite(sorted);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      console.warn('[HRContext] Attendance imports exceeded quota, trimming local HR attendance cache...');
    }

    await clearQuotaRecoveryCaches();

    const retentionSizes = [12, 6, 3, 2, 1];
    for (const keep of retentionSizes) {
      try {
        await tryWrite(sorted.slice(0, keep));
        return;
      } catch (retryError) {
        if (!isQuotaExceededError(retryError)) throw retryError;
      }
    }

    throw new Error('Unable to save fingerprint attendance import locally because device storage is full. Run manual cleanup in Settings, then retry.');
  }, []);

  const syncAll = useCallback(async (fetchOnly = false) => {
    if (!currentUser?.id || syncInProgressRef.current) return;
    try {
      syncInProgressRef.current = true;
      setIsSyncing(true);
      const [staffRaw, importsRaw] = await Promise.all([
        AsyncStorage.getItem(HR_STAFF_KEY),
        AsyncStorage.getItem(HR_ATTENDANCE_IMPORTS_KEY),
      ]);
      const localStaff: HRStaffMember[] = staffRaw ? JSON.parse(staffRaw) : [];
      const localImports: HRAttendanceImport[] = importsRaw ? JSON.parse(importsRaw) : [];

      const [syncedStaff, syncedImports] = await Promise.all([
        syncData<HRStaffMember>('hr_staff_members', localStaff, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRAttendanceImport>('hr_attendance_imports', localImports, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
      ]);

      await persistStaff(syncedStaff);
      await persistAttendanceImports(syncedImports);
    } catch (error) {
      console.error('[HRContext] Sync failed:', error);
    } finally {
      setIsSyncing(false);
      syncInProgressRef.current = false;
    }
  }, [currentUser, persistStaff, persistAttendanceImports]);

  useEffect(() => {
    const userId = currentUser?.id || null;
    if (!userId) {
      initialFetchSyncedUserRef.current = null;
      return;
    }
    if (initialFetchSyncedUserRef.current === userId) return;
    initialFetchSyncedUserRef.current = userId;
    syncAll(true);
  }, [currentUser?.id, syncAll]);

  const addStaffMember = useCallback(async (input: Omit<HRStaffMember, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
    if (!currentUser?.id) return;
    const now = Date.now();
    const newRow: HRStaffMember = {
      ...input,
      id: `hr-staff-${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUser.id,
      active: input.active ?? true,
    };
    const allRows = [...staffMembers, newRow];
    await persistStaff(allRows);
    await syncAll();
  }, [currentUser, staffMembers, persistStaff, syncAll]);

  const updateStaffMember = useCallback(async (id: string, updates: Partial<HRStaffMember>) => {
    const now = Date.now();
    const allRows = staffMembers.map((row) => row.id === id ? { ...row, ...updates, updatedAt: now } : row);
    await persistStaff(allRows);
    await syncAll();
  }, [staffMembers, persistStaff, syncAll]);

  const deleteStaffMember = useCallback(async (id: string) => {
    const now = Date.now();
    const allRows = staffMembers.map((row) => row.id === id ? { ...row, deleted: true, updatedAt: now } : row);
    await persistStaff(allRows);
    await syncAll();
  }, [staffMembers, persistStaff, syncAll]);

  const importPayrollTemplateRows = useCallback(async (rows: ParsedPayrollTemplateRow[]) => {
    if (!currentUser?.id) return 0;
    const merged = createStaffFromPayrollTemplateRows(rows, currentUser.id, staffMembers);
    await persistStaff(merged);
    await syncAll();
    return rows.length;
  }, [currentUser, staffMembers, persistStaff, syncAll]);

  const upsertAttendanceImport = useCallback(async (attendanceImport: HRAttendanceImport) => {
    const allExisting = [...attendanceImports];
    const existingIndex = allExisting.findIndex((r) => r.monthKey === attendanceImport.monthKey && !r.deleted);
    const now = Date.now();
    let merged: HRAttendanceImport[];
    if (existingIndex >= 0) {
      merged = [
        ...allExisting.slice(0, existingIndex),
        { ...attendanceImport, id: allExisting[existingIndex].id, updatedAt: now, createdAt: allExisting[existingIndex].createdAt, createdBy: allExisting[existingIndex].createdBy },
        ...allExisting.slice(existingIndex + 1),
      ];
    } else {
      merged = [...allExisting, attendanceImport];
    }
    await persistAttendanceImports(merged);
    await syncAll();
  }, [attendanceImports, persistAttendanceImports, syncAll]);

  const deleteAttendanceImport = useCallback(async (id: string) => {
    const now = Date.now();
    const merged = attendanceImports.map((row) => row.id === id ? { ...row, deleted: true, updatedAt: now } : row);
    await persistAttendanceImports(merged);
    await syncAll();
  }, [attendanceImports, persistAttendanceImports, syncAll]);

  const getLatestAttendanceImportForMonth = useCallback((monthKey: string) => {
    return [...attendanceImports]
      .filter((r) => !r.deleted && r.monthKey === monthKey)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }, [attendanceImports]);

  const value = useMemo<HRContextType>(() => ({
    staffMembers,
    attendanceImports,
    isLoading,
    isSyncing,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
    importPayrollTemplateRows,
    upsertAttendanceImport,
    deleteAttendanceImport,
    getLatestAttendanceImportForMonth,
    syncAll,
  }), [
    staffMembers,
    attendanceImports,
    isLoading,
    isSyncing,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
    importPayrollTemplateRows,
    upsertAttendanceImport,
    deleteAttendanceImport,
    getLatestAttendanceImportForMonth,
    syncAll,
  ]);

  return <HRCtx.Provider value={value}>{children}</HRCtx.Provider>;
}
