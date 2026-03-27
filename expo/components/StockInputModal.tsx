import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Product } from '@/types';
import { useStock } from '@/contexts/StockContext';

type StockCheckInputs = {
  openingStock: string;
  receivedStock: string;
  wastage: string;
  currentStock: string;
  comments: string;
};

type RequestInputs = {
  quantity: string;
  priority: 'low' | 'medium' | 'high';
  comments: string;
};

type StockInputModalProps = {
  visible: boolean;
  mode: 'stockCheck' | 'request';
  product: Product | null;
  onClose: () => void;
  onSave: (data: StockCheckInputs | RequestInputs) => void;
  isSaving?: boolean;
  selectedOutlet?: string;
  selectedDate?: string;
};

export function StockInputModal({ visible, mode, product, onClose, onSave, isSaving, selectedOutlet, selectedDate }: StockInputModalProps) {
  const { inventoryStocks, outlets, productConversions, products, stockChecks, requests } = useStock();
  const [openingStock, setOpeningStock] = useState<string>('');
  const [receivedStock, setReceivedStock] = useState<string>('');
  const [wastage, setWastage] = useState<string>('');
  const [comments, setComments] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);

  const currentStock = mode === 'stockCheck' 
    ? String(
        (parseFloat(openingStock) || 0) + 
        (parseFloat(receivedStock) || 0) - 
        (parseFloat(wastage) || 0)
      )
    : '0';

  const handleSave = () => {
    if (mode === 'stockCheck') {
      onSave({
        openingStock,
        receivedStock,
        wastage,
        currentStock,
        comments,
      });
    } else {
      onSave({
        quantity,
        priority,
        comments,
      });
    }
    
    setOpeningStock('');
    setReceivedStock('');
    setWastage('');
    setComments('');
    setQuantity('');
    setPriority('medium');
  };

  useEffect(() => {
    if (visible && mode === 'stockCheck' && product && selectedOutlet && !hasLoaded) {
      console.log('StockInputModal: Auto-loading opening stock for product:', product.name, 'outlet:', selectedOutlet);
      
      const outlet = outlets.find(o => o.name === selectedOutlet);
      if (!outlet) {
        console.log('StockInputModal: Outlet not found');
        setHasLoaded(true);
        return;
      }

      const getProductPairForInventory = (productId: string) => {
        const fromConversion = productConversions.find(c => c.fromProductId === productId);
        const toConversion = productConversions.find(c => c.toProductId === productId);
        
        if (fromConversion) {
          return { wholeProductId: productId, slicesProductId: fromConversion.toProductId };
        }
        if (toConversion) {
          return { wholeProductId: toConversion.fromProductId, slicesProductId: productId };
        }
        return null;
      };

      if (outlet.outletType === 'production') {
        const invStock = inventoryStocks.find(s => s.productId === product.id);
        if (invStock && invStock.productionWhole > 0) {
          console.log('StockInputModal: Found production stock:', invStock.productionWhole);
          setOpeningStock(String(invStock.productionWhole));
        } else {
          const productPair = getProductPairForInventory(product.id);
          if (productPair) {
            const invStockPair = inventoryStocks.find(s => s.productId === productPair.wholeProductId);
            if (invStockPair) {
              if (product.id === productPair.wholeProductId && invStockPair.productionWhole > 0) {
                console.log('StockInputModal: Found whole product stock:', invStockPair.productionWhole);
                setOpeningStock(String(invStockPair.productionWhole));
              } else if (product.id === productPair.slicesProductId && invStockPair.productionSlices > 0) {
                console.log('StockInputModal: Found slices product stock:', invStockPair.productionSlices);
                setOpeningStock(String(invStockPair.productionSlices));
              }
            }
          }
          
          const hasConversion = productConversions.some(
            c => c.fromProductId === product.id || c.toProductId === product.id
          );
          
          if (!hasConversion) {
            const productionOutletNames = outlets
              .filter(o => o.outletType === 'production')
              .map(o => o.name);
            
            let totalQty = 0;
            stockChecks.forEach(check => {
              if (!check.outlet || !productionOutletNames.includes(check.outlet)) return;
              
              check.counts.forEach(count => {
                if (count.productId !== product.id) return;
                
                const receivedStock = count.receivedStock || 0;
                const wastage = count.wastage || 0;
                const netStock = receivedStock - wastage;
                if (netStock > 0) {
                  totalQty += netStock;
                }
              });
            });
            
            const approvedRequestsForOutlet = requests.filter(
              req => req.status === 'approved' && req.toOutlet === selectedOutlet && req.productId === product.id
            );
            
            approvedRequestsForOutlet.forEach(req => {
              totalQty += req.quantity;
            });
            
            if (totalQty > 0) {
              console.log('StockInputModal: Found production stock (other units):', totalQty);
              setOpeningStock(String(totalQty));
            }
          }
        }
      } else if (outlet.outletType === 'sales') {
        const productPair = getProductPairForInventory(product.id);
        if (productPair) {
          const invStock = inventoryStocks.find(s => s.productId === productPair.wholeProductId);
          if (invStock) {
            const outletStock = invStock.outletStocks.find(os => os.outletName === selectedOutlet);
            if (outletStock) {
              if (product.id === productPair.wholeProductId && outletStock.whole > 0) {
                console.log('StockInputModal: Found sales outlet whole stock:', outletStock.whole);
                setOpeningStock(String(outletStock.whole));
              } else if (product.id === productPair.slicesProductId && outletStock.slices > 0) {
                console.log('StockInputModal: Found sales outlet slices stock:', outletStock.slices);
                setOpeningStock(String(outletStock.slices));
              }
            }
          }
        }
        
        const hasConversion = productConversions.some(
          c => c.fromProductId === product.id || c.toProductId === product.id
        );
        
        if (!hasConversion) {
          const approvedRequestsForOutlet = requests.filter(
            req => req.status === 'approved' && req.toOutlet === selectedOutlet && req.productId === product.id
          );
          
          let totalQty = 0;
          approvedRequestsForOutlet.forEach(req => {
            totalQty += req.quantity;
          });
          
          if (totalQty > 0) {
            console.log('StockInputModal: Found approved request stock:', totalQty);
            setOpeningStock(String(totalQty));
          }
        }
      }
      
      setHasLoaded(true);
    }
  }, [visible, mode, product, selectedOutlet, hasLoaded, outlets, inventoryStocks, productConversions, products, stockChecks, requests]);

  const handleClose = () => {
    setOpeningStock('');
    setReceivedStock('');
    setWastage('');
    setComments('');
    setQuantity('');
    setPriority('medium');
    setHasLoaded(false);
    onClose();
  };

  const getPriorityColor = (p: 'low' | 'medium' | 'high') => {
    switch (p) {
      case 'high': return Colors.light.danger;
      case 'medium': return Colors.light.warning;
      case 'low': return Colors.light.success;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>
                {mode === 'stockCheck' ? 'Stock Check' : 'Request'}
              </Text>
              {product && (
                <Text style={styles.modalSubtitle}>
                  {product.name} ({product.unit})
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X size={24} color={Colors.light.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {mode === 'stockCheck' ? (
              <>
                <Text style={styles.label}>Closing Stock</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  value={openingStock}
                  onChangeText={setOpeningStock}
                  placeholderTextColor={Colors.light.muted}
                />

                <Text style={styles.label}>Received</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  value={receivedStock}
                  onChangeText={setReceivedStock}
                  placeholderTextColor={Colors.light.muted}
                />

                <Text style={styles.label}>Wastage</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  value={wastage}
                  onChangeText={setWastage}
                  placeholderTextColor={Colors.light.muted}
                />

                <Text style={styles.label}>Current Stock (Auto-calculated)</Text>
                <View style={styles.currentStockDisplay}>
                  <Text style={styles.currentStockText}>{currentStock}</Text>
                </View>

                <Text style={styles.label}>Comments (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.commentsInput]}
                  placeholder="Add comments..."
                  multiline
                  numberOfLines={3}
                  value={comments}
                  onChangeText={setComments}
                  placeholderTextColor={Colors.light.muted}
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>Quantity</Text>
                <TextInput
                  style={styles.input}
                  placeholder={product ? `Enter quantity in ${product.unit}` : '0'}
                  keyboardType="decimal-pad"
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholderTextColor={Colors.light.muted}
                />

                <Text style={styles.label}>Priority</Text>
                <View style={styles.priorityContainer}>
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

                <Text style={styles.label}>Comments (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.commentsInput]}
                  placeholder="Add comments..."
                  multiline
                  numberOfLines={3}
                  value={comments}
                  onChangeText={setComments}
                  placeholderTextColor={Colors.light.muted}
                />
              </>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={Colors.light.card} />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end' as const,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalSubtitle: {
    fontSize: 16,
    color: Colors.light.muted,
    marginTop: 4,
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 12,
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
  commentsInput: {
    height: 80,
    textAlignVertical: 'top' as const,
  },
  currentStockDisplay: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  currentStockText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  priorityContainer: {
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
  saveButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center' as const,
    marginTop: 16,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.card,
  },
});
