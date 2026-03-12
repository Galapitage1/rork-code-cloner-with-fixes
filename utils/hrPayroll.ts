import {
  HRAttendanceImport,
  HRAttendanceSummaryRow,
  HRHolidayCalendarSettings,
  HRStaffMember,
  LeaveRequest,
  LeaveType,
} from '@/types';

export type PayrollColumn = {
  key: string;
  label: string;
};

export const PAYROLL_COLUMNS: PayrollColumn[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'userName', label: 'User Name' },
  { key: 'employeeCode', label: 'Employee Code' },
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
  { key: 'overTime', label: 'Fixed Over time' },
  { key: 'serviceChargeEarning', label: 'Fixed Service Charge' },
  { key: 'epfEmployer', label: 'EPF Employer' },
  { key: 'etfEmployer', label: 'ETF Employer' },
  { key: 'epfEmployee', label: 'EPF Employee' },
  { key: 'extraOt', label: 'Extra OT' },
  { key: 'lateHours', label: 'Late hours' },
  { key: 'otMerc', label: 'OT Merc' },
  { key: 'otPublic', label: 'OT Public' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'advance', label: 'Advance' },
  { key: 'overtimeExtraDays', label: 'Overtime (Extra Days)' },
  { key: 'hoursDays', label: 'Hours/Days' },
  { key: 'otherReduction', label: 'Other Reduction' },
  { key: 'reductionReason', label: 'Rason' },
  { key: 'loans', label: 'Loans' },
  { key: 'sickUnauthorizedLeave', label: 'Sick/Unauthoreised Leave' },
  { key: 'serviceChargeReduction', label: 'Service Charge' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'totalSalaryReceiving', label: 'Total Salary Recieving' },
  { key: 'finalSalaryAfterReductions', label: 'Final Salary (After reductions)' },
];

export const PAYROLL_HEADER_LABELS = PAYROLL_COLUMNS.map((c) => c.label);

export const PAYROLL_DEFAULT_IMPORT_KEYS = new Set<string>([
  ...PAYROLL_COLUMNS
    .map((column) => column.key)
    .filter((key) => !['fullName', 'userName', 'employeeCode', 'position', 'epfNumber', 'month', 'remarks', 'otMerc', 'otPublic', 'extraOt', 'lateHours'].includes(key)),
  'employmentType',
  'startingDate',
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
  notes?: string;
  monthLabel?: string;
  payrollDefaults: Record<string, string | number | null>;
};

export type ParsedPayrollTemplate = {
  headers: PayrollColumn[];
  monthLabel?: string;
  rows: ParsedPayrollTemplateRow[];
  sourceSheetName?: string;
};

const STAFF_MASTER_BASE_COLUMNS: PayrollColumn[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'userName', label: 'User Name' },
  { key: 'employeeCode', label: 'Employee Code' },
  { key: 'position', label: 'Position' },
  { key: 'epfNumber', label: 'EPF Number' },
];

export const STAFF_IMPORT_TEMPLATE_COLUMNS: PayrollColumn[] = [
  ...STAFF_MASTER_BASE_COLUMNS,
  { key: 'employmentType', label: 'Employment Type' },
  { key: 'startingDate', label: 'Starting Date' },
  { key: 'basicRatePerHr', label: 'Basic Rate/Hr' },
  { key: 'fullRatePerHr', label: 'Fll Rate/hr' },
  { key: 'hoursPerDay', label: 'Hr/Day' },
  { key: 'totalSalary', label: 'Total Salary' },
  { key: 'basic', label: 'Basic' },
  { key: 'performanceAllowance', label: 'Performance Allawance' },
  { key: 'attendanceAllowance', label: 'Attendence Allawance' },
  { key: 'overTime', label: 'Fixed Over time' },
  { key: 'serviceChargeEarning', label: 'Fixed Service Charge' },
  { key: 'epfEmployer', label: 'EPF Employer' },
  { key: 'etfEmployer', label: 'ETF Employer' },
  { key: 'epfEmployee', label: 'EPF Employee' },
  { key: 'notes', label: 'Notes' },
];

export const STAFF_MASTER_COLUMNS: PayrollColumn[] = [
  ...STAFF_IMPORT_TEMPLATE_COLUMNS,
];

const STAFF_SAMPLE_VALUES: Record<string, string | number> = {
  fullName: 'Example Staff',
  userName: 'Example',
  employeeCode: '00002003',
  position: 'Front End',
  epfNumber: 'EPF123',
  employmentType: 'Full-Time',
  startingDate: '2026-01-01',
  basicRatePerHr: 100,
  fullRatePerHr: 160,
  hoursPerDay: 8,
  totalSalary: 40000,
  basic: 20000,
  performanceAllowance: 12000,
  attendanceAllowance: 2200,
  overTime: 1000,
  serviceChargeEarning: 800,
  epfEmployer: 0,
  etfEmployer: 0,
  epfEmployee: 0,
  notes: 'Sample note',
};

