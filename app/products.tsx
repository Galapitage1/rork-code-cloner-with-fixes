import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput, Modal, Image, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, Stack } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useStock } from '@/contexts/StockContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useOrders } from '@/contexts/OrderContext';
import { useState, useEffect } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { Plus, Edit2, Trash2, X, ArrowLeft, Download, Upload, Package, Camera, ImageIcon as ImageI } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Product, ProductType } from '@/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { parseExcelFile, generateSampleExcelBase64 } from '@/utils/excelParser';
import * as XLSX from 'xlsx';

export default function ProductsScreen() {
  const router = useRouter();
  const { isAdmin, isSuperAdmin, currency } = useAuth();
  const { products, addProduct, updateProduct, deleteProduct, showProductList, toggleShowProductList, syncAll } = useStock();
  const { recipes } = useRecipes();
  const { orders } = useOrders();
  
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productName, setProductName] = useState<string>('');
  const [productType, setProductType] = useState<ProductType>('menu');
  const [productUnit, setProductUnit] = useState<string>('');
  const [productCategory, setProductCategory] = useState<string>('');
  const [productMinStock, setProductMinStock] = useState<string>('');
  const [productSellingPrice, setProductSellingPrice] = useState<string>('');
  const [productImageUri, setProductImageUri] = useState<string>('');
  const [productShowInStock, setProductShowInStock] = useState<boolean>(true);
  const [productSalesBasedRawCalc, setProductSalesBasedRawCalc] = useState<boolean>(false);
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [confirmVisible, setConfirmVisible] = useState<boolean>(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    onConfirm: () => Promise<void> | void;
    testID: string;
  } | null>(null);

  useEffect(() => {
    if (!isAdmin && !isSuperAdmin) {
      Alert.alert('Access Denied', 'Only admins can access this page.');
      router.replace('/(tabs)/settings');
    }
  }, [isAdmin, isSuperAdmin, router]);

  if (!isAdmin && !isSuperAdmin) {
    return null;
  }

  const openConfirm = (cfg: { title: string; message: string; destructive?: boolean; onConfirm: () => Promise<void> | void; testID: string }) => {
    setConfirmState(cfg);
    setConfirmVisible(true);
  };

  const handleImportExcel = async () => {
    try {
      setIsImporting(true);

      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.onchange = async (e: any) => {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (event: any) => {
            const base64 = event.target.result.split(',')[1];
            await processExcelFile(base64);
          };
          reader.readAsDataURL(file);
        };
        input.click();
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
          copyToCacheDirectory: true,
        });

        if (result.canceled) {
          setIsImporting(false);
          return;
        }

        const fileUri = result.assets[0].uri;
        const base64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        await processExcelFile(base64);
      }
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Error', 'Failed to import Excel file. Please try again.');
      setIsImporting(false);
    }
  };

  const processExcelFile = async (base64: string) => {
    try {
      const { products: parsedProducts, errors } = parseExcelFile(base64, products);

      if (errors.length > 0) {
        Alert.alert('Import Warnings', errors.join('\n'));
      }

      if (parsedProducts.length === 0) {
        Alert.alert('No Products', 'No valid products found in the Excel file.');
        setIsImporting(false);
        return;
      }

      let newCount = 0;
      let updatedCount = 0;
      const updatedProducts: { name: string; unit: string; changes: string[] }[] = [];

      for (const parsedProduct of parsedProducts) {
        const existing = products.find(
          p => p.name.toLowerCase().trim() === parsedProduct.name.toLowerCase().trim() &&
               p.unit.toLowerCase().trim() === parsedProduct.unit.toLowerCase().trim()
        );

        if (existing) {
          const changes: string[] = [];
          if (existing.type !== parsedProduct.type) changes.push(`type: ${existing.type} → ${parsedProduct.type}`);
          if (existing.category !== parsedProduct.category) changes.push(`category: ${existing.category || 'none'} → ${parsedProduct.category || 'none'}`);
          if (existing.minStock !== parsedProduct.minStock) changes.push(`min stock: ${existing.minStock || 'none'} → ${parsedProduct.minStock || 'none'}`);
          if (existing.sellingPrice !== parsedProduct.sellingPrice) changes.push(`price: ${currency} ${existing.sellingPrice || 0} → ${currency} ${parsedProduct.sellingPrice || 0}`);
          if (existing.showInStock !== parsedProduct.showInStock) changes.push(`show in stock: ${existing.showInStock} → ${parsedProduct.showInStock}`);
          if (existing.salesBasedRawCalc !== parsedProduct.salesBasedRawCalc) changes.push(`sales based calc: ${existing.salesBasedRawCalc} → ${parsedProduct.salesBasedRawCalc}`);

          if (changes.length > 0) {
            const updates: Partial<Product> = {
              type: parsedProduct.type,
              category: parsedProduct.category,
              minStock: parsedProduct.minStock,
              sellingPrice: parsedProduct.sellingPrice,
              showInStock: parsedProduct.showInStock,
              salesBasedRawCalc: parsedProduct.salesBasedRawCalc,
            };
            await updateProduct(existing.id, updates);
            updatedProducts.push({ name: parsedProduct.name, unit: parsedProduct.unit, changes });
            updatedCount++;
          }
        } else {
          await addProduct(parsedProduct);
          newCount++;
        }
      }

      let message = '';
      if (newCount > 0) message += `✓ Added ${newCount} new product(s).\n`;
      if (updatedCount > 0) {
        message += `✓ Updated ${updatedCount} existing product(s).\n`;
        if (updatedProducts.length <= 5) {
          message += '\nUpdated products:\n';
          updatedProducts.forEach(p => {
            message += `\n• ${p.name} (${p.unit}):\n  ${p.changes.join('\n  ')}`;
          });
        } else {
          message += '\nFirst 5 updated products:\n';
          updatedProducts.slice(0, 5).forEach(p => {
            message += `\n• ${p.name} (${p.unit}):\n  ${p.changes.join('\n  ')}`;
          });
          message += `\n\n...and ${updatedProducts.length - 5} more`;
        }
      }
      if (newCount === 0 && updatedCount === 0) {
        message = 'No changes detected. All products are already up to date.';
      }
      
      Alert.alert(
        newCount > 0 || updatedCount > 0 ? 'Import Complete' : 'No Changes',
        message
      );
    } catch (error) {
      console.error('Process error:', error);
      Alert.alert('Error', 'Failed to process Excel file.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadSample = async () => {
    try {
      const base64 = generateSampleExcelBase64();
      
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
        link.download = 'sample_products.xlsx';
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 100);
        
        Alert.alert('Success', 'Sample template downloaded successfully.');
      } else {
        if (!FileSystem.documentDirectory) {
          Alert.alert(
            'Sample Format',
            'Sample file format:\n\nColumns:\n- Product Name (required)\n- Type (menu/raw)\n- Unit (kg, pieces, etc.)\n- Category (optional)\n- Min Stock (optional)\n- Show in Stock & Requests (TRUE/FALSE, optional; defaults to TRUE)\n\nCreate an Excel file with these columns and your products.'
          );
          return;
        }
        
        const fileName = 'sample_products.xlsx';
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Sample Template',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Success', 'Sample template saved to app directory.');
        }
      }
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Failed to generate sample file.');
    }
  };

  const handleExportData = async () => {
    try {
      if (products.length === 0) {
        Alert.alert('No Data', 'No products to export.');
        return;
      }

      const data = products.map(p => ({
        'Product Name': p.name,
        'Type': p.type,
        'Unit': p.unit,
        'Category': p.category || '',
        'Min Stock': p.minStock || '',
        'Selling Price': p.type === 'menu' && p.sellingPrice ? p.sellingPrice : '',
        'Show in Stock & Requests': p.showInStock !== false,
        'Sales Based Raw Calc': p.salesBasedRawCalc === true,
      }));

      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
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
        link.download = `products_export_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 100);
        
        Alert.alert('Success', 'Products exported successfully.');
      } else {
        if (!FileSystem.documentDirectory) {
          Alert.alert('Error', 'File system not available.');
          return;
        }
        
        const fileName = `products_export_${new Date().toISOString().split('T')[0]}.xlsx`;
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Products Export',
            UTI: 'com.microsoft.excel.xlsx',
          });
        } else {
          Alert.alert('Success', 'Products exported to app directory.');
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export products.');
    }
  };

  const handleOpenProductModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setProductName(product.name);
      setProductType(product.type);
      setProductUnit(product.unit);
      setProductCategory(product.category || '');
      setProductMinStock(product.minStock?.toString() || '');
      setProductImageUri(product.imageUri || '');
      setProductShowInStock(product.showInStock !== false);
      setProductSalesBasedRawCalc(product.salesBasedRawCalc === true);
      
      const priceValue = product.sellingPrice;
      const priceString = (priceValue !== undefined && priceValue !== null) ? String(priceValue) : '';
      setProductSellingPrice(priceString);
    } else {
      setEditingProduct(null);
      setProductName('');
      setProductType('menu');
      setProductUnit('');
      setProductCategory('');
      setProductMinStock('');
      setProductImageUri('');
      setProductShowInStock(true);
      setProductSalesBasedRawCalc(false);
      setProductSellingPrice('');
    }
    setShowProductModal(true);
  };

  const handleCloseProductModal = () => {
    setShowProductModal(false);
    setEditingProduct(null);
    setProductName('');
    setProductType('menu');
    setProductUnit('');
    setProductCategory('');
    setProductMinStock('');
    setProductImageUri('');
    setProductShowInStock(true);
    setProductSalesBasedRawCalc(false);
    setProductSellingPrice('');
  };

  const handleSaveProduct = async () => {
    if (!productName.trim()) {
      Alert.alert('Error', 'Please enter a product name.');
      return;
    }

    if (!productUnit.trim()) {
      Alert.alert('Error', 'Please enter a unit.');
      return;
    }

    if (!editingProduct) {
      const existingProduct = products.find(
        p => p.name.toLowerCase() === productName.trim().toLowerCase() &&
             p.unit.toLowerCase() === productUnit.trim().toLowerCase()
      );

      if (existingProduct) {
        Alert.alert('Error', 'A product with this name and unit already exists.');
        return;
      }
    }

    try {
      if (editingProduct) {
        const sellingPriceValue = productSellingPrice.trim() ? parseFloat(productSellingPrice.trim()) : undefined;
        const finalSellingPrice = productType === 'menu' && sellingPriceValue !== undefined && !isNaN(sellingPriceValue) ? sellingPriceValue : undefined;
        
        const updates = {
          name: productName.trim(),
          type: productType,
          unit: productUnit.trim(),
          category: productCategory.trim() || undefined,
          minStock: productMinStock.trim() ? parseFloat(productMinStock.trim()) : undefined,
          imageUri: productImageUri || undefined,
          showInStock: productShowInStock,
          salesBasedRawCalc: productSalesBasedRawCalc,
          sellingPrice: finalSellingPrice,
        };
        
        await updateProduct(editingProduct.id, updates);
        Alert.alert('Success', 'Product updated successfully.');
      } else {
        const sellingPriceValue = productSellingPrice.trim() ? parseFloat(productSellingPrice.trim()) : undefined;
        const finalSellingPrice = productType === 'menu' && sellingPriceValue && !isNaN(sellingPriceValue) ? sellingPriceValue : undefined;
        
        const newProduct: Product = {
          id: Date.now().toString(),
          name: productName.trim(),
          type: productType,
          unit: productUnit.trim(),
          category: productCategory.trim() || undefined,
          minStock: productMinStock.trim() ? parseFloat(productMinStock.trim()) : undefined,
          imageUri: productImageUri || undefined,
          showInStock: productShowInStock,
          salesBasedRawCalc: productSalesBasedRawCalc,
          sellingPrice: finalSellingPrice,
        };

        await addProduct(newProduct);
        Alert.alert('Success', 'Product added successfully.');
      }
      handleCloseProductModal();
    } catch (error) {
      console.error('Error saving product:', error);
      Alert.alert('Error', `Failed to ${editingProduct ? 'update' : 'add'} product.`);
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    openConfirm({
      title: 'Delete Product',
      message: `Are you sure you want to delete "${product.name} (${product.unit})"?`,
      destructive: true,
      testID: 'confirm-delete-product',
      onConfirm: async () => {
        try {
          await deleteProduct(product.id);
          Alert.alert('Success', 'Product deleted successfully.');
        } catch {
          Alert.alert('Error', 'Failed to delete product.');
        }
      },
    });
  };

  const checkProductDependencies = (productId: string): { hasRecipes: boolean; hasOrders: boolean; count: number } => {
    let count = 0;
    const hasRecipes = recipes.some(r => {
      if (r.menuProductId === productId) {
        count++;
        return true;
      }
      return r.components.some(c => {
        if (c.rawProductId === productId) {
          count++;
          return true;
        }
        return false;
      });
    });
    
    const hasOrders = orders.some(o => o.products.some(p => {
      if (p.productId === productId) {
        count++;
        return true;
      }
      return false;
    }));
    
    return { hasRecipes, hasOrders, count };
  };

  const handleRemoveDuplicates = async () => {
    try {
      const duplicates = new Map<string, Product[]>();
      
      products.forEach(product => {
        const key = `${product.name.toLowerCase().trim()}_${product.unit.toLowerCase().trim()}`;
        if (!duplicates.has(key)) {
          duplicates.set(key, []);
        }
        duplicates.get(key)?.push(product);
      });
      
      const duplicateEntries = Array.from(duplicates.entries()).filter(([_, items]) => items.length > 1);
      
      if (duplicateEntries.length === 0) {
        Alert.alert('No Duplicates', 'No duplicate products found.');
        return;
      }
      
      const removableCount = duplicateEntries.reduce((sum, [_, items]) => sum + (items.length - 1), 0);
      
      let message = `Found ${duplicateEntries.length} duplicate product(s) with ${removableCount} duplicate entries to remove:\n\n`;
      const displayLimit = 10;
      duplicateEntries.slice(0, displayLimit).forEach(([key, items]) => {
        message += `• ${items[0].name} (${items[0].unit}) - ${items.length} copies\n`;
      });
      
      if (duplicateEntries.length > displayLimit) {
        message += `\n...and ${duplicateEntries.length - displayLimit} more duplicates\n`;
      }
      
      message += '\nThe oldest entries will be kept. Duplicates connected to recipes/orders will be preserved.';
      
      openConfirm({
        title: 'Remove Duplicates',
        message: message,
        destructive: true,
        testID: 'confirm-remove-duplicates',
        onConfirm: async () => {
          try {
            console.log('[RemoveDuplicates] Starting duplicate removal process...');
            console.log('[RemoveDuplicates] Total duplicates to process:', duplicateEntries.length);
            
            let removedCount = 0;
            let skippedCount = 0;
            const skippedProducts: string[] = [];
            const idsToDelete: string[] = [];
            
            for (const [, items] of duplicateEntries) {
              const sortedByTimestamp = items.sort((a, b) => {
                const timeA = a.updatedAt || 0;
                const timeB = b.updatedAt || 0;
                return timeA - timeB;
              });
              
              const toKeep = sortedByTimestamp[0];
              const toRemove = sortedByTimestamp.slice(1);
              
              console.log(`[RemoveDuplicates] "${items[0].name}" - keeping oldest (${toKeep.id}), checking ${toRemove.length} duplicates`);
              
              for (const product of toRemove) {
                const deps = checkProductDependencies(product.id);
                
                if (deps.hasRecipes || deps.hasOrders) {
                  console.log(`[RemoveDuplicates] Skipping ${product.name} (${product.unit}) - has ${deps.count} dependencies`);
                  skippedCount++;
                  if (skippedProducts.length < 5) {
                    skippedProducts.push(`${product.name} (${product.unit}) - ${deps.count} dependencies`);
                  }
                  continue;
                }
                
                idsToDelete.push(product.id);
              }
            }
            
            if (idsToDelete.length === 0) {
              Alert.alert('No Changes', 'All duplicates are connected to recipes or orders and cannot be removed.');
              return;
            }
            
            console.log(`[RemoveDuplicates] Removing ${idsToDelete.length} duplicates in one batch...`);
            
            const updatedProducts = products.map(p => 
              idsToDelete.includes(p.id) ? { ...p, deleted: true as const, updatedAt: Date.now() } : p
            );
            
            await AsyncStorage.setItem('@stock_app_products', JSON.stringify(updatedProducts));
            removedCount = idsToDelete.length;
            
            console.log('[RemoveDuplicates] Waiting for sync...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            try {
              await syncAll(false);
              console.log('[RemoveDuplicates] Sync completed');
            } catch (syncError) {
              console.error('[RemoveDuplicates] Sync failed:', syncError);
              Alert.alert(
                'Warning',
                `Deleted ${removedCount} duplicate(s) locally. If they reappear, please check your internet connection and try again.`
              );
              return;
            }
            
            let resultMessage = `Removed ${removedCount} duplicate product(s).`;
            if (skippedCount > 0) {
              resultMessage += `\n\nSkipped ${skippedCount} duplicate(s) that are connected to recipes or orders.`;
              if (skippedProducts.length > 0) {
                resultMessage += '\n\nSkipped products:';
                skippedProducts.forEach(p => {
                  resultMessage += `\n• ${p}`;
                });
                if (skippedCount > skippedProducts.length) {
                  resultMessage += `\n...and ${skippedCount - skippedProducts.length} more`;
                }
              }
            }
            
            Alert.alert('Success', resultMessage);
          } catch (error) {
            console.error('[RemoveDuplicates] Error removing duplicates:', error);
            Alert.alert('Error', 'Failed to remove duplicate products.');
          }
        },
      });
    } catch (error) {
      console.error('Error checking duplicates:', error);
      Alert.alert('Error', 'Failed to check for duplicates.');
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera roll permission is required to upload images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const imageUri = Platform.OS === 'web' 
        ? `data:image/jpeg;base64,${result.assets[0].base64}`
        : result.assets[0].uri;
      setProductImageUri(imageUri);
    }
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const imageUri = Platform.OS === 'web'
        ? `data:image/jpeg;base64,${result.assets[0].base64}`
        : result.assets[0].uri;
      setProductImageUri(imageUri);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Products Management',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
              <ArrowLeft size={24} color={Colors.light.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <View style={styles.statsCard}>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Total Products</Text>
              <Text style={styles.statValue}>{products.length}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Menu Items</Text>
              <Text style={styles.statValue}>{products.filter(p => p.type === 'menu').length}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Raw Materials</Text>
              <Text style={styles.statValue}>{products.filter(p => p.type === 'raw').length}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Kitchen Items</Text>
              <Text style={styles.statValue}>{products.filter(p => p.type === 'kitchen').length}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleImportExcel}
            disabled={isImporting}
          >
            {isImporting ? (
              <ActivityIndicator color={Colors.light.card} />
            ) : (
              <>
                <Upload size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>Import from Excel</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleDownloadSample}
          >
            <Download size={20} color={Colors.light.tint} />
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Download Sample Template</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleExportData}
            disabled={products.length === 0}
          >
            <Package size={20} color={products.length === 0 ? Colors.light.muted : Colors.light.tint} />
            <Text style={[styles.buttonText, styles.secondaryButtonText, products.length === 0 && styles.disabledText]}>
              Export Products
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={() => handleOpenProductModal()}
          >
            <Plus size={20} color={Colors.light.card} />
            <Text style={styles.buttonText}>Add Product Manually</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => router.push('/product-conversions')}
          >
            <Package size={20} color={Colors.light.tint} />
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Product Unit Conversions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleRemoveDuplicates}
            disabled={products.length === 0}
          >
            <Trash2 size={20} color={products.length === 0 ? Colors.light.muted : Colors.light.tint} />
            <Text style={[styles.buttonText, styles.secondaryButtonText, products.length === 0 && styles.disabledText]}>
              Remove Duplicates
            </Text>
          </TouchableOpacity>

          <View style={styles.toggleContainer}>
            <Text style={styles.toggleLabel}>Show Product List</Text>
            <Switch
              value={showProductList}
              onValueChange={(value) => toggleShowProductList(value)}
              trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
              thumbColor={Colors.light.card}
            />
          </View>

          {showProductList && (
          <>
          <Text style={styles.sectionSubtitle}>Products List</Text>
          
          {products.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No products added yet</Text>
            </View>
          ) : (
            <>
              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  value={productSearchQuery}
                  onChangeText={setProductSearchQuery}
                  placeholder="Search products..."
                  placeholderTextColor={Colors.light.muted}
                />
              </View>
              
              <View style={styles.productsList}>
                {(() => {
                  const filtered = products.filter(p => {
                    if (!productSearchQuery.trim()) return true;
                    const query = productSearchQuery.toLowerCase();
                    return (
                      p.name.toLowerCase().includes(query) ||
                      p.type.toLowerCase().includes(query) ||
                      p.unit.toLowerCase().includes(query) ||
                      (p.category && p.category.toLowerCase().includes(query))
                    );
                  });

                  const grouped = filtered.reduce((acc, product) => {
                    if (!acc[product.type]) acc[product.type] = [];
                    acc[product.type].push(product);
                    return acc;
                  }, {} as Record<ProductType, Product[]>);

                  const typeOrder: ProductType[] = ['menu', 'raw', 'kitchen'];
                  const typeTitles: Record<ProductType, string> = {
                    menu: 'Menu Items',
                    raw: 'Raw Materials',
                    kitchen: 'Kitchen Items',
                  };

                  return typeOrder.map(type => {
                    const items = grouped[type];
                    if (!items || items.length === 0) return null;

                    const sorted = items.sort((a, b) => a.name.localeCompare(b.name));

                    return (
                      <View key={type} style={styles.productTypeSection}>
                        <Text style={styles.productTypeTitle}>{typeTitles[type]}</Text>
                        {sorted.map((product) => (
                          <View key={product.id} style={styles.productCard}>
                            <View style={styles.productCardContent}>
                              {product.imageUri && (
                                <Image
                                  source={{ uri: product.imageUri }}
                                  style={styles.productThumbnail}
                                  resizeMode="cover"
                                />
                              )}
                              <View style={styles.productCardInfo}>
                                <Text style={styles.productCardName}>{product.name}</Text>
                                <Text style={styles.productCardDetails}>
                                  {product.type === 'menu' ? 'Menu' : product.type === 'kitchen' ? 'Kitchen' : 'Raw Material'} • {product.unit}
                                </Text>
                                {product.category && (
                                  <Text style={styles.productCardCategory}>{product.category}</Text>
                                )}
                              </View>
                            </View>
                            <View style={styles.productActions}>
                              <TouchableOpacity
                                style={styles.iconButton}
                                onPress={() => handleOpenProductModal(product)}
                              >
                                <Edit2 size={18} color={Colors.light.tint} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.iconButton}
                                onPress={() => handleDeleteProduct(product)}
                              >
                                <Trash2 size={18} color={Colors.light.danger} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    );
                  });
                })()}
              </View>
            </>
          )}
          </>
          )}
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={!!confirmVisible}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        destructive={!!confirmState?.destructive}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={async () => {
          try {
            await confirmState?.onConfirm?.();
          } finally {
            setConfirmVisible(false);
          }
        }}
        testID={confirmState?.testID}
      />

      <Modal
        visible={showProductModal}
        transparent
        animationType="fade"
        onRequestClose={handleCloseProductModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingProduct ? 'Edit Product' : 'Add Product'}</Text>
              <TouchableOpacity onPress={handleCloseProductModal}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Product Name *</Text>
                <TextInput
                  style={styles.input}
                  value={productName}
                  onChangeText={setProductName}
                  placeholder="Enter product name"
                  placeholderTextColor={Colors.light.muted}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Type *</Text>
                <View style={styles.typeSelector}>
                  <TouchableOpacity
                    style={[
                      styles.typeButton,
                      productType === 'menu' && styles.typeButtonActive,
                    ]}
                    onPress={() => setProductType('menu')}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        productType === 'menu' && styles.typeButtonTextActive,
                      ]}
                    >
                      Menu
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeButton,
                      productType === 'raw' && styles.typeButtonActive,
                    ]}
                    onPress={() => setProductType('raw')}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        productType === 'raw' && styles.typeButtonTextActive,
                      ]}
                    >
                      Raw Material
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeButton,
                      productType === 'kitchen' && styles.typeButtonActive,
                    ]}
                    onPress={() => setProductType('kitchen')}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        productType === 'kitchen' && styles.typeButtonTextActive,
                      ]}
                    >
                      Kitchen
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Unit *</Text>
                <TextInput
                  style={styles.input}
                  value={productUnit}
                  onChangeText={setProductUnit}
                  placeholder="e.g., kg, pieces, liters"
                  placeholderTextColor={Colors.light.muted}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={productCategory}
                  onChangeText={setProductCategory}
                  placeholder="Enter category"
                  placeholderTextColor={Colors.light.muted}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Minimum Stock (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={productMinStock}
                  onChangeText={setProductMinStock}
                  placeholder="Enter minimum stock level"
                  placeholderTextColor={Colors.light.muted}
                  keyboardType="numeric"
                />
              </View>

              {productType === 'menu' && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Selling Price ({currency}) (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={productSellingPrice}
                    onChangeText={setProductSellingPrice}
                    placeholder="0.00"
                    placeholderTextColor={Colors.light.muted}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Include in Stock Check & Requests</Text>
                <View style={styles.switchContainer}>
                  <Text style={styles.switchLabel}>Show this product when checking stock and making requests</Text>
                  <Switch
                    value={productShowInStock}
                    onValueChange={setProductShowInStock}
                    trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                    thumbColor={Colors.light.card}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Sales Based Raw Calculation</Text>
                <View style={styles.switchContainer}>
                  <Text style={styles.switchLabel}>Calculate raw materials based on sales using recipe values during reconciliation</Text>
                  <Switch
                    value={productSalesBasedRawCalc}
                    onValueChange={setProductSalesBasedRawCalc}
                    trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                    thumbColor={Colors.light.card}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Product Image (Optional)</Text>
                {productImageUri ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image
                      source={{ uri: productImageUri }}
                      style={styles.imagePreview}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => setProductImageUri('')}
                    >
                      <X size={20} color={Colors.light.card} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.imageButtonsContainer}>
                    <TouchableOpacity
                      style={styles.imageButton}
                      onPress={handleTakePhoto}
                    >
                      <Camera size={20} color={Colors.light.tint} />
                      <Text style={styles.imageButtonText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.imageButton}
                      onPress={handlePickImage}
                    >
                      <ImageI size={20} color={Colors.light.tint} />
                      <Text style={styles.imageButtonText}>Choose from Library</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, styles.modalButton]}
                onPress={handleCloseProductModal}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, styles.modalButton]}
                onPress={handleSaveProduct}
              >
                <Text style={styles.buttonText}>{editingProduct ? 'Update Product' : 'Add Product'}</Text>
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
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 32,
  },
  statsCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 12,
  },
  statRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  statLabel: {
    fontSize: 16,
    color: Colors.light.text,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  button: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 12,
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
  disabledText: {
    color: Colors.light.muted,
  },
  sectionSubtitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 8,
    marginBottom: 12,
  },
  emptyState: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  searchContainer: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  productsList: {
    gap: 12,
  },
  productTypeSection: {
    marginBottom: 20,
  },
  productTypeTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.tint,
    marginBottom: 12,
    paddingLeft: 4,
  },
  productCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  productCardContent: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  productThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
  },
  productCardInfo: {
    flex: 1,
  },
  productCardName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  productCardDetails: {
    fontSize: 13,
    color: Colors.light.muted,
  },
  productCardCategory: {
    fontSize: 12,
    color: Colors.light.tint,
    marginTop: 2,
  },
  productActions: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  iconButton: {
    padding: 8,
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
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
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
  modalButton: {
    flex: 1,
    marginBottom: 0,
  },
  typeSelector: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    alignItems: 'center' as const,
  },
  typeButtonActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  typeButtonTextActive: {
    color: Colors.light.card,
  },
  switchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
  },
  switchLabel: {
    flex: 1,
    color: Colors.light.text,
    fontSize: 14,
    marginRight: 12,
  },
  imagePreviewContainer: {
    position: 'relative' as const,
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  removeImageButton: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    backgroundColor: Colors.light.danger,
    borderRadius: 20,
    padding: 6,
  },
  imageButtonsContainer: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  imageButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  imageButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  toggleContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
});
