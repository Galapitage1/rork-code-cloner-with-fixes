import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  HRAttendanceImport,
  HRFingerprintPortalSettings,
  HRHolidayCalendarSettings,
  HRLoanRecord,
  HRPayrollManualEdit,
  HRPayrollMonthSheet,
  HRSecuritySettings,
  HRServiceChargeMonthEntry,
  HRServiceChargeSettings,
  HRStaffMember,
} from '@/types';
import { syncData } from '@/utils/syncData';
import { createStaffFromPayrollTemplateRows, ParsedPayrollTemplateRow } from '@/utils/hrPayroll';

const HR_STAFF_KEY = '@hr_staff_members';
const HR_ATTENDANCE_IMPORTS_KEY = '@hr_attendance_imports';
const HR_PAYROLL_SHEETS_KEY = '@hr_payroll_month_sheets';
const HR_SECURITY_SETTINGS_KEY = '@hr_security_settings';
const HR_FINGERPRINT_PORTAL_SETTINGS_KEY = '@hr_fingerprint_portal_settings';
const HR_HOLIDAY_CALENDAR_SETTINGS_KEY = '@hr_holiday_calendar_settings';
const HR_LOAN_RECORDS_KEY = '@hr_loan_records';
const HR_SERVICE_CHARGE_SETTINGS_KEY = '@hr_service_charge_settings';
const HR_SERVICE_CHARGE_MONTH_ENTRIES_KEY = '@hr_service_charge_month_entries';
const HR_QUOTA_RECOVERY_KEYS = [
  '@reconciliation_sales_reports',
  '@reconciliation_kitchen_stock_reports',
  '@stock_app_live_inventory_snapshots',
  '@stock_app_activity_logs',
] as const;