type FingerprintParseResult = {
  monthKey: string;
  monthLabel: string;
  reportStartDate?: string;
  reportEndDate?: string;
  sourceSheetName?: string;
  rows: Omit<HRAttendanceSummaryRow, 'id'>[];
};

type HolidayCategory = 'merc' | 'public';

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

function normalizeEmploymentType(value: unknown): 'Full-Time' | 'Part-Time' | null {
  const key = normalizeText(value);
  if (!key) return null;
  if (key.includes('part')) return 'Part-Time';
  if (key.includes('full')) return 'Full-Time';
  return null;
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const num = parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

function parseNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundToWholeNumber(value: number): number {
  return Math.round(value || 0);
}

function parseHourLikeToMinutes(value: unknown): number {
  const fromDuration = parseDurationToMinutes(value);
  if (fromDuration > 0) return fromDuration;
  const numeric = parseNumberOrNull(value);
  if (numeric === null || numeric <= 0) return 0;
  return Math.round(numeric * 60);
}

function formatHourLikeText(raw: unknown, minutes: number): string {
  const text = String(raw ?? '').trim();
  if (!text) return minutes > 0 ? minutesToText(minutes) : '';
  if (text.includes(':')) return text;
  return minutes > 0 ? minutesToText(minutes) : text;
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

function formatUtcIsoDate(year: number, month: number, day: number): string | undefined {
  if (!year || !month || !day) return undefined;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString().slice(0, 10);
}

function parseDateCellToIso(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30)
    if (value > 20000 && value < 80000) {
      const excelEpochMs = Date.UTC(1899, 11, 30);
      const ms = excelEpochMs + Math.round(value * 24 * 60 * 60 * 1000);
      const dt = new Date(ms);
      if (Number.isFinite(dt.getTime())) return dt.toISOString().slice(0, 10);
    }
    return undefined;
  }

  const text = String(value).trim();
  if (!text) return undefined;

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return formatUtcIsoDate(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10));
  }

  const dmyIso = parseDateStringToIso(text);
  if (dmyIso) return dmyIso;

  const dMonY = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{2,4})$/);
  if (dMonY) {
    const day = parseInt(dMonY[1], 10);
    const month = monthNameToNumber(dMonY[2]);
    let year = parseInt(dMonY[3], 10);
    if (year < 100) year += 2000;
    if (month) return formatUtcIsoDate(year, month, day);
  }

  const monDY = text.match(/^([A-Za-z]{3,9})[-\s]+(\d{1,2}),?\s*(\d{2,4})$/);
  if (monDY) {
    const month = monthNameToNumber(monDY[1]);
    const day = parseInt(monDY[2], 10);
    let year = parseInt(monDY[3], 10);
    if (year < 100) year += 2000;
    if (month) return formatUtcIsoDate(year, month, day);
  }

  return undefined;
}

function approxEqual(left: number, right: number, epsilon = 0.0001): boolean {
  return Math.abs(left - right) <= epsilon;
}

function buildPaidHolidayCategoryByDate(settings?: HRHolidayCalendarSettings | null): Map<string, HolidayCategory> {
  const paidHolidaysByDate = new Map<string, HolidayCategory>();
  const holidays = settings?.holidays || [];
  for (const holiday of holidays) {
    if (!holiday || holiday.getPaid !== true) continue;
    const dateIso = parseDateCellToIso(holiday.date);
    if (!dateIso) continue;
    const times = Number(holiday.times);
    if (!Number.isFinite(times)) continue;
    if (approxEqual(times, 1.5)) {
      paidHolidaysByDate.set(dateIso, 'merc');
      continue;
    }
    if (approxEqual(times, 2)) {
      paidHolidaysByDate.set(dateIso, 'public');
    }
  }
  return paidHolidaysByDate;
}

function toIsoFromMonthKeyAndDay(monthKey: string | undefined, day: number): string | undefined {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return undefined;
  if (!Number.isFinite(day) || day < 1 || day > 31) return undefined;
  const [yearText, monthText] = monthKey.split('-');
  const year = parseInt(yearText, 10);
  const month = parseInt(monthText, 10);
  if (!year || !month) return undefined;
  return formatUtcIsoDate(year, month, Math.floor(day));
}

function parseDayNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 1 && value <= 31) return value;
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (!/^\d{1,2}$/.test(text)) return null;
  const day = Number(text);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return day;
}

