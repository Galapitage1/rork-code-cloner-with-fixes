import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { 
  Plus, 
  Camera, 
  User, 
  Mail, 
  Phone, 
  Building2,
  MapPin,
  FileText,
  Download,
  X,
  Edit,
  Trash2,
  CameraOff,
  Upload,
  Award,
  CreditCard,
} from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Colors from '@/constants/colors';
import { useCustomers } from '@/contexts/CustomerContext';
import { useAuth } from '@/contexts/AuthContext';
import { Customer } from '@/types';
import * as Haptics from 'expo-haptics';
import { exportCustomersToExcel } from '@/utils/customerExporter';
import { VoiceSearchInput } from '@/components/VoiceSearchInput';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export default function CustomersScreen() {
  const { customers, addCustomer, importCustomers, updateCustomer, deleteCustomer, searchCustomers } = useCustomers();
  const { isAdmin, isSuperAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isScanModalVisible, setIsScanModalVisible] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const displayedCustomers = searchQuery ? searchCustomers(searchQuery) : customers;

  const handleAddCustomer = () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setIsAddModalVisible(true);
  };

  const handleScanCard = () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setIsScanModalVisible(true);
  };

  const handleEditCustomer = (customer: Customer) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setSelectedCustomer(customer);
    setIsEditModalVisible(true);
  };

  const handleDeleteCustomer = (customer: Customer) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setCustomerToDelete(customer);
    setDeleteConfirmVisible(true);
  };

  const confirmDelete = async () => {
    if (customerToDelete) {
      try {
        await deleteCustomer(customerToDelete.id);
        setDeleteConfirmVisible(false);
        setCustomerToDelete(null);
      } catch (error) {
        console.error('Error deleting customer:', error);
        Alert.alert('Error', 'Failed to delete customer');
      }
    }
  };

  const handleExport = async () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    
    try {
      await exportCustomersToExcel(customers);
      Alert.alert('Success', 'Customers exported successfully!');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export customers');
    }
  };

  const handleImport = async () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }

    try {
      setIsImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/comma-separated-values', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        setIsImporting(false);
        return;
      }

      const file = result.assets[0];
      if (!file) {
        Alert.alert('Error', 'No file selected');
        setIsImporting(false);
        return;
      }

      let fileContent: string;
      if (Platform.OS === 'web') {
        const response = await fetch(file.uri);
        fileContent = await response.text();
      } else {
        fileContent = await FileSystem.readAsStringAsync(file.uri);
      }

      const lines = fileContent.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        Alert.alert('Error', 'CSV file is empty or invalid');
        setIsImporting(false);
        return;
      }

      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          const nextChar = line[i + 1];
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };

      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/"/g, ''));
      const nameIndex = headers.findIndex(h => h.includes('name'));
      const emailIndex = headers.findIndex(h => h.includes('email'));
      const phoneIndex = headers.findIndex(h => h.includes('phone'));
      const companyIndex = headers.findIndex(h => h.includes('company'));
      const addressIndex = headers.findIndex(h => h.includes('address'));
      const pointsIndex = headers.findIndex(h => h.includes('point'));
      const idNumberIndex = headers.findIndex(h => h.includes('id') && h.includes('number'));

      if (nameIndex === -1) {
        Alert.alert('Error', 'CSV must contain a "Name" column');
        setIsImporting(false);
        return;
      }

      console.log('Starting to parse', lines.length - 1, 'customer rows...');
      const customersToImport: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const name = values[nameIndex]?.replace(/^"|"$/g, '').trim();
        
        if (!name) continue;

        const customerData: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> = {
          name,
          email: emailIndex !== -1 && values[emailIndex] ? values[emailIndex].replace(/^"|"$/g, '').trim() : undefined,
          phone: phoneIndex !== -1 && values[phoneIndex] ? values[phoneIndex].replace(/^"|"$/g, '').trim() : undefined,
          company: companyIndex !== -1 && values[companyIndex] ? values[companyIndex].replace(/^"|"$/g, '').trim() : undefined,
          address: addressIndex !== -1 && values[addressIndex] ? values[addressIndex].replace(/^"|"$/g, '').trim() : undefined,
          points: pointsIndex !== -1 && values[pointsIndex] ? parseFloat(values[pointsIndex].replace(/^"|"$/g, '')) || 0 : 0,
          idNumber: idNumberIndex !== -1 && values[idNumberIndex] ? values[idNumberIndex].replace(/^"|"$/g, '').trim() : undefined,
        };

        customersToImport.push(customerData);
      }

      console.log('Parsed', customersToImport.length, 'customers, importing...');
      const imported = await importCustomers(customersToImport);
      console.log('Import complete, imported', imported, 'customers');
      console.log('Current customers count:', customers.length);
      Alert.alert('Success', `Imported ${imported} customer(s) successfully!`);
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Error', 'Failed to import customers. Please check the file format.');
    } finally {
      setIsImporting(false);
    }
  };

  const renderCustomerCard = ({ item }: { item: Customer }) => (
    <TouchableOpacity
      style={styles.customerCard}
      onPress={() => handleEditCustomer(item)}
      activeOpacity={0.7}
    >
      <View style={styles.customerHeader}>
        <View style={styles.customerAvatar}>
          <User size={24} color={Colors.light.tint} />
        </View>
        <View style={styles.customerInfo}>
          <View style={styles.customerNameRow}>
            <Text style={styles.customerName}>{item.name}</Text>
            {item.points !== undefined && (
              <View style={styles.pointsBadge}>
                <Award size={12} color={Colors.light.tint} />
                <Text style={styles.pointsText}>{item.points}</Text>
              </View>
            )}
          </View>
          {item.company && (
            <Text style={styles.customerCompany}>{item.company}</Text>
          )}
        </View>
        <View style={styles.customerActions}>
          <TouchableOpacity
            onPress={() => handleEditCustomer(item)}
            style={styles.actionButton}
          >
            <Edit size={18} color={Colors.light.tint} />
          </TouchableOpacity>
          {(isAdmin || isSuperAdmin) && (
            <TouchableOpacity
              onPress={() => handleDeleteCustomer(item)}
              style={styles.actionButton}
            >
              <Trash2 size={18} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={styles.customerDetails}>
        {item.email && (
          <View style={styles.detailRow}>
            <Mail size={14} color={Colors.light.icon} />
            <Text style={styles.detailText}>{item.email}</Text>
          </View>
        )}
        {item.phone && (
          <View style={styles.detailRow}>
            <Phone size={14} color={Colors.light.icon} />
            <Text style={styles.detailText}>{item.phone}</Text>
          </View>
        )}
        {item.address && (
          <View style={styles.detailRow}>
            <MapPin size={14} color={Colors.light.icon} />
            <Text style={styles.detailText} numberOfLines={1}>{item.address}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <VoiceSearchInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search customers..."
          placeholderTextColor={Colors.light.icon}
          style={styles.searchBar}
          inputStyle={styles.searchInput}
        />
        <TouchableOpacity style={styles.actionButton} onPress={handleImport} disabled={isImporting}>
          {isImporting ? (
            <ActivityIndicator size="small" color={Colors.light.tint} />
          ) : (
            <Upload size={20} color={Colors.light.tint} />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleExport}>
          <Download size={20} color={Colors.light.tint} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{customers.length}</Text>
          <Text style={styles.statLabel}>Total Customers</Text>
        </View>
      </View>

      <FlatList
        data={displayedCustomers}
        renderItem={renderCustomerCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        removeClippedSubviews={true}
        maxToRenderPerBatch={20}
        initialNumToRender={20}
        windowSize={10}
        updateCellsBatchingPeriod={50}
        getItemLayout={(data, index) => ({
          length: 120,
          offset: 120 * index,
          index,
        })}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <User size={64} color={Colors.light.icon} />
            <Text style={styles.emptyText}>No customers yet</Text>
            <Text style={styles.emptySubtext}>Add your first customer to get started</Text>
          </View>
        }
      />

      <View style={styles.fabContainer}>
        <TouchableOpacity style={styles.fabSecondary} onPress={handleScanCard}>
          <Camera size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={handleAddCustomer}>
          <Plus size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <CustomerFormModal
        visible={isAddModalVisible}
        onClose={() => setIsAddModalVisible(false)}
        onSave={addCustomer}
      />

      {selectedCustomer && (
        <CustomerFormModal
          visible={isEditModalVisible}
          onClose={() => {
            setIsEditModalVisible(false);
            setSelectedCustomer(null);
          }}
          onSave={(data) => updateCustomer(selectedCustomer.id, data)}
          initialData={selectedCustomer}
        />
      )}

      <ScanCardModal
        visible={isScanModalVisible}
        onClose={() => setIsScanModalVisible(false)}
        onSave={addCustomer}
      />

      <ConfirmDialog
        visible={deleteConfirmVisible}
        title="Delete Customer"
        message={`Are you sure you want to delete ${customerToDelete?.name}?`}
        confirmText="Delete"
        destructive={true}
        onCancel={() => {
          setDeleteConfirmVisible(false);
          setCustomerToDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </View>
  );
}

interface CustomerFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => void;
  initialData?: Customer;
}

function CustomerFormModal({ visible, onClose, onSave, initialData }: CustomerFormModalProps) {
  const { isAdmin, isSuperAdmin } = useAuth();
  const [name, setName] = useState(initialData?.name || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [company, setCompany] = useState(initialData?.company || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [points, setPoints] = useState(initialData?.points?.toString() || '0');
  const [idNumber, setIdNumber] = useState(initialData?.idNumber || '');

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setEmail(initialData.email || '');
      setPhone(initialData.phone || '');
      setCompany(initialData.company || '');
      setAddress(initialData.address || '');
      setNotes(initialData.notes || '');
      setPoints(initialData.points?.toString() || '0');
      setIdNumber(initialData.idNumber || '');
    }
  }, [initialData]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter customer name');
      return;
    }

    const pointsValue = parseFloat(points) || 0;

    onSave({
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      address: address.trim() || undefined,
      notes: notes.trim() || undefined,
      points: pointsValue,
      idNumber: idNumber.trim() || undefined,
    });

    setName('');
    setEmail('');
    setPhone('');
    setCompany('');
    setAddress('');
    setNotes('');
    setPoints('0');
    setIdNumber('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <X size={24} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {initialData ? 'Edit Customer' : 'Add Customer'}
          </Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={styles.saveButton}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <User size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Name *</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Enter customer name"
              value={name}
              onChangeText={setName}
              placeholderTextColor={Colors.light.icon}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <Mail size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Email</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Enter email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={Colors.light.icon}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <Phone size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Phone</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Enter phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholderTextColor={Colors.light.icon}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <Building2 size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Company</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Enter company name"
              value={company}
              onChangeText={setCompany}
              placeholderTextColor={Colors.light.icon}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <MapPin size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Address</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Enter address"
              value={address}
              onChangeText={setAddress}
              placeholderTextColor={Colors.light.icon}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <Award size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Points</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Customer points"
              value={points}
              onChangeText={setPoints}
              keyboardType="numeric"
              placeholderTextColor={Colors.light.icon}
              editable={!initialData || isAdmin || isSuperAdmin}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <CreditCard size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>ID Number</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Customer ID number"
              value={idNumber}
              onChangeText={setIdNumber}
              placeholderTextColor={Colors.light.icon}
            />
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputHeader}>
              <FileText size={18} color={Colors.light.icon} />
              <Text style={styles.inputLabel}>Notes</Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Additional notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              placeholderTextColor={Colors.light.icon}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

interface ScanCardModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => void;
}

function ScanCardModal({ visible, onClose, onSave }: ScanCardModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (visible && !permission) {
      console.log('Requesting camera permission...');
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handleStartCamera = async () => {
    if (!permission?.granted) {
      console.log('Permission not granted, requesting...');
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access to scan business cards'
        );
        return;
      }
    }
    setShowCamera(true);
  };

  const handleTakePicture = async () => {
    if (!cameraRef.current) {
      Alert.alert('Error', 'Camera not ready');
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      console.log('Taking picture...');
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });

      if (photo && photo.base64) {
        console.log('Picture taken, processing...');
        setShowCamera(false);
        await processBusinessCard(photo.base64);
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      Alert.alert('Error', 'Failed to capture image. Please try again.');
    }
  };

  const processBusinessCard = async (base64Image: string) => {
    setIsProcessing(true);
    
    try {
      console.log('AI-powered business card scanning is not available in this deployment.');
      Alert.alert(
        'Feature Not Available',
        'AI-powered business card scanning is not available in web deployment. Please add customer details manually.',
        [
          {
            text: 'OK',
            onPress: handleClose,
          },
        ]
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setShowCamera(false);
    setIsProcessing(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={handleClose}>
            <X size={24} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Scan Business Card</Text>
          <View style={{ width: 24 }} />
        </View>

        {showCamera ? (
          <View style={styles.cameraContainer}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
            >
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraFrame} />
                <TouchableOpacity
                  style={styles.captureButton}
                  onPress={handleTakePicture}
                  disabled={isProcessing}
                >
                  <View style={styles.captureButtonInner} />
                </TouchableOpacity>
              </View>
            </CameraView>
          </View>
        ) : isProcessing ? (
          <View style={styles.scanContent}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
            <Text style={styles.scanText}>Processing business card...</Text>
          </View>
        ) : !permission ? (
          <View style={styles.scanContent}>
            <Camera size={64} color={Colors.light.icon} />
            <Text style={styles.scanText}>Loading camera...</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.scanContent}>
            <CameraOff size={64} color={Colors.light.icon} />
            <Text style={styles.scanText}>Camera permission is required to scan business cards</Text>
            <TouchableOpacity style={styles.scanButton} onPress={requestPermission}>
              <Text style={styles.scanButtonText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.scanContent}>
            <Camera size={64} color={Colors.light.icon} />
            <Text style={styles.scanText}>
              Take a photo of the business card to automatically extract contact information
            </Text>
            <TouchableOpacity style={styles.scanButton} onPress={handleStartCamera}>
              <Camera size={20} color="#fff" />
              <Text style={styles.scanButtonText}>Open Camera</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  searchContainer: {
    flexDirection: 'row' as const,
    padding: 16,
    gap: 12,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  searchBar: {
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
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  statsContainer: {
    flexDirection: 'row' as const,
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center' as const,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.icon,
    fontWeight: '500' as const,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  customerCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  customerHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  customerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${Colors.light.tint}20`,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: 12,
  },
  customerInfo: {
    flex: 1,
  },
  customerNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 2,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  pointsBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: `${Colors.light.tint}15`,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  pointsText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  customerCompany: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  customerActions: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  customerDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.light.icon,
    textAlign: 'center' as const,
  },
  fabContainer: {
    position: 'absolute' as const,
    right: 16,
    bottom: 16,
    flexDirection: 'row' as const,
    gap: 12,
    alignItems: 'center' as const,
  },
  fabSecondary: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.icon,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  saveButton: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  inputHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
  },
  scanContent: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 32,
  },
  scanText: {
    fontSize: 16,
    color: Colors.light.icon,
    textAlign: 'center' as const,
    marginTop: 16,
    marginBottom: 32,
  },
  scanButton: {
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 60,
  },
  cameraFrame: {
    width: 300,
    height: 200,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
});
