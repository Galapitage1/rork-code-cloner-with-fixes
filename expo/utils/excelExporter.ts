import * as XLSX from 'xlsx';
import { writeAsStringAsync, getInfoAsync } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { StockCheck, Product, ProductRequest, Recipe, StoreProduct } from '@/types';

function calculateProductCostHelper(
  productId: string,
  quantity: number,
  products: Product[],
  recipes?: Recipe[],
  storeProducts?: StoreProduct[],
  context: string = ''
): number {
  if (!recipes) {
    console.log(`⚠️ [${context}] No recipes provided`);
    return 0;
  }
  
  const product = products.find(p => p.id === productId);
  const recipe = recipes.find(r => r.menuProductId === productId);
  
  if (!recipe) {
    console.log(`⚠️ [${context}] No recipe found for product ${product?.name} (${productId})`);
    return 0;
  }
  
  if (!recipe.components || recipe.components.length === 0) {
    console.log(`⚠️ [${context}] Recipe found but has no components for product ${product?.name}`);
    return 0;
  }
  
  let totalCost = 0;
  console.log(`[${context}] Calculating cost for ${product?.name} (qty ${quantity}):`);
  for (const component of recipe.components) {
    const rawProduct = products.find(p => p.id === component.rawProductId);
    const storeProduct = storeProducts?.find(sp => sp.name.toLowerCase() === rawProduct?.name?.toLowerCase());
    const costPerUnit = storeProduct?.costPerUnit || rawProduct?.sellingPrice || 0;
    const componentCost = costPerUnit * component.quantityPerUnit * quantity;
    console.log(`  - ${rawProduct?.name}: ${costPerUnit}${storeProduct ? ' (store)' : ''} x ${component.quantityPerUnit} x ${quantity} = ${componentCost}`);
    totalCost += componentCost;
  }
  
  console.log(`✓ [${context}] Total cost: ${totalCost}`);
  return totalCost;
}

