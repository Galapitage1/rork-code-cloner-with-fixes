import React, { useMemo, useState } from 'react';
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
import { ArrowLeft, FileSpreadsheet, Upload, Users, CalendarDays, Clock3, Download, RefreshCw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react-native';
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
  parseStaffDetailsWorkbook,
  staffImportTemplateToAoa,
  PAYROLL_COLUMNS,
  minutesToDecimalHours,
} from '@/utils/hrPayroll';

type SimpleFormState = {
  fullName: string;
  userName: string;
  employeeCode: string;
  position: string;
  epfNumber: string;
};

const emptyStaffForm: SimpleFormState = {
  fullName: '',
  userName: '',
  employeeCode: '',
  position: '',
  epfNumber: '',
};

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

export default function HRScreen() {
  const router = useRouter();
  const { currentUser, isSuperAdmin } = useAuth();
  const { leaveRequests, leaveTypes } = useLeave();
  const {
    staffMembers,
    attendanceImports,
    isLoading,
    isSyncing,
    addStaffMember,
    importPayrollTemplateRows,
    upsertAttendanceImport,
    getLatestAttendanceImportForMonth,
    deleteAttendanceImport,
    syncAll,
  } = useHR();

  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(currentMonthKey());
  const [staffForm, setStaffForm] = useState<SimpleFormState>(emptyStaffForm);
  const [isImportingStaffDetails, setIsImportingStaffDetails] = useState(false);
  const [isImportingAttendance, setIsImportingAttendance] = useState(false);
  const [isSavingStaff, setIsSavingStaff] = useState(false);

  const monthOptions = useMemo(() => {
    const set = new Set<string>([currentMonthKey(), selectedMonthKey]);
    attendanceImports.forEach((item) => item.monthKey && set.add(item.monthKey));
    leaveRequests.forEach((req) => {
      if (req.startDate) set.add(req.startDate.slice(0, 7));
      if (req.endDate) set.add(req.endDate.slice(0, 7));
    });
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
  }, [attendanceImports, leaveRequests, selectedMonthKey]);

  const selectedAttendanceImport = useMemo(
    () => getLatestAttendanceImportForMonth(selectedMonthKey),
    [getLatestAttendanceImportForMonth, selectedMonthKey]
  );

  const payrollRows = useMemo(() => generatePayrollRowsForMonth({
    monthKey: selectedMonthKey,
    staffMembers,
    attendanceImport: selectedAttendanceImport,
    leaveRequests,
    leaveTypes,
  }), [selectedMonthKey, staffMembers, selectedAttendanceImport, leaveRequests, leaveTypes]);

  const kpis = useMemo(() => {
    const matched = payrollRows.filter((r) => r.meta.attendanceMatched).length;
    const approvedLeaveDays = payrollRows.reduce((sum, r) => sum + r.meta.approvedLeaveDays, 0);
    const totalLateHours = payrollRows.reduce((sum, r) => sum + minutesToDecimalHours(r.meta.lateMinutes, 3), 0);
    const totalOtHours = payrollRows.reduce((sum, r) => sum + minutesToDecimalHours(r.meta.overtimeMinutes, 3), 0);
    return { matched, approvedLeaveDays, totalLateHours, totalOtHours };
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

  const handleImportStaffDetails = async () => {
    if (!currentUser?.id) return;
    setIsImportingStaffDetails(true);
    await handlePickAndParseWorkbook(async (wb, fileName) => {
      const parsed = parseStaffDetailsWorkbook(wb as any, XLSX);
      const importedCount = await importPayrollTemplateRows(parsed.rows);
      const templateMonth = parsed.monthLabel || '';
      Alert.alert(
        'Staff Details Imported',
        `Imported ${importedCount} staff row(s) from ${fileName}.${templateMonth ? `\nMonth in file: ${templateMonth}` : ''}\n\nStaff master details were updated.`
      );
    });
    setIsImportingStaffDetails(false);
  };

  const handleDownloadStaffImportTemplate = () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Not Supported', 'Template download is currently enabled on web.');
      return;
    }
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(staffImportTemplateToAoa());
      XLSX.utils.book_append_sheet(wb, ws, 'Staff Import');
      XLSX.writeFile(wb, 'HR-Staff-Import-Template.xlsx');
    } catch (error) {
      console.error('[HR] Staff template export failed:', error);
      Alert.alert('Template Error', 'Failed to download staff import template');
    }
  };

  const handleImportFingerprintAttendance = async () => {
    if (!currentUser?.id) return;
    setIsImportingAttendance(true);
    await handlePickAndParseWorkbook(async (wb, fileName) => {
      const parsed = parseFingerprintAttendanceWorkbook(wb as any, XLSX);
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

  const handleAddStaff = async () => {
    if (!currentUser?.id) return;
    const fullName = staffForm.fullName.trim();
    if (!fullName) {
      Alert.alert('Missing Name', 'Please enter Full Name');
      return;
    }
    setIsSavingStaff(true);
    try {
      await addStaffMember({
        fullName,
        userName: staffForm.userName.trim() || undefined,
        employeeCode: staffForm.employeeCode.trim() || undefined,
        position: staffForm.position.trim() || undefined,
        epfNumber: staffForm.epfNumber.trim() || undefined,
        active: true,
      });
      setStaffForm(emptyStaffForm);
      Alert.alert('Success', 'Staff member added');
    } catch (error) {
      console.error('[HR] Failed to add staff:', error);
      Alert.alert('Error', 'Failed to add staff member');
    } finally {
      setIsSavingStaff(false);
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
          <TouchableOpacity style={styles.syncButton} onPress={() => syncAll()} disabled={isSyncing}>
            {isSyncing ? <ActivityIndicator size="small" color={Colors.light.tint} /> : <RefreshCw size={18} color={Colors.light.tint} />}
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
            <Text style={styles.loadingText}>Loading HR module...</Text>
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
              <Text style={styles.sectionTitle}>1. Staff Master / Staff Details Import</Text>
              <Text style={styles.sectionHint}>
                Import staff details only. Use the staff import template (based on your payroll sheet headers) to load names, usernames, employee codes, positions, EPF and optional pay defaults.
              </Text>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton]}
                  onPress={handleImportStaffDetails}
                  disabled={isImportingStaffDetails}
                >
                  {isImportingStaffDetails ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Upload size={16} color="#fff" />
                      <Text style={styles.primaryButtonText}>Import Staff Details</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={handleDownloadStaffImportTemplate}
                >
                  <Download size={16} color={Colors.light.tint} />
                  <Text style={styles.secondaryButtonText}>Download Staff Template</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.formCard}>
                <Text style={styles.formTitle}>Add Staff (Quick)</Text>
                <View style={styles.formGrid}>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    value={staffForm.fullName}
                    onChangeText={(v) => setStaffForm((s) => ({ ...s, fullName: v }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="User Name"
                    value={staffForm.userName}
                    onChangeText={(v) => setStaffForm((s) => ({ ...s, userName: v }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Employee Code"
                    value={staffForm.employeeCode}
                    onChangeText={(v) => setStaffForm((s) => ({ ...s, employeeCode: v }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Position"
                    value={staffForm.position}
                    onChangeText={(v) => setStaffForm((s) => ({ ...s, position: v }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="EPF Number"
                    value={staffForm.epfNumber}
                    onChangeText={(v) => setStaffForm((s) => ({ ...s, epfNumber: v }))}
                  />
                </View>
                <TouchableOpacity style={[styles.actionButton, styles.secondaryButton]} onPress={handleAddStaff} disabled={isSavingStaff}>
                  {isSavingStaff ? <ActivityIndicator size="small" color={Colors.light.tint} /> : <Text style={styles.secondaryButtonText}>Add Staff</Text>}
                </TouchableOpacity>
              </View>

              <ScrollView horizontal style={styles.inlineTableWrap}>
                <View>
                  <View style={styles.tableHeaderRow}>
                    {['Full Name', 'User Name', 'Emp Code', 'Position', 'EPF', 'Defaults Loaded'].map((h) => (
                      <Text key={h} style={[styles.tableCell, styles.tableHeaderCell, h === 'Full Name' ? styles.wideCell : null]}>{h}</Text>
                    ))}
                  </View>
                  {staffMembers.length === 0 ? (
                    <Text style={styles.emptyLine}>No staff added yet.</Text>
                  ) : (
                    staffMembers
                      .slice()
                      .sort((a, b) => a.fullName.localeCompare(b.fullName))
                      .map((staff) => (
                        <View key={staff.id} style={styles.tableRow}>
                          <Text style={[styles.tableCell, styles.wideCell]}>{staff.fullName}</Text>
                          <Text style={styles.tableCell}>{staff.userName || '-'}</Text>
                          <Text style={styles.tableCell}>{staff.employeeCode || '-'}</Text>
                          <Text style={styles.tableCell}>{staff.position || '-'}</Text>
                          <Text style={styles.tableCell}>{staff.epfNumber || '-'}</Text>
                          <Text style={styles.tableCell}>{staff.payrollDefaults ? 'Yes' : 'No'}</Text>
                        </View>
                      ))
                  )}
                </View>
              </ScrollView>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>2. Fingerprint Attendance Import (Monthly)</Text>
              <Text style={styles.sectionHint}>
                Import the monthly fingerprint performance report (like your `Jan-26.xls`) to calculate present/late/work/OT and compare leave with approved Leave Requests.
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton]}
                  onPress={handleImportFingerprintAttendance}
                  disabled={isImportingAttendance}
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
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Selected Month Attendance</Text>
                <Text style={styles.infoCardText}>{attendanceSummaryText}</Text>
                {selectedAttendanceImport && (
                  <View style={styles.infoInlineRow}>
                    <Text style={styles.infoTiny}>Month: {selectedAttendanceImport.monthLabel}</Text>
                    <Text style={styles.infoTiny}>Imported: {new Date(selectedAttendanceImport.updatedAt).toLocaleString()}</Text>
                    {isSuperAdmin && (
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

              {selectedAttendanceImport?.rows?.length ? (
                <ScrollView horizontal style={styles.inlineTableWrap}>
                  <View>
                    <View style={styles.tableHeaderRow}>
                      {['EmpCode', 'Name', 'Present', 'Leave', 'Absent', 'Paid Days', 'Late', 'Work Hrs', 'OT'].map((h) => (
                        <Text key={h} style={[styles.tableCell, styles.tableHeaderCell, h === 'Name' ? styles.wideCell : null]}>{h}</Text>
                      ))}
                    </View>
                    {selectedAttendanceImport.rows.slice(0, 25).map((row) => (
                      <View key={row.id} style={styles.tableRow}>
                        <Text style={styles.tableCell}>{row.employeeCode}</Text>
                        <Text style={[styles.tableCell, styles.wideCell]}>{row.employeeName}</Text>
                        <Text style={styles.tableCell}>{row.presentDays}</Text>
                        <Text style={styles.tableCell}>{row.leaveDays}</Text>
                        <Text style={styles.tableCell}>{row.absentDays}</Text>
                        <Text style={styles.tableCell}>{row.paidDays}</Text>
                        <Text style={styles.tableCell}>{row.lateHoursText || '-'}</Text>
                        <Text style={styles.tableCell}>{row.workHoursText || '-'}</Text>
                        <Text style={styles.tableCell}>{row.overtimeText || '-'}</Text>
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
              <Text style={styles.sectionTitle}>3. Monthly Payroll Sheet (Leave Integrated)</Text>
              <Text style={styles.sectionHint}>
                Payroll rows use your payroll headers and auto-fill key values from fingerprint attendance (Hours Worked, OT, Late hours) and approved leave requests for the selected month.
              </Text>

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
                  <Text style={styles.infoTiny}>Attendance matched rows: {kpis.matched}/{payrollRows.length}</Text>
                  {!payrollRows.length && attendanceImports.length > 0 && (
                    <Text style={[styles.infoTiny, { color: '#B45309' }]}>
                      No rows for {formatMonthKey(selectedMonthKey)}. Try another month chip or import staff details.
                    </Text>
                  )}
                </View>
              </View>

              <ScrollView horizontal style={styles.payrollTableWrap}>
                <View>
                  <View style={styles.tableHeaderRow}>
                    {PAYROLL_COLUMNS.map((col) => (
                      <Text
                        key={col.key}
                        style={[
                          styles.payrollCell,
                          styles.tableHeaderCell,
                          (col.key === 'fullName' || col.key === 'remarks' || col.key === 'reasonHoursDays') && styles.payrollWideCell,
                        ]}
                      >
                        {col.label}
                      </Text>
                    ))}
                  </View>
                  {payrollRows.length === 0 ? (
                    <Text style={styles.emptyLine}>No payroll rows yet. Add staff and/or import fingerprint attendance.</Text>
                  ) : (
                    payrollRows.map((row) => (
                      <View key={row.id} style={styles.tableRow}>
                        {PAYROLL_COLUMNS.map((col) => (
                          <Text
                            key={`${row.id}-${col.key}`}
                            style={[
                              styles.payrollCell,
                              (col.key === 'fullName' || col.key === 'remarks' || col.key === 'reasonHoursDays') && styles.payrollWideCell,
                            ]}
                            numberOfLines={2}
                          >
                            {row.values[col.key] === null || row.values[col.key] === undefined || row.values[col.key] === ''
                              ? '-'
                              : String(row.values[col.key])}
                          </Text>
                        ))}
                      </View>
                    ))
                  )}
                </View>
              </ScrollView>

              <View style={styles.noteCard}>
                <Text style={styles.noteTitle}>How Leave Integration Works</Text>
                <Text style={styles.noteText}>
                  The payroll sheet matches approved Leave Requests to staff by employee name (Full Name / User Name / fingerprint name). It fills approved leave days into `Hours/Days`, leave type summaries into `reason/hrs/days`, and estimates unauthorised leave as `Absent - Approved Leave`.
                </Text>
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
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
  payrollCell: {
    width: 130,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 11,
    color: '#0F172A',
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
