import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput, Modal, Image, Switch, Clipboard as RNClipboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { Upload, Trash2, Settings as SettingsIcon, FileSpreadsheet, Store, Plus, Edit2, X, Package, LogOut, Users as UsersIcon, Camera, ImageIcon, RefreshCw, CloudOff, Cloud, Share2, Link, Pause, Play, ChevronDown, ChevronUp, Mail, Save, Check, Download } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActivityLog } from '@/contexts/ActivityLogContext';
import { useMoir } from '@/contexts/MoirContext';

import { useCustomers } from '@/contexts/CustomerContext';
import { useOrders } from '@/contexts/OrderContext';
import { useStores } from '@/contexts/StoresContext';
import { useProduction } from '@/contexts/ProductionContext';
import { trpcClient } from '@/lib/trpc';
import { syncData } from '@/utils/syncManager';
import { useRecipes } from '@/contexts/RecipeContext';
import { useProductUsage } from '@/contexts/ProductUsageContext';
import { Outlet, Product, ProductType, UserRole, ProductConversion } from '@/types';
import { hasPermission } from '@/utils/permissions';
import { parseExcelFile, generateSampleExcelBase64 } from '@/utils/excelParser';
import Colors from '@/constants/colors';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import * as XLSX from 'xlsx';
import { CURRENCIES } from '@/utils/currencyHelper';

const CAMPAIGN_SETTINGS_KEY = '@campaign_settings';