export async function exportStockCheckToExcel(
  stockCheck: StockCheck,
  products: Product[],
  recipes?: Recipe[],
  storeProducts?: any[],
  productConversions?: any[]
): Promise<void> {
  console.log('=== EXPORT START ===');
  console.log('Platform:', Platform.OS);
  console.log('Stock check:', { outlet: stockCheck.outlet, date: stockCheck.date, countsLength: stockCheck.counts.length });
  console.log('Recipes provided:', recipes ? recipes.length : 'NONE');
  console.log('Product conversions provided:', productConversions ? productConversions.length : 'NONE');
  
  try {
    if (!stockCheck.counts || stockCheck.counts.length === 0) {
      throw new Error('No stock counts to export');
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    console.log('Product map created with', productMap.size, 'products');
    
    const reportData = stockCheck.counts.map(count => {
      const product = productMap.get(count.productId);
      const sellingPrice = product?.sellingPrice || 0;
      const totalValue = sellingPrice * count.quantity;
      const totalCost = calculateProductCostHelper(count.productId, count.quantity, products, recipes, storeProducts, 'STOCK CHECK');
      
      // Format wastage with unit conversion if applicable
      let wastageDisplay = '';
      if (count.wastage !== undefined && count.wastage > 0) {
        wastageDisplay = String(count.wastage);
        
        // Check if this product has a conversion
        if (productConversions && productConversions.length > 0) {
          const conversion = productConversions.find(
            (c: any) => c.fromProductId === count.productId || c.toProductId === count.productId
          );
          
          if (conversion) {
            // If this is the "from" product (e.g., whole cake)
            if (conversion.fromProductId === count.productId) {
              const toProduct = productMap.get(conversion.toProductId);
              const convertedAmount = count.wastage * conversion.conversionFactor;
              wastageDisplay = `${count.wastage} ${product?.unit || ''} (${convertedAmount} ${toProduct?.unit || ''})`;
            } 
            // If this is the "to" product (e.g., slices)
            else if (conversion.toProductId === count.productId) {
              const fromProduct = productMap.get(conversion.fromProductId);
              const convertedAmount = count.wastage / conversion.conversionFactor;
              wastageDisplay = `${count.wastage} ${product?.unit || ''} (${convertedAmount.toFixed(2)} ${fromProduct?.unit || ''})`;
            }
          }
        }
      }
      
      return {
        'Product Name': product?.name || 'Unknown',
        'Type': product?.type || '',
        'Category': product?.category || '',
        'Unit': product?.unit || '',
        'Opening Stock': count.openingStock !== undefined ? count.openingStock : '',
        'Received Stock': count.receivedStock !== undefined ? count.receivedStock : '',
        'Wastage': wastageDisplay,
        'Current Stock': count.quantity,
        'Selling Price': sellingPrice || '',
        'Product Value': totalValue || '',
        'Total Cost': totalCost || '',
        'Min Stock': product?.minStock || '',
        'Notes': count.notes || '',
      };
    });
    console.log('Report data prepared:', reportData.length, 'rows');

    const summaryData = [
      { Field: 'Date (Selected)', Value: stockCheck.date },
      { Field: 'Done Date', Value: stockCheck.doneDate ?? new Date(stockCheck.timestamp).toISOString().split('T')[0] },
      { Field: 'Outlet', Value: stockCheck.outlet || 'N/A' },
      { Field: 'Total Items Counted', Value: stockCheck.counts.length },
      { Field: 'Report Generated', Value: new Date().toLocaleString() },
    ];

    console.log('Creating workbook...');
    const wb = XLSX.utils.book_new();
    console.log('Workbook created');
    
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    console.log('Summary sheet added');
    
    const stockWs = XLSX.utils.json_to_sheet(reportData);
    XLSX.utils.book_append_sheet(wb, stockWs, 'Stock Count');
    console.log('Stock Count sheet added');

    console.log('Writing workbook...');
    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    console.log('Workbook written, size:', wbout.length, 'chars');
    
    const fileName = `stock_check_${stockCheck.outlet?.replace(/\s+/g, '_')}_${stockCheck.date}.xlsx`;
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
          dialogTitle: 'Save Stock Check Report',
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

export async function exportRequestsToExcel(
  toOutlet: string,
  requests: ProductRequest[],
  products: Product[],
  recipes?: Recipe[],
  storeProducts?: any[],
  productConversions?: any[]
): Promise<void> {
  console.log('=== REQUEST EXPORT START ===');
  console.log('Platform:', Platform.OS);
  console.log('To Outlet:', toOutlet);
  console.log('Requests:', requests.length);
  console.log('Recipes provided:', recipes ? recipes.length : 'NONE');
  
  try {
    if (!requests || requests.length === 0) {
      throw new Error('No requests to export');
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    console.log('Product map created with', productMap.size, 'products');
    
    const requestData = requests.map(request => {
      const product = productMap.get(request.productId);
      const sellingPrice = product?.sellingPrice || 0;
      const isApproved = request.status === 'approved';
      const totalValue = isApproved ? sellingPrice * request.quantity : '';
      const totalCost = isApproved ? calculateProductCostHelper(request.productId, request.quantity, products, recipes, storeProducts, 'REQUESTS') : '';
      
      return {
        'Product Name': product?.name || 'Unknown',
        'Type': product?.type || '',
        'Category': product?.category || '',
        'Unit': product?.unit || '',
        'Quantity Requested': request.quantity,
        'Wastage': request.wastage || 0,
        'Selling Price': isApproved ? (sellingPrice || '') : '',
        'Product Value': totalValue,
        'Total Cost': totalCost,
        'Priority': request.priority.toUpperCase(),
        'From Outlet': request.fromOutlet,
        'To Outlet': request.toOutlet,
        'Status': request.status.toUpperCase(),
        'Requested At': new Date(request.requestedAt).toLocaleString(),
        'Notes': request.notes || '',
      };
    });
    console.log('Request data prepared:', requestData.length, 'rows');

    const summaryData = [
      { Field: 'Receiving Outlet', Value: toOutlet },
      { Field: 'Total Items', Value: requests.length },
      { Field: 'High Priority', Value: requests.filter(r => r.priority === 'high').length },
      { Field: 'Medium Priority', Value: requests.filter(r => r.priority === 'medium').length },
      { Field: 'Low Priority', Value: requests.filter(r => r.priority === 'low').length },
      { Field: 'Report Generated', Value: new Date().toLocaleString() },
    ];

    console.log('Creating workbook...');
    const wb = XLSX.utils.book_new();
    console.log('Workbook created');
    
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    console.log('Summary sheet added');
    
    const requestsWs = XLSX.utils.json_to_sheet(requestData);
    XLSX.utils.book_append_sheet(wb, requestsWs, 'Requests');
    console.log('Requests sheet added');

    console.log('Writing workbook...');
    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    console.log('Workbook written, size:', wbout.length, 'chars');
    
    const fileName = `product_requests_${toOutlet.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
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
        
        console.log('=== WEB REQUEST EXPORT COMPLETED ===');
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
          dialogTitle: 'Save Product Requests',
          UTI: 'com.microsoft.excel.xlsx',
        });
        console.log('=== MOBILE REQUEST EXPORT COMPLETED ===');
      } catch (mobileError) {
        console.error('Mobile export error:', mobileError);
        throw new Error(`Mobile export failed: ${mobileError instanceof Error ? mobileError.message : 'Unknown error'}`);
      }
    }
  } catch (error) {
    console.error('=== REQUEST EXPORT FAILED ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
}

export async function exportProductionToExcel(
  monthKey: string,
  requests: any[],
  products: Product[],
  recipes?: Recipe[],
  storeProducts?: any[]
): Promise<void> {
  console.log('=== PRODUCTION EXPORT START ===');
  console.log('Platform:', Platform.OS);
  console.log('Month:', monthKey);
  console.log('Requests:', requests.length);
  console.log('Recipes provided:', recipes ? recipes.length : 'NONE');
  console.log('Store products provided:', storeProducts ? storeProducts.length : 'NONE');
  
  try {
    if (!requests || requests.length === 0) {
      throw new Error('No production requests to export');
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    console.log('Product map created with', productMap.size, 'products');
    
    const reportData: any[] = [];
    
    requests.forEach(request => {
      request.items.forEach((item: any) => {
        const product = productMap.get(item.productId);
        const totalCost = calculateProductCostHelper(item.productId, item.quantity, products, recipes, storeProducts, 'PRODUCTION');
        
        reportData.push({
          'Date': request.date,
          'Requested By': request.requestedBy,
          'Product Name': product?.name || 'Unknown',
          'Type': product?.type || '',
          'Category': product?.category || '',
          'Unit': product?.unit || '',
          'Quantity': item.quantity,
          'Total Cost': totalCost || '',
        });
      });
    });
    
    console.log('Report data prepared:', reportData.length, 'rows');

    const [year, month] = monthKey.split('-');
    const monthName = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const totalCost = reportData.reduce((sum, row) => sum + (row['Total Cost'] || 0), 0);

    const summaryData = [
      { Field: 'Month', Value: monthName },
      { Field: 'Total Requests', Value: requests.length },
      { Field: 'Total Items', Value: reportData.length },
      { Field: 'Total Cost', Value: totalCost.toFixed(2) },
      { Field: 'Report Generated', Value: new Date().toLocaleString() },
    ];

    console.log('Creating workbook...');
    const wb = XLSX.utils.book_new();
    console.log('Workbook created');
    
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    console.log('Summary sheet added');
    
    const productionWs = XLSX.utils.json_to_sheet(reportData);
    XLSX.utils.book_append_sheet(wb, productionWs, 'Production');
    console.log('Production sheet added');

    console.log('Writing workbook...');
    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    console.log('Workbook written, size:', wbout.length, 'chars');
    
    const fileName = `approved_production_${monthKey}.xlsx`;
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
        
        console.log('=== WEB PRODUCTION EXPORT COMPLETED ===');
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
          dialogTitle: 'Save Production Report',
          UTI: 'com.microsoft.excel.xlsx',
        });
        console.log('=== MOBILE PRODUCTION EXPORT COMPLETED ===');
      } catch (mobileError) {
        console.error('Mobile export error:', mobileError);
        throw new Error(`Mobile export failed: ${mobileError instanceof Error ? mobileError.message : 'Unknown error'}`);
      }
    }
  } catch (error) {
    console.error('=== PRODUCTION EXPORT FAILED ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
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
