import * as XLSX from 'xlsx';
import { writeAsStringAsync, getInfoAsync } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { Supplier } from '@/types';

export async function exportSuppliersToExcel(suppliers: Supplier[]): Promise<void> {
  console.log('=== SUPPLIERS EXPORT START ===');
  console.log('Platform:', Platform.OS);
  console.log('Suppliers:', suppliers.length);
  
  try {
    if (!suppliers || suppliers.length === 0) {
      throw new Error('No suppliers to export');
    }

    const suppliersData = suppliers.map(supplier => ({
      'Supplier Name': supplier.name,
      'Address': supplier.address || '',
      'Phone': supplier.phone || '',
      'Email': supplier.email || '',
      'Contact Person': supplier.contactPerson || '',
      'Contact Person Phone': supplier.contactPersonPhone || '',
      'Contact Person Email': supplier.contactPersonEmail || '',
      'VAT Number': supplier.vatNumber || '',
      'Notes': supplier.notes || '',
    }));
    
    console.log('Suppliers data prepared:', suppliersData.length, 'rows');

    console.log('Creating workbook...');
    const wb = XLSX.utils.book_new();
    console.log('Workbook created');
    
    const suppliersWs = XLSX.utils.json_to_sheet(suppliersData);
    XLSX.utils.book_append_sheet(wb, suppliersWs, 'Suppliers');
    console.log('Suppliers sheet added');

    console.log('Writing workbook...');
    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    console.log('Workbook written, size:', wbout.length, 'chars');
    
    const fileName = `suppliers_${new Date().toISOString().split('T')[0]}.xlsx`;
    console.log('File name:', fileName);
    
    if (Platform.OS === 'web') {
      console.log('Starting web export...');
      try {
        const blob = base64ToBlob(wbout, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        console.log('Blob created, size:', blob.size);
        
        const url = URL.createObjectURL(blob);
        console.log('Object URL created:', url);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        console.log('Link added to DOM');
        
        link.click();
        console.log('Link clicked');
        
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('Cleanup completed');
        }, 100);
        
        console.log('=== WEB EXPORT COMPLETED ===');
      } catch (webError) {
        console.error('Web export error:', webError);
        throw new Error(`Web export failed: ${webError instanceof Error ? webError.message : 'Unknown error'}`);
      }
    } else {
      console.log('Starting mobile export...');
      try {
        if (!(FileSystem as any).documentDirectory) {
          throw new Error('Document directory not available');
        }
        
        const fileUri = `${(FileSystem as any).documentDirectory}${fileName}`;
        console.log('File URI:', fileUri);
        
        await writeAsStringAsync(fileUri, wbout, {
          encoding: 'base64',
        });
        console.log('File written successfully');
        
        const fileInfo = await getInfoAsync(fileUri);
        console.log('File info:', fileInfo);
        
        const canShare = await Sharing.isAvailableAsync();
        console.log('Sharing available:', canShare);
        
        if (!canShare) {
          throw new Error('Sharing is not available on this device');
        }
        
        console.log('Starting share dialog...');
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Save Suppliers List',
          UTI: 'com.microsoft.excel.xlsx',
        });
        console.log('=== MOBILE EXPORT COMPLETED ===');
      } catch (mobileError) {
        console.error('Mobile export error:', mobileError);
        throw new Error(`Mobile export failed: ${mobileError instanceof Error ? mobileError.message : 'Unknown error'}`);
      }
    }
  } catch (error) {
    console.error('=== EXPORT FAILED ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
}

export interface ParsedSuppliersData {
  suppliers: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[];
  errors: string[];
}

export function parseSuppliersExcel(base64Data: string): ParsedSuppliersData {
  const errors: string[] = [];
  const suppliers: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[] = [];

  try {
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    
    if (workbook.SheetNames.length === 0) {
      errors.push('Excel file has no sheets');
      return { suppliers, errors };
    }

    const seenKeys = new Set<string>();
    const sheetErrors: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      if (!jsonData || jsonData.length === 0) {
        sheetErrors.push(`Sheet "${sheetName}" has no rows`);
        continue;
      }

      const parsed = parseSuppliersFromRows(jsonData);
      if (parsed.suppliers.length === 0) {
        if (parsed.errors.length > 0) {
          sheetErrors.push(`Sheet "${sheetName}": ${parsed.errors.join(' | ')}`);
        }
        continue;
      }

      for (const supplier of parsed.suppliers) {
        const key = `${String(supplier.name || '').trim().toLowerCase()}__${String(supplier.address || '').trim().toLowerCase()}`;
        if (!supplier.name || seenKeys.has(key)) continue;
        seenKeys.add(key);
        suppliers.push(supplier);
      }
    }

    if (suppliers.length === 0) {
      errors.push(
        sheetErrors.length > 0
          ? `${sheetErrors.join('\n')}\nNo valid suppliers found in Excel file`
          : 'No valid suppliers found in Excel file'
      );
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { suppliers, errors };
}

function parseSuppliersFromRows(rows: any[][]): ParsedSuppliersData {
  const errors: string[] = [];
  const suppliers: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[] = [];

  if (rows.length < 1) {
    errors.push('No data rows found in Excel file');
    return { suppliers, errors };
  }

  const headerRow = rows[0] || [];
  const headers = headerRow.map((h: any) => String(h ?? '').toLowerCase().trim());
  const nameIndex = headers.findIndex((h: string) => (h.includes('supplier') && h.includes('name')) || h === 'name');
  const addressIndex = headers.findIndex((h: string) => h.includes('address'));
  const phoneIndex = headers.findIndex((h: string) => h.includes('phone') && !h.includes('contact') && !h.includes('person'));
  const emailIndex = headers.findIndex((h: string) => h.includes('email') && !h.includes('contact') && !h.includes('person'));
  const contactPersonIndex = headers.findIndex((h: string) => h.includes('contact') && h.includes('person') && !h.includes('phone') && !h.includes('email'));
  const contactPersonPhoneIndex = headers.findIndex((h: string) => h.includes('contact') && h.includes('person') && h.includes('phone'));
  const contactPersonEmailIndex = headers.findIndex((h: string) => h.includes('contact') && h.includes('person') && h.includes('email'));
  const vatNumberIndex = headers.findIndex((h: string) => h.includes('vat'));
  const notesIndex = headers.findIndex((h: string) => h.includes('notes'));

  if (nameIndex !== -1) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const name = row[nameIndex];
      if (!name || String(name).trim() === '') continue;

      suppliers.push({
        name: String(name).trim(),
        address: addressIndex !== -1 && row[addressIndex] ? String(row[addressIndex]).trim() : undefined,
        phone: phoneIndex !== -1 && row[phoneIndex] ? String(row[phoneIndex]).trim() : undefined,
        email: emailIndex !== -1 && row[emailIndex] ? String(row[emailIndex]).trim() : undefined,
        contactPerson: contactPersonIndex !== -1 && row[contactPersonIndex] ? String(row[contactPersonIndex]).trim() : undefined,
        contactPersonPhone: contactPersonPhoneIndex !== -1 && row[contactPersonPhoneIndex] ? String(row[contactPersonPhoneIndex]).trim() : undefined,
        contactPersonEmail: contactPersonEmailIndex !== -1 && row[contactPersonEmailIndex] ? String(row[contactPersonEmailIndex]).trim() : undefined,
        vatNumber: vatNumberIndex !== -1 && row[vatNumberIndex] ? String(row[vatNumberIndex]).trim() : undefined,
        notes: notesIndex !== -1 && row[notesIndex] ? String(row[notesIndex]).trim() : undefined,
      });
    }
    if (suppliers.length === 0) {
      errors.push('Supplier name column found, but no valid supplier rows were parsed');
    }
    return { suppliers, errors };
  }

  return parseSuppliersLabelRowsFormat(rows);
}

