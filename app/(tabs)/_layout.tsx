import { Tabs, useRouter } from 'expo-router';
import { ClipboardCheck, ShoppingCart, History, Settings, Users, FileSpreadsheet, Utensils, Home, Package, FileBarChart, ShoppingBag, TrendingUp, Warehouse, UserCheck, ClipboardList, Factory, Activity } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';

function CustomHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.customHeader, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerLeft}>
        <Image
          source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/irnvdefvf4r08jqg0p373' }}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={() => router.push('/home')}
          style={styles.homeButton}
        >
          <Home size={24} color={Colors.light.tint} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { currentUser, showPageTabs } = useAuth();
  const isUser = currentUser?.role === 'user';
  const isMobile = Platform.OS === 'ios' || Platform.OS === 'android';

  const shouldHideTabs = (isMobile && !showPageTabs);

  const tabBarStyle = shouldHideTabs ? { display: 'none' as const } : {
    backgroundColor: Colors.light.card,
    borderTopColor: Colors.light.border,
    borderTopWidth: 1,
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.light.tint,
        tabBarInactiveTintColor: Colors.light.tabIconDefault,
        headerShown: true,
        tabBarStyle,
      }}
    >
      <Tabs.Screen
        name="stock-check"
        options={{
          title: 'Stock Check',
          header: () => <CustomHeader title="Stock Check" />,
          tabBarIcon: ({ color, size }) => <ClipboardCheck size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          header: () => <CustomHeader title="Requests" />,
          tabBarIcon: ({ color, size }) => <ShoppingCart size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          header: () => <CustomHeader title="History" />,
          tabBarIcon: ({ color, size }) => <History size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          header: () => <CustomHeader title="Customers" />,
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sales-upload"
        options={{
          title: 'Reconcile',
          header: () => <CustomHeader title="Sales Reconcile" />,
          tabBarIcon: ({ color, size }) => <FileSpreadsheet size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: 'Recipes',
          header: () => <CustomHeader title="Recipes" />,
          tabBarIcon: ({ color, size }) => <Utensils size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          header: () => <CustomHeader title="Inventory" />,
          tabBarIcon: ({ color, size }) => <Package size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="live-inventory"
        options={{
          title: 'Live Inventory',
          header: () => <CustomHeader title="Live Inventory" />,
          tabBarIcon: ({ color, size }) => <TrendingUp size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="product-tracker"
        options={{
          title: 'Product Tracker',
          header: () => <CustomHeader title="Product Tracker" />,
          tabBarIcon: ({ color, size }) => <Activity size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />

      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          header: () => <CustomHeader title="Reports" />,
          tabBarIcon: ({ color, size }) => <FileBarChart size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          header: () => <CustomHeader title="Orders" />,
          tabBarIcon: ({ color, size }) => <ShoppingBag size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stores"
        options={{
          title: 'Stores',
          header: () => <CustomHeader title="Stores" />,
          tabBarIcon: ({ color, size }) => <Warehouse size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="suppliers"
        options={{
          title: 'Suppliers',
          header: () => <CustomHeader title="Suppliers" />,
          tabBarIcon: ({ color, size }) => <UserCheck size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="grn"
        options={{
          title: 'GRN',
          header: () => <CustomHeader title="Goods Received" />,
          tabBarIcon: ({ color, size }) => <ClipboardList size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="production"
        options={{
          title: 'Production',
          header: () => <CustomHeader title="Production" />,
          tabBarIcon: ({ color, size }) => <Factory size={size} color={color} />,
          href: isUser ? null : undefined,
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          header: () => <CustomHeader title="Settings" />,
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  customHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerLeft: {
    width: 80,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  headerRight: {
    width: 80,
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    alignItems: 'center' as const,
  },
  homeButton: {
    padding: 8,
  },
  logo: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.light.text,
    flex: 1,
    textAlign: 'center' as const,
  },

});
