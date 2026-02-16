import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, FlatList, ActivityIndicator, Alert, Switch, Modal, ScrollView, Dimensions, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '@/constants/colors';
import { FileSpreadsheet, UploadCloud, Download, ChevronDown, ChevronUp, Trash2, Calendar, AlertTriangle, CalendarDays, X } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useStock } from '@/contexts/StockContext';
import { Product, StockCheck, SalesDeduction, InventoryStock } from '@/types';
import { useRecipes } from '@/contexts/RecipeContext';
import { useAuth } from '@/contexts/AuthContext';
import { exportSalesDiscrepanciesToExcel, reconcileSalesFromExcelBase64, SalesReconcileResult, computeRawConsumptionFromSales, RawConsumptionResult, parseRequestsReceivedFromExcelBase64, reconcileKitchenStockFromExcelBase64, KitchenStockCheckResult, exportKitchenStockDiscrepanciesToExcel } from '@/utils/salesReconciler';
import { saveKitchenStockReportLocally, saveKitchenStockReportToServer, getLocalKitchenStockReports, KitchenStockReport, saveSalesReportLocally, saveSalesReportToServer, getLocalSalesReports, SalesReport, syncAllReconciliationData } from '@/utils/reconciliationSync';
import { CalendarModal } from '@/components/CalendarModal';


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
  const stockContext = useStock();
  const { stockChecks, products, productConversions, deductInventoryFromSales, inventoryStocks, outlets, salesDeductions, updateStockCheck, addReconcileHistory, syncAll, updateInventoryStock, reconcileHistory, clearAllReconcileHistory, deleteReconcileHistory } = stockContext;
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
  const [showClearDateCalendar, setShowClearDateCalendar] = useState<boolean>(false);
  const [clearDateInput, setClearDateInput] = useState<string>('');
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [showDeleteAllReconcileConfirm, setShowDeleteAllReconcileConfirm] = useState<boolean>(false);
  const [isDeletingAllReconcile, setIsDeletingAllReconcile] = useState<boolean>(false);

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
      const rawConsumption = await computeRawConsumptionFromSales(base64Data, stockChecks, products, recipes);
      
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
    
    const prodsReqUpdatesForHistory: Array<{
      productId: string;
      prodsReqWhole: number;
      prodsReqSlices: number;
    }> = [];
    
    const stockCheckUpdates: Map<string, any> = new Map();
    
    for (const row of reconciled.rows) {
      if (!row.productId || !row.sold || row.sold === 0) continue;
      
      const product = products.find(p => p.id === row.productId);
      if (!product) continue;

      const productPair = getProductPair(product);
      
      if (productPair) {
        console.log(`\n=== PROCESSING MENU ITEM: ${product.name} ===`);
        console.log(`SalesUpload: Product ID: ${product.id}`);
        console.log(`SalesUpload: Outlet: ${outletName}, Date: ${salesDate}`);
        console.log(`SalesUpload: Sold quantity: ${row.sold}`);
        console.log(`SalesUpload: Product has unit conversions - will create/update sales deduction`);
        
        // Check if we already processed this
        const existingReconciliation = reconcileHistory.find(
          (r: any) => r.outlet === outletName && r.date === salesDate && !r.deleted
        );
        
        if (existingReconciliation) {
          console.log(`SalesUpload: ⚠️ Re-reconciliation detected for ${outletName} on ${salesDate}`);
          console.log(`SalesUpload: Will update sales deductions to match NEW reconciliation data`);
          console.log(`SalesUpload: This prevents duplicate inventory deductions`);
        } else {
          console.log(`SalesUpload: First reconciliation for ${outletName} on ${salesDate}`);
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
        console.log(`SalesUpload: ✓ Queued sales deduction: ${wholeDeducted}W + ${slicesDeducted}S`);
        console.log(`SalesUpload: This will appear in Live Inventory 'Sold' column for ${product.name}`);
        console.log(`=== END PROCESSING MENU ITEM ===\n`);
        
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
          
          prodsReqUpdatesForHistory.push({
            productId: productPair.wholeProductId,
            prodsReqWhole: newProdsReqWhole,
            prodsReqSlices: newProdsReqSlices,
          });
          
          console.log(`SalesUpload: Queued Prods.Req update - was ${currentProdsReqWhole}W/${currentProdsReqSlices}S, will be ${newProdsReqWhole}W/${newProdsReqSlices}S`);
        }
      } else {
        console.log(`\n=== PROCESSING MENU ITEM (NO CONVERSION): ${product.name} ===`);
        console.log(`SalesUpload: Product ID: ${product.id}`);
        console.log(`SalesUpload: Outlet: ${outletName}, Date: ${salesDate}`);
        console.log(`SalesUpload: Sold quantity: ${row.sold}`);
        console.log(`SalesUpload: No unit conversions - production stock (other units)`);
        
        // Check if we already processed this
        const existingReconciliation = reconcileHistory.find(
          (r: any) => r.outlet === outletName && r.date === salesDate && !r.deleted
        );
        
        if (existingReconciliation) {
          console.log(`SalesUpload: ⚠️ Re-reconciliation detected for ${outletName} on ${salesDate}`);
          console.log(`SalesUpload: Will update sales deductions to match NEW reconciliation data`);
        } else {
          console.log(`SalesUpload: First reconciliation for ${outletName} on ${salesDate}`);
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
        console.log(`SalesUpload: ✓ Queued sales deduction: ${row.sold} ${product.unit}`);
        console.log(`SalesUpload: This will appear in Live Inventory 'Sold' column for ${product.name}`);
        console.log(`=== END PROCESSING MENU ITEM (NO CONVERSION) ===\n`);
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
    
    return prodsReqUpdatesForHistory;
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
        { text: 'Syncing latest data from server...', status: 'pending' as const },
        { text: 'Parsing sales data...', status: 'pending' as const },
        { text: 'Matching with stock checks...', status: 'pending' as const },
        { text: 'Checking for existing reconciliation...', status: 'pending' as const },
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
      
      // CRITICAL FIX: Sync BEFORE reconciliation to get latest data from server
      // This ensures we see if reconciliation was already done on another device
      updateStep(2, 'active');
      console.log('\n=== SYNCING BEFORE RECONCILIATION ===');
      console.log('Pulling latest reconciliation data from server...');
      try {
        await syncAll(true); // silent sync
        console.log('✓ Sync complete - will read fresh data from AsyncStorage');
      } catch (syncError) {
        console.error('Sync failed, proceeding with cached data:', syncError);
      }
      updateStep(2, 'complete');
      
      updateStep(3, 'active');
      let requestsMap: Map<string, number> | undefined;
      if (manualMode && requestBase64) {
        try {
          const temp = await reconcileSalesFromExcelBase64(base64, stockChecks, products);
          const outlet = temp.matchedOutletName ?? temp.outletFromSheet ?? null;
          const date = temp.sheetDate ?? null;
          requestsMap = parseRequestsReceivedFromExcelBase64(requestBase64, products, outlet, date);
        } catch (e) {
          console.log('SalesUpload: failed to pre-parse requests', e);
        }
      }
      updateStep(3, 'complete');
      
      updateStep(4, 'active');
      const reconciled = await reconcileSalesFromExcelBase64(base64, stockChecks, products, { requestsReceivedByProductId: requestsMap, productConversions });
      console.log('SalesUpload: reconciled', reconciled);
      updateStep(4, 'complete');
      
      // CRITICAL FIX: Check if reconciliation already exists BEFORE making any deductions
      updateStep(5, 'active');
      const outlet = reconciled.matchedOutletName || reconciled.outletFromSheet;
      const date = reconciled.sheetDate;
      
      if (outlet && date) {
        console.log('\n=== CHECKING FOR EXISTING RECONCILIATION ===');
        console.log('Outlet:', outlet, 'Date:', date);
        
        // CRITICAL: Read reconcileHistory directly from AsyncStorage to get FRESH synced data
        // React state updates are async and may not reflect the sync that just completed
        console.log('Reading FRESH reconcileHistory from AsyncStorage (bypassing stale React state)...');
        let freshReconcileHistory: any[] = [];
        try {
          const historyData = await AsyncStorage.getItem('@stock_app_reconcile_history');
          if (historyData) {
            freshReconcileHistory = JSON.parse(historyData).filter((h: any) => !h?.deleted);
            console.log('✓ Loaded', freshReconcileHistory.length, 'reconciliation entries from AsyncStorage');
          } else {
            console.log('No reconciliation history in AsyncStorage');
          }
        } catch (readError) {
          console.error('Failed to read reconcileHistory from AsyncStorage:', readError);
          console.log('Falling back to React state (may be stale):', reconcileHistory.length, 'entries');
          freshReconcileHistory = reconcileHistory;
        }
        
        const existingReconciliation = freshReconcileHistory.find(
          r => r.outlet === outlet && r.date === date && !r.deleted
        );
        
        if (existingReconciliation) {
          console.log('✓ FOUND EXISTING RECONCILIATION - Skipping inventory deductions');
          console.log('  This reconciliation was already processed before');
          console.log('  Reconciliation ID:', existingReconciliation.id);
          console.log('  Timestamp:', new Date(existingReconciliation.timestamp).toISOString());
          console.log('  Sales data entries:', existingReconciliation.salesData?.length || 0);
          console.log('  Raw consumption entries:', existingReconciliation.rawConsumption?.length || 0);
          console.log('=== SKIPPING DEDUCTIONS - Using existing data ===\n');
          
          updateStep(5, 'complete');
          setProcessingSteps(prev => [...prev, { 
            text: '✓ Found existing reconciliation - No duplicate deductions', 
            status: 'complete' 
          }]);
        } else {
          console.log('✗ NO EXISTING RECONCILIATION FOUND - Proceeding with deductions');
          console.log('  This is the first time processing this date/outlet');
          console.log('=== PROCEEDING WITH INVENTORY DEDUCTIONS ===\n');
          
          updateStep(5, 'complete');
          updateStep(6, 'active');
          const [prodsReqUpdates] = await Promise.all([
            processSalesInventoryDeductions(reconciled),
            processRawMaterialDeductions(reconciled, base64)
          ]);
          
          // Store prodsReqUpdates for later use in reconciliation history
          (reconciled as any).prodsReqUpdatesFromDeductions = prodsReqUpdates;
          
          updateStep(6, 'complete');
        }
      } else {
        console.log('⚠️ WARNING: Missing outlet or date - cannot check for existing reconciliation');
        updateStep(5, 'complete');
        updateStep(6, 'active');
        const [prodsReqUpdates] = await Promise.all([
          processSalesInventoryDeductions(reconciled),
          processRawMaterialDeductions(reconciled, base64)
        ]);
        
        // Store prodsReqUpdates for later use in reconciliation history
        (reconciled as any).prodsReqUpdatesFromDeductions = prodsReqUpdates;
        
        updateStep(6, 'complete');
      }
      
      updateStep(7, 'active');
      
      if (reconciled.errors.length > 0 && reconciled.rows.length === 0) {
        updateStep(7, 'error');
        setProcessingSteps(prev => [...prev, { text: `Error: ${reconciled.errors.join(', ')}`, status: 'error' }]);
        return;
      }
      
      if (!reconciled.dateMatched) {
        const msg = reconciled.errors.length > 0 ? reconciled.errors.join('\n') : 'Stock check date does not match sales sheet date (H9). Please ensure dates match and try again.';
        updateStep(7, 'error');
        setProcessingSteps(prev => [...prev, { text: `Error: Date mismatch - ${msg}`, status: 'error' }]);
        return;
      }
      
      if (reconciled.rows.length === 0) {
        updateStep(7, 'error');
        setProcessingSteps(prev => [...prev, { text: 'Error: No valid sales data found in the uploaded file', status: 'error' }]);
        return;
      }
      setResult(reconciled);
      await saveReconciliationToHistory(reconciled);
      
      let raw: RawConsumptionResult | null = null;
      try {
        raw = await computeRawConsumptionFromSales(base64, stockChecks, products, recipes);
        setRawResult(raw);
        console.log('SalesUpload: Raw consumption computed:', raw?.rows?.length || 0, 'raw materials');
      } catch (e) {
        console.log('SalesUpload: raw compute failed', e);
        setRawResult(null);
      }
      
      if (outlet && date && reconciled.dateMatched) {
        // Check again if reconciliation exists (might have just been created above)
        const existingReconciliation = reconcileHistory.find(
          r => r.outlet === outlet && r.date === date && !r.deleted
        );
        
        if (existingReconciliation) {
          console.log('\n=== RECONCILIATION ALREADY EXISTS - SKIPPING SAVE ===');
          console.log('Existing reconciliation ID:', existingReconciliation.id);
          console.log('Not saving duplicate reconciliation');
          console.log('=== RECONCILIATION ALREADY SAVED ===\n');
        } else {
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
          console.log('\n=== SAVING RECONCILIATION TO STOCKCONTEXT ===');
          console.log('Date:', date);
          console.log('Outlet:', outlet);
          console.log('Sales rows:', reconciled.rows.length);
          console.log('Raw consumption rows:', raw?.rows.length || 0);
          
          if (raw?.rows && raw.rows.length > 0) {
            console.log('Raw consumption data to save:');
            raw.rows.forEach(r => {
              console.log(`  - ${r.rawName} (ID: ${r.rawProductId}): ${r.consumed} ${r.rawUnit}`);
            });
          } else {
            console.log('⚠️ WARNING: No raw consumption data to save!');
            console.log('Live Inventory Sold column for raw materials will NOT be updated');
          }
          
          // CRITICAL FIX: For products with unit conversions, we need to create separate salesData entries
          // for both whole and slices units so that live inventory can find them
          const salesDataArray: Array<{ productId: string; sold: number; opening: number; received: number; closing: number }> = [];
          const stockCheckDataArray: Array<{ productId: string; openingStock: number; receivedStock: number; wastage: number; closingStock: number }> = [];
          
          reconciled.rows.forEach(r => {
            const productId = r.productId || '';
            if (!productId) return;
            
            // Add main product entry
            salesDataArray.push({
              productId: productId,
              sold: r.sold,
              opening: r.opening ?? 0,
              received: r.received ?? 0,
              closing: r.closing ?? 0,
            });
            
            stockCheckDataArray.push({
              productId: productId,
              openingStock: r.opening ?? 0,
              receivedStock: r.received ?? 0,
              wastage: r.wastage ?? 0,
              closingStock: r.closing ?? 0,
            });
            
            // CRITICAL: If this product has splitUnits (unit conversions), add entries for each unit
            // This ensures live inventory can find sold data for both whole and slices units
            if (r.splitUnits && r.splitUnits.length > 0) {
              console.log(`Product has split units (conversions): ${r.name}`);
              
              r.splitUnits.forEach(split => {
                // Find the product for this specific unit
                const product = products.find(p => 
                  p.name.toLowerCase() === r.name.toLowerCase() && 
                  p.unit.toLowerCase() === split.unit.toLowerCase()
                );
                
                if (product && product.id !== productId) {
                  console.log(`  Adding separate entry for unit: ${split.unit} (productId: ${product.id})`);
                  
                  // For split units, the sold value is 0 because the main unit already has the total sold
                  // But we need the stock check data for each unit
                  salesDataArray.push({
                    productId: product.id,
                    sold: 0, // Sold is already counted in the main product
                    opening: split.opening,
                    received: split.received,
                    closing: split.closing,
                  });
                  
                  stockCheckDataArray.push({
                    productId: product.id,
                    openingStock: split.opening,
                    receivedStock: split.received,
                    wastage: split.wastage,
                    closingStock: split.closing,
                  });
                }
              });
            }
          });
          
          console.log('salesData entries created:', salesDataArray.length);
          console.log('Products with data:', salesDataArray.map(sd => {
            const prod = products.find(p => p.id === sd.productId);
            return `${prod?.name} (${prod?.unit}): sold=${sd.sold}`;
          }).join(', '));
          
          const prodsReqUpdates = (reconciled as any).prodsReqUpdatesFromDeductions || [];
          
          const reconcileHistoryEntry = {
            id: `reconcile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date,
            outlet,
            salesData: salesDataArray,
            stockCheckData: stockCheckDataArray,
            rawConsumption: raw?.rows.map(r => ({
              rawProductId: r.rawProductId,
              consumed: r.consumed,
            })) || [],
            prodsReqUpdates: prodsReqUpdates.length > 0 ? prodsReqUpdates : undefined,
            timestamp: Date.now(),
            updatedAt: Date.now(),
          };
          
          console.log('Reconciliation entry to save:', JSON.stringify({
            id: reconcileHistoryEntry.id,
            date: reconcileHistoryEntry.date,
            outlet: reconcileHistoryEntry.outlet,
            rawConsumptionCount: reconcileHistoryEntry.rawConsumption.length,
            rawConsumption: reconcileHistoryEntry.rawConsumption,
            prodsReqUpdatesCount: reconcileHistoryEntry.prodsReqUpdates?.length || 0,
            prodsReqUpdates: reconcileHistoryEntry.prodsReqUpdates
          }, null, 2));
          
          await addReconcileHistory(reconcileHistoryEntry);
          console.log('✓ Saved reconciliation to StockContext for', outlet, date, 'with', raw?.rows.length || 0, 'raw consumption entries');
          
          // NEW SYNC SYSTEM: Save sales report to new reconciliation sync system
          console.log('\n=== SAVING SALES REPORT TO NEW SYNC SYSTEM ===');
          try {
            const existingReports = await getLocalSalesReports();
            const existingReport = existingReports.find(r => r.outlet === outlet && r.date === date && !r.deleted);
            
            // Build sales data array from reconciled rows
            // CRITICAL FIX: For products with unit conversions, create DUPLICATE entries
            // for BOTH whole and slices product IDs with the SAME sold data
            // This ensures live inventory can find the data regardless of which product ID it searches
            const salesDataForReport: Array<{
              productId: string;
              productName: string;
              unit: string;
              soldWhole: number;
              soldSlices: number;
            }> = [];
            
            const processedPairs = new Set<string>();
            
            salesDataArray.forEach(sd => {
              const product = products.find(p => p.id === sd.productId);
              const productPair = product ? getProductPair(product) : null;
              
              let soldWhole = sd.sold;
              let soldSlices = 0;
              
              if (productPair && product) {
                // Skip if we already processed this product pair
                const pairKey = `${productPair.wholeProductId}-${productPair.slicesProductId}`;
                if (processedPairs.has(pairKey)) {
                  return;
                }
                processedPairs.add(pairKey);
                
                const isWholeProduct = product.id === productPair.wholeProductId;
                const conversionFactor = productPair.conversionFactor;
                
                // Convert sold value to whole + slices format
                if (isWholeProduct) {
                  soldWhole = Math.floor(sd.sold);
                  soldSlices = Math.round((sd.sold % 1) * conversionFactor);
                } else {
                  soldWhole = Math.floor(sd.sold / conversionFactor);
                  soldSlices = Math.round(sd.sold % conversionFactor);
                }
                
                // CRITICAL: Create entries for BOTH whole and slices products with SAME sold data
                const wholeProduct = products.find(p => p.id === productPair.wholeProductId);
                const slicesProduct = products.find(p => p.id === productPair.slicesProductId);
                
                if (wholeProduct) {
                  salesDataForReport.push({
                    productId: wholeProduct.id,
                    productName: wholeProduct.name,
                    unit: wholeProduct.unit,
                    soldWhole,
                    soldSlices,
                  });
                  console.log(`Added sales data for WHOLE product: ${wholeProduct.name} -> ${soldWhole}W/${soldSlices}S`);
                }
                
                if (slicesProduct) {
                  salesDataForReport.push({
                    productId: slicesProduct.id,
                    productName: slicesProduct.name,
                    unit: slicesProduct.unit,
                    soldWhole,
                    soldSlices,
                  });
                  console.log(`Added sales data for SLICES product: ${slicesProduct.name} -> ${soldWhole}W/${soldSlices}S`);
                }
              } else {
                // No unit conversion - create single entry
                salesDataForReport.push({
                  productId: sd.productId,
                  productName: product?.name || '',
                  unit: product?.unit || '',
                  soldWhole,
                  soldSlices,
                });
                console.log(`Added sales data for product (no conversion): ${product?.name} -> ${soldWhole}`);
              }
            });
            
            // Build raw consumption array
            // CRITICAL FIX: For raw materials with unit conversions, create entries for BOTH units
            const rawConsumptionForReport: Array<{
              rawProductId: string;
              rawName: string;
              rawUnit: string;
              consumedWhole: number;
              consumedSlices: number;
            }> = [];
            
            const processedRawPairs = new Set<string>();
            
            (raw?.rows || []).forEach(r => {
              const rawProduct = products.find(p => p.id === r.rawProductId);
              const productPair = rawProduct ? getProductPair(rawProduct) : null;
              
              let consumedWhole = r.consumed;
              let consumedSlices = 0;
              
              if (productPair && rawProduct) {
                // Skip if we already processed this product pair
                const pairKey = `${productPair.wholeProductId}-${productPair.slicesProductId}`;
                if (processedRawPairs.has(pairKey)) {
                  return;
                }
                processedRawPairs.add(pairKey);
                
                const isWholeProduct = rawProduct.id === productPair.wholeProductId;
                const conversionFactor = productPair.conversionFactor;
                
                // Convert consumed value to whole + slices format
                if (isWholeProduct) {
                  consumedWhole = Math.floor(r.consumed);
                  consumedSlices = Math.round((r.consumed % 1) * conversionFactor);
                } else {
                  consumedWhole = Math.floor(r.consumed / conversionFactor);
                  consumedSlices = Math.round(r.consumed % conversionFactor);
                }
                
                // CRITICAL: Create entries for BOTH whole and slices products with SAME consumed data
                const wholeProduct = products.find(p => p.id === productPair.wholeProductId);
                const slicesProduct = products.find(p => p.id === productPair.slicesProductId);
                
                if (wholeProduct) {
                  rawConsumptionForReport.push({
                    rawProductId: wholeProduct.id,
                    rawName: wholeProduct.name,
                    rawUnit: wholeProduct.unit,
                    consumedWhole,
                    consumedSlices,
                  });
                  console.log(`Added raw consumption for WHOLE: ${wholeProduct.name} -> ${consumedWhole}W/${consumedSlices}S`);
                }
                
                if (slicesProduct) {
                  rawConsumptionForReport.push({
                    rawProductId: slicesProduct.id,
                    rawName: slicesProduct.name,
                    rawUnit: slicesProduct.unit,
                    consumedWhole,
                    consumedSlices,
                  });
                  console.log(`Added raw consumption for SLICES: ${slicesProduct.name} -> ${consumedWhole}W/${consumedSlices}S`);
                }
              } else {
                // No unit conversion - create single entry
                rawConsumptionForReport.push({
                  rawProductId: r.rawProductId,
                  rawName: r.rawName,
                  rawUnit: r.rawUnit,
                  consumedWhole,
                  consumedSlices,
                });
                console.log(`Added raw consumption (no conversion): ${r.rawName} -> ${consumedWhole}`);
              }
            });
            
            const now = Date.now();
            const reconsolidatedAt = new Date().toLocaleString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }).replace(',', '');
            
            let hasChanges = true;
            
            if (existingReport) {
              console.log('Existing sales report found, checking for changes...');
              hasChanges = 
                JSON.stringify(existingReport.salesData) !== JSON.stringify(salesDataForReport) ||
                JSON.stringify(existingReport.rawConsumption) !== JSON.stringify(rawConsumptionForReport);
              
              if (!hasChanges) {
                console.log('No changes detected, skipping sales report save');
              }
            }
            
            if (hasChanges) {
              const salesReport: SalesReport = {
                id: existingReport?.id || `sales-${now}-${Math.random().toString(36).substr(2, 9)}`,
                outlet,
                date,
                timestamp: now,
                reconsolidatedAt,
                salesData: salesDataForReport,
                rawConsumption: rawConsumptionForReport,
                updatedAt: now,
              };
              
              // Save locally
              await saveSalesReportLocally(salesReport);
              console.log('✓ Sales report saved locally');
              
              // Push to server immediately
              console.log('Pushing sales report to server...');
              const serverSaved = await saveSalesReportToServer(salesReport);
              
              if (serverSaved) {
                console.log('✓ Sales report synced to server');
                setProcessingSteps(prev => [...prev, { text: '✓ Sales report saved and synced', status: 'complete' }]);
              } else {
                console.log('⚠️ Failed to sync sales report to server, will retry later');
                setProcessingSteps(prev => [...prev, { text: '⚠️ Sales report saved locally only', status: 'error' }]);
              }
            }
          } catch (reportError) {
            console.error('Failed to save sales report:', reportError);
            setProcessingSteps(prev => [...prev, { text: 'Warning: Failed to save sales report', status: 'error' }]);
          }
          console.log('=== SALES REPORT SAVE COMPLETE ===\n');
          
          // CRITICAL FIX: Trigger immediate sync and AWAIT it so reconciliation is on server BEFORE user can navigate away
          console.log('\n=== SYNCING RECONCILIATION TO SERVER (IMMEDIATE) ===');
          console.log('Triggering immediate sync to share reconciliation with other devices...');
          console.log('⚠️ This sync must complete BEFORE any background sync to prevent data conflicts');
          
          try {
            // CRITICAL: First sync the NEW reconciliation system (sales reports)
            // This must happen BEFORE StockContext sync to ensure fresh data is on server
            console.log('Step 1: Syncing NEW reconciliation system (sales reports)...');
            await syncAllReconciliationData();
            console.log('✓ Sales reports synced to server');
            
            // Small delay to ensure server processes the sales report
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Now sync StockContext data
            console.log('Step 2: Syncing StockContext data...');
            await syncAll(false); // Use manual sync (not silent) to ensure it completes
            console.log('✓ StockContext synced to server successfully');
            console.log('✓ Other devices will receive it on their next sync');
          } catch (syncError) {
            console.error('❌ Failed to sync reconciliation to server:', syncError);
            console.error('Reconciliation is saved locally but may not be available on other devices');
            Alert.alert('Sync Warning', 'Reconciliation saved locally but could not sync to server. Other devices may not see this data.');
          }
          console.log('=== RECONCILIATION SAVE COMPLETE ===\n');
        } catch (error) {
          console.error('Failed to save reconciliation to StockContext:', error);
        }
        }
      }
      
      updateStep(7, 'complete');
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
      console.log('handleDeleteAllHistory: Deleting local reconciliation history (UI view)');
      setReconciliationHistory([]);
      await AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify([]));
      setShowDeleteAllConfirm(false);
      Alert.alert('Success', 'All reconciliation history deleted successfully from this view.');
    } catch (error) {
      console.error('Failed to delete all reconciliation history:', error);
      Alert.alert('Error', 'Failed to delete all reconciliation history.');
    }
  }, []);

  const handleDeleteAllReconciliationData = useCallback(async () => {
    try {
      setIsDeletingAllReconcile(true);
      console.log('\n=== DELETE ALL RECONCILIATION DATA START ===');
      console.log('This will delete ALL reconciliation data:');
      console.log('  1. Local reconciliation history (UI view)');
      console.log('  2. StockContext reconcileHistory (synced to server)');
      console.log('  3. Server reconciliation data');
      console.log('  4. Prevent sync from other devices');
      
      // Step 1: Clear local reconciliation history (UI view)
      console.log('Step 1: Clearing local reconciliation history...');
      setReconciliationHistory([]);
      await AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify([]));
      console.log('✓ Local reconciliation history cleared');
      
      // Step 2: Clear StockContext reconcileHistory and sync deletion to server
      console.log('Step 2: Clearing StockContext reconcileHistory and syncing to server...');
      await clearAllReconcileHistory();
      console.log('✓ StockContext reconcileHistory cleared and synced to server');
      
      // Step 3: Trigger immediate full sync to ensure deletions are on server
      console.log('Step 3: Triggering immediate full sync to persist deletions...');
      try {
        await syncAll(false); // Manual sync to ensure it completes
        console.log('✓ Full sync complete - reconciliation deletions are on server');
      } catch (syncError) {
        console.error('❌ Sync failed:', syncError);
        console.log('Reconciliation data deleted locally but may not be synced to server');
      }
      
      setShowDeleteAllReconcileConfirm(false);
      console.log('=== DELETE ALL RECONCILIATION DATA COMPLETE ===\n');
      Alert.alert(
        'Success',
        'All reconciliation data has been deleted locally and from the server. Other devices will sync this deletion on their next sync cycle.'
      );
    } catch (error) {
      console.error('Failed to delete all reconciliation data:', error);
      Alert.alert(
        'Error',
        `Failed to delete all reconciliation data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsDeletingAllReconcile(false);
    }
  }, [clearAllReconcileHistory, syncAll]);

  const handleClearReconciliationData = useCallback(async () => {
    if (!clearDateInput.trim()) {
      Alert.alert('Error', 'Please enter a date');
      return;
    }

    try {
      setIsClearing(true);
      console.log('\n=== CLEAR RECONCILIATION DATA BY DATE START ===');
      console.log('Clearing reconciliation data for date:', clearDateInput);

      // STEP 1: Clear local reconciliation history (UI view)
      console.log('Step 1: Clearing local reconciliation history...');
      const updatedHistory = reconciliationHistory.filter(h => h.date !== clearDateInput);
      await AsyncStorage.setItem(RECONCILIATION_HISTORY_KEY, JSON.stringify(updatedHistory));
      setReconciliationHistory(updatedHistory);
      console.log('✓ Local reconciliation history cleared');

      // STEP 2: Mark reconciliation entries for this date as deleted in StockContext
      console.log('Step 2: Marking reconciliation entries as deleted in StockContext...');
      const reconcileToDelete = reconcileHistory.filter(h => h.date === clearDateInput);
      console.log(`Found ${reconcileToDelete.length} reconciliation entries to delete for ${clearDateInput}`);
      
      for (const entry of reconcileToDelete) {
        try {
          await deleteReconcileHistory(entry.id);
          console.log(`✓ Marked reconciliation entry ${entry.id} as deleted`);
        } catch (err) {
          console.error(`Failed to delete reconciliation entry ${entry.id}:`, err);
        }
      }

      // STEP 3: Restore inventory and mark sales deductions as deleted
      console.log('Step 3: Restoring inventory and marking sales deductions as deleted...');
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

      // Mark sales deductions as deleted (not removed) so they sync to server
      const updatedDeductions = salesDeductions.map(d => 
        d.salesDate === clearDateInput 
          ? { ...d, deleted: true as const, updatedAt: Date.now() }
          : d
      );
      await AsyncStorage.setItem('@stock_app_sales_deductions', JSON.stringify(updatedDeductions));
      console.log('✓ Marked sales deductions as deleted');

      const updatedInventory = [...inventoryStocks];
      await AsyncStorage.setItem('@stock_app_inventory_stocks', JSON.stringify(updatedInventory));
      console.log('✓ Restored inventory');

      // STEP 4: Sync deletions to server
      console.log('Step 4: Syncing deletions to server...');
      try {
        await syncAll(false);
        console.log('✓ Deletions synced to server successfully');
      } catch (syncError) {
        console.error('Failed to sync deletions to server:', syncError);
        console.log('Data deleted locally but may not sync to server');
      }
      console.log('=== CLEAR RECONCILIATION DATA BY DATE COMPLETE ===\n');

      setShowClearDataModal(false);
      setClearDateInput('');
      Alert.alert(
        'Success', 
        `Reconciliation data for ${clearDateInput} has been cleared and synced to server. Other devices will sync this deletion on their next sync cycle.`
      );
    } catch (error) {
      console.error('Failed to clear reconciliation data:', error);
      Alert.alert('Error', `Failed to clear reconciliation data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsClearing(false);
    }
  }, [clearDateInput, reconciliationHistory, salesDeductions, products, inventoryStocks, productConversions, reconcileHistory, deleteReconcileHistory, syncAll]);

  const discrepanciesCount = useMemo(() => {
    if (!result) return 0;
    return result.rows.filter((r) => (r.discrepancy ?? 0) !== 0).length;
  }, [result]);

  const pickKitchenFile = useCallback(async () => {
    try {
      console.log('\n=== KITCHEN RECONCILIATION START ===');
      console.log('BLOCKING background syncs to prevent data conflicts...');
      
      // CRITICAL: Block background syncs to prevent data conflicts
      // This prevents background sync from pulling old server data and overriding our Prods.Req updates
      const syncInProgressRef = (stockContext as any).syncInProgressRef;
      if (syncInProgressRef) {
        syncInProgressRef.current = true;
        console.log('✓ Background syncs BLOCKED');
      }
      
      setIsPickingKitchen(true);
      setKitchenResult(null);
      setShowProcessingModal(true);
      
      const steps = [
        { text: 'Selecting Excel file...', status: 'active' as const },
        { text: 'Reading file contents...', status: 'pending' as const },
        { text: 'Syncing latest data from server...', status: 'pending' as const },
        { text: 'Parsing kitchen production data...', status: 'pending' as const },
        { text: 'Matching with stock checks...', status: 'pending' as const },
        { text: 'Checking for existing reconciliation...', status: 'pending' as const },
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
      
      // CRITICAL FIX: Sync BEFORE reconciliation to get latest kitchen stock reports AND inventory from server
      updateStep(2, 'active');
      console.log('\n=== SYNCING BEFORE KITCHEN RECONCILIATION ===');
      console.log('Pulling latest data from server (kitchen reports + inventory)...');
      try {
        await syncAllReconciliationData();
        console.log('✓ Reconciliation sync complete');
        await syncAll(true);
        console.log('✓ StockContext sync complete - inventory and kitchen reports are fresh');
      } catch (syncError) {
        console.error('Sync failed, proceeding with cached data:', syncError);
      }
      updateStep(2, 'complete');
      
      updateStep(3, 'active');
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
      updateStep(3, 'complete');
      
      updateStep(4, 'active');
      const reconciled = reconcileKitchenStockFromExcelBase64(base64, stockChecks, products, { manualStockByProductId: manualStockMap });
      console.log('KitchenStock: reconciled', reconciled);
      updateStep(4, 'complete');
      
      // CRITICAL FIX: Check if kitchen stock report already exists on server
      updateStep(5, 'active');
      const outletName = reconciled.outletName;
      const date = reconciled.stockCheckDate;
      let existingServerReport: any = null;
      
      if (outletName && date) {
        console.log('\n=== CHECKING FOR EXISTING KITCHEN STOCK REPORT ===');
        console.log('Outlet:', outletName, 'Date:', date);
        
        try {
          const existingReports = await getLocalKitchenStockReports();
          existingServerReport = existingReports.find(r => r.outlet === outletName && r.date === date && !r.deleted);
          
          if (existingServerReport) {
            console.log('✓ FOUND EXISTING KITCHEN STOCK REPORT - Will apply Prods.Req from server');
            console.log('  Report ID:', existingServerReport.id);
            console.log('  Timestamp:', new Date(existingServerReport.timestamp).toISOString());
            console.log('  Products:', existingServerReport.products?.length || 0);
            console.log('=== WILL APPLY PRODS.REQ FROM SERVER DATA ===\n');
          } else {
            console.log('✗ NO EXISTING REPORT FOUND - This is first reconciliation');
            console.log('=== WILL UPDATE PRODS.REQ WITH NEW DATA ===\n');
          }
        } catch (error) {
          console.error('Failed to check for existing reports:', error);
        }
      }
      updateStep(5, 'complete');
      
      updateStep(6, 'active');
      
      if (!reconciled.matched) {
        const msg = reconciled.errors.length > 0 ? reconciled.errors.join('\n') : 'No matching stock check found';
        updateStep(6, 'error');
        setProcessingSteps(prev => [...prev, { text: `Error: ${msg}`, status: 'error' }]);
        setKitchenResult(null);
        return;
      }
      
      setKitchenResult(reconciled);
      updateStep(6, 'complete');
      
      // Save kitchen stock report and update Prods.Req
      
      if (outletName && date) {
        console.log('\n=== SAVING KITCHEN STOCK REPORT ===');
        console.log('Outlet:', outletName);
        console.log('Date:', date);
        console.log('Items:', reconciled.discrepancies.length);
        
        try {
          // Use the existing report we already found (from server sync)
          const existingReport = existingServerReport;
          
          // Build products array from discrepancies
          const reportProductsRaw = reconciled.discrepancies.map(d => {
            const product = products.find((p: Product) => p.name === d.productName && p.unit === d.unit);
            
            if (!product) {
              console.log(`⚠️ Product not found for kitchen report: ${d.productName} (${d.unit})`);
              return null;
            }
            
            const productConversion = getProductPair(product);
            
            let quantityWhole = d.kitchenProduction;
            let quantitySlices = 0;
            let productIdToStore = product.id;
            
            // CRITICAL FIX: If product has conversions, ALWAYS use the WHOLE product ID
            // This ensures live inventory can find the data when searching with pair.wholeId
            if (productConversion) {
              productIdToStore = productConversion.wholeProductId;
              const isWholeProduct = product.id === productConversion.wholeProductId;
              const conversionFactor = productConversion.conversionFactor;
              
              if (isWholeProduct) {
                quantityWhole = Math.floor(d.kitchenProduction);
                quantitySlices = Math.round((d.kitchenProduction % 1) * conversionFactor);
              } else {
                // Product is in slices unit, convert to whole + slices
                quantityWhole = Math.floor(d.kitchenProduction / conversionFactor);
                quantitySlices = Math.round(d.kitchenProduction % conversionFactor);
              }
            }
            
            console.log(`Kitchen report product: ${d.productName} (${d.unit}) - Storing with wholeId=${productIdToStore} - ${quantityWhole}W + ${quantitySlices}S`);
            
            return {
              productId: productIdToStore,
              productName: d.productName,
              unit: d.unit,
              quantityWhole,
              quantitySlices,
            };
          }).filter(p => p !== null) as Array<{
            productId: string;
            productName: string;
            unit: string;
            quantityWhole: number;
            quantitySlices: number;
          }>;
          
          // CRITICAL FIX: Merge products with same productId (wholeId)
          // This handles cases where Excel has both "Cake (whole)" and "Cake (slices)" in Kitchen Production rows
          // They should be combined into a single entry
          console.log('\n=== MERGING PRODUCTS WITH SAME WHOLE ID ===');
          const productMap = new Map<string, {
            productId: string;
            productName: string;
            unit: string;
            quantityWhole: number;
            quantitySlices: number;
          }>();
          
          reportProductsRaw.forEach(p => {
            const existing = productMap.get(p.productId);
            
            if (existing) {
              console.log(`Merging duplicate entry for ${p.productName}:`);
              console.log(`  Existing: ${existing.quantityWhole}W + ${existing.quantitySlices}S`);
              console.log(`  Adding: ${p.quantityWhole}W + ${p.quantitySlices}S`);
              
              // Combine quantities
              let totalWhole = existing.quantityWhole + p.quantityWhole;
              let totalSlices = existing.quantitySlices + p.quantitySlices;
              
              // Normalize slices to whole if needed
              const productConversion = productConversions.find(c => 
                c.fromProductId === p.productId || c.toProductId === p.productId
              );
              
              if (productConversion) {
                const factor = productConversion.conversionFactor;
                if (totalSlices >= factor) {
                  const extraWhole = Math.floor(totalSlices / factor);
                  totalWhole += extraWhole;
                  totalSlices = Math.round(totalSlices % factor);
                }
              }
              
              console.log(`  Result: ${totalWhole}W + ${totalSlices}S`);
              
              productMap.set(p.productId, {
                ...existing,
                quantityWhole: totalWhole,
                quantitySlices: totalSlices,
              });
            } else {
              productMap.set(p.productId, p);
            }
          });
          
          const reportProducts = Array.from(productMap.values());
          console.log(`Final report products: ${reportProducts.length} (merged from ${reportProductsRaw.length} raw entries)`);
          console.log('=== MERGE COMPLETE ===\n');
          
          const now = Date.now();
          const reconsolidatedAt = new Date().toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).replace(',', '');
          
          let hasChanges = true;
          
          if (existingReport) {
            console.log('Existing report found, checking for changes...');
            hasChanges = JSON.stringify(existingReport.products) !== JSON.stringify(reportProducts);
            
            if (!hasChanges) {
              console.log('No changes detected, skipping report save');
            }
          }
          
          if (hasChanges) {
            const report: KitchenStockReport = {
              id: existingReport?.id || `kitchen-${now}-${Math.random().toString(36).substr(2, 9)}`,
              outlet: outletName,
              date,
              timestamp: now,
              reconsolidatedAt,
              products: reportProducts,
              updatedAt: now,
            };
            
            // Save locally
            await saveKitchenStockReportLocally(report);
            console.log('✓ Kitchen stock report saved locally');
            
            // Push to server immediately
            console.log('Pushing kitchen stock report to server...');
            const serverSaved = await saveKitchenStockReportToServer(report);
            
            if (serverSaved) {
              console.log('✓ Kitchen stock report synced to server');
            } else {
              console.log('⚠️ Failed to sync to server, will retry later');
            }
            
            setProcessingSteps(prev => [...prev, { text: '✓ Kitchen stock report saved and synced', status: 'complete' }]);
            
            // Update Prods.Req in inventory
            console.log('\n=== UPDATING PRODS.REQ IN INVENTORY ===');
            setProcessingSteps(prev => [...prev, { text: 'Updating Prods.Req in inventory...', status: 'active' }]);
            
            try {
              // CRITICAL: Read FRESH inventory from AsyncStorage to prevent stale state issues
              console.log('Reading FRESH inventory from AsyncStorage...');
              const freshInventoryData = await AsyncStorage.getItem('@stock_app_inventory_stocks');
              let freshInventory: InventoryStock[] = [];
              
              if (freshInventoryData) {
                try {
                  freshInventory = JSON.parse(freshInventoryData).filter((i: any) => !i?.deleted);
                  console.log('✓ Loaded', freshInventory.length, 'inventory items from AsyncStorage');
                } catch (parseError) {
                  console.error('Failed to parse fresh inventory:', parseError);
                  freshInventory = [...inventoryStocks];
                }
              } else {
                console.log('No inventory data in AsyncStorage, using state');
                freshInventory = [...inventoryStocks];
              }
              
              const inventoryUpdates: Array<{ productId: string; updates: Partial<InventoryStock> }> = [];
              
              for (const reportProduct of reportProducts) {
                if (!reportProduct.productId) continue;
                
                const product = products.find(p => p.id === reportProduct.productId);
                if (!product) continue;
                
                const invStock = freshInventory.find(s => s.productId === reportProduct.productId);
                if (!invStock) {
                  console.log(`No inventory stock found for ${reportProduct.productName}, skipping`);
                  continue;
                }
                
                // Check if we already updated this product for this date
                const previousReport = existingReport;
                let shouldUpdate = true;
                let qtyToAdd = reportProduct.quantityWhole;
                let slicesToAdd = reportProduct.quantitySlices;
                
                if (previousReport) {
                  // Find the previous quantity for this product
                  const prevProduct = previousReport.products.find((p: any) => p.productId === reportProduct.productId);
                  
                  if (prevProduct) {
                    const quantitiesChanged = 
                      prevProduct.quantityWhole !== reportProduct.quantityWhole ||
                      prevProduct.quantitySlices !== reportProduct.quantitySlices;
                    
                    if (!quantitiesChanged) {
                      console.log(`Quantities unchanged for ${reportProduct.productName}, skipping inventory update`);
                      shouldUpdate = false;
                    } else {
                      // Calculate the difference
                      const wholeDiff = reportProduct.quantityWhole - prevProduct.quantityWhole;
                      const slicesDiff = reportProduct.quantitySlices - prevProduct.quantitySlices;
                      
                      console.log(`Quantities changed for ${reportProduct.productName}:`);
                      console.log(`  Previous: ${prevProduct.quantityWhole}W + ${prevProduct.quantitySlices}S`);
                      console.log(`  New: ${reportProduct.quantityWhole}W + ${reportProduct.quantitySlices}S`);
                      console.log(`  Difference: ${wholeDiff}W + ${slicesDiff}S`);
                      
                      qtyToAdd = wholeDiff;
                      slicesToAdd = slicesDiff;
                    }
                  }
                }
                
                if (shouldUpdate) {
                  const currentProdsReqWhole = invStock.prodsReqWhole || 0;
                  const currentProdsReqSlices = invStock.prodsReqSlices || 0;
                  
                  const newProdsReqWhole = currentProdsReqWhole + qtyToAdd;
                  const newProdsReqSlices = currentProdsReqSlices + slicesToAdd;
                  
                  console.log(`Updating Prods.Req for ${reportProduct.productName}:`);
                  console.log(`  Current: ${currentProdsReqWhole}W + ${currentProdsReqSlices}S`);
                  console.log(`  Adding: ${qtyToAdd}W + ${slicesToAdd}S`);
                  console.log(`  New: ${newProdsReqWhole}W + ${newProdsReqSlices}S`);
                  
                  inventoryUpdates.push({
                    productId: reportProduct.productId,
                    updates: {
                      prodsReqWhole: newProdsReqWhole,
                      prodsReqSlices: newProdsReqSlices,
                    }
                  });
                }
              }
              
              // Apply all inventory updates
              if (inventoryUpdates.length > 0) {
                console.log(`Applying ${inventoryUpdates.length} inventory updates...`);
                
                // CRITICAL: Update inventory stocks in AsyncStorage directly to ensure persistence
                console.log('Reading current inventory from AsyncStorage for atomic update...');
                const currentInventoryData = await AsyncStorage.getItem('@stock_app_inventory_stocks');
                let currentInventory: InventoryStock[] = [];
                
                if (currentInventoryData) {
                  currentInventory = JSON.parse(currentInventoryData).filter((i: any) => !i?.deleted);
                }
                
                // Apply updates to fresh inventory data
                const updatedInventory = currentInventory.map((inv: InventoryStock) => {
                  const update = inventoryUpdates.find((u: { productId: string; updates: Partial<InventoryStock> }) => u.productId === inv.productId);
                  if (update) {
                    console.log(`Applying update to ${inv.productId}: prodsReqWhole=${update.updates.prodsReqWhole}, prodsReqSlices=${update.updates.prodsReqSlices}`);
                    return {
                      ...inv,
                      ...update.updates,
                      updatedAt: Date.now(),
                    };
                  }
                  return inv;
                });
                
                // Save updated inventory to AsyncStorage FIRST
                console.log('Saving updated inventory to AsyncStorage...');
                await AsyncStorage.setItem('@stock_app_inventory_stocks', JSON.stringify(updatedInventory));
                console.log('✓ Inventory saved to AsyncStorage');
                
                // Then call updateInventoryStock to update state and trigger sync
                for (const update of inventoryUpdates) {
                  await updateInventoryStock(update.productId, update.updates);
                }
                console.log('✓ All inventory updates applied to state');
                
                // CRITICAL: Immediately sync to server to prevent old data from overriding
                console.log('\n=== SYNCING PRODS.REQ UPDATES TO SERVER (IMMEDIATE) ===');
                console.log('⚠️ This sync must complete to share Prods.Req with other devices');
                console.log('⚠️ This includes both kitchen stock reports AND inventory Prods.Req values');
                try {
                  // First sync the kitchen stock reports
                  await syncAllReconciliationData();
                  console.log('✓ Kitchen stock reports synced to server');
                  
                  // Then sync inventory stocks with updated Prods.Req values
                  await syncAll(false);
                  console.log('✓ Inventory Prods.Req updates synced to server successfully');
                  console.log('✓ Other devices will see Prods.Req updates on their next sync');
                  console.log('✓ Live Inventory will display updated Prods.Req values');
                } catch (syncError) {
                  console.error('❌ Failed to sync Prods.Req updates to server:', syncError);
                  Alert.alert('Sync Warning', 'Prods.Req updated locally but could not sync to server. Other devices may not see these updates.');
                }
                console.log('=== SYNC COMPLETE ===\n');
                
                setProcessingSteps(prev => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (updated[lastIndex]?.text.includes('Updating Prods.Req')) {
                    updated[lastIndex] = { text: `✓ Updated Prods.Req for ${inventoryUpdates.length} products`, status: 'complete' };
                  }
                  return updated;
                });
              } else {
                console.log('No inventory updates needed');
                setProcessingSteps(prev => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (updated[lastIndex]?.text.includes('Updating Prods.Req')) {
                    updated[lastIndex] = { text: 'No inventory updates needed', status: 'complete' };
                  }
                  return updated;
                });
              }
              
              console.log('=== PRODS.REQ UPDATE COMPLETE ===\n');
            } catch (error) {
              console.error('Failed to update Prods.Req in inventory:', error);
              setProcessingSteps(prev => [...prev, { text: 'Warning: Failed to update inventory', status: 'error' }]);
            }
          }
        } catch (error) {
          console.error('Failed to save kitchen stock report:', error);
          setProcessingSteps(prev => [...prev, { text: 'Warning: Failed to save report', status: 'error' }]);
        }
        
        console.log('=== KITCHEN STOCK REPORT SAVE COMPLETE ===\n');
      }
      
      setProcessingSteps(prev => [...prev, { text: `✓ Successfully processed ${reconciled.discrepancies.length} items`, status: 'complete' }]);
      
      if (reconciled.errors.length > 0) {
        setProcessingSteps(prev => [...prev, { text: `Note: ${reconciled.errors.join(', ')}`, status: 'error' }]);
      }
      
      console.log('=== KITCHEN RECONCILIATION COMPLETE ===\n');
    } catch (e) {
      console.error('KitchenStock: pick error', e);
      setProcessingSteps(prev => [...prev, { text: `Fatal Error: ${e instanceof Error ? e.message : 'Failed to load file'}`, status: 'error' }]);
    } finally {
      setIsPickingKitchen(false);
      
      // CRITICAL: Re-enable background syncs after kitchen reconciliation is complete
      console.log('RESUMING background syncs...');
      const syncInProgressRef = (stockContext as any).syncInProgressRef;
      if (syncInProgressRef) {
        syncInProgressRef.current = false;
        console.log('✓ Background syncs RESUMED');
      }
    }
  }, [stockChecks, products, kitchenManualMode, manualStockBase64, updateStep, productConversions, inventoryStocks, updateInventoryStock, getProductPair, syncAll, stockContext]);

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
            <Text style={[styles.cardTitle, { color: '#FF9F0A' }]}>Super Admin: Reconciliation Management</Text>
          </View>
          <Text style={styles.cardDesc}>Manage reconciliation data. Clear data for a specific date or delete all reconciliation data from local storage and server.</Text>
          
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#FF9F0A', marginBottom: 12 }]}
            onPress={() => setShowClearDataModal(true)}
          >
            <View style={styles.btnInner}>
              <Calendar color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Clear Data by Date</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#f44336' }]}
            onPress={() => setShowDeleteAllReconcileConfirm(true)}
          >
            <View style={styles.btnInner}>
              <Trash2 color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Delete All Reconciliation Data</Text>
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
        <Text style={styles.cardDesc}>Upload kitchen production Excel. The parser now supports both formats: (1) `Discrepancies` sheet where Kitchen Production is read from the Kitchen Production column (typically column E), and (2) legacy layout using outlet name in row 9 with products in C and units in E. Production date/outlet are read from B7/D5 or summary rows.</Text>
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
            <TouchableOpacity 
              style={styles.dateInputContainer}
              onPress={() => setShowClearDateCalendar(true)}
            >
              <CalendarDays size={20} color={Colors.light.tint} />
              <Text style={[styles.dateInput, !clearDateInput && { color: Colors.light.tabIconDefault }]}>
                {clearDateInput || 'Select date...'}
              </Text>
            </TouchableOpacity>
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

      <CalendarModal
        visible={showClearDateCalendar}
        initialDate={clearDateInput}
        onClose={() => setShowClearDateCalendar(false)}
        onSelect={(iso) => {
          setClearDateInput(iso);
          setShowClearDateCalendar(false);
        }}
        testID="calendar-clear-reconciliation"
      />

      <Modal
        visible={showDeleteAllReconcileConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteAllReconcileConfirm(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalContent}>
            <View style={styles.clearDataModalHeader}>
              <Trash2 size={32} color="#f44336" />
              <Text style={styles.confirmModalTitle}>Delete All Reconciliation Data?</Text>
            </View>
            <Text style={styles.confirmModalMessage}>
              This will permanently delete ALL reconciliation data:
              {`\n`}• Local reconciliation history (this device)
              {`\n`}• Server reconciliation data
              {`\n`}• Prevents sync from other devices
              {`\n`}{`\n`}This action cannot be undone. Are you absolutely sure?
            </Text>
            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonCancel]}
                onPress={() => setShowDeleteAllReconcileConfirm(false)}
                disabled={isDeletingAllReconcile}
              >
                <Text style={styles.confirmModalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalButtonDelete]}
                onPress={handleDeleteAllReconciliationData}
                disabled={isDeletingAllReconcile}
              >
                {isDeletingAllReconcile ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmModalButtonTextDelete}>Delete All</Text>
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
