import * as XLSX from 'xlsx';
import { Product, ProductType, ProductRequest, StockCheck, StockCount } from '@/types';
import { findBestMatch, findMappingForTruncatedName, saveProductNameMapping } from './productNameMapping';

export interface ParsedExcelData {
  products: Product[];
  errors: string[];
  isUpdate?: boolean;
}

export function parseExcelFile(base64Data: string, existingProducts?: Product[]): ParsedExcelData {
  const errors: string[] = [];
  const products: Product[] = [];

  try {
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      if (jsonData.length < 2) {
        errors.push(`Sheet "${sheetName}" has no data rows`);
        return;
      }

      const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
      
      const nameIndex = headers.findIndex((h: string) => h.includes('name') || h.includes('product'));
      const typeIndex = headers.findIndex((h: string) => h.includes('type'));
      const unitIndex = headers.findIndex((h: string) => h.includes('unit'));
      const categoryIndex = headers.findIndex((h: string) => h.includes('category'));
      const minStockIndex = headers.findIndex((h: string) => h.includes('min') || h.includes('minimum'));
      const sellingPriceIndex = headers.findIndex((h: string) => h.includes('selling') && h.includes('price'));
      const showInStockIndex = headers.findIndex((h: string) => h.includes('show') && (h.includes('stock') || h.includes('requests')));
      const salesBasedIndex = headers.findIndex((h: string) => h.includes('sales') && h.includes('raw'));
      
      

      if (nameIndex === -1) {
        errors.push(`Sheet "${sheetName}" missing required "Name" column`);
        return;
      }

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        const name = row[nameIndex];
        
        if (!name || String(name).trim() === '') continue;

        const typeValue = typeIndex !== -1 ? String(row[typeIndex]).toLowerCase().trim() : '';
        let type: ProductType = 'raw';
        
        if (typeValue.includes('menu') || typeValue.includes('finished')) {
          type = 'menu';
        } else if (typeValue.includes('kitchen')) {
          type = 'kitchen';
        }

        const showVal = showInStockIndex !== -1 && row[showInStockIndex] !== undefined && row[showInStockIndex] !== null ? String(row[showInStockIndex]).toLowerCase().trim() : '';
        const showInStock = showVal === '' ? true : ['true','yes','y','1'].includes(showVal);

        const salesBasedVal = salesBasedIndex !== -1 && row[salesBasedIndex] !== undefined && row[salesBasedIndex] !== null ? String(row[salesBasedIndex]).toLowerCase().trim() : '';
        const salesBasedRawCalc = ['true','yes','y','1'].includes(salesBasedVal);

        const parsedName = String(name).trim();
        const parsedUnit = unitIndex !== -1 && row[unitIndex] ? String(row[unitIndex]).trim() : 'units';
        const parsedCategory = categoryIndex !== -1 && row[categoryIndex] ? String(row[categoryIndex]).trim() : undefined;
        const parsedMinStock = minStockIndex !== -1 && row[minStockIndex] ? Number(row[minStockIndex]) : undefined;
        
        const rawSellingPrice = sellingPriceIndex !== -1 ? row[sellingPriceIndex] : undefined;
        const parsedSellingPrice = type === 'menu' && rawSellingPrice !== undefined && rawSellingPrice !== null && String(rawSellingPrice).trim() !== '' ? Number(rawSellingPrice) : undefined;
        
        

        const existingProduct = existingProducts?.find(
          p => p.name.toLowerCase().trim() === parsedName.toLowerCase() &&
               p.unit.toLowerCase().trim() === parsedUnit.toLowerCase()
        );

        if (existingProduct) {
          const updatedProduct: Product = {
            ...existingProduct,
            type,
            category: parsedCategory,
            minStock: parsedMinStock,
            sellingPrice: parsedSellingPrice,
            showInStock,
            salesBasedRawCalc,
          };
          
          products.push(updatedProduct);
        } else {
          const product: Product = {
            id: `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
            name: parsedName,
            type,
            unit: parsedUnit,
            category: parsedCategory,
            minStock: parsedMinStock,
            sellingPrice: parsedSellingPrice,
            showInStock,
            salesBasedRawCalc,
          };
          products.push(product);
        }
      }
    });

    if (products.length === 0 && errors.length === 0) {
      errors.push('No valid products found in the Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { products, errors };
}

export interface UnmatchedProduct {
  rowIndex: number;
  name: string;
  unit: string;
  quantity: number;
  possibleMatches: { id: string; name: string; score: number }[];
}

export interface ParsedRequestData {
  requests: Partial<ProductRequest>[];
  errors: string[];
  summaryInfo?: {
    receivingOutlet?: string;
    sendingOutlet?: string;
    requestDate?: string;
  };
  unmatchedProducts?: UnmatchedProduct[];
  autoMatchedCount?: number;
}

export interface ParsedStockCheckData {
  stockCheck: Partial<StockCheck> | null;
  counts: Partial<StockCount>[];
  errors: string[];
  summaryInfo?: {
    date?: string;
    doneDate?: string;
    outlet?: string;
  };
}

export async function parseRequestsExcelFile(
  base64Data: string,
  existingProducts: Product[]
): Promise<ParsedRequestData> {
  const errors: string[] = [];
  const requests: Partial<ProductRequest>[] = [];
  let summaryInfo: ParsedRequestData['summaryInfo'] = {};
  const unmatchedProducts: UnmatchedProduct[] = [];
  let autoMatchedCount = 0;

  try {
    console.log('Parsing requests Excel file...');
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    console.log('Workbook sheets:', workbook.SheetNames);

    // Try to get summary info
    if (workbook.SheetNames.includes('Summary')) {
      const summarySheet = workbook.Sheets['Summary'];
      const summaryData = XLSX.utils.sheet_to_json(summarySheet) as any[];
      
      summaryData.forEach((row: any) => {
        const field = String(row.Field || '').toLowerCase();
        if (field === 'receiving outlet' || field.includes('to outlet')) {
          summaryInfo.receivingOutlet = String(row.Value || '').trim();
        } else if (field === 'sending outlet' || field.includes('from outlet')) {
          summaryInfo.sendingOutlet = String(row.Value || '').trim();
        } else if (field === 'request date' || field === 'date') {
          summaryInfo.requestDate = String(row.Value || '').trim();
        }
      });
    }

    // Find the Requests sheet
    const requestsSheetName = workbook.SheetNames.find(name => 
      name.toLowerCase().includes('request')
    ) || workbook.SheetNames.find(name => name !== 'Summary');

    if (!requestsSheetName) {
      errors.push('No requests sheet found in Excel file');
      return { requests, errors, summaryInfo };
    }

    const worksheet = workbook.Sheets[requestsSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length < 2) {
      errors.push('No data rows found in requests sheet');
      return { requests, errors, summaryInfo };
    }

    const headers = jsonData[0].map((h: any) => String(h || '').toLowerCase().trim());
    console.log('Headers found:', headers);

    // Find column indices based on exported format
    const nameIndex = headers.findIndex((h: string) => h.includes('product') && h.includes('name'));
    const quantityIndex = headers.findIndex((h: string) => h.includes('quantity'));
    const wastageIndex = headers.findIndex((h: string) => h.includes('wastage'));
    const priorityIndex = headers.findIndex((h: string) => h.includes('priority'));
    const fromOutletIndex = headers.findIndex((h: string) => h.includes('from') && h.includes('outlet'));
    const toOutletIndex = headers.findIndex((h: string) => h.includes('to') && h.includes('outlet'));
    const statusIndex = headers.findIndex((h: string) => h.includes('status'));
    const requestedAtIndex = headers.findIndex((h: string) => h.includes('requested') && h.includes('at'));
    const requestDateIndex = headers.findIndex((h: string) => (h.includes('request') && h.includes('date')) || h === 'date');
    const notesIndex = headers.findIndex((h: string) => h.includes('notes'));
    const unitIndex = headers.findIndex((h: string) => h === 'unit');

    console.log('Column indices:', { nameIndex, quantityIndex, priorityIndex, fromOutletIndex, toOutletIndex, statusIndex });

    if (nameIndex === -1) {
      errors.push('Missing "Product Name" column');
      return { requests, errors, summaryInfo };
    }

    if (quantityIndex === -1) {
      errors.push('Missing "Quantity" column');
      return { requests, errors, summaryInfo };
    }

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const productName = row[nameIndex];
      
      if (!productName || String(productName).trim() === '') continue;

      const parsedName = String(productName).trim();
      const parsedUnit = unitIndex !== -1 && row[unitIndex] ? String(row[unitIndex]).trim().toLowerCase() : '';
      
      let matchingProduct = existingProducts.find(p => {
        const nameMatch = p.name.toLowerCase().trim() === parsedName.toLowerCase();
        if (parsedUnit) {
          return nameMatch && p.unit.toLowerCase().trim() === parsedUnit;
        }
        return nameMatch;
      });

      if (!matchingProduct) {
        const savedMapping = await findMappingForTruncatedName(parsedName);
        if (savedMapping) {
          matchingProduct = existingProducts.find(p => p.id === savedMapping.fullProductId);
        }
      }

      if (!matchingProduct) {
        const productsWithUnit = existingProducts.map(p => ({ id: p.id, name: p.name, unit: p.unit }));
        const matchResult = findBestMatch(parsedName, productsWithUnit, { unit: parsedUnit, minAutoMatchScore: 85 });
        
        if (matchResult.match) {
          matchingProduct = existingProducts.find(p => p.id === matchResult.match!.id);
          if (matchingProduct) {
            autoMatchedCount++;
            await saveProductNameMapping(parsedName, matchingProduct.id, matchingProduct.name);
          }
        } else if (matchResult.needsConfirmation && matchResult.possibleMatches.length > 0) {
          const quantity = Number(row[quantityIndex]) || 0;
          unmatchedProducts.push({
            rowIndex: i + 1,
            name: parsedName,
            unit: parsedUnit,
            quantity,
            possibleMatches: matchResult.possibleMatches,
          });
          continue;
        }
      }

      if (!matchingProduct) {
        errors.push(`Row ${i + 1}: Product "${parsedName}" not found in system`);
        continue;
      }

      const quantity = Number(row[quantityIndex]) || 0;
      if (quantity <= 0) {
        errors.push(`Row ${i + 1}: Invalid quantity for "${parsedName}"`);
        continue;
      }

      const wastage = wastageIndex !== -1 ? Number(row[wastageIndex]) || 0 : 0;
      
      let priority: ProductRequest['priority'] = 'medium';
      if (priorityIndex !== -1 && row[priorityIndex]) {
        const priorityVal = String(row[priorityIndex]).toLowerCase().trim();
        if (priorityVal === 'high') priority = 'high';
        else if (priorityVal === 'low') priority = 'low';
      }

      let status: ProductRequest['status'] = 'approved';
      if (statusIndex !== -1 && row[statusIndex]) {
        const statusVal = String(row[statusIndex]).toLowerCase().trim();
        if (statusVal === 'pending') status = 'pending';
        else if (statusVal === 'fulfilled') status = 'fulfilled';
      }

      const fromOutlet = fromOutletIndex !== -1 && row[fromOutletIndex] ? String(row[fromOutletIndex]).trim() : '';
      const toOutlet = toOutletIndex !== -1 && row[toOutletIndex] ? String(row[toOutletIndex]).trim() : summaryInfo.receivingOutlet || '';
      const notes = notesIndex !== -1 && row[notesIndex] ? String(row[notesIndex]).trim() : '';

      // Parse request date
      let requestDate = summaryInfo.requestDate || '';
      if (requestDateIndex !== -1 && row[requestDateIndex]) {
        const dateVal = row[requestDateIndex];
        if (typeof dateVal === 'number') {
          const excelDate = XLSX.SSF.parse_date_code(dateVal);
          if (excelDate) {
            requestDate = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
          }
        } else {
          const parsed = new Date(dateVal);
          if (!isNaN(parsed.getTime())) {
            requestDate = parsed.toISOString().split('T')[0];
          }
        }
      }

      // Parse requested at timestamp
      let requestedAt = Date.now();
      if (requestedAtIndex !== -1 && row[requestedAtIndex]) {
        const dateVal = row[requestedAtIndex];
        const parsed = new Date(dateVal);
        if (!isNaN(parsed.getTime())) {
          requestedAt = parsed.getTime();
        }
      } else if (requestDate) {
        requestedAt = new Date(requestDate + 'T12:00:00').getTime();
      }

      // Use outlet from row or fallback to summary
      const finalFromOutlet = fromOutlet || summaryInfo.sendingOutlet || '';
      const finalToOutlet = toOutlet || summaryInfo.receivingOutlet || '';

      // Update summaryInfo if we found outlets in the data
      if (!summaryInfo.receivingOutlet && finalToOutlet) {
        summaryInfo.receivingOutlet = finalToOutlet;
      }
      if (!summaryInfo.sendingOutlet && finalFromOutlet) {
        summaryInfo.sendingOutlet = finalFromOutlet;
      }
      if (!summaryInfo.requestDate && requestDate) {
        summaryInfo.requestDate = requestDate;
      }

      requests.push({
        productId: matchingProduct.id,
        quantity,
        wastage,
        priority,
        status,
        fromOutlet: finalFromOutlet,
        toOutlet: finalToOutlet,
        notes,
        requestedAt,
        requestDate,
      });
    }

    if (requests.length === 0 && errors.length === 0 && unmatchedProducts.length === 0) {
      errors.push('No valid requests found in the Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { requests, errors, summaryInfo, unmatchedProducts, autoMatchedCount };
}

export function parseStockCheckExcelFile(
  base64Data: string,
  existingProducts: Product[]
): ParsedStockCheckData {
  const errors: string[] = [];
  const counts: Partial<StockCount>[] = [];
  let summaryInfo: ParsedStockCheckData['summaryInfo'] = {};

  try {
    console.log('Parsing stock check Excel file...');
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    console.log('Workbook sheets:', workbook.SheetNames);

    // Try to get summary info
    if (workbook.SheetNames.includes('Summary')) {
      const summarySheet = workbook.Sheets['Summary'];
      const summaryData = XLSX.utils.sheet_to_json(summarySheet) as any[];
      console.log('Summary data:', summaryData);
      
      summaryData.forEach((row: any) => {
        const field = String(row.Field || '').toLowerCase();
        if (field.includes('date') && field.includes('selected')) {
          summaryInfo.date = String(row.Value || '').trim();
        } else if (field.includes('done date')) {
          summaryInfo.doneDate = String(row.Value || '').trim();
        } else if (field.includes('outlet')) {
          summaryInfo.outlet = String(row.Value || '').trim();
        }
      });
    }

    // Find the Stock Count sheet
    const stockSheetName = workbook.SheetNames.find(name => 
      name.toLowerCase().includes('stock') && name.toLowerCase().includes('count')
    ) || workbook.SheetNames.find(name => name !== 'Summary');

    if (!stockSheetName) {
      errors.push('No stock count sheet found in Excel file');
      return { stockCheck: null, counts, errors, summaryInfo };
    }

    const worksheet = workbook.Sheets[stockSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length < 2) {
      errors.push('No data rows found in stock count sheet');
      return { stockCheck: null, counts, errors, summaryInfo };
    }

    const headers = jsonData[0].map((h: any) => String(h || '').toLowerCase().trim());
    console.log('Headers found:', headers);

    // Find column indices based on exported format
    const nameIndex = headers.findIndex((h: string) => h.includes('product') && h.includes('name'));
    const unitIndex = headers.findIndex((h: string) => h === 'unit');
    const openingStockIndex = headers.findIndex((h: string) => h.includes('opening'));
    const receivedStockIndex = headers.findIndex((h: string) => h.includes('received'));
    const wastageIndex = headers.findIndex((h: string) => h.includes('wastage'));
    const currentStockIndex = headers.findIndex((h: string) => h.includes('current'));
    const notesIndex = headers.findIndex((h: string) => h.includes('notes'));

    console.log('Column indices:', { nameIndex, openingStockIndex, receivedStockIndex, currentStockIndex });

    if (nameIndex === -1) {
      errors.push('Missing "Product Name" column');
      return { stockCheck: null, counts, errors, summaryInfo };
    }

    if (currentStockIndex === -1) {
      errors.push('Missing "Current Stock" column');
      return { stockCheck: null, counts, errors, summaryInfo };
    }

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const productName = row[nameIndex];
      
      if (!productName || String(productName).trim() === '') continue;

      const parsedName = String(productName).trim();
      const parsedUnit = unitIndex !== -1 && row[unitIndex] ? String(row[unitIndex]).trim().toLowerCase() : '';
      
      // Find matching product
      let matchingProduct = existingProducts.find(p => {
        const nameMatch = p.name.toLowerCase().trim() === parsedName.toLowerCase();
        if (parsedUnit) {
          return nameMatch && p.unit.toLowerCase().trim() === parsedUnit;
        }
        return nameMatch;
      });

      if (!matchingProduct) {
        errors.push(`Row ${i + 1}: Product "${parsedName}" not found in system`);
        continue;
      }

      const quantity = Number(row[currentStockIndex]) || 0;
      const openingStock = openingStockIndex !== -1 ? Number(row[openingStockIndex]) || 0 : undefined;
      const receivedStock = receivedStockIndex !== -1 ? Number(row[receivedStockIndex]) || 0 : undefined;
      
      // Parse wastage - handle the format "5 whole (50 slice)"
      let wastage = 0;
      if (wastageIndex !== -1 && row[wastageIndex]) {
        const wastageVal = String(row[wastageIndex]).trim();
        const numMatch = wastageVal.match(/^(\d+\.?\d*)/);
        if (numMatch) {
          wastage = Number(numMatch[1]) || 0;
        }
      }

      const notes = notesIndex !== -1 && row[notesIndex] ? String(row[notesIndex]).trim() : '';

      counts.push({
        productId: matchingProduct.id,
        quantity,
        openingStock,
        receivedStock,
        wastage,
        notes,
      });
    }

    if (counts.length === 0 && errors.length === 0) {
      errors.push('No valid stock counts found in the Excel file');
    }

    console.log(`Parsed ${counts.length} stock counts with ${errors.length} errors`);

  } catch (error) {
    console.error('Failed to parse stock check Excel:', error);
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { 
    stockCheck: counts.length > 0 ? {} : null, 
    counts, 
    errors, 
    summaryInfo 
  };
}

export function generateSampleExcelBase64(): string {
  const sampleData = [
    ['Product Name', 'Type', 'Unit', 'Category', 'Min Stock', 'Selling Price', 'Show in Stock & Requests (TRUE/FALSE)', 'Sales Based Raw Calc (TRUE/FALSE)'],
    ['Chocolate Cake', 'menu', 'whole', 'Cakes', 5, 2500, true, true],
    ['Chocolate Cake', 'menu', 'slice', 'Cakes', '', 350, true, true],
    ['Vanilla Cupcake', 'menu', 'pieces', 'Cupcakes', 12, 150, true, true],
    ['Croissant', 'menu', 'pieces', 'Pastries', 20, 200, true, false],
    ['Flour', 'raw', 'kg', 'Ingredients', 10, '', true, false],
    ['Sugar', 'raw', 'kg', 'Ingredients', 5, '', false, false],
    ['Butter', 'raw', 'kg', 'Ingredients', 3, '', true, false],
    ['Eggs', 'raw', 'dozen', 'Ingredients', 5, '', true, false],
    ['Milk', 'raw', 'liters', 'Ingredients', 10, '', true, false],
    ['Frosting', 'kitchen', 'kg', 'Prepared Items', 5, '', true, false],
  ];

  const conversionData = [
    ['From Product', 'From Unit', 'Conversion Factor', 'To Product', 'To Unit'],
    ['Chocolate Cake', 'whole', 10, 'Chocolate Cake', 'slice'],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sampleData);
  const conversionSheet = XLSX.utils.aoa_to_sheet(conversionData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
  XLSX.utils.book_append_sheet(workbook, conversionSheet, 'Unit Conversions');
  
  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  return base64;
}