function hashSecretValue(input: string): string {
  const value = String(input || '').trim();
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return `hrh1_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

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

const PAYROLL_DERIVED_OVERRIDE_KEYS = new Set([
  'totalSalaryReceiving',
  'finalSalaryAfterReductions',
]);

function compactPayrollRowOverrides(
  rowOverrides: Record<string, Record<string, string | number | null>> | undefined,
): Record<string, Record<string, string | number | null>> | undefined {
  if (!rowOverrides) return undefined;
  const compacted: Record<string, Record<string, string | number | null>> = {};
  Object.entries(rowOverrides).forEach(([rowId, values]) => {
    if (!values || typeof values !== 'object') return;
    const nextValues: Record<string, string | number | null> = {};
    Object.entries(values).forEach(([key, value]) => {
      if (PAYROLL_DERIVED_OVERRIDE_KEYS.has(key)) return;
      if (value === null || value === undefined) return;
      if (typeof value === 'string' && value.trim() === '') return;
      nextValues[key] = typeof value === 'string' ? value.trim() : value;
    });
    if (Object.keys(nextValues).length > 0) {
      compacted[rowId] = nextValues;
    }
  });
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function compactPayrollSheetsForStorage(
  rows: HRPayrollMonthSheet[],
  options?: {
    maxManualEditsPerSheet?: number;
    stripEditComments?: boolean;
    maxDetailedMonths?: number;
  },
): HRPayrollMonthSheet[] {
  const maxManualEditsPerSheet = options?.maxManualEditsPerSheet;
  const stripEditComments = !!options?.stripEditComments;
  const maxDetailedMonths = options?.maxDetailedMonths;
  const monthOrder = [...rows]
    .filter((row) => !row.deleted && String(row.monthKey || '').trim())
    .map((row) => String(row.monthKey || '').trim())
    .sort((a, b) => b.localeCompare(a));
  const keepDetailed = maxDetailedMonths && maxDetailedMonths > 0
    ? new Set(monthOrder.slice(0, maxDetailedMonths))
    : null;

  return rows.map((row) => {
    const keepDetail = !keepDetailed || keepDetailed.has(String(row.monthKey || '').trim());
    const compactedOverrides = keepDetail ? compactPayrollRowOverrides(row.rowOverrides) : undefined;
    const sourceManualEdits = Array.isArray(row.manualEdits) ? row.manualEdits : [];
    const compactedManualEdits = keepDetail
      ? sourceManualEdits
          .map((edit) => ({
            ...edit,
            comment: stripEditComments ? undefined : (edit.comment ? String(edit.comment).slice(0, 120) : undefined),
          }))
      : [];
    const finalManualEdits = typeof maxManualEditsPerSheet === 'number' && maxManualEditsPerSheet >= 0
      ? compactedManualEdits.slice(-maxManualEditsPerSheet)
      : compactedManualEdits;

    return {
      ...row,
      rowOverrides: compactedOverrides,
      manualEdits: finalManualEdits.length ? finalManualEdits : undefined,
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
  payrollMonthSheets: HRPayrollMonthSheet[];
  securitySettings: HRSecuritySettings | null;
  fingerprintPortalSettings: HRFingerprintPortalSettings | null;
  holidayCalendarSettings: HRHolidayCalendarSettings | null;
  loanRecords: HRLoanRecord[];
  serviceChargeSettings: HRServiceChargeSettings | null;
  serviceChargeMonthEntries: HRServiceChargeMonthEntry[];
  hasSecuritySetup: boolean;
  hrSessionUnlocked: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  unlockHRSession: () => void;
  lockHRSession: () => void;
  addStaffMember: (input: Omit<HRStaffMember, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
  updateStaffMember: (id: string, updates: Partial<HRStaffMember>) => Promise<void>;
  deleteStaffMember: (id: string) => Promise<void>;
  importPayrollTemplateRows: (rows: ParsedPayrollTemplateRow[]) => Promise<number>;
  upsertAttendanceImport: (attendanceImport: HRAttendanceImport) => Promise<void>;
  deleteAttendanceImport: (id: string) => Promise<void>;
  getLatestAttendanceImportForMonth: (monthKey: string) => HRAttendanceImport | undefined;
  getPayrollSheetForMonth: (monthKey: string) => HRPayrollMonthSheet | undefined;
  canEditPayrollMonth: (monthKey: string, userId?: string | null) => boolean;
  setSecurityPasswords: (hrModulePassword: string, hrAuthorizerPassword: string) => Promise<void>;
  saveFingerprintPortalSettings: (input: {
    portalBaseUrl: string;
    corporateId: string;
    userName: string;
    password: string;
    monthlyReportPath?: string;
  }) => Promise<void>;
  saveHolidayCalendarSettings: (input: {
    calendarUrl?: string;
    holidays: Array<{
      id: string;
      name: string;
      date: string;
      getPaid: boolean;
      times: number;
    }>;
  }) => Promise<void>;
  saveLoanRecords: (input: Array<{
    id: string;
    name: string;
    loanDate: string;
    loanAmount: number;
    interestRate: number;
  }>) => Promise<void>;
  saveServiceChargeSettings: (input: Array<{
    id: string;
    outletName: string;
    percentToStaff: number;
    percentOther: number;
  }>) => Promise<void>;
  saveServiceChargeMonthEntry: (input: {
    monthKey: string;
    outletRows: Array<{
      id: string;
      outletName: string;
      serviceCharge: number;
    }>;
  }) => Promise<void>;
  applySalesServiceChargeCapture: (input: {
    outletName: string;
    date: string; // YYYY-MM-DD
    amount: number;
  }) => Promise<void>;
  getServiceChargeMonthEntry: (monthKey: string) => HRServiceChargeMonthEntry | undefined;
  verifyModulePassword: (password: string) => boolean;
  verifyAuthorizerPassword: (password: string) => boolean;
  markPayrollProcessed: (monthKey: string) => Promise<HRPayrollMonthSheet | undefined>;
  approveAndLockPayrollMonth: (monthKey: string) => Promise<HRPayrollMonthSheet | undefined>;
  unlockPayrollMonthForEditor: (
    monthKey: string,
    authorizerPassword: string
  ) => Promise<{ success: boolean; message?: string; sheet?: HRPayrollMonthSheet }>;
  savePayrollCellOverride: (params: {
    monthKey: string;
    rowId: string;
    columnKey: string;
    value: string | number | null;
    previousValue: string | number | null;
    comment?: string;
  }) => Promise<void>;
  savePayrollOverridesBatch: (params: {
    monthKey: string;
    updates: Array<{
      rowId: string;
      columnKey: string;
      value: string | number | null;
      previousValue: string | number | null;
      comment?: string;
    }>;
    replaceExisting?: boolean;
    importLabel?: string;
  }) => Promise<{ saved: number }>;
  clearPayrollColumnOverrides: (monthKey: string, columnKey: string) => Promise<{ cleared: number }>;
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
  const [payrollMonthSheets, setPayrollMonthSheets] = useState<HRPayrollMonthSheet[]>([]);
  const [securitySettings, setSecuritySettings] = useState<HRSecuritySettings | null>(null);
  const [fingerprintPortalSettings, setFingerprintPortalSettings] = useState<HRFingerprintPortalSettings | null>(null);
  const [holidayCalendarSettings, setHolidayCalendarSettings] = useState<HRHolidayCalendarSettings | null>(null);
  const [loanRecords, setLoanRecords] = useState<HRLoanRecord[]>([]);
  const [serviceChargeSettings, setServiceChargeSettings] = useState<HRServiceChargeSettings | null>(null);
  const [serviceChargeMonthEntries, setServiceChargeMonthEntries] = useState<HRServiceChargeMonthEntry[]>([]);
  const [hrSessionUnlocked, setHrSessionUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgressRef = useRef(false);
  const initialFetchSyncedUserRef = useRef<string | null>(null);
  const lastSessionUserIdRef = useRef<string | null>(null);

  const loadLocal = useCallback(async () => {
    try {
      const [staffRaw, importsRaw, payrollSheetsRaw, securityRaw, fingerprintPortalRaw, holidayCalendarRaw, loanRecordsRaw, serviceChargeSettingsRaw, serviceChargeMonthsRaw] = await Promise.all([
        AsyncStorage.getItem(HR_STAFF_KEY),
        AsyncStorage.getItem(HR_ATTENDANCE_IMPORTS_KEY),
        AsyncStorage.getItem(HR_PAYROLL_SHEETS_KEY),
        AsyncStorage.getItem(HR_SECURITY_SETTINGS_KEY),
        AsyncStorage.getItem(HR_FINGERPRINT_PORTAL_SETTINGS_KEY),
        AsyncStorage.getItem(HR_HOLIDAY_CALENDAR_SETTINGS_KEY),
        AsyncStorage.getItem(HR_LOAN_RECORDS_KEY),
        AsyncStorage.getItem(HR_SERVICE_CHARGE_SETTINGS_KEY),
        AsyncStorage.getItem(HR_SERVICE_CHARGE_MONTH_ENTRIES_KEY),
      ]);
      const parsedStaff: HRStaffMember[] = staffRaw ? JSON.parse(staffRaw) : [];
      const parsedImports: HRAttendanceImport[] = importsRaw ? JSON.parse(importsRaw) : [];
      const parsedPayrollSheets: HRPayrollMonthSheet[] = payrollSheetsRaw ? JSON.parse(payrollSheetsRaw) : [];
      const parsedSecurity = securityRaw ? JSON.parse(securityRaw) : null;
      const parsedFingerprintPortal = fingerprintPortalRaw ? JSON.parse(fingerprintPortalRaw) : null;
      const parsedHolidayCalendar = holidayCalendarRaw ? JSON.parse(holidayCalendarRaw) : null;
      const parsedLoanRecords: HRLoanRecord[] = loanRecordsRaw ? JSON.parse(loanRecordsRaw) : [];
      const parsedServiceChargeSettings = serviceChargeSettingsRaw ? JSON.parse(serviceChargeSettingsRaw) : null;
      const parsedServiceChargeMonths: HRServiceChargeMonthEntry[] = serviceChargeMonthsRaw ? JSON.parse(serviceChargeMonthsRaw) : [];
      setStaffMembers(parsedStaff.filter((s) => !s.deleted));
      setAttendanceImports(parsedImports.filter((i) => !i.deleted));
      setPayrollMonthSheets(parsedPayrollSheets.filter((s) => !s.deleted));
      setSecuritySettings(parsedSecurity && !parsedSecurity.deleted ? parsedSecurity : null);
      setFingerprintPortalSettings(parsedFingerprintPortal && !parsedFingerprintPortal.deleted ? parsedFingerprintPortal : null);
      setHolidayCalendarSettings(parsedHolidayCalendar && !parsedHolidayCalendar.deleted ? parsedHolidayCalendar : null);
      setLoanRecords(parsedLoanRecords.filter((item) => !item.deleted));
      setServiceChargeSettings(parsedServiceChargeSettings && !parsedServiceChargeSettings.deleted ? parsedServiceChargeSettings : null);
      setServiceChargeMonthEntries(parsedServiceChargeMonths.filter((item) => !item.deleted));
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

  const persistPayrollSheets = useCallback(async (allRows: HRPayrollMonthSheet[]) => {
    const normalized = [...allRows]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((row) => ({
        ...row,
        isLocked: !!row.isLocked,
        editingRestrictedToUserId: row.editingRestrictedToUserId || undefined,
      }));

    const attempts: Array<{
      label: string;
      maxManualEditsPerSheet?: number;
      stripEditComments?: boolean;
      maxDetailedMonths?: number;
    }> = [
      { label: 'full' },
      { label: 'trim-comments', stripEditComments: true, maxManualEditsPerSheet: 800 },
      { label: 'trim-manual-edits', stripEditComments: true, maxManualEditsPerSheet: 240 },
      { label: 'recent-18-detailed', stripEditComments: true, maxManualEditsPerSheet: 120, maxDetailedMonths: 18 },
      { label: 'recent-12-detailed', stripEditComments: true, maxManualEditsPerSheet: 80, maxDetailedMonths: 12 },
      { label: 'recent-6-detailed', stripEditComments: true, maxManualEditsPerSheet: 40, maxDetailedMonths: 6 },
    ];

    let lastQuotaError: unknown = null;
    for (const attempt of attempts) {
      const candidate = compactPayrollSheetsForStorage(normalized, {
        maxManualEditsPerSheet: attempt.maxManualEditsPerSheet,
        stripEditComments: attempt.stripEditComments,
        maxDetailedMonths: attempt.maxDetailedMonths,
      });
      try {
        await AsyncStorage.setItem(HR_PAYROLL_SHEETS_KEY, JSON.stringify(candidate));
        if (attempt.label !== 'full') {
          console.warn(`[HRContext] Payroll sheets exceeded storage quota, persisted compacted cache (${attempt.label}).`);
        }
        setPayrollMonthSheets(candidate.filter((r) => !r.deleted));
        return;
      } catch (error) {
        if (!isQuotaExceededError(error)) throw error;
        lastQuotaError = error;
      }
    }

    await clearQuotaRecoveryCaches();

    const emergency = compactPayrollSheetsForStorage(normalized, {
      maxManualEditsPerSheet: 20,
      stripEditComments: true,
      maxDetailedMonths: 3,
    });
    try {
      await AsyncStorage.setItem(HR_PAYROLL_SHEETS_KEY, JSON.stringify(emergency));
      setPayrollMonthSheets(emergency.filter((r) => !r.deleted));
      console.warn('[HRContext] Persisted emergency payroll cache (3 detailed months) due to storage quota.');
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      throw lastQuotaError || error;
    }
  }, []);

  const persistSecuritySettings = useCallback(async (settings: HRSecuritySettings | null) => {
    if (!settings || settings.deleted) {
      await AsyncStorage.removeItem(HR_SECURITY_SETTINGS_KEY);
      setSecuritySettings(null);
      return;
    }
    await AsyncStorage.setItem(HR_SECURITY_SETTINGS_KEY, JSON.stringify(settings));
    setSecuritySettings(settings);
  }, []);

  const persistFingerprintPortalSettings = useCallback(async (settings: HRFingerprintPortalSettings | null) => {
    if (!settings || settings.deleted) {
      await AsyncStorage.removeItem(HR_FINGERPRINT_PORTAL_SETTINGS_KEY);
      setFingerprintPortalSettings(null);
      return;
    }
    await AsyncStorage.setItem(HR_FINGERPRINT_PORTAL_SETTINGS_KEY, JSON.stringify(settings));
    setFingerprintPortalSettings(settings);
  }, []);

  const persistHolidayCalendarSettings = useCallback(async (settings: HRHolidayCalendarSettings | null) => {
    if (!settings || settings.deleted) {
      await AsyncStorage.removeItem(HR_HOLIDAY_CALENDAR_SETTINGS_KEY);
      setHolidayCalendarSettings(null);
      return;
    }
    await AsyncStorage.setItem(HR_HOLIDAY_CALENDAR_SETTINGS_KEY, JSON.stringify(settings));
    setHolidayCalendarSettings(settings);
  }, []);

  const persistLoanRecords = useCallback(async (rows: HRLoanRecord[]) => {
    const normalized = [...rows]
      .map((row) => ({
        ...row,
        name: String(row.name || '').trim(),
        loanDate: String(row.loanDate || '').trim(),
        loanAmount: Number.isFinite(Number(row.loanAmount)) ? Number(row.loanAmount) : 0,
        interestRate: Number.isFinite(Number(row.interestRate)) ? Number(row.interestRate) : 0,
      }))
      .filter((row) => row.name && row.loanDate)
      .sort((a, b) => (a.loanDate || '').localeCompare(b.loanDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
    await AsyncStorage.setItem(HR_LOAN_RECORDS_KEY, JSON.stringify(normalized));
    setLoanRecords(normalized.filter((row) => !row.deleted));
  }, []);

  const persistServiceChargeSettings = useCallback(async (settings: HRServiceChargeSettings | null) => {
    if (!settings || settings.deleted) {
      await AsyncStorage.removeItem(HR_SERVICE_CHARGE_SETTINGS_KEY);
      setServiceChargeSettings(null);
      return;
    }
    const normalized: HRServiceChargeSettings = {
      ...settings,
      outletOptions: [...(settings.outletOptions || [])]
        .map((row) => ({
          id: String(row.id || `hr-service-charge-outlet-${Math.random().toString(36).slice(2, 7)}`),
          outletName: String(row.outletName || '').trim(),
          percentToStaff: Number.isFinite(Number(row.percentToStaff)) ? Number(row.percentToStaff) : 0,
          percentOther: Number.isFinite(Number(row.percentOther)) ? Number(row.percentOther) : 0,
        }))
        .filter((row) => !!row.outletName)
        .sort((a, b) => a.outletName.localeCompare(b.outletName)),
    };
    await AsyncStorage.setItem(HR_SERVICE_CHARGE_SETTINGS_KEY, JSON.stringify(normalized));
    setServiceChargeSettings(normalized);
  }, []);

  const persistServiceChargeMonthEntries = useCallback(async (rows: HRServiceChargeMonthEntry[]) => {
    const normalized = [...rows]
      .map((row) => ({
        ...row,
        monthKey: String(row.monthKey || '').trim(),
        totalAvailableToStaff: Number.isFinite(Number(row.totalAvailableToStaff)) ? Number(row.totalAvailableToStaff) : 0,
        outletRows: [...(row.outletRows || [])]
          .map((outletRow) => ({
            id: String(outletRow.id || `hr-service-charge-month-${Math.random().toString(36).slice(2, 7)}`),
            outletName: String(outletRow.outletName || '').trim(),
            serviceCharge: Number.isFinite(Number(outletRow.serviceCharge)) ? Number(outletRow.serviceCharge) : 0,
            availableToStaff: Number.isFinite(Number(outletRow.availableToStaff)) ? Number(outletRow.availableToStaff) : 0,
          }))
          .filter((outletRow) => !!outletRow.outletName),
        salesCaptures: [...(row.salesCaptures || [])]
          .map((capture) => ({
            id: String(capture.id || `hr-service-charge-capture-${Math.random().toString(36).slice(2, 7)}`),
            outletName: String(capture.outletName || '').trim(),
            date: String(capture.date || '').trim(),
            amount: Number.isFinite(Number(capture.amount)) ? Number(capture.amount) : 0,
            updatedAt: Number.isFinite(Number(capture.updatedAt)) ? Number(capture.updatedAt) : Date.now(),
            deleted: !!capture.deleted,
          }))
          .filter((capture) => !!capture.outletName && /^\d{4}-\d{2}-\d{2}$/.test(capture.date)),
      }))
      .filter((row) => !!row.monthKey)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey) || (b.updatedAt || 0) - (a.updatedAt || 0));
    await AsyncStorage.setItem(HR_SERVICE_CHARGE_MONTH_ENTRIES_KEY, JSON.stringify(normalized));
    setServiceChargeMonthEntries(normalized.filter((row) => !row.deleted));
  }, []);

  const syncAll = useCallback(async (fetchOnly = false) => {
    if (!currentUser?.id || syncInProgressRef.current) return;
    try {
      syncInProgressRef.current = true;
      setIsSyncing(true);
      const [staffRaw, importsRaw, payrollSheetsRaw, securityRaw, fingerprintPortalRaw, holidayCalendarRaw, loanRecordsRaw, serviceChargeSettingsRaw, serviceChargeMonthsRaw] = await Promise.all([
        AsyncStorage.getItem(HR_STAFF_KEY),
        AsyncStorage.getItem(HR_ATTENDANCE_IMPORTS_KEY),
        AsyncStorage.getItem(HR_PAYROLL_SHEETS_KEY),
        AsyncStorage.getItem(HR_SECURITY_SETTINGS_KEY),
        AsyncStorage.getItem(HR_FINGERPRINT_PORTAL_SETTINGS_KEY),
        AsyncStorage.getItem(HR_HOLIDAY_CALENDAR_SETTINGS_KEY),
        AsyncStorage.getItem(HR_LOAN_RECORDS_KEY),
        AsyncStorage.getItem(HR_SERVICE_CHARGE_SETTINGS_KEY),
        AsyncStorage.getItem(HR_SERVICE_CHARGE_MONTH_ENTRIES_KEY),
      ]);
      const localStaff: HRStaffMember[] = staffRaw ? JSON.parse(staffRaw) : [];
      const localImports: HRAttendanceImport[] = importsRaw ? JSON.parse(importsRaw) : [];
      const localPayrollSheets: HRPayrollMonthSheet[] = payrollSheetsRaw ? JSON.parse(payrollSheetsRaw) : [];
      const localSecuritySettings: HRSecuritySettings[] = securityRaw ? [JSON.parse(securityRaw)] : [];
      const localFingerprintPortalSettings: HRFingerprintPortalSettings[] = fingerprintPortalRaw ? [JSON.parse(fingerprintPortalRaw)] : [];
      const localHolidayCalendarSettings: HRHolidayCalendarSettings[] = holidayCalendarRaw ? [JSON.parse(holidayCalendarRaw)] : [];
      const localLoanRecords: HRLoanRecord[] = loanRecordsRaw ? JSON.parse(loanRecordsRaw) : [];
      const localServiceChargeSettings: HRServiceChargeSettings[] = serviceChargeSettingsRaw ? [JSON.parse(serviceChargeSettingsRaw)] : [];
      const localServiceChargeMonthEntries: HRServiceChargeMonthEntry[] = serviceChargeMonthsRaw ? JSON.parse(serviceChargeMonthsRaw) : [];

      const [syncedStaff, syncedImports, syncedPayrollSheets, syncedSecuritySettings, syncedFingerprintPortalSettings, syncedHolidayCalendarSettings, syncedLoanRecords, syncedServiceChargeSettings, syncedServiceChargeMonthEntries] = await Promise.all([
        syncData<HRStaffMember>('hr_staff_members', localStaff, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRAttendanceImport>('hr_attendance_imports', localImports, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRPayrollMonthSheet>('hr_payroll_month_sheets', localPayrollSheets, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRSecuritySettings>('hr_security_settings', localSecuritySettings, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRFingerprintPortalSettings>('hr_fingerprint_portal_settings', localFingerprintPortalSettings, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRHolidayCalendarSettings>('hr_holiday_calendar_settings', localHolidayCalendarSettings, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRLoanRecord>('hr_loan_records', localLoanRecords, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRServiceChargeSettings>('hr_service_charge_settings', localServiceChargeSettings, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
        syncData<HRServiceChargeMonthEntry>('hr_service_charge_month_entries', localServiceChargeMonthEntries, currentUser.id, { fetchOnly, includeDeleted: true, minDays: 3650 }),
      ]);

      await persistStaff(syncedStaff);
      await persistAttendanceImports(syncedImports);
      await persistPayrollSheets(syncedPayrollSheets);

      const latestSecurity = [...syncedSecuritySettings]
        .filter((item) => !item.deleted)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
      await persistSecuritySettings(latestSecurity);

      const latestFingerprintPortal = [...syncedFingerprintPortalSettings]
        .filter((item) => !item.deleted)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
      await persistFingerprintPortalSettings(latestFingerprintPortal);

      const latestHolidayCalendar = [...syncedHolidayCalendarSettings]
        .filter((item) => !item.deleted)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
      await persistHolidayCalendarSettings(latestHolidayCalendar);

      await persistLoanRecords(syncedLoanRecords);
      const latestServiceChargeSettings = [...syncedServiceChargeSettings]
        .filter((item) => !item.deleted)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
      await persistServiceChargeSettings(latestServiceChargeSettings);
      await persistServiceChargeMonthEntries(syncedServiceChargeMonthEntries);
    } catch (error) {
      console.error('[HRContext] Sync failed:', error);
    } finally {
      setIsSyncing(false);
      syncInProgressRef.current = false;
    }
  }, [
    currentUser,
    persistStaff,
    persistAttendanceImports,
    persistPayrollSheets,
    persistSecuritySettings,
    persistFingerprintPortalSettings,
    persistHolidayCalendarSettings,
    persistLoanRecords,
    persistServiceChargeSettings,
    persistServiceChargeMonthEntries,
  ]);

  useEffect(() => {
    const userId = currentUser?.id || null;
    if (lastSessionUserIdRef.current !== userId) {
      lastSessionUserIdRef.current = userId;
      setHrSessionUnlocked(false);
    }
    if (!userId) {
      initialFetchSyncedUserRef.current = null;
      return;
    }
    if (initialFetchSyncedUserRef.current === userId) return;
    initialFetchSyncedUserRef.current = userId;
    syncAll(true);
  }, [currentUser?.id, syncAll]);

  const unlockHRSession = useCallback(() => {
    setHrSessionUnlocked(true);
  }, []);

  const lockHRSession = useCallback(() => {
    setHrSessionUnlocked(false);
  }, []);

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

  const getPayrollSheetForMonth = useCallback((monthKey: string) => {
    return [...payrollMonthSheets]
      .filter((r) => !r.deleted && r.monthKey === monthKey)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }, [payrollMonthSheets]);

  const verifyModulePassword = useCallback((password: string) => {
    if (!securitySettings?.hrModulePasswordHash) return false;
    return hashSecretValue(password) === securitySettings.hrModulePasswordHash;
  }, [securitySettings]);

  const verifyAuthorizerPassword = useCallback((password: string) => {
    if (!securitySettings?.hrAuthorizerPasswordHash) return false;
    return hashSecretValue(password) === securitySettings.hrAuthorizerPasswordHash;
  }, [securitySettings]);

  const canEditPayrollMonth = useCallback((monthKey: string, userId?: string | null) => {
    const row = getPayrollSheetForMonth(monthKey);
    if (!row) return true;
    if (row.isLocked) return false;
    if (row.editingRestrictedToUserId && row.editingRestrictedToUserId !== (userId || '')) return false;
    return true;
  }, [getPayrollSheetForMonth]);

  const setSecurityPasswords = useCallback(async (hrModulePassword: string, hrAuthorizerPassword: string) => {
    if (!currentUser?.id) return;
    const modulePassword = String(hrModulePassword || '').trim();
    const authorizerPassword = String(hrAuthorizerPassword || '').trim();
    if (!modulePassword || !authorizerPassword) {
      throw new Error('Both HR Module Password and Authorizer Password are required.');
    }
    const now = Date.now();
    const nextSettings: HRSecuritySettings = {
      id: securitySettings?.id || 'hr_security_settings',
      hrModulePasswordHash: hashSecretValue(modulePassword),
      hrAuthorizerPasswordHash: hashSecretValue(authorizerPassword),
      createdAt: securitySettings?.createdAt || now,
      updatedAt: now,
      createdBy: securitySettings?.createdBy || currentUser.id,
      updatedBy: currentUser.id,
    };
    await persistSecuritySettings(nextSettings);
    await syncAll();
  }, [currentUser, persistSecuritySettings, securitySettings, syncAll]);

  const saveFingerprintPortalSettings = useCallback(async (input: {
    portalBaseUrl: string;
    corporateId: string;
    userName: string;
    password: string;
    monthlyReportPath?: string;
  }) => {
    if (!currentUser?.id) return;
    const now = Date.now();
    const baseUrl = String(input.portalBaseUrl || '').trim() || 'https://www.onlineebiocloud.com';
    const corporateId = String(input.corporateId || '').trim();
    const userName = String(input.userName || '').trim();
    const password = String(input.password || '').trim();
    const monthlyReportPath = String(input.monthlyReportPath || '').trim();

    if (!corporateId || !userName || !password) {
      throw new Error('Corporate ID, User Name, and Password are required.');
    }

    const nextSettings: HRFingerprintPortalSettings = {
      id: fingerprintPortalSettings?.id || 'hr_fingerprint_portal_settings',
      portalBaseUrl: baseUrl.replace(/\/+$/, ''),
      corporateId,
      userName,
      password,
      monthlyReportPath: monthlyReportPath || undefined,
      createdAt: fingerprintPortalSettings?.createdAt || now,
      updatedAt: now,
      createdBy: fingerprintPortalSettings?.createdBy || currentUser.id,
      updatedBy: currentUser.id,
    };

    await persistFingerprintPortalSettings(nextSettings);
    await syncAll();
  }, [currentUser, fingerprintPortalSettings, persistFingerprintPortalSettings, syncAll]);

  const saveHolidayCalendarSettings = useCallback(async (input: {
    calendarUrl?: string;
    holidays: Array<{
      id: string;
      name: string;
      date: string;
      getPaid: boolean;
      times: number;
    }>;
  }) => {
    if (!currentUser?.id) return;
    const now = Date.now();
    const cleanedHolidays = (input.holidays || [])
      .filter((item) => String(item.name || '').trim() && String(item.date || '').trim())
      .map((item) => ({
        id: String(item.id || `hr-holiday-${item.date}-${Math.random().toString(36).slice(2, 8)}`),
        name: String(item.name || '').trim(),
        date: String(item.date || '').trim(),
        getPaid: !!item.getPaid,
        times: Number.isFinite(Number(item.times)) ? Number(item.times) : 1,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    const nextSettings: HRHolidayCalendarSettings = {
      id: holidayCalendarSettings?.id || 'hr_holiday_calendar_settings',
      calendarUrl: String(input.calendarUrl || '').trim() || undefined,
      holidays: cleanedHolidays,
      createdAt: holidayCalendarSettings?.createdAt || now,
      updatedAt: now,
      createdBy: holidayCalendarSettings?.createdBy || currentUser.id,
      updatedBy: currentUser.id,
    };
    await persistHolidayCalendarSettings(nextSettings);
    await syncAll();
  }, [currentUser, holidayCalendarSettings, persistHolidayCalendarSettings, syncAll]);

  const saveLoanRecords = useCallback(async (input: Array<{
    id: string;
    name: string;
    loanDate: string;
    loanAmount: number;
    interestRate: number;
  }>) => {
    if (!currentUser?.id) return;
    const now = Date.now();
    const cleanedRows: HRLoanRecord[] = (input || [])
      .map((item, index) => ({
        id: String(item.id || `hr-loan-${now}-${index}-${Math.random().toString(36).slice(2, 7)}`),
        name: String(item.name || '').trim(),
        loanDate: String(item.loanDate || '').trim(),
        loanAmount: Number.isFinite(Number(item.loanAmount)) ? Number(item.loanAmount) : 0,
        interestRate: Number.isFinite(Number(item.interestRate)) ? Number(item.interestRate) : 0,
        createdAt: loanRecords.find((row) => row.id === item.id)?.createdAt || now + index,
        updatedAt: now + index,
        createdBy: loanRecords.find((row) => row.id === item.id)?.createdBy || currentUser.id,
        updatedBy: currentUser.id,
        deleted: false,
      }))
      .filter((item) => item.name && item.loanDate);

    const incomingIds = new Set(cleanedRows.map((row) => row.id));
    const deletedRows: HRLoanRecord[] = loanRecords
      .filter((row) => !row.deleted && !incomingIds.has(row.id))
      .map((row, index) => ({
        ...row,
        deleted: true,
        updatedAt: now + cleanedRows.length + index,
        updatedBy: currentUser.id,
      }));

    await persistLoanRecords([...cleanedRows, ...deletedRows]);
    await syncAll();
  }, [currentUser, loanRecords, persistLoanRecords, syncAll]);

  const saveServiceChargeSettings = useCallback(async (input: Array<{
    id: string;
    outletName: string;
    percentToStaff: number;
    percentOther: number;
  }>) => {
    if (!currentUser?.id) return;
    const now = Date.now();
    const cleanedOptions = (input || [])
      .map((item, idx) => ({
        id: String(item.id || `hr-service-charge-outlet-${now}-${idx}-${Math.random().toString(36).slice(2, 7)}`),
        outletName: String(item.outletName || '').trim(),
        percentToStaff: Number.isFinite(Number(item.percentToStaff)) ? Number(item.percentToStaff) : 0,
        percentOther: Number.isFinite(Number(item.percentOther)) ? Number(item.percentOther) : 0,
      }))
      .filter((item) => !!item.outletName)
      .sort((a, b) => a.outletName.localeCompare(b.outletName));

    const nextSettings: HRServiceChargeSettings = {
      id: serviceChargeSettings?.id || 'hr_service_charge_settings',
      outletOptions: cleanedOptions,
      createdAt: serviceChargeSettings?.createdAt || now,
      updatedAt: now,
      createdBy: serviceChargeSettings?.createdBy || currentUser.id,
      updatedBy: currentUser.id,
    };

    await persistServiceChargeSettings(nextSettings);
    await syncAll();
  }, [currentUser, persistServiceChargeSettings, serviceChargeSettings, syncAll]);

  const saveServiceChargeMonthEntry = useCallback(async (input: {
    monthKey: string;
    outletRows: Array<{
      id: string;
      outletName: string;
      serviceCharge: number;
    }>;
  }) => {
    if (!currentUser?.id) return;
    const monthKey = String(input.monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error('Month must be in YYYY-MM format.');
    }
    const now = Date.now();
    const optionsByOutletName = new Map(
      (serviceChargeSettings?.outletOptions || []).map((item) => [String(item.outletName || '').trim(), item] as const)
    );
    const cleanedRows = (input.outletRows || [])
      .map((item, idx) => {
        const outletName = String(item.outletName || '').trim();
        const serviceCharge = Number.isFinite(Number(item.serviceCharge)) ? Number(item.serviceCharge) : 0;
        const option = optionsByOutletName.get(outletName);
        const percentToStaff = Number.isFinite(Number(option?.percentToStaff)) ? Number(option?.percentToStaff) : 0;
        const availableToStaff = (serviceCharge * percentToStaff) / 100;
        return {
          id: String(item.id || `hr-service-charge-month-row-${monthKey}-${now}-${idx}`),
          outletName,
          serviceCharge,
          availableToStaff,
        };
      })
      .filter((item) => !!item.outletName)
      .sort((a, b) => a.outletName.localeCompare(b.outletName));
    const totalAvailableToStaff = cleanedRows.reduce((sum, row) => sum + row.availableToStaff, 0);

    const existing = serviceChargeMonthEntries.find((row) => !row.deleted && row.monthKey === monthKey);
    const nextEntry: HRServiceChargeMonthEntry = existing
      ? {
          ...existing,
          outletRows: cleanedRows,
          totalAvailableToStaff,
          updatedAt: now,
          updatedBy: currentUser.id,
        }
      : {
          id: `hr-service-charge-month-${monthKey}-${Math.random().toString(36).slice(2, 7)}`,
          monthKey,
          outletRows: cleanedRows,
          totalAvailableToStaff,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
        };
    const merged = existing
      ? serviceChargeMonthEntries.map((row) => (row.id === existing.id ? nextEntry : row))
      : [...serviceChargeMonthEntries, nextEntry];
    await persistServiceChargeMonthEntries(merged);
    await syncAll();
  }, [currentUser, persistServiceChargeMonthEntries, serviceChargeMonthEntries, serviceChargeSettings?.outletOptions, syncAll]);

  const applySalesServiceChargeCapture = useCallback(async (input: {
    outletName: string;
    date: string;
    amount: number;
  }) => {
    if (!currentUser?.id) return;
    const outletName = String(input.outletName || '').trim();
    const date = String(input.date || '').trim();
    const amount = Number.isFinite(Number(input.amount)) ? Number(input.amount) : 0;
    if (!outletName || !/^\d{4}-\d{2}-\d{2}$/.test(date) || amount < 0) {
      return;
    }

    const monthKey = date.slice(0, 7);
    const now = Date.now();
    const percentByOutlet = new Map(
      (serviceChargeSettings?.outletOptions || []).map((row) => [String(row.outletName || '').trim(), Number(row.percentToStaff) || 0] as const)
    );
    const percentToStaff = percentByOutlet.get(outletName) || 0;

    const existingMonth = serviceChargeMonthEntries.find((row) => !row.deleted && row.monthKey === monthKey);
    const captures = [...(existingMonth?.salesCaptures || [])];
    const existingCaptureIndex = captures.findIndex(
      (capture) => !capture.deleted && capture.outletName === outletName && capture.date === date
    );
    const previousCaptureAmount = existingCaptureIndex >= 0 ? Number(captures[existingCaptureIndex]?.amount || 0) : 0;
    const delta = amount - previousCaptureAmount;
    if (Math.abs(delta) < 1e-9) {
      return;
    }

    if (existingCaptureIndex >= 0) {
      captures[existingCaptureIndex] = {
        ...captures[existingCaptureIndex],
        amount,
        updatedAt: now,
        deleted: false,
      };
    } else {
      captures.push({
        id: `hr-service-charge-capture-${outletName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}`,
        outletName,
        date,
        amount,
        updatedAt: now,
      });
    }

    const outletRows = [...(existingMonth?.outletRows || [])];
    const rowIndex = outletRows.findIndex((row) => String(row.outletName || '').trim() === outletName);
    const currentServiceCharge = rowIndex >= 0 ? Number(outletRows[rowIndex]?.serviceCharge || 0) : 0;
    const nextServiceCharge = Math.max(0, currentServiceCharge + delta);
    const nextAvailableToStaff = (nextServiceCharge * percentToStaff) / 100;

    if (rowIndex >= 0) {
      outletRows[rowIndex] = {
        ...outletRows[rowIndex],
        serviceCharge: nextServiceCharge,
        availableToStaff: nextAvailableToStaff,
      };
    } else {
      outletRows.push({
        id: `hr-service-charge-month-row-${monthKey}-${outletName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        outletName,
        serviceCharge: nextServiceCharge,
        availableToStaff: nextAvailableToStaff,
      });
    }

    const totalAvailableToStaff = outletRows.reduce(
      (sum, row) => sum + (Number.isFinite(Number(row.availableToStaff)) ? Number(row.availableToStaff) : 0),
      0
    );

    const nextMonthEntry: HRServiceChargeMonthEntry = existingMonth
      ? {
          ...existingMonth,
          outletRows,
          salesCaptures: captures,
          totalAvailableToStaff,
          updatedAt: now,
          updatedBy: currentUser.id,
        }
      : {
          id: `hr-service-charge-month-${monthKey}-${Math.random().toString(36).slice(2, 7)}`,
          monthKey,
          outletRows,
          salesCaptures: captures,
          totalAvailableToStaff,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
        };

    const merged = existingMonth
      ? serviceChargeMonthEntries.map((row) => (row.id === existingMonth.id ? nextMonthEntry : row))
      : [...serviceChargeMonthEntries, nextMonthEntry];
    await persistServiceChargeMonthEntries(merged);
    await syncAll();
  }, [currentUser, persistServiceChargeMonthEntries, serviceChargeMonthEntries, serviceChargeSettings?.outletOptions, syncAll]);

  const getServiceChargeMonthEntry = useCallback((monthKey: string) => {
    return [...serviceChargeMonthEntries]
      .filter((row) => !row.deleted && row.monthKey === monthKey)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }, [serviceChargeMonthEntries]);

  const markPayrollProcessed = useCallback(async (monthKey: string) => {
    if (!currentUser?.id) return undefined;
    const key = String(monthKey || '').trim();
    if (!key) return undefined;
    const now = Date.now();
    const existing = getPayrollSheetForMonth(key);
    const next: HRPayrollMonthSheet = existing
      ? {
          ...existing,
          processedAt: now,
          processedBy: currentUser.id,
          updatedAt: now,
        }
      : {
          id: `hr-payroll-${key}-${Math.random().toString(36).slice(2, 7)}`,
          monthKey: key,
          processedAt: now,
          processedBy: currentUser.id,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          isLocked: false,
        };
    const merged = existing
      ? payrollMonthSheets.map((row) => (row.id === existing.id ? next : row))
      : [...payrollMonthSheets, next];
    await persistPayrollSheets(merged);
    await syncAll();
    return next;
  }, [currentUser, getPayrollSheetForMonth, payrollMonthSheets, persistPayrollSheets, syncAll]);

  const approveAndLockPayrollMonth = useCallback(async (monthKey: string) => {
    if (!currentUser?.id) return undefined;
    const key = String(monthKey || '').trim();
    if (!key) return undefined;
    const now = Date.now();
    const existing = getPayrollSheetForMonth(key);
    const next: HRPayrollMonthSheet = existing
      ? {
          ...existing,
          processedAt: existing.processedAt || now,
          processedBy: existing.processedBy || currentUser.id,
          approvedAt: now,
          approvedBy: currentUser.id,
          lockedAt: now,
          lockedBy: currentUser.id,
          isLocked: true,
          unlockedAt: undefined,
          unlockedBy: undefined,
          editingRestrictedToUserId: undefined,
          updatedAt: now,
        }
      : {
          id: `hr-payroll-${key}-${Math.random().toString(36).slice(2, 7)}`,
          monthKey: key,
          processedAt: now,
          processedBy: currentUser.id,
          approvedAt: now,
          approvedBy: currentUser.id,
          lockedAt: now,
          lockedBy: currentUser.id,
          isLocked: true,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
        };
    const merged = existing
      ? payrollMonthSheets.map((row) => (row.id === existing.id ? next : row))
      : [...payrollMonthSheets, next];
    await persistPayrollSheets(merged);
    await syncAll();
    return next;
  }, [currentUser, getPayrollSheetForMonth, payrollMonthSheets, persistPayrollSheets, syncAll]);

  const unlockPayrollMonthForEditor = useCallback(async (
    monthKey: string,
    authorizerPassword: string
  ) => {
    if (!currentUser?.id) return { success: false, message: 'Not logged in' };
    const key = String(monthKey || '').trim();
    if (!key) return { success: false, message: 'Invalid month key' };
    if (!verifyAuthorizerPassword(authorizerPassword)) {
      return { success: false, message: 'Authorizer password is incorrect.' };
    }
    const existing = getPayrollSheetForMonth(key);
    if (!existing) {
      return { success: false, message: 'No payroll month record found to unlock.' };
    }
    const now = Date.now();
    const next: HRPayrollMonthSheet = {
      ...existing,
      isLocked: false,
      unlockedAt: now,
      unlockedBy: currentUser.id,
      editingRestrictedToUserId: currentUser.id,
      updatedAt: now,
    };
    const merged = payrollMonthSheets.map((row) => (row.id === existing.id ? next : row));
    await persistPayrollSheets(merged);
    await syncAll();
    return { success: true, sheet: next };
  }, [
    currentUser,
    getPayrollSheetForMonth,
    payrollMonthSheets,
    persistPayrollSheets,
    syncAll,
    verifyAuthorizerPassword,
  ]);

  const savePayrollCellOverride = useCallback(async (params: {
    monthKey: string;
    rowId: string;
    columnKey: string;
    value: string | number | null;
    previousValue: string | number | null;
    comment?: string;
  }) => {
    if (!currentUser?.id) return;
    const monthKey = String(params.monthKey || '').trim();
    const rowId = String(params.rowId || '').trim();
    const columnKey = String(params.columnKey || '').trim();
    if (!monthKey || !rowId || !columnKey) return;

    const canEdit = canEditPayrollMonth(monthKey, currentUser.id);
    if (!canEdit) {
      throw new Error('Selected payroll month is locked or restricted for another authorizer.');
    }

    const now = Date.now();
    const existing = getPayrollSheetForMonth(monthKey);
    const baseRowOverrides = existing?.rowOverrides || {};
    const baseManualEdits = existing?.manualEdits || [];
    const rowOverrides = { ...baseRowOverrides };
    const currentRow = { ...(rowOverrides[rowId] || {}) };
    currentRow[columnKey] = params.value;
    rowOverrides[rowId] = currentRow;

    const editEntry: HRPayrollManualEdit = {
      id: `hr-manual-edit-${now}-${Math.random().toString(36).slice(2, 7)}`,
      monthKey,
      rowId,
      columnKey,
      previousValue: params.previousValue,
      nextValue: params.value,
      comment: params.comment?.trim().slice(0, 120) || undefined,
      editedAt: now,
      editedBy: currentUser.id,
    };

    const next: HRPayrollMonthSheet = existing
      ? {
          ...existing,
          rowOverrides,
          manualEdits: [...baseManualEdits, editEntry].slice(-1200),
          updatedAt: now,
        }
      : {
          id: `hr-payroll-${monthKey}-${Math.random().toString(36).slice(2, 7)}`,
          monthKey,
          rowOverrides,
          manualEdits: [editEntry],
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          isLocked: false,
          editingRestrictedToUserId: undefined,
        };

    const merged = existing
      ? payrollMonthSheets.map((row) => (row.id === existing.id ? next : row))
      : [...payrollMonthSheets, next];
    await persistPayrollSheets(merged);
    await syncAll();
  }, [
    canEditPayrollMonth,
    currentUser,
    getPayrollSheetForMonth,
    payrollMonthSheets,
    persistPayrollSheets,
    syncAll,
  ]);

  const savePayrollOverridesBatch = useCallback(async (params: {
    monthKey: string;
    updates: Array<{
      rowId: string;
      columnKey: string;
      value: string | number | null;
      previousValue: string | number | null;
      comment?: string;
    }>;
    replaceExisting?: boolean;
    importLabel?: string;
  }) => {
    if (!currentUser?.id) return { saved: 0 };
    const monthKey = String(params.monthKey || '').trim();
    if (!monthKey) return { saved: 0 };
    const updates = (params.updates || []).filter((item) =>
      item &&
      typeof item.rowId === 'string' &&
      item.rowId.trim() &&
      typeof item.columnKey === 'string' &&
      item.columnKey.trim()
    );
    if (!updates.length) return { saved: 0 };

    const canEdit = canEditPayrollMonth(monthKey, currentUser.id);
    if (!canEdit) {
      throw new Error('Selected payroll month is locked or restricted for another authorizer.');
    }

    const now = Date.now();
    const existing = getPayrollSheetForMonth(monthKey);
    const baseRowOverrides = params.replaceExisting ? {} : (existing?.rowOverrides || {});
    const rowOverrides = { ...baseRowOverrides } as Record<string, Record<string, string | number | null>>;
    const baseManualEdits = existing?.manualEdits || [];
    const criticalColumns = new Set(['extraOt', 'lateHours', 'otMerc', 'otPublic']);
    const historySource = updates.length > 600
      ? updates.filter((item) => criticalColumns.has(item.columnKey.trim()))
      : updates;
    const historyLimited = historySource.slice(-320);
    const editEntries: HRPayrollManualEdit[] = historyLimited.map((item, idx) => ({
      id: `hr-manual-edit-${now}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      monthKey,
      rowId: item.rowId.trim(),
      columnKey: item.columnKey.trim(),
      previousValue: item.previousValue,
      nextValue: item.value,
      comment: (item.comment?.trim() || params.importLabel || 'Batch override import').slice(0, 120),
      editedAt: now + idx,
      editedBy: currentUser.id,
    }));

    updates.forEach((item) => {
      const rowId = item.rowId.trim();
      const col = item.columnKey.trim();
      rowOverrides[rowId] = { ...(rowOverrides[rowId] || {}), [col]: item.value };
    });

    const next: HRPayrollMonthSheet = existing
      ? {
          ...existing,
          rowOverrides,
          manualEdits: [...baseManualEdits, ...editEntries].slice(-1000),
          updatedAt: now,
        }
      : {
          id: `hr-payroll-${monthKey}-${Math.random().toString(36).slice(2, 7)}`,
          monthKey,
          rowOverrides,
          manualEdits: editEntries,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          isLocked: false,
          editingRestrictedToUserId: undefined,
        };

    const merged = existing
      ? payrollMonthSheets.map((row) => (row.id === existing.id ? next : row))
      : [...payrollMonthSheets, next];
    await persistPayrollSheets(merged);
    await syncAll();
    return { saved: updates.length };
  }, [
    canEditPayrollMonth,
    currentUser,
    getPayrollSheetForMonth,
    payrollMonthSheets,
    persistPayrollSheets,
    syncAll,
  ]);

  const clearPayrollColumnOverrides = useCallback(async (monthKey: string, columnKey: string) => {
    if (!currentUser?.id) return { cleared: 0 };
    const key = String(monthKey || '').trim();
    const col = String(columnKey || '').trim();
    if (!key || !col) return { cleared: 0 };

    const canEdit = canEditPayrollMonth(key, currentUser.id);
    if (!canEdit) {
      throw new Error('Selected payroll month is locked or restricted for another authorizer.');
    }

    const existing = getPayrollSheetForMonth(key);
    if (!existing?.rowOverrides) return { cleared: 0 };

    const now = Date.now();
    let cleared = 0;
    const nextOverrides: Record<string, Record<string, string | number | null>> = {};
    Object.entries(existing.rowOverrides || {}).forEach(([rowId, rowValues]) => {
      const rowCopy = { ...(rowValues || {}) };
      if (Object.prototype.hasOwnProperty.call(rowCopy, col)) {
        delete rowCopy[col];
        cleared += 1;
      }
      if (Object.keys(rowCopy).length > 0) {
        nextOverrides[rowId] = rowCopy;
      }
    });

    if (cleared <= 0) return { cleared: 0 };

    const next: HRPayrollMonthSheet = {
      ...existing,
      rowOverrides: nextOverrides,
      updatedAt: now,
    };
    const merged = payrollMonthSheets.map((row) => (row.id === existing.id ? next : row));
    await persistPayrollSheets(merged);
    await syncAll();
    return { cleared };
  }, [
    canEditPayrollMonth,
    currentUser,
    getPayrollSheetForMonth,
    payrollMonthSheets,
    persistPayrollSheets,
    syncAll,
  ]);

  const value = useMemo<HRContextType>(() => ({
    staffMembers,
    attendanceImports,
    payrollMonthSheets,
    securitySettings,
    fingerprintPortalSettings,
    holidayCalendarSettings,
    loanRecords,
    serviceChargeSettings,
    serviceChargeMonthEntries,
    hrSessionUnlocked,
    hasSecuritySetup: !!securitySettings?.hrModulePasswordHash && !!securitySettings?.hrAuthorizerPasswordHash,
    isLoading,
    isSyncing,
    unlockHRSession,
    lockHRSession,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
    importPayrollTemplateRows,
    upsertAttendanceImport,
    deleteAttendanceImport,
    getLatestAttendanceImportForMonth,
    getPayrollSheetForMonth,
    canEditPayrollMonth,
    setSecurityPasswords,
    saveFingerprintPortalSettings,
    saveHolidayCalendarSettings,
    saveLoanRecords,
    saveServiceChargeSettings,
    saveServiceChargeMonthEntry,
    applySalesServiceChargeCapture,
    getServiceChargeMonthEntry,
    verifyModulePassword,
    verifyAuthorizerPassword,
    markPayrollProcessed,
    approveAndLockPayrollMonth,
    unlockPayrollMonthForEditor,
    savePayrollCellOverride,
    savePayrollOverridesBatch,
    clearPayrollColumnOverrides,
    syncAll,
  }), [
    staffMembers,
    attendanceImports,
    payrollMonthSheets,
    securitySettings,
    fingerprintPortalSettings,
    holidayCalendarSettings,
    loanRecords,
    serviceChargeSettings,
    serviceChargeMonthEntries,
    hrSessionUnlocked,
    isLoading,
    isSyncing,
    unlockHRSession,
    lockHRSession,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
    importPayrollTemplateRows,
    upsertAttendanceImport,
    deleteAttendanceImport,
    getLatestAttendanceImportForMonth,
    getPayrollSheetForMonth,
    canEditPayrollMonth,
    setSecurityPasswords,
    saveFingerprintPortalSettings,
    saveHolidayCalendarSettings,
    saveLoanRecords,
    saveServiceChargeSettings,
    saveServiceChargeMonthEntry,
    applySalesServiceChargeCapture,
    getServiceChargeMonthEntry,
    verifyModulePassword,
    verifyAuthorizerPassword,
    markPayrollProcessed,
    approveAndLockPayrollMonth,
    unlockPayrollMonthForEditor,
    savePayrollCellOverride,
    savePayrollOverridesBatch,
    clearPayrollColumnOverrides,
    syncAll,
  ]);

  return <HRCtx.Provider value={value}>{children}</HRCtx.Provider>;
}
