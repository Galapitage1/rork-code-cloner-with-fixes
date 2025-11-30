import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator, Modal } from 'react-native';
import { useState, useMemo, useCallback } from 'react';
import { Picker } from '@react-native-picker/picker';
import { Calendar, FileText, Search, Plus, List, Package, X } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useStores } from '@/contexts/StoresContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProduction } from '@/contexts/ProductionContext';
import { CalendarModal } from '@/components/CalendarModal';
import { ProductionRequestItem, ProductRequest } from '@/types';
import Colors from '@/constants/colors';
import { useRouter } from 'expo-router';

export default function ProductionScreen() {
  const { products, productConversions, outlets, addRequest } = useStock();
  const { storeProducts } = useStores();
  const { currentUser } = useAuth();
  const { addProductionRequest } = useProduction();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTab, setSelectedTab] = useState<string>('All');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [requestedBy, setRequestedBy] = useState<string>('');
  const [quantities, setQuantities] = useState<Map<string, string>>(new Map());
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  
  const [showRawMaterialsModal, setShowRawMaterialsModal] = useState<boolean>(false);
  const [selectedOutlet, setSelectedOutlet] = useState<string>('');
  const [rawMaterialsSearch, setRawMaterialsSearch] = useState<string>('');
  const [selectedRawMaterials, setSelectedRawMaterials] = useState<Map<string, string>>(new Map());
  const [isSubmittingRawRequest, setIsSubmittingRawRequest] = useState<boolean>(false);

  const getWholeProductForPair = useCallback((productId: string) => {
    const toConversion = productConversions.find(c => c.toProductId === productId);
    if (toConversion) {
      return toConversion.fromProductId;
    }
    return productId;
  }, [productConversions]);

  const productTypes = useMemo(() => {
    const types = new Set<string>();
    products.forEach(p => {
      if (p.type === 'menu' || p.type === 'kitchen') {
        types.add(p.type === 'menu' ? 'Menu' : 'Kitchen');
      }
    });
    return ['All', ...Array.from(types).sort()];
  }, [products]);

  const eligibleProducts = useMemo(() => {
    const wholeProductIds = new Set<string>();
    
    const filtered = products.filter(p => {
      if (p.showInStock === false) return false;
      
      if (p.type === 'raw') return false;
      
      if (p.type === 'menu' || p.type === 'kitchen') {
        const toConversion = productConversions.find(c => c.toProductId === p.id);
        if (toConversion) {
          return false;
        }
        
        const fromConversion = productConversions.find(c => c.fromProductId === p.id);
        if (fromConversion) {
          if (wholeProductIds.has(p.id)) {
            return false;
          }
          wholeProductIds.add(p.id);
          return true;
        }
        
        return true;
      }
      
      return false;
    });

    let tabFiltered = filtered;
    if (selectedTab !== 'All') {
      const targetType = selectedTab === 'Menu' ? 'menu' : 'kitchen';
      tabFiltered = filtered.filter(p => p.type === targetType);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return tabFiltered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.category?.toLowerCase().includes(query)
      );
    }
    
    return tabFiltered;
  }, [products, productConversions, searchQuery, selectedTab]);

  const handleQuantityChange = (productId: string, value: string) => {
    const newQuantities = new Map(quantities);
    if (value === '' || value === '0') {
      newQuantities.delete(productId);
    } else {
      newQuantities.set(productId, value);
    }
    setQuantities(newQuantities);
  };

  const handleOpenRawMaterialsRequest = () => {
    const salesOutlets = outlets.filter(o => o.outletType === 'sales');
    if (salesOutlets.length === 0) {
      Alert.alert('No Outlets', 'Please add sales outlets first in Settings.');
      return;
    }
    setSelectedOutlet(salesOutlets[0]?.name || '');
    setSelectedRawMaterials(new Map());
    setRawMaterialsSearch('');
    setShowRawMaterialsModal(true);
  };

  const handleSubmitRawMaterialsRequest = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to submit a request');
      return;
    }

    if (!selectedOutlet) {
      Alert.alert('Required', 'Please select an outlet');
      return;
    }

    if (selectedRawMaterials.size === 0) {
      Alert.alert('Required', 'Please add at least one raw material');
      return;
    }

    const hasEmptyQuantity = Array.from(selectedRawMaterials.values()).some(
      qty => !qty.trim() || parseFloat(qty) <= 0
    );

    if (hasEmptyQuantity) {
      Alert.alert('Error', 'Please enter valid quantities for all selected raw materials');
      return;
    }

    try {
      setIsSubmittingRawRequest(true);
      const todayIso = new Date().toISOString().split('T')[0];
      
      const requestsToCreate: ProductRequest[] = [];
      
      for (const [storeProductId, quantity] of selectedRawMaterials.entries()) {
        const storeProduct = storeProducts.find(sp => sp.id === storeProductId);
        if (!storeProduct) continue;
        
        const product = products.find(p => 
          p.name.toLowerCase() === storeProduct.name.toLowerCase() && 
          p.type === 'raw'
        );
        
        if (!product) {
          console.log('Raw material product not found for:', storeProduct.name);
          continue;
        }
        
        const request: ProductRequest = {
          id: `raw-req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          productId: product.id,
          quantity: parseFloat(quantity),
          priority: 'medium',
          notes: 'Raw Material Request from Production',
          requestedAt: Date.now(),
          status: 'pending',
          fromOutlet: 'Stores',
          toOutlet: selectedOutlet,
          requestDate: todayIso,
          doneDate: todayIso,
          requestedBy: currentUser.username || 'Production',
        };
        
        requestsToCreate.push(request);
      }
      
      if (requestsToCreate.length === 0) {
        Alert.alert('Error', 'No valid raw materials found to create requests');
        return;
      }
      
      for (const request of requestsToCreate) {
        await addRequest(request);
      }
      
      setShowRawMaterialsModal(false);
      setSelectedRawMaterials(new Map());
      setSelectedOutlet('');
      setRawMaterialsSearch('');
      
      Alert.alert('Success', `${requestsToCreate.length} raw material request(s) submitted successfully. Go to Requests tab to approve.`);
    } catch (error) {
      console.error('Failed to submit raw materials request:', error);
      Alert.alert('Error', 'Failed to submit raw materials request');
    } finally {
      setIsSubmittingRawRequest(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to submit a production request');
      return;
    }

    if (!requestedBy.trim()) {
      Alert.alert('Required', 'Please enter who is requesting this production');
      return;
    }

    if (quantities.size === 0) {
      Alert.alert('Required', 'Please enter at least one product quantity');
      return;
    }

    const items: ProductionRequestItem[] = Array.from(quantities.entries()).map(([productId, quantity]) => ({
      productId,
      quantity: parseFloat(quantity) || 0,
    })).filter(item => item.quantity > 0);

    if (items.length === 0) {
      Alert.alert('Error', 'No valid quantities entered');
      return;
    }

    try {
      setIsSaving(true);
      
      const request = {
        id: `prod-req-${Date.now()}`,
        date: selectedDate,
        requestedBy: requestedBy.trim(),
        items,
        status: 'pending' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: currentUser.id,
      };

      await addProductionRequest(request);

      setQuantities(new Map());
      setRequestedBy('');
      
      Alert.alert('Success', 'Production request submitted successfully');
    } catch (error) {
      console.error('Failed to submit production request:', error);
      Alert.alert('Error', 'Failed to submit production request');
    } finally {
      setIsSaving(false);
    }
  };

  const productsWithQuantity = useMemo(() => {
    return eligibleProducts.filter(p => quantities.has(p.id) && parseFloat(quantities.get(p.id) || '0') > 0);
  }, [eligibleProducts, quantities]);

  const productsWithoutQuantity = useMemo(() => {
    return eligibleProducts.filter(p => !quantities.has(p.id) || parseFloat(quantities.get(p.id) || '0') === 0);
  }, [eligibleProducts, quantities]);

  const rawMaterialProducts = useMemo(() => {
    const filtered = storeProducts.filter(sp => {
      if (rawMaterialsSearch.trim()) {
        const query = rawMaterialsSearch.toLowerCase();
        return sp.name.toLowerCase().includes(query) || sp.category?.toLowerCase().includes(query);
      }
      return true;
    });
    return filtered.sort((a, b) => {
      const aSelected = selectedRawMaterials.has(a.id);
      const bSelected = selectedRawMaterials.has(b.id);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [storeProducts, rawMaterialsSearch, selectedRawMaterials]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowCalendar(true)}
          >
            <Calendar size={20} color={Colors.light.tint} />
            <Text style={styles.dateText}>{selectedDate}</Text>
          </TouchableOpacity>

          <View style={styles.headerButtonsRow}>
            <TouchableOpacity
              style={styles.rawMaterialsButton}
              onPress={handleOpenRawMaterialsRequest}
            >
              <Package size={18} color="#fff" />
              <Text style={styles.rawMaterialsButtonText}>Raw Materials</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.viewRequestsButton}
              onPress={() => router.push('/production-requests')}
            >
              <List size={20} color="#fff" />
              <Text style={styles.viewRequestsText}>View Requests</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputRow}>
          <FileText size={20} color={Colors.light.icon} />
          <TextInput
            style={styles.requestedByInput}
            placeholder="Requested By"
            value={requestedBy}
            onChangeText={setRequestedBy}
            placeholderTextColor={Colors.light.tabIconDefault}
          />
        </View>

        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.tabsContainer}
          contentContainerStyle={styles.tabsContent}
        >
          {productTypes.map((type) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.tab,
                selectedTab === type && styles.tabActive,
              ]}
              onPress={() => setSelectedTab(type)}
            >
              <Text
                style={[
                  styles.tabText,
                  selectedTab === type && styles.tabTextActive,
                ]}
              >
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.searchContainer}>
          <Search size={20} color={Colors.light.icon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={Colors.light.tabIconDefault}
          />
        </View>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {productsWithQuantity.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Products with Quantity</Text>
            {productsWithQuantity.map((product) => (
              <View key={product.id} style={styles.productRow}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  {product.category && (
                    <Text style={styles.productCategory}>{product.category}</Text>
                  )}
                </View>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.quantityInput}
                    value={quantities.get(product.id) || ''}
                    onChangeText={(value) => handleQuantityChange(product.id, value)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.light.tabIconDefault}
                  />
                  <Text style={styles.unitText}>{product.unit}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {productsWithoutQuantity.length > 0 && (
          <>
            {productsWithQuantity.length > 0 && (
              <View style={styles.divider} />
            )}
            <Text style={styles.sectionTitle}>
              {productsWithQuantity.length > 0 ? 'Other Products' : 'All Products'}
            </Text>
            {productsWithoutQuantity.map((product) => (
              <View key={product.id} style={styles.productRow}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  {product.category && (
                    <Text style={styles.productCategory}>{product.category}</Text>
                  )}
                </View>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.quantityInput}
                    value={quantities.get(product.id) || ''}
                    onChangeText={(value) => handleQuantityChange(product.id, value)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.light.tabIconDefault}
                  />
                  <Text style={styles.unitText}>{product.unit}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {eligibleProducts.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No products available</Text>
          </View>
        )}

        <View style={styles.spacer} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, (isSaving || quantities.size === 0) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSaving || quantities.size === 0}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Plus size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Submit Request</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <CalendarModal
        visible={showCalendar}
        initialDate={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setShowCalendar(false)}
      />

      <Modal
        visible={showRawMaterialsModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowRawMaterialsModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Raw Materials Request</Text>
            <TouchableOpacity onPress={() => setShowRawMaterialsModal(false)}>
              <X size={24} color={Colors.light.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <Text style={styles.label}>To Outlet</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={selectedOutlet}
                onValueChange={(itemValue: string) => setSelectedOutlet(itemValue)}
                style={styles.picker}
              >
                {outlets.filter(o => o.outletType === 'sales').map((outlet) => (
                  <Picker.Item
                    key={outlet.id}
                    label={outlet.name}
                    value={outlet.name}
                  />
                ))}
              </Picker>
            </View>

            <View style={styles.searchContainer}>
              <Search size={20} color={Colors.light.icon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search raw materials..."
                value={rawMaterialsSearch}
                onChangeText={setRawMaterialsSearch}
                placeholderTextColor={Colors.light.tabIconDefault}
              />
            </View>

            <ScrollView style={styles.rawMaterialsList} showsVerticalScrollIndicator={false}>
              {selectedRawMaterials.size > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Selected ({selectedRawMaterials.size})</Text>
                  {rawMaterialProducts.filter(sp => selectedRawMaterials.has(sp.id)).map((sp) => (
                    <View key={sp.id} style={styles.rawMaterialRow}>
                      <View style={styles.rawMaterialInfo}>
                        <Text style={styles.rawMaterialName}>{sp.name}</Text>
                        <Text style={styles.rawMaterialCategory}>{sp.category} • Stock: {sp.quantity} {sp.unit}</Text>
                      </View>
                      <View style={styles.rawMaterialActions}>
                        <TextInput
                          style={styles.rawMaterialQuantityInput}
                          value={selectedRawMaterials.get(sp.id) || ''}
                          onChangeText={(value) => {
                            const newMap = new Map(selectedRawMaterials);
                            if (value === '' || value === '0') {
                              newMap.delete(sp.id);
                            } else {
                              newMap.set(sp.id, value);
                            }
                            setSelectedRawMaterials(newMap);
                          }}
                          keyboardType="numeric"
                          placeholder="Qty"
                          placeholderTextColor={Colors.light.tabIconDefault}
                        />
                        <Text style={styles.unitText}>{sp.unit}</Text>
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => {
                            const newMap = new Map(selectedRawMaterials);
                            newMap.delete(sp.id);
                            setSelectedRawMaterials(newMap);
                          }}
                        >
                          <X size={18} color={Colors.light.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  <View style={styles.divider} />
                </>  
              )}

              <Text style={styles.sectionTitle}>
                {selectedRawMaterials.size > 0 ? 'Available Raw Materials' : 'All Raw Materials'}
              </Text>
              {rawMaterialProducts.filter(sp => !selectedRawMaterials.has(sp.id)).map((sp) => (
                <TouchableOpacity
                  key={sp.id}
                  style={styles.rawMaterialRow}
                  onPress={() => {
                    const newMap = new Map(selectedRawMaterials);
                    newMap.set(sp.id, '1');
                    setSelectedRawMaterials(newMap);
                  }}
                >
                  <View style={styles.rawMaterialInfo}>
                    <Text style={styles.rawMaterialName}>{sp.name}</Text>
                    <Text style={styles.rawMaterialCategory}>{sp.category} • Stock: {sp.quantity} {sp.unit}</Text>
                  </View>
                  <Plus size={20} color={Colors.light.tint} />
                </TouchableOpacity>
              ))}

              {rawMaterialProducts.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No raw materials found</Text>
                </View>
              )}

              <View style={styles.spacer} />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.submitButton, (isSubmittingRawRequest || selectedRawMaterials.size === 0) && styles.submitButtonDisabled]}
                onPress={handleSubmitRawMaterialsRequest}
                disabled={isSubmittingRawRequest || selectedRawMaterials.size === 0}
              >
                {isSubmittingRawRequest ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Plus size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>Submit Request ({selectedRawMaterials.size})</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
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
    backgroundColor: Colors.light.card,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  headerButtonsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  dateButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 8,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  rawMaterialsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  rawMaterialsButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#fff',
  },
  viewRequestsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  viewRequestsText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  requestedByInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.text,
    paddingVertical: 10,
  },
  tabsContainer: {
    flexGrow: 0,
  },
  tabsContent: {
    gap: 8,
    paddingVertical: 4,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  tabActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.text,
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600' as const,
  },
  searchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.light.text,
    paddingVertical: 10,
  },
  scrollView: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: Colors.light.background,
  },
  productRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  productInfo: {
    flex: 1,
    marginRight: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  productCategory: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  inputContainer: {
    flexDirection: 'column' as const,
    alignItems: 'flex-end' as const,
    gap: 4,
  },
  quantityInput: {
    width: 80,
    height: 40,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'right' as const,
  },
  unitText: {
    fontSize: 11,
    color: Colors.light.tabIconDefault,
  },
  divider: {
    height: 8,
    backgroundColor: Colors.light.background,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.tabIconDefault,
  },
  spacer: {
    height: 100,
  },
  footer: {
    backgroundColor: Colors.light.card,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  submitButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.light.tint,
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.light.tabIconDefault,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    paddingTop: 60,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  pickerContainer: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 16,
  },
  picker: {
    backgroundColor: Colors.light.background,
    color: Colors.light.text,
  },
  rawMaterialsList: {
    flex: 1,
    marginTop: 16,
  },
  rawMaterialRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  rawMaterialInfo: {
    flex: 1,
    marginRight: 12,
  },
  rawMaterialName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  rawMaterialCategory: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  rawMaterialActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  rawMaterialQuantityInput: {
    width: 70,
    height: 36,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    color: Colors.light.text,
    textAlign: 'center' as const,
  },
  removeButton: {
    padding: 4,
  },
  modalFooter: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
});
