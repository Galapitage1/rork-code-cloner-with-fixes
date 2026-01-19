import * as XLSX from 'xlsx';
import { Product, StockCheck, Recipe, ProductConversion } from '@/types';
import { findMappingForTruncatedName, findPossibleMatches } from './productNameMapping';

export type ReconciledRow = {
  name: string;
  unit: string;
  sold: number;
  opening: number | null;
  received: number | null;
  wastage: number | null;
  closing: number | null;
  expectedClosing: number | null;
  discrepancy: number | null;
  productId?: string;
  notes?: string;
  rowIndex?: number;
  needsMapping?: boolean;
  possibleMatches?: { id: string; name: string; score: number }[];
  splitUnits?: {
    unit: string;
    opening: number;
    received: number;
    wastage: number;
    closing: number;
    expectedClosing: number;
    discrepancy: number;
  }[];
};

export type SalesReconcileResult = {
  outletFromSheet: string | null;
  outletMatched: boolean;
  matchedOutletName: string | null;
  stockCheckDate: string | null;
  sheetDate: string | null;
  dateMatched: boolean;
  rows: ReconciledRow[];
  errors: string[];
};

function getCellString(worksheet: XLSX.WorkSheet, addr: string): string | null {
  const c = worksheet[addr];
  if (!c) return null;
  const v = typeof c.v === 'string' ? c.v : String(c.v);
  return v?.trim?.() ?? null;
}

function getCellDate(worksheet: XLSX.WorkSheet, addr: string): string | null {
  const c = worksheet[addr];
  if (!c) return null;
  
  // If it's a date type cell (serial number), format it properly
  if (c.t === 'n' && c.w) {
    // c.w is the formatted string representation
    return c.w.trim();
  }
  
  // If it's a string, return as is
  if (typeof c.v === 'string') {
    return c.v.trim();
  }
  
  // Otherwise try to convert to string
  return String(c.v).trim();
}

function getCellNumber(worksheet: XLSX.WorkSheet, addr: string): number | null {
  const c = worksheet[addr];
  if (!c) return null;
  const n = typeof c.v === 'number' ? c.v : Number(c.v);
  return Number.isFinite(n) ? n : null;
}

