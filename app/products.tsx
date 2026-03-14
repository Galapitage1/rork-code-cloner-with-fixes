import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput, Modal, Image, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useStock } from '@/contexts/StockContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { useOrders } from '@/contexts/OrderContext';
import { useStores } from '@/contexts/StoresContext';
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { Plus, Edit2, Trash2, X, ArrowLeft, Download, Upload, Package, Camera, ImageIcon as ImageI } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { Product, ProductType } from '@/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { parseExcelFile, generateSampleExcelBase64 } from '@/utils/excelParser';
import { syncData } from '@/utils/syncData';
import * as XLSX from 'xlsx';

const MAX_PRODUCT_PHOTOS = 3;
const CAMPAIGN_SETTINGS_KEY = '@campaign_settings';

function normalizeProductCategories(rawCategories: any): string[] {
  if (!Array.isArray(rawCategories)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];
  rawCategories.forEach((entry) => {
    const value = String(entry || '').trim();
    if (!value) {
      return;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    next.push(value);
  });

  return next.sort((a, b) => a.localeCompare(b));
}

function getProductImageUris(product?: Partial<Product> | null): string[] {
  const imageUris = Array.isArray(product?.imageUris)
    ? product!.imageUris.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  if (imageUris.length > 0) {
    return imageUris.slice(0, MAX_PRODUCT_PHOTOS);
  }
  const legacyImage = typeof product?.imageUri === 'string' ? product.imageUri.trim() : '';
  return legacyImage ? [legacyImage] : [];
}

export default function ProductsScreen() {
  const router = useRouter();
  const { isAdmin, isSuperAdmin, currency, currentUser } = useAuth();
  const { products, addProduct, updateProduct, deleteProduct, showProductList, toggleShowProductList, syncAll } = useStock();
  const { syncRecipes } = useRecipes();
  const { syncOrders } = useOrders();
  const { storeProducts, deleteStoreProduct } = useStores();
  
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productName, setProductName] = useState<string>('');
  const [productDescription, setProductDescription] = useState<string>('');
  const [productType, setProductType] = useState<ProductType>('menu');
  const [productUnit, setProductUnit] = useState<string>('');
  const [productCategory, setProductCategory] = useState<string>('');
  const [productCategories, setProductCategories] = useState<string[]>([]);
  const [productMinStock, setProductMinStock] = useState<string>('');
  const [productSellingPrice, setProductSellingPrice] = useState<string>('');
  const [productImageUris, setProductImageUris] = useState<string[]>([]);
  const [productShowInStock, setProductShowInStock] = useState<boolean>(true);
  const [productSalesBasedRawCalc, setProductSalesBasedRawCalc] = useState<boolean>(false);
  const [productKOTEnabled, setProductKOTEnabled] = useState<boolean>(false);
  const [productBOTEnabled, setProductBOTEnabled] = useState<boolean>(false);
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
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

  const loadProductCategories = useCallback(async () => {
    try {
      const localRaw = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      const localSettings = localRaw ? JSON.parse(localRaw) : null;
      const localCategories = normalizeProductCategories(localSettings?.productCategories);
      setProductCategories(localCategories);

      if (currentUser?.id) {
        const synced = await syncData<any>(
          'campaign_settings',
          localSettings ? [localSettings] : [],
          currentUser.id,
          { fetchOnly: true, includeDeleted: true, minDays: 3650 }
        );
        const latest = (Array.isArray(synced) ? synced : [])
          .filter((item: any) => item && item.deleted !== true)
          .sort((a: any, b: any) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
        if (latest) {
          await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(latest));
          setProductCategories(normalizeProductCategories(latest.productCategories));
        }
      }
    } catch (error) {
      console.error('[PRODUCTS] Failed to load product categories:', error);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    loadProductCategories();
  }, [loadProductCategories]);

  useFocusEffect(
    useCallback(() => {
      loadProductCategories();
    }, [loadProductCategories])
  );

  if (!isAdmin && !isSuperAdmin) {
    return null;
  }

  const availableProductCategories = useMemo(() => {
    const next = normalizeProductCategories(productCategories);
    if (productCategory.trim() && !next.some((item) => item.toLowerCase() === productCategory.trim().toLowerCase())) {
      next.push(productCategory.trim());
      next.sort((a, b) => a.localeCompare(b));
    }
    return next;
  }, [productCategories, productCategory]);

  const selectProductCategory = () => {
    const options = [
      { text: 'No Category', onPress: () => setProductCategory('') },
      ...availableProductCategories.map((category) => ({
        text: category,
        onPress: () => setProductCategory(category),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ];

    Alert.alert('Select Category', '', options as any);
  };

  const openConfirm = (cfg: { title: string; message: string; destructive?: boolean; onConfirm: () => Promise<void> | void; testID: string }) => {
    setConfirmState(cfg);
    setConfirmVisible(true);
  };

  const getApiBaseUrl = () => {
    const envBase = String(process.env.EXPO_PUBLIC_RORK_API_BASE_URL || '').trim().replace(/\/+$/, '');
    if (envBase) return envBase;
    if (typeof window !== 'undefined' && window.location?.origin) {
      return String(window.location.origin).trim().replace(/\/+$/, '');
    }
    return 'https://tracker.tecclk.com';
  };

  const getUploadEndpoint = () => {
    const apiBase = getApiBaseUrl();
    return apiBase.includes('tracker.tecclk.com')
      ? `${apiBase}/Tracker/api/upload-media.php`
      : `${apiBase}/api/upload-media`;
  };

  const uploadProductImageUri = async (imageUri: string, fileName?: string, mimeType?: string): Promise<string> => {
    const trimmedUri = String(imageUri || '').trim();
    if (!trimmedUri) {
      throw new Error('Missing product image');
    }
    if (/^https?:\/\//i.test(trimmedUri)) {
      return trimmedUri;
    }

    const uploadEndpoint = getUploadEndpoint();
    const formData = new FormData();

    if (Platform.OS === 'web' || trimmedUri.startsWith('data:')) {
      const response = await fetch(trimmedUri);
      const blob = await response.blob();
      const filename = fileName || trimmedUri.split('/').pop() || `product-photo-${Date.now()}.jpg`;
      formData.append('file', blob, filename);
    } else {
      const filename = fileName || trimmedUri.split('/').pop() || `product-photo-${Date.now()}.jpg`;
      formData.append('file', {
        uri: trimmedUri,
        name: filename,
        type: mimeType || 'image/jpeg',
      } as any);
    }

    const uploadResponse = await fetch(uploadEndpoint, {
      method: 'POST',
      body: formData,
    });

    const uploadResult = await uploadResponse.json();
    if (!uploadResponse.ok || !uploadResult?.success || !uploadResult?.url) {
      throw new Error(uploadResult?.error || 'Failed to upload product image');
    }

    return String(uploadResult.url);
  };

  const uploadProductImageAsset = async (asset: ImagePicker.ImagePickerAsset): Promise<string> => {
    return uploadProductImageUri(
      asset.uri,
      asset.fileName || `product-photo-${Date.now()}.jpg`,
      asset.mimeType || 'image/jpeg'
    );
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
      // CRITICAL: Read ALL products from storage including deleted ones to prevent conflicts
      console.log('[processExcelFile] Reading ALL products from storage (including deleted) to check for conflicts');
      const allProductsData = await AsyncStorage.getItem('@stock_app_products');
      const allProducts: Product[] = allProductsData ? JSON.parse(allProductsData) : [];
      console.log('[processExcelFile] Found', allProducts.length, 'total products in storage (active + deleted)');
      
      // Filter active products for Excel parser
      const activeProducts = allProducts.filter(p => !p.deleted);
      console.log('[processExcelFile] Found', activeProducts.length, 'active products');
      
      const { products: parsedProducts, errors } = parseExcelFile(base64, activeProducts);

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
      let reactivatedCount = 0;
      const updatedProducts: { name: string; unit: string; changes: string[] }[] = [];
      const skippedDeleted: string[] = [];

      // Keep track of which products we've processed to avoid duplicates in this import
      const processedKeys = new Set<string>();
      
      for (const parsedProduct of parsedProducts) {
        const productKey = `${parsedProduct.name.toLowerCase().trim()}_${parsedProduct.unit.toLowerCase().trim()}`;
        
        // Skip if we already processed this product in this import
        if (processedKeys.has(productKey)) {
          console.log('[processExcelFile] Skipping duplicate in Excel file:', parsedProduct.name);
          continue;
        }
        processedKeys.add(productKey);
        
        // Check in ALL products (including deleted ones) to prevent conflicts
        const existing = allProducts.find(
          p => p.name.toLowerCase().trim() === parsedProduct.name.toLowerCase().trim() &&
               p.unit.toLowerCase().trim() === parsedProduct.unit.toLowerCase().trim()
        );

        if (existing && existing.deleted) {
          // Product was previously deleted - reactivate it with new data
          console.log('[processExcelFile] Found deleted product:', existing.name, '- reactivating with new data from Excel');
          const reactivated: Product = {
            ...existing,
            ...parsedProduct,
            id: existing.id, // Keep the original ID
            deleted: false,
            updatedAt: Date.now(),
          };
          
          // Update in the allProducts array
          const updatedAllProducts = allProducts.map(p =>
            p.id === existing.id ? reactivated : p
          );
          await AsyncStorage.setItem('@stock_app_products', JSON.stringify(updatedAllProducts));
          
          // Update local allProducts array for next iterations
          allProducts.splice(allProducts.findIndex(p => p.id === existing.id), 1, reactivated);
          reactivatedCount++;
        } else if (existing) {
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
            
            // Update in allProducts array directly
            const updatedProduct = { ...existing, ...updates, updatedAt: Date.now() };
            const updatedAllProducts = allProducts.map(p => p.id === existing.id ? updatedProduct : p);
            await AsyncStorage.setItem('@stock_app_products', JSON.stringify(updatedAllProducts));
            
            // Update local allProducts array for next iterations
            allProducts.splice(allProducts.findIndex(p => p.id === existing.id), 1, updatedProduct);
            
            updatedProducts.push({ name: parsedProduct.name, unit: parsedProduct.unit, changes });
            updatedCount++;
          }
        } else {
          // Brand new product - add it
          const newProduct: Product = {
            ...parsedProduct,
            id: parsedProduct.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            deleted: false,
            updatedAt: Date.now(),
          };
          
          allProducts.push(newProduct);
          await AsyncStorage.setItem('@stock_app_products', JSON.stringify(allProducts));
          newCount++;
        }
      }

      // Trigger sync to reload products and update server
      console.log('[processExcelFile] Triggering sync to reload products and update server');
      await syncAll(false).catch(e => console.error('[processExcelFile] Sync failed:', e));
      
      let message = '';
      if (newCount > 0) message += `✓ Added ${newCount} new product(s).\n`;
      if (reactivatedCount > 0) message += `✓ Reactivated ${reactivatedCount} previously deleted product(s).\n`;
      if (skippedDeleted.length > 0) {
        message += `\n⚠️ Skipped ${skippedDeleted.length} product(s) that were previously deleted.\n`;
        if (skippedDeleted.length <= 5) {
          skippedDeleted.forEach(name => {
            message += `  • ${name}\n`;
          });
        } else {
          skippedDeleted.slice(0, 5).forEach(name => {
            message += `  • ${name}\n`;
          });
          message += `  ...and ${skippedDeleted.length - 5} more\n`;
        }
        message += `\nTo re-import these products, first remove them from the Products page using "Remove Duplicates" button.`;
      }
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
      if (newCount === 0 && updatedCount === 0 && reactivatedCount === 0 && skippedDeleted.length === 0) {
        message = 'No changes detected. All products are already up to date.';
      }
      
      Alert.alert(
        newCount > 0 || updatedCount > 0 || reactivatedCount > 0 ? 'Import Complete' : skippedDeleted.length > 0 ? 'Import Issues' : 'No Changes',
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
            'Sample file format:\n\nColumns:\n- Product Name (required)\n- Description (optional)\n- Type (menu/raw)\n- Unit (kg, pieces, etc.)\n- Category (optional)\n- Min Stock (optional)\n- Show in Stock & Requests (TRUE/FALSE, optional; defaults to TRUE)\n\nCreate an Excel file with these columns and your products.'
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
        'Description': p.description || '',
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
      setProductDescription(product.description || '');
      setProductType(product.type);
      setProductUnit(product.unit);
      setProductCategory(product.category || '');
      setProductMinStock(product.minStock?.toString() || '');
      setProductImageUris(getProductImageUris(product));
      setProductShowInStock(product.showInStock !== false);
      setProductSalesBasedRawCalc(product.salesBasedRawCalc === true);
      setProductKOTEnabled(product.kotEnabled === true);
      setProductBOTEnabled(product.botEnabled === true);
      
      const priceValue = product.sellingPrice;
      const priceString = (priceValue !== undefined && priceValue !== null) ? String(priceValue) : '';
      setProductSellingPrice(priceString);
    } else {
      setEditingProduct(null);
      setProductName('');
      setProductDescription('');
      setProductType('menu');
      setProductUnit('');
      setProductCategory('');
      setProductMinStock('');
      setProductImageUris([]);
      setProductShowInStock(true);
      setProductSalesBasedRawCalc(false);
      setProductKOTEnabled(false);
      setProductBOTEnabled(false);
      setProductSellingPrice('');
    }
    setShowProductModal(true);
  };

  const handleCloseProductModal = () => {
    setShowProductModal(false);
    setEditingProduct(null);
    setProductName('');
    setProductDescription('');
    setProductType('menu');
    setProductUnit('');
    setProductCategory('');
    setProductMinStock('');
    setProductImageUris([]);
    setProductShowInStock(true);
    setProductSalesBasedRawCalc(false);
    setProductKOTEnabled(false);
    setProductBOTEnabled(false);
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
      setIsUploadingImage(true);
      const normalizedProductImageUris = await Promise.all(
        productImageUris.slice(0, MAX_PRODUCT_PHOTOS).map((imageUri, index) =>
          uploadProductImageUri(imageUri, `product-photo-${index + 1}.jpg`)
        )
      );

      if (editingProduct) {
        const sellingPriceValue = productSellingPrice.trim() ? parseFloat(productSellingPrice.trim()) : undefined;
        const finalSellingPrice = productType === 'menu' && sellingPriceValue !== undefined && !isNaN(sellingPriceValue) ? sellingPriceValue : undefined;
        
        const updates = {
          name: productName.trim(),
          description: productDescription.trim() || undefined,
          type: productType,
          unit: productUnit.trim(),
          category: productCategory.trim() || undefined,
          minStock: productMinStock.trim() ? parseFloat(productMinStock.trim()) : undefined,
          imageUri: normalizedProductImageUris[0] || undefined,
          imageUris: normalizedProductImageUris.length > 0 ? normalizedProductImageUris : undefined,
          showInStock: productShowInStock,
          salesBasedRawCalc: productSalesBasedRawCalc,
          sellingPrice: finalSellingPrice,
          kotEnabled: productKOTEnabled,
          botEnabled: productBOTEnabled,
        };
        
        await updateProduct(editingProduct.id, updates);
        Alert.alert('Success', 'Product updated successfully.');
      } else {
        const sellingPriceValue = productSellingPrice.trim() ? parseFloat(productSellingPrice.trim()) : undefined;
        const finalSellingPrice = productType === 'menu' && sellingPriceValue && !isNaN(sellingPriceValue) ? sellingPriceValue : undefined;
        
        const newProduct: Product = {
          id: Date.now().toString(),
          name: productName.trim(),
          description: productDescription.trim() || undefined,
          type: productType,
          unit: productUnit.trim(),
          category: productCategory.trim() || undefined,
          minStock: productMinStock.trim() ? parseFloat(productMinStock.trim()) : undefined,
          imageUri: normalizedProductImageUris[0] || undefined,
          imageUris: normalizedProductImageUris.length > 0 ? normalizedProductImageUris : undefined,
          showInStock: productShowInStock,
          salesBasedRawCalc: productSalesBasedRawCalc,
          sellingPrice: finalSellingPrice,
          kotEnabled: productKOTEnabled,
          botEnabled: productBOTEnabled,
        };

        await addProduct(newProduct);
        Alert.alert('Success', 'Product added successfully.');
      }
      handleCloseProductModal();
    } catch (error) {
      console.error('Error saving product:', error);
      Alert.alert('Error', (error as Error).message || `Failed to ${editingProduct ? 'update' : 'add'} product.`);
    } finally {
      setIsUploadingImage(false);
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

  const getArrayFromStorage = async (key: string): Promise<any[]> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const setArrayToStorage = async (key: string, value: any[]): Promise<void> => {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  };

  const remapDeepProductIds = (
    input: any,
    idMap: Map<string, string>
  ): { value: any; changes: number } => {
    const idKeys = new Set([
      'productId',
      'rawProductId',
      'fromProductId',
      'toProductId',
      'menuProductId',
      'kitchenProductId',
    ]);

    if (Array.isArray(input)) {
      let totalChanges = 0;
      const next = input.map(item => {
        const result = remapDeepProductIds(item, idMap);
        totalChanges += result.changes;
        return result.value;
      });
      return { value: next, changes: totalChanges };
    }

    if (input && typeof input === 'object') {
      let totalChanges = 0;
      const next: Record<string, any> = {};

      Object.entries(input).forEach(([key, value]) => {
        if (idKeys.has(key) && typeof value === 'string') {
          const mapped = idMap.get(value);
          if (mapped && mapped !== value) {
            next[key] = mapped;
            totalChanges += 1;
            return;
          }
          next[key] = value;
          return;
        }

        const result = remapDeepProductIds(value, idMap);
        next[key] = result.value;
        totalChanges += result.changes;
      });

      return { value: next, changes: totalChanges };
    }

    return { value: input, changes: 0 };
  };

  const mergeStockCountsByProductId = (counts: any[]): any[] => {
    const map = new Map<string, any>();
    const numericFields = [
      'quantity',
      'openingStock',
      'receivedStock',
      'wastage',
      'autoFilledReceivedFromProdReq',
      'totalValue',
      'totalCost',
    ];

    counts.forEach((count) => {
      const productId = String(count?.productId || '').trim();
      if (!productId) return;

      if (!map.has(productId)) {
        map.set(productId, { ...count, productId });
        return;
      }

      const existing = map.get(productId)!;
      numericFields.forEach((field) => {
        const current = Number(existing[field] ?? 0);
        const incoming = Number(count[field] ?? 0);
        if (!Number.isFinite(current) && !Number.isFinite(incoming)) return;
        existing[field] = (Number.isFinite(current) ? current : 0) + (Number.isFinite(incoming) ? incoming : 0);
      });

      if (existing.sellingPrice === undefined && count.sellingPrice !== undefined) {
        existing.sellingPrice = count.sellingPrice;
      }

      const currentNotes = String(existing.notes || '').trim();
      const incomingNotes = String(count.notes || '').trim();
      if (incomingNotes) {
        existing.notes = currentNotes && currentNotes !== incomingNotes
          ? `${currentNotes} | ${incomingNotes}`
          : (currentNotes || incomingNotes);
      }
    });

    return Array.from(map.values());
  };

  const mergeOutletStocks = (stocks: any[]): any[] => {
    const map = new Map<string, any>();
    const numericFields = [
      'whole',
      'slices',
      'openingWhole',
      'openingSlices',
      'receivedWhole',
      'receivedSlices',
      'soldWhole',
      'soldSlices',
      'wastageWhole',
      'wastageSlices',
    ];

    stocks.forEach((item) => {
      const outletName = String(item?.outletName || '').trim();
      if (!outletName) return;
      const key = outletName.toLowerCase();

      if (!map.has(key)) {
        map.set(key, { ...item, outletName });
        return;
      }

      const existing = map.get(key)!;
      numericFields.forEach((field) => {
        const current = Number(existing[field] ?? 0);
        const incoming = Number(item[field] ?? 0);
        if (!Number.isFinite(current) && !Number.isFinite(incoming)) return;
        existing[field] = (Number.isFinite(current) ? current : 0) + (Number.isFinite(incoming) ? incoming : 0);
      });
    });

    return Array.from(map.values());
  };

  const relinkProductReferences = async (
    idMap: Map<string, string>
  ): Promise<{ datasetsUpdated: number; referencesRelinked: number }> => {
    const now = Date.now();
    let datasetsUpdated = 0;
    let referencesRelinked = 0;

    const remapAndSave = async (key: string, postProcess?: (rows: any[]) => any[]) => {
      const original = await getArrayFromStorage(key);
      if (!original.length) return;

      let localChanges = 0;
      const remapped = original.map(item => {
        const result = remapDeepProductIds(item, idMap);
        localChanges += result.changes;
        return result.value;
      });

      let next = remapped;
      if (postProcess) {
        next = postProcess(remapped);
      }

      const changed = localChanges > 0 || JSON.stringify(next) !== JSON.stringify(original);
      if (changed) {
        await setArrayToStorage(key, next);
        datasetsUpdated += 1;
        referencesRelinked += localChanges;
      }
    };

    await remapAndSave('@stock_app_stock_checks', (rows) => {
      return rows.map((check) => {
        if (!Array.isArray(check?.counts)) return check;
        const mergedCounts = mergeStockCountsByProductId(check.counts);
        return { ...check, counts: mergedCounts, updatedAt: now };
      });
    });

    await remapAndSave('@stock_app_requests');

    await remapAndSave('@stock_app_product_conversions', (rows) => {
      const active = rows.filter((row) => !row?.deleted);
      const deleted = rows.filter((row) => row?.deleted);
      const keepByPair = new Map<string, any>();
      const tombstones: any[] = [];

      active.forEach((conversion) => {
        const fromId = String(conversion?.fromProductId || '').trim();
        const toId = String(conversion?.toProductId || '').trim();
        if (!fromId || !toId || fromId === toId) {
          tombstones.push({ ...conversion, deleted: true, updatedAt: now });
          return;
        }

        const key = `${fromId}__${toId}`;
        const existing = keepByPair.get(key);
        if (!existing) {
          keepByPair.set(key, conversion);
          return;
        }

        const keepCurrent = (conversion.updatedAt || 0) >= (existing.updatedAt || 0);
        if (keepCurrent) {
          tombstones.push({ ...existing, deleted: true, updatedAt: now });
          keepByPair.set(key, conversion);
        } else {
          tombstones.push({ ...conversion, deleted: true, updatedAt: now });
        }
      });

      const keep = Array.from(keepByPair.values()).map(item => ({ ...item, updatedAt: now }));
      return [...keep, ...deleted, ...tombstones];
    });

    await remapAndSave('@stock_app_inventory_stocks', (rows) => {
      const active = rows.filter((row) => !row?.deleted);
      const deleted = rows.filter((row) => row?.deleted);
      const byProductId = new Map<string, any[]>();

      active.forEach((row) => {
        const productId = String(row?.productId || '').trim();
        if (!productId) return;
        if (!byProductId.has(productId)) byProductId.set(productId, []);
        byProductId.get(productId)!.push(row);
      });

      const mergedActive: any[] = [];
      const tombstones: any[] = [];
      const numericFields = [
        'productionWhole',
        'productionSlices',
        'prodsWhole',
        'prodsSlices',
        'prodsReqWhole',
        'prodsReqSlices',
        'productionRequest',
      ];

      byProductId.forEach((group) => {
        const sorted = [...group].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
        const keep = { ...sorted[0] };

        sorted.forEach((row, index) => {
          if (index > 0) {
            tombstones.push({ ...row, deleted: true, updatedAt: now });
          }
          numericFields.forEach((field) => {
            const current = Number(keep[field] ?? 0);
            const incoming = Number(row[field] ?? 0);
            if (!Number.isFinite(current) && !Number.isFinite(incoming)) return;
            keep[field] = (Number.isFinite(current) ? current : 0) + (Number.isFinite(incoming) ? incoming : 0);
          });
        });

        keep.outletStocks = mergeOutletStocks(
          sorted.flatMap(item => Array.isArray(item?.outletStocks) ? item.outletStocks : [])
        );
        keep.updatedAt = now;
        mergedActive.push(keep);
      });

      return [...mergedActive, ...deleted, ...tombstones];
    });

    await remapAndSave('@stock_app_sales_deductions', (rows) => {
      const active = rows.filter((row) => !row?.deleted);
      const deleted = rows.filter((row) => row?.deleted);
      const byKey = new Map<string, any[]>();

      active.forEach((row) => {
        const key = `${row?.outletName || ''}__${row?.salesDate || ''}__${row?.productId || ''}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(row);
      });

      const mergedActive: any[] = [];
      const tombstones: any[] = [];
      byKey.forEach((group) => {
        const sorted = [...group].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
        const keep = { ...sorted[0] };

        let wholeDeducted = 0;
        let slicesDeducted = 0;
        sorted.forEach((row, index) => {
          if (index > 0) {
            tombstones.push({ ...row, deleted: true, updatedAt: now });
          }
          wholeDeducted += Number(row?.wholeDeducted || 0);
          slicesDeducted += Number(row?.slicesDeducted || 0);
        });

        keep.wholeDeducted = wholeDeducted;
        keep.slicesDeducted = slicesDeducted;
        keep.updatedAt = now;
        mergedActive.push(keep);
      });

      return [...mergedActive, ...deleted, ...tombstones];
    });

    await remapAndSave('@stock_app_reconcile_history', (rows) => {
      const mergeById = (items: any[], idField: string, fieldsToSum: string[]) => {
        const map = new Map<string, any>();
        items.forEach((item) => {
          const id = String(item?.[idField] || '').trim();
          if (!id) return;
          if (!map.has(id)) {
            map.set(id, { ...item, [idField]: id });
            return;
          }

          const existing = map.get(id)!;
          fieldsToSum.forEach((field) => {
            existing[field] = Number(existing[field] || 0) + Number(item[field] || 0);
          });
        });
        return Array.from(map.values());
      };

      return rows.map((row) => {
        const salesData = Array.isArray(row?.salesData)
          ? mergeById(row.salesData, 'productId', ['sold', 'opening', 'received', 'closing'])
          : row?.salesData;
        const stockCheckData = Array.isArray(row?.stockCheckData)
          ? mergeById(row.stockCheckData, 'productId', ['openingStock', 'receivedStock', 'wastage', 'closingStock'])
          : row?.stockCheckData;
        const rawConsumption = Array.isArray(row?.rawConsumption)
          ? mergeById(row.rawConsumption, 'rawProductId', ['consumed'])
          : row?.rawConsumption;
        const prodsReqUpdates = Array.isArray(row?.prodsReqUpdates)
          ? mergeById(row.prodsReqUpdates, 'productId', ['prodsReqWhole', 'prodsReqSlices'])
          : row?.prodsReqUpdates;

        return {
          ...row,
          salesData,
          stockCheckData,
          rawConsumption,
          prodsReqUpdates,
          updatedAt: now,
        };
      });
    });

    await remapAndSave('@stock_app_live_inventory_snapshots', (rows) => {
      return rows.map((snapshot) => {
        if (!Array.isArray(snapshot?.items)) return snapshot;
        const map = new Map<string, any>();

        snapshot.items.forEach((item: any) => {
          const productId = String(item?.productId || '').trim();
          if (!productId) return;

          if (!map.has(productId)) {
            map.set(productId, {
              ...item,
              productId,
              outletStocks: mergeOutletStocks(Array.isArray(item?.outletStocks) ? item.outletStocks : []),
            });
            return;
          }

          const existing = map.get(productId)!;
          [
            'productionWhole',
            'productionSlices',
            'prodsReqWhole',
            'prodsReqSlices',
          ].forEach((field) => {
            existing[field] = Number(existing[field] || 0) + Number(item[field] || 0);
          });
          existing.outletStocks = mergeOutletStocks([
            ...(Array.isArray(existing.outletStocks) ? existing.outletStocks : []),
            ...(Array.isArray(item?.outletStocks) ? item.outletStocks : []),
          ]);
        });

        return { ...snapshot, items: Array.from(map.values()), updatedAt: now };
      });
    });

    await remapAndSave('@stock_app_recipes', (rows) => {
      const active = rows.filter((row) => !row?.deleted).map((row) => {
        const components = Array.isArray(row?.components) ? row.components : [];
        const componentMap = new Map<string, any>();
        components.forEach((component: any) => {
          const rawProductId = String(component?.rawProductId || '').trim();
          if (!rawProductId) return;
          if (!componentMap.has(rawProductId)) {
            componentMap.set(rawProductId, { ...component, rawProductId });
            return;
          }
          const existing = componentMap.get(rawProductId)!;
          existing.quantityPerUnit = Number(existing.quantityPerUnit || 0) + Number(component.quantityPerUnit || 0);
        });
        return { ...row, components: Array.from(componentMap.values()) };
      });
      const deleted = rows.filter((row) => row?.deleted);
      const keepByMenuProduct = new Map<string, any>();
      const tombstones: any[] = [];

      active.forEach((recipe) => {
        const key = String(recipe?.menuProductId || '').trim();
        if (!key) {
          tombstones.push({ ...recipe, deleted: true, updatedAt: now });
          return;
        }
        const existing = keepByMenuProduct.get(key);
        if (!existing) {
          keepByMenuProduct.set(key, recipe);
          return;
        }
        const keepCurrent = (recipe.updatedAt || 0) >= (existing.updatedAt || 0);
        if (keepCurrent) {
          tombstones.push({ ...existing, deleted: true, updatedAt: now });
          keepByMenuProduct.set(key, recipe);
        } else {
          tombstones.push({ ...recipe, deleted: true, updatedAt: now });
        }
      });

      const keep = Array.from(keepByMenuProduct.values()).map(item => ({ ...item, updatedAt: now }));
      return [...keep, ...deleted, ...tombstones];
    });

    await remapAndSave('@stock_app_linked_products', (rows) => {
      const active = rows.filter((row) => !row?.deleted).map((row) => {
        const components = Array.isArray(row?.components) ? row.components : [];
        const componentMap = new Map<string, any>();
        components.forEach((component: any) => {
          const kitchenProductId = String(component?.kitchenProductId || '').trim();
          if (!kitchenProductId) return;
          if (!componentMap.has(kitchenProductId)) {
            componentMap.set(kitchenProductId, { ...component, kitchenProductId });
            return;
          }
          const existing = componentMap.get(kitchenProductId)!;
          existing.quantityPerMenuUnit = Number(existing.quantityPerMenuUnit || 0) + Number(component.quantityPerMenuUnit || 0);
        });
        return { ...row, components: Array.from(componentMap.values()) };
      });
      const deleted = rows.filter((row) => row?.deleted);
      const keepByMenuProduct = new Map<string, any>();
      const tombstones: any[] = [];

      active.forEach((mapping) => {
        const key = String(mapping?.menuProductId || '').trim();
        if (!key) {
          tombstones.push({ ...mapping, deleted: true, updatedAt: now });
          return;
        }
        const existing = keepByMenuProduct.get(key);
        if (!existing) {
          keepByMenuProduct.set(key, mapping);
          return;
        }
        const keepCurrent = (mapping.updatedAt || 0) >= (existing.updatedAt || 0);
        if (keepCurrent) {
          tombstones.push({ ...existing, deleted: true, updatedAt: now });
          keepByMenuProduct.set(key, mapping);
        } else {
          tombstones.push({ ...mapping, deleted: true, updatedAt: now });
        }
      });

      const keep = Array.from(keepByMenuProduct.values()).map(item => ({ ...item, updatedAt: now }));
      return [...keep, ...deleted, ...tombstones];
    });

    await remapAndSave('@stock_app_orders', (rows) => {
      return rows.map((order) => {
        if (!Array.isArray(order?.products)) return order;
        const lines = new Map<string, any>();

        order.products.forEach((line: any) => {
          const productId = String(line?.productId || '').trim();
          if (!productId) return;
          const unit = String(line?.unit || '').trim();
          const key = `${productId}__${unit}`;

          if (!lines.has(key)) {
            lines.set(key, { ...line, productId, unit });
            return;
          }

          const existing = lines.get(key)!;
          existing.quantity = Number(existing.quantity || 0) + Number(line.quantity || 0);
        });

        return { ...order, products: Array.from(lines.values()), updatedAt: now };
      });
    });

    await remapAndSave('@stock_app_product_tracker_data', (rows) => {
      return rows.map((entry) => {
        if (!Array.isArray(entry?.movements)) return entry;
        const movementsMap = new Map<string, any>();
        entry.movements.forEach((movement: any) => {
          const productId = String(movement?.productId || '').trim();
          if (!productId) return;

          if (!movementsMap.has(productId)) {
            movementsMap.set(productId, { ...movement, productId });
            return;
          }

          const existing = movementsMap.get(productId)!;
          [
            'openingWhole',
            'openingSlices',
            'receivedWhole',
            'receivedSlices',
            'wastageWhole',
            'wastageSlices',
            'soldWhole',
            'soldSlices',
            'currentWhole',
            'currentSlices',
            'discrepancyWhole',
            'discrepancySlices',
          ].forEach((field) => {
            existing[field] = Number(existing[field] || 0) + Number(movement[field] || 0);
          });
        });

        return { ...entry, movements: Array.from(movementsMap.values()), timestamp: now };
      });
    });

    const reportKeys = [
      '@reconciliation_kitchen_stock_reports',
      '@reconciliation_sales_reports',
      '@reconciliation_pending_kitchen_stock_reports',
      '@reconciliation_pending_sales_reports',
      '@kitchen_stock_reports',
      '@sales_reports',
      '@pending_sync_queue',
    ];
    for (const key of reportKeys) {
      await remapAndSave(key);
    }

    try {
      const usageKey = '@stock_app_product_usage';
      const rawUsage = await AsyncStorage.getItem(usageKey);
      if (rawUsage) {
        const parsedUsage = JSON.parse(rawUsage) as Record<string, Record<string, { searchCount: number; usageCount: number; lastUsed: number }>>;
        const nextUsage: Record<string, Record<string, { searchCount: number; usageCount: number; lastUsed: number }>> = {};
        let changed = false;

        Object.entries(parsedUsage || {}).forEach(([userId, usageByProduct]) => {
          nextUsage[userId] = {};
          Object.entries(usageByProduct || {}).forEach(([productId, usage]) => {
            const mappedId = idMap.get(productId) || productId;
            if (mappedId !== productId) changed = true;

            if (!nextUsage[userId][mappedId]) {
              nextUsage[userId][mappedId] = { ...usage };
              return;
            }

            nextUsage[userId][mappedId] = {
              searchCount: Number(nextUsage[userId][mappedId].searchCount || 0) + Number(usage.searchCount || 0),
              usageCount: Number(nextUsage[userId][mappedId].usageCount || 0) + Number(usage.usageCount || 0),
              lastUsed: Math.max(Number(nextUsage[userId][mappedId].lastUsed || 0), Number(usage.lastUsed || 0)),
            };
          });
        });

        if (changed) {
          await AsyncStorage.setItem(usageKey, JSON.stringify(nextUsage));
          datasetsUpdated += 1;
        }
      }
    } catch (error) {
      console.warn('[RemoveDuplicates] Failed to remap product usage cache:', error);
    }

    return { datasetsUpdated, referencesRelinked };
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
      
      const storeDuplicates = new Map<string, typeof storeProducts[0][]>();
      
      storeProducts.forEach(product => {
        const key = `${product.name.toLowerCase().trim()}_${product.unit.toLowerCase().trim()}`;
        if (!storeDuplicates.has(key)) {
          storeDuplicates.set(key, []);
        }
        storeDuplicates.get(key)?.push(product);
      });
      
      const storeDuplicateEntries = Array.from(storeDuplicates.entries()).filter(([_, items]) => items.length > 1);
      
      const orphanedStoreProducts: typeof storeProducts = [];
      storeProducts.forEach(storeProduct => {
        const key = `${storeProduct.name.toLowerCase().trim()}_${storeProduct.unit.toLowerCase().trim()}`;
        const hasMatchingProduct = products.some(p => 
          `${p.name.toLowerCase().trim()}_${p.unit.toLowerCase().trim()}` === key
        );
        if (!hasMatchingProduct) {
          orphanedStoreProducts.push(storeProduct);
        }
      });
      
      if (duplicateEntries.length === 0 && storeDuplicateEntries.length === 0 && orphanedStoreProducts.length === 0) {
        Alert.alert('No Duplicates', 'No duplicate products or orphaned store products found.');
        return;
      }
      
      const removableCount = duplicateEntries.reduce((sum, [_, items]) => sum + (items.length - 1), 0);
      const storeRemovableCount = storeDuplicateEntries.reduce((sum, [_, items]) => sum + (items.length - 1), 0);
      
      let message = '';
      
      if (duplicateEntries.length > 0) {
        message += `Found ${duplicateEntries.length} duplicate product(s) with ${removableCount} duplicate entries in Products.\n\n`;
        const displayLimit = 5;
        duplicateEntries.slice(0, displayLimit).forEach(([key, items]) => {
          message += `• ${items[0].name} (${items[0].unit}) - ${items.length} copies\n`;
        });
        
        if (duplicateEntries.length > displayLimit) {
          message += `...and ${duplicateEntries.length - displayLimit} more\n`;
        }
      }
      
      if (storeDuplicateEntries.length > 0) {
        if (message) message += '\n';
        message += `Found ${storeDuplicateEntries.length} duplicate store product(s) with ${storeRemovableCount} duplicate entries in Stores.\n\n`;
        const displayLimit = 5;
        storeDuplicateEntries.slice(0, displayLimit).forEach(([key, items]) => {
          message += `• ${items[0].name} (${items[0].unit}) - ${items.length} copies\n`;
        });
        
        if (storeDuplicateEntries.length > displayLimit) {
          message += `...and ${storeDuplicateEntries.length - displayLimit} more\n`;
        }
      }
      
      if (orphanedStoreProducts.length > 0) {
        if (message) message += '\n';
        message += `Found ${orphanedStoreProducts.length} orphaned store product(s) (products in Stores that don\'t match any Product).\n\n`;
        const displayLimit = 5;
        orphanedStoreProducts.slice(0, displayLimit).forEach(item => {
          message += `• ${item.name} (${item.unit})\n`;
        });
        
        if (orphanedStoreProducts.length > displayLimit) {
          message += `...and ${orphanedStoreProducts.length - displayLimit} more\n`;
        }
      }
      
      message += '\nThe oldest entries will be kept. Connected references will be relinked to the kept product before deleting duplicates.';
      
      openConfirm({
        title: 'Remove Duplicates',
        message: message,
        destructive: true,
        testID: 'confirm-remove-duplicates',
        onConfirm: async () => {
          try {
            console.log('[RemoveDuplicates] Starting duplicate removal process...');
            console.log('[RemoveDuplicates] Total duplicates to process:', duplicateEntries.length);
            
            const now = Date.now();
            let removedProductDuplicates = 0;
            let removedStoreDuplicates = 0;
            let removedOrphanedStoreProducts = 0;
            const storeIdsToDelete: string[] = [];
            const idMap = new Map<string, string>();
            
            for (const [, items] of duplicateEntries) {
              const sortedByTimestamp = items.sort((a, b) => {
                const timeA = a.updatedAt || 0;
                const timeB = b.updatedAt || 0;
                return timeA - timeB;
              });
              
              const toKeep = sortedByTimestamp[0];
              const toRemove = sortedByTimestamp.slice(1);
              
              console.log(`[RemoveDuplicates] "${items[0].name}" - keeping oldest (${toKeep.id}), relinking ${toRemove.length} duplicates`);
              
              for (const product of toRemove) {
                idMap.set(product.id, toKeep.id);
              }
            }
            
            let relinkResult = { datasetsUpdated: 0, referencesRelinked: 0 };

            if (idMap.size > 0) {
              console.log(`[RemoveDuplicates] Marking ${idMap.size} duplicate products as deleted and relinking references...`);

              const updatedProducts = products.map(p =>
                idMap.has(p.id) ? { ...p, deleted: true as const, updatedAt: now } : p
              );
              await AsyncStorage.setItem('@stock_app_products', JSON.stringify(updatedProducts));
              removedProductDuplicates = idMap.size;

              relinkResult = await relinkProductReferences(idMap);
              console.log(
                `[RemoveDuplicates] Relinked ${relinkResult.referencesRelinked} references across ${relinkResult.datasetsUpdated} dataset(s).`
              );
            }
            
            for (const [, items] of storeDuplicateEntries) {
              const sortedByTimestamp = items.sort((a, b) => {
                const timeA = a.updatedAt || 0;
                const timeB = b.updatedAt || 0;
                return timeA - timeB;
              });
              
              const toKeep = sortedByTimestamp[0];
              const toRemove = sortedByTimestamp.slice(1);
              
              console.log(`[RemoveDuplicates] Store: "${items[0].name}" - keeping oldest (${toKeep.id}), removing ${toRemove.length} duplicates`);
              
              for (const product of toRemove) {
                storeIdsToDelete.push(product.id);
              }
            }
            
            if (storeIdsToDelete.length > 0) {
              console.log(`[RemoveDuplicates] Removing ${storeIdsToDelete.length} store product duplicates...`);
              for (const id of storeIdsToDelete) {
                await deleteStoreProduct(id);
              }
              removedStoreDuplicates = storeIdsToDelete.length;
            }
            
            if (orphanedStoreProducts.length > 0) {
              console.log(`[RemoveDuplicates] Removing ${orphanedStoreProducts.length} orphaned store products...`);
              
              // CRITICAL: Delete all orphaned store products at once and sync
              const storeIdsToRemove: string[] = [];
              orphanedStoreProducts.forEach(storeProduct => {
                storeIdsToRemove.push(storeProduct.id);
              });
              
              console.log(`[RemoveDuplicates] Deleting ${storeIdsToRemove.length} orphaned store products in batch...`);
              for (const id of storeIdsToRemove) {
                await deleteStoreProduct(id);
              }
              
              console.log(`[RemoveDuplicates] Waiting for store products sync to complete...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              removedOrphanedStoreProducts = orphanedStoreProducts.length;
            }
            
            console.log('[RemoveDuplicates] Waiting for sync...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const totalRemoved = removedProductDuplicates + removedStoreDuplicates + removedOrphanedStoreProducts;

            try {
              await syncAll(false);
              await syncRecipes(false);
              await syncOrders(false);
              console.log('[RemoveDuplicates] Sync completed');
            } catch (syncError) {
              console.error('[RemoveDuplicates] Sync failed:', syncError);
              Alert.alert(
                'Warning',
                `Applied duplicate cleanup locally (removed ${totalRemoved}). Some sync operations failed; please run manual sync.`
              );
              return;
            }
            
            let resultMessage = `Removed ${removedProductDuplicates} duplicate product(s).`;
            if (relinkResult.referencesRelinked > 0) {
              resultMessage += `\nRelinked ${relinkResult.referencesRelinked} reference(s) across ${relinkResult.datasetsUpdated} dataset(s).`;
            }
            if (removedStoreDuplicates > 0) resultMessage += `\nRemoved ${removedStoreDuplicates} duplicate store product(s).`;
            if (removedOrphanedStoreProducts > 0) resultMessage += `\nRemoved ${removedOrphanedStoreProducts} orphaned store product(s).`;
            
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

  const handleAttachProductPhoto = async (source: 'library' | 'camera') => {
    if (productImageUris.length >= MAX_PRODUCT_PHOTOS) {
      Alert.alert('Photo Limit Reached', `You can add up to ${MAX_PRODUCT_PHOTOS} photos per product.`);
      return;
    }

    const permissionResult = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.status !== 'granted') {
      Alert.alert(
        'Permission Denied',
        source === 'camera'
          ? 'Camera permission is required to take photos.'
          : 'Camera roll permission is required to upload images.'
      );
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.7,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.7,
        });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    try {
      setIsUploadingImage(true);
      const uploadedUrl = await uploadProductImageAsset(result.assets[0]);
      setProductImageUris((prev) => [...prev, uploadedUrl].slice(0, MAX_PRODUCT_PHOTOS));
    } catch (error) {
      console.error('Product image upload failed:', error);
      Alert.alert('Upload Failed', (error as Error).message || 'Failed to upload product photo.');
    } finally {
      setIsUploadingImage(false);
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
                        {sorted.map((product) => {
                          const imageUris = getProductImageUris(product);
                          const primaryImageUri = imageUris[0];
                          return (
                            <View key={product.id} style={styles.productCard}>
                              <View style={styles.productCardContent}>
                                {primaryImageUri && (
                                  <Image
                                    source={{ uri: primaryImageUri }}
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
                                  <View style={styles.queueToggleRow}>
                                    <View style={styles.queueToggleInline}>
                                      <Text style={styles.queueToggleLabel}>KOT</Text>
                                      <Switch
                                        value={product.kotEnabled === true}
                                        onValueChange={(value) => {
                                          updateProduct(product.id, { kotEnabled: value }).catch(() => {});
                                        }}
                                        trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                                        thumbColor={Colors.light.card}
                                      />
                                    </View>
                                    <View style={styles.queueToggleInline}>
                                      <Text style={styles.queueToggleLabel}>BOT</Text>
                                      <Switch
                                        value={product.botEnabled === true}
                                        onValueChange={(value) => {
                                          updateProduct(product.id, { botEnabled: value }).catch(() => {});
                                        }}
                                        trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                                        thumbColor={Colors.light.card}
                                      />
                                    </View>
                                  </View>
                                  {imageUris.length > 1 && (
                                    <Text style={styles.productCardCategory}>{imageUris.length} photos</Text>
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
                          );
                        })}
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
                {Platform.OS === 'web' ? (
                  <View style={styles.pickerContainer}>
                    <select
                      value={productCategory}
                      onChange={(e: any) => setProductCategory(String(e.target.value || ''))}
                      style={styles.webSelect as any}
                    >
                      <option value="">No category</option>
                      {availableProductCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.input}
                    onPress={selectProductCategory}
                  >
                    <Text style={productCategory ? styles.selectValueText : styles.selectPlaceholderText}>
                      {productCategory || (availableProductCategories.length > 0 ? 'Select category' : 'No categories added in Settings')}
                    </Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.inputHelperText}>
                  Manage this dropdown from Settings {'>'} Product Categories.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Product Description (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textAreaInput]}
                  value={productDescription}
                  onChangeText={setProductDescription}
                  placeholder="Enter a short product description"
                  placeholderTextColor={Colors.light.muted}
                  multiline
                  textAlignVertical="top"
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
                <Text style={styles.inputLabel}>Kitchen Queue Routing</Text>
                <View style={styles.switchContainer}>
                  <Text style={styles.switchLabel}>Send this product to the KOT queue when a sale is parked or completed</Text>
                  <Switch
                    value={productKOTEnabled}
                    onValueChange={setProductKOTEnabled}
                    trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                    thumbColor={Colors.light.card}
                  />
                </View>
                <View style={styles.switchContainer}>
                  <Text style={styles.switchLabel}>Send this product to the BOT queue when a sale is parked or completed</Text>
                  <Switch
                    value={productBOTEnabled}
                    onValueChange={setProductBOTEnabled}
                    trackColor={{ false: Colors.light.border, true: Colors.light.tint }}
                    thumbColor={Colors.light.card}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Product Photos (Optional, up to 3)</Text>
                {productImageUris.length > 0 ? (
                  <View style={styles.imagePreviewGrid}>
                    {productImageUris.map((imageUri, index) => (
                      <View key={`${imageUri}-${index}`} style={styles.imagePreviewItem}>
                        <Image
                          source={{ uri: imageUri }}
                          style={styles.imagePreview}
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          style={styles.removeImageButton}
                          onPress={() => setProductImageUris((prev) => prev.filter((_, imageIndex) => imageIndex !== index))}
                        >
                          <X size={18} color={Colors.light.card} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.imageButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.imageButton, productImageUris.length >= MAX_PRODUCT_PHOTOS && styles.imageButtonDisabled]}
                    onPress={() => handleAttachProductPhoto('camera')}
                    disabled={productImageUris.length >= MAX_PRODUCT_PHOTOS || isUploadingImage}
                  >
                    <Camera size={20} color={productImageUris.length >= MAX_PRODUCT_PHOTOS ? Colors.light.muted : Colors.light.tint} />
                    <Text style={[styles.imageButtonText, productImageUris.length >= MAX_PRODUCT_PHOTOS && styles.disabledText]}>
                      Take Photo
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.imageButton, productImageUris.length >= MAX_PRODUCT_PHOTOS && styles.imageButtonDisabled]}
                    onPress={() => handleAttachProductPhoto('library')}
                    disabled={productImageUris.length >= MAX_PRODUCT_PHOTOS || isUploadingImage}
                  >
                    <ImageI size={20} color={productImageUris.length >= MAX_PRODUCT_PHOTOS ? Colors.light.muted : Colors.light.tint} />
                    <Text style={[styles.imageButtonText, productImageUris.length >= MAX_PRODUCT_PHOTOS && styles.disabledText]}>
                      Choose from Library
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.imageHelperText}>
                  {isUploadingImage
                    ? 'Uploading photo...'
                    : `${productImageUris.length}/${MAX_PRODUCT_PHOTOS} photos attached. Uploaded photos sync across devices.`}
                </Text>
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
    gap: 2,
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
  queueToggleRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  queueToggleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queueToggleLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.text,
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
  pickerContainer: {
    width: '100%',
  },
  webSelect: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.light.text,
    width: '100%',
  },
  selectValueText: {
    fontSize: 16,
    color: Colors.light.text,
  },
  selectPlaceholderText: {
    fontSize: 16,
    color: Colors.light.muted,
  },
  inputHelperText: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.light.muted,
  },
  textAreaInput: {
    minHeight: 88,
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
  imagePreviewGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
  },
  imagePreviewItem: {
    position: 'relative' as const,
    width: 120,
    height: 90,
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
  imageButtonDisabled: {
    opacity: 0.6,
  },
  imageButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  imageHelperText: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 8,
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
