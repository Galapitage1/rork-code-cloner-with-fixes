import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, Modal, ActivityIndicator, Platform, Linking, TextInput, AppState, AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMoir } from '@/contexts/MoirContext';
import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, LogOut, Users as UsersIcon, Clock, Settings, Upload, Trash2, X, FileText, AlertTriangle, Info, Target } from 'lucide-react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import XLSX from 'xlsx';
import { useRouter } from 'expo-router';

const COLORS = {
  yellow: '#FFD700',
  black: '#000000',
  white: '#FFFFFF',
  darkYellow: '#FFC700',
  lightYellow: '#FFE64D',
  gray: '#666666',
  lightGray: '#CCCCCC',
  green: '#10B981',
  red: '#EF4444',
};

export default function MoirScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    users,
    records,
    currentUser,
    isLoading,
    recordButtonPress,
    getLastSeenForUser,
    getAllLatestLocations,
    getLatestLocationForUser,
    loginUser,
    logoutUser,
    requestLocationPermission,
    enableLocationTracking,
    locationTrackingEnabled,
    locationPermissionGranted,
    importUsersFromExcel,
    clearAllUsers,
    clearAllRecords,
    removeDuplicateUsers,
    updateUserDetails,
    syncAllData,
    radiusMeters,
    updateRadiusMeters,
    getUsersOutsideRadius,
    calculateDistance,
  } = useMoir();


  const [showMapModal, setShowMapModal] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(true);
  const [showPermissionModal, setShowPermissionModal] = useState<boolean>(false);
  const [showAdminSettings, setShowAdminSettings] = useState<boolean>(false);
  const [adminUsername, setAdminUsername] = useState<string>('');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState<boolean>(false);
  const [userLoginInput, setUserLoginInput] = useState<string>('');
  const [showTimestampLog, setShowTimestampLog] = useState<boolean>(false);
  const [selectedUserForLog, setSelectedUserForLog] = useState<string | null>(null);
  const [showUserDetailsModal, setShowUserDetailsModal] = useState<boolean>(false);
  const [selectedUserForDetails, setSelectedUserForDetails] = useState<string | null>(null);
  const [userDetailsForm, setUserDetailsForm] = useState<{
    phoneNumber: string;
    emergencyPhoneNumber: string;
    emergencyPerson: string;
    allergies: string;
    medication: string;
    otherDetails: string;
  }>({
    phoneNumber: '',
    emergencyPhoneNumber: '',
    emergencyPerson: '',
    allergies: '',
    medication: '',
    otherDetails: '',
  });
  const [showUserInfoModal, setShowUserInfoModal] = useState<boolean>(false);
  const [selectedUserForInfo, setSelectedUserForInfo] = useState<string | null>(null);
  const [radiusInput, setRadiusInput] = useState<string>(String(radiusMeters));
  const [notifiedUsers, setNotifiedUsers] = useState<Set<string>>(new Set());
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    setRadiusInput(String(radiusMeters));
  }, [radiusMeters]);

  useEffect(() => {
    if (!currentUser && !isAdmin) {
      setShowLoginModal(true);
    } else {
      setShowLoginModal(false);
    }
  }, [currentUser, isAdmin]);

  const checkUsersOutsideRadius = useCallback(() => {
    if (!isAdmin) return;

    const adminLocation = getLatestLocationForUser('admin-location');
    const usersOutside = getUsersOutsideRadius(adminLocation);

    const newUsersOutside = usersOutside.filter(item => !notifiedUsers.has(item.user.id));
    
    if (newUsersOutside.length > 0) {
      const userNames = newUsersOutside.map(item => 
        `${item.user.name} (${Math.round(item.distance)}m away)`
      ).join(', ');
      
      Alert.alert(
        'Users Outside Radius',
        `The following users are outside the ${radiusMeters}m radius:\n\n${userNames}`,
        [{ text: 'OK' }]
      );

      setNotifiedUsers(prev => {
        const updated = new Set(prev);
        newUsersOutside.forEach(item => updated.add(item.user.id));
        return updated;
      });
    }

    const currentUsersOutsideIds = new Set(usersOutside.map(item => item.user.id));
    setNotifiedUsers(prev => {
      const updated = new Set<string>();
      prev.forEach(id => {
        if (currentUsersOutsideIds.has(id)) {
          updated.add(id);
        }
      });
      return updated;
    });
  }, [isAdmin, getLatestLocationForUser, getUsersOutsideRadius, radiusMeters, notifiedUsers]);

  useEffect(() => {
    if (!isAdmin) return;

    const interval = setInterval(() => {
      checkUsersOutsideRadius();
    }, 60000);

    return () => clearInterval(interval);
  }, [isAdmin, checkUsersOutsideRadius]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        isAdmin
      ) {
        checkUsersOutsideRadius();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isAdmin, checkUsersOutsideRadius]);

  const handleAdminButtonPress = async (userId: string, userName: string) => {
    if (!isAdmin) return;
    
    try {
      await recordButtonPress(userId, userName);
    } catch (error) {
      console.error('Failed to record timestamp:', error);
      Alert.alert('Error', 'Failed to record timestamp. Please try again.');
    }
  };

  const handleUserButtonPress = (userId: string, userName: string) => {
    if (!currentUser || currentUser.id !== userId) return;
    Alert.alert('Info', 'Only admin can record attendance.');
  };

  const handleShowLocations = () => {
    console.log('handleShowLocations: Opening map modal and triggering background sync to get latest locations...');
    setShowMapModal(true);
    
    console.log('handleShowLocations: Syncing to fetch latest location data from server...');
    syncAllData(false)
      .then(() => {
        console.log('handleShowLocations: ✓ Background sync complete - locations updated from server');
        console.log('handleShowLocations: Checking users outside radius...');
        checkUsersOutsideRadius();
      })
      .catch((error) => {
        console.error('handleShowLocations: Background sync failed:', error);
      });
  };

  const handleAdminLogin = async () => {
    if (adminUsername.toLowerCase() === 'admin' && adminPassword === 'admin123') {
      setIsAdmin(true);
      setShowLoginModal(false);
      Alert.alert('Success', 'Logged in as Admin');
    } else {
      Alert.alert('Error', 'Invalid admin credentials');
    }
  };

  const handleUserLogin = async (userName: string) => {
    try {
      const user = await loginUser(userName);
      if (user) {
        setShowLoginModal(false);
        if (!locationPermissionGranted || !locationTrackingEnabled) {
          setShowPermissionModal(true);
        }
      }
    } catch {
      Alert.alert('Error', 'Failed to login. Please try again.');
    }
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    try {
      if (currentUser) {
        await logoutUser();
      }
      
      if (isAdmin) {
        setIsAdmin(false);
        setAdminUsername('');
        setAdminPassword('');
      }
      
      setShowLoginModal(true);
      setShowPermissionModal(false);
      setShowAdminSettings(false);
      setShowMapModal(false);
      setShowLogoutConfirm(false);
      
      router.replace('/home');
    } catch (error) {
      console.error('Logout error:', error);
      setShowLogoutConfirm(false);
      Alert.alert('Error', 'Failed to logout. Please try again.');
    }
  };

  const handleImportUsers = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const content = await readAsStringAsync(asset.uri, {
        encoding: 'base64',
      });

      const workbook = XLSX.read(content, { type: 'base64' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];

      if (data.length < 2) {
        Alert.alert('Error', 'Excel file is empty or has no data rows');
        return;
      }

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
        }))
        .filter((userData: any) => userData.name);

      if (usersData.length === 0) {
        Alert.alert('Error', 'No valid user data found in the Excel file');
        return;
      }

      const count = await importUsersFromExcel(usersData);
      Alert.alert('Success', `Imported/Updated ${count} users successfully`);
      setShowAdminSettings(false);
    } catch (error) {
      console.error('Import users error:', error);
      Alert.alert('Error', 'Failed to import users. Please try again.');
    }
  };

  const handleClearAllUsers = () => {
    Alert.alert(
      'Clear All Users',
      'Are you sure you want to delete all users? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllUsers();
              Alert.alert('Success', 'All users have been deleted');
            } catch {
              Alert.alert('Error', 'Failed to delete users');
            }
          },
        },
      ]
    );
  };

  const handleClearAllRecords = () => {
    Alert.alert(
      'Delete All Timestamp Records',
      'Are you sure you want to delete all timestamp records? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllRecords();
              Alert.alert('Success', 'All timestamp records have been deleted');
            } catch {
              Alert.alert('Error', 'Failed to delete records');
            }
          },
        },
      ]
    );
  };

  const handleEditUserDetails = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user) {
      setSelectedUserForDetails(userId);
      setUserDetailsForm({
        phoneNumber: user.phoneNumber || '',
        emergencyPhoneNumber: user.emergencyPhoneNumber || '',
        emergencyPerson: user.emergencyPerson || '',
        allergies: user.allergies || '',
        medication: user.medication || '',
        otherDetails: user.otherDetails || '',
      });
      setShowUserDetailsModal(true);
    }
  };

  const handleSaveUserDetails = async () => {
    if (!selectedUserForDetails) return;
    
    try {
      await updateUserDetails(selectedUserForDetails, userDetailsForm);
      Alert.alert('Success', 'User details updated successfully');
      setShowUserDetailsModal(false);
      setSelectedUserForDetails(null);
    } catch (error) {
      console.error('Failed to update user details:', error);
      Alert.alert('Error', 'Failed to update user details');
    }
  };

  const handleShowUserInfo = (userId: string) => {
    setSelectedUserForInfo(userId);
    setShowUserInfoModal(true);
  };

  const selectedUserDetails = selectedUserForInfo ? users.find(u => u.id === selectedUserForInfo) : null;

  const handleRemoveDuplicates = async () => {
    Alert.alert(
      'Remove Duplicate Users',
      'This will remove users with duplicate names (case-insensitive), keeping the oldest entry for each name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await removeDuplicateUsers();
              if (result.removed === 0) {
                Alert.alert('No Duplicates', 'No duplicate users were found.');
              } else {
                Alert.alert(
                  'Success',
                  `Removed ${result.removed} duplicate user${result.removed > 1 ? 's' : ''}. ${result.remaining} unique user${result.remaining > 1 ? 's' : ''} remaining.`
                );
              }
            } catch {
              Alert.alert('Error', 'Failed to remove duplicates');
            }
          },
        },
      ]
    );
  };

  const handleRequestPermission = async () => {
    try {
      const result = await requestLocationPermission();
      if (result.foreground) {
        await enableLocationTracking();
        setShowPermissionModal(false);
        Alert.alert(
          'Success!',
          result.background
            ? 'Location tracking enabled. Your location will be shared automatically.'
            : 'Foreground location enabled. For background tracking, please enable it in your device settings.'
        );
      } else {
        Alert.alert(
          'Permission Denied',
          'Location permission is required for this feature. Please enable it in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              },
            },
          ]
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to request location permission.');
    }
  };

  const handleShowAllLocations = () => {
    const locations = getAllLatestLocations();
    if (locations.length === 0) {
      Alert.alert('No Locations', 'No users have shared their location yet.');
      return;
    }
    
    const url = `https://www.google.com/maps/dir/?api=1&destination=${locations[0].latitude},${locations[0].longitude}&waypoints=${locations.slice(1).map(l => `${l.latitude},${l.longitude}`).join('|')}`;
    
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open Google Maps.');
    });
  };

  const handleUserLocationPress = (userId: string) => {
    const location = getAllLatestLocations().find(l => l.userId === userId);
    if (!location) {
      Alert.alert('No Location', 'This user has not shared their location yet.');
      return;
    }
    
    const url = `https://www.google.com/maps?q=${location.latitude},${location.longitude}&query_place_id=${encodeURIComponent(location.userName)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open Google Maps.');
    });
  };

  const renderMapContent = () => {
    const locations = getAllLatestLocations();
    const locationUserIds = new Set(locations.map(l => l.userId));

    return (
      <ScrollView style={styles.locationsListContainer} contentContainerStyle={styles.locationsListContent}>
        <View style={styles.locationsHeader}>
          <Text style={styles.locationsTitle}>User Locations</Text>
          <Text style={styles.locationsSubtitle}>
            {locations.length} {locations.length === 1 ? 'user has' : 'users have'} shared {locations.length === 1 ? 'their' : 'their'} location
          </Text>
        </View>

        {locations.length > 0 && (
          <TouchableOpacity
            style={styles.showAllLocationsButton}
            onPress={handleShowAllLocations}
          >
            <MapPin size={20} color={COLORS.black} />
            <Text style={styles.showAllLocationsText}>Show All Locations on Map</Text>
          </TouchableOpacity>
        )}

        <View style={styles.userLocationsList}>
          {users.map((user) => {
            const hasLocation = locationUserIds.has(user.id);
            const location = locations.find(l => l.userId === user.id);
            
            return (
              <TouchableOpacity
                key={user.id}
                style={[
                  styles.userLocationButton,
                  hasLocation ? styles.userLocationButtonGreen : styles.userLocationButtonOrange,
                ]}
                onPress={() => {
                  if (hasLocation) {
                    handleUserLocationPress(user.id);
                  } else {
                    Alert.alert('No Location', `${user.name} has not shared their location yet.`);
                  }
                }}
              >
                <View style={styles.userLocationButtonInner}>
                  <MapPin size={20} color={COLORS.white} />
                  <View style={styles.userLocationInfo}>
                    <Text style={styles.userLocationName}>{user.name}</Text>
                    {hasLocation && location && (
                      <Text style={styles.userLocationTime}>
                        Last updated: {new Date(location.timestamp).toLocaleTimeString()}
                      </Text>
                    )}
                    {!hasLocation && (
                      <Text style={styles.userLocationNoData}>No location shared</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {users.length === 0 && (
          <View style={styles.emptyMapContainer}>
            <MapPin size={64} color={COLORS.gray} />
            <Text style={styles.emptyMapText}>
              No users found.
            </Text>
            <Text style={styles.emptyMapSubtext}>
              Admin needs to import users first.
            </Text>
          </View>
        )}
      </ScrollView>
    );
  };

  const formatLastSeen = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={COLORS.yellow} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Image
          source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/lvak0yyqswj80vzs2cc0f' }}
          style={styles.logo}
          resizeMode="contain"
        />
        {currentUser && (
          <View style={styles.userInfo}>
            <Text style={styles.welcomeText}>Welcome, {currentUser.name}</Text>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
              <LogOut size={20} color={COLORS.white} />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        )}
        {isAdmin && (
          <View style={styles.userInfo}>
            <View style={styles.adminBadge}>
              <UsersIcon size={20} color={COLORS.yellow} />
              <Text style={styles.adminText}>Admin View</Text>
            </View>
            <TouchableOpacity onPress={() => setShowAdminSettings(true)} style={styles.settingsIconButton}>
              <Settings size={24} color={COLORS.yellow} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTimestampLog(true)} style={styles.settingsIconButton}>
              <FileText size={24} color={COLORS.yellow} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
              <LogOut size={20} color={COLORS.white} />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {users.length === 0 ? (
          <View style={styles.emptyState}>
            <UsersIcon size={64} color={COLORS.gray} />
            <Text style={styles.emptyTitle}>No Users Found</Text>
            <Text style={styles.emptyDescription}>
              Admin needs to import users to get started.
            </Text>
            {isAdmin && (
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => setShowAdminSettings(true)}
              >
                <Text style={styles.settingsButtonText}>Import Users</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <View style={styles.usersGrid}>
              {users
                .filter(user => {
                  if (isAdmin) return true;
                  return currentUser?.id === user.id;
                })
                .map((user) => {
                  const lastSeen = isAdmin ? getLastSeenForUser(user.id) : null;
                  const isCurrentUser = currentUser?.id === user.id;
                  const userLocation = isAdmin ? getLatestLocationForUser(user.id) : (!isAdmin && isCurrentUser ? getLatestLocationForUser(user.id) : null);
                  const hasLocation = userLocation !== null;
                  
                  let isOutsideRadius = false;
                  if (isAdmin && userLocation) {
                    const adminLocation = getLatestLocationForUser('admin-location');
                    if (adminLocation) {
                      const distance = calculateDistance(
                        adminLocation.latitude,
                        adminLocation.longitude,
                        userLocation.latitude,
                        userLocation.longitude
                      );
                      isOutsideRadius = distance > radiusMeters;
                    }
                  }

                  return (
                    <View key={user.id} style={styles.userButtonWrapper}>
                      <TouchableOpacity
                        style={[
                          styles.userButton,
                          isCurrentUser && styles.userButtonActive,
                          isAdmin && hasLocation && !isOutsideRadius && styles.userButtonWithLocation,
                          isAdmin && isOutsideRadius && styles.userButtonOutsideRadius,
                        ]}
                        onPress={() => {
                          if (isAdmin) {
                            handleAdminButtonPress(user.id, user.name);
                          } else {
                            handleUserButtonPress(user.id, user.name);
                          }
                        }}
                        disabled={!isAdmin && !isCurrentUser}
                      >
                        <View style={styles.buttonInner}>
                          <Text style={styles.userName} numberOfLines={2}>{user.name}</Text>
                          {isAdmin && (
                            <View style={styles.lastSeenContainer}>
                              <Clock size={12} color={COLORS.gray} />
                              <Text style={styles.lastSeenLabel}>Last Seen</Text>
                              <Text style={styles.lastSeenTime}>
                                {formatLastSeen(lastSeen)}
                              </Text>
                            </View>
                          )}
                          {!isAdmin && isCurrentUser && (
                            <View style={[styles.locationStatusContainer, hasLocation ? styles.locationStatusGreen : styles.locationStatusRed]}>
                              <MapPin size={12} color={COLORS.white} />
                              <Text style={styles.locationStatusText}>
                                {hasLocation ? 'Sharing' : 'Not sharing'}
                              </Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                      {isAdmin && (
                        <TouchableOpacity
                          style={styles.userInfoButton}
                          onPress={() => handleShowUserInfo(user.id)}
                        >
                          <Info size={16} color={COLORS.white} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
            </View>

            {isAdmin && (
              <TouchableOpacity
                style={styles.showLocationsButton}
                onPress={handleShowLocations}
              >
                <MapPin size={24} color={COLORS.white} />
                <Text style={styles.showLocationsText}>Show Locations</Text>
              </TouchableOpacity>
            )}
            
            {!isAdmin && currentUser && !locationPermissionGranted && (
              <TouchableOpacity
                style={styles.enableLocationButton}
                onPress={() => setShowPermissionModal(true)}
              >
                <MapPin size={24} color={COLORS.white} />
                <Text style={styles.enableLocationButtonText}>Enable Location Sharing</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={showLoginModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalScrollContent}>
            <View style={styles.modalContent}>
              <ScrollView
                contentContainerStyle={styles.modalInnerScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}
                bounces={false}
              >
                <Image
                  source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/lvak0yyqswj80vzs2cc0f' }}
                  style={styles.modalLogo}
                  resizeMode="contain"
                />
                <Text style={styles.modalTitleSmall}>Welcome to Moir</Text>
                
                <View style={styles.loginSection}>
                  <Text style={styles.loginSectionTitle}>User Login</Text>
                  <Text style={styles.loginSectionSubtitle}>Type your name to log in:</Text>
                  <TextInput
                    style={styles.userLoginInput}
                    placeholder="Enter your name"
                    placeholderTextColor={COLORS.gray}
                    value={userLoginInput}
                    onChangeText={setUserLoginInput}
                    autoCapitalize="words"
                  />
                  <TouchableOpacity
                    style={styles.userLoginButton}
                    onPress={() => {
                      if (userLoginInput.trim()) {
                        handleUserLogin(userLoginInput.trim());
                      } else {
                        Alert.alert('Error', 'Please enter your name.');
                      }
                    }}
                  >
                    <Text style={styles.userLoginButtonText}>Login</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.divider} />

                <View style={styles.loginSection}>
                  <Text style={styles.loginSectionTitle}>Admin Login</Text>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Username"
                    placeholderTextColor={COLORS.gray}
                    value={adminUsername}
                    onChangeText={setAdminUsername}
                    autoCapitalize="none"
                  />
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Password"
                    placeholderTextColor={COLORS.gray}
                    secureTextEntry={true}
                    value={adminPassword}
                    onChangeText={setAdminPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.adminLoginButton}
                    onPress={handleAdminLogin}
                  >
                    <Text style={styles.adminLoginButtonText}>Login as Admin</Text>
                  </TouchableOpacity>
                  <Text style={styles.defaultCredentialsHint}>
                    Default: Admin / •••••••
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPermissionModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPermissionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <MapPin size={64} color={COLORS.yellow} />
            <Text style={styles.modalTitle}>Enable Location Tracking</Text>
            <Text style={styles.permissionDescription}>
              To share your location with the system, we need permission to access your device location.
            </Text>
            <Text style={styles.permissionInstructions}>
              • Your location will be shared every 60 seconds{'\n'}
              • Location tracking works even when the app is in the background{'\n'}
              • You can disable this anytime from Settings
            </Text>
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={handleRequestPermission}
            >
              <Text style={styles.permissionButtonText}>Enable Location</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipButton}
              onPress={() => setShowPermissionModal(false)}
            >
              <Text style={styles.skipButtonText}>Skip for Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showMapModal}
        animationType="slide"
        onRequestClose={() => setShowMapModal(false)}
      >
        <View style={styles.mapModalContainer}>
          <View style={[styles.mapHeader, { paddingTop: insets.top + 10 }]}>
            <Text style={styles.mapModalTitle}>User Locations</Text>
            <TouchableOpacity
              style={styles.mapCloseButton}
              onPress={() => setShowMapModal(false)}
            >
              <X size={28} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          {renderMapContent()}
        </View>
      </Modal>

      <Modal
        visible={showAdminSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAdminSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.settingsModal]}>
            <View style={styles.settingsHeader}>
              <Text style={styles.modalTitle}>Admin Settings</Text>
              <TouchableOpacity onPress={() => setShowAdminSettings(false)}>
                <X size={28} color={COLORS.black} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.settingsContent}>
              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Manage Users</Text>
                <Text style={styles.settingDescription}>
                  Import users from Excel file. File should have names in the first column.
                </Text>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleImportUsers}
                >
                  <Upload size={20} color={COLORS.black} />
                  <Text style={styles.actionButtonText}>Import Users from Excel</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Current Users</Text>
                <Text style={styles.settingDescription}>
                  Total users: {users.length}
                </Text>
              </View>

              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Location Radius Alert</Text>
                <Text style={styles.settingDescription}>
                  Set the maximum distance (in meters) from your location. Users outside this radius will be highlighted in red and you'll receive notifications.
                </Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Radius (meters)</Text>
                  <TextInput
                    style={styles.radiusInput}
                    value={radiusInput}
                    onChangeText={setRadiusInput}
                    keyboardType="numeric"
                    placeholder="500"
                    placeholderTextColor={COLORS.gray}
                  />
                </View>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={async () => {
                    const meters = parseInt(radiusInput, 10);
                    if (isNaN(meters) || meters <= 0) {
                      Alert.alert('Invalid Input', 'Please enter a valid positive number.');
                      return;
                    }
                    try {
                      await updateRadiusMeters(meters);
                      Alert.alert('Success', `Radius updated to ${meters} meters`);
                      setNotifiedUsers(new Set());
                    } catch (error) {
                      Alert.alert('Error', 'Failed to update radius');
                    }
                  }}
                >
                  <Target size={20} color={COLORS.black} />
                  <Text style={styles.actionButtonText}>Update Radius</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>User Management</Text>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleRemoveDuplicates}
                >
                  <AlertTriangle size={20} color={COLORS.black} />
                  <Text style={styles.actionButtonText}>
                    Remove Duplicate Users
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingItem}>
                <Text style={styles.settingLabel}>Danger Zone</Text>
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={handleClearAllUsers}
                >
                  <Trash2 size={20} color={COLORS.white} />
                  <Text style={[styles.actionButtonText, styles.dangerButtonText]}>
                    Clear All Users
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showTimestampLog}
        animationType="slide"
        onRequestClose={() => setShowTimestampLog(false)}
      >
        <View style={styles.timestampLogContainer}>
          <View style={[styles.timestampLogHeader, { paddingTop: insets.top + 10 }]}>
            <Text style={styles.timestampLogTitle}>Timestamp Log</Text>
            <TouchableOpacity
              style={styles.timestampLogCloseButton}
              onPress={() => setShowTimestampLog(false)}
            >
              <X size={28} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.timestampLogContent} contentContainerStyle={styles.timestampLogScrollContent}>
            {selectedUserForLog && (
              <TouchableOpacity
                style={styles.backToAllButton}
                onPress={() => setSelectedUserForLog(null)}
              >
                <Text style={styles.backToAllButtonText}>← Back to All Users</Text>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity
              style={[styles.actionButton, styles.dangerButton, { marginBottom: 16 }]}
              onPress={handleClearAllRecords}
            >
              <Trash2 size={20} color={COLORS.white} />
              <Text style={[styles.actionButtonText, styles.dangerButtonText]}>
                Delete All Logs
              </Text>
            </TouchableOpacity>

            {!selectedUserForLog ? (
              <View>
                <Text style={styles.timestampLogSectionTitle}>Select a user to view their timestamp history:</Text>
                {users.length === 0 ? (
                  <View style={styles.emptyLogContainer}>
                    <UsersIcon size={64} color={COLORS.gray} />
                    <Text style={styles.emptyLogText}>
                      No users found.
                    </Text>
                  </View>
                ) : (
                  users.map((user) => {
                    const userRecordsCount = records.filter(r => r.isAdminRecord && r.userId === user.id).length;
                    return (
                      <TouchableOpacity
                        key={user.id}
                        style={styles.userLogSelectButton}
                        onPress={() => setSelectedUserForLog(user.id)}
                      >
                        <View style={styles.userLogSelectInner}>
                          <Text style={styles.userLogSelectName}>{user.name}</Text>
                          <View style={styles.userLogSelectBadge}>
                            <Text style={styles.userLogSelectCount}>{userRecordsCount}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            ) : (
              <View>
                {records.filter(r => r.isAdminRecord && r.userId === selectedUserForLog).length === 0 ? (
                  <View style={styles.emptyLogContainer}>
                    <Clock size={64} color={COLORS.gray} />
                    <Text style={styles.emptyLogText}>
                      No timestamps recorded for this user yet.
                    </Text>
                  </View>
                ) : (
                  records
                    .filter(r => r.isAdminRecord && r.userId === selectedUserForLog)
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .map((record) => (
                      <View key={record.id} style={styles.timestampLogItem}>
                        <View style={styles.timestampLogItemHeader}>
                          <Text style={styles.timestampLogUserName}>{record.userName}</Text>
                          <View style={styles.timestampLogTimeContainer}>
                            <Clock size={16} color={COLORS.yellow} />
                          </View>
                        </View>
                        <View style={styles.timestampLogDetails}>
                          <View style={styles.timestampLogDetailRow}>
                            <Text style={styles.timestampLogDetailLabel}>Date:</Text>
                            <Text style={styles.timestampLogDetailValue}>{record.date}</Text>
                          </View>
                          <View style={styles.timestampLogDetailRow}>
                            <Text style={styles.timestampLogDetailLabel}>Time:</Text>
                            <Text style={styles.timestampLogDetailValue}>{record.time}</Text>
                          </View>
                          <View style={styles.timestampLogDetailRow}>
                            <Text style={styles.timestampLogDetailLabel}>Timestamp:</Text>
                            <Text style={styles.timestampLogDetailValue}>
                              {new Date(record.timestamp).toLocaleString()}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      <ConfirmDialog
        visible={showLogoutConfirm}
        title="Logout"
        message="Are you sure you want to logout?"
        confirmText="Logout"
        cancelText="Cancel"
        destructive
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <Modal
        visible={showUserInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUserInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.settingsHeader}>
              <Text style={styles.modalTitle}>User Details</Text>
              <TouchableOpacity onPress={() => setShowUserInfoModal(false)}>
                <X size={28} color={COLORS.black} />
              </TouchableOpacity>
            </View>

            {selectedUserDetails && (
              <ScrollView style={styles.settingsContent}>
                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Name:</Text>
                  <Text style={styles.userDetailValue}>{selectedUserDetails.name}</Text>
                </View>

                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Phone Number:</Text>
                  <Text style={styles.userDetailValue}>
                    {selectedUserDetails.phoneNumber || 'N/A'}
                  </Text>
                </View>

                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Emergency Phone:</Text>
                  <Text style={styles.userDetailValue}>
                    {selectedUserDetails.emergencyPhoneNumber || 'N/A'}
                  </Text>
                </View>

                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Emergency Person:</Text>
                  <Text style={styles.userDetailValue}>
                    {selectedUserDetails.emergencyPerson || 'N/A'}
                  </Text>
                </View>

                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Allergies:</Text>
                  <Text style={styles.userDetailValue}>
                    {selectedUserDetails.allergies || 'N/A'}
                  </Text>
                </View>

                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Medication:</Text>
                  <Text style={styles.userDetailValue}>
                    {selectedUserDetails.medication || 'N/A'}
                  </Text>
                </View>

                <View style={styles.userDetailRow}>
                  <Text style={styles.userDetailLabel}>Other Details:</Text>
                  <Text style={styles.userDetailValue}>
                    {selectedUserDetails.otherDetails || 'N/A'}
                  </Text>
                </View>
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowUserInfoModal(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: COLORS.black,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: COLORS.black,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.yellow,
    alignItems: 'center' as const,
  },
  logo: {
    width: 250,
    height: 80,
    marginBottom: 16,
  },
  userInfo: {
    alignItems: 'center' as const,
    gap: 8,
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: COLORS.yellow,
  },
  logoutButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: COLORS.red,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  logoutText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  adminBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: COLORS.black,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  adminText: {
    color: COLORS.yellow,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  settingsIconButton: {
    padding: 8,
    backgroundColor: COLORS.black,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.yellow,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  emptyState: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: COLORS.yellow,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 16,
    color: COLORS.lightGray,
    textAlign: 'center' as const,
    marginBottom: 24,
  },
  settingsButton: {
    backgroundColor: COLORS.yellow,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  settingsButtonText: {
    color: COLORS.black,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  usersGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
    justifyContent: 'center' as const,
  },
  userButtonWrapper: {
    width: '48%',
    minWidth: 140,
    maxWidth: 180,
    aspectRatio: 1,
    position: 'relative' as const,
  },
  userButton: {
    backgroundColor: COLORS.darkYellow,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: COLORS.yellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  userButtonActive: {
    borderWidth: 3,
    borderColor: COLORS.green,
  },
  userButtonWithLocation: {
    backgroundColor: '#D1FAE5',
  },
  userButtonOutsideRadius: {
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: COLORS.red,
  },
  buttonInner: {
    padding: 8,
    backgroundColor: 'transparent',
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  userName: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
    marginBottom: 6,
    minHeight: 32,
  },
  lastSeenContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    backgroundColor: COLORS.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  lastSeenLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: COLORS.gray,
  },
  lastSeenTime: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  locationStatusContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  locationStatusGreen: {
    backgroundColor: COLORS.green,
  },
  locationStatusRed: {
    backgroundColor: COLORS.red,
  },
  locationStatusText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: COLORS.white,
  },
  enableLocationButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 12,
    backgroundColor: COLORS.green,
    paddingVertical: 20,
    borderRadius: 16,
    marginTop: 24,
    elevation: 8,
    shadowColor: COLORS.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  enableLocationButtonText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.white,
  },
  showLocationsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 12,
    backgroundColor: COLORS.yellow,
    paddingVertical: 20,
    borderRadius: 16,
    marginTop: 24,
    elevation: 8,
    shadowColor: COLORS.yellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  showLocationsText: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  modalScrollContent: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 20,
  },
  modalInnerScrollContent: {
    flexGrow: 1,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    width: '90%',
    maxWidth: 500,
    maxHeight: '85%',
    borderWidth: 3,
    borderColor: COLORS.yellow,
    alignSelf: 'center' as const,
  },
  modalLogo: {
    width: 110,
    height: 35,
    alignSelf: 'center' as const,
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  modalTitleSmall: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
    marginBottom: 6,
  },
  loginSection: {
    width: '100%',
    marginBottom: 6,
  },
  loginSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginBottom: 6,
  },
  loginSectionSubtitle: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 4,
  },
  passwordInput: {
    width: '100%',
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: COLORS.black,
    marginBottom: 6,
  },
  adminLoginButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.yellow,
  },
  adminLoginButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: COLORS.yellow,
    textAlign: 'center' as const,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.lightGray,
    marginVertical: 8,
    width: '100%',
  },
  usersList: {
    maxHeight: 400,
  },
  userListItem: {
    backgroundColor: COLORS.yellow,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 12,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  userListItemText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
  },
  permissionDescription: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  permissionInstructions: {
    fontSize: 14,
    color: COLORS.gray,
    lineHeight: 24,
    marginBottom: 24,
    backgroundColor: COLORS.lightYellow,
    padding: 16,
    borderRadius: 8,
  },
  permissionButton: {
    backgroundColor: COLORS.yellow,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  permissionButtonText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
  },
  skipButton: {
    paddingVertical: 12,
  },
  skipButtonText: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: 'center' as const,
  },
  mapModalContainer: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  mapHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: COLORS.black,
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.yellow,
  },
  mapModalTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: COLORS.yellow,
  },
  mapCloseButton: {
    padding: 8,
    backgroundColor: COLORS.yellow,
    borderRadius: 20,
  },
  map: {
    flex: 1,
  },
  emptyMapContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: COLORS.white,
    padding: 40,
  },
  emptyMapText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginTop: 16,
    textAlign: 'center' as const,
  },
  emptyMapSubtext: {
    fontSize: 14,
    color: COLORS.gray,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  mapFooter: {
    backgroundColor: COLORS.black,
    borderTopWidth: 3,
    borderTopColor: COLORS.yellow,
    paddingVertical: 12,
  },
  locationCardsContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  locationCard: {
    backgroundColor: COLORS.yellow,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 180,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  locationCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 6,
  },
  locationCardName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  locationCardTime: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 4,
  },
  locationCardCoords: {
    fontSize: 10,
    color: COLORS.gray,
    fontFamily: 'monospace' as const,
  },
  closeButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.yellow,
    textAlign: 'center' as const,
  },
  settingsModal: {
    maxHeight: '90%',
    height: 600,
  },
  settingsHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  settingsContent: {
    flex: 1,
  },
  settingItem: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  settingLabel: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginBottom: 8,
  },
  settingDescription: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: 12,
    lineHeight: 20,
  },
  actionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: COLORS.yellow,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  dangerButton: {
    backgroundColor: COLORS.red,
    borderBottomColor: '#B91C1C',
  },
  dangerButtonText: {
    color: COLORS.white,
  },
  defaultCredentialsHint: {
    fontSize: 10,
    color: COLORS.gray,
    textAlign: 'center' as const,
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
  userLoginInput: {
    width: '100%',
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: COLORS.black,
    marginBottom: 6,
  },
  userLoginButton: {
    backgroundColor: COLORS.yellow,
    paddingVertical: 10,
    borderRadius: 8,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  userLoginButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
  },
  webMapContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  webMapScrollContent: {
    padding: 20,
  },
  webMapTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginBottom: 20,
    textAlign: 'center' as const,
  },
  webLocationItem: {
    backgroundColor: COLORS.lightYellow,
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  webLocationHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.yellow,
  },
  webLocationName: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  webLocationDetails: {
    marginBottom: 12,
  },
  webLocationLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: COLORS.gray,
    marginBottom: 4,
  },
  webLocationValue: {
    fontSize: 16,
    color: COLORS.black,
  },
  viewOnMapButton: {
    backgroundColor: COLORS.yellow,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.darkYellow,
  },
  viewOnMapButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: COLORS.black,
    textAlign: 'center' as const,
  },
  locationsListContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  locationsListContent: {
    padding: 20,
  },
  locationsHeader: {
    marginBottom: 20,
  },
  locationsTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginBottom: 8,
  },
  locationsSubtitle: {
    fontSize: 14,
    color: COLORS.gray,
  },
  showAllLocationsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: COLORS.yellow,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  showAllLocationsText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  userLocationsList: {
    gap: 12,
  },
  userLocationButton: {
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  userLocationButtonGreen: {
    backgroundColor: COLORS.green,
    shadowColor: COLORS.green,
  },
  userLocationButtonOrange: {
    backgroundColor: '#F97316',
    shadowColor: '#F97316',
  },
  userLocationButtonInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 16,
    gap: 12,
  },
  userLocationInfo: {
    flex: 1,
  },
  userLocationName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: COLORS.white,
    marginBottom: 4,
  },
  userLocationTime: {
    fontSize: 12,
    color: COLORS.white,
    opacity: 0.9,
  },
  userLocationNoData: {
    fontSize: 12,
    color: COLORS.white,
    opacity: 0.8,
    fontStyle: 'italic' as const,
  },
  timestampLogContainer: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  timestampLogHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: COLORS.black,
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.yellow,
  },
  timestampLogTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: COLORS.yellow,
  },
  timestampLogCloseButton: {
    padding: 8,
    backgroundColor: COLORS.yellow,
    borderRadius: 20,
  },
  timestampLogContent: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  timestampLogScrollContent: {
    padding: 20,
  },
  emptyLogContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: 60,
  },
  emptyLogText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginTop: 16,
    textAlign: 'center' as const,
  },
  emptyLogSubtext: {
    fontSize: 14,
    color: COLORS.gray,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  timestampLogItem: {
    backgroundColor: COLORS.lightYellow,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  timestampLogItemHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.yellow,
  },
  timestampLogUserName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  timestampLogTimeContainer: {
    backgroundColor: COLORS.black,
    padding: 8,
    borderRadius: 20,
  },
  timestampLogDetails: {
    gap: 8,
  },
  timestampLogDetailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  timestampLogDetailLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: COLORS.gray,
  },
  timestampLogDetailValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  backToAllButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 16,
    alignSelf: 'flex-start' as const,
  },
  backToAllButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: COLORS.yellow,
  },
  timestampLogSectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: COLORS.black,
    marginBottom: 16,
    textAlign: 'center' as const,
  },
  userLogSelectButton: {
    backgroundColor: COLORS.lightYellow,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    borderBottomWidth: 4,
    borderBottomColor: COLORS.darkYellow,
  },
  userLogSelectInner: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  userLogSelectName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: COLORS.black,
  },
  userLogSelectBadge: {
    backgroundColor: COLORS.black,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  userLogSelectCount: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: COLORS.yellow,
  },
  userInfoButton: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    backgroundColor: COLORS.green,
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    elevation: 4,
    shadowColor: COLORS.green,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  userDetailRow: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  userDetailLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: COLORS.gray,
    marginBottom: 4,
  },
  userDetailValue: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: COLORS.black,
  },
  inputGroup: {
    marginVertical: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: COLORS.gray,
    marginBottom: 8,
  },
  radiusInput: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.yellow,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.black,
  },
});