export async function reconcileSalesFromExcelBase64(
  base64Data: string,
  stockChecks: StockCheck[],
  products: Product[],
  options?: { requestsReceivedByProductId?: Map<string, number>; productConversions?: ProductConversion[]; useSavedMappings?: boolean }
): Promise<SalesReconcileResult> {
  const errors: string[] = [];
  const rows: ReconciledRow[] = [];

  try {
    const wb = XLSX.read(base64Data, { type: 'base64' });
    if (wb.SheetNames.length === 0) {
      return {
        outletFromSheet: null,
        outletMatched: false,
        matchedOutletName: null,
        stockCheckDate: null,
        sheetDate: null,
        dateMatched: false,
        rows: [],
        errors: ['Workbook contains no sheets'],
      };
    }

    const ws = wb.Sheets[wb.SheetNames[0]];

    const outletFromSheet = getCellString(ws, 'J5');
    const sheetDateRaw = getCellDate(ws, 'H9');
    console.log('===== SALES RECONCILIATION DATE PARSING =====');
    console.log('Raw date from Excel cell H9:', sheetDateRaw);
    const normalizeDate = (s: string | null): string | null => {
      if (!s) return null;
      const trimmed = s.trim();
      
      // First, try to match DD/MM/YYYY or DD-MM-YYYY format (most common in Excel exports)
      // IMPORTANT: In this format, DD is day and MM is month
      // So 10/11/2025 means day=10, month=11 (November), year=2025
      const ddmmyyyyMatch = trimmed.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
      if (ddmmyyyyMatch) {
        const day = String(Number(ddmmyyyyMatch[1])).padStart(2, '0');
        const month = String(Number(ddmmyyyyMatch[2])).padStart(2, '0');
        const year = ddmmyyyyMatch[3].length === 2 ? `20${ddmmyyyyMatch[3]}` : ddmmyyyyMatch[3];
        // Return in YYYY-MM-DD format: year-month-day
        console.log(`normalizeDate: Parsed DD/MM/YYYY - day=${day}, month=${month}, year=${year} -> ${year}-${month}-${day}`);
        console.log(`normalizeDate: This is the PRODUCTION/SALES DATE - we will use stock check from the SAME date`);
        return `${year}-${month}-${day}`;
      }
      
      // Try YYYY-MM-DD or YYYY/MM/DD format
      const yyyymmddMatch = trimmed.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (yyyymmddMatch) {
        const year = yyyymmddMatch[1];
        const month = String(Number(yyyymmddMatch[2])).padStart(2, '0');
        const day = String(Number(yyyymmddMatch[3])).padStart(2, '0');
        console.log(`normalizeDate: Parsed YYYY-MM-DD - year=${year}, month=${month}, day=${day} -> ${year}-${month}-${day}`);
        return `${year}-${month}-${day}`;
      }
      
      // Fallback: try to parse as date (but be careful with locale interpretation)
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        console.log(`normalizeDate: Parsed as Date object - year=${y}, month=${m}, day=${day} -> ${y}-${m}-${day}`);
        return `${y}-${m}-${day}`;
      }
      
      console.log(`normalizeDate: Could not parse date: ${trimmed}`);
      return trimmed;
    };
    const sheetDate = normalizeDate(sheetDateRaw);
    console.log('Normalized date (YYYY-MM-DD format):', sheetDate);
    console.log('Expected format: YYYY-MM-DD where YYYY=year, MM=month, DD=day');
    console.log('Example: 2025-11-10 means November 10, 2025');
    console.log('==========================================');

    let matchedOutletName: string | null = null;
    let matchedCheck: StockCheck | undefined;

    if (outletFromSheet) {
      const candidates = stockChecks.filter((sc) =>
        (sc.outlet ?? '').toLowerCase() === outletFromSheet.toLowerCase(),
      );
      if (candidates.length > 0) {
        if (sheetDate) {
          // IMPORTANT: For reconciliation, we compare with the stock check from the SAME date
          // This compares the production data with the stock check done on the same date
          const stockCheckDate = sheetDate;
          console.log(`Reconciliation: Production/Sales date is ${sheetDate}, looking for stock check from ${stockCheckDate} (same date)`);
          matchedCheck = candidates.find((c) => c.date === stockCheckDate);
        }
        if (!matchedCheck) {
          candidates.sort((a, b) => b.timestamp - a.timestamp);
          matchedCheck = candidates[0];
        }
        matchedOutletName = matchedCheck.outlet ?? outletFromSheet;
      }
    }

    if (!outletFromSheet) {
      errors.push(`❌ Missing outlet in sheet cell J5`);
    }
    if (!matchedCheck) {
      const availableOutlets = stockChecks
        .filter(sc => sc.outlet)
        .map(sc => sc.outlet)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ');
      errors.push(`❌ No matching stock check found for outlet "${outletFromSheet}" from J5. Available outlets in stock checks: ${availableOutlets || 'None'}`);
    }

    // Calculate expected stock check date (same date as production/sales)
    let expectedStockCheckDate: string | null = null;
    if (sheetDate) {
      expectedStockCheckDate = sheetDate;
      console.log(`Expected stock check date: ${expectedStockCheckDate} (same date as production/sales date ${sheetDate})`);
    }
    
    const dateMatched = !!matchedCheck && !!sheetDate && !!expectedStockCheckDate && matchedCheck.date === expectedStockCheckDate;
    if (!sheetDate) {
      errors.push(`❌ Missing or invalid sales date in sheet cell H9. Found: "${sheetDateRaw || '(empty)'}"`);
    }
    if (matchedCheck && sheetDate && expectedStockCheckDate && !dateMatched) {
      return {
        outletFromSheet: outletFromSheet ?? null,
        outletMatched: !!matchedCheck,
        matchedOutletName,
        stockCheckDate: matchedCheck?.date ?? null,
        sheetDate: sheetDate ?? null,
        dateMatched: false,
        rows: [],
        errors: [
          ...errors,
          `❌ DATE MISMATCH:`,
          `   📊 Production/Sales Date from Excel (H9): ${sheetDate}`,
          `   📋 Expected Stock Check Date: ${expectedStockCheckDate} (same date)`,
          `   📝 Found Stock Check Date: ${matchedCheck.date}`,
          `   ℹ️  Note: Reconciliation needs the stock check from the SAME date as production/sales`,
          `   ℹ️  Please create a stock check for ${expectedStockCheckDate} or adjust the production/sales date`
        ],
      };
    }

    const productByNameUnit = new Map<string, Product>();
    products.forEach((p) => {
      const key = `${p.name.toLowerCase()}__${p.unit.toLowerCase()}`;
      if (!productByNameUnit.has(key)) productByNameUnit.set(key, p);
    });

    const productConversions = options?.productConversions || [];
    const conversionMap = new Map<string, { toProductId: string; factor: number }[]>();
    productConversions.forEach((conv) => {
      const key = conv.fromProductId;
      if (!conversionMap.has(key)) {
        conversionMap.set(key, []);
      }
      conversionMap.get(key)!.push({ toProductId: conv.toProductId, factor: conv.conversionFactor });
    });

    const productsByName = new Map<string, Product[]>();
    products.forEach(p => {
      const name = p.name.toLowerCase();
      if (!productsByName.has(name)) {
        productsByName.set(name, []);
      }
      productsByName.get(name)!.push(p);
    });

    const countByProductId = new Map<string, { opening: number | null; received: number | null; wastage: number | null; closing: number | null }>();
    
    if (matchedCheck) {
      matchedCheck.counts.forEach((c) => {
        countByProductId.set(c.productId, {
          opening: c.openingStock ?? null,
          received: c.receivedStock ?? null,
          wastage: c.wastage ?? null,
          closing: c.quantity ?? null,
        });
      });
    }

    // Find the actual data range in the worksheet
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:AC500');
    const maxRow = Math.max(range.e.r + 1, 1000); // Go up to at least row 1000 or worksheet end
    
    let consecutiveEmptyRows = 0;
    const maxConsecutiveEmpty = 10; // Stop after 10 consecutive empty rows
    
    for (let i = 10; i <= maxRow; i++) { // Start from row 10 to catch all products
      const name = getCellString(ws, `I${i}`);
      const unit = getCellString(ws, `R${i}`);
      const sold = getCellNumber(ws, `AC${i}`);

      // Track consecutive empty rows to know when data ends
      if (!name && !unit && sold == null) {
        consecutiveEmptyRows++;
        if (consecutiveEmptyRows >= maxConsecutiveEmpty) {
          break; // Stop processing after many consecutive empty rows
        }
        continue;
      }
      
      consecutiveEmptyRows = 0; // Reset counter when we find data
      if (!name || !unit) {
        rows.push({
          name: name ?? '',
          unit: unit ?? '',
          sold: Number(sold ?? 0),
          opening: null,
          received: null,
          wastage: null,
          closing: null,
          expectedClosing: null,
          discrepancy: null,
          notes: 'Missing product name or unit',
        });
        continue;
      }

      const key = `${name.toLowerCase()}__${unit.toLowerCase()}`;
      let product = productByNameUnit.get(key);

      if (!product && options?.useSavedMappings !== false) {
        const mapping = await findMappingForTruncatedName(name);
        if (mapping) {
          product = products.find(p => p.id === mapping.fullProductId);
          console.log(`Using saved mapping: "${name}" -> "${mapping.fullProductName}" (${mapping.fullProductId})`);
        }
      }

      if (!product) {
        const possibleMatches = findPossibleMatches(name, products.filter(p => p.unit.toLowerCase() === unit.toLowerCase()));
        const needsMapping = possibleMatches.length > 0;
        
        rows.push({
          name,
          unit,
          sold: Number(sold ?? 0),
          opening: null,
          received: null,
          wastage: null,
          closing: null,
          expectedClosing: null,
          discrepancy: null,
          notes: needsMapping ? 'Product name may be truncated - needs confirmation' : 'Product not found in master list',
          needsMapping,
          possibleMatches: needsMapping ? possibleMatches : undefined,
        });
        continue;
      }

      const counts = matchedCheck ? countByProductId.get(product.id) : undefined;
      // ACTUAL values from stock check (not calculated)
      // Opening = what was counted at the start of the day in the stock check
      // Received = what was received during the day in the stock check  
      // Wastage = what was marked as wastage in the stock check
      // Closing = what was counted at the end of the day in the stock check (the 'quantity' field)
      let opening = counts?.opening ?? 0;
      let receivedBase = counts?.received ?? 0;
      const extraReceived = options?.requestsReceivedByProductId?.get(product.id) ?? 0;
      let received = receivedBase + extraReceived;
      let wastage = counts?.wastage ?? 0;
      let closing = counts?.closing ?? 0;
      
      console.log(`Product ${product.name}: ACTUAL values from stock check - Opening: ${opening}, Received: ${received}, Wastage: ${wastage}, Closing: ${closing}`);
      console.log(`Product ${product.name}: These are the ACTUAL counted/recorded values, not system calculations`);

      const s = Number(sold ?? 0);

      const sameName = productsByName.get(product.name.toLowerCase()) || [];
      const splitUnits: ReconciledRow['splitUnits'] = [];

      if (sameName.length > 1 && matchedCheck) {
        const unitsData: { [unit: string]: { opening: number; received: number; wastage: number; closing: number; productId: string } } = {};
        
        unitsData[product.unit] = {
          opening,
          received,
          wastage,
          closing,
          productId: product.id,
        };

        for (const altProduct of sameName) {
          if (altProduct.id === product.id) continue;
          
          const altCounts = countByProductId.get(altProduct.id);
          if (!altCounts) continue;

          const altOpening = altCounts.opening ?? 0;
          const altReceivedBase = altCounts.received ?? 0;
          const altExtraReceived = options?.requestsReceivedByProductId?.get(altProduct.id) ?? 0;
          const altReceived = altReceivedBase + altExtraReceived;
          const altWastage = altCounts.wastage ?? 0;
          const altClosing = altCounts.closing ?? 0;

          const hasStock = (altOpening + altReceived) > 0;
          if (!hasStock) continue;

          unitsData[altProduct.unit] = {
            opening: altOpening,
            received: altReceived,
            wastage: altWastage,
            closing: altClosing,
            productId: altProduct.id,
          };

          const convFactor = conversionMap.get(altProduct.id)?.find(c => c.toProductId === product.id)?.factor;
          if (convFactor) {
            console.log(`Converting ${altProduct.name} (${altProduct.unit}) to ${product.name} (${product.unit}): factor=${convFactor}`);
            console.log(`  Alt product - Opening: ${altOpening}, Received: ${altReceived}, Wastage: ${altWastage}, Closing: ${altClosing}`);
            console.log(`  Converting to base unit: Opening: ${altOpening * convFactor}, Received: ${altReceived * convFactor}, Wastage: ${altWastage * convFactor}, Closing: ${altClosing * convFactor}`);
            opening += altOpening * convFactor;
            received += altReceived * convFactor;
            wastage += altWastage * convFactor;
            closing += altClosing * convFactor;
          }
        }

        Object.entries(unitsData).forEach(([unitName, data]) => {
          const unitExpectedClosing = data.opening + data.received - (unitName === product.unit ? s : 0) - data.wastage;
          const unitDiscrepancy = data.closing - unitExpectedClosing;
          splitUnits.push({
            unit: unitName,
            opening: data.opening,
            received: data.received,
            wastage: data.wastage,
            closing: data.closing,
            expectedClosing: unitExpectedClosing,
            discrepancy: unitDiscrepancy,
          });
        });
      }

      console.log(`Final calculation for ${name} (${unit}):`);
      console.log(`  Opening: ${opening}, Received: ${received}, Sold: ${s}, Wastage: ${wastage}, Closing: ${closing}`);
      console.log(`  Formula: Discrepancy = Opening + Received - Sales - Closing - Wastage`);
      console.log(`  Discrepancy = ${opening} + ${received} - ${s} - ${closing} - ${wastage} = ${opening + received - s - closing - wastage}`);

      const discrepancy = opening + received - s - closing - wastage;
      const expectedClosing = opening + received - s - wastage;

      rows.push({
        name,
        unit,
        sold: s,
        opening,
        received,
        wastage,
        closing,
        expectedClosing,
        discrepancy,
        productId: product.id,
        rowIndex: i,
        splitUnits: splitUnits.length > 0 ? splitUnits : undefined,
      });
    }

    // Final date match check with expected stock check date
    const finalDateMatched = !!matchedCheck && !!sheetDate && !!expectedStockCheckDate && matchedCheck.date === expectedStockCheckDate;
    
    return {
      outletFromSheet: outletFromSheet ?? null,
      outletMatched: !!matchedCheck && !!outletFromSheet,
      matchedOutletName,
      stockCheckDate: matchedCheck?.date ?? null,
      sheetDate: sheetDate ?? null,
      dateMatched: finalDateMatched,
      rows,
      errors,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return {
      outletFromSheet: null,
      outletMatched: false,
      matchedOutletName: null,
      stockCheckDate: null,
      sheetDate: null,
      dateMatched: false,
      rows: [],
      errors: [`Failed to parse sales workbook: ${msg}`],
    };
  }
}

