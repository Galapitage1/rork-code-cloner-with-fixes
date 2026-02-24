import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Dimensions, Animated, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ClipboardCheck, ShoppingCart, History, Settings, Users, FileSpreadsheet, Utensils, LogOut, Package, BarChart3, ShoppingBag, TrendingUp, Warehouse, UserCheck, ClipboardList, Factory, FileText, Mail, CalendarDays, BadgeDollarSign } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useRef, useEffect, useState } from 'react';
import { useStores } from '@/contexts/StoresContext';

import Colors from '@/constants/colors';
import { hasPermission } from '@/utils/permissions';

const { width } = Dimensions.get('window');
const boxSize = Math.min(width / 3 - 24, 110);

type NavCard = {
  title: string;
  icon: any;
  route: string;
  color: string;
  requiresPermission?: 'viewSales' | 'viewRecipes' | null;
};

const navCards: NavCard[] = [
  {
    title: 'Stock Check',
    icon: ClipboardCheck,
    route: '/(tabs)/stock-check',
    color: '#3B82F6',
  },
  {
    title: 'Requests',
    icon: ShoppingCart,
    route: '/(tabs)/requests',
    color: '#10B981',
  },
  {
    title: 'History',
    icon: History,
    route: '/(tabs)/history',
    color: '#8B5CF6',
  },
  {
    title: 'Customers',
    icon: Users,
    route: '/(tabs)/customers',
    color: '#F59E0B',
  },
  {
    title: 'Reconcile',
    icon: FileSpreadsheet,
    route: '/(tabs)/sales-upload',
    color: '#EF4444',
    requiresPermission: 'viewSales',
  },
  {
    title: 'Recipes',
    icon: Utensils,
    route: '/(tabs)/recipes',
    color: '#EC4899',
    requiresPermission: 'viewRecipes',
  },

  {
    title: 'Stores',
    icon: Warehouse,
    route: '/(tabs)/stores',
    color: '#0EA5E9',
    requiresPermission: 'viewRecipes',
  },
  {
    title: 'Suppliers',
    icon: UserCheck,
    route: '/(tabs)/suppliers',
    color: '#F59E0B',
    requiresPermission: 'viewRecipes',
  },
  {
    title: 'GRN',
    icon: ClipboardList,
    route: '/(tabs)/grn',
    color: '#10B981',
    requiresPermission: 'viewRecipes',
  },
  {
    title: 'Inventory',
    icon: Package,
    route: '/(tabs)/inventory',
    color: '#14B8A6',
    requiresPermission: 'viewRecipes',
  },
  {
    title: 'Live Inventory',
    icon: TrendingUp,
    route: '/(tabs)/live-inventory',
    color: '#06B6D4',
    requiresPermission: 'viewRecipes',
  },
  {
    title: 'Reports',
    icon: BarChart3,
    route: '/(tabs)/reports',
    color: '#8B5CF6',
    requiresPermission: 'viewSales',
  },
  {
    title: 'Orders',
    icon: ShoppingBag,
    route: '/(tabs)/orders',
    color: '#F97316',
  },
  {
    title: 'Campaigns',
    icon: Mail,
    route: '/campaigns',
    color: '#7C3AED',
  },
  {
    title: 'Production',
    icon: Factory,
    route: '/(tabs)/production',
    color: '#6366F1',
    requiresPermission: 'viewRecipes',
  },
  {
    title: 'Settings',
    icon: Settings,
    route: '/(tabs)/settings',
    color: '#6B7280',
  },
];

const leaveCard: NavCard = {
  title: 'Leave',
  icon: CalendarDays,
  route: '/leave',
  color: '#0891B2',
};

