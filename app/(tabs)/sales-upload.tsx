import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, FlatList, ActivityIndicator, Alert, Switch, Modal, ScrollView, Dimensions, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '@/constants/colors';
import { FileSpreadsheet, UploadCloud, Download, ChevronDown, ChevronUp, Trash2, Calendar, AlertTriangle } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useStock } from '@/contexts/StockContext';
import { Product, StockCheck, SalesDeduction } from '@/types';
import { useRecipes } from '@/contexts/RecipeContext';
import { useAuth } from '@/contexts/AuthContext';
import { exportSalesDiscrepanciesToExcel, reconcileSalesFromExcelBase64, SalesReconcileResult, computeRawConsumptionFromSales, RawConsumptionResult, parseRequestsReceivedFromExcelBase64, reconcileKitchenStockFromExcelBase64, KitchenStockCheckResult, exportKitchenStockDiscrepanciesToExcel } from '@/utils/salesReconciler';


function base64FromUri(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    return fetch(uri)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = () => {
          const res = typeof reader.result === 'string' ? reader.result : '';
          const comma = res.indexOf(',');
          resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.readAsDataURL(blob);
      }));
  }
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

type ReconciliationHistory = {
  date: string;
  outlet: string;
  timestamp: number;
  result: SalesReconcileResult;
};

const RECONCILIATION_HISTORY_KEY = '@sales_reconciliation_history';

