import { writeAsStringAsync } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Customer } from '@/types';
import { Platform } from 'react-native';

export async function exportCustomersToExcel(customers: Customer[]): Promise<void> {
  try {
    const XLSX = await import('xlsx');

    const worksheetData = [
      ['Name', 'Email', 'Phone', 'Company', 'Address', 'Points', 'ID Number', 'Notes', 'Created At', 'Last Updated'],
      ...customers.map((customer) => [
        customer.name,
        customer.email || '',
        customer.phone || '',
        customer.company || '',
        customer.address || '',
        customer.points || 0,
        customer.idNumber || '',
        customer.notes || '',
        new Date(customer.createdAt).toLocaleDateString(),
        new Date(customer.updatedAt).toLocaleDateString(),
      ]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    const columnWidths = [
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 20 },
      { wch: 30 },
      { wch: 10 },
      { wch: 20 },
      { wch: 30 },
      { wch: 15 },
      { wch: 15 },
    ];
    worksheet['!cols'] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');

    const wbout = XLSX.write(workbook, {
      type: 'base64',
      bookType: 'xlsx',
    });

    const filename = `customers_${new Date().toISOString().split('T')[0]}.xlsx`;

    if (Platform.OS === 'web') {
      const blob = base64ToBlob(wbout, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      const docDir = (FileSystem as any).documentDirectory;
      if (!docDir) throw new Error('Document directory not available');
      const fileUri = docDir + filename;
      await writeAsStringAsync(fileUri, wbout, {
        encoding: 'base64',
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Export Customers',
          UTI: 'com.microsoft.excel.xlsx',
        });
      } else {
        console.log('Sharing is not available on this device');
      }
    }
  } catch (error) {
    console.error('Error exporting customers to Excel:', error);
    throw error;
  }
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
