import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { Calendar, Plus, Check, X, Clock, ChevronDown, Filter, ArrowLeft } from 'lucide-react-native';
import { useLeave } from '@/contexts/LeaveContext';
import { useAuth } from '@/contexts/AuthContext';
import { CalendarModal } from '@/components/CalendarModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import Colors from '@/constants/colors';
import { LeaveRequest, LeaveRequestStatus } from '@/types';

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export default function LeaveScreen() {
  const router = useRouter();
  const { currentUser, isSuperAdmin } = useAuth();
  const { 
    leaveTypes, 
    leaveRequests, 
    isLoading, 
    addLeaveRequest, 
    updateLeaveRequestStatus,
    getLeaveTypeById,
  } = useLeave();

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [employeeName, setEmployeeName] = useState('');
  const [selectedLeaveType, setSelectedLeaveType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showLeaveTypePicker, setShowLeaveTypePicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showFilterPicker, setShowFilterPicker] = useState(false);
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

  const filteredRequests = useMemo(() => {
    let requests = isSuperAdmin ? leaveRequests : leaveRequests.filter(r => r.createdBy === currentUser?.id);
    
    if (filterStatus !== 'all') {
      requests = requests.filter(r => r.status === filterStatus);
    }
    
    return requests.sort((a, b) => b.createdAt - a.createdAt);
  }, [leaveRequests, isSuperAdmin, currentUser, filterStatus]);

  const pendingCount = useMemo(() => {
    const requests = isSuperAdmin ? leaveRequests : leaveRequests.filter(r => r.createdBy === currentUser?.id);
    return requests.filter(r => r.status === 'pending').length;
  }, [leaveRequests, isSuperAdmin, currentUser]);

  const resetForm = () => {
    setEmployeeName('');
    setSelectedLeaveType('');
    setStartDate('');
    setEndDate('');
    setReason('');
  };

  const handleSubmitRequest = async () => {
    if (!employeeName.trim()) {
      Alert.alert('Error', 'Please enter your name');
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

    try {
      setIsSubmitting(true);
      await addLeaveRequest({
        employeeName: employeeName.trim(),
        leaveTypeId: selectedLeaveType,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
      });
      Alert.alert('Success', 'Leave request submitted successfully');
      setShowRequestModal(false);
      resetForm();
    } catch {
      Alert.alert('Error', 'Failed to submit leave request');
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
    } catch {
      Alert.alert('Error', 'Failed to update leave request');
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

  const calculateDays = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  const getStatusColor = (status: LeaveRequestStatus) => {
    switch (status) {
      case 'pending': return '#F59E0B';
      case 'approved': return '#10B981';
      case 'rejected': return '#EF4444';
      default: return Colors.light.muted;
    }
  };

  const getStatusBgColor = (status: LeaveRequestStatus) => {
    switch (status) {
      case 'pending': return '#FEF3C7';
      case 'approved': return '#D1FAE5';
      case 'rejected': return '#FEE2E2';
      default: return Colors.light.background;
    }
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
            <View style={[styles.statCard, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
              <Clock size={20} color="#F59E0B" />
              <Text style={[styles.statNumber, { color: '#F59E0B' }]}>{pendingCount}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#D1FAE5', borderColor: '#10B981' }]}>
              <Check size={20} color="#10B981" />
              <Text style={[styles.statNumber, { color: '#10B981' }]}>
                {filteredRequests.filter(r => r.status === 'approved').length}
              </Text>
              <Text style={styles.statLabel}>Approved</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#FEE2E2', borderColor: '#EF4444' }]}>
              <X size={20} color="#EF4444" />
              <Text style={[styles.statNumber, { color: '#EF4444' }]}>
                {filteredRequests.filter(r => r.status === 'rejected').length}
              </Text>
              <Text style={styles.statLabel}>Rejected</Text>
            </View>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => setShowFilterPicker(true)}
            >
              <Filter size={18} color={Colors.light.tint} />
              <Text style={styles.filterButtonText}>
                {filterStatus === 'all' ? 'All' : filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1)}
              </Text>
              <ChevronDown size={16} color={Colors.light.tint} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.newRequestButton}
              onPress={() => setShowRequestModal(true)}
            >
              <Plus size={20} color="#FFFFFF" />
              <Text style={styles.newRequestButtonText}>New Request</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {filteredRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Calendar size={48} color={Colors.light.muted} />
                <Text style={styles.emptyStateText}>No leave requests found</Text>
                <Text style={styles.emptyStateSubtext}>
                  {filterStatus !== 'all' ? 'Try changing the filter' : 'Tap "New Request" to submit one'}
                </Text>
              </View>
            ) : (
              filteredRequests.map((request) => {
                const leaveType = getLeaveTypeById(request.leaveTypeId);
                return (
                  <View key={request.id} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <View style={styles.requestInfo}>
                        <Text style={styles.employeeName}>{request.employeeName}</Text>
                        <View style={[styles.leaveTypeBadge, { backgroundColor: leaveType?.color || Colors.light.muted }]}>
                          <Text style={styles.leaveTypeBadgeText}>{leaveType?.name || 'Unknown'}</Text>
                        </View>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(request.status) }]}>
                        <Text style={[styles.statusText, { color: getStatusColor(request.status) }]}>
                          {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.dateRow}>
                      <View style={styles.dateInfo}>
                        <Text style={styles.dateLabel}>From</Text>
                        <Text style={styles.dateValue}>{formatDate(request.startDate)}</Text>
                      </View>
                      <View style={styles.dateDivider} />
                      <View style={styles.dateInfo}>
                        <Text style={styles.dateLabel}>To</Text>
                        <Text style={styles.dateValue}>{formatDate(request.endDate)}</Text>
                      </View>
                      <View style={styles.daysContainer}>
                        <Text style={styles.daysNumber}>{calculateDays(request.startDate, request.endDate)}</Text>
                        <Text style={styles.daysLabel}>days</Text>
                      </View>
                    </View>

                    {request.reason && (
                      <View style={styles.reasonContainer}>
                        <Text style={styles.reasonLabel}>Reason:</Text>
                        <Text style={styles.reasonText}>{request.reason}</Text>
                      </View>
                    )}

                    {request.reviewedBy && (
                      <View style={styles.reviewInfo}>
                        <Text style={styles.reviewInfoText}>
                          {request.status === 'approved' ? 'Approved' : 'Rejected'} by {request.reviewedBy}
                          {request.reviewedAt && ` on ${new Date(request.reviewedAt).toLocaleDateString()}`}
                        </Text>
                        {request.reviewNotes && (
                          <Text style={styles.reviewNotes}>Note: {request.reviewNotes}</Text>
                        )}
                      </View>
                    )}

                    {isSuperAdmin && request.status === 'pending' && (
                      <View style={styles.actionButtons}>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.approveButton]}
                          onPress={() => handleReviewRequest(request, 'approve')}
                        >
                          <Check size={18} color="#FFFFFF" />
                          <Text style={styles.actionButtonText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.rejectButton]}
                          onPress={() => handleReviewRequest(request, 'reject')}
                        >
                          <X size={18} color="#FFFFFF" />
                          <Text style={styles.actionButtonText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
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
                <Text style={styles.inputLabel}>Your Name *</Text>
                <TextInput
                  style={styles.input}
                  value={employeeName}
                  onChangeText={setEmployeeName}
                  placeholder="Enter your full name"
                  placeholderTextColor={Colors.light.muted}
                />
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

              {startDate && endDate && new Date(endDate) >= new Date(startDate) && (
                <View style={styles.durationInfo}>
                  <Text style={styles.durationText}>
                    Duration: {calculateDays(startDate, endDate)} day(s)
                  </Text>
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
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showFilterPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterPicker(false)}
      >
        <TouchableOpacity 
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowFilterPicker(false)}
        >
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Filter by Status</Text>
            {(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.pickerOption,
                  filterStatus === status && styles.pickerOptionSelected
                ]}
                onPress={() => {
                  setFilterStatus(status);
                  setShowFilterPicker(false);
                }}
              >
                <Text style={styles.pickerOptionText}>
                  {status === 'all' ? 'All Requests' : status.charAt(0).toUpperCase() + status.slice(1)}
                </Text>
                {filterStatus === status && <Check size={20} color={Colors.light.tint} />}
              </TouchableOpacity>
            ))}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 4,
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
  pickerOptionText: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
});