export default function SalesUploadScreen() {
  console.log('SalesUploadScreen: Rendering');
  const { stockChecks, products, productConversions, deductInventoryFromSales, inventoryStocks, outlets, salesDeductions, updateStockCheck, addReconcileHistory, syncAll, updateInventoryStock, reconcileHistory } = useStock();
  const { recipes } = useRecipes();
  const { isSuperAdmin } = useAuth();
  
  console.log('SalesUploadScreen: products.length:', products.length);
  console.log('SalesUploadScreen: outlets.length:', outlets.length);
  console.log('SalesUploadScreen: stockChecks.length:', stockChecks.length);
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [isPickingRequests, setIsPickingRequests] = useState<boolean>(false);
  const [manualMode, setManualMode] = useState<boolean>(false);
  const [requestBase64, setRequestBase64] = useState<string | null>(null);
  const [result, setResult] = useState<SalesReconcileResult | null>(null);
  const [rawResult, setRawResult] = useState<RawConsumptionResult | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [isPickingKitchen, setIsPickingKitchen] = useState<boolean>(false);
  const [kitchenResult, setKitchenResult] = useState<KitchenStockCheckResult | null>(null);
  const [exportingKitchen, setExportingKitchen] = useState<boolean>(false);
  const [kitchenManualMode, setKitchenManualMode] = useState<boolean>(false);
  const [manualStockBase64, setManualStockBase64] = useState<string | null>(null);
  const [isPickingManualStock, setIsPickingManualStock] = useState<boolean>(false);
  const [processingSteps, setProcessingSteps] = useState<Array<{ text: string; status: 'pending' | 'active' | 'complete' | 'error' }>>([]);
  const [showProcessingModal, setShowProcessingModal] = useState<boolean>(false);
  const [resultsExpanded, setResultsExpanded] = useState<boolean>(true);
  const [kitchenResultsExpanded, setKitchenResultsExpanded] = useState<boolean>(true);
  const [reconciliationHistory, setReconciliationHistory] = useState<ReconciliationHistory[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState<boolean>(false);
  const [deleteTargetIndex, setDeleteTargetIndex] = useState<number | null>(null);
  const [showClearDataModal, setShowClearDataModal] = useState<boolean>(false);
  const [clearDateInput, setClearDateInput] = useState<string>('');
  const [isClearing, setIsClearing] = useState<boolean>(false);

  const getProductPair = useCallback((product: Product) => {
    const fromConversion = productConversions.find(c => c.fromProductId === product.id);
    const toConversion = productConversions.find(c => c.toProductId === product.id);
    
    if (fromConversion) {
      return { 
        wholeProductId: product.id, 
        slicesProductId: fromConversion.toProductId, 
        conversionFactor: fromConversion.conversionFactor 
      };
    }
    if (toConversion) {
      return { 
        wholeProductId: toConversion.fromProductId, 
        slicesProductId: product.id, 
        conversionFactor: toConversion.conversionFactor 
      };
    }
    return null;
  }, [productConversions]);

  const processRawMaterialDeductions = useCallback(async (reconciled: SalesReconcileResult, base64Data: string) => {
    if (!reconciled.outletMatched || !reconciled.dateMatched) {
      console.log('SalesUpload: Skipping raw material deductions - outlet or date not matched');
      return;
    }

    const outletName = reconciled.matchedOutletName || reconciled.outletFromSheet;
    const salesDate = reconciled.sheetDate;
    
    if (!outletName || !salesDate) {
      console.log('SalesUpload: Missing outlet name or sales date');
      return;
    }

    const outlet = outlets.find(o => o.name === outletName);
    if (!outlet || outlet.outletType !== 'sales') {
      console.log('SalesUpload: Outlet is not a sales outlet, skipping raw material deductions');
      return;
    }

    console.log(`SalesUpload: Processing raw material deductions for ${outletName} on ${salesDate}`);

    try {
      const rawConsumption = computeRawConsumptionFromSales(base64Data, stockChecks, products, recipes);
      
      if (!rawConsumption.rows || rawConsumption.rows.length === 0) {
        console.log('SalesUpload: No raw materials consumed from sales');
        return;
      }

      console.log(`SalesUpload: Processing ${rawConsumption.rows.length} raw material deductions`);

      const productionOutletNames = outlets.filter(o => o.outletType === 'production').map(o => o.name);
      const allProductionStockChecks = stockChecks.filter(c => productionOutletNames.includes(c.outlet || ''));
      const sortedProductionStockChecks = allProductionStockChecks.sort((a, b) => b.timestamp - a.timestamp);
      
      const deductionsToProcess: Array<{
        outletName: string;
        productId: string;
        salesDate: string;
        wholeDeducted: number;
        slicesDeducted: number;
      }> = [];
      
      const stockCheckUpdates: Map<string, any> = new Map();

      for (const rawRow of rawConsumption.rows) {
        const rawProduct = products.find(p => p.id === rawRow.rawProductId);
        if (!rawProduct) {
          console.log(`SalesUpload: Raw product ${rawRow.rawProductId} not found`);
          continue;
        }

        console.log(`SalesUpload: Deducting ${rawRow.consumed} ${rawRow.rawUnit} of ${rawRow.rawName} from outlet ${outletName}`);

        const productPair = getProductPair(rawProduct);
        
        if (productPair) {
          console.log(`\n=== DEDUCTING RAW MATERIAL WITH CONVERSION: ${rawRow.rawName} ===`);
          const invStock = inventoryStocks.find(s => s.productId === productPair.wholeProductId);
          if (!invStock) {
            console.log(`SalesUpload: No inventory found for raw product ${rawRow.rawName}`);
            continue;
          }

          const isWholeProduct = rawProduct.id === productPair.wholeProductId;
          const conversionFactor = productPair.conversionFactor;
          
          let wholeDeducted = 0;
          let slicesDeducted = 0;
          
          if (isWholeProduct) {
            wholeDeducted = Math.floor(rawRow.consumed);
            slicesDeducted = Math.round((rawRow.consumed % 1) * conversionFactor);
          } else {
            const totalSlices = rawRow.consumed;
            wholeDeducted = Math.floor(totalSlices / conversionFactor);
            slicesDeducted = Math.round(totalSlices % conversionFactor);
          }

          console.log(`  Consuming: ${rawRow.consumed} ${rawRow.rawUnit} = ${wholeDeducted}W + ${slicesDeducted}S`);
          console.log(`  DEDUCTING FROM INVENTORY (for Inventory Section)`);
          console.log(`  RECORDING AS SALES DEDUCTION (for Live Inventory Sold column)`);

          deductionsToProcess.push({
            outletName,
            productId: productPair.wholeProductId,
            salesDate,
            wholeDeducted,
            slicesDeducted
          });
          
          console.log(`  ✓ Queued deduction for batch processing`);
          console.log(`  ✓ Will show as -${wholeDeducted}W -${slicesDeducted}S in Live Inventory Sold row`);
          console.log(`=== END DEDUCTING RAW MATERIAL WITH CONVERSION ===\n`);
        } else {
          console.log(`\n=== DEDUCTING RAW MATERIAL (Other Units): ${rawRow.rawName} ===`);
          console.log(`  No product pair found - this is a Production Stock (Other Units) product`);
          
          // CRITICAL: Check BOTH in-memory array AND reconciliation history to prevent duplicate deductions
          const existingDeduction = salesDeductions.find(
            d => d.outletName === outletName && d.productId === rawProduct.id && d.salesDate === salesDate && !d.deleted
          );
          
          // DOUBLE-CHECK: Also verify in reconciliation history
          const existingReconciliation = reconcileHistory.find(
            (r: any) => r.outlet === outletName && r.date === salesDate && !r.deleted
          );
          
          if (existingDeduction) {
            console.log(`  ✓ Sales already processed for raw ${rawRow.rawName} at ${outletName} on ${salesDate}`);
            console.log(`  Existing deduction ID: ${existingDeduction.id}`);
            
            if (existingReconciliation) {
              console.log(`  ✓ Reconciliation history confirms this date was already processed`);
            }
            continue;
          }
          
          if (existingReconciliation) {
            console.log(`  ⚠️ WARNING - Reconciliation history shows raw material was already processed`);
            console.log(`  Skipping to prevent duplicate deduction.`);
            continue;
          }

          console.log(`  STEP 1: Deducting ${rawRow.consumed} ${rawRow.rawUnit} from Production Stock checks`);
          const productionOutletNames = outlets.filter(o => o.outletType === 'production').map(o => o.name);
          const allProductionStockChecks = stockChecks.filter(c => productionOutletNames.includes(c.outlet || ''));
          
          let totalAvailableQty = 0;
          const sortedProductionStockChecks = allProductionStockChecks.sort((a, b) => b.timestamp - a.timestamp);
          
          for (const check of sortedProductionStockChecks) {
            const countIndex = check.counts.findIndex(c => c.productId === rawProduct.id);
            if (countIndex === -1) continue;
            
            const count = check.counts[countIndex];
            const receivedStock = count.receivedStock || 0;
            const wastage = count.wastage || 0;
            const netStock = receivedStock - wastage;
            
            if (netStock > 0) {
              totalAvailableQty += netStock;
            }
          }
          
          console.log(`  Total available qty in Production Stock: ${totalAvailableQty} ${rawRow.rawUnit}`);
          
          if (totalAvailableQty < rawRow.consumed) {
            console.log(`  ⚠️ Insufficient stock! Available: ${totalAvailableQty}, Required: ${rawRow.consumed}`);
            console.log(`  Skipping deduction for this product`);
            continue;
          }

          let remainingToDeduct = rawRow.consumed;
          
          for (const check of sortedProductionStockChecks) {
            if (remainingToDeduct <= 0) break;
            
            const countIndex = check.counts.findIndex(c => c.productId === rawProduct.id);
            if (countIndex === -1) continue;
            
            const count = check.counts[countIndex];
            const receivedStock = count.receivedStock || 0;
            const wastage = count.wastage || 0;
            const currentQuantity = count.quantity || 0;
            const netStock = receivedStock - wastage;
            
            if (netStock <= 0) continue;
            
            const deductAmount = Math.min(netStock, remainingToDeduct);
            const updatedReceivedStock = Math.max(0, receivedStock - deductAmount);
            const updatedQuantity = Math.max(0, currentQuantity - deductAmount);
            
            console.log(`  Deducting ${deductAmount} from check ${check.id} (outlet: ${check.outlet})`);
            console.log(`    Before: receivedStock=${receivedStock}, quantity=${currentQuantity}`);
            console.log(`    After: receivedStock=${updatedReceivedStock}, quantity=${updatedQuantity}`);
            
            let updatedCounts = stockCheckUpdates.get(check.id) || [...check.counts];
            const updateIndex = updatedCounts.findIndex((c: any) => c.productId === rawProduct.id);
            if (updateIndex !== -1) {
              updatedCounts[updateIndex] = {
                ...updatedCounts[updateIndex],
                receivedStock: updatedReceivedStock,
                quantity: updatedQuantity,
              };
            }
            
            stockCheckUpdates.set(check.id, updatedCounts);
            remainingToDeduct -= deductAmount;
            
            console.log(`  ✓ Queued ${deductAmount} deduction from production stock check (remaining: ${remainingToDeduct})`);
          }

          console.log(`  STEP 2: Recording sales deduction for Live Inventory`);
          deductionsToProcess.push({
            outletName,
            productId: rawProduct.id,
            salesDate,
            wholeDeducted: rawRow.consumed,
            slicesDeducted: 0
          });
          console.log(`  ✓ Queued sales deduction - will show as -${rawRow.consumed} in Live Inventory Sold column`);
          console.log(`  ✓ Inventory Section will be updated: -${rawRow.consumed} ${rawRow.rawUnit}`);
          console.log(`=== END DEDUCTING RAW MATERIAL (Other Units) ===\n`);
        }
      }
      
      console.log(`\n=== BATCH PROCESSING ${stockCheckUpdates.size} STOCK CHECK UPDATES ===`);
      const stockCheckPromises = Array.from(stockCheckUpdates.entries()).map(([checkId, counts]) => 
        updateStockCheck(checkId, counts).catch(err => {
          console.error(`Failed to update stock check ${checkId}:`, err);
        })
      );
      await Promise.all(stockCheckPromises);
      console.log(`✓ Completed ${stockCheckUpdates.size} stock check updates`);
      
      console.log(`\n=== BATCH PROCESSING ${deductionsToProcess.length} INVENTORY DEDUCTIONS ===`);
      const deductionPromises = deductionsToProcess.map(d => 
        deductInventoryFromSales(d.outletName, d.productId, d.salesDate, d.wholeDeducted, d.slicesDeducted)
          .catch(err => {
            console.error(`Failed to deduct inventory for product ${d.productId}:`, err);
          })
      );
      await Promise.all(deductionPromises);
      console.log(`✓ Completed ${deductionsToProcess.length} inventory deductions`);
      
    } catch (error) {
      console.error('SalesUpload: Error processing raw material deductions:', error);
    }
  }, [products, inventoryStocks, outlets, stockChecks, salesDeductions, deductInventoryFromSales, updateStockCheck, getProductPair, recipes]);

  const processSalesInventoryDeductions = useCallback(async (reconciled: SalesReconcileResult) => {
    if (!reconciled.outletMatched || !reconciled.dateMatched) {
      console.log('SalesUpload: Skipping inventory deductions - outlet or date not matched');
      return;
    }

    const outletName = reconciled.matchedOutletName || reconciled.outletFromSheet;
    const salesDate = reconciled.sheetDate;
    
    if (!outletName || !salesDate) {
      console.log('SalesUpload: Missing outlet name or sales date');
      return;
    }

    const outlet = outlets.find(o => o.name === outletName);
    if (!outlet || outlet.outletType !== 'sales') {
      console.log('SalesUpload: Outlet is not a sales outlet, skipping inventory deductions');
      return;
    }

    console.log(`SalesUpload: Processing inventory deductions for ${outletName} on ${salesDate}`);
    
    const nextDay = new Date(salesDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];
    console.log(`SalesUpload: Will add Prods.Req quantities to next day: ${nextDayStr}`);
    
    const productionOutletNames = outlets.filter(o => o.outletType === 'production').map(o => o.name);
    const allProductionStockChecks = stockChecks.filter(c => productionOutletNames.includes(c.outlet || ''));
    const sortedProductionStockChecks = allProductionStockChecks.sort((a, b) => b.timestamp - a.timestamp);
    
    const deductionsToProcess: Array<{
      outletName: string;
      productId: string;
      salesDate: string;
      wholeDeducted: number;
      slicesDeducted: number;
    }> = [];
    
    const inventoryUpdates: Array<{
      productId: string;
      updates: any;
    }> = [];
    
    const stockCheckUpdates: Map<string, any> = new Map();
    
    for (const row of reconciled.rows) {
      if (!row.productId || !row.sold || row.sold === 0) continue;
      
      const product = products.find(p => p.id === row.productId);
      if (!product) continue;

      const productPair = getProductPair(product);
      
      if (productPair) {
        // FIX: Don't skip - always create/update sales deductions for Live Inventory display
        // Sales deductions are REQUIRED for Live Inventory sold column to work
        console.log(`SalesUpload: Processing ${product.name} at ${outletName} on ${salesDate} (with conversions)`);
        console.log(`SalesUpload: This will create/update sales deduction for Live Inventory sold column`);
        
        // Check if we already processed this (for logging only, not for skipping)
        const existingReconciliation = reconcileHistory.find(
          (r: any) => r.outlet === outletName && r.date === salesDate && !r.deleted
        );
        
        if (existingReconciliation) {
          console.log(`SalesUpload: Found existing reconciliation for ${outletName} on ${salesDate}`);
          console.log(`SalesUpload: Will update sales deductions to match current reconciliation data`);
        }

        const invStock = inventoryStocks.find(s => s.productId === productPair.wholeProductId);
        if (!invStock) {
          console.log(`SalesUpload: No inventory found for product ${product.name}`);
          continue;
        }

        const isWholeProduct = row.productId === productPair.wholeProductId;
        const conversionFactor = productPair.conversionFactor;
        
        let wholeDeducted = 0;
        let slicesDeducted = 0;
        
        if (isWholeProduct) {
          wholeDeducted = Math.floor(row.sold);
          slicesDeducted = Math.round((row.sold % 1) * conversionFactor);
        } else {
          const totalSlices = row.sold;
          wholeDeducted = Math.floor(totalSlices / conversionFactor);
          slicesDeducted = Math.round(totalSlices % conversionFactor);
        }

        deductionsToProcess.push({
          outletName,
          productId: productPair.wholeProductId,
          salesDate,
          wholeDeducted,
          slicesDeducted
        });
        console.log(`SalesUpload: Queued ${wholeDeducted} whole + ${slicesDeducted} slices of ${product.name}`);
        
        if (row.received != null && row.received > 0) {
            const receivedQty = row.received;
            const isReceivedWholeProduct = row.productId === productPair.wholeProductId;
            
            let receivedWhole = 0;
            let receivedSlices = 0;
            
            if (isReceivedWholeProduct) {
              receivedWhole = Math.floor(receivedQty);
              receivedSlices = Math.round((receivedQty % 1) * conversionFactor);
            } else {
              const totalSlices = receivedQty;
              receivedWhole = Math.floor(totalSlices / conversionFactor);
              receivedSlices = Math.round(totalSlices % conversionFactor);
            }
            
            // Normalize received slices
            if (receivedSlices >= conversionFactor) {
              const extraWhole = Math.floor(receivedSlices / conversionFactor);
              receivedWhole += extraWhole;
              receivedSlices = Math.round(receivedSlices % conversionFactor);
            }
            
          console.log(`SalesUpload: Adding ${receivedWhole} whole + ${receivedSlices} slices to Prods.Req for ${product.name}`);
          
          const currentProdsReqWhole = invStock.prodsReqWhole || 0;
          const currentProdsReqSlices = invStock.prodsReqSlices || 0;
          
          const newProdsReqWhole = currentProdsReqWhole + receivedWhole;
          const newProdsReqSlices = currentProdsReqSlices + receivedSlices;
          
          inventoryUpdates.push({
            productId: productPair.wholeProductId,
            updates: {
              prodsReqWhole: newProdsReqWhole,
              prodsReqSlices: newProdsReqSlices,
            }
          });
          
          console.log(`SalesUpload: Queued Prods.Req update - was ${currentProdsReqWhole}W/${currentProdsReqSlices}S, will be ${newProdsReqWhole}W/${newProdsReqSlices}S`);
        }
      } else {
        console.log(`SalesUpload: No product pair found for ${product.name}, checking Production Stock (Other Units)`);
        
        // FIX: Don't skip - always create/update sales deductions for Live Inventory display
        console.log(`SalesUpload: Processing ${product.name} at ${outletName} on ${salesDate} (no conversion)`);
        console.log(`SalesUpload: This will create/update sales deduction for Live Inventory sold column`);
        
        // Check if we already processed this (for logging only)
        const existingReconciliation = reconcileHistory.find(
          (r: any) => r.outlet === outletName && r.date === salesDate && !r.deleted
        );
        
        if (existingReconciliation) {
          console.log(`SalesUpload: Found existing reconciliation - will update to match current data`);
        }
        
        let totalAvailableQty = 0;
        
        for (const check of sortedProductionStockChecks) {
          const countIndex = check.counts.findIndex(c => c.productId === row.productId);
          if (countIndex === -1) continue;
          
          const count = check.counts[countIndex];
          const receivedStock = count.receivedStock || 0;
          const wastage = count.wastage || 0;
          const netStock = receivedStock - wastage;
          
          if (netStock > 0) {
            totalAvailableQty += netStock;
          }
        }
        
        console.log(`SalesUpload: Total available qty for ${product.name} in Production Stock: ${totalAvailableQty}`);
        
        if (totalAvailableQty < row.sold) {
          console.log(`SalesUpload: Insufficient stock in Production Stock for ${product.name}. Available: ${totalAvailableQty}, Required: ${row.sold}`);
          continue;
        }

        let remainingToDeduct = row.sold;
        
        for (const check of sortedProductionStockChecks) {
          if (remainingToDeduct <= 0) break;
          
          const countIndex = check.counts.findIndex(c => c.productId === row.productId);
          if (countIndex === -1) continue;
          
          const count = check.counts[countIndex];
          const receivedStock = count.receivedStock || 0;
          const wastage = count.wastage || 0;
          const netStock = receivedStock - wastage;
          
          if (netStock <= 0) continue;
          
          const deductAmount = Math.min(netStock, remainingToDeduct);
          const updatedReceivedStock = Math.max(0, receivedStock - deductAmount);
          
          let updatedCounts = stockCheckUpdates.get(check.id) || [...check.counts];
          const updateIndex = updatedCounts.findIndex((c: any) => c.productId === row.productId);
          if (updateIndex !== -1) {
            updatedCounts[updateIndex] = {
              ...updatedCounts[updateIndex],
              receivedStock: updatedReceivedStock,
            };
          }
          
          stockCheckUpdates.set(check.id, updatedCounts);
          remainingToDeduct -= deductAmount;
          
          console.log(`SalesUpload: Queued ${deductAmount} of ${product.name} from production stock check ${check.id}`);
        }

        deductionsToProcess.push({
          outletName,
          productId: row.productId,
          salesDate,
          wholeDeducted: row.sold,
          slicesDeducted: 0
        });
        console.log(`SalesUpload: Queued ${row.sold} ${product.unit} of ${product.name} from Production Stock`);
      }
    }
    
    console.log(`\n=== BATCH PROCESSING ${stockCheckUpdates.size} STOCK CHECK UPDATES ===`);
    const stockCheckPromises = Array.from(stockCheckUpdates.entries()).map(([checkId, counts]) => 
      updateStockCheck(checkId, counts).catch(err => {
        console.error(`Failed to update stock check ${checkId}:`, err);
      })
    );
    await Promise.all(stockCheckPromises);
    console.log(`✓ Completed ${stockCheckUpdates.size} stock check updates`);
    
    console.log(`\n=== BATCH PROCESSING ${deductionsToProcess.length} INVENTORY DEDUCTIONS ===`);
    const deductionPromises = deductionsToProcess.map(d => 
      deductInventoryFromSales(d.outletName, d.productId, d.salesDate, d.wholeDeducted, d.slicesDeducted)
        .catch(err => {
          console.error(`Failed to deduct inventory for product ${d.productId}:`, err);
        })
    );
    await Promise.all(deductionPromises);
    console.log(`✓ Completed ${deductionsToProcess.length} inventory deductions`);
    
    console.log(`\n=== BATCH PROCESSING ${inventoryUpdates.length} INVENTORY STOCK UPDATES ===`);
    const inventoryPromises = inventoryUpdates.map(u => 
      updateInventoryStock(u.productId, u.updates).catch(err => {
        console.error(`Failed to update inventory for product ${u.productId}:`, err);
      })
    );
    await Promise.all(inventoryPromises);
    console.log(`✓ Completed ${inventoryUpdates.length} inventory stock updates`);
    
  }, [products, inventoryStocks, outlets, stockChecks, salesDeductions, deductInventoryFromSales, updateStockCheck, getProductPair, updateInventoryStock]);

  const saveReconciliationToHistory = useCallback(async (reconciled: SalesReconcileResult) => {
    try {
      const outlet = reconciled.matchedOutletName || reconciled.outletFromSheet;
      const date = reconciled.sheetDate;
      
      if (!outlet || !date) return;

      setReconciliationHistory(prev => {
        const existingIndex = prev.findIndex(
          h => h.date === date && h.outlet === outlet
        );

        const hasDifference = (existing: ReconciliationHistory, newResult: SalesReconcileResult): boolean => {
          if (existing.result.rows.length !== newResult.rows.length) return true;
          
          return existing.result.rows.some((oldRow, idx) => {
            const newRow = newResult.rows[idx];
            return oldRow.sold !== newRow.sold || 
                   oldRow.opening !== newRow.opening ||
                   oldRow.received !== newRow.received ||
                   oldRow.closing !== newRow.closing;
          });
        };

        let updatedHistory: ReconciliationHistory[];
        
        if (existingIndex >= 0) {
          if (hasDifference(prev[existingIndex], reconciled)) {
            updatedHistory = [...prev];
            updatedHistory[existingIndex] = {
              date,
              outlet,
              timestamp: Date.now(),
              result: reconciled,
            };
            console.log('Updated existing reconciliation in history');
          } else {
            console.log('No changes detected, skipping history update');
            return prev;
          }
        } else {
          updatedHistory = [
            ...prev,
            {
              date,
              outlet,
              timestamp: Date.now(),
              result: reconciled,
            },
          ];
        }

        updatedHistory.sort((a, b) => b.timestamp - a.timestamp);
        AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify(updatedHistory)).catch(err => {
          console.error('Failed to save reconciliation history:', err);
        });
        return updatedHistory;
      });
    } catch (error) {
      console.error('Failed to save reconciliation history:', error);
    }
  }, []);

  const updateStep = useCallback((index: number, status: 'pending' | 'active' | 'complete' | 'error') => {
    setProcessingSteps(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], status };
      }
      return updated;
    });
  }, []);

  const pickFile = useCallback(async () => {
    try {
      setIsPicking(true);
      setResult(null);
      setShowProcessingModal(true);
      
      const steps = [
        { text: 'Selecting Excel file...', status: 'active' as const },
        { text: 'Reading file contents...', status: 'pending' as const },
        { text: 'Parsing sales data...', status: 'pending' as const },
        { text: 'Matching with stock checks...', status: 'pending' as const },
        { text: 'Processing inventory deductions...', status: 'pending' as const },
        { text: 'Finalizing results...', status: 'pending' as const },
      ];
      setProcessingSteps(steps);
      
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets || res.assets.length === 0) {
        updateStep(0, 'error');
        return;
      }
      const file = res.assets[0];
      console.log('SalesUpload: picked file', file);
      updateStep(0, 'complete');
      
      updateStep(1, 'active');
      const base64 = await base64FromUri(file.uri);
      console.log('SalesUpload: base64 length', base64.length);
      updateStep(1, 'complete');
      updateStep(2, 'active');
      let requestsMap: Map<string, number> | undefined;
      if (manualMode && requestBase64) {
        try {
          const temp = reconcileSalesFromExcelBase64(base64, stockChecks, products);
          const outlet = temp.matchedOutletName ?? temp.outletFromSheet ?? null;
          const date = temp.sheetDate ?? null;
          requestsMap = parseRequestsReceivedFromExcelBase64(requestBase64, products, outlet, date);
        } catch (e) {
          console.log('SalesUpload: failed to pre-parse requests', e);
        }
      }
      updateStep(2, 'complete');
      
      updateStep(3, 'active');
      const reconciled = reconcileSalesFromExcelBase64(base64, stockChecks, products, { requestsReceivedByProductId: requestsMap, productConversions });
      console.log('SalesUpload: reconciled', reconciled);
      updateStep(3, 'complete');
      
      updateStep(4, 'active');
      await Promise.all([
        processSalesInventoryDeductions(reconciled),
        processRawMaterialDeductions(reconciled, base64)
      ]);
      updateStep(4, 'complete');
      
      updateStep(5, 'active');
      
      if (reconciled.errors.length > 0 && reconciled.rows.length === 0) {
        updateStep(5, 'error');
        setProcessingSteps(prev => [...prev, { text: `Error: ${reconciled.errors.join(', ')}`, status: 'error' }]);
        return;
      }
      
      if (!reconciled.dateMatched) {
        const msg = reconciled.errors.length > 0 ? reconciled.errors.join('\n') : 'Stock check date does not match sales sheet date (H9). Please ensure dates match and try again.';
        updateStep(5, 'error');
        setProcessingSteps(prev => [...prev, { text: `Error: Date mismatch - ${msg}`, status: 'error' }]);
        return;
      }
      
      if (reconciled.rows.length === 0) {
        updateStep(5, 'error');
        setProcessingSteps(prev => [...prev, { text: 'Error: No valid sales data found in the uploaded file', status: 'error' }]);
        return;
      }
      setResult(reconciled);
      await saveReconciliationToHistory(reconciled);
      
      let raw: RawConsumptionResult | null = null;
      try {
        raw = computeRawConsumptionFromSales(base64, stockChecks, products, recipes);
        setRawResult(raw);
        console.log('SalesUpload: Raw consumption computed:', raw.rows.length, 'raw materials');
      } catch (e) {
        console.log('SalesUpload: raw compute failed', e);
        setRawResult(null);
      }
      
      const outlet = reconciled.matchedOutletName || reconciled.outletFromSheet;
      const date = reconciled.sheetDate;
      if (outlet && date && reconciled.dateMatched) {
        console.log('\n=== SAVING RECONCILIATION HISTORY ===');
        console.log('Outlet:', outlet);
        console.log('Date:', date);
        console.log('Sales rows:', reconciled.rows.length);
        console.log('Raw consumption rows:', raw?.rows.length || 0);
        
        if (raw?.rows && raw.rows.length > 0) {
          console.log('Raw materials consumed:');
          raw.rows.forEach(r => {
            console.log(`  - ${r.rawName} (ID: ${r.rawProductId}): ${r.consumed} ${r.rawUnit}`);
          });
        } else {
          console.log('⚠️ WARNING: No raw consumption data to save!');
        }
        
        try {
          await addReconcileHistory({
            id: `reconcile-${Date.now()}`,
            date,
            outlet,
            salesData: reconciled.rows.map(r => ({
              productId: r.productId || '',
              sold: r.sold,
              opening: r.opening ?? 0,
              received: r.received ?? 0,
              closing: r.closing ?? 0,
            })),
            stockCheckData: reconciled.rows.map(r => ({
              productId: r.productId || '',
              openingStock: r.opening ?? 0,
              receivedStock: r.received ?? 0,
              wastage: r.wastage ?? 0,
              closingStock: r.closing ?? 0,
            })),
            rawConsumption: raw?.rows.map(r => ({
              rawProductId: r.rawProductId,
              consumed: r.consumed,
            })) || [],
            timestamp: Date.now(),
          });
          console.log('Saved reconciliation to StockContext for', outlet, date, 'with', raw?.rows.length || 0, 'raw consumption entries');
          
          // Trigger immediate sync so other devices are notified
          console.log('Triggering immediate sync to share reconciliation with other devices...');
          await syncAll().catch(e => console.error('Failed to sync reconciliation:', e));
          console.log('✓ Reconciliation synced to server - other devices will receive it on their next sync');
        } catch (error) {
          console.error('Failed to save reconciliation to StockContext:', error);
        }
      }
      
      updateStep(5, 'complete');
      setProcessingSteps(prev => [...prev, { text: `✓ Successfully processed ${reconciled.rows.length} products`, status: 'complete' }]);
      
      if (!reconciled.outletMatched) {
        setProcessingSteps(prev => [...prev, { text: 'Warning: Outlet mismatch - counts may be missing', status: 'error' }]);
      }
      if (reconciled.errors.length > 0) {
        setProcessingSteps(prev => [...prev, { text: `Note: ${reconciled.errors.join(', ')}`, status: 'error' }]);
      }
    } catch (e) {
      console.error('SalesUpload: pick error', e);
      setProcessingSteps(prev => [...prev, { text: `Fatal Error: ${e instanceof Error ? e.message : 'Failed to load file'}`, status: 'error' }]);
    } finally {
      setIsPicking(false);
    }
  }, [stockChecks, products, recipes, manualMode, requestBase64, productConversions, processSalesInventoryDeductions, processRawMaterialDeductions, saveReconciliationToHistory, addReconcileHistory, syncAll, updateStep]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const historyData = await AsyncStorage.getItem(RECONCILIATION_HISTORY_KEY);
        if (historyData) {
          const history: ReconciliationHistory[] = JSON.parse(historyData);
          setReconciliationHistory(history.sort((a, b) => b.timestamp - a.timestamp));
        }
      } catch (error) {
        console.error('Failed to load reconciliation history:', error);
      }
    };
    loadHistory();
  }, []);

  const handleDeleteHistory = useCallback(async (index: number) => {
    try {
      const updatedHistory = reconciliationHistory.filter((_, i) => i !== index);
      setReconciliationHistory(updatedHistory);
      await AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify(updatedHistory));
      setShowDeleteConfirm(false);
      setDeleteTargetIndex(null);
      Alert.alert('Success', 'Reconciliation record deleted successfully.');
    } catch (error) {
      console.error('Failed to delete reconciliation history:', error);
      Alert.alert('Error', 'Failed to delete reconciliation record.');
    }
  }, [reconciliationHistory]);

  const handleDeleteAllHistory = useCallback(async () => {
    try {
      setReconciliationHistory([]);
      await AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify([]));
      setShowDeleteAllConfirm(false);
      Alert.alert('Success', 'All reconciliation history deleted successfully.');
    } catch (error) {
      console.error('Failed to delete all reconciliation history:', error);
      Alert.alert('Error', 'Failed to delete all reconciliation history.');
    }
  }, []);

  const handleClearReconciliationData = useCallback(async () => {
    if (!clearDateInput.trim()) {
      Alert.alert('Error', 'Please enter a date');
      return;
    }

    try {
      setIsClearing(true);
      console.log('Clearing reconciliation data for date:', clearDateInput);

      const updatedHistory = reconciliationHistory.filter(h => h.date !== clearDateInput);
      await AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify(updatedHistory));
      setReconciliationHistory(updatedHistory);

      const deductionsForDate = salesDeductions.filter(d => d.salesDate === clearDateInput);
      console.log(`Found ${deductionsForDate.length} sales deductions to restore for ${clearDateInput}`);

      for (const deduction of deductionsForDate) {
        const product = products.find(p => p.id === deduction.productId);
        if (!product) continue;

        console.log(`Restoring stock for ${product.name}: ${deduction.wholeDeducted} whole + ${deduction.slicesDeducted} slices`);

        const invStock = inventoryStocks.find(s => s.productId === deduction.productId);
        if (invStock) {
          const outlet = invStock.outletStocks.find(o => o.outletName === deduction.outletName);
          if (outlet) {
            const conversionFactor = productConversions.find(c => 
              c.fromProductId === deduction.productId || c.toProductId === deduction.productId
            )?.conversionFactor || 1;

            const totalSlicesToRestore = (deduction.wholeDeducted * conversionFactor) + deduction.slicesDeducted;
            let newSlices = outlet.slices + totalSlicesToRestore;
            let newWhole = outlet.whole;

            while (newSlices >= conversionFactor) {
              newWhole += 1;
              newSlices -= conversionFactor;
            }

            outlet.whole = newWhole;
            outlet.slices = newSlices;
            console.log(`Restored inventory - Whole: ${newWhole}, Slices: ${newSlices}`);
          }
        }
      }

      const updatedDeductions = salesDeductions.filter(d => d.salesDate !== clearDateInput);
      await AsyncStorage.setItem('@stock_app_sales_deductions', JSON.stringify(updatedDeductions));

      const updatedInventory = [...inventoryStocks];
      await AsyncStorage.setItem('@stock_app_inventory_stocks', JSON.stringify(updatedInventory));

      setShowClearDataModal(false);
      setClearDateInput('');
      Alert.alert('Success', `Reconciliation data for ${clearDateInput} has been cleared and inventory restored.`);
    } catch (error) {
      console.error('Failed to clear reconciliation data:', error);
      Alert.alert('Error', `Failed to clear reconciliation data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsClearing(false);
    }
  }, [clearDateInput, reconciliationHistory, salesDeductions, products, inventoryStocks, productConversions]);

  const discrepanciesCount = useMemo(() => {
    if (!result) return 0;
    return result.rows.filter((r) => (r.discrepancy ?? 0) !== 0).length;
  }, [result]);

  const pickKitchenFile = useCallback(async () => {
    try {
      setIsPickingKitchen(true);
      setKitchenResult(null);
      setShowProcessingModal(true);
      
      const steps = [
        { text: 'Selecting Excel file...', status: 'active' as const },
        { text: 'Reading file contents...', status: 'pending' as const },
        { text: 'Parsing kitchen production data...', status: 'pending' as const },
        { text: 'Matching with stock checks...', status: 'pending' as const },
        { text: 'Calculating discrepancies...', status: 'pending' as const },
      ];
      setProcessingSteps(steps);
      
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets || res.assets.length === 0) {
        updateStep(0, 'error');
        return;
      }
      const file = res.assets[0];
      console.log('KitchenStock: picked file', file);
      updateStep(0, 'complete');
      
      updateStep(1, 'active');
      const base64 = await base64FromUri(file.uri);
      console.log('KitchenStock: base64 length', base64.length);
      updateStep(1, 'complete');
      
      updateStep(2, 'active');
      let manualStockMap: Map<string, number> | undefined;
      if (kitchenManualMode && manualStockBase64) {
        try {
          const temp = reconcileKitchenStockFromExcelBase64(base64, stockChecks, products);
          const outlet = temp.outletName ?? null;
          const date = temp.stockCheckDate ?? null;
          manualStockMap = parseRequestsReceivedFromExcelBase64(manualStockBase64, products, outlet, date);
        } catch (e) {
          console.log('KitchenStock: failed to pre-parse manual stock', e);
        }
      }
      updateStep(2, 'complete');
      
      updateStep(3, 'active');
      const reconciled = reconcileKitchenStockFromExcelBase64(base64, stockChecks, products, { manualStockByProductId: manualStockMap });
      console.log('KitchenStock: reconciled', reconciled);
      updateStep(3, 'complete');
      
      updateStep(4, 'active');
      
      if (!reconciled.matched) {
        const msg = reconciled.errors.length > 0 ? reconciled.errors.join('\n') : 'No matching stock check found';
        updateStep(4, 'error');
        setProcessingSteps(prev => [...prev, { text: `Error: ${msg}`, status: 'error' }]);
        setKitchenResult(null);
        return;
      }
      
      setKitchenResult(reconciled);
      updateStep(4, 'complete');
      setProcessingSteps(prev => [...prev, { text: `✓ Successfully processed ${reconciled.discrepancies.length} items`, status: 'complete' }]);
      
      if (reconciled.errors.length > 0) {
        setProcessingSteps(prev => [...prev, { text: `Note: ${reconciled.errors.join(', ')}`, status: 'error' }]);
      }
    } catch (e) {
      console.error('KitchenStock: pick error', e);
      setProcessingSteps(prev => [...prev, { text: `Fatal Error: ${e instanceof Error ? e.message : 'Failed to load file'}`, status: 'error' }]);
    } finally {
      setIsPickingKitchen(false);
    }
  }, [stockChecks, products, kitchenManualMode, manualStockBase64, updateStep]);

  const exportKitchenReport = useCallback(async () => {
    if (!kitchenResult) return;
    try {
      setExportingKitchen(true);
      const base64 = exportKitchenStockDiscrepanciesToExcel(kitchenResult);
      const filename = `kitchen_stock_discrepancies_${(kitchenResult.outletName || 'outlet').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

      if (Platform.OS === 'web') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 200);
      } else {
        const uri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        const canShare = await (await import('expo-sharing')).isAvailableAsync();
        if (canShare) {
          await (await import('expo-sharing')).shareAsync(uri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Export Kitchen Stock Discrepancies',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Saved', `Report saved to: ${uri}`);
        }
      }
    } catch (e) {
      console.error('KitchenStock: export error', e);
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setExportingKitchen(false);
    }
  }, [kitchenResult]);

  const exportReport = useCallback(async () => {
    if (!result) return;
    try {
      setExporting(true);
      const base64 = exportSalesDiscrepanciesToExcel(result, rawResult);
      const filename = `sales_reconcile_${(result.matchedOutletName || result.outletFromSheet || 'outlet').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

      if (Platform.OS === 'web') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 200);
      } else {
        const uri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        const canShare = await (await import('expo-sharing')).isAvailableAsync();
        if (canShare) {
          await (await import('expo-sharing')).shareAsync(uri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Export Sales Reconcile',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Saved', `Report saved to: ${uri}`);
        }
      }
    } catch (e) {
      console.error('SalesUpload: export error', e);
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setExporting(false);
    }
  }, [result, rawResult]);

  const renderSalesItem = useCallback((item: NonNullable<SalesReconcileResult>['rows'][number]) => {
    const hasDiscrepancy = (item.discrepancy ?? 0) !== 0;
    const hasSplitUnits = item.splitUnits && item.splitUnits.length > 0;
    
    return (
      <View style={[styles.rowContainer, hasDiscrepancy ? styles.rowDiscrepancy : undefined]} testID="sales-row">
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowSub}>Combined ({item.unit})</Text>
            {item.notes ? <Text style={styles.rowNote}>{item.notes}</Text> : null}
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.kv}>Sold: <Text style={styles.kvVal}>{item.sold}</Text></Text>
            <Text style={styles.kv}>Open: <Text style={styles.kvVal}>{item.opening ?? '-'}</Text></Text>
            <Text style={styles.kv}>Recv: <Text style={styles.kvVal}>{item.received ?? '-'}</Text></Text>
            <Text style={styles.kv}>Wst: <Text style={styles.kvVal}>{item.wastage ?? '-'}</Text></Text>
            <Text style={styles.kv}>Close: <Text style={styles.kvVal}>{item.closing ?? '-'}</Text></Text>
            <Text style={styles.kv}>Exp: <Text style={styles.kvVal}>{item.expectedClosing ?? '-'}</Text></Text>
            <Text style={[styles.kv, hasDiscrepancy ? styles.discrepancy : undefined]}>Δ: <Text style={[styles.kvVal, hasDiscrepancy ? styles.discrepancy : undefined]}>{item.discrepancy ?? '-'}</Text></Text>
          </View>
        </View>
        
        {hasSplitUnits && (
          <View style={styles.splitUnitsContainer}>
            <Text style={styles.splitUnitsHeader}>By Unit:</Text>
            {item.splitUnits!.map((split, idx) => {
              const splitHasDiscrepancy = split.discrepancy !== 0;
              return (
                <View key={`${split.unit}-${idx}`} style={styles.splitUnitRow}>
                  <View style={styles.splitUnitLeft}>
                    <Text style={styles.splitUnitTitle}>{split.unit}</Text>
                  </View>
                  <View style={styles.splitUnitRight}>
                    <Text style={styles.kvSmall}>Sold: <Text style={styles.kvValSmall}>{split.unit === item.unit ? item.sold : 0}</Text></Text>
                    <Text style={styles.kvSmall}>Open: <Text style={styles.kvValSmall}>{split.opening}</Text></Text>
                    <Text style={styles.kvSmall}>Recv: <Text style={styles.kvValSmall}>{split.received}</Text></Text>
                    <Text style={styles.kvSmall}>Wst: <Text style={styles.kvValSmall}>{split.wastage}</Text></Text>
                    <Text style={styles.kvSmall}>Close: <Text style={styles.kvValSmall}>{split.closing}</Text></Text>
                    <Text style={styles.kvSmall}>Exp: <Text style={styles.kvValSmall}>{split.expectedClosing}</Text></Text>
                    <Text style={[styles.kvSmall, splitHasDiscrepancy ? styles.discrepancy : undefined]}>Δ: <Text style={[styles.kvValSmall, splitHasDiscrepancy ? styles.discrepancy : undefined]}>{split.discrepancy}</Text></Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }, []);

  console.log('SalesUploadScreen: About to return JSX');
  
  return (
    <View style={styles.container} testID="sales-upload-screen">

      <Modal
        visible={showProcessingModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowProcessingModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Processing Excel File</Text>
            
            <View style={styles.stepsContainer}>
              {processingSteps.map((step, index) => (
                <View key={index} style={styles.stepRow}>
                  <View style={styles.stepIcon}>
                    {step.status === 'pending' && (
                      <View style={styles.pendingIcon} />
                    )}
                    {step.status === 'active' && (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    )}
                    {step.status === 'complete' && (
                      <Text style={styles.completeIcon}>✓</Text>
                    )}
                    {step.status === 'error' && (
                      <Text style={styles.errorIcon}>✕</Text>
                    )}
                  </View>
                  <Text style={[
                    styles.stepText,
                    step.status === 'active' && styles.stepTextActive,
                    step.status === 'complete' && styles.stepTextComplete,
                    step.status === 'error' && styles.stepTextError,
                  ]}>
                    {step.text}
                  </Text>
                </View>
              ))}
            </View>
            
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowProcessingModal(false)}
            >
              <Text style={styles.modalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {isSuperAdmin && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <AlertTriangle color="#FF9F0A" size={20} />
            <Text style={[styles.cardTitle, { color: '#FF9F0A' }]}>Super Admin: Clear Reconciliation Data</Text>
          </View>
          <Text style={styles.cardDesc}>Clear all reconciliation data for a specific date. This will restore deducted inventory and remove sales records.</Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#FF9F0A' }]}
            onPress={() => setShowClearDataModal(true)}
          >
            <View style={styles.btnInner}>
              <Calendar color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Clear Data by Date</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <FileSpreadsheet color={Colors.light.tint} size={20} />
          <Text style={styles.cardTitle}>Upload Outlet Sales (Excel)</Text>
        </View>
        <Text style={styles.cardDesc}>Sheet fields used: Outlet J5, Names I14:I500, Units R14:R500, Sold AC14:AC500.</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Manual upload stock requests</Text>
          <Switch value={manualMode} onValueChange={setManualMode} testID="manual-toggle" />
        </View>
        {manualMode && (
          <View style={styles.manualRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={async () => {
              try {
                setIsPickingRequests(true);
                const res2 = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], multiple: false, copyToCacheDirectory: true });
                if (res2.canceled || !res2.assets || res2.assets.length === 0) return;
                const f = res2.assets[0];
                const b64 = await base64FromUri(f.uri);
                setRequestBase64(b64);
                Alert.alert('Requests file attached', 'We will use this to improve reconciliation.');
              } catch (err) {
                console.log('Pick requests excel error', err);
                Alert.alert('Error', 'Failed to select requests excel');
              } finally {
                setIsPickingRequests(false);
              }
            }} disabled={isPickingRequests} testID="pick-requests-btn">
              {isPickingRequests ? <ActivityIndicator color={Colors.light.tint} /> : (
                <View style={styles.btnInner}>
                  <UploadCloud color={Colors.light.tint} size={18} />
                  <Text style={styles.secondaryBtnText}>Choose Requests Excel</Text>
                </View>
              )}
            </TouchableOpacity>
            {requestBase64 ? <Text style={styles.meta}>Requests file selected</Text> : null}
          </View>
        )}
        <TouchableOpacity style={styles.primaryBtn} onPress={pickFile} disabled={isPicking} testID="pick-excel-btn">
          {isPicking ? <ActivityIndicator color="#fff" /> : (
            <View style={styles.btnInner}>
              <UploadCloud color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Choose Excel</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <FileSpreadsheet color={Colors.light.tint} size={20} />
          <Text style={styles.cardTitle}>Kitchen Stock Check</Text>
        </View>
        <Text style={styles.cardDesc}>Upload kitchen production Excel. Match production date from B7 with same date stock check. Outlet from D5. The system will search for the outlet name in row 9 and use that column (rows 8-500) for kitchen production quantities. Products from C, units from E.</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Manual upload stock request</Text>
          <Switch value={kitchenManualMode} onValueChange={setKitchenManualMode} testID="kitchen-manual-toggle" />
        </View>
        {kitchenManualMode && (
          <View style={styles.manualRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={async () => {
              try {
                setIsPickingManualStock(true);
                const res2 = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], multiple: false, copyToCacheDirectory: true });
                if (res2.canceled || !res2.assets || res2.assets.length === 0) return;
                const f = res2.assets[0];
                const b64 = await base64FromUri(f.uri);
                setManualStockBase64(b64);
                Alert.alert('Manual stock file attached', 'We will use this instead of historical stock check data.');
              } catch (err) {
                console.log('Pick manual stock excel error', err);
                Alert.alert('Error', 'Failed to select manual stock excel');
              } finally {
                setIsPickingManualStock(false);
              }
            }} disabled={isPickingManualStock} testID="pick-manual-stock-btn">
              {isPickingManualStock ? <ActivityIndicator color={Colors.light.tint} /> : (
                <View style={styles.btnInner}>
                  <UploadCloud color={Colors.light.tint} size={18} />
                  <Text style={styles.secondaryBtnText}>Choose Manual Stock Excel</Text>
                </View>
              )}
            </TouchableOpacity>
            {manualStockBase64 ? <Text style={styles.meta}>Manual stock file selected</Text> : null}
          </View>
        )}
        <TouchableOpacity style={styles.primaryBtn} onPress={pickKitchenFile} disabled={isPickingKitchen} testID="pick-kitchen-excel-btn">
          {isPickingKitchen ? <ActivityIndicator color="#fff" /> : (
            <View style={styles.btnInner}>
              <UploadCloud color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Choose Kitchen Excel</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {kitchenResult && (
        <View style={styles.result} testID="kitchen-result">
          <TouchableOpacity 
            style={styles.resultHeaderContainer} 
            onPress={() => setKitchenResultsExpanded(!kitchenResultsExpanded)}
            activeOpacity={0.7}
          >
            <View style={styles.resultHeaderLeft}>
              <View style={styles.resultTitleRow}>
                <Text style={styles.resultTitle}>Kitchen Stock Check</Text>
                <Text style={[styles.badgeSmall, kitchenResult.matched ? styles.badgeOk : styles.badgeWarn]}>
                  {kitchenResult.matched ? 'Matched' : 'No Match'}
                </Text>
              </View>
              {kitchenResult.matched && (
                <Text style={styles.reconsolidatedDate}>
                  Date Reconsolidated: {new Date().toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  }).replace(',', '')}
                </Text>
              )}
              <Text style={styles.metaInline}>Outlet: {kitchenResult.outletName ?? 'N/A'}</Text>
              <Text style={styles.metaInline}>{kitchenResult.discrepancies.length} items · {kitchenResult.discrepancies.filter(d => d.discrepancy !== 0).length} discrepancies</Text>
            </View>
            <View style={styles.resultHeaderRight}>
              <TouchableOpacity 
                style={styles.exportIconBtn} 
                onPress={(e) => {
                  e.stopPropagation();
                  exportKitchenReport();
                }} 
                disabled={exportingKitchen}
              >
                {exportingKitchen ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <Download color={Colors.light.tint} size={20} />
                )}
              </TouchableOpacity>
              {kitchenResultsExpanded ? (
                <ChevronUp color={Colors.light.text} size={20} />
              ) : (
                <ChevronDown color={Colors.light.text} size={20} />
              )}
            </View>
          </TouchableOpacity>

          {kitchenResultsExpanded && (
            <>
              <View style={styles.metaContainer}>
                <Text style={styles.meta}>Production Date: {kitchenResult.productionDate ?? '-'}</Text>
                <Text style={styles.meta}>Stock Check Date: {kitchenResult.stockCheckDate ?? '-'}</Text>
              </View>

              <ScrollView style={styles.resultScrollView} nestedScrollEnabled>
                {kitchenResult.discrepancies.map((item, idx) => {
                  const hasDiscrepancy = item.discrepancy !== 0;
                  return (
                    <View key={`${item.productName}-${item.unit}-${idx}`} style={[styles.row, hasDiscrepancy ? styles.rowDiscrepancy : undefined]} testID="kitchen-row">
                      <View style={styles.rowLeft}>
                        <Text style={styles.rowTitle}>{item.productName}</Text>
                        <Text style={styles.rowSub}>{item.unit}</Text>
                      </View>
                      <View style={styles.rowRight}>
                        <Text style={styles.kv}>Opening: <Text style={styles.kvVal}>{item.openingStock}</Text></Text>
                        <Text style={styles.kv}>Received: <Text style={styles.kvVal}>{item.receivedInStockCheck}</Text></Text>
                        <Text style={styles.kv}>Kitchen: <Text style={styles.kvVal}>{item.kitchenProduction}</Text></Text>
                        <Text style={[styles.kv, hasDiscrepancy ? styles.discrepancy : undefined]}>Δ: <Text style={[styles.kvVal, hasDiscrepancy ? styles.discrepancy : undefined]}>{item.discrepancy}</Text></Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {reconciliationHistory.length > 0 && (
        <View style={styles.card}>
          <TouchableOpacity 
            style={styles.cardHeader}
            onPress={() => setExpandedHistory(prev => {
              const next = new Set(prev);
              if (next.has('main')) {
                next.delete('main');
              } else {
                next.add('main');
              }
              return next;
            })}
          >
            <FileSpreadsheet color={Colors.light.tint} size={20} />
            <Text style={styles.cardTitle}>Reconciliation History ({reconciliationHistory.length})</Text>
            {expandedHistory.has('main') ? (
              <ChevronUp color={Colors.light.text} size={20} />
            ) : (
              <ChevronDown color={Colors.light.text} size={20} />
            )}
          </TouchableOpacity>
          
          {expandedHistory.has('main') && (
            <View style={styles.historyContainer}>
              <View style={styles.historyActionsBar}>
                <TouchableOpacity
                  style={styles.deleteAllButton}
                  onPress={() => setShowDeleteAllConfirm(true)}
                  disabled={reconciliationHistory.length === 0}
                >
                  <Trash2 size={16} color={reconciliationHistory.length === 0 ? Colors.light.muted : '#f44336'} />
                  <Text style={[styles.deleteAllButtonText, reconciliationHistory.length === 0 && styles.deleteAllButtonTextDisabled]}>Delete All</Text>
                </TouchableOpacity>
              </View>
              {reconciliationHistory.map((history, idx) => {
                const historyKey = `${history.date}-${history.outlet}`;
                const isExpanded = expandedHistory.has(historyKey);
                const discrepancies = history.result.rows.filter(r => (r.discrepancy ?? 0) !== 0).length;
                
                return (
                  <View key={`${historyKey}-${idx}`} style={styles.historyCard}>
                    <TouchableOpacity
                      style={styles.historyHeader}
                      onPress={() => {
                        setExpandedHistory(prev => {
                          const next = new Set(prev);
                          if (next.has(historyKey)) {
                            next.delete(historyKey);
                          } else {
                            next.add(historyKey);
                          }
                          return next;
                        });
                      }}
                    >
                      <View style={styles.historyHeaderLeft}>
                        <Text style={styles.historyDate}>{history.date}</Text>
                        <Text style={styles.historyOutlet}>{history.outlet}</Text>
                        <Text style={styles.historyMeta}>{history.result.rows.length} items · {discrepancies} discrepancies</Text>
                      </View>
                      <View style={styles.historyHeaderRight}>
                        <TouchableOpacity
                          style={styles.historyDownloadButton}
                          onPress={async (e) => {
                            e.stopPropagation();
                            try {
                              const base64 = exportSalesDiscrepanciesToExcel(history.result, null);
                              const filename = `sales_reconcile_${(history.outlet || 'outlet').replace(/\s+/g, '_')}_${history.date}.xlsx`;

                              if (Platform.OS === 'web') {
                                const byteCharacters = atob(base64);
                                const byteNumbers = new Array(byteCharacters.length);
                                for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                                const byteArray = new Uint8Array(byteNumbers);
                                const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = filename;
                                link.click();
                                setTimeout(() => URL.revokeObjectURL(url), 200);
                              } else {
                                const uri = `${FileSystem.documentDirectory}${filename}`;
                                await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
                                const canShare = await (await import('expo-sharing')).isAvailableAsync();
                                if (canShare) {
                                  await (await import('expo-sharing')).shareAsync(uri, {
                                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                    dialogTitle: 'Export Sales Reconciliation',
                                    UTI: 'com.microsoft.excel.xlsx',
                                  });
                                } else {
                                  Alert.alert('Saved', `Report saved to: ${uri}`);
                                }
                              }
                              Alert.alert('Success', 'Reconciliation report downloaded successfully.');
                            } catch (error) {
                              console.error('History download error:', error);
                              Alert.alert('Error', 'Failed to download reconciliation report.');
                            }
                          }}
                        >
                          <Download size={18} color={Colors.light.tint} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.historyDeleteButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            setDeleteTargetIndex(idx);
                            setShowDeleteConfirm(true);
                          }}
                        >
                          <Trash2 size={18} color="#f44336" />
                        </TouchableOpacity>
                        {isExpanded ? (
                          <ChevronUp size={20} color={Colors.light.tint} />
                        ) : (
                          <ChevronDown size={20} color={Colors.light.tint} />
                        )}
                      </View>
                    </TouchableOpacity>
                    
                    {isExpanded && (
                      <ScrollView style={styles.historyItemsContainer} nestedScrollEnabled>
                        {history.result.rows.map((item, itemIdx) => {
                          const hasDiscrepancy = (item.discrepancy ?? 0) !== 0;
                          return (
                            <View key={`${item.name}-${itemIdx}`} style={[styles.row, hasDiscrepancy ? styles.rowDiscrepancy : undefined]}>
                              <View style={styles.rowLeft}>
                                <Text style={styles.rowTitle}>{item.name}</Text>
                                <Text style={styles.rowSub}>{item.unit}</Text>
                              </View>
                              <View style={styles.rowRight}>
                                <Text style={styles.kv}>Sold: <Text style={styles.kvVal}>{item.sold}</Text></Text>
                                <Text style={styles.kv}>Open: <Text style={styles.kvVal}>{item.opening ?? '-'}</Text></Text>
                                <Text style={styles.kv}>Recv: <Text style={styles.kvVal}>{item.received ?? '-'}</Text></Text>
                                <Text style={styles.kv}>Close: <Text style={styles.kvVal}>{item.closing ?? '-'}</Text></Text>
                                <Text style={[styles.kv, hasDiscrepancy ? styles.discrepancy : undefined]}>Δ: <Text style={[styles.kvVal, hasDiscrepancy ? styles.discrepancy : undefined]}>{item.discrepancy ?? '-'}</Text></Text>
                              </View>
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {result && (
        <View style={styles.result} testID="reconcile-result">
          <TouchableOpacity 
            style={styles.resultHeaderContainer} 
            onPress={() => setResultsExpanded(!resultsExpanded)}
            activeOpacity={0.7}
          >
            <View style={styles.resultHeaderLeft}>
              <View style={styles.resultTitleRow}>
                <Text style={styles.resultTitle}>Sales Reconciliation</Text>
                <Text style={[styles.badgeSmall, result.outletMatched ? styles.badgeOk : styles.badgeWarn]}>
                  {result.outletMatched ? 'Matched' : 'No Match'}
                </Text>
              </View>
              <Text style={styles.metaInline}>Outlet: {result.outletFromSheet ?? 'N/A'}</Text>
              <Text style={styles.metaInline}>{result.rows.length} items · {discrepanciesCount} discrepancies</Text>
            </View>
            <View style={styles.resultHeaderRight}>
              <TouchableOpacity 
                style={styles.exportIconBtn} 
                onPress={(e) => {
                  e.stopPropagation();
                  exportReport();
                }} 
                disabled={exporting}
              >
                {exporting ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <Download color={Colors.light.tint} size={20} />
                )}
              </TouchableOpacity>
              {resultsExpanded ? (
                <ChevronUp color={Colors.light.text} size={20} />
              ) : (
                <ChevronDown color={Colors.light.text} size={20} />
              )}
            </View>
          </TouchableOpacity>

          {resultsExpanded && (
            <>
              <View style={styles.metaContainer}>
                <Text style={styles.meta}>Stock Check Date: {result.stockCheckDate ?? '-'}</Text>
                <Text style={styles.meta}>Sales Sheet Date: {result.sheetDate ?? '-'}</Text>
              </View>

              <ScrollView style={styles.resultScrollView} nestedScrollEnabled>
                {result.rows.map((item, idx) => (
                  <View key={`${item.name}-${item.unit}-${idx}`}>
                    {renderSalesItem(item)}
                  </View>
                ))}

                {rawResult && rawResult.rows.length > 0 && (
                  <View style={styles.rawConsumptionSection}>
                    <Text style={styles.sectionHeaderText}>Raw Material Consumption</Text>
                    {rawResult.rows.map((item) => (
                      <View key={item.rawProductId} style={styles.row}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.rowTitle}>{item.rawName}</Text>
                          <Text style={styles.rowSub}>{item.rawUnit}</Text>
                        </View>
                        <View style={styles.rowRight}>
                          <Text style={styles.kv}>Total: <Text style={styles.kvVal}>{item.totalStock ?? '-'}</Text></Text>
                          <Text style={styles.kv}>Consumed: <Text style={styles.kvVal}>{item.consumed}</Text></Text>
                          <Text style={styles.kv}>Expected Close: <Text style={styles.kvVal}>{item.expectedClosing ?? '-'}</Text></Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}

      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowDeleteConfirm(false);
          setDeleteTargetIndex(null);
        }}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalContent}>
            <Text style={styles.confirmModalTitle}>Delete Reconciliation Record?</Text>
            <Text style={styles.confirmModalMessage}>This action cannot be undone. Are you sure you want to delete this reconciliation record?</Text>
            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonCancel]}
                onPress={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTargetIndex(null);
                }}
              >
                <Text style={styles.confirmModalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonDelete]}
                onPress={() => {
                  if (deleteTargetIndex !== null) {
                    handleDeleteHistory(deleteTargetIndex);
                  }
                }}
              >
                <Text style={styles.confirmModalButtonTextDelete}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showDeleteAllConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteAllConfirm(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalContent}>
            <Text style={styles.confirmModalTitle}>Delete All Reconciliation History?</Text>
            <Text style={styles.confirmModalMessage}>This will permanently delete all {reconciliationHistory.length} reconciliation records. This action cannot be undone.</Text>
            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonCancel]}
                onPress={() => setShowDeleteAllConfirm(false)}
              >
                <Text style={styles.confirmModalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonDelete]}
                onPress={handleDeleteAllHistory}
              >
                <Text style={styles.confirmModalButtonTextDelete}>Delete All</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showClearDataModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowClearDataModal(false);
          setClearDateInput('');
        }}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalContent}>
            <View style={styles.clearDataModalHeader}>
              <AlertTriangle size={32} color="#FF9F0A" />
              <Text style={styles.confirmModalTitle}>Clear Reconciliation Data</Text>
            </View>
            <Text style={styles.confirmModalMessage}>
              Enter the date (DD/MM/YYYY) to clear all reconciliation data. This will:
              {`\n`}• Remove reconciliation history{`\n`}• Delete sales deduction records{`\n`}• Restore inventory quantities{`\n`}• Update live inventory
            </Text>
            <View style={styles.dateInputContainer}>
              <Calendar size={20} color={Colors.light.tint} />
              <TextInput
                style={styles.dateInput}
                placeholder="DD/MM/YYYY (e.g., 13/11/2025)"
                value={clearDateInput}
                onChangeText={setClearDateInput}
                placeholderTextColor={Colors.light.tabIconDefault}
              />
            </View>
            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonCancel]}
                onPress={() => {
                  setShowClearDataModal(false);
                  setClearDateInput('');
                }}
                disabled={isClearing}
              >
                <Text style={styles.confirmModalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmModalButton, { backgroundColor: '#FF9F0A' }]}
                onPress={handleClearReconciliationData}
                disabled={isClearing}
              >
                {isClearing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmModalButtonTextDelete}>Clear Data</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
    padding: 16,
    minHeight: 100,
  },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 12,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  toggleLabel: { fontSize: 12, color: Colors.light.text, fontWeight: '600' },
  manualRow: { marginBottom: 8 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  cardDesc: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  result: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  resultHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: Colors.light.card,
  },
  resultHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  resultHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
  },
  exportIconBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,122,255,0.08)',
  },
  metaContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  metaInline: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    marginBottom: 8,
  },
  rowContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowDiscrepancy: {
    backgroundColor: 'rgba(255,59,48,0.06)',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  rowLeft: {
    flex: 1,
    paddingRight: 8,
  },
  rowRight: {
    minWidth: 160,
    alignItems: 'flex-end',
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
  },
  rowSub: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  rowNote: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 2,
  },
  kv: {
    fontSize: 12,
    color: Colors.light.text,
  },
  kvVal: {
    fontWeight: '700',
  },
  discrepancy: {
    color: '#FF3B30',
  },
  secondaryBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: Colors.light.tint,
    fontWeight: '700',
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 11,
    overflow: 'hidden',
    color: '#fff',
  },
  badgeOk: {
    backgroundColor: '#34C759',
  },
  badgeWarn: {
    backgroundColor: '#FF9F0A',
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 6,
  },
  splitUnitsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    backgroundColor: 'rgba(0,122,255,0.03)',
    borderRadius: 6,
    padding: 8,
  },
  splitUnitsHeader: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    marginBottom: 8,
  },
  splitUnitRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  splitUnitLeft: {
    flex: 1,
    justifyContent: 'center' as const,
  },
  splitUnitTitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  splitUnitRight: {
    minWidth: 140,
    alignItems: 'flex-end' as const,
    gap: 1,
  },
  kvSmall: {
    fontSize: 11,
    color: Colors.light.text,
  },
  kvValSmall: {
    fontWeight: '600' as const,
  },
  resultScrollView: {
    maxHeight: Dimensions.get('window').height * 0.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rawConsumptionSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  stepsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepIcon: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingIcon: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.light.border,
  },
  completeIcon: {
    fontSize: 18,
    color: '#34C759',
    fontWeight: '700',
  },
  errorIcon: {
    fontSize: 18,
    color: '#FF3B30',
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.tabIconDefault,
  },
  stepTextActive: {
    color: Colors.light.tint,
    fontWeight: '600',
  },
  stepTextComplete: {
    color: Colors.light.text,
  },
  stepTextError: {
    color: '#FF3B30',
  },
  modalButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  historyContainer: {
    marginTop: 12,
    gap: 12,
  },
  historyCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  historyHeaderLeft: {
    flex: 1,
  },
  historyHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
  },
  historyDownloadButton: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
  },
  historyDeleteButton: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(244, 67, 54, 0.08)',
  },
  historyActionsBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  deleteAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 67, 54, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(244, 67, 54, 0.2)',
  },
  deleteAllButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f44336',
  },
  deleteAllButtonTextDisabled: {
    color: Colors.light.muted,
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmModalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmModalMessage: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmModalButtonCancel: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  confirmModalButtonDelete: {
    backgroundColor: '#f44336',
  },
  confirmModalButtonTextCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
  },
  confirmModalButtonTextDelete: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  clearDataModalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    marginBottom: 24,
  },
  dateInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
    padding: 0,
  },
  historyDate: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 2,
  },
  historyOutlet: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.tint,
    marginBottom: 2,
  },
  historyMeta: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  reconsolidatedDate: {
    fontSize: 11,
    color: '#34C759',
    marginTop: 2,
    fontWeight: '600' as const,
  },
  historyItemsContainer: {
    maxHeight: 300,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
});
