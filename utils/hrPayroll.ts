import { HRAttendanceImport, HRAttendanceSummaryRow, HRStaffMember, LeaveRequest, LeaveType } from '@/types';

export type PayrollColumn = {
  key: string;
  label: string;
};

export const PAYROLL_COLUMNS: PayrollColumn[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'userName', label: 'User Name' },
  { key: 'position', label: 'Position' },
  { key: 'epfNumber', label: 'EPF Number' },
  { key: 'month', label: 'Month' },
  { key: 'basicRatePerHr', label: 'Basic Rate/Hr' },
  { key: 'fullRatePerHr', label: 'Fll Rate/hr' },
  { key: 'hoursPerDay', label: 'Hr/Day' },
  { key: 'hoursWorked', label: 'Hrs Worked' },
  { key: 'totalSalary', label: 'Total Salary' },
  { key: 'basic', label: 'Basic' },
  { key: 'performanceAllowance', label: 'Performance Allawance' },
  { key: 'attendanceAllowance', label: 'Attendence Allawance' },
  { key: 'overTime', label: 'Over time' },
  { key: 'serviceChargeEarning', label: 'Service Charge' },
  { key: 'bra1', label: 'BRA1' },
  { key: 'bra2', label: 'BRA2' },
  { key: 'epfEmployer', label: 'EPF Employer' },
  { key: 'etfEmployer', label: 'ETF Employer' },
  { key: 'epfEmployee', label: 'EPF Employee' },
  { key: 'extraOt', label: 'Extra OT' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'advance', label: 'Advance' },
  { key: 'reasonHoursDays', label: 'reason/hrs/days' },
  { key: 'overtimeExtraDays', label: 'Overtime (Extra Days)' },
  { key: 'hoursDays', label: 'Hours/Days' },
  { key: 'otherReduction', label: 'Other Reduction' },
  { key: 'reductionReason', label: 'Rason' },
  { key: 'loans', label: 'Loans' },
  { key: 'sickUnauthorizedLeave', label: 'Sick/Unauthoreised Leave' },
  { key: 'lateHours', label: 'Late hours' },
  { key: 'serviceChargeReduction', label: 'Service Charge' },
  { key: 'totalSalaryReceiving', label: 'Total Salary Recieving' },
  { key: 'finalSalaryAfterReductions', label: 'Final Salary (After reductions)' },
  { key: 'reasonForLeaving', label: 'Reason for leaving' },
];

export const PAYROLL_HEADER_LABELS = PAYROLL_COLUMNS.map((c) => c.label);

export const PAYROLL_DEFAULT_IMPORT_KEYS = new Set<string>([
  'basicRatePerHr',
  'fullRatePerHr',
  'hoursPerDay',
  'totalSalary',
  'basic',
  'performanceAllowance',
  'attendanceAllowance',
  'serviceChargeEarning',
  'bra1',
  'bra2',
  'epfEmployer',
  'etfEmployer',
  'epfEmployee',
  'advance',
  'otherReduction',
  'loans',
  'serviceChargeReduction',
]);

type WorkbookLike = {
  SheetNames: string[];
  Sheets: Record<string, any>;
};

export type ParsedPayrollTemplateRow = {
  fullName: string;
  userName?: string;
  employeeCode?: string;
  position?: string;
  epfNumber?: string;
  monthLabel?: string;
  payrollDefaults: Record<string, string | number | null>;
};

export type ParsedPayrollTemplate = {
  headers: PayrollColumn[];
  monthLabel?: string;
  rows: ParsedPayrollTemplateRow[];
  sourceSheetName?: string;
};

export const STAFF_IMPORT_TEMPLATE_COLUMNS: PayrollColumn[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'userName', label: 'User Name' },
  { key: 'employeeCode', label: 'Employee Code' },
  { key: 'position', label: 'Position' },
  { key: 'epfNumber', label: 'EPF Number' },
  { key: 'basicRatePerHr', label: 'Basic Rate/Hr' },
  { key: 'fullRatePerHr', label: 'Fll Rate/hr' },
  { key: 'hoursPerDay', label: 'Hr/Day' },
  { key: 'totalSalary', label: 'Total Salary' },
  { key: 'basic', label: 'Basic' },
  { key: 'performanceAllowance', label: 'Performance Allawance' },
  { key: 'attendanceAllowance', label: 'Attendence Allawance' },
  { key: 'serviceChargeEarning', label: 'Service Charge' },
  { key: 'bra1', label: 'BRA1' },
  { key: 'bra2', label: 'BRA2' },
  { key: 'advance', label: 'Advance' },
  { key: 'loans', label: 'Loans' },
];

