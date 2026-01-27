import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Platform, ActivityIndicator, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useState, useCallback, useEffect } from 'react';
import { useStock } from '@/contexts/StockContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useStores } from '@/contexts/StoresContext';
import Colors from '@/constants/colors';
import { Plus, Save, X, Upload, AlertCircle } from 'lucide-react-native';
import { RecipeComponent, Recipe } from '@/types';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { parseRecipeExcelFile, UnmatchedItem, PendingIngredient } from '@/utils/recipeExcelParser';
import { VoiceSearchInput } from '@/components/VoiceSearchInput';
import { formatCurrency } from '@/utils/currencyHelper';

export default function RecipesScreen() {
  const { isAdmin, currency } = useAuth();
  const { products, productConversions } = useStock();
  const { recipes, addOrUpdateRecipe, getRecipeFor } = useRecipes();
  const { storeProducts } = useStores();

  const menuItems = useMemo(() => products.filter(p => p.type === 'menu'), [products]);
  const rawItems = useMemo(() => products.filter(p => p.type === 'raw'), [products]);
  const [search, setSearch] = useState<string>('');
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [rawMaterialSearch, setRawMaterialSearch] = useState<string>('');
  const [showEditor, setShowEditor] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showImportResults, setShowImportResults] = useState<boolean>(false);
  const [importResults, setImportResults] = useState<{ success: number; warnings: string[]; errors: string[] }>({ success: 0, warnings: [], errors: [] });
  
  // Product matching state
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedItem[]>([]);
  const [currentUnmatchedIndex, setCurrentUnmatchedIndex] = useState<number>(0);
  const [showMatchingModal, setShowMatchingModal] = useState<boolean>(false);
  const [showManualSelection, setShowManualSelection] = useState<boolean>(false);
  const [manualSearchQuery, setManualSearchQuery] = useState<string>('');
  const [pendingRecipes, setPendingRecipes] = useState<Recipe[]>([]);
  const [resolvedIngredients, setResolvedIngredients] = useState<Map<string, { productId: string; quantity: number; forProductId: string }>>(new Map());
  const [resolvedMenuProducts, setResolvedMenuProducts] = useState<Map<string, { menuProductId: string; pendingIngredients: PendingIngredient[] }>>(new Map());
  const [parsedBase64Data, setParsedBase64Data] = useState<string>('');
  const [savedMatches, setSavedMatches] = useState<Record<string, string>>({});
  const [modalExpanded, setModalExpanded] = useState<boolean>(false);

  const SAVED_MATCHES_KEY = '@recipe_import_saved_matches';
  const MODAL_EXPANDED_KEY = '@recipe_import_modal_expanded';

  useEffect(() => {
    const loadSavedPreferences = async () => {
      try {
        const [matchesStr, expandedStr] = await Promise.all([
          AsyncStorage.getItem(SAVED_MATCHES_KEY),
          AsyncStorage.getItem(MODAL_EXPANDED_KEY),
        ]);
        if (matchesStr) {
          setSavedMatches(JSON.parse(matchesStr));
        }
        if (expandedStr) {
          setModalExpanded(JSON.parse(expandedStr));
        }
      } catch (e) {
        console.log('[Recipes] Failed to load saved preferences:', e);
      }
    };
    loadSavedPreferences();
  }, []);

  const saveMatchPreference = useCallback(async (originalName: string, type: 'menu' | 'ingredient', selectedProductId: string) => {
    const key = `${type}:${originalName.toLowerCase()}`;
    const updated = { ...savedMatches, [key]: selectedProductId };
    setSavedMatches(updated);
    try {
      await AsyncStorage.setItem(SAVED_MATCHES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.log('[Recipes] Failed to save match preference:', e);
    }
  }, [savedMatches]);

  const toggleModalExpanded = useCallback(async () => {
    const newValue = !modalExpanded;
    setModalExpanded(newValue);
    try {
      await AsyncStorage.setItem(MODAL_EXPANDED_KEY, JSON.stringify(newValue));
    } catch (e) {
      console.log('[Recipes] Failed to save modal expanded preference:', e);
    }
  }, [modalExpanded]);

  const getSavedMatch = useCallback((originalName: string, type: 'menu' | 'ingredient'): string | null => {
    const key = `${type}:${originalName.toLowerCase()}`;
    return savedMatches[key] || null;
  }, [savedMatches]);

  const calculateProductCost = useCallback((menuProductId: string): number | null => {
    const recipe = recipes.find(r => r.menuProductId === menuProductId);
    if (!recipe || recipe.components.length === 0) {
      return null;
    }
    
    let totalCost = 0;
    let hasSomeCosts = false;
    
    const menuProduct = menuItems.find(m => m.id === menuProductId);
    if (menuProduct) {
      console.log(`\n[Recipes] ========== Calculating cost for "${menuProduct.name}" ==========`);
      console.log(`[Recipes] Recipe has ${recipe.components.length} components`);
      console.log(`[Recipes] Store products available: ${storeProducts.length}`);
    }
    
    for (let i = 0; i < recipe.components.length; i++) {
      const component = recipe.components[i];
      const rawProduct = rawItems.find(p => p.id === component.rawProductId);
      
      if (!rawProduct) {
        console.log(`[Recipes] [${i+1}/${recipe.components.length}] ❌ Raw product not found: ${component.rawProductId}`);
        continue;
      }
      
      console.log(`[Recipes] [${i+1}/${recipe.components.length}] Looking for: "${rawProduct.name}" (${rawProduct.unit})`);
      
      const normalizeUnit = (unit: string): string => {
        const normalized = unit.toLowerCase().trim();
        return normalized.replace(/^1/, '').trim();
      };
      
      const storeProduct = storeProducts.find(sp => {
        const nameMatch = sp.name.toLowerCase().trim() === rawProduct.name.toLowerCase().trim();
        const recipeUnit = normalizeUnit(rawProduct.unit);
        const storeUnit = normalizeUnit(sp.unit);
        const unitMatch = recipeUnit === storeUnit;
        if (nameMatch || sp.name.toLowerCase().includes(rawProduct.name.toLowerCase())) {
          console.log(`[Recipes]    Comparing with: "${sp.name}" (${sp.unit}) - nameMatch: ${nameMatch}, unitMatch: ${unitMatch} (recipe: ${recipeUnit}, store: ${storeUnit}), costPerUnit: ${sp.costPerUnit}`);
        }
        return nameMatch && unitMatch;
      });
      
      if (storeProduct && storeProduct.costPerUnit !== undefined && storeProduct.costPerUnit !== null) {
        const componentCost = component.quantityPerUnit * storeProduct.costPerUnit;
        totalCost += componentCost;
        hasSomeCosts = true;
        console.log(`[Recipes] [${i+1}/${recipe.components.length}] ✓ ${rawProduct.name}: ${component.quantityPerUnit} × ${storeProduct.costPerUnit} = ${componentCost.toFixed(2)} (Running total: ${totalCost.toFixed(2)})`);
      } else {
        console.log(`[Recipes] [${i+1}/${recipe.components.length}] ⚠️  No cost for "${rawProduct.name}" (${rawProduct.unit}) - Store product ${storeProduct ? 'found but no cost' : 'not found'}`);
      }
    }
    
    console.log(`[Recipes] ========== FINAL TOTAL: ${hasSomeCosts ? totalCost.toFixed(2) : 'N/A'} ==========\n`);
    return hasSomeCosts ? totalCost : null;
  }, [recipes, rawItems, storeProducts, menuItems]);

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? menuItems.filter(m => m.name.toLowerCase().includes(q)) : menuItems;
    return filtered.sort((a, b) => {
      const typeA = a.type || '';
      const typeB = b.type || '';
      const catA = a.category || 'Uncategorized';
      const catB = b.category || 'Uncategorized';
      
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      if (catA !== catB) return catA.localeCompare(catB);
      return a.name.localeCompare(b.name);
    });
  }, [menuItems, search]);

  const groupedMenu = useMemo(() => {
    const groups: Record<string, Record<string, typeof menuItems>> = {};
    
    filteredMenu.forEach(item => {
      const type = item.type || 'Unknown';
      const category = item.category || 'Uncategorized';
      
      if (!groups[type]) groups[type] = {};
      if (!groups[type][category]) groups[type][category] = [];
      groups[type][category].push(item);
    });
    
    return groups;
  }, [filteredMenu]);

  const openEditor = (menuId: string) => {
    setEditingMenuId(menuId);
    const existing = getRecipeFor(menuId);
    setComponents(existing ? existing.components.map(c => ({ ...c })) : []);
    setRawMaterialSearch('');
    setShowEditor(true);
  };

  const addComponentRow = (rawProductId?: string) => {
    const productId = rawProductId || rawItems[0]?.id || '';
    setComponents(prev => [...prev, { rawProductId: productId, quantityPerUnit: 0 }]);
    setRawMaterialSearch('');
  };

  const updateComponent = (idx: number, patch: Partial<RecipeComponent>) => {
    setComponents(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  const removeComponent = (idx: number) => {
    setComponents(prev => prev.filter((_, i) => i !== idx));
  };

  const saveRecipe = async () => {
    if (!editingMenuId) return;
    const cleaned = components.filter(c => c.rawProductId && Number.isFinite(c.quantityPerUnit) && c.quantityPerUnit > 0);
    const r: Recipe = { id: `rcp-${editingMenuId}`, menuProductId: editingMenuId, components: cleaned, updatedAt: Date.now() };
    await addOrUpdateRecipe(r);
    setShowEditor(false);
    setEditingMenuId(null);
    setComponents([]);
  };

  const handleImport = async () => {
    try {
      setIsImporting(true);
      
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'web' 
          ? ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
          : ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsImporting(false);
        return;
      }

      const file = result.assets[0];
      let base64Data: string;

      if (Platform.OS === 'web') {
        if (file.file) {
          const reader = new FileReader();
          base64Data = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file.file as Blob);
          });
        } else {
          throw new Error('No file selected');
        }
      } else {
        base64Data = await FileSystem.readAsStringAsync(file.uri, {
          encoding: 'base64',
        });
      }

      const parsed = parseRecipeExcelFile(base64Data, products, productConversions, recipes);
      
      if (parsed.errors.length > 0) {
        setImportResults({ success: 0, warnings: parsed.warnings, errors: parsed.errors });
        setShowImportResults(true);
        setIsImporting(false);
        return;
      }

      // Store pending recipes and base64 data for re-parsing after menu resolution
      setPendingRecipes(parsed.recipes);
      setParsedBase64Data(base64Data);
      
      // Sort unmatched items: menu products first, then ingredients
      const sortedUnmatched = [
        ...parsed.unmatchedItems.filter(u => u.type === 'menu'),
        ...parsed.unmatchedItems.filter(u => u.type === 'ingredient'),
      ];
      
      // Check if there are unmatched items that need resolution
      if (sortedUnmatched.length > 0) {
        setUnmatchedItems(sortedUnmatched);
        setCurrentUnmatchedIndex(0);
        setResolvedIngredients(new Map());
        setResolvedMenuProducts(new Map());
        setShowMatchingModal(true);
        setIsImporting(false);
        return;
      }

      // No unmatched items, proceed with import
      let successCount = 0;
      for (const recipe of parsed.recipes) {
        await addOrUpdateRecipe(recipe);
        successCount++;
      }

      setImportResults({ success: successCount, warnings: parsed.warnings, errors: [] });
      setShowImportResults(true);
      setIsImporting(false);

    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Import Error', error instanceof Error ? error.message : 'Failed to import recipes');
      setIsImporting(false);
    }
  };

  const handleMatchSelection = async (selectedProductId: string | null) => {
    const currentItem = unmatchedItems[currentUnmatchedIndex];
    
    if (currentItem.type === 'menu') {
      // Handle menu product matching
      if (selectedProductId) {
        const key = currentItem.originalName.toLowerCase();
        setResolvedMenuProducts(prev => {
          const newMap = new Map(prev);
          newMap.set(key, {
            menuProductId: selectedProductId,
            pendingIngredients: currentItem.pendingIngredients || [],
          });
          return newMap;
        });
        // Save the match for future imports
        saveMatchPreference(currentItem.originalName, 'menu', selectedProductId);
        console.log(`[Recipes] Menu product "${currentItem.originalName}" matched to product ID: ${selectedProductId}`);
      } else {
        console.log(`[Recipes] Menu product "${currentItem.originalName}" skipped`);
      }
    } else if (currentItem.type === 'ingredient') {
      // Handle ingredient matching
      if (selectedProductId && currentItem.forProductId && currentItem.quantity) {
        const key = `${currentItem.forProductId}-${currentItem.originalName}-${currentItem.originalUnit}`;
        setResolvedIngredients(prev => {
          const newMap = new Map(prev);
          newMap.set(key, {
            productId: selectedProductId,
            quantity: currentItem.quantity!,
            forProductId: currentItem.forProductId!,
          });
          return newMap;
        });
        // Save the match for future imports
        saveMatchPreference(currentItem.originalName, 'ingredient', selectedProductId);
        console.log(`[Recipes] Ingredient "${currentItem.originalName}" matched to product ID: ${selectedProductId}`);
      } else {
        console.log(`[Recipes] Ingredient "${currentItem.originalName}" skipped`);
      }
    }
    
    // Move to next unmatched item or finish
    if (currentUnmatchedIndex < unmatchedItems.length - 1) {
      setCurrentUnmatchedIndex(prev => prev + 1);
      setShowManualSelection(false);
      setManualSearchQuery('');
    } else {
      // All items resolved, finalize import
      await finalizeImport();
    }
  };

  const finalizeImport = async () => {
    try {
      setShowMatchingModal(false);
      setIsImporting(true);
      
      // Apply resolved ingredients to recipes
      const finalRecipes = [...pendingRecipes];
      
      // First, process resolved menu products and their pending ingredients
      resolvedMenuProducts.forEach((resolved, _key) => {
        const menuProductId = resolved.menuProductId;
        const matchedMenuProduct = products.find(p => p.id === menuProductId);
        
        if (!matchedMenuProduct) {
          console.log(`[Recipes] Could not find menu product with ID: ${menuProductId}`);
          return;
        }
        
        // Process pending ingredients for this menu product
        resolved.pendingIngredients.forEach(pending => {
          // Try to match the ingredient
          const matchedRaw = rawItems.find(p => 
            p.name.toLowerCase() === pending.ingredientName.toLowerCase()
          ) || rawItems.find(p => 
            p.name.toLowerCase().includes(pending.ingredientName.toLowerCase()) ||
            pending.ingredientName.toLowerCase().includes(p.name.toLowerCase())
          );
          
          if (matchedRaw) {
            const existingRecipe = finalRecipes.find(r => r.menuProductId === menuProductId);
            if (existingRecipe) {
              const existingComponent = existingRecipe.components.find(c => c.rawProductId === matchedRaw.id);
              if (!existingComponent) {
                existingRecipe.components.push({
                  rawProductId: matchedRaw.id,
                  quantityPerUnit: pending.quantity,
                });
              }
            } else {
              finalRecipes.push({
                id: `rcp-${menuProductId}`,
                menuProductId: menuProductId,
                components: [{
                  rawProductId: matchedRaw.id,
                  quantityPerUnit: pending.quantity,
                }],
                updatedAt: Date.now(),
              });
            }
            console.log(`[Recipes] Added ingredient "${pending.ingredientName}" to menu product "${matchedMenuProduct.name}"`);
          } else {
            console.log(`[Recipes] Could not match ingredient "${pending.ingredientName}" for menu product "${matchedMenuProduct.name}"`);
          }
        });
      });
      
      // Then, process resolved ingredients (for already matched menu products)
      resolvedIngredients.forEach((resolved, _key) => {
        const existingRecipe = finalRecipes.find(r => r.menuProductId === resolved.forProductId);
        if (existingRecipe) {
          const existingComponent = existingRecipe.components.find(c => c.rawProductId === resolved.productId);
          if (!existingComponent) {
            existingRecipe.components.push({
              rawProductId: resolved.productId,
              quantityPerUnit: resolved.quantity,
            });
          }
        } else {
          finalRecipes.push({
            id: `rcp-${resolved.forProductId}`,
            menuProductId: resolved.forProductId,
            components: [{
              rawProductId: resolved.productId,
              quantityPerUnit: resolved.quantity,
            }],
            updatedAt: Date.now(),
          });
        }
      });
      
      let successCount = 0;
      for (const recipe of finalRecipes) {
        await addOrUpdateRecipe(recipe);
        successCount++;
      }
      
      const menuSkipped = unmatchedItems.filter(u => u.type === 'menu').length - resolvedMenuProducts.size;
      const ingredientSkipped = unmatchedItems.filter(u => u.type === 'ingredient').length - resolvedIngredients.size;
      const warnings: string[] = [];
      if (menuSkipped > 0) {
        warnings.push(`${menuSkipped} menu product(s) were skipped`);
      }
      if (ingredientSkipped > 0) {
        warnings.push(`${ingredientSkipped} ingredient(s) were skipped`);
      }
      
      setImportResults({ success: successCount, warnings, errors: [] });
      setShowImportResults(true);
      setIsImporting(false);
      
      // Reset state
      setUnmatchedItems([]);
      setCurrentUnmatchedIndex(0);
      setResolvedIngredients(new Map());
      setResolvedMenuProducts(new Map());
      setPendingRecipes([]);
      setParsedBase64Data('');
    } catch (error) {
      console.error('Finalize import error:', error);
      Alert.alert('Import Error', error instanceof Error ? error.message : 'Failed to finalize import');
      setIsImporting(false);
    }
  };

  const currentUnmatched = unmatchedItems[currentUnmatchedIndex];
  const filteredProductsForManual = useMemo(() => {
    if (!showManualSelection || !currentUnmatched) return [];
    const targetProducts = currentUnmatched.type === 'menu' ? menuItems : rawItems;
    if (!manualSearchQuery.trim()) return targetProducts;
    const q = manualSearchQuery.toLowerCase().trim();
    return targetProducts.filter(p => p.name.toLowerCase().includes(q));
  }, [showManualSelection, currentUnmatched, manualSearchQuery, menuItems, rawItems]);

  const previouslyMatchedProduct = useMemo(() => {
    if (!currentUnmatched) return null;
    const savedId = getSavedMatch(currentUnmatched.originalName, currentUnmatched.type);
    if (!savedId) return null;
    const targetProducts = currentUnmatched.type === 'menu' ? menuItems : rawItems;
    return targetProducts.find(p => p.id === savedId) || null;
  }, [currentUnmatched, getSavedMatch, menuItems, rawItems]);

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const modalMaxHeight = modalExpanded ? screenHeight * 0.9 : 520;
  const modalMaxWidth = modalExpanded ? Math.min(screenWidth * 0.95, 800) : 560;

  return (
    <View style={styles.container}>
      {!isAdmin ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.light.muted }}>Admins only</Text>
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <VoiceSearchInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search menu items..."
              placeholderTextColor={Colors.light.muted}
              style={styles.searchBar}
              inputStyle={styles.searchInput}
            />
            <TouchableOpacity 
              style={styles.importBtn} 
              onPress={handleImport}
              disabled={isImporting}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Upload size={16} color="#fff" />
              )}
              <Text style={styles.importBtnText}>Import</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {Object.entries(groupedMenu).sort(([typeA], [typeB]) => typeA.localeCompare(typeB)).map(([type, categories]) => (
              <View key={type}>
                <View style={styles.typeHeader}>
                  <Text style={styles.typeTitle}>{type.toUpperCase()}</Text>
                </View>
                
                {Object.entries(categories).sort(([catA], [catB]) => catA.localeCompare(catB)).map(([category, items]) => (
                  <View key={`${type}-${category}`}>
                    <View style={styles.categoryHeader}>
                      <Text style={styles.categoryTitle}>{category}</Text>
                    </View>
                    
                    {items.map(m => {
                      const r = recipes.find(rc => rc.menuProductId === m.id);
                      const productCost = calculateProductCost(m.id);
                      const markupPercentage = productCost !== null && m.sellingPrice && m.sellingPrice > 0 && productCost > 0
                        ? ((m.sellingPrice - productCost) / productCost) * 100
                        : null;
                      
                      return (
                        <View key={m.id} style={styles.card}>
                          <View style={styles.cardHeader}>
                            <View style={{ flex: 1 }}>
                              <View style={styles.nameRow}>
                                <Text style={styles.menuName}>{m.name}</Text>
                                <View style={styles.costMarkupContainer}>
                                  {productCost !== null && (
                                    <Text style={styles.costTextInline}>Cost: {formatCurrency(productCost, currency)}</Text>
                                  )}
                                  {markupPercentage !== null && (
                                    <Text style={styles.markupTextInline}>+{markupPercentage.toFixed(0)}%</Text>
                                  )}
                                </View>
                              </View>
                              {m.sellingPrice && (
                                <Text style={styles.sellingPriceText}>Selling Price: {formatCurrency(m.sellingPrice, currency)}</Text>
                              )}
                              <Text style={styles.sub}>Unit: {m.unit}</Text>
                              <Text style={styles.subSmall}>{r ? `${r.components.length} ingredient${r.components.length !== 1 ? 's' : ''}` : 'No recipe defined'}</Text>
                            </View>
                            <TouchableOpacity style={styles.primaryBtn} onPress={() => openEditor(m.id)}>
                              <Plus size={16} color="#fff" />
                              <Text style={styles.primaryBtnText}>{r ? 'Edit' : 'Add'} Recipe</Text>
                            </TouchableOpacity>
                          </View>

                          {r && (
                            <View style={styles.componentsList}>
                              {r.components.map((c, idx) => {
                                const raw = rawItems.find(p => p.id === c.rawProductId);
                                if (!raw) return null;
                                return (
                                  <View key={idx} style={styles.compRow}>
                                    <Text style={styles.compName}>{raw.name}</Text>
                                    <Text style={styles.compQty}>{c.quantityPerUnit} {raw.unit} / {m.unit}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>

          <Modal visible={showEditor} transparent animationType="fade" onRequestClose={() => setShowEditor(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Recipe</Text>
                  <TouchableOpacity onPress={() => setShowEditor(false)}>
                    <X size={22} color={Colors.light.text} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 12 }}>
                  {components.length === 0 && (
                    <Text style={styles.emptyText}>Search and select raw materials to add to this recipe.</Text>
                  )}
                  
                  {/* Search bar to add raw materials */}
                  <View style={styles.searchSection}>
                    <Text style={styles.searchLabel}>Add Raw Material</Text>
                    <TextInput
                      style={styles.modalSearchInput}
                      placeholder="Search raw materials..."
                      value={rawMaterialSearch}
                      onChangeText={setRawMaterialSearch}
                      placeholderTextColor={Colors.light.muted}
                    />
                    {rawMaterialSearch.trim() && (
                      <ScrollView style={styles.dropdown}>
                        {rawItems
                          .filter(r => r.name.toLowerCase().includes(rawMaterialSearch.toLowerCase().trim()))
                          .map(rawItem => {
                            const alreadyAdded = components.some(c => c.rawProductId === rawItem.id);
                            return (
                              <TouchableOpacity
                                key={rawItem.id}
                                style={[styles.dropdownItem, alreadyAdded && styles.dropdownItemDisabled]}
                                onPress={() => {
                                  if (!alreadyAdded) {
                                    addComponentRow(rawItem.id);
                                  }
                                }}
                                disabled={alreadyAdded}
                              >
                                <Text style={[styles.dropdownItemText, alreadyAdded && styles.dropdownItemTextDisabled]}>
                                  {rawItem.name} ({rawItem.unit})
                                  {alreadyAdded && ' - Already added'}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                      </ScrollView>
                    )}
                  </View>

                  {/* List of added ingredients */}
                  {components.map((c, idx) => {
                    const raw = rawItems.find(p => p.id === c.rawProductId);
                    return (
                      <View key={idx} style={styles.ingredientRow}>
                        <View style={styles.ingredientInfo}>
                          <Text style={styles.ingredientName}>{raw?.name || 'Unknown'}</Text>
                          <Text style={styles.ingredientUnit}>Unit: {raw?.unit || 'N/A'}</Text>
                        </View>
                        <View style={styles.qtyInputContainer}>
                          <Text style={styles.qtyLabel}>Qty</Text>
                          <TextInput
                            style={styles.qtyInput}
                            placeholder="0"
                            keyboardType="decimal-pad"
                            value={String(c.quantityPerUnit || '')}
                            onChangeText={(v) => updateComponent(idx, { quantityPerUnit: parseFloat(v) || 0 })}
                            placeholderTextColor={Colors.light.muted}
                          />
                        </View>
                        <TouchableOpacity style={styles.removeBtn} onPress={() => removeComponent(idx)}>
                          <X size={18} color={Colors.light.danger} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
                <View style={styles.modalFooter}>
                  <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={saveRecipe}>
                    <Save size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <Modal visible={showImportResults} transparent animationType="fade" onRequestClose={() => setShowImportResults(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Import Results</Text>
                  <TouchableOpacity onPress={() => setShowImportResults(false)}>
                    <X size={22} color={Colors.light.text} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ padding: 16 }}>
                  {importResults.success > 0 && (
                    <View style={styles.resultSection}>
                      <Text style={styles.successText}>✓ Successfully imported {importResults.success} recipe{importResults.success !== 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  {importResults.warnings.length > 0 && (
                    <View style={styles.resultSection}>
                      <View style={styles.resultHeader}>
                        <AlertCircle size={16} color={Colors.light.warning} />
                        <Text style={styles.warningTitle}>Warnings ({importResults.warnings.length})</Text>
                      </View>
                      {importResults.warnings.map((w, i) => (
                        <Text key={i} style={styles.warningText}>• {w}</Text>
                      ))}
                    </View>
                  )}
                  {importResults.errors.length > 0 && (
                    <View style={styles.resultSection}>
                      <View style={styles.resultHeader}>
                        <AlertCircle size={16} color={Colors.light.danger} />
                        <Text style={styles.errorTitle}>Errors ({importResults.errors.length})</Text>
                      </View>
                      {importResults.errors.map((e, i) => (
                        <Text key={i} style={styles.errorText}>• {e}</Text>
                      ))}
                    </View>
                  )}
                </ScrollView>
                <View style={styles.modalFooter}>
                  <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={() => setShowImportResults(false)}>
                    <Text style={styles.primaryBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Product Matching Modal */}
          <Modal visible={showMatchingModal} transparent animationType="fade" onRequestClose={() => {}}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, styles.matchingModalContent, { maxWidth: modalMaxWidth }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Match Product ({currentUnmatchedIndex + 1}/{unmatchedItems.length})</Text>
                  <TouchableOpacity onPress={toggleModalExpanded} style={styles.expandBtn}>
                    <Text style={styles.expandBtnText}>{modalExpanded ? '⊟ Compact' : '⊞ Expand'}</Text>
                  </TouchableOpacity>
                </View>
                
                {currentUnmatched && !showManualSelection && (
                  <ScrollView style={{ maxHeight: modalMaxHeight - 80 }} contentContainerStyle={{ padding: 16 }}>
                    <View style={styles.unmatchedInfo}>
                      <Text style={styles.unmatchedLabel}>
                        {currentUnmatched.type === 'menu' ? 'Menu Product not found:' : 'Ingredient not found:'}
                      </Text>
                      <Text style={styles.unmatchedName}>
                        "{currentUnmatched.originalName}"
                        {currentUnmatched.originalUnit ? ` (${currentUnmatched.originalUnit})` : ''}
                      </Text>
                      {currentUnmatched.type === 'menu' && currentUnmatched.pendingIngredients && currentUnmatched.pendingIngredients.length > 0 && (
                        <Text style={styles.unmatchedFor}>
                          Has {currentUnmatched.pendingIngredients.length} ingredient(s) to import
                        </Text>
                      )}
                      {currentUnmatched.type === 'ingredient' && currentUnmatched.forProduct && (
                        <Text style={styles.unmatchedFor}>For recipe: {currentUnmatched.forProduct}</Text>
                      )}
                      {currentUnmatched.type === 'ingredient' && currentUnmatched.quantity && (
                        <Text style={styles.unmatchedQty}>Quantity: {currentUnmatched.quantity} {currentUnmatched.originalUnit}</Text>
                      )}
                    </View>
                    
                    {previouslyMatchedProduct && (
                      <View style={styles.previousMatchSection}>
                        <Text style={styles.previousMatchTitle}>Previously Used Match:</Text>
                        <TouchableOpacity
                          style={[styles.matchOption, styles.previousMatchOption]}
                          onPress={() => handleMatchSelection(previouslyMatchedProduct.id)}
                        >
                          <View style={styles.matchOptionContent}>
                            <Text style={styles.matchOptionName}>{previouslyMatchedProduct.name}</Text>
                            <Text style={styles.matchOptionUnit}>Unit: {previouslyMatchedProduct.unit}</Text>
                          </View>
                          <Text style={styles.previousMatchBadge}>Use Again</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {currentUnmatched.possibleMatches.length > 0 ? (
                      <>
                        <Text style={styles.matchSectionTitle}>
                          {currentUnmatched.type === 'menu' ? 'Suggested Menu Products:' : 'Suggested Ingredients:'}
                        </Text>
                        {currentUnmatched.possibleMatches.map((match, idx) => (
                          <TouchableOpacity
                            key={match.id}
                            style={[styles.matchOption, idx === 0 && styles.matchOptionBest]}
                            onPress={() => handleMatchSelection(match.id)}
                          >
                            <View style={styles.matchOptionContent}>
                              <Text style={styles.matchOptionName}>{match.name}</Text>
                              <Text style={styles.matchOptionUnit}>Unit: {match.unit}</Text>
                              {match.category && <Text style={styles.matchOptionCategory}>{match.category}</Text>}
                            </View>
                            {idx === 0 && <Text style={styles.bestMatchBadge}>Best Match</Text>}
                          </TouchableOpacity>
                        ))}
                      </>
                    ) : (
                      <Text style={styles.noMatchesText}>
                        No similar {currentUnmatched.type === 'menu' ? 'menu products' : 'ingredients'} found
                      </Text>
                    )}
                    
                    <View style={styles.matchActions}>
                      <TouchableOpacity
                        style={styles.matchActionBtn}
                        onPress={() => {
                          setShowManualSelection(true);
                          setManualSearchQuery('');
                        }}
                      >
                        <Text style={styles.matchActionBtnText}>Choose Another...</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={[styles.matchActionBtn, styles.matchSkipBtn]}
                        onPress={() => handleMatchSelection(null)}
                      >
                        <Text style={styles.matchSkipBtnText}>Skip</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                )}
                
                {currentUnmatched && showManualSelection && (
                  <View style={{ maxHeight: modalMaxHeight - 80, padding: 16 }}>
                    <View style={styles.manualHeader}>
                      <TouchableOpacity onPress={() => setShowManualSelection(false)}>
                        <Text style={styles.backLink}>← Back to suggestions</Text>
                      </TouchableOpacity>
                    </View>
                    
                    <TextInput
                      style={styles.manualSearchInput}
                      placeholder="Search all products..."
                      value={manualSearchQuery}
                      onChangeText={setManualSearchQuery}
                      placeholderTextColor={Colors.light.muted}
                      autoFocus
                    />
                    
                    <ScrollView style={styles.manualList}>
                      {filteredProductsForManual.map(product => (
                        <TouchableOpacity
                          key={product.id}
                          style={styles.manualOption}
                          onPress={() => handleMatchSelection(product.id)}
                        >
                          <Text style={styles.manualOptionName}>{product.name}</Text>
                          <Text style={styles.manualOptionUnit}>{product.unit}</Text>
                        </TouchableOpacity>
                      ))}
                      {filteredProductsForManual.length === 0 && (
                        <Text style={styles.noResultsText}>No products found</Text>
                      )}
                    </ScrollView>
                  </View>
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
  container: { flex: 1, backgroundColor: Colors.light.background, padding: 12 },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, color: Colors.light.text },
  importBtn: { backgroundColor: Colors.light.accent, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', minWidth: 100 },
  importBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { flex: 1 },
  card: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  menuName: { fontSize: 16, fontWeight: '700', color: Colors.light.text, flex: 1 },
  costMarkupContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  costTextInline: { fontSize: 12, color: Colors.light.tint, fontWeight: '700' as const, backgroundColor: Colors.light.tint + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  markupTextInline: { fontSize: 12, color: Colors.light.success, fontWeight: '700' as const, backgroundColor: Colors.light.success + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sub: { fontSize: 12, color: Colors.light.muted, marginTop: 4 },
  subSmall: { fontSize: 11, color: Colors.light.tabIconDefault },
  sellingPriceText: { fontSize: 13, color: Colors.light.text, fontWeight: '600' as const, marginTop: 4 },
  costText: { fontSize: 13, color: Colors.light.tint, fontWeight: '700' as const, marginTop: 2 },
  markupText: { fontSize: 13, color: Colors.light.success, fontWeight: '700' as const, marginTop: 2 },
  primaryBtn: { backgroundColor: Colors.light.tint, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  componentsList: { marginTop: 8, gap: 8 },
  compRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  compName: { color: Colors.light.text },
  compQty: { color: Colors.light.accent, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalContent: { backgroundColor: Colors.light.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, width: '100%', maxWidth: 560, overflow: 'hidden' },
  matchingModalContent: { maxWidth: 560 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  searchSection: { marginBottom: 16 },
  searchLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 8 },
  modalSearchInput: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 12, color: Colors.light.text, fontSize: 14 },
  dropdown: { maxHeight: 200, backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, marginTop: 4 },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  dropdownItemDisabled: { backgroundColor: Colors.light.background, opacity: 0.5 },
  dropdownItemText: { color: Colors.light.text, fontSize: 14 },
  dropdownItemTextDisabled: { color: Colors.light.muted },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 12, marginBottom: 8 },
  ingredientInfo: { flex: 1 },
  ingredientName: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 2 },
  ingredientUnit: { fontSize: 12, color: Colors.light.muted },
  qtyInputContainer: { alignItems: 'center' },
  qtyLabel: { fontSize: 11, color: Colors.light.muted, marginBottom: 4 },
  qtyInput: { backgroundColor: Colors.light.card, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, color: Colors.light.text, fontWeight: '700' as const, fontSize: 14, width: 80, textAlign: 'center' as const },
  removeBtn: { padding: 6 },
  emptyText: { color: Colors.light.muted, marginBottom: 8 },
  modalFooter: { padding: 12, borderTopWidth: 1, borderTopColor: Colors.light.border },
  resultSection: { marginBottom: 16 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  successText: { color: Colors.light.success, fontSize: 15, fontWeight: '700' },
  warningTitle: { color: Colors.light.warning, fontSize: 14, fontWeight: '700' },
  warningText: { color: Colors.light.muted, fontSize: 13, marginLeft: 22, marginTop: 4 },
  errorTitle: { color: Colors.light.danger, fontSize: 14, fontWeight: '700' },
  errorText: { color: Colors.light.danger, fontSize: 13, marginLeft: 22, marginTop: 4 },
  unmatchedInfo: { backgroundColor: Colors.light.background, borderRadius: 8, padding: 12, marginBottom: 16 },
  unmatchedLabel: { fontSize: 12, color: Colors.light.muted, marginBottom: 4 },
  unmatchedName: { fontSize: 16, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 4 },
  unmatchedFor: { fontSize: 13, color: Colors.light.accent, marginTop: 4 },
  unmatchedQty: { fontSize: 13, color: Colors.light.muted, marginTop: 2 },
  matchSectionTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 10 },
  matchOption: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchOptionBest: { borderColor: Colors.light.tint, borderWidth: 2 },
  matchOptionContent: { flex: 1 },
  matchOptionName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  matchOptionUnit: { fontSize: 12, color: Colors.light.muted, marginTop: 2 },
  bestMatchBadge: { backgroundColor: Colors.light.tint, color: '#fff', fontSize: 10, fontWeight: '700' as const, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
  noMatchesText: { color: Colors.light.muted, fontSize: 14, textAlign: 'center' as const, marginVertical: 16 },
  matchActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  matchActionBtn: { flex: 1, backgroundColor: Colors.light.accent, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  matchActionBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: 14 },
  matchSkipBtn: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border },
  matchSkipBtnText: { color: Colors.light.muted, fontWeight: '600' as const, fontSize: 14 },
  manualHeader: { marginBottom: 12 },
  backLink: { color: Colors.light.tint, fontSize: 14, fontWeight: '600' as const },
  manualSearchInput: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 12, fontSize: 14, color: Colors.light.text, marginBottom: 12 },
  manualList: { flex: 1 },
  manualOption: { backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 8, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  manualOptionName: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text, flex: 1 },
  manualOptionUnit: { fontSize: 12, color: Colors.light.muted },
  noResultsText: { color: Colors.light.muted, textAlign: 'center' as const, marginTop: 20 },
  matchOptionCategory: { fontSize: 11, color: Colors.light.accent, marginTop: 2 },
  typeHeader: { backgroundColor: Colors.light.tint, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, marginTop: 16, borderRadius: 8 },
  typeTitle: { fontSize: 16, fontWeight: '800' as const, color: '#fff', letterSpacing: 1 },
  categoryHeader: { backgroundColor: Colors.light.accent + '20', paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8, marginTop: 8, borderRadius: 6 },
  categoryTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.accent },
  expandBtn: { backgroundColor: Colors.light.background, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: Colors.light.border },
  expandBtnText: { fontSize: 12, color: Colors.light.tint, fontWeight: '600' as const },
  previousMatchSection: { marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  previousMatchTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.light.success, marginBottom: 8 },
  previousMatchOption: { borderColor: Colors.light.success, borderWidth: 2, backgroundColor: Colors.light.success + '10' },
  previousMatchBadge: { backgroundColor: Colors.light.success, color: '#fff', fontSize: 10, fontWeight: '700' as const, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
});
