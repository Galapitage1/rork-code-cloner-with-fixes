import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, FileSpreadsheet, Upload, Users, CalendarDays, Clock3, Download, RefreshCw, Trash2, ChevronLeft, ChevronRight, ShieldCheck, Lock, LockOpen, Unlock, KeyRound, Settings } from 'lucide-react-native';
import * as XLSX from 'xlsx';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useLeave } from '@/contexts/LeaveContext';
import { useHR } from '@/contexts/HRContext';
import {
  buildAttendanceImport,
  createAttendanceImportSummaryText,
  formatMonthKey,
  generatePayrollRowsForMonth,
  parseFingerprintAttendanceWorkbook,
  PAYROLL_COLUMNS,
  minutesToDecimalHours,
} from '@/utils/hrPayroll';

const PAYROLL_YELLOW_EDITABLE_KEYS = new Set<string>([
  'hoursWorked',
  'hoursDays',
  'extraOt',
  'lateHours',
]);

const PAYROLL_GREY_EDITABLE_KEYS = new Set<string>([
  'advance',
  'otherReduction',
  'reductionReason',
  'loans',
  'serviceChargeReduction',
  'bonus',
  'overtimeExtraDays',
]);

const RATE_COLUMN_KEYS = new Set<string>([
  'basicRatePerHr',
  'fullRatePerHr',
]);

const PAYROLL_TEXT_COLUMN_KEYS = new Set<string>([
  'fullName',
  'userName',
  'employeeCode',
  'position',
  'epfNumber',
  'month',
  'remarks',
  'reductionReason',
]);

const PAYROLL_READ_ONLY_FORMULA_KEYS = new Set<string>([
  'totalSalaryReceiving',
  'finalSalaryAfterReductions',
]);

const PAYROLL_UNEDITABLE_KEYS = new Set<string>([
  ...PAYROLL_READ_ONLY_FORMULA_KEYS,
  'totalSalary',
  'overTime',
]);

const PAYROLL_HIGHLIGHT_EDIT_KEYS = new Set<string>([
  'extraOt',
  'lateHours',
  'otMerc',
  'otPublic',
]);

function normalizeMonthKeyInput(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return trimmed;
  return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr || '', 10);
  const month = parseInt(monthStr || '', 10);
  if (!year || !month) return currentMonthKey();
  const dt = new Date(Date.UTC(year, month - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + delta);
  return dt.toISOString().slice(0, 7);
}

function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_RORK_API_BASE_URL) {
    const envBase = String(process.env.EXPO_PUBLIC_RORK_API_BASE_URL).trim().replace(/\/+$/, '');
    if (envBase) return envBase;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const originBase = String(window.location.origin).trim().replace(/\/+$/, '');
    if (originBase) return originBase;
  }
  return 'https://tracker.tecclk.com';
}

function monthKeyToDateRange(monthKey: string): { fromDate: string; toDate: string } {
  const match = String(monthKey || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    const now = new Date();
    const fallbackMonthKey = now.toISOString().slice(0, 7);
    return monthKeyToDateRange(fallbackMonthKey);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const format = (date: Date) => {
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  };
  return {
    fromDate: format(start),
    toDate: format(end),
  };
}

function normalizeLooseText(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._:/()-]+/g, '');
}

function buildPayrollLookupKey(userName?: string, fullName?: string): string {
  const userKey = normalizeLooseText(userName || '');
  if (userKey) return userKey;
  return normalizeLooseText(fullName || '');
}

function parseImportedCellValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return Math.round(num);
  }
  return text;
}

function roundToWholeNumber(value: number): number {
  return Math.round(value || 0);
}

function parseLooseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const num = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : null;
}

function isNumericPayrollColumn(columnKey: string): boolean {
  return !PAYROLL_TEXT_COLUMN_KEYS.has(columnKey);
}

function formatPayrollDisplayValue(columnKey: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (!isNumericPayrollColumn(columnKey)) return String(value);
  const num = parseLooseNumber(value);
  if (num === null) return String(value);
  return String(roundToWholeNumber(num));
}

function toNumberOrZero(value: string | number | null | undefined): number {
  const parsed = parseLooseNumber(value);
  return parsed === null ? 0 : parsed;
}

function computeTotalSalaryByEmploymentType(
  employmentType: 'Full-Time' | 'Part-Time',
  values: {
    basic?: string | number | null;
    performanceAllowance?: string | number | null;
    attendanceAllowance?: string | number | null;
    overTime?: string | number | null;
    serviceChargeEarning?: string | number | null;
    epfEmployer?: string | number | null;
    etfEmployer?: string | number | null;
  },
): number {
  const performance = toNumberOrZero(values.performanceAllowance);
  if (employmentType === 'Part-Time') {
    return roundToWholeNumber(performance);
  }
  return roundToWholeNumber(
    toNumberOrZero(values.basic) +
    performance +
    toNumberOrZero(values.attendanceAllowance) +
    toNumberOrZero(values.overTime) +
    toNumberOrZero(values.serviceChargeEarning) +
    toNumberOrZero(values.epfEmployer) +
    toNumberOrZero(values.etfEmployer)
  );
}

const PAYROLL_FIRST_COLUMN_LEFT = 0;
const PAYROLL_SECOND_COLUMN_LEFT = 260; // Full Name column width

function getPayrollStickyCellStyle(columnIndex: number, isHeader = false) {
  if (Platform.OS !== 'web') return null;
  const baseHeaderStyle = isHeader ? { top: 0 } : null;
  if (columnIndex === 0) {
    return {
      position: 'sticky',
      left: PAYROLL_FIRST_COLUMN_LEFT,
      zIndex: isHeader ? 70 : 40,
      ...baseHeaderStyle,
      backgroundColor: isHeader ? '#DBEAFE' : '#FFFFFF',
      borderRightWidth: 1,
      borderRightColor: '#E2E8F0',
    } as any;
  }
  if (columnIndex === 1) {
    return {
      position: 'sticky',
      left: PAYROLL_SECOND_COLUMN_LEFT,
      zIndex: isHeader ? 69 : 39,
      ...baseHeaderStyle,
      backgroundColor: isHeader ? '#DBEAFE' : '#FFFFFF',
      borderRightWidth: 1,
      borderRightColor: '#E2E8F0',
    } as any;
  }
  return null;
}

function getPayrollHistoryColumnStyle(columnIndex: number, columnKey: string) {
  const oneBased = columnIndex + 1;
  if (columnKey === 'totalSalary') return 'green';
  if (columnIndex === 0) return 'blue';
  if (columnKey === 'hoursPerDay') return 'yellow';
  if ((oneBased >= 2 && oneBased <= 8) || (oneBased >= 12 && oneBased <= 19)) return 'yellow';
  return null;
}

