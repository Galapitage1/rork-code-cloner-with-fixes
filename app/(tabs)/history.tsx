import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { useMemo, useState } from 'react';
import { History as HistoryIcon, Package, Download, ShoppingCart, ArrowRight, X, Edit, Search, ChevronDown, ChevronUp, Calendar } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useStores } from '@/contexts/StoresContext';
import Colors from '@/constants/colors';
import { exportStockCheckToExcel, exportRequestsToExcel } from '@/utils/excelExporter';
import { StockCheck, StockCount, ProductRequest } from '@/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export default function HistoryScreen() {
  const { stockChecks, products, requests, outlets, isLoading, deleteRequest, updateRequest, updateStockCheck, deleteAllStockChecks, deleteStockCheck, deleteAllRequests, saveStockCheck, productConversions } = useStock();
  const { isAdmin, isSuperAdmin, currentUser } = useAuth();
  const { recipes } = useRecipes();
  const { storeProducts } = useStores();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editingRequest, setEditingRequest] = useState<ProductRequest | null>(null);
  const [editQuantity, setEditQuantity] = useState<string>('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [editNotes, setEditNotes] = useState<string>('');
  
  const [editingStockCheck, setEditingStockCheck] = useState<StockCheck | null>(null);
  const [editingStockCheckOutlet, setEditingStockCheckOutlet] = useState<string>('');
  const [originalStockCheckOutlet, setOriginalStockCheckOutlet] = useState<string>('');
  const [expandedStockOutlets, setExpandedStockOutlets] = useState<Set<string>>(new Set());
  const [expandedRequestOutlets, setExpandedRequestOutlets] = useState<Set<string>>(new Set());
  const [expandedStockDates, setExpandedStockDates] = useState<Set<string>>(new Set());
  const [expandedStockMonths, setExpandedStockMonths] = useState<Set<string>>(new Set());
  const [expandedRequestMonths, setExpandedRequestMonths] = useState<Set<string>>(new Set());
  const [confirmDeleteStockCheck, setConfirmDeleteStockCheck] = useState<StockCheck | null>(null);
  const [confirmDeleteRequest, setConfirmDeleteRequest] = useState<ProductRequest | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<{ date: string; items: ProductRequest[] } | null>(null);
  const [confirmDeleteAllChecks, setConfirmDeleteAllChecks] = useState<boolean>(false);
  const [confirmDeleteAllRequests, setConfirmDeleteAllRequests] = useState<boolean>(false);
  const [stockSearchQuery, setStockSearchQuery] = useState<string>('');
  const [expandedStockChecks, setExpandedStockChecks] = useState<Set<string>>(new Set());
  const [expandedRequestDates, setExpandedRequestDates] = useState<Set<string>>(new Set());
  const [newStockCounts, setNewStockCounts] = useState<Map<string, string>>(new Map());
  const [newOpeningStocks, setNewOpeningStocks] = useState<Map<string, string>>(new Map());
  const [newReceivedStocks, setNewReceivedStocks] = useState<Map<string, string>>(new Map());
  const [newStockNotes, setNewStockNotes] = useState<Map<string, string>>(new Map());
  const [newWastages, setNewWastages] = useState<Map<string, string>>(new Map());
  const [replaceAllInventoryEdit, setReplaceAllInventoryEdit] = useState<boolean>(false);
  const [editingStockCheckDate, setEditingStockCheckDate] = useState<string>('');

  const sortedChecks = useMemo(() => 
    [...stockChecks].sort((a, b) => b.timestamp - a.timestamp),
    [stockChecks]
  );

  const sortedRequests = useMemo(() => 
    [...requests].sort((a, b) => {
      const da = a.requestDate ? new Date(a.requestDate).getTime() : a.requestedAt;
      const db = b.requestDate ? new Date(b.requestDate).getTime() : b.requestedAt;
      return db - da;
    }),
    [requests]
  );

  const groupedRequestsByMonth = useMemo(() => {
    const monthGroups = new Map<string, Map<string, Map<string, typeof requests>>>();
    sortedRequests.forEach(request => {
      const date = request.requestDate || new Date(request.requestedAt).toISOString().split('T')[0];
      const [year, month] = date.split('-');
      const monthKey = `${year}-${month}`;
      
      if (!monthGroups.has(monthKey)) {
        monthGroups.set(monthKey, new Map());
      }
      const monthGroup = monthGroups.get(monthKey)!;
      
      if (!monthGroup.has(date)) {
        monthGroup.set(date, new Map());
      }
      const dateGroup = monthGroup.get(date)!;
      const outlet = request.toOutlet;
      const existing = dateGroup.get(outlet) || [];
      dateGroup.set(outlet, [...existing, request]);
    });
    return monthGroups;
  }, [sortedRequests]);

  const groupedStockChecksByMonth = useMemo(() => {
    const monthGroups = new Map<string, Map<string, Map<string, StockCheck[]>>>();
    sortedChecks.forEach(check => {
      const date = check.date;
      const [year, month] = date.split('-');
      const monthKey = `${year}-${month}`;
      
      if (!monthGroups.has(monthKey)) {
        monthGroups.set(monthKey, new Map());
      }
      const monthGroup = monthGroups.get(monthKey)!;
      
      if (!monthGroup.has(date)) {
        monthGroup.set(date, new Map());
      }
      const dateGroup = monthGroup.get(date)!;
      const outlet = check.outlet || 'No Outlet';
      
      const existing = dateGroup.get(outlet) || [];
      dateGroup.set(outlet, [...existing, check]);
    });
    return monthGroups;
  }, [sortedChecks]);

  const handleDownload = async (check: typeof stockChecks[0]) => {
    try {
      setDownloadingId(check.id);
      await exportStockCheckToExcel(check, products, recipes, storeProducts, productConversions);
    } catch (error) {
      console.error('Download error:', error);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadRequests = async (date: string, dateRequests: typeof requests) => {
    try {
      setDownloadingId(date);
      const groupedByOutlet = new Map<string, typeof requests>();
      dateRequests.forEach(request => {
        const existing = groupedByOutlet.get(request.toOutlet) || [];
        groupedByOutlet.set(request.toOutlet, [...existing, request]);
      });
      
      for (const [toOutlet, outletRequests] of groupedByOutlet.entries()) {
        await exportRequestsToExcel(toOutlet, outletRequests, products, recipes, storeProducts, productConversions);
      }
    } catch (error) {
      console.error('Download error:', error);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteAllStockChecks = () => {
    setConfirmDeleteAllChecks(true);
  };

  const handleDeleteRequestGroup = (date: string, dateRequests: typeof requests) => {
    setConfirmDeleteGroup({ date, items: dateRequests });
  };

  const handleDeleteSingleRequest = (request: typeof requests[0]) => {
    setConfirmDeleteRequest(request);
  };

  const handleEditRequest = (request: typeof requests[0]) => {
    setEditingRequest(request);
    setEditQuantity(request.quantity.toString());
    setEditPriority(request.priority);
    setEditNotes(request.notes || '');
  };

  const handleSaveEdit = async () => {
    if (!editingRequest) return;
    
    const quantity = parseFloat(editQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid quantity');
      return;
    }

    try {
      await updateRequest(editingRequest.id, {
        quantity,
        priority: editPriority,
        notes: editNotes,
      });
      setEditingRequest(null);
      Alert.alert('Success', 'Request updated successfully');
    } catch (error) {
      console.error('Update error:', error);
      Alert.alert('Error', 'Failed to update request');
    }
  };

  const handleCancelEdit = () => {
    setEditingRequest(null);
    setEditQuantity('');
    setEditPriority('medium');
    setEditNotes('');
  };

  const handleEditStockCheck = (check: typeof stockChecks[0]) => {
    setEditingStockCheck(check);
    setEditingStockCheckOutlet(check.outlet || '');
    setOriginalStockCheckOutlet(check.outlet || '');
    setEditingStockCheckDate(check.date);
    setStockSearchQuery('');
    setReplaceAllInventoryEdit(false);
    
    const newCounts = new Map<string, string>();
    const newOpening = new Map<string, string>();
    const newReceived = new Map<string, string>();
    const newNotes = new Map<string, string>();
    const newWaste = new Map<string, string>();
    
    check.counts.forEach(count => {
      newCounts.set(count.productId, String(count.quantity));
      if (count.openingStock !== undefined) {
        newOpening.set(count.productId, String(count.openingStock));
      }
      if (count.receivedStock !== undefined) {
        newReceived.set(count.productId, String(count.receivedStock));
      }
      if (count.wastage !== undefined) {
        newWaste.set(count.productId, String(count.wastage));
      }
      if (count.notes) {
        newNotes.set(count.productId, count.notes);
      }
    });
    
    setNewStockCounts(newCounts);
    setNewOpeningStocks(newOpening);
    setNewReceivedStocks(newReceived);
    setNewStockNotes(newNotes);
    setNewWastages(newWaste);
  };

  const handleCancelStockEdit = () => {
    setEditingStockCheck(null);
    setEditingStockCheckOutlet('');
    setOriginalStockCheckOutlet('');
    setEditingStockCheckDate('');
    setStockSearchQuery('');
    setNewStockCounts(new Map());
    setNewOpeningStocks(new Map());
    setNewReceivedStocks(new Map());
    setNewStockNotes(new Map());
    setNewWastages(new Map());
    setReplaceAllInventoryEdit(false);
  };



  const handleOpeningStockChange = (productId: string, value: string) => {
    const newMap = new Map(newOpeningStocks);
    if (value === '') {
      newMap.delete(productId);
    } else {
      newMap.set(productId, value);
    }
    setNewOpeningStocks(newMap);
    
    const receivedVal = newReceivedStocks.get(productId) ?? '';
    const sum = (parseFloat(value || '0') || 0) + (parseFloat(receivedVal || '0') || 0);
    const countsMap = new Map(newStockCounts);
    if (!value && !receivedVal) {
      countsMap.delete(productId);
    } else {
      countsMap.set(productId, Number.isFinite(sum) ? String(sum) : '0');
    }
    setNewStockCounts(countsMap);
  };

  const handleReceivedStockChange = (productId: string, value: string) => {
    const newMap = new Map(newReceivedStocks);
    if (value === '') {
      newMap.delete(productId);
    } else {
      newMap.set(productId, value);
    }
    setNewReceivedStocks(newMap);
    
    const openingVal = newOpeningStocks.get(productId) ?? '';
    const sum = (parseFloat(openingVal || '0') || 0) + (parseFloat(value || '0') || 0);
    const countsMap = new Map(newStockCounts);
    if (!openingVal && !value) {
      countsMap.delete(productId);
    } else {
      countsMap.set(productId, Number.isFinite(sum) ? String(sum) : '0');
    }
    setNewStockCounts(countsMap);
  };

  const handleWastageChange = (productId: string, value: string) => {
    const newMap = new Map(newWastages);
    if (value === '') {
      newMap.delete(productId);
    } else {
      newMap.set(productId, value);
    }
    setNewWastages(newMap);
  };

  const handleStockNoteChange = (productId: string, value: string) => {
    const newMap = new Map(newStockNotes);
    if (value === '') {
      newMap.delete(productId);
    } else {
      newMap.set(productId, value);
    }
    setNewStockNotes(newMap);
  };

  const handleSaveStockEdit = async () => {
    if (!editingStockCheck) return;
    
    if (newStockCounts.size === 0) {
      Alert.alert('No Items', 'Please add at least one item to the stock check');
      return;
    }

    try {
      const newCounts: StockCount[] = Array.from(newStockCounts.entries())
        .map(([productId, countStr]) => ({
          productId,
          quantity: parseFloat(countStr) || 0,
          openingStock: newOpeningStocks.has(productId) ? parseFloat(newOpeningStocks.get(productId)!) || 0 : undefined,
          receivedStock: newReceivedStocks.has(productId) ? parseFloat(newReceivedStocks.get(productId)!) || 0 : undefined,
          wastage: newWastages.has(productId) ? parseFloat(newWastages.get(productId)!) || 0 : undefined,
          notes: newStockNotes.get(productId),
          replaceInventoryDate: replaceAllInventoryEdit ? editingStockCheck.date : undefined,
        }))
        .filter(count => count.quantity > 0);

      const outletChanged = originalStockCheckOutlet !== editingStockCheckOutlet;
      
      const dateChanged = editingStockCheck.date !== editingStockCheckDate;
      
      const updatedCheck: StockCheck = {
        ...editingStockCheck,
        counts: newCounts,
        outlet: editingStockCheckOutlet,
        date: editingStockCheckDate,
        replaceAllInventory: replaceAllInventoryEdit,
        updatedAt: Date.now(),
      };
      
      console.log('\n=== HISTORY EDIT WITH REPLACE INVENTORY ===');
      console.log('Stock check date (original):', editingStockCheck.date);
      console.log('Stock check date (new):', editingStockCheckDate);
      console.log('Date changed:', dateChanged);
      console.log('Replace All Inventory:', replaceAllInventoryEdit);
      console.log('Outlet:', editingStockCheckOutlet);
      
      // Move the stock check to the new date if date changed
      if (dateChanged) {
        console.log('Date changed - moving stock check from', editingStockCheck.date, 'to', editingStockCheckDate);
        await deleteStockCheck(editingStockCheck.id);
        
        // Move stock check to new date (keeping same data, just updating date)
        const movedStockCheck: StockCheck = {
          id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: editingStockCheckDate,
          timestamp: Date.now(),
          counts: newCounts,
          outlet: editingStockCheckOutlet,
          doneDate: editingStockCheck.doneDate,
          completedBy: editingStockCheck.completedBy,
          replaceAllInventory: replaceAllInventoryEdit,
          updatedAt: Date.now(),
        };
        
        await saveStockCheck(movedStockCheck);
        console.log('Stock check moved to new date:', editingStockCheckDate);
      } else {
        await updateStockCheck(updatedCheck.id, newCounts, editingStockCheckOutlet, outletChanged);
      }
      
      console.log('✓ Stock check updated');
      console.log('✓ Opening stock for products replaced with these values');
      console.log('✓ Live inventory will recalculate from this date forward');
      console.log('✓ Current stock will be highlighted in red to show replacement');
      console.log('=== HISTORY EDIT COMPLETE ===\n');
      
      setEditingStockCheck(null);
      setEditingStockCheckDate('');
      setReplaceAllInventoryEdit(false);
      
      if (dateChanged) {
        Alert.alert(
          'Success',
          `Stock check moved to ${editingStockCheckDate}.\n\nThe stock check has been moved from ${editingStockCheck.date} to ${editingStockCheckDate} in the history. Opening stock for the next day (${getNextDay(editingStockCheckDate)}) will be updated in live inventory.`,
          [{ text: 'OK' }]
        );
      } else if (replaceAllInventoryEdit) {
        Alert.alert(
          'Success', 
          `Stock check updated successfully.\n\nOpening stock has been replaced for ${editingStockCheck.date}. Live inventory will recalculate from this date forward.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Success', 'Stock check updated successfully');
      }
    } catch (error) {
      console.error('Update error:', error);
      Alert.alert('Error', 'Failed to update stock check');
    }
  };

  const filteredProductsForStock = useMemo(() => {
    if (!editingStockCheck) return [];
    
    const existingProductIds = new Set(editingStockCheck.counts.map(c => c.productId));
    let filtered = products.filter(p => p.showInStock !== false);
    
    if (stockSearchQuery.trim()) {
      const query = stockSearchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.category?.toLowerCase().includes(query)
      );
    }
    
    return filtered.sort((a, b) => {
      const hasStockA = newStockCounts.has(a.id) && parseFloat(newStockCounts.get(a.id) || '0') > 0 ? 1 : 0;
      const hasStockB = newStockCounts.has(b.id) && parseFloat(newStockCounts.get(b.id) || '0') > 0 ? 1 : 0;
      
      if (hasStockB !== hasStockA) {
        return hasStockB - hasStockA;
      }
      
      return a.name.localeCompare(b.name);
    });
  }, [editingStockCheck, products, stockSearchQuery, newStockCounts]);



  const getPriorityColor = (priority: 'low' | 'medium' | 'high') => {
    switch (priority) {
      case 'high': return Colors.light.danger;
      case 'medium': return Colors.light.warning;
      case 'low': return Colors.light.success;
    }
  };

  const handleDeleteSingleStockCheck = (check: typeof stockChecks[0]) => {
    setConfirmDeleteStockCheck(check);
  };

  const toggleStockCheckExpanded = (checkId: string) => {
    setExpandedStockChecks(prev => {
      const next = new Set(prev);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return next;
    });
  };

  const toggleRequestDateExpanded = (date: string) => {
    setExpandedRequestDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const toggleStockOutletExpanded = (key: string) => {
    setExpandedStockOutlets(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleRequestOutletExpanded = (key: string) => {
    setExpandedRequestOutlets(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleStockDateExpanded = (date: string) => {
    setExpandedStockDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const toggleStockMonthExpanded = (month: string) => {
    setExpandedStockMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

  const toggleRequestMonthExpanded = (month: string) => {
    setExpandedRequestMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

  const getMonthName = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  };

  const getNextDay = (dateStr: string) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1}}>
              <HistoryIcon size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>Stock Check History</Text>
            </View>
            {isSuperAdmin && stockChecks.length > 0 && (
              <TouchableOpacity
                style={styles.deleteAllButton}
                onPress={handleDeleteAllStockChecks}
              >
                <X size={16} color={Colors.light.danger} />
                <Text style={styles.deleteAllButtonText}>Delete All</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {sortedChecks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Package size={48} color={Colors.light.muted} />
              <Text style={styles.emptyText}>No stock checks yet</Text>
            </View>
          ) : (
            Array.from(groupedStockChecksByMonth.entries())
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([monthKey, dateMap]) => {
              const isMonthExpanded = expandedStockMonths.has(monthKey);
              const allDates = Array.from(dateMap.keys());
              const allMonthChecks = Array.from(dateMap.values()).flatMap(outletMap => Array.from(outletMap.values()).flat());
              const monthTotalChecks = allMonthChecks.length;
              
              return (
                <View key={monthKey} style={styles.monthCard}>
                  <TouchableOpacity 
                    style={styles.monthHeader} 
                    onPress={() => toggleStockMonthExpanded(monthKey)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.monthHeaderLeft}>
                      <Text style={styles.monthTitle}>{getMonthName(monthKey)}</Text>
                      <Text style={styles.monthCount}>{monthTotalChecks} check{monthTotalChecks !== 1 ? 's' : ''} · {allDates.length} date{allDates.length !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.monthHeaderRight}>
                      {isMonthExpanded ? (
                        <ChevronUp size={24} color={Colors.light.tint} />
                      ) : (
                        <ChevronDown size={24} color={Colors.light.tint} />
                      )}
                    </View>
                  </TouchableOpacity>

                  {isMonthExpanded && (
                    <View style={styles.monthContent}>
                      {Array.from(dateMap.entries())
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([date, outletMap]) => {
                        const isDateExpanded = expandedStockDates.has(date);
                        const allChecks = Array.from(outletMap.values()).flat();
                        const uniqueOutlets = Array.from(new Set(allChecks.map(c => c.outlet || 'No Outlet')));
                        const outletsText = uniqueOutlets.join(', ');
                        
                        return (
                          <View key={date} style={styles.card}>
                  <TouchableOpacity 
                    style={styles.compactHeader} 
                    onPress={() => toggleStockDateExpanded(date)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.compactHeaderLeft}>
                      <Text style={styles.compactDate}>Date: {date}</Text>
                      <Text style={styles.compactOutlet}>Outlets: {outletsText}</Text>
                      <Text style={styles.compactCount}>{allChecks.length} check{allChecks.length !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.compactHeaderRight}>
                      {isDateExpanded ? (
                        <ChevronUp size={24} color={Colors.light.tint} />
                      ) : (
                        <ChevronDown size={24} color={Colors.light.tint} />
                      )}
                    </View>
                  </TouchableOpacity>

                  {isDateExpanded && (
                    <View style={styles.expandedContent}>
                      {Array.from(outletMap.entries()).map(([outletName, checks]) => {
                        const outletKey = `${date}-${outletName}`;
                        const isOutletExpanded = expandedStockOutlets.has(outletKey);
                        
                        return (
                          <View key={outletKey} style={styles.outletSection}>
                            <TouchableOpacity 
                              style={styles.outletHeader} 
                              onPress={() => toggleStockOutletExpanded(outletKey)}
                              activeOpacity={0.7}
                            >
                              <View style={styles.outletHeaderLeft}>
                                <Text style={styles.outletName}>{outletName}</Text>
                                <Text style={styles.outletCount}>{checks.length} check{checks.length !== 1 ? 's' : ''}</Text>
                              </View>
                              <View style={styles.outletHeaderRight}>
                                {isOutletExpanded ? (
                                  <ChevronUp size={20} color={Colors.light.tint} />
                                ) : (
                                  <ChevronDown size={20} color={Colors.light.tint} />
                                )}
                              </View>
                            </TouchableOpacity>

                            {isOutletExpanded && (
                              <View style={styles.outletContent}>
                                {checks.map((check) => {
                                  const groupedByType = check.counts.reduce((acc, count) => {
                                    const product = products.find(p => p.id === count.productId);
                                    const productInfo = product || { id: count.productId, name: 'Deleted Product', unit: 'unit', category: 'other' };
                                    const type = productInfo.category || 'other';
                                    if (!acc[type]) acc[type] = [];
                                    acc[type].push({ count, product: productInfo });
                                    return acc;
                                  }, {} as Record<string, Array<{ count: StockCount; product: typeof products[0] | { id: string; name: string; unit: string; category: string } }>>);

                                  Object.keys(groupedByType).forEach(type => {
                                    groupedByType[type].sort((a, b) => a.product.name.localeCompare(b.product.name));
                                  });

                                  return (
                                    <View key={check.id} style={styles.checkCard}>
                                      <View style={styles.checkHeader}>
                                        <View style={styles.checkHeaderLeft}>
                                          <Text style={styles.checkTime}>Done: {check.doneDate ?? new Date(check.timestamp).toISOString().split('T')[0]} · {new Date(check.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                                          {check.completedBy && (
                                            check.completedBy === 'AUTO' ? (
                                              <Text style={styles.autoText}>Auto</Text>
                                            ) : (
                                              <Text style={styles.completedByText}>
                                                Checked By: {check.completedBy}
                                              </Text>
                                            )
                                          )}
                                        </View>
                                        <View style={styles.headerButtons}>
                                          {isSuperAdmin && (
                                            <TouchableOpacity
                                              style={styles.editButtonSmall}
                                              onPress={() => handleEditStockCheck(check)}
                                            >
                                              <Edit size={18} color={Colors.light.tint} />
                                            </TouchableOpacity>
                                          )}
                                          {isSuperAdmin && (
                                            <TouchableOpacity
                                              style={styles.deleteButton}
                                              onPress={() => handleDeleteSingleStockCheck(check)}
                                            >
                                              <X size={20} color={Colors.light.danger} />
                                            </TouchableOpacity>
                                          )}
                                          <TouchableOpacity
                                            style={styles.downloadButton}
                                            onPress={() => handleDownload(check)}
                                            disabled={downloadingId === check.id}
                                          >
                                            {downloadingId === check.id ? (
                                              <ActivityIndicator size="small" color={Colors.light.tint} />
                                            ) : (
                                              <Download size={20} color={Colors.light.tint} />
                                            )}
                                          </TouchableOpacity>
                                        </View>
                                      </View>

                                      <View style={styles.checkStats}>
                                        <View style={styles.statItem}>
                                          <Text style={styles.statValue}>{check.counts.length}</Text>
                                          <Text style={styles.statLabel}>Products</Text>
                                        </View>
                                        <View style={styles.statItem}>
                                          <Text style={styles.statValue}>
                                            {check.counts.reduce((sum, c) => sum + c.quantity, 0).toFixed(0)}
                                          </Text>
                                          <Text style={styles.statLabel}>Total Items</Text>
                                        </View>
                                      </View>

                                      <View style={styles.checkDetails}>
                                        {Object.entries(groupedByType).map(([type, items]) => (
                                          <View key={type} style={styles.typeGroup}>
                                            <Text style={styles.typeTitle}>{type.toUpperCase()}</Text>
                                            {items.map(({ count, product }) => (
                                              <View key={count.productId} style={styles.detailRow}>
                                                <Text style={styles.detailProduct}>{product.name}</Text>
                                                <Text style={styles.detailQuantity}>
                                                  {count.quantity} {product.unit}
                                                </Text>
                                              </View>
                                            ))}
                                          </View>
                                        ))}
                                      </View>
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1}}>
              <ShoppingCart size={24} color={Colors.light.accent} />
              <Text style={styles.sectionTitle}>Request History</Text>
            </View>
            {isSuperAdmin && requests.length > 0 && (
              <TouchableOpacity
                style={styles.deleteAllButton}
                onPress={() => setConfirmDeleteAllRequests(true)}
              >
                <X size={16} color={Colors.light.danger} />
                <Text style={styles.deleteAllButtonText}>Delete All</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {sortedRequests.length === 0 ? (
            <View style={styles.emptyCard}>
              <ShoppingCart size={48} color={Colors.light.muted} />
              <Text style={styles.emptyText}>No requests yet</Text>
            </View>
          ) : (
            Array.from(groupedRequestsByMonth.entries())
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([monthKey, dateMap]) => {
              const isMonthExpanded = expandedRequestMonths.has(monthKey);
              const allDates = Array.from(dateMap.keys());
              const allMonthRequests = Array.from(dateMap.values()).flatMap(outletMap => Array.from(outletMap.values()).flat());
              const monthTotalRequests = allMonthRequests.length;
              
              return (
                <View key={monthKey} style={styles.monthCard}>
                  <TouchableOpacity 
                    style={styles.monthHeader} 
                    onPress={() => toggleRequestMonthExpanded(monthKey)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.monthHeaderLeft}>
                      <Text style={styles.monthTitle}>{getMonthName(monthKey)}</Text>
                      <Text style={styles.monthCount}>{monthTotalRequests} request{monthTotalRequests !== 1 ? 's' : ''} · {allDates.length} date{allDates.length !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.monthHeaderRight}>
                      {isMonthExpanded ? (
                        <ChevronUp size={24} color={Colors.light.tint} />
                      ) : (
                        <ChevronDown size={24} color={Colors.light.tint} />
                      )}
                    </View>
                  </TouchableOpacity>

                  {isMonthExpanded && (
                    <View style={styles.monthContent}>
                      {Array.from(dateMap.entries())
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([date, outletMap]) => {
                        const isExpanded = expandedRequestDates.has(date);
                        const allRequests = Array.from(outletMap.values()).flat();
                        const outlets = Array.from(outletMap.keys()).join(', ');
                        return (
                          <View key={date} style={styles.card}>
                  <TouchableOpacity 
                    style={styles.compactHeader} 
                    onPress={() => toggleRequestDateExpanded(date)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.compactHeaderLeft}>
                      <Text style={styles.compactDate}>Date: {date}</Text>
                      <Text style={styles.compactOutlet}>To: {outlets}</Text>
                      <Text style={styles.compactCount}>{allRequests.length} request{allRequests.length !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.compactHeaderRight}>
                      {isExpanded ? (
                        <ChevronUp size={24} color={Colors.light.tint} />
                      ) : (
                        <ChevronDown size={24} color={Colors.light.tint} />
                      )}
                    </View>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.expandedContent}>

                      {Array.from(outletMap.entries()).map(([toOutlet, outletRequests]) => {
                        const outletKey = `${date}-${toOutlet}`;
                        const isOutletExpanded = expandedRequestOutlets.has(outletKey);
                        
                        return (
                          <View key={outletKey} style={styles.outletSection}>
                            <View>
                              <TouchableOpacity 
                                style={styles.outletHeader} 
                                onPress={() => toggleRequestOutletExpanded(outletKey)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.outletHeaderLeft}>
                                  <Text style={styles.outletName}>To: {toOutlet}</Text>
                                  <Text style={styles.outletCount}>{outletRequests.length} request{outletRequests.length !== 1 ? 's' : ''}</Text>
                                </View>
                                <View style={styles.outletHeaderRight}>
                                  {isOutletExpanded ? (
                                    <ChevronUp size={20} color={Colors.light.tint} />
                                  ) : (
                                    <ChevronDown size={20} color={Colors.light.tint} />
                                  )}
                                </View>
                              </TouchableOpacity>

                              <View style={styles.outletActions}>
                                <TouchableOpacity
                                  style={styles.downloadButton}
                                  onPress={async () => {
                                    try {
                                      setDownloadingId(outletKey);
                                      await exportRequestsToExcel(toOutlet, outletRequests, products, recipes, storeProducts);
                                    } catch (error) {
                                      console.error('Download error:', error);
                                    } finally {
                                      setDownloadingId(null);
                                    }
                                  }}
                                  disabled={downloadingId === outletKey}
                                >
                                  {downloadingId === outletKey ? (
                                    <ActivityIndicator size="small" color={Colors.light.tint} />
                                  ) : (
                                    <Download size={20} color={Colors.light.tint} />
                                  )}
                                </TouchableOpacity>
                              </View>
                            </View>

                            {isOutletExpanded && (
                              <View style={styles.outletContent}>
                                {(() => {
                                  const groupedByType = outletRequests.reduce((acc, request) => {
                                    const product = products.find(p => p.id === request.productId);
                                    const productInfo = product || { id: request.productId, name: 'Deleted Product', unit: 'unit', category: 'other' };
                                    const type = productInfo.category || 'other';
                                    if (!acc[type]) acc[type] = [];
                                    acc[type].push({ request, product: productInfo });
                                    return acc;
                                  }, {} as Record<string, Array<{ request: ProductRequest; product: typeof products[0] | { id: string; name: string; unit: string; category: string } }>>);

                                  Object.keys(groupedByType).forEach(type => {
                                    groupedByType[type].sort((a, b) => a.product.name.localeCompare(b.product.name));
                                  });

                                  return Object.entries(groupedByType).map(([type, items]) => (
                                    <View key={type} style={styles.typeGroup}>
                                      <Text style={styles.typeTitle}>{type.toUpperCase()}</Text>
                                      {items.map(({ request, product }) => (
                                        <View key={request.id} style={styles.requestDetailRow}>
                                          <View style={styles.requestDetailLeft}>
                                            <Text style={styles.detailProduct}>{product.name}</Text>
                                            <View style={styles.requestFlow}>
                                              <Text style={styles.requestOutletText}>{request.fromOutlet}</Text>
                                              <ArrowRight size={12} color={Colors.light.muted} />
                                              <Text style={styles.requestOutletText}>{request.toOutlet}</Text>
                                            </View>
                                            {request.requestedBy && (
                                              <Text style={styles.requestedByText}>
                                                Requested By: {request.requestedBy === 'AUTO' ? (
                                                  <Text style={styles.autoText}>AUTO</Text>
                                                ) : (
                                                  request.requestedBy
                                                )}
                                              </Text>
                                            )}
                                          </View>
                                          <View style={styles.requestDetailRight}>
                                            <Text style={styles.detailQuantity}>
                                              {request.quantity} {product.unit}
                                            </Text>
                                            {request.wastage !== undefined && request.wastage > 0 && (
                                              <Text style={styles.wastageText}>
                                                Wastage: {request.wastage} {product.unit}
                                              </Text>
                                            )}
                                            {request.requestDate ? (
                                              <Text style={styles.requestDateSmall}>Date: {request.requestDate}{request.doneDate ? ` · Done: ${request.doneDate}` : ''}</Text>
                                            ) : null}
                                            <View style={styles.requestDetailBottom}>
                                              <View style={[styles.priorityBadgeSmall, { backgroundColor: getPriorityColor(request.priority) + '20' }]}>
                                                <Text style={[styles.priorityTextSmall, { color: getPriorityColor(request.priority) }]}>
                                                  {request.priority.toUpperCase()}
                                                </Text>
                                              </View>
                                              <View style={styles.requestActions}>
                                                <TouchableOpacity
                                                  style={styles.editButtonSmall}
                                                  onPress={() => handleEditRequest(request)}
                                                >
                                                  <Edit size={14} color={Colors.light.tint} />
                                                </TouchableOpacity>
                                                {isSuperAdmin && (
                                                  <TouchableOpacity
                                                    style={styles.deleteButtonSmall}
                                                    onPress={() => handleDeleteSingleRequest(request)}
                                                  >
                                                    <X size={14} color={Colors.light.danger} />
                                                  </TouchableOpacity>
                                                )}
                                              </View>
                                            </View>
                                          </View>
                                        </View>
                                      ))}
                                    </View>
                                  ));
                                })()}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal
        visible={editingStockCheck !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelStockEdit}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Stock Check</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={handleCancelStockEdit}
              >
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            
            {editingStockCheck && (
              <View style={styles.modalBody}>
                <Text style={styles.modalSubtitle}>
                  {new Date(editingStockCheck.timestamp).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
                <Text style={styles.modalInfo}>
                  Items in stock check: {editingStockCheck.counts.length}
                </Text>

                {isSuperAdmin && (
                  <View style={styles.dateEditContainer}>
                    <Text style={styles.dateEditLabel}>Stock Check Date</Text>
                    <View style={styles.dateEditButtonWrapper}>
                      <Calendar size={16} color={Colors.light.tint} />
                      <TextInput
                        style={styles.dateEditInput}
                        value={editingStockCheckDate}
                        onChangeText={setEditingStockCheckDate}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={Colors.light.muted}
                      />
                    </View>
                  </View>
                )}

                {isSuperAdmin && (
                  <View style={styles.outletSelectContainer}>
                    <Text style={styles.outletSelectLabel}>Outlet Location</Text>
                    <View style={styles.outletSelectWrapper}>
                      {outlets.map((outlet) => (
                        <TouchableOpacity
                          key={outlet.id}
                          style={[
                            styles.outletSelectButton,
                            editingStockCheckOutlet === outlet.name && styles.outletSelectButtonActive,
                          ]}
                          onPress={() => setEditingStockCheckOutlet(outlet.name)}
                        >
                          <Text
                            style={[
                              styles.outletSelectButtonText,
                              editingStockCheckOutlet === outlet.name && styles.outletSelectButtonTextActive,
                            ]}
                          >
                            {outlet.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {isSuperAdmin && (
                  <TouchableOpacity 
                    style={[styles.inventoryToggleContainer, replaceAllInventoryEdit && styles.inventoryToggleActive]}
                    onPress={() => setReplaceAllInventoryEdit(!replaceAllInventoryEdit)}
                  >
                    <Text style={[styles.inventoryToggleLabel, replaceAllInventoryEdit && styles.inventoryToggleLabelActive]}>
                      Replace All Inventory
                    </Text>
                    <View style={[styles.inventoryToggle, replaceAllInventoryEdit && styles.inventoryToggleOn]}>
                      <View style={[styles.inventoryToggleThumb, replaceAllInventoryEdit && styles.inventoryToggleThumbOn]} />
                    </View>
                  </TouchableOpacity>
                )}

                <View style={styles.searchBar}>
                  <Search size={20} color={Colors.light.muted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search products to add..."
                    value={stockSearchQuery}
                    onChangeText={setStockSearchQuery}
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>

                <ScrollView style={styles.productsList} contentContainerStyle={styles.productsListContent}>
                  {filteredProductsForStock.length === 0 ? (
                    <View style={styles.emptyProducts}>
                      <Package size={48} color={Colors.light.muted} />
                      <Text style={styles.emptyProductsText}>
                        {stockSearchQuery ? 'No products found' : 'No products available'}
                      </Text>
                    </View>
                  ) : (
                    filteredProductsForStock.map((product) => (
                      <View key={product.id} style={styles.addProductCard}>
                        <View style={styles.addProductInfo}>
                          <Text style={styles.addProductName}>{product.name}</Text>
                          <Text style={styles.addProductUnit}>Unit: {product.unit}</Text>
                          {product.category && (
                            <Text style={styles.addProductCategory}>{product.category}</Text>
                          )}
                        </View>
                        <View style={styles.addInputContainer}>
                          <View style={styles.addInputRow}>
                            <View style={styles.addInputField}>
                              <Text style={styles.addInputLabel}>Opening Stock</Text>
                              <TextInput
                                style={styles.addInput}
                                placeholder="0"
                                keyboardType="decimal-pad"
                                value={newOpeningStocks.get(product.id) || ''}
                                onChangeText={(value) => handleOpeningStockChange(product.id, value)}
                                placeholderTextColor={Colors.light.muted}
                              />
                            </View>
                            <View style={styles.addInputField}>
                              <Text style={styles.addInputLabel}>Received</Text>
                              <TextInput
                                style={styles.addInput}
                                placeholder="0"
                                keyboardType="decimal-pad"
                                value={newReceivedStocks.get(product.id) || ''}
                                onChangeText={(value) => handleReceivedStockChange(product.id, value)}
                                placeholderTextColor={Colors.light.muted}
                              />
                            </View>
                            <View style={styles.addInputField}>
                              <Text style={styles.addInputLabel}>Wastage</Text>
                              <TextInput
                                style={styles.addInput}
                                placeholder="0"
                                keyboardType="decimal-pad"
                                value={newWastages.get(product.id) || ''}
                                onChangeText={(value) => handleWastageChange(product.id, value)}
                                placeholderTextColor={Colors.light.muted}
                              />
                            </View>
                          </View>
                          <View style={styles.fullWidthField}>
                            <Text style={styles.addInputLabel}>Current Stock</Text>
                            <View style={styles.addCurrentDisplay}>
                              <Text style={styles.addCurrentText}>
                                {(() => {
                                  const o = newOpeningStocks.get(product.id) ?? '';
                                  const r = newReceivedStocks.get(product.id) ?? '';
                                  const sum = (parseFloat(o || '0') || 0) + (parseFloat(r || '0') || 0);
                                  return Number.isFinite(sum) ? String(sum) : '0';
                                })()}
                              </Text>
                            </View>
                          </View>
                          <TextInput
                            style={styles.addNotesInput}
                            placeholder="Notes (optional)"
                            value={newStockNotes.get(product.id) || ''}
                            onChangeText={(value) => handleStockNoteChange(product.id, value)}
                            placeholderTextColor={Colors.light.muted}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </ScrollView>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={handleCancelStockEdit}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      styles.modalButtonSave,
                      { flexDirection: 'row' as const, gap: 6 },
                      newStockCounts.size === 0 && { opacity: 0.5 }
                    ]}
                    onPress={handleSaveStockEdit}
                    disabled={newStockCounts.size === 0}
                  >
                    <Text style={styles.modalButtonTextSave}>
                      Save Changes
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={editingRequest !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelEdit}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Request</Text>
            
            {editingRequest && (
              <View style={styles.modalBody}>
                <Text style={styles.modalProductName}>
                  {products.find(p => p.id === editingRequest.productId)?.name}
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Quantity *</Text>
                  <TextInput
                    style={styles.input}
                    value={editQuantity}
                    onChangeText={setEditQuantity}
                    keyboardType="numeric"
                    placeholder="Enter quantity"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Priority *</Text>
                  <View style={styles.priorityButtons}>
                    {(['low', 'medium', 'high'] as const).map((priority) => (
                      <TouchableOpacity
                        key={priority}
                        style={[
                          styles.priorityButton,
                          editPriority === priority && styles.priorityButtonActive,
                          editPriority === priority && { backgroundColor: getPriorityColor(priority) },
                        ]}
                        onPress={() => setEditPriority(priority)}
                      >
                        <Text
                          style={[
                            styles.priorityButtonText,
                            editPriority === priority && styles.priorityButtonTextActive,
                          ]}
                        >
                          {priority.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={editNotes}
                    onChangeText={setEditNotes}
                    placeholder="Additional notes (optional)"
                    multiline
                    numberOfLines={3}
                  />
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={handleCancelEdit}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={handleSaveEdit}
                  >
                    <Text style={styles.modalButtonTextSave}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
      <ConfirmDialog
        visible={!!confirmDeleteStockCheck}
        title="Delete Stock Check"
        message="Are you sure you want to delete this stock check? This cannot be undone."
        destructive
        onCancel={() => setConfirmDeleteStockCheck(null)}
        onConfirm={async () => {
          if (!confirmDeleteStockCheck) return;
          try {
            await deleteStockCheck(confirmDeleteStockCheck.id);
          } catch (e) {
            console.log('Failed to delete stock check', e);
          } finally {
            setConfirmDeleteStockCheck(null);
          }
        }}
        testID="confirm-delete-stock-check"
      />

      <ConfirmDialog
        visible={!!confirmDeleteRequest}
        title="Delete Request"
        message={confirmDeleteRequest ? `Delete request for ${products.find(p => p.id === confirmDeleteRequest.productId)?.name || 'this product'}?` : ''}
        destructive
        onCancel={() => setConfirmDeleteRequest(null)}
        onConfirm={async () => {
          if (!confirmDeleteRequest) return;
          try {
            await deleteRequest(confirmDeleteRequest.id);
          } catch (e) {
            console.log('Failed to delete request', e);
          } finally {
            setConfirmDeleteRequest(null);
          }
        }}
        testID="confirm-delete-request"
      />

      <ConfirmDialog
        visible={!!confirmDeleteGroup}
        title="Delete Requests"
        message={confirmDeleteGroup ? `Delete all ${confirmDeleteGroup.items.length} request${confirmDeleteGroup.items.length !== 1 ? 's' : ''} from ${confirmDeleteGroup.date}?` : ''}
        destructive
        onCancel={() => setConfirmDeleteGroup(null)}
        onConfirm={async () => {
          if (!confirmDeleteGroup) return;
          try {
            for (const r of confirmDeleteGroup.items) {
              await deleteRequest(r.id);
            }
          } catch (e) {
            console.log('Failed to delete request group', e);
          } finally {
            setConfirmDeleteGroup(null);
          }
        }}
        testID="confirm-delete-request-group"
      />

      <ConfirmDialog
        visible={confirmDeleteAllChecks}
        title="Delete All Stock Checks"
        message={`Are you sure you want to delete all ${stockChecks.length} stock check${stockChecks.length !== 1 ? 's' : ''}? This cannot be undone.`}
        destructive
        confirmText="Delete All"
        onCancel={() => setConfirmDeleteAllChecks(false)}
        onConfirm={async () => {
          try {
            await deleteAllStockChecks();
          } catch (e) {
            console.log('Failed to delete all stock checks', e);
          } finally {
            setConfirmDeleteAllChecks(false);
          }
        }}
        testID="confirm-delete-all-stock-checks"
      />

      <ConfirmDialog
        visible={confirmDeleteAllRequests}
        title="Delete All Requests"
        message={`Are you sure you want to delete all ${requests.length} request${requests.length !== 1 ? 's' : ''}? This cannot be undone.`}
        destructive
        confirmText="Delete All"
        onCancel={() => setConfirmDeleteAllRequests(false)}
        onConfirm={async () => {
          try {
            await deleteAllRequests();
          } catch (e) {
            console.log('Failed to delete all requests', e);
          } finally {
            setConfirmDeleteAllRequests(false);
          }
        }}
        testID="confirm-delete-all-requests"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
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
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  emptyCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 48,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.muted,
    marginTop: 12,
  },
  checkHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 16,
  },
  checkHeaderLeft: {
    flex: 1,
  },
  checkDate: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  checkTime: {
    fontSize: 12,
    color: Colors.light.muted,
    marginBottom: 2,
  },
  doneSmall: {
    fontSize: 11,
    color: Colors.light.muted,
    marginTop: 2,
  },
  requestDateSmall: {
    fontSize: 10,
    color: Colors.light.tabIconDefault,
  },
  checkOutlet: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '500' as const,
  },
  headerButtons: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.danger + '15',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },

  downloadButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  checkStats: {
    flexDirection: 'row' as const,
    gap: 16,
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center' as const,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.muted,
    textAlign: 'center' as const,
  },
  checkDetails: {
    gap: 8,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  },
  detailProduct: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  detailQuantity: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.accent,
  },
  moreText: {
    fontSize: 12,
    color: Colors.light.muted,
    fontStyle: 'italic' as const,
    marginTop: 4,
  },
  moreTextLink: {
    fontSize: 12,
    color: Colors.light.tint,
    fontStyle: 'italic' as const,
    marginTop: 4,
    textDecorationLine: 'underline' as const,
  },
  outletSelectContainer: {
    marginBottom: 16,
  },
  outletSelectLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  outletSelectWrapper: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  outletSelectButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  outletSelectButtonActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  outletSelectButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  outletSelectButtonTextActive: {
    color: '#fff',
  },
  requestDetailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border + '40',
  },
  requestDetailLeft: {
    flex: 1,
    gap: 4,
  },
  requestDetailRight: {
    alignItems: 'flex-end' as const,
    gap: 4,
  },
  requestDetailBottom: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  deleteButtonSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.light.danger + '15',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  requestFlow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  requestOutletText: {
    fontSize: 11,
    color: Colors.light.muted,
  },
  priorityBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityTextSmall: {
    fontSize: 9,
    fontWeight: '700' as const,
  },
  requestActions: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  editButtonSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 16,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.light.muted,
    marginBottom: 4,
  },
  modalInfo: {
    fontSize: 14,
    color: Colors.light.text,
    marginBottom: 16,
  },
  modalBody: {
    padding: 20,
  },
  modalProductName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
  priorityButtons: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  priorityButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
  },
  priorityButtonActive: {
    borderColor: 'transparent',
  },
  priorityButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  priorityButtonTextActive: {
    color: '#fff',
  },
  modalButtons: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  modalButtonCancel: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modalButtonSave: {
    backgroundColor: Colors.light.tint,
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  modalButtonTextSave: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
  searchBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  productsList: {
    maxHeight: 400,
  },
  productsListContent: {
    paddingBottom: 16,
  },
  emptyProducts: {
    alignItems: 'center' as const,
    padding: 32,
  },
  emptyProductsText: {
    fontSize: 14,
    color: Colors.light.muted,
    marginTop: 12,
    textAlign: 'center' as const,
  },
  addProductCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  addProductInfo: {
    marginBottom: 12,
  },
  addProductName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  addProductUnit: {
    fontSize: 12,
    color: Colors.light.muted,
    marginBottom: 2,
  },
  addProductCategory: {
    fontSize: 11,
    color: Colors.light.tint,
  },
  addInputContainer: {
    gap: 8,
  },
  addInputRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  addInputField: {
    flex: 1,
  },
  fullWidthField: {
    width: '100%',
  },
  addInputLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  addInput: {
    backgroundColor: Colors.light.card,
    borderRadius: 6,
    padding: 8,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  addCurrentDisplay: {
    backgroundColor: Colors.light.card,
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    alignItems: 'center' as const,
  },
  addCurrentText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  addNotesInput: {
    backgroundColor: Colors.light.card,
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  deleteAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.danger + '15',
    borderWidth: 1,
    borderColor: Colors.light.danger + '30',
  },
  deleteAllButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.danger,
  },
  compactHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  compactHeaderLeft: {
    flex: 1,
  },
  compactHeaderRight: {
    paddingLeft: 12,
  },
  compactDate: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  compactOutlet: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '500' as const,
  },
  compactCount: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 2,
  },
  expandedContent: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  outletSection: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
  },
  outletHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 12,
  },
  outletHeaderLeft: {
    flex: 1,
  },
  outletHeaderRight: {
    paddingLeft: 12,
  },
  outletName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.tint,
    marginBottom: 2,
  },
  outletCount: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  outletContent: {
    padding: 12,
    paddingTop: 0,
  },
  outletActions: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    alignItems: 'center' as const,
    padding: 12,
    paddingTop: 8,
    gap: 8,
  },
  checkCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border + '40',
    borderRadius: 8,
    padding: 12,
    backgroundColor: Colors.light.card,
  },
  typeGroup: {
    marginBottom: 12,
  },
  typeTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.light.muted,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  combinedText: {
    fontSize: 11,
    color: Colors.light.tint,
    marginTop: 2,
    fontStyle: 'italic' as const,
  },
  completedByText: {
    fontSize: 11,
    color: Colors.light.muted,
    marginTop: 2,
  },
  requestedByText: {
    fontSize: 11,
    color: Colors.light.muted,
    marginTop: 2,
  },
  autoText: {
    fontSize: 11,
    color: Colors.light.success,
    fontWeight: '700' as const,
  },
  wastageText: {
    fontSize: 11,
    color: Colors.light.danger,
    fontWeight: '600' as const,
  },
  inventoryToggleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 16,
  },
  inventoryToggleActive: {
    backgroundColor: Colors.light.tint + '10',
    borderColor: Colors.light.tint,
  },
  inventoryToggleLabel: {
    fontSize: 14,
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
  dateEditContainer: {
    marginBottom: 16,
  },
  dateEditLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  dateEditButtonWrapper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateEditInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  monthCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: Colors.light.tint + '40',
  },
  monthHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    backgroundColor: Colors.light.tint + '10',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  monthHeaderLeft: {
    flex: 1,
  },
  monthHeaderRight: {
    paddingLeft: 12,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    marginBottom: 4,
  },
  monthCount: {
    fontSize: 13,
    color: Colors.light.text,
    opacity: 0.8,
  },
  monthContent: {
    padding: 12,
  },
});
