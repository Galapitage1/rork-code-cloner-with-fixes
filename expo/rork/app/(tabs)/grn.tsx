import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Modal, ScrollView, Alert, Platform } from 'react-native';
import { Plus, Search, X, Download, Upload, Trash2, ChevronRight, Calendar } from 'lucide-react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import Colors from '@/constants/colors';
import { useStores } from '@/contexts/StoresContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/utils/currencyHelper';
import { GRN, GRNItem, Supplier } from '@/types';
import { CalendarModal } from '@/components/CalendarModal';
import { exportGRNsToExcel, parseGRNsExcel } from '@/utils/grnExporter';

export default function GRNScreen() {
  const { grns, suppliers, storeProducts, addGRN, deleteGRN, addSupplier } = useStores();
  const { isSuperAdmin, currency } = useAuth();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showGRNModal, setShowGRNModal] = useState<boolean>(false);
  const [showSupplierModal, setShowSupplierModal] = useState<boolean>(false);
  const [showItemsModal, setShowItemsModal] = useState<boolean>(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [showSupplierSelect, setShowSupplierSelect] = useState<boolean>(false);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [showGRNDatePicker, setShowGRNDatePicker] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [grnToDelete, setGrnToDelete] = useState<string | null>(null);

  const [grnFormData, setGrnFormData] = useState({
    invoiceNumber: '',
    invoiceAmount: '',
    vatAmount: '',
    discountAmount: '',
    dueDate: '',
    grnDate: '',
  });

  const [supplierFormData, setSupplierFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    contactPerson: '',
    contactPersonPhone: '',
    contactPersonEmail: '',
    vatNumber: '',
  });

  const [items, setItems] = useState<GRNItem[]>([]);
  const [itemSearch, setItemSearch] = useState<string>('');

  const filteredGRNs = useMemo(() => {
    if (!searchQuery) return grns;
    
    return grns.filter(g => {
      const supplier = suppliers.find(s => s.id === g.supplierId);
      return g.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
             (supplier && supplier.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [grns, searchQuery, suppliers]);

  const grnsBySupplier = useMemo(() => {
    const grouped = new Map<string, GRN[]>();
    grns.forEach(grn => {
      const existing = grouped.get(grn.supplierId) || [];
      grouped.set(grn.supplierId, [...existing, grn]);
    });
    return grouped;
  }, [grns]);

  const filteredProducts = useMemo(() => {
    if (!itemSearch) return storeProducts;
    return storeProducts.filter(p => 
      p.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
      p.category.toLowerCase().includes(itemSearch.toLowerCase())
    );
  }, [storeProducts, itemSearch]);

  const totalAmount = useMemo(() => {
    const invoice = parseFloat(grnFormData.invoiceAmount) || 0;
    const vat = parseFloat(grnFormData.vatAmount) || 0;
    const discount = parseFloat(grnFormData.discountAmount) || 0;
    return invoice + vat - discount;
  }, [grnFormData]);

  const handleAddSupplier = async () => {
    if (!supplierFormData.name) {
      Alert.alert('Error', 'Supplier name is required');
      return;
    }

    try {
      const newSupplier: Supplier = {
        id: `supplier-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...supplierFormData,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'current-user',
      };
      await addSupplier(newSupplier);
      setSelectedSupplier(newSupplier);
      setShowSupplierModal(false);
      resetSupplierForm();
      Alert.alert('Success', 'Supplier added successfully');
    } catch {
      Alert.alert('Error', 'Failed to add supplier');
    }
  };

  const handleAddGRN = async () => {
    if (!selectedSupplier) {
      Alert.alert('Error', 'Please select a supplier');
      return;
    }

    if (!grnFormData.invoiceNumber) {
      Alert.alert('Error', 'Invoice number is required');
      return;
    }

    if (items.length === 0) {
      Alert.alert('Error', 'Please add at least one item');
      return;
    }

    try {
      const newGRN: GRN = {
        id: `grn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        supplierId: selectedSupplier.id,
        invoiceNumber: grnFormData.invoiceNumber,
        invoiceAmount: parseFloat(grnFormData.invoiceAmount) || 0,
        vatAmount: parseFloat(grnFormData.vatAmount) || 0,
        discountAmount: parseFloat(grnFormData.discountAmount) || 0,
        items,
        dueDate: grnFormData.dueDate || new Date().toISOString().split('T')[0],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'current-user',
      };

      await addGRN(newGRN);
      setShowGRNModal(false);
      resetGRNForm();
      Alert.alert('Success', 'GRN added successfully. Store quantities updated.');
    } catch {
      Alert.alert('Error', 'Failed to add GRN');
    }
  };

  const handleDeleteGRN = (grnId: string) => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only Super Admin can delete GRNs');
      return;
    }

    setGrnToDelete(grnId);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteGRN = async () => {
    if (!grnToDelete) return;

    try {
      await deleteGRN(grnToDelete);
      Alert.alert('Success', 'GRN deleted successfully');
    } catch {
      Alert.alert('Error', 'Failed to delete GRN');
    } finally {
      setShowDeleteConfirm(false);
      setGrnToDelete(null);
    }
  };

  const handleAddItem = (productId: string) => {
    const existing = items.find(i => i.storeProductId === productId);
    if (existing) {
      Alert.alert('Info', 'Product already added. Edit the quantity in the list.');
      return;
    }

    const product = storeProducts.find(p => p.id === productId);
    const initialCostPerUnit = product?.costPerUnit || 0;

    setItems([...items, { storeProductId: productId, quantity: 0, costPerUnit: initialCostPerUnit }]);
    setShowItemsModal(false);
    setItemSearch('');
  };

  const handleUpdateItemQuantity = (productId: string, quantity: number) => {
    setItems(items.map(i => 
      i.storeProductId === productId ? { ...i, quantity } : i
    ));
  };

  const handleUpdateItemCostPerUnit = (productId: string, costPerUnit: number) => {
    setItems(items.map(i => 
      i.storeProductId === productId ? { ...i, costPerUnit } : i
    ));
  };

  const handleRemoveItem = (productId: string) => {
    setItems(items.filter(i => i.storeProductId !== productId));
  };

  const resetGRNForm = () => {
    setGrnFormData({
      invoiceNumber: '',
      invoiceAmount: '',
      vatAmount: '',
      discountAmount: '',
      dueDate: '',
      grnDate: '',
    });
    setSelectedSupplier(null);
    setItems([]);
  };

  const resetSupplierForm = () => {
    setSupplierFormData({
      name: '',
      address: '',
      phone: '',
      email: '',
      contactPerson: '',
      contactPersonPhone: '',
      contactPersonEmail: '',
      vatNumber: '',
    });
  };

  const renderGRNItem = ({ item }: { item: GRN }) => {
    const supplier = suppliers.find(s => s.id === item.supplierId);
    const totalPayable = item.invoiceAmount + item.vatAmount - item.discountAmount;
    const today = new Date();
    const dueDate = new Date(item.dueDate);
    const isOverdue = today > dueDate;

    return (
      <View style={styles.grnCard}>
        <View style={styles.grnHeader}>
          <View>
            <Text style={styles.supplierName}>{supplier?.name || 'Unknown Supplier'}</Text>
            <Text style={styles.invoiceNumber}>Invoice: {item.invoiceNumber}</Text>
          </View>
          {isSuperAdmin && (
            <TouchableOpacity onPress={() => handleDeleteGRN(item.id)}>
              <Trash2 size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.grnDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Total Payable:</Text>
            <Text style={[styles.detailValue, isOverdue && styles.overdueAmount]}>SLR {totalPayable.toFixed(2)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Due Date:</Text>
            <Text style={[styles.detailValue, isOverdue && styles.overdueDate]}>{item.dueDate}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Items:</Text>
            <Text style={styles.detailValue}>{item.items.length} product(s)</Text>
          </View>
        </View>
        
        {isOverdue && (
          <View style={styles.overdueNotice}>
            <Text style={styles.overdueNoticeText}>⚠️ Payment Overdue</Text>
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
            placeholder="Search GRNs..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={Colors.light.tabIconDefault}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowGRNModal(true)}>
            <Plus size={20} color="#FFFFFF" />
          </TouchableOpacity>
          {isSuperAdmin && (
            <>
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
            </>
          )}
        </View>
      </View>

      <FlatList
        data={filteredGRNs}
        renderItem={renderGRNItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No GRNs found</Text>
          </View>
        }
      />

      <Modal visible={showGRNModal} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add GRN</Text>
              <TouchableOpacity onPress={() => { setShowGRNModal(false); resetGRNForm(); }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Supplier *</Text>
              <TouchableOpacity 
                style={styles.supplierSelect}
                onPress={() => setShowSupplierSelect(true)}
              >
                <Text style={[styles.supplierSelectText, !selectedSupplier && styles.placeholder]}>
                  {selectedSupplier ? selectedSupplier.name : 'Select Supplier'}
                </Text>
                <ChevronRight size={20} color={Colors.light.tabIconDefault} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowSupplierModal(true)} style={styles.addSupplierLink}>
                <Plus size={16} color={Colors.light.tint} />
                <Text style={styles.addSupplierText}>Add New Supplier</Text>
              </TouchableOpacity>

              <Text style={styles.label}>Invoice Number *</Text>
              <TextInput
                style={styles.input}
                value={grnFormData.invoiceNumber}
                onChangeText={(text) => setGrnFormData({ ...grnFormData, invoiceNumber: text })}
                placeholder="Enter invoice number"
              />

              <Text style={styles.label}>Invoice Amount (SLR)</Text>
              <TextInput
                style={styles.input}
                value={grnFormData.invoiceAmount}
                onChangeText={(text) => setGrnFormData({ ...grnFormData, invoiceAmount: text })}
                placeholder="0.00"
                keyboardType="numeric"
              />

              <Text style={styles.label}>VAT Amount (SLR)</Text>
              <TextInput
                style={styles.input}
                value={grnFormData.vatAmount}
                onChangeText={(text) => setGrnFormData({ ...grnFormData, vatAmount: text })}
                placeholder="0.00"
                keyboardType="numeric"
              />

              <Text style={styles.label}>Discount Amount (SLR)</Text>
              <TextInput
                style={styles.input}
                value={grnFormData.discountAmount}
                onChangeText={(text) => setGrnFormData({ ...grnFormData, discountAmount: text })}
                placeholder="0.00"
                keyboardType="numeric"
              />

              <View style={styles.totalSection}>
                <Text style={styles.totalLabel}>Total Payable:</Text>
                <Text style={styles.totalValue}>SLR {totalAmount.toFixed(2)}</Text>
              </View>

              <Text style={styles.label}>GRN Date</Text>
              <TouchableOpacity
                style={styles.datePickerButton}
                onPress={() => setShowGRNDatePicker(true)}
              >
                <Calendar size={20} color={Colors.light.tabIconDefault} />
                <Text style={[styles.datePickerText, !grnFormData.grnDate && styles.placeholder]}>
                  {grnFormData.grnDate || 'Select GRN Date'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.label}>Due Date</Text>
              <TouchableOpacity
                style={styles.datePickerButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Calendar size={20} color={Colors.light.tabIconDefault} />
                <Text style={[styles.datePickerText, !grnFormData.dueDate && styles.placeholder]}>
                  {grnFormData.dueDate || 'Select Due Date'}
                </Text>
              </TouchableOpacity>

              <View style={styles.itemsSection}>
                <View style={styles.itemsHeader}>
                  <Text style={styles.sectionTitle}>Items *</Text>
                  <TouchableOpacity onPress={() => setShowItemsModal(true)} style={styles.addItemButton}>
                    <Plus size={18} color="#FFFFFF" />
                    <Text style={styles.addItemText}>Add Item</Text>
                  </TouchableOpacity>
                </View>

                {items.map((item) => {
                  const product = storeProducts.find(p => p.id === item.storeProductId);
                  return (
                    <View key={item.storeProductId} style={styles.itemRow}>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{product?.name}</Text>
                        <Text style={styles.itemUnit}>{product?.unit}</Text>
                      </View>
                      <View style={styles.itemQuantitySection}>
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>Qty</Text>
                          <TextInput
                            style={styles.itemQuantityInput}
                            value={item.quantity.toString()}
                            onChangeText={(text) => {
                              const val = parseFloat(text);
                              if (!isNaN(val)) {
                                handleUpdateItemQuantity(item.storeProductId, val);
                              }
                            }}
                            keyboardType="numeric"
                            placeholder="0"
                          />
                        </View>
                        <View style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>Cost/Unit</Text>
                          <TextInput
                            style={styles.itemQuantityInput}
                            value={item.costPerUnit?.toString() || '0'}
                            onChangeText={(text) => {
                              const val = parseFloat(text);
                              if (!isNaN(val)) {
                                handleUpdateItemCostPerUnit(item.storeProductId, val);
                              }
                            }}
                            keyboardType="numeric"
                            placeholder="0.00"
                          />
                        </View>
                        <TouchableOpacity onPress={() => handleRemoveItem(item.storeProductId)} style={styles.deleteButton}>
                          <X size={20} color="#FF3B30" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                {items.length === 0 && (
                  <Text style={styles.noItemsText}>No items added yet</Text>
                )}
              </View>

              <TouchableOpacity style={styles.submitButton} onPress={handleAddGRN}>
                <Text style={styles.submitButtonText}>Save GRN</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showSupplierSelect} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Supplier</Text>
              <TouchableOpacity onPress={() => setShowSupplierSelect(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {suppliers.map((supplier) => (
                <TouchableOpacity
                  key={supplier.id}
                  style={styles.supplierOption}
                  onPress={() => {
                    setSelectedSupplier(supplier);
                    setShowSupplierSelect(false);
                  }}
                >
                  <Text style={styles.supplierOptionName}>{supplier.name}</Text>
                  {supplier.phone && (
                    <Text style={styles.supplierOptionDetail}>{supplier.phone}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showSupplierModal} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Supplier</Text>
              <TouchableOpacity onPress={() => { setShowSupplierModal(false); resetSupplierForm(); }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Supplier Name *</Text>
              <TextInput
                style={styles.input}
                value={supplierFormData.name}
                onChangeText={(text) => setSupplierFormData({ ...supplierFormData, name: text })}
                placeholder="Enter supplier name"
              />

              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={supplierFormData.phone}
                onChangeText={(text) => setSupplierFormData({ ...supplierFormData, phone: text })}
                placeholder="Enter phone number"
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={supplierFormData.email}
                onChangeText={(text) => setSupplierFormData({ ...supplierFormData, email: text })}
                placeholder="Enter email"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <TouchableOpacity style={styles.submitButton} onPress={handleAddSupplier}>
                <Text style={styles.submitButtonText}>Add Supplier</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showItemsModal} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Product</Text>
              <TouchableOpacity onPress={() => { setShowItemsModal(false); setItemSearch(''); }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchContainer}>
              <Search size={20} color={Colors.light.tabIconDefault} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search products..."
                value={itemSearch}
                onChangeText={setItemSearch}
                placeholderTextColor={Colors.light.tabIconDefault}
              />
            </View>

            <ScrollView style={styles.modalBody}>
              {filteredProducts.map((product) => (
                <TouchableOpacity
                  key={product.id}
                  style={styles.productOption}
                  onPress={() => handleAddItem(product.id)}
                >
                  <View>
                    <Text style={styles.productOptionName}>{product.name}</Text>
                    <Text style={styles.productOptionCategory}>{product.category}</Text>
                  </View>
                  <Text style={styles.productOptionUnit}>{product.unit}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <CalendarModal
        visible={showDatePicker}
        initialDate={grnFormData.dueDate}
        onClose={() => setShowDatePicker(false)}
        onSelect={(date) => {
          setGrnFormData({ ...grnFormData, dueDate: date });
          setShowDatePicker(false);
        }}
      />

      <CalendarModal
        visible={showGRNDatePicker}
        initialDate={grnFormData.grnDate}
        onClose={() => setShowGRNDatePicker(false)}
        onSelect={(date) => {
          setGrnFormData({ ...grnFormData, grnDate: date });
          setShowGRNDatePicker(false);
        }}
      />

      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete GRN"
        message="Are you sure you want to delete this GRN entry? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        destructive
        onConfirm={confirmDeleteGRN}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setGrnToDelete(null);
        }}
      />
    </View>
  );

  async function handleExport() {
    if (grns.length === 0) {
      Alert.alert('No Data', 'There are no GRNs to export');
      return;
    }

    try {
      setIsExporting(true);
      await exportGRNsToExcel(grns, suppliers, storeProducts, currency);
      if (Platform.OS === 'web') {
        Alert.alert('Success', 'GRNs exported successfully');
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Export Failed', error instanceof Error ? error.message : 'Failed to export GRNs');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport() {
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

      const { grns: parsedGRNs, errors } = parseGRNsExcel(base64Data);

      if (errors.length > 0) {
        Alert.alert('Import Errors', errors.join('\n'));
        setIsImporting(false);
        return;
      }

      if (parsedGRNs.length === 0) {
        Alert.alert('No Data', 'No valid GRNs found in the file');
        setIsImporting(false);
        return;
      }

      Alert.alert(
        'Import Notice',
        `Found ${parsedGRNs.length} GRN(s) in the file. Note: Import only adds GRN records without updating inventory. For full functionality, create GRNs through the app.`
      );
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Import Failed', error instanceof Error ? error.message : 'Failed to import GRNs');
    } finally {
      setIsImporting(false);
    }
  }
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  listContent: {
    padding: 16,
  },
  grnCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  grnHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  supplierName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  invoiceNumber: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
  },
  grnDetails: {
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
  overdueAmount: {
    color: '#FF3B30',
    fontWeight: '700' as const,
  },
  overdueDate: {
    color: '#FF3B30',
  },
  overdueNotice: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#FFCCCC',
    backgroundColor: '#FFF5F5',
    padding: 8,
    borderRadius: 6,
  },
  overdueNoticeText: {
    fontSize: 14,
    color: '#FF3B30',
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  datePickerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: Colors.light.background,
  },
  datePickerText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  emptyContainer: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 60,
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
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  supplierSelect: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: Colors.light.background,
  },
  supplierSelectText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  placeholder: {
    color: Colors.light.tabIconDefault,
  },
  addSupplierLink: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 8,
  },
  addSupplierText: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '600' as const,
  },
  totalSection: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  itemsSection: {
    marginTop: 24,
  },
  itemsHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  addItemButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addItemText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600' as const,
  },
  itemRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  itemUnit: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  itemQuantitySection: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  itemQuantityInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 14,
    color: Colors.light.text,
    width: 80,
    textAlign: 'right' as const,
  },
  noItemsText: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    textAlign: 'center' as const,
    paddingVertical: 20,
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
  supplierOption: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  supplierOptionName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  supplierOptionDetail: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
  },
  modalSearchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginHorizontal: 20,
    marginVertical: 12,
    height: 40,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  productOption: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  productOptionName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  productOptionCategory: {
    fontSize: 13,
    color: Colors.light.tabIconDefault,
  },
  productOptionUnit: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    fontWeight: '500' as const,
  },
  inputGroup: {
    flexDirection: 'column' as const,
    alignItems: 'flex-start' as const,
    gap: 4,
  },
  inputLabel: {
    fontSize: 11,
    color: Colors.light.tabIconDefault,
    fontWeight: '500' as const,
  },
  deleteButton: {
    paddingLeft: 8,
  },
});