function resolveStatusColumnDateIso(
  rows: any[][],
  statusRowIndex: number,
  statusColIndex: number,
  monthKey?: string
): string | undefined {
  const lookbackLimit = Math.max(0, statusRowIndex - 12);
  for (let rowIndex = statusRowIndex; rowIndex >= lookbackLimit; rowIndex -= 1) {
    const row = rows[rowIndex] || [];
    const candidates = [
      row[statusColIndex],
      statusColIndex > 0 ? row[statusColIndex - 1] : undefined,
      row[statusColIndex + 1],
    ];
    for (const candidate of candidates) {
      const dateIso = parseDateCellToIso(candidate);
      if (dateIso) return dateIso;
      const day = parseDayNumber(candidate);
      if (day !== null) {
        const dayIso = toIsoFromMonthKeyAndDay(monthKey, day);
        if (dayIso) return dayIso;
      }
    }
  }
  return undefined;
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
    STAFF_IMPORT_TEMPLATE_COLUMNS.forEach((col) => {
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
      STAFF_IMPORT_TEMPLATE_COLUMNS.forEach((col) => {
        if (['fullName', 'userName', 'employeeCode', 'position', 'epfNumber', 'notes'].includes(col.key)) return;
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
        notes: String(row[headerIndexMap.get('notes') ?? -1] ?? '').trim() || undefined,
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
  const sampleRow = STAFF_IMPORT_TEMPLATE_COLUMNS.map((column) => STAFF_SAMPLE_VALUES[column.key] ?? '');
  const titleRow = Array.from({ length: headerRow.length }, (_, idx) =>
    idx === 0 ? 'Staff Import Template (Full Master Columns)' : ''
  );
  return [
    titleRow,
    headerRow,
    sampleRow,
  ];
}

type FingerprintHeaderInfo = { headerRowIndex: number; colIndex: Record<string, number>; score: number };

type NamedHolidayMinutesMap = { byCode: Map<string, number>; byName: Map<string, number>; globalMinutes: number };
type HolidayMinutesMap = {
  total: NamedHolidayMinutesMap;
  merc: NamedHolidayMinutesMap;
  public: NamedHolidayMinutesMap;
};

function findIndexByAliases(normalizedRow: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map((value) => normalizeText(value));
  let index = normalizedRow.findIndex((value) => normalizedAliases.includes(value));
  if (index >= 0) return index;
  index = normalizedRow.findIndex((value) => normalizedAliases.some((alias) => value.includes(alias)));
  return index;
}

function normalizeCodeKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function looksLikeEmployeeCode(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const normalized = normalizeText(text);
  if (['empcode', 'employeecode', 'code', 'total', 'grandtotal', 'status'].includes(normalized)) return false;
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount < 4) return false;
  if (!/^[A-Za-z0-9/_-]+$/.test(text)) return false;
  return text.length >= 3;
}

function looksLikeEmployeeName(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const normalized = normalizeText(text);
  if (['name', 'employee', 'employeename', 'status', 'total', 'grandtotal', 'report'].includes(normalized)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  return text.length >= 2;
}

function findFingerprintHeaderMap(rows: any[][]): FingerprintHeaderInfo | null {
  let best: FingerprintHeaderInfo | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const normalized = row.map(normalizeText);
    const empCodeIndex = findIndexByAliases(normalized, ['EmpCode', 'Employee Code', 'EmployeeCode', 'Emp Code']);
    const nameIndex = findIndexByAliases(normalized, ['Name', 'Employee Name', 'EmployeeName']);
    const presentIndex = findIndexByAliases(normalized, ['Present', 'PresentDays', 'Present Days']);
    if (empCodeIndex < 0 || nameIndex < 0 || presentIndex < 0) continue;

    const getIdx = (aliases: string[]) => findIndexByAliases(normalized, aliases);
    const colIndex = {
      empCode: empCodeIndex,
      name: nameIndex,
      present: presentIndex,
      hl: getIdx([SUMMARY_FIELDS.hl, 'Half Leave', 'HalfLeave']),
      wo: getIdx([SUMMARY_FIELDS.wo, 'Week Off', 'Weekly Off', 'WeeklyOff']),
      absent: getIdx([SUMMARY_FIELDS.absent, 'Absent Days', 'AbsentDays']),
      leave: getIdx([SUMMARY_FIELDS.leave, 'Leave Days', 'LeaveDays']),
      paidDays: getIdx([SUMMARY_FIELDS.paidDays, 'Paid Days', 'PaidDays']),
      lateHrs: getIdx([SUMMARY_FIELDS.lateHrs, 'LateHours', 'Late Hrs', 'Late']),
      workHrs: getIdx([SUMMARY_FIELDS.workHrs, 'WorkHours', 'Worked Hours', 'WorkedHours']),
      ovTim: getIdx([SUMMARY_FIELDS.ovTim, 'Overtime', 'OT', 'Over Time']),
      holidays: getIdx(['Holidays', 'Holiday', 'POH', 'Public Holiday', 'PH']),
    };
    const score = Object.values(colIndex).reduce((sum, idx) => (idx >= 0 ? sum + 1 : sum), 0);
    if (!best || score > best.score) {
      best = { headerRowIndex: i, colIndex, score };
    }
  }
  return best;
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

function addHolidayMinutesToMap(map: Map<string, number>, key: string, minutes: number) {
  if (!key || minutes <= 0) return;
  map.set(key, (map.get(key) || 0) + minutes);
}

function createEmptyNamedHolidayMinutesMap(): NamedHolidayMinutesMap {
  return {
    byCode: new Map<string, number>(),
    byName: new Map<string, number>(),
    globalMinutes: 0,
  };
}

function createEmptyHolidayMinutesMap(): HolidayMinutesMap {
  return {
    total: createEmptyNamedHolidayMinutesMap(),
    merc: createEmptyNamedHolidayMinutesMap(),
    public: createEmptyNamedHolidayMinutesMap(),
  };
}

function addHolidayMinutesToNamedMap(
  map: NamedHolidayMinutesMap,
  codeKey: string,
  nameKey: string,
  minutes: number
) {
  if (codeKey) {
    addHolidayMinutesToMap(map.byCode, codeKey, minutes);
    return;
  }
  if (nameKey) {
    addHolidayMinutesToMap(map.byName, nameKey, minutes);
    return;
  }
  map.globalMinutes += Math.max(0, minutes);
}

function addCategorizedHolidayMinutes(
  map: HolidayMinutesMap,
  category: HolidayCategory | undefined,
  codeKey: string,
  nameKey: string,
  minutes: number
) {
  if (!category || minutes <= 0) return;
  addHolidayMinutesToNamedMap(map.total, codeKey, nameKey, minutes);
  if (category === 'merc') {
    addHolidayMinutesToNamedMap(map.merc, codeKey, nameKey, minutes);
    return;
  }
  addHolidayMinutesToNamedMap(map.public, codeKey, nameKey, minutes);
}

function getHolidayMinutesForEmployee(
  map: NamedHolidayMinutesMap,
  employeeCode: string,
  employeeName: string
): number {
  return (
    map.byCode.get(normalizeCodeKey(employeeCode)) ||
    map.byName.get(normalizeNameKey(employeeName)) ||
    0
  );
}

function hasAnyHolidayMinutes(map: HolidayMinutesMap): boolean {
  return map.total.byCode.size > 0 || map.total.byName.size > 0 || map.total.globalMinutes > 0;
}

function extractHolidayMinutesFromEmployeeBlocks(
  rows: any[][],
  paidHolidayCategoryByDate: Map<string, HolidayCategory>,
  monthKey?: string
): HolidayMinutesMap {
  const holidayMinutes = createEmptyHolidayMinutesMap();

  const isEmpHeaderRow = (row: any[]) => {
    const b = normalizeText(row?.[1]);
    const d = normalizeText(row?.[3]);
    return (b === normalizeText('EmpCode') || b === normalizeText('Employee Code')) &&
      (d === normalizeText('Name') || d === normalizeText('Employee Name'));
  };
  const isStatusLabel = (value: unknown) => normalizeText(value) === normalizeText('Status');
  const isOvertimeLabel = (value: unknown) => {
    const n = normalizeText(value);
    return n === normalizeText('O.Times Hrs.') ||
      n === normalizeText('O.Times Hrs') ||
      n === normalizeText('OTimes Hrs.') ||
      n === normalizeText('OTimes Hrs');
  };

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    if (!isEmpHeaderRow(row)) continue;

    const dataRow = rows[r + 1] || [];
    const employeeCode = String(dataRow[1] ?? '').trim();
    const employeeName = String(dataRow[3] ?? '').trim();
    if (!looksLikeEmployeeCode(employeeCode) || !looksLikeEmployeeName(employeeName)) continue;

    let statusRowIndex = -1;
    let overtimeRowIndex = -1;
    const blockEnd = Math.min(rows.length, r + 16);
    for (let k = r + 2; k < blockEnd; k += 1) {
      const label = (rows[k] || [])[1];
      if (isStatusLabel(label)) statusRowIndex = k;
      if (isOvertimeLabel(label)) overtimeRowIndex = k;
    }
    if (statusRowIndex < 0 || overtimeRowIndex < 0) continue;

    const statusRow = rows[statusRowIndex] || [];
    const overtimeRow = rows[overtimeRowIndex] || [];
    const width = Math.max(statusRow.length, overtimeRow.length);
    for (let c = 0; c < width; c += 1) {
      if (normalizeText(statusRow[c]) !== normalizeText('POH')) continue;
      const dayMinutes = parseHourLikeToMinutes(overtimeRow[c]);
      if (dayMinutes <= 0) continue;
      const dateIso = resolveStatusColumnDateIso(rows, statusRowIndex, c, monthKey);
      const category = dateIso ? paidHolidayCategoryByDate.get(dateIso) : undefined;
      addCategorizedHolidayMinutes(
        holidayMinutes,
        category,
        normalizeCodeKey(employeeCode),
        normalizeNameKey(employeeName),
        dayMinutes
      );
    }
  }

  return holidayMinutes;
}

function extractPublicHolidayMinutesByEmployee(
  rows: any[][],
  headerInfo: FingerprintHeaderInfo | null | undefined,
  paidHolidayCategoryByDate: Map<string, HolidayCategory>,
  monthKey?: string
): HolidayMinutesMap {
  const fromBlocks = extractHolidayMinutesFromEmployeeBlocks(rows, paidHolidayCategoryByDate, monthKey);
  if (hasAnyHolidayMinutes(fromBlocks)) {
    return fromBlocks;
  }

  const holidayMinutes = createEmptyHolidayMinutesMap();

  let headerRowIndex = -1;
  let statusColIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i += 1) {
    const row = rows[i] || [];
    const normalized = row.map(normalizeText);
    const idx = findIndexByAliases(normalized, ['Status']);
    if (idx >= 0) {
      headerRowIndex = i;
      statusColIndex = idx;
      break;
    }
  }
  if (statusColIndex < 0) {
    statusColIndex = 1; // fallback: user indicated Status is column B
  }

  const statusHeaderRow = headerRowIndex >= 0 ? (rows[headerRowIndex] || []) : [];
  const normalizedStatusHeader = statusHeaderRow.map(normalizeText);
  const empCodeCol = findIndexByAliases(normalizedStatusHeader, ['EmpCode', 'Employee Code', 'EmployeeCode', 'Emp Code']);
  const employeeNameCol = findIndexByAliases(normalizedStatusHeader, ['Name', 'Employee Name', 'EmployeeName']);
  const fallbackEmpCodeCol = headerInfo?.colIndex?.empCode ?? 0;
  const fallbackNameCol = headerInfo?.colIndex?.name ?? 2;
  const fallbackOvertimeCol = headerInfo?.colIndex?.ovTim ?? -1;
  const codeCol = empCodeCol >= 0 ? empCodeCol : fallbackEmpCodeCol;
  const nameCol = employeeNameCol >= 0 ? employeeNameCol : fallbackNameCol;

  let lastKnownCode = '';
  let lastKnownName = '';

  const startRowIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const employeeCode = String(row[codeCol] ?? '').trim();
    const employeeName = String(row[nameCol] ?? '').trim();
    if (looksLikeEmployeeCode(employeeCode)) {
      lastKnownCode = employeeCode;
    }
    if (looksLikeEmployeeName(employeeName)) {
      lastKnownName = employeeName;
    }

    const statusValue = normalizeText(row[statusColIndex]);
    if (statusValue !== normalizeText('POH')) continue;

    const previousRow = rowIndex > 0 ? (rows[rowIndex - 1] || []) : [];
    const minutesCandidates = [
      parseHourLikeToMinutes(previousRow[statusColIndex - 1]),
      parseHourLikeToMinutes(previousRow[statusColIndex]),
      parseHourLikeToMinutes(previousRow[statusColIndex + 1]),
      parseHourLikeToMinutes(row[statusColIndex - 1]),
      parseHourLikeToMinutes(row[statusColIndex + 1]),
      parseHourLikeToMinutes(fallbackOvertimeCol >= 0 ? row[fallbackOvertimeCol] : undefined),
      parseHourLikeToMinutes(fallbackOvertimeCol >= 0 ? previousRow[fallbackOvertimeCol] : undefined),
    ];
    const matchedMinutes = minutesCandidates.find((mins) => mins > 0) || 0;
    if (matchedMinutes <= 0) continue;

    const dateIso = resolveStatusColumnDateIso(rows, rowIndex, statusColIndex, monthKey);
    const category = dateIso ? paidHolidayCategoryByDate.get(dateIso) : undefined;

    const mappedCode = looksLikeEmployeeCode(employeeCode) ? employeeCode : lastKnownCode;
    const mappedName = looksLikeEmployeeName(employeeName) ? employeeName : lastKnownName;
    addCategorizedHolidayMinutes(
      holidayMinutes,
      category,
      normalizeCodeKey(mappedCode),
      normalizeNameKey(mappedName),
      matchedMinutes
    );
  }

  return holidayMinutes;
}

function mergeNamedHolidayMinutesMap(base: NamedHolidayMinutesMap, incoming: NamedHolidayMinutesMap) {
  incoming.byCode.forEach((value, key) => addHolidayMinutesToMap(base.byCode, key, value));
  incoming.byName.forEach((value, key) => addHolidayMinutesToMap(base.byName, key, value));
  base.globalMinutes += incoming.globalMinutes || 0;
}

function mergeHolidayMinutesMap(base: HolidayMinutesMap, incoming: HolidayMinutesMap) {
  mergeNamedHolidayMinutesMap(base.total, incoming.total);
  mergeNamedHolidayMinutesMap(base.merc, incoming.merc);
  mergeNamedHolidayMinutesMap(base.public, incoming.public);
}

function parseFingerprintSummaryRows(
  rows: any[][],
  headerInfo: FingerprintHeaderInfo,
  sheetName: string,
  holidayMinutesMap: HolidayMinutesMap
): Omit<HRAttendanceSummaryRow, 'id'>[] {
  const parsedRows: Omit<HRAttendanceSummaryRow, 'id'>[] = [];
  const { colIndex } = headerInfo;
  for (let i = headerInfo.headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const code = String(row[colIndex.empCode] ?? '').trim();
    const name = String(row[colIndex.name] ?? '').trim();
    if (!looksLikeEmployeeCode(code) || !looksLikeEmployeeName(name)) continue;

    const rawOvertimeMinutes = parseHourLikeToMinutes(row[colIndex.ovTim]);
    const holidayMercMinutes = Math.max(0, getHolidayMinutesForEmployee(holidayMinutesMap.merc, code, name));
    const holidayPublicMinutes = Math.max(0, getHolidayMinutesForEmployee(holidayMinutesMap.public, code, name));
    const holidaysMinutes = holidayMercMinutes + holidayPublicMinutes;
    const adjustedOvertimeMinutes = Math.max(0, rawOvertimeMinutes - holidaysMinutes);

    const lateMinutes = parseHourLikeToMinutes(row[colIndex.lateHrs]);
    const workMinutes = parseHourLikeToMinutes(row[colIndex.workHrs]);
    const presentDays = parseNumber(row[colIndex.present]);
    const hasSummarySignals = presentDays > 0 ||
      parseNumber(row[colIndex.leave]) > 0 ||
      parseNumber(row[colIndex.absent]) > 0 ||
      workMinutes > 0 ||
      rawOvertimeMinutes > 0 ||
      lateMinutes > 0 ||
      holidaysMinutes > 0;
    if (!hasSummarySignals) continue;

    parsedRows.push({
      employeeCode: code,
      employeeName: name,
      presentDays,
      halfLeaveDays: parseNumber(row[colIndex.hl]),
      weeklyOffDays: parseNumber(row[colIndex.wo]),
      absentDays: parseNumber(row[colIndex.absent]),
      leaveDays: parseNumber(row[colIndex.leave]),
      paidDays: roundToWholeNumber(parseNumber(row[colIndex.paidDays])),
      lateHoursText: formatHourLikeText(row[colIndex.lateHrs], lateMinutes),
      lateMinutes,
      workHoursText: formatHourLikeText(row[colIndex.workHrs], workMinutes),
      workMinutes,
      overtimeText: adjustedOvertimeMinutes > 0 ? minutesToText(adjustedOvertimeMinutes) : '',
      overtimeMinutes: adjustedOvertimeMinutes,
      holidaysText: holidaysMinutes > 0 ? minutesToText(holidaysMinutes) : '',
      holidaysMinutes,
      holidayMercText: holidayMercMinutes > 0 ? minutesToText(holidayMercMinutes) : '',
      holidayMercMinutes,
      holidayPublicText: holidayPublicMinutes > 0 ? minutesToText(holidayPublicMinutes) : '',
      holidayPublicMinutes,
      sourceSheet: sheetName,
    });
  }
  return parsedRows;
}

export function parseFingerprintAttendanceWorkbook(
  workbook: WorkbookLike,
  XLSX: any,
  options?: { holidayCalendarSettings?: HRHolidayCalendarSettings | null }
): FingerprintParseResult {
  let bestSheetName: string | null = null;
  let bestRows: any[][] | null = null;
  let bestHeaderInfo: FingerprintHeaderInfo | null = null;
  let bestSheetScore = -1;
  const paidHolidayCategoryByDate = buildPaidHolidayCategoryByDate(options?.holidayCalendarSettings);
  const workbookHolidayMinutes: HolidayMinutesMap = createEmptyHolidayMinutesMap();

  for (const sheetName of workbook.SheetNames) {
    const rows = getRows(workbook, sheetName, XLSX);
    if (!rows.length) continue;

    const headerInfo = findFingerprintHeaderMap(rows);
    const sheetReportRange = extractReportRangeFromRows(rows);
    const sheetMonthLabel = extractAttendanceMonthLabel(rows);
    const sheetMonthKey =
      (sheetReportRange.reportStartDate ? sheetReportRange.reportStartDate.slice(0, 7) : undefined) ||
      deriveMonthKeyFromLabel(sheetMonthLabel || sheetName);
    const sheetHolidayMinutes = extractPublicHolidayMinutesByEmployee(
      rows,
      headerInfo,
      paidHolidayCategoryByDate,
      sheetMonthKey
    );
    mergeHolidayMinutesMap(workbookHolidayMinutes, sheetHolidayMinutes);
    if (!headerInfo) continue;

    const parsedRows = parseFingerprintSummaryRows(rows, headerInfo, sheetName, createEmptyHolidayMinutesMap());
    const hasReportRange = !!sheetReportRange.reportStartDate;
    const hasMonthLabel = !!sheetMonthLabel;
    const sheetScore =
      (parsedRows.length * 10) +
      (headerInfo.score * 3) +
      (hasReportRange ? 30 : 0) +
      (hasMonthLabel ? 20 : 0);

    if (sheetScore > bestSheetScore) {
      bestSheetScore = sheetScore;
      bestSheetName = sheetName;
      bestRows = rows;
      bestHeaderInfo = headerInfo;
    }
  }

  if (!bestSheetName || !bestRows || !bestHeaderInfo) {
    throw new Error('Fingerprint summary format not found. Expected monthly performance summary with EmpCode/Name/Present/LateHrs/WorkHrs/OvTim columns.');
  }

  const { reportStartDate, reportEndDate } = extractReportRangeFromRows(bestRows);
  const extractedMonthLabel = extractAttendanceMonthLabel(bestRows);
  const monthKeyFromRange = reportStartDate ? reportStartDate.slice(0, 7) : undefined;
  const monthKey = monthKeyFromRange || deriveMonthKeyFromLabel(extractedMonthLabel || bestSheetName) || new Date().toISOString().slice(0, 7);
  const monthLabel = extractedMonthLabel || formatMonthKey(monthKey);
  const parsedRows = parseFingerprintSummaryRows(bestRows, bestHeaderInfo, bestSheetName, workbookHolidayMinutes);

  return {
    monthKey,
    monthLabel,
    reportStartDate,
    reportEndDate,
    sourceSheetName: bestSheetName,
    rows: parsedRows,
  };
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
  leaveTypes: LeaveType[],
  staffId?: string
): ApprovedLeaveSummary {
  const nameKeys = employeeNames.map(normalizeNameKey).filter(Boolean);
  const staffKey = String(staffId || '').trim();
  const monthStart = `${monthKey}-01`;
  const [y, m] = monthKey.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
  const leaveTypeMap = new Map(leaveTypes.map((lt) => [lt.id, lt.name]));
  const approvedLeaveDates = new Set<string>();
  const approvedLeaveByType: Record<string, number> = {};

  leaveRequests
    .filter((r) => !r.deleted && r.status === 'approved')
    .forEach((request) => {
      const requestStaffId = String(request.staffId || '').trim();
      const matchedByStaffId = !!staffKey && !!requestStaffId && requestStaffId === staffKey;
      if (!matchedByStaffId) {
        const reqNameKey = normalizeNameKey(request.employeeName || '');
        if (!reqNameKey || !nameKeys.includes(reqNameKey)) return;
      }
      const overlapDates = eachDateInRange(request.startDate, request.endDate)
        .filter((d) => d >= monthStart && d <= monthEnd);
      if (!overlapDates.length) return;

      overlapDates.forEach((d) => approvedLeaveDates.add(d));
      const overlapDayCount =
        request.startDate === request.endDate && request.dayPortion === 0.5
          ? 0.5
          : overlapDates.length;
      const typeName = leaveTypeMap.get(request.leaveTypeId) || 'Leave';
      approvedLeaveByType[typeName] = (approvedLeaveByType[typeName] || 0) + overlapDayCount;
    });

  return {
    approvedLeaveDays: Object.values(approvedLeaveByType).reduce((sum, value) => sum + (value || 0), 0),
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
    attendanceRowId?: string;
    attendanceMatched: boolean;
    attendanceEmployeeName?: string;
    approvedLeaveDays: number;
    unpaidLeaveDays: number;
    fingerprintLeaveDays: number;
    absentDays: number;
    overtimeMinutes: number;
    lateMinutes: number;
    holidayMercMinutes: number;
    holidayPublicMinutes: number;
    employmentType: 'Full-Time' | 'Part-Time';
  };
};

function isUnpaidLeaveTypeName(typeName: string): boolean {
  const key = normalizeNameKey(typeName || '');
  if (!key) return false;
  if (key === 'unpaidleave' || key === 'leaveunpaid') return true;
  if (key === 'sickleaveunpaid' || key === 'sickunpaidleave') return true;
  return key.includes('unpaid') && key.includes('leave');
}

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

    const leaveSummary = getApprovedLeaveSummaryForEmployee(employeeNames, monthKey, leaveRequests, leaveTypes, staff?.id);
    const fingerprintLeaveDays = attendance?.leaveDays || 0;
    const absentDays = attendance?.absentDays || 0;
    const latenessHoursDec = minutesToDecimalHours(attendance?.lateMinutes || 0, 3);
    const overtimeHoursDec = minutesToDecimalHours(attendance?.overtimeMinutes || 0, 3);
    const unpaidLeaveDays = Object.entries(leaveSummary.approvedLeaveByType).reduce((sum, [typeName, count]) => {
      if (isUnpaidLeaveTypeName(typeName)) {
        return sum + (count || 0);
      }
      return sum;
    }, 0);

    const values: Record<string, string | number | null> = {};
    PAYROLL_COLUMNS.forEach((col) => {
      values[col.key] = staff?.payrollDefaults?.[col.key] ?? null;
    });

    const basicRate = parseNumberOrNull(values.basicRatePerHr);
    const fullRate = parseNumberOrNull(values.fullRatePerHr);
    const hoursPerDay = parseNumberOrNull(values.hoursPerDay);
    if (basicRate !== null) values.basicRatePerHr = roundToWholeNumber(basicRate);
    if (fullRate !== null) values.fullRatePerHr = roundToWholeNumber(fullRate);

    values.fullName = staff?.fullName || attendance?.employeeName || source.displayName || '';
    values.userName = staff?.userName || attendance?.employeeName || '';
    values.employeeCode = staff?.employeeCode || attendance?.employeeCode || '';
    values.position = staff?.position || values.position || '';
    values.epfNumber = staff?.epfNumber || values.epfNumber || '';
    values.month = formatMonthKey(monthKey);
    const employmentType = normalizeEmploymentType(staff?.payrollDefaults?.employmentType) || 'Full-Time';
    values.employmentType = employmentType;
    const effectiveFullRate = fullRate !== null ? fullRate : 0;
    const effectiveHoursPerDay = hoursPerDay !== null ? hoursPerDay : 0;
    const isActiveStaff = !!staff && staff.active !== false && !staff.deleted;
    values.sickUnauthorizedLeave = isActiveStaff
      ? roundToWholeNumber(unpaidLeaveDays * effectiveFullRate * effectiveHoursPerDay)
      : 0;
    values.hoursDays = isActiveStaff ? leaveSummary.approvedLeaveDays : 0;

    if (attendance) {
      const attendanceHours = minutesToDecimalHours(attendance.workMinutes || 0, 3);
      const existingHoursWorked = parseNumberOrNull(values.hoursWorked);
      if (existingHoursWorked === null || existingHoursWorked <= 0) {
        values.hoursWorked = roundToWholeNumber(attendanceHours);
      }
      const effectiveBasicRate = basicRate !== null ? basicRate : 0;
      const holidayMercHoursDec = minutesToDecimalHours(attendance.holidayMercMinutes || 0, 3);
      const holidayPublicHoursDec = minutesToDecimalHours(attendance.holidayPublicMinutes || 0, 3);
      const extraOtAmount = roundToWholeNumber(overtimeHoursDec * effectiveFullRate);
      const lateAmount = roundToWholeNumber(latenessHoursDec * effectiveFullRate);
      const otMercAmount = roundToWholeNumber(holidayMercHoursDec * effectiveBasicRate);
      const otPublicAmount = roundToWholeNumber(holidayPublicHoursDec * effectiveBasicRate);

      values.extraOt = extraOtAmount;
      values.lateHours = lateAmount;
      values.otMerc = otMercAmount;
      values.otPublic = otPublicAmount;
      values.remarks = `OT Merc Hrs:${holidayMercHoursDec.toFixed(2)} | OT Public Hrs:${holidayPublicHoursDec.toFixed(2)}`;
    }

    if (employmentType === 'Part-Time') {
      const hoursWorked = parseNumberOrNull(values.hoursWorked) || 0;
      values.performanceAllowance = roundToWholeNumber(hoursWorked * 176.8);
    }

    const performanceAllowance = parseNumberOrNull(values.performanceAllowance) || 0;
    const totalSalary = employmentType === 'Part-Time'
      ? performanceAllowance
      : (
          (parseNumberOrNull(values.basic) || 0) +
          performanceAllowance +
          (parseNumberOrNull(values.attendanceAllowance) || 0) +
          (parseNumberOrNull(values.overTime) || 0) +
          (parseNumberOrNull(values.serviceChargeEarning) || 0) +
          (parseNumberOrNull(values.epfEmployer) || 0) +
          (parseNumberOrNull(values.etfEmployer) || 0)
        );
    values.totalSalary = roundToWholeNumber(totalSalary);

    rows.push({
      id: baseId,
      monthKey,
      values,
      meta: {
        staffId: staff?.id,
        employeeCode: attendance?.employeeCode || staff?.employeeCode,
        attendanceRowId: attendance?.id,
        attendanceMatched: !!attendance,
        attendanceEmployeeName: attendance?.employeeName,
        approvedLeaveDays: leaveSummary.approvedLeaveDays,
        unpaidLeaveDays,
        fingerprintLeaveDays,
        absentDays,
        overtimeMinutes: attendance?.overtimeMinutes || 0,
        lateMinutes: attendance?.lateMinutes || 0,
        holidayMercMinutes: attendance?.holidayMercMinutes || 0,
        holidayPublicMinutes: attendance?.holidayPublicMinutes || 0,
        employmentType,
      },
    });
  };

  staffMembers
    .filter((s) => !s.deleted && s.active !== false)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .forEach((staff) => {
      const attendance = (staff.employeeCode && attendanceByCode.get(staff.employeeCode))
        || attendanceByName.get(normalizeNameKey(staff.fullName))
        || (staff.userName && attendanceByName.get(normalizeNameKey(staff.userName)));
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
      if (k === 'basicRatePerHr' || k === 'fullRatePerHr') {
        const numericRate = parseNumberOrNull(v);
        if (numericRate === null) continue;
        compactDefaults[k] = roundToOneDecimal(numericRate);
        continue;
      }
      if (k === 'employmentType') {
        const normalizedEmployment = normalizeEmploymentType(v);
        if (!normalizedEmployment) continue;
        compactDefaults[k] = normalizedEmployment;
        continue;
      }
      compactDefaults[k] = typeof v === 'string' ? v.trim() : v;
    }

    const importedNotes = typeof row.notes === 'string' ? row.notes.trim() : undefined;

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
      notes: importedNotes !== undefined ? (importedNotes || undefined) : base.notes,
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
