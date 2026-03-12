import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, ShieldCheck, Users, Download, Plus, Trash2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useHR } from '@/contexts/HRContext';
import { useLeave } from '@/contexts/LeaveContext';
import { useStock } from '@/contexts/StockContext';
import { generatePayrollRowsForMonth } from '@/utils/hrPayroll';
import { getSalesReportsByOutletAndDateRange, syncAllReconciliationData } from '@/utils/reconciliationSync';
import { HRHolidayCalendarItem, HRLoanRecord, HRServiceChargeMonthEntry, HRServiceChargeOutletOption } from '@/types';

type ParsedHoliday = {
  name: string;
  date: string;
};

function decodeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .trim();
}

function parseIcsDate(value: string): string | null {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function holidayKey(name: string, date: string): string {
  return `${date}__${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function buildHolidayId(name: string, date: string): string {
  const safeName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'holiday';
  return `hr-holiday-${date}-${safeName}`;
}

function parseHolidaysFromIcs(rawIcs: string): ParsedHoliday[] {
  const unfolded = String(rawIcs || '').replace(/\r\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const parsed: ParsedHoliday[] = [];
  let inEvent = false;
  let summary = '';
  let date: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = '';
      date = null;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent && summary && date) {
        parsed.push({ name: summary, date });
      }
      inEvent = false;
      summary = '';
      date = null;
      continue;
    }
    if (!inEvent) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex).toUpperCase();
    const value = line.slice(colonIndex + 1);

    if (key.startsWith('SUMMARY')) {
      summary = decodeIcsText(value);
      continue;
    }
    if (key.startsWith('DTSTART')) {
      date = parseIcsDate(value);
    }
  }

  const byKey = new Map<string, ParsedHoliday>();
  parsed.forEach((item) => {
    if (!item.name || !item.date) return;
    byKey.set(holidayKey(item.name, item.date), item);
  });

  return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function parsePositiveDecimalInput(text: string): number | null {
  const normalized = String(text || '').trim().replace(',', '.');
  if (!normalized || normalized === '.') return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseNonNegativeNumberInput(text: string): number | null {
  const normalized = String(text || '').trim().replace(',', '.');
  if (!normalized || normalized === '.') return null;
  if (!/^\d+(\.\d*)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeNameKey(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/[\s._:/()-]+/g, '');
}

function buildStaffLookupKey(userName: string, fullName?: string): string {
  const userKey = normalizeNameKey(userName);
  if (userKey) return userKey;
  return normalizeNameKey(fullName || '');
}

function toNumberOrZero(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value || 0) * 100) / 100;
}

function normalizeMonthKey(input: string): string {
  const trimmed = String(input || '').trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return trimmed;
  return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const normalized = normalizeMonthKey(monthKey);
  const parts = normalized.split('-');
  if (parts.length !== 2) return new Date().toISOString().slice(0, 7);
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return new Date().toISOString().slice(0, 7);
  }
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

export default function HRSetupScreen() {
  const router = useRouter();
  const { currentUser, isSuperAdmin } = useAuth();
  const { leaveRequests, leaveTypes } = useLeave();
  const { outlets } = useStock();
  const {
    hasSecuritySetup,
    hrSessionUnlocked,
    verifyModulePassword,
    securitySettings,
    fingerprintPortalSettings,
    holidayCalendarSettings,
    loanRecords,
    serviceChargeSettings,
    serviceChargeMonthEntries,
    staffMembers,
    attendanceImports,
    payrollMonthSheets,
    setSecurityPasswords,
    saveFingerprintPortalSettings,
    saveHolidayCalendarSettings,
    saveLoanRecords,
    saveServiceChargeSettings,
    saveServiceChargeMonthEntry,
    getServiceChargeMonthEntry,
    isSyncing,
    syncAll,
    unlockHRSession,
    verifyAuthorizerPassword,
  } = useHR();

  const [hrLoginPassword, setHrLoginPassword] = useState('');
  const [modulePasswordInput, setModulePasswordInput] = useState('');
  const [authorizerPasswordInput, setAuthorizerPasswordInput] = useState('');
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
  const [fingerprintPortalBaseUrlInput, setFingerprintPortalBaseUrlInput] = useState('https://www.onlineebiocloud.com');
  const [fingerprintCorporateIdInput, setFingerprintCorporateIdInput] = useState('');
  const [fingerprintUserNameInput, setFingerprintUserNameInput] = useState('');
  const [fingerprintPasswordInput, setFingerprintPasswordInput] = useState('');
  const [fingerprintMonthlyReportPathInput, setFingerprintMonthlyReportPathInput] = useState('NewMonthly.aspx');
  const [showFingerprintPassword, setShowFingerprintPassword] = useState(false);
  const [showFingerprintPortal, setShowFingerprintPortal] = useState(false);
  const [isSavingFingerprintSettings, setIsSavingFingerprintSettings] = useState(false);
  const [calendarUrlInput, setCalendarUrlInput] = useState('');
  const [holidayItems, setHolidayItems] = useState<HRHolidayCalendarItem[]>([]);
  const [holidayTimesInputs, setHolidayTimesInputs] = useState<Record<string, string>>({});
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [isSavingCalendar, setIsSavingCalendar] = useState(false);
  const [showHolidayCalendar, setShowHolidayCalendar] = useState(false);
  const [showLoans, setShowLoans] = useState(false);
  const [showServiceCharge, setShowServiceCharge] = useState(false);
  const [showServiceChargeOptions, setShowServiceChargeOptions] = useState(false);
  const [serviceChargeOptionsUnlocked, setServiceChargeOptionsUnlocked] = useState(false);
  const [serviceChargeOptionsPassword, setServiceChargeOptionsPassword] = useState('');
  const [serviceChargeOptionRows, setServiceChargeOptionRows] = useState<HRServiceChargeOutletOption[]>([]);
  const [isSavingServiceChargeOptions, setIsSavingServiceChargeOptions] = useState(false);
  const [serviceChargeMonthInput, setServiceChargeMonthInput] = useState(new Date().toISOString().slice(0, 7));
  const [serviceChargeMonthRows, setServiceChargeMonthRows] = useState<HRServiceChargeMonthEntry['outletRows']>([]);
  const [isLoadingServiceChargeMonth, setIsLoadingServiceChargeMonth] = useState(false);
  const [isSavingServiceChargeMonth, setIsSavingServiceChargeMonth] = useState(false);
  const [loanItems, setLoanItems] = useState<HRLoanRecord[]>([]);
  const [isSavingLoans, setIsSavingLoans] = useState(false);
  const [showAddLoanForm, setShowAddLoanForm] = useState(false);
  const [loanSearchInput, setLoanSearchInput] = useState('');
  const [loanSearchFocused, setLoanSearchFocused] = useState(false);
  const [selectedLoanStaffUserName, setSelectedLoanStaffUserName] = useState('');
  const [newLoanDate, setNewLoanDate] = useState(new Date().toISOString().slice(0, 10));
  const [newLoanAmountInput, setNewLoanAmountInput] = useState('');
  const [newLoanInterestRateInput, setNewLoanInterestRateInput] = useState('0');

  const isHRUnlocked = !hasSecuritySetup || hrSessionUnlocked;

  const salesOutlets = useMemo(
    () =>
      [...outlets]
        .filter((row) => !row.deleted && row.outletType === 'sales' && String(row.name || '').trim())
        .map((row) => String(row.name || '').trim())
        .sort((a, b) => a.localeCompare(b)),
    [outlets]
  );

  useEffect(() => {
    setFingerprintPortalBaseUrlInput(
      String(fingerprintPortalSettings?.portalBaseUrl || '').trim() || 'https://www.onlineebiocloud.com'
    );
    setFingerprintCorporateIdInput(String(fingerprintPortalSettings?.corporateId || '').trim());
    setFingerprintUserNameInput(String(fingerprintPortalSettings?.userName || '').trim());
    setFingerprintPasswordInput(String(fingerprintPortalSettings?.password || '').trim());
    setFingerprintMonthlyReportPathInput(
      String(fingerprintPortalSettings?.monthlyReportPath || '').trim() || 'NewMonthly.aspx'
    );
  }, [fingerprintPortalSettings]);

  useEffect(() => {
    setCalendarUrlInput(holidayCalendarSettings?.calendarUrl || '');
    const sorted = [...(holidayCalendarSettings?.holidays || [])]
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    setHolidayItems(
      sorted
    );
    setHolidayTimesInputs(
      Object.fromEntries(
        sorted.map((item) => [item.id, String(item.times || 1)])
      )
    );
  }, [holidayCalendarSettings?.calendarUrl, holidayCalendarSettings?.holidays]);

  useEffect(() => {
    const sorted = [...(loanRecords || [])]
      .filter((row) => !row.deleted)
      .sort((a, b) => (a.loanDate || '').localeCompare(b.loanDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
    setLoanItems(sorted);
  }, [loanRecords]);

  useEffect(() => {
    const existingByOutlet = new Map(
      (serviceChargeSettings?.outletOptions || []).map((row) => [String(row.outletName || '').trim(), row] as const)
    );
    const merged = salesOutlets.map((outletName, idx) => {
      const existing = existingByOutlet.get(outletName);
      return {
        id: existing?.id || `hr-service-charge-outlet-${idx}-${outletName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        outletName,
        percentToStaff: Number.isFinite(Number(existing?.percentToStaff)) ? Number(existing?.percentToStaff) : 0,
        percentOther: Number.isFinite(Number(existing?.percentOther)) ? Number(existing?.percentOther) : 0,
      } as HRServiceChargeOutletOption;
    });
    setServiceChargeOptionRows(merged);
  }, [salesOutlets, serviceChargeSettings?.outletOptions]);

  const selectedServiceChargeMonthEntry = useMemo(
    () => getServiceChargeMonthEntry(normalizeMonthKey(serviceChargeMonthInput)),
    [getServiceChargeMonthEntry, serviceChargeMonthInput, serviceChargeMonthEntries]
  );

  useEffect(() => {
    const existingByOutlet = new Map(
      (selectedServiceChargeMonthEntry?.outletRows || []).map((row) => [String(row.outletName || '').trim(), row] as const)
    );
    const merged = salesOutlets.map((outletName, idx) => {
      const existing = existingByOutlet.get(outletName);
      return {
        id: existing?.id || `hr-service-charge-month-row-${normalizeMonthKey(serviceChargeMonthInput)}-${idx}`,
        outletName,
        serviceCharge: Number.isFinite(Number(existing?.serviceCharge)) ? Number(existing?.serviceCharge) : 0,
        availableToStaff: Number.isFinite(Number(existing?.availableToStaff)) ? Number(existing?.availableToStaff) : 0,
      };
    });
    setServiceChargeMonthRows(merged);
  }, [salesOutlets, selectedServiceChargeMonthEntry?.id, selectedServiceChargeMonthEntry?.outletRows, serviceChargeMonthInput]);

  const holidayStats = useMemo(() => {
    const paidCount = holidayItems.filter((item) => item.getPaid).length;
    return { total: holidayItems.length, paidCount };
  }, [holidayItems]);

  const serviceChargeOptionsByOutlet = useMemo(
    () => new Map(serviceChargeOptionRows.map((row) => [String(row.outletName || '').trim(), row] as const)),
    [serviceChargeOptionRows]
  );

  const serviceChargeMonthTotals = useMemo(() => {
    const rows = serviceChargeMonthRows.map((row) => {
      const option = serviceChargeOptionsByOutlet.get(String(row.outletName || '').trim());
      const percentToStaff = Number.isFinite(Number(option?.percentToStaff)) ? Number(option?.percentToStaff) : 0;
      const serviceCharge = Number.isFinite(Number(row.serviceCharge)) ? Number(row.serviceCharge) : 0;
      const availableToStaff = roundMoney((serviceCharge * percentToStaff) / 100);
      return {
        ...row,
        serviceCharge,
        availableToStaff,
      };
    });
    const totalAvailableToStaff = roundMoney(rows.reduce((sum, row) => sum + row.availableToStaff, 0));
    return { rows, totalAvailableToStaff };
  }, [serviceChargeMonthRows, serviceChargeOptionsByOutlet]);

  const activeStaffLoanOptions = useMemo(
    () =>
      [...staffMembers]
        .filter((staff) => !staff.deleted && staff.active !== false)
        .map((staff) => ({
          id: String(staff.id || '').trim(),
          userName: String(staff.userName || '').trim(),
          fullName: String(staff.fullName || '').trim(),
          position: String(staff.position || '').trim(),
        }))
        .filter((staff) => !!staff.userName)
        .sort((a, b) => a.userName.localeCompare(b.userName)),
    [staffMembers]
  );

  const filteredLoanStaffOptions = useMemo(() => {
    const query = normalizeNameKey(loanSearchInput);
    if (!query) return activeStaffLoanOptions.slice(0, 60);
    return activeStaffLoanOptions
      .filter((staff) => {
        const userKey = normalizeNameKey(staff.userName);
        const nameKey = normalizeNameKey(staff.fullName);
        const positionKey = normalizeNameKey(staff.position);
        return userKey.includes(query) || nameKey.includes(query) || positionKey.includes(query);
      })
      .slice(0, 60);
  }, [activeStaffLoanOptions, loanSearchInput]);

  const staffLookupMaps = useMemo(() => {
    const lookupByAnyKey = new Map<string, string>();
    const displayByLookupKey = new Map<string, string>();
    const preferredByLookupKey = new Map<string, string>();
    staffMembers
      .filter((staff) => !staff.deleted)
      .forEach((staff) => {
        const userName = String(staff.userName || '').trim();
        const fullName = String(staff.fullName || '').trim();
        const lookupKey = buildStaffLookupKey(userName, fullName);
        if (!lookupKey) return;
        const userKey = normalizeNameKey(userName);
        const fullKey = normalizeNameKey(fullName);
        if (userKey) lookupByAnyKey.set(userKey, lookupKey);
        if (fullKey) lookupByAnyKey.set(fullKey, lookupKey);
        lookupByAnyKey.set(lookupKey, lookupKey);
        if (!displayByLookupKey.has(lookupKey)) {
          displayByLookupKey.set(
            lookupKey,
            userName ? `${userName}${fullName ? ` (${fullName})` : ''}` : fullName || lookupKey
          );
        }
        if (!preferredByLookupKey.has(lookupKey)) {
          preferredByLookupKey.set(lookupKey, userName || fullName || lookupKey);
        }
      });
    return { lookupByAnyKey, displayByLookupKey, preferredByLookupKey };
  }, [staffMembers]);

  const resolveLoanLookupKey = useCallback((primary?: string, secondary?: string): string => {
    const candidates = [primary, secondary];
    for (const candidate of candidates) {
      const key = normalizeNameKey(candidate || '');
      if (!key) continue;
      const mapped = staffLookupMaps.lookupByAnyKey.get(key);
      if (mapped) return mapped;
    }
    return normalizeNameKey(primary || secondary || '');
  }, [staffLookupMaps]);

  const payrollRowIdentityLookupKeyMap = useMemo(() => {
    const byIdentity = new Map<string, string>();
    payrollMonthSheets
      .filter((sheet) => !sheet.deleted)
      .forEach((sheet) => {
        const attendanceImport = [...attendanceImports]
          .filter((item) => !item.deleted && item.monthKey === sheet.monthKey)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        const generated = generatePayrollRowsForMonth({
          monthKey: sheet.monthKey,
          staffMembers,
          attendanceImport,
          leaveRequests,
          leaveTypes,
        });
        generated.forEach((row) => {
          const rowLookupKey = resolveLoanLookupKey(
            String(row.values.userName || '').trim(),
            String(row.values.fullName || '').trim()
          );
          if (!rowLookupKey) return;
          byIdentity.set(`${sheet.monthKey}::${row.id}`, rowLookupKey);
        });
      });
    return byIdentity;
  }, [attendanceImports, leaveRequests, leaveTypes, payrollMonthSheets, resolveLoanLookupKey, staffMembers]);

  const payrollLoanDeductionsByLookupKey = useMemo(() => {
    const staffLookupById = new Map(
      staffMembers.map((staff) => [
        String(staff.id || '').trim(),
        resolveLoanLookupKey(String(staff.userName || ''), String(staff.fullName || '')),
      ])
    );
    const latestAttendanceByMonth = new Map<string, ReturnType<typeof attendanceImports.slice>[number]>();
    attendanceImports
      .filter((item) => !item.deleted)
      .forEach((item) => {
        const existing = latestAttendanceByMonth.get(item.monthKey);
        if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
          latestAttendanceByMonth.set(item.monthKey, item);
        }
      });

    const resolveRowLookupKey = (
      monthKey: string,
      rowId: string,
      rowValues: Record<string, string | number | null> | undefined
    ): string => {
      const overrideLookup = resolveLoanLookupKey(
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
        return resolveLoanLookupKey('', String(attRow?.employeeName || '').trim());
      }
      const staffId = suffix;
      const staffLookup = staffLookupById.get(staffId);
      if (staffLookup) return staffLookup;

      return payrollRowIdentityLookupKeyMap.get(`${monthKey}::${rowId}`) || '';
    };

    const deductions = new Map<string, number>();
    payrollMonthSheets
      .filter((sheet) => !sheet.deleted)
      .forEach((sheet) => {
        const rowOverrides = sheet.rowOverrides || {};
        Object.entries(rowOverrides).forEach(([rowId, values]) => {
          const amount = toNumberOrZero(values?.loans);
          if (amount <= 0) return;
          const key = resolveRowLookupKey(sheet.monthKey, rowId, values as Record<string, string | number | null>);
          if (!key) return;
          deductions.set(key, (deductions.get(key) || 0) + amount);
        });
      });
    return deductions;
  }, [attendanceImports, payrollMonthSheets, payrollRowIdentityLookupKeyMap, resolveLoanLookupKey, staffMembers]);

  const loanBalanceById = useMemo(() => {
    const balanceById = new Map<string, number>();
    const loansByLookup = new Map<string, HRLoanRecord[]>();
    loanItems
      .filter((row) => !row.deleted)
      .forEach((row) => {
        const key = resolveLoanLookupKey(row.name, row.name);
        if (!key) return;
        const list = loansByLookup.get(key) || [];
        list.push(row);
        loansByLookup.set(key, list);
      });

    loansByLookup.forEach((rows, key) => {
      const sorted = [...rows].sort((a, b) => (a.loanDate || '').localeCompare(b.loanDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
      let remainingDeduction = payrollLoanDeductionsByLookupKey.get(key) || 0;
      sorted.forEach((row) => {
        const principal = toNumberOrZero(row.loanAmount);
        const apr = toNumberOrZero(row.interestRate);
        const baseBalance = roundMoney(principal + (principal * apr) / 100);
        const applied = Math.min(Math.max(0, remainingDeduction), baseBalance);
        const remainingBalance = roundMoney(baseBalance - applied);
        remainingDeduction = Math.max(0, remainingDeduction - applied);
        balanceById.set(row.id, remainingBalance);
      });
    });

    return balanceById;
  }, [loanItems, payrollLoanDeductionsByLookupKey, resolveLoanLookupKey]);

  const handleHRUnlock = () => {
    if (hasSecuritySetup && !verifyModulePassword(hrLoginPassword)) {
      Alert.alert('Access Denied', 'Invalid HR module password.');
      return;
    }
    unlockHRSession();
    setHrLoginPassword('');
  };

  const handleSaveSecurity = async () => {
    if (!isSuperAdmin) {
      Alert.alert('Access Denied', 'Only super admins can update HR module security passwords.');
      return;
    }
    if (!modulePasswordInput.trim() || !authorizerPasswordInput.trim()) {
      Alert.alert('Missing Password', 'Enter both HR module password and authorizer password.');
      return;
    }
    setIsSavingSecurity(true);
    try {
      await setSecurityPasswords(modulePasswordInput, authorizerPasswordInput);
      setModulePasswordInput('');
      setAuthorizerPasswordInput('');
      Alert.alert('Saved', 'HR module passwords updated.');
    } catch (error) {
      Alert.alert('Error', (error as Error).message || 'Failed to save HR security settings.');
    } finally {
      setIsSavingSecurity(false);
    }
  };

  const handleSaveFingerprintSettings = async () => {
    if (!currentUser?.id) return;
    setIsSavingFingerprintSettings(true);
    try {
      await saveFingerprintPortalSettings({
        portalBaseUrl: fingerprintPortalBaseUrlInput.trim() || 'https://www.onlineebiocloud.com',
        corporateId: fingerprintCorporateIdInput.trim(),
        userName: fingerprintUserNameInput.trim(),
        password: fingerprintPasswordInput,
        monthlyReportPath: fingerprintMonthlyReportPathInput.trim() || 'NewMonthly.aspx',
      });
      Alert.alert('Saved', 'Fingerprint login settings saved and synced.');
    } catch (error) {
      Alert.alert('Save Failed', (error as Error).message || 'Failed to save fingerprint settings.');
    } finally {
      setIsSavingFingerprintSettings(false);
    }
  };

  const handleLoadHolidaysFromUrl = async () => {
    const url = calendarUrlInput.trim();
    if (!url) {
      Alert.alert('Missing URL', 'Enter a holiday ICS calendar URL first.');
      return;
    }
    setIsLoadingCalendar(true);
    try {
      let rawIcs = '';
      const proxyUrl = `${getApiBaseUrl()}/Tracker/api/hr-holiday-calendar-fetch.php?url=${encodeURIComponent(url)}`;
      try {
        const proxyResponse = await fetch(proxyUrl, { method: 'GET' });
        const proxyPayload = await proxyResponse.json().catch(() => ({} as any));
        if (!proxyResponse.ok || !proxyPayload?.success || typeof proxyPayload?.content !== 'string') {
          const reason = proxyPayload?.error || `Proxy request failed (${proxyResponse.status})`;
          throw new Error(String(reason));
        }
        rawIcs = proxyPayload.content;
      } catch (proxyError) {
        // Fallback direct fetch for environments where proxy is unavailable.
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
          throw new Error(
            `${(proxyError as Error)?.message || 'Proxy failed'} | Direct calendar request failed (${response.status})`
          );
        }
        rawIcs = await response.text();
      }

      const parsed = parseHolidaysFromIcs(rawIcs);
      if (!parsed.length) {
        Alert.alert('No Holidays Found', 'No valid holiday events were found in the linked calendar.');
        return;
      }

      const existingByKey = new Map(
        holidayItems.map((item) => [holidayKey(item.name, item.date), item] as const)
      );
      const merged: HRHolidayCalendarItem[] = parsed.map((item) => {
        const existing = existingByKey.get(holidayKey(item.name, item.date));
        if (existing) {
          return {
            ...existing,
            name: item.name,
            date: item.date,
          };
        }
        return {
          id: buildHolidayId(item.name, item.date),
          name: item.name,
          date: item.date,
          getPaid: false,
          times: 1,
        };
      });
      setHolidayItems(merged);
      setHolidayTimesInputs(
        Object.fromEntries(
          merged.map((item) => [item.id, String(item.times || 1)])
        )
      );
      Alert.alert('Calendar Loaded', `Loaded ${merged.length} holiday entries from the linked calendar.`);
    } catch (error) {
      Alert.alert('Calendar Load Failed', (error as Error).message || 'Failed to load holiday calendar.');
    } finally {
      setIsLoadingCalendar(false);
    }
  };

  const handleSaveHolidaySettings = async () => {
    if (!currentUser?.id) return;
    setIsSavingCalendar(true);
    try {
      await saveHolidayCalendarSettings({
        calendarUrl: calendarUrlInput.trim(),
        holidays: holidayItems,
      });
      Alert.alert('Saved', 'Holiday calendar settings saved.');
    } catch (error) {
      Alert.alert('Error', (error as Error).message || 'Failed to save holiday calendar settings.');
    } finally {
      setIsSavingCalendar(false);
    }
  };

  const updateHolidayField = (
    holidayId: string,
    updates: Partial<Pick<HRHolidayCalendarItem, 'getPaid' | 'times'>>
  ) => {
    setHolidayItems((prev) => prev.map((item) => (item.id === holidayId ? { ...item, ...updates } : item)));
  };

  const handleUnlockServiceChargeOptions = () => {
    if (!serviceChargeOptionsPassword.trim()) {
      Alert.alert('Missing Password', 'Enter authorizer password to open Service Charge options.');
      return;
    }
    if (!verifyAuthorizerPassword(serviceChargeOptionsPassword.trim())) {
      Alert.alert('Access Denied', 'Invalid authorizer password.');
      return;
    }
    setServiceChargeOptionsUnlocked(true);
    setServiceChargeOptionsPassword('');
  };

  const updateServiceChargeOption = (
    outletName: string,
    key: 'percentToStaff' | 'percentOther',
    value: string
  ) => {
    const parsed = parseNonNegativeNumberInput(value);
    if (parsed === null) return;
    setServiceChargeOptionRows((prev) =>
      prev.map((row) => (row.outletName === outletName ? { ...row, [key]: parsed } : row))
    );
  };

  const handleSaveServiceChargeOptions = async () => {
    if (!currentUser?.id) return;
    setIsSavingServiceChargeOptions(true);
    try {
      await saveServiceChargeSettings(
        serviceChargeOptionRows.map((row) => ({
          id: row.id,
          outletName: row.outletName,
          percentToStaff: toNumberOrZero(row.percentToStaff),
          percentOther: toNumberOrZero(row.percentOther),
        }))
      );
      setServiceChargeOptionsUnlocked(false);
      setShowServiceChargeOptions(false);
      setServiceChargeOptionsPassword('');
      Alert.alert('Saved', 'Service Charge options saved and locked.');
    } catch (error) {
      Alert.alert('Error', (error as Error).message || 'Failed to save service charge options.');
    } finally {
      setIsSavingServiceChargeOptions(false);
    }
  };

  const updateServiceChargeMonthRow = (outletName: string, value: string) => {
    const parsed = parseNonNegativeNumberInput(value);
    if (parsed === null && value.trim() !== '') return;
    const nextValue = parsed === null ? 0 : parsed;
    setServiceChargeMonthRows((prev) =>
      prev.map((row) => (row.outletName === outletName ? { ...row, serviceCharge: nextValue } : row))
    );
  };

  const handleLoadServiceChargeMonth = async () => {
    const normalizedMonth = normalizeMonthKey(serviceChargeMonthInput);
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) {
      Alert.alert('Invalid Month', 'Enter month in YYYY-MM format.');
      return;
    }
    setServiceChargeMonthInput(normalizedMonth);
    if (salesOutlets.length === 0) {
      Alert.alert('No Sales Outlets', 'Add sales outlets in Settings first.');
      return;
    }

    const [yearText, monthText] = normalizedMonth.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      Alert.alert('Invalid Month', 'Enter month in YYYY-MM format.');
      return;
    }
    const startDate = `${normalizedMonth}-01`;
    const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

    setIsLoadingServiceChargeMonth(true);
    try {
      try {
        await syncAllReconciliationData();
      } catch (syncError) {
        console.warn('[HR Setup] Service charge month load: reconciliation sync failed, using available data', syncError);
      }

      const outletTotals = new Map<string, number>();
      await Promise.all(
        salesOutlets.map(async (outletName) => {
          const reports = await getSalesReportsByOutletAndDateRange(outletName, startDate, endDate, { allowServerFetch: true });
          const total = roundMoney(
            reports.reduce((sum, report) => {
              const amount = Number(report?.serviceChargeAmount);
              return Number.isFinite(amount) ? sum + amount : sum;
            }, 0)
          );
          outletTotals.set(outletName, total);
        })
      );

      setServiceChargeMonthRows((previous) =>
        salesOutlets.map((outletName, idx) => {
          const existing = previous.find((row) => String(row.outletName || '').trim() === outletName);
          return {
            id: existing?.id || `hr-service-charge-month-row-${normalizedMonth}-${idx}`,
            outletName,
            serviceCharge: outletTotals.get(outletName) ?? 0,
            availableToStaff: Number(existing?.availableToStaff || 0),
          };
        })
      );

      const loadedTotal = roundMoney(Array.from(outletTotals.values()).reduce((sum, value) => sum + value, 0));
      Alert.alert('Month Loaded', `Loaded service charge from sales reconciliation for ${normalizedMonth}.\nTotal: ${loadedTotal.toFixed(2)}`);
    } catch (error) {
      Alert.alert('Load Failed', (error as Error).message || 'Failed to load service charge from sales reconciliation.');
    } finally {
      setIsLoadingServiceChargeMonth(false);
    }
  };

  const handlePreviousServiceChargeMonth = () => {
    setServiceChargeMonthInput((prev) => shiftMonthKey(prev, -1));
  };

  const handleNextServiceChargeMonth = () => {
    setServiceChargeMonthInput((prev) => shiftMonthKey(prev, 1));
  };

  const handleSaveServiceChargeMonth = async () => {
    if (!currentUser?.id) return;
    const normalizedMonth = normalizeMonthKey(serviceChargeMonthInput);
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) {
      Alert.alert('Invalid Month', 'Enter month in YYYY-MM format.');
      return;
    }
    setIsSavingServiceChargeMonth(true);
    try {
      await saveServiceChargeMonthEntry({
        monthKey: normalizedMonth,
        outletRows: serviceChargeMonthTotals.rows.map((row) => ({
          id: row.id,
          outletName: row.outletName,
          serviceCharge: toNumberOrZero(row.serviceCharge),
        })),
      });
      Alert.alert('Saved', `Service Charge month ${normalizedMonth} saved.`);
    } catch (error) {
      Alert.alert('Error', (error as Error).message || 'Failed to save service charge month data.');
    } finally {
      setIsSavingServiceChargeMonth(false);
    }
  };

  const handleAddLoan = () => {
    const userName = selectedLoanStaffUserName.trim();
    if (!userName) {
      Alert.alert('Select User Name', 'Select an active staff user name before adding a loan.');
      return;
    }
    const amount = parseNonNegativeNumberInput(newLoanAmountInput);
    if (amount === null || amount <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid loan amount greater than 0.');
      return;
    }
    const interest = parseNonNegativeNumberInput(newLoanInterestRateInput);
    if (interest === null) {
      Alert.alert('Invalid Interest Rate', 'Enter a valid interest rate (0 or higher).');
      return;
    }
    const loanDate = String(newLoanDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(loanDate)) {
      Alert.alert('Invalid Date', 'Enter loan date in YYYY-MM-DD format.');
      return;
    }

    const now = Date.now();
    setLoanItems((prev) => [
      ...prev,
      {
        id: `hr-loan-${now}-${Math.random().toString(36).slice(2, 7)}`,
        name: userName,
        loanDate,
        loanAmount: amount,
        interestRate: interest,
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser?.id || 'system',
      },
    ]);
    setLoanSearchInput('');
    setSelectedLoanStaffUserName('');
    setNewLoanAmountInput('');
    setNewLoanInterestRateInput('0');
  };

  const updateLoanField = (
    loanId: string,
    key: 'name' | 'loanDate' | 'loanAmount' | 'interestRate',
    value: string
  ) => {
    setLoanItems((prev) => prev.map((item) => {
      if (item.id !== loanId) return item;
      if (key === 'loanAmount' || key === 'interestRate') {
        const parsed = parseNonNegativeNumberInput(value);
        return { ...item, [key]: parsed === null ? item[key] : parsed };
      }
      return { ...item, [key]: value };
    }));
  };

  const handleDeleteLoan = (loanId: string) => {
    Alert.alert('Delete Loan', 'Are you sure you want to delete this loan record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setLoanItems((prev) => prev.filter((item) => item.id !== loanId));
        },
      },
    ]);
  };

  const handleSaveLoans = async () => {
    if (!currentUser?.id) return;
    const cleaned = loanItems
      .map((item) => {
        const resolvedKey = resolveLoanLookupKey(item.name, item.name);
        const canonicalName = staffLookupMaps.preferredByLookupKey.get(resolvedKey) || String(item.name || '').trim();
        return {
          id: String(item.id || '').trim(),
          name: canonicalName,
          loanDate: String(item.loanDate || '').trim(),
          loanAmount: toNumberOrZero(item.loanAmount),
          interestRate: toNumberOrZero(item.interestRate),
        };
      })
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        loanDate: String(item.loanDate || '').trim(),
      }))
      .filter((item) => item.id && item.name && item.loanDate);
    setIsSavingLoans(true);
    try {
      await saveLoanRecords(cleaned);
      Alert.alert('Saved', 'Loan settings saved.');
    } catch (error) {
      Alert.alert('Error', (error as Error).message || 'Failed to save loan settings.');
    } finally {
      setIsSavingLoans(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.push('/hr' as any)}>
            <ArrowLeft size={20} color={Colors.light.tint} />
            <Text style={styles.backButtonText}>Back to HR</Text>
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>HR Setup</Text>
            <Text style={styles.headerSubtitle}>Staff Master, HR Security, Holiday Calendar, Service Charge, Loans</Text>
          </View>
          <TouchableOpacity style={styles.syncButton} onPress={() => syncAll()} disabled={isSyncing}>
            {isSyncing ? <ActivityIndicator size="small" color={Colors.light.tint} /> : <RefreshCw size={18} color={Colors.light.tint} />}
          </TouchableOpacity>
        </View>

        {!isHRUnlocked ? (
          <View style={styles.lockedCard}>
            <ShieldCheck size={20} color="#2563EB" />
            <Text style={styles.lockedTitle}>HR Module Locked</Text>
            <Text style={styles.lockedHint}>Enter HR module password to open HR Setup.</Text>
            <TextInput
              style={styles.input}
              placeholder="HR module password"
              secureTextEntry
              value={hrLoginPassword}
              onChangeText={setHrLoginPassword}
            />
            <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={handleHRUnlock}>
              <Text style={styles.primaryButtonText}>Unlock HR Setup</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Staff Master</Text>
              <Text style={styles.sectionHint}>Open the dedicated staff master page from here.</Text>
              <TouchableOpacity
                style={[styles.actionButton, styles.primaryButton]}
                onPress={() => router.push('/hr-staff' as any)}
              >
                <Users size={16} color="#fff" />
                <Text style={styles.primaryButtonText}>Open Staff Master Page</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>HR Security</Text>
              <Text style={styles.sectionHint}>
                Configure HR module password and authorizer password used for unlocking payroll month editing.
              </Text>
              <View style={styles.infoInlineRow}>
                <Text style={styles.infoTiny}>
                  Security setup: {hasSecuritySetup ? 'Configured' : 'Not configured yet'}
                </Text>
                {securitySettings?.updatedAt ? (
                  <Text style={styles.infoTiny}>
                    Last updated: {new Date(securitySettings.updatedAt).toLocaleString()}
                  </Text>
                ) : null}
              </View>
              {isSuperAdmin ? (
                <View style={styles.formCard}>
                  <Text style={styles.formTitle}>{hasSecuritySetup ? 'Update Passwords' : 'Create Passwords'}</Text>
                  <View style={styles.formGrid}>
                    <TextInput
                      style={styles.input}
                      placeholder="HR module password"
                      secureTextEntry
                      value={modulePasswordInput}
                      onChangeText={setModulePasswordInput}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Authorizer password"
                      secureTextEntry
                      value={authorizerPasswordInput}
                      onChangeText={setAuthorizerPasswordInput}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.secondaryButton]}
                    onPress={handleSaveSecurity}
                    disabled={isSavingSecurity}
                  >
                    {isSavingSecurity ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Save HR Security</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.infoTiny}>Only super admins can change HR security passwords.</Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fingerprint Portal (Pull Report)</Text>
              <Text style={styles.sectionHint}>
                These credentials are used by `Pull Report` in Staff HR & Payroll and sync across devices.
              </Text>
              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => setShowFingerprintPortal((prev) => !prev)}
              >
                <Text style={styles.secondaryButtonText}>{showFingerprintPortal ? 'Hide' : 'Show'} Fingerprint Portal</Text>
              </TouchableOpacity>
              {showFingerprintPortal && (
                <View style={styles.formCard}>
                  <View style={styles.formGrid}>
                    <TextInput
                      style={styles.input}
                      placeholder="Portal Base URL"
                      value={fingerprintPortalBaseUrlInput}
                      onChangeText={setFingerprintPortalBaseUrlInput}
                      autoCapitalize="none"
                      autoCorrect={false}
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
                        <Text style={styles.primaryButtonText}>Save Fingerprint Settings</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Holiday Calendar</Text>
              <Text style={styles.sectionHint}>
                Link an ICS calendar URL and configure paid-holiday rules (Get Paid + Times) for each holiday.
              </Text>
              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => setShowHolidayCalendar((prev) => !prev)}
              >
                <Text style={styles.secondaryButtonText}>{showHolidayCalendar ? 'Hide' : 'Show'} Holiday Calendar</Text>
              </TouchableOpacity>

              {showHolidayCalendar && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="https://www.officeholidays.com/ics/ics_country_code.php?iso=LK"
                    value={calendarUrlInput}
                    onChangeText={setCalendarUrlInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.secondaryButton]}
                      onPress={handleLoadHolidaysFromUrl}
                      disabled={isLoadingCalendar}
                    >
                      {isLoadingCalendar ? (
                        <ActivityIndicator size="small" color={Colors.light.tint} />
                      ) : (
                        <>
                          <Download size={14} color={Colors.light.tint} />
                          <Text style={styles.secondaryButtonText}>Load Holidays</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.primaryButton]}
                      onPress={handleSaveHolidaySettings}
                      disabled={isSavingCalendar}
                    >
                      {isSavingCalendar ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.primaryButtonText}>Save Holiday Settings</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.infoTiny}>
                    Holidays: {holidayStats.total} | Get Paid enabled: {holidayStats.paidCount}
                  </Text>

                  {holidayItems.length === 0 ? (
                    <Text style={styles.emptyText}>No holiday rows loaded yet.</Text>
                  ) : (
                    <View style={styles.holidayList}>
                      {holidayItems.map((item) => (
                        <View key={item.id} style={styles.holidayRow}>
                          <View style={styles.holidayMain}>
                            <Text style={styles.holidayName}>{item.name}</Text>
                            <Text style={styles.holidayDate}>{item.date}</Text>
                          </View>
                          <View style={styles.holidayControls}>
                            <View style={styles.switchWrap}>
                              <Text style={styles.controlLabel}>Get Paid</Text>
                              <Switch
                                value={!!item.getPaid}
                                onValueChange={(value) => updateHolidayField(item.id, { getPaid: value })}
                              />
                            </View>
                            <View style={styles.timesWrap}>
                              <Text style={styles.controlLabel}>Times</Text>
                              <TextInput
                                style={[styles.timesInput, !item.getPaid && styles.timesInputDisabled]}
                                value={holidayTimesInputs[item.id] ?? String(item.times || 1)}
                                onChangeText={(text) => {
                                  setHolidayTimesInputs((prev) => ({ ...prev, [item.id]: text }));
                                  const parsed = parsePositiveDecimalInput(text);
                                  if (parsed !== null) {
                                    updateHolidayField(item.id, { times: parsed });
                                  }
                                }}
                                onBlur={() => {
                                  setHolidayTimesInputs((prev) => ({
                                    ...prev,
                                    [item.id]: String(item.times || 1),
                                  }));
                                }}
                                keyboardType="decimal-pad"
                                editable={item.getPaid}
                              />
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Service Charge</Text>
              <Text style={styles.sectionHint}>
                Outlet list is imported from Settings (Sales outlets only). Save `Options` first, then add monthly Service Charge values.
              </Text>
              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => setShowServiceCharge((prev) => !prev)}
              >
                <Text style={styles.secondaryButtonText}>{showServiceCharge ? 'Hide' : 'Show'} Service Charge</Text>
              </TouchableOpacity>

              {showServiceCharge && (
                <>
                  {salesOutlets.length === 0 ? (
                    <Text style={styles.emptyText}>No sales outlets found in Settings.</Text>
                  ) : (
                    <>
                      <View style={styles.buttonRow}>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.secondaryButton]}
                          onPress={() => setShowServiceChargeOptions((prev) => !prev)}
                        >
                          <Text style={styles.secondaryButtonText}>Options</Text>
                        </TouchableOpacity>
                        <Text style={styles.infoTiny}>Sales outlets loaded: {salesOutlets.length}</Text>
                      </View>

                      {showServiceChargeOptions && (
                        <View style={styles.formCard}>
                          {!serviceChargeOptionsUnlocked ? (
                            <>
                              <Text style={styles.formTitle}>Service Charge Options (Protected)</Text>
                              <TextInput
                                style={styles.input}
                                placeholder="Authorizer password"
                                secureTextEntry
                                value={serviceChargeOptionsPassword}
                                onChangeText={setServiceChargeOptionsPassword}
                              />
                              <TouchableOpacity
                                style={[styles.actionButton, styles.secondaryButton]}
                                onPress={handleUnlockServiceChargeOptions}
                              >
                                <Text style={styles.secondaryButtonText}>Unlock Options</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <>
                              <Text style={styles.formTitle}>Service Charge Options</Text>
                              <ScrollView horizontal style={styles.loanTableWrap}>
                                <View>
                                  <View style={styles.loanHeaderRow}>
                                    {['Sales Outlet', '% To Staff', '% Other'].map((header) => (
                                      <Text key={header} style={[styles.loanCell, styles.loanHeaderCell]}>{header}</Text>
                                    ))}
                                  </View>
                                  {serviceChargeOptionRows.map((row) => (
                                    <View key={row.id} style={styles.loanRow}>
                                      <Text style={styles.loanCell}>{row.outletName}</Text>
                                      <View style={styles.loanCell}>
                                        <TextInput
                                          style={styles.loanInput}
                                          value={String(row.percentToStaff ?? 0)}
                                          placeholder="0"
                                          keyboardType="decimal-pad"
                                          onChangeText={(text) => updateServiceChargeOption(row.outletName, 'percentToStaff', text)}
                                        />
                                      </View>
                                      <View style={styles.loanCell}>
                                        <TextInput
                                          style={styles.loanInput}
                                          value={String(row.percentOther ?? 0)}
                                          placeholder="0"
                                          keyboardType="decimal-pad"
                                          onChangeText={(text) => updateServiceChargeOption(row.outletName, 'percentOther', text)}
                                        />
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              </ScrollView>
                              <TouchableOpacity
                                style={[styles.actionButton, styles.primaryButton]}
                                onPress={handleSaveServiceChargeOptions}
                                disabled={isSavingServiceChargeOptions}
                              >
                                {isSavingServiceChargeOptions ? (
                                  <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                  <Text style={styles.primaryButtonText}>Save Options</Text>
                                )}
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      )}

                      <View style={styles.formCard}>
                        <Text style={styles.formTitle}>Add Month</Text>
                        <View style={styles.buttonRow}>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.secondaryButton]}
                            onPress={handlePreviousServiceChargeMonth}
                          >
                            <Text style={styles.secondaryButtonText}>Previous Month</Text>
                          </TouchableOpacity>
                          <TextInput
                            style={styles.input}
                            placeholder="YYYY-MM"
                            value={serviceChargeMonthInput}
                            onChangeText={setServiceChargeMonthInput}
                          />
                          <TouchableOpacity
                            style={[styles.actionButton, styles.secondaryButton]}
                            onPress={handleNextServiceChargeMonth}
                          >
                            <Text style={styles.secondaryButtonText}>Next Month</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.secondaryButton]}
                            onPress={handleLoadServiceChargeMonth}
                            disabled={isLoadingServiceChargeMonth}
                          >
                            {isLoadingServiceChargeMonth ? (
                              <ActivityIndicator size="small" color={Colors.light.tint} />
                            ) : (
                              <Text style={styles.secondaryButtonText}>Load Month</Text>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.primaryButton]}
                            onPress={handleSaveServiceChargeMonth}
                            disabled={isSavingServiceChargeMonth}
                          >
                            {isSavingServiceChargeMonth ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.primaryButtonText}>Save Month</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.infoTiny}>Month: {normalizeMonthKey(serviceChargeMonthInput)}</Text>
                        <ScrollView horizontal style={styles.loanTableWrap}>
                          <View>
                            <View style={styles.loanHeaderRow}>
                              {['Sales Outlet', 'Service Charge', 'Service Charge Available'].map((header) => (
                                <Text key={header} style={[styles.loanCell, styles.loanHeaderCell]}>{header}</Text>
                              ))}
                            </View>
                            {serviceChargeMonthTotals.rows.map((row) => (
                              <View key={row.id} style={styles.loanRow}>
                                <Text style={styles.loanCell}>{row.outletName}</Text>
                                <View style={styles.loanCell}>
                                  <TextInput
                                    style={styles.loanInput}
                                    value={String(row.serviceCharge ?? 0)}
                                    placeholder="0"
                                    keyboardType="decimal-pad"
                                    onChangeText={(text) => updateServiceChargeMonthRow(row.outletName, text)}
                                  />
                                </View>
                                <Text style={styles.loanCell}>{row.availableToStaff.toFixed(2)}</Text>
                              </View>
                            ))}
                            <View style={styles.loanHeaderRow}>
                              <Text style={[styles.loanCell, styles.loanHeaderCell]}>Total</Text>
                              <Text style={[styles.loanCell, styles.loanHeaderCell]}>-</Text>
                              <Text style={[styles.loanCell, styles.loanHeaderCell]}>{serviceChargeMonthTotals.totalAvailableToStaff.toFixed(2)}</Text>
                            </View>
                          </View>
                        </ScrollView>
                      </View>
                    </>
                  )}
                </>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Loans</Text>
              <Text style={styles.sectionHint}>
                Maintain staff loan records and live balances. Loan balance is reduced automatically by payroll `Loans` deductions.
              </Text>
              <TouchableOpacity
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => setShowLoans((prev) => !prev)}
              >
                <Text style={styles.secondaryButtonText}>{showLoans ? 'Hide' : 'Show'} Loans</Text>
              </TouchableOpacity>

              {showLoans && (
                <>
                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.secondaryButton]}
                      onPress={() => {
                        setShowAddLoanForm((prev) => !prev);
                        if (showAddLoanForm) {
                          setLoanSearchFocused(false);
                          setLoanSearchInput('');
                          setSelectedLoanStaffUserName('');
                        }
                      }}
                    >
                      <Plus size={14} color={Colors.light.tint} />
                      <Text style={styles.secondaryButtonText}>{showAddLoanForm ? 'Hide Add Loan' : 'Add Loan'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.primaryButton]}
                      onPress={handleSaveLoans}
                      disabled={isSavingLoans}
                    >
                      {isSavingLoans ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.primaryButtonText}>Save Loans</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {showAddLoanForm && (
                    <View style={styles.loanAddCard}>
                      <Text style={styles.formTitle}>Add Loan (Active Staff User Name)</Text>
                      <View style={styles.loanSearchWrap}>
                        <TextInput
                          style={styles.input}
                          placeholder="Search user name"
                          value={loanSearchInput}
                          onFocus={() => setLoanSearchFocused(true)}
                          onBlur={() => {
                            setTimeout(() => setLoanSearchFocused(false), 120);
                          }}
                          onChangeText={(text) => {
                            setLoanSearchInput(text);
                            setSelectedLoanStaffUserName('');
                          }}
                        />
                        {(loanSearchFocused || !!loanSearchInput.trim()) && (
                          <ScrollView style={styles.loanSearchList}>
                            {filteredLoanStaffOptions.length === 0 ? (
                              <Text style={styles.emptyText}>No active staff users found for this search.</Text>
                            ) : (
                              filteredLoanStaffOptions.map((staff) => {
                                const selected = selectedLoanStaffUserName === staff.userName;
                                return (
                                  <TouchableOpacity
                                    key={staff.id || staff.userName}
                                    style={[styles.loanSearchItem, selected && styles.loanSearchItemSelected]}
                                    onPress={() => {
                                      setSelectedLoanStaffUserName(staff.userName);
                                      setLoanSearchInput(staff.userName);
                                      setLoanSearchFocused(false);
                                    }}
                                  >
                                    <Text style={[styles.loanSearchItemTitle, selected && styles.loanSearchItemTitleSelected]}>
                                      {staff.userName}
                                    </Text>
                                    {staff.fullName ? <Text style={styles.loanSearchItemSub}>{staff.fullName}</Text> : null}
                                  </TouchableOpacity>
                                );
                              })
                            )}
                          </ScrollView>
                        )}
                      </View>
                      {selectedLoanStaffUserName ? (
                        <Text style={styles.infoTiny}>Selected user name: {selectedLoanStaffUserName}</Text>
                      ) : (
                        <Text style={styles.infoTiny}>Pick one active staff user name from the dropdown.</Text>
                      )}
                      <View style={styles.buttonRow}>
                        <TextInput
                          style={[styles.input, styles.loanFieldInput]}
                          value={newLoanDate}
                          placeholder="YYYY-MM-DD"
                          onChangeText={setNewLoanDate}
                        />
                        <TextInput
                          style={[styles.input, styles.loanFieldInput]}
                          value={newLoanAmountInput}
                          placeholder="Loan Amount"
                          keyboardType="decimal-pad"
                          onChangeText={setNewLoanAmountInput}
                        />
                        <TextInput
                          style={[styles.input, styles.loanFieldInput]}
                          value={newLoanInterestRateInput}
                          placeholder="Interest Rate (APR %)"
                          keyboardType="decimal-pad"
                          onChangeText={setNewLoanInterestRateInput}
                        />
                        <TouchableOpacity
                          style={[styles.actionButton, styles.secondaryButton]}
                          onPress={handleAddLoan}
                        >
                          <Plus size={14} color={Colors.light.tint} />
                          <Text style={styles.secondaryButtonText}>Add Loan Row</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {loanItems.length === 0 ? (
                    <Text style={styles.emptyText}>No loans added yet.</Text>
                  ) : (
                    <ScrollView horizontal style={styles.loanTableWrap}>
                      <View>
                        <View style={styles.loanHeaderRow}>
                          {['User Name', 'Loan Date', 'Loan Amount', 'Interest Rate', 'Loan Balance', 'Action'].map((header) => (
                            <Text key={header} style={[styles.loanCell, styles.loanHeaderCell]}>{header}</Text>
                          ))}
                        </View>
                        {loanItems.map((item) => {
                          const principal = toNumberOrZero(item.loanAmount);
                          const apr = toNumberOrZero(item.interestRate);
                          const baseBalance = roundMoney(principal + (principal * apr) / 100);
                          const remainingBalance = loanBalanceById.get(item.id) ?? baseBalance;
                          return (
                            <View key={item.id} style={styles.loanRow}>
                              <View style={styles.loanCell}>
                                <TextInput
                                  style={styles.loanInput}
                                  value={item.name}
                                  placeholder="User Name"
                                  onChangeText={(text) => updateLoanField(item.id, 'name', text)}
                                />
                                {(() => {
                                  const lookupKey = resolveLoanLookupKey(item.name, item.name);
                                  const label = staffLookupMaps.displayByLookupKey.get(lookupKey);
                                  if (!label || label === item.name) return null;
                                  return <Text style={styles.loanTinyLabel}>{label}</Text>;
                                })()}
                              </View>
                              <View style={styles.loanCell}>
                                <TextInput
                                  style={styles.loanInput}
                                  value={item.loanDate}
                                  placeholder="YYYY-MM-DD"
                                  onChangeText={(text) => updateLoanField(item.id, 'loanDate', text)}
                                />
                              </View>
                              <View style={styles.loanCell}>
                                <TextInput
                                  style={styles.loanInput}
                                  value={String(item.loanAmount ?? 0)}
                                  placeholder="0"
                                  keyboardType="decimal-pad"
                                  onChangeText={(text) => updateLoanField(item.id, 'loanAmount', text)}
                                />
                              </View>
                              <View style={styles.loanCell}>
                                <TextInput
                                  style={styles.loanInput}
                                  value={String(item.interestRate ?? 0)}
                                  placeholder="APR %"
                                  keyboardType="decimal-pad"
                                  onChangeText={(text) => updateLoanField(item.id, 'interestRate', text)}
                                />
                              </View>
                              <Text style={styles.loanCell}>{remainingBalance.toFixed(2)}</Text>
                              <View style={styles.loanCell}>
                                <TouchableOpacity
                                  style={styles.deleteLoanButton}
                                  onPress={() => handleDeleteLoan(item.id)}
                                >
                                  <Trash2 size={14} color="#fff" />
                                  <Text style={styles.deleteLoanButtonText}>Delete</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </ScrollView>
                  )}
                </>
              )}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
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
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
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
  actionButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  secondaryButton: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
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
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  holidayList: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  holidayRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    padding: 10,
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  holidayMain: {
    gap: 2,
  },
  holidayName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  holidayDate: {
    fontSize: 12,
    color: '#475569',
  },
  holidayControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'center',
  },
  switchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timesWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlLabel: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  timesInput: {
    minWidth: 72,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  timesInputDisabled: {
    backgroundColor: '#F1F5F9',
    color: '#94A3B8',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
  },
  loanAddCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
    gap: 8,
    backgroundColor: '#F8FAFC',
  },
  loanSearchWrap: {
    position: 'relative',
    zIndex: 20,
  },
  loanFieldInput: {
    minWidth: 130,
    flexGrow: 1,
  },
  loanSearchList: {
    maxHeight: 240,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    padding: 6,
    marginTop: 6,
  },
  loanSearchItem: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  loanSearchItemSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  loanSearchItemTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  loanSearchItemTitleSelected: {
    color: '#1D4ED8',
  },
  loanSearchItemSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  loanTableWrap: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
  },
  loanHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  loanRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  loanCell: {
    width: 170,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
  },
  loanHeaderCell: {
    fontWeight: '700',
    color: '#334155',
  },
  loanInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontSize: 12,
  },
  loanTinyLabel: {
    marginTop: 4,
    fontSize: 10,
    color: '#64748B',
  },
  deleteLoanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#B91C1C',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteLoanButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
});
