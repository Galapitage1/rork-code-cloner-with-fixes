import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LeaveType,
  LeaveRequest,
  LeaveRequestStatus,
  LeaveBalanceSecuritySettings,
  StaffLeaveBalance,
} from '@/types';
import { syncData } from '@/utils/syncData';
import { useAuth } from './AuthContext';

const LEAVE_TYPES_KEY = '@leave_types';
const LEAVE_REQUESTS_KEY = '@leave_requests';
const STAFF_LEAVE_BALANCES_KEY = '@staff_leave_balances';
const LEAVE_BALANCE_SECURITY_KEY = '@leave_balance_security';

const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { id: 'annual', name: 'Annual Leave', color: '#3B82F6', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sick', name: 'Sick Leave', color: '#EF4444', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'casual', name: 'Casual Leave', color: '#10B981', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'maternity', name: 'Maternity Leave', color: '#EC4899', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'paternity', name: 'Paternity Leave', color: '#8B5CF6', createdAt: Date.now(), updatedAt: Date.now() },
];

type LeaveAvailabilityYear = {
  year: number;
  requestedDays: number;
  totalDays: number;
  usedPendingDays: number;
  usedApprovedDays: number;
  remainingDaysBeforeRequest: number;
  remainingDaysAfterRequest: number;
  isEnough: boolean;
};

type LeaveAvailabilityCheck = {
  isEnough: boolean;
  message?: string;
  yearly: LeaveAvailabilityYear[];
};

type CheckLeaveAvailabilityInput = {
  staffId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  dayPortion?: number;
  excludeRequestId?: string;
};