export type RawConsumptionRow = {
  rawProductId: string;
  rawName: string;
  rawUnit: string;
  openingStock: number | null;
  receivedStock: number | null;
  totalStock: number | null;
  consumed: number;
  expectedClosing: number | null;
  discrepancy: number | null;
};

export type RawConsumptionResult = {
  outlet: string | null;
  date: string | null;
  rows: RawConsumptionRow[];
};

export async function computeRawConsumptionFromSales(
  base64Data: string,
  stockChecks: StockCheck[],
  products: Product[],
  recipes: Recipe[],
): Promise<RawConsumptionResult> {
  const sales = await reconcileSalesFromExcelBase64(base64Data, stockChecks, products);
  const outlet = sales.matchedOutletName ?? sales.outletFromSheet ?? null;
  const date = sales.stockCheckDate ?? sales.sheetDate ?? null;

  const stockById = new Map<string, { totalStock: number | null; openingStock: number | null; receivedStock: number | null }>();
  if (sales.dateMatched && outlet) {
    const check = stockChecks.find(c => (c.outlet ?? '').toLowerCase() === outlet.toLowerCase() && c.date === sales.sheetDate);
    if (check) {
      check.counts.forEach(c => stockById.set(c.productId, {
        totalStock: c.quantity ?? null,
        openingStock: c.openingStock ?? null,
        receivedStock: c.receivedStock ?? null,
      }));
    }
  }

  const productsById = new Map(products.map(p => [p.id, p] as const));
  const recipeByMenu = new Map(recipes.map(r => [r.menuProductId, r] as const));

  const soldByProductId = new Map<string, number>();
  sales.rows.forEach(r => {
    if (r.productId) {
      soldByProductId.set(r.productId, (soldByProductId.get(r.productId) || 0) + (r.sold || 0));
    }
  });

  const totals = new Map<string, number>();
  soldByProductId.forEach((sold, pid) => {
    const p = productsById.get(pid);
    if (!p || p.type !== 'menu' || sold <= 0) return;
    
    // Only calculate raw materials for products with salesBasedRawCalc flag enabled
    if (!p.salesBasedRawCalc) return;
    
    const rec = recipeByMenu.get(pid);
    if (!rec) return;
    rec.components.forEach(c => {
      const prev = totals.get(c.rawProductId) || 0;
      totals.set(c.rawProductId, prev + sold * c.quantityPerUnit);
    });
  });

  const rows: RawConsumptionRow[] = [];
  totals.forEach((consumed, rawId) => {
    const raw = productsById.get(rawId);
    if (!raw) return;
    const stockData = stockById.get(rawId);
    const openingStock = stockData?.openingStock ?? null;
    const receivedStock = stockData?.receivedStock ?? null;
    const totalStock = stockData?.totalStock ?? null;
    
    // Calculate discrepancy: Kitchen Production (consumed) - Opening Stock - Received in Stock Check
    const discrepancy = (consumed != null && openingStock != null && receivedStock != null) 
      ? Number((consumed - openingStock - receivedStock).toFixed(3)) 
      : null;
    
    const expectedClosing = totalStock != null ? Number((totalStock - consumed).toFixed(3)) : null;
    
    rows.push({ 
      rawProductId: rawId, 
      rawName: raw.name, 
      rawUnit: raw.unit, 
      openingStock,
      receivedStock,
      totalStock, 
      consumed: Number(consumed.toFixed(3)), 
      expectedClosing,
      discrepancy
    });
  });

  rows.sort((a, b) => a.rawName.localeCompare(b.rawName));

  return { outlet, date, rows };
}

