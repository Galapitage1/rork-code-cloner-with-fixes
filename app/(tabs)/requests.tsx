import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useState, useMemo, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShoppingCart, Plus, X, Download, Edit2, CalendarDays, ChevronDown, ChevronUp, Trash2, RotateCcw } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useStores } from '@/contexts/StoresContext';
import { Product, ProductRequest, StockCheck } from '@/types';
import Colors from '@/constants/colors';
import { exportRequestsToExcel } from '@/utils/excelExporter';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CalendarModal } from '@/components/CalendarModal';
import { VoiceSearchInput } from '@/components/VoiceSearchInput';
import { useAuth } from '@/contexts/AuthContext';

import { ButtonViewMode } from '@/components/ButtonViewMode';

export default function RequestsScreen() {
  const { products, requests, addRequest, updateRequestStatus, deleteRequest, updateRequest, outlets, isLoading, deductInventoryFromApproval, productConversions, viewMode, inventoryStocks, updateInventoryStock, stockChecks, updateStockCheck, saveStockCheck, getDeletedRequests, restoreRequests } = useStock();
  const { storeProducts, updateStoreProduct } = useStores();
  const { isAdmin, isSuperAdmin, currentUser } = useAuth();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState<string>('');
  const [priority, setPriority] = useState<ProductRequest['priority']>('medium');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [fromOutlet, setFromOutlet] = useState<string>('');
  const [toOutlet, setToOutlet] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editMode, setEditMode] = useState<boolean>(false);
  const [editingRequestOutlet, setEditingRequestOutlet] = useState<ProductRequest | null>(null);
  const [editOutletFrom, setEditOutletFrom] = useState<string>('');
  const [editOutletTo, setEditOutletTo] = useState<string>('');
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'approve' } | null>(null);
  const [requestDate, setRequestDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [requestedBy, setRequestedBy] = useState<string>('');
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedOutlets, setExpandedOutlets] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<'all' | 'menu' | 'kitchen' | 'raw'>('all');
  const [editingRequestItem, setEditingRequestItem] = useState<ProductRequest | null>(null);
  const [editItemFromOutlet, setEditItemFromOutlet] = useState<string>('');
  const [editItemToOutlet, setEditItemToOutlet] = useState<string>('');
  const [editItemQuantity, setEditItemQuantity] = useState<string>('');
  const [showNameRequiredDialog, setShowNameRequiredDialog] = useState<boolean>(false);
  const [showAllRequestsModal, setShowAllRequestsModal] = useState<boolean>(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string; productName: string } | null>(null);
  const [approvalInProgress, setApprovalInProgress] = useState<boolean>(false);
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);
  const [restoreStartDate, setRestoreStartDate] = useState<string>('2026-01-01');
  const [restoreEndDate, setRestoreEndDate] = useState<string>('2026-01-13');
  const [deletedRequestsList, setDeletedRequestsList] = useState<ProductRequest[]>([]);
  const [selectedForRestore, setSelectedForRestore] = useState<Set<string>>(new Set());
  const [isLoadingDeleted, setIsLoadingDeleted] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  useEffect(() => {
    const loadOutletSelection = async () => {
      try {
        const savedFrom = await AsyncStorage.getItem('@requests_from_outlet');
        const savedTo = await AsyncStorage.getItem('@requests_to_outlet');
        if (savedFrom && outlets.find(o => o.name === savedFrom)) {
          setFromOutlet(savedFrom);
        } else if (outlets.length > 0) {
          setFromOutlet(outlets[0]?.name || '');
        }
        if (savedTo && outlets.find(o => o.name === savedTo)) {
          setToOutlet(savedTo);
        } else if (outlets.length > 1) {
          setToOutlet(outlets[1]?.name || '');
        }
      } catch (error) {
        console.error('Failed to load outlet selection:', error);
      }
    };
    loadOutletSelection();
  }, [outlets]);

  const getOpeningStockForProduct = useCallback((productId: string, outletName: string): number => {
    console.log('getOpeningStockForProduct: Getting opening stock for product', productId, 'outlet', outletName);
    
    const product = products.find(p => p.id === productId);
    if (!product) {
      console.log('getOpeningStockForProduct: Product not found');
      return 0;
    }

    if (product.type === 'raw') {
      console.log('getOpeningStockForProduct: Raw product - checking Stores section');
      const storeProduct = storeProducts.find(sp => sp.name.toLowerCase() === product.name.toLowerCase());
      if (storeProduct) {
        console.log('getOpeningStockForProduct: Found', storeProduct.quantity, 'in Stores section');
        return storeProduct.quantity;
      }
      console.log('getOpeningStockForProduct: No matching store product found');
      return 0;
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

    if (!productPair) {
      console.log('getOpeningStockForProduct: No product pair - checking Production Stock (Other Units)');
      const productionOutletNames = outlets.filter(o => o.outletType === 'production').map(o => o.name);
      const productionStockChecks = stockChecks.filter(c => productionOutletNames.includes(c.outlet || ''));
      
      let totalQty = 0;
      productionStockChecks.forEach(check => {
        const count = check.counts.find(c => c.productId === productId);
        if (count) {
          const receivedStock = count.receivedStock || 0;
          const wastage = count.wastage || 0;
          const netStock = Math.max(receivedStock - wastage, count.quantity || 0);
          totalQty += netStock;
        }
      });
      
      console.log('getOpeningStockForProduct: Found', totalQty, 'in Production Stock (Other Units)');
      return totalQty;
    }

    console.log('getOpeningStockForProduct: Product has conversion - checking General Inventory');
    const invStock = inventoryStocks.find(s => s.productId === productPair.wholeProductId);
    if (!invStock) {
      console.log('getOpeningStockForProduct: No inventory stock found');
      return 0;
    }

    const outlet = outlets.find(o => o.name === outletName);
    if (!outlet) {
      console.log('getOpeningStockForProduct: Outlet not found');
      return 0;
    }

    const conversion = productConversions.find(
      c => c.fromProductId === productPair.wholeProductId && c.toProductId === productPair.slicesProductId
    );
    const conversionFactor = conversion?.conversionFactor || 10;

    const isWholeProduct = productId === productPair.wholeProductId;
    let totalStock = 0;

    if (outlet.outletType === 'production') {
      const totalSlices = invStock.productionWhole * conversionFactor + invStock.productionSlices;
      totalStock = isWholeProduct ? invStock.productionWhole + (invStock.productionSlices / conversionFactor) : totalSlices;
    } else {
      const outletStock = invStock.outletStocks.find(os => os.outletName === outletName);
      if (outletStock) {
        const totalSlices = outletStock.whole * conversionFactor + outletStock.slices;
        totalStock = isWholeProduct ? outletStock.whole + (outletStock.slices / conversionFactor) : totalSlices;
      }
    }

    console.log('getOpeningStockForProduct: Found', totalStock, 'in General Inventory');
    return totalStock;
  }, [outlets, productConversions, inventoryStocks, stockChecks, products, storeProducts]);

  const historicalRequestMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    requests.forEach(req => {
      const reqDate = req.requestDate || new Date(req.requestedAt).toISOString().split('T')[0];
      const key = `${reqDate}-${req.toOutlet}`;
      if (!map.has(key)) {
        map.set(key, new Map());
      }
      map.get(key)!.set(req.productId, req.quantity);
    });
    return map;
  }, [requests]);

  const pendingRequests = useMemo(() => 
    requests.filter(r => r.status === 'pending').sort((a, b) => b.requestedAt - a.requestedAt),
    [requests]
  );

  const groupedPendingRequests = useMemo(() => {
    const groups = new Map<string, Map<string, ProductRequest[]>>();
    pendingRequests.forEach(request => {
      const date = request.requestDate || new Date(request.requestedAt).toISOString().split('T')[0];
      if (!groups.has(date)) {
        groups.set(date, new Map());
      }
      const dateGroup = groups.get(date)!;
      const existing = dateGroup.get(request.toOutlet) || [];
      dateGroup.set(request.toOutlet, [...existing, request]);
    });
    return groups;
  }, [pendingRequests]);

  const filteredProducts = useMemo(() => {
    let base = products.filter(p => p.showInStock !== false);
    
    if (filterType !== 'all') {
      base = base.filter(p => p.type === filterType);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      base = base.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.category?.toLowerCase().includes(query) ||
        p.type.toLowerCase().includes(query)
      );
    }

    base.sort((a, b) => {
      const openingStockA = fromOutlet ? getOpeningStockForProduct(a.id, fromOutlet) : 0;
      const openingStockB = fromOutlet ? getOpeningStockForProduct(b.id, fromOutlet) : 0;
      
      const hasStockA = openingStockA > 0 ? 1 : 0;
      const hasStockB = openingStockB > 0 ? 1 : 0;
      
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

    return base;
  }, [products, searchQuery, fromOutlet, getOpeningStockForProduct, filterType]);

  const replaceOutletStockWithCurrentStock = async (productId: string, outletName: string, requestQty: number) => {
    try {
      console.log('replaceOutletStockWithCurrentStock: Starting for product', productId, 'outlet', outletName, 'quantity', requestQty);
      
      const product = products.find(p => p.id === productId);
      if (!product) {
        console.log('replaceOutletStockWithCurrentStock: Product not found');
        return;
      }

      const outlet = outlets.find(o => o.name === outletName);
      if (!outlet) {
        console.log('replaceOutletStockWithCurrentStock: Outlet not found');
        return;
      }

      console.log('replaceOutletStockWithCurrentStock: Product:', product.name, 'Outlet:', outlet.name, 'Type:', outlet.outletType);

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

      if (!productPair) {
        console.log('replaceOutletStockWithCurrentStock: No product pair found - Production Stock (Other Units) product');
        
        console.log('replaceOutletStockWithCurrentStock: Stock for Production Stock (Other Units) is tracked by requests only');
        console.log('replaceOutletStockWithCurrentStock: When approved, the request will show as current stock');
        
        console.log('replaceOutletStockWithCurrentStock: Complete for Production Stock (Other Units)');
        return;
      }

      console.log('replaceOutletStockWithCurrentStock: Product with conversion found - General Inventory product');
      console.log('replaceOutletStockWithCurrentStock: Stock for sales outlets is managed by inventory system');
      console.log('replaceOutletStockWithCurrentStock: Stock will be updated when request is approved');
      console.log('replaceOutletStockWithCurrentStock: Complete');
    } catch (error) {
      console.error('replaceOutletStockWithCurrentStock: Error:', error);
      throw error;
    }
  };

  const handleAddRequest = () => {
    console.log('Add request clicked');
    console.log('Products:', products.length);
    console.log('Outlets:', outlets.length);

    if (products.length === 0) {
      Alert.alert('No Products', 'Please import products first in Settings before making requests.');
      return;
    }
    if (outlets.length < 2) {
      Alert.alert('Insufficient Outlets', 'Please add at least 2 outlets in Settings to create requests between them.');
      return;
    }
    if (!fromOutlet) {
      setFromOutlet(outlets[0]?.name || '');
    }
    if (!toOutlet) {
      setToOutlet(outlets[1]?.name || '');
    }
    setRequestedBy('');
    setShowModal(true);
  };

  const handleSubmitRequest = async () => {
    console.log('Submitting request...');
    
    if (!selectedProduct) {
      Alert.alert('Error', 'Please select a product');
      return;
    }

    if (!fromOutlet || !toOutlet) {
      Alert.alert('Error', 'Please select both outlets');
      return;
    }

    if (!requestDate || requestDate.trim() === '') {
      Alert.alert('Error', 'Please select a request date');
      return;
    }

    const trimmedRequestedBy = requestedBy?.trim() || '';
    console.log('Requested by value:', requestedBy, 'trimmed:', trimmedRequestedBy);
    if (!trimmedRequestedBy || trimmedRequestedBy === '') {
      console.log('Name is empty - showing dialog');
      setShowNameRequiredDialog(true);
      return;
    }
    console.log('Name validation passed, proceeding with submission');

    if (fromOutlet === toOutlet) {
      Alert.alert('Error', 'From and To outlets must be different');
      return;
    }

    if (!quantity.trim()) {
      Alert.alert('Error', 'Please enter a quantity');
      return;
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return;
    }

    try {
      setIsSubmitting(true);
      const todayIso = new Date().toISOString().split('T')[0];
      const request: ProductRequest = {
        id: `req-${Date.now()}`,
        productId: selectedProduct.id,
        quantity: qty,
        priority,
        notes: notes.trim() || undefined,
        requestedAt: Date.now(),
        status: 'pending',
        fromOutlet,
        toOutlet,
        requestDate,
        doneDate: todayIso,
        requestedBy: requestedBy.trim(),
      };

      console.log('Creating request:', request);
      await replaceOutletStockWithCurrentStock(selectedProduct.id, toOutlet, qty);
      await addRequest(request);
      
      setSelectedProduct(null);
      setQuantity('');
      setPriority('medium');
      setNotes('');
    } catch (error) {
      Alert.alert('Error', 'Failed to submit request. Please try again.');
      console.error('Submit error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    const request = requests.find(r => r.id === requestId);
    if (!request) return;

    setConfirmAction({ id: requestId, type: 'approve' });
  };



  const handleDeleteRequest = async (requestId: string) => {
    console.log('========================================');
    console.log('handleDeleteRequest: START - Called for requestId:', requestId);
    console.log('handleDeleteRequest: isSuperAdmin:', isSuperAdmin);
    console.log('handleDeleteRequest: currentUser:', currentUser);
    
    if (!isSuperAdmin) {
      console.log('handleDeleteRequest: BLOCKED - User is not superadmin');
      Alert.alert('Permission Denied', 'Only super admins can delete requests.');
      return;
    }

    const request = requests.find(r => r.id === requestId);
    if (!request) {
      console.log('handleDeleteRequest: ERROR - Request not found in requests array');
      Alert.alert('Error', 'Request not found.');
      return;
    }

    const productName = products.find(p => p.id === request.productId)?.name || 'Unknown';
    console.log('handleDeleteRequest: Request found:', {
      id: requestId,
      product: productName,
      from: request.fromOutlet,
      to: request.toOutlet,
      status: request.status
    });

    console.log('handleDeleteRequest: Showing confirmation dialog...');
    setDeleteConfirmation({ id: requestId, productName });
  };

  const handleDeleteAllRequests = () => {
    Alert.alert(
      'Delete All Requests',
      `Are you sure you want to delete all ${pendingRequests.length} pending requests?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all(
                pendingRequests.map(request => deleteRequest(request.id))
              );
              Alert.alert('Success', 'All requests deleted successfully');
            } catch (error) {
              console.error('Failed to delete all requests:', error);
              Alert.alert('Error', 'Failed to delete all requests');
            }
          },
        },
      ]
    );
  };

  const handleEditRequestOutlet = (request: ProductRequest) => {
    setEditingRequestOutlet(request);
    setEditOutletFrom(request.fromOutlet);
    setEditOutletTo(request.toOutlet);
  };

  const handleSaveOutletEdit = async () => {
    if (!editingRequestOutlet) return;
    
    if (editOutletFrom === editOutletTo) {
      Alert.alert('Error', 'From and To outlets must be different');
      return;
    }

    try {
      await updateRequest(editingRequestOutlet.id, {
        fromOutlet: editOutletFrom,
        toOutlet: editOutletTo,
      });
      setEditingRequestOutlet(null);
      Alert.alert('Success', 'Outlets updated successfully');
    } catch (error) {
      console.error('Update error:', error);
      Alert.alert('Error', 'Failed to update outlets');
    }
  };

  const handleButtonModeAddRequest = async (productId: string, data: any) => {
    const { quantity, priority, comments } = data;

    if (!fromOutlet || !toOutlet) {
      Alert.alert('Error', 'Please configure outlets first');
      return;
    }

    if (fromOutlet === toOutlet) {
      Alert.alert('Error', 'From and To outlets must be different');
      return;
    }

    if (!quantity || parseFloat(quantity) <= 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return;
    }

    try {
      const todayIso = new Date().toISOString().split('T')[0];
      const request: ProductRequest = {
        id: `req-${Date.now()}`,
        productId,
        quantity: parseFloat(quantity),
        priority: priority || 'medium',
        notes: comments || undefined,
        requestedAt: Date.now(),
        status: 'pending',
        fromOutlet,
        toOutlet,
        requestDate: todayIso,
        doneDate: todayIso,
        requestedBy: 'Button Mode',
      };

      await replaceOutletStockWithCurrentStock(productId, toOutlet, parseFloat(quantity));
      await addRequest(request);
      Alert.alert('Success', 'Request added successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to submit request. Please try again.');
      console.error('Submit error:', error);
    }
  };

  const handleExportGroup = async (toOutlet: string, groupRequests: ProductRequest[]) => {
    try {
      await exportRequestsToExcel(toOutlet, groupRequests, products);
      Alert.alert('Success', `Requests for ${toOutlet} exported successfully!`);
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export requests. Please try again.');
    }
  };

  const getPriorityColor = (priority: ProductRequest['priority']) => {
    switch (priority) {
      case 'high': return Colors.light.danger;
      case 'medium': return Colors.light.warning;
      case 'low': return Colors.light.success;
    }
  };



  const toggleDateExpanded = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const toggleOutletExpanded = (dateOutletKey: string) => {
    setExpandedOutlets(prev => {
      const next = new Set(prev);
      if (next.has(dateOutletKey)) {
        next.delete(dateOutletKey);
      } else {
        next.add(dateOutletKey);
      }
      return next;
    });
  };

  const handleEditRequestDate = (dateOutletKey: string) => {
    const [date, toOutlet] = dateOutletKey.split('-TO-');
    setRequestDate(date);
    setToOutlet(toOutlet);
    setShowModal(true);
  };

  const handleEditRequestItem = (request: ProductRequest) => {
    setEditingRequestItem(request);
    setEditItemFromOutlet(request.fromOutlet);
    setEditItemToOutlet(request.toOutlet);
    setEditItemQuantity(request.quantity.toString());
  };

  const handleSaveItemEdit = async () => {
    if (!editingRequestItem || (!isSuperAdmin && !isAdmin)) return;

    const qty = parseFloat(editItemQuantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return;
    }

    if (editItemFromOutlet === editItemToOutlet) {
      Alert.alert('Error', 'From and To outlets must be different');
      return;
    }

    try {
      await updateRequest(editingRequestItem.id, {
        fromOutlet: editItemFromOutlet,
        toOutlet: editItemToOutlet,
        quantity: qty,
      });
      setEditingRequestItem(null);
      Alert.alert('Success', 'Request updated successfully');
    } catch (error) {
      console.error('Update error:', error);
      Alert.alert('Error', 'Failed to update request');
    }
  };

  const handleOpenRestoreModal = async () => {
    setShowRestoreModal(true);
    setIsLoadingDeleted(true);
    setSelectedForRestore(new Set());
    try {
      const deleted = await getDeletedRequests(restoreStartDate, restoreEndDate);
      setDeletedRequestsList(deleted);
    } catch (error) {
      console.error('Failed to load deleted requests:', error);
      Alert.alert('Error', 'Failed to load deleted requests');
    } finally {
      setIsLoadingDeleted(false);
    }
  };

  const handleSearchDeleted = async () => {
    setIsLoadingDeleted(true);
    try {
      const deleted = await getDeletedRequests(restoreStartDate, restoreEndDate);
      setDeletedRequestsList(deleted);
      setSelectedForRestore(new Set());
    } catch (error) {
      console.error('Failed to search deleted requests:', error);
      Alert.alert('Error', 'Failed to search deleted requests');
    } finally {
      setIsLoadingDeleted(false);
    }
  };

  const handleToggleSelectForRestore = (requestId: string) => {
    setSelectedForRestore(prev => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };

  const handleSelectAllDeleted = () => {
    if (selectedForRestore.size === deletedRequestsList.length) {
      setSelectedForRestore(new Set());
    } else {
      setSelectedForRestore(new Set(deletedRequestsList.map(r => r.id)));
    }
  };

  const handleRestoreSelected = async () => {
    if (selectedForRestore.size === 0) {
      Alert.alert('No Selection', 'Please select requests to restore');
      return;
    }

    setIsRestoring(true);
    try {
      const count = await restoreRequests(Array.from(selectedForRestore));
      Alert.alert('Success', `Restored ${count} request(s) successfully`);
      setShowRestoreModal(false);
      setDeletedRequestsList([]);
      setSelectedForRestore(new Set());
    } catch (error) {
      console.error('Failed to restore requests:', error);
      Alert.alert('Error', 'Failed to restore requests');
    } finally {
      setIsRestoring(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
        {showModal && viewMode === 'button' ? (
          <ButtonViewMode
            products={products}
            filterType={filterType}
            productConversions={productConversions}
            onAddRequest={handleButtonModeAddRequest}
            mode="request"
            outlets={outlets}
            onClose={() => setShowModal(false)}
          />
        ) : (
        <>
          <View style={styles.headerBar}>
            <Text style={styles.headerTitle}>Pending Requests</Text>
            <View style={styles.headerButtonsRow}>
              <TouchableOpacity 
                style={styles.addNewButtonTop}
                onPress={handleAddRequest}
              >
                <Plus size={20} color={Colors.light.tint} />
                <Text style={styles.addNewButtonTopText}>Add New Request</Text>
              </TouchableOpacity>
              {isSuperAdmin && pendingRequests.length > 0 && (
                <TouchableOpacity 
                  style={styles.deleteAllButtonTop}
                  onPress={handleDeleteAllRequests}
                >
                  <Trash2 size={18} color={Colors.light.danger} />
                  <Text style={styles.deleteAllButtonTopText}>Delete All</Text>
                </TouchableOpacity>
              )}
              {isSuperAdmin && (
                <TouchableOpacity 
                  style={styles.restoreButtonTop}
                  onPress={handleOpenRestoreModal}
                >
                  <RotateCcw size={18} color={Colors.light.success} />
                  <Text style={styles.restoreButtonTopText}>Restore</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {pendingRequests.length === 0 ? (
            <View style={styles.mainContent}>
              <View style={styles.centerContainer}>
                <ShoppingCart size={80} color={Colors.light.muted} />
                <Text style={styles.mainTitle}>No Pending Requests</Text>
                <Text style={styles.mainSubtitle}>
                  {products.length === 0 
                    ? 'Import products in Settings first'
                    : outlets.length < 2
                    ? 'Add at least 2 outlets in Settings'
                    : 'Create a new request to get started'}
                </Text>
                <TouchableOpacity 
                  style={styles.createButton}
                  onPress={handleAddRequest}
                >
                  <Plus size={24} color={Colors.light.card} />
                  <Text style={styles.createButtonText}>New Request</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                {Array.from(groupedPendingRequests.entries()).map(([date, outletGroups]) => {
                  const isDateExpanded = expandedDates.has(date);
                  const totalRequests = Array.from(outletGroups.values()).reduce((sum, reqs) => sum + reqs.length, 0);
                  const outlets = Array.from(outletGroups.keys()).join(', ');
                  return (
                    <View key={date} style={styles.dateGroupCard}>
                      <TouchableOpacity 
                        style={styles.compactGroupHeader}
                        onPress={() => toggleDateExpanded(date)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.compactGroupLeft}>
                          <Text style={styles.compactGroupTitle}>Date: {date}</Text>
                          <Text style={styles.compactGroupSubtitle}>{totalRequests} request{totalRequests !== 1 ? 's' : ''}</Text>
                          <Text style={styles.compactGroupDates} numberOfLines={1}>To: {outlets}</Text>
                        </View>
                        <View style={styles.compactGroupRight}>
                          {isDateExpanded ? (
                            <ChevronUp size={24} color={Colors.light.tint} />
                          ) : (
                            <ChevronDown size={24} color={Colors.light.tint} />
                          )}
                        </View>
                      </TouchableOpacity>

                      {isDateExpanded && (
                        <View style={styles.expandedGroupContent}>
                          {Array.from(outletGroups.entries()).map(([toOutlet, groupRequests]) => {
                            const outletKey = `${date}-${toOutlet}`;
                            const isOutletExpanded = expandedOutlets.has(outletKey);
                            
                            const groupedByType = (() => {
                              const groups = new Map<string, ProductRequest[]>();
                              groupRequests.forEach(request => {
                                const product = products.find(p => p.id === request.productId);
                                if (!product) return;
                                const type = product.type || 'other';
                                const existing = groups.get(type) || [];
                                groups.set(type, [...existing, request]);
                              });
                              Array.from(groups.values()).forEach(reqs => {
                                reqs.sort((a, b) => {
                                  const prodA = products.find(p => p.id === a.productId);
                                  const prodB = products.find(p => p.id === b.productId);
                                  return (prodA?.name || '').localeCompare(prodB?.name || '');
                                });
                              });
                              return groups;
                            })();

                            return (
                              <View key={outletKey} style={styles.outletSubCard}>
                                <TouchableOpacity 
                                  style={styles.outletSubHeader}
                                  onPress={() => toggleOutletExpanded(outletKey)}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.outletSubLeft}>
                                    <Text style={styles.outletSubTitle}>To: {toOutlet}</Text>
                                    <Text style={styles.outletSubCount}>{groupRequests.length} request{groupRequests.length !== 1 ? 's' : ''}</Text>
                                  </View>
                                  <View style={styles.outletSubRight}>
                                    {(isSuperAdmin || isAdmin) && (
                                      <TouchableOpacity 
                                        style={styles.editGroupButton}
                                        onPress={(e) => {
                                          e.stopPropagation();
                                          handleEditRequestDate(`${date}-TO-${toOutlet}`);
                                        }}
                                      >
                                        <Edit2 size={16} color={Colors.light.tint} />
                                        <Text style={styles.editGroupButtonText}>Edit</Text>
                                      </TouchableOpacity>
                                    )}
                                    {isOutletExpanded ? (
                                      <ChevronUp size={20} color={Colors.light.accent} />
                                    ) : (
                                      <ChevronDown size={20} color={Colors.light.accent} />
                                    )}
                                  </View>
                                </TouchableOpacity>

                                {isOutletExpanded && (
                                  <View style={styles.outletExpandedContent}>
                                    <TouchableOpacity 
                                      style={styles.exportButton}
                                      onPress={() => handleExportGroup(toOutlet, groupRequests)}
                                    >
                                      <Download size={18} color={Colors.light.tint} />
                                      <Text style={styles.exportButtonText}>Export</Text>
                                    </TouchableOpacity>

                                    {Array.from(groupedByType.entries()).map(([type, typeRequests]) => (
                                      <View key={type} style={styles.typeSection}>
                                        <Text style={styles.typeSectionTitle}>{type.toUpperCase()}</Text>
                                        <View style={styles.itemsList}>
                                          {typeRequests.map((request) => {
                                            const product = products.find(p => p.id === request.productId);
                                            if (!product) return null;

                                            return (
                                              <View key={request.id} style={styles.compactRequestItem}>
                                                <View style={styles.compactItemHeader}>
                                                  <View style={styles.compactItemLeft}>
                                                    <Text style={styles.compactProductName}>{product.name}</Text>
                                                    <View style={styles.compactItemDetails}>
                                                      <Text style={styles.compactQuantity}>
                                                        {request.quantity} {product.unit}
                                                      </Text>
                                                      <Text style={styles.compactSeparator}>•</Text>
                                                      <Text style={styles.compactFromOutlet}>From: {request.fromOutlet}</Text>
                                                    </View>
                                                  </View>
                                                  <View style={styles.compactItemRight}>
                                                    {(isSuperAdmin || isAdmin) && (
                                                      <TouchableOpacity 
                                                        style={styles.compactEditItemButton}
                                                        onPress={() => handleEditRequestItem(request)}
                                                      >
                                                        <Edit2 size={14} color={Colors.light.tint} />
                                                      </TouchableOpacity>
                                                    )}
                                                    <View style={[styles.compactPriorityBadge, { backgroundColor: getPriorityColor(request.priority) + '20' }]}>
                                                      <Text style={[styles.compactPriorityText, { color: getPriorityColor(request.priority) }]}>
                                                        {request.priority.charAt(0).toUpperCase()}
                                                      </Text>
                                                    </View>
                                                  </View>
                                                </View>
                                                {request.notes && (
                                                  <Text style={styles.compactNotes} numberOfLines={1}>{request.notes}</Text>
                                                )}
                                                {(isAdmin || isSuperAdmin) && (
                                                  <View style={styles.compactActionRow}>
                                                    <TouchableOpacity 
                                                      style={styles.compactApproveButton}
                                                      onPress={() => handleApprove(request.id)}
                                                    >
                                                      <Text style={styles.compactActionText}>Approve</Text>
                                                    </TouchableOpacity>
                                                    {isSuperAdmin && (
                                                      <TouchableOpacity 
                                                        onPress={() => {
                                                          console.log('Delete button pressed for request:', request.id);
                                                          handleDeleteRequest(request.id);
                                                        }}
                                                        style={styles.compactDeleteButton}
                                                        activeOpacity={0.7}
                                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                                      >
                                                        <X size={18} color={Colors.light.danger} />
                                                      </TouchableOpacity>
                                                    )}
                                                  </View>
                                                )}
                                              </View>
                                            );
                                          })}
                                        </View>
                                      </View>
                                    ))}
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
              </ScrollView>
            </>
          )}

        <Modal
          visible={showModal && viewMode !== 'button'}
          animationType="slide"
          transparent={false}
          onRequestClose={() => {
            setRequestedBy('');
            setShowModal(false);
          }}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>New Request</Text>
                <TouchableOpacity onPress={() => {
                  setRequestedBy('');
                  setShowModal(false);
                }}>
                  <X size={24} color={Colors.light.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalScroll}>
                <View style={styles.outletsRow}>
                  <View style={styles.outletColumn}>
                    <Text style={styles.label}>From Outlet</Text>
                    <View style={styles.pickerContainer}>
                      <Picker
                        selectedValue={fromOutlet}
                        onValueChange={(itemValue: string) => {
                          setFromOutlet(itemValue);
                          AsyncStorage.setItem('@requests_from_outlet', itemValue).catch(console.error);
                        }}
                        style={styles.picker}
                      >
                        {outlets.map((outlet) => (
                          <Picker.Item
                            key={outlet.id}
                            label={outlet.name}
                            value={outlet.name}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>

                  <View style={styles.outletColumn}>
                    <Text style={styles.label}>To Outlet</Text>
                    <View style={styles.pickerContainer}>
                      <Picker
                        selectedValue={toOutlet}
                        onValueChange={(itemValue: string) => {
                          setToOutlet(itemValue);
                          AsyncStorage.setItem('@requests_to_outlet', itemValue).catch(console.error);
                        }}
                        style={styles.picker}
                      >
                        {outlets.map((outlet) => (
                          <Picker.Item
                            key={outlet.id}
                            label={outlet.name}
                            value={outlet.name}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: Colors.light.muted, fontWeight: '600' }}>Request Date</Text>
                  <TouchableOpacity onPress={() => setShowCalendar(true)} style={{ padding: 6, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 6, backgroundColor: Colors.light.card }} testID="open-calendar-request">
                    <CalendarDays size={14} color={Colors.light.tint} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => {
                    const d = new Date(requestDate);
                    d.setDate(d.getDate() - 1);
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    setRequestDate(`${y}-${m}-${day}`);
                  }} style={{ padding: 6, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 6, backgroundColor: Colors.light.card }}>
                    <Text>-</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowCalendar(true)}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.light.text, minWidth: 88, textAlign: 'center' }}>{requestDate}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => {
                    const d = new Date(requestDate);
                    d.setDate(d.getDate() + 1);
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    setRequestDate(`${y}-${m}-${day}`);
                  }} style={{ padding: 6, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 6, backgroundColor: Colors.light.card }}>
                    <Text>+</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <Text style={{ fontSize: 12, color: Colors.light.muted, fontWeight: '600' }}>Requested By</Text>
                  <TextInput
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: Colors.light.text,
                      padding: 8,
                      backgroundColor: Colors.light.background,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: Colors.light.border,
                    }}
                    placeholder="Enter your name"
                    value={requestedBy}
                    onChangeText={setRequestedBy}
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>

                <Text style={styles.label}>Product</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  style={styles.productTypeTabs}
                >
                  <TouchableOpacity
                    style={[
                      styles.typeTab,
                      filterType === 'all' && styles.typeTabSelected
                    ]}
                    onPress={() => setFilterType('all')}
                  >
                    <Text style={[
                      styles.typeTabText,
                      filterType === 'all' && styles.typeTabTextSelected
                    ]}>All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeTab,
                      filterType === 'menu' && styles.typeTabSelected
                    ]}
                    onPress={() => setFilterType('menu')}
                  >
                    <Text style={[
                      styles.typeTabText,
                      filterType === 'menu' && styles.typeTabTextSelected
                    ]}>Menu</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeTab,
                      filterType === 'kitchen' && styles.typeTabSelected
                    ]}
                    onPress={() => setFilterType('kitchen')}
                  >
                    <Text style={[
                      styles.typeTabText,
                      filterType === 'kitchen' && styles.typeTabTextSelected
                    ]}>Kitchen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeTab,
                      filterType === 'raw' && styles.typeTabSelected
                    ]}
                    onPress={() => setFilterType('raw')}
                  >
                    <Text style={[
                      styles.typeTabText,
                      filterType === 'raw' && styles.typeTabTextSelected
                    ]}>Raw</Text>
                  </TouchableOpacity>
                </ScrollView>
                <VoiceSearchInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search products..."
                  placeholderTextColor={Colors.light.muted}
                  style={styles.searchContainer}
                />
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={true}
                  persistentScrollbar={true}
                  style={styles.productSelector}
                >
                  {filteredProducts.map((product) => {
                    const historicalKey = `${requestDate}-${toOutlet}`;
                    const historicalQty = historicalRequestMap.get(historicalKey)?.get(product.id);
                    const openingStock = fromOutlet ? getOpeningStockForProduct(product.id, fromOutlet) : 0;
                    return (
                      <TouchableOpacity
                        key={product.id}
                        style={[
                          styles.productChip,
                          selectedProduct?.id === product.id && styles.productChipSelected
                        ]}
                        onPress={() => {
                          setSelectedProduct(product);
                          if (historicalQty !== undefined && toOutlet && requestDate) {
                            setQuantity(historicalQty.toString());
                          } else if (openingStock > 0) {
                            setQuantity(openingStock.toString());
                          } else {
                            setQuantity('');
                          }
                        }}
                      >
                        <View>
                          <Text style={[
                            styles.productChipText,
                            selectedProduct?.id === product.id && styles.productChipTextSelected
                          ]}>
                            {product.name}
                          </Text>
                          <Text style={[
                            styles.productChipUnit,
                            selectedProduct?.id === product.id && styles.productChipUnitSelected
                          ]}>
                            {product.unit}{openingStock > 0 && ` · Stock: ${openingStock.toFixed(1)}`}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={styles.label}>Quantity</Text>
                <TextInput
                  style={styles.input}
                  placeholder={selectedProduct ? `Enter quantity in ${selectedProduct.unit}` : 'Select product first'}
                  keyboardType="decimal-pad"
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholderTextColor={Colors.light.muted}
                />

                <Text style={styles.label}>Priority</Text>
                <View style={styles.prioritySelector}>
                  {(['low', 'medium', 'high'] as const).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityButton,
                        priority === p && { backgroundColor: getPriorityColor(p) }
                      ]}
                      onPress={() => setPriority(p)}
                    >
                      <Text style={[
                        styles.priorityButtonText,
                        priority === p && styles.priorityButtonTextSelected
                      ]}>
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>Notes (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.notesInputModal]}
                  placeholder="Add any additional notes..."
                  multiline
                  numberOfLines={3}
                  value={notes}
                  onChangeText={setNotes}
                  placeholderTextColor={Colors.light.muted}
                />
              </ScrollView>

              <TouchableOpacity
                style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
                onPress={handleSubmitRequest}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={Colors.light.card} />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <CalendarModal
          visible={showCalendar}
          initialDate={requestDate}
          onClose={() => setShowCalendar(false)}
          onSelect={(iso) => {
            setRequestDate(iso);
            setShowCalendar(false);
          }}
          testID="calendar-requests"
        />



        <ConfirmDialog
          visible={!!confirmAction}
          title={'Approve Request'}
          message={approvalInProgress ? 'Processing approval...' : 'Are you sure you want to approve this request?'}
          destructive={false}
          onCancel={() => !approvalInProgress && setConfirmAction(null)}
          onConfirm={async () => {
            if (!confirmAction || approvalInProgress) return;
            
            setApprovalInProgress(true);
            
            try {
              const request = requests.find(r => r.id === confirmAction.id);
              if (!request) {
                setConfirmAction(null);
                setApprovalInProgress(false);
                return;
              }

              const product = products.find(p => p.id === request.productId);
              if (product && product.type === 'raw') {
                console.log('Approving raw material request - checking Stores section');
                const storeProduct = storeProducts.find(sp => sp.name.toLowerCase() === product.name.toLowerCase());
                
                if (!storeProduct) {
                  setConfirmAction(null);
                  setApprovalInProgress(false);
                  Alert.alert('Cannot Approve', `Raw material "${product.name}" not found in Stores section`);
                  return;
                }

                if (storeProduct.quantity < request.quantity) {
                  setConfirmAction(null);
                  setApprovalInProgress(false);
                  Alert.alert('Cannot Approve', `Insufficient stock in Stores: ${storeProduct.quantity} ${product.unit} available, ${request.quantity} ${product.unit} requested`);
                  return;
                }

                console.log(`Deducting ${request.quantity} from store product ${storeProduct.name}`);
                
                const requestDate = request.requestDate || new Date(request.requestedAt).toISOString().split('T')[0];
                const targetOutletCheck = stockChecks.find(c => c.outlet === request.toOutlet && c.date === requestDate);
                
                const updateOperations = [];
                
                updateOperations.push(
                  updateStoreProduct(storeProduct.id, {
                    quantity: storeProduct.quantity - request.quantity,
                  })
                );
                
                if (targetOutletCheck) {
                  console.log('Found existing stock check for target outlet');
                  const targetCountIndex = targetOutletCheck.counts.findIndex(c => c.productId === request.productId);
                  const updatedTargetCounts = [...targetOutletCheck.counts];
                  
                  if (targetCountIndex >= 0) {
                    const existingCount = updatedTargetCounts[targetCountIndex];
                    updatedTargetCounts[targetCountIndex] = {
                      ...existingCount,
                      quantity: existingCount.quantity + request.quantity,
                      receivedStock: (existingCount.receivedStock || 0) + request.quantity,
                    };
                  } else {
                    updatedTargetCounts.push({
                      productId: request.productId,
                      quantity: request.quantity,
                      receivedStock: request.quantity,
                      openingStock: 0,
                    });
                  }
                  
                  updateOperations.push(updateStockCheck(targetOutletCheck.id, updatedTargetCounts));
                } else {
                  console.log('No existing stock check for target outlet on', requestDate, '- creating one');
                  const newStockCheck: StockCheck = {
                    id: `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    date: requestDate,
                    outlet: request.toOutlet,
                    counts: [{
                      productId: request.productId,
                      quantity: request.quantity,
                      receivedStock: request.quantity,
                      openingStock: 0,
                    }],
                    timestamp: Date.now(),
                    completedBy: 'AUTO',
                  };
                  updateOperations.push(saveStockCheck(newStockCheck, true));
                }
                
                updateOperations.push(updateRequestStatus(confirmAction.id, 'approved'));
                
                await Promise.all(updateOperations);
                console.log('All operations completed successfully');
              } else {
                const result = await deductInventoryFromApproval(request);
                if (!result.success) {
                  setConfirmAction(null);
                  setApprovalInProgress(false);
                  Alert.alert('Cannot Approve', result.message || 'Insufficient inventory');
                  return;
                }
                await updateRequestStatus(confirmAction.id, 'approved');
              }

              setConfirmAction(null);
              setApprovalInProgress(false);
            } catch (error) {
              console.error('Error during approval:', error);
              Alert.alert('Error', 'Failed to approve request. Please try again.');
              setConfirmAction(null);
              setApprovalInProgress(false);
            }
          }}
          testID="confirm-request-action"
        />

        <Modal
          visible={editingRequestItem !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingRequestItem(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContentSmall}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Item</Text>
                <TouchableOpacity onPress={() => setEditingRequestItem(null)}>
                  <X size={24} color={Colors.light.text} />
                </TouchableOpacity>
              </View>
              
              {editingRequestItem && (
                <View style={styles.modalBody}>
                  <Text style={styles.modalProductName}>
                    {products.find(p => p.id === editingRequestItem.productId)?.name}
                  </Text>

                  <View style={styles.editFieldGroup}>
                    <Text style={styles.inputLabel}>From Outlet</Text>
                    <View style={styles.pickerContainer}>
                      <Picker
                        selectedValue={editItemFromOutlet}
                        onValueChange={(itemValue: string) => setEditItemFromOutlet(itemValue)}
                        style={styles.picker}
                      >
                        {outlets.map((outlet) => (
                          <Picker.Item
                            key={outlet.id}
                            label={outlet.name}
                            value={outlet.name}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>

                  <View style={styles.editFieldGroup}>
                    <Text style={styles.inputLabel}>To Outlet</Text>
                    <View style={styles.pickerContainer}>
                      <Picker
                        selectedValue={editItemToOutlet}
                        onValueChange={(itemValue: string) => setEditItemToOutlet(itemValue)}
                        style={styles.picker}
                      >
                        {outlets.map((outlet) => (
                          <Picker.Item
                            key={outlet.id}
                            label={outlet.name}
                            value={outlet.name}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>

                  <View style={styles.editFieldGroup}>
                    <Text style={styles.inputLabel}>Quantity</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Enter quantity"
                      keyboardType="decimal-pad"
                      value={editItemQuantity}
                      onChangeText={setEditItemQuantity}
                      placeholderTextColor={Colors.light.muted}
                    />
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonCancel]}
                      onPress={() => setEditingRequestItem(null)}
                    >
                      <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonSave]}
                      onPress={handleSaveItemEdit}
                    >
                      <Text style={styles.modalButtonTextSave}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        </Modal>

        <Modal
          visible={editingRequestOutlet !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingRequestOutlet(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContentSmall}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Request Outlets</Text>
                <TouchableOpacity onPress={() => setEditingRequestOutlet(null)}>
                  <X size={24} color={Colors.light.text} />
                </TouchableOpacity>
              </View>
              
              {editingRequestOutlet && (
                <View style={styles.modalBody}>
                  <Text style={styles.modalProductName}>
                    {products.find(p => p.id === editingRequestOutlet.productId)?.name}
                  </Text>

                  <View style={styles.outletsRow}>
                    <View style={styles.outletColumn}>
                      <Text style={styles.inputLabel}>From Outlet</Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={editOutletFrom}
                          onValueChange={(itemValue: string) => setEditOutletFrom(itemValue)}
                          style={styles.picker}
                        >
                          {outlets.map((outlet) => (
                            <Picker.Item
                              key={outlet.id}
                              label={outlet.name}
                              value={outlet.name}
                            />
                          ))}
                        </Picker>
                      </View>
                    </View>

                    <View style={styles.outletColumn}>
                      <Text style={styles.inputLabel}>To Outlet</Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={editOutletTo}
                          onValueChange={(itemValue: string) => setEditOutletTo(itemValue)}
                          style={styles.picker}
                        >
                          {outlets.map((outlet) => (
                            <Picker.Item
                              key={outlet.id}
                              label={outlet.name}
                              value={outlet.name}
                            />
                          ))}
                        </Picker>
                      </View>
                    </View>
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonCancel]}
                      onPress={() => setEditingRequestOutlet(null)}
                    >
                      <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonSave]}
                      onPress={handleSaveOutletEdit}
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
          visible={showNameRequiredDialog}
          title="Name Required"
          message='Please enter your name in the "Requested By" field before submitting.'
          confirmText="OK"
          cancelText=""
          onConfirm={() => setShowNameRequiredDialog(false)}
          onCancel={() => setShowNameRequiredDialog(false)}
          testID="name-required-dialog"
        />

        <ConfirmDialog
          visible={!!deleteConfirmation}
          title="Delete Request"
          message={deleteConfirmation ? `Are you sure you want to delete the request for "${deleteConfirmation.productName}"?` : ''}
          confirmText="Delete"
          cancelText="Cancel"
          destructive={true}
          onCancel={() => {
            console.log('handleDeleteRequest: User pressed CANCEL');
            setDeleteConfirmation(null);
          }}
          onConfirm={async () => {
            if (!deleteConfirmation) return;
            try {
              console.log('handleDeleteRequest: User pressed DELETE - executing...');
              await deleteRequest(deleteConfirmation.id);
              console.log('handleDeleteRequest: deleteRequest() function completed');
              setDeleteConfirmation(null);
              console.log('handleDeleteRequest: SUCCESS');
              console.log('========================================');
            } catch (error) {
              console.error('handleDeleteRequest: FAILED with error:', error);
              Alert.alert('Error', 'Failed to delete request. Please try again.');
              setDeleteConfirmation(null);
              console.log('========================================');
            }
          }}
          testID="delete-request-confirm"
        />

        <Modal
          visible={showRestoreModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowRestoreModal(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Restore Deleted Requests</Text>
                <TouchableOpacity onPress={() => setShowRestoreModal(false)}>
                  <X size={24} color={Colors.light.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.restoreDateRow}>
                <View style={styles.restoreDateCol}>
                  <Text style={styles.restoreDateLabel}>From Date</Text>
                  <TextInput
                    style={styles.restoreDateInput}
                    value={restoreStartDate}
                    onChangeText={setRestoreStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
                <View style={styles.restoreDateCol}>
                  <Text style={styles.restoreDateLabel}>To Date</Text>
                  <TextInput
                    style={styles.restoreDateInput}
                    value={restoreEndDate}
                    onChangeText={setRestoreEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
                <TouchableOpacity 
                  style={styles.searchDeletedButton}
                  onPress={handleSearchDeleted}
                >
                  <Text style={styles.searchDeletedButtonText}>Search</Text>
                </TouchableOpacity>
              </View>

              {isLoadingDeleted ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={Colors.light.tint} />
                  <Text style={styles.loadingText}>Loading deleted requests...</Text>
                </View>
              ) : deletedRequestsList.length === 0 ? (
                <View style={styles.emptyRestoreContainer}>
                  <RotateCcw size={48} color={Colors.light.muted} />
                  <Text style={styles.emptyRestoreText}>No deleted requests found for this date range</Text>
                </View>
              ) : (
                <>
                  <View style={styles.restoreSelectAllRow}>
                    <TouchableOpacity 
                      style={styles.selectAllButton}
                      onPress={handleSelectAllDeleted}
                    >
                      <View style={[styles.restoreCheckbox, selectedForRestore.size === deletedRequestsList.length && styles.restoreCheckboxSelected]} />
                      <Text style={styles.selectAllText}>
                        {selectedForRestore.size === deletedRequestsList.length ? 'Deselect All' : 'Select All'} ({deletedRequestsList.length})
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.deletedRequestsList}>
                    {deletedRequestsList.map((request) => {
                      const product = products.find(p => p.id === request.productId);
                      const isSelected = selectedForRestore.has(request.id);
                      const reqDate = request.requestDate || new Date(request.requestedAt).toISOString().split('T')[0];

                      return (
                        <TouchableOpacity 
                          key={request.id} 
                          style={[styles.deletedRequestItem, isSelected && styles.deletedRequestItemSelected]}
                          onPress={() => handleToggleSelectForRestore(request.id)}
                        >
                          <View style={[styles.restoreCheckbox, isSelected && styles.restoreCheckboxSelected]} />
                          <View style={styles.deletedRequestInfo}>
                            <Text style={styles.deletedRequestProduct}>{product?.name || 'Unknown'}</Text>
                            <Text style={styles.deletedRequestDetails}>
                              {request.quantity} {product?.unit || ''} • {reqDate} • {request.status}
                            </Text>
                            <Text style={styles.deletedRequestRoute}>
                              {request.fromOutlet} → {request.toOutlet}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <TouchableOpacity
                    style={[styles.restoreButton, (isRestoring || selectedForRestore.size === 0) && styles.restoreButtonDisabled]}
                    onPress={handleRestoreSelected}
                    disabled={isRestoring || selectedForRestore.size === 0}
                  >
                    {isRestoring ? (
                      <ActivityIndicator color={Colors.light.card} />
                    ) : (
                      <Text style={styles.restoreButtonText}>
                        Restore {selectedForRestore.size} Request{selectedForRestore.size !== 1 ? 's' : ''}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>

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
    marginBottom: 24,
  },
  emptyButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  mainContent: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  centerContainer: {
    alignItems: 'center' as const,
    padding: 32,
    maxWidth: 500,
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 20,
    textAlign: 'center' as const,
  },
  mainSubtitle: {
    fontSize: 16,
    color: Colors.light.muted,
    textAlign: 'center' as const,
    marginTop: 12,
    marginBottom: 32,
  },
  createButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 24,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  headerBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerButtonsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  addNewButtonTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.tint + '15',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  addNewButtonTopText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  deleteAllButtonTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.danger,
  },
  deleteAllButtonTopText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.danger,
  },
  editGroupButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.light.tint + '15',
    borderWidth: 1,
    borderColor: Colors.light.tint,
    marginRight: 8,
  },
  editGroupButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  allRequestsContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  allRequestsHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: {
    padding: 4,
  },
  allRequestsTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  allRequestsScrollView: {
    flex: 1,
  },
  requestStatusSection: {
    padding: 16,
  },
  statusSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 12,
  },
  statusSectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  statusBadgePending: {
    backgroundColor: '#FFA500',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeApproved: {
    backgroundColor: Colors.light.success,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  deleteAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.light.danger + '15',
    borderWidth: 1,
    borderColor: Colors.light.danger,
  },
  deleteAllButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.danger,
  },
  editAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.light.tint + '15',
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  editAllButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
  emptyStateSmall: {
    padding: 24,
    alignItems: 'center' as const,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  requestListScroll: {
    maxHeight: 400,
  },
  approvedRequestCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  approvedRequestHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  approvedProductName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  approvedRequestDate: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 4,
  },
  approvedRequestDetails: {
    alignItems: 'flex-end' as const,
  },
  approvedQuantity: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 6,
  },
  approvedBadge: {
    backgroundColor: Colors.light.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  approvedBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
  approvedRequestFlow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  approvedOutletText: {
    fontSize: 13,
    color: Colors.light.text,
  },
  approvedArrow: {
    fontSize: 16,
    color: Colors.light.muted,
  },
  approvedNotes: {
    fontSize: 12,
    color: Colors.light.muted,
    fontStyle: 'italic' as const,
  },
  addButton: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  requestCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  requestHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  requestTitleRow: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  productName: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
    flex: 1,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  requestDetails: {
    gap: 6,
    marginBottom: 12,
  },
  quantityText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  notesText: {
    fontSize: 14,
    color: Colors.light.muted,
    fontStyle: 'italic' as const,
  },
  dateText: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  actionButtons: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  approveButton: {
    backgroundColor: Colors.light.success,
  },
  fulfillButton: {
    backgroundColor: Colors.light.tint,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  modalContent: {
    flex: 1,
    backgroundColor: Colors.light.card,
    padding: 24,
    paddingTop: 60,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalScroll: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 16,
  },
  productSelector: {
    flexDirection: 'row' as const,
    marginBottom: 8,
    paddingBottom: 16,
  },
  productChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  productChipSelected: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  productChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  productChipTextSelected: {
    color: Colors.light.card,
  },
  productChipUnit: {
    fontSize: 11,
    color: Colors.light.muted,
    marginTop: 2,
  },
  productChipUnitSelected: {
    color: Colors.light.card,
    opacity: 0.8,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  notesInputModal: {
    height: 80,
    textAlignVertical: 'top' as const,
  },
  prioritySelector: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  priorityButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  priorityButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  priorityButtonTextSelected: {
    color: Colors.light.card,
  },
  submitButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center' as const,
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
  fab: {
    position: 'absolute' as const,
    right: 20,
    bottom: 100,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: Colors.light.card,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
      },
      android: {
        elevation: 12,
      },
      web: {
        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.25)',
      },
    }),
  },
  outletFlow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 12,
    marginBottom: 12,
    paddingVertical: 8,
  },
  outletBadge: {
    backgroundColor: Colors.light.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
  },
  outletBadgeLabel: {
    fontSize: 10,
    color: Colors.light.muted,
    marginBottom: 2,
    textTransform: 'uppercase' as const,
  },
  outletBadgeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  outletSelectorScroll: {
    flexDirection: 'row' as const,
    marginBottom: 8,
  },
  outletChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  outletChipSelected: {
    backgroundColor: Colors.light.success,
    borderColor: Colors.light.success,
  },
  outletChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  outletChipTextSelected: {
    color: Colors.light.card,
  },
  pickerContainer: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden' as const,
    marginBottom: 8,
  },
  picker: {
    backgroundColor: Colors.light.background,
    color: Colors.light.text,
  },
  searchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  clearButton: {
    padding: 4,
  },
  outletGroup: {
    marginBottom: 24,
  },
  dateGroupCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  outletSubCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  outletSubHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  outletSubLeft: {
    flex: 1,
  },
  outletSubRight: {
    paddingLeft: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  outletSubTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  outletSubCount: {
    fontSize: 13,
    color: Colors.light.accent,
    fontWeight: '500' as const,
  },
  outletExpandedContent: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  typeSection: {
    marginTop: 12,
  },
  typeSectionTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.muted,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  outletGroupCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  outletGroupHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  outletGroupTitleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    flex: 1,
  },
  outletGroupTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  outletGroupBadge: {
    backgroundColor: Colors.light.tint + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  outletGroupBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  exportButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  deleteButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.danger + '20',
    marginLeft: 8,
  },
  itemsList: {
    gap: 8,
  },
  compactRequestItem: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  compactItemHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 8,
  },
  compactItemLeft: {
    flex: 1,
    marginRight: 8,
  },
  compactProductName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  compactItemDetails: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  compactQuantity: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  compactSeparator: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  compactFromOutlet: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  compactItemRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  compactPriorityBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  compactPriorityText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  compactDeleteButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.danger + '15',
    borderWidth: 1,
    borderColor: Colors.light.danger + '30',
  },
  compactNotes: {
    fontSize: 12,
    color: Colors.light.muted,
    fontStyle: 'italic' as const,
    marginBottom: 8,
  },
  compactActionRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  compactApproveButton: {
    flex: 1,
    backgroundColor: Colors.light.success,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center' as const,
  },
  compactActionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.card,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  editModeButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.background,
  },
  editModeButtonActive: {
    backgroundColor: Colors.light.tint,
  },
  editModeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  editModeTextActive: {
    color: Colors.light.card,
  },
  compactGroupHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  compactGroupLeft: {
    flex: 1,
  },
  compactGroupRight: {
    paddingLeft: 12,
  },
  compactGroupTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  compactGroupSubtitle: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '500' as const,
  },
  compactGroupDates: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 2,
  },
  expandedGroupContent: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  compactEditRequestButton: {
    flex: 1,
    backgroundColor: Colors.light.accent,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center' as const,
  },
  compactEditItemButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.tint + '20',
    marginRight: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 16,
  },
  modalContentSmall: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    width: '100%',
    maxWidth: 500,
    padding: 20,
  },
  modalBody: {
    marginTop: 16,
  },
  modalProductName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 12,
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
  outletsRow: {
    flexDirection: 'column' as const,
    gap: 12,
    marginBottom: 8,
  },
  outletColumn: {
    flex: 1,
    width: '100%',
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.light.muted,
    marginBottom: 16,
  },
  editFieldGroup: {
    marginBottom: 16,
  },
  dateEditRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  dateEditButton: {
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
  },
  dateAdjustButton: {
    padding: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
  },
  dateAdjustText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  dateDisplayButton: {
    flex: 1,
    padding: 10,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateDisplayText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    textAlign: 'center' as const,
  },
  productTypeTabs: {
    flexDirection: 'row' as const,
    marginBottom: 12,
  },
  typeTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  typeTabSelected: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  typeTabText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  typeTabTextSelected: {
    color: Colors.light.card,
  },
  restoreButtonTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.success + '15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.success,
  },
  restoreButtonTopText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.success,
  },
  restoreDateRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 12,
    marginBottom: 16,
  },
  restoreDateCol: {
    flex: 1,
  },
  restoreDateLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.muted,
    marginBottom: 6,
  },
  restoreDateInput: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchDeletedButton: {
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  searchDeletedButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  emptyRestoreContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 32,
  },
  emptyRestoreText: {
    fontSize: 16,
    color: Colors.light.muted,
    textAlign: 'center' as const,
    marginTop: 16,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.light.muted,
    marginTop: 12,
  },
  restoreSelectAllRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  selectAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  restoreCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  restoreCheckboxSelected: {
    backgroundColor: Colors.light.success,
    borderColor: Colors.light.success,
  },
  deletedRequestsList: {
    flex: 1,
  },
  deletedRequestItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 14,
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  deletedRequestItemSelected: {
    backgroundColor: Colors.light.success + '15',
    borderColor: Colors.light.success,
  },
  deletedRequestInfo: {
    flex: 1,
  },
  deletedRequestProduct: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  deletedRequestDetails: {
    fontSize: 13,
    color: Colors.light.muted,
    marginBottom: 2,
  },
  deletedRequestRoute: {
    fontSize: 12,
    color: Colors.light.accent,
  },
  restoreButton: {
    backgroundColor: Colors.light.success,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center' as const,
    marginTop: 16,
  },
  restoreButtonDisabled: {
    opacity: 0.5,
  },
  restoreButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
});