interface LeaveContextType {
  leaveTypes: LeaveType[];
  leaveRequests: LeaveRequest[];
  staffLeaveBalances: StaffLeaveBalance[];
  hasLeaveBalancePassword: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  addLeaveType: (name: string, color: string) => Promise<void>;
  updateLeaveType: (id: string, updates: Partial<LeaveType>) => Promise<void>;
  deleteLeaveType: (id: string) => Promise<void>;
  addLeaveRequest: (request: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
  updateLeaveRequestStatus: (id: string, status: LeaveRequestStatus, reviewNotes?: string) => Promise<void>;
  deleteLeaveRequest: (id: string) => Promise<void>;
  setLeaveBalancePassword: (password: string) => Promise<void>;
  verifyLeaveBalancePassword: (password: string) => boolean;
  upsertStaffLeaveBalance: (input: {
    staffId: string;
    staffName: string;
    leaveTypeId: string;
    year: number;
    totalDays: number;
  }) => Promise<void>;
  deleteStaffLeaveBalance: (id: string) => Promise<void>;
  checkLeaveAvailability: (input: CheckLeaveAvailabilityInput) => LeaveAvailabilityCheck;
  syncAll: () => Promise<void>;
  getLeaveTypeById: (id: string) => LeaveType | undefined;
  getPendingRequests: () => LeaveRequest[];
  getMyRequests: () => LeaveRequest[];
}

const LeaveContext = createContext<LeaveContextType | undefined>(undefined);

function hashSecretValue(input: string): string {
  const value = String(input || '').trim();
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return `lvh1_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function parseISODateUTC(value: string): Date | null {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function splitDateRangeByYear(startDate: string, endDate: string): Record<number, number> | null {
  const start = parseISODateUTC(startDate);
  const end = parseISODateUTC(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return null;

  const counts: Record<number, number> = {};
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getUTCFullYear();
    counts[year] = (counts[year] || 0) + 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return counts;
}

function getNormalizedDayPortion(requestLike: { startDate: string; endDate: string; dayPortion?: number }): number {
  const start = String(requestLike.startDate || '').trim();
  const end = String(requestLike.endDate || '').trim();
  if (start !== end) return 1;
  return requestLike.dayPortion === 0.5 ? 0.5 : 1;
}

function getWeightedRequestDaysByYear(requestLike: { startDate: string; endDate: string; dayPortion?: number }): Record<number, number> {
  const byYear = splitDateRangeByYear(requestLike.startDate, requestLike.endDate) || {};
  const portion = getNormalizedDayPortion(requestLike);
  if (portion === 1) return byYear;
  const weighted: Record<number, number> = {};
  Object.entries(byYear).forEach(([yearText, dayCount]) => {
    weighted[Number(yearText)] = roundDays((Number(dayCount) || 0) * portion);
  });
  return weighted;
}

function roundDays(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function LeaveProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [staffLeaveBalances, setStaffLeaveBalances] = useState<StaffLeaveBalance[]>([]);
  const [leaveBalanceSecurity, setLeaveBalanceSecurity] = useState<LeaveBalanceSecuritySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const hasLeaveBalancePassword = useMemo(
    () => !!(leaveBalanceSecurity && !leaveBalanceSecurity.deleted && leaveBalanceSecurity.accessPasswordHash),
    [leaveBalanceSecurity]
  );

  const checkLeaveAvailability = useCallback((input: CheckLeaveAvailabilityInput): LeaveAvailabilityCheck => {
    const staffId = String(input.staffId || '').trim();
    const leaveTypeId = String(input.leaveTypeId || '').trim();
    const startDate = String(input.startDate || '').trim();
    const endDate = String(input.endDate || '').trim();
    const excludeRequestId = String(input.excludeRequestId || '').trim();

    if (!staffId || !leaveTypeId) {
      return { isEnough: false, message: 'Please select staff and leave type.', yearly: [] };
    }

    const requestedByYear = getWeightedRequestDaysByYear({
      startDate,
      endDate,
      dayPortion: input.dayPortion,
    });
    if (!requestedByYear || Object.keys(requestedByYear).length === 0) {
      return { isEnough: false, message: 'Invalid leave date range.', yearly: [] };
    }

    const requestsForStaffLeaveType = leaveRequests.filter((row) => {
      if (row.deleted) return false;
      if (row.id === excludeRequestId) return false;
      if (row.staffId !== staffId) return false;
      if (row.leaveTypeId !== leaveTypeId) return false;
      return row.status === 'pending' || row.status === 'approved';
    });

    const yearly: LeaveAvailabilityYear[] = Object.entries(requestedByYear)
      .map(([yearText, requestedDaysRaw]) => {
        const year = Number(yearText);
        const requestedDays = roundDays(Number(requestedDaysRaw) || 0);

        const matchingBalances = staffLeaveBalances
          .filter((row) => !row.deleted && row.staffId === staffId && row.leaveTypeId === leaveTypeId && Number(row.year) === year)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        const totalDays = roundDays(Number(matchingBalances[0]?.totalDays || 0));

        let usedPendingDays = 0;
        let usedApprovedDays = 0;
        requestsForStaffLeaveType.forEach((row) => {
          const daysByYear = getWeightedRequestDaysByYear(row);
          const days = Number(daysByYear[year] || 0);
          if (!days) return;
          if (row.status === 'approved') {
            usedApprovedDays += days;
          } else {
            usedPendingDays += days;
          }
        });

        usedPendingDays = roundDays(usedPendingDays);
        usedApprovedDays = roundDays(usedApprovedDays);
        const remainingDaysBeforeRequest = roundDays(totalDays - usedPendingDays - usedApprovedDays);
        const remainingDaysAfterRequest = roundDays(remainingDaysBeforeRequest - requestedDays);

        return {
          year,
          requestedDays,
          totalDays,
          usedPendingDays,
          usedApprovedDays,
          remainingDaysBeforeRequest,
          remainingDaysAfterRequest,
          isEnough: remainingDaysAfterRequest >= 0,
        };
      })
      .sort((a, b) => a.year - b.year);

    const failedYear = yearly.find((row) => !row.isEnough);
    if (!failedYear) {
      return { isEnough: true, yearly };
    }

    const leaveTypeName = leaveTypes.find((row) => row.id === leaveTypeId)?.name || 'selected leave type';
    return {
      isEnough: false,
      yearly,
      message: `Not enough ${leaveTypeName} balance for ${failedYear.year}. Available ${failedYear.remainingDaysBeforeRequest} day(s), requested ${failedYear.requestedDays} day(s).`,
    };
  }, [leaveRequests, leaveTypes, staffLeaveBalances]);

  const loadData = useCallback(async () => {
    try {
      const [typesData, requestsData, balancesData, securityData] = await Promise.all([
        AsyncStorage.getItem(LEAVE_TYPES_KEY),
        AsyncStorage.getItem(LEAVE_REQUESTS_KEY),
        AsyncStorage.getItem(STAFF_LEAVE_BALANCES_KEY),
        AsyncStorage.getItem(LEAVE_BALANCE_SECURITY_KEY),
      ]);

      if (typesData) {
        const parsed = JSON.parse(typesData);
        setLeaveTypes(parsed.filter((t: LeaveType) => !t.deleted));
      } else {
        setLeaveTypes(DEFAULT_LEAVE_TYPES);
        await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(DEFAULT_LEAVE_TYPES));
      }

      if (requestsData) {
        const parsed = JSON.parse(requestsData);
        setLeaveRequests(parsed.filter((r: LeaveRequest) => !r.deleted));
      }

      if (balancesData) {
        const parsed = JSON.parse(balancesData);
        const rows = (Array.isArray(parsed) ? parsed : []).filter((row: StaffLeaveBalance) => !row.deleted);
        setStaffLeaveBalances(rows);
      }

      if (securityData) {
        const parsed = JSON.parse(securityData);
        setLeaveBalanceSecurity(parsed && !parsed.deleted ? parsed : null);
      }
    } catch (error) {
      console.error('[LeaveContext] Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const syncAll = useCallback(async () => {
    if (!currentUser || isSyncing) return;

    try {
      setIsSyncing(true);

      const [localTypes, localRequests, localBalances, localSecurity] = await Promise.all([
        AsyncStorage.getItem(LEAVE_TYPES_KEY),
        AsyncStorage.getItem(LEAVE_REQUESTS_KEY),
        AsyncStorage.getItem(STAFF_LEAVE_BALANCES_KEY),
        AsyncStorage.getItem(LEAVE_BALANCE_SECURITY_KEY),
      ]);

      const parsedTypes = localTypes ? JSON.parse(localTypes) : DEFAULT_LEAVE_TYPES;
      const parsedRequests = localRequests ? JSON.parse(localRequests) : [];
      const parsedBalances = localBalances ? JSON.parse(localBalances) : [];
      const parsedSecurityRows: LeaveBalanceSecuritySettings[] = localSecurity
        ? [JSON.parse(localSecurity)].filter((row) => row && !row.deleted)
        : [];

      const [syncedTypes, syncedRequests, syncedBalances, syncedSecurityRows] = await Promise.all([
        syncData<LeaveType>('leave_types', parsedTypes, currentUser.id),
        syncData<LeaveRequest>('leave_requests', parsedRequests, currentUser.id),
        syncData<StaffLeaveBalance>('staff_leave_balances', parsedBalances, currentUser.id),
        syncData<LeaveBalanceSecuritySettings>('leave_balance_security_settings', parsedSecurityRows, currentUser.id),
      ]);

      const activeTypes = syncedTypes.filter((row) => !row.deleted);
      const activeRequests = syncedRequests.filter((row) => !row.deleted);
      const activeBalances = syncedBalances.filter((row) => !row.deleted);
      const activeSecurity = [...syncedSecurityRows]
        .filter((row) => !row.deleted)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;

      setLeaveTypes(activeTypes.length > 0 ? activeTypes : DEFAULT_LEAVE_TYPES);
      setLeaveRequests(activeRequests);
      setStaffLeaveBalances(activeBalances);
      setLeaveBalanceSecurity(activeSecurity);

      await Promise.all([
        AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(syncedTypes)),
        AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(syncedRequests)),
        AsyncStorage.setItem(STAFF_LEAVE_BALANCES_KEY, JSON.stringify(syncedBalances)),
        activeSecurity
          ? AsyncStorage.setItem(LEAVE_BALANCE_SECURITY_KEY, JSON.stringify(activeSecurity))
          : AsyncStorage.removeItem(LEAVE_BALANCE_SECURITY_KEY),
      ]);
    } catch (error) {
      console.error('[LeaveContext] Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [currentUser, isSyncing]);

  const addLeaveType = useCallback(async (name: string, color: string) => {
    const newType: LeaveType = {
      id: `leave-type-${Date.now()}`,
      name,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updated = [...leaveTypes, newType];
    setLeaveTypes(updated);
    await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(updated));

    if (currentUser) {
      try {
        const synced = await syncData<LeaveType>('leave_types', updated, currentUser.id);
        const active = synced.filter((row) => !row.deleted);
        setLeaveTypes(active.length > 0 ? active : DEFAULT_LEAVE_TYPES);
        await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(synced));
      } catch (error) {
        console.error('[LeaveContext] Failed to sync leave types:', error);
      }
    }
  }, [leaveTypes, currentUser]);

  const updateLeaveType = useCallback(async (id: string, updates: Partial<LeaveType>) => {
    const updated = leaveTypes.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
    );
    setLeaveTypes(updated);
    await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(updated));

    if (currentUser) {
      try {
        const synced = await syncData<LeaveType>('leave_types', updated, currentUser.id);
        const active = synced.filter((row) => !row.deleted);
        setLeaveTypes(active.length > 0 ? active : DEFAULT_LEAVE_TYPES);
        await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(synced));
      } catch (error) {
        console.error('[LeaveContext] Failed to sync leave types:', error);
      }
    }
  }, [leaveTypes, currentUser]);

  const deleteLeaveType = useCallback(async (id: string) => {
    const updated = leaveTypes.map((t) =>
      t.id === id ? { ...t, deleted: true, updatedAt: Date.now() } : t
    );
    setLeaveTypes(updated.filter((t) => !t.deleted));
    await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(updated));

    if (currentUser) {
      try {
        const synced = await syncData<LeaveType>('leave_types', updated, currentUser.id);
        const active = synced.filter((row) => !row.deleted);
        setLeaveTypes(active.length > 0 ? active : DEFAULT_LEAVE_TYPES);
        await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(synced));
      } catch (error) {
        console.error('[LeaveContext] Failed to sync leave types:', error);
      }
    }
  }, [leaveTypes, currentUser]);

  const addLeaveRequest = useCallback(async (request: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
    if (!currentUser) return;

    const staffId = String(request.staffId || '').trim();
    if (!staffId) {
      throw new Error('Please select a staff member from active HR staff.');
    }

    const normalizedDayPortion = (request.startDate === request.endDate && request.dayPortion === 0.5) ? 0.5 : 1;

    const availability = checkLeaveAvailability({
      staffId,
      leaveTypeId: request.leaveTypeId,
      startDate: request.startDate,
      endDate: request.endDate,
      dayPortion: normalizedDayPortion,
    });
    if (!availability.isEnough) {
      throw new Error(availability.message || 'Not enough leave balance.');
    }

    const newRequest: LeaveRequest = {
      ...request,
      staffId,
      dayPortion: normalizedDayPortion,
      id: `leave-req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: currentUser.id,
    };