function NavigationCard({ card, onPress, unreadCount }: { card: NavCard; onPress: () => void; unreadCount?: number }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const shadowAnim = useRef(new Animated.Value(4)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 0.95,
        useNativeDriver: true,
      }),
      Animated.timing(shadowAnim, {
        toValue: 2,
        duration: 150,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 3,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(shadowAnim, {
        toValue: 4,
        duration: 150,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const Icon = card.icon;

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={0.9}
      style={styles.cardTouchable}
    >
      <Animated.View
        style={[
          styles.card,
          {
            transform: [{ scale: scaleAnim }],
            shadowOpacity: shadowAnim.interpolate({
              inputRange: [2, 4],
              outputRange: [0.15, 0.25],
            }),
          },
        ]}
      >
        <View style={[styles.cardInner, { backgroundColor: card.color }]}>
          <View style={styles.iconContainer}>
            <Icon size={32} color="#FFFFFF" strokeWidth={2} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {card.title}
          </Text>
          {unreadCount !== undefined && unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { currentUser, logout, isSuperAdmin, syncUsers } = useAuth();
  const { syncAll: syncStoresData } = useStores();
  const [hasInitialSynced, setHasInitialSynced] = useState(false);

  console.log('===== HomeScreen Debug =====');
  console.log('isSuperAdmin:', isSuperAdmin);
  console.log('currentUser:', currentUser);
  console.log('currentUser?.username:', currentUser?.username);
  console.log('currentUser?.role:', currentUser?.role);
  console.log('===========================');

  useEffect(() => {
    async function syncOnHomeLoad() {
      if (hasInitialSynced) return;
      
      console.log('[HomeScreen] First visit - syncing users and outlets...');
      try {
        await Promise.all([
          syncUsers(undefined, true),
          syncStoresData(true),
        ]);
        console.log('[HomeScreen] Users and outlets synced successfully');
        setHasInitialSynced(true);
      } catch (error) {
        console.error('[HomeScreen] Failed to sync users and outlets:', error);
      }
    }

    syncOnHomeLoad();
  }, [hasInitialSynced, syncUsers, syncStoresData]);

  const handleNavigate = async (route: string) => {
    if (route === '/feedback-dashboard') {
      const dashboardUrl =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.origin}/Tracker/feedback/dashboard.html`
          : 'https://tracker.tecclk.com/Tracker/feedback/dashboard.html';

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(dashboardUrl, '_blank');
      } else {
        await Linking.openURL(dashboardUrl);
      }
      return;
    }

    router.push(route as any);
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login' as any);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };



  const visibleCards = navCards.filter(card => {
    if (!card.requiresPermission) return true;
    return hasPermission(currentUser?.role, card.requiresPermission);
  });

  const settingsIndex = visibleCards.findIndex(card => card.route === '/(tabs)/settings');
  let allCards: NavCard[] = isSuperAdmin && settingsIndex >= 0 
    ? [
        ...visibleCards.slice(0, settingsIndex),
        {
          title: 'Feedback',
          icon: BarChart3,
          route: '/feedback-dashboard',
          color: '#0F766E',
        },
        {
          title: 'Activity Logs',
          icon: FileText,
          route: '/logs',
          color: '#7C3AED',
        },
        ...visibleCards.slice(settingsIndex)
      ]
    : visibleCards;

  if (currentUser?.role === 'admin' || isSuperAdmin) {
    const settingsInsertIndex = allCards.findIndex(card => card.route === '/(tabs)/settings');
    const hrCard: NavCard = {
      title: 'Staff HR',
      icon: BadgeDollarSign,
      route: '/hr',
      color: '#0F766E',
    };
    if (!allCards.some(card => card.route === '/hr')) {
      if (settingsInsertIndex >= 0) {
        allCards = [...allCards.slice(0, settingsInsertIndex), hrCard, ...allCards.slice(settingsInsertIndex)];
      } else {
        allCards = [...allCards, hrCard];
      }
    }
  }

  allCards = [leaveCard, ...allCards];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.backgroundContainer}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Image
              source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/irnvdefvf4r08jqg0p373' }}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>WELCOME TO THE ENGLISH CAKE COMPANY</Text>
            <Text style={styles.subtitle}>Welcome, {currentUser?.username}</Text>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.grid}>
              {allCards.map((card, index) => (
                <NavigationCard
                  key={index}
                  card={card}
                  onPress={() => handleNavigate(card.route)}
                />
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <LogOut size={20} color={Colors.light.danger} />
              <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backgroundContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center' as const,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
    textAlign: 'center' as const,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  grid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 16,
    justifyContent: 'center' as const,
  },
  cardTouchable: {
    width: boxSize,
    height: boxSize,
  },
  card: {
    flex: 1,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowRadius: 12,
    elevation: 10,
  },
  cardInner: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    overflow: 'hidden' as const,
    borderBottomWidth: 6,
    borderBottomColor: 'rgba(0, 0, 0, 0.3)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconContainer: {
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    textAlign: 'center' as const,
  },
  badge: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  footer: {
    padding: 16,
    paddingBottom: 8,
    backgroundColor: Colors.light.card,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  logoutButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.danger,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.danger,
  },
});
