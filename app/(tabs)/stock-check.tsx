import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator, Modal } from 'react-native';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { ClipboardCheck, MapPin, Check, ChevronLeft, ChevronRight, CalendarDays, Search, Grid } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { CalendarModal } from '@/components/CalendarModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useActivityLog } from '@/contexts/ActivityLogContext';
import { StockCount } from '@/types';
import Colors from '@/constants/colors';
import { exportStockCheckToExcel } from '@/utils/excelExporter';
import { VoiceSearchInput } from '@/components/VoiceSearchInput';
import { useProductUsage } from '@/contexts/ProductUsageContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { ButtonViewMode } from '@/components/ButtonViewMode';
import { saveKitchenStockReportLocally, saveKitchenStockReportToServer, syncAllReconciliationData, KitchenStockReport } from '@/utils/reconciliationSync';
import { useRecipes } from '@/contexts/RecipeContext';
import { useStores } from '@/contexts/StoresContext';

export default function StockCheckScreen() {
  const { products, outlets, saveStockCheck, stockChecks, isLoading, inventoryStocks, productConversions, requests, viewMode, reconcileHistory, syncAll } = useStock();
  const { getSortedProducts, trackUsage } = useProductUsage();
  const { currentUser, isSuperAdmin, enableReceivedAutoLoad } = useAuth();
  const { logActivity } = useActivityLog();
  const { recipes } = useRecipes();
  const { storeProducts } = useStores();
  
  const getProductPairForInventory = useCallback((productId: string) => {
    const fromConversion = productConversions.find(c => c.fromProductId === productId);
    const toConversion = productConversions.find(c => c.toProductId === productId);
    
    if (fromConversion) {
      return { wholeProductId: productId, slicesProductId: fromConversion.toProductId };
    }
    if (toConversion) {
      return { wholeProductId: toConversion.fromProductId, slicesProductId: productId };
    }
    return null;
  }, [productConversions]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [counts, setCounts] = useState<Map<string, string>>(new Map());
  const [openingStocks, setOpeningStocks] = useState<Map<string, string>>(new Map());
  const [receivedStocks, setReceivedStocks] = useState<Map<string, string>>(new Map());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [wastages, setWastages] = useState<Map<string, string>>(new Map());
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const [autoFilledReceivedFields, setAutoFilledReceivedFields] = useState<Set<string>>(new Set());
  const [autoFilledReceivedAmounts, setAutoFilledReceivedAmounts] = useState<Map<string, number>>(new Map());
  const [mismatchedFields, setMismatchedFields] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [filterType, setFilterType] = useState<'all' | 'menu' | 'kitchen' | 'raw'>('all');
  const [selectedOutlet, setSelectedOutlet] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [checkedBy, setCheckedBy] = useState<string>('');

  useEffect(() => {
    const loadOutletSelection = async () => {
      try {
        const savedOutlet = await AsyncStorage.getItem('@stock_check_selected_outlet');
        if (savedOutlet && outlets.find(o => o.name === savedOutlet)) {
          setSelectedOutlet(savedOutlet);
        } else if (outlets.length > 0) {
          setSelectedOutlet(outlets[0].name);
        }
      } catch (error) {
        console.error('Failed to load outlet selection:', error);
      }
    };
    if (outlets.length > 0) {
      loadOutletSelection();
    }
  }, [outlets]);
  const [showOutletModal, setShowOutletModal] = useState<boolean>(false);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [showMismatchDialog, setShowMismatchDialog] = useState<boolean>(false);
  const [mismatchMessage, setMismatchMessage] = useState<string>('');
  const [shouldShowOutletPopup, setShouldShowOutletPopup] = useState<boolean>(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState<boolean>(false);
  const [hasUserInput, setHasUserInput] = useState<boolean>(false);
  const [showNameRequiredDialog, setShowNameRequiredDialog] = useState<boolean>(false);
  const [replaceAllInventory, setReplaceAllInventory] = useState<boolean>(false);

  // Reset toggle to OFF when outlet or date changes
  useEffect(() => {
    console.log('Outlet or date changed - resetting replaceAllInventory toggle to OFF');
    setReplaceAllInventory(false);
  }, [selectedOutlet, selectedDate]);


  const filteredProducts = useMemo(() => {
    let filtered = products.filter(p => p.showInStock !== false);
    
    if (filterType !== 'all') {
      filtered = filtered.filter(p => p.type === filterType);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.category?.toLowerCase().includes(query)
      );
    }
    
    filtered.sort((a, b) => {
      const openingStockA = openingStocks.get(a.id);
      const openingStockB = openingStocks.get(b.id);
      
      const hasStockA = openingStockA && parseFloat(openingStockA) > 0 ? 1 : 0;
      const hasStockB = openingStockB && parseFloat(openingStockB) > 0 ? 1 : 0;
      
      if (hasStockB !== hasStockA) {
        return hasStockB - hasStockA;
      }
      
      const categoryA = a.category || '';
      const categoryB = b.category || '';
      if (categoryA !== categoryB) {
        return categoryA.localeCompare(categoryB);
      }
      
      const typeA = a.type || '';
      const typeB = b.type || '';
      if (typeA !== typeB) {
        return typeA.localeCompare(typeB);
      }
      
      return a.name.localeCompare(b.name);
    });
    
    return filtered;
  }, [products, searchQuery, filterType, openingStocks]);



  const updateCurrentStock = (productId: string, opening: Map<string, string>, received: Map<string, string>, waste: Map<string, string>) => {
    const openingVal = parseFloat(opening.get(productId) || '0') || 0;
    const receivedVal = parseFloat(received.get(productId) || '0') || 0;
    const wastageVal = parseFloat(waste.get(productId) || '0') || 0;
    
    const currentStock = openingVal + receivedVal - wastageVal;
    
    const newCounts = new Map(counts);
    if (currentStock > 0 || openingVal > 0 || receivedVal > 0) {
      newCounts.set(productId, String(currentStock));
    } else {
      newCounts.delete(productId);
    }
    setCounts(newCounts);
  };

  const handleOpeningStockChange = (productId: string, value: string) => {
    setHasUserInput(true);
    if (currentUser?.id && value && parseFloat(value) > 0) {
      trackUsage(currentUser.id, productId);
    }
    const previousCheck = getPreviousDayStockCheck(selectedDate, selectedOutlet);
    const previousClosingStock = previousCheck?.counts.find(c => c.productId === productId)?.quantity;
    
    const newOpeningStocks = new Map(openingStocks);
    if (value === '') {
      newOpeningStocks.delete(productId);
    } else {
      newOpeningStocks.set(productId, value);
    }
    setOpeningStocks(newOpeningStocks);

    const newAutoFilled = new Set(autoFilledFields);
    newAutoFilled.delete(productId);
    setAutoFilledFields(newAutoFilled);

    const newMismatched = new Set(mismatchedFields);
    if (previousClosingStock !== undefined && value !== String(previousClosingStock)) {
      newMismatched.add(productId);
      if (!showMismatchDialog) {
        setMismatchMessage(
          `Opening Stock Mismatch - Previous day's closing stock differs from today's opening stock. Red highlighted cells show the mismatch.`
        );
        setShowMismatchDialog(true);
      }
    } else {
      newMismatched.delete(productId);
    }
    setMismatchedFields(newMismatched);
    
    updateCurrentStock(productId, newOpeningStocks, receivedStocks, wastages);
  };

  const handleReceivedStockChange = (productId: string, value: string) => {
    setHasUserInput(true);
    const newReceivedStocks = new Map(receivedStocks);
    if (value === '') {
      newReceivedStocks.delete(productId);
    } else {
      newReceivedStocks.set(productId, value);
    }
    setReceivedStocks(newReceivedStocks);
    
    // Remove the auto-filled badge when user edits (but keep the amount for later deduction)
    const newAutoFilledReceived = new Set(autoFilledReceivedFields);
    newAutoFilledReceived.delete(productId);
    setAutoFilledReceivedFields(newAutoFilledReceived);
    
    updateCurrentStock(productId, openingStocks, newReceivedStocks, wastages);
  };

  const handleWastageChange = (productId: string, value: string) => {
    setHasUserInput(true);
    const newWastages = new Map(wastages);
    if (value === '') {
      newWastages.delete(productId);
    } else {
      newWastages.set(productId, value);
    }
    setWastages(newWastages);
    updateCurrentStock(productId, openingStocks, receivedStocks, newWastages);
  };

  const handleNoteChange = (productId: string, value: string) => {
    const newNotes = new Map(notes);
    if (value === '') {
      newNotes.delete(productId);
    } else {
      newNotes.set(productId, value);
    }
    setNotes(newNotes);
  };

  const getPreviousDayStockCheck = useCallback((currentDate: string, outletName: string) => {
    // CRITICAL: Get the LATEST (most recent) stock check from history
    // This checks ALL visible (non-deleted) stock checks in history including the current day
    // and finds the LAST one done by a user (not AUTO) by checking both date AND time
    console.log('\n=== getPreviousDayStockCheck: FINDING LATEST STOCK CHECK ===');
    console.log('getPreviousDayStockCheck: Target outlet:', outletName);
    console.log('getPreviousDayStockCheck: Current date:', currentDate);
    console.log('getPreviousDayStockCheck: Total stock checks in memory:', stockChecks.length);
    
    // Filter all stock checks for this outlet from ALL history
    // CRITICAL: Include current day checks BUT only those done BEFORE now (by timestamp)
    // Exclude AUTO checks and deleted checks
    // IMPORTANT: Check ALL stock checks in history, including current day
    const currentTimestamp = Date.now();
    const allChecksForOutlet = stockChecks.filter(
      check => {
        // Must be same outlet
        if (check.outlet !== outletName) return false;
        // Must not be deleted
        if (check.deleted) return false;
        // Must be before current date OR (same date AND done before now)
        if (check.date < currentDate) return true;
        if (check.date === currentDate && check.timestamp < currentTimestamp) return true;
        return false;
      }
    );
    
    console.log('getPreviousDayStockCheck: Found', allChecksForOutlet.length, 'stock checks for outlet', outletName);
    console.log('getPreviousDayStockCheck: (including deleted=false checks from ALL history up to now)');
    
    if (allChecksForOutlet.length === 0) {
      console.log('getPreviousDayStockCheck: ⚠️ NO stock checks found in history for this outlet');
      console.log('=== getPreviousDayStockCheck: DONE (no checks found) ===\n');
      return undefined;
    }
    
    // CRITICAL: Sort by date DESC, then by timestamp DESC to get the LATEST check
    // This ensures we get the most recent check even if there are multiple checks on the same day
    console.log('getPreviousDayStockCheck: Sorting checks to find the LATEST one...');
    console.log('getPreviousDayStockCheck: Available checks BEFORE sorting:');
    allChecksForOutlet.forEach((check, i) => {
      console.log(`  [${i}] Date: ${check.date}, Time: ${new Date(check.timestamp).toLocaleTimeString()}, By: ${check.completedBy}, Products: ${check.counts.length}`);
    });
    
    allChecksForOutlet.sort((a, b) => {
      // First sort by date (descending) - most recent date first
      const dateCompare = (b.date || '').localeCompare(a.date || '');
      if (dateCompare !== 0) return dateCompare;
      // Then by timestamp (descending) - CRITICAL for same-day multiple checks
      // Most recent timestamp first
      return b.timestamp - a.timestamp;
    });
    
    console.log('getPreviousDayStockCheck: Available checks AFTER sorting (latest first):');
    allChecksForOutlet.forEach((check, i) => {
      console.log(`  [${i}] Date: ${check.date}, Time: ${new Date(check.timestamp).toLocaleTimeString()}, By: ${check.completedBy}, Products: ${check.counts.length}`);
    });
    
    const latestCheck = allChecksForOutlet[0];
    console.log('\ngetPreviousDayStockCheck: ✓✓✓ LATEST STOCK CHECK SELECTED:');
    console.log('  Date:', latestCheck.date);
    console.log('  Timestamp:', latestCheck.timestamp, '(' + new Date(latestCheck.timestamp).toLocaleString() + ')');
    console.log('  Time:', new Date(latestCheck.timestamp).toLocaleTimeString());
    console.log('  Outlet:', latestCheck.outlet);
    console.log('  CompletedBy:', latestCheck.completedBy);
    console.log('  Products count:', latestCheck.counts.length);
    console.log('  This is the MOST RECENT stock check by date AND time');
    console.log('  (If multiple checks exist on same day, this is the LAST one done)');
    console.log('=== getPreviousDayStockCheck: DONE ===\n');
    
    return latestCheck;
  }, [stockChecks]);

  useEffect(() => {
    const checkFirstStockCheckOfDay = async () => {
      const today = new Date().toISOString().split('T')[0];
      const lastPromptDate = await AsyncStorage.getItem('@stock_check_last_outlet_prompt_date');
      
      if (lastPromptDate !== today) {
        console.log('First stock check of the day, showing outlet selection popup');
        setShouldShowOutletPopup(true);
        await AsyncStorage.setItem('@stock_check_last_outlet_prompt_date', today);
      }
    };
    
    checkFirstStockCheckOfDay();
  }, []);

  useEffect(() => {
    console.log('===== STOCK CHECK AUTO-FILL useEffect TRIGGERED =====');
    console.log('Checking for auto-fill: outlet:', selectedOutlet, 'date:', selectedDate);
    console.log('hasUserInput:', hasUserInput);
    console.log('replaceAllInventory toggle state:', replaceAllInventory);
    
    if (!selectedOutlet || !selectedDate) {
      console.log('No outlet or date selected, clearing form');
      setCounts(new Map());
      setOpeningStocks(new Map());
      setReceivedStocks(new Map());
      setAutoFilledFields(new Set());
      setAutoFilledReceivedFields(new Set());
      setMismatchedFields(new Set());
      setHasUserInput(false);
      console.log('Resetting replaceAllInventory toggle because outlet/date cleared');
      setReplaceAllInventory(false);
      return;
    }

    if (hasUserInput) {
      console.log('User has input, skipping auto-fill to preserve data');
      return;
    }

    console.log('Loading from inventory for outlet:', selectedOutlet);

    const newOpeningStocks = new Map<string, string>();
    const newReceivedStocks = new Map<string, string>();
    const newCounts = new Map<string, string>();
    const newAutoFilled = new Set<string>();
    const newAutoFilledReceived = new Set<string>();
    const newMismatchedFields = new Set<string>();

    const outlet = outlets.find(o => o.name === selectedOutlet);
    if (!outlet) {
      console.log('Outlet not found:', selectedOutlet);
      console.log('Available outlets:', outlets.map(o => `${o.name} (${o.outletType})`).join(', '));
      setCounts(new Map());
      setOpeningStocks(new Map());
      setReceivedStocks(new Map());
      setAutoFilledFields(new Set());
      setAutoFilledReceivedFields(new Set());
      setMismatchedFields(new Set());
      return;
    }

    console.log('Found outlet:', outlet.name, 'type:', outlet.outletType);

    // LOAD FROM INVENTORY SYSTEM - For ALL outlets (sales and production)
    // This loads the displayed inventory amount for opening stock
    console.log('\n=== LOADING FROM INVENTORY SYSTEM ===');
    console.log('Loading opening stock from inventory for outlet:', selectedOutlet);
    console.log('Selected date:', selectedDate);

    // Load from inventory for ALL outlets (sales AND production)
    // For ALL products (with and without conversions)
    console.log('Loading from inventory system for outlet:', selectedOutlet);
    console.log('Outlet type:', outlet.outletType);
    console.log('Total inventoryStocks:', inventoryStocks.length);
    
    if (outlet.outletType === 'production') {
      console.log('Production outlet - loading from production inventory columns');
      
      // For products WITH conversions, read from production columns
      inventoryStocks.forEach(invStock => {
        const product = products.find(p => p.id === invStock.productId);
        if (!product) return;
        
        const productPair = getProductPairForInventory(invStock.productId);
        if (productPair) {
          const wholeProduct = products.find(p => p.id === productPair.wholeProductId);
          const slicesProduct = products.find(p => p.id === productPair.slicesProductId);
          
          // Use production columns
          let wholeQty = invStock.productionWhole || 0;
          let slicesQty = invStock.productionSlices || 0;
          
          console.log('Product with conversion:', wholeProduct?.name, 'whole:', wholeQty, 'slices:', slicesQty);
          
          if (wholeProduct && wholeQty > 0) {
            newOpeningStocks.set(wholeProduct.id, String(wholeQty));
            newAutoFilled.add(wholeProduct.id);
            newCounts.set(wholeProduct.id, String(wholeQty));
            console.log('✓ Loaded whole from inventory:', wholeProduct.name, 'qty:', wholeQty);
          }
          
          if (slicesProduct && slicesQty > 0) {
            newOpeningStocks.set(slicesProduct.id, String(slicesQty));
            newAutoFilled.add(slicesProduct.id);
            newCounts.set(slicesProduct.id, String(slicesQty));
            console.log('✓ Loaded slices from inventory:', slicesProduct.name, 'qty:', slicesQty);
          }
        }
      });
      
      // For products WITHOUT conversions, read from production columns
      console.log('Loading products WITHOUT conversions from production inventory');
      inventoryStocks.forEach(invStock => {
        const product = products.find(p => p.id === invStock.productId);
        if (!product) return;
        
        const hasConversion = productConversions.some(
          c => c.fromProductId === product.id || c.toProductId === product.id
        );
        
        if (!hasConversion) {
          const qty = invStock.productionWhole || 0;
          console.log('Product without conversion:', product.name, 'qty:', qty);
          
          if (qty > 0) {
            newOpeningStocks.set(invStock.productId, String(qty));
            newAutoFilled.add(invStock.productId);
            newCounts.set(invStock.productId, String(qty));
            console.log('✓ Loaded from inventory (no conversion):', product.name, 'qty:', qty);
          }
        }
      });
    } else if (outlet.outletType === 'sales') {
      console.log('Sales outlet - loading from outlet-specific inventory columns');
      
      // For products WITH conversions, read from outletStocks
      inventoryStocks.forEach(invStock => {
        const outletStock = invStock.outletStocks.find(os => os.outletName === selectedOutlet);
        if (!outletStock) return;
        
        const productPair = getProductPairForInventory(invStock.productId);
        if (productPair) {
          const wholeProduct = products.find(p => p.id === productPair.wholeProductId);
          const slicesProduct = products.find(p => p.id === productPair.slicesProductId);
          
          console.log('Product with conversion:', wholeProduct?.name, 'whole:', outletStock.whole, 'slices:', outletStock.slices);
          
          if (wholeProduct && outletStock.whole > 0) {
            newOpeningStocks.set(wholeProduct.id, String(outletStock.whole));
            newAutoFilled.add(wholeProduct.id);
            newCounts.set(wholeProduct.id, String(outletStock.whole));
            console.log('✓ Loaded whole from inventory:', wholeProduct.name, 'qty:', outletStock.whole);
          }
          
          if (slicesProduct && outletStock.slices > 0) {
            newOpeningStocks.set(slicesProduct.id, String(outletStock.slices));
            newAutoFilled.add(slicesProduct.id);
            newCounts.set(slicesProduct.id, String(outletStock.slices));
            console.log('✓ Loaded slices from inventory:', slicesProduct.name, 'qty:', outletStock.slices);
          }
        }
      });
      
      // For products WITHOUT conversions, read from outletStocks
      console.log('Loading products WITHOUT conversions from sales outlet inventory');
      inventoryStocks.forEach(invStock => {
        const product = products.find(p => p.id === invStock.productId);
        if (!product) return;
        
        const hasConversion = productConversions.some(
          c => c.fromProductId === product.id || c.toProductId === product.id
        );
        
        if (!hasConversion) {
          const outletStock = invStock.outletStocks.find(os => os.outletName === selectedOutlet);
          if (outletStock && outletStock.whole > 0) {
            console.log('Product without conversion:', product.name, 'qty:', outletStock.whole);
            newOpeningStocks.set(invStock.productId, String(outletStock.whole));
            newAutoFilled.add(invStock.productId);
            newCounts.set(invStock.productId, String(outletStock.whole));
            console.log('✓ Loaded from inventory (no conversion):', product.name, 'qty:', outletStock.whole);
          }
        }
      });
    }
    
    console.log('=== INVENTORY LOADING COMPLETE ===');
    console.log('Loaded', newOpeningStocks.size, 'products from inventory');
    console.log('===================================\n');

    // Auto-fill received stocks from Prods.Req for production outlets
    // THIS IS CRITICAL: We load received from inventoryStocks.prodsReqWhole / productionRequest fields
    // RESPECT the "Enable Received Auto Load" setting
    if (outlet.outletType === 'production' && enableReceivedAutoLoad) {
      console.log('\n=== AUTO-FILLING RECEIVED STOCKS FROM PRODS.REQ (INVENTORY) ===');
      console.log('Production outlet:', selectedOutlet, 'outlet type:', outlet.outletType);
      console.log('Selected date:', selectedDate);
      console.log('Total inventory stocks:', inventoryStocks.length);
      console.log('Total products:', products.length);
      console.log('Inventory stocks details:');
      inventoryStocks.forEach(inv => {
        const prod = products.find(p => p.id === inv.productId);
        console.log('  - Product:', prod?.name, 'prodsReqWhole:', inv.prodsReqWhole, 'productionRequest:', inv.productionRequest);
      });
      
      let receivedCount = 0;
      // Read from inventory stocks - Prods.Req column
      inventoryStocks.forEach(invStock => {
        const product = products.find(p => p.id === invStock.productId);
        if (!product) {
          console.log('Skipping inventory stock - product not found for ID:', invStock.productId);
          return;
        }
        
        console.log('\nProcessing product:', product.name);
        console.log('  prodsReqWhole:', invStock.prodsReqWhole);
        console.log('  productionRequest:', invStock.productionRequest);
        
        // Find the whole product if this is a conversion product
        const productPair = getProductPairForInventory(invStock.productId);
        console.log('  productPair:', productPair ? 'YES (wholeId=' + productPair.wholeProductId + ')' : 'NO');
        
        if (productPair) {
          // Products with conversions - use prodsReqWhole field
          const wholeProduct = products.find(p => p.id === productPair.wholeProductId);
          const prodsReqQty = invStock.prodsReqWhole || 0;
          
          console.log('  Whole product:', wholeProduct?.name, 'prodsReqQty:', prodsReqQty);
          
          if (wholeProduct && prodsReqQty > 0) {
            console.log('  ✅ AUTO-FILLING received for WHOLE product:', wholeProduct.name, 'qty:', prodsReqQty, 'from prodsReqWhole');
            
            // Override any existing value - THIS IS PRIORITY
            newReceivedStocks.set(wholeProduct.id, String(prodsReqQty));
            newAutoFilledReceived.add(wholeProduct.id);
            
            // No need to track separately - already in newReceivedStocks
            
            receivedCount++;
            
            // Update counts to include the auto-filled received stock
            const opening = parseFloat(newOpeningStocks.get(wholeProduct.id) || '0') || 0;
            const received = prodsReqQty;
            const wastage = 0;
            const currentStock = opening + received - wastage;
            newCounts.set(wholeProduct.id, String(currentStock));
            
            console.log('  Set received stock for', wholeProduct.name, '- opening:', opening, 'received:', received, 'current:', currentStock);
          } else if (wholeProduct && prodsReqQty === 0) {
            console.log('  ⚠️ Whole product found but prodsReqQty is 0 or undefined');
          } else if (!wholeProduct) {
            console.log('  ⚠️ prodsReqQty > 0 but whole product not found');
          }
        } else {
          // Products without conversions - use productionRequest field
          const prodReqQty = invStock.productionRequest || 0;
          
          console.log('  No conversion pair, using productionRequest:', prodReqQty);
          
          if (prodReqQty > 0) {
            console.log('  ✅ AUTO-FILLING received for product (no conversion):', product.name, 'qty:', prodReqQty, 'from productionRequest');
            
            // Override any existing value - THIS IS PRIORITY
            newReceivedStocks.set(product.id, String(prodReqQty));
            newAutoFilledReceived.add(product.id);
            
            // No need to track separately - already in newReceivedStocks
            
            receivedCount++;
            
            // Update counts to include the auto-filled received stock
            const opening = parseFloat(newOpeningStocks.get(product.id) || '0') || 0;
            const received = prodReqQty;
            const wastage = 0;
            const currentStock = opening + received - wastage;
            newCounts.set(product.id, String(currentStock));
            
            console.log('  Set received stock for', product.name, '- opening:', opening, 'received:', received, 'current:', currentStock);
          } else {
            console.log('  ⚠️ productionRequest is 0 or undefined');
          }
        }
      });
      
      console.log('\n=== FINISHED AUTO-FILLING RECEIVED STOCKS ===');
      console.log('Total products processed with received stocks:', receivedCount);
      console.log('Auto-filled received fields count:', newAutoFilledReceived.size);
      console.log('Received stocks map size:', newReceivedStocks.size);
      console.log('===================================================\n');
    } else {
      if (outlet.outletType === 'production' && !enableReceivedAutoLoad) {
        console.log('Outlet is production type BUT "Enable Received Auto Load" is DISABLED - skipping Prods.Req auto-fill');
        console.log('enableReceivedAutoLoad setting:', enableReceivedAutoLoad);
      } else {
        console.log('Outlet is NOT production type - skipping Prods.Req auto-fill');
        console.log('Outlet type:', outlet?.outletType);
      }
    }

    console.log('\n=== SETTING STATE ===');
    console.log('Setting openingStocks with', newOpeningStocks.size, 'items');
    console.log('Setting receivedStocks with', newReceivedStocks.size, 'items');
    console.log('Setting counts with', newCounts.size, 'items');
    console.log('Setting autoFilledFields with', newAutoFilled.size, 'items');
    console.log('Setting autoFilledReceivedFields with', newAutoFilledReceived.size, 'items');
    console.log('=====================\n');
    
    setOpeningStocks(newOpeningStocks);
    setReceivedStocks(newReceivedStocks);
    setCounts(newCounts);
    setAutoFilledFields(newAutoFilled);
    setAutoFilledReceivedFields(newAutoFilledReceived);
    setMismatchedFields(newMismatchedFields);
    
    // Build the auto-filled amounts map based on what was actually auto-filled
    const autoFilledAmountsMap = new Map<string, number>();
    inventoryStocks.forEach(invStock => {
      const product = products.find(p => p.id === invStock.productId);
      if (!product) return;
      
      const productPair = getProductPairForInventory(invStock.productId);
      if (productPair) {
        const wholeProduct = products.find(p => p.id === productPair.wholeProductId);
        const prodsReqQty = invStock.prodsReqWhole || 0;
        
        if (wholeProduct && prodsReqQty > 0 && newAutoFilledReceived.has(wholeProduct.id)) {
          autoFilledAmountsMap.set(wholeProduct.id, prodsReqQty);
          console.log('Tracking auto-filled amount for', wholeProduct.name, ':', prodsReqQty);
        }
      } else {
        const prodReqQty = invStock.productionRequest || 0;
        
        if (prodReqQty > 0 && newAutoFilledReceived.has(product.id)) {
          autoFilledAmountsMap.set(product.id, prodReqQty);
          console.log('Tracking auto-filled amount for', product.name, ':', prodReqQty);
        }
      }
    });
    setAutoFilledReceivedAmounts(autoFilledAmountsMap);
    
    console.log('Auto-filled', newAutoFilled.size, 'products from inventory for outlet:', selectedOutlet);
    console.log('===== STOCK CHECK AUTO-FILL useEffect COMPLETE =====\n');
  }, [selectedDate, selectedOutlet, inventoryStocks, stockChecks, products, outlets, productConversions, getProductPairForInventory, hasUserInput, requests, enableReceivedAutoLoad]);



  const handleSave = async () => {
    if (isSaving) {
      console.log('Already saving, ignoring duplicate submission');
      return;
    }

    if (!selectedOutlet || selectedOutlet.trim() === '') {
      Alert.alert('Error', 'Please select an outlet before submitting.');
      return;
    }

    if (!selectedDate || selectedDate.trim() === '') {
      Alert.alert('Error', 'Please select a date before submitting.');
      return;
    }

    const trimmedName = checkedBy?.trim() || '';
    console.log('Checked by value:', checkedBy, 'trimmed:', trimmedName);
    if (!trimmedName || trimmedName === '') {
      console.log('Name is empty - showing dialog');
      setShowNameRequiredDialog(true);
      return;
    }
    console.log('Name validation passed, proceeding with submission');

    if (counts.size === 0) {
      Alert.alert('No Data', 'Please enter at least one stock count before saving.');
      return;
    }



    performSave();
  };

  const performSave = async () => {
    try {
      console.log('Starting performSave...');
      setIsSaving(true);
      
      // Capture the replaceAllInventory flag BEFORE any state changes
      const shouldReplaceAllInventory = replaceAllInventory;
      console.log('performSave: replaceAllInventory flag captured:', shouldReplaceAllInventory);
      
      // Important: Keep the toggle ON during the save process
      // It will be reset after inventory update completes
      
      const stockCounts: StockCount[] = Array.from(counts.entries())
        .map(([productId, countStr]) => ({
          productId,
          quantity: parseFloat(countStr) || 0,
          openingStock: openingStocks.has(productId) ? parseFloat(openingStocks.get(productId)!) || 0 : undefined,
          receivedStock: receivedStocks.has(productId) ? parseFloat(receivedStocks.get(productId)!) || 0 : undefined,
          wastage: wastages.has(productId) ? parseFloat(wastages.get(productId)!) || 0 : undefined,
          notes: notes.get(productId),
          // Include auto-filled amount for Prod.Req deduction
          autoFilledReceivedFromProdReq: autoFilledReceivedAmounts.has(productId) ? autoFilledReceivedAmounts.get(productId) : undefined,
        }))
        .filter(count => count.quantity > 0);

      console.log('Stock counts prepared (filtered):', stockCounts.length);

      const todayIso = new Date().toISOString().split('T')[0];
      const stockCheck = {
        id: `check-${Date.now()}`,
        date: selectedDate,
        timestamp: Date.now(),
        counts: stockCounts,
        outlet: selectedOutlet,
        doneDate: todayIso,
        completedBy: checkedBy.trim(),
        replaceAllInventory: shouldReplaceAllInventory,
      };
      
      console.log('performSave: Stock check object created with replaceAllInventory:', stockCheck.replaceAllInventory);

      console.log('Saving stock check to storage with replaceAllInventory:', stockCheck.replaceAllInventory);
      console.log('performSave: Toggle state before save:', replaceAllInventory);
      await saveStockCheck(stockCheck);
      console.log('Stock check saved successfully');
      console.log('performSave: Inventory replacement completed for outlet:', selectedOutlet);
      
      // CRITICAL: Create and save kitchen stock report for production outlets
      const outlet = outlets.find(o => o.name === selectedOutlet);
      if (outlet && outlet.outletType === 'production') {
        console.log('\n=== CREATING KITCHEN STOCK REPORT FOR PRODUCTION OUTLET ===');
        console.log('Outlet:', selectedOutlet, 'Date:', selectedDate);
        
        try {
          // Build products array from stock counts - CRITICAL: Use receivedStock (Kitchen Production / Column K)
          const productsForReport = stockCounts
            .filter(count => count.receivedStock && count.receivedStock > 0)
            .map(count => {
              const product = products.find(p => p.id === count.productId);
              const productPair = productConversions.find(
                c => c.fromProductId === count.productId || c.toProductId === count.productId
              );
              
              // Determine if this is whole or slices product
              let quantityWhole = 0;
              let quantitySlices = 0;
              
              if (productPair) {
                // Product with conversion
                const isWholeProduct = productPair.fromProductId === count.productId;
                
                if (isWholeProduct) {
                  quantityWhole = count.receivedStock || 0;
                } else {
                  quantitySlices = count.receivedStock || 0;
                }
              } else {
                // Product without conversion - treat as whole
                quantityWhole = count.receivedStock || 0;
              }
              
              console.log(`  Product: ${product?.name}, received: ${count.receivedStock}, quantityWhole: ${quantityWhole}, quantitySlices: ${quantitySlices}`);
              
              return {
                productId: count.productId,
                productName: product?.name || 'Unknown',
                unit: product?.unit || 'units',
                quantityWhole,
                quantitySlices,
              };
            });
          
          console.log('Products for report (with received stock):', productsForReport.length);
          
          const now = Date.now();
          const reconsolidatedAt = new Date().toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).replace(',', '');
          
          const kitchenReport: KitchenStockReport = {
            id: `kitchen-${now}-${Math.random().toString(36).substr(2, 9)}`,
            outlet: selectedOutlet,
            date: selectedDate,
            timestamp: now,
            reconsolidatedAt,
            products: productsForReport,
            updatedAt: now,
          };
          
          console.log('Kitchen report products:', productsForReport.length);
          
          // Save locally
          await saveKitchenStockReportLocally(kitchenReport);
          console.log('✓ Kitchen stock report saved locally');
          
          // Push to server immediately
          console.log('Pushing kitchen stock report to server...');
          const serverSaved = await saveKitchenStockReportToServer(kitchenReport);
          
          if (serverSaved) {
            console.log('✓ Kitchen stock report synced to server');
          } else {
            console.log('⚠️ Failed to sync kitchen stock report to server, will retry later');
          }
          
          // Sync all reconciliation data
          console.log('Syncing all reconciliation data...');
          await syncAllReconciliationData();
          await syncAll(false);
          console.log('✓ Reconciliation data synced');
        } catch (reportError) {
          console.error('Failed to save kitchen stock report:', reportError);
        }
        
        console.log('=== KITCHEN STOCK REPORT SAVE COMPLETE ===\n');
      }
      
      // Log the activity
      if (logActivity) {
        try {
          await logActivity(
            'stock_check',
            selectedOutlet,
            `Stock check completed with ${stockCounts.length} items`,
            {
              itemCount: stockCounts.length,
              completedBy: checkedBy.trim(),
              stockCheckDate: selectedDate,
              replaceAllInventory: shouldReplaceAllInventory,
            }
          );
          console.log('Stock check activity logged successfully');
        } catch (logError) {
          console.error('Failed to log stock check activity:', logError);
        }
      }
      
      // Reset all form state AFTER successful save AND inventory update
      console.log('performSave: Resetting form state...');
      setCounts(new Map());
      setOpeningStocks(new Map());
      setReceivedStocks(new Map());
      setNotes(new Map());
      setWastages(new Map());
      setAutoFilledFields(new Set());
      setAutoFilledReceivedFields(new Set());
      setAutoFilledReceivedAmounts(new Map());
      setMismatchedFields(new Set());
      setHasUserInput(false);
      setCheckedBy('');
      // Toggle will be automatically reset by useEffect when outlet/date changes
      console.log('performSave: All form state reset (replaceAllInventory toggle managed by useEffect)');
      
      setIsSaving(false);

      // Automatically export stock check to Excel
      console.log('performSave: Starting automatic Excel export...');
      try {
        await exportStockCheckToExcel(
          stockCheck,
          products,
          recipes,
          storeProducts,
          productConversions
        );
        console.log('performSave: ✓ Excel export completed successfully');
        Alert.alert('Success', 'Stock check saved and exported successfully!');
      } catch (exportError) {
        console.error('performSave: Excel export failed:', exportError);
        Alert.alert('Success', 'Stock check saved successfully! However, Excel export failed. You can export it from the History tab.');
      }
    } catch (error) {
      console.error('Save error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setIsSaving(false);
      Alert.alert('Error', `Failed to save stock check: ${errorMessage}. Please try again.`);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  const handleButtonModeAddStock = async (productId: string, data: any) => {
    const { openingStock, receivedStock, wastage, comments } = data;
    
    if (currentUser?.id && (parseFloat(openingStock) > 0 || parseFloat(receivedStock) > 0)) {
      trackUsage(currentUser.id, productId);
    }
    
    try {
      const existingCheck = stockChecks.find(
        check => check.date === selectedDate && check.outlet === selectedOutlet && !check.deleted
      );

      const opening = parseFloat(openingStock) || 0;
      const received = parseFloat(receivedStock) || 0;
      const waste = parseFloat(wastage) || 0;
      const currentStock = opening + received - waste;

      if (currentStock === 0 && opening === 0 && received === 0) {
        Alert.alert('Notice', 'No stock values entered.');
        return;
      }

      const newCount: StockCount = {
        productId: productId,
        quantity: currentStock,
        openingStock: opening > 0 ? opening : undefined,
        receivedStock: received > 0 ? received : undefined,
        wastage: waste > 0 ? waste : undefined,
        notes: comments || undefined,
      };

      const todayIso = new Date().toISOString().split('T')[0];

      if (existingCheck) {
        console.log('Button mode: Found existing stock check for', selectedOutlet, selectedDate, '- updating...');
        
        const updatedCounts = [...existingCheck.counts];
        const existingCountIndex = updatedCounts.findIndex(c => c.productId === productId);
        
        if (existingCountIndex >= 0) {
          const existingCount = updatedCounts[existingCountIndex];
          updatedCounts[existingCountIndex] = {
            productId: productId,
            quantity: currentStock,
            openingStock: opening > 0 ? opening : existingCount.openingStock,
            receivedStock: (existingCount.receivedStock || 0) + received,
            wastage: (existingCount.wastage || 0) + waste,
            notes: comments || existingCount.notes,
          };
          console.log('Button mode: Updated existing product entry');
        } else {
          updatedCounts.push(newCount);
          console.log('Button mode: Added new product to existing check');
        }
        
        const updatedStockCheck = {
          ...existingCheck,
          counts: updatedCounts,
          timestamp: Date.now(),
          doneDate: todayIso,
          updatedAt: Date.now(),
        };
        
        await saveStockCheck(updatedStockCheck);
        console.log('Button mode: Stock check updated successfully');
        
        // Log the activity
        if (logActivity) {
          try {
            const product = products.find(p => p.id === productId);
            await logActivity(
              'stock_check',
              selectedOutlet,
              `Updated stock for ${product?.name || 'Unknown'}`,
              {
                productId,
                productName: product?.name,
                openingStock: opening,
                receivedStock: received,
                wastage: waste,
                currentStock,
              }
            );
          } catch (logError) {
            console.error('Failed to log stock check activity:', logError);
          }
        }
      } else {
        console.log('Button mode: No existing stock check found - creating new one...');
        const stockCheck = {
          id: `check-${Date.now()}`,
          date: selectedDate,
          timestamp: Date.now(),
          counts: [newCount],
          outlet: selectedOutlet,
          doneDate: todayIso,
          updatedAt: Date.now(),
        };
        
        await saveStockCheck(stockCheck);
        console.log('Button mode: New stock check created successfully');
        
        // Log the activity
        if (logActivity) {
          try {
            const product = products.find(p => p.id === productId);
            await logActivity(
              'stock_check',
              selectedOutlet,
              `New stock entry for ${product?.name || 'Unknown'}`,
              {
                productId,
                productName: product?.name,
                openingStock: opening,
                receivedStock: received,
                wastage: waste,
                currentStock,
              }
            );
          } catch (logError) {
            console.error('Failed to log stock check activity:', logError);
          }
        }
      }
      
      Alert.alert('Success', 'Stock entry saved and inventory updated!');
    } catch (error) {
      console.error('Button mode save error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Error', `Failed to save stock entry: ${errorMessage}. Please try again.`);
    }
  };

  if (products.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <ClipboardCheck size={64} color={Colors.light.muted} />
        <Text style={styles.emptyTitle}>No Products</Text>
        <Text style={styles.emptyText}>Import products from Excel to start checking stock</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

        {viewMode === 'button' ? (
          <ButtonViewMode
            products={products}
            filterType={filterType}
            productConversions={productConversions}
            onAddStock={handleButtonModeAddStock}
            mode="stockCheck"
            selectedOutlet={selectedOutlet}
            setSelectedOutlet={setSelectedOutlet}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            outlets={outlets}
          />
        ) : (
        <>
        <View style={styles.topBar}>
          <TouchableOpacity 
            style={styles.outletSelector}
            onPress={() => setShowOutletModal(true)}
          >
            <MapPin size={16} color={Colors.light.tint} />
            <View style={styles.outletInfo}>
              <Text style={styles.outletLabel}>Outlet</Text>
              <Text style={styles.outletValue}>{selectedOutlet}</Text>
            </View>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>
          <View style={styles.dateSelector}>
            <TouchableOpacity onPress={() => setShowCalendar(true)} style={{ padding: 4 }} testID="open-calendar-stock">
              <CalendarDays size={16} color={Colors.light.tint} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              setSelectedDate(`${y}-${m}-${day}`);
            }} style={styles.chevBtn}>
              <ChevronLeft size={16} color={Colors.light.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCalendar(true)}>
              <Text style={styles.dateText}>{selectedDate}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              setSelectedDate(`${y}-${m}-${day}`);
            }} style={styles.chevBtn}>
              <ChevronRight size={16} color={Colors.light.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.checkedByContainer}>
            <Text style={styles.checkedByLabel}>Checked By</Text>
            <TextInput
              style={styles.checkedByInput}
              placeholder="Enter your name"
              value={checkedBy}
              onChangeText={setCheckedBy}
              placeholderTextColor={Colors.light.muted}
            />
          </View>
          {isSuperAdmin && (
            <TouchableOpacity 
              style={[styles.inventoryToggleContainer, replaceAllInventory && styles.inventoryToggleActive]}
              onPress={() => setReplaceAllInventory(!replaceAllInventory)}
            >
              <Text style={[styles.inventoryToggleLabel, replaceAllInventory && styles.inventoryToggleLabelActive]}>
                Replace All Inventory
              </Text>
              <View style={[styles.inventoryToggle, replaceAllInventory && styles.inventoryToggleOn]}>
                <View style={[styles.inventoryToggleThumb, replaceAllInventory && styles.inventoryToggleThumbOn]} />
              </View>
            </TouchableOpacity>
          )}
        </View>
        
        <View style={styles.searchContainer}>
          <VoiceSearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search products..."
            placeholderTextColor={Colors.light.muted}
            style={styles.searchBar}
            inputStyle={styles.searchInput}
          />
        </View>

        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={[styles.filterButton, filterType === 'all' && styles.filterButtonActive]}
            onPress={() => setFilterType('all')}
          >
            <Text style={[styles.filterText, filterType === 'all' && styles.filterTextActive]}>
              All ({products.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, filterType === 'menu' && styles.filterButtonActive]}
            onPress={() => setFilterType('menu')}
          >
            <Text style={[styles.filterText, filterType === 'menu' && styles.filterTextActive]}>
              Menu ({products.filter(p => p.type === 'menu').length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, filterType === 'kitchen' && styles.filterButtonActive]}
            onPress={() => setFilterType('kitchen')}
          >
            <Text style={[styles.filterText, filterType === 'kitchen' && styles.filterTextActive]}>
              Kitchen ({products.filter(p => p.type === 'kitchen').length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, filterType === 'raw' && styles.filterButtonActive]}
            onPress={() => setFilterType('raw')}
          >
            <Text style={[styles.filterText, filterType === 'raw' && styles.filterTextActive]}>
              Raw ({products.filter(p => p.type === 'raw').length})
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {filteredProducts.map((product, index) => {
            const prevProduct = index > 0 ? filteredProducts[index - 1] : null;
            const showCategoryHeader = !prevProduct || prevProduct.category !== product.category;

            return (
              <View key={product.id}>
                {showCategoryHeader && product.category && (
                  <Text style={styles.categoryHeader}>{product.category}</Text>
                )}
                <View style={styles.productCard} testID={`product-card-${product.id}`}>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{product.name}</Text>
                    <Text style={styles.productUnit}>Unit: {product.unit}</Text>
                  </View>
                  <View style={styles.inputContainer}>
                    <View style={styles.inputRow}>
                      <View style={styles.inputField}>
                        <View style={styles.labelWithBadge}>
                          <Text style={styles.inputLabel}>Closing Stock</Text>
                          {autoFilledFields.has(product.id) && (
                            <View style={styles.autoFilledBadge}>
                              <Text style={styles.autoFilledBadgeText}>Auto</Text>
                            </View>
                          )}
                        </View>
                        <TextInput
                          style={[
                            styles.smallInput,
                            autoFilledFields.has(product.id) && styles.autoFilledInput,
                            mismatchedFields.has(product.id) && styles.mismatchedInput,
                          ]}
                          placeholder="0"
                          keyboardType="decimal-pad"
                          value={openingStocks.get(product.id) || ''}
                          onChangeText={(value) => handleOpeningStockChange(product.id, value)}
                          placeholderTextColor={Colors.light.muted}
                          testID={`opening-${product.id}`}
                        />
                      </View>
                      <View style={styles.inputField}>
                        <View style={styles.labelWithBadge}>
                          <Text style={styles.inputLabel}>Received</Text>
                          {autoFilledReceivedFields.has(product.id) && (
                            <View style={styles.autoFilledBadge}>
                              <Text style={styles.autoFilledBadgeText}>Auto</Text>
                            </View>
                          )}
                        </View>
                        <TextInput
                          style={[
                            styles.smallInput,
                            autoFilledReceivedFields.has(product.id) && styles.autoFilledInput,
                          ]}
                          placeholder="0"
                          keyboardType="decimal-pad"
                          value={receivedStocks.get(product.id) || ''}
                          onChangeText={(value) => handleReceivedStockChange(product.id, value)}
                          placeholderTextColor={Colors.light.muted}
                          testID={`received-${product.id}`}
                        />
                      </View>
                      <View style={styles.inputField}>
                        <Text style={styles.inputLabel}>Wastage</Text>
                        <TextInput
                          style={styles.smallInput}
                          placeholder="0"
                          keyboardType="decimal-pad"
                          value={wastages.get(product.id) || ''}
                          onChangeText={(value) => handleWastageChange(product.id, value)}
                          placeholderTextColor={Colors.light.muted}
                          testID={`wastage-${product.id}`}
                        />
                      </View>
                    </View>
                    <View style={styles.fullWidthField}>
                      <Text style={styles.inputLabel}>Current Stock (Auto-calculated)</Text>
                      <View style={styles.currentStockDisplay}>
                        <Text style={styles.currentStockText}>
                          {(() => {
                            const opening = parseFloat(openingStocks.get(product.id) || '0') || 0;
                            const received = parseFloat(receivedStocks.get(product.id) || '0') || 0;
                            const wastage = parseFloat(wastages.get(product.id) || '0') || 0;
                            return (opening + received - wastage).toFixed(2).replace(/\.?0+$/, '');
                          })()}
                        </Text>
                      </View>
                    </View>
                    <TextInput
                      style={styles.notesInput}
                      placeholder="Notes (optional)"
                      value={notes.get(product.id) || ''}
                      onChangeText={(value) => handleNoteChange(product.id, value)}
                      placeholderTextColor={Colors.light.muted}
                    />
                  </View>
                </View>
              </View>
            );
          })}
          <View style={styles.bottomPadding} />
        </ScrollView>
        
        <View style={styles.submitContainer}>
          <TouchableOpacity 
            style={[styles.submitButton, (isSaving || counts.size === 0) && styles.submitButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving || counts.size === 0}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={Colors.light.card} />
            ) : (
              <>
                <Check size={16} color={Colors.light.card} />
                <Text style={styles.submitButtonText}>Submit Stock Check</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        
        <Modal
          visible={showOutletModal || shouldShowOutletPopup}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setShowOutletModal(false);
            setShouldShowOutletPopup(false);
          }}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              setShowOutletModal(false);
              setShouldShowOutletPopup(false);
            }}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{shouldShowOutletPopup ? 'Select Outlet for Today\'s Stock Check' : 'Select Outlet'}</Text>
              {outlets.length === 0 ? (
                <View style={styles.emptyOutlets}>
                  <Text style={styles.emptyOutletsText}>No outlets available. Please add outlets in Settings.</Text>
                </View>
              ) : (
                outlets.map((outlet) => (
                  <TouchableOpacity
                    key={outlet.id}
                    style={[
                      styles.outletOption,
                      selectedOutlet === outlet.name && styles.outletOptionSelected
                    ]}
                    onPress={() => {
                      setSelectedOutlet(outlet.name);
                      AsyncStorage.setItem('@stock_check_selected_outlet', outlet.name).catch(console.error);
                      setReplaceAllInventory(false);
                      setShowOutletModal(false);
                      setShouldShowOutletPopup(false);
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
                    {selectedOutlet === outlet.name && (
                      <Check size={20} color={Colors.light.tint} />
                    )}
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
          testID="calendar-stock-check"
        />

        <ConfirmDialog
          visible={showMismatchDialog}
          title="Opening Stock Mismatch"
          message={mismatchMessage}
          confirmText="OK"
          cancelText=""
          onConfirm={() => setShowMismatchDialog(false)}
          onCancel={() => setShowMismatchDialog(false)}
          testID="mismatch-dialog"
        />

        <ConfirmDialog
          visible={showReconcileDialog}
          title="Reconciliation Required"
          message="Cannot continue until Reconciliation is done. Please try again in a while."
          confirmText="OK"
          cancelText=""
          onConfirm={() => setShowReconcileDialog(false)}
          onCancel={() => setShowReconcileDialog(false)}
          testID="reconcile-dialog"
        />

        <ConfirmDialog
          visible={showNameRequiredDialog}
          title="Name Required"
          message='Please enter your name in the "Checked By" field before submitting.'
          confirmText="OK"
          cancelText=""
          onConfirm={() => setShowNameRequiredDialog(false)}
          onCancel={() => setShowNameRequiredDialog(false)}
          testID="name-required-dialog"
        />


        </>
        )}
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.muted,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  topBar: {
    flexDirection: 'column' as const,
    backgroundColor: Colors.light.card,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 10,
  },
  outletSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    gap: 8,
    minWidth: 0,
  },

  outletInfo: {
    flex: 1,
    minWidth: 0,
  },
  outletLabel: {
    fontSize: 10,
    color: Colors.light.muted,
    marginBottom: 1,
  },
  outletValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    numberOfLines: 1,
  },
  changeText: {
    fontSize: 12,
    color: Colors.light.tint,
    fontWeight: '600' as const,
  },
  dateSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  chevBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.text,
    minWidth: 88,
    textAlign: 'center' as const,
  },
  searchContainer: {
    padding: 10,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  searchBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.text,
  },
  filterContainer: {
    flexDirection: 'row' as const,
    padding: 10,
    gap: 6,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
    alignItems: 'center' as const,
  },
  filterButtonActive: {
    backgroundColor: Colors.light.tint,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  filterTextActive: {
    color: Colors.light.card,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  categoryHeader: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    marginTop: 8,
    marginBottom: 6,
  },
  productCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  productInfo: {
    marginBottom: 8,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  productUnit: {
    fontSize: 11,
    color: Colors.light.muted,
  },

  inputContainer: {
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  inputField: {
    flex: 1,
  },
  fullWidthField: {
    width: '100%',
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  labelWithBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginBottom: 4,
  },
  autoFilledBadge: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  autoFilledBadgeText: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
  smallInput: {
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    padding: 6,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  autoFilledInput: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
    borderWidth: 1.5,
  },
  mismatchedInput: {
    backgroundColor: '#ffebee',
    borderColor: '#f44336',
    borderWidth: 1.5,
  },
  countInput: {
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    padding: 8,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  currentStockDisplay: {
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  currentStockText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  notesInput: {
    backgroundColor: Colors.light.background,
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  bottomPadding: {
    height: 80,
  },
  submitContainer: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.light.card,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  submitButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.light.muted,
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.card,
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
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.background,
    marginBottom: 8,
  },
  outletOptionSelected: {
    backgroundColor: Colors.light.tint + '15',
    borderWidth: 2,
    borderColor: Colors.light.tint,
  },
  outletOptionText: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  outletOptionTextSelected: {
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  outletOptionInfo: {
    flex: 1,
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
  checkedByContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  checkedByLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  checkedByInput: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.text,
    padding: 4,
  },
  inventoryToggleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  inventoryToggleActive: {
    backgroundColor: Colors.light.tint + '10',
    borderColor: Colors.light.tint,
  },
  inventoryToggleLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  inventoryToggleLabelActive: {
    color: Colors.light.tint,
  },
  inventoryToggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.light.muted,
    padding: 2,
    justifyContent: 'center' as const,
  },
  inventoryToggleOn: {
    backgroundColor: Colors.light.tint,
  },
  inventoryToggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.light.card,
  },
  inventoryToggleThumbOn: {
    marginLeft: 18,
  },
});
