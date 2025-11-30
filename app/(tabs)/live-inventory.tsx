import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform, TextInput, Alert } from 'react-native';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { StockCount, StockCheck } from '@/types';
import { Stack } from 'expo-router';
import { Calendar, Download, ChevronLeft, ChevronRight, TrendingUp, AlertTriangle } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useProduction } from '@/contexts/ProductionContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useStores } from '@/contexts/StoresContext';
import { CalendarModal } from '@/components/CalendarModal';
import Colors from '@/constants/colors';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

type DailyInventoryRecord = {
  date: string;
  openingWhole: number;
  openingSlices: number;
  receivedWhole: number;
  receivedSlices: number;
  wastageWhole: number;
  wastageSlices: number;
  soldWhole: number;
  soldSlices: number;
  currentWhole: number;
  currentSlices: number;
  discrepancyWhole: number;
  discrepancySlices: number;
  manuallyEditedDate?: string;
  replaceInventoryDate?: string;
};

type ProductInventoryHistory = {
  productId: string;
  productName: string;
  unit: string;
  outlet: string;
  records: DailyInventoryRecord[];
};

function LiveInventoryScreen() {
  const { products, outlets, stockChecks, salesDeductions, productConversions, requests, updateStockCheck, saveStockCheck, syncAll } = useStock();
  const { approvedProductions } = useProduction();
  const { recipes } = useRecipes();
  const { storeProducts } = useStores();
  const [selectedOutlet, setSelectedOutlet] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showOutletModal, setShowOutletModal] = useState<boolean>(false);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [dateRange, setDateRange] = useState<'week' | 'month'>('week');
  const [editingCell, setEditingCell] = useState<{productId: string; date: string; field: 'currentWhole' | 'currentSlices'} | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const editInputRef = useRef<TextInput>(null);

  const getDateRange = useCallback((endDate: string, rangeType: 'week' | 'month'): string[] => {
    const end = new Date(endDate);
    const dates: string[] = [];
    const daysBack = rangeType === 'week' ? 7 : 30;
    
    for (let i = daysBack - 1; i >= 0; i--) {
      const date = new Date(end);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().split('T')[0]);
    }
    
    return dates;
  }, []);

  const productInventoryHistory = useMemo((): ProductInventoryHistory[] => {
    console.log('[LIVE INVENTORY] Recalculating inventory history at', new Date().toISOString());
    if (!selectedOutlet) return [];

    const dates = getDateRange(selectedDate, dateRange);
    const outlet = outlets.find(o => o.name === selectedOutlet);
    if (!outlet) return [];

    // Check if this is a production outlet
    const isProductionOutlet = outlet.outletType === 'production';

    console.log('\n========================================');
    console.log('=== LIVE INVENTORY CALCULATION (REBUILT) ===');
    console.log('========================================');
    console.log('Outlet:', selectedOutlet, '| Type:', outlet.outletType);
    console.log('Date Range:', dates[0], 'to', dates[dates.length - 1]);
    console.log('Total Stock Checks:', stockChecks.length);
    console.log('Total Sales Deductions:', salesDeductions.length);
    console.log('Total Requests:', requests.length);
    console.log('========================================\n');

    const history: ProductInventoryHistory[] = [];
    const processedProducts = new Set<string>();

    // Separate products into two groups
    const productsWithConversions = new Set<string>();
    productConversions.forEach(c => {
      productsWithConversions.add(c.fromProductId);
      productsWithConversions.add(c.toProductId);
    });

    // Group 1: Products WITH unit conversions (General Inventory)
    const conversionPairs: Array<{ wholeId: string; slicesId: string; factor: number }> = [];
    productConversions.forEach(c => {
      if (!conversionPairs.some(p => p.wholeId === c.fromProductId)) {
        conversionPairs.push({
          wholeId: c.fromProductId,
          slicesId: c.toProductId,
          factor: c.conversionFactor,
        });
      }
    });

    conversionPairs.forEach(pair => {
      const wholeProduct = products.find(p => p.id === pair.wholeId);
      if (!wholeProduct || processedProducts.has(pair.wholeId)) return;

      processedProducts.add(pair.wholeId);
      processedProducts.add(pair.slicesId);

      const records: DailyInventoryRecord[] = [];

      dates.forEach(date => {
        // STEP 1: Opening = Current day's LATEST USER STOCK CHECK openingStock field (if set)
        // This is set by manual stock checks on the SELECTED DATE
        const todayChecksForOpening = stockChecks
          .filter(c => c.date === date && c.outlet === selectedOutlet && c.completedBy !== 'AUTO')
          .sort((a, b) => b.timestamp - a.timestamp);
        
        let openingWhole = 0;
        let openingSlices = 0;

        if (todayChecksForOpening.length > 0) {
          const latestTodayCheck = todayChecksForOpening[0];
          const wholeCount = latestTodayCheck.counts.find(c => c.productId === pair.wholeId);
          const slicesCount = latestTodayCheck.counts.find(c => c.productId === pair.slicesId);
          
          // Use openingStock if it's set (from stock check submission on THIS date)
          if (wholeCount && wholeCount.openingStock !== undefined) {
            openingWhole = wholeCount.openingStock;
          }
          
          if (slicesCount && slicesCount.openingStock !== undefined) {
            openingSlices = slicesCount.openingStock;
          }
        }

        // STEP 2: Received calculation depends on outlet type
        let receivedWhole = 0;
        let receivedSlices = 0;

        if (isProductionOutlet) {
          // For production outlets: Show approved production requests (Prods.Req)
          const approvedProds = approvedProductions.filter(
            ap => ap.approvalDate === date
          );

          approvedProds.forEach(ap => {
            if (ap.items && Array.isArray(ap.items)) {
              ap.items.forEach(item => {
                if (item.productId === pair.wholeId) {
                  const whole = Math.floor(item.requestedQuantity);
                  const slices = Math.round((item.requestedQuantity % 1) * pair.factor);
                  receivedWhole += whole;
                  receivedSlices += slices;
                } else if (item.productId === pair.slicesId) {
                  const totalSlices = Math.round(item.requestedQuantity);
                  receivedWhole += Math.floor(totalSlices / pair.factor);
                  receivedSlices += Math.round(totalSlices % pair.factor);
                }
              });
            }
          });
        } else {
          // For sales outlets: Show approved requests TO this outlet
          const receivedRequests = requests.filter(
            r => r.status === 'approved' && 
                 r.toOutlet === selectedOutlet && 
                 r.requestDate === date
          );

          receivedRequests.forEach(req => {
            if (req.productId === pair.wholeId) {
              const whole = Math.floor(req.quantity);
              const slices = Math.round((req.quantity % 1) * pair.factor);
              receivedWhole += whole;
              receivedSlices += slices;
            } else if (req.productId === pair.slicesId) {
              const totalSlices = Math.round(req.quantity);
              receivedWhole += Math.floor(totalSlices / pair.factor);
              receivedSlices += Math.round(totalSlices % pair.factor);
            }
          });
        }

        // Normalize received
        if (receivedSlices >= pair.factor) {
          const extraWhole = Math.floor(receivedSlices / pair.factor);
          receivedWhole += extraWhole;
          receivedSlices = Math.round(receivedSlices % pair.factor);
        }

        // STEP 3: Wastage from TODAY's LATEST USER STOCK CHECK
        let wastageWhole = 0;
        let wastageSlices = 0;

        const todayChecks = stockChecks
          .filter(c => c.date === date && c.outlet === selectedOutlet && c.completedBy !== 'AUTO')
          .sort((a, b) => b.timestamp - a.timestamp);

        if (todayChecks.length > 0) {
          const latestTodayCheck = todayChecks[0];
          const wholeCount = latestTodayCheck.counts.find(c => c.productId === pair.wholeId);
          const slicesCount = latestTodayCheck.counts.find(c => c.productId === pair.slicesId);
          
          if (wholeCount) wastageWhole = wholeCount.wastage || 0;
          if (slicesCount) wastageSlices = slicesCount.wastage || 0;
        }

        // STEP 4: Sold/Transferred
        let soldWhole = 0;
        let soldSlices = 0;
        
        // STEP 4.1: Check if this product is a raw material that should show consumption from menu sales
        // If a menu product has "Calculate raw materials based on sales" enabled, show the raw material usage here
        let rawMaterialUsageWhole = 0;
        let rawMaterialUsageSlices = 0;

        if (outlet.outletType === 'production') {
          // Production: Get approved OUT requests FROM this outlet
          const outRequests = requests.filter(
            r => r.status === 'approved' && 
                 r.fromOutlet === selectedOutlet && 
                 r.requestDate === date
          );

          outRequests.forEach(req => {
            if (req.productId === pair.wholeId) {
              const whole = Math.floor(req.quantity);
              const slices = Math.round((req.quantity % 1) * pair.factor);
              soldWhole += whole;
              soldSlices += slices;
            } else if (req.productId === pair.slicesId) {
              const totalSlices = Math.round(req.quantity);
              soldWhole += Math.floor(totalSlices / pair.factor);
              soldSlices += Math.round(totalSlices % pair.factor);
            }
          });
        } else {
          // Sales: Get from salesDeductions (reconciliation)
          // ALWAYS USE salesDeductions data when available - this is the ACTUAL sold data from reconciliation
          console.log(`Product ${wholeProduct.name} on ${date} - checking salesDeductions for outlet:`, selectedOutlet);
          console.log('  Total salesDeductions in context:', salesDeductions.length);
          
          const salesForDate = salesDeductions.filter(
            s => (s.outletName === selectedOutlet || s.outletName.toLowerCase().trim() === selectedOutlet.toLowerCase().trim()) && 
                 s.salesDate === date && 
                 s.productId === pair.wholeId && 
                 !s.deleted
          );
          
          console.log('  Sales deductions found for this date:', salesForDate.length);
          
          salesForDate.forEach(s => {
            soldWhole += s.wholeDeducted || 0;
            soldSlices += s.slicesDeducted || 0;
            console.log(`  Sold: ${s.wholeDeducted}W + ${s.slicesDeducted}S from sales reconciliation`);
          });
          
          if (salesForDate.length === 0) {
            console.log('  WARNING: No sales deductions found - sold will be 0');
          }
        }

        // Normalize sold
        if (soldSlices >= pair.factor) {
          const extraWhole = Math.floor(soldSlices / pair.factor);
          soldWhole += extraWhole;
          soldSlices = Math.round(soldSlices % pair.factor);
        }

        // STEP 5: Calculate Current Stock
        // ALWAYS calculate: Current = Opening + Received - Sold (with unit conversions)
        // Unless manually edited or replaced ON THIS SPECIFIC DATE
        let manuallyEditedDate: string | undefined;
        let replaceInventoryDate: string | undefined;
        let currentWhole = 0;
        let currentSlices = 0;
        
        // Check if there's a stock check for today with replaceAllInventory flag
        const todayCheckWithReplace = todayChecks.find(c => c.replaceAllInventory);
        if (todayCheckWithReplace) {
          replaceInventoryDate = date;
          console.log(`Product ${wholeProduct.name} on ${date} was replaced via Replace All Inventory`);
          
          // Use stock check quantities directly as Current Stock (don't calculate)
          const wholeCount = todayCheckWithReplace.counts.find(c => c.productId === pair.wholeId);
          const slicesCount = todayCheckWithReplace.counts.find(c => c.productId === pair.slicesId);
          
          currentWhole = wholeCount?.quantity || 0;
          currentSlices = slicesCount?.quantity || 0;
          
          console.log(`Using stock check quantities directly - Whole: ${currentWhole}, Slices: ${currentSlices}`);
        } else {
          // Check if stock counts have manuallyEditedDate for THIS SPECIFIC DATE
          const wholeCount = todayChecks.length > 0 ? todayChecks[0].counts.find(c => c.productId === pair.wholeId) : undefined;
          const slicesCount = todayChecks.length > 0 ? todayChecks[0].counts.find(c => c.productId === pair.slicesId) : undefined;
          
          // ONLY use manual value if manuallyEditedDate matches THIS date
          const isManuallyEditedToday = (wholeCount?.manuallyEditedDate === date) || (slicesCount?.manuallyEditedDate === date);
          
          if (isManuallyEditedToday) {
            manuallyEditedDate = date;
            console.log(`Product ${wholeProduct.name} on ${date} was manually edited ON THIS DATE`);
            
            // Use manually edited quantities directly for THIS date only
            currentWhole = wholeCount?.quantity || 0;
            currentSlices = slicesCount?.quantity || 0;
            console.log(`Using manually edited quantities - Whole: ${currentWhole}, Slices: ${currentSlices}`);
          } else {
            // ALWAYS use formula for dates that are NOT manually edited:
            // Current = Opening + Received - Sold
            // NOTE: Wastage is NOT subtracted because it's already reflected in the opening stock
            console.log(`Product ${wholeProduct.name} on ${date} - using formula: Opening(${openingWhole}W/${openingSlices}S) + Received(${receivedWhole}W/${receivedSlices}S) - Sold(${soldWhole}W/${soldSlices}S)`);
            
            let totalSlices = (openingWhole * pair.factor + openingSlices) +
                              (receivedWhole * pair.factor + receivedSlices) -
                              (soldWhole * pair.factor + soldSlices);
            
            console.log(`  Total slices calculated: ${totalSlices}`);
            
            // Handle negative values correctly with unit conversion
            if (totalSlices < 0) {
              currentWhole = -Math.ceil(Math.abs(totalSlices) / pair.factor);
              currentSlices = totalSlices < 0 ? Math.round(pair.factor - (Math.abs(totalSlices) % pair.factor)) % pair.factor : 0;
              if (currentSlices === 0) {
                currentWhole = Math.floor(totalSlices / pair.factor);
              }
            } else {
              currentWhole = Math.floor(totalSlices / pair.factor);
              currentSlices = Math.round(totalSlices % pair.factor);
              
              // Normalize: if slices >= factor, convert to whole
              if (currentSlices >= pair.factor) {
                const extraWhole = Math.floor(currentSlices / pair.factor);
                currentWhole += extraWhole;
                currentSlices = Math.round(currentSlices % pair.factor);
              }
            }
            
            console.log(`  Result - Whole: ${currentWhole}, Slices: ${currentSlices}`);
          }
        }

        // Add record if there's any activity
        if (openingWhole > 0 || openingSlices > 0 || receivedWhole > 0 || receivedSlices > 0 || 
            wastageWhole > 0 || wastageSlices > 0 || soldWhole > 0 || soldSlices > 0 || 
            currentWhole > 0 || currentSlices > 0) {
          records.push({
            date,
            openingWhole: Math.round(openingWhole * 100) / 100,
            openingSlices: Math.round(openingSlices * 100) / 100,
            receivedWhole: Math.round(receivedWhole * 100) / 100,
            receivedSlices: Math.round(receivedSlices * 100) / 100,
            wastageWhole: Math.round(wastageWhole * 100) / 100,
            wastageSlices: Math.round(wastageSlices * 100) / 100,
            soldWhole: Math.round(soldWhole * 100) / 100,
            soldSlices: Math.round(soldSlices * 100) / 100,
            currentWhole: Math.round(currentWhole * 100) / 100,
            currentSlices: Math.round(currentSlices * 100) / 100,
            discrepancyWhole: 0,
            discrepancySlices: 0,
            manuallyEditedDate,
            replaceInventoryDate,
          });
        }
      });

      if (records.length > 0) {
        for (let index = 0; index < records.length; index += 1) {
          const currentRecord = records[index];
          const nextIndex = index + 1;

          // CALCULATE DISCREPANCY: Opening (next day) - Current (today)
          // Formula: Discrepancy = Next Day Opening - Current
          // This shows how much stock is missing or extra compared to what we expect to carry forward
          
          if (nextIndex < records.length) {
            const nextRecord = records[nextIndex];
            
            // Get next day's opening stock (in total slices)
            const nextOpeningTotalSlices = (nextRecord.openingWhole * pair.factor) + nextRecord.openingSlices;
            
            // Get today's current stock (in total slices)
            const currentTotalSlices = (currentRecord.currentWhole * pair.factor) + currentRecord.currentSlices;
            
            // Discrepancy = Next Day Opening - Today's Current
            const discrepancyTotalSlices = nextOpeningTotalSlices - currentTotalSlices;

            // Handle negative discrepancies correctly with unit conversion
            if (discrepancyTotalSlices < 0) {
              const absDiscrepancySlices = Math.abs(discrepancyTotalSlices);
              currentRecord.discrepancyWhole = -Math.ceil(absDiscrepancySlices / pair.factor);
              const remainder = absDiscrepancySlices % pair.factor;
              currentRecord.discrepancySlices = remainder > 0 ? -(pair.factor - remainder) : 0;
              if (currentRecord.discrepancySlices === -pair.factor) {
                currentRecord.discrepancyWhole -= 1;
                currentRecord.discrepancySlices = 0;
              }
            } else {
              currentRecord.discrepancyWhole = Math.floor(discrepancyTotalSlices / pair.factor);
              currentRecord.discrepancySlices = Math.round(discrepancyTotalSlices % pair.factor);
              if (currentRecord.discrepancySlices >= pair.factor) {
                currentRecord.discrepancyWhole += Math.floor(currentRecord.discrepancySlices / pair.factor);
                currentRecord.discrepancySlices = Math.round(currentRecord.discrepancySlices % pair.factor);
              }
            }

            console.log(`Discrepancy for ${wholeProduct.name} on ${currentRecord.date}:`);
            console.log(`  Today's Current: ${currentRecord.currentWhole}W/${currentRecord.currentSlices}S`);
            console.log(`  Next Day Opening: ${nextRecord.openingWhole}W/${nextRecord.openingSlices}S`);
            console.log(`  Discrepancy (Next Opening - Current): ${currentRecord.discrepancyWhole}W/${currentRecord.discrepancySlices}S`);
          } else {
            // Last day - no discrepancy
            currentRecord.discrepancyWhole = 0;
            currentRecord.discrepancySlices = 0;
            console.log(`Discrepancy for ${wholeProduct.name} on ${currentRecord.date}: Last day - no discrepancy`);
          }
        }

        history.push({
          productId: pair.wholeId,
          productName: wholeProduct.name,
          unit: wholeProduct.unit,
          outlet: selectedOutlet,
          records,
        });
      }
    });

    // Group 2: Products WITHOUT unit conversions (Other Units)
    products.forEach(product => {
      if (processedProducts.has(product.id) || productsWithConversions.has(product.id)) return;
      processedProducts.add(product.id);

      const records: DailyInventoryRecord[] = [];

      dates.forEach(date => {
        // Opening = Current day's LATEST USER STOCK CHECK openingStock field (if set)
        // This is set by manual stock checks on the SELECTED DATE
        const todayChecksForOpening = stockChecks
          .filter(c => c.date === date && c.outlet === selectedOutlet && c.completedBy !== 'AUTO')
          .sort((a, b) => b.timestamp - a.timestamp);
        
        let opening = 0;
        if (todayChecksForOpening.length > 0) {
          const latestTodayCheck = todayChecksForOpening[0];
          const count = latestTodayCheck.counts.find(c => c.productId === product.id);
          
          // Use openingStock if it's set (from stock check submission on THIS date)
          if (count && count.openingStock !== undefined) {
            opening = count.openingStock;
          }
        }

        // Received from approved requests
        let received = 0;
        const receivedRequests = requests.filter(
          r => r.status === 'approved' && 
               r.toOutlet === selectedOutlet && 
               r.requestDate === date && 
               r.productId === product.id
        );
        receivedRequests.forEach(req => { received += req.quantity; });

        // Wastage from today's check
        let wastage = 0;
        const todayChecks = stockChecks
          .filter(c => c.date === date && c.outlet === selectedOutlet && c.completedBy !== 'AUTO')
          .sort((a, b) => b.timestamp - a.timestamp);

        if (todayChecks.length > 0) {
          const latestTodayCheck = todayChecks[0];
          const count = latestTodayCheck.counts.find(c => c.productId === product.id);
          if (count) wastage = count.wastage || 0;
        }

        // Sold/Transferred
        let sold = 0;
        
        if (outlet?.outletType === 'production') {
          const outRequests = requests.filter(
            r => r.status === 'approved' && 
                 r.fromOutlet === selectedOutlet && 
                 r.requestDate === date && 
                 r.productId === product.id
          );
          outRequests.forEach(req => { sold += req.quantity; });
        } else {
          // Sales: Get from salesDeductions (reconciliation)
          // ALWAYS USE salesDeductions data when available
          const salesForDate = salesDeductions.filter(
            s => (s.outletName === selectedOutlet || s.outletName.toLowerCase().trim() === selectedOutlet.toLowerCase().trim()) && 
                 s.salesDate === date && 
                 s.productId === product.id && 
                 !s.deleted
          );
          
          salesForDate.forEach(s => { 
            sold += s.wholeDeducted || 0;
          });
        }

        // STEP 5: Calculate Current Stock
        // ALWAYS calculate: Current = Opening + Received - Sold
        // Unless manually edited or replaced ON THIS SPECIFIC DATE
        let manuallyEditedDate: string | undefined;
        let replaceInventoryDate: string | undefined;
        let current = 0;
        
        // Check if there's a stock check for today with replaceAllInventory flag
        const todayCheckWithReplace = todayChecks.find(c => c.replaceAllInventory);
        if (todayCheckWithReplace) {
          replaceInventoryDate = date;
          console.log(`Product ${product.name} on ${date} was replaced via Replace All Inventory`);
          
          // Use stock check quantity directly as Current Stock (don't calculate)
          const count = todayCheckWithReplace.counts.find(c => c.productId === product.id);
          current = count?.quantity || 0;
          
          console.log(`Using stock check quantity directly: ${current}`);
        } else {
          // Check if stock count has manuallyEditedDate for THIS SPECIFIC DATE
          if (todayChecks.length > 0) {
            const latestTodayCheck = todayChecks[0];
            const count = latestTodayCheck.counts.find(c => c.productId === product.id);
            
            // ONLY use manual value if manuallyEditedDate matches THIS date
            const isManuallyEditedToday = count?.manuallyEditedDate === date;
            
            if (isManuallyEditedToday) {
              manuallyEditedDate = date;
              console.log(`Product ${product.name} on ${date} was manually edited ON THIS DATE`);
              
              // Use manually edited quantity directly for THIS date only
              current = count.quantity || 0;
              console.log(`Using manually edited quantity: ${current}`);
            } else {
              // ALWAYS use formula for dates that are NOT manually edited:
              // Current = Opening + Received - Sold
              // NOTE: Wastage is NOT subtracted because it's already reflected in the opening stock
              console.log(`Product ${product.name} on ${date} - using formula: ${opening} + ${received} - ${sold}`);
              current = opening + received - sold;
              console.log(`  Result: ${current}`);
            }
          } else {
            // ALWAYS use formula: Current = Opening + Received - Sold
            // NOTE: Wastage is NOT subtracted because it's already reflected in the opening stock
            console.log(`Product ${product.name} on ${date} - using formula (no check): ${opening} + ${received} - ${sold}`);
            current = opening + received - sold;
            console.log(`  Result: ${current}`);
          }
        }
        
        // Round to 2 decimal places to avoid floating point errors
        current = Math.round(current * 100) / 100;

        if (opening > 0 || received > 0 || wastage > 0 || sold > 0 || current > 0) {
          records.push({
            date,
            openingWhole: Math.round(opening * 100) / 100,
            openingSlices: 0,
            receivedWhole: Math.round(received * 100) / 100,
            receivedSlices: 0,
            wastageWhole: Math.round(wastage * 100) / 100,
            wastageSlices: 0,
            soldWhole: Math.round(sold * 100) / 100,
            soldSlices: 0,
            currentWhole: Math.round(current * 100) / 100,
            currentSlices: 0,
            discrepancyWhole: 0,
            discrepancySlices: 0,
            manuallyEditedDate,
            replaceInventoryDate,
          });
        }
      });

      if (records.length > 0) {
        for (let index = 0; index < records.length; index += 1) {
          const currentRecord = records[index];
          const nextIndex = index + 1;

          // CALCULATE DISCREPANCY: Opening (next day) - Current (today)
          // Formula: Discrepancy = Next Day Opening - Current
          // This shows how much stock is missing or extra compared to what we expect to carry forward
          
          if (nextIndex < records.length) {
            const nextRecord = records[nextIndex];
            
            // Discrepancy = Next Day Opening - Today's Current
            const discrepancy = nextRecord.openingWhole - currentRecord.currentWhole;
            currentRecord.discrepancyWhole = Math.round(discrepancy * 100) / 100;
            currentRecord.discrepancySlices = 0;

            console.log(`Discrepancy for ${product.name} on ${currentRecord.date}:`);
            console.log(`  Today's Current: ${currentRecord.currentWhole}`);
            console.log(`  Next Day Opening: ${nextRecord.openingWhole}`);
            console.log(`  Discrepancy (Next Opening - Current): ${currentRecord.discrepancyWhole}`);
          } else {
            // Last day - no discrepancy
            currentRecord.discrepancyWhole = 0;
            currentRecord.discrepancySlices = 0;
            console.log(`Discrepancy for ${product.name} on ${currentRecord.date}: Last day - no discrepancy`);
          }
        }

        history.push({
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          outlet: selectedOutlet,
          records,
        });
      }
    });

    console.log('========================================');
    console.log('Live Inventory Calculation Complete');
    console.log('Total Products Processed:', history.length);
    console.log('========================================\n');

    return history.sort((a, b) => a.productName.localeCompare(b.productName));
  }, [selectedOutlet, selectedDate, dateRange, products, outlets, stockChecks, salesDeductions, productConversions, requests, getDateRange, approvedProductions]);

  console.log('[LIVE INVENTORY] Current inventory history count:', productInventoryHistory.length);
  console.log('[LIVE INVENTORY] Dependencies - stockChecks:', stockChecks.length, 'salesDeductions:', salesDeductions.length, 'requests:', requests.length);

  useEffect(() => {
    if (selectedOutlet) {
      console.log('[LIVE INVENTORY] Outlet selected/changed:', selectedOutlet, '- triggering silent sync to load latest sales data');
      syncAll(true).catch(e => console.log('[LIVE INVENTORY] Silent sync error:', e));
    }
  }, [selectedOutlet, syncAll]);

  const handleExportDiscrepancies = async () => {
    try {
      if (productInventoryHistory.length === 0) {
        alert('No data to export');
        return;
      }

      const outlet = outlets.find(o => o.name === selectedOutlet);
      const workbook = XLSX.utils.book_new();
      
      const dateRangeStart = getDateRange(selectedDate, dateRange)[0];
      const dateRangeEnd = selectedDate;
      
      const summaryData = [
        ['Live Inventory Discrepancies Report'],
        ['Outlet:', selectedOutlet],
        ['Date Range:', `${dateRangeStart} to ${dateRangeEnd}`],
        ['Generated:', new Date().toLocaleString()],
        [],
        ['Summary'],
        ['Total Products:', productInventoryHistory.length],
      ];
      
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      const discrepancyData: any[] = [];
      
      productInventoryHistory.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        const recipe = recipes?.find(r => r.menuProductId === item.productId);
        
        item.records.forEach(record => {
          const discrepancyWhole = record.discrepancyWhole || 0;
          const discrepancySlices = record.discrepancySlices || 0;
          
          if (discrepancyWhole !== 0 || discrepancySlices !== 0) {
            const conversionFactor = (() => {
              const pair = productConversions.find(c => c.fromProductId === item.productId);
              return pair?.conversionFactor || 1;
            })();
            
            const totalDiscrepancyQty = discrepancyWhole + (discrepancySlices / conversionFactor);
            const sellingPrice = product?.sellingPrice || 0;
            const totalSellingCost = totalDiscrepancyQty * sellingPrice;
            
            let totalCostPrice = 0;
            if (recipe && recipe.components && recipe.components.length > 0) {
              recipe.components.forEach(component => {
                const rawProduct = products.find(p => p.id === component.rawProductId);
                const storeProduct = storeProducts.find(sp => sp.name.toLowerCase() === rawProduct?.name?.toLowerCase());
                const costPerUnit = storeProduct?.costPerUnit || rawProduct?.sellingPrice || 0;
                totalCostPrice += costPerUnit * component.quantityPerUnit * totalDiscrepancyQty;
              });
            }
            
            discrepancyData.push([
              record.date,
              item.productName,
              item.unit,
              `W: ${discrepancyWhole}, S: ${discrepancySlices}`,
              totalSellingCost.toFixed(2),
              totalCostPrice.toFixed(2),
            ]);
          }
        });
      });

      if (discrepancyData.length === 0) {
        alert('No discrepancies found in the selected period');
        return;
      }

      const headers = [['Date', 'Product', 'Unit', 'Quantity', 'Total Selling Cost', 'Total Cost Price']];
      const discrepancySheet = XLSX.utils.aoa_to_sheet([...headers, ...discrepancyData]);
      XLSX.utils.book_append_sheet(workbook, discrepancySheet, 'Discrepancies');

      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
      const filename = `discrepancies_${selectedOutlet.replace(/\s+/g, '_')}_${dateRangeStart}_to_${dateRangeEnd}.xlsx`;

      if (Platform.OS === 'web') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 100);
        
        alert('Discrepancies report exported successfully.');
      } else {
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Discrepancies Report',
            UTI: 'com.microsoft.excel.xlsx',
          });
        }
      }
    } catch (error) {
      console.error('Export discrepancies error:', error);
      alert('Failed to export discrepancies report.');
    }
  };

  const handleExportToExcel = async () => {
    try {
      if (productInventoryHistory.length === 0) {
        alert('No data to export');
        return;
      }

      const outlet = outlets.find(o => o.name === selectedOutlet);
      const workbook = XLSX.utils.book_new();
      
      const summaryData = [
        ['Live Inventory Report'],
        ['Outlet:', selectedOutlet],
        ['Date Range:', `${getDateRange(selectedDate, dateRange)[0]} to ${selectedDate}`],
        ['Generated:', new Date().toLocaleString()],
        [],
        ['Summary'],
        ['Total Products:', productInventoryHistory.length],
      ];
      
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      const detailData: any[] = [];
      
      productInventoryHistory.forEach(item => {
        detailData.push([
          item.productName,
          item.unit,
          '',
          '',
          '',
          '',
          '',
        ]);
        
        detailData.push([
          'Date',
          'Opening Stock',
          'Received',
          'Wastage',
          outlet?.outletType === 'production' ? 'Approved Out' : 'Sold',
          'Current Stock',
          'Discrepancies',
        ]);
        
        item.records.forEach(record => {
          detailData.push([
            record.date,
            `W: ${record.openingWhole}, S: ${record.openingSlices}`,
            `W: ${record.receivedWhole}, S: ${record.receivedSlices}`,
            `W: ${record.wastageWhole}, S: ${record.wastageSlices}`,
            `W: ${record.soldWhole}, S: ${record.soldSlices}`,
            `W: ${record.currentWhole}, S: ${record.currentSlices}`,
            `W: ${record.discrepancyWhole}, S: ${record.discrepancySlices}`,
          ]);
        });
        
        detailData.push([]);
      });

      const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Inventory Detail');

      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
      const filename = `live_inventory_${selectedOutlet.replace(/\s+/g, '_')}_${selectedDate}.xlsx`;

      if (Platform.OS === 'web') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 100);
        
        alert('Inventory report exported successfully.');
      } else {
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Live Inventory Report',
            UTI: 'com.microsoft.excel.xlsx',
          });
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export inventory report.');
    }
  };

  const handleEditCurrentStock = useCallback(async (productId: string, date: string, field: 'currentWhole' | 'currentSlices', newWhole: number, newSlices: number) => {
    try {
      console.log('\n=== EDITING CURRENT STOCK IN LIVE INVENTORY ===');
      console.log('Product:', productId, 'Date:', date);
      console.log('New values - Whole:', newWhole, 'Slices:', newSlices);
      
      const outlet = outlets.find(o => o.name === selectedOutlet);
      if (!outlet) {
        Alert.alert('Error', 'Outlet not found');
        return;
      }
      
      const productPair = (() => {
        const fromConversion = productConversions.find(c => c.fromProductId === productId);
        const toConversion = productConversions.find(c => c.toProductId === productId);
        
        if (fromConversion) {
          return { wholeProductId: productId, slicesProductId: fromConversion.toProductId };
        }
        if (toConversion) {
          return { wholeProductId: toConversion.fromProductId, slicesProductId: productId };
        }
        return null;
      })();
      
      // STEP 1: Update TODAY's stock check to mark the edit and set the new current stock
      console.log('STEP 1: Marking current stock as manually edited on date:', date);
      const todayCheck = stockChecks.find(c => c.date === date && c.outlet === selectedOutlet && c.completedBy !== 'AUTO');
      
      if (todayCheck) {
        console.log('Found existing stock check for today:', todayCheck.id);
        const updatedTodayCounts = [...todayCheck.counts];
        
        if (productPair) {
          // Update with conversions
          const wholeCountIndex = updatedTodayCounts.findIndex(c => c.productId === productPair.wholeProductId);
          const slicesCountIndex = updatedTodayCounts.findIndex(c => c.productId === productPair.slicesProductId);
          
          if (wholeCountIndex >= 0) {
            updatedTodayCounts[wholeCountIndex] = {
              ...updatedTodayCounts[wholeCountIndex],
              quantity: newWhole,
              openingStock: newWhole,
              manuallyEditedDate: date,
            };
            console.log('Updated whole product count with manuallyEditedDate and openingStock');
          } else {
            updatedTodayCounts.push({
              productId: productPair.wholeProductId,
              quantity: newWhole,
              openingStock: newWhole,
              receivedStock: 0,
              wastage: 0,
              manuallyEditedDate: date,
            });
            console.log('Created new whole product count with manuallyEditedDate and openingStock');
          }
          
          if (slicesCountIndex >= 0) {
            updatedTodayCounts[slicesCountIndex] = {
              ...updatedTodayCounts[slicesCountIndex],
              quantity: newSlices,
              openingStock: newSlices,
              manuallyEditedDate: date,
            };
            console.log('Updated slices product count with manuallyEditedDate and openingStock');
          } else {
            updatedTodayCounts.push({
              productId: productPair.slicesProductId,
              quantity: newSlices,
              openingStock: newSlices,
              receivedStock: 0,
              wastage: 0,
              manuallyEditedDate: date,
            });
            console.log('Created new slices product count with manuallyEditedDate and openingStock');
          }
        } else {
          // Product without conversions
          const countIndex = updatedTodayCounts.findIndex(c => c.productId === productId);
          
          if (countIndex >= 0) {
            updatedTodayCounts[countIndex] = {
              ...updatedTodayCounts[countIndex],
              quantity: newWhole,
              openingStock: newWhole,
              manuallyEditedDate: date,
            };
            console.log('Updated product count with manuallyEditedDate and openingStock');
          } else {
            updatedTodayCounts.push({
              productId: productId,
              quantity: newWhole,
              openingStock: newWhole,
              receivedStock: 0,
              wastage: 0,
              manuallyEditedDate: date,
            });
            console.log('Created new product count with manuallyEditedDate and openingStock');
          }
        }
        
        await updateStockCheck(todayCheck.id, updatedTodayCounts);
        console.log('✓ Updated today\'s stock check with manuallyEditedDate');
      } else {
        console.log('Creating new stock check for today with manual edit');
        const newCounts: StockCount[] = [];
        
        if (productPair) {
          newCounts.push({
            productId: productPair.wholeProductId,
            quantity: newWhole,
            openingStock: newWhole,
            receivedStock: 0,
            wastage: 0,
            manuallyEditedDate: date,
          });
          newCounts.push({
            productId: productPair.slicesProductId,
            quantity: newSlices,
            openingStock: newSlices,
            receivedStock: 0,
            wastage: 0,
            manuallyEditedDate: date,
          });
        } else {
          newCounts.push({
            productId: productId,
            quantity: newWhole,
            openingStock: newWhole,
            receivedStock: 0,
            wastage: 0,
            manuallyEditedDate: date,
          });
        }
        
        const newStockCheck: StockCheck = {
          id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: date,
          timestamp: Date.now(),
          outlet: selectedOutlet,
          counts: newCounts,
          completedBy: 'MANUAL_EDIT',
          updatedAt: Date.now(),
        };
        
        await saveStockCheck(newStockCheck, true);
        console.log('✓ Created new stock check for today with manuallyEditedDate');
      }
      
      console.log('✓ Opening stock for the SELECTED DATE has been set:', date);
      console.log('The opening stock is now:', newWhole, 'whole,', newSlices, 'slices for date:', date);
      console.log('This will be used as the opening stock for the selected date in live inventory calculations');
      
      console.log('=== EDIT COMPLETE - CURRENT STOCK WILL BE HIGHLIGHTED IN RED ===\n');
      
      Alert.alert(
        'Success',
        `Updated opening stock for ${date}. This stock will be highlighted in red.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error editing current stock:', error);
      Alert.alert('Error', 'Failed to update current stock');
    }
  }, [selectedOutlet, outlets, productConversions, stockChecks, updateStockCheck, saveStockCheck]);

  const navigateDate = (direction: 'prev' | 'next') => {
    const current = new Date(selectedDate);
    const daysToMove = dateRange === 'week' ? 7 : 30;
    
    if (direction === 'prev') {
      current.setDate(current.getDate() - daysToMove);
    } else {
      current.setDate(current.getDate() + daysToMove);
    }
    
    setSelectedDate(current.toISOString().split('T')[0]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Live Inventory' }} />

      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.outletSelector}
          onPress={() => setShowOutletModal(true)}
        >
          <TrendingUp size={16} color={Colors.light.tint} />
          <View style={styles.outletInfo}>
            <Text style={styles.outletLabel}>Outlet</Text>
            <Text style={styles.outletValue}>{selectedOutlet || 'Select Outlet'}</Text>
          </View>
          <Text style={styles.changeText}>Change</Text>
        </TouchableOpacity>

        <View style={styles.dateRangeSelector}>
          <TouchableOpacity 
            style={[styles.rangeButton, dateRange === 'week' && styles.rangeButtonActive]}
            onPress={() => setDateRange('week')}
          >
            <Text style={[styles.rangeButtonText, dateRange === 'week' && styles.rangeButtonTextActive]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.rangeButton, dateRange === 'month' && styles.rangeButtonActive]}
            onPress={() => setDateRange('month')}
          >
            <Text style={[styles.rangeButtonText, dateRange === 'month' && styles.rangeButtonTextActive]}>Month</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dateNavigator}>
          <TouchableOpacity onPress={() => navigateDate('prev')} style={styles.navButton}>
            <ChevronLeft size={20} color={Colors.light.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowCalendar(true)} style={styles.dateButton}>
            <Calendar size={16} color={Colors.light.tint} />
            <Text style={styles.dateText}>{selectedDate}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigateDate('next')} style={styles.navButton}>
            <ChevronRight size={20} color={Colors.light.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.exportButtons}>
          <TouchableOpacity 
            style={styles.exportButton}
            onPress={handleExportToExcel}
            disabled={productInventoryHistory.length === 0}
          >
            <Download size={18} color={Colors.light.tint} />
            <Text style={styles.exportButtonText}>Export</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.exportDiscrepancyButton}
            onPress={handleExportDiscrepancies}
            disabled={productInventoryHistory.length === 0}
          >
            <AlertTriangle size={18} color={Colors.light.card} />
            <Text style={styles.exportDiscrepancyButtonText}>Discrepancies</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!selectedOutlet ? (
        <View style={styles.emptyContainer}>
          <TrendingUp size={64} color={Colors.light.muted} />
          <Text style={styles.emptyTitle}>Select an Outlet</Text>
          <Text style={styles.emptyText}>Choose an outlet to view live inventory tracking</Text>
        </View>
      ) : productInventoryHistory.length === 0 ? (
        <View style={styles.emptyContainer}>
          <TrendingUp size={64} color={Colors.light.muted} />
          <Text style={styles.emptyTitle}>No Inventory Data</Text>
          <Text style={styles.emptyText}>No stock movements found for the selected date range</Text>
        </View>
      ) : (
        <>
          <View style={styles.tableHeaderWrapper}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.tableHeader}>
                <View style={[styles.headerCell, styles.productNameCell]}>
                  <Text style={styles.headerText}>Product</Text>
                </View>
                <View style={[styles.headerCell, styles.dateCell]}>
                  <Text style={styles.headerText}>Date</Text>
                </View>
                <View style={[styles.headerCell, styles.doubleNumberCell]}>
                  <Text style={styles.headerText}>Opening</Text>
                  <View style={styles.subHeaderRow}>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Whole</Text>
                    </View>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Slice</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.headerCell, styles.doubleNumberCell]}>
                  <Text style={styles.headerText}>{outlets.find(o => o.name === selectedOutlet)?.outletType === 'production' ? 'Prods.Req' : 'Received'}</Text>
                  <View style={styles.subHeaderRow}>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Whole</Text>
                    </View>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Slice</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.headerCell, styles.doubleNumberCell]}>
                  <Text style={styles.headerText}>Wastage</Text>
                  <View style={styles.subHeaderRow}>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Whole</Text>
                    </View>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Slice</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.headerCell, styles.doubleNumberCell]}>
                  <Text style={styles.headerText}>{outlets.find(o => o.name === selectedOutlet)?.outletType === 'production' ? 'Transferred' : 'Sold'}</Text>
                  <View style={styles.subHeaderRow}>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Whole</Text>
                    </View>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Slice</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.headerCell, styles.doubleNumberCell]}>
                  <Text style={styles.headerText}>Current</Text>
                  <View style={styles.subHeaderRow}>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Whole</Text>
                    </View>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Slice</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.headerCell, styles.doubleNumberCell]}>
                  <Text style={styles.headerText}>Discrepancies</Text>
                  <View style={styles.subHeaderRow}>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Whole</Text>
                    </View>
                    <View style={styles.subHeaderCell}>
                      <Text style={styles.subHeaderText}>Slice</Text>
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>

          <ScrollView style={styles.scrollView}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={styles.tableContainer}>
                {productInventoryHistory.map(item => (
                  <View key={item.productId} style={styles.productSection}>
                    {item.records.map((record, idx) => (
                      <View key={`${item.productId}-${record.date}`} style={styles.tableRow}>
                        {idx === 0 && (
                          <View style={[styles.cell, styles.productNameCell]}>
                            <Text style={styles.productName}>{item.productName}</Text>
                            <Text style={styles.productUnit}>{item.unit}</Text>
                          </View>
                        )}
                        {idx > 0 && <View style={[styles.cell, styles.productNameCell]} />}
                        
                        <View style={[styles.cell, styles.dateCell]}>
                          <Text style={styles.cellText}>{record.date}</Text>
                        </View>

                        <View style={styles.doubleNumberCell}>
                          <View style={styles.subCellRow}>
                            <View style={[styles.cell, styles.subNumberCell]}>
                              <Text style={styles.cellNumber}>{record.openingWhole}</Text>
                            </View>
                            <View style={[styles.cell, styles.subNumberCell]}>
                              <Text style={styles.cellNumber}>{record.openingSlices}</Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.doubleNumberCell}>
                          <View style={styles.subCellRow}>
                            <View style={[styles.cell, styles.subNumberCell, record.receivedWhole > 0 && styles.positiveCell]}>
                              <Text style={[styles.cellNumber, record.receivedWhole > 0 && styles.positiveText]}>
                                {record.receivedWhole > 0 ? `+${record.receivedWhole}` : record.receivedWhole}
                              </Text>
                            </View>
                            <View style={[styles.cell, styles.subNumberCell, record.receivedSlices > 0 && styles.positiveCell]}>
                              <Text style={[styles.cellNumber, record.receivedSlices > 0 && styles.positiveText]}>
                                {record.receivedSlices > 0 ? `+${record.receivedSlices}` : record.receivedSlices}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.doubleNumberCell}>
                          <View style={styles.subCellRow}>
                            <View style={[styles.cell, styles.subNumberCell, record.wastageWhole > 0 && styles.negativeCell]}>
                              <Text style={[styles.cellNumber, record.wastageWhole > 0 && styles.negativeText]}>
                                {record.wastageWhole > 0 ? `-${record.wastageWhole}` : record.wastageWhole}
                              </Text>
                            </View>
                            <View style={[styles.cell, styles.subNumberCell, record.wastageSlices > 0 && styles.negativeCell]}>
                              <Text style={[styles.cellNumber, record.wastageSlices > 0 && styles.negativeText]}>
                                {record.wastageSlices > 0 ? `-${record.wastageSlices}` : record.wastageSlices}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.doubleNumberCell}>
                          <View style={styles.subCellRow}>
                            <View style={[styles.cell, styles.subNumberCell, record.soldWhole > 0 && styles.soldCell]}>
                              <Text style={[styles.cellNumber, record.soldWhole > 0 && styles.soldText]}>
                                {record.soldWhole > 0 ? `-${record.soldWhole}` : record.soldWhole}
                              </Text>
                            </View>
                            <View style={[styles.cell, styles.subNumberCell, record.soldSlices > 0 && styles.soldCell]}>
                              <Text style={[styles.cellNumber, record.soldSlices > 0 && styles.soldText]}>
                                {record.soldSlices > 0 ? `-${record.soldSlices}` : record.soldSlices}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.doubleNumberCell}>
                          <View style={styles.subCellRow}>
                            {editingCell?.productId === item.productId && editingCell?.date === record.date && editingCell?.field === 'currentWhole' ? (
                              <View style={[styles.cell, styles.subNumberCell, styles.editingCell]}>
                                <TextInput
                                  ref={editInputRef}
                                  style={styles.editInput}
                                  value={editValue}
                                  onChangeText={setEditValue}
                                  keyboardType="numeric"
                                  selectTextOnFocus
                                  autoFocus
                                  onSubmitEditing={async () => {
                                    const newValue = parseFloat(editValue) || 0;
                                    if (newValue !== record.currentWhole) {
                                      await handleEditCurrentStock(item.productId, record.date, 'currentWhole', newValue, record.currentSlices);
                                    }
                                    setEditingCell(null);
                                  }}
                                />
                                <View style={styles.editButtons}>
                                  <TouchableOpacity 
                                    style={styles.confirmButton}
                                    onPress={async () => {
                                      const newValue = parseFloat(editValue) || 0;
                                      if (newValue !== record.currentWhole) {
                                        await handleEditCurrentStock(item.productId, record.date, 'currentWhole', newValue, record.currentSlices);
                                      }
                                      setEditingCell(null);
                                    }}
                                  >
                                    <Text style={styles.confirmText}>✓</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity 
                                    style={styles.cancelButton}
                                    onPress={() => setEditingCell(null)}
                                  >
                                    <Text style={styles.cancelText}>✕</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ) : (
                              <TouchableOpacity 
                                activeOpacity={0.7}
                                style={[
                                  styles.cell, 
                                  styles.subNumberCell, 
                                  styles.currentStockCell,
                                  (record.manuallyEditedDate || record.replaceInventoryDate) && styles.manuallyEditedCell
                                ]}
                                onPress={() => {
                                  setEditingCell({ productId: item.productId, date: record.date, field: 'currentWhole' });
                                  setEditValue(record.currentWhole.toString());
                                  setTimeout(() => editInputRef.current?.focus(), 100);
                                }}
                              >
                                <Text style={[styles.cellNumber, styles.currentStockText]}>
                                  {record.currentWhole}
                                </Text>
                              </TouchableOpacity>
                            )}
                            
                            {editingCell?.productId === item.productId && editingCell?.date === record.date && editingCell?.field === 'currentSlices' ? (
                              <View style={[styles.cell, styles.subNumberCell, styles.editingCell]}>
                                <TextInput
                                  ref={editInputRef}
                                  style={styles.editInput}
                                  value={editValue}
                                  onChangeText={setEditValue}
                                  keyboardType="numeric"
                                  selectTextOnFocus
                                  autoFocus
                                  onSubmitEditing={async () => {
                                    const newValue = parseFloat(editValue) || 0;
                                    if (newValue !== record.currentSlices) {
                                      await handleEditCurrentStock(item.productId, record.date, 'currentSlices', record.currentWhole, newValue);
                                    }
                                    setEditingCell(null);
                                  }}
                                />
                                <View style={styles.editButtons}>
                                  <TouchableOpacity 
                                    style={styles.confirmButton}
                                    onPress={async () => {
                                      const newValue = parseFloat(editValue) || 0;
                                      if (newValue !== record.currentSlices) {
                                        await handleEditCurrentStock(item.productId, record.date, 'currentSlices', record.currentWhole, newValue);
                                      }
                                      setEditingCell(null);
                                    }}
                                  >
                                    <Text style={styles.confirmText}>✓</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity 
                                    style={styles.cancelButton}
                                    onPress={() => setEditingCell(null)}
                                  >
                                    <Text style={styles.cancelText}>✕</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ) : (
                              <TouchableOpacity 
                                activeOpacity={0.7}
                                style={[
                                  styles.cell, 
                                  styles.subNumberCell, 
                                  styles.currentStockCell,
                                  (record.manuallyEditedDate || record.replaceInventoryDate) && styles.manuallyEditedCell
                                ]}
                                onPress={() => {
                                  setEditingCell({ productId: item.productId, date: record.date, field: 'currentSlices' });
                                  setEditValue(record.currentSlices.toString());
                                  setTimeout(() => editInputRef.current?.focus(), 100);
                                }}
                              >
                                <Text style={[styles.cellNumber, styles.currentStockText]}>
                                  {record.currentSlices}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>

                        <View style={styles.doubleNumberCell}>
                          <View style={styles.subCellRow}>
                            <View style={[styles.cell, styles.subNumberCell, record.discrepancyWhole !== 0 && (record.discrepancyWhole > 0 ? styles.positiveCell : styles.negativeCell)]}>
                              <Text style={[styles.cellNumber, record.discrepancyWhole !== 0 && (record.discrepancyWhole > 0 ? styles.positiveText : styles.negativeText)]}>
                                {record.discrepancyWhole > 0 ? `+${record.discrepancyWhole}` : record.discrepancyWhole}
                              </Text>
                            </View>
                            <View style={[styles.cell, styles.subNumberCell, record.discrepancySlices !== 0 && (record.discrepancySlices > 0 ? styles.positiveCell : styles.negativeCell)]}>
                              <Text style={[styles.cellNumber, record.discrepancySlices !== 0 && (record.discrepancySlices > 0 ? styles.positiveText : styles.negativeText)]}>
                                {record.discrepancySlices > 0 ? `+${record.discrepancySlices}` : record.discrepancySlices}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        </>
      )}

      <Modal
        visible={showOutletModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOutletModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowOutletModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Outlet</Text>
            {outlets.length === 0 ? (
              <View style={styles.emptyOutlets}>
                <Text style={styles.emptyOutletsText}>No outlets available</Text>
              </View>
            ) : (
              outlets.map(outlet => (
                <TouchableOpacity
                  key={outlet.id}
                  style={[
                    styles.outletOption,
                    selectedOutlet === outlet.name && styles.outletOptionSelected
                  ]}
                  onPress={() => {
                    setSelectedOutlet(outlet.name);
                    setShowOutletModal(false);
                  }}
                >
                  <View style={styles.outletOptionInfo}>
                    <Text style={[
                      styles.outletOptionText,
                      selectedOutlet === outlet.name && styles.outletOptionTextSelected
                    ]}>
                      {outlet.name}
                    </Text>
                    {outlet.location && (
                      <Text style={styles.outletOptionLocation}>{outlet.location}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <CalendarModal
        visible={showCalendar}
        initialDate={selectedDate}
        onClose={() => setShowCalendar(false)}
        onSelect={(iso) => {
          setSelectedDate(iso);
          setShowCalendar(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    padding: 8,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 6,
  },
  outletSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: 8,
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  outletInfo: {
    flex: 1,
  },
  outletLabel: {
    fontSize: 9,
    color: Colors.light.muted,
  },
  outletValue: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  changeText: {
    fontSize: 12,
    color: Colors.light.tint,
    fontWeight: '600' as const,
  },
  dateRangeSelector: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  rangeButton: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
  },
  rangeButtonActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  rangeButtonText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  rangeButtonTextActive: {
    color: Colors.light.card,
  },
  dateNavigator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  navButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    padding: 8,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  exportButtons: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  exportButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    padding: 8,
    borderRadius: 6,
    backgroundColor: Colors.light.tint,
    flex: 1,
  },
  exportButtonText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  exportDiscrepancyButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f97316',
    flex: 1,
  },
  exportDiscrepancyButtonText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.muted,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  tableHeaderWrapper: {
    backgroundColor: Colors.light.card,
    borderBottomWidth: 2,
    borderBottomColor: Colors.light.tint,
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  tableContainer: {
    padding: 12,
    paddingTop: 0,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  headerCell: {
    paddingHorizontal: 8,
    justifyContent: 'center' as const,
  },
  productNameCell: {
    width: 140,
  },
  dateCell: {
    width: 100,
  },
  doubleNumberCell: {
    width: 170,
  },
  subHeaderRow: {
    flexDirection: 'row' as const,
    marginTop: 4,
  },
  subHeaderCell: {
    flex: 1,
    alignItems: 'center' as const,
  },
  subHeaderText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.light.card,
    textAlign: 'center' as const,
  },
  subCellRow: {
    flexDirection: 'row' as const,
  },
  subNumberCell: {
    flex: 1,
    alignItems: 'center' as const,
    paddingHorizontal: 4,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.card,
    textAlign: 'center' as const,
  },
  productSection: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.light.border,
  },
  tableRow: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  cell: {
    paddingHorizontal: 8,
    justifyContent: 'center' as const,
  },
  productName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  productUnit: {
    fontSize: 11,
    color: Colors.light.muted,
    marginTop: 2,
  },
  cellText: {
    fontSize: 12,
    color: Colors.light.text,
    textAlign: 'center' as const,
  },
  cellNumber: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
    textAlign: 'center' as const,
  },
  positiveCell: {
    backgroundColor: '#e8f5e9',
  },
  positiveText: {
    color: '#2e7d32',
  },
  negativeCell: {
    backgroundColor: '#ffebee',
  },
  negativeText: {
    color: '#c62828',
  },
  soldCell: {
    backgroundColor: '#fff3e0',
  },
  soldText: {
    color: '#e65100',
  },
  currentStockCell: {
    backgroundColor: '#e3f2fd',
  },
  currentStockText: {
    color: '#1565c0',
    fontWeight: '700' as const,
  },
  editingCell: {
    backgroundColor: '#ffcdd2',
    borderWidth: 2,
    borderColor: '#d32f2f',
    borderRadius: 4,
    flexDirection: 'column' as const,
    alignItems: 'stretch' as const,
    padding: 4,
    minWidth: 80,
  },
  manuallyEditedCell: {
    backgroundColor: '#ffebee',
    borderColor: '#e57373',
    borderWidth: 2,
  },
  editInput: {
    padding: 8,
    textAlign: 'center' as const,
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#1565c0',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.tint,
    borderRadius: 4,
    marginBottom: 4,
  },
  editButtons: {
    flexDirection: 'row' as const,
    gap: 4,
    justifyContent: 'center' as const,
  },
  confirmButton: {
    backgroundColor: '#4caf50',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flex: 1,
    alignItems: 'center' as const,
  },
  confirmText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700' as const,
  },
  cancelButton: {
    backgroundColor: '#f44336',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flex: 1,
    alignItems: 'center' as const,
  },
  cancelText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  outletOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.light.background,
    marginBottom: 8,
  },
  outletOptionSelected: {
    backgroundColor: Colors.light.tint + '15',
    borderWidth: 2,
    borderColor: Colors.light.tint,
  },
  outletOptionInfo: {
    flex: 1,
  },
  outletOptionText: {
    fontSize: 15,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  outletOptionTextSelected: {
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  outletOptionLocation: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 2,
  },
  emptyOutlets: {
    padding: 20,
    alignItems: 'center' as const,
  },
  emptyOutletsText: {
    fontSize: 14,
    color: Colors.light.muted,
    textAlign: 'center' as const,
  },
});

export default LiveInventoryScreen;