type FingerprintParseResult = {
  monthKey: string;
  monthLabel: string;
  reportStartDate?: string;
  reportEndDate?: string;
  sourceSheetName?: string;
  rows: Omit<HRAttendanceSummaryRow, 'id'>[];
};

const SUMMARY_FIELDS = {
  empCode: 'EmpCode',
  name: 'Name',
  present: 'Present',
  hl: 'HL',
  wo: 'WO',
  absent: 'Absent',
  leave: 'Leave',
  paidDays: 'PaidDays',
  lateHrs: 'LateHrs.',
  workHrs: 'WorkHrs',
  ovTim: 'OvTim',
} as const;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s._:/()-]+/g, '');
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const num = parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

export function parseDurationToMinutes(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const match = text.match(/^(\d+):(\d{1,2})$/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return 0;
  return hours * 60 + mins;
}

export function minutesToDecimalHours(minutes: number, decimals = 2): number {
  if (!Number.isFinite(minutes)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((minutes / 60) * factor) / factor;
}

export function minutesToText(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseDateStringToIso(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!dmy) return undefined;
  let [, d, m, y] = dmy;
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (!year || !month || !day) return undefined;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.toISOString().split('T')[0];
}

function monthNameToNumber(name: string): number | null {
  const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase());
  return idx >= 0 ? idx + 1 : null;
}

function deriveMonthKeyFromLabel(label?: string): string | undefined {
  if (!label) return undefined;
  const text = label.trim();
  const match1 = text.match(/\b([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (match1) {
    const monthNum = monthNameToNumber(match1[1]);
    const year = parseInt(match1[2], 10);
    if (monthNum && year) {
      return `${year}-${String(monthNum).padStart(2, '0')}`;
    }
  }
  const match2 = text.match(/\b([A-Za-z]{3})-(\d{2})\b/);
  if (match2) {
    const monthNum = monthNameToNumber(match2[1]);
    const year = 2000 + parseInt(match2[2], 10);
    if (monthNum && year) {
      return `${year}-${String(monthNum).padStart(2, '0')}`;
    }
  }
  return undefined;
}

export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const monthIndex = Number(month) - 1;
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex] || month;
  return `${monthName}-${String(year).slice(-2)}`;
}

function getRows(workbook: WorkbookLike, sheetName: string, XLSX: any): any[][] {
  const ws = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

export function parsePayrollTemplateWorkbook(workbook: WorkbookLike, XLSX: any): ParsedPayrollTemplate {
  for (const sheetName of workbook.SheetNames) {
    const rows = getRows(workbook, sheetName, XLSX);
    if (!rows.length) continue;

    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i] || [];
      const normalized = row.map(normalizeText);
      const hasFullName = normalized.includes(normalizeText('Full Name'));
      const hasUserName = normalized.includes(normalizeText('User Name'));
      const hasMonth = normalized.includes(normalizeText('Month'));
      if (hasFullName && hasUserName && hasMonth) {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex < 0) continue;

    const headerRow = rows[headerRowIndex] || [];
    const headerIndexMap = new Map<string, number>();
    PAYROLL_COLUMNS.forEach((col) => {
      const idx = headerRow.findIndex((cell: unknown) => normalizeText(cell) === normalizeText(col.label));
      if (idx >= 0) {
        headerIndexMap.set(col.key, idx);
      }
    });

    const dataRows = rows.slice(headerRowIndex + 1);
    const parsedRows: ParsedPayrollTemplateRow[] = [];
    for (const row of dataRows) {
      const fullName = String(row[headerIndexMap.get('fullName') ?? -1] ?? '').trim();
      const userName = String(row[headerIndexMap.get('userName') ?? -1] ?? '').trim();
      const position = String(row[headerIndexMap.get('position') ?? -1] ?? '').trim();
      if (!fullName && !userName && !position) continue;

      const payrollDefaults: Record<string, string | number | null> = {};
      for (const col of PAYROLL_COLUMNS) {
        const idx = headerIndexMap.get(col.key);
        const raw = idx === undefined ? '' : row[idx];
        if (raw === '' || raw === undefined || raw === null) {
          payrollDefaults[col.key] = null;
        } else {
          payrollDefaults[col.key] = typeof raw === 'number' ? raw : String(raw);
        }
      }
      parsedRows.push({
        fullName,
        userName: userName || undefined,
        employeeCode: String(row[headerIndexMap.get('employeeCode') ?? -1] ?? '').trim() || undefined,
        position: position || undefined,
        epfNumber: String(row[headerIndexMap.get('epfNumber') ?? -1] ?? '').trim() || undefined,
        monthLabel: String(row[headerIndexMap.get('month') ?? -1] ?? '').trim() || undefined,
        payrollDefaults,
      });
    }

    const firstMonth = parsedRows.find((r) => r.monthLabel)?.monthLabel;
    return {
      headers: PAYROLL_COLUMNS,
      monthLabel: firstMonth,
      rows: parsedRows,
      sourceSheetName: sheetName,
    };
  }

  throw new Error('Payroll template header row not found. Expected headers like "Full Name", "User Name", "Month".');
}

export function parseStaffDetailsWorkbook(workbook: WorkbookLike, XLSX: any): ParsedPayrollTemplate {
  for (const sheetName of workbook.SheetNames) {
    const rows = getRows(workbook, sheetName, XLSX);
    if (!rows.length) continue;

    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const normalized = (rows[i] || []).map(normalizeText);
      const hasFullName = normalized.includes(normalizeText('Full Name'));
      const hasUserName = normalized.includes(normalizeText('User Name'));
      if (hasFullName && hasUserName) {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex < 0) continue;

    const headerRow = rows[headerRowIndex] || [];
    const headerIndexMap = new Map<string, number>();
    const acceptedColumns = [...PAYROLL_COLUMNS, { key: 'employeeCode', label: 'Employee Code' }];
    acceptedColumns.forEach((col) => {
      const idx = headerRow.findIndex((cell: unknown) => normalizeText(cell) === normalizeText(col.label));
      if (idx >= 0) headerIndexMap.set(col.key, idx);
    });

    const parsedRows: ParsedPayrollTemplateRow[] = [];
    for (const row of rows.slice(headerRowIndex + 1)) {
      const fullName = String(row[headerIndexMap.get('fullName') ?? -1] ?? '').trim();
      const userName = String(row[headerIndexMap.get('userName') ?? -1] ?? '').trim();
      const position = String(row[headerIndexMap.get('position') ?? -1] ?? '').trim();
      const employeeCode = String(row[headerIndexMap.get('employeeCode') ?? -1] ?? '').trim();
      if (!fullName && !userName && !position && !employeeCode) continue;

      const payrollDefaults: Record<string, string | number | null> = {};
      PAYROLL_COLUMNS.forEach((col) => {
        const idx = headerIndexMap.get(col.key);
        if (idx === undefined) return;
        const raw = row[idx];
        if (raw === '' || raw === undefined || raw === null) return;
        payrollDefaults[col.key] = typeof raw === 'number' ? raw : String(raw);
      });

      parsedRows.push({
        fullName: fullName || userName || 'Unnamed',
        userName: userName || undefined,
        employeeCode: employeeCode || undefined,
        position: position || undefined,
        epfNumber: String(row[headerIndexMap.get('epfNumber') ?? -1] ?? '').trim() || undefined,
        monthLabel: String(row[headerIndexMap.get('month') ?? -1] ?? '').trim() || undefined,
        payrollDefaults,
      });
    }

    return {
      headers: STAFF_IMPORT_TEMPLATE_COLUMNS,
      rows: parsedRows,
      sourceSheetName: sheetName,
      monthLabel: parsedRows.find((r) => r.monthLabel)?.monthLabel,
    };
  }

  throw new Error('Staff import template header row not found. Expected at least "Full Name" and "User Name" columns.');
}

export function staffImportTemplateToAoa(): any[][] {
  const headerRow = STAFF_IMPORT_TEMPLATE_COLUMNS.map((c) => c.label);
  const sampleRow = [
    'Example Staff',
    'Example',
    '00002003',
    'Front End',
    'EPF123',
    100,
    160,
    8,
    40000,
    20000,
    12000,
    2200,
    1000,
    1000,
    2500,
    0,
    0,
  ];
  return [
    ['Staff Import Template (based on payroll sheet headers)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    headerRow,
    sampleRow,
  ];
}

function findFingerprintHeaderMap(rows: any[][]): { headerRowIndex: number; colIndex: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const normalized = row.map(normalizeText);
    const empCodeIndex = normalized.findIndex((v) => v === normalizeText(SUMMARY_FIELDS.empCode));
    const nameIndex = normalized.findIndex((v) => v === normalizeText(SUMMARY_FIELDS.name));
    const presentIndex = normalized.findIndex((v) => v === normalizeText(SUMMARY_FIELDS.present));
    if (empCodeIndex >= 0 && nameIndex >= 0 && presentIndex >= 0) {
      const getIdx = (label: string) => normalized.findIndex((v) => v === normalizeText(label));
      return {
        headerRowIndex: i,
        colIndex: {
          empCode: empCodeIndex,
          name: nameIndex,
          present: presentIndex,
          hl: getIdx(SUMMARY_FIELDS.hl),
          wo: getIdx(SUMMARY_FIELDS.wo),
          absent: getIdx(SUMMARY_FIELDS.absent),
          leave: getIdx(SUMMARY_FIELDS.leave),
          paidDays: getIdx(SUMMARY_FIELDS.paidDays),
          lateHrs: getIdx(SUMMARY_FIELDS.lateHrs),
          workHrs: getIdx(SUMMARY_FIELDS.workHrs),
          ovTim: getIdx(SUMMARY_FIELDS.ovTim),
        },
      };
    }
  }
  return null;
}

function extractReportRangeFromRows(rows: any[][]): { reportStartDate?: string; reportEndDate?: string } {
  for (const row of rows.slice(0, 12)) {
    for (const cell of row) {
      const text = String(cell ?? '');
      const match = text.match(/Report from\s*:\s*([0-9/-]+)\s*To\s*:\s*([0-9/-]+)/i);
      if (match) {
        return {
          reportStartDate: parseDateStringToIso(match[1]),
          reportEndDate: parseDateStringToIso(match[2]),
        };
      }
    }
  }
  return {};
}

function extractAttendanceMonthLabel(rows: any[][]): string | undefined {
  for (const row of rows) {
    for (const cell of row) {
      const text = String(cell ?? '').trim();
      if (/Attendnace Month Of:-/i.test(text) || /Attendance Month Of:-/i.test(text)) {
        const label = text.split(':-')[1]?.trim();
        if (label) return label;
      }
    }
  }
  return undefined;
}

export function parseFingerprintAttendanceWorkbook(workbook: WorkbookLike, XLSX: any): FingerprintParseResult {
  for (const sheetName of workbook.SheetNames) {
    const rows = getRows(workbook, sheetName, XLSX);
    if (!rows.length) continue;
    const headerInfo = findFingerprintHeaderMap(rows);
    if (!headerInfo) continue;

    const { colIndex } = headerInfo;
    const { reportStartDate, reportEndDate } = extractReportRangeFromRows(rows);
    const extractedMonthLabel = extractAttendanceMonthLabel(rows);
    const monthKeyFromRange = reportStartDate ? reportStartDate.slice(0, 7) : undefined;
    const monthKey = monthKeyFromRange || deriveMonthKeyFromLabel(extractedMonthLabel || sheetName) || new Date().toISOString().slice(0, 7);
    const monthLabel = extractedMonthLabel || formatMonthKey(monthKey);

    const parsedRows: Omit<HRAttendanceSummaryRow, 'id'>[] = [];
    for (let i = headerInfo.headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const code = String(row[colIndex.empCode] ?? '').trim();
      const name = String(row[colIndex.name] ?? '').trim();
      if (!code || !name) continue;

      if (!/^\d{4,}$/.test(code)) continue;

      const presentDays = parseNumber(row[colIndex.present]);
      const hasSummarySignals = presentDays > 0 ||
        parseNumber(row[colIndex.leave]) > 0 ||
        parseNumber(row[colIndex.absent]) > 0 ||
        parseDurationToMinutes(row[colIndex.workHrs]) > 0 ||
        parseDurationToMinutes(row[colIndex.ovTim]) > 0;
      if (!hasSummarySignals) continue;

      parsedRows.push({
        employeeCode: code,
        employeeName: name,
        presentDays,
        halfLeaveDays: parseNumber(row[colIndex.hl]),
        weeklyOffDays: parseNumber(row[colIndex.wo]),
        absentDays: parseNumber(row[colIndex.absent]),
        leaveDays: parseNumber(row[colIndex.leave]),
        paidDays: parseNumber(row[colIndex.paidDays]),
        lateHoursText: String(row[colIndex.lateHrs] ?? '').trim(),
        lateMinutes: parseDurationToMinutes(row[colIndex.lateHrs]),
        workHoursText: String(row[colIndex.workHrs] ?? '').trim(),
        workMinutes: parseDurationToMinutes(row[colIndex.workHrs]),
        overtimeText: String(row[colIndex.ovTim] ?? '').trim(),
        overtimeMinutes: parseDurationToMinutes(row[colIndex.ovTim]),
        sourceSheet: sheetName,
      });
    }

    return {
      monthKey,
      monthLabel,
      reportStartDate,
      reportEndDate,
      sourceSheetName: sheetName,
      rows: parsedRows,
    };
  }

  throw new Error('Fingerprint summary format not found. Expected monthly performance summary with EmpCode/Name/Present/LateHrs/WorkHrs/OvTim columns.');
}

export function buildAttendanceImport(
  parsed: FingerprintParseResult,
  currentUserId: string,
  sourceFileName?: string
): HRAttendanceImport {
  const now = Date.now();
  return {
    id: `hr-att-${parsed.monthKey}-${now}`,
    monthKey: parsed.monthKey,
    monthLabel: parsed.monthLabel,
    sourceFileName,
    sourceSheetName: parsed.sourceSheetName,
    reportStartDate: parsed.reportStartDate,
    reportEndDate: parsed.reportEndDate,
    rows: parsed.rows.map((row, idx) => ({
      ...row,
      id: `hr-att-row-${parsed.monthKey}-${idx}-${now}`,
    })),
    createdAt: now,
    updatedAt: now,
    createdBy: currentUserId,
  };
}

function normalizeNameKey(name: string): string {
  return normalizeText(name).replace(/[^a-z0-9]/g, '');
}

function eachDateInRange(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export type ApprovedLeaveSummary = {
  approvedLeaveDays: number;
  approvedLeaveDates: string[];
  approvedLeaveByType: Record<string, number>;
  leaveTypeNames: string[];
};

export function getApprovedLeaveSummaryForEmployee(
  employeeNames: string[],
  monthKey: string,
  leaveRequests: LeaveRequest[],
  leaveTypes: LeaveType[]
): ApprovedLeaveSummary {
  const nameKeys = employeeNames.map(normalizeNameKey).filter(Boolean);
  const monthStart = `${monthKey}-01`;
  const [y, m] = monthKey.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
  const leaveTypeMap = new Map(leaveTypes.map((lt) => [lt.id, lt.name]));
  const approvedLeaveDates = new Set<string>();
  const approvedLeaveByType: Record<string, number> = {};

  leaveRequests
    .filter((r) => !r.deleted && r.status === 'approved')
    .forEach((request) => {
      const reqNameKey = normalizeNameKey(request.employeeName || '');
      if (!reqNameKey || !nameKeys.includes(reqNameKey)) return;
      const overlapDates = eachDateInRange(request.startDate, request.endDate)
        .filter((d) => d >= monthStart && d <= monthEnd);
      if (!overlapDates.length) return;

      overlapDates.forEach((d) => approvedLeaveDates.add(d));
      const typeName = leaveTypeMap.get(request.leaveTypeId) || 'Leave';
      approvedLeaveByType[typeName] = (approvedLeaveByType[typeName] || 0) + overlapDates.length;
    });

  return {
    approvedLeaveDays: approvedLeaveDates.size,
    approvedLeaveDates: Array.from(approvedLeaveDates).sort(),
    approvedLeaveByType,
    leaveTypeNames: Object.keys(approvedLeaveByType),
  };
}

export type GeneratedPayrollRow = {
  id: string;
  monthKey: string;
  values: Record<string, string | number | null>;
  meta: {
    staffId?: string;
    employeeCode?: string;
    attendanceMatched: boolean;
    attendanceEmployeeName?: string;
    approvedLeaveDays: number;
    fingerprintLeaveDays: number;
    absentDays: number;
    overtimeMinutes: number;
    lateMinutes: number;
  };
};

export function generatePayrollRowsForMonth(params: {
  monthKey: string;
  staffMembers: HRStaffMember[];
  attendanceImport?: HRAttendanceImport;
  leaveRequests: LeaveRequest[];
  leaveTypes: LeaveType[];
}): GeneratedPayrollRow[] {
  const { monthKey, staffMembers, attendanceImport, leaveRequests, leaveTypes } = params;
  const rows: GeneratedPayrollRow[] = [];
  const attendanceRows = attendanceImport?.rows || [];

  const attendanceByCode = new Map(attendanceRows.map((r) => [r.employeeCode, r]));
  const attendanceByName = new Map(attendanceRows.map((r) => [normalizeNameKey(r.employeeName), r]));
  const usedAttendanceIds = new Set<string>();

  const buildRow = (
    baseId: string,
    source: { staff?: HRStaffMember; attendance?: HRAttendanceSummaryRow; displayName?: string }
  ) => {
    const staff = source.staff;
    const attendance = source.attendance;
    if (attendance) usedAttendanceIds.add(attendance.id);

    const employeeNames = [
      source.displayName || '',
      staff?.fullName || '',
      staff?.userName || '',
      attendance?.employeeName || '',
    ].filter(Boolean);

    const leaveSummary = getApprovedLeaveSummaryForEmployee(employeeNames, monthKey, leaveRequests, leaveTypes);
    const fingerprintLeaveDays = attendance?.leaveDays || 0;
    const absentDays = attendance?.absentDays || 0;
    const latenessHoursDec = minutesToDecimalHours(attendance?.lateMinutes || 0, 3);
    const overtimeHoursDec = minutesToDecimalHours(attendance?.overtimeMinutes || 0, 3);
    const unauthorizedLeave = Math.max(0, absentDays - leaveSummary.approvedLeaveDays);

    const values: Record<string, string | number | null> = {};
    PAYROLL_COLUMNS.forEach((col) => {
      values[col.key] = staff?.payrollDefaults?.[col.key] ?? null;
    });

    values.fullName = staff?.fullName || attendance?.employeeName || source.displayName || '';
    values.userName = staff?.userName || attendance?.employeeName || '';
    values.position = staff?.position || values.position || '';
    values.epfNumber = staff?.epfNumber || values.epfNumber || '';
    values.month = formatMonthKey(monthKey);
    if (attendance) {
      values.hoursWorked = attendance.workHoursText || minutesToText(attendance.workMinutes);
      values.overTime = attendance.overtimeText || overtimeHoursDec;
      values.extraOt = overtimeHoursDec;
      values.lateHours = latenessHoursDec;
      values.sickUnauthorizedLeave = unauthorizedLeave;
      values.hoursDays = leaveSummary.approvedLeaveDays;
      values.reasonHoursDays = leaveSummary.leaveTypeNames.length
        ? leaveSummary.leaveTypeNames.map((name) => `${name}:${leaveSummary.approvedLeaveByType[name]}`).join(', ')
        : null;
      values.remarks = [
        `Present:${attendance.presentDays}`,
        `Paid:${attendance.paidDays}`,
        `FP Leave:${fingerprintLeaveDays}`,
        `Approved Leave:${leaveSummary.approvedLeaveDays}`,
      ].join(' | ');
    }

    rows.push({
      id: baseId,
      monthKey,
      values,
      meta: {
        staffId: staff?.id,
        employeeCode: attendance?.employeeCode || staff?.employeeCode,
        attendanceMatched: !!attendance,
        attendanceEmployeeName: attendance?.employeeName,
        approvedLeaveDays: leaveSummary.approvedLeaveDays,
        fingerprintLeaveDays,
        absentDays,
        overtimeMinutes: attendance?.overtimeMinutes || 0,
        lateMinutes: attendance?.lateMinutes || 0,
      },
    });
  };

  staffMembers
    .filter((s) => !s.deleted && s.active !== false)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .forEach((staff) => {
      const attendance = (staff.employeeCode && attendanceByCode.get(staff.employeeCode))
        || (staff.userName && attendanceByName.get(normalizeNameKey(staff.userName)))
        || attendanceByName.get(normalizeNameKey(staff.fullName));
      buildRow(`payroll-${monthKey}-${staff.id}`, { staff, attendance });
    });

  attendanceRows.forEach((att) => {
    if (usedAttendanceIds.has(att.id)) return;
    buildRow(`payroll-${monthKey}-att-${att.id}`, { attendance: att, displayName: att.employeeName });
  });

  return rows;
}

export function payrollRowsToSheetAoA(rows: GeneratedPayrollRow[]): any[][] {
  const aoa: any[][] = [];
  aoa.push(PAYROLL_COLUMNS.map((c) => c.label));
  rows.forEach((row) => {
    aoa.push(PAYROLL_COLUMNS.map((c) => row.values[c.key] ?? ''));
  });
  return aoa;
}

export function createStaffFromPayrollTemplateRows(
  parsedRows: ParsedPayrollTemplateRow[],
  currentUserId: string,
  existingStaff: HRStaffMember[]
): HRStaffMember[] {
  const now = Date.now();
  const byKey = new Map<string, HRStaffMember>();

  const getKey = (s: { fullName?: string; userName?: string; epfNumber?: string }) =>
    normalizeNameKey(s.epfNumber || '') || normalizeNameKey(s.userName || '') || normalizeNameKey(s.fullName || '');

  existingStaff.forEach((staff) => {
    byKey.set(getKey(staff), staff);
  });

  parsedRows.forEach((row, idx) => {
    const key = getKey(row);
    if (!key) return;
    const existing = byKey.get(key);
    const base: HRStaffMember = existing || {
      id: `hr-staff-${now}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      fullName: row.fullName || row.userName || 'Unnamed',
      createdAt: now + idx,
      createdBy: currentUserId,
      updatedAt: now + idx,
      active: true,
    };

    const compactDefaults: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(row.payrollDefaults || {})) {
      if (!PAYROLL_DEFAULT_IMPORT_KEYS.has(k)) continue;
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      compactDefaults[k] = typeof v === 'string' ? v.trim() : v;
    }

    const updated: HRStaffMember = {
      ...base,
      fullName: row.fullName || base.fullName,
      userName: row.userName || base.userName,
      employeeCode: row.employeeCode || base.employeeCode,
      position: row.position || base.position,
      epfNumber: row.epfNumber || base.epfNumber,
      payrollDefaults: {
        ...(base.payrollDefaults || {}),
        ...compactDefaults,
      },
      updatedAt: now + idx,
      deleted: false,
    };
    byKey.set(key, updated);
  });

  return Array.from(byKey.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function createAttendanceImportSummaryText(importData?: HRAttendanceImport): string {
  if (!importData) return 'No fingerprint attendance imported for selected month.';
  const staffCount = importData.rows.length;
  const totalOtMinutes = importData.rows.reduce((sum, row) => sum + (row.overtimeMinutes || 0), 0);
  const totalLateMinutes = importData.rows.reduce((sum, row) => sum + (row.lateMinutes || 0), 0);
  return `${staffCount} staff | OT ${minutesToText(totalOtMinutes)} | Late ${minutesToText(totalLateMinutes)} | Source: ${importData.sourceFileName || 'manual import'}`;
}