export default function SettingsScreen() {
  const { products, outlets, productConversions, addProduct, updateProduct, deleteProduct, addOutlet, updateOutlet, deleteOutlet, addProductConversion, updateProductConversion, deleteProductConversion, clearAllProducts, clearAllOutlets, deleteUserStockChecks, isLoading, isSyncing: isStockSyncing, lastSyncTime: stockLastSync, syncAll, isSyncPaused, toggleSyncPause, viewMode, setViewMode } = useStock();

  const { currentUser, users, logout, addUser, updateUser, deleteUser, isSyncing: isUserSyncing, lastSyncTime: userLastSync, syncUsers, clearAllUsers, isSuperAdmin, showPageTabs, toggleShowPageTabs, currency, updateCurrency } = useAuth();
  const { isSyncing: isCustomerSyncing, lastSyncTime: customerLastSync, syncCustomers } = useCustomers();
  const { isSyncing: isRecipeSyncing, lastSyncTime: recipeLastSync, syncRecipes } = useRecipes();
  const { isSyncing: isOrderSyncing, lastSyncTime: orderLastSync, syncOrders } = useOrders();
  const { isSyncing: isStoresSyncing, lastSyncTime: storesLastSync, syncAll: syncStores, setUser: setStoresUser } = useStores();
  const { isSyncing: isProductionSyncing, lastSyncTime: productionLastSync, syncAll: syncProduction, setUser: setProductionUser } = useProduction();
  const { deleteUserData } = useProductUsage();
  const { clearAllLogs } = useActivityLog();
  const { users: moirUsers, importUsersFromExcel: importMoirUsers, clearAllUsers: clearAllMoirUsers, syncAllData: syncMoirData } = useMoir();
  const router = useRouter();
  const [showOutletModal, setShowOutletModal] = useState<boolean>(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);
  const [outletName, setOutletName] = useState<string>('');
  const [outletLocation, setOutletLocation] = useState<string>('');
  const [outletType, setOutletType] = useState<'sales' | 'production'>('sales');
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
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [confirmVisible, setConfirmVisible] = useState<boolean>(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    onConfirm: () => Promise<void> | void;
    testID: string;
  } | null>(null);
  const [editingUser, setEditingUser] = useState<{ id: string; username: string; role: UserRole } | null>(null);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('user');
  const [showSyncCodeModal, setShowSyncCodeModal] = useState<boolean>(false);
  const [syncCode, setSyncCode] = useState<string>('');
  const [importSyncCode, setImportSyncCode] = useState<string>('');
  const [showConversionModal, setShowConversionModal] = useState<boolean>(false);
  const [editingConversion, setEditingConversion] = useState<ProductConversion | null>(null);
  const [conversionFromProductId, setConversionFromProductId] = useState<string>('');
  const [conversionToProductId, setConversionToProductId] = useState<string>('');
  const [conversionFactor, setConversionFactor] = useState<string>('');
  const [usersExpanded, setUsersExpanded] = useState<boolean>(true);
  const [outletsExpanded, setOutletsExpanded] = useState<boolean>(true);
  const [standardsExpanded, setStandardsExpanded] = useState<boolean>(false);
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false);
  const [showUnitModal, setShowUnitModal] = useState<boolean>(false);
  const [showProductTypeModal, setShowProductTypeModal] = useState<boolean>(false);
  const [moirExpanded, setMoirExpanded] = useState<boolean>(false);
  const [isImportingMoir, setIsImportingMoir] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<string | null>(null);
  const [editingProductType, setEditingProductType] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string>('');
  const [unitName, setUnitName] = useState<string>('');
  const [productTypeName, setProductTypeName] = useState<string>('');
  const [campaignsExpanded, setCampaignsExpanded] = useState<boolean>(false);
  const [emailApiKey, setEmailApiKey] = useState<string>('');
  const [emailApiProvider, setEmailApiProvider] = useState<'sendgrid' | 'aws-ses' | 'smtp'>('smtp');
  const [smsApiKey, setSmsApiKey] = useState<string>('');
  const [smsApiUrl, setSmsApiUrl] = useState<string>('https://app.notify.lk/api/v1/send');
  const [smtpHost, setSmtpHost] = useState<string>('');
  const [smtpPort, setSmtpPort] = useState<string>('587');
  const [smtpUsername, setSmtpUsername] = useState<string>('');
  const [smtpPassword, setSmtpPassword] = useState<string>('');
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [isTestingEmail, setIsTestingEmail] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  useEffect(() => {
    loadCampaignSettings();
  }, []);

  const loadCampaignSettings = async () => {
    try {
      const settings = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        setEmailApiKey(parsed.emailApiKey || '');
        setEmailApiProvider(parsed.emailApiProvider || 'smtp');
        setSmsApiKey(parsed.smsApiKey || '');
        setSmsApiUrl(parsed.smsApiUrl || 'https://app.notify.lk/api/v1/send');
        setSmtpHost(parsed.smtpHost || '');
        setSmtpPort(parsed.smtpPort || '587');
        setSmtpUsername(parsed.smtpUsername || '');
        setSmtpPassword(parsed.smtpPassword || '');
      }
    } catch (error) {
      console.error('Failed to load campaign settings:', error);
    }
  };

  const saveCampaignSettings = async () => {
    try {
      setIsSavingSettings(true);
      setConnectionStatus(null);
      const settings = {
        emailApiKey,
        emailApiProvider,
        smsApiKey,
        smsApiUrl,
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        updatedAt: Date.now(),
        id: 'campaign_settings',
      };
      
      await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(settings));
      
      if (currentUser) {
        try {
          await syncData('campaign_settings', [settings], currentUser.id);
          setConnectionStatus({ type: 'success', message: 'Settings saved and synced successfully' });
        } catch (syncError) {
          console.error('Failed to sync campaign settings:', syncError);
          setConnectionStatus({ type: 'error', message: 'Settings saved locally but sync failed' });
        }
      } else {
        setConnectionStatus({ type: 'success', message: 'Settings saved successfully' });
      }
    } catch (error) {
      console.error('Failed to save campaign settings:', error);
      setConnectionStatus({ type: 'error', message: 'Failed to save campaign settings' });
    } finally {
      setIsSavingSettings(false);
    }
  };
  
  const testEmailConnection = async () => {
    if (!smtpHost || !smtpUsername || !smtpPassword) {
      setConnectionStatus({ type: 'error', message: 'Please fill in all SMTP settings before testing' });
      return;
    }
    
    try {
      setIsTestingEmail(true);
      setConnectionStatus(null);
      
      const result = await trpcClient.campaigns.testEmail.mutate({
        smtpConfig: {
          host: smtpHost,
          port: parseInt(smtpPort, 10),
          auth: {
            user: smtpUsername,
            pass: smtpPassword,
          },
        },
        testEmail: smtpUsername,
      });
      
      setConnectionStatus({ type: 'success', message: 'Successfully connected! Test email sent to ' + smtpUsername });
    } catch (error) {
      console.error('Email connection test failed:', error);
      setConnectionStatus({
        type: 'error',
        message: 'Connection not successful: ' + (error instanceof Error ? error.message : 'Unknown error')
      });
    } finally {
      setIsTestingEmail(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      setStoresUser(currentUser);
      setProductionUser(currentUser);
    }
  }, [currentUser, setStoresUser, setProductionUser]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  const isSyncing = isStockSyncing || isUserSyncing || isCustomerSyncing || isRecipeSyncing || isOrderSyncing || isStoresSyncing || isProductionSyncing;
  const lastSyncTime = Math.max(stockLastSync || 0, userLastSync || 0, customerLastSync || 0, recipeLastSync || 0, orderLastSync || 0, storesLastSync || 0, productionLastSync || 0);

  const formatLastSync = (timestamp: number) => {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const openConfirm = (cfg: { title: string; message: string; destructive?: boolean; onConfirm: () => Promise<void> | void; testID: string }) => {
    setConfirmState(cfg);
    setConfirmVisible(true);
  };

  const handleClearAllProducts = () => {
    openConfirm({
      title: 'Clear All Products',
      message:
        'This will delete ALL products and Product Unit Conversions from this device and the server. This action cannot be undone.',
      destructive: true,
      testID: 'confirm-clear-products',
      onConfirm: async () => {
        try {
          await clearAllProducts();
          const conversionIds = productConversions.map(c => c.id);
          for (const id of conversionIds) {
            await deleteProductConversion(id);
          }
          Alert.alert('Success', 'All products and Product Unit Conversions have been cleared from this device and the server.');
        } catch (error) {
          Alert.alert('Error', 'Failed to clear products. Please try again.');
        }
      },
    });
  };

  const handleClearAllUsers = () => {
    openConfirm({
      title: 'Clear All Users',
      message:
        'This will delete ALL users (except the default Admin account) from this device and the server. This action cannot be undone.',
      destructive: true,
      testID: 'confirm-clear-users',
      onConfirm: async () => {
        try {
          await clearAllUsers();
          Alert.alert('Success', 'All users have been cleared from this device and the server.');
        } catch (error) {
          Alert.alert('Error', 'Failed to clear users. Please try again.');
        }
      },
    });
  };

  const handleClearAllOutlets = () => {
    openConfirm({
      title: 'Clear All Outlets',
      message:
        'This will delete ALL outlets from this device and the server. This action cannot be undone.',
      destructive: true,
      testID: 'confirm-clear-outlets',
      onConfirm: async () => {
        try {
          await clearAllOutlets();
          Alert.alert('Success', 'All outlets have been cleared from this device and the server.');
        } catch (error) {
          Alert.alert('Error', 'Failed to clear outlets. Please try again.');
        }
      },
    });
  };

  const handleManualSync = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'Please login to sync data.');
      return;
    }

    try {
      console.log('[SETTINGS] Manual sync - Syncing all data from server immediately...');
      
      let successCount = 0;
      let failCount = 0;
      
      const syncOperations = [
        { fn: () => syncAll(false), name: 'Stock Data' },
        { fn: () => syncUsers(undefined, false), name: 'Users' },
        { fn: syncCustomers, name: 'Customers' },
        { fn: syncRecipes, name: 'Recipes' },
        { fn: syncOrders, name: 'Orders' },
        { fn: syncStores, name: 'Stores & GRN' },
        { fn: syncProduction, name: 'Production' },
        { fn: syncMoirData, name: 'MOIR Data' },
      ];
      
      console.log('[SETTINGS] Executing', syncOperations.length, 'sync operations...');
      
      for (const { fn, name } of syncOperations) {
        try {
          console.log(`[SETTINGS] Syncing ${name}...`);
          await fn();
          successCount++;
          console.log(`[SETTINGS] ✓ ${name} synced successfully`);
          await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
        } catch (e) {
          console.error(`[SETTINGS] ✗ Sync failed for ${name}:`, e);
          failCount++;
        }
      }

      if (failCount > 0) {
        Alert.alert(
          'Partial Success',
          `${successCount} out of ${syncOperations.length} data types synced successfully.`
        );
      } else {
        Alert.alert('Success', 'All data synced successfully from server.');
      }
      
      console.log('[SETTINGS] Manual sync complete - Success:', successCount, 'Failed:', failCount);
    } catch (error) {
      console.error('[SETTINGS] Manual sync error:', error);
      Alert.alert('Sync Failed', 'Failed to sync data. Please check your internet connection and try again.');
    }
  };

  console.log('Settings render - isLoading:', isLoading, 'campaignsExpanded:', campaignsExpanded);
  console.log('Settings colors:', Colors.light.background, Colors.light.text, Colors.light.tint);
  
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Multi-Device Sync Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          {isSyncing ? (
            <Cloud size={24} color={Colors.light.tint} />
          ) : (
            <CloudOff size={24} color={Colors.light.muted} />
          )}
          <Text style={styles.sectionTitle}>Multi-Device Sync</Text>
        </View>

        <View style={styles.statsCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Sync Status</Text>
            <Text style={[styles.statValue, { color: isSyncing ? Colors.light.success || '#10B981' : isSyncPaused ? Colors.light.warning || '#F59E0B' : Colors.light.muted }]}>
              {isSyncing ? <Text>Syncing...</Text> : isSyncPaused ? <Text>Paused</Text> : <Text>Idle</Text>}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Last Synced</Text>
            <Text style={styles.statValue}>{formatLastSync(lastSyncTime)}</Text>
          </View>
        </View>

        <View style={styles.syncInfoCard}>
          <Text style={styles.syncInfoText}>
            {isSyncPaused 
              ? 'Auto-sync is paused. Manual sync is still available. Resume to enable automatic syncing every 1 minute.'
              : 'Your products, outlets, users, customers, recipes, and MOIR attendance users automatically sync every 1 minute across all your devices.'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleManualSync}
          disabled={isSyncing || !hasPermission(currentUser?.role, 'enableSync')}
        >
          {isSyncing ? (
            <ActivityIndicator color={Colors.light.card} />
          ) : (
            <>
              <RefreshCw size={20} color={Colors.light.card} />
              <Text style={styles.buttonText}>Sync Now</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* User Data Section */}
      {isAdmin && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setUsersExpanded(!usersExpanded)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <UsersIcon size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>User Data ({users.length})</Text>
            </View>
            {usersExpanded ? (
              <ChevronUp size={20} color={Colors.light.tint} />
            ) : (
              <ChevronDown size={20} color={Colors.light.tint} />
            )}
          </TouchableOpacity>

          {usersExpanded && (
            <>
              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  Manage app users and their access levels.
                </Text>
              </View>

              {users.map((user) => (
                <View key={user.id} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle}>{user.username}</Text>
                    <Text style={styles.listItemSubtitle}>
                      Role: {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </Text>
                  </View>
                  {hasPermission(currentUser?.role, 'manageUsers') && user.id !== currentUser?.id && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingUser(user);
                          setNewUsername(user.username);
                          setNewUserRole(user.role);
                          setShowUserModal(true);
                        }}
                      >
                        <Edit2 size={20} color={Colors.light.tint} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          openConfirm({
                            title: 'Delete User',
                            message: `Are you sure you want to delete ${user.username}?`,
                            destructive: true,
                            testID: 'confirm-delete-user',
                            onConfirm: async () => {
                              try {
                                await deleteUser(user.id);
                                await deleteUserData(user.id);
                                Alert.alert('Success', 'User deleted successfully');
                              } catch (error) {
                                Alert.alert('Error', 'Failed to delete user');
                              }
                            },
                          });
                        }}
                      >
                        <Trash2 size={20} color={Colors.light.danger} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}

              {hasPermission(currentUser?.role, 'manageUsers') && (
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton]}
                  onPress={() => {
                    setEditingUser(null);
                    setNewUsername('');
                    setNewUserRole('user');
                    setShowUserModal(true);
                  }}
                >
                  <Plus size={20} color={Colors.light.card} />
                  <Text style={styles.buttonText}>Add User</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      {/* Outlets Section */}
      {isAdmin && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setOutletsExpanded(!outletsExpanded)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Store size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>Outlets ({outlets.length})</Text>
            </View>
            {outletsExpanded ? (
              <ChevronUp size={20} color={Colors.light.tint} />
            ) : (
              <ChevronDown size={20} color={Colors.light.tint} />
            )}
          </TouchableOpacity>

          {outletsExpanded && (
            <>
              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  Manage sales and production outlets.
                </Text>
              </View>

              {outlets.map((outlet) => (
                <View key={outlet.id} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle}>{outlet.name}</Text>
                    <Text style={styles.listItemSubtitle}>
                      {outlet.location} • {outlet.outletType ? outlet.outletType.charAt(0).toUpperCase() + outlet.outletType.slice(1) : 'N/A'}
                    </Text>
                  </View>
                  {hasPermission(currentUser?.role, 'manageOutlets') && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingOutlet(outlet);
                          setOutletName(outlet.name);
                          setOutletLocation(outlet.location || '');
                          setOutletType(outlet.outletType || 'sales');
                          setShowOutletModal(true);
                        }}
                      >
                        <Edit2 size={20} color={Colors.light.tint} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          openConfirm({
                            title: 'Delete Outlet',
                            message: `Are you sure you want to delete ${outlet.name}?`,
                            destructive: true,
                            testID: 'confirm-delete-outlet',
                            onConfirm: async () => {
                              try {
                                await deleteOutlet(outlet.id);
                                Alert.alert('Success', 'Outlet deleted successfully');
                              } catch (error) {
                                Alert.alert('Error', 'Failed to delete outlet');
                              }
                            },
                          });
                        }}
                      >
                        <Trash2 size={20} color={Colors.light.danger} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}

              {hasPermission(currentUser?.role, 'manageOutlets') && (
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton]}
                  onPress={() => {
                    setEditingOutlet(null);
                    setOutletName('');
                    setOutletLocation('');
                    setOutletType('sales');
                    setShowOutletModal(true);
                  }}
                >
                  <Plus size={20} color={Colors.light.card} />
                  <Text style={styles.buttonText}>Add Outlet</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      {/* Moir Section */}
      {isSuperAdmin && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setMoirExpanded(!moirExpanded)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <UsersIcon size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>Moir ({moirUsers.length})</Text>
            </View>
            {moirExpanded ? (
              <ChevronUp size={20} color={Colors.light.tint} />
            ) : (
              <ChevronDown size={20} color={Colors.light.tint} />
            )}
          </TouchableOpacity>

          {moirExpanded && (
            <>
              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  Manage MOIR attendance users.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => router.push('/moir')}
              >
                <UsersIcon size={20} color={Colors.light.tint} />
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Open Moir</Text>
              </TouchableOpacity>

              {moirUsers.slice(0, 5).map((user) => (
                <View key={user.id} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle}>{user.name}</Text>
                    <Text style={styles.listItemSubtitle}>Phone: {user.phoneNumber || 'N/A'}</Text>
                  </View>
                </View>
              ))}

              {moirUsers.length > 5 && (
                <Text style={styles.listItemSubtitle}>
                  ... and {moirUsers.length - 5} more users
                </Text>
              )}

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={async () => {
                  try {
                    const headers = ['Name', 'Phone Number', 'Emergency Phone', 'Emergency Person', 'Allergies', 'Medication', 'Other Details'];
                    const data = moirUsers.map(u => [
                      u.name || '',
                      u.phoneNumber || '',
                      u.emergencyPhoneNumber || '',
                      u.emergencyPerson || '',
                      u.allergies || '',
                      u.medication || '',
                      u.otherDetails || ''
                    ]);
                    
                    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Moir Users');
                    
                    const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
                    
                    if (Platform.OS === 'web') {
                      const blob = new Blob([Uint8Array.from(atob(wbout), c => c.charCodeAt(0))], {
                        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `moir_users_${new Date().toISOString().split('T')[0]}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } else {
                      const fileUri = `${FileSystem.documentDirectory}moir_users_${new Date().toISOString().split('T')[0]}.xlsx`;
                      await FileSystem.writeAsStringAsync(fileUri, wbout, {
                        encoding: FileSystem.EncodingType.Base64,
                      });
                      await Sharing.shareAsync(fileUri, {
                        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        dialogTitle: 'Export Moir Users',
                        UTI: 'com.microsoft.excel.xlsx',
                      });
                    }
                    
                    Alert.alert('Success', 'Moir users exported successfully');
                  } catch (error) {
                    console.error('Export error:', error);
                    Alert.alert('Error', 'Failed to export Moir users');
                  }
                }}
              >
                <Download size={20} color={Colors.light.tint} />
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Export Excel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={async () => {
                  try {
                    setIsImportingMoir(true);
                    const result = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'] });
                    if (result.assets && result.assets.length > 0) {
                      const fileUri = result.assets[0].uri;
                      let fileContent: string;
                      if (Platform.OS === 'web') {
                        const response = await fetch(fileUri);
                        const blob = await response.blob();
                        fileContent = await new Promise((resolve) => {
                          const reader = new FileReader();
                          reader.onloadend = () => resolve(reader.result as string);
                          reader.readAsDataURL(blob);
                        });
                      } else {
                        fileContent = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
                      }
                      const base64 = fileContent.split(',')[1] || fileContent;
                      
                      const workbook = XLSX.read(base64, { type: 'base64' });
                      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                      const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
                      
                      const usersData = data
                        .slice(1)
                        .filter((row: any) => row && row[0])
                        .map((row: any) => ({
                          name: String(row[0] || '').trim(),
                          phoneNumber: row[1] ? String(row[1]).trim() : undefined,
                          emergencyPhoneNumber: row[2] ? String(row[2]).trim() : undefined,
                          emergencyPerson: row[3] ? String(row[3]).trim() : undefined,
                          allergies: row[4] ? String(row[4]).trim() : undefined,
                          medication: row[5] ? String(row[5]).trim() : undefined,
                          otherDetails: row[6] ? String(row[6]).trim() : undefined,
                        }));
                      
                      await importMoirUsers(usersData);
                      Alert.alert('Success', 'MOIR users imported/updated successfully');
                    }
                  } catch (error) {
                    Alert.alert('Error', 'Failed to import MOIR users');
                  } finally {
                    setIsImportingMoir(false);
                  }
                }}
                disabled={isImportingMoir}
              >
                {isImportingMoir ? (
                  <ActivityIndicator color={Colors.light.card} />
                ) : (
                  <>
                    <Upload size={20} color={Colors.light.card} />
                    <Text style={styles.buttonText}>Import Excel</Text>
                  </>
                )}
              </TouchableOpacity>

              {isSuperAdmin && moirUsers.length > 0 && (
                <TouchableOpacity
                  style={[styles.button, styles.dangerButton]}
                  onPress={() => {
                    openConfirm({
                      title: 'Clear All MOIR Users',
                      message: 'This will delete ALL MOIR users from this device and the server. This action cannot be undone.',
                      destructive: true,
                      testID: 'confirm-clear-moir',
                      onConfirm: async () => {
                        try {
                          await clearAllMoirUsers();
                          Alert.alert('Success', 'All MOIR users have been cleared');
                        } catch (error) {
                          Alert.alert('Error', 'Failed to clear MOIR users');
                        }
                      },
                    });
                  }}
                >
                  <Trash2 size={20} color={Colors.light.card} />
                  <Text style={styles.buttonText}>Clear All MOIR Users</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      {/* Campaign Services Section */}
      {isSuperAdmin && (
        <View style={styles.section}>
          <TouchableOpacity 
            style={styles.sectionHeader}
            onPress={() => setCampaignsExpanded(!campaignsExpanded)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Mail size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>Campaign Services</Text>
            </View>
            {campaignsExpanded ? (
              <ChevronUp size={20} color={Colors.light.tint} />
            ) : (
              <ChevronDown size={20} color={Colors.light.tint} />
            )}
          </TouchableOpacity>

          {campaignsExpanded && (
            <>
              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  Configure email and SMS service settings for bulk campaigns.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={() => router.push('/campaigns')}
              >
                <Mail size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>Open Campaign Manager</Text>
              </TouchableOpacity>

              <Text style={styles.sectionSubtitle}>Email Service Configuration</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email Service Provider</Text>
                <View style={styles.pickerContainer}>
                  {Platform.OS === 'web' ? (
                    <select
                      value={emailApiProvider}
                      onChange={(e: any) => setEmailApiProvider(e.target.value)}
                      style={{
                        backgroundColor: Colors.light.background,
                        borderWidth: 1,
                        borderColor: Colors.light.border,
                        borderRadius: 8,
                        padding: 12,
                        fontSize: 16,
                        color: Colors.light.text,
                        width: '100%',
                      }}
                    >
                      <option value="smtp"><Text>SMTP</Text></option>
                      <option value="sendgrid"><Text>SendGrid</Text></option>
                      <option value="aws-ses"><Text>AWS SES</Text></option>
                    </select>
                  ) : (
                    <TouchableOpacity
                      style={styles.input}
                      onPress={() => {
                        Alert.alert(
                          'Select Email Provider',
                          '',
                          [
                            { text: 'SMTP', onPress: () => setEmailApiProvider('smtp') },
                            { text: 'SendGrid', onPress: () => setEmailApiProvider('sendgrid') },
                            { text: 'AWS SES', onPress: () => setEmailApiProvider('aws-ses') },
                            { text: 'Cancel', style: 'cancel' as const }
                          ]
                        );
                      }}
                    >
                      <Text style={{ color: Colors.light.text }}>
                        {emailApiProvider === 'smtp' ? 'SMTP' : emailApiProvider === 'sendgrid' ? 'SendGrid' : emailApiProvider === 'aws-ses' ? 'AWS SES' : 'SMTP'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {emailApiProvider === 'smtp' ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>SMTP Host *</Text>
                    <TextInput
                      style={styles.input}
                      value={smtpHost}
                      onChangeText={setSmtpHost}
                      placeholder="smtp.gmail.com"
                      placeholderTextColor={Colors.light.muted}
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>SMTP Port *</Text>
                    <TextInput
                      style={styles.input}
                      value={smtpPort}
                      onChangeText={setSmtpPort}
                      placeholder="587"
                      placeholderTextColor={Colors.light.muted}
                      keyboardType="numeric"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>SMTP Username/Email *</Text>
                    <TextInput
                      style={styles.input}
                      value={smtpUsername}
                      onChangeText={setSmtpUsername}
                      placeholder="your@email.com"
                      placeholderTextColor={Colors.light.muted}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>SMTP Password *</Text>
                    <TextInput
                      style={styles.input}
                      value={smtpPassword}
                      onChangeText={setSmtpPassword}
                      placeholder="Enter your SMTP password"
                      placeholderTextColor={Colors.light.muted}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                  </View>

                  <View style={styles.syncInfoCard}>
                    <Text style={styles.syncInfoText}>
                      <Text>For Gmail: Use your email and App Password (not regular password){'\n'}For other providers: Use provided SMTP credentials{'\n'}Common ports: 587 (TLS), 465 (SSL), 25 (unsecured)</Text>
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Email API Key</Text>
                    <TextInput
                      style={styles.input}
                      value={emailApiKey}
                      onChangeText={setEmailApiKey}
                      placeholder="Enter your email service API key"
                      placeholderTextColor={Colors.light.muted}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                  </View>

                  <View style={styles.syncInfoCard}>
                    <Text style={styles.syncInfoText}>
                      <Text>For SendGrid: Get your API key from https://app.sendgrid.com/settings/api_keys{'\n'}For AWS SES: Configure AWS credentials in your backend</Text>
                    </Text>
                  </View>
                </>
              )}

              <Text style={styles.sectionSubtitle}>SMS Service Configuration</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>SMS API URL</Text>
                <TextInput
                  style={styles.input}
                  value={smsApiUrl}
                  onChangeText={setSmsApiUrl}
                  placeholder="https://app.notify.lk/api/v1/send"
                  placeholderTextColor={Colors.light.muted}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>SMS API Key</Text>
                <TextInput
                  style={styles.input}
                  value={smsApiKey}
                  onChangeText={setSmsApiKey}
                  placeholder="Enter your SMS service API key"
                  placeholderTextColor={Colors.light.muted}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  The current SMS API key is pre-configured for Notify.lk service.
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton, { flex: 1 }]}
                  onPress={saveCampaignSettings}
                  disabled={isSavingSettings}
                >
                  {isSavingSettings ? (
                    <ActivityIndicator size="small" color={Colors.light.card} />
                  ) : (
                    <>
                      <RefreshCw size={20} color={Colors.light.card} />
                      <Text style={styles.buttonText}>Save & Sync</Text>
                    </>
                  )}
                </TouchableOpacity>
                
                {emailApiProvider === 'smtp' && (
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton, { flex: 1 }]}
                    onPress={testEmailConnection}
                    disabled={isTestingEmail || !smtpHost || !smtpUsername || !smtpPassword}
                  >
                    {isTestingEmail ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <>
                        <Mail size={20} color={Colors.light.tint} />
                        <Text style={[styles.buttonText, styles.secondaryButtonText]}>Test</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {connectionStatus && (
                <View style={[
                  styles.statusMessage,
                  connectionStatus.type === 'success' ? styles.successMessage : styles.errorMessage
                ]}>
                  {connectionStatus.type === 'success' ? (
                    <Check size={16} color="#10B981" />
                  ) : (
                    <X size={16} color="#EF4444" />
                  )}
                  <Text style={[
                    styles.statusMessageText,
                    connectionStatus.type === 'success' ? styles.successMessageText : styles.errorMessageText
                  ]}>
                    {connectionStatus.message}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* App Settings Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <SettingsIcon size={24} color={Colors.light.tint} />
          <Text style={styles.sectionTitle}>App Settings</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => router.push('/products')}
        >
          <Package size={20} color={Colors.light.tint} />
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Products</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => {
            openConfirm({
              title: 'Logout',
              message: 'Are you sure you want to logout?',
              destructive: true,
              testID: 'confirm-logout',
              onConfirm: async () => {
                await logout();
                router.replace('/login');
              },
            });
          }}
        >
          <LogOut size={20} color={Colors.light.tint} />
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Logout</Text>
        </TouchableOpacity>

        {isSuperAdmin && (
          <>
            <Text style={styles.sectionSubtitle}>Danger Zone</Text>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={handleClearAllProducts}
            >
              <Trash2 size={20} color={Colors.light.card} />
              <Text style={styles.buttonText}>Clear All Products</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={handleClearAllUsers}
            >
              <Trash2 size={20} color={Colors.light.card} />
              <Text style={styles.buttonText}>Clear All Users</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={handleClearAllOutlets}
            >
              <Trash2 size={20} color={Colors.light.card} />
              <Text style={styles.buttonText}>Clear All Outlets</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* About Section */}
      {isAdmin && (
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About</Text>
          <Text style={styles.infoText}>
            <Text>Stock Check App for Cake Shop{'\n'}Version 1.0.0{'\n\n'}Manage your daily inventory, track stock levels, and request products efficiently.{'\n\n'}Last Updated: {new Date().toLocaleString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</Text>
          </Text>
        </View>
      )}

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.background,
  },
  scrollContent: {
    padding: 16,
    flexGrow: 1,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  sectionSubtitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 8,
    marginBottom: 12,
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
  dangerButton: {
    backgroundColor: Colors.light.danger,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.card,
  },
  secondaryButtonText: {
    color: Colors.light.tint,
  },
  infoSection: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: Colors.light.muted,
    lineHeight: 20,
  },
  syncInfoCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  syncInfoText: {
    fontSize: 14,
    color: Colors.light.muted,
    lineHeight: 20,
    textAlign: 'center' as const,
  },
  inputGroup: {
    gap: 8,
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
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
  statusMessage: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
  },
  successMessage: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  errorMessage: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  statusMessageText: {
    fontSize: 14,
    fontWeight: '500' as const,
    flex: 1,
  },
  successMessageText: {
    color: '#10B981',
  },
  errorMessageText: {
    color: '#EF4444',
  },
  listItem: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  listItemTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  listItemSubtitle: {
    fontSize: 14,
    color: Colors.light.muted,
    marginTop: 4,
  },
});
