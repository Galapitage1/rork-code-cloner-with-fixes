import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Dimensions, Platform } from 'react-native';
import { useState, useMemo } from 'react';
import { ChevronLeft, MapPin, CalendarDays, ChevronRight, Check, Home } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Product, ProductConversion, Outlet } from '@/types';
import { StockInputModal } from './StockInputModal';
import { CalendarModal } from './CalendarModal';

type ButtonViewModeProps = {
  products: Product[];
  filterType: 'all' | 'menu' | 'kitchen' | 'raw';
  productConversions: ProductConversion[];
  onAddStock?: (productId: string, data: any) => void;
  onAddRequest?: (productId: string, data: any) => void;
  mode: 'stockCheck' | 'request';
  selectedOutlet?: string;
  setSelectedOutlet?: (outlet: string) => void;
  selectedDate?: string;
  setSelectedDate?: (date: string) => void;
  outlets?: Outlet[];
  onClose?: () => void;
};

const BUTTON_COLORS = [
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#EF4444',
  '#14B8A6',
];

const getColorForIndex = (index: number) => {
  return BUTTON_COLORS[index % BUTTON_COLORS.length];
};

export function ButtonViewMode({ products, filterType, productConversions, onAddStock, onAddRequest, mode, selectedOutlet, setSelectedOutlet, selectedDate, setSelectedDate, outlets, onClose }: ButtonViewModeProps) {
  const [viewLevel, setViewLevel] = useState<'tabs' | 'categories' | 'products' | 'units'>('tabs');
  const [selectedTab, setSelectedTab] = useState<'all' | 'menu' | 'kitchen' | 'raw'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showInputModal, setShowInputModal] = useState<boolean>(false);
  const [showOutletModal, setShowOutletModal] = useState<boolean>(false);
  const [showFromOutletModal, setShowFromOutletModal] = useState<boolean>(false);
  const [showToOutletModal, setShowToOutletModal] = useState<boolean>(false);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [fromOutlet, setFromOutlet] = useState<string>(outlets && outlets.length > 0 ? outlets[0].name : '');
  const [toOutlet, setToOutlet] = useState<string>(outlets && outlets.length > 1 ? outlets[1].name : '');
  const [requestDate, setRequestDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  const screenWidth = Dimensions.get('window').width;
  const buttonSize = Math.max(Math.min((screenWidth - 48) / 3, 120), 80);

  const filteredByTab = useMemo(() => {
    let filtered = products.filter(p => p.showInStock !== false);
    if (selectedTab !== 'all') {
      filtered = filtered.filter(p => p.type === selectedTab);
    }
    return filtered;
  }, [products, selectedTab]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    filteredByTab.forEach(p => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [filteredByTab]);

  const productsInCategory = useMemo(() => {
    if (!selectedCategory) return [];
    const allProducts = filteredByTab.filter(p => p.category === selectedCategory);
    
    const processedProductIds = new Set<string>();
    const uniqueProducts: Product[] = [];
    
    allProducts.forEach(product => {
      if (processedProductIds.has(product.id)) return;
      
      const fromConversion = productConversions.find(c => c.fromProductId === product.id);
      const toConversion = productConversions.find(c => c.toProductId === product.id);
      
      if (fromConversion) {
        processedProductIds.add(product.id);
        processedProductIds.add(fromConversion.toProductId);
        uniqueProducts.push(product);
      } else if (toConversion) {
        const fromProduct = allProducts.find(p => p.id === toConversion.fromProductId);
        if (fromProduct) {
          processedProductIds.add(toConversion.fromProductId);
          processedProductIds.add(product.id);
          uniqueProducts.push(fromProduct);
        } else {
          processedProductIds.add(product.id);
          uniqueProducts.push(product);
        }
      } else {
        processedProductIds.add(product.id);
        uniqueProducts.push(product);
      }
    });
    
    return uniqueProducts.sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredByTab, selectedCategory, productConversions]);

  const productUnits = useMemo(() => {
    if (!selectedProduct) return [];
    
    const units: { product: Product; label: string }[] = [];
    const fromConversion = productConversions.find(c => c.fromProductId === selectedProduct.id);
    const toConversion = productConversions.find(c => c.toProductId === selectedProduct.id);
    
    if (fromConversion) {
      const toProduct = products.find(p => p.id === fromConversion.toProductId);
      units.push({ product: selectedProduct, label: selectedProduct.name });
      if (toProduct) {
        units.push({ product: toProduct, label: toProduct.name });
      }
    } else if (toConversion) {
      const fromProduct = products.find(p => p.id === toConversion.fromProductId);
      if (fromProduct) {
        units.push({ product: fromProduct, label: fromProduct.name });
      }
      units.push({ product: selectedProduct, label: selectedProduct.name });
    }
    
    return units;
  }, [selectedProduct, productConversions, products]);

  const handleTabSelect = (tab: 'all' | 'menu' | 'kitchen' | 'raw') => {
    setSelectedTab(tab);
    setViewLevel('categories');
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setViewLevel('products');
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    
    const fromConversion = productConversions.find(c => c.fromProductId === product.id);
    const toConversion = productConversions.find(c => c.toProductId === product.id);
    const hasUnits = fromConversion || toConversion;
    
    if (hasUnits) {
      setViewLevel('units');
    } else {
      setShowInputModal(true);
    }
  };

  const handleUnitSelect = (product: Product) => {
    setSelectedProduct(product);
    setShowInputModal(true);
  };

  const handleInputSave = (data: any) => {
    if (!selectedProduct) return;
    
    if (mode === 'stockCheck' && onAddStock) {
      onAddStock(selectedProduct.id, data);
    } else if (mode === 'request' && onAddRequest) {
      const requestData = {
        ...data,
        fromOutlet,
        toOutlet,
        requestDate,
      };
      onAddRequest(selectedProduct.id, requestData);
    }
    
    setShowInputModal(false);
    
    if (viewLevel === 'units') {
      setViewLevel('products');
    } else if (viewLevel === 'products') {
      setViewLevel('categories');
    }
  };

  const handleBack = () => {
    if (viewLevel === 'units') {
      setViewLevel('products');
    } else if (viewLevel === 'products') {
      setViewLevel('categories');
      setSelectedCategory(null);
    } else if (viewLevel === 'categories') {
      setViewLevel('tabs');
    }
  };

  const handleHome = () => {
    if (mode === 'request' && onClose) {
      onClose();
    } else if (mode === 'stockCheck') {
      setViewLevel('tabs');
      setSelectedTab('all');
      setSelectedCategory(null);
      setSelectedProduct(null);
    }
  };

  return (
    <View style={styles.container}>
      {mode === 'stockCheck' && (
        <View style={styles.topBar}>
          <TouchableOpacity 
            style={styles.outletSelector}
            onPress={() => setShowOutletModal(true)}
          >
            <MapPin size={16} color={Colors.light.tint} />
            <View style={styles.outletInfo}>
              <Text style={styles.outletLabel}>Outlet</Text>
              <Text style={styles.outletValue}>{selectedOutlet || 'Select'}</Text>
            </View>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>
          <View style={styles.dateSelector}>
            <TouchableOpacity onPress={() => setShowCalendar(true)} style={{ padding: 4 }}>
              <CalendarDays size={16} color={Colors.light.tint} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              if (!selectedDate) return;
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              setSelectedDate?.(`${y}-${m}-${day}`);
            }} style={styles.chevBtn}>
              <ChevronLeft size={16} color={Colors.light.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCalendar(true)}>
              <Text style={styles.dateText}>{selectedDate || 'Select'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              if (!selectedDate) return;
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              setSelectedDate?.(`${y}-${m}-${day}`);
            }} style={styles.chevBtn}>
              <ChevronRight size={16} color={Colors.light.text} />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {mode === 'request' && (
        <View style={styles.topBar}>
          <View style={styles.requestTopSection}>
            <TouchableOpacity 
              style={styles.requestOutletButton}
              onPress={() => setShowFromOutletModal(true)}
            >
              <Text style={styles.requestOutletLabel}>From</Text>
              <Text style={styles.requestOutletValue}>{fromOutlet || 'Select'}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.requestOutletButton}
              onPress={() => setShowToOutletModal(true)}
            >
              <Text style={styles.requestOutletLabel}>To</Text>
              <Text style={styles.requestOutletValue}>{toOutlet || 'Select'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.dateSelector}>
            <TouchableOpacity onPress={() => setShowCalendar(true)} style={{ padding: 4 }}>
              <CalendarDays size={16} color={Colors.light.tint} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              const d = new Date(requestDate);
              d.setDate(d.getDate() - 1);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              setRequestDate(`${y}-${m}-${day}`);
            }} style={styles.chevBtn}>
              <ChevronLeft size={16} color={Colors.light.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCalendar(true)}>
              <Text style={styles.dateText}>{requestDate}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              const d = new Date(requestDate);
              d.setDate(d.getDate() + 1);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              setRequestDate(`${y}-${m}-${day}`);
            }} style={styles.chevBtn}>
              <ChevronRight size={16} color={Colors.light.text} />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {viewLevel !== 'tabs' && (
        <View style={styles.navigationBar}>
          <TouchableOpacity style={styles.navButton} onPress={handleBack}>
            <ChevronLeft size={24} color={Colors.light.tint} />
            <Text style={styles.navButtonText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButtonLarge} onPress={handleHome}>
            <Home size={32} color={Colors.light.card} />
            <Text style={styles.navButtonTextLarge}>Home</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {viewLevel === 'tabs' && (
          <View style={styles.buttonGrid}>
            <TouchableOpacity style={[styles.button3D, { backgroundColor: getColorForIndex(0), width: buttonSize, height: buttonSize }]} onPress={() => handleTabSelect('all')}>
              <Text style={styles.buttonText}>All</Text>
              <Text style={styles.buttonSubtext}>{products.filter(p => p.showInStock !== false).length} items</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button3D, { backgroundColor: getColorForIndex(1), width: buttonSize, height: buttonSize }]} onPress={() => handleTabSelect('menu')}>
              <Text style={styles.buttonText}>Menu</Text>
              <Text style={styles.buttonSubtext}>{products.filter(p => p.type === 'menu' && p.showInStock !== false).length} items</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button3D, { backgroundColor: getColorForIndex(2), width: buttonSize, height: buttonSize }]} onPress={() => handleTabSelect('kitchen')}>
              <Text style={styles.buttonText}>Production</Text>
              <Text style={styles.buttonSubtext}>{products.filter(p => p.type === 'kitchen' && p.showInStock !== false).length} items</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button3D, { backgroundColor: getColorForIndex(3), width: buttonSize, height: buttonSize }]} onPress={() => handleTabSelect('raw')}>
              <Text style={styles.buttonText}>Raw</Text>
              <Text style={styles.buttonSubtext}>{products.filter(p => p.type === 'raw' && p.showInStock !== false).length} items</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewLevel === 'categories' && (
          <View style={styles.buttonGrid}>
            {categories.map((category, idx) => (
              <TouchableOpacity key={category} style={[styles.button3D, { backgroundColor: getColorForIndex(idx), width: buttonSize, height: buttonSize }]} onPress={() => handleCategorySelect(category)}>
                <Text style={styles.buttonText}>{category}</Text>
                <Text style={styles.buttonSubtext}>
                  {filteredByTab.filter(p => p.category === category).length} items
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {viewLevel === 'products' && (
          <View style={styles.buttonGrid}>
            {productsInCategory.map((product, idx) => {
              const fromConversion = productConversions.find(c => c.fromProductId === product.id);
              const toConversion = productConversions.find(c => c.toProductId === product.id);
              const hasUnits = fromConversion || toConversion;
              
              let displayName = product.name;
              if (hasUnits) {
                displayName = product.name
                  .replace(/\s*\(Whole\)\s*/gi, '')
                  .replace(/\s*\(Slice\)\s*/gi, '')
                  .replace(/\s*\(Slices\)\s*/gi, '')
                  .trim();
              }
              
              return (
                <TouchableOpacity key={product.id} style={[styles.button3D, { backgroundColor: getColorForIndex(idx), width: buttonSize, height: buttonSize }]} onPress={() => handleProductSelect(product)}>
                  <Text style={styles.buttonText}>{displayName}</Text>
                  {!hasUnits && <Text style={styles.buttonSubtext}>{product.unit}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {viewLevel === 'units' && productUnits.length > 0 && (
          <View style={styles.buttonGrid}>
            {productUnits.map((unit, idx) => (
              <TouchableOpacity key={idx} style={[styles.button3D, { backgroundColor: getColorForIndex(idx), width: buttonSize, height: buttonSize }]} onPress={() => handleUnitSelect(unit.product)}>
                <Text style={styles.buttonText}>{unit.label}</Text>
                <Text style={styles.buttonSubtext}>{unit.product.unit}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <StockInputModal
        visible={showInputModal}
        mode={mode}
        product={selectedProduct}
        onClose={() => setShowInputModal(false)}
        onSave={handleInputSave}
        selectedOutlet={selectedOutlet}
        selectedDate={selectedDate}
      />

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
            {(outlets || []).map((outlet) => (
              <TouchableOpacity
                key={outlet.id}
                style={[
                  styles.outletOption,
                  selectedOutlet === outlet.name && styles.outletOptionSelected
                ]}
                onPress={() => {
                  setSelectedOutlet?.(outlet.name);
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
                {selectedOutlet === outlet.name && (
                  <Check size={20} color={Colors.light.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showFromOutletModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFromOutletModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFromOutletModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select From Outlet</Text>
            {(outlets || []).map((outlet) => (
              <TouchableOpacity
                key={outlet.id}
                style={[
                  styles.outletOption,
                  fromOutlet === outlet.name && styles.outletOptionSelected
                ]}
                onPress={() => {
                  setFromOutlet(outlet.name);
                  setShowFromOutletModal(false);
                }}
              >
                <View style={styles.outletOptionInfo}>
                  <Text style={[
                    styles.outletOptionText,
                    fromOutlet === outlet.name && styles.outletOptionTextSelected
                  ]}>
                    {outlet.name}
                  </Text>
                  {outlet.location && (
                    <Text style={styles.outletOptionLocation}>{outlet.location}</Text>
                  )}
                </View>
                {fromOutlet === outlet.name && (
                  <Check size={20} color={Colors.light.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showToOutletModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowToOutletModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowToOutletModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select To Outlet</Text>
            {(outlets || []).map((outlet) => (
              <TouchableOpacity
                key={outlet.id}
                style={[
                  styles.outletOption,
                  toOutlet === outlet.name && styles.outletOptionSelected
                ]}
                onPress={() => {
                  setToOutlet(outlet.name);
                  setShowToOutletModal(false);
                }}
              >
                <View style={styles.outletOptionInfo}>
                  <Text style={[
                    styles.outletOptionText,
                    toOutlet === outlet.name && styles.outletOptionTextSelected
                  ]}>
                    {outlet.name}
                  </Text>
                  {outlet.location && (
                    <Text style={styles.outletOptionLocation}>{outlet.location}</Text>
                  )}
                </View>
                {toOutlet === outlet.name && (
                  <Check size={20} color={Colors.light.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <CalendarModal
        visible={showCalendar}
        initialDate={mode === 'stockCheck' ? (selectedDate || new Date().toISOString().split('T')[0]) : requestDate}
        onClose={() => setShowCalendar(false)}
        onSelect={(iso) => {
          if (mode === 'stockCheck') {
            setSelectedDate?.(iso);
          } else {
            setRequestDate(iso);
          }
          setShowCalendar(false);
        }}
        testID="calendar-button-mode"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  navigationBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  navButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  navButtonLarge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
      },
    }),
  },
  navButtonTextLarge: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
  scrollContent: {
    padding: 16,
  },
  buttonGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
    justifyContent: 'center' as const,
  },
  button3D: {
    borderRadius: 16,
    padding: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      },
    }),
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    textAlign: 'center' as const,
  },
  buttonSubtext: {
    fontSize: 11,
    color: '#FFFFFF',
    marginTop: 4,
    opacity: 0.9,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 8,
  },
  outletSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    gap: 8,
  },
  outletInfo: {
    flex: 1,
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
  },
  changeText: {
    fontSize: 12,
    color: Colors.light.tint,
    fontWeight: '600' as const,
  },
  dateSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
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
  requestTopSection: {
    flexDirection: 'row' as const,
    gap: 8,
    flex: 1,
  },
  requestOutletButton: {
    flex: 1,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  requestOutletLabel: {
    fontSize: 10,
    color: Colors.light.muted,
    marginBottom: 2,
  },
  requestOutletValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
});
