import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform, TextInput, Alert } from 'react-native';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { StockCount, StockCheck } from '@/types';
import { Stack } from 'expo-router';
import { Calendar, Download, ChevronLeft, ChevronRight, TrendingUp, AlertTriangle } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useStores } from '@/contexts/StoresContext';
import { CalendarModal } from '@/components/CalendarModal';
import Colors from '@/constants/colors';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getKitchenStockReportsByOutletAndDateRange, getSalesReportsByOutletAndDateRange, KitchenStockReport, SalesReport, syncAllReconciliationData } from '@/utils/reconciliationSync';

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

const isUserStockCheck = (check: StockCheck) => {
  const completedBy = (check.completedBy || '').trim();
  return completedBy !== '' && completedBy !== 'AUTO';
};

function LiveInventoryScreen() {
  const { products, outlets, stockChecks, salesDeductions, productConversions, requests, updateStockCheck, saveStockCheck, syncAll, reconcileHistory } = useStock();
  const { recipes } = useRecipes();
  const { storeProducts } = useStores();
  const [selectedOutlet, setSelectedOutlet] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showOutletModal, setShowOutletModal] = useState<boolean>(false);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [dateRange, setDateRange] = useState<'week' | 'month'>('week');
  const [productSearch, setProductSearch] = useState<string>('');
  const [editingCell, setEditingCell] = useState<{productId: string; date: string; field: 'currentWhole' | 'currentSlices'} | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const editInputRef = useRef<TextInput>(null);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [kitchenStockReports, setKitchenStockReports] = useState<KitchenStockReport[]>([]);
  const [salesReports, setSalesReports] = useState<SalesReport[]>([]);
  const syncAllRef = useRef(syncAll);
  const activeLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    syncAllRef.current = syncAll;
  }, [syncAll]);

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

  // CRITICAL: Sync reconciliation data when outlet or date changes
  // This ensures sold items from other devices are displayed
  useEffect(() => {
    if (!selectedOutlet || !selectedDate) return;
    
    console.log('[LIVE INVENTORY] Outlet or date changed, syncing and fetching reconciliation data...');
    console.log('[LIVE INVENTORY] Outlet:', selectedOutlet, 'Date:', selectedDate);
    
    const outlet = outlets.find(o => o.name === selectedOutlet);
    if (!outlet) {
      setIsLoadingData(false);
      return;
    }

    const loadKey = `${selectedOutlet}|${selectedDate}|${dateRange}|${outlet.outletType}`;
    if (activeLoadKeyRef.current === loadKey) {
      console.log('[LIVE INVENTORY] Load already in progress for same selection, skipping duplicate run');
      return;
    }
    activeLoadKeyRef.current = loadKey;
    setIsLoadingData(true);
    
    const dates = getDateRange(selectedDate, dateRange);
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    
    // CRITICAL: Sync in the correct order to prevent stale data
    // 1. First sync NEW reconciliation system (sales/kitchen reports) - this is the SOURCE OF TRUTH
    // 2. Then sync StockContext data (which might have older reconcileHistory)
    // 3. Then fetch reports from the synced data
    let isCancelled = false;
    (async () => {
      try {
        console.log('[LIVE INVENTORY] Step 1: Syncing NEW reconciliation system...');
        await syncAllReconciliationData();
        console.log('[LIVE INVENTORY] ✓ NEW reconciliation system synced');
        
        console.log('[LIVE INVENTORY] Step 2: Syncing StockContext...');
        await syncAllRef.current(true);
        console.log('[LIVE INVENTORY] ✓ StockContext synced');
        
        console.log('[LIVE INVENTORY] Step 3: Fetching reconciliation reports...');
        
        // Small delay to ensure AsyncStorage has written the data
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Fetch the NEW reconciliation system data based on outlet type
        if (outlet.outletType === 'production') {
          const reports = await getKitchenStockReportsByOutletAndDateRange(selectedOutlet, startDate, endDate);
          console.log('[LIVE INVENTORY] ✓ Fetched', reports.length, 'kitchen stock reports for production outlet');
          
          // Log details of what we fetched
          reports.forEach(r => {
            console.log(`  - ${r.outlet} ${r.date}: ${r.products.length} products, updated ${new Date(r.updatedAt).toISOString()}`);
          });
          
          if (!isCancelled) {
            setKitchenStockReports(reports);
            setSalesReports([]);
          }
        } else if (outlet.outletType === 'sales') {
          const reports = await getSalesReportsByOutletAndDateRange(selectedOutlet, startDate, endDate);
          console.log('[LIVE INVENTORY] ✓ Fetched', reports.length, 'sales reports for sales outlet');
          
          // Log details of what we fetched
          reports.forEach(r => {
            console.log(`  - ${r.outlet} ${r.date}: ${r.salesData?.length || 0} products, updated ${new Date(r.updatedAt).toISOString()}`);
            if (r.salesData && r.salesData.length > 0) {
              const sample = r.salesData[0];
              console.log(`    Sample: ${sample.productName} -> ${sample.soldWhole}W/${sample.soldSlices}S`);
            }
          });
          
          if (!isCancelled) {
            setSalesReports(reports);
            setKitchenStockReports([]);
          }
        }
        
        console.log('[LIVE INVENTORY] ✓ All data loaded and ready');
      } catch (error) {
        console.error('[LIVE INVENTORY] ❌ Sync/fetch failed:', error);
      } finally {
        if (!isCancelled) {
          setIsLoadingData(false);
        }
        if (activeLoadKeyRef.current === loadKey) {
          activeLoadKeyRef.current = null;
        }
      }
    })();
    
    return () => {
      isCancelled = true;
    };
  }, [selectedOutlet, selectedDate, dateRange, outlets, getDateRange]);

  const productInventoryHistory = useMemo((): ProductInventoryHistory[] => {
    console.log('\n========================================');
    console.log('[LIVE INVENTORY] Recalculating inventory history at', new Date().toISOString());
    console.log('[LIVE INVENTORY] Kitchen stock reports:', kitchenStockReports.length);
    console.log('[LIVE INVENTORY] Sales reports:', salesReports.length);
    console.log('========================================\n');
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
    const conversionPairs: { wholeId: string; slicesId: string; factor: number }[] = [];
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

      // Filter: Only show products based on their type and settings
      // Menu/Kitchen products: must have showInStock enabled
      // Raw materials: show if salesBasedRawCalc enabled OR appears in any reconciliation rawConsumption
      if (wholeProduct.type === 'menu' || wholeProduct.type === 'kitchen') {
        if (!wholeProduct.showInStock) {
          console.log(`Skipping menu/kitchen product ${wholeProduct.name} - showInStock is disabled`);
          return;
        }
      } else if (wholeProduct.type === 'raw') {
        // Check if this raw material appears in any reconciliation data for this outlet
        const appearsInReconciliation = reconcileHistory.some(
          r => r.outlet === selectedOutlet && 
               !r.deleted && 
               r.rawConsumption && 
               r.rawConsumption.some(rc => rc.rawProductId === pair.wholeId)
        );
        
        if (!wholeProduct.salesBasedRawCalc && !appearsInReconciliation) {
          console.log(`Skipping raw material ${wholeProduct.name} - salesBasedRawCalc is disabled and doesn't appear in reconciliation`);
          return;
        }
        
        if (appearsInReconciliation) {
          console.log(`Including raw material ${wholeProduct.name} - appears in reconciliation rawConsumption`);
        }
      }

      processedProducts.add(pair.wholeId);
      processedProducts.add(pair.slicesId);

      const records: DailyInventoryRecord[] = [];

      dates.forEach((date, dateIndex) => {
        // STEP 1: Opening stock logic
        // NEW BEHAVIOR: Opening stock for ANY day = Previous calendar day's closing (current) stock
        // This creates continuous flow: Day X Closing → Day X+1 Opening
        let openingWhole = 0;
        let openingSlices = 0;

        // Get previous calendar day
        const currentDate = new Date(date);
        currentDate.setDate(currentDate.getDate() - 1);
        const previousCalendarDate = currentDate.toISOString().split('T')[0];

        // Find latest stock check from previous calendar day
        const previousDayChecks = stockChecks
          .filter(c => c.date === previousCalendarDate && c.outlet === selectedOutlet && isUserStockCheck(c))
          .sort((a, b) => b.timestamp - a.timestamp);
        
        if (previousDayChecks.length > 0) {
          // Use previous day's closing stock (quantity field) as today's opening
          const latestPreviousDayCheck = previousDayChecks[0];
          const wholeCount = latestPreviousDayCheck.counts.find(c => c.productId === pair.wholeId);
          const slicesCount = latestPreviousDayCheck.counts.find(c => c.productId === pair.slicesId);
          
          if (wholeCount) {
            openingWhole = wholeCount.quantity || 0;
          }
          
          if (slicesCount) {
            openingSlices = slicesCount.quantity || 0;
          }
          
          console.log(`Product ${wholeProduct.name} on ${date} - Opening from ${previousCalendarDate}'s closing: ${openingWhole}W/${openingSlices}S`);
        } else {
          // No previous day stock check - opening is 0
          console.log(`Product ${wholeProduct.name} on ${date} - No stock check for ${previousCalendarDate}, opening = 0`);
        }

        // STEP 2: Received calculation depends on outlet type
        let receivedWhole = 0;
        let receivedSlices = 0;

        if (isProductionOutlet) {
          console.log(`[PRODUCTION OUTLET] Checking kitchen stock reports for ${wholeProduct.name} on ${date}`);
          const kitchenReport = kitchenStockReports.find(r => r.date === date && r.outlet === selectedOutlet);
          
          if (kitchenReport) {
            console.log(`[PRODUCTION OUTLET] ✓ Found kitchen stock report for ${date}`);
            const productEntry = kitchenReport.products.find(p => p.productId === pair.wholeId);
            
            if (productEntry) {
              const slicesAsWhole = productEntry.quantitySlices / pair.factor;
              receivedWhole = productEntry.quantityWhole + slicesAsWhole;
              receivedSlices = 0;
              console.log(`[PRODUCTION OUTLET] Kitchen reconciliation: ${productEntry.quantityWhole}W + ${productEntry.quantitySlices}S = ${receivedWhole} Whole (displayed in Whole column only)`);
            } else {
              console.log(`[PRODUCTION OUTLET] No product entry found for ${wholeProduct.name} in kitchen report`);
            }
          } else {
            console.log(`[PRODUCTION OUTLET] No kitchen stock report found for ${date}`);
          }

          const reconcileCandidates = reconcileHistory
            .filter(r => r.date === date && r.outlet === selectedOutlet && !r.deleted && Array.isArray(r.prodsReqUpdates) && r.prodsReqUpdates.length > 0)
            .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
          const reconcileForDate = reconcileCandidates[0];
          const prodsReqUpdate = reconcileForDate?.prodsReqUpdates?.find(u => u.productId === pair.wholeId);

          if (reconcileForDate) {
            console.log(`[PRODUCTION OUTLET] Prods.Req reconciliation source: outlet=${reconcileForDate.outlet}, updatedAt=${reconcileForDate.updatedAt}, entries=${reconcileForDate.prodsReqUpdates?.length || 0}`);
          }

          if (prodsReqUpdate) {
            const kitchenProductionQty = (prodsReqUpdate.prodsReqWhole || 0) + ((prodsReqUpdate.prodsReqSlices || 0) / pair.factor);
            receivedWhole += kitchenProductionQty;
            console.log(`[PRODUCTION OUTLET] Added Prods.Req from reconciliation: ${kitchenProductionQty} (W:${prodsReqUpdate.prodsReqWhole}, S:${prodsReqUpdate.prodsReqSlices})`);
          } else {
            console.log(`[PRODUCTION OUTLET] No Prods.Req reconciliation update found for ${wholeProduct.name}`);
          }
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
        // IMPORTANT: Wastage should be shown under the correct unit conversion
        // If wastage is entered for "Whole" product, it goes to wastageWhole
        // If wastage is entered for "Slice" product, it goes to wastageSlices
        let wastageWhole = 0;
        let wastageSlices = 0;

        const todayChecks = stockChecks
          .filter(c => c.date === date && c.outlet === selectedOutlet && isUserStockCheck(c))
          .sort((a, b) => b.timestamp - a.timestamp);

        if (todayChecks.length > 0) {
          const latestTodayCheck = todayChecks[0];
          const wholeCount = latestTodayCheck.counts.find(c => c.productId === pair.wholeId);
          const slicesCount = latestTodayCheck.counts.find(c => c.productId === pair.slicesId);
          
          // Wastage entered for the "Whole" product goes to wastageWhole column
          if (wholeCount && wholeCount.wastage) {
            wastageWhole = wholeCount.wastage;
            console.log(`Wastage for WHOLE product (${wholeProduct.name}): ${wastageWhole}`);
          }
          
          // Wastage entered for the "Slice" product goes to wastageSlices column
          if (slicesCount && slicesCount.wastage) {
            wastageSlices = slicesCount.wastage;
            const slicesProduct = products.find(p => p.id === pair.slicesId);
            console.log(`Wastage for SLICES product (${slicesProduct?.name}): ${wastageSlices}`);
          }
        }

        // STEP 4: Sold/Transferred
        let soldWhole = 0;
        let soldSlices = 0;

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
          // Sales: use NEW sales reports as primary source (fallback to legacy reconcileHistory)
          const productInfo = products.find(p => p.id === pair.wholeId);
          const isRawMaterial = productInfo && productInfo.type === 'raw';
          const salesReport = salesReports.find(r => r.date === date && r.outlet === selectedOutlet);
          
          if (isRawMaterial) {
            // First try NEW sales report raw consumption
            const wholeRawConsumptionFromReport = salesReport?.rawConsumption?.find(
              rc => rc.rawProductId === pair.wholeId
            );
            const slicesRawConsumptionFromReport = salesReport?.rawConsumption?.find(
              rc => rc.rawProductId === pair.slicesId
            );
            const rawConsumptionFromReport = wholeRawConsumptionFromReport || slicesRawConsumptionFromReport;

            if (rawConsumptionFromReport) {
              soldWhole = rawConsumptionFromReport.consumedWhole || 0;
              soldSlices = rawConsumptionFromReport.consumedSlices || 0;
              console.log(`[SALES OUTLET] Raw consumption from sales report for ${wholeProduct.name}: ${soldWhole}W/${soldSlices}S`);
            } else {
              // Fallback to legacy reconciliation history for backward compatibility
              const reconcileForDate = reconcileHistory.find(
                r => r.outlet === selectedOutlet && r.date === date && !r.deleted
              );

              if (reconcileForDate && reconcileForDate.rawConsumption) {
                const wholeRawConsumption = reconcileForDate.rawConsumption.find(
                rc => rc.rawProductId === pair.wholeId
                );
                const slicesRawConsumption = reconcileForDate.rawConsumption.find(
                rc => rc.rawProductId === pair.slicesId
                );

                const rawConsumption = wholeRawConsumption || slicesRawConsumption;
                if (rawConsumption) {
                  if ('consumedWhole' in rawConsumption && 'consumedSlices' in rawConsumption) {
                    soldWhole = (rawConsumption as any).consumedWhole || 0;
                    soldSlices = (rawConsumption as any).consumedSlices || 0;
                  } else {
                    const consumedQty = (rawConsumption as any).consumed || 0;
                    soldWhole = Math.floor(consumedQty);
                    soldSlices = Math.round((consumedQty % 1) * pair.factor);
                  }
                  console.log(`[SALES OUTLET] Raw consumption from legacy reconciliation for ${wholeProduct.name}: ${soldWhole}W/${soldSlices}S`);
                }
              }
            }
          } else {
            // For menu/kitchen products (not raw materials), get sold data from NEW sales reports
            console.log(`[SALES OUTLET] Product ${wholeProduct.name} on ${date} - checking NEW sales reports`);
            console.log('[SALES OUTLET] Total sales reports:', salesReports.length);
            
            console.log('[SALES OUTLET] Found sales report for date?', !!salesReport);
            
            if (salesReport && salesReport.salesData) {
              console.log('[SALES OUTLET] salesData entries in report:', salesReport.salesData.length);
              console.log('[SALES OUTLET] Sales report updatedAt:', new Date(salesReport.updatedAt).toISOString());
              console.log('[SALES OUTLET] Sales report reconsolidatedAt:', salesReport.reconsolidatedAt);

              const pairSalesEntries = salesReport.salesData.filter(
                sd => sd.productId === pair.wholeId || sd.productId === pair.slicesId
              );

              console.log('[SALES OUTLET] Found pairSalesEntries:', pairSalesEntries.length);

              if (pairSalesEntries.length > 0) {
                const toTotalSlices = (entry: SalesReport['salesData'][number]) =>
                  ((entry.soldWhole || 0) * pair.factor) + (entry.soldSlices || 0);

                let totalSoldSlices = 0;
                const entriesWithSource = pairSalesEntries.filter((entry) => !!entry.sourceUnit);

                if (entriesWithSource.length > 0) {
                  const wholeEntry = entriesWithSource.find(
                    entry => entry.productId === pair.wholeId && entry.sourceUnit === 'whole'
                  );
                  const slicesEntry = entriesWithSource.find(
                    entry => entry.productId === pair.slicesId && entry.sourceUnit === 'slices'
                  );
                  const aggregateEntry = entriesWithSource.find(entry => entry.sourceUnit === 'aggregate');

                  if (wholeEntry) {
                    totalSoldSlices += toTotalSlices(wholeEntry);
                  }
                  if (slicesEntry) {
                    totalSoldSlices += toTotalSlices(slicesEntry);
                  }

                  // Backward compatibility if only aggregate-format data exists.
                  if (!wholeEntry && !slicesEntry && aggregateEntry) {
                    totalSoldSlices += toTotalSlices(aggregateEntry);
                  }

                  // Safety fallback if sourceUnit exists but doesn't match expected shape.
                  if (totalSoldSlices === 0 && entriesWithSource.some(entry => (entry.soldWhole || 0) > 0 || (entry.soldSlices || 0) > 0)) {
                    totalSoldSlices = entriesWithSource.reduce((sum, entry) => sum + toTotalSlices(entry), 0);
                  }
                } else {
                  // Legacy format fallback:
                  // - Old reports could duplicate combined values for both whole/slices IDs.
                  // - Newer/partial data may store separate contributions per unit.
                  const wholeEntry = pairSalesEntries.find(entry => entry.productId === pair.wholeId);
                  const slicesEntry = pairSalesEntries.find(entry => entry.productId === pair.slicesId);
                  let usedLegacyDuplicate = false;

                  const hasLegacyDuplicate =
                    !!wholeEntry &&
                    !!slicesEntry &&
                    (wholeEntry.soldWhole || 0) === (slicesEntry.soldWhole || 0) &&
                    (wholeEntry.soldSlices || 0) === (slicesEntry.soldSlices || 0);

                  if (hasLegacyDuplicate && wholeEntry) {
                    totalSoldSlices = toTotalSlices(wholeEntry);
                    usedLegacyDuplicate = true;
                  } else {
                    totalSoldSlices = pairSalesEntries.reduce((sum, entry) => sum + toTotalSlices(entry), 0);
                  }

                  // Recovery fallback for older reports that stored only one side of whole/slice sales:
                  // Recalculate from reconcileHistory if it provides a richer pair breakdown.
                  if (usedLegacyDuplicate) {
                    const legacyReconcile = reconcileHistory.find(
                      r => r.outlet === selectedOutlet && r.date === date && !r.deleted
                    );

                    if (legacyReconcile?.salesData && legacyReconcile.salesData.length > 0) {
                      const reconcileTotalSlices = legacyReconcile.salesData.reduce((sum, entry) => {
                        if (entry.productId === pair.wholeId) {
                          return sum + ((entry.sold || 0) * pair.factor);
                        }
                        if (entry.productId === pair.slicesId) {
                          return sum + (entry.sold || 0);
                        }
                        return sum;
                      }, 0);

                      if (reconcileTotalSlices > totalSoldSlices) {
                        console.log(
                          `[SALES OUTLET] Using reconcileHistory fallback for ${wholeProduct.name}: ${totalSoldSlices} -> ${reconcileTotalSlices} slices`
                        );
                        totalSoldSlices = reconcileTotalSlices;
                      }
                    }
                  }
                }

                soldWhole = Math.floor(totalSoldSlices / pair.factor);
                soldSlices = Math.round(totalSoldSlices % pair.factor);

                console.log(`[SALES OUTLET] ✓ Aggregated sales from ${pairSalesEntries.length} entries`);
                console.log(`[SALES OUTLET]   Total sold: ${soldWhole}W + ${soldSlices}S (factor ${pair.factor})`);
                pairSalesEntries.forEach((entry) => {
                  console.log(
                    `[SALES OUTLET]   Entry ${entry.productName} (${entry.unit}) id=${entry.productId} source=${entry.sourceUnit || 'legacy'} -> ${entry.soldWhole}W/${entry.soldSlices}S`
                  );
                });
              } else {
                console.log('[SALES OUTLET] ⚠️ No salesData found for either unit');
                console.log('[SALES OUTLET] Looking for wholeId:', pair.wholeId);
                console.log('[SALES OUTLET] Looking for slicesId:', pair.slicesId);
                console.log('[SALES OUTLET] Available products in report:');
                salesReport.salesData.forEach(sd => {
                  console.log(`  - ${sd.productName} (${sd.unit}): ${sd.productId} -> ${sd.soldWhole}W/${sd.soldSlices}S`);
                });
              }
              
              console.log(`[SALES OUTLET] FINAL SOLD for ${wholeProduct.name}: ${soldWhole}W + ${soldSlices}S`);
            } else {
              console.log(`[SALES OUTLET] ⚠️ No sales report found for ${date}`);
              console.log(`[SALES OUTLET] Available sales reports:`);
              salesReports.forEach(sr => {
                console.log(`  - ${sr.outlet} ${sr.date} (${sr.salesData?.length || 0} products)`);
              });
            }
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

      // Filter: Only show products based on their type and settings
      // Menu/Kitchen products: must have showInStock enabled
      // Raw materials: show if salesBasedRawCalc enabled OR appears in any reconciliation rawConsumption
      if (product.type === 'menu' || product.type === 'kitchen') {
        if (!product.showInStock) {
          console.log(`Skipping menu/kitchen product (no conversion) ${product.name} - showInStock is disabled`);
          return;
        }
      } else if (product.type === 'raw') {
        // Check if this raw material appears in any reconciliation data for this outlet
        const appearsInReconciliation = reconcileHistory.some(
          r => r.outlet === selectedOutlet && 
               !r.deleted && 
               r.rawConsumption && 
               r.rawConsumption.some(rc => rc.rawProductId === product.id)
        );
        
        if (!product.salesBasedRawCalc && !appearsInReconciliation) {
          console.log(`Skipping raw material (no conversion) ${product.name} - salesBasedRawCalc is disabled and doesn't appear in reconciliation`);
          return;
        }
        
        if (appearsInReconciliation) {
          console.log(`Including raw material (no conversion) ${product.name} - appears in reconciliation rawConsumption`);
        }
      }

      processedProducts.add(product.id);

      const records: DailyInventoryRecord[] = [];

      dates.forEach((date, dateIndex) => {
        // Opening stock logic
        // NEW BEHAVIOR: Opening stock for ANY day = Previous calendar day's closing (current) stock
        // This creates continuous flow: Day X Closing → Day X+1 Opening
        let opening = 0;
        
        // Get previous calendar day
        const currentDate = new Date(date);
        currentDate.setDate(currentDate.getDate() - 1);
        const previousCalendarDate = currentDate.toISOString().split('T')[0];

        // Find latest stock check from previous calendar day
        const previousDayChecks = stockChecks
          .filter(c => c.date === previousCalendarDate && c.outlet === selectedOutlet && isUserStockCheck(c))
          .sort((a, b) => b.timestamp - a.timestamp);
        
        if (previousDayChecks.length > 0) {
          // Use previous day's closing stock (quantity field) as today's opening
          const latestPreviousDayCheck = previousDayChecks[0];
          const count = latestPreviousDayCheck.counts.find(c => c.productId === product.id);
          
          if (count) {
            opening = count.quantity || 0;
          }
          
          console.log(`Product ${product.name} on ${date} - Opening from ${previousCalendarDate}'s closing: ${opening}`);
        } else {
          // No previous day stock check - opening is 0
          console.log(`Product ${product.name} on ${date} - No stock check for ${previousCalendarDate}, opening = 0`);
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
        
        // CRITICAL FIX: For PRODUCTION outlets, ADD Kitchen Production values from reconciliation (Discrepancies sheet)
        // These are stored as prodsReqUpdates in reconciliation history and should appear in Prods.Req column
        if (outlet?.outletType === 'production') {
          const reconcileCandidates = reconcileHistory
            .filter(r => r.date === date && r.outlet === selectedOutlet && !r.deleted && Array.isArray(r.prodsReqUpdates) && r.prodsReqUpdates.length > 0)
            .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
          const reconcileForDate = reconcileCandidates[0];

          if (reconcileForDate && reconcileForDate.prodsReqUpdates) {
            console.log(`[PRODUCTION OUTLET] Prods.Req reconciliation source: outlet=${reconcileForDate.outlet}, updatedAt=${reconcileForDate.updatedAt}, entries=${reconcileForDate.prodsReqUpdates?.length || 0}`);
            const prodsReqUpdate = reconcileForDate.prodsReqUpdates.find(
              u => u.productId === product.id
            );
            
            if (prodsReqUpdate) {
              // Get conversion factor for this product
              const productPair = productConversions.find(c => c.fromProductId === product.id);
              const conversionFactor = productPair?.conversionFactor || 10;
              
              // Add Kitchen Production values from reconciliation to received/Prods.Req
              const kitchenProductionQty = (prodsReqUpdate.prodsReqWhole || 0) + ((prodsReqUpdate.prodsReqSlices || 0) / conversionFactor);
              console.log(`Product ${product.name} on ${date} - Adding Kitchen Production from reconciliation: ${kitchenProductionQty} (W:${prodsReqUpdate.prodsReqWhole}, S:${prodsReqUpdate.prodsReqSlices})`);
              received += kitchenProductionQty;
            }
          }
        }

        // Wastage from today's check
        let wastage = 0;
        const todayChecks = stockChecks
          .filter(c => c.date === date && c.outlet === selectedOutlet && isUserStockCheck(c))
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
          // Sales: First check if this is a raw material with consumption data from reconciliation
          // For raw materials, use NEW sales report raw consumption first
          const isRawMaterial = product.type === 'raw';
          const salesReport = salesReports.find(r => r.date === date && r.outlet === selectedOutlet);
          
          if (isRawMaterial) {
            const rawConsumptionFromReport = salesReport?.rawConsumption?.find(
              rc => rc.rawProductId === product.id
            );

            if (rawConsumptionFromReport) {
              sold = (rawConsumptionFromReport.consumedWhole || 0) + (rawConsumptionFromReport.consumedSlices || 0);
              console.log(`Raw consumption from sales report for ${product.name}: ${sold}`);
            } else {
              // Fallback to legacy reconciliation history
              const reconcileForDate = reconcileHistory.find(
                r => r.outlet === selectedOutlet && r.date === date && !r.deleted
              );
              const rawConsumption = reconcileForDate?.rawConsumption?.find(
                rc => rc.rawProductId === product.id
              );

              if (rawConsumption) {
                if ('consumedWhole' in rawConsumption && 'consumedSlices' in rawConsumption) {
                  sold = (rawConsumption as any).consumedWhole || 0;
                } else {
                  sold = (rawConsumption as any).consumed || 0;
                }
              }
            }
          } else {
            // For menu/kitchen products, use NEW sales report data first
            const salesDataFromReport = salesReport?.salesData?.find(sd => sd.productId === product.id);
            if (salesDataFromReport) {
              sold = (salesDataFromReport.soldWhole || 0) + (salesDataFromReport.soldSlices || 0);
            } else {
              // Fallback to legacy reconciliation history
              const reconcileForDate = reconcileHistory.find(
                r => r.outlet === selectedOutlet && r.date === date && !r.deleted
              );
              const legacySalesData = reconcileForDate?.salesData?.find(
                sd => sd.productId === product.id
              );
              if (legacySalesData) {
                sold = legacySalesData.sold;
              }
            }
          }
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
              // Current = Opening + Received - Wastage - Sold
              console.log(`Product ${product.name} on ${date} - using formula: Opening(${opening}) + Received(${received}) - Wastage(${wastage}) - Sold(${sold})`);              current = opening + received - wastage - sold;
              console.log(`  Result: ${current}`);
            }
          } else {
            // ALWAYS use formula: Current = Opening + Received - Wastage - Sold
            console.log(`Product ${product.name} on ${date} - using formula (no check): Opening(${opening}) + Received(${received}) - Wastage(${wastage}) - Sold(${sold})`);
            current = opening + received - wastage - sold;
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
  }, [selectedOutlet, selectedDate, dateRange, products, outlets, stockChecks, salesDeductions, productConversions, requests, getDateRange, reconcileHistory, kitchenStockReports, salesReports]);

  console.log('[LIVE INVENTORY] Current inventory history count:', productInventoryHistory.length);
  console.log('[LIVE INVENTORY] Dependencies - stockChecks:', stockChecks.length, 'salesDeductions:', salesDeductions.length, 'requests:', requests.length);
  console.log('[LIVE INVENTORY] Sales deductions for selected outlet:', salesDeductions.filter(s => s.outletName === selectedOutlet).length);
  if (salesDeductions.length > 0 && selectedOutlet) {
    const outletSales = salesDeductions.filter(s => s.outletName === selectedOutlet);
    if (outletSales.length > 0) {
      console.log('[LIVE INVENTORY] Sample sales deductions for', selectedOutlet, ':', outletSales.slice(0, 3).map(s => ({
        date: s.salesDate,
        product: products.find(p => p.id === s.productId)?.name || s.productId,
        whole: s.wholeDeducted,
        slices: s.slicesDeducted
      })));
    } else {
      console.log('[LIVE INVENTORY] ⚠️ No sales deductions found for outlet:', selectedOutlet);
      console.log('[LIVE INVENTORY] Available outlets in sales deductions:', [...new Set(salesDeductions.map(s => s.outletName))]);
    }
  }

  const filteredProductInventoryHistory = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return productInventoryHistory;
    return productInventoryHistory.filter(item => item.productName.toLowerCase().includes(query));
  }, [productInventoryHistory, productSearch]);

  const handleExportDiscrepancies = async () => {
    try {
      if (productInventoryHistory.length === 0) {
        alert('No data to export');
        return;
      }
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
      const todayCheck = stockChecks.find(c => c.date === date && c.outlet === selectedOutlet && isUserStockCheck(c));
      
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

        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by product name"
            placeholderTextColor={Colors.light.muted}
            value={productSearch}
            onChangeText={setProductSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {!selectedOutlet ? (
        <View style={styles.emptyContainer}>
          <TrendingUp size={64} color={Colors.light.muted} />
          <Text style={styles.emptyTitle}>Select an Outlet</Text>
          <Text style={styles.emptyText}>Choose an outlet to view live inventory tracking</Text>
        </View>
      ) : isLoadingData ? (
        <View style={styles.emptyContainer}>
          <TrendingUp size={64} color={Colors.light.muted} />
          <Text style={styles.emptyTitle}>Loading Data...</Text>
          <Text style={styles.emptyText}>Syncing latest reconciliation data from server</Text>
        </View>
      ) : filteredProductInventoryHistory.length === 0 ? (
        <View style={styles.emptyContainer}>
          <TrendingUp size={64} color={Colors.light.muted} />
          <Text style={styles.emptyTitle}>{productSearch.trim() ? 'No Matching Products' : 'No Inventory Data'}</Text>
          <Text style={styles.emptyText}>
            {productSearch.trim()
              ? `No products found for "${productSearch.trim()}"`
              : 'No stock movements found for the selected date range'}
          </Text>
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
                {filteredProductInventoryHistory.map(item => (
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
  searchContainer: {
    marginTop: 2,
  },
  searchInput: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 13,
    color: Colors.light.text,
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