export function exportSalesDiscrepanciesToExcel(
  result: SalesReconcileResult,
  raw?: RawConsumptionResult | null,
): string {
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const reconciliationTimestamp = `${dateStr} ${timeStr}`;
  
  const summary = [
    { Field: 'Sales Date (from Excel H9)', Value: result.sheetDate ?? '' },
    { Field: 'Stock Check Date Used', Value: result.stockCheckDate ?? '' },
    { Field: 'Outlet (from Excel J5)', Value: result.outletFromSheet ?? '' },
    { Field: 'Date Matched', Value: result.dateMatched ? `Yes - Date Reconsolidated: ${reconciliationTimestamp}` : 'No' },
    { Field: 'Formula', Value: 'Discrepancy = Opening + Received - Sales - Closing - Wastage' },
    { Field: 'Note', Value: 'Opening, Received, Wastage, and Closing are ACTUAL values from the Stock Check' },
    { Field: 'Generated At', Value: new Date().toLocaleString() },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
  
  const ws = XLSX.utils.aoa_to_sheet([
    ['Product Name', 'Unit', 'Sold (AC)', 'Opening Stock', 'Received', 'Wastage', 'Closing Stock', 'Expected Closing', 'Discrepancy', 'Notes'],
    ...result.rows.map((r, idx) => [
      r.name,
      r.unit,
      r.sold,
      r.opening ?? 0,
      r.received ?? 0,
      r.wastage ?? 0,
      r.closing ?? 0,
      r.expectedClosing ?? 0,
      { f: `D${idx + 2}+E${idx + 2}-C${idx + 2}-G${idx + 2}-F${idx + 2}`, t: 'n' },
      r.notes ?? '',
    ])
  ]);
  
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const discrepancyCell = XLSX.utils.encode_cell({ r: R, c: 8 });
    const cell = ws[discrepancyCell];
    if (cell && typeof cell.v === 'number' && cell.v !== 0) {
      cell.s = {
        fill: { fgColor: { rgb: 'FFCCCC' } },
        font: { color: { rgb: 'CC0000' } }
      };
    }
  }
  
  if (!ws['!cols']) ws['!cols'] = [];
  ws['!cols'][0] = { wch: 20 };
  ws['!cols'][1] = { wch: 10 };
  ws['!cols'][2] = { wch: 10 };
  ws['!cols'][3] = { wch: 12 };
  ws['!cols'][4] = { wch: 10 };
  ws['!cols'][5] = { wch: 10 };
  ws['!cols'][6] = { wch: 12 };
  ws['!cols'][7] = { wch: 15 };
  ws['!cols'][8] = { wch: 12 };
  ws['!cols'][9] = { wch: 20 };
  
  XLSX.utils.book_append_sheet(wb, ws, 'Discrepancies');

  const hasUnitSplits = result.rows.some(r => r.splitUnits && r.splitUnits.length > 0);
  if (hasUnitSplits) {
    const unitSheetData: any[] = [];
    result.rows.forEach((r) => {
      if (r.splitUnits && r.splitUnits.length > 0) {
        r.splitUnits.forEach(split => {
          unitSheetData.push([
            r.name,
            split.unit,
            split.unit === r.unit ? r.sold : 0,
            split.opening,
            split.received,
            split.wastage,
            split.closing,
            split.expectedClosing,
            split.discrepancy,
          ]);
        });
        
        unitSheetData.push([
          r.name + ' (Combined Total)',
          r.unit,
          r.sold,
          r.opening ?? 0,
          r.received ?? 0,
          r.wastage ?? 0,
          r.closing ?? 0,
          r.expectedClosing ?? 0,
          r.discrepancy ?? 0,
        ]);
      }
    });
    
    if (unitSheetData.length > 0) {
      const unitWs = XLSX.utils.aoa_to_sheet([
        ['Product Name', 'Unit', 'Sold', 'Opening Stock', 'Received', 'Wastage', 'Closing Stock', 'Expected Closing', 'Discrepancy'],
        ...unitSheetData.map((row, idx) => [
          row[0],
          row[1],
          row[2],
          row[3],
          row[4],
          row[5],
          row[6],
          row[7],
          { f: `D${idx + 2}+E${idx + 2}-C${idx + 2}-G${idx + 2}-F${idx + 2}`, t: 'n' },
        ])
      ]);
      
      const unitRange = XLSX.utils.decode_range(unitWs['!ref'] || 'A1');
      for (let R = unitRange.s.r + 1; R <= unitRange.e.r; ++R) {
        const discrepancyCell = XLSX.utils.encode_cell({ r: R, c: 8 });
        const cell = unitWs[discrepancyCell];
        if (cell && typeof cell.v === 'number' && cell.v !== 0) {
          cell.s = {
            fill: { fgColor: { rgb: 'FFCCCC' } },
            font: { color: { rgb: 'CC0000' } }
          };
        }
      }
      
      if (!unitWs['!cols']) unitWs['!cols'] = [];
      unitWs['!cols'][0] = { wch: 20 };
      unitWs['!cols'][1] = { wch: 10 };
      unitWs['!cols'][2] = { wch: 10 };
      unitWs['!cols'][3] = { wch: 12 };
      unitWs['!cols'][4] = { wch: 10 };
      unitWs['!cols'][5] = { wch: 10 };
      unitWs['!cols'][6] = { wch: 12 };
      unitWs['!cols'][7] = { wch: 15 };
      unitWs['!cols'][8] = { wch: 12 };
      
      XLSX.utils.book_append_sheet(wb, unitWs, 'By Unit');
    }
  }

  if (raw && raw.rows.length > 0) {
    const rawRows = raw.rows.map((r) => ({
      'Raw Material': r.rawName,
      'Unit': r.rawUnit,
      'Opening Stock': r.openingStock ?? '',
      'Received in Stock Check': r.receivedStock ?? '',
      'Kitchen Production (Column K)': r.consumed,
      'Discrepancy (K - Opening - Received)': r.discrepancy ?? '',
      'Starting Stock (from history)': r.totalStock ?? '',
      'Expected Closing': r.expectedClosing ?? '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawRows), 'Raw Consumption');
  }

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

export function parseRequestsReceivedFromExcelBase64(
  base64Data: string,
  products: Product[],
  outletFilter?: string | null,
  dateFilterISO?: string | null,
): Map<string, number> {
  const receivedByProductId = new Map<string, number>();
  try {
    const wb = XLSX.read(base64Data, { type: 'base64' });
    if (wb.SheetNames.length === 0) return receivedByProductId;

    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      if (!rows || rows.length === 0) continue;
      const headers = (rows[0] as any[]).map((h) => String(h || '').toLowerCase().trim());

      const idxProduct = headers.findIndex((h) => h.includes('product'));
      const idxUnit = headers.findIndex((h) => h.includes('unit'));
      const idxQty = headers.findIndex((h) => h.includes('quantity'));
      const idxToOutlet = headers.findIndex((h) => h.includes('to outlet'));
      const idxDate = headers.findIndex((h) => h.includes('date'));

      if (idxProduct === -1 || idxQty === -1) continue;

      const prodKeyMap = new Map<string, Product>();
      products.forEach((p) => {
        const key = `${p.name.toLowerCase()}__${p.unit.toLowerCase()}`;
        if (!prodKeyMap.has(key)) prodKeyMap.set(key, p);
      });

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const prodName = row[idxProduct] ? String(row[idxProduct]).trim() : '';
        const unit = idxUnit !== -1 && row[idxUnit] ? String(row[idxUnit]).trim() : '';
        const qtyNum = Number(row[idxQty] ?? 0);
        const toOutlet = idxToOutlet !== -1 && row[idxToOutlet] ? String(row[idxToOutlet]).trim() : '';
        const dateStr = idxDate !== -1 && row[idxDate] ? String(row[idxDate]).trim() : '';

        if (!prodName || !Number.isFinite(qtyNum) || qtyNum === 0) continue;

        if (outletFilter && toOutlet && toOutlet.toLowerCase() !== outletFilter.toLowerCase()) continue;
        if (dateFilterISO && dateStr) {
          const d = new Date(dateStr);
          const iso = isNaN(d.getTime()) ? dateStr : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          if (iso !== dateFilterISO) continue;
        }

        const key = `${prodName.toLowerCase()}__${unit.toLowerCase()}`;
        const prod = (unit ? prodKeyMap.get(key) : undefined) || Array.from(prodKeyMap.values()).find(p => p.name.toLowerCase() === prodName.toLowerCase());
        if (!prod) continue;

        const prev = receivedByProductId.get(prod.id) || 0;
        receivedByProductId.set(prod.id, prev + qtyNum);
      }
    }
  } catch (e) {
    console.log('parseRequestsReceivedFromExcelBase64: failed', e);
  }
  return receivedByProductId;
}

export type KitchenStockDiscrepancy = {
  productName: string;
  unit: string;
  openingStock: number;
  receivedInStockCheck: number;
  kitchenProduction: number;
  discrepancy: number;
};

export type KitchenStockCheckResult = {
  productionDate: string | null;
  stockCheckDate: string | null;
  outletName: string | null;
  matched: boolean;
  discrepancies: KitchenStockDiscrepancy[];
  errors: string[];
};

export function reconcileKitchenStockFromExcelBase64(
  base64Data: string,
  stockChecks: StockCheck[],
  products: Product[],
  options?: { manualStockByProductId?: Map<string, number> }
): KitchenStockCheckResult {
  const errors: string[] = [];
  const discrepancies: KitchenStockDiscrepancy[] = [];

  try {
    const wb = XLSX.read(base64Data, { type: 'base64' });
    if (wb.SheetNames.length === 0) {
      return {
        productionDate: null,
        stockCheckDate: null,
        outletName: null,
        matched: false,
        discrepancies: [],
        errors: ['Workbook contains no sheets'],
      };
    }

    const ws = wb.Sheets[wb.SheetNames[0]];

    const dateFromCell = getCellString(ws, 'B7');
    let productionDate: string | null = null;
    
    if (dateFromCell) {
      const dateMatch = dateFromCell.match(/Date From[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
      if (dateMatch) {
        const datePart = dateMatch[1];
        const parts = datePart.split(/[-\/]/);
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          let year = parseInt(parts[2], 10);
          if (year < 100) year += 2000;
          
          const d = new Date(year, month - 1, day);
          if (!isNaN(d.getTime())) {
            productionDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
        }
      }
    }

    if (!productionDate) {
      const cellValue = dateFromCell || '(empty)';
      return {
        productionDate: null,
        stockCheckDate: null,
        outletName: null,
        matched: false,
        discrepancies: [],
        errors: [`Could not parse production date from cell B7. Found: "${cellValue}". Expected format: "Date From DD/MM/YYYY" (e.g., "Date From 21/10/2025")`],
      };
    }

    const stockCheckDate = productionDate;

    const outletName = getCellString(ws, 'D5');
    if (!outletName) {
      return {
        productionDate,
        stockCheckDate,
        outletName: null,
        matched: false,
        discrepancies: [],
        errors: ['Missing outlet name in cell D5'],
      };
    }

    const matchedStockCheck = stockChecks.find(
      (sc) => sc.date === stockCheckDate && (sc.outlet ?? '').toLowerCase() === outletName.toLowerCase()
    );

    if (!matchedStockCheck) {
      return {
        productionDate,
        stockCheckDate,
        outletName,
        matched: false,
        discrepancies: [],
        errors: [`No stock check found for outlet "${outletName}" on date ${stockCheckDate}`],
      };
    }

    const productMap = new Map<string, Product>();
    products.forEach((p) => {
      const key = `${p.name.toLowerCase()}__${p.unit.toLowerCase()}`;
      if (!productMap.has(key)) productMap.set(key, p);
    });

    const stockCheckQuantityMap = new Map<string, number>();
    if (options?.manualStockByProductId) {
      options.manualStockByProductId.forEach((qty, productId) => {
        stockCheckQuantityMap.set(productId, qty);
      });
    } else {
      matchedStockCheck.counts.forEach((count) => {
        stockCheckQuantityMap.set(count.productId, count.receivedStock ?? 0);
      });
    }

    // Dynamically find the column containing the outlet name in row 9
    // Search through columns A to Z (and beyond if needed)
    let productionColumn: string | null = null;
    const maxColumns = 50; // Search up to column AX
    
    for (let col = 0; col < maxColumns; col++) {
      const columnLetter = XLSX.utils.encode_col(col);
      const cellAddress = `${columnLetter}9`;
      const cellValue = getCellString(ws, cellAddress);
      
      if (cellValue && cellValue.toLowerCase() === outletName.toLowerCase()) {
        productionColumn = columnLetter;
        console.log(`Found outlet "${outletName}" in column ${columnLetter} at row 9`);
        break;
      }
    }

    if (!productionColumn) {
      return {
        productionDate,
        stockCheckDate,
        outletName,
        matched: false,
        discrepancies: [],
        errors: [`Could not find outlet "${outletName}" in row 9. Please ensure the outlet name appears in row 9 of the Excel sheet.`],
      };
    }

    for (let i = 8; i <= 500; i++) {
      const productName = getCellString(ws, `C${i}`);
      const unit = getCellString(ws, `E${i}`);
      const quantity = getCellNumber(ws, `${productionColumn}${i}`);

      if (!productName && unit == null && quantity == null) continue;
      if (!productName || !unit || quantity == null) continue;

      const key = `${productName.toLowerCase()}__${unit.toLowerCase()}`;
      const product = productMap.get(key);

      if (!product) {
        discrepancies.push({
          productName,
          unit,
          openingStock: 0,
          receivedInStockCheck: 0,
          kitchenProduction: quantity,
          discrepancy: quantity,
        });
        continue;
      }

      const receivedInStockCheck = stockCheckQuantityMap.get(product.id) ?? 0;
      
      // Get opening stock from the matched stock check
      const openingStock = (() => {
        if (!matchedStockCheck) return 0;
        const count = matchedStockCheck.counts.find(c => c.productId === product.id);
        return count?.openingStock ?? 0;
      })();
      
      // Calculate discrepancy: Kitchen Production - Opening Stock - Received in Stock Check
      const discrepancy = quantity - openingStock - receivedInStockCheck;

      discrepancies.push({
        productName,
        unit,
        openingStock,
        receivedInStockCheck,
        kitchenProduction: quantity,
        discrepancy,
      });
    }

    return {
      productionDate,
      stockCheckDate,
      outletName,
      matched: true,
      discrepancies,
      errors,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return {
      productionDate: null,
      stockCheckDate: null,
      outletName: null,
      matched: false,
      discrepancies: [],
      errors: [`Failed to parse kitchen stock workbook: ${msg}`],
    };
  }
}

export function exportKitchenStockDiscrepanciesToExcel(
  result: KitchenStockCheckResult,
): string {
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const reconciliationTimestamp = `${dateStr} ${timeStr}`;
  
  const summary = [
    { Field: 'Production Date', Value: result.productionDate ?? '' },
    { Field: 'Stock Check Date (Next Day)', Value: result.stockCheckDate ?? '' },
    { Field: 'Outlet Name', Value: result.outletName ?? '' },
    { Field: 'Matched', Value: result.matched ? `Yes - Date Reconsolidated: ${reconciliationTimestamp}` : 'No' },
    { Field: 'Total Discrepancies', Value: result.discrepancies.length },
    { Field: 'Formula', Value: 'Discrepancy = Kitchen Production - Opening Stock - Received in Stock Check' },
    { Field: 'Generated At', Value: new Date().toLocaleString() },
  ];

  const rows = result.discrepancies.map((d) => ({
    'Product Name': d.productName,
    'Unit': d.unit,
    'Opening Stock': d.openingStock,
    'Received in Stock Check': d.receivedInStockCheck,
    'Kitchen Production (Column K)': d.kitchenProduction,
    'Discrepancy (K - Opening - Received)': d.discrepancy,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Discrepancies');

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
