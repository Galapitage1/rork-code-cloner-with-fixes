import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Modal, ScrollView, Alert, Platform } from 'react-native';
import { Plus, Search, X, Download, Upload, Trash2, GitMerge } from 'lucide-react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import Colors from '@/constants/colors';
import { useStores } from '@/contexts/StoresContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/utils/currencyHelper';
import { StoreProduct, Supplier } from '@/types';
import { exportStoreProductsToExcel, parseStoreProductsExcel } from '@/utils/storesExporter';

export default function StoresScreen() {
  const { storeProducts, addStoreProduct, updateStoreProduct, deleteStoreProduct, importStoreProducts, grns, suppliers, removeDuplicateStoreProducts } = useStores();
  const { isSuperAdmin, currency } = useAuth();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [showOnlyLowStock, setShowOnlyLowStock] = useState<boolean>(false);
  const [showSupplierModal, setShowSupplierModal] = useState<boolean>(false);
  const [selectedProductSuppliers, setSelectedProductSuppliers] = useState<{ productName: string; suppliers: { name: string; phone?: string; email?: string; contactPerson?: string; contactPersonPhone?: string; }[] } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    unit: '',
    category: '',
    quantity: '',
    minStockLevel: '',
    costPerUnit: '',
  });

  const categories = useMemo(() => {
    const cats = new Set<string>(['All']);
    storeProducts.forEach(p => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats);
  }, [storeProducts]);

  const filteredProducts = useMemo(() => {
    let filtered = storeProducts;
    
    if (showOnlyLowStock) {
      filtered = filtered.filter(p => p.quantity < p.minStockLevel);
    }
    
    if (categoryFilter !== 'All') {
      filtered = filtered.filter(p => p.category === categoryFilter);
    }
    
    if (searchQuery) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [storeProducts, searchQuery, categoryFilter, showOnlyLowStock]);

  const lowStockProducts = useMemo(() => {
    return storeProducts.filter(p => p.quantity < p.minStockLevel);
  }, [storeProducts]);

  const handleAddProduct = async () => {
    if (!formData.name || !formData.unit || !formData.category) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const newProduct: StoreProduct = {
      id: `store-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: formData.name,
      unit: formData.unit,
      category: formData.category,
      quantity: parseFloat(formData.quantity) || 0,
      minStockLevel: parseFloat(formData.minStockLevel) || 0,
      costPerUnit: formData.costPerUnit ? parseFloat(formData.costPerUnit) : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'current-user',
    };

    try {
      await addStoreProduct(newProduct);
      setShowAddModal(false);
      resetForm();
      Alert.alert('Success', 'Store product added successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to add product');
    }
  };

  const handleUpdateQuantity = async (productId: string, newQuantity: number) => {
    try {
      await updateStoreProduct(productId, { quantity: newQuantity });
    } catch (error) {
      Alert.alert('Error', 'Failed to update quantity');
    }
  };

  const handleUpdateMinStock = async (productId: string, newMinStock: number) => {
    try {
      await updateStoreProduct(productId, { minStockLevel: newMinStock });
    } catch (error) {
      Alert.alert('Error', 'Failed to update minimum stock level');
    }
  };

  const handleUpdateCostPerUnit = async (productId: string, newCostPerUnit: number | undefined) => {
    try {
      await updateStoreProduct(productId, { costPerUnit: newCostPerUnit });
    } catch (error) {
      Alert.alert('Error', 'Failed to update cost per unit');
    }
  };

  const handleDeleteProduct = (productId: string) => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only Super Admin can delete products');
      return;
    }

    setProductToDelete(productId);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;

    try {
      await deleteStoreProduct(productToDelete);
      Alert.alert('Success', 'Product deleted successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to delete product');
    } finally {
      setShowDeleteConfirm(false);
      setProductToDelete(null);
    }
  };

  const handleOrderNow = (productId: string) => {
    const product = storeProducts.find(p => p.id === productId);
    if (!product) return;

    const productGRNs = grns.filter(grn => 
      grn.items.some(item => item.storeProductId === productId)
    );

    const uniqueSupplierIds = new Set<string>();
    productGRNs.forEach(grn => uniqueSupplierIds.add(grn.supplierId));

    const productSuppliers = Array.from(uniqueSupplierIds)
      .map(supplierId => suppliers.find(s => s.id === supplierId))
      .filter((s): s is Supplier => s !== undefined)
      .map(s => ({
        name: s.name,
        phone: s.phone,
        email: s.email,
        contactPerson: s.contactPerson,
        contactPersonPhone: s.contactPersonPhone,
      }));

    if (productSuppliers.length === 0) {
      Alert.alert('No Suppliers', `No suppliers found for ${product.name}. Add a GRN entry to link suppliers.`);
      return;
    }

    setSelectedProductSuppliers({
      productName: product.name,
      suppliers: productSuppliers,
    });
    setShowSupplierModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      unit: '',
      category: '',
      quantity: '',
      minStockLevel: '',
      costPerUnit: '',
    });
  };

  const handleExport = async () => {
    if (storeProducts.length === 0) {
      Alert.alert('No Data', 'There are no store products to export');
      return;
    }

    try {
      setIsExporting(true);
      await exportStoreProductsToExcel(storeProducts);
      if (Platform.OS === 'web') {
        Alert.alert('Success', 'Store products exported successfully');
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Export Failed', error instanceof Error ? error.message : 'Failed to export store products');
    } finally {
      setIsExporting(false);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only Super Admin can remove duplicates');
      return;
    }

    try {
      console.log('[StoresScreen] Starting duplicate removal...');
      const result = await removeDuplicateStoreProducts();
      console.log('[StoresScreen] Duplicate removal complete:', result);
      
      if (result.duplicatesRemoved === 0) {
        Alert.alert('No Duplicates', 'No duplicate store products found.');
      } else {
        Alert.alert(
          'Duplicates Removed',
          `Successfully removed ${result.duplicatesRemoved} duplicate store product(s).\n\nRemaining products: ${result.remainingCount}`
        );
      }
    } catch (error) {
      console.error('[StoresScreen] Remove duplicates error:', error);
      Alert.alert('Error', 'Failed to remove duplicates');
    }
  };

  const handleImport = async () => {
    try {
      setIsImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsImporting(false);
        return;
      }

      const file = result.assets[0];
      let base64Data: string;

      if (Platform.OS === 'web') {
        if (!file.uri) {
          throw new Error('File URI is missing');
        }
        const response = await fetch(file.uri);
        const blob = await response.blob();
        const reader = new FileReader();
        base64Data = await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        if (!file.uri) {
          throw new Error('File URI is missing');
        }
        base64Data = await FileSystem.readAsStringAsync(file.uri, {
          encoding: 'base64',
        });
      }

      const { storeProducts: parsedProducts, errors } = parseStoreProductsExcel(base64Data);

      if (errors.length > 0) {
        Alert.alert('Import Errors', errors.join('\n'));
        setIsImporting(false);
        return;
      }

      if (parsedProducts.length === 0) {
        Alert.alert('No Data', 'No valid products found in the file');
        setIsImporting(false);
        return;
      }

      const importResult = await importStoreProducts(parsedProducts);
      const message: string[] = [];
      if (importResult.added > 0) {
        message.push(`Added ${importResult.added} new product(s)`);
      }
      if (importResult.updated > 0) {
        message.push(`Updated ${importResult.updated} existing product(s)`);
      }
      if (message.length === 0) {
        message.push('No changes made');
      }
      Alert.alert(
        'Import Complete',
        message.join('\n')
      );
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Import Failed', error instanceof Error ? error.message : 'Failed to import store products');
    } finally {
      setIsImporting(false);
    }
  };

  const renderProductItem = ({ item }: { item: StoreProduct }) => {
    const isLowStock = item.quantity < item.minStockLevel;

    return (
      <View style={[styles.productCard, isLowStock && styles.lowStockCard]}>
        <View style={styles.productHeader}>
          <View style={styles.productInfo}>
            <Text style={styles.productName}>{item.name}</Text>
            <Text style={styles.productCategory}>{item.category}</Text>
          </View>
          {isSuperAdmin && (
            <TouchableOpacity onPress={() => handleDeleteProduct(item.id)} style={styles.deleteButton}>
              <Trash2 size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.productDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Unit:</Text>
            <Text style={styles.detailValue}>{item.unit}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Quantity:</Text>
            <View style={styles.editableField}>
              {isSuperAdmin ? (
                <TextInput
                  style={styles.input}
                  value={item.quantity.toString()}
                  onChangeText={(text) => {
                    const val = parseFloat(text);
                    if (!isNaN(val)) {
                      handleUpdateQuantity(item.id, val);
                    }
                  }}
                  keyboardType="numeric"
                />
              ) : (
                <Text style={styles.detailValue}>{item.quantity}</Text>
              )}
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Min Stock:</Text>
            <View style={styles.editableField}>
              {isSuperAdmin ? (
                <TextInput
                  style={styles.input}
                  value={item.minStockLevel.toString()}
                  onChangeText={(text) => {
                    const val = parseFloat(text);
                    if (!isNaN(val)) {
                      handleUpdateMinStock(item.id, val);
                    }
                  }}
                  keyboardType="numeric"
                />
              ) : (
                <Text style={styles.detailValue}>{item.minStockLevel}</Text>
              )}
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Cost Per Unit:</Text>
            <View style={styles.editableField}>
              {isSuperAdmin ? (
                <TextInput
                  style={styles.input}
                  value={item.costPerUnit !== undefined ? item.costPerUnit.toString() : ''}
                  onChangeText={(text) => {
                    const val = parseFloat(text);
                    if (!isNaN(val)) {
                      handleUpdateCostPerUnit(item.id, val);
                    } else if (text === '') {
                      handleUpdateCostPerUnit(item.id, undefined);
                    }
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
              ) : (
                <Text style={styles.detailValue}>
                  {item.costPerUnit !== undefined ? formatCurrency(item.costPerUnit, currency) : '-'}
                </Text>
              )}
            </View>
          </View>
        </View>

        {isLowStock && (
          <View style={styles.lowStockBanner}>
            <Text style={styles.lowStockText}>⚠️ Low Stock</Text>
            <TouchableOpacity 
              style={styles.orderNowButton}
              onPress={() => handleOrderNow(item.id)}
            >
              <Text style={styles.orderNowText}>Order now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchContainer}>
          <Search size={20} color={Colors.light.tabIconDefault} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search raw materials..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={Colors.light.tabIconDefault}
          />
        </View>

        <View style={styles.actions}>
          {isSuperAdmin && (
            <>
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={handleRemoveDuplicates}
                disabled={isExporting || isImporting}
              >
                <GitMerge size={20} color={Colors.light.tint} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={handleExport}
                disabled={isExporting}
              >
                <Download size={20} color={Colors.light.tint} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={handleImport}
                disabled={isImporting}
              >
                <Upload size={20} color={Colors.light.tint} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.actionButtonPrimary} 
                onPress={() => setShowAddModal(true)}
              >
                <Plus size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.categoryChip, categoryFilter === cat && styles.categoryChipActive]}
            onPress={() => setCategoryFilter(cat)}
          >
            <Text style={[styles.categoryChipText, categoryFilter === cat && styles.categoryChipTextActive]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {lowStockProducts.length > 0 && (
        <TouchableOpacity 
          style={styles.alertBanner}
          onPress={() => setShowOnlyLowStock(!showOnlyLowStock)}
          activeOpacity={0.7}
        >
          <Text style={styles.alertText}>
            ⚠️ {lowStockProducts.length} raw material{lowStockProducts.length > 1 ? 's' : ''} below minimum stock level
          </Text>
          <Text style={styles.alertSubtext}>
            {showOnlyLowStock ? 'Tap to show all' : 'Tap to filter'}
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={filteredProducts}
        renderItem={renderProductItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No raw materials found</Text>
          </View>
        }
      />

      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Raw Material</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Product Name *</Text>
              <TextInput
                style={styles.modalInput}
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="Enter product name"
              />

              <Text style={styles.label}>Unit *</Text>
              <TextInput
                style={styles.modalInput}
                value={formData.unit}
                onChangeText={(text) => setFormData({ ...formData, unit: text })}
                placeholder="e.g., kg, g, ml, L, 1g, 1ml"
              />

              <Text style={styles.label}>Category *</Text>
              <TextInput
                style={styles.modalInput}
                value={formData.category}
                onChangeText={(text) => setFormData({ ...formData, category: text })}
                placeholder="Enter category"
              />

              <Text style={styles.label}>Initial Quantity</Text>
              <TextInput
                style={styles.modalInput}
                value={formData.quantity}
                onChangeText={(text) => setFormData({ ...formData, quantity: text })}
                placeholder="0"
                keyboardType="numeric"
              />

              <Text style={styles.label}>Minimum Stock Level</Text>
              <TextInput
                style={styles.modalInput}
                value={formData.minStockLevel}
                onChangeText={(text) => setFormData({ ...formData, minStockLevel: text })}
                placeholder="0"
                keyboardType="numeric"
              />

              <Text style={styles.label}>Cost Per Unit ({currency})</Text>
              <TextInput
                style={styles.modalInput}
                value={formData.costPerUnit}
                onChangeText={(text) => setFormData({ ...formData, costPerUnit: text })}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />

              <TouchableOpacity style={styles.submitButton} onPress={handleAddProduct}>
                <Text style={styles.submitButtonText}>Add Raw Material</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete Raw Material"
        message="Are you sure you want to delete this raw material? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setProductToDelete(null);
        }}
      />

      <Modal visible={showSupplierModal} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Suppliers for {selectedProductSuppliers?.productName}
              </Text>
              <TouchableOpacity onPress={() => {
                setShowSupplierModal(false);
                setSelectedProductSuppliers(null);
              }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {selectedProductSuppliers?.suppliers.map((supplier, index) => (
                <View key={index} style={styles.supplierCard}>
                  <Text style={styles.supplierName}>{supplier.name}</Text>
                  {supplier.phone && (
                    <View style={styles.supplierDetail}>
                      <Text style={styles.supplierDetailLabel}>Phone:</Text>
                      <Text style={styles.supplierDetailValue}>{supplier.phone}</Text>
                    </View>
                  )}
                  {supplier.email && (
                    <View style={styles.supplierDetail}>
                      <Text style={styles.supplierDetailLabel}>Email:</Text>
                      <Text style={styles.supplierDetailValue}>{supplier.email}</Text>
                    </View>
                  )}
                  {supplier.contactPerson && (
                    <View style={styles.supplierDetail}>
                      <Text style={styles.supplierDetailLabel}>Contact Person:</Text>
                      <Text style={styles.supplierDetailValue}>{supplier.contactPerson}</Text>
                    </View>
                  )}
                  {supplier.contactPersonPhone && (
                    <View style={styles.supplierDetail}>
                      <Text style={styles.supplierDetailLabel}>Contact Phone:</Text>
                      <Text style={styles.supplierDetailValue}>{supplier.contactPersonPhone}</Text>
                    </View>
                  )}
                </View>
              ))}
              {(!selectedProductSuppliers?.suppliers || selectedProductSuppliers.suppliers.length === 0) && (
                <Text style={styles.noSuppliersText}>No suppliers found</Text>
              )}
            </ScrollView>
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
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 12,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  actionButtonPrimary: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  categoryScroll: {
    maxHeight: 60,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: Colors.light.tint,
  },
  categoryChipText: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '500' as const,
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  alertBanner: {
    backgroundColor: '#FFF4E5',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#FFD580',
  },
  alertText: {
    fontSize: 14,
    color: '#CC6600',
    fontWeight: '600' as const,
    marginBottom: 2,
  },
  alertSubtext: {
    fontSize: 12,
    color: '#CC6600',
    fontWeight: '500' as const,
  },
  listContent: {
    padding: 16,
    paddingTop: 24,
  },
  productCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  lowStockCard: {
    borderColor: '#FF3B30',
    borderWidth: 2,
    backgroundColor: '#FFF5F5',
  },
  productHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  productCategory: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
  },
  deleteButton: {
    padding: 4,
  },
  productDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  detailLabel: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    fontWeight: '500' as const,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  editableField: {
    minWidth: 80,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'right' as const,
  },
  lowStockBanner: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#FFCCCC',
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  lowStockText: {
    fontSize: 14,
    color: '#FF3B30',
    fontWeight: '700' as const,
  },
  orderNowButton: {
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  orderNowText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700' as const,
  },
  emptyContainer: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.tabIconDefault,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end' as const,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalBody: {
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  submitButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center' as const,
    marginTop: 24,
    marginBottom: 20,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  supplierCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  supplierName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  supplierDetail: {
    flexDirection: 'row' as const,
    marginBottom: 6,
  },
  supplierDetailLabel: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    fontWeight: '500' as const,
    width: 120,
  },
  supplierDetailValue: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '600' as const,
    flex: 1,
  },
  noSuppliersText: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    textAlign: 'center' as const,
    paddingVertical: 40,
  },
});
