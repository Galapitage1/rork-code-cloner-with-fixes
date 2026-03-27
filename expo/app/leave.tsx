import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { Calendar, Plus, Check, X, Clock, ChevronDown, ArrowLeft, KeyRound, ShieldCheck, Pencil, Trash2 } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useLeave } from '@/contexts/LeaveContext';
import { useAuth } from '@/contexts/AuthContext';
import { useHR } from '@/contexts/HRContext';
import { CalendarModal } from '@/components/CalendarModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import Colors from '@/constants/colors';
import { LeaveRequest } from '@/types';

type FilterStatus = 'pending' | 'approved' | 'rejected';

export default function LeaveScreen() {
  const router = useRouter();
  const { currentUser, isSuperAdmin, isAdmin } = useAuth();
  const { staffMembers, syncAll: syncHRData } = useHR();
  const { 
    leaveTypes, 
    leaveRequests, 
    staffLeaveBalances,
    hasLeaveBalancePassword,
    isLoading, 
    syncAll: syncLeaveData,
    addLeaveRequest, 
    updateLeaveRequestStatus,
    deleteLeaveRequest,
    setLeaveBalancePassword,
    verifyLeaveBalancePassword,
    upsertStaffLeaveBalance,
    deleteStaffLeaveBalance,
    checkLeaveAvailability,
    getLeaveTypeById,
  } = useLeave();

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [staffPickerSearch, setStaffPickerSearch] = useState('');
  const [selectedLeaveType, setSelectedLeaveType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showLeaveTypePicker, setShowLeaveTypePicker] = useState(false);
  const [showDayPortionPicker, setShowDayPortionPicker] = useState(false);
  const [selectedDayPortion, setSelectedDayPortion] = useState<'full' | 'half'>('full');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [leaveBalanceUnlocked, setLeaveBalanceUnlocked] = useState(false);
  const [leaveBalancePasswordInput, setLeaveBalancePasswordInput] = useState('');
  const [newLeaveBalancePassword, setNewLeaveBalancePassword] = useState('');
  const [confirmLeaveBalancePassword, setConfirmLeaveBalancePassword] = useState('');
  const [balanceStaffId, setBalanceStaffId] = useState('');
  const [balanceLeaveTypeId, setBalanceLeaveTypeId] = useState('');
  const [balanceYear, setBalanceYear] = useState(String(new Date().getFullYear()));
  const [balanceTotalDays, setBalanceTotalDays] = useState('');
  const [showBalanceStaffPicker, setShowBalanceStaffPicker] = useState(false);
  const [showBalanceLeaveTypePicker, setShowBalanceLeaveTypePicker] = useState(false);

  const canManageBalances = isAdmin || isSuperAdmin;
  const activeStaffMembers = useMemo(
    () => staffMembers
      .filter((row) => !row.deleted && row.active !== false)
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staffMembers]
  );
  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    staffMembers
      .filter((row) => !row.deleted)
      .forEach((row) => {
        if (row.id) map.set(row.id, row.fullName || row.userName || row.id);
      });
    return map;
  }, [staffMembers]);

  const selectedRequestStaff = useMemo(
    () => activeStaffMembers.find((row) => row.id === selectedStaffId),
    [activeStaffMembers, selectedStaffId]
  );
  const filteredRequestPickerStaff = useMemo(() => {
    const query = staffPickerSearch.trim().toLowerCase();
    if (!query) return activeStaffMembers;
    return activeStaffMembers.filter((row) => {
      const userName = String(row.userName || '').toLowerCase();
      const fullName = String(row.fullName || '').toLowerCase();
      return userName.includes(query) || fullName.includes(query);
    });
  }, [activeStaffMembers, staffPickerSearch]);

  const selectedDayPortionValue = useMemo(() => {
    const isSingleDay = !!startDate && !!endDate && startDate === endDate;
    if (!isSingleDay) return 1;
    return selectedDayPortion === 'half' ? 0.5 : 1;
  }, [startDate, endDate, selectedDayPortion]);

  const latestLeaveBalanceByKey = useMemo(() => {
    const map = new Map<string, number>();
    staffLeaveBalances
      .filter((row) => !row.deleted)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .forEach((row) => {
        const key = `${row.staffId}__${row.leaveTypeId}__${row.year}`;
        if (!map.has(key)) {
          map.set(key, Number(row.totalDays) || 0);
        }
      });
    return map;
  }, [staffLeaveBalances]);

  const getWeightedRequestDaysByYear = (requestLike: { startDate: string; endDate: string; dayPortion?: number }) => {
    const start = new Date(requestLike.startDate);
    const end = new Date(requestLike.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return {} as Record<number, number>;
    const dayPortion =
      requestLike.startDate === requestLike.endDate && requestLike.dayPortion === 0.5 ? 0.5 : 1;
    const out: Record<number, number> = {};
    const cursor = new Date(start.getTime());
    while (cursor <= end) {
      const year = cursor.getFullYear();
      out[year] = (out[year] || 0) + dayPortion;
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  };

  useFocusEffect(
    useCallback(() => {
      syncHRData(true);
      syncLeaveData();
    }, [syncHRData, syncLeaveData])
  );

  useEffect(() => {
    if (!selectedStaffId) return;
    const stillValid = activeStaffMembers.some((row) => row.id === selectedStaffId);
    if (!stillValid) {
      setSelectedStaffId(activeStaffMembers[0]?.id || '');
    }
  }, [activeStaffMembers, selectedStaffId]);

  useEffect(() => {
    if (!balanceStaffId) return;
    const stillValid = activeStaffMembers.some((row) => row.id === balanceStaffId);
    if (!stillValid) {
      setBalanceStaffId(activeStaffMembers[0]?.id || '');
    }
  }, [activeStaffMembers, balanceStaffId]);

  useEffect(() => {
    if (!startDate || !endDate) return;
    if (startDate !== endDate && selectedDayPortion !== 'full') {
      setSelectedDayPortion('full');
    }
  }, [startDate, endDate, selectedDayPortion]);

  useEffect(() => {
    if (!showStaffPicker) {
      setStaffPickerSearch('');
    }
  }, [showStaffPicker]);

  const leaveAvailabilityPreview = useMemo(() => {
    if (!selectedStaffId || !selectedLeaveType || !startDate || !endDate) return null;
    return checkLeaveAvailability({
      staffId: selectedStaffId,
      leaveTypeId: selectedLeaveType,
      startDate,
      endDate,
      dayPortion: selectedDayPortionValue,
    });
  }, [selectedStaffId, selectedLeaveType, startDate, endDate, checkLeaveAvailability, selectedDayPortionValue]);

  const selectedBalanceYear = useMemo(() => {
    const parsed = parseInt(balanceYear, 10);
    if (!Number.isInteger(parsed)) return new Date().getFullYear();
    return Math.max(2000, Math.min(2100, parsed));
  }, [balanceYear]);

  const balancesForYear = useMemo(
    () => staffLeaveBalances
      .filter((row) => !row.deleted && Number(row.year) === selectedBalanceYear)
      .slice()
      .sort((a, b) => {
        if (a.staffName !== b.staffName) return a.staffName.localeCompare(b.staffName);
        const leaveA = getLeaveTypeById(a.leaveTypeId)?.name || a.leaveTypeId;
        const leaveB = getLeaveTypeById(b.leaveTypeId)?.name || b.leaveTypeId;
        return leaveA.localeCompare(leaveB);
      }),
    [staffLeaveBalances, selectedBalanceYear, getLeaveTypeById]
  );

  const visibleRequests = useMemo(() => {
    const scoped = isSuperAdmin ? leaveRequests : leaveRequests.filter((r) => r.createdBy === currentUser?.id);
    return scoped.filter((r) => !r.deleted);
  }, [leaveRequests, isSuperAdmin, currentUser]);

  const statusCounts = useMemo(() => {
    return {
      pending: visibleRequests.filter((r) => r.status === 'pending').length,
      approved: visibleRequests.filter((r) => r.status === 'approved').length,
      rejected: visibleRequests.filter((r) => r.status === 'rejected').length,
    };
  }, [visibleRequests]);

  const filteredRequests = useMemo(() => {
    return visibleRequests
      .filter((r) => r.status === filterStatus)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [visibleRequests, filterStatus]);

  const groupedRequests = useMemo(() => {
    const monthMap = new Map<
      string,
      {
        monthKey: string;
        monthLabel: string;
        sortValue: number;
        staffMap: Map<
          string,
          {
            staffKey: string;
            staffName: string;
            userName: string;
            totalDays: number;
            requests: LeaveRequest[];
          }
        >;
      }
    >();

    filteredRequests.forEach((request) => {
      const monthDate = new Date(request.startDate || request.createdAt || Date.now());
      const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const monthSortValue = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getTime();
      const staffLookup = activeStaffMembers.find((row) => row.id === request.staffId);
      const staffName = staffLookup?.fullName || request.employeeName || 'Unknown Staff';
      const userName = staffLookup?.userName || '-';
      const staffKey = request.staffId || request.employeeName || request.id;
      const requestDays = (() => {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
        const diffMs = Math.abs(end.getTime() - start.getTime());
        const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
        if (request.startDate === request.endDate && request.dayPortion === 0.5) return 0.5;
        return days;
      })();

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          monthKey,
          monthLabel,
          sortValue: monthSortValue,
          staffMap: new Map(),
        });
      }

      const monthGroup = monthMap.get(monthKey)!;
      if (!monthGroup.staffMap.has(staffKey)) {
        monthGroup.staffMap.set(staffKey, {
          staffKey,
          staffName,
          userName,
          totalDays: 0,
          requests: [],
        });
      }

      const staffGroup = monthGroup.staffMap.get(staffKey)!;
      staffGroup.requests.push(request);
      staffGroup.totalDays += Number(requestDays) || 0;
    });

    return Array.from(monthMap.values())
      .sort((a, b) => b.sortValue - a.sortValue)
      .map((monthGroup) => ({
        monthKey: monthGroup.monthKey,
        monthLabel: monthGroup.monthLabel,
        staffGroups: Array.from(monthGroup.staffMap.values())
          .map((staffGroup) => ({
            ...staffGroup,
            requests: staffGroup.requests.sort((a, b) => {
              const aTime = new Date(a.startDate || a.createdAt).getTime();
              const bTime = new Date(b.startDate || b.createdAt).getTime();
              return bTime - aTime;
            }),
          }))
          .sort((a, b) => a.staffName.localeCompare(b.staffName)),
      }));
  }, [filteredRequests, activeStaffMembers]);

  const resetForm = () => {
    setSelectedStaffId('');
    setSelectedLeaveType('');
    setStartDate('');
    setEndDate('');
    setSelectedDayPortion('full');
    setReason('');
  };

  const handleSubmitRequest = async () => {
    if (!selectedStaffId) {
      Alert.alert('Error', 'Please select a staff member');
      return;
    }
    if (!selectedLeaveType) {
      Alert.alert('Error', 'Please select a leave type');
      return;
    }
    if (!startDate) {
      Alert.alert('Error', 'Please select a start date');
      return;
    }
    if (!endDate) {
      Alert.alert('Error', 'Please select an end date');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      Alert.alert('Error', 'End date cannot be before start date');
      return;
    }
    if (!selectedRequestStaff) {
      Alert.alert('Error', 'Selected staff member is no longer active');
      return;
    }

    try {
      setIsSubmitting(true);
      await addLeaveRequest({
        staffId: selectedRequestStaff.id,
        employeeName: selectedRequestStaff.fullName,
        leaveTypeId: selectedLeaveType,
        startDate,
        endDate,
        dayPortion: selectedDayPortionValue,
        reason: reason.trim() || undefined,
      });
      Alert.alert('Success', 'Leave request submitted successfully');
      setShowRequestModal(false);
      resetForm();
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Failed to submit leave request';
      Alert.alert('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewRequest = (request: LeaveRequest, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setReviewAction(action);
    setReviewNotes('');
    setShowReviewModal(true);
  };

  const confirmReview = async () => {
    if (!selectedRequest) return;

    try {
      await updateLeaveRequestStatus(
        selectedRequest.id, 
        reviewAction === 'approve' ? 'approved' : 'rejected',
        reviewNotes.trim() || undefined
      );
      Alert.alert('Success', `Leave request ${reviewAction === 'approve' ? 'approved' : 'rejected'}`);
      setShowReviewModal(false);
      setSelectedRequest(null);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Failed to update leave request';
      Alert.alert('Error', message);
    }
  };

  const handleDeleteRequestWithOptions = (request: LeaveRequest) => {
    if (!isSuperAdmin) return;

    const runDeleteOnly = async () => {
      await deleteLeaveRequest(request.id);
      Alert.alert('Deleted', 'Leave request deleted without giving back leave amount.');
    };

    const runDeleteAndGiveBack = async () => {
      const staffId = String(request.staffId || '').trim();
      if (!staffId) {
        await deleteLeaveRequest(request.id);
        Alert.alert('Deleted', 'Leave request deleted. Staff was not linked, so no leave amount was added back.');
        return;
      }
      const staff = activeStaffMembers.find((row) => row.id === staffId);
      const staffName = staff?.fullName || request.employeeName || 'Staff';
      const byYear = getWeightedRequestDaysByYear(request);
      const yearEntries = Object.entries(byYear).filter(([, days]) => Number(days) > 0);
      for (const [yearText, days] of yearEntries) {
        const year = Number(yearText);
        const key = `${staffId}__${request.leaveTypeId}__${year}`;
        const currentTotal = latestLeaveBalanceByKey.get(key) || 0;
        await upsertStaffLeaveBalance({
          staffId,
          staffName,
          leaveTypeId: request.leaveTypeId,
          year,
          totalDays: currentTotal + Number(days),
        });
      }
      await deleteLeaveRequest(request.id);
      Alert.alert('Deleted', 'Leave request deleted and leave amount added back.');
    };

    Alert.alert(
      'Delete Leave Request',
      'Delete this leave request?\n\nYes = add leave amount back to staff.\nNo = just delete without giving back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'No (Just Delete)',
          style: 'destructive',
          onPress: async () => {
            try {
              await runDeleteOnly();
            } catch (error) {
              const message = error instanceof Error && error.message ? error.message : 'Failed to delete leave request';
              Alert.alert('Error', message);
            }
          },
        },
        {
          text: 'Yes (Give Back)',
          onPress: async () => {
            try {
              await runDeleteAndGiveBack();
            } catch (error) {
              const message = error instanceof Error && error.message ? error.message : 'Failed to delete leave request';
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };

  const resetBalanceEditorForm = () => {
    setBalanceStaffId('');
    setBalanceLeaveTypeId('');
    setBalanceTotalDays('');
  };

  const openBalanceEditor = () => {
    if (!canManageBalances) return;
    setShowBalanceModal(true);
    setLeaveBalanceUnlocked(false);
    setLeaveBalancePasswordInput('');
    setNewLeaveBalancePassword('');
    setConfirmLeaveBalancePassword('');
    resetBalanceEditorForm();
  };

  const closeBalanceEditor = () => {
    setShowBalanceModal(false);
    setLeaveBalanceUnlocked(false);
    setLeaveBalancePasswordInput('');
    setNewLeaveBalancePassword('');
    setConfirmLeaveBalancePassword('');
    resetBalanceEditorForm();
  };

  const handleUnlockBalanceEditor = async () => {
    if (!canManageBalances) return;

    if (!hasLeaveBalancePassword) {
      if (!newLeaveBalancePassword.trim() || !confirmLeaveBalancePassword.trim()) {
        Alert.alert('Error', 'Set and confirm the leave balance password');
        return;
      }
      if (newLeaveBalancePassword.trim() !== confirmLeaveBalancePassword.trim()) {
        Alert.alert('Error', 'Passwords do not match');
        return;
      }
      try {
        await setLeaveBalancePassword(newLeaveBalancePassword.trim());
        setLeaveBalanceUnlocked(true);
        setNewLeaveBalancePassword('');
        setConfirmLeaveBalancePassword('');
        Alert.alert('Saved', 'Leave balance password set successfully');
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'Failed to set password';
        Alert.alert('Error', message);
      }
      return;
    }

    if (!leaveBalancePasswordInput.trim()) {
      Alert.alert('Error', 'Enter password to continue');
      return;
    }
    if (!verifyLeaveBalancePassword(leaveBalancePasswordInput.trim())) {
      Alert.alert('Error', 'Invalid password');
      return;
    }
    setLeaveBalanceUnlocked(true);
    setLeaveBalancePasswordInput('');
  };

  const handleSaveStaffLeaveBalance = async () => {
    if (!leaveBalanceUnlocked) {
      Alert.alert('Locked', 'Unlock leave balance editor first');
      return;
    }
    const staff = activeStaffMembers.find((row) => row.id === balanceStaffId);
    if (!staff) {
      Alert.alert('Error', 'Please select an active staff member');
      return;
    }
    if (!balanceLeaveTypeId) {
      Alert.alert('Error', 'Please select a leave type');
      return;
    }
    const total = Number(balanceTotalDays);
    if (!Number.isFinite(total) || total < 0) {
      Alert.alert('Error', 'Enter a valid leave amount (0 or more)');
      return;
    }
    try {
      await upsertStaffLeaveBalance({
        staffId: staff.id,
        staffName: staff.fullName,
        leaveTypeId: balanceLeaveTypeId,
        year: selectedBalanceYear,
        totalDays: total,
      });
      Alert.alert('Saved', 'Staff leave balance saved');
      resetBalanceEditorForm();
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Failed to save leave balance';
      Alert.alert('Error', message);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const calculateDays = (start: string, end: string, dayPortion?: number) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    if (start === end && dayPortion === 0.5) return 0.5;
    return diffDays;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.backgroundContainer}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={24} color={Colors.light.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Leave Requests</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.statsRow}>
            <TouchableOpacity
              style={[
                styles.statCard,
                { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
                filterStatus === 'pending' && styles.statCardActive,
              ]}
              onPress={() => setFilterStatus('pending')}
            >
              <Clock size={20} color="#F59E0B" />
              <Text style={[styles.statNumber, { color: '#F59E0B' }]}>{statusCounts.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.statCard,
                { backgroundColor: '#D1FAE5', borderColor: '#10B981' },
                filterStatus === 'approved' && styles.statCardActive,
              ]}
              onPress={() => setFilterStatus('approved')}
            >
              <Check size={20} color="#10B981" />
              <Text style={[styles.statNumber, { color: '#10B981' }]}>{statusCounts.approved}</Text>
              <Text style={styles.statLabel}>Approved</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.statCard,
                { backgroundColor: '#FEE2E2', borderColor: '#EF4444' },
                filterStatus === 'rejected' && styles.statCardActive,
              ]}
              onPress={() => setFilterStatus('rejected')}
            >
              <X size={20} color="#EF4444" />
              <Text style={[styles.statNumber, { color: '#EF4444' }]}>{statusCounts.rejected}</Text>
              <Text style={styles.statLabel}>Rejected</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.newRequestButton}
              onPress={() => {
                if (activeStaffMembers.length === 0) {
                  Alert.alert('No Active Staff', 'No active staff members found in HR module. Please add staff details in HR first.');
                  return;
                }
                if (!selectedStaffId) {
                  setSelectedStaffId(activeStaffMembers[0].id);
                }
                setSelectedDayPortion('full');
                setShowRequestModal(true);
              }}
            >
              <Plus size={20} color="#FFFFFF" />
              <Text style={styles.newRequestButtonText}>New Request</Text>
            </TouchableOpacity>

            {canManageBalances && (
              <TouchableOpacity
                style={styles.balanceLinkButton}
                onPress={() => router.push('/staff-leave' as any)}
              >
                <ShieldCheck size={16} color={Colors.light.tint} />
                <Text style={styles.balanceLinkButtonText}>Staff Leave Page</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {groupedRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Calendar size={48} color={Colors.light.muted} />
                <Text style={styles.emptyStateText}>No leave requests found</Text>
                <Text style={styles.emptyStateSubtext}>Tap "New Request" to submit one</Text>
              </View>
            ) : (
              groupedRequests.map((monthGroup) => (
                <View key={monthGroup.monthKey} style={styles.monthBlock}>
                  <Text style={styles.monthTitle}>{monthGroup.monthLabel}</Text>

                  {monthGroup.staffGroups.map((staffGroup) => (
                    <View key={`${monthGroup.monthKey}-${staffGroup.staffKey}`} style={styles.staffGroupCard}>
                      <View style={styles.staffGroupHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.employeeName}>{staffGroup.staffName}</Text>
                          <Text style={styles.staffSubMeta}>
                            {staffGroup.userName || '-'} • {staffGroup.requests.length} request(s) • {staffGroup.totalDays.toFixed(1)} day(s)
                          </Text>
                        </View>
                      </View>

                      {staffGroup.requests.map((request) => {
                        const leaveType = getLeaveTypeById(request.leaveTypeId);
                        const isCompactApproved = filterStatus === 'approved';
                        return (
                          <View
                            key={request.id}
                            style={[
                              styles.requestLineItem,
                              isCompactApproved && styles.requestLineItemCompact,
                            ]}
                          >
                            <View style={styles.requestLineMain}>
                              <View style={[styles.leaveTypeBadge, { backgroundColor: leaveType?.color || Colors.light.muted }]}>
                                <Text style={styles.leaveTypeBadgeText}>{leaveType?.name || 'Unknown'}</Text>
                              </View>
                              <Text style={styles.requestLineDate}>
                                {formatDate(request.startDate)} - {formatDate(request.endDate)}
                              </Text>
                              <Text style={styles.requestLineDays}>
                                {calculateDays(request.startDate, request.endDate, request.dayPortion)} day(s)
                              </Text>
                            </View>

                            {!isCompactApproved && !!request.reason && (
                              <Text style={styles.reasonText}>Reason: {request.reason}</Text>
                            )}

                            {request.reviewedBy && !isCompactApproved && (
                              <View style={styles.reviewInfo}>
                                <Text style={styles.reviewInfoText}>
                                  {request.status === 'approved' ? 'Approved' : 'Rejected'} by {request.reviewedBy}
                                  {request.reviewedAt && ` on ${new Date(request.reviewedAt).toLocaleDateString()}`}
                                </Text>
                                {request.reviewNotes && <Text style={styles.reviewNotes}>Note: {request.reviewNotes}</Text>}
                              </View>
                            )}

                            {isSuperAdmin && (
                              <View style={styles.requestLineActions}>
                                {request.status === 'pending' && (
                                  <>
                                    <TouchableOpacity
                                      style={[styles.miniActionBtn, styles.approveMiniBtn]}
                                      onPress={() => handleReviewRequest(request, 'approve')}
                                    >
                                      <Check size={12} color="#FFFFFF" />
                                      <Text style={styles.miniActionBtnText}>Approve</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.miniActionBtn, styles.rejectMiniBtn]}
                                      onPress={() => handleReviewRequest(request, 'reject')}
                                    >
                                      <X size={12} color="#FFFFFF" />
                                      <Text style={styles.miniActionBtnText}>Reject</Text>
                                    </TouchableOpacity>
                                  </>
                                )}
                                <TouchableOpacity
                                  style={[styles.miniActionBtn, styles.deleteMiniBtn]}
                                  onPress={() => handleDeleteRequestWithOptions(request)}
                                >
                                  <Trash2 size={12} color="#FFFFFF" />
                                  <Text style={styles.miniActionBtnText}>Delete</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </View>

      <Modal
        visible={showRequestModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRequestModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Leave Request</Text>
              <TouchableOpacity onPress={() => setShowRequestModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Staff Member *</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => setShowStaffPicker(true)}
                >
                  <Text style={[styles.selectButtonText, !selectedRequestStaff && { color: Colors.light.muted }]}>
                    {selectedRequestStaff
                      ? `${selectedRequestStaff.userName || 'No Username'} - ${selectedRequestStaff.fullName}`
                      : 'Select staff by username'}
                  </Text>
                  <ChevronDown size={20} color={Colors.light.muted} />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Leave Type *</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => setShowLeaveTypePicker(true)}
                >
                  {selectedLeaveType ? (
                    <View style={styles.selectedLeaveType}>
                      <View style={[styles.leaveTypeColor, { backgroundColor: getLeaveTypeById(selectedLeaveType)?.color }]} />
                      <Text style={styles.selectButtonText}>{getLeaveTypeById(selectedLeaveType)?.name}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.selectButtonText, { color: Colors.light.muted }]}>Select leave type</Text>
                  )}
                  <ChevronDown size={20} color={Colors.light.muted} />
                </TouchableOpacity>
              </View>

              <View style={styles.dateInputsRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Start Date *</Text>
                  <TouchableOpacity
                    style={styles.selectButton}
                    onPress={() => setShowStartDatePicker(true)}
                  >
                    <Calendar size={18} color={Colors.light.muted} />
                    <Text style={[styles.selectButtonText, !startDate && { color: Colors.light.muted }]}>
                      {startDate ? formatDate(startDate) : 'Select date'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>End Date *</Text>
                  <TouchableOpacity
                    style={styles.selectButton}
                    onPress={() => setShowEndDatePicker(true)}
                  >
                    <Calendar size={18} color={Colors.light.muted} />
                    <Text style={[styles.selectButtonText, !endDate && { color: Colors.light.muted }]}>
                      {endDate ? formatDate(endDate) : 'Select date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {startDate && endDate && startDate === endDate && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Day Option</Text>
                  <TouchableOpacity
                    style={styles.selectButton}
                    onPress={() => setShowDayPortionPicker(true)}
                  >
                    <Text style={styles.selectButtonText}>
                      {selectedDayPortion === 'half' ? 'Half Day' : 'Full Day'}
                    </Text>
                    <ChevronDown size={20} color={Colors.light.muted} />
                  </TouchableOpacity>
                </View>
              )}

              {startDate && endDate && new Date(endDate) >= new Date(startDate) && (
                <View style={styles.durationInfo}>
                  <Text style={styles.durationText}>
                    Duration: {calculateDays(startDate, endDate, selectedDayPortionValue)} day(s)
                  </Text>
                </View>
              )}

              {leaveAvailabilityPreview && selectedLeaveType && (
                <View style={[styles.durationInfo, !leaveAvailabilityPreview.isEnough && styles.balanceWarningBox]}>
                  <Text style={[styles.durationText, !leaveAvailabilityPreview.isEnough && styles.balanceWarningText]}>
                    {leaveAvailabilityPreview.isEnough
                      ? 'Leave balance check passed.'
                      : (leaveAvailabilityPreview.message || 'Not enough leave balance')}
                  </Text>
                  {leaveAvailabilityPreview.yearly.map((row) => (
                    <Text
                      key={`availability-${row.year}`}
                      style={[styles.balanceYearText, !row.isEnough && styles.balanceWarningText]}
                    >
                      {row.year}: total {row.totalDays}, used {row.usedApprovedDays + row.usedPendingDays}, remaining {row.remainingDaysBeforeRequest}, request {row.requestedDays}
                    </Text>
                  ))}
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Reason (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Enter reason for leave"
                  placeholderTextColor={Colors.light.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  setShowRequestModal(false);
                  resetForm();
                }}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleSubmitRequest}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showStaffPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStaffPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowStaffPicker(false)}
        >
          <TouchableOpacity style={styles.pickerContent} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Select Staff</Text>
            <TextInput
              style={styles.pickerSearchInput}
              value={staffPickerSearch}
              onChangeText={setStaffPickerSearch}
              placeholder="Search by username or name"
              placeholderTextColor={Colors.light.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {activeStaffMembers.length === 0 ? (
              <Text style={styles.emptyPickerText}>No active staff found in HR.</Text>
            ) : filteredRequestPickerStaff.length === 0 ? (
              <Text style={styles.emptyPickerText}>No staff found for that search.</Text>
            ) : (
              <ScrollView style={styles.pickerList}>
                {filteredRequestPickerStaff.map((staff) => (
                  <TouchableOpacity
                    key={staff.id}
                    style={[
                      styles.pickerOption,
                      selectedStaffId === staff.id && styles.pickerOptionSelected
                    ]}
                  onPress={() => {
                      setSelectedStaffId(staff.id);
                      setShowStaffPicker(false);
                    }}
                  >
                    <View style={styles.pickerOptionMeta}>
                      <Text style={styles.pickerOptionPrimaryText}>{staff.userName || '-'}</Text>
                      <Text style={styles.pickerOptionSubText}>{staff.fullName}</Text>
                    </View>
                    {selectedStaffId === staff.id && <Check size={20} color={Colors.light.tint} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showLeaveTypePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLeaveTypePicker(false)}
      >
        <TouchableOpacity 
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowLeaveTypePicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Leave Type</Text>
            <ScrollView style={styles.pickerList}>
              {leaveTypes.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={[
                    styles.pickerOption,
                    selectedLeaveType === type.id && styles.pickerOptionSelected
                  ]}
                  onPress={() => {
                    setSelectedLeaveType(type.id);
                    setShowLeaveTypePicker(false);
                  }}
                >
                  <View style={[styles.leaveTypeColor, { backgroundColor: type.color }]} />
                  <Text style={styles.pickerOptionText}>{type.name}</Text>
                  {selectedLeaveType === type.id && <Check size={20} color={Colors.light.tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showDayPortionPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDayPortionPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowDayPortionPicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Day Option</Text>
            <ScrollView style={styles.pickerList}>
              {[
                { id: 'full', label: 'Full Day' },
                { id: 'half', label: 'Half Day' },
              ].map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.pickerOption,
                    selectedDayPortion === option.id && styles.pickerOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedDayPortion(option.id as 'full' | 'half');
                    setShowDayPortionPicker(false);
                  }}
                >
                  <Text style={styles.pickerOptionText}>{option.label}</Text>
                  {selectedDayPortion === option.id && <Check size={20} color={Colors.light.tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showBalanceModal}
        transparent
        animationType="slide"
        onRequestClose={closeBalanceEditor}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Staff Leave Amounts</Text>
              <TouchableOpacity onPress={closeBalanceEditor}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              {!leaveBalanceUnlocked ? (
                <View style={styles.lockedSection}>
                  <Text style={styles.inputLabel}>Access Control</Text>
                  {!hasLeaveBalancePassword ? (
                    <>
                      <Text style={styles.inputHint}>
                        Set a password for admins to access staff leave amount editing.
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={newLeaveBalancePassword}
                        onChangeText={setNewLeaveBalancePassword}
                        placeholder="New password"
                        placeholderTextColor={Colors.light.muted}
                        secureTextEntry
                      />
                      <TextInput
                        style={styles.input}
                        value={confirmLeaveBalancePassword}
                        onChangeText={setConfirmLeaveBalancePassword}
                        placeholder="Confirm password"
                        placeholderTextColor={Colors.light.muted}
                        secureTextEntry
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.inputHint}>
                        Enter leave balance password to add or edit staff leave amounts.
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={leaveBalancePasswordInput}
                        onChangeText={setLeaveBalancePasswordInput}
                        placeholder="Password"
                        placeholderTextColor={Colors.light.muted}
                        secureTextEntry
                      />
                    </>
                  )}

                  <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handleUnlockBalanceEditor}>
                    <KeyRound size={16} color="#FFFFFF" />
                    <Text style={styles.buttonText}>{hasLeaveBalancePassword ? 'Unlock' : 'Set Password & Unlock'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.inputLabel}>Year (starting from January)</Text>
                  <TextInput
                    style={styles.input}
                    value={balanceYear}
                    onChangeText={setBalanceYear}
                    placeholder="2026"
                    placeholderTextColor={Colors.light.muted}
                    keyboardType="numeric"
                  />

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Staff *</Text>
                    <TouchableOpacity
                      style={styles.selectButton}
                      onPress={() => setShowBalanceStaffPicker(true)}
                    >
                      <Text style={[styles.selectButtonText, !balanceStaffId && { color: Colors.light.muted }]}>
                        {activeStaffMembers.find((row) => row.id === balanceStaffId)?.fullName || 'Select active staff'}
                      </Text>
                      <ChevronDown size={20} color={Colors.light.muted} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Leave Type *</Text>
                    <TouchableOpacity
                      style={styles.selectButton}
                      onPress={() => setShowBalanceLeaveTypePicker(true)}
                    >
                      <Text style={[styles.selectButtonText, !balanceLeaveTypeId && { color: Colors.light.muted }]}>
                        {getLeaveTypeById(balanceLeaveTypeId)?.name || 'Select leave type'}
                      </Text>
                      <ChevronDown size={20} color={Colors.light.muted} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Total Leave Amount (days) *</Text>
                    <TextInput
                      style={styles.input}
                      value={balanceTotalDays}
                      onChangeText={setBalanceTotalDays}
                      placeholder="e.g. 14"
                      placeholderTextColor={Colors.light.muted}
                      keyboardType="numeric"
                    />
                  </View>

                  <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handleSaveStaffLeaveBalance}>
                    <Text style={styles.buttonText}>Save Leave Amount</Text>
                  </TouchableOpacity>

                  <Text style={styles.sectionMiniTitle}>Saved Leave Amounts - {selectedBalanceYear}</Text>
                  {balancesForYear.length === 0 ? (
                    <Text style={styles.emptyPickerText}>No staff leave amounts set for this year.</Text>
                  ) : (
                    balancesForYear.map((row) => {
                      const leaveType = getLeaveTypeById(row.leaveTypeId);
                      const liveStaffName = staffNameById.get(row.staffId) || row.staffName;
                      return (
                        <View key={row.id} style={styles.balanceRowCard}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.balanceRowTitle}>{liveStaffName}</Text>
                            <Text style={styles.balanceRowMeta}>
                              {leaveType?.name || row.leaveTypeId} - {row.totalDays} day(s)
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.miniIconButton}
                            onPress={() => {
                              setBalanceStaffId(row.staffId);
                              setBalanceLeaveTypeId(row.leaveTypeId);
                              setBalanceTotalDays(String(row.totalDays));
                            }}
                          >
                            <Pencil size={16} color={Colors.light.tint} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.miniIconButton}
                            onPress={async () => {
                              try {
                                await deleteStaffLeaveBalance(row.id);
                              } catch (error) {
                                const message = error instanceof Error && error.message ? error.message : 'Failed to delete leave amount';
                                Alert.alert('Error', message);
                              }
                            }}
                          >
                            <Trash2 size={16} color={Colors.light.danger} />
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showBalanceStaffPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBalanceStaffPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowBalanceStaffPicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Staff</Text>
            <ScrollView style={styles.pickerList}>
              {activeStaffMembers.map((staff) => (
                <TouchableOpacity
                  key={staff.id}
                  style={[styles.pickerOption, balanceStaffId === staff.id && styles.pickerOptionSelected]}
                  onPress={() => {
                    setBalanceStaffId(staff.id);
                    setShowBalanceStaffPicker(false);
                  }}
                >
                  <Text style={styles.pickerOptionText}>{staff.fullName}</Text>
                  {balanceStaffId === staff.id && <Check size={20} color={Colors.light.tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showBalanceLeaveTypePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBalanceLeaveTypePicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowBalanceLeaveTypePicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Leave Type</Text>
            <ScrollView style={styles.pickerList}>
              {leaveTypes.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={[styles.pickerOption, balanceLeaveTypeId === type.id && styles.pickerOptionSelected]}
                  onPress={() => {
                    setBalanceLeaveTypeId(type.id);
                    setShowBalanceLeaveTypePicker(false);
                  }}
                >
                  <View style={[styles.leaveTypeColor, { backgroundColor: type.color }]} />
                  <Text style={styles.pickerOptionText}>{type.name}</Text>
                  {balanceLeaveTypeId === type.id && <Check size={20} color={Colors.light.tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showReviewModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '50%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {reviewAction === 'approve' ? 'Approve' : 'Reject'} Request
              </Text>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Notes (Optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={reviewNotes}
                onChangeText={setReviewNotes}
                placeholder={reviewAction === 'approve' ? 'Add approval notes...' : 'Add rejection reason...'}
                placeholderTextColor={Colors.light.muted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, reviewAction === 'approve' ? styles.approveButtonFull : styles.rejectButtonFull]}
                onPress={confirmReview}
              >
                <Text style={styles.buttonText}>
                  {reviewAction === 'approve' ? 'Approve' : 'Reject'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CalendarModal
        visible={showStartDatePicker}
        onClose={() => setShowStartDatePicker(false)}
        onSelect={(date: string) => {
          setStartDate(date);
          setShowStartDatePicker(false);
        }}
        initialDate={startDate}
      />

      <CalendarModal
        visible={showEndDatePicker}
        onClose={() => setShowEndDatePicker(false)}
        onSelect={(date: string) => {
          setEndDate(date);
          setShowEndDatePicker(false);
        }}
        initialDate={endDate || startDate}
      />

      <ConfirmDialog
        visible={confirmVisible}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        destructive={!!confirmState?.destructive}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={async () => {
          try {
            await confirmState?.onConfirm?.();
          } finally {
            setConfirmVisible(false);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backgroundContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  statsRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  statCard: {
    flex: 1,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  statCardActive: {
    borderWidth: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700' as const,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  actionsRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  filterButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.tint,
  },
  newRequestButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
  },
  newRequestButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  balanceLinkButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  balanceLinkButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 4,
  },
  monthBlock: {
    marginBottom: 14,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  staffGroupCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  staffGroupHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  staffSubMeta: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 2,
  },
  requestLineItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 10,
    gap: 8,
  },
  requestLineItemCompact: {
    paddingVertical: 8,
    paddingHorizontal: 9,
    gap: 6,
  },
  requestLineMain: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  requestLineDate: {
    fontSize: 12,
    color: Colors.light.text,
    flex: 1,
    minWidth: 140,
  },
  requestLineDays: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  requestLineActions: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  miniActionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  approveMiniBtn: {
    backgroundColor: '#10B981',
  },
  rejectMiniBtn: {
    backgroundColor: '#EF4444',
  },
  deleteMiniBtn: {
    backgroundColor: '#B91C1C',
  },
  miniActionBtnText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 60,
    gap: 12,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  requestCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  requestHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  requestInfo: {
    flex: 1,
    gap: 6,
  },
  employeeName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  leaveTypeBadge: {
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  leaveTypeBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  dateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  dateInfo: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 11,
    color: Colors.light.muted,
    marginBottom: 2,
  },
  dateValue: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  dateDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.light.border,
    marginHorizontal: 12,
  },
  daysContainer: {
    alignItems: 'center' as const,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 12,
  },
  daysNumber: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  daysLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
  },
  reasonContainer: {
    marginBottom: 12,
  },
  reasonLabel: {
    fontSize: 12,
    color: Colors.light.muted,
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
  },
  reviewInfo: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  reviewInfoText: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  reviewNotes: {
    fontSize: 12,
    color: Colors.light.text,
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
  superAdminActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  deleteRequestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#B91C1C',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  deleteRequestButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  actionButtons: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveButton: {
    backgroundColor: '#10B981',
  },
  rejectButton: {
    backgroundColor: '#EF4444',
  },
  approveButtonFull: {
    backgroundColor: '#10B981',
  },
  rejectButtonFull: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 16,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalScroll: {
    maxHeight: 400,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
  selectButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  selectButtonText: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  selectedLeaveType: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    flex: 1,
  },
  leaveTypeColor: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dateInputsRow: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  durationInfo: {
    backgroundColor: '#EBF5FF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center' as const,
  },
  durationText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  balanceWarningBox: {
    backgroundColor: '#FEF2F2',
  },
  balanceWarningText: {
    color: '#B91C1C',
  },
  balanceYearText: {
    marginTop: 4,
    fontSize: 12,
    color: '#1E3A8A',
  },
  modalActions: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 20,
  },
  button: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: Colors.light.tint,
  },
  secondaryButton: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  secondaryButtonText: {
    color: Colors.light.tint,
  },
  lockedSection: {
    gap: 10,
  },
  inputHint: {
    fontSize: 12,
    color: Colors.light.muted,
    marginBottom: 2,
  },
  sectionMiniTitle: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  emptyPickerText: {
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.light.muted,
  },
  balanceRowCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  balanceRowTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  balanceRowMeta: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 2,
  },
  miniIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.light.background,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 24,
  },
  pickerContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 340,
  },
  pickerList: {
    maxHeight: 340,
  },
  pickerSearchInput: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    color: Colors.light.text,
    fontSize: 14,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 16,
    textAlign: 'center' as const,
  },
  pickerOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    borderRadius: 10,
    gap: 12,
  },
  pickerOptionSelected: {
    backgroundColor: '#EBF5FF',
  },
  pickerOptionMeta: {
    flex: 1,
    gap: 2,
  },
  pickerOptionPrimaryText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  pickerOptionText: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  pickerOptionSubText: {
    fontSize: 12,
    color: Colors.light.muted,
  },
});