    const updated = [...leaveRequests, newRequest];
    setLeaveRequests(updated);
    await AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(updated));

    try {
      await syncData('leave_requests', updated, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync leave requests:', error);
    }
  }, [checkLeaveAvailability, currentUser, leaveRequests]);

  const updateLeaveRequestStatus = useCallback(async (id: string, status: LeaveRequestStatus, reviewNotes?: string) => {
    if (!currentUser) return;

    const existing = leaveRequests.find((row) => row.id === id && !row.deleted);
    if (!existing) {
      throw new Error('Leave request not found.');
    }

    if (status === 'approved') {
      const staffId = String(existing.staffId || '').trim();
      if (staffId) {
        const availability = checkLeaveAvailability({
          staffId,
          leaveTypeId: existing.leaveTypeId,
          startDate: existing.startDate,
          endDate: existing.endDate,
          excludeRequestId: existing.id,
        });
        if (!availability.isEnough) {
          throw new Error(availability.message || 'Not enough leave balance to approve this request.');
        }
      }
    }

    const updated = leaveRequests.map((row) =>
      row.id === id ? {
        ...row,
        status,
        reviewedBy: currentUser.username,
        reviewedAt: Date.now(),
        reviewNotes,
        updatedAt: Date.now(),
      } : row
    );
    setLeaveRequests(updated);
    await AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(updated));

    try {
      await syncData('leave_requests', updated, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync leave requests:', error);
    }
  }, [checkLeaveAvailability, currentUser, leaveRequests]);

  const deleteLeaveRequest = useCallback(async (id: string) => {
    if (!currentUser) return;

    const updated = leaveRequests.map((row) =>
      row.id === id ? { ...row, deleted: true, updatedAt: Date.now() } : row
    );
    setLeaveRequests(updated.filter((row) => !row.deleted));
    await AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(updated));

    try {
      await syncData('leave_requests', updated, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync leave requests:', error);
    }
  }, [leaveRequests, currentUser]);

  const setLeaveBalancePassword = useCallback(async (password: string) => {
    if (!currentUser) return;

    const plain = String(password || '').trim();
    if (plain.length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }

    const now = Date.now();
    const next: LeaveBalanceSecuritySettings = leaveBalanceSecurity
      ? {
          ...leaveBalanceSecurity,
          accessPasswordHash: hashSecretValue(plain),
          updatedAt: now,
          updatedBy: currentUser.id,
          deleted: false,
        }
      : {
          id: `leave-balance-security-${now}`,
          accessPasswordHash: hashSecretValue(plain),
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
        };

    setLeaveBalanceSecurity(next);
    await AsyncStorage.setItem(LEAVE_BALANCE_SECURITY_KEY, JSON.stringify(next));

    try {
      await syncData('leave_balance_security_settings', [next], currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync leave balance security:', error);
    }
  }, [currentUser, leaveBalanceSecurity]);

  const verifyLeaveBalancePassword = useCallback((password: string) => {
    const plain = String(password || '').trim();
    if (!plain || !leaveBalanceSecurity || leaveBalanceSecurity.deleted) return false;
    return leaveBalanceSecurity.accessPasswordHash === hashSecretValue(plain);
  }, [leaveBalanceSecurity]);

  const upsertStaffLeaveBalance = useCallback(async (input: {
    staffId: string;
    staffName: string;
    leaveTypeId: string;
    year: number;
    totalDays: number;
  }) => {
    if (!currentUser) return;

    const staffId = String(input.staffId || '').trim();
    const staffName = String(input.staffName || '').trim();
    const leaveTypeId = String(input.leaveTypeId || '').trim();
    const year = Number(input.year);
    const totalDays = roundDays(Math.max(0, Number(input.totalDays) || 0));

    if (!staffId || !staffName || !leaveTypeId || !Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new Error('Invalid leave balance details.');
    }

    const now = Date.now();
    const existing = [...staffLeaveBalances]
      .filter((row) => !row.deleted && row.staffId === staffId && row.leaveTypeId === leaveTypeId && Number(row.year) === year)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

    const nextRow: StaffLeaveBalance = existing
      ? {
          ...existing,
          staffName,
          totalDays,
          updatedAt: now,
          updatedBy: currentUser.id,
          deleted: false,
        }
      : {
          id: `staff-leave-balance-${now}-${Math.random().toString(36).slice(2, 8)}`,
          staffId,
          staffName,
          leaveTypeId,
          year,
          totalDays,
          createdAt: now,
          updatedAt: now,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
        };

    const allRows = existing
      ? staffLeaveBalances.map((row) => row.id === existing.id ? nextRow : row)
      : [...staffLeaveBalances, nextRow];

    setStaffLeaveBalances(allRows.filter((row) => !row.deleted));
    await AsyncStorage.setItem(STAFF_LEAVE_BALANCES_KEY, JSON.stringify(allRows));

    try {
      await syncData('staff_leave_balances', allRows, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync staff leave balances:', error);
    }
  }, [currentUser, staffLeaveBalances]);

  const deleteStaffLeaveBalance = useCallback(async (id: string) => {
    if (!currentUser) return;
    const now = Date.now();
    const allRows = staffLeaveBalances.map((row) =>
      row.id === id ? { ...row, deleted: true, updatedAt: now, updatedBy: currentUser.id } : row
    );
    setStaffLeaveBalances(allRows.filter((row) => !row.deleted));
    await AsyncStorage.setItem(STAFF_LEAVE_BALANCES_KEY, JSON.stringify(allRows));

    try {
      await syncData('staff_leave_balances', allRows, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync staff leave balances:', error);
    }
  }, [currentUser, staffLeaveBalances]);

  const getLeaveTypeById = useCallback((id: string) => {
    return leaveTypes.find((row) => row.id === id);
  }, [leaveTypes]);

  const getPendingRequests = useCallback(() => {
    return leaveRequests.filter((row) => row.status === 'pending');
  }, [leaveRequests]);

  const getMyRequests = useCallback(() => {
    if (!currentUser) return [];
    return leaveRequests.filter((row) => row.createdBy === currentUser.id);
  }, [leaveRequests, currentUser]);

  return (
    <LeaveContext.Provider value={{
      leaveTypes,
      leaveRequests,
      staffLeaveBalances,
      hasLeaveBalancePassword,
      isLoading,
      isSyncing,
      addLeaveType,
      updateLeaveType,
      deleteLeaveType,
      addLeaveRequest,
      updateLeaveRequestStatus,
      deleteLeaveRequest,
      setLeaveBalancePassword,
      verifyLeaveBalancePassword,
      upsertStaffLeaveBalance,
      deleteStaffLeaveBalance,
      checkLeaveAvailability,
      syncAll,
      getLeaveTypeById,
      getPendingRequests,
      getMyRequests,
    }}>
      {children}
    </LeaveContext.Provider>
  );
}

export function useLeave() {
  const context = useContext(LeaveContext);
  if (!context) {
    throw new Error('useLeave must be used within a LeaveProvider');
  }
  return context;
}
