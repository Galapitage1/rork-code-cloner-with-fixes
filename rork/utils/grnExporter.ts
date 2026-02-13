import * as XLSX from 'xlsx';
import { writeAsStringAsync, getInfoAsync } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { GRN, Supplier, StoreProduct } from '@/types';
import { formatCurrency } from './currencyHelper';

export async function exportGRNsToExcel(grns: GRN[], suppliers: Supplier[], storeProducts: StoreProduct[], currency: string): Promise<void> {
  console.log('=== GRN EXPORT START ===');
  console.log('Platform:', Platform.OS);
  console.log('GRNs:', grns.length);
  
  try {
    if (!grns || grns.length === 0) {
      throw new Error('No GRNs to export');
    }

    const grnsData = grns.map(grn => {
      const supplier = suppliers.find(s => s.id === grn.supplierId);
      const totalPayable = grn.invoiceAmount + grn.vatAmount - grn.discountAmount;
      
      return {
        'Supplier Name': supplier?.name || 'Unknown',
        'Supplier Phone': supplier?.phone || '',
        'Supplier Email': supplier?.email || '',
        'Supplier Address': supplier?.address || '',
        'Contact Person': supplier?.contactPerson || '',
        'Contact Person Phone': supplier?.contactPersonPhone || '',
        'Contact Person Email': supplier?.contactPersonEmail || '',
        'VAT Number': supplier?.vatNumber || '',
        'Invoice Number': grn.invoiceNumber,
        [`Invoice Amount (${currency})`]: grn.invoiceAmount,
        [`VAT Amount (${currency})`]: grn.vatAmount,
        [`Discount Amount (${currency})`]: grn.discountAmount,
        [`Total Payable (${currency})`]: totalPayable,
        'Due Date': grn.dueDate,
        'Number of Items': grn.items.length,
        'Created Date': new Date(grn.createdAt).toISOString().split('T')[0],
      };
    });
    
    const grnsItemsData: any[] = [];
    grns.forEach(grn => {
      const supplier = suppliers.find(s => s.id === grn.supplierId);
      grn.items.forEach(item => {
        const product = storeProducts.find(p => p.id === item.storeProductId);
        grnsItemsData.push({
          'Invoice Number': grn.invoiceNumber,
          'Supplier Name': supplier?.name || 'Unknown',
          'Product Name': product?.name || 'Unknown Product',
          'Product Unit': product?.unit || '',
          'Quantity': item.quantity,
          [`Cost Per Unit (${currency})`]: item.costPerUnit || 0,
          [`Total Cost (${currency})`]: (item.quantity * (item.costPerUnit || 0)).toFixed(2),
        });
      });
    });
    
    console.log('GRN data prepared:', grnsData.length, 'rows');

    console.log('Creating workbook...');
    const wb = XLSX.utils.book_new();
    console.log('Workbook created');
    
    const grnsWs = XLSX.utils.json_to_sheet(grnsData);
    XLSX.utils.book_append_sheet(wb, grnsWs, 'GRNs');
    console.log('GRNs sheet added');
    
    if (grnsItemsData.length > 0) {
      const grnsItemsWs = XLSX.utils.json_to_sheet(grnsItemsData);
      XLSX.utils.book_append_sheet(wb, grnsItemsWs, 'GRN Items');
      console.log('GRN Items sheet added');
    }

    console.log('Writing workbook...');
    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    console.log('Workbook written, size:', wbout.length, 'chars');
    
    const fileName = `grns_${new Date().toISOString().split('T')[0]}.xlsx`;
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
          dialogTitle: 'Save GRNs List',
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

export interface ParsedGRNsData {
  grns: Array<{
    supplierName: string;
    invoiceNumber: string;
    invoiceAmount: number;
    vatAmount: number;
    discountAmount: number;
    dueDate: string;
  }>;
  errors: string[];
}

export function parseGRNsExcel(base64Data: string): ParsedGRNsData {
  const errors: string[] = [];
  const grns: ParsedGRNsData['grns'] = [];

  try {
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    
    if (workbook.SheetNames.length === 0) {
      errors.push('Excel file has no sheets');
      return { grns, errors };
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length < 2) {
      errors.push('No data rows found in Excel file');
      return { grns, errors };
    }

    const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
    const supplierNameIndex = headers.findIndex((h: string) => h.includes('supplier') && h.includes('name'));
    const invoiceNumberIndex = headers.findIndex((h: string) => h.includes('invoice') && h.includes('number'));
    const invoiceAmountIndex = headers.findIndex((h: string) => h.includes('invoice') && h.includes('amount'));
    const vatAmountIndex = headers.findIndex((h: string) => h.includes('vat'));
    const discountAmountIndex = headers.findIndex((h: string) => h.includes('discount'));
    const dueDateIndex = headers.findIndex((h: string) => h.includes('due') && h.includes('date'));

    if (supplierNameIndex === -1) {
      errors.push('Missing required "Supplier Name" column');
      return { grns, errors };
    }

    if (invoiceNumberIndex === -1) {
      errors.push('Missing required "Invoice Number" column');
      return { grns, errors };
    }

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const supplierName = row[supplierNameIndex];
      const invoiceNumber = row[invoiceNumberIndex];
      
      if (!supplierName || String(supplierName).trim() === '') continue;
      if (!invoiceNumber || String(invoiceNumber).trim() === '') continue;

      const grn = {
        supplierName: String(supplierName).trim(),
        invoiceNumber: String(invoiceNumber).trim(),
        invoiceAmount: invoiceAmountIndex !== -1 && row[invoiceAmountIndex] !== undefined ? Number(row[invoiceAmountIndex]) : 0,
        vatAmount: vatAmountIndex !== -1 && row[vatAmountIndex] !== undefined ? Number(row[vatAmountIndex]) : 0,
        discountAmount: discountAmountIndex !== -1 && row[discountAmountIndex] !== undefined ? Number(row[discountAmountIndex]) : 0,
        dueDate: dueDateIndex !== -1 && row[dueDateIndex] ? String(row[dueDateIndex]).trim() : new Date().toISOString().split('T')[0],
      };

      grns.push(grn);
    }

    if (grns.length === 0) {
      errors.push('No valid GRNs found in Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { grns, errors };
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