export default function HRScreen() {
  const router = useRouter();
  const { currentUser, isSuperAdmin, isAdmin } = useAuth();
  const { leaveRequests, leaveTypes } = useLeave();
  const {
    staffMembers,
    attendanceImports,
    payrollMonthSheets,
    loanRecords,
    fingerprintPortalSettings,
    holidayCalendarSettings,
    hasSecuritySetup,
    hrSessionUnlocked,
    isLoading,
    isSyncing,
    upsertAttendanceImport,
    getLatestAttendanceImportForMonth,
    getPayrollSheetForMonth,
    canEditPayrollMonth,
    saveFingerprintPortalSettings,
    verifyModulePassword,
    markPayrollProcessed,
    approveAndLockPayrollMonth,
    unlockPayrollMonthForEditor,
    savePayrollCellOverride,
    savePayrollOverridesBatch,
    clearPayrollColumnOverrides,
    deleteAttendanceImport,
    getServiceChargeMonthEntry,
    syncAll,
    unlockHRSession,
  } = useHR();

  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(currentMonthKey());
  const [isImportingAttendance, setIsImportingAttendance] = useState(false);
  const [hrLoginPassword, setHrLoginPassword] = useState('');
  const [unlockPasswordInput, setUnlockPasswordInput] = useState('');
  const [isMonthActionRunning, setIsMonthActionRunning] = useState(false);
  const [payrollCellDrafts, setPayrollCellDrafts] = useState<Record<string, string>>({});
  const [selectedPayslipRowId, setSelectedPayslipRowId] = useState<string>('');
  const [printAllPayslips, setPrintAllPayslips] = useState(false);
  const [isExportingPayroll, setIsExportingPayroll] = useState(false);
  const [isImportingPayrollSheet, setIsImportingPayrollSheet] = useState(false);
  const [showAttendanceTable, setShowAttendanceTable] = useState(false);
  const [showPayrollHistoryMonths, setShowPayrollHistoryMonths] = useState(false);
  const [payrollSearchInput, setPayrollSearchInput] = useState('');
  const [appliedPayrollSearch, setAppliedPayrollSearch] = useState('');
  const [showFingerprintSettings, setShowFingerprintSettings] = useState(false);
  const [fingerprintPortalBaseUrlInput, setFingerprintPortalBaseUrlInput] = useState('https://www.onlineebiocloud.com');
  const [fingerprintCorporateIdInput, setFingerprintCorporateIdInput] = useState('');
  const [fingerprintUserNameInput, setFingerprintUserNameInput] = useState('');
  const [fingerprintPasswordInput, setFingerprintPasswordInput] = useState('');
  const [fingerprintMonthlyReportPathInput, setFingerprintMonthlyReportPathInput] = useState('NewMonthly.aspx');
  const [showFingerprintPassword, setShowFingerprintPassword] = useState(false);
  const [isSavingFingerprintSettings, setIsSavingFingerprintSettings] = useState(false);
  const [isPullingFingerprintReport, setIsPullingFingerprintReport] = useState(false);

  const monthOptions = useMemo(() => {
    const set = new Set<string>([currentMonthKey(), selectedMonthKey]);
    attendanceImports.forEach((item) => item.monthKey && set.add(item.monthKey));
    payrollMonthSheets.forEach((item) => item.monthKey && set.add(item.monthKey));
    leaveRequests.forEach((req) => {
      if (req.startDate) set.add(req.startDate.slice(0, 7));
      if (req.endDate) set.add(req.endDate.slice(0, 7));
    });
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
  }, [attendanceImports, payrollMonthSheets, leaveRequests, selectedMonthKey]);

  const isHRUnlocked = !hasSecuritySetup || hrSessionUnlocked;

  const selectedAttendanceImport = useMemo(
    () => getLatestAttendanceImportForMonth(selectedMonthKey),
    [getLatestAttendanceImportForMonth, selectedMonthKey]
  );
  const selectedPayrollSheet = useMemo(
    () => getPayrollSheetForMonth(selectedMonthKey),
    [getPayrollSheetForMonth, selectedMonthKey]
  );
  const selectedServiceChargeMonthEntry = useMemo(
    () => getServiceChargeMonthEntry(selectedMonthKey),
    [getServiceChargeMonthEntry, selectedMonthKey]
  );
  const monthIsLocked = !!selectedPayrollSheet?.isLocked;
  const monthCanEdit = canEditPayrollMonth(selectedMonthKey, currentUser?.id);
  const monthRestrictedByAuthorizer =
    !monthIsLocked &&
    !!selectedPayrollSheet?.editingRestrictedToUserId &&
    selectedPayrollSheet.editingRestrictedToUserId !== currentUser?.id;
  const disableSelectedMonthEdits = monthIsLocked || monthRestrictedByAuthorizer || !monthCanEdit;

  const payrollRows = useMemo(() => generatePayrollRowsForMonth({
    monthKey: selectedMonthKey,
    staffMembers,
    attendanceImport: selectedAttendanceImport,
    leaveRequests,
    leaveTypes,
  }), [selectedMonthKey, staffMembers, selectedAttendanceImport, leaveRequests, leaveTypes]);

  const payrollRowsWithOverrides = useMemo(() => {
    const rowOverrides = selectedPayrollSheet?.rowOverrides || {};
    return payrollRows.map((row) => {
      const rowOverrideValues = rowOverrides[row.id] || {};
      const values: Record<string, string | number | null> = {
        ...row.values,
        ...rowOverrideValues,
      };

      PAYROLL_COLUMNS.forEach((column) => {
        if (!isNumericPayrollColumn(column.key)) return;
        const parsed = parseLooseNumber(values[column.key]);
        if (parsed !== null) {
          values[column.key] = roundToWholeNumber(parsed);
        }
      });

      const fullRate = toNumberOrZero(values.fullRatePerHr);
      const basicRate = toNumberOrZero(values.basicRatePerHr);

      if (!Object.prototype.hasOwnProperty.call(rowOverrideValues, 'extraOt')) {
        const overtimeHours = minutesToDecimalHours(row.meta.overtimeMinutes || 0, 3);
        values.extraOt = roundToWholeNumber(overtimeHours * fullRate);
      }
      if (!Object.prototype.hasOwnProperty.call(rowOverrideValues, 'lateHours')) {
        const lateHours = minutesToDecimalHours(row.meta.lateMinutes || 0, 3);
        values.lateHours = roundToWholeNumber(lateHours * fullRate);
      }
      if (!Object.prototype.hasOwnProperty.call(rowOverrideValues, 'otMerc')) {
        const holidayMercHours = minutesToDecimalHours(row.meta.holidayMercMinutes || 0, 3);
        values.otMerc = roundToWholeNumber(holidayMercHours * basicRate);
      }
      if (!Object.prototype.hasOwnProperty.call(rowOverrideValues, 'otPublic')) {
        const holidayPublicHours = minutesToDecimalHours(row.meta.holidayPublicMinutes || 0, 3);
        values.otPublic = roundToWholeNumber(holidayPublicHours * basicRate);
      }
      if (!Object.prototype.hasOwnProperty.call(rowOverrideValues, 'sickUnauthorizedLeave')) {
        const unpaidLeaveDays = row.meta.unpaidLeaveDays || 0;
        values.sickUnauthorizedLeave = roundToWholeNumber(unpaidLeaveDays * fullRate * toNumberOrZero(values.hoursPerDay));
      }
      const isPartTime = row.meta.employmentType === 'Part-Time';
      if (isPartTime) {
        values.performanceAllowance = roundToWholeNumber(toNumberOrZero(values.hoursWorked) * 176.8);
      }
      values.totalSalary = computeTotalSalaryByEmploymentType(
        isPartTime ? 'Part-Time' : 'Full-Time',
        values
      );
      if (!Object.prototype.hasOwnProperty.call(rowOverrideValues, 'remarks')) {
        const holidayMercHours = minutesToDecimalHours(row.meta.holidayMercMinutes || 0, 3);
        const holidayPublicHours = minutesToDecimalHours(row.meta.holidayPublicMinutes || 0, 3);
        values.remarks = `OT Merc Hrs:${holidayMercHours.toFixed(2)} | OT Public Hrs:${holidayPublicHours.toFixed(2)}`;
      }

      const totalSalaryReceivingRaw =
        toNumberOrZero(values.totalSalary) +
        toNumberOrZero(values.extraOt) +
        toNumberOrZero(values.overtimeExtraDays) +
        toNumberOrZero(values.otMerc) +
        toNumberOrZero(values.otPublic) +
        toNumberOrZero(values.serviceChargeReduction) +
        toNumberOrZero(values.bonus);
      values.totalSalaryReceiving = roundToWholeNumber(totalSalaryReceivingRaw);

      const finalSalaryRaw =
        toNumberOrZero(values.totalSalaryReceiving) -
        (
          toNumberOrZero(values.epfEmployee) +
          toNumberOrZero(values.advance) +
          toNumberOrZero(values.otherReduction) +
          toNumberOrZero(values.loans) +
          toNumberOrZero(values.sickUnauthorizedLeave) +
          toNumberOrZero(values.lateHours)
        );
      values.finalSalaryAfterReductions = roundToWholeNumber(finalSalaryRaw);

      return {
        ...row,
        values,
      };
    });
  }, [payrollRows, selectedPayrollSheet?.rowOverrides]);

  const totalServiceChargeAvailableForMonth = useMemo(
    () => roundToWholeNumber(toNumberOrZero(selectedServiceChargeMonthEntry?.totalAvailableToStaff)),
    [selectedServiceChargeMonthEntry?.totalAvailableToStaff]
  );

  const totalAssignedServiceChargeLive = useMemo(() => {
    if (!payrollRowsWithOverrides.length) return 0;
    return roundToWholeNumber(
      payrollRowsWithOverrides.reduce((sum, row) => {
        const draftKey = `${row.id}::serviceChargeReduction`;
        const draftValue = payrollCellDrafts[draftKey];
        const effective = draftValue !== undefined ? draftValue : row.values.serviceChargeReduction;
        return sum + toNumberOrZero(effective);
      }, 0)
    );
  }, [payrollRowsWithOverrides, payrollCellDrafts]);

  const remainingServiceChargeBalance = useMemo(
    () => roundToWholeNumber(totalServiceChargeAvailableForMonth - totalAssignedServiceChargeLive),
    [totalAssignedServiceChargeLive, totalServiceChargeAvailableForMonth]
  );

  const filteredPayrollRows = useMemo(() => {
    const normalizedQuery = normalizeLooseText(appliedPayrollSearch);
    if (!normalizedQuery) return payrollRowsWithOverrides;
    return payrollRowsWithOverrides.filter((row) => {
      const fullName = normalizeLooseText(String(row.values.fullName || ''));
      const userName = normalizeLooseText(String(row.values.userName || ''));
      const position = normalizeLooseText(String(row.values.position || ''));
      return fullName.includes(normalizedQuery) || userName.includes(normalizedQuery) || position.includes(normalizedQuery);
    });
  }, [appliedPayrollSearch, payrollRowsWithOverrides]);

  const payrollManualEdits = useMemo(
    () => [...(selectedPayrollSheet?.manualEdits || [])].sort((a, b) => b.editedAt - a.editedAt),
    [selectedPayrollSheet?.manualEdits]
  );
  const criticalEditedCellKeys = useMemo(() => {
    const keys = new Set<string>();
    payrollManualEdits.forEach((item) => {
      if (!PAYROLL_HIGHLIGHT_EDIT_KEYS.has(item.columnKey)) return;
      keys.add(`${item.rowId}::${item.columnKey}`);
    });
    return keys;
  }, [payrollManualEdits]);
  const payrollMonthHistory = useMemo(
    () =>
      [...payrollMonthSheets]
        .filter((item) => !item.deleted)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [payrollMonthSheets]
  );

  const payrollLoanPendingByLookupKey = useMemo(() => {
    const lookupByAnyKey = new Map<string, string>();
    const activeStaffLookupKeys = new Set<string>();
    const staffLookupById = new Map<string, string>();
    staffMembers
      .filter((staff) => !staff.deleted)
      .forEach((staff) => {
        const userName = String(staff.userName || '').trim();
        const fullName = String(staff.fullName || '').trim();
        const lookupKey = buildPayrollLookupKey(userName, fullName);
        if (!lookupKey) return;
        const userKey = normalizeLooseText(userName);
        const fullKey = normalizeLooseText(fullName);
        if (userKey) lookupByAnyKey.set(userKey, lookupKey);
        if (fullKey) lookupByAnyKey.set(fullKey, lookupKey);
        lookupByAnyKey.set(lookupKey, lookupKey);
        staffLookupById.set(String(staff.id || '').trim(), lookupKey);
        if (staff.active !== false) {
          activeStaffLookupKeys.add(lookupKey);
        }
      });

    const resolveLookupKey = (primary?: string, secondary?: string): string => {
      const candidates = [primary, secondary];
      for (const candidate of candidates) {
        const normalized = normalizeLooseText(candidate || '');
        if (!normalized) continue;
        const mapped = lookupByAnyKey.get(normalized);
        if (mapped) return mapped;
      }
      return normalizeLooseText(primary || secondary || '');
    };

    const principalByLookupKey = new Map<string, number>();
    loanRecords
      .filter((loan) => !loan.deleted)
      .forEach((loan) => {
        const lookupKey = resolveLookupKey(loan.name, loan.name);
        if (!lookupKey || !activeStaffLookupKeys.has(lookupKey)) return;
        const principal = toNumberOrZero(loan.loanAmount);
        const apr = toNumberOrZero(loan.interestRate);
        const total = principal + (principal * apr) / 100;
        if (total <= 0) return;
        principalByLookupKey.set(lookupKey, (principalByLookupKey.get(lookupKey) || 0) + total);
      });

    const latestAttendanceByMonth = new Map<string, ReturnType<typeof attendanceImports.slice>[number]>();
    attendanceImports
      .filter((item) => !item.deleted)
      .forEach((item) => {
        const existing = latestAttendanceByMonth.get(item.monthKey);
        if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
          latestAttendanceByMonth.set(item.monthKey, item);
        }
      });

    const payrollRowIdentityLookupKeyMap = new Map<string, string>();
    payrollMonthSheets
      .filter((sheet) => !sheet.deleted)
      .forEach((sheet) => {
        const attendanceImport = latestAttendanceByMonth.get(sheet.monthKey);
        const generated = generatePayrollRowsForMonth({
          monthKey: sheet.monthKey,
          staffMembers,
          attendanceImport,
          leaveRequests,
          leaveTypes,
        });
        generated.forEach((row) => {
          const rowLookupKey = resolveLookupKey(
            String(row.values.userName || '').trim(),
            String(row.values.fullName || '').trim()
          );
          if (rowLookupKey) {
            payrollRowIdentityLookupKeyMap.set(`${sheet.monthKey}::${row.id}`, rowLookupKey);
          }
        });
      });

    const resolveRowLookupKey = (
      monthKey: string,
      rowId: string,
      rowValues: Record<string, string | number | null> | undefined
    ): string => {
      const overrideLookup = resolveLookupKey(
        String(rowValues?.userName || '').trim(),
        String(rowValues?.fullName || '').trim()
      );
      if (overrideLookup) return overrideLookup;

      const prefix = `payroll-${monthKey}-`;
      if (!rowId.startsWith(prefix)) {
        return payrollRowIdentityLookupKeyMap.get(`${monthKey}::${rowId}`) || '';
      }
      const suffix = rowId.slice(prefix.length);
      if (suffix.startsWith('att-')) {
        const attRowId = suffix.slice(4);
        const attImport = latestAttendanceByMonth.get(monthKey);
        const attRow = attImport?.rows?.find((row) => row.id === attRowId);
        return resolveLookupKey('', String(attRow?.employeeName || '').trim());
      }
      const staffLookup = staffLookupById.get(suffix);
      if (staffLookup) return staffLookup;
      return payrollRowIdentityLookupKeyMap.get(`${monthKey}::${rowId}`) || '';
    };

    const deductionsByLookupKey = new Map<string, number>();
    payrollMonthSheets
      .filter((sheet) => !sheet.deleted)
      .forEach((sheet) => {
        Object.entries(sheet.rowOverrides || {}).forEach(([rowId, values]) => {
          const amount = toNumberOrZero(values?.loans);
          if (amount <= 0) return;
          const lookupKey = resolveRowLookupKey(sheet.monthKey, rowId, values as Record<string, string | number | null>);
          if (!lookupKey) return;
          deductionsByLookupKey.set(lookupKey, (deductionsByLookupKey.get(lookupKey) || 0) + amount);
        });
      });

    const pendingByLookupKey = new Map<string, number>();
    principalByLookupKey.forEach((principalTotal, lookupKey) => {
      const deducted = deductionsByLookupKey.get(lookupKey) || 0;
      const pending = Math.max(0, principalTotal - deducted);
      if (pending > 0) {
        pendingByLookupKey.set(lookupKey, pending);
      }
    });

    return pendingByLookupKey;
  }, [attendanceImports, leaveRequests, leaveTypes, loanRecords, payrollMonthSheets, staffMembers]);

  const kpis = useMemo(() => {
    const matched = payrollRowsWithOverrides.filter((r) => r.meta.attendanceMatched).length;
    const approvedLeaveDays = payrollRowsWithOverrides.reduce((sum, r) => sum + r.meta.approvedLeaveDays, 0);
    const totalLateHours = payrollRowsWithOverrides.reduce((sum, r) => sum + minutesToDecimalHours(r.meta.lateMinutes, 3), 0);
    const totalOtHours = payrollRowsWithOverrides.reduce((sum, r) => sum + minutesToDecimalHours(r.meta.overtimeMinutes, 3), 0);
    return { matched, approvedLeaveDays, totalLateHours, totalOtHours };
  }, [payrollRowsWithOverrides]);

  const attendanceUnpaidLeaveByRowId = useMemo(() => {
    const byRow = new Map<string, number>();
    payrollRows.forEach((row) => {
      if (!row.meta.attendanceRowId) return;
      byRow.set(row.meta.attendanceRowId, row.meta.unpaidLeaveDays || 0);
    });
    return byRow;
  }, [payrollRows]);

  const approvedLeaveThisMonth = useMemo(() => {
    const monthStart = `${selectedMonthKey}-01`;
    const [y, m] = selectedMonthKey.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
    return leaveRequests.filter((r) => {
      if (r.deleted || r.status !== 'approved') return false;
      return !(r.endDate < monthStart || r.startDate > monthEnd);
    });
  }, [leaveRequests, selectedMonthKey]);

  useEffect(() => {
    if (!fingerprintPortalSettings) return;
    setFingerprintPortalBaseUrlInput(String(fingerprintPortalSettings.portalBaseUrl || '').trim() || 'https://www.onlineebiocloud.com');
    setFingerprintCorporateIdInput(String(fingerprintPortalSettings.corporateId || '').trim());
    setFingerprintUserNameInput(String(fingerprintPortalSettings.userName || '').trim());
    setFingerprintPasswordInput(String(fingerprintPortalSettings.password || '').trim());
    setFingerprintMonthlyReportPathInput(String(fingerprintPortalSettings.monthlyReportPath || '').trim() || 'NewMonthly.aspx');
  }, [fingerprintPortalSettings]);

  useEffect(() => {
    if (!payrollRowsWithOverrides.length) {
      setSelectedPayslipRowId('');
      return;
    }
    if (!selectedPayslipRowId || !payrollRowsWithOverrides.some((row) => row.id === selectedPayslipRowId)) {
      setSelectedPayslipRowId(payrollRowsWithOverrides[0].id);
    }
  }, [payrollRowsWithOverrides, selectedPayslipRowId]);

  const handlePickAndParseWorkbook = async (onWorkbook: (wb: XLSX.WorkBook, fileName: string) => Promise<void> | void) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      Alert.alert('Not Supported', 'Excel import is currently supported on web in this HR module.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) {
        document.body.removeChild(input);
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        await onWorkbook(wb, file.name);
      } catch (error) {
        console.error('[HR] Excel import failed:', error);
        Alert.alert('Import Error', (error as Error).message || 'Failed to read Excel file');
      } finally {
        document.body.removeChild(input);
      }
    };
    input.click();
  };

  const handleImportFingerprintAttendance = async () => {
    if (!currentUser?.id) return;
    if (disableSelectedMonthEdits) {
      Alert.alert('Month Locked', 'This payroll month is locked or restricted to another authorizer and cannot be edited.');
      return;
    }
    setIsImportingAttendance(true);
    await handlePickAndParseWorkbook(async (wb, fileName) => {
      const parsed = parseFingerprintAttendanceWorkbook(wb as any, XLSX, {
        holidayCalendarSettings,
      });
      const importPayload = buildAttendanceImport(parsed, currentUser.id, fileName);
      await upsertAttendanceImport(importPayload);
      setSelectedMonthKey(parsed.monthKey);
      Alert.alert(
        'Fingerprint Attendance Imported',
        `Month: ${parsed.monthLabel}\nRows: ${importPayload.rows.length}\n\nThe payroll sheet can now calculate lateness, OT and leave matching for this month.`
      );
    });
    setIsImportingAttendance(false);
  };

  const handleSaveFingerprintSettings = async () => {
    if (!currentUser?.id) return;
    setIsSavingFingerprintSettings(true);
    try {
      await saveFingerprintPortalSettings({
        portalBaseUrl: fingerprintPortalBaseUrlInput,
        corporateId: fingerprintCorporateIdInput,
        userName: fingerprintUserNameInput,
        password: fingerprintPasswordInput,
        monthlyReportPath: fingerprintMonthlyReportPathInput,
      });
      Alert.alert('Saved', 'Fingerprint login settings saved and synced to server.');
    } catch (error) {
      Alert.alert('Save Failed', (error as Error).message || 'Failed to save fingerprint login settings.');
    } finally {
      setIsSavingFingerprintSettings(false);
    }
  };

  const handlePullFingerprintReport = async () => {
    if (!currentUser?.id) return;
    if (disableSelectedMonthEdits) {
      Alert.alert('Month Locked', 'This payroll month is locked or restricted to another authorizer and cannot be edited.');
      return;
    }
    const corporateId = fingerprintCorporateIdInput.trim();
    const userName = fingerprintUserNameInput.trim();
    const password = fingerprintPasswordInput.trim();
    if (!corporateId || !userName || !password) {
      Alert.alert('Missing Settings', 'Save fingerprint login settings first (Corporate ID, User Name, Password).');
      setShowFingerprintSettings(true);
      return;
    }

    setIsPullingFingerprintReport(true);
    try {
      await saveFingerprintPortalSettings({
        portalBaseUrl: fingerprintPortalBaseUrlInput,
        corporateId,
        userName,
        password,
        monthlyReportPath: fingerprintMonthlyReportPathInput,
      });

      const { fromDate, toDate } = monthKeyToDateRange(selectedMonthKey);
      const endpoint = `${getApiBaseUrl()}/Tracker/api/hr-fingerprint-monthly-report.php`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          portalBaseUrl: fingerprintPortalBaseUrlInput.trim() || 'https://www.onlineebiocloud.com',
          corporateId,
          userName,
          password,
          monthlyReportPath: fingerprintMonthlyReportPathInput.trim() || 'NewMonthly.aspx',
          monthKey: selectedMonthKey,
          fromDate,
          toDate,
        }),
      });

      const rawBody = await response.text();
      let data: any = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        throw new Error(`Server returned non-JSON response (HTTP ${response.status}).`);
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error ||
          data?.message ||
          `Failed to pull report (HTTP ${response.status}).`
        );
      }

      const pulledRows = Array.isArray(data.rows) ? data.rows : [];
      if (!pulledRows.length) {
        throw new Error('No attendance rows returned by portal for selected month.');
      }

      const pulledMonthKey = normalizeMonthKeyInput(String(data.monthKey || selectedMonthKey));
      const parsed: ReturnType<typeof parseFingerprintAttendanceWorkbook> = {
        monthKey: pulledMonthKey,
        monthLabel: String(data.monthLabel || formatMonthKey(pulledMonthKey)),
        reportStartDate: String(data.reportStartDate || '').trim() || undefined,
        reportEndDate: String(data.reportEndDate || '').trim() || undefined,
        sourceSheetName: String(data.sourceSheetName || 'OnlineBioCloud Pull'),
        rows: pulledRows,
      };
      const importPayload = buildAttendanceImport(parsed, currentUser.id, `Pulled-${pulledMonthKey}.xls`);
      await upsertAttendanceImport(importPayload);
      setSelectedMonthKey(pulledMonthKey);

      Alert.alert(
        'Fingerprint Report Pulled',
        `Month: ${parsed.monthLabel}\nRows: ${importPayload.rows.length}\n\nAttendance was imported from OnlineBioCloud.`
      );
    } catch (error) {
      Alert.alert('Pull Failed', (error as Error).message || 'Failed to pull monthly fingerprint report.');
    } finally {
      setIsPullingFingerprintReport(false);
    }
  };

  const handleHRUnlock = () => {
    if (hasSecuritySetup && !verifyModulePassword(hrLoginPassword)) {
      Alert.alert('Access Denied', 'Invalid HR module password.');
      return;
    }
    unlockHRSession();
    setHrLoginPassword('');
  };

  const handleProcessMonth = async () => {
    if (!currentUser?.id) return;
    if (disableSelectedMonthEdits) {
      Alert.alert('Month Locked', 'This payroll month is locked or restricted to another authorizer.');
      return;
    }
    setIsMonthActionRunning(true);
    try {
      await markPayrollProcessed(selectedMonthKey);
      Alert.alert('Processed', `Payroll month ${formatMonthKey(selectedMonthKey)} marked as processed.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to mark payroll as processed.');
    } finally {
      setIsMonthActionRunning(false);
    }
  };

  const handleApproveAndLock = async () => {
    if (!currentUser?.id) return;
    if (!isAdmin) {
      Alert.alert('Access Denied', 'Only admins and super admins can approve and lock payroll months.');
      return;
    }
    setIsMonthActionRunning(true);
    try {
      await approveAndLockPayrollMonth(selectedMonthKey);
      setUnlockPasswordInput('');
      Alert.alert('Locked', `${formatMonthKey(selectedMonthKey)} is approved and locked.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to approve and lock payroll month.');
    } finally {
      setIsMonthActionRunning(false);
    }
  };

  const handleUnlockMonth = async () => {
    if (!currentUser?.id) return;
    if (!unlockPasswordInput.trim()) {
      Alert.alert('Missing Password', 'Enter authorizer password to unlock this month.');
      return;
    }
    setIsMonthActionRunning(true);
    try {
      const result = await unlockPayrollMonthForEditor(selectedMonthKey, unlockPasswordInput);
      if (!result.success) {
        Alert.alert('Unlock Failed', result.message || 'Could not unlock selected month.');
        return;
      }
      setUnlockPasswordInput('');
      Alert.alert('Unlocked', `Unlocked for editing by ${currentUser.username || currentUser.id} only.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to unlock payroll month.');
    } finally {
      setIsMonthActionRunning(false);
    }
  };

  const isPayrollCellEditable = (columnKey: string) => {
    if (PAYROLL_UNEDITABLE_KEYS.has(columnKey)) return false;
    return PAYROLL_YELLOW_EDITABLE_KEYS.has(columnKey) || PAYROLL_GREY_EDITABLE_KEYS.has(columnKey);
  };

  const parsePayrollCellValue = (columnKey: string, input: string, previousValue: string | number | null) => {
    const trimmed = input.trim();
    if (trimmed === '') return null;
    if (isNumericPayrollColumn(columnKey) || typeof previousValue === 'number' || RATE_COLUMN_KEYS.has(columnKey)) {
      const parsed = Number(trimmed.replace(/,/g, ''));
      return Number.isFinite(parsed) ? roundToWholeNumber(parsed) : trimmed;
    }
    return trimmed;
  };

  const handlePayrollCellBlur = async (params: {
    rowId: string;
    columnKey: string;
    draftValue: string;
    previousValue: string | number | null;
  }) => {
    if (!currentUser?.id) return;
    const draftKey = `${params.rowId}::${params.columnKey}`;
    const nextValue = parsePayrollCellValue(params.columnKey, params.draftValue, params.previousValue);
    const previousText = params.previousValue === null || params.previousValue === undefined ? '' : String(params.previousValue);
    const nextText = nextValue === null || nextValue === undefined ? '' : String(nextValue);
    if (previousText === nextText) {
      setPayrollCellDrafts((prev) => {
        const copy = { ...prev };
        delete copy[draftKey];
        return copy;
      });
      return;
    }

    const comment = `Edited ${params.columnKey}`;

    try {
      await savePayrollCellOverride({
        monthKey: selectedMonthKey,
        rowId: params.rowId,
        columnKey: params.columnKey,
        value: nextValue,
        previousValue: params.previousValue,
        comment,
      });
      setPayrollCellDrafts((prev) => {
        const copy = { ...prev };
        delete copy[draftKey];
        return copy;
      });
    } catch (error) {
      Alert.alert('Save Failed', (error as Error).message || 'Could not save payroll cell edit.');
    }
  };

  const escapeHtml = (input: string) =>
    input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const PAYSLIP_DOCUMENT_STYLES = `
    body { margin:0; background:#f1f5f9; font-family: Arial, sans-serif; }
    .sheet-wrap.page-break { page-break-after: always; }
    .sheet {
      width: 780px;
      margin: 20px auto;
      background:#fff;
      border:2px solid #222;
      color:#111;
    }
    .top { text-align:center; border-bottom:2px solid #222; padding:10px 20px 8px; }
    .logo {
      width: 150px;
      height: auto;
      object-fit: contain;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
      display:block;
      margin:0 auto 4px;
    }
    .company { font-size:12px; font-weight:700; margin:2px 0; }
    .address { font-size:12px; margin:2px 0; }
    .title { font-size:30px; font-weight:700; margin-top:4px; }
    .meta { padding:14px 26px 8px; font-size:13px; }
    .meta-row { margin:4px 0; }
    table { width: calc(100% - 52px); margin: 2px 26px 0; border-collapse: collapse; font-size:12px; }
    th, td { border:1px solid #222; padding:3px 6px; line-height:1.2; }
    th { background:#d6d6d6; text-align:left; }
    .amt { text-align:right; width:90px; }
    .wide { width:260px; }
    .highlight { background:#d6d6d6; font-weight:700; }
    .sig-wrap { display:flex; justify-content:space-between; gap:20px; padding:28px 26px 10px; font-size:12px; }
    .sig { width:46%; text-align:center; }
    .line { border-bottom:1px solid #222; height:14px; margin-bottom:3px; }
    .footer-line { border-bottom:1px solid #222; margin:0 26px 18px; }
    @media print {
      body { background:#fff; }
      .sheet { margin:0; width:auto; border:2px solid #222; }
    }
  `;

  const buildPayslipSheetHtml = (row: typeof payrollRowsWithOverrides[number]) => {
    const employeeName = String(row.values.fullName || 'Staff');
    const getText = (key: string) => {
      const value = row.values[key];
      if (value === null || value === undefined || value === '') return '';
      return String(value);
    };
    const toNum = (key: string) => {
      const raw = getText(key).replace(/,/g, '').trim();
      const num = Number(raw);
      return Number.isFinite(num) ? num : 0;
    };
    const currency = (value: number | string) => {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
      }
      return String(value || '').trim();
    };
    const deductionsTotal =
      toNum('advance') +
      toNum('epfEmployee') +
      toNum('otherReduction') +
      toNum('lateHours') +
      toNum('loans') +
      toNum('sickUnauthorizedLeave') +
      toNum('serviceChargeReduction');
    const totalEarnings = toNum('totalSalary') || toNum('totalSalaryReceiving') || 0;
    const netSalary = toNum('finalSalaryAfterReductions') || toNum('totalSalaryReceiving') || Math.max(0, totalEarnings - deductionsTotal);
    const lineRow = (
      earningLabel: string,
      earningValue: string | number,
      deductionLabel: string,
      deductionValue: string | number
    ) => {
      const totalEarningRow = normalizeLooseText(earningLabel) === normalizeLooseText('Total Earnings');
      const totalDeductionRow = normalizeLooseText(deductionLabel) === normalizeLooseText('Total Deduction');
      const netSalaryRow = normalizeLooseText(deductionLabel) === normalizeLooseText('NET SALARY');
      return `<tr>
        <td class="${totalEarningRow ? 'highlight' : ''}">${escapeHtml(earningLabel)}</td>
        <td class="amt ${totalEarningRow ? 'highlight' : ''}">${escapeHtml(currency(earningValue))}</td>
        <td class="${totalDeductionRow || netSalaryRow ? 'highlight' : ''}">${escapeHtml(deductionLabel)}</td>
        <td class="amt ${totalDeductionRow || netSalaryRow ? 'highlight' : ''}">${escapeHtml(currency(deductionValue))}</td>
      </tr>`;
    };
    return `
      <div class="sheet">
        <div class="top">
          <img class="logo" src="/Tracker/brand/tecc-logo-full.png?v=20260308" alt="logo" />
          <div class="company">THE ENGLISH CAKE COMPANY</div>
          <div class="address">18/15, Chitra Lane, Colombo 05</div>
          <div class="title">Pay Slip</div>
        </div>
        <div class="meta">
          <div class="meta-row"><strong>Employee Name :</strong> ${escapeHtml(employeeName)}</div>
          <div class="meta-row"><strong>Designation :</strong> ${escapeHtml(getText('position'))}</div>
          <div class="meta-row"><strong>Month :</strong> ${escapeHtml(formatMonthKey(selectedMonthKey))}</div>
          <div class="meta-row"><strong>EPF No:</strong> ${escapeHtml(getText('epfNumber'))}</div>
        </div>
        <table>
          <tr>
            <th class="wide">Earnings</th>
            <th class="amt">Rs.</th>
            <th class="wide">Deductions</th>
            <th class="amt">Rs.</th>
          </tr>
          ${lineRow('Basic Salary', getText('basic'), 'Advance', getText('advance'))}
          ${lineRow('Bonus', getText('bonus'), 'EPF (Employee)', getText('epfEmployee'))}
          ${lineRow('Performance Allowance', getText('performanceAllowance'), 'Other', getText('otherReduction'))}
          ${lineRow('Attendence Allowance', getText('attendanceAllowance'), 'Late', getText('lateHours'))}
          ${lineRow('', '', '', '')}
          ${lineRow('Fixed Service Charge', getText('serviceChargeEarning'), '', '')}
          ${lineRow('OT Worked', getText('overTime'), '', '')}
          ${lineRow('OT Days(Hols + Extra Days)', getText('overtimeExtraDays'), 'Loan', getText('loans'))}
          ${lineRow('', '', 'Sickness & Leave', getText('sickUnauthorizedLeave'))}
          ${lineRow('Service Charge', getText('serviceChargeReduction'), 'Total Deduction', currency(deductionsTotal))}
          ${lineRow('Total Earnings', currency(totalEarnings), '', '')}
          ${lineRow('EPF (Employer)', getText('epfEmployer'), 'Casual Leave', '')}
          ${lineRow('Basic Rate Per hour :', getText('basicRatePerHr'), 'Unpaid Leave', '')}
          ${lineRow('Total Rate Per hour :', getText('fullRatePerHr'), 'Annual Leave :', '')}
          ${lineRow('Worked Hours :', getText('hoursWorked'), '', '')}
          ${lineRow('Remarks :', getText('remarks'), 'NET SALARY', currency(netSalary))}
        </table>
        <div class="sig-wrap">
          <div class="sig">
            <div class="line"></div>
            <div>Signature</div>
          </div>
          <div class="sig">
            <div class="line"></div>
            <div>Accountant</div>
          </div>
        </div>
        <div class="footer-line"></div>
      </div>
    `;
  };

  const openPayslipWindow = (title: string, sheetsHtml: string) => {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      Alert.alert('Popup Blocked', 'Allow popups to print payslip.');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>${PAYSLIP_DOCUMENT_STYLES}</style>
        </head>
        <body>${sheetsHtml}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  const handlePrintPayslip = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      Alert.alert('Not Supported', 'Payslip print is currently available on web.');
      return;
    }
    const row = payrollRowsWithOverrides.find((item) => item.id === selectedPayslipRowId);
    if (!row) {
      Alert.alert('No Staff Selected', 'Select a staff row to print a payslip.');
      return;
    }
    const employeeName = String(row.values.fullName || row.values.userName || 'Staff');
    openPayslipWindow(`Payslip - ${employeeName}`, buildPayslipSheetHtml(row));
  };

  const handlePrintAllPayslips = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      Alert.alert('Not Supported', 'Payslip print is currently available on web.');
      return;
    }
    if (!payrollRowsWithOverrides.length) {
      Alert.alert('No Data', 'No payroll rows to print.');
      return;
    }
    const allSheets = payrollRowsWithOverrides
      .map((row, idx) => `<div class="sheet-wrap ${idx < payrollRowsWithOverrides.length - 1 ? 'page-break' : ''}">${buildPayslipSheetHtml(row)}</div>`)
      .join('');
    openPayslipWindow(`Payslips - ${formatMonthKey(selectedMonthKey)}`, allSheets);
  };

  const handleExportPayrollSheet = () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Not Supported', 'Payroll export is currently available on web.');
      return;
    }
    if (!payrollRowsWithOverrides.length) {
      Alert.alert('No Data', 'No payroll rows available for selected month.');
      return;
    }
    setIsExportingPayroll(true);
    try {
      const wb = XLSX.utils.book_new();
      const header = PAYROLL_COLUMNS.map((col) => col.label);
      const aoa: any[][] = [header];
      payrollRowsWithOverrides.forEach((row) => {
        aoa.push(PAYROLL_COLUMNS.map((col) => row.values[col.key] ?? ''));
      });
      const wsPayroll = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, wsPayroll, `Payroll-${selectedMonthKey}`);

      const wsMeta = XLSX.utils.aoa_to_sheet([
        ['Field', 'Value'],
        ['Month', selectedMonthKey],
        ['Formatted Month', formatMonthKey(selectedMonthKey)],
        ['Rows', payrollRowsWithOverrides.length],
        ['Processed By', selectedPayrollSheet?.processedBy || ''],
        ['Processed At', selectedPayrollSheet?.processedAt ? new Date(selectedPayrollSheet.processedAt).toISOString() : ''],
        ['Approved By', selectedPayrollSheet?.approvedBy || ''],
        ['Approved At', selectedPayrollSheet?.approvedAt ? new Date(selectedPayrollSheet.approvedAt).toISOString() : ''],
        ['Locked', monthIsLocked ? 'Yes' : 'No'],
      ]);
      XLSX.utils.book_append_sheet(wb, wsMeta, 'Payroll Meta');
      XLSX.writeFile(wb, `HR-Payroll-${selectedMonthKey}.xlsx`);
    } catch (error) {
      Alert.alert('Export Error', 'Failed to export payroll sheet.');
    } finally {
      setIsExportingPayroll(false);
    }
  };

  const handleImportPayrollSheet = async () => {
    if (!currentUser?.id) return;
    if (disableSelectedMonthEdits) {
      Alert.alert('Month Locked', 'Selected month is locked/restricted and cannot import overrides.');
      return;
    }
    setIsImportingPayrollSheet(true);
    await handlePickAndParseWorkbook(async (wb, fileName) => {
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
      if (!rows.length) throw new Error('Payroll import file is empty.');

      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
        const normalized = (rows[i] || []).map((cell) => normalizeLooseText(String(cell || '')));
        if (normalized.includes(normalizeLooseText('Full Name')) || normalized.includes(normalizeLooseText('User Name'))) {
          headerRowIndex = i;
          break;
        }
      }
      if (headerRowIndex < 0) {
        throw new Error('Payroll import headers not found. Expected at least Full Name / User Name columns.');
      }

      const headerRow = rows[headerRowIndex] || [];
      const headerMap = new Map<string, number>();
      PAYROLL_COLUMNS.forEach((col) => {
        const idx = headerRow.findIndex((cell: unknown) => normalizeLooseText(String(cell || '')) === normalizeLooseText(col.label));
        if (idx >= 0) headerMap.set(col.key, idx);
      });
      const employeeCodeIdx = headerRow.findIndex((cell: unknown) =>
        normalizeLooseText(String(cell || '')) === normalizeLooseText('Employee Code')
      );
      const fullNameIdx = headerMap.get('fullName');
      const userNameIdx = headerMap.get('userName');
      if (fullNameIdx === undefined && userNameIdx === undefined) {
        throw new Error('Payroll import requires Full Name or User Name column.');
      }

      const byFullName = new Map<string, typeof payrollRowsWithOverrides[number]>();
      const byUserName = new Map<string, typeof payrollRowsWithOverrides[number]>();
      const byEmpCode = new Map<string, typeof payrollRowsWithOverrides[number]>();
      payrollRowsWithOverrides.forEach((row) => {
        const fullName = String(row.values.fullName || '').trim();
        const userName = String(row.values.userName || '').trim();
        const empCode = String(row.meta.employeeCode || '').trim();
        if (fullName) byFullName.set(normalizeLooseText(fullName), row);
        if (userName) byUserName.set(normalizeLooseText(userName), row);
        if (empCode) byEmpCode.set(normalizeLooseText(empCode), row);
      });

      const importableKeys = PAYROLL_COLUMNS
        .map((col) => col.key)
        .filter((key) => !['fullName', 'userName', 'position', 'epfNumber', 'month'].includes(key))
        .filter((key) => !PAYROLL_UNEDITABLE_KEYS.has(key));

      const updates: Array<{
        rowId: string;
        columnKey: string;
        value: string | number | null;
        previousValue: string | number | null;
        comment?: string;
      }> = [];
      const unmatched: string[] = [];

      for (const row of rows.slice(headerRowIndex + 1)) {
        const fullName = String(row[fullNameIdx ?? -1] || '').trim();
        const userName = String(row[userNameIdx ?? -1] || '').trim();
        const empCode = String(row[employeeCodeIdx >= 0 ? employeeCodeIdx : -1] || '').trim();
        if (!fullName && !userName && !empCode) continue;

        const matched =
          (empCode && byEmpCode.get(normalizeLooseText(empCode))) ||
          (userName && byUserName.get(normalizeLooseText(userName))) ||
          (fullName && byFullName.get(normalizeLooseText(fullName)));

        if (!matched) {
          unmatched.push(fullName || userName || empCode);
          continue;
        }

        importableKeys.forEach((key) => {
          const idx = headerMap.get(key);
          if (idx === undefined) return;
          const raw = row[idx];
          const nextValue = parseImportedCellValue(raw);
          if (nextValue === null) return;
          const previousValue = matched.values[key] ?? null;
          if (String(previousValue ?? '') === String(nextValue ?? '')) return;
          updates.push({
            rowId: matched.id,
            columnKey: key,
            value: nextValue,
            previousValue,
            comment: `Imported from ${fileName}`,
          });
        });
      }

      if (!updates.length) {
        Alert.alert(
          'No Changes',
          `No matching changes found for ${formatMonthKey(selectedMonthKey)}.${unmatched.length ? `\nUnmatched rows: ${unmatched.length}` : ''}`
        );
        return;
      }

      const result = await savePayrollOverridesBatch({
        monthKey: selectedMonthKey,
        updates,
        replaceExisting: false,
        importLabel: `Imported from ${fileName}`,
      });

      Alert.alert(
        'Payroll Import Complete',
        `Imported updates: ${result.saved}\nUnmatched rows: ${unmatched.length}`
      );
    });
    setIsImportingPayrollSheet(false);
  };

  const handleRecalculateUnpaidLeaveForMonth = async () => {
    if (!currentUser?.id) return;
    if (disableSelectedMonthEdits) {
      Alert.alert('Month Locked', 'Selected month is locked/restricted and cannot be recalculated.');
      return;
    }
    setIsMonthActionRunning(true);
    try {
      const result = await clearPayrollColumnOverrides(selectedMonthKey, 'sickUnauthorizedLeave');
      if (!result.cleared) {
        Alert.alert('No Overrides', 'No old Sick/Unauthoreised Leave overrides were found for this month.');
      } else {
        Alert.alert('Recalculated', `Cleared ${result.cleared} old override(s). Formula values are now re-applied for this month.`);
      }
    } catch (error) {
      Alert.alert('Recalculate Failed', (error as Error).message || 'Failed to recalculate selected month.');
    } finally {
      setIsMonthActionRunning(false);
    }
  };

  const attendanceSummaryText = createAttendanceImportSummaryText(selectedAttendanceImport);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.push('/home' as any)}>
            <ArrowLeft size={20} color={Colors.light.tint} />
            <Text style={styles.backButtonText}>Home</Text>
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Staff HR & Payroll</Text>
            <Text style={styles.headerSubtitle}>
              Monthly payroll sheet + fingerprint attendance import + leave request matching
            </Text>
          </View>
          <TouchableOpacity style={styles.setupButton} onPress={() => router.push('/hr-setup' as any)}>
            <Settings size={16} color={Colors.light.tint} />
            <Text style={styles.setupButtonText}>Setup</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.syncButton} onPress={() => syncAll()} disabled={isSyncing}>
            {isSyncing ? <ActivityIndicator size="small" color={Colors.light.tint} /> : <RefreshCw size={18} color={Colors.light.tint} />}
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
            <Text style={styles.loadingText}>Loading HR module...</Text>
          </View>
        ) : !isHRUnlocked ? (
          <View style={styles.lockedCard}>
            <ShieldCheck size={20} color="#2563EB" />
            <Text style={styles.lockedTitle}>HR Module Locked</Text>
            <Text style={styles.lockedHint}>
              Enter HR module password to continue.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="HR module password"
              secureTextEntry
              value={hrLoginPassword}
              onChangeText={setHrLoginPassword}
            />
            <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={handleHRUnlock}>
              <KeyRound size={16} color="#fff" />
              <Text style={styles.primaryButtonText}>Unlock HR Module</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Users size={18} color="#2563EB" />
                <Text style={styles.kpiLabel}>Staff</Text>
                <Text style={styles.kpiValue}>{staffMembers.length}</Text>
              </View>
              <View style={styles.kpiCard}>
                <CalendarDays size={18} color="#0F766E" />
                <Text style={styles.kpiLabel}>Approved Leave Days</Text>
                <Text style={styles.kpiValue}>{kpis.approvedLeaveDays.toFixed(1)}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Clock3 size={18} color="#B45309" />
                <Text style={styles.kpiLabel}>Late Hours</Text>
                <Text style={styles.kpiValue}>{kpis.totalLateHours.toFixed(2)}</Text>
              </View>
              <View style={styles.kpiCard}>
                <FileSpreadsheet size={18} color="#7C3AED" />
                <Text style={styles.kpiLabel}>OT Hours</Text>
                <Text style={styles.kpiValue}>{kpis.totalOtHours.toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>1. Fingerprint Attendance Import (Monthly)</Text>
              <Text style={styles.sectionHint}>
                Import the monthly fingerprint performance report (like your `Jan-26.xls`) to calculate present/late/work/OT and compare leave with approved Leave Requests.
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton]}
                  onPress={handleImportFingerprintAttendance}
                  disabled={isImportingAttendance || disableSelectedMonthEdits}
                >
                  {isImportingAttendance ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Upload size={16} color="#fff" />
                      <Text style={styles.primaryButtonText}>Import Fingerprint Report</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={handlePullFingerprintReport}
                  disabled={isPullingFingerprintReport || disableSelectedMonthEdits}
                >
                  {isPullingFingerprintReport ? (
                    <ActivityIndicator size="small" color={Colors.light.tint} />
                  ) : (
                    <>
                      <Download size={16} color={Colors.light.tint} />
                      <Text style={styles.secondaryButtonText}>Pull Report</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={() => setShowFingerprintSettings((prev) => !prev)}
                >
                  <Settings size={14} color={Colors.light.tint} />
                  <Text style={styles.secondaryButtonText}>
                    {showFingerprintSettings ? 'Hide Fingerprint Settings' : 'Show Fingerprint Settings'}
                  </Text>
                </TouchableOpacity>
              </View>
              {disableSelectedMonthEdits && (
                <Text style={[styles.infoTiny, { color: '#B45309' }]}>
                  Attendance import for this month is blocked because the month is locked or unlocked by another authorizer.
                </Text>
              )}
              {showFingerprintSettings && (
                <View style={styles.formCard}>
                  <Text style={styles.formTitle}>Fingerprint Login Settings (Synced)</Text>
                  <Text style={styles.infoTiny}>
                    These settings are saved to server and sync across devices. Credentials are required for `Pull Report`.
                  </Text>
                  <View style={styles.formGrid}>
                    <TextInput
                      style={styles.input}
                      placeholder="Portal Base URL"
                      value={fingerprintPortalBaseUrlInput}
                      onChangeText={setFingerprintPortalBaseUrlInput}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Corporate ID"
                      value={fingerprintCorporateIdInput}
                      onChangeText={setFingerprintCorporateIdInput}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="User Name"
                      value={fingerprintUserNameInput}
                      onChangeText={setFingerprintUserNameInput}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      value={fingerprintPasswordInput}
                      onChangeText={setFingerprintPasswordInput}
                      secureTextEntry={!showFingerprintPassword}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Monthly Report Path (optional)"
                      value={fingerprintMonthlyReportPathInput}
                      onChangeText={setFingerprintMonthlyReportPathInput}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.secondaryButton]}
                      onPress={() => setShowFingerprintPassword((prev) => !prev)}
                    >
                      <Text style={styles.secondaryButtonText}>{showFingerprintPassword ? 'Hide Password' : 'Show Password'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.primaryButton]}
                      onPress={handleSaveFingerprintSettings}
                      disabled={isSavingFingerprintSettings}
                    >
                      {isSavingFingerprintSettings ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Text style={styles.primaryButtonText}>Save Fingerprint Settings</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Selected Month Attendance</Text>
                <Text style={styles.infoCardText}>{attendanceSummaryText}</Text>
                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={() => setShowAttendanceTable((prev) => !prev)}
                >
                  <Text style={styles.secondaryButtonText}>{showAttendanceTable ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
                {selectedAttendanceImport && (
                  <View style={styles.infoInlineRow}>
                    <Text style={styles.infoTiny}>Month: {selectedAttendanceImport.monthLabel}</Text>
                    <Text style={styles.infoTiny}>Imported: {new Date(selectedAttendanceImport.updatedAt).toLocaleString()}</Text>
                    {isSuperAdmin && !disableSelectedMonthEdits && (
                      <TouchableOpacity
                        style={styles.deleteMiniButton}
                        onPress={async () => {
                          await deleteAttendanceImport(selectedAttendanceImport.id);
                          Alert.alert('Deleted', 'Attendance import removed for selected month');
                        }}
                      >
                        <Trash2 size={14} color={Colors.light.danger} />
                        <Text style={styles.deleteMiniText}>Delete Import</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {selectedAttendanceImport?.rows?.length && showAttendanceTable ? (
                <ScrollView horizontal style={styles.inlineTableWrap}>
                  <View>
                    <View style={styles.tableHeaderRow}>
                      {['EmpCode', 'Name', 'Present', 'Leave', 'Unpaid Leave', 'Absent', 'Paid Days', 'Late', 'Work Hrs', 'Holiday Merc', 'Holiday Public', 'OT'].map((h) => (
                        <Text key={h} style={[styles.tableCell, styles.tableHeaderCell, h === 'Name' ? styles.wideCell : null]}>{h}</Text>
                      ))}
                    </View>
                    {selectedAttendanceImport.rows.slice(0, 25).map((row) => (
                      <View key={row.id} style={styles.tableRow}>
                        {(() => {
                          const holidayMercHours = (row.holidayMercMinutes || 0) > 0
                            ? `${minutesToDecimalHours(row.holidayMercMinutes || 0, 2).toFixed(2)} h`
                            : (row.holidayMercText || '-');
                          const holidayPublicHours = (row.holidayPublicMinutes || 0) > 0
                            ? `${minutesToDecimalHours(row.holidayPublicMinutes || 0, 2).toFixed(2)} h`
                            : (row.holidayPublicText || '-');
                          return (
                            <>
                        <Text style={styles.tableCell}>{row.employeeCode}</Text>
                        <Text style={[styles.tableCell, styles.wideCell]}>{row.employeeName}</Text>
                        <Text style={styles.tableCell}>{row.presentDays}</Text>
                        <Text style={styles.tableCell}>{row.leaveDays}</Text>
                        <Text style={styles.tableCell}>{attendanceUnpaidLeaveByRowId.get(row.id) || 0}</Text>
                        <Text style={styles.tableCell}>{row.absentDays}</Text>
                        <Text style={styles.tableCell}>{row.paidDays}</Text>
                        <Text style={styles.tableCell}>{row.lateHoursText || '-'}</Text>
                        <Text style={styles.tableCell}>{row.workHoursText || '-'}</Text>
                        <Text style={styles.tableCell}>{holidayMercHours}</Text>
                        <Text style={styles.tableCell}>{holidayPublicHours}</Text>
                        <Text style={styles.tableCell}>{row.overtimeText || '-'}</Text>
                            </>
                          );
                        })()}
                      </View>
                    ))}
                    {selectedAttendanceImport.rows.length > 25 && (
                      <Text style={styles.emptyLine}>Showing first 25 of {selectedAttendanceImport.rows.length} attendance rows.</Text>
                    )}
                  </View>
                </ScrollView>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>2. Monthly Payroll Sheet (Leave Integrated)</Text>
              <Text style={styles.sectionHint}>
                Payroll rows use your payroll headers and auto-fill key values from fingerprint attendance (Hours Worked, OT, Late hours) and approved leave requests for the selected month.
              </Text>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Payroll Control</Text>
                <View style={styles.infoInlineRow}>
                  {monthIsLocked ? (
                    <View style={styles.statusPillLocked}>
                      <Lock size={12} color="#fff" />
                      <Text style={styles.statusPillText}>Locked</Text>
                    </View>
                  ) : monthRestrictedByAuthorizer ? (
                    <View style={styles.statusPillRestricted}>
                      <LockOpen size={12} color="#fff" />
                      <Text style={styles.statusPillText}>Unlocked (Other Authorizer)</Text>
                    </View>
                  ) : selectedPayrollSheet?.editingRestrictedToUserId ? (
                    <View style={styles.statusPillActive}>
                      <LockOpen size={12} color="#fff" />
                      <Text style={styles.statusPillText}>Unlocked (You)</Text>
                    </View>
                  ) : (
                    <View style={styles.statusPillNeutral}>
                      <Text style={styles.statusPillTextNeutral}>Editable</Text>
                    </View>
                  )}
                  {selectedPayrollSheet?.processedBy ? (
                    <Text style={styles.infoTiny}>
                      Processed: {selectedPayrollSheet.processedBy} {selectedPayrollSheet.processedAt ? `(${new Date(selectedPayrollSheet.processedAt).toLocaleString()})` : ''}
                    </Text>
                  ) : null}
                  {selectedPayrollSheet?.approvedBy ? (
                    <Text style={styles.infoTiny}>
                      Approved: {selectedPayrollSheet.approvedBy} {selectedPayrollSheet.approvedAt ? `(${new Date(selectedPayrollSheet.approvedAt).toLocaleString()})` : ''}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={handleProcessMonth}
                    disabled={isMonthActionRunning || disableSelectedMonthEdits}
                  >
                    <Text style={styles.secondaryButtonText}>Create Payroll Sheet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.primaryButton]}
                    onPress={handleApproveAndLock}
                    disabled={isMonthActionRunning || monthIsLocked}
                  >
                    {isMonthActionRunning ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Lock size={14} color="#fff" />
                        <Text style={styles.primaryButtonText}>Approve & Lock</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={handleExportPayrollSheet}
                    disabled={isExportingPayroll || !payrollRowsWithOverrides.length}
                  >
                    {isExportingPayroll ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <>
                        <Download size={14} color={Colors.light.tint} />
                        <Text style={styles.secondaryButtonText}>Export Payroll (Excel)</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={handleImportPayrollSheet}
                    disabled={isImportingPayrollSheet || disableSelectedMonthEdits}
                  >
                    {isImportingPayrollSheet ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <>
                        <Upload size={14} color={Colors.light.tint} />
                        <Text style={styles.secondaryButtonText}>Import Payroll (Excel)</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={handleRecalculateUnpaidLeaveForMonth}
                    disabled={isMonthActionRunning || disableSelectedMonthEdits}
                  >
                    <Text style={styles.secondaryButtonText}>Recalculate Unpaid Leave (This Month)</Text>
                  </TouchableOpacity>
                </View>
                {monthIsLocked && (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Authorizer password to unlock"
                      secureTextEntry
                      value={unlockPasswordInput}
                      onChangeText={setUnlockPasswordInput}
                    />
                    <TouchableOpacity
                      style={[styles.actionButton, styles.warningButton]}
                      onPress={handleUnlockMonth}
                      disabled={isMonthActionRunning}
                    >
                      <Unlock size={14} color="#fff" />
                      <Text style={styles.primaryButtonText}>Unlock For My Editing</Text>
                    </TouchableOpacity>
                    <Text style={styles.infoTiny}>
                      Unlock grants edit access only to the authorizing user until this month is locked again.
                    </Text>
                  </>
                )}
              </View>

              <View style={styles.monthSelectorCard}>
                <View style={styles.monthNavRow}>
                  <TouchableOpacity
                    style={styles.monthNavButton}
                    onPress={() => setSelectedMonthKey((prev) => shiftMonthKey(prev, -1))}
                  >
                    <ChevronLeft size={16} color={Colors.light.tint} />
                    <Text style={styles.monthNavButtonText}>Prev Month</Text>
                  </TouchableOpacity>

                  <Text style={styles.monthCurrentLabel}>{formatMonthKey(selectedMonthKey)}</Text>

                  <TouchableOpacity
                    style={styles.monthNavButton}
                    onPress={() => setSelectedMonthKey((prev) => shiftMonthKey(prev, 1))}
                  >
                    <Text style={styles.monthNavButtonText}>Next Month</Text>
                    <ChevronRight size={16} color={Colors.light.tint} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Payroll Month (YYYY-MM)</Text>
                <TextInput
                  style={styles.input}
                  value={selectedMonthKey}
                  onChangeText={(v) => setSelectedMonthKey(normalizeMonthKeyInput(v))}
                  placeholder="2026-01"
                  autoCapitalize="none"
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthChipRow}>
                  {monthOptions.map((month) => (
                    <TouchableOpacity
                      key={month}
                      style={[styles.monthChip, month === selectedMonthKey && styles.monthChipActive]}
                      onPress={() => setSelectedMonthKey(month)}
                    >
                      <Text style={[styles.monthChipText, month === selectedMonthKey && styles.monthChipTextActive]}>
                        {formatMonthKey(month)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.infoInlineRow}>
                  <Text style={styles.infoTiny}>Approved leave requests overlapping month: {approvedLeaveThisMonth.length}</Text>
                  <Text style={styles.infoTiny}>Attendance matched rows: {kpis.matched}/{payrollRowsWithOverrides.length}</Text>
                  {!payrollRowsWithOverrides.length && attendanceImports.length > 0 && (
                    <Text style={[styles.infoTiny, { color: '#B45309' }]}>
                      No rows for {formatMonthKey(selectedMonthKey)}. Try another month chip or import staff details.
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Payroll Sheet History</Text>
                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={() => setShowPayrollHistoryMonths((prev) => !prev)}
                >
                  <Text style={styles.secondaryButtonText}>{showPayrollHistoryMonths ? 'Hide' : 'Show'} Months</Text>
                </TouchableOpacity>
                {!showPayrollHistoryMonths ? (
                  <Text style={styles.infoTiny}>Months list is hidden by default. Press Show Months to view.</Text>
                ) : !payrollMonthHistory.length ? (
                  <Text style={styles.infoTiny}>No payroll sheets processed yet.</Text>
                ) : (
                  payrollMonthHistory.slice(0, 18).map((sheet) => (
                    <View key={sheet.id} style={styles.historyRow}>
                      <View style={styles.historyRowMain}>
                        <Text style={styles.historyMonthText}>{formatMonthKey(sheet.monthKey)}</Text>
                        <Text style={styles.infoTiny}>
                          {sheet.isLocked ? 'Locked' : 'Open'} | Processed: {sheet.processedBy || '-'} | Approved: {sheet.approvedBy || '-'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.secondaryButton, styles.historyOpenButton]}
                        onPress={() => setSelectedMonthKey(sheet.monthKey)}
                      >
                        <Text style={styles.secondaryButtonText}>Open</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Search Payroll Rows</Text>
                <View style={styles.buttonRow}>
                  <TextInput
                    style={[styles.input, styles.searchInput]}
                    placeholder="Search by Name / User Name / Position"
                    value={payrollSearchInput}
                    onChangeText={setPayrollSearchInput}
                  />
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={() => setAppliedPayrollSearch(payrollSearchInput.trim())}
                  >
                    <Text style={styles.secondaryButtonText}>Search</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={() => {
                      setPayrollSearchInput('');
                      setAppliedPayrollSearch('');
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Clear</Text>
                  </TouchableOpacity>
                </View>
                {appliedPayrollSearch.trim() ? (
                  <Text style={styles.infoTiny}>
                    Filter active: "{appliedPayrollSearch}" | Showing {filteredPayrollRows.length} of {payrollRowsWithOverrides.length}
                  </Text>
                ) : null}
              </View>

              <ScrollView horizontal style={styles.payrollTableWrap}>
                <View>
                  <View style={styles.payrollTableHeaderRow}>
                    {PAYROLL_COLUMNS.map((col, columnIndex) => (
                      <Text
                        key={col.key}
                        style={[
                          styles.payrollCell,
                          styles.tableHeaderCell,
                          styles.payrollHeaderCell,
                          Platform.OS === 'web' && styles.webStickyHeaderCell,
                          Platform.OS === 'web' && styles.payrollWebStickyHeaderCell,
                          getPayrollStickyCellStyle(columnIndex, true),
                          getPayrollHistoryColumnStyle(columnIndex, col.key) === 'blue' && styles.cellLightBlue,
                          getPayrollHistoryColumnStyle(columnIndex, col.key) === 'yellow' && styles.cellLightYellow,
                          getPayrollHistoryColumnStyle(columnIndex, col.key) === 'green' && styles.cellLightGreen,
                          (col.key === 'fullName' || col.key === 'remarks') && styles.payrollWideCell,
                        ]}
                      >
                        {col.key === 'serviceChargeReduction' ? (
                          <>
                            {col.label}
                            {'\n'}
                            <Text style={[styles.serviceChargeBalanceLabel, remainingServiceChargeBalance < 0 && styles.serviceChargeBalanceNegative]}>
                              Bal: {remainingServiceChargeBalance} / {totalServiceChargeAvailableForMonth}
                            </Text>
                          </>
                        ) : (
                          col.label
                        )}
                      </Text>
                    ))}
                  </View>
                  {filteredPayrollRows.length === 0 ? (
                    <Text style={styles.emptyLine}>
                      {payrollRowsWithOverrides.length === 0
                        ? 'No payroll rows yet. Add staff and/or import fingerprint attendance.'
                        : 'No payroll rows match the current search filter.'}
                    </Text>
                  ) : (
                    filteredPayrollRows.map((row) => {
                      const draftPrefix = `${row.id}::`;
                      const rowDraftValues: Record<string, string> = {};
                      Object.entries(payrollCellDrafts).forEach(([draftKey, draftValue]) => {
                        if (!draftKey.startsWith(draftPrefix)) return;
                        rowDraftValues[draftKey.slice(draftPrefix.length)] = draftValue;
                      });
                      const getFormulaInputValue = (key: string) =>
                        rowDraftValues[key] !== undefined ? rowDraftValues[key] : row.values[key];
                      const isPartTimeRow = row.meta.employmentType === 'Part-Time';
                      const livePerformanceAllowance = isPartTimeRow
                        ? roundToWholeNumber(toNumberOrZero(getFormulaInputValue('hoursWorked')) * 176.8)
                        : toNumberOrZero(getFormulaInputValue('performanceAllowance'));
                      const liveTotalSalary = computeTotalSalaryByEmploymentType(
                        isPartTimeRow ? 'Part-Time' : 'Full-Time',
                        {
                          basic: getFormulaInputValue('basic'),
                          performanceAllowance: livePerformanceAllowance,
                          attendanceAllowance: getFormulaInputValue('attendanceAllowance'),
                          overTime: getFormulaInputValue('overTime'),
                          serviceChargeEarning: getFormulaInputValue('serviceChargeEarning'),
                          epfEmployer: getFormulaInputValue('epfEmployer'),
                          etfEmployer: getFormulaInputValue('etfEmployer'),
                        }
                      );

                      const liveTotalSalaryReceiving = roundToWholeNumber(
                        liveTotalSalary +
                        toNumberOrZero(getFormulaInputValue('extraOt')) +
                        toNumberOrZero(getFormulaInputValue('overtimeExtraDays')) +
                        toNumberOrZero(getFormulaInputValue('otMerc')) +
                        toNumberOrZero(getFormulaInputValue('otPublic')) +
                        toNumberOrZero(getFormulaInputValue('serviceChargeReduction')) +
                        toNumberOrZero(getFormulaInputValue('bonus'))
                      );
                      const liveFinalSalaryAfterReductions = roundToWholeNumber(
                        liveTotalSalaryReceiving -
                        (
                          toNumberOrZero(getFormulaInputValue('epfEmployee')) +
                          toNumberOrZero(getFormulaInputValue('advance')) +
                          toNumberOrZero(getFormulaInputValue('otherReduction')) +
                          toNumberOrZero(getFormulaInputValue('loans')) +
                          toNumberOrZero(getFormulaInputValue('sickUnauthorizedLeave')) +
                          toNumberOrZero(getFormulaInputValue('lateHours'))
                        )
                      );
                      const rowLoanLookupKey = buildPayrollLookupKey(
                        String(row.values.userName || ''),
                        String(row.values.fullName || '')
                      );
                      const pendingLoanAmount = payrollLoanPendingByLookupKey.get(rowLoanLookupKey) || 0;

                      return (
                      <View key={row.id} style={styles.tableRow}>
                        {PAYROLL_COLUMNS.map((col, columnIndex) => {
                          const formulaRawValue =
                            col.key === 'totalSalary'
                              ? liveTotalSalary
                              : col.key === 'totalSalaryReceiving'
                              ? liveTotalSalaryReceiving
                              : col.key === 'finalSalaryAfterReductions'
                                ? liveFinalSalaryAfterReductions
                                : col.key === 'performanceAllowance' && isPartTimeRow
                                  ? livePerformanceAllowance
                                : row.values[col.key];
                          const rawValue = formulaRawValue;
                          const fallbackValue = formatPayrollDisplayValue(col.key, rawValue);
                          const draftKey = `${row.id}::${col.key}`;
                          const draftValue = payrollCellDrafts[draftKey];
                          const effectiveValue = draftValue !== undefined ? draftValue : fallbackValue;
                          const editable = isPayrollCellEditable(col.key) && !disableSelectedMonthEdits;
                          const isCriticalEdited = criticalEditedCellKeys.has(draftKey);
                          const columnTheme = getPayrollHistoryColumnStyle(columnIndex, col.key);
                          const shouldHighlightPendingLoan =
                            col.key === 'loans' &&
                            pendingLoanAmount > 0 &&
                            toNumberOrZero(effectiveValue) <= 0;
                          return editable ? (
                            <View
                              key={`${row.id}-${col.key}`}
                              style={[
                                styles.payrollEditableCell,
                                getPayrollStickyCellStyle(columnIndex),
                                columnTheme === 'blue' && styles.cellLightBlue,
                                columnTheme === 'yellow' && styles.cellLightYellow,
                                columnTheme === 'green' && styles.cellLightGreen,
                                isCriticalEdited && styles.cellEditedCritical,
                                shouldHighlightPendingLoan && styles.cellPendingLoan,
                                (col.key === 'fullName' || col.key === 'remarks') && styles.payrollWideCell,
                              ]}
                            >
                              <TextInput
                                style={styles.payrollCellInput}
                                value={effectiveValue}
                                onChangeText={(text) =>
                                  setPayrollCellDrafts((prev) => ({ ...prev, [draftKey]: text }))
                                }
                                onBlur={() =>
                                  handlePayrollCellBlur({
                                    rowId: row.id,
                                    columnKey: col.key,
                                    draftValue: effectiveValue,
                                    previousValue: rawValue ?? null,
                                  })
                                }
                                placeholder="-"
                              />
                            </View>
                          ) : (
                            <Text
                              key={`${row.id}-${col.key}`}
                              style={[
                                styles.payrollCell,
                                getPayrollStickyCellStyle(columnIndex),
                                columnTheme === 'blue' && styles.cellLightBlue,
                                columnTheme === 'yellow' && styles.cellLightYellow,
                                columnTheme === 'green' && styles.cellLightGreen,
                                isCriticalEdited && styles.cellEditedCritical,
                                shouldHighlightPendingLoan && styles.cellPendingLoan,
                                (col.key === 'fullName' || col.key === 'remarks') && styles.payrollWideCell,
                              ]}
                              numberOfLines={2}
                            >
                              {fallbackValue || '-'}
                            </Text>
                          );
                        })}
                      </View>
                    )})
                  )}
                </View>
              </ScrollView>

              <View style={styles.noteCard}>
                <Text style={styles.noteTitle}>How Leave Integration Works</Text>
                <Text style={styles.noteText}>
                  The payroll sheet matches approved Leave Requests to staff by employee name (Full Name / User Name / fingerprint name). It fills approved leave days into `Hours/Days` and estimates unauthorised leave as `Absent - Approved Leave`.
                </Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Manual Edit History (Selected Month)</Text>
                {!payrollManualEdits.length ? (
                  <Text style={styles.infoTiny}>No manual payroll edits recorded for this month.</Text>
                ) : (
                  payrollManualEdits.slice(0, 12).map((item) => (
                    <Text key={item.id} style={styles.infoTiny}>
                      {new Date(item.editedAt).toLocaleString()} | {item.columnKey} | {String(item.previousValue ?? '-')} to {String(item.nextValue ?? '-')} | by {item.editedBy}{item.comment ? ` | ${item.comment}` : ''}
                    </Text>
                  ))
                )}
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Print Payslips</Text>
                <Text style={styles.infoTiny}>
                  Select one staff for single print, or enable `Select All` to print every payslip for this month.
                </Text>
                <TouchableOpacity
                  style={[styles.actionButton, printAllPayslips ? styles.primaryButton : styles.secondaryButton]}
                  onPress={() => setPrintAllPayslips((prev) => !prev)}
                >
                  <Text style={printAllPayslips ? styles.primaryButtonText : styles.secondaryButtonText}>
                    {printAllPayslips ? 'Select All: ON' : 'Select All: OFF'}
                  </Text>
                </TouchableOpacity>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthChipRow}>
                  {payrollRowsWithOverrides.map((row) => (
                    <TouchableOpacity
                      key={row.id}
                      style={[styles.monthChip, selectedPayslipRowId === row.id && styles.monthChipActive]}
                      onPress={() => {
                        setSelectedPayslipRowId(row.id);
                        setPrintAllPayslips(false);
                      }}
                    >
                      <Text style={[styles.monthChipText, selectedPayslipRowId === row.id && styles.monthChipTextActive]}>
                        {String(row.values.fullName || row.values.userName || row.id)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton]}
                  onPress={printAllPayslips ? handlePrintAllPayslips : handlePrintPayslip}
                  disabled={!printAllPayslips && !selectedPayslipRowId}
                >
                  <Download size={14} color="#fff" />
                  <Text style={styles.primaryButtonText}>{printAllPayslips ? 'Print All Payslips' : 'Print Selected Payslip'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  backButtonText: {
    color: Colors.light.tint,
    fontWeight: '600',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  syncButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  setupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  setupButtonText: {
    color: Colors.light.tint,
    fontWeight: '600',
    fontSize: 12,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  lockedCard: {
    margin: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    padding: 16,
    gap: 10,
  },
  lockedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  lockedHint: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
  },
  loadingText: {
    color: '#64748B',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  kpiCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    minWidth: 150,
    flexGrow: 1,
    gap: 4,
  },
  kpiLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionHint: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  primaryButton: {
    backgroundColor: '#0F766E',
    borderColor: '#0F766E',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  warningButton: {
    backgroundColor: '#B45309',
    borderColor: '#B45309',
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  formCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 10,
  },
  formTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 160,
    color: '#0F172A',
  },
  searchInput: {
    minWidth: 320,
    flexGrow: 1,
  },
  inlineTableWrap: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
  },
  payrollTableWrap: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  payrollTableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#DBEAFE',
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tableCell: {
    width: 120,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
  },
  staffActionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniActionButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#FFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  miniArchiveButton: {
    backgroundColor: '#B91C1C',
    borderColor: '#B91C1C',
  },
  miniRestoreButton: {
    backgroundColor: '#0F766E',
    borderColor: '#0F766E',
  },
  miniActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  payrollCell: {
    width: 130,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 11,
    color: '#0F172A',
  },
  payrollEditableCell: {
    width: 130,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  payrollCellInput: {
    fontSize: 11,
    color: '#0F172A',
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 20,
  },
  cellOrange: {
    backgroundColor: '#FFF7ED',
  },
  cellYellow: {
    backgroundColor: '#FEF9C3',
  },
  cellLightBlue: {
    backgroundColor: '#E0F2FE',
  },
  cellLightYellow: {
    backgroundColor: '#FEF9C3',
  },
  cellLightGreen: {
    backgroundColor: '#DCFCE7',
  },
  cellEditedCritical: {
    backgroundColor: '#FEE2E2',
  },
  cellPendingLoan: {
    backgroundColor: '#FECACA',
  },
  cellPurple: {
    backgroundColor: '#F3E8FF',
  },
  cellGrey: {
    backgroundColor: '#E5E7EB',
  },
  zoneHintText: {
    fontSize: 9,
    color: '#64748B',
    marginTop: 2,
  },
  zoneLegendText: {
    fontSize: 10,
    color: '#475569',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    padding: 8,
  },
  historyRowMain: {
    flex: 1,
    gap: 2,
  },
  historyMonthText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  historyOpenButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  wideCell: {
    width: 220,
  },
  payrollWideCell: {
    width: 260,
  },
  tableHeaderCell: {
    fontWeight: '700',
    color: '#334155',
  },
  payrollHeaderCell: {
    color: '#000000',
    backgroundColor: '#DBEAFE',
  },
  serviceChargeBalanceLabel: {
    fontSize: 9,
    color: '#047857',
    fontWeight: '700',
  },
  serviceChargeBalanceNegative: {
    color: '#B91C1C',
  },
  webStickyHeaderCell: {
    position: 'sticky',
    top: 0,
    zIndex: 60,
    backgroundColor: '#F1F5F9',
  },
  payrollWebStickyHeaderCell: {
    backgroundColor: '#DBEAFE',
    borderBottomColor: '#BFDBFE',
  },
  emptyLine: {
    padding: 12,
    color: '#64748B',
    fontSize: 12,
  },
  infoCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 6,
  },
  infoCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  infoCardText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  infoInlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  infoTiny: {
    fontSize: 11,
    color: '#64748B',
  },
  statusPillLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: '#B91C1C',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillRestricted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: '#92400E',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: '#065F46',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillNeutral: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  statusPillTextNeutral: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteMiniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  deleteMiniText: {
    color: Colors.light.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  monthSelectorCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 8,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  monthNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  monthNavButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.tint,
  },
  monthCurrentLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  monthChipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  monthChip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  monthChipActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#38BDF8',
  },
  monthChipText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  monthChipTextActive: {
    color: '#0369A1',
  },
  noteCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 6,
  },
  noteTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  noteText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
});