function parseSuppliersLabelRowsFormat(
  rows: any[][]
): ParsedSuppliersData {
  const errors: string[] = [];
  const suppliers: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[] = [];

  // User-provided format:
  // - Column C (index 2) contains labels like "Account Name", "Account code", "Contact Person", "BankDraft"
  // - Values are read from specific columns in the same row:
  //   Account Name -> H (index 7)
  //   Account code -> X (index 23) [used as Address]
  //   Contact Person -> H (index 7)
  //   BankDraft -> R (index 17) [used as Contact Number]
  const LABEL_COL = 2;
  const COL_H = 7;
  const COL_R = 17;
  const COL_X = 23;

  type DraftSupplier = Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
  let current: DraftSupplier | null = null;

  const normalizeLabel = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[:*.\-_/\\]+/g, ' ')
      .replace(/\s+/g, ' ');

  const findLabelInRow = (row: any[]): string => {
    // Prefer column C as requested, but fall back to scanning first few columns in case the sheet is shifted.
    const preferred = normalizeLabel(row?.[LABEL_COL]);
    if (preferred) return preferred;
    for (let col = 0; col <= 6; col++) {
      const value = normalizeLabel(row?.[col]);
      if (value) return value;
    }
    return '';
  };

  const read = (row: any[], index: number): string | undefined => {
    const value = row?.[index];
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text ? text : undefined;
  };

  const pushCurrent = () => {
    if (!current?.name) return;
    suppliers.push(current);
  };

  let foundAnyKnownLabel = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const label = findLabelInRow(row);
    if (!label) continue;

    const isAccountName = label.includes('account name');
    const isAccountCode = label.includes('account code');
    const isContactPerson = label.includes('contact person');
    const isBankDraft = label.includes('bankdraft') || label.includes('bank draft');

    if (!isAccountName && !isAccountCode && !isContactPerson && !isBankDraft) {
      continue;
    }

    foundAnyKnownLabel = true;

    if (isAccountName) {
      pushCurrent();
      current = {
        name: read(row, COL_H) || '',
        address: undefined,
        phone: undefined,
        email: undefined,
        contactPerson: undefined,
        contactPersonPhone: undefined,
        contactPersonEmail: undefined,
        vatNumber: undefined,
        notes: undefined,
      };
      continue;
    }

    // If the file starts mid-block (no Account Name row before details), create a draft so we can still capture data.
    if (!current) {
      current = {
        name: '',
        address: undefined,
        phone: undefined,
        email: undefined,
        contactPerson: undefined,
        contactPersonPhone: undefined,
        contactPersonEmail: undefined,
        vatNumber: undefined,
        notes: undefined,
      };
    }

    if (isAccountCode) {
      current.address = read(row, COL_X) || current.address;
    } else if (isContactPerson) {
      current.contactPerson = read(row, COL_H) || current.contactPerson;
    } else if (isBankDraft) {
      const contactNumber = read(row, COL_R);
      if (contactNumber) {
        current.contactPersonPhone = contactNumber;
        if (!current.phone) {
          // Also populate supplier phone when no dedicated phone is available.
          current.phone = contactNumber;
        }
      }
    }
  }

  pushCurrent();

  if (!foundAnyKnownLabel) {
    errors.push('Missing required "Supplier Name" column and no supported label-row supplier format found (expected labels like Account Name / Account code / Contact Person / BankDraft).');
  }

  return { suppliers, errors };
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
