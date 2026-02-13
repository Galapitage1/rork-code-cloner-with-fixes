import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ActivityLog, ActivityType } from '@/types';
import { syncData } from '@/utils/syncManager';

const STORAGE_KEY = '@stock_app_activity_logs';

export const [ActivityLogProvider, useActivityLog] = createContextHook(() => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null>(null);
  const syncInProgressRef = useRef(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const logsData = await AsyncStorage.getItem(STORAGE_KEY);
        
        if (logsData) {
          try {
            const parsed = JSON.parse(logsData);
            if (Array.isArray(parsed)) {
              setLogs(parsed.filter((l: any) => !l?.deleted));
            }
          } catch (parseError) {
            console.error('[ActivityLogContext] Failed to parse logs:', parseError);
            await AsyncStorage.removeItem(STORAGE_KEY);
            setLogs([]);
          }
        }
      } catch (error) {
        console.error('[ActivityLogContext] Failed to load logs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  const setUser = useCallback((user: { id: string; username?: string; role?: 'superadmin' | 'admin' | 'user' } | null) => {
    setCurrentUser(user);
  }, []);

  const saveLogs = useCallback(async (logsData: ActivityLog[]) => {
    try {
      const logsWithTimestamp = logsData.map(l => ({
        ...l,
        createdAt: l.createdAt || Date.now(),
      }));
      
      const MAX_LOGS = 500;
      const trimmedLogs = logsWithTimestamp.length > MAX_LOGS
        ? logsWithTimestamp.slice(-MAX_LOGS)
        : logsWithTimestamp;
      
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedLogs));
        setLogs(trimmedLogs.filter(l => !l.deleted));
      } catch (storageError: any) {
        if (storageError?.message?.includes('QuotaExceededError') || storageError?.message?.includes('quota')) {
          console.warn('[ActivityLogContext] Storage quota exceeded, trimming logs to 100');
          const evenMoreTrimmed = logsWithTimestamp.slice(-100);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(evenMoreTrimmed));
          setLogs(evenMoreTrimmed.filter(l => !l.deleted));
        } else {
          throw storageError;
        }
      }

      try {
        if (currentUser?.id) {
          const synced = await syncData('activityLogs', trimmedLogs, currentUser.id);
          const trimmedSynced = Array.isArray(synced) && synced.length > MAX_LOGS
            ? synced.slice(-MAX_LOGS)
            : synced;
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedSynced));
          setLogs((trimmedSynced as any[]).filter(l => !l?.deleted));
        }
      } catch (e) {
        console.log('[ActivityLogContext] Sync failed, will retry later');
      }
    } catch (error) {
      console.error('[ActivityLogContext] Failed to save logs:', error);
    }
  }, [currentUser]);

  const logActivity = useCallback(async (
    type: ActivityType,
    outlet: string,
    description: string,
    metadata?: Record<string, any>
  ) => {
    if (!currentUser) {
      console.warn('[ActivityLogContext] Cannot log activity: No current user');
      return;
    }

    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const newLog: ActivityLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      date,
      time,
      outlet,
      username: currentUser.username || 'Unknown',
      userId: currentUser.id,
      description,
      metadata,
      createdAt: Date.now(),
    };

    const updatedLogs = [...logs, newLog];
    await saveLogs(updatedLogs);
  }, [currentUser, logs, saveLogs]);

  const getLogsByDate = useCallback((date: string) => {
    return logs.filter(log => log.date === date);
  }, [logs]);

  const getLogsByOutlet = useCallback((outlet: string) => {
    return logs.filter(log => log.outlet === outlet);
  }, [logs]);

  const getLogsByDateAndOutlet = useCallback((date: string, outlet: string) => {
    return logs.filter(log => log.date === date && log.outlet === outlet);
  }, [logs]);

  const clearAllLogs = useCallback(async () => {
    try {
      const deletedLogs = logs.map(l => ({ ...l, deleted: true as const, updatedAt: Date.now() }));
      await saveLogs(deletedLogs as any);
      
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      setLogs([]);
    } catch (error) {
      console.error('[ActivityLogContext] Failed to clear logs:', error);
      throw error;
    }
  }, [logs, saveLogs]);

  const syncLogs = useCallback(async (silent: boolean = false) => {
    if (!currentUser || syncInProgressRef.current) {
      return;
    }
    
    try {
      syncInProgressRef.current = true;
      if (!silent) {
        setIsSyncing(true);
      }
      const synced = await syncData('activityLogs', logs, currentUser.id);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(synced));
      setLogs((synced as any[]).filter(l => !l?.deleted));
    } catch (error) {
      console.error('[ActivityLogContext] syncLogs: Failed:', error);
      if (!silent) {
        throw error;
      }
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, [currentUser, logs]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (currentUser) {
      interval = setInterval(() => {
        syncLogs(true).catch((e) => console.log('[ActivityLogContext] Auto-sync error', e));
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentUser, syncLogs]);

  return useMemo(() => ({
    logs,
    isLoading,
    isSyncing,
    logActivity,
    getLogsByDate,
    getLogsByOutlet,
    getLogsByDateAndOutlet,
    clearAllLogs,
    syncLogs,
    setUser,
  }), [
    logs,
    isLoading,
    isSyncing,
    logActivity,
    getLogsByDate,
    getLogsByOutlet,
    getLogsByDateAndOutlet,
    clearAllLogs,
    syncLogs,
    setUser,
  ]);
});
