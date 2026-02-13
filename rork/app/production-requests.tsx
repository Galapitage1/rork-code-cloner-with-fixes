import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Trash2, Check, Edit2, Download } from 'lucide-react-native';
import { useProduction } from '@/contexts/ProductionContext';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useStores } from '@/contexts/StoresContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApprovedProductionItem, ProductionRequest } from '@/types';
import Colors from '@/constants/colors';
import { useRouter } from 'expo-router';

export default function ProductionRequestsScreen() {
  const { productionRequests, deleteProductionRequest, approveProductionRequest } = useProduction();
  const { products, productConversions, inventoryStocks, updateInventoryStock } = useStock();
  const { currentUser, isSuperAdmin } = useAuth();
  const { recipes } = useRecipes();
  const { storeProducts, updateStoreProduct } = useStores();
  const router = useRouter();

  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [approvingRequest, setApprovingRequest] = useState<string | null>(null);
  const [editingIngredients, setEditingIngredients] = useState<Map<string, Map<string, string>>>(new Map());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const sortedRequests = useMemo(() => {
    const pending = productionRequests.filter(r => r.status === 'pending').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const approved = productionRequests.filter(r => r.status === 'approved').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return [...pending, ...approved];
  }, [productionRequests]);

  const approvedByMonth = useMemo(() => {
    const approved = productionRequests
      .filter(r => r.status === 'approved')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const grouped: { [month: string]: { [date: string]: ProductionRequest[] } } = {};

    approved.forEach(request => {
      const date = new Date(request.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const dateKey = request.date;

      if (!grouped[monthKey]) {
        grouped[monthKey] = {};
      }

      if (!grouped[monthKey][dateKey]) {
        grouped[monthKey][dateKey] = [];
      }

      grouped[monthKey][dateKey].push(request);
    });

    return grouped;
  }, [productionRequests]);

  const toggleExpand = (requestId: string) => {
    const newExpanded = new Set(expandedRequests);
    if (newExpanded.has(requestId)) {
      newExpanded.delete(requestId);
    } else {
      newExpanded.add(requestId);
    }
    setExpandedRequests(newExpanded);
  };

  const toggleMonth = (monthKey: string) => {
    const newExpanded = new Set(expandedMonths);
    if (newExpanded.has(monthKey)) {
      newExpanded.delete(monthKey);
    } else {
      newExpanded.add(monthKey);
    }
    setExpandedMonths(newExpanded);
  };

  const toggleDate = (dateKey: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(dateKey)) {
      newExpanded.delete(dateKey);
    } else {
      newExpanded.add(dateKey);
    }
    setExpandedDates(newExpanded);
  };

  const getMonthName = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const calculateIngredients = useCallback((requestId: string) => {
    const request = productionRequests.find(r => r.id === requestId);
    if (!request) return [];

    const ingredientTotals = new Map<string, number>();

    request.items.forEach(item => {
      const recipe = recipes.find(r => r.menuProductId === item.productId);
      if (recipe) {
        recipe.components.forEach(component => {
          const current = ingredientTotals.get(component.rawProductId) || 0;
          ingredientTotals.set(component.rawProductId, current + (component.quantityPerUnit * item.quantity));
        });
      }
    });

    return Array.from(ingredientTotals.entries()).map(([rawProductId, quantity]) => {
      const rawProduct = products.find(p => p.id === rawProductId);
      return {
        rawProductId,
        rawProductName: rawProduct?.name || 'Unknown',
        quantity,
        unit: rawProduct?.unit || '',
      };
    });
  }, [productionRequests, recipes, products]);

  const getEditedQuantity = (requestId: string, rawProductId: string, originalQuantity: number): number => {
    const requestEdits = editingIngredients.get(requestId);
    if (!requestEdits) return originalQuantity;
    
    const editedValue = requestEdits.get(rawProductId);
    if (editedValue !== undefined) {
      return parseFloat(editedValue) || 0;
    }
    return originalQuantity;
  };

  const handleIngredientEdit = (requestId: string, rawProductId: string, value: string) => {
    const newEditing = new Map(editingIngredients);
    let requestEdits = newEditing.get(requestId);
    
    if (!requestEdits) {
      requestEdits = new Map();
      newEditing.set(requestId, requestEdits);
    }
    
    requestEdits.set(rawProductId, value);
    setEditingIngredients(newEditing);
  };

  const handleApprove = async (requestId: string) => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to approve requests');
      return;
    }

    const request = productionRequests.find(r => r.id === requestId);
    if (!request) return;

    const ingredients = calculateIngredients(requestId);
    const requestEdits = editingIngredients.get(requestId);

    const approvedItems: ApprovedProductionItem[] = request.items.map(item => {
      const product = products.find(p => p.id === item.productId);
      const recipe = recipes.find(r => r.menuProductId === item.productId);

      const itemIngredients = recipe ? recipe.components.map(component => {
        const rawProduct = products.find(p => p.id === component.rawProductId);
        const originalQty = component.quantityPerUnit * item.quantity;
        const editedQty = requestEdits?.get(component.rawProductId) ? parseFloat(requestEdits.get(component.rawProductId) || '0') : originalQty;
        
        const storeProduct = storeProducts.find(sp => sp.name.toLowerCase() === rawProduct?.name?.toLowerCase());
        const costPerUnit = storeProduct?.costPerUnit || 0;
        const totalCost = costPerUnit * editedQty;

        return {
          rawProductId: component.rawProductId,
          rawProductName: rawProduct?.name || 'Unknown',
          quantity: editedQty,
          costPerUnit,
          totalCost,
        };
      }) : [];
      
      const totalItemCost = itemIngredients.reduce((sum, ing) => sum + (ing.totalCost || 0), 0);

      return {
        productId: item.productId,
        productName: product?.name || 'Unknown',
        requestedQuantity: item.quantity,
        totalCost: totalItemCost,
        ingredients: itemIngredients,
      };
    });

    try {
      setIsProcessing(true);

      for (const ingredient of ingredients) {
        const editedQty = getEditedQuantity(requestId, ingredient.rawProductId, ingredient.quantity);
        const storeProduct = storeProducts.find(sp => sp.name.toLowerCase() === ingredient.rawProductName.toLowerCase());
        
        if (storeProduct) {
          const newQuantity = Math.max(0, storeProduct.quantity - editedQty);
          await updateStoreProduct(storeProduct.id, { quantity: newQuantity });
          console.log(`[ProductionRequests] Reduced ${ingredient.rawProductName} from ${storeProduct.quantity} to ${newQuantity}`);
        } else {
          console.warn(`[ProductionRequests] Store product not found: ${ingredient.rawProductName}`);
        }
      }

      for (const item of request.items) {
        const productId = item.productId;
        const approvedQty = item.quantity;
        
        const existingStock = inventoryStocks.find(s => s.productId === productId);
        if (existingStock) {
          const newProdsReqWhole = (existingStock.prodsReqWhole || 0) + approvedQty;
          await updateInventoryStock(productId, { prodsReqWhole: newProdsReqWhole });
          console.log(`[ProductionRequests] Added ${approvedQty} to ${productId} Prods.Req (${existingStock.prodsReqWhole} → ${newProdsReqWhole})`);
        } else {
          await updateInventoryStock(productId, {
            prodsReqWhole: approvedQty,
            prodsReqSlices: 0,
          });
          console.log(`[ProductionRequests] Created inventory stock for ${productId} with Prods.Req: ${approvedQty}`);
        }
      }

      const approvalDate = new Date().toISOString().split('T')[0];
      
      const approval = {
        id: `prod-approval-${Date.now()}`,
        requestId: request.id,
        date: request.date,
        requestedBy: request.requestedBy,
        items: approvedItems,
        approvalDate,
        approvedAt: Date.now(),
        approvedBy: currentUser.username || currentUser.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await approveProductionRequest(approval);

      Alert.alert('Success', 'Production request approved successfully');
      setApprovingRequest(null);
      setShowApproveConfirm(null);
    } catch (error) {
      console.error('[ProductionRequests] Failed to approve request:', error);
      Alert.alert('Error', 'Failed to approve production request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (requestId: string) => {
    try {
      setIsProcessing(true);
      await deleteProductionRequest(requestId);
      Alert.alert('Success', 'Production request deleted');
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('[ProductionRequests] Failed to delete request:', error);
      Alert.alert('Error', 'Failed to delete production request');
    } finally {
      setIsProcessing(false);
    }
  };

  const pendingRequests = useMemo(() => 
    productionRequests.filter(r => r.status === 'pending').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [productionRequests]
  );

  const handleExportMonth = async (monthKey: string, requests: any[]) => {
    try {
      console.log('[ProductionRequests] Exporting month:', monthKey);
      
      if (requests.length === 0) {
        Alert.alert('No Data', 'No approved production requests for this month');
        return;
      }

      const { exportProductionToExcel } = await import('@/utils/excelExporter');
      await exportProductionToExcel(monthKey, requests, products, recipes, storeProducts);
      
      Alert.alert('Success', 'Report downloaded successfully');
    } catch (error) {
      console.error('[ProductionRequests] Export failed:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to generate report');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {productionRequests.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No production requests</Text>
          </View>
        ) : (
          <>
            {pendingRequests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>Pending Requests</Text>
                {pendingRequests.map((request) => {
            const isExpanded = expandedRequests.has(request.id);
            const isApproving = approvingRequest === request.id;
            const ingredients = isExpanded || isApproving ? calculateIngredients(request.id) : [];

                  return (
                    <View key={request.id} style={styles.requestCard}>
                      <View style={styles.requestHeader}>
                        <View style={styles.requestHeaderLeft}>
                          <Text style={styles.requestDate}>{request.date}</Text>
                          <Text style={styles.requestedBy}>By: {request.requestedBy}</Text>
                          <View style={styles.statusBadge}>
                            <Text style={styles.statusText}>PENDING</Text>
                          </View>
                        </View>

                        <View style={styles.requestHeaderRight}>
                          {!isApproving && (
                            <TouchableOpacity
                              style={styles.approveButton}
                              onPress={() => setApprovingRequest(request.id)}
                            >
                              <Check size={18} color="#fff" />
                            </TouchableOpacity>
                          )}
                          {isSuperAdmin && (
                            <TouchableOpacity
                              style={styles.deleteButton}
                              onPress={() => setShowDeleteConfirm(request.id)}
                            >
                              <Trash2 size={18} color="#fff" />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={styles.expandButton}
                            onPress={() => toggleExpand(request.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown size={20} color={Colors.light.tint} />
                            ) : (
                              <ChevronRight size={20} color={Colors.light.tint} />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>

                      {isExpanded && (
                        <View style={styles.requestDetails}>
                          <Text style={styles.sectionTitle}>Products:</Text>
                          {request.items.map((item, idx) => {
                            const product = products.find(p => p.id === item.productId);
                            return (
                              <View key={idx} style={styles.productItem}>
                                <Text style={styles.productItemName}>{product?.name || 'Unknown'}</Text>
                                <Text style={styles.productItemQty}>{item.quantity} {product?.unit}</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}

                      {isApproving && (
                        <View style={styles.approvalSection}>
                          <Text style={styles.sectionTitle}>Ingredients (Editable):</Text>
                          {ingredients.map((ingredient, idx) => {
                            const editedQty = getEditedQuantity(request.id, ingredient.rawProductId, ingredient.quantity);
                            return (
                              <View key={idx} style={styles.ingredientRow}>
                                <View style={styles.ingredientInfo}>
                                  <Text style={styles.ingredientName}>{ingredient.rawProductName}</Text>
                                </View>
                                <View style={styles.ingredientInput}>
                                  <TextInput
                                    style={styles.quantityInput}
                                    value={editingIngredients.get(request.id)?.get(ingredient.rawProductId) || String(ingredient.quantity)}
                                    onChangeText={(value) => handleIngredientEdit(request.id, ingredient.rawProductId, value)}
                                    keyboardType="numeric"
                                  />
                                  <Text style={styles.unitText}>{ingredient.unit}</Text>
                                </View>
                              </View>
                            );
                          })}

                          <View style={styles.approvalButtons}>
                            <TouchableOpacity
                              style={styles.cancelButton}
                              onPress={() => {
                                setApprovingRequest(null);
                                const newEditing = new Map(editingIngredients);
                                newEditing.delete(request.id);
                                setEditingIngredients(newEditing);
                              }}
                            >
                              <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.confirmApproveButton}
                              onPress={() => setShowApproveConfirm(request.id)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.confirmApproveButtonText}>Approve</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {Object.keys(approvedByMonth).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>Approved Requests</Text>
                {Object.entries(approvedByMonth)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([monthKey, dateGroups]) => {
                    const isMonthExpanded = expandedMonths.has(monthKey);
                    const monthRequests = Object.values(dateGroups).flat();
                    return (
                      <View key={monthKey} style={styles.monthGroup}>
                        <View style={styles.monthHeaderContainer}>
                          <TouchableOpacity
                            style={styles.monthHeader}
                            onPress={() => toggleMonth(monthKey)}
                          >
                            <Text style={styles.monthHeaderText}>{getMonthName(monthKey)}</Text>
                            {isMonthExpanded ? (
                              <ChevronDown size={20} color={Colors.light.tint} />
                            ) : (
                              <ChevronRight size={20} color={Colors.light.tint} />
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.downloadButton}
                            onPress={() => handleExportMonth(monthKey, monthRequests)}
                          >
                            <Download size={18} color="#fff" />
                          </TouchableOpacity>
                        </View>

                        {isMonthExpanded && (
                          <View style={styles.dateGroupsContainer}>
                            {Object.entries(dateGroups)
                              .sort(([a], [b]) => b.localeCompare(a))
                              .map(([dateKey, requests]) => {
                                const isDateExpanded = expandedDates.has(dateKey);
                                return (
                                  <View key={dateKey} style={styles.dateGroup}>
                                    <TouchableOpacity
                                      style={styles.dateHeader}
                                      onPress={() => toggleDate(dateKey)}
                                    >
                                      <View style={styles.dateHeaderLeft}>
                                        <Text style={styles.dateHeaderText}>{dateKey}</Text>
                                        <Text style={styles.dateHeaderCount}>({requests.length} request{requests.length !== 1 ? 's' : ''})</Text>
                                      </View>
                                      {isDateExpanded ? (
                                        <ChevronDown size={18} color={Colors.light.tabIconDefault} />
                                      ) : (
                                        <ChevronRight size={18} color={Colors.light.tabIconDefault} />
                                      )}
                                    </TouchableOpacity>

                                    {isDateExpanded && (
                                      <View style={styles.requestsList}>
                                        {requests.map((request) => {
                                          const isExpanded = expandedRequests.has(request.id);
                                          const ingredients = isExpanded ? calculateIngredients(request.id) : [];

                                          return (
                                            <View key={request.id} style={styles.requestCard}>
                                              <View style={styles.requestHeader}>
                                                <View style={styles.requestHeaderLeft}>
                                                  <Text style={styles.requestedBy}>By: {request.requestedBy}</Text>
                                                  <View style={styles.statusBadgeApproved}>
                                                    <Text style={styles.statusTextApproved}>APPROVED</Text>
                                                  </View>
                                                </View>

                                                <View style={styles.requestHeaderRight}>
                                                  <TouchableOpacity
                                                    style={styles.expandButton}
                                                    onPress={() => toggleExpand(request.id)}
                                                  >
                                                    {isExpanded ? (
                                                      <ChevronDown size={20} color={Colors.light.tint} />
                                                    ) : (
                                                      <ChevronRight size={20} color={Colors.light.tint} />
                                                    )}
                                                  </TouchableOpacity>
                                                </View>
                                              </View>

                                              {isExpanded && (
                                                <View style={styles.requestDetails}>
                                                  <Text style={styles.sectionTitle}>Products:</Text>
                                                  {request.items.map((item: any, idx: number) => {
                                                    const product = products.find(p => p.id === item.productId);
                                                    return (
                                                      <View key={idx} style={styles.productItem}>
                                                        <Text style={styles.productItemName}>{product?.name || 'Unknown'}</Text>
                                                        <Text style={styles.productItemQty}>{item.quantity} {product?.unit}</Text>
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
                  })}
              </View>
            )}
          </>
        )}

        <View style={styles.spacer} />
      </ScrollView>

      <ConfirmDialog
        visible={showDeleteConfirm !== null}
        title="Delete Request"
        message="Are you sure you want to delete this production request?"
        onConfirm={() => {
          if (showDeleteConfirm) {
            handleDelete(showDeleteConfirm);
          }
        }}
        onCancel={() => setShowDeleteConfirm(null)}
      />

      <ConfirmDialog
        visible={showApproveConfirm !== null}
        title="Approve Request"
        message="Are you sure you want to approve this production request? This will update inventory and reduce ingredient quantities from stores."
        onConfirm={() => {
          if (showApproveConfirm) {
            handleApprove(showApproveConfirm);
          }
        }}
        onCancel={() => setShowApproveConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scrollView: {
    flex: 1,
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
  section: {
    marginTop: 8,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.light.background,
  },
  monthGroup: {
    marginBottom: 8,
  },
  monthHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  monthHeaderText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  dateGroupsContainer: {
    backgroundColor: Colors.light.background,
  },
  dateGroup: {
    marginBottom: 8,
  },
  dateHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  dateHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  dateHeaderText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.text,
  },
  dateHeaderCount: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  requestsList: {
    paddingLeft: 8,
  },
  requestCard: {
    backgroundColor: Colors.light.card,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  requestHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
  },
  requestHeaderLeft: {
    flex: 1,
  },
  requestDate: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  requestedBy: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    marginBottom: 8,
  },
  statusBadge: {
    backgroundColor: '#FFA500',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start' as const,
  },
  statusBadgeApproved: {
    backgroundColor: '#4CAF50',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#fff',
  },
  statusTextApproved: {
    color: '#fff',
  },
  requestHeaderRight: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'center' as const,
  },
  approveButton: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  deleteButton: {
    backgroundColor: '#f44336',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  expandButton: {
    width: 36,
    height: 36,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  requestDetails: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  productItem: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    marginBottom: 8,
  },
  productItemName: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  productItemQty: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  approvalSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  ingredientRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    marginBottom: 8,
  },
  ingredientInfo: {
    flex: 1,
    marginRight: 12,
  },
  ingredientName: {
    fontSize: 14,
    color: Colors.light.text,
  },
  ingredientInput: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  quantityInput: {
    width: 80,
    height: 40,
    backgroundColor: Colors.light.card,
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
  approvalButtons: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  confirmApproveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    alignItems: 'center' as const,
  },
  confirmApproveButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  spacer: {
    height: 100,
  },
  monthHeaderContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  downloadButton: {
    backgroundColor: Colors.light.tint,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: 12,
  },
});
