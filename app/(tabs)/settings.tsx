import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput, Modal, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { Trash2, Settings as SettingsIcon, Store, Plus, Edit2, X, Package, LogOut, Users as UsersIcon, RefreshCw, CloudOff, Cloud, ChevronDown, ChevronUp, Mail, Save, Check, AlertCircle, CheckCircle, MessageSquare, CalendarDays } from 'lucide-react-native';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';

import { useCustomers } from '@/contexts/CustomerContext';
import { useOrders } from '@/contexts/OrderContext';
import { useStores } from '@/contexts/StoresContext';
import { useProduction } from '@/contexts/ProductionContext';

import { syncData } from '@/utils/syncData';
import { testServerConnection, testWriteToServer } from '@/utils/testSync';
import { useRecipes } from '@/contexts/RecipeContext';
import { useProductUsage } from '@/contexts/ProductUsageContext';
import { useSMSCampaign } from '@/contexts/SMSCampaignContext';
import { SMSProviderSettings } from '@/components/SMSProviderSettings';
import { Outlet, UserRole, LeaveType } from '@/types';
import { useLeave } from '@/contexts/LeaveContext';
import { hasPermission } from '@/utils/permissions';
import { useBackendStatus } from '@/utils/backendStatus';
import Colors from '@/constants/colors';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const CAMPAIGN_SETTINGS_KEY = '@campaign_settings';

