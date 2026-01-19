import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LeaveType, LeaveRequest, LeaveRequestStatus } from '@/types';
import { syncData } from '@/utils/syncData';
import { useAuth } from './AuthContext';

const LEAVE_TYPES_KEY = '@leave_types';
const LEAVE_REQUESTS_KEY = '@leave_requests';

const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { id: 'annual', name: 'Annual Leave', color: '#3B82F6', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sick', name: 'Sick Leave', color: '#EF4444', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'casual', name: 'Casual Leave', color: '#10B981', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'maternity', name: 'Maternity Leave', color: '#EC4899', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'paternity', name: 'Paternity Leave', color: '#8B5CF6', createdAt: Date.now(), updatedAt: Date.now() },
];

interface LeaveContextType {
  leaveTypes: LeaveType[];
  leaveRequests: LeaveRequest[];
  isLoading: boolean;
  isSyncing: boolean;
  addLeaveType: (name: string, color: string) => Promise<void>;
  updateLeaveType: (id: string, updates: Partial<LeaveType>) => Promise<void>;
  deleteLeaveType: (id: string) => Promise<void>;
  addLeaveRequest: (request: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
  updateLeaveRequestStatus: (id: string, status: LeaveRequestStatus, reviewNotes?: string) => Promise<void>;
  deleteLeaveRequest: (id: string) => Promise<void>;
  syncAll: () => Promise<void>;
  getLeaveTypeById: (id: string) => LeaveType | undefined;
  getPendingRequests: () => LeaveRequest[];
  getMyRequests: () => LeaveRequest[];
}

const LeaveContext = createContext<LeaveContextType | undefined>(undefined);

export function LeaveProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [typesData, requestsData] = await Promise.all([
        AsyncStorage.getItem(LEAVE_TYPES_KEY),
        AsyncStorage.getItem(LEAVE_REQUESTS_KEY),
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

      const [localTypes, localRequests] = await Promise.all([
        AsyncStorage.getItem(LEAVE_TYPES_KEY),
        AsyncStorage.getItem(LEAVE_REQUESTS_KEY),
      ]);

      const parsedTypes = localTypes ? JSON.parse(localTypes) : DEFAULT_LEAVE_TYPES;
      const parsedRequests = localRequests ? JSON.parse(localRequests) : [];

      const [syncedTypes, syncedRequests] = await Promise.all([
        syncData<LeaveType>('leave_types', parsedTypes, currentUser.id),
        syncData<LeaveRequest>('leave_requests', parsedRequests, currentUser.id),
      ]);

      const activeTypes = syncedTypes.filter(t => !t.deleted);
      const activeRequests = syncedRequests.filter(r => !r.deleted);

      setLeaveTypes(activeTypes.length > 0 ? activeTypes : DEFAULT_LEAVE_TYPES);
      setLeaveRequests(activeRequests);

      await Promise.all([
        AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(syncedTypes)),
        AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(syncedRequests)),
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
        await syncData('leave_types', updated, currentUser.id);
      } catch (error) {
        console.error('[LeaveContext] Failed to sync leave types:', error);
      }
    }
  }, [leaveTypes, currentUser]);

  const updateLeaveType = useCallback(async (id: string, updates: Partial<LeaveType>) => {
    const updated = leaveTypes.map(t => 
      t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
    );
    setLeaveTypes(updated);
    await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(updated));

    if (currentUser) {
      try {
        await syncData('leave_types', updated, currentUser.id);
      } catch (error) {
        console.error('[LeaveContext] Failed to sync leave types:', error);
      }
    }
  }, [leaveTypes, currentUser]);

  const deleteLeaveType = useCallback(async (id: string) => {
    const updated = leaveTypes.map(t => 
      t.id === id ? { ...t, deleted: true, updatedAt: Date.now() } : t
    );
    setLeaveTypes(updated.filter(t => !t.deleted));
    await AsyncStorage.setItem(LEAVE_TYPES_KEY, JSON.stringify(updated));

    if (currentUser) {
      try {
        await syncData('leave_types', updated, currentUser.id);
      } catch (error) {
        console.error('[LeaveContext] Failed to sync leave types:', error);
      }
    }
  }, [leaveTypes, currentUser]);

  const addLeaveRequest = useCallback(async (request: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
    if (!currentUser) return;

    const newRequest: LeaveRequest = {
      ...request,
      id: `leave-req-${Date.now()}`,
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
  }, [leaveRequests, currentUser]);

  const updateLeaveRequestStatus = useCallback(async (id: string, status: LeaveRequestStatus, reviewNotes?: string) => {
    if (!currentUser) return;

    const updated = leaveRequests.map(r => 
      r.id === id ? { 
        ...r, 
        status, 
        reviewedBy: currentUser.username,
        reviewedAt: Date.now(),
        reviewNotes,
        updatedAt: Date.now() 
      } : r
    );
    setLeaveRequests(updated);
    await AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(updated));

    try {
      await syncData('leave_requests', updated, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync leave requests:', error);
    }
  }, [leaveRequests, currentUser]);

  const deleteLeaveRequest = useCallback(async (id: string) => {
    if (!currentUser) return;

    const updated = leaveRequests.map(r => 
      r.id === id ? { ...r, deleted: true, updatedAt: Date.now() } : r
    );
    setLeaveRequests(updated.filter(r => !r.deleted));
    await AsyncStorage.setItem(LEAVE_REQUESTS_KEY, JSON.stringify(updated));

    try {
      await syncData('leave_requests', updated, currentUser.id);
    } catch (error) {
      console.error('[LeaveContext] Failed to sync leave requests:', error);
    }
  }, [leaveRequests, currentUser]);

  const getLeaveTypeById = useCallback((id: string) => {
    return leaveTypes.find(t => t.id === id);
  }, [leaveTypes]);

  const getPendingRequests = useCallback(() => {
    return leaveRequests.filter(r => r.status === 'pending');
  }, [leaveRequests]);

  const getMyRequests = useCallback(() => {
    if (!currentUser) return [];
    return leaveRequests.filter(r => r.createdBy === currentUser.id);
  }, [leaveRequests, currentUser]);

  return (
    <LeaveContext.Provider value={{
      leaveTypes,
      leaveRequests,
      isLoading,
      isSyncing,
      addLeaveType,
      updateLeaveType,
      deleteLeaveType,
      addLeaveRequest,
      updateLeaveRequestStatus,
      deleteLeaveRequest,
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
