import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Modal, ScrollView, Alert, Platform } from 'react-native';
import { Plus, Search, X, Trash2, Edit2, Phone, Mail, User, Download, Upload } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import Colors from '@/constants/colors';
import { useStores } from '@/contexts/StoresContext';
import { useAuth } from '@/contexts/AuthContext';
import { Supplier } from '@/types';
import { exportSuppliersToExcel, parseSuppliersExcel } from '@/utils/suppliersExporter';

export default function SuppliersScreen() {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier, importSuppliers } = useStores();
  const { isSuperAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    contactPerson: '',
    contactPersonPhone: '',
    contactPersonEmail: '',
    vatNumber: '',
    notes: '',
  });

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery) return suppliers;
    
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (s.phone && s.phone.includes(searchQuery))
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, searchQuery]);

  const handleSubmit = async () => {
    if (!formData.name) {
      Alert.alert('Error', 'Supplier name is required');
      return;
    }

    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, formData);
        Alert.alert('Success', 'Supplier updated successfully');
      } else {
        const newSupplier: Supplier = {
          id: `supplier-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ...formData,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'current-user',
        };
        await addSupplier(newSupplier);
        Alert.alert('Success', 'Supplier added successfully');
      }
      setShowModal(false);
      resetForm();
    } catch {
      Alert.alert('Error', 'Failed to save supplier');
    }
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      address: supplier.address || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      contactPerson: supplier.contactPerson || '',
      contactPersonPhone: supplier.contactPersonPhone || '',
      contactPersonEmail: supplier.contactPersonEmail || '',
      vatNumber: supplier.vatNumber || '',
      notes: supplier.notes || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (supplierId: string) => {
    if (!isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only Super Admin can delete suppliers');
      return;
    }

    Alert.alert(
      'Delete Supplier',
      'Are you sure you want to delete this supplier?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSupplier(supplierId);
              Alert.alert('Success', 'Supplier deleted successfully');
            } catch {
              Alert.alert('Error', 'Failed to delete supplier');
            }
          },
        },
      ]
    );
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      phone: '',
      email: '',
      contactPerson: '',
      contactPersonPhone: '',
      contactPersonEmail: '',
      vatNumber: '',
      notes: '',
    });
    setEditingSupplier(null);
  };

  const handleExport = async () => {
    if (suppliers.length === 0) {
      Alert.alert('No Data', 'There are no suppliers to export');
      return;
    }

    try {
      setIsExporting(true);
      await exportSuppliersToExcel(suppliers);
      if (Platform.OS === 'web') {
        Alert.alert('Success', 'Suppliers exported successfully');
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Export Failed', error instanceof Error ? error.message : 'Failed to export suppliers');
    } finally {
      setIsExporting(false);
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

      const { suppliers: parsedSuppliers, errors } = parseSuppliersExcel(base64Data);

      if (errors.length > 0) {
        Alert.alert('Import Errors', errors.join('\n'));
        setIsImporting(false);
        return;
      }

      if (parsedSuppliers.length === 0) {
        Alert.alert('No Data', 'No valid suppliers found in the file');
        setIsImporting(false);
        return;
      }

      const addedCount = await importSuppliers(parsedSuppliers);
      Alert.alert(
        'Import Complete',
        `Successfully imported ${addedCount} supplier(s).\n${parsedSuppliers.length - addedCount} duplicate(s) skipped.`
      );
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Import Failed', error instanceof Error ? error.message : 'Failed to import suppliers');
    } finally {
      setIsImporting(false);
    }
  };

  const renderSupplierItem = ({ item }: { item: Supplier }) => (
    <View style={styles.supplierCard}>
      <View style={styles.supplierHeader}>
        <Text style={styles.supplierName}>{item.name}</Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => handleEdit(item)} style={styles.iconButton}>
            <Edit2 size={20} color={Colors.light.tint} />
          </TouchableOpacity>
          {isSuperAdmin && (
            <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.iconButton}>
              <Trash2 size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {item.address && (
        <Text style={styles.supplierDetail}>{item.address}</Text>
      )}

      {item.phone && (
        <View style={styles.detailRow}>
          <Phone size={16} color={Colors.light.tabIconDefault} />
          <Text style={styles.detailText}>{item.phone}</Text>
        </View>
      )}

      {item.email && (
        <View style={styles.detailRow}>
          <Mail size={16} color={Colors.light.tabIconDefault} />
          <Text style={styles.detailText}>{item.email}</Text>
        </View>
      )}

      {item.contactPerson && (
        <View style={styles.contactSection}>
          <View style={styles.detailRow}>
            <User size={16} color={Colors.light.tabIconDefault} />
            <Text style={styles.detailText}>{item.contactPerson}</Text>
          </View>
          {item.contactPersonPhone && (
            <Text style={styles.subDetail}>  📱 {item.contactPersonPhone}</Text>
          )}
          {item.contactPersonEmail && (
            <Text style={styles.subDetail}>  ✉️ {item.contactPersonEmail}</Text>
          )}
        </View>
      )}

      {item.vatNumber && (
        <Text style={styles.vatNumber}>VAT: {item.vatNumber}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchContainer}>
          <Search size={20} color={Colors.light.tabIconDefault} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search suppliers..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={Colors.light.tabIconDefault}
          />
        </View>

        <View style={styles.headerActions}>
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
            style={styles.addButton} 
            onPress={() => { resetForm(); setShowModal(true); }}
          >
            <Plus size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={filteredSuppliers}
        renderItem={renderSupplierItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No suppliers found</Text>
            <TouchableOpacity 
              style={styles.emptyButton}
              onPress={() => { resetForm(); setShowModal(true); }}
            >
              <Text style={styles.emptyButtonText}>Add First Supplier</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
              </Text>
              <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Supplier Name *</Text>
              <TextInput
                style={styles.input}
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="Enter supplier name"
              />

              <Text style={styles.label}>Address</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.address}
                onChangeText={(text) => setFormData({ ...formData, address: text })}
                placeholder="Enter address"
                multiline
                numberOfLines={3}
              />

              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={formData.phone}
                onChangeText={(text) => setFormData({ ...formData, phone: text })}
                placeholder="Enter phone number"
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                placeholder="Enter email"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.sectionTitle}>Contact Person</Text>

              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={formData.contactPerson}
                onChangeText={(text) => setFormData({ ...formData, contactPerson: text })}
                placeholder="Enter contact person name"
              />

              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={formData.contactPersonPhone}
                onChangeText={(text) => setFormData({ ...formData, contactPersonPhone: text })}
                placeholder="Enter contact person phone"
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={formData.contactPersonEmail}
                onChangeText={(text) => setFormData({ ...formData, contactPersonEmail: text })}
                placeholder="Enter contact person email"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.label}>VAT Registration Number</Text>
              <TextInput
                style={styles.input}
                value={formData.vatNumber}
                onChangeText={(text) => setFormData({ ...formData, vatNumber: text })}
                placeholder="Enter VAT number"
              />

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.notes}
                onChangeText={(text) => setFormData({ ...formData, notes: text })}
                placeholder="Enter additional notes"
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
                <Text style={styles.submitButtonText}>
                  {editingSupplier ? 'Update Supplier' : 'Add Supplier'}
                </Text>
              </TouchableOpacity>
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
  headerActions: {
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  listContent: {
    padding: 16,
  },
  supplierCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  supplierHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  supplierName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    flex: 1,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  iconButton: {
    padding: 4,
  },
  supplierDetail: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6,
  },
  detailText: {
    fontSize: 14,
    color: Colors.light.text,
  },
  contactSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  subDetail: {
    fontSize: 13,
    color: Colors.light.tabIconDefault,
    marginLeft: 24,
    marginTop: 4,
  },
  vatNumber: {
    fontSize: 13,
    color: Colors.light.tabIconDefault,
    marginTop: 8,
    fontStyle: 'italic' as const,
  },
  emptyContainer: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.tabIconDefault,
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 20,
    marginBottom: 12,
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
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top' as const,
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
});
