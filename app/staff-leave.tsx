import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Check, ChevronDown, KeyRound, Pencil, ShieldCheck, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useHR } from '@/contexts/HRContext';
import { useLeave } from '@/contexts/LeaveContext';

function parseISODateUTC(value: string): Date | null {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt;
}

function splitDateRangeByYear(startDate: string, endDate: string): Record<number, number> {
  const start = parseISODateUTC(startDate);
  const end = parseISODateUTC(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return {};

  const out: Record<number, number> = {};
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getUTCFullYear();
    out[year] = (out[year] || 0) + 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export default function StaffLeaveScreen() {
  const router = useRouter();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { staffMembers } = useHR();
  const {
    leaveTypes,
    leaveRequests,
    staffLeaveBalances,
    hasLeaveBalancePassword,
    verifyLeaveBalancePassword,
    setLeaveBalancePassword,
    upsertStaffLeaveBalance,
  } = useLeave();

  const [yearText, setYearText] = useState(String(new Date().getFullYear()));
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  const [showEditor, setShowEditor] = useState(false);
  const [editorStaffId, setEditorStaffId] = useState('');
  const [editorLeaveTypeId, setEditorLeaveTypeId] = useState('');
  const [editorTotalDays, setEditorTotalDays] = useState('');
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [showLeaveTypePicker, setShowLeaveTypePicker] = useState(false);

  const canManage = isAdmin || isSuperAdmin;

  const selectedYear = useMemo(() => {
    const year = parseInt(yearText, 10);
    if (!Number.isInteger(year)) return new Date().getFullYear();
    return Math.max(2000, Math.min(2100, year));
  }, [yearText]);

  const activeStaff = useMemo(
    () => staffMembers
      .filter((row) => !row.deleted && row.active !== false)
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staffMembers]
  );

  const balancesByKey = useMemo(() => {
    const map = new Map<string, number>();
    staffLeaveBalances
      .filter((row) => !row.deleted && Number(row.year) === selectedYear)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .forEach((row) => {
        const key = `${row.staffId}__${row.leaveTypeId}`;
        if (!map.has(key)) {
          map.set(key, Number(row.totalDays) || 0);
        }
      });
    return map;
  }, [selectedYear, staffLeaveBalances]);

  const usedByKey = useMemo(() => {
    const map = new Map<string, { approved: number; pending: number }>();
    leaveRequests.forEach((request) => {
      if (request.deleted) return;
      if (!(request.status === 'approved' || request.status === 'pending')) return;
      if (!request.staffId || !request.leaveTypeId) return;

      const daysByYear = splitDateRangeByYear(request.startDate, request.endDate);
      const usedDays = Number(daysByYear[selectedYear] || 0);
      if (!usedDays) return;

      const key = `${request.staffId}__${request.leaveTypeId}`;
      const prev = map.get(key) || { approved: 0, pending: 0 };
      if (request.status === 'approved') {
        prev.approved += usedDays;
      } else {
        prev.pending += usedDays;
      }
      map.set(key, prev);
    });
    return map;
  }, [leaveRequests, selectedYear]);

  const matrixRows = useMemo(() => {
    return activeStaff.map((staff) => {
      const cells = leaveTypes.map((leaveType) => {
        const key = `${staff.id}__${leaveType.id}`;
        const total = Number(balancesByKey.get(key) || 0);
        const used = usedByKey.get(key) || { approved: 0, pending: 0 };
        const remaining = total - used.approved - used.pending;
        return {
          key,
          leaveType,
          total,
          approved: used.approved,
          pending: used.pending,
          remaining,
        };
      });

      return { staff, cells };
    });
  }, [activeStaff, leaveTypes, balancesByKey, usedByKey]);

  const openEditor = (params?: { staffId?: string; leaveTypeId?: string; totalDays?: number }) => {
    if (!isUnlocked) return;
    setEditorStaffId(params?.staffId || activeStaff[0]?.id || '');
    setEditorLeaveTypeId(params?.leaveTypeId || leaveTypes[0]?.id || '');
    setEditorTotalDays(params?.totalDays !== undefined ? String(params.totalDays) : '');
    setShowEditor(true);
  };

  const selectedEditorStaff = useMemo(
    () => activeStaff.find((row) => row.id === editorStaffId),
    [activeStaff, editorStaffId]
  );

  const unlock = async () => {
    if (!canManage) return;

    if (!hasLeaveBalancePassword) {
      if (!newPasswordInput.trim() || !confirmPasswordInput.trim()) {
        Alert.alert('Error', 'Set and confirm password');
        return;
      }
      if (newPasswordInput.trim() !== confirmPasswordInput.trim()) {
        Alert.alert('Error', 'Passwords do not match');
        return;
      }
      await setLeaveBalancePassword(newPasswordInput.trim());
      setIsUnlocked(true);
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      Alert.alert('Saved', 'Password created and access granted');
      return;
    }

    if (!verifyLeaveBalancePassword(passwordInput.trim())) {
      Alert.alert('Error', 'Invalid password');
      return;
    }

    setPasswordInput('');
    setIsUnlocked(true);
  };

  const saveEdit = async () => {
    const staff = selectedEditorStaff;
    if (!staff) {
      Alert.alert('Error', 'Select staff');
      return;
    }
    if (!editorLeaveTypeId) {
      Alert.alert('Error', 'Select leave type');
      return;
    }
    const days = Number(editorTotalDays);
    if (!Number.isFinite(days) || days < 0) {
      Alert.alert('Error', 'Enter valid leave amount');
      return;
    }

    await upsertStaffLeaveBalance({
      staffId: staff.id,
      staffName: staff.fullName,
      leaveTypeId: editorLeaveTypeId,
      year: selectedYear,
      totalDays: days,
    });

    setShowEditor(false);
    Alert.alert('Saved', 'Leave amount saved');
  };

  if (!canManage) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={20} color={Colors.light.tint} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Staff Leave</Text>
            <View style={{ width: 56 }} />
          </View>
          <View style={styles.centeredCard}>
            <Text style={styles.lockText}>Only admins can access this page.</Text>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={20} color={Colors.light.tint} />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Staff Leave</Text>
          <View style={{ width: 56 }} />
        </View>

        <View style={styles.controlsRow}>
          <Text style={styles.yearLabel}>Year</Text>
          <TextInput
            style={styles.yearInput}
            value={yearText}
            onChangeText={setYearText}
            keyboardType="numeric"
            placeholder="2026"
            placeholderTextColor={Colors.light.muted}
          />
          <TouchableOpacity
            style={[styles.addButton, !isUnlocked && styles.addButtonDisabled]}
            disabled={!isUnlocked}
            onPress={() => openEditor()}
          >
            <Text style={styles.addButtonText}>Add / Edit Leave</Text>
          </TouchableOpacity>
        </View>

        {!isUnlocked ? (
          <View style={styles.centeredCard}>
            <View style={styles.lockTitleRow}>
              <ShieldCheck size={18} color={Colors.light.tint} />
              <Text style={styles.lockTitle}>Admin Access</Text>
            </View>
            {!hasLeaveBalancePassword ? (
              <>
                <Text style={styles.lockHint}>Create password to manage staff leave amounts.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor={Colors.light.muted}
                  secureTextEntry
                  value={newPasswordInput}
                  onChangeText={setNewPasswordInput}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor={Colors.light.muted}
                  secureTextEntry
                  value={confirmPasswordInput}
                  onChangeText={setConfirmPasswordInput}
                />
              </>
            ) : (
              <>
                <Text style={styles.lockHint}>Enter password to add/edit leave amounts.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={Colors.light.muted}
                  secureTextEntry
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                />
              </>
            )}
            <TouchableOpacity style={styles.unlockButton} onPress={unlock}>
              <KeyRound size={15} color="#fff" />
              <Text style={styles.unlockButtonText}>{hasLeaveBalancePassword ? 'Unlock' : 'Create & Unlock'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView horizontal style={styles.tableWrap} contentContainerStyle={{ paddingBottom: 16 }}>
            <View>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.headerCell, styles.staffCol]}>Staff</Text>
                {leaveTypes.map((leaveType) => (
                  <Text key={`header-${leaveType.id}`} style={styles.headerCell}>
                    {leaveType.name}
                  </Text>
                ))}
              </View>

              {matrixRows.length === 0 ? (
                <Text style={styles.emptyText}>No active staff found in HR module.</Text>
              ) : (
                matrixRows.map((row) => (
                  <View key={row.staff.id} style={styles.tableRow}>
                    <Text style={[styles.cell, styles.staffCol]}>{row.staff.fullName}</Text>
                    {row.cells.map((cell) => (
                      <TouchableOpacity
                        key={`${row.staff.id}-${cell.leaveType.id}`}
                        style={styles.cellButton}
                        onPress={() => openEditor({
                          staffId: row.staff.id,
                          leaveTypeId: cell.leaveType.id,
                          totalDays: cell.total,
                        })}
                      >
                        <Text style={[styles.cellValue, cell.remaining < 0 && styles.negativeText]}>
                          {cell.remaining.toFixed(1)}
                        </Text>
                        <Text style={styles.cellSub}>Total {cell.total.toFixed(1)}</Text>
                        <Text style={styles.cellSub}>Used {Number(cell.approved + cell.pending).toFixed(1)}</Text>
                        <View style={styles.editPill}>
                          <Pencil size={11} color={Colors.light.tint} />
                          <Text style={styles.editPillText}>Edit</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      <Modal visible={showEditor} transparent animationType="slide" onRequestClose={() => setShowEditor(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add / Edit Leave Amount</Text>
              <TouchableOpacity onPress={() => setShowEditor(false)}>
                <X size={20} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Staff</Text>
            <TouchableOpacity style={styles.selectButton} onPress={() => setShowStaffPicker(true)}>
              <Text style={styles.selectText}>{selectedEditorStaff?.fullName || 'Select staff'}</Text>
              <ChevronDown size={16} color={Colors.light.muted} />
            </TouchableOpacity>

            <Text style={styles.label}>Leave Type</Text>
            <TouchableOpacity style={styles.selectButton} onPress={() => setShowLeaveTypePicker(true)}>
              <Text style={styles.selectText}>{leaveTypes.find((x) => x.id === editorLeaveTypeId)?.name || 'Select leave type'}</Text>
              <ChevronDown size={16} color={Colors.light.muted} />
            </TouchableOpacity>

            <Text style={styles.label}>Year</Text>
            <TextInput style={styles.input} value={String(selectedYear)} editable={false} />

            <Text style={styles.label}>Total Leave Amount (days)</Text>
            <TextInput
              style={styles.input}
              value={editorTotalDays}
              onChangeText={setEditorTotalDays}
              keyboardType="numeric"
              placeholder="e.g. 14"
              placeholderTextColor={Colors.light.muted}
            />

            <TouchableOpacity style={styles.saveButton} onPress={saveEdit}>
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showStaffPicker} transparent animationType="fade" onRequestClose={() => setShowStaffPicker(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowStaffPicker(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select Staff</Text>
            <ScrollView style={styles.pickerList}>
              {activeStaff.map((staff) => (
                <TouchableOpacity
                  key={staff.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setEditorStaffId(staff.id);
                    setShowStaffPicker(false);
                  }}
                >
                  <Text style={styles.pickerText}>{staff.fullName}</Text>
                  {editorStaffId === staff.id && <Check size={16} color={Colors.light.tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showLeaveTypePicker} transparent animationType="fade" onRequestClose={() => setShowLeaveTypePicker(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowLeaveTypePicker(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select Leave Type</Text>
            <ScrollView style={styles.pickerList}>
              {leaveTypes.map((leaveType) => (
                <TouchableOpacity
                  key={leaveType.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setEditorLeaveTypeId(leaveType.id);
                    setShowLeaveTypePicker(false);
                  }}
                >
                  <Text style={styles.pickerText}>{leaveType.name}</Text>
                  {editorLeaveTypeId === leaveType.id && <Check size={16} color={Colors.light.tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backButtonText: {
    color: Colors.light.tint,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  yearLabel: {
    fontSize: 13,
    color: Colors.light.muted,
    fontWeight: '600',
  },
  yearInput: {
    width: 90,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: Colors.light.text,
    fontSize: 14,
  },
  addButton: {
    marginLeft: 'auto',
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  centeredCard: {
    margin: 16,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    gap: 10,
  },
  lockText: {
    color: Colors.light.muted,
    fontSize: 14,
  },
  lockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  lockHint: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.light.text,
  },
  unlockButton: {
    marginTop: 2,
    alignSelf: 'flex-start',
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unlockButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  tableWrap: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  headerCell: {
    minWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.text,
  },
  staffCol: {
    minWidth: 220,
  },
  tableRow: {
    flexDirection: 'row',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  cell: {
    minWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: Colors.light.text,
    fontSize: 13,
  },
  cellButton: {
    minWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 2,
  },
  cellValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  cellSub: {
    fontSize: 11,
    color: Colors.light.muted,
  },
  negativeText: {
    color: Colors.light.danger,
  },
  editPill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Colors.light.background,
  },
  editPillText: {
    fontSize: 11,
    color: Colors.light.tint,
    fontWeight: '600',
  },
  emptyText: {
    padding: 12,
    color: Colors.light.muted,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
  },
  label: {
    marginTop: 2,
    marginBottom: 4,
    fontSize: 13,
    color: Colors.light.muted,
    fontWeight: '600',
  },
  selectButton: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: {
    color: Colors.light.text,
    fontSize: 14,
  },
  saveButton: {
    marginTop: 6,
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 12,
  },
  pickerList: {
    maxHeight: 340,
  },
  pickerTitle: {
    textAlign: 'center',
    color: Colors.light.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pickerText: {
    color: Colors.light.text,
    fontSize: 14,
  },
});
