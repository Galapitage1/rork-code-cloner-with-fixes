import * as XLSX from 'xlsx';
import { writeAsStringAsync, getInfoAsync } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { StoreProduct } from '@/types';

export async function exportStoreProductsToExcel(storeProducts: StoreProduct[]): Promise<void> {
  console.log('=== STORE PRODUCTS EXPORT START ===');
  console.log('Platform:', Platform.OS);
  console.log('Store Products:', storeProducts.length);
  
  try {
    if (!storeProducts || storeProducts.length === 0) {
      throw new Error('No store products to export');
    }

    const productsData = storeProducts.map(product => ({
      'Product Name': product.name,
      'Unit': product.unit,
      'Category': product.category,
      'Quantity': product.quantity,
      'Minimum Stock Level': product.minStockLevel,
      'Cost Per Unit': product.costPerUnit || '',
    }));
    
    console.log('Store products data prepared:', productsData.length, 'rows');

    console.log('Creating workbook...');
    const wb = XLSX.utils.book_new();
    console.log('Workbook created');
    
    const productsWs = XLSX.utils.json_to_sheet(productsData);
    XLSX.utils.book_append_sheet(wb, productsWs, 'Store Products');
    console.log('Store Products sheet added');

    console.log('Writing workbook...');
    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    console.log('Workbook written, size:', wbout.length, 'chars');
    
    const fileName = `store_products_${new Date().toISOString().split('T')[0]}.xlsx`;
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
          dialogTitle: 'Save Store Products List',
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

export interface ParsedStoreProductsData {
  storeProducts: Omit<StoreProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[];
  errors: string[];
}

export function parseStoreProductsExcel(base64Data: string): ParsedStoreProductsData {
  const errors: string[] = [];
  const storeProducts: Omit<StoreProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[] = [];

  try {
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    
    if (workbook.SheetNames.length === 0) {
      errors.push('Excel file has no sheets');
      return { storeProducts, errors };
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length < 2) {
      errors.push('No data rows found in Excel file');
      return { storeProducts, errors };
    }

    const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
    const nameIndex = headers.findIndex((h: string) => h.includes('product') && h.includes('name') || h === 'name');
    const unitIndex = headers.findIndex((h: string) => h.includes('unit') && !h.includes('cost'));
    const categoryIndex = headers.findIndex((h: string) => h.includes('category'));
    const quantityIndex = headers.findIndex((h: string) => h.includes('quantity') && !h.includes('min'));
    const minStockIndex = headers.findIndex((h: string) => (h.includes('min') || h.includes('minimum')) && h.includes('stock'));
    const costPerUnitIndex = headers.findIndex((h: string) => h.includes('cost') && h.includes('per') && h.includes('unit'));

    if (nameIndex === -1) {
      errors.push('Missing required "Product Name" column');
      return { storeProducts, errors };
    }

    if (unitIndex === -1) {
      errors.push('Missing required "Unit" column');
      return { storeProducts, errors };
    }

    if (categoryIndex === -1) {
      errors.push('Missing required "Category" column');
      return { storeProducts, errors };
    }

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const name = row[nameIndex];
      const unit = row[unitIndex];
      const category = row[categoryIndex];
      
      if (!name || String(name).trim() === '') continue;
      if (!unit || String(unit).trim() === '') continue;
      if (!category || String(category).trim() === '') continue;

      const product = {
        name: String(name).trim(),
        unit: String(unit).trim(),
        category: String(category).trim(),
        quantity: quantityIndex !== -1 && row[quantityIndex] !== undefined && row[quantityIndex] !== '' ? Number(row[quantityIndex]) : 0,
        minStockLevel: minStockIndex !== -1 && row[minStockIndex] !== undefined && row[minStockIndex] !== '' ? Number(row[minStockIndex]) : 0,
        costPerUnit: costPerUnitIndex !== -1 && row[costPerUnitIndex] !== undefined && row[costPerUnitIndex] !== '' ? Number(row[costPerUnitIndex]) : undefined,
      };

      storeProducts.push(product);
    }

    if (storeProducts.length === 0) {
      errors.push('No valid products found in Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { storeProducts, errors };
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
