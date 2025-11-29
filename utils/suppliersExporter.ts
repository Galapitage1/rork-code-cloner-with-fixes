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

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length < 2) {
      errors.push('No data rows found in Excel file');
      return { suppliers, errors };
    }

    const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
    const nameIndex = headers.findIndex((h: string) => h.includes('supplier') && h.includes('name') || h === 'name');
    const addressIndex = headers.findIndex((h: string) => h.includes('address'));
    const phoneIndex = headers.findIndex((h: string) => h.includes('phone') && !h.includes('contact') && !h.includes('person'));
    const emailIndex = headers.findIndex((h: string) => h.includes('email') && !h.includes('contact') && !h.includes('person'));
    const contactPersonIndex = headers.findIndex((h: string) => h.includes('contact') && h.includes('person'));
    const contactPersonPhoneIndex = headers.findIndex((h: string) => h.includes('contact') && h.includes('person') && h.includes('phone'));
    const contactPersonEmailIndex = headers.findIndex((h: string) => h.includes('contact') && h.includes('person') && h.includes('email'));
    const vatNumberIndex = headers.findIndex((h: string) => h.includes('vat'));
    const notesIndex = headers.findIndex((h: string) => h.includes('notes'));

    if (nameIndex === -1) {
      errors.push('Missing required "Supplier Name" column');
      return { suppliers, errors };
    }

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const name = row[nameIndex];
      
      if (!name || String(name).trim() === '') continue;

      const supplier = {
        name: String(name).trim(),
        address: addressIndex !== -1 && row[addressIndex] ? String(row[addressIndex]).trim() : undefined,
        phone: phoneIndex !== -1 && row[phoneIndex] ? String(row[phoneIndex]).trim() : undefined,
        email: emailIndex !== -1 && row[emailIndex] ? String(row[emailIndex]).trim() : undefined,
        contactPerson: contactPersonIndex !== -1 && row[contactPersonIndex] ? String(row[contactPersonIndex]).trim() : undefined,
        contactPersonPhone: contactPersonPhoneIndex !== -1 && row[contactPersonPhoneIndex] ? String(row[contactPersonPhoneIndex]).trim() : undefined,
        contactPersonEmail: contactPersonEmailIndex !== -1 && row[contactPersonEmailIndex] ? String(row[contactPersonEmailIndex]).trim() : undefined,
        vatNumber: vatNumberIndex !== -1 && row[vatNumberIndex] ? String(row[vatNumberIndex]).trim() : undefined,
        notes: notesIndex !== -1 && row[notesIndex] ? String(row[notesIndex]).trim() : undefined,
      };

      suppliers.push(supplier);
    }

    if (suppliers.length === 0) {
      errors.push('No valid suppliers found in Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
