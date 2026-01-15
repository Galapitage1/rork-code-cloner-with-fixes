import * as XLSX from 'xlsx';
import { Product, ProductType } from '@/types';

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