export default function SettingsScreen() {
  const { outlets, addOutlet, updateOutlet, deleteOutlet, clearAllProducts, clearAllOutlets, isLoading, isSyncing: isStockSyncing, lastSyncTime: stockLastSync, syncAll, isSyncPaused } = useStock();

  const { currentUser, users, logout, addUser, updateUser, deleteUser, isSyncing: isUserSyncing, lastSyncTime: userLastSync, syncUsers, clearAllUsers, isSuperAdmin, enableReceivedAutoLoad, toggleEnableReceivedAutoLoad } = useAuth();
  const { isSyncing: isCustomerSyncing, lastSyncTime: customerLastSync, syncCustomers } = useCustomers();
  const { isSyncing: isRecipeSyncing, lastSyncTime: recipeLastSync, syncRecipes } = useRecipes();
  const { isSyncing: isOrderSyncing, lastSyncTime: orderLastSync, syncOrders } = useOrders();
  const { isSyncing: isStoresSyncing, lastSyncTime: storesLastSync, syncAll: syncStores, setUser: setStoresUser } = useStores();
  const { isSyncing: isProductionSyncing, lastSyncTime: productionLastSync, syncAll: syncProduction, setUser: setProductionUser } = useProduction();
  const { deleteUserData } = useProductUsage();
  const router = useRouter();
  const [showOutletModal, setShowOutletModal] = useState<boolean>(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);
  const [outletName, setOutletName] = useState<string>('');
  const [outletLocation, setOutletLocation] = useState<string>('');
  const [outletType, setOutletType] = useState<'sales' | 'production'>('sales');
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
  const [usersExpanded, setUsersExpanded] = useState<boolean>(true);
  const [outletsExpanded, setOutletsExpanded] = useState<boolean>(true);
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
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [isSavingPermanentSettings, setIsSavingPermanentSettings] = useState<boolean>(false);
  const [showSMSSettings, setShowSMSSettings] = useState<boolean>(false);
  const [leaveTypesExpanded, setLeaveTypesExpanded] = useState<boolean>(false);
  const [showLeaveTypeModal, setShowLeaveTypeModal] = useState<boolean>(false);
  const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(null);
  const [newLeaveTypeName, setNewLeaveTypeName] = useState<string>('');
  const [newLeaveTypeColor, setNewLeaveTypeColor] = useState<string>('#3B82F6');
  const [dataCleanupExpanded, setDataCleanupExpanded] = useState<boolean>(false);
  const [isDeletingData, setIsDeletingData] = useState<boolean>(false);
  
  const { settings: smsSettings, saveSettings: saveSMSSettings, testLogin: testSMSLogin, sendTestSMS, isSaving: isSavingSMS } = useSMSCampaign();
  const { leaveTypes, addLeaveType, updateLeaveType, deleteLeaveType } = useLeave();

  const leaveTypeColors = [
    '#3B82F6', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6',
    '#EC4899', '#06B6D4', '#6366F1', '#14B8A6', '#F97316'
  ];

  const backendStatus = useBackendStatus();

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  const loadCampaignSettings = useCallback(async () => {
    try {
      console.log('[SETTINGS] Loading campaign settings from local storage...');
      const settings = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        console.log('[SETTINGS] Loaded local settings:', { hasEmail: !!parsed.emailApiKey, hasSmtp: !!parsed.smtpHost });
        setEmailApiKey(parsed.emailApiKey || '');
        setEmailApiProvider(parsed.emailApiProvider || 'smtp');
        setSmsApiKey(parsed.smsApiKey || '');
        setSmsApiUrl(parsed.smsApiUrl || 'https://app.notify.lk/api/v1/send');
        setSmtpHost(parsed.smtpHost || '');
        setSmtpPort(parsed.smtpPort || '587');
        setSmtpUsername(parsed.smtpUsername || '');
        setSmtpPassword(parsed.smtpPassword || '');
      } else {
        console.log('[SETTINGS] No local settings found');
      }
      
      if (currentUser) {
        console.log('[SETTINGS] Syncing settings from server for user:', currentUser.id);
        try {
          const synced = await syncData<any>('campaign_settings', [], currentUser.id);
          if (synced && synced.length > 0) {
            const latest = synced[0];
            console.log('[SETTINGS] Synced settings from server:', { hasEmail: !!latest?.emailApiKey, hasSmtp: !!latest?.smtpHost });
            await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(latest));
            setEmailApiKey(latest?.emailApiKey || '');
            setEmailApiProvider(latest?.emailApiProvider || 'smtp');
            setSmsApiKey(latest?.smsApiKey || '');
            setSmsApiUrl(latest?.smsApiUrl || 'https://app.notify.lk/api/v1/send');
            setSmtpHost(latest?.smtpHost || '');
            setSmtpPort(latest?.smtpPort || '587');
            setSmtpUsername(latest?.smtpUsername || '');
            setSmtpPassword(latest?.smtpPassword || '');
          }
        } catch (syncError) {
          console.error('[SETTINGS] Failed to sync campaign settings from server:', syncError);
        }
      }
    } catch (error) {
      console.error('[SETTINGS] Failed to load campaign settings:', error);
    }
  }, [currentUser]);

  useEffect(() => {
    loadCampaignSettings();
  }, [loadCampaignSettings]);

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
      setConnectionStatus({ type: 'error', message: 'Please fill in all SMTP settings' });
      return;
    }

    try {
      setIsTestingEmail(true);
      setConnectionStatus(null);

      const baseUrl = backendStatus.baseUrl;
      console.log('[Email Test] Testing connection to:', baseUrl);

      const response = await fetch(`${baseUrl}/api/test-email-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          smtpConfig: {
            host: smtpHost,
            port: smtpPort,
            username: smtpUsername,
            password: smtpPassword,
          },
        }),
      });

      const result = await response.json();
      console.log('[Email Test] Result:', result);

      if (response.ok && result.success) {
        const smtpResult = result.results?.smtp;
        if (smtpResult?.success) {
          setConnectionStatus({ type: 'success', message: smtpResult.message || 'SMTP connection successful' });
        } else {
          setConnectionStatus({ type: 'error', message: smtpResult?.message || 'SMTP connection failed' });
        }
      } else {
        setConnectionStatus({ type: 'error', message: result.error || 'Connection test failed' });
      }
    } catch (error: any) {
      console.error('[Email Test] Error:', error);
      setConnectionStatus({ 
        type: 'error', 
        message: error.message || 'Failed to test connection. Check if backend server is running.' 
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
          Alert.alert('Success', 'All products and Product Unit Conversions have been cleared from this device and the server.');
        } catch {
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
        } catch {
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
        } catch {
          Alert.alert('Error', 'Failed to clear outlets. Please try again.');
        }
      },
    });
  };

  const deleteOldDataFromServer = async (daysToKeep: number) => {
    if (!currentUser) {
      throw new Error('User not logged in');
    }

    const cutoffDate = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    console.log(`[DATA CLEANUP] Deleting data older than ${daysToKeep} days (cutoff: ${new Date(cutoffDate).toISOString()})`);

    const dataTypes = [
      'products',
      'stockChecks',
      'requests',
      'productConversions',
      'inventoryStocks',
      'salesDeductions',
      'reconcileHistory',
      'liveInventorySnapshots',
      'customers',
      'recipes',
      'linkedProducts',
      'orders',
      'stores',
      'suppliers',
      'grns',
      'productions',
      'leave_requests',
    ];

    const baseUrl = backendStatus.baseUrl;
    let deletedCount = 0;
    let failedCount = 0;

    for (const dataType of dataTypes) {
      try {
        console.log(`[DATA CLEANUP] Processing ${dataType}...`);
        const response = await fetch(`${baseUrl}/Tracker/api/delete-old-data.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: currentUser.id,
            dataType,
            cutoffDate,
          }),
        });

        const result = await response.json();
        if (result.success) {
          console.log(`[DATA CLEANUP] ✓ ${dataType}: ${result.deleted || 0} items deleted`);
          deletedCount += (result.deleted || 0);
        } else {
          console.error(`[DATA CLEANUP] ✗ ${dataType}: ${result.error || 'Unknown error'}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`[DATA CLEANUP] ✗ ${dataType}: Error during cleanup:`, error);
        failedCount++;
      }
    }

    console.log(`[DATA CLEANUP] Complete - Deleted: ${deletedCount} items, Failed: ${failedCount} types`);
    
    if (failedCount > 0) {
      throw new Error(`Cleanup partially failed. ${failedCount} data types could not be cleaned.`);
    }
  };

  const handleManualSync = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'Please login to sync data.');
      return;
    }

    try {
      console.log('[SETTINGS] Manual sync - Restoring data from server for last 45 days...');
      
      // CRITICAL: Clear last sync timestamps to force full fetch from server
      // This ensures we restore data for the last 45 days, including items deleted locally
      const timestampKeys = [
        '@last_sync_products_' + currentUser.id,
        '@last_sync_stockChecks_' + currentUser.id,
        '@last_sync_requests_' + currentUser.id,
        '@last_sync_outlets_' + currentUser.id,
        '@last_sync_productConversions_' + currentUser.id,
        '@last_sync_inventoryStocks_' + currentUser.id,
        '@last_sync_salesDeductions_' + currentUser.id,
        '@last_sync_reconcileHistory_' + currentUser.id,
        '@last_sync_liveInventorySnapshots_' + currentUser.id,
      ];
      
      console.log('[SETTINGS] Clearing sync timestamps to restore full 45-day history...');
      await Promise.all(timestampKeys.map(key => AsyncStorage.removeItem(key).catch(() => {})));
      
      let successCount = 0;
      let failCount = 0;
      
      const syncOperations = [
        { fn: () => syncAll(false, true), name: 'Stock Data' },
        { fn: () => syncUsers(undefined, false), name: 'Users' },
        { fn: syncCustomers, name: 'Customers' },
        { fn: syncRecipes, name: 'Recipes' },
        { fn: syncOrders, name: 'Orders' },
        { fn: syncStores, name: 'Stores & GRN' },
        { fn: syncProduction, name: 'Production' },
      ];
      
      console.log('[SETTINGS] Executing', syncOperations.length, 'sync operations with 45-day restore...');
      
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
          `${successCount} out of ${syncOperations.length} data types synced successfully.\n\nData from the last 45 days has been restored from the server.`
        );
      } else {
        Alert.alert('Success', 'All data synced successfully from server.\n\nData from the last 45 days has been restored, including any items that were deleted locally.');
      }
      
      console.log('[SETTINGS] Manual sync complete - Success:', successCount, 'Failed:', failCount);
      console.log('[SETTINGS] ✓ Restored data from last 45 days from server');
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
              : 'Your products, outlets, users, customers, and recipes automatically sync every 1 minute across all your devices.'}
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

        {/* Backend Status */}
        <View style={[styles.statsCard, { borderColor: backendStatus.isAvailable ? '#10B981' : '#EF4444' }]}>
          <View style={styles.statRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {backendStatus.isAvailable ? (
                <CheckCircle size={20} color="#10B981" />
              ) : (
                <AlertCircle size={20} color="#EF4444" />
              )}
              <Text style={styles.statLabel}>Backend Server</Text>
            </View>
            <TouchableOpacity
              onPress={() => backendStatus.refresh()}
              disabled={backendStatus.checking}
            >
              {backendStatus.checking ? (
                <ActivityIndicator size="small" color={Colors.light.tint} />
              ) : (
                <RefreshCw size={18} color={Colors.light.tint} />
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.syncInfoText, { textAlign: 'left', color: backendStatus.isAvailable ? '#10B981' : '#EF4444' }]}>
              {backendStatus.isAvailable ? `Connected to ${backendStatus.baseUrl}` : `Cannot reach ${backendStatus.baseUrl}`}
            </Text>
          </View>
          {!backendStatus.isAvailable && (
            <View style={[styles.syncInfoCard, { marginBottom: 0, backgroundColor: '#FEF2F2', borderColor: '#EF4444' }]}>
              <Text style={[styles.syncInfoText, { color: '#EF4444' }]}>
                Backend server is unavailable. Data will be stored locally and synced when the server is reachable.
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={async () => {
            try {
              setIsTestingConnection(true);
              console.log('Testing server connection...');
              
              const readTest = await testServerConnection();
              console.log('Read test result:', readTest);
              
              const writeTest = await testWriteToServer();
              console.log('Write test result:', writeTest);
              
              if (readTest.success && writeTest.success) {
                Alert.alert(
                  'Connection Successful',
                  `✓ Read Test: ${readTest.message}\n✓ Write Test: ${writeTest.message}`,
                  [{ text: 'OK' }]
                );
              } else {
                const errors: string[] = [];
                if (!readTest.success) errors.push(`Read: ${readTest.message}`);
                if (!writeTest.success) errors.push(`Write: ${writeTest.message}`);
                
                Alert.alert(
                  'Connection Failed',
                  errors.join('\n\n') + '\n\nPlease check:\n1. Server is running at https://tracker.tecclk.com\n2. /Tracker/api/ folder exists\n3. PHP files have proper permissions',
                  [{ text: 'OK' }]
                );
              }
            } catch (error: any) {
              Alert.alert('Test Failed', error.message || 'Unknown error occurred');
            } finally {
              setIsTestingConnection(false);
            }
          }}
          disabled={isTestingConnection}
        >
          {isTestingConnection ? (
            <ActivityIndicator color={Colors.light.tint} />
          ) : (
            <>
              <AlertCircle size={20} color={Colors.light.tint} />
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>Test Server Connection</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Data Cleanup Settings - Super Admin Only */}
      {isSuperAdmin && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setDataCleanupExpanded(!dataCleanupExpanded)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Trash2 size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>Data Cleanup</Text>
            </View>
            {dataCleanupExpanded ? (
              <ChevronUp size={20} color={Colors.light.tint} />
            ) : (
              <ChevronDown size={20} color={Colors.light.tint} />
            )}
          </TouchableOpacity>

          {dataCleanupExpanded && (
            <>
              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  Delete old data from the server to free up storage space. Select how many days of data you want to keep. This action cannot be undone.
                </Text>
              </View>

              <View style={[styles.syncInfoCard, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                <Text style={[styles.syncInfoText, { color: '#92400E' }]}>⚠️ Only manually deleted data can be removed from the server. Data is NEVER automatically deleted.</Text>
              </View>

              <Text style={styles.sectionSubtitle}>Keep Data From Last:</Text>

              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={() => {
                  Alert.alert(
                    'Keep All Data',
                    'All data will be kept on the server. No data will be deleted. This is the default setting.',
                    [{ text: 'OK' }]
                  );
                }}
              >
                <CheckCircle size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>ALL Data (No Deletion)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  openConfirm({
                    title: 'Delete Old Data',
                    message: 'This will delete all data older than 30 days from the server. Recent 30 days of data will be kept. This action cannot be undone.',
                    destructive: true,
                    testID: 'confirm-delete-30-days',
                    onConfirm: async () => {
                      try {
                        setIsDeletingData(true);
                        await deleteOldDataFromServer(30);
                        Alert.alert('Success', 'Data older than 30 days has been deleted from the server.');
                      } catch (error) {
                        Alert.alert('Error', 'Failed to delete old data. Please try again.');
                      } finally {
                        setIsDeletingData(false);
                      }
                    },
                  });
                }}
                disabled={isDeletingData}
              >
                {isDeletingData ? (
                  <ActivityIndicator color={Colors.light.tint} />
                ) : (
                  <>
                    <CalendarDays size={20} color={Colors.light.tint} />
                    <Text style={[styles.buttonText, styles.secondaryButtonText]}>30 Days</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  openConfirm({
                    title: 'Delete Old Data',
                    message: 'This will delete all data older than 45 days from the server. Recent 45 days of data will be kept. This action cannot be undone.',
                    destructive: true,
                    testID: 'confirm-delete-45-days',
                    onConfirm: async () => {
                      try {
                        setIsDeletingData(true);
                        await deleteOldDataFromServer(45);
                        Alert.alert('Success', 'Data older than 45 days has been deleted from the server.');
                      } catch (error) {
                        Alert.alert('Error', 'Failed to delete old data. Please try again.');
                      } finally {
                        setIsDeletingData(false);
                      }
                    },
                  });
                }}
                disabled={isDeletingData}
              >
                {isDeletingData ? (
                  <ActivityIndicator color={Colors.light.tint} />
                ) : (
                  <>
                    <CalendarDays size={20} color={Colors.light.tint} />
                    <Text style={[styles.buttonText, styles.secondaryButtonText]}>45 Days</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  openConfirm({
                    title: 'Delete Old Data',
                    message: 'This will delete all data older than 90 days from the server. Recent 90 days of data will be kept. This action cannot be undone.',
                    destructive: true,
                    testID: 'confirm-delete-90-days',
                    onConfirm: async () => {
                      try {
                        setIsDeletingData(true);
                        await deleteOldDataFromServer(90);
                        Alert.alert('Success', 'Data older than 90 days has been deleted from the server.');
                      } catch (error) {
                        Alert.alert('Error', 'Failed to delete old data. Please try again.');
                      } finally {
                        setIsDeletingData(false);
                      }
                    },
                  });
                }}
                disabled={isDeletingData}
              >
                {isDeletingData ? (
                  <ActivityIndicator color={Colors.light.tint} />
                ) : (
                  <>
                    <CalendarDays size={20} color={Colors.light.tint} />
                    <Text style={[styles.buttonText, styles.secondaryButtonText]}>90 Days</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  openConfirm({
                    title: 'Delete Old Data',
                    message: 'This will delete all data older than 180 days from the server. Recent 180 days of data will be kept. This action cannot be undone.',
                    destructive: true,
                    testID: 'confirm-delete-180-days',
                    onConfirm: async () => {
                      try {
                        setIsDeletingData(true);
                        await deleteOldDataFromServer(180);
                        Alert.alert('Success', 'Data older than 180 days has been deleted from the server.');
                      } catch (error) {
                        Alert.alert('Error', 'Failed to delete old data. Please try again.');
                      } finally {
                        setIsDeletingData(false);
                      }
                    },
                  });
                }}
                disabled={isDeletingData}
              >
                {isDeletingData ? (
                  <ActivityIndicator color={Colors.light.tint} />
                ) : (
                  <>
                    <CalendarDays size={20} color={Colors.light.tint} />
                    <Text style={[styles.buttonText, styles.secondaryButtonText]}>180 Days</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Permanent Settings Save - Super Admin Only */}
      {isSuperAdmin && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Save size={24} color={Colors.light.tint} />
            <Text style={styles.sectionTitle}>Permanent Settings Protection</Text>
          </View>

          <View style={styles.syncInfoCard}>
            <Text style={styles.syncInfoText}>
              Save all current settings (outlets, users, campaign settings) as PERMANENT. Once saved, these settings will never be replaced during sync. This prevents deleted items from coming back during automatic sync.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={async () => {
              openConfirm({
                title: 'Save Permanent Settings',
                message: 'This will lock all current settings (outlets, users, campaign settings) and prevent sync from overwriting them. Are you sure?',
                destructive: false,
                testID: 'confirm-save-permanent-settings',
                onConfirm: async () => {
                  try {
                    setIsSavingPermanentSettings(true);
                    
                    // Save a permanent settings flag with timestamp
                    const permanentSettings = {
                      id: 'permanent_settings_lock',
                      outlets: outlets.map(o => o.id),
                      users: users.map(u => u.id),
                      savedAt: Date.now(),
                      updatedAt: Date.now(),
                    };
                    
                    await AsyncStorage.setItem('@permanent_settings_lock', JSON.stringify(permanentSettings));
                    
                    if (currentUser) {
                      try {
                        await syncData('permanent_settings_lock', [permanentSettings], currentUser.id);
                      } catch (syncError) {
                        console.error('[SETTINGS] Failed to sync permanent settings lock:', syncError);
                      }
                    }
                    
                    Alert.alert(
                      'Success',
                      `Settings saved as permanent:\n- ${outlets.length} outlets\n- ${users.length} users\n\nThese settings will now be protected from sync overwrites.`
                    );
                  } catch (error) {
                    console.error('[SETTINGS] Failed to save permanent settings:', error);
                    Alert.alert('Error', 'Failed to save permanent settings. Please try again.');
                  } finally {
                    setIsSavingPermanentSettings(false);
                  }
                },
              });
            }}
            disabled={isSavingPermanentSettings}
          >
            {isSavingPermanentSettings ? (
              <ActivityIndicator color={Colors.light.card} />
            ) : (
              <>
                <Save size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>Save Permanent Settings</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={[styles.syncInfoCard, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={[styles.syncInfoText, { color: '#92400E' }]}>
              ⚠️ This is a powerful feature. Once saved, these settings cannot be changed through sync. You can still manually edit them on this device, but other devices will respect these permanent settings during sync.
            </Text>
          </View>
        </View>
      )}

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
                              } catch {
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
                              } catch {
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

      {/* Leave Types Section */}
      {isSuperAdmin && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setLeaveTypesExpanded(!leaveTypesExpanded)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <CalendarDays size={24} color={Colors.light.tint} />
              <Text style={styles.sectionTitle}>Leave Types ({leaveTypes.length})</Text>
            </View>
            {leaveTypesExpanded ? (
              <ChevronUp size={20} color={Colors.light.tint} />
            ) : (
              <ChevronDown size={20} color={Colors.light.tint} />
            )}
          </TouchableOpacity>

          {leaveTypesExpanded && (
            <>
              <View style={styles.syncInfoCard}>
                <Text style={styles.syncInfoText}>
                  Manage leave types available for employees to select when submitting leave requests.
                </Text>
              </View>

              {leaveTypes.map((type) => (
                <View key={type.id} style={styles.listItem}>
                  <View style={[styles.leaveTypeColorDot, { backgroundColor: type.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle}>{type.name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingLeaveType(type);
                        setNewLeaveTypeName(type.name);
                        setNewLeaveTypeColor(type.color);
                        setShowLeaveTypeModal(true);
                      }}
                    >
                      <Edit2 size={20} color={Colors.light.tint} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        openConfirm({
                          title: 'Delete Leave Type',
                          message: `Are you sure you want to delete "${type.name}"?`,
                          destructive: true,
                          testID: 'confirm-delete-leave-type',
                          onConfirm: async () => {
                            try {
                              await deleteLeaveType(type.id);
                              Alert.alert('Success', 'Leave type deleted successfully');
                            } catch {
                              Alert.alert('Error', 'Failed to delete leave type');
                            }
                          },
                        });
                      }}
                    >
                      <Trash2 size={20} color={Colors.light.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={() => {
                  setEditingLeaveType(null);
                  setNewLeaveTypeName('');
                  setNewLeaveTypeColor('#3B82F6');
                  setShowLeaveTypeModal(true);
                }}
              >
                <Plus size={20} color={Colors.light.card} />
                <Text style={styles.buttonText}>Add Leave Type</Text>
              </TouchableOpacity>
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
                onPress={() => router.push('/campaigns' as any)}
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

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setShowSMSSettings(!showSMSSettings)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <MessageSquare size={24} color={Colors.light.tint} />
                  <Text style={styles.sectionTitle}>Dialog eSMS Settings</Text>
                </View>
                {showSMSSettings ? (
                  <ChevronUp size={20} color={Colors.light.tint} />
                ) : (
                  <ChevronDown size={20} color={Colors.light.tint} />
                )}
              </TouchableOpacity>

              {showSMSSettings && (
                <View style={styles.nestedSection}>
                  <SMSProviderSettings
                    settings={smsSettings}
                    onSave={saveSMSSettings}
                    onTestLogin={testSMSLogin}
                    onSendTest={sendTestSMS}
                    isSaving={isSavingSMS}
                  />
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
          onPress={() => router.push('/products' as any)}
        >
          <Package size={20} color={Colors.light.tint} />
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Products</Text>
        </TouchableOpacity>

        <View style={styles.syncInfoCard}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Enable Received Auto Load</Text>
              <Text style={styles.toggleDescription}>
                When enabled, production outlets will automatically load received quantities from inventory when loading stock checks or changing outlets/dates.
              </Text>
            </View>
            <Switch
              value={enableReceivedAutoLoad}
              onValueChange={toggleEnableReceivedAutoLoad}
              trackColor={{ false: Colors.light.muted, true: Colors.light.tint }}
              thumbColor={Colors.light.card}
            />
          </View>
        </View>

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
                router.replace('/login' as any);
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

      {/* User Modal */}
      <Modal
        visible={showUserModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUserModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingUser ? 'Edit User' : 'Add User'}
              </Text>
              <TouchableOpacity onPress={() => setShowUserModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Username *</Text>
              <TextInput
                style={styles.input}
                value={newUsername}
                onChangeText={setNewUsername}
                placeholder="Enter username"
                placeholderTextColor={Colors.light.muted}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Role *</Text>
              <View style={styles.pickerContainer}>
                {Platform.OS === 'web' ? (
                  <select
                    value={newUserRole}
                    onChange={(e: any) => setNewUserRole(e.target.value as UserRole)}
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
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    {isSuperAdmin && <option value="superadmin">Super Admin</option>}
                  </select>
                ) : (
                  <TouchableOpacity
                    style={styles.input}
                    onPress={() => {
                      const options = [
                        { text: 'User', onPress: () => setNewUserRole('user') },
                        { text: 'Admin', onPress: () => setNewUserRole('admin') },
                      ];
                      if (isSuperAdmin) {
                        options.push({ text: 'Super Admin', onPress: () => setNewUserRole('superadmin') });
                      }
                      options.push({ text: 'Cancel', style: 'cancel' as const } as any);
                      Alert.alert('Select Role', '', options);
                    }}
                  >
                    <Text style={{ color: Colors.light.text }}>
                      {newUserRole === 'user' ? 'User' : newUserRole === 'admin' ? 'Admin' : 'Super Admin'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, { flex: 1 }]}
                onPress={() => setShowUserModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, { flex: 1 }]}
                onPress={async () => {
                  if (!newUsername.trim()) {
                    Alert.alert('Error', 'Please enter a username');
                    return;
                  }
                  try {
                    if (editingUser) {
                      await updateUser(editingUser.id, { username: newUsername, role: newUserRole });
                      Alert.alert('Success', 'User updated successfully');
                    } else {
                      await addUser(newUsername, newUserRole);
                      Alert.alert('Success', 'User added successfully. Default password is "password"');
                    }
                    setShowUserModal(false);
                  } catch {
                    Alert.alert('Error', 'Failed to save user');
                  }
                }}
              >
                <Text style={styles.buttonText}>{editingUser ? 'Update' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Outlet Modal */}
      <Modal
        visible={showOutletModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowOutletModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingOutlet ? 'Edit Outlet' : 'Add Outlet'}
              </Text>
              <TouchableOpacity onPress={() => setShowOutletModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Outlet Name *</Text>
              <TextInput
                style={styles.input}
                value={outletName}
                onChangeText={setOutletName}
                placeholder="Enter outlet name"
                placeholderTextColor={Colors.light.muted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={outletLocation}
                onChangeText={setOutletLocation}
                placeholder="Enter location"
                placeholderTextColor={Colors.light.muted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Type *</Text>
              <View style={styles.pickerContainer}>
                {Platform.OS === 'web' ? (
                  <select
                    value={outletType}
                    onChange={(e: any) => setOutletType(e.target.value as 'sales' | 'production')}
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
                    <option value="sales">Sales</option>
                    <option value="production">Production</option>
                  </select>
                ) : (
                  <TouchableOpacity
                    style={styles.input}
                    onPress={() => {
                      Alert.alert(
                        'Select Type',
                        '',
                        [
                          { text: 'Sales', onPress: () => setOutletType('sales') },
                          { text: 'Production', onPress: () => setOutletType('production') },
                          { text: 'Cancel', style: 'cancel' as const }
                        ]
                      );
                    }}
                  >
                    <Text style={{ color: Colors.light.text }}>
                      {outletType === 'sales' ? 'Sales' : 'Production'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, { flex: 1 }]}
                onPress={() => setShowOutletModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, { flex: 1 }]}
                onPress={async () => {
                  if (!outletName.trim()) {
                    Alert.alert('Error', 'Please enter an outlet name');
                    return;
                  }
                  try {
                    if (editingOutlet) {
                      await updateOutlet(editingOutlet.id, {
                        name: outletName,
                        location: outletLocation,
                        outletType: outletType
                      });
                      Alert.alert('Success', 'Outlet updated successfully');
                    } else {
                      const newOutlet: Outlet = {
                        id: `outlet-${Date.now()}`,
                        name: outletName,
                        location: outletLocation,
                        outletType: outletType,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      };
                      await addOutlet(newOutlet);
                      Alert.alert('Success', 'Outlet added successfully');
                    }
                    setShowOutletModal(false);
                  } catch {
                    Alert.alert('Error', 'Failed to save outlet');
                  }
                }}
              >
                <Text style={styles.buttonText}>{editingOutlet ? 'Update' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Leave Type Modal */}
      <Modal
        visible={showLeaveTypeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLeaveTypeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingLeaveType ? 'Edit Leave Type' : 'Add Leave Type'}
              </Text>
              <TouchableOpacity onPress={() => setShowLeaveTypeModal(false)}>
                <X size={24} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Leave Type Name *</Text>
              <TextInput
                style={styles.input}
                value={newLeaveTypeName}
                onChangeText={setNewLeaveTypeName}
                placeholder="e.g., Annual Leave, Sick Leave"
                placeholderTextColor={Colors.light.muted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Color *</Text>
              <View style={styles.colorPickerGrid}>
                {leaveTypeColors.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorPickerItem,
                      { backgroundColor: color },
                      newLeaveTypeColor === color && styles.colorPickerItemSelected
                    ]}
                    onPress={() => setNewLeaveTypeColor(color)}
                  >
                    {newLeaveTypeColor === color && <Check size={16} color="#FFFFFF" />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, { flex: 1 }]}
                onPress={() => setShowLeaveTypeModal(false)}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, { flex: 1 }]}
                onPress={async () => {
                  if (!newLeaveTypeName.trim()) {
                    Alert.alert('Error', 'Please enter a leave type name');
                    return;
                  }
                  try {
                    if (editingLeaveType) {
                      await updateLeaveType(editingLeaveType.id, {
                        name: newLeaveTypeName,
                        color: newLeaveTypeColor
                      });
                      Alert.alert('Success', 'Leave type updated successfully');
                    } else {
                      await addLeaveType(newLeaveTypeName, newLeaveTypeColor);
                      Alert.alert('Success', 'Leave type added successfully');
                    }
                    setShowLeaveTypeModal(false);
                  } catch {
                    Alert.alert('Error', 'Failed to save leave type');
                  }
                }}
              >
                <Text style={styles.buttonText}>{editingLeaveType ? 'Update' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  divider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 24,
  },
  nestedSection: {
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
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
  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
  },
  toggleInfo: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 12,
    color: Colors.light.muted,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 16,
  },
  modalContent: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalActions: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 24,
  },
  leaveTypeColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  colorPickerGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
  },
  colorPickerItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorPickerItemSelected: {
    borderColor: Colors.light.text,
  },
});
