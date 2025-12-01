import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal, Platform, ActivityIndicator } from 'react-native';
import { useState, useMemo } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Package, Edit2, Download, Trash2, X, Save, Upload, Plus } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { VoiceSearchInput } from '@/components/VoiceSearchInput';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import Colors from '@/constants/colors';
import { Product, InventoryStock, StockCheck, StockCount, ProductRequest } from '@/types';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React from "react";

export default function InventoryScreen() {
  const { 
    products, 
    outlets, 
    inventoryStocks, 
    updateInventoryStock, 
    addInventoryStock, 
    clearAllInventory, 
    isLoading, 
    productConversions, 
    stockChecks,
    updateStockCheck,
    requests,
    addProduct,
    saveStockCheck,
    addRequest,
    deleteRequest,
    updateRequest
  } = useStock();
  const { isSuperAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingStock, setEditingStock] = useState<InventoryStock | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [editValues, setEditValues] = useState<{
    productionWhole: string;
    productionSlices: string;
    prodsReqWhole: string;
    prodsReqSlices: string;
    outletStocks: { outletName: string; whole: string; slices: string }[];
  }>({
    productionWhole: '0',
    productionSlices: '0',
    prodsReqWhole: '0',
    prodsReqSlices: '0',
    outletStocks: [],
  });
  const [showEditOtherUnitsModal, setShowEditOtherUnitsModal] = useState<boolean>(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editOtherUnitsValues, setEditOtherUnitsValues] = useState<{
    outletStocks: { outletName: string; quantity: string }[];
  }>({
    outletStocks: [],
  });
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSavingOtherUnits, setIsSavingOtherUnits] = useState<boolean>(false);
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);
  const [addProductModalType, setAddProductModalType] = useState<'conversion' | 'other'>('conversion');
  const [selectedProductToAdd, setSelectedProductToAdd] = useState<string>('');
  const [showImportProgress, setShowImportProgress] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{
    currentRow: number;
    totalRows: number;
    productsAdded: number;
    productsUpdated: number;
    productsSkipped: number;
    errors: string[];
    isComplete: boolean;
  }>({
    currentRow: 0,
    totalRows: 0,
    productsAdded: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    errors: [],
    isComplete: false,
  });

  const productionOutlets = useMemo(() => 
    outlets.filter(o => o.outletType === 'production'),
    [outlets]
  );

  const salesOutlets = useMemo(() =>
    outlets.filter(o => o.outletType === 'sales'),
    [outlets]
  );

  const productsWithConversions = useMemo(() => {
    return products.filter(p => {
      const hasConversion = productConversions.some(
        c => c.fromProductId === p.id || c.toProductId === p.id
      );
      return hasConversion;
    });
  }, [products, productConversions]);

  const productsWithoutConversions = useMemo(() => {
    return products.filter(p => {
      const hasConversion = productConversions.some(
        c => c.fromProductId === p.id || c.toProductId === p.id
      );
      const isMenuOrRaw = p.type === 'menu' || p.type === 'raw';
      console.log(`Product: ${p.name}, type: ${p.type}, hasConversion: ${hasConversion}, isMenuOrRaw: ${isMenuOrRaw}`);
      return !hasConversion && isMenuOrRaw;
    });
  }, [products, productConversions]);

  const nonConversionStocks = useMemo(() => {
    const stocksByProduct = new Map<string, Map<string, number>>();
    
    const productionOutletNames = productionOutlets.map(o => o.name);
    
    productsWithoutConversions.forEach(product => {
      if (!stocksByProduct.has(product.id)) {
        stocksByProduct.set(product.id, new Map<string, number>());
      }
      const outletMap = stocksByProduct.get(product.id)!;
      
      productionOutletNames.forEach(outletName => {
        const productionStockChecks = stockChecks.filter(check => check.outlet === outletName);
        
        // Only use the LATEST stock check for each production outlet to avoid adding up multiple entries
        const latestCheck = productionStockChecks.sort((a, b) => b.timestamp - a.timestamp)[0];
        
        if (latestCheck) {
          const count = latestCheck.counts.find(c => c.productId === product.id);
          if (count) {
            const quantity = count.quantity || 0;
            if (quantity > 0) {
              outletMap.set(outletName, quantity);
            }
          }
        }
      });
      
      salesOutlets.forEach(salesOutlet => {
        const approvedRequests = requests.filter(
          req => req.status === 'approved' && req.toOutlet === salesOutlet.name && req.productId === product.id
        );
        const totalQty = approvedRequests.reduce((sum, req) => sum + req.quantity, 0);
        if (totalQty > 0) {
          outletMap.set(salesOutlet.name, totalQty);
        }
      });
    });
    
    return stocksByProduct;
  }, [stockChecks, productsWithoutConversions, productionOutlets, salesOutlets, requests]);

  const filteredProducts = useMemo(() => {
    const productsWithInventory = productsWithConversions.filter(p => {
      const inventory = inventoryStocks.find(inv => inv.productId === p.id);
      if (!inventory) return false;
      
      const hasProductionStock = (inventory.productionWhole > 0 || inventory.productionSlices > 0);
      const hasOutletStock = inventory.outletStocks.some(os => os.whole > 0 || os.slices > 0);
      
      return hasProductionStock || hasOutletStock;
    });

    let filteredBySearch = productsWithInventory;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filteredBySearch = productsWithInventory.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.category?.toLowerCase().includes(query)
      );
    }

    // Group by type and sort alphabetically
    const grouped = filteredBySearch.reduce((acc, product) => {
      const type = product.type || 'other';
      if (!acc[type]) acc[type] = [];
      acc[type].push(product);
      return acc;
    }, {} as Record<string, typeof filteredBySearch>);

    // Sort products within each type alphabetically
    Object.keys(grouped).forEach(type => {
      grouped[type].sort((a, b) => a.name.localeCompare(b.name));
    });

    // Flatten back to array with type information
    const result: (Product & { isTypeHeader?: boolean; typeLabel?: string })[] = [];
    const sortedTypes = Object.keys(grouped).sort();
    sortedTypes.forEach(type => {
      result.push({ ...grouped[type][0], isTypeHeader: true, typeLabel: type });
      result.push(...grouped[type]);
    });

    return result;
  }, [productsWithConversions, searchQuery, inventoryStocks]);

  const getInventoryForProduct = (productId: string): InventoryStock | null => {
    return inventoryStocks.find(inv => inv.productId === productId) || null;
  };

  const getProductPair = (product: Product) => {
    const fromConversion = productConversions.find(c => c.fromProductId === product.id);
    const toConversion = productConversions.find(c => c.toProductId === product.id);
    
    if (fromConversion) {
      const toProd = products.find(p => p.id === fromConversion.toProductId);
      return { whole: product, slices: toProd, conversionFactor: fromConversion.conversionFactor };
    }
    if (toConversion) {
      const fromProd = products.find(p => p.id === toConversion.fromProductId);
      return { whole: fromProd, slices: product, conversionFactor: toConversion.conversionFactor };
    }
    return null;
  };

  const handleOpenEditModal = (product: Product) => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only super admins can edit inventory.');
      return;
    }

    const inventory = getInventoryForProduct(product.id);
    const productPair = getProductPair(product);
    
    if (!productPair) {
      Alert.alert('Error', 'No conversion found for this product.');
      return;
    }

    setEditingStock(inventory || {
      id: Date.now().toString(),
      productId: product.id,
      productionWhole: 0,
      productionSlices: 0,
      outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
      updatedAt: Date.now(),
    });

    setEditValues({
      productionWhole: inventory?.productionWhole.toString() || '0',
      productionSlices: inventory?.productionSlices.toString() || '0',
      prodsReqWhole: inventory?.prodsReqWhole?.toString() || '0',
      prodsReqSlices: inventory?.prodsReqSlices?.toString() || '0',
      outletStocks: salesOutlets.map(outlet => {
        const existing = inventory?.outletStocks.find(os => os.outletName === outlet.name);
        return {
          outletName: outlet.name,
          whole: existing?.whole.toString() || '0',
          slices: existing?.slices.toString() || '0',
        };
      }),
    });

    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingStock) return;

    try {
      const updates: Partial<InventoryStock> = {
        productionWhole: parseFloat(editValues.productionWhole) || 0,
        productionSlices: parseFloat(editValues.productionSlices) || 0,
        prodsReqWhole: parseFloat(editValues.prodsReqWhole) || 0,
        prodsReqSlices: parseFloat(editValues.prodsReqSlices) || 0,
        outletStocks: editValues.outletStocks.map(os => ({
          outletName: os.outletName,
          whole: parseFloat(os.whole) || 0,
          slices: parseFloat(os.slices) || 0,
        })),
        updatedAt: Date.now(),
      };

      const existing = inventoryStocks.find(inv => inv.productId === editingStock.productId);
      if (existing) {
        await updateInventoryStock(editingStock.productId, updates);
      } else {
        await addInventoryStock({
          ...editingStock,
          ...updates,
        } as InventoryStock);
      }

      const product = products.find(p => p.id === editingStock.productId);
      const productPair = product ? getProductPair(product) : null;
      const today = new Date().toISOString().split('T')[0];
      
      if (productPair && productPair.whole && productPair.slices) {
        const newProductionWhole = parseFloat(editValues.productionWhole) || 0;
        const newProductionSlices = parseFloat(editValues.productionSlices) || 0;
        
        for (const outlet of productionOutlets) {
          const existingCheck = stockChecks.find(
            check => check.outlet === outlet.name && check.date === today
          );
          
          if (existingCheck) {
            const updatedCounts = [...existingCheck.counts];
            
            const wholeCountIndex = updatedCounts.findIndex(c => c.productId === productPair.whole?.id);
            const slicesCountIndex = updatedCounts.findIndex(c => c.productId === productPair.slices?.id);
            
            if (wholeCountIndex >= 0) {
              updatedCounts[wholeCountIndex] = {
                ...updatedCounts[wholeCountIndex],
                quantity: newProductionWhole,
              };
            } else {
              if (productPair.whole) {
                updatedCounts.push({
                  productId: productPair.whole.id,
                  quantity: newProductionWhole,
                  receivedStock: newProductionWhole,
                  wastage: 0,
                });
              }
            }
            
            if (slicesCountIndex >= 0) {
              updatedCounts[slicesCountIndex] = {
                ...updatedCounts[slicesCountIndex],
                quantity: newProductionSlices,
              };
            } else if (productPair.slices) {
              updatedCounts.push({
                productId: productPair.slices.id,
                quantity: newProductionSlices,
                receivedStock: newProductionSlices,
                wastage: 0,
              });
            }
            
            await updateStockCheck(existingCheck.id, updatedCounts, undefined, false);
          } else {
            const newCounts: StockCount[] = [];
            
            if (productPair.whole) {
              newCounts.push({
                productId: productPair.whole.id,
                quantity: newProductionWhole,
                receivedStock: newProductionWhole,
                wastage: 0,
              });
            }
            
            if (productPair.slices) {
              newCounts.push({
                productId: productPair.slices.id,
                quantity: newProductionSlices,
                receivedStock: newProductionSlices,
                wastage: 0,
              });
            }
            
            const newStockCheck: StockCheck = {
              id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              date: today,
              timestamp: Date.now(),
              outlet: outlet.name,
              counts: newCounts,
              updatedAt: Date.now(),
            };
            
            await saveStockCheck(newStockCheck, true);
          }
        }
        
        for (const outletStock of editValues.outletStocks) {
          const newWhole = parseFloat(outletStock.whole) || 0;
          const newSlices = parseFloat(outletStock.slices) || 0;
          
          const existingCheck = stockChecks.find(
            check => check.outlet === outletStock.outletName && check.date === today
          );
          
          if (existingCheck) {
            const updatedCounts = [...existingCheck.counts];
            
            const wholeCountIndex = updatedCounts.findIndex(c => c.productId === productPair.whole?.id);
            const slicesCountIndex = updatedCounts.findIndex(c => c.productId === productPair.slices?.id);
            
            if (wholeCountIndex >= 0) {
              updatedCounts[wholeCountIndex] = {
                ...updatedCounts[wholeCountIndex],
                quantity: newWhole,
              };
            } else if (productPair.whole) {
              updatedCounts.push({
                productId: productPair.whole.id,
                quantity: newWhole,
                receivedStock: newWhole,
                wastage: 0,
              });
            }
            
            if (slicesCountIndex >= 0) {
              updatedCounts[slicesCountIndex] = {
                ...updatedCounts[slicesCountIndex],
                quantity: newSlices,
              };
            } else if (productPair.slices) {
              updatedCounts.push({
                productId: productPair.slices.id,
                quantity: newSlices,
                receivedStock: newSlices,
                wastage: 0,
              });
            }
            
            await updateStockCheck(existingCheck.id, updatedCounts, undefined, false);
          } else {
            const newCounts: StockCount[] = [];
            
            if (productPair.whole) {
              newCounts.push({
                productId: productPair.whole.id,
                quantity: newWhole,
                receivedStock: newWhole,
                wastage: 0,
              });
            }
            
            if (productPair.slices) {
              newCounts.push({
                productId: productPair.slices.id,
                quantity: newSlices,
                receivedStock: newSlices,
                wastage: 0,
              });
            }
            
            const newStockCheck: StockCheck = {
              id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              date: today,
              timestamp: Date.now(),
              outlet: outletStock.outletName,
              counts: newCounts,
              updatedAt: Date.now(),
            };
            
            await saveStockCheck(newStockCheck, true);
          }
        }
      }

      Alert.alert('Success', 'Inventory updated successfully.');
      setShowEditModal(false);
      setEditingStock(null);
    } catch (error) {
      console.error('Failed to save inventory:', error);
      Alert.alert('Error', 'Failed to save inventory.');
    }
  };

  const handleOpenEditOtherUnitsModal = (productId: string) => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only super admins can edit inventory.');
      return;
    }

    console.log('handleOpenEditOtherUnitsModal: Opening edit modal for product:', productId);
    setEditingProductId(productId);
    
    const product = productsWithoutConversions.find(p => p.id === productId);
    console.log('handleOpenEditOtherUnitsModal: Product:', product?.name);
    
    const allOutlets = [...productionOutlets, ...salesOutlets];
    
    console.log('handleOpenEditOtherUnitsModal: Getting current stock from nonConversionStocks (what is displayed in UI):');
    
    const productStockMap = nonConversionStocks.get(productId);
    
    setEditOtherUnitsValues({
      outletStocks: allOutlets.map(outlet => {
        const currentStock = productStockMap?.get(outlet.name) || 0;
        
        console.log(`  ${outlet.name}: ${currentStock} ${product?.unit || ''} (current stock)`);
        return {
          outletName: outlet.name,
          quantity: currentStock.toString(),
        };
      }),
    });

    setShowEditOtherUnitsModal(true);
  };

  const handleOpenAddProductModal = (type: 'conversion' | 'other') => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only super admins can add products to inventory.');
      return;
    }
    setAddProductModalType(type);
    setSelectedProductToAdd('');
    setShowAddProductModal(true);
  };

  const handleAddProduct = async () => {
    if (!selectedProductToAdd) {
      Alert.alert('Error', 'Please select a product.');
      return;
    }

    try {
      const product = products.find(p => p.id === selectedProductToAdd);
      if (!product) {
        Alert.alert('Error', 'Product not found.');
        return;
      }

      if (addProductModalType === 'conversion') {
        const productPair = getProductPair(product);
        if (!productPair) {
          Alert.alert('Error', 'This product does not have a conversion pair. Please add it to "Other Units" section.');
          return;
        }

        const wholeProductId = productPair.whole?.id;
        if (!wholeProductId) {
          Alert.alert('Error', 'Invalid product pair.');
          return;
        }

        const existingInv = inventoryStocks.find(inv => inv.productId === wholeProductId);
        if (existingInv) {
          Alert.alert('Error', `${productPair.whole?.name} is already in inventory.`);
          return;
        }

        const newInv: InventoryStock = {
          id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          productId: wholeProductId,
          productionWhole: 0,
          productionSlices: 0,
          prodsReqWhole: 0,
          prodsReqSlices: 0,
          outletStocks: salesOutlets.map(o => ({ outletName: o.name, whole: 0, slices: 0 })),
          updatedAt: Date.now(),
        };

        await addInventoryStock(newInv);
        Alert.alert('Success', `${productPair.whole?.name} has been added to inventory.`);
      } else {
        const productPair = getProductPair(product);
        if (productPair) {
          Alert.alert('Error', 'This product has conversion units. Please add it to the "Products with conversion units" section.');
          return;
        }

        const firstProductionOutlet = productionOutlets[0];
        if (!firstProductionOutlet) {
          Alert.alert('Error', 'No production outlet found. Please create a production outlet first.');
          return;
        }

        const today = new Date().toISOString().split('T')[0];
        const existingCheck = stockChecks.find(
          check => check.outlet === firstProductionOutlet.name && check.date === today
        );

        if (existingCheck) {
          const productAlreadyExists = existingCheck.counts.find(c => c.productId === product.id);
          if (productAlreadyExists) {
            Alert.alert('Error', `${product.name} is already in inventory (Other Units).`);
            return;
          }

          const updatedCounts = [
            ...existingCheck.counts,
            {
              productId: product.id,
              quantity: 0,
              receivedStock: 0,
              wastage: 0,
            }
          ];
          await updateStockCheck(existingCheck.id, updatedCounts, undefined, false);
        } else {
          const newStockCheck: StockCheck = {
            id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: today,
            timestamp: Date.now(),
            outlet: firstProductionOutlet.name,
            counts: [
              {
                productId: product.id,
                quantity: 0,
                receivedStock: 0,
                wastage: 0,
              }
            ],
            updatedAt: Date.now(),
          };
          await saveStockCheck(newStockCheck, true);
        }

        Alert.alert('Success', `${product.name} has been added to inventory (Other Units).`);
      }

      setShowAddProductModal(false);
      setSelectedProductToAdd('');
    } catch (error) {
      console.error('Failed to add product to inventory:', error);
      Alert.alert('Error', 'Failed to add product to inventory.');
    }
  };

  const handleSaveOtherUnitsEdit = async () => {
    if (!editingProductId) return;

    setIsSavingOtherUnits(true);
    try {
      const product = productsWithoutConversions.find(p => p.id === editingProductId);
      if (!product) {
        Alert.alert('Error', 'Product not found.');
        return;
      }

      console.log('handleSaveOtherUnitsEdit: Editing product:', product.name);
      console.log('handleSaveOtherUnitsEdit: Outlet stocks to update:', editOtherUnitsValues.outletStocks);
      console.log('handleSaveOtherUnitsEdit: STEP 1 - Overwriting with manually entered stock...');

      const updatesToApply: { checkId: string; counts: StockCount[]; skipInventoryUpdate: boolean }[] = [];
      const newChecksToCreate: StockCheck[] = [];
      const requestsToCreate: ProductRequest[] = [];

      for (const outletStock of editOtherUnitsValues.outletStocks) {
        const newQuantity = parseFloat(outletStock.quantity) || 0;
        const outlet = outlets.find(o => o.name === outletStock.outletName);
        
        if (!outlet) {
          console.log('handleSaveOtherUnitsEdit: Outlet not found:', outletStock.outletName);
          continue;
        }

        console.log(`handleSaveOtherUnitsEdit: Processing outlet "${outlet.name}" (${outlet.outletType}), new quantity: ${newQuantity}`);

        let currentQuantity = 0;
        
        if (outlet.outletType === 'production') {
          const productionStockChecks = stockChecks.filter(check => check.outlet === outlet.name);
          productionStockChecks.forEach(check => {
            const count = check.counts.find(c => c.productId === editingProductId);
            if (count) {
              const quantity = count.quantity || 0;
              if (quantity > 0) {
                currentQuantity += quantity;
              }
            }
          });
        } else {
          const approvedRequestsForOutlet = requests.filter(
            req => req.status === 'approved' && req.toOutlet === outlet.name && req.productId === editingProductId
          );
          approvedRequestsForOutlet.forEach(req => {
            currentQuantity += req.quantity;
          });
        }

        console.log(`handleSaveOtherUnitsEdit: Current quantity for ${outlet.name}: ${currentQuantity}`);

        if (currentQuantity === newQuantity) {
          console.log(`handleSaveOtherUnitsEdit: No change for ${outlet.name}, skipping`);
          continue;
        }

        if (outlet.outletType === 'production') {
          const outletStockChecks = stockChecks.filter(check => check.outlet === outlet.name);
          
          if (outletStockChecks.length > 0) {
            const latestCheck = outletStockChecks.sort((a, b) => b.timestamp - a.timestamp)[0];
            const updatedCounts = [...latestCheck.counts];
            const existingCountIndex = updatedCounts.findIndex(c => c.productId === editingProductId);

            if (existingCountIndex >= 0) {
              console.log(`handleSaveOtherUnitsEdit: Updating production outlet ${outlet.name} - old quantity: ${currentQuantity}, new quantity: ${newQuantity}`);

              const existingCount = updatedCounts[existingCountIndex];
              
              console.log(`handleSaveOtherUnitsEdit: Current count - quantity: ${existingCount.quantity}`);
              console.log(`handleSaveOtherUnitsEdit: REPLACING stock with manually entered value: ${newQuantity}`);
              console.log(`handleSaveOtherUnitsEdit: Setting openingStock=0, receivedStock=${newQuantity}, wastage=0`);
              console.log(`handleSaveOtherUnitsEdit: This will REPLACE the current stock in inventory, NOT add to it`);
              
              updatedCounts[existingCountIndex] = {
                productId: editingProductId,
                receivedStock: newQuantity,
                wastage: 0,
                quantity: newQuantity,
              };
              
              console.log(`handleSaveOtherUnitsEdit: Updated count - openingStock: 0, receivedStock: ${newQuantity}, wastage: 0, quantity: ${newQuantity}`);
              updatesToApply.push({ checkId: latestCheck.id, counts: updatedCounts, skipInventoryUpdate: true });
            } else {
              if (newQuantity > 0) {
                console.log(`handleSaveOtherUnitsEdit: Adding new count to production outlet ${outlet.name}`);
                console.log(`handleSaveOtherUnitsEdit: Setting receivedStock and current stock to: ${newQuantity}`);
                updatedCounts.push({
                  productId: editingProductId,
                  quantity: newQuantity,
                  receivedStock: newQuantity,
                  wastage: 0,
                });
                updatesToApply.push({ checkId: latestCheck.id, counts: updatedCounts, skipInventoryUpdate: true });
              }
            }
          } else {
            if (newQuantity > 0) {
              console.log(`handleSaveOtherUnitsEdit: Creating new stock check for production outlet ${outlet.name}`);
              console.log(`handleSaveOtherUnitsEdit: Setting receivedStock and current stock to: ${newQuantity}`);
              const newStockCheck: StockCheck = {
                id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                date: new Date().toISOString().split('T')[0],
                timestamp: Date.now(),
                outlet: outlet.name,
                counts: [{
                  productId: editingProductId,
                  quantity: newQuantity,
                  receivedStock: newQuantity,
                  wastage: 0,
                }],
                updatedAt: Date.now(),
              };
              newChecksToCreate.push(newStockCheck);
            }
          }
        } else {
          console.log(`handleSaveOtherUnitsEdit: Sales outlet ${outlet.name} - current: ${currentQuantity}, new: ${newQuantity}`);
          
          if (newQuantity > currentQuantity) {
            const additionalQuantity = newQuantity - currentQuantity;
            console.log(`handleSaveOtherUnitsEdit: Will create approved request for sales outlet ${outlet.name} - quantity: ${additionalQuantity}`);
            
            const newRequest: ProductRequest = {
              id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              productId: editingProductId,
              quantity: additionalQuantity,
              requestDate: new Date().toISOString().split('T')[0],
              requestedAt: Date.now(),
              fromOutlet: productionOutlets[0]?.name || 'Production',
              toOutlet: outlet.name,
              status: 'approved',
              priority: 'medium',
              updatedAt: Date.now(),
            };
            requestsToCreate.push(newRequest);
          } else if (newQuantity < currentQuantity) {
            console.log(`handleSaveOtherUnitsEdit: Reducing stock for sales outlet ${outlet.name}`);
            
            const allRequestsForOutlet = requests.filter(
              req => req.status === 'approved' && req.toOutlet === outlet.name && req.productId === editingProductId
            );
            
            if (allRequestsForOutlet.length > 0) {
              const reductionNeeded = currentQuantity - newQuantity;
              let remainingReduction = reductionNeeded;
              
              const sortedRequests = allRequestsForOutlet.sort((a, b) => b.requestedAt - a.requestedAt);
              
              for (const req of sortedRequests) {
                if (remainingReduction <= 0) break;
                
                if (req.quantity <= remainingReduction) {
                  await deleteRequest(req.id);
                  remainingReduction -= req.quantity;
                } else {
                  await updateRequest(req.id, { quantity: req.quantity - remainingReduction });
                  remainingReduction = 0;
                }
              }
            }
          }
        }
      }

      console.log(`handleSaveOtherUnitsEdit: Applying ${updatesToApply.length} updates, creating ${newChecksToCreate.length} new checks, and ${requestsToCreate.length} new requests`);
      console.log('handleSaveOtherUnitsEdit: STEP 2 - Applying updates to stock checks (will sync to server)...');

      for (const update of updatesToApply) {
        await updateStockCheck(update.checkId, update.counts, undefined, false);
      }

      for (const newCheck of newChecksToCreate) {
        await saveStockCheck(newCheck, false);
      }

      for (const newRequest of requestsToCreate) {
        await addRequest(newRequest);
      }

      console.log('handleSaveOtherUnitsEdit: STEP 3 - All updates applied and synced to server');
      console.log('handleSaveOtherUnitsEdit: Manual edits have overwritten server values');


      Alert.alert('Success', 'Stock updated successfully.');
      setShowEditOtherUnitsModal(false);
      setEditingProductId(null);
    } catch (error) {
      console.error('Failed to save stock:', error);
      Alert.alert('Error', 'Failed to save stock.');
    } finally {
      setIsSavingOtherUnits(false);
    }
  };

  const handleExportInventory = async () => {
    try {
      if (filteredProducts.length === 0 && nonConversionStocks.size === 0) {
        Alert.alert('No Data', 'No inventory data to export.');
        return;
      }

      const data: any[] = [];
      
      filteredProducts.forEach(product => {
        const inventory = getInventoryForProduct(product.id);
        const productPair = getProductPair(product);
        
        if (productPair && productPair.whole) {
          const row: any = {
            'Product': productPair.whole.name,
            'Production Whole': inventory?.productionWhole || 0,
            'Production Slices': inventory?.productionSlices || 0,
          };

          salesOutlets.forEach(outlet => {
            const outletStock = inventory?.outletStocks.find(os => os.outletName === outlet.name);
            row[`${outlet.name} Whole`] = outletStock?.whole || 0;
            row[`${outlet.name} Slices`] = outletStock?.slices || 0;
          });

          data.push(row);
        }
      });

      const otherUnitsData: any[] = [];
      Array.from(nonConversionStocks.entries()).forEach(([productId, outletMap]) => {
        const product = productsWithoutConversions.find(p => p.id === productId);
        if (!product) return;

        const hasStock = Array.from(outletMap.values()).some(qty => qty > 0);
        if (!hasStock) return;

        const row: any = {
          'Product': product.name,
          'Unit': product.unit,
        };

        productionOutlets.forEach(outlet => {
          const qty = outletMap.get(outlet.name) || 0;
          const displayName = 
            outlet.name === 'HO' ? 'Stores' :
            outlet.name === 'Baking Kitchen' ? 'Kitchen' :
            outlet.location || outlet.name;
          row[displayName] = qty;
        });
        
        salesOutlets.forEach(outlet => {
          const qty = outletMap.get(outlet.name) || 0;
          row[outlet.location || outlet.name] = qty;
        });

        otherUnitsData.push(row);
      });

      const workbook = XLSX.utils.book_new();
      
      if (data.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
      }
      
      if (otherUnitsData.length > 0) {
        const otherUnitsWorksheet = XLSX.utils.json_to_sheet(otherUnitsData);
        XLSX.utils.book_append_sheet(workbook, otherUnitsWorksheet, 'Inventory Stocks (Other Units)');
      }
      
      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

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
        link.download = `inventory_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 100);
        
        Alert.alert('Success', 'Inventory exported successfully.');
      } else {
        if (!FileSystem.documentDirectory) {
          Alert.alert('Error', 'File system not available.');
          return;
        }
        
        const fileName = `inventory_${new Date().toISOString().split('T')[0]}.xlsx`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Inventory Export',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Success', 'Inventory exported to app directory.');
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export inventory.');
    }
  };

  const handleClearInventory = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = async () => {
    try {
      await clearAllInventory();
      setShowClearConfirm(false);
      Alert.alert('Success', 'All inventory data has been cleared.');
    } catch (error) {
      console.error('Clear inventory error:', error);
      Alert.alert('Error', 'Failed to clear inventory.');
    }
  };

  const handleUploadStockCheck = async () => {
    try {
      setIsUploading(true);
      setShowImportProgress(true);
      setImportProgress({
        currentRow: 0,
        totalRows: 0,
        productsAdded: 0,
        productsUpdated: 0,
        productsSkipped: 0,
        errors: [],
        isComplete: false,
      });
      
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      const file = result.assets[0];
      console.log('File selected:', file.name);

      let base64Data: string;
      if (Platform.OS === 'web') {
        const response = await fetch(file.uri);
        const blob = await response.blob();
        const reader = new FileReader();
        base64Data = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        const fileContent = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        base64Data = fileContent;
      }

      const workbook = XLSX.read(base64Data, { type: 'base64' });
      
      if (!workbook.SheetNames.includes('Summary')) {
        Alert.alert('Error', 'Excel file must contain a "Summary" sheet.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      if (!workbook.SheetNames.includes('Stock Count')) {
        Alert.alert('Error', 'Excel file must contain a "Stock Count" sheet.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      const summarySheet = workbook.Sheets['Summary'];
      const stockCountSheet = workbook.Sheets['Stock Count'];

      const dateCell = summarySheet['B6'];
      if (!dateCell) {
        Alert.alert('Error', 'Summary sheet cell B6 (date) is empty.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      let parsedDate: string;
      const dateValue = dateCell.v;
      
      if (typeof dateValue === 'number') {
        const date = new Date((dateValue - 25569) * 86400 * 1000);
        parsedDate = date.toISOString().split('T')[0];
      } else if (dateValue instanceof Date) {
        parsedDate = dateValue.toISOString().split('T')[0];
      } else {
        parsedDate = String(dateValue).split('T')[0];
      }

      const today = new Date().toISOString().split('T')[0];
      if (parsedDate !== today) {
        Alert.alert(
          'Date Mismatch',
          `The uploaded stock check is dated ${parsedDate}, but today is ${today}. Only stock checks from today can be uploaded.`
        );
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      const outletCell = summarySheet['B4'];
      if (!outletCell) {
        Alert.alert('Error', 'Summary sheet cell B4 (outlet name) is empty.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      const outletName = String(outletCell.v).trim();
      console.log('Outlet name from Summary B4:', outletName);

      const outlet = outlets.find(
        (o) => o.name.toLowerCase().trim() === outletName.toLowerCase()
      );

      if (!outlet) {
        Alert.alert('Error', `Outlet "${outletName}" not found in system. Please check outlet name matches exactly.`);
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      console.log('Found outlet:', outlet.name, 'Type:', outlet.outletType, 'Location:', outlet.location);

      const stockCountData = XLSX.utils.sheet_to_json(stockCountSheet, { header: 1 }) as any[][];

      if (stockCountData.length < 2) {
        Alert.alert('Error', 'Stock Count sheet has no data rows.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      const headers = stockCountData[0].map((h: any) => String(h).toLowerCase().trim());
      const productNameIndex = headers.findIndex((h: string) => h.includes('product') && (h.includes('name') || h.includes('item')));
      const receivedStockIndex = headers.findIndex((h: string) => h.includes('received'));

      if (productNameIndex === -1) {
        Alert.alert('Error', 'Stock Count sheet is missing "Product Name" column.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      if (receivedStockIndex === -1) {
        Alert.alert('Error', 'Stock Count sheet is missing "Received" column.');
        setIsUploading(false);
        setShowImportProgress(false);
        return;
      }

      const freshInventoryStocks = inventoryStocks.filter(inv => !inv.deleted);
      let updatedInventoryStocks = [...freshInventoryStocks];
      let updatesCount = 0;
      const totalDataRows = stockCountData.length - 1;

      setImportProgress(prev => ({
        ...prev,
        totalRows: totalDataRows,
      }));

      console.log('Processing', totalDataRows, 'rows from Stock Count sheet');
      console.log('Available products in system:', products.length);
      console.log('Sample product names:', products.slice(0, 10).map(p => `"${p.name}"`).join(', '));
      
      for (let i = 1; i < stockCountData.length; i++) {
        const row = stockCountData[i];
        if (!row || row.length === 0) continue;
        
        setImportProgress(prev => ({
          ...prev,
          currentRow: i,
        }));
        
        const productName = row[productNameIndex];
        const receivedStock = parseFloat(row[receivedStockIndex]) || 0;

        console.log(`\n=== Row ${i} ===`);
        console.log(`Product name from Excel: "${productName}"`);
        console.log(`Received stock: ${receivedStock}`);

        if (!productName || String(productName).trim() === '') {
          console.log(`Empty product name, skipping`);
          setImportProgress(prev => ({
            ...prev,
            productsSkipped: prev.productsSkipped + 1,
          }));
          continue;
        }

        if (receivedStock === 0) {
          console.log(`Zero received stock, skipping`);
          setImportProgress(prev => ({
            ...prev,
            productsSkipped: prev.productsSkipped + 1,
          }));
          continue;
        }

        const productNameLower = String(productName).toLowerCase().trim();
        console.log(`Searching for product with name: "${productNameLower}"`);
        
        let product = products.find(
          (p) => p.name.toLowerCase().trim() === productNameLower
        );

        if (!product) {
          console.log(`❌ Product NOT FOUND in system`);
          console.log(`Exact name from Excel: "${productName}"`);
          console.log(`Creating new product: "${productName}"`);
          
          const unitCell = row[headers.findIndex((h: string) => h.includes('unit'))];
          const productUnit = unitCell ? String(unitCell).trim() : 'units';
          
          const newProduct: Product = {
            id: `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: String(productName).trim(),
            type: 'menu',
            unit: productUnit,
            showInStock: true,
            updatedAt: Date.now(),
          };
          
          try {
            await addProduct(newProduct);
            product = newProduct;
            console.log(`✅ Created new product: "${product.name}" with unit: ${product.unit}`);
            setImportProgress(prev => ({
              ...prev,
              productsAdded: prev.productsAdded + 1,
            }));
          } catch (error) {
            const errorMsg = `Failed to create product "${productName}": ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error(errorMsg);
            setImportProgress(prev => ({
              ...prev,
              errors: [...prev.errors, errorMsg],
            }));
            continue;
          }
        } else {
          setImportProgress(prev => ({
            ...prev,
            productsUpdated: prev.productsUpdated + 1,
          }));
        }

        console.log(`✅ Found product: "${product.name}" (ID: ${product.id})`);
        console.log(`Product unit: ${product.unit}`);
        console.log(`Received stock: ${receivedStock} ${product.unit}`);

        const productPair = getProductPair(product);
        if (!productPair) {
          console.log(`⚠️ No product conversion found for "${productName}"`);
          console.log(`Adding to stock check as product without conversions`);
          
          const latestStockCheck = stockChecks
            .filter(check => check.outlet === outlet.name)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          
          if (latestStockCheck) {
            const updatedCounts = [...latestStockCheck.counts];
            const existingCountIndex = updatedCounts.findIndex(c => c.productId === product.id);
            
            if (existingCountIndex >= 0) {
              const existingCount = updatedCounts[existingCountIndex];
              updatedCounts[existingCountIndex] = {
                ...existingCount,
                receivedStock: (existingCount.receivedStock || 0) + receivedStock,
                quantity: (existingCount.quantity || 0) + receivedStock,
              };
              await updateStockCheck(latestStockCheck.id, updatedCounts);
              console.log(`✓ Updated existing stock check for "${productName}" - added ${receivedStock} ${product.unit}`);
              updatesCount++;
            } else {
              updatedCounts.push({
                productId: product.id,
                quantity: receivedStock,
                receivedStock: receivedStock,
                wastage: 0,
              });
              await updateStockCheck(latestStockCheck.id, updatedCounts);
              console.log(`✓ Added to stock check for "${productName}" - ${receivedStock} ${product.unit}`);
              updatesCount++;
            }
          } else {
            console.log(`⚠️ No stock check found for outlet ${outlet.name}, creating new stock check...`);
            const newStockCheck: StockCheck = {
              id: `check-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              date: new Date().toISOString().split('T')[0],
              timestamp: Date.now(),
              outlet: outlet.name,
              counts: [{
                productId: product.id,
                quantity: receivedStock,
                receivedStock: receivedStock,
                wastage: 0,
              }],
              updatedAt: Date.now(),
            };
            
            await saveStockCheck(newStockCheck);
            console.log(`✓ Created new stock check for "${productName}" - ${receivedStock} ${product.unit}`);
            updatesCount++;
          }
          continue;
        }

        const wholeProductId = productPair.whole?.id;
        if (!wholeProductId) {
          console.log(`Row ${i}: Whole product ID not found for "${productName}"`);
          continue;
        }

        console.log(`✅ Found product pair:`);
        console.log(`  - Whole: "${productPair.whole?.name || 'Unknown'}" (ID: ${productPair.whole?.id})`);
        console.log(`  - Slices: "${productPair.slices?.name || 'N/A'}" (ID: ${productPair.slices?.id})`);
        console.log(`  - Conversion factor: ${productPair.conversionFactor}`);

        let invStock = updatedInventoryStocks.find((s) => s.productId === wholeProductId);

        if (!invStock) {
          invStock = {
            id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            productId: wholeProductId,
            productionWhole: 0,
            productionSlices: 0,
            outletStocks: salesOutlets.map((o) => ({ outletName: o.name, whole: 0, slices: 0 })),
            updatedAt: Date.now(),
          };
          updatedInventoryStocks.push(invStock);
        }

        const conversionFactor = productPair.conversionFactor || 10;
        const isWholeProduct = product.id === wholeProductId;

        let receivedWhole = 0;
        let receivedSlices = 0;

        if (isWholeProduct) {
          receivedWhole = Math.floor(receivedStock);
          receivedSlices = Math.round((receivedStock % 1) * conversionFactor);
        } else {
          receivedSlices = Math.round(receivedStock);
        }

        if (receivedSlices >= conversionFactor) {
          const extraWhole = Math.floor(receivedSlices / conversionFactor);
          receivedWhole += extraWhole;
          receivedSlices = Math.round(receivedSlices % conversionFactor);
        }

        if (outlet.outletType === 'production') {
          invStock.productionWhole += receivedWhole;
          invStock.productionSlices += receivedSlices;

          if (invStock.productionSlices >= conversionFactor) {
            const extraWhole = Math.floor(invStock.productionSlices / conversionFactor);
            invStock.productionWhole += extraWhole;
            invStock.productionSlices = Math.round(invStock.productionSlices % conversionFactor);
          }

          console.log(
            `✓ Updated PRODUCTION stock for "${productName}":`
          );
          console.log(`  Added: ${receivedWhole} whole, ${receivedSlices} slices`);
          console.log(`  New totals: ${invStock.productionWhole} whole, ${invStock.productionSlices} slices`);
          updatesCount++;
        } else {
          const targetOutletName = outlet.location || outlet.name;
          let outletStock = invStock.outletStocks.find(
            (os) => os.outletName === targetOutletName || os.outletName === outlet.name
          );

          if (!outletStock) {
            outletStock = { outletName: outlet.name, whole: 0, slices: 0 };
            invStock.outletStocks.push(outletStock);
          }

          outletStock.whole += receivedWhole;
          outletStock.slices += receivedSlices;

          if (outletStock.slices >= conversionFactor) {
            const extraWhole = Math.floor(outletStock.slices / conversionFactor);
            outletStock.whole += extraWhole;
            outletStock.slices = Math.round(outletStock.slices % conversionFactor);
          }

          console.log(
            `✓ Updated OUTLET stock for "${productName}" at ${outlet.name}:`
          );
          console.log(`  Outlet location: ${targetOutletName}`);
          console.log(`  Added: ${receivedWhole} whole, ${receivedSlices} slices`);
          console.log(`  New totals: ${outletStock.whole} whole, ${outletStock.slices} slices`);
          updatesCount++;
        }

        invStock.updatedAt = Date.now();
      }

      if (updatesCount === 0) {
        setImportProgress(prev => ({
          ...prev,
          isComplete: true,
        }));
        setIsUploading(false);
        return;
      }

      for (const invStock of updatedInventoryStocks) {
        const existing = freshInventoryStocks.find((s) => s.productId === invStock.productId);
        if (existing) {
          await updateInventoryStock(invStock.productId, {
            productionWhole: invStock.productionWhole,
            productionSlices: invStock.productionSlices,
            outletStocks: invStock.outletStocks,
            updatedAt: invStock.updatedAt,
          });
        } else {
          await addInventoryStock(invStock);
        }
      }

      setImportProgress(prev => ({
        ...prev,
        isComplete: true,
      }));
      setIsUploading(false);
    } catch (error) {
      console.error('Upload stock check error:', error);
      const errorMsg = `Failed to upload stock check: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setImportProgress(prev => ({
        ...prev,
        errors: [...prev.errors, errorMsg],
        isComplete: true,
      }));
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  if (productionOutlets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Package size={48} color={Colors.light.muted} />
        <Text style={styles.emptyText}>No production outlets found.</Text>
        <Text style={styles.emptySubtext}>Add a production outlet in Settings to track inventory.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          <VoiceSearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search products..."
            placeholderTextColor={Colors.light.muted}
            style={styles.searchContainer}
            inputStyle={styles.searchInput}
          />

          {isSuperAdmin && (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.uploadButton]}
                onPress={handleUploadStockCheck}
                disabled={isUploading}
              >
                {isUploading ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <>
                    <Upload size={20} color={Colors.light.tint} />
                    <Text style={styles.actionButtonText}>Upload</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.exportButton]}
                onPress={handleExportInventory}
              >
                <Download size={20} color={Colors.light.tint} />
                <Text style={styles.actionButtonText}>Export</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.clearButton]}
                onPress={handleClearInventory}
              >
                <Trash2 size={20} color={Colors.light.danger} />
                <Text style={[styles.actionButtonText, styles.clearButtonText]}>Clear All</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.tableHeaderWrapper}>
          <View style={styles.tableHeaderTitleRow}>
            <Text style={styles.tableHeaderTitle}>Products with Conversion Units</Text>
            {isSuperAdmin && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => handleOpenAddProductModal('conversion')}
              >
                <Plus size={20} color={Colors.light.tint} />
              </TouchableOpacity>
            )}
          </View>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
          >
            <View style={styles.tableHeader}>
              <View style={[styles.headerCell, styles.productNameCell]}>
                <Text style={styles.headerText}>Product</Text>
              </View>
              <View style={[styles.headerCell, styles.numberCell]}>
                <Text style={styles.headerText}>Prods.Req</Text>
              </View>
              <View style={[styles.headerCell, styles.numberCell]}>
                <Text style={styles.headerText}>Inventory Stocks Whole</Text>
              </View>
              <View style={[styles.headerCell, styles.numberCell]}>
                <Text style={styles.headerText}>Inventory Stocks Slices</Text>
              </View>
              {salesOutlets.map((outlet) => (
                <View key={outlet.id} style={styles.outletHeaderGroup}>
                  <View style={[styles.headerCell, styles.numberCell]}>
                    <Text style={styles.headerText}>{outlet.location || outlet.name} Whole</Text>
                  </View>
                  <View style={[styles.headerCell, styles.numberCell]}>
                    <Text style={styles.headerText}>{outlet.location || outlet.name} Slices</Text>
                  </View>
                </View>
              ))}
              {isSuperAdmin && (
                <View style={[styles.headerCell, styles.actionCell]}>
                  <Text style={styles.headerText}>Actions</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>

        <ScrollView 
          style={styles.scrollContainer}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator
            nestedScrollEnabled
          >
            <View style={styles.tableContainer}>
            {filteredProducts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No products with conversions found</Text>
              </View>
            ) : (
              filteredProducts.map((product, index) => {
                // Type header row
                if (product.isTypeHeader) {
                  return (
                    <View key={`type-${product.typeLabel}-${index}`} style={styles.typeHeaderRow}>
                      <Text style={styles.typeHeaderText}>{product.typeLabel?.toUpperCase()}</Text>
                    </View>
                  );
                }

                const inventory = getInventoryForProduct(product.id);
                const productPair = getProductPair(product);
                
                if (!productPair || !productPair.whole) return null;

                return (
                  <View key={product.id} style={styles.tableRow}>
                    <View style={[styles.cell, styles.productNameCell]}>
                      <Text style={styles.cellText}>{productPair.whole.name}</Text>
                      <Text style={styles.cellSubtext}>
                        {productPair.whole.unit} / {productPair.slices?.unit}
                      </Text>
                    </View>
                    <View style={[styles.cell, styles.numberCell]}>
                      <Text style={styles.cellText}>{inventory?.prodsReqWhole || 0}</Text>
                    </View>
                    <View style={[styles.cell, styles.numberCell]}>
                      <Text style={styles.cellText}>{inventory?.productionWhole || 0}</Text>
                    </View>
                    <View style={[styles.cell, styles.numberCell]}>
                      <Text style={styles.cellText}>{inventory?.productionSlices || 0}</Text>
                    </View>
                    {salesOutlets.map((outlet) => {
                      const outletStock = inventory?.outletStocks.find(
                        os => os.outletName === outlet.name
                      );
                      return (
                        <View key={outlet.id} style={styles.outletDataGroup}>
                          <View style={[styles.cell, styles.numberCell]}>
                            <Text style={styles.cellText}>{outletStock?.whole || 0}</Text>
                          </View>
                          <View style={[styles.cell, styles.numberCell]}>
                            <Text style={styles.cellText}>{outletStock?.slices || 0}</Text>
                          </View>
                        </View>
                      );
                    })}
                    {isSuperAdmin && (
                      <View style={[styles.cell, styles.actionCell]}>
                        <TouchableOpacity
                          style={styles.editButton}
                          onPress={() => handleOpenEditModal(product)}
                        >
                          <Edit2 size={18} color={Colors.light.tint} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}

            {nonConversionStocks.size > 0 && (
              <>
                <View style={styles.sectionDivider} />
                <View style={[styles.sectionHeaderContainer, styles.stickyOtherUnitsHeader]}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionHeaderText}>Inventory Stocks (Other Units)</Text>
                      <Text style={styles.sectionHeaderSubtext}>Products without unit conversions from production outlets</Text>
                    </View>
                    {isSuperAdmin && (
                      <TouchableOpacity
                        style={styles.addButton}
                        onPress={() => handleOpenAddProductModal('other')}
                      >
                        <Plus size={20} color={Colors.light.tint} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={[styles.tableHeader, styles.stickyOtherUnitsTableHeader]}>
                  <View style={[styles.headerCell, styles.productNameCell]}>
                    <Text style={styles.headerText}>Product</Text>
                  </View>
                  {productionOutlets
                    .filter(outlet => outlet.name !== 'HO')
                    .map((outlet) => {
                      let displayName = outlet.location || outlet.name;
                      if (outlet.name === 'Baking Kitchen' || displayName === 'Baking Kitchen') {
                        displayName = 'Kitchen';
                      }
                      return (
                        <View key={outlet.id} style={[styles.headerCell, styles.numberCell]}>
                          <Text style={styles.headerText}>{displayName}</Text>
                        </View>
                      );
                    })}
                  {salesOutlets.map((outlet) => (
                    <View key={outlet.id} style={[styles.headerCell, styles.numberCell]}>
                      <Text style={styles.headerText}>{outlet.location || outlet.name}</Text>
                    </View>
                  ))}
                  {isSuperAdmin && (
                    <View style={[styles.headerCell, styles.actionCell]}>
                      <Text style={styles.headerText}>Actions</Text>
                    </View>
                  )}
                </View>

                {(() => {
                  // Group products by type and sort
                  const productsWithStock = Array.from(nonConversionStocks.entries())
                    .map(([productId, outletMap]) => {
                      const product = productsWithoutConversions.find(p => p.id === productId);
                      if (!product) return null;
                      const hasStock = Array.from(outletMap.values()).some(qty => qty > 0);
                      if (!hasStock) return null;
                      return { product, outletMap };
                    })
                    .filter(Boolean) as { product: Product; outletMap: Map<string, number> }[];

                  // Group by type
                  const grouped = productsWithStock.reduce((acc, item) => {
                    const type = item.product.type || 'other';
                    if (!acc[type]) acc[type] = [];
                    acc[type].push(item);
                    return acc;
                  }, {} as Record<string, typeof productsWithStock>);

                  // Sort products within each type alphabetically
                  Object.keys(grouped).forEach(type => {
                    grouped[type].sort((a, b) => a.product.name.localeCompare(b.product.name));
                  });

                  // Render grouped items
                  const sortedTypes = Object.keys(grouped).sort();
                  return sortedTypes.map(type => (
                    <React.Fragment key={`type-group-${type}`}>
                      <View style={styles.typeHeaderRow}>
                        <Text style={styles.typeHeaderText}>{type.toUpperCase()}</Text>
                      </View>
                      {grouped[type].map(({ product, outletMap }) => (
                        <View key={product.id} style={styles.tableRow}>
                          <View style={[styles.cell, styles.productNameCell]}>
                            <Text style={styles.cellText}>{product.name}</Text>
                            <Text style={styles.cellSubtext}>{product.unit}</Text>
                          </View>
                          {productionOutlets
                            .filter(outlet => outlet.name !== 'HO')
                            .map((outlet) => {
                              const qty = outletMap.get(outlet.name) || 0;
                              return (
                                <View key={outlet.id} style={[styles.cell, styles.numberCell]}>
                                  <Text style={styles.cellText}>{qty}</Text>
                                </View>
                              );
                            })}
                          {salesOutlets.map((outlet) => {
                            const qty = outletMap.get(outlet.name) || 0;
                            return (
                              <View key={outlet.id} style={[styles.cell, styles.numberCell]}>
                                <Text style={styles.cellText}>{qty}</Text>
                              </View>
                            );
                          })}
                          {isSuperAdmin && (
                            <View style={[styles.cell, styles.actionCell]}>
                              <TouchableOpacity
                                style={styles.editButton}
                                onPress={() => handleOpenEditOtherUnitsModal(product.id)}
                              >
                                <Edit2 size={18} color={Colors.light.tint} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      ))}
                    </React.Fragment>
                  ));
                })()}
              </>
            )}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Edit Inventory Stock</Text>
                {editingStock && (() => {
                  const product = products.find(p => p.id === editingStock.productId);
                  const productPair = product ? getProductPair(product) : null;
                  if (productPair && productPair.whole) {
                    return (
                      <Text style={styles.modalSubtitle}>
                        {productPair.whole.name}
                      </Text>
                    );
                  }
                  return null;
                })()}
              </View>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.modalSectionTitle}>Prods.Req</Text>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Whole</Text>
                  <TextInput
                    style={styles.input}
                    value={editValues.prodsReqWhole}
                    onChangeText={(text) => setEditValues(prev => ({ ...prev, prodsReqWhole: text }))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Slices</Text>
                  <TextInput
                    style={styles.input}
                    value={editValues.prodsReqSlices}
                    onChangeText={(text) => setEditValues(prev => ({ ...prev, prodsReqSlices: text }))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
              </View>

              <Text style={styles.modalSectionTitle}>Inventory Stocks</Text>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Whole</Text>
                  <TextInput
                    style={styles.input}
                    value={editValues.productionWhole}
                    onChangeText={(text) => setEditValues(prev => ({ ...prev, productionWhole: text }))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Slices</Text>
                  <TextInput
                    style={styles.input}
                    value={editValues.productionSlices}
                    onChangeText={(text) => setEditValues(prev => ({ ...prev, productionSlices: text }))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
              </View>

              {editValues.outletStocks.map((outletStock, index) => (
                <View key={outletStock.outletName}>
                  <Text style={styles.modalSectionTitle}>{outletStock.outletName}</Text>
                  <View style={styles.inputRow}>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Whole</Text>
                      <TextInput
                        style={styles.input}
                        value={outletStock.whole}
                        onChangeText={(text) => {
                          const updated = [...editValues.outletStocks];
                          updated[index].whole = text;
                          setEditValues(prev => ({ ...prev, outletStocks: updated }));
                        }}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={Colors.light.muted}
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Slices</Text>
                      <TextInput
                        style={styles.input}
                        value={outletStock.slices}
                        onChangeText={(text) => {
                          const updated = [...editValues.outletStocks];
                          updated[index].slices = text;
                          setEditValues(prev => ({ ...prev, outletStocks: updated }));
                        }}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={Colors.light.muted}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleSaveEdit}
              >
                <Save size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEditOtherUnitsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditOtherUnitsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Edit Inventory Stocks</Text>
                {editingProductId && (() => {
                  const product = productsWithoutConversions.find(p => p.id === editingProductId);
                  if (product) {
                    return (
                      <Text style={styles.modalSubtitle}>
                        {product.name} ({product.unit})
                      </Text>
                    );
                  }
                  return null;
                })()}
              </View>
              <TouchableOpacity onPress={() => setShowEditOtherUnitsModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {editingProductId && (
                <Text style={styles.modalSectionTitle}>
                  {productsWithoutConversions.find(p => p.id === editingProductId)?.name}
                </Text>
              )}
              {editOtherUnitsValues.outletStocks
                .filter(outletStock => outletStock.outletName !== 'HO')
                .map((outletStock, index) => {
                  let displayName = outletStock.outletName;
                  if (displayName === 'Baking Kitchen') {
                    displayName = 'Kitchen';
                  }
                  const actualIndex = editOtherUnitsValues.outletStocks.findIndex(os => os.outletName === outletStock.outletName);
                  return (
                    <View key={outletStock.outletName} style={{ marginBottom: 16 }}>
                      <Text style={styles.inputLabel}>{displayName}</Text>
                      <TextInput
                        style={styles.input}
                        value={outletStock.quantity}
                        onChangeText={(text) => {
                          const updated = [...editOtherUnitsValues.outletStocks];
                          updated[actualIndex].quantity = text;
                          setEditOtherUnitsValues(prev => ({ ...prev, outletStocks: updated }));
                        }}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={Colors.light.muted}
                      />
                    </View>
                  );
                })}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setShowEditOtherUnitsModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, isSavingOtherUnits && styles.saveButtonDisabled]}
                onPress={handleSaveOtherUnitsEdit}
                disabled={isSavingOtherUnits}
              >
                {isSavingOtherUnits ? (
                  <ActivityIndicator size="small" color={Colors.light.card} />
                ) : (
                  <>
                    <Save size={20} color={Colors.light.card} />
                    <Text style={styles.buttonText}>Save</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={showClearConfirm}
        title="Clear All Inventory"
        message="This will delete ALL inventory data including production stock, sales outlet stock, and all production stock checks. This action cannot be undone."
        confirmText="Clear All"
        cancelText="Cancel"
        destructive
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        testID="clear-inventory-confirm"
      />

      <Modal
        visible={showImportProgress}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (importProgress.isComplete) {
            setShowImportProgress(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {importProgress.isComplete ? 'Import Complete' : 'Importing Inventory'}
              </Text>
              {importProgress.isComplete && (
                <TouchableOpacity onPress={() => setShowImportProgress(false)}>
                  <X size={24} color={Colors.light.text} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.modalBody}>
              {!importProgress.isComplete && (
                <>
                  <ActivityIndicator size="large" color={Colors.light.tint} style={{ marginBottom: 16 }} />
                  <Text style={styles.progressText}>
                    Processing row {importProgress.currentRow} of {importProgress.totalRows}
                  </Text>
                </>
              )}

              <View style={styles.statsContainer}>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Products Added:</Text>
                  <Text style={[styles.statValue, styles.successText]}>{importProgress.productsAdded}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Products Updated:</Text>
                  <Text style={[styles.statValue, styles.infoText]}>{importProgress.productsUpdated}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Products Skipped:</Text>
                  <Text style={[styles.statValue, styles.mutedText]}>{importProgress.productsSkipped}</Text>
                </View>
                {importProgress.errors.length > 0 && (
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Errors:</Text>
                    <Text style={[styles.statValue, styles.errorText]}>{importProgress.errors.length}</Text>
                  </View>
                )}
              </View>

              {importProgress.errors.length > 0 && (
                <View style={styles.errorsContainer}>
                  <Text style={styles.errorsTitle}>Errors:</Text>
                  <ScrollView style={styles.errorsList} nestedScrollEnabled>
                    {importProgress.errors.map((error, index) => (
                      <Text key={index} style={styles.errorText}>
                        • {error}
                      </Text>
                    ))}
                  </ScrollView>
                </View>
              )}

              {importProgress.isComplete && importProgress.errors.length === 0 && (
                <View style={styles.successContainer}>
                  <Text style={styles.successMessage}>✓ Import completed successfully!</Text>
                </View>
              )}
            </View>

            {importProgress.isComplete && (
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton]}
                  onPress={() => setShowImportProgress(false)}
                >
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAddProductModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddProductModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Add Product to Inventory
              </Text>
              <TouchableOpacity onPress={() => setShowAddProductModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Select Product</Text>
              <View style={styles.pickerContainer}>
                <ScrollView style={styles.pickerScrollView} nestedScrollEnabled>
                  {(() => {
                    const availableProducts = addProductModalType === 'conversion'
                      ? productsWithConversions.filter(p => {
                          const productPair = getProductPair(p);
                          if (!productPair) return false;
                          const wholeProductId = productPair.whole?.id;
                          return !inventoryStocks.find(inv => inv.productId === wholeProductId);
                        })
                      : productsWithoutConversions.filter(p => {
                          // Include all products without conversions (both menu and raw)
                          return !nonConversionStocks.has(p.id);
                        });

                    if (availableProducts.length === 0) {
                      return (
                        <Text style={styles.noProductsText}>
                          No products available to add.
                          {addProductModalType === 'conversion'
                            ? ' All products with conversions are already in inventory.'
                            : ' All products without conversions are already in inventory.'}
                        </Text>
                      );
                    }

                    return availableProducts.map((product) => {
                      const productPair = getProductPair(product);
                      const displayName = productPair?.whole?.name || product.name;
                      const isSelected = selectedProductToAdd === (productPair?.whole?.id || product.id);

                      return (
                        <TouchableOpacity
                          key={product.id}
                          style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                          onPress={() => setSelectedProductToAdd(productPair?.whole?.id || product.id)}
                        >
                          <Text style={[styles.pickerItemText, isSelected && styles.pickerItemTextSelected]}>
                            {displayName}
                          </Text>
                          {product.unit && (
                            <Text style={[styles.pickerItemSubtext, isSelected && styles.pickerItemSubtextSelected]}>
                              {product.unit}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    });
                  })()}
                </ScrollView>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => setShowAddProductModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, !selectedProductToAdd && styles.saveButtonDisabled]}
                onPress={handleAddProduct}
                disabled={!selectedProductToAdd}
              >
                <Plus size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    backgroundColor: Colors.light.background,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 16,
    textAlign: 'center' as const,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.light.muted,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  header: {
    padding: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 12,
  },
  searchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  actionButtons: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  uploadButton: {
    backgroundColor: Colors.light.card,
    borderColor: Colors.light.border,
  },
  exportButton: {
    backgroundColor: Colors.light.card,
    borderColor: Colors.light.border,
  },
  clearButton: {
    backgroundColor: Colors.light.card,
    borderColor: Colors.light.danger,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  clearButtonText: {
    color: Colors.light.danger,
  },
  scrollContainer: {
    flex: 1,
  },
  tableHeaderWrapper: {
    backgroundColor: Colors.light.card,
    borderBottomWidth: 2,
    borderBottomColor: Colors.light.tint,
    paddingTop: 16,
    paddingHorizontal: 16,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  tableContainer: {
    padding: 16,
    paddingTop: 0,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  outletHeaderGroup: {
    flexDirection: 'row' as const,
  },
  headerCell: {
    paddingHorizontal: 8,
    justifyContent: 'center' as const,
  },
  productNameCell: {
    width: 180,
  },
  numberCell: {
    width: 100,
    alignItems: 'center' as const,
  },
  actionCell: {
    width: 80,
    alignItems: 'center' as const,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.card,
    textAlign: 'center' as const,
  },
  tableRow: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  outletDataGroup: {
    flexDirection: 'row' as const,
  },
  cell: {
    paddingHorizontal: 8,
    justifyContent: 'center' as const,
  },
  cellText: {
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'center' as const,
  },
  cellSubtext: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 2,
  },
  editButton: {
    padding: 8,
  },
  emptyState: {
    backgroundColor: Colors.light.card,
    padding: 32,
    alignItems: 'center' as const,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.light.muted,
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
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalSubtitle: {
    fontSize: 15,
    color: Colors.light.muted,
    marginTop: 4,
  },
  modalBody: {
    padding: 20,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 12,
    marginTop: 16,
  },
  inputRow: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 16,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  modalFooter: {
    flexDirection: 'row' as const,
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  button: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: Colors.light.tint,
  },
  secondaryButton: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  secondaryButtonText: {
    color: Colors.light.tint,
  },
  sectionDivider: {
    height: 32,
  },
  sectionHeaderContainer: {
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  sectionHeaderText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  sectionHeaderSubtext: {
    fontSize: 13,
    color: Colors.light.muted,
  },
  progressText: {
    fontSize: 16,
    color: Colors.light.text,
    textAlign: 'center' as const,
    marginBottom: 24,
  },
  statsContainer: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  statRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  statLabel: {
    fontSize: 15,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
  successText: {
    color: '#10b981',
  },
  infoText: {
    color: Colors.light.tint,
  },
  mutedText: {
    color: Colors.light.muted,
  },
  errorText: {
    color: Colors.light.danger,
  },
  errorsContainer: {
    marginTop: 16,
    backgroundColor: '#fee',
    borderRadius: 12,
    padding: 16,
    maxHeight: 200,
  },
  errorsTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.light.danger,
    marginBottom: 8,
  },
  errorsList: {
    maxHeight: 150,
  },
  successContainer: {
    marginTop: 16,
    backgroundColor: '#d1fae5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center' as const,
  },
  successMessage: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#059669',
  },
  typeHeaderRow: {
    backgroundColor: Colors.light.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: Colors.light.tint,
    marginTop: 8,
  },
  typeHeaderText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    letterSpacing: 1,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  stickyOtherUnitsHeader: {
    position: 'sticky' as any,
    top: 0,
    zIndex: 20,
    backgroundColor: Colors.light.background,
    paddingBottom: 8,
  },
  stickyOtherUnitsTableHeader: {
    position: 'sticky' as any,
    top: 60,
    zIndex: 19,
  },
  tableHeaderTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.light.card,
  },
  tableHeaderTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.card,
    borderWidth: 2,
    borderColor: Colors.light.tint,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sectionHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  pickerContainer: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    maxHeight: 300,
    marginTop: 8,
  },
  pickerScrollView: {
    maxHeight: 300,
  },
  pickerItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  pickerItemSelected: {
    backgroundColor: Colors.light.tint,
  },
  pickerItemText: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  pickerItemTextSelected: {
    color: Colors.light.card,
    fontWeight: '700' as const,
  },
  pickerItemSubtext: {
    fontSize: 13,
    color: Colors.light.muted,
    marginTop: 4,
  },
  pickerItemSubtextSelected: {
    color: Colors.light.card,
  },
  noProductsText: {
    padding: 16,
    fontSize: 14,
    color: Colors.light.muted,
    textAlign: 'center' as const,
  },
});
