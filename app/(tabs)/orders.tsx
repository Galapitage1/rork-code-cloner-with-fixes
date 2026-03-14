import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShoppingBag, Plus, X, Download, Edit2, Check, Clock, AlertCircle, Phone, Mail, MapPin, Package, Trash2, Calendar, Search, RefreshCw, Globe } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/colors';
import { useOrders } from '@/contexts/OrderContext';
import { useCustomers } from '@/contexts/CustomerContext';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerOrder, DeliveryMethod, OrderProduct, OrderReceivedFrom, UberEatsOrder, WebsiteOrder, WebsiteOrderItem } from '@/types';
import { CalendarModal } from '@/components/CalendarModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { syncData } from '@/utils/syncData';
import { getFromServer } from '@/utils/directSync';

const WEBSITE_ORDERS_KEY = '@stock_app_website_orders';
const UBER_EATS_ORDERS_KEY = '@stock_app_uber_eats_orders';
const CAMPAIGN_SETTINGS_KEY = '@campaign_settings';
const WEBSITE_PRODUCT_MAP_KEY = '@website_order_product_map_v1';
const WEBSITE_SOURCE = 'website' as const;
const WEBSITE_NOTE_PREFIX = 'Website TX:';

type OrdersViewMode = 'active' | 'fulfilled' | 'website' | 'uber';

type RemoteWebsiteOrder = {
  transactionId?: unknown;
  status?: unknown;
  requestedDateTime?: unknown;
  requestedDateTimeWithoutTimeZone?: unknown;
  orderReadyTime?: unknown;
  collectionMethod?: unknown;
  pickupMethodSubtype?: unknown;
  channel?: unknown;
  customer?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    address?: unknown;
  } | unknown;
  paymentStatus?: unknown;
  paymentType?: unknown;
  totals?: {
    subTotalPrice?: unknown;
    taxAmount?: unknown;
    serviceCharge?: unknown;
    deliveryCharge?: unknown;
    tipAmount?: unknown;
    promoAmount?: unknown;
    promoCode?: unknown;
    grandTotalPrice?: unknown;
  } | unknown;
  items?: unknown;
  rewardItems?: unknown;
  dynamicEntries?: unknown;
  taxSummary?: unknown;
  discounts?: unknown;
  flatFees?: unknown;
  additionalComments?: unknown;
  additionalInfos?: unknown;
  detail?: unknown;
};

type WebsiteOrdersResponse = {
  success?: boolean;
  error?: string;
  summaryOnly?: boolean;
  orderIds?: string[];
  orders?: RemoteWebsiteOrder[];
  summary?: {
    totalOrdersFromPage?: number;
    orderIdsFound?: number;
    ordersLoaded?: number;
    skipped?: number;
  };
  range?: {
    startDate?: string;
    endDate?: string;
    timezone?: string;
  };
  skipped?: Array<{ transactionId?: string; reason?: string }>;
};

type CampaignSettings = {
  websiteOrdersUsername?: string;
  websiteOrdersPassword?: string;
  websiteOrdersBizId?: string;
  uberEatsClientId?: string;
  uberEatsClientSecret?: string;
  uberEatsOutletConfigs?: Record<string, { outletName?: string; storeId?: string; storeName?: string }>;
};

type UberEatsSyncResponse = {
  success?: boolean;
  error?: string;
  savedCount?: number;
  counts?: Array<{
    outletName?: string;
    storeId?: string;
    loaded?: number;
    error?: string;
  }>;
};

type WebsitePullOptions = {
  purchaseStatus?: 'all' | 'pending';
  silent?: boolean;
  source?: 'manual' | 'auto';
};

type WebsiteUnmatchedChoice = {
  key: string;
  itemName: string;
  variantName?: string;
  sizeHint?: string;
  count: number;
  suggestedProductId?: string;
};

type WebsiteMappingPromptResult = {
  proceed: boolean;
  mappings: Record<string, string>;
};

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return undefined;
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function normalizePhone(value: string | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  return raw.replace(/[^\d+]/g, '').replace(/^00/, '+');
}

function normalizeName(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

function normalizeOutletName(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeUnitHint(value: string | undefined): string {
  const text = normalizeName(value || '');
  if (!text) return '';
  if (text.includes('slice')) return 'slice';
  if (text.includes('whole') || text.includes('full')) return 'whole';
  if (text.includes('half')) return 'half';
  if (/\bkg\b/.test(text)) return 'kg';
  if (/\bg\b/.test(text)) return 'g';
  if (/\bml\b/.test(text)) return 'ml';
  if (/\bl\b/.test(text)) return 'l';
  if (text.includes('piece') || text.includes('pcs') || /\bpc\b/.test(text)) return 'piece';
  if (text.includes('small')) return 'small';
  if (text.includes('medium')) return 'medium';
  if (text.includes('large')) return 'large';
  return '';
}

function extractSizeHint(itemName: string, variantName?: string): string {
  const source = `${variantName || ''} ${itemName}`.toLowerCase();
  const qtyMatch = source.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (qtyMatch) {
    return qtyMatch[2].toLowerCase();
  }
  return normalizeUnitHint(source);
}

function getWebsiteItemMapKey(itemName: string, variantName?: string): string {
  const base = normalizeName(itemName);
  const variant = normalizeName(variantName || '');
  const size = extractSizeHint(itemName, variantName);
  return `${base}|${variant}|${size || 'na'}`;
}

function websiteSourceIdFromOrder(order: {
  externalSource?: string;
  externalSourceId?: string;
  notes?: string;
}): string {
  if (order.externalSource === WEBSITE_SOURCE && order.externalSourceId) {
    return String(order.externalSourceId);
  }
  const notes = String(order.notes || '');
  const match = notes.match(/Website TX:\s*([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : '';
}

function parseAppigoDateTime(raw: unknown): { date: string; time: string } {
  const fallbackNow = new Date();
  const fallbackDate = fallbackNow.toISOString().split('T')[0];
  const fallbackTime = fallbackNow.toTimeString().slice(0, 5);

  if (typeof raw !== 'string' || raw.trim() === '') {
    return { date: fallbackDate, time: fallbackTime };
  }

  const trimmed = raw.trim();
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const date = parsed.toISOString().split('T')[0];
    const time = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
    return { date, time };
  }

  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) {
    return { date: fallbackDate, time: fallbackTime };
  }

  const monthIndex = monthMap[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6].toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  const dt = new Date(year, monthIndex, day, hour, minute, 0, 0);
  if (Number.isNaN(dt.getTime())) {
    return { date: fallbackDate, time: fallbackTime };
  }
  const date = dt.toISOString().split('T')[0];
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { date, time };
}

function parseWebsiteOrderItems(items: unknown): WebsiteOrderItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((row): WebsiteOrderItem => {
    const item = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
    return {
      itemId: typeof item.itemId === 'string' ? item.itemId : undefined,
      itemName: typeof item.itemName === 'string' ? item.itemName : 'Unknown Item',
      itemQuantity: parseNumber(item.itemQuantity) ?? 0,
      variantName: typeof item.variantName === 'string' ? item.variantName : undefined,
      addOnList: Array.isArray(item.addOnList)
        ? item.addOnList.map((x) => String(x))
        : undefined,
      note: typeof item.note === 'string' ? item.note : undefined,
      unitPrice: parseNumber(item.unitPrice),
      totalPrice: parseNumber(item.totalPrice),
    };
  });
}

function getWebsitePickupDateTime(remote: RemoteWebsiteOrder): unknown {
  const detail = (typeof remote.detail === 'object' && remote.detail !== null)
    ? (remote.detail as Record<string, unknown>)
    : {};

  return (
    detail.pickupTime ||
    detail.pickUpTime ||
    detail.pickupDateTime ||
    detail.pickUpDateTime ||
    remote.orderReadyTime ||
    remote.requestedDateTimeWithoutTimeZone ||
    remote.requestedDateTime
  );
}

function toWebsiteOrder(remote: RemoteWebsiteOrder, now: number, userId: string): WebsiteOrder | null {
  const txId = String(remote.transactionId || '').trim();
  if (!txId) return null;

  const customer = (typeof remote.customer === 'object' && remote.customer !== null
    ? remote.customer
    : {}) as Record<string, unknown>;
  const totals = (typeof remote.totals === 'object' && remote.totals !== null
    ? remote.totals
    : {}) as Record<string, unknown>;

  // Use website pickup time as primary order date/time for Tracker.
  const dateTime = parseAppigoDateTime(getWebsitePickupDateTime(remote));

  const detail = (typeof remote.detail === 'object' && remote.detail !== null)
    ? (remote.detail as Record<string, unknown>)
    : {};
  const additionalInfos = (typeof remote.additionalInfos === 'object' && remote.additionalInfos !== null)
    ? (remote.additionalInfos as Record<string, unknown>)
    : {};

  return {
    id: `website_order_${txId}`,
    transactionId: txId,
    status: String(remote.status || ''),
    orderDate: dateTime.date,
    orderTime: dateTime.time,
    requestedDateTime: typeof remote.requestedDateTime === 'string' ? remote.requestedDateTime : undefined,
    orderReadyTime: typeof remote.orderReadyTime === 'string' ? remote.orderReadyTime : undefined,
    collectionMethod: typeof remote.collectionMethod === 'string' ? remote.collectionMethod : undefined,
    pickupMethodSubtype: typeof remote.pickupMethodSubtype === 'string' ? remote.pickupMethodSubtype : undefined,
    channel: typeof remote.channel === 'string' ? remote.channel : undefined,
    customerName: String(customer.name || '').trim() || 'Website Customer',
    customerPhone: String(customer.phone || '').trim() || undefined,
    customerEmail: String(customer.email || '').trim() || undefined,
    customerAddress: String(customer.address || '').trim() || undefined,
    paymentStatus: typeof remote.paymentStatus === 'string' ? remote.paymentStatus : undefined,
    paymentType: typeof remote.paymentType === 'string' ? remote.paymentType : undefined,
    subTotalPrice: parseNumber(totals.subTotalPrice),
    taxAmount: parseNumber(totals.taxAmount),
    serviceCharge: parseNumber(totals.serviceCharge),
    deliveryCharge: parseNumber(totals.deliveryCharge),
    tipAmount: parseNumber(totals.tipAmount),
    promoAmount: parseNumber(totals.promoAmount),
    promoCode: typeof totals.promoCode === 'string' ? totals.promoCode : undefined,
    grandTotalPrice: parseNumber(totals.grandTotalPrice),
    additionalComments: typeof remote.additionalComments === 'string' ? remote.additionalComments : undefined,
    items: parseWebsiteOrderItems(remote.items),
    rewardItems: parseWebsiteOrderItems(remote.rewardItems),
    dynamicEntries: Array.isArray(remote.dynamicEntries)
      ? remote.dynamicEntries.map((row) => {
          const entry = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
          return {
            key: typeof entry.key === 'string' ? entry.key : undefined,
            value: typeof entry.value === 'string' ? entry.value : undefined,
          };
        })
      : undefined,
    taxSummary: Array.isArray(remote.taxSummary) ? remote.taxSummary : undefined,
    discounts: Array.isArray(remote.discounts) ? remote.discounts : undefined,
    flatFees: Array.isArray(remote.flatFees) ? remote.flatFees : undefined,
    additionalInfos,
    detail,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  };
}

export default function OrdersScreen() {
  const { orders, addOrder, updateOrder, deleteOrder, fulfillOrder, getActiveOrders, getFulfilledOrders, isLoading } = useOrders();
  const { customers, addCustomer, importCustomers } = useCustomers();
  const { products, outlets, addRequest } = useStock();
  const { currentUser } = useAuth();

  const [showNewOrderModal, setShowNewOrderModal] = useState<boolean>(false);
  const [showViewMode, setShowViewMode] = useState<OrdersViewMode>('active');
  const [editingOrder, setEditingOrder] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<string>('new');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [customerAddress, setCustomerAddress] = useState<string>('');
  const [orderProducts, setOrderProducts] = useState<OrderProduct[]>([]);
  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [orderTime, setOrderTime] = useState<string>(new Date().toTimeString().slice(0, 5));
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('collection');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [collectionOutlet, setCollectionOutlet] = useState<string>(outlets.filter(o => o.outletType === 'sales')[0]?.name || '');
  const [orderOutlet, setOrderOutlet] = useState<string>(outlets.filter(o => o.outletType === 'sales')[0]?.name || '');
  const [orderReceivedFrom, setOrderReceivedFrom] = useState<OrderReceivedFrom>('at_outlet');
  const [orderReceivedFromOther, setOrderReceivedFromOther] = useState<string>('');
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productQuantity, setProductQuantity] = useState<string>('');
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState<boolean>(false);
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [websiteOrders, setWebsiteOrders] = useState<WebsiteOrder[]>([]);
  const [websiteOrdersLoading, setWebsiteOrdersLoading] = useState<boolean>(false);
  const [websiteOrdersSyncing, setWebsiteOrdersSyncing] = useState<boolean>(false);
  const [websiteRangeLabel, setWebsiteRangeLabel] = useState<string>('');
  const [websiteRawVisible, setWebsiteRawVisible] = useState<Record<string, boolean>>({});
  const [websiteItemMappings, setWebsiteItemMappings] = useState<Record<string, string>>({});
  const [websiteMatchModalVisible, setWebsiteMatchModalVisible] = useState<boolean>(false);
  const [websiteMatchChoices, setWebsiteMatchChoices] = useState<WebsiteUnmatchedChoice[]>([]);
  const [websiteMatchSelections, setWebsiteMatchSelections] = useState<Record<string, string>>({});
  const [uberEatsOrders, setUberEatsOrders] = useState<UberEatsOrder[]>([]);
  const [uberEatsOrdersLoading, setUberEatsOrdersLoading] = useState<boolean>(false);
  const [uberEatsOrdersSyncing, setUberEatsOrdersSyncing] = useState<boolean>(false);
  const [uberOutletFilter, setUberOutletFilter] = useState<string>('');

  const websiteMatchResolverRef = useRef<((value: WebsiteMappingPromptResult) => void) | null>(null);
  const lastWebsitePingAtRef = useRef<number>(0);

  const activeOrders = useMemo(() => getActiveOrders(), [getActiveOrders]);
  const fulfilledOrders = useMemo(() => getFulfilledOrders(), [getFulfilledOrders]);

  const salesOutlets = useMemo(() => outlets.filter(o => o.outletType === 'sales'), [outlets]);

  const menuProducts = useMemo(() => {
    return products.filter(p => p.type === 'menu' && p.showInStock !== false);
  }, [products]);

  const filteredMenuProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return menuProducts;
    const query = productSearchQuery.toLowerCase();
    return menuProducts.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.category?.toLowerCase().includes(query)
    );
  }, [menuProducts, productSearchQuery]);

  const getApiBaseUrl = useCallback(() => {
    const envBase = process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
    if (envBase && envBase.trim()) return envBase.trim().replace(/\/+$/, '');
    if (typeof window !== 'undefined' && window.location?.origin) {
      return String(window.location.origin).trim().replace(/\/+$/, '');
    }
    return 'https://tracker.tecclk.com';
  }, []);

  const mergeWebsiteOrders = useCallback((existing: WebsiteOrder[], incoming: WebsiteOrder[]) => {
    const byId = new Map<string, WebsiteOrder>();
    existing.forEach((order) => {
      byId.set(order.id, order);
    });
    incoming.forEach((order) => {
      const current = byId.get(order.id);
      if (!current || (order.updatedAt || 0) >= (current.updatedAt || 0)) {
        byId.set(order.id, order);
      }
    });
    return Array.from(byId.values());
  }, []);

  const mergeUberEatsOrders = useCallback((existing: UberEatsOrder[], incoming: UberEatsOrder[]) => {
    const byId = new Map<string, UberEatsOrder>();
    existing.forEach((order) => {
      byId.set(order.id, order);
    });
    incoming.forEach((order) => {
      const current = byId.get(order.id);
      if (!current || (order.updatedAt || 0) >= (current.updatedAt || 0)) {
        byId.set(order.id, order);
      }
    });
    return Array.from(byId.values());
  }, []);

  const persistWebsiteOrders = useCallback(async (next: WebsiteOrder[], changedItems?: WebsiteOrder[]) => {
    const sorted = [...next].sort((a, b) => {
      const aTs = (a.updatedAt || a.createdAt || 0);
      const bTs = (b.updatedAt || b.createdAt || 0);
      return bTs - aTs;
    });
    await AsyncStorage.setItem(WEBSITE_ORDERS_KEY, JSON.stringify(sorted));

    if (!currentUser) {
      setWebsiteOrders(sorted.filter((o) => o.deleted !== true));
      return;
    }

    const syncOptions: {
      includeDeleted: boolean;
      minDays: number;
      changedItems?: WebsiteOrder[];
    } = {
      includeDeleted: true,
      minDays: 365,
    };
    if (Array.isArray(changedItems) && changedItems.length > 0) {
      syncOptions.changedItems = changedItems;
    }

    const synced = await syncData<WebsiteOrder>('website_orders', sorted, currentUser.id, syncOptions);
    await AsyncStorage.setItem(WEBSITE_ORDERS_KEY, JSON.stringify(synced));
    const visible = synced.filter((order) => order.deleted !== true).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    setWebsiteOrders(visible);
  }, [currentUser]);

  const loadWebsiteOrders = useCallback(async () => {
    if (!currentUser) {
      setWebsiteOrders([]);
      return;
    }

    setWebsiteOrdersLoading(true);
    try {
      const storedOrdersRaw = await AsyncStorage.getItem(WEBSITE_ORDERS_KEY);

      const localOrders: WebsiteOrder[] = storedOrdersRaw ? JSON.parse(storedOrdersRaw) : [];
      const safeLocalOrders = Array.isArray(localOrders) ? localOrders : [];

      const synced = await syncData<WebsiteOrder>('website_orders', safeLocalOrders, currentUser.id, {
        includeDeleted: true,
        minDays: 365,
      });
      await AsyncStorage.setItem(WEBSITE_ORDERS_KEY, JSON.stringify(synced));
      const visible = synced.filter((order) => order.deleted !== true).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setWebsiteOrders(visible);
    } catch (error) {
      console.error('Failed to load website orders:', error);
    } finally {
      setWebsiteOrdersLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadWebsiteOrders().catch(() => {});
  }, [loadWebsiteOrders]);

  const persistUberEatsOrders = useCallback(async (next: UberEatsOrder[], changedItems?: UberEatsOrder[]) => {
    const sorted = [...next].sort((a, b) => {
      const aTs = a.updatedAt || a.createdAt || 0;
      const bTs = b.updatedAt || b.createdAt || 0;
      return bTs - aTs;
    });
    await AsyncStorage.setItem(UBER_EATS_ORDERS_KEY, JSON.stringify(sorted));

    if (!currentUser) {
      setUberEatsOrders(sorted.filter((o) => o.deleted !== true));
      return;
    }

    const syncOptions: {
      includeDeleted: boolean;
      minDays: number;
      changedItems?: UberEatsOrder[];
    } = {
      includeDeleted: true,
      minDays: 365,
    };
    if (Array.isArray(changedItems) && changedItems.length > 0) {
      syncOptions.changedItems = changedItems;
    }

    const synced = await syncData<UberEatsOrder>('uber_eats_orders', sorted, currentUser.id, syncOptions);
    await AsyncStorage.setItem(UBER_EATS_ORDERS_KEY, JSON.stringify(synced));
    const visible = synced.filter((order) => order.deleted !== true).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    setUberEatsOrders(visible);
  }, [currentUser]);

  const loadUberEatsOrders = useCallback(async () => {
    if (!currentUser) {
      setUberEatsOrders([]);
      return;
    }

    setUberEatsOrdersLoading(true);
    try {
      const storedRaw = await AsyncStorage.getItem(UBER_EATS_ORDERS_KEY);
      const localOrders: UberEatsOrder[] = storedRaw ? JSON.parse(storedRaw) : [];
      const safeLocalOrders = Array.isArray(localOrders) ? localOrders : [];

      const synced = await syncData<UberEatsOrder>('uber_eats_orders', safeLocalOrders, currentUser.id, {
        includeDeleted: true,
        minDays: 365,
      });
      await AsyncStorage.setItem(UBER_EATS_ORDERS_KEY, JSON.stringify(synced));
      const visible = synced.filter((order) => order.deleted !== true).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setUberEatsOrders(visible);
    } catch (error) {
      console.error('Failed to load Uber Eats orders:', error);
    } finally {
      setUberEatsOrdersLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadUberEatsOrders().catch(() => {});
  }, [loadUberEatsOrders]);

  const groupedWebsiteOrders = useMemo(() => {
    const grouped = new Map<string, WebsiteOrder[]>();
    websiteOrders.forEach((order) => {
      const dateKey = order.orderDate || 'Unknown Date';
      const existing = grouped.get(dateKey) || [];
      existing.push(order);
      grouped.set(dateKey, existing);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => [
        date,
        [...rows].sort((a, b) => {
          const aTs = new Date(`${a.orderDate}T${a.orderTime || '00:00'}`).getTime();
          const bTs = new Date(`${b.orderDate}T${b.orderTime || '00:00'}`).getTime();
          return bTs - aTs;
        }),
      ] as const);
  }, [websiteOrders]);

  const filteredUberEatsOrders = useMemo(() => {
    const selectedOutlet = String(uberOutletFilter || '').trim();
    if (!selectedOutlet) {
      return uberEatsOrders;
    }
    return uberEatsOrders.filter((order) => String(order.outletName || '').trim() === selectedOutlet);
  }, [uberEatsOrders, uberOutletFilter]);

  const groupedUberEatsOrders = useMemo(() => {
    const grouped = new Map<string, UberEatsOrder[]>();
    filteredUberEatsOrders.forEach((order) => {
      const dateKey = order.orderDate || 'Unknown Date';
      const existing = grouped.get(dateKey) || [];
      existing.push(order);
      grouped.set(dateKey, existing);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => [
        date,
        [...rows].sort((a, b) => {
          const aTs = new Date(`${a.orderDate}T${a.orderTime || '00:00'}`).getTime();
          const bTs = new Date(`${b.orderDate}T${b.orderTime || '00:00'}`).getTime();
          return bTs - aTs;
        }),
      ] as const);
  }, [filteredUberEatsOrders]);

  const toggleWebsiteRaw = useCallback((orderId: string) => {
    setWebsiteRawVisible((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  }, []);

  const loadWebsiteConnectionSettings = useCallback(async (): Promise<CampaignSettings> => {
    try {
      const raw = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      const parsedLocal = raw ? (JSON.parse(raw) as CampaignSettings & { updatedAt?: number; deleted?: boolean }) : null;
      let selected: (CampaignSettings & { updatedAt?: number; deleted?: boolean }) | null = parsedLocal;

      if (currentUser?.id) {
        try {
          const remoteSettings = await getFromServer<any>({
            userId: currentUser.id,
            dataType: 'campaign_settings',
            includeDeleted: true,
            minDays: 3650,
          });
          const latestRemote = (Array.isArray(remoteSettings) ? remoteSettings : [])
            .filter((item: any) => item && item.deleted !== true)
            .sort((a: any, b: any) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];

          if (latestRemote) {
            const localUpdatedAt = Number((parsedLocal as any)?.updatedAt) || 0;
            const remoteUpdatedAt = Number(latestRemote.updatedAt) || 0;
            if (!parsedLocal || remoteUpdatedAt >= localUpdatedAt) {
              selected = latestRemote;
              await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(latestRemote));
            }
          }
        } catch (remoteError) {
          console.warn('Failed to refresh campaign settings for website orders:', remoteError);
        }
      }

      if (!selected) return {};
      return {
        websiteOrdersUsername: String(selected.websiteOrdersUsername || ''),
        websiteOrdersPassword: String(selected.websiteOrdersPassword || ''),
        websiteOrdersBizId: String(selected.websiteOrdersBizId || ''),
        uberEatsClientId: String(selected.uberEatsClientId || ''),
        uberEatsClientSecret: String(selected.uberEatsClientSecret || ''),
        uberEatsOutletConfigs: (selected.uberEatsOutletConfigs && typeof selected.uberEatsOutletConfigs === 'object')
          ? selected.uberEatsOutletConfigs
          : {},
      };
    } catch {
      return {};
    }
  }, [currentUser?.id]);

  const loadWebsiteItemMappings = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(WEBSITE_PRODUCT_MAP_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setWebsiteItemMappings(parsed as Record<string, string>);
      } else {
        setWebsiteItemMappings({});
      }
    } catch {
      setWebsiteItemMappings({});
    }
  }, []);

  useEffect(() => {
    loadWebsiteItemMappings().catch(() => {});
  }, [loadWebsiteItemMappings]);

  const persistWebsiteItemMappings = useCallback(async (next: Record<string, string>) => {
    setWebsiteItemMappings(next);
    await AsyncStorage.setItem(WEBSITE_PRODUCT_MAP_KEY, JSON.stringify(next));
  }, []);

  const promptWebsiteItemMappings = useCallback(async (choices: WebsiteUnmatchedChoice[]) => {
    if (choices.length === 0) {
      return { proceed: true, mappings: {} } as WebsiteMappingPromptResult;
    }

    const initialSelections: Record<string, string> = {};
    choices.forEach((choice) => {
      if (choice.suggestedProductId) {
        initialSelections[choice.key] = choice.suggestedProductId;
      }
    });

    setWebsiteMatchChoices(choices);
    setWebsiteMatchSelections(initialSelections);
    setWebsiteMatchModalVisible(true);

    return await new Promise<WebsiteMappingPromptResult>((resolve) => {
      websiteMatchResolverRef.current = resolve;
    });
  }, []);

  const closeWebsiteMappingPrompt = useCallback((result: WebsiteMappingPromptResult) => {
    setWebsiteMatchModalVisible(false);
    const resolver = websiteMatchResolverRef.current;
    websiteMatchResolverRef.current = null;
    if (resolver) {
      resolver(result);
    }
  }, []);

  const findMenuProductByWebsiteItem = useCallback((item: WebsiteOrderItem, mappings: Record<string, string>) => {
    const itemName = String(item.itemName || '').trim();
    const variantName = String(item.variantName || '').trim();
    const mapKey = getWebsiteItemMapKey(itemName, variantName);
    const sizeHint = extractSizeHint(itemName, variantName);
    const mappedProductId = mappings[mapKey];

    if (mappedProductId) {
      const mappedProduct = menuProducts.find((product) => product.id === mappedProductId);
      if (mappedProduct) {
        return {
          product: mappedProduct,
          mapKey,
          sizeHint,
          suggestedProductId: mappedProduct.id,
        };
      }
    }

    const normalizedItem = normalizeName(itemName);
    const normalizedVariant = normalizeName(variantName);
    if (!normalizedItem) {
      return { product: null, mapKey, sizeHint };
    }

    const candidates = menuProducts.filter((product) => {
      const productName = normalizeName(product.name);
      if (productName === normalizedItem) return true;
      if (normalizedItem.includes(productName) || productName.includes(normalizedItem)) return true;
      if (normalizedVariant && (productName.includes(normalizedVariant) || normalizedVariant.includes(productName))) return true;
      return false;
    });

    if (candidates.length === 0) {
      return { product: null, mapKey, sizeHint };
    }

    const unitFiltered = sizeHint
      ? candidates.filter((candidate) => {
          const normalizedUnit = normalizeUnitHint(candidate.unit);
          const productName = normalizeName(candidate.name);
          return normalizedUnit === sizeHint || productName.includes(sizeHint);
        })
      : candidates;
    const scoredPool = unitFiltered.length > 0 ? unitFiltered : candidates;

    const scored = scoredPool
      .map((candidate) => {
        const productName = normalizeName(candidate.name);
        let score = 0;
        if (productName === normalizedItem) score += 100;
        else if (normalizedItem.includes(productName) || productName.includes(normalizedItem)) score += 45;
        if (normalizedVariant && productName.includes(normalizedVariant)) score += 25;
        if (sizeHint) {
          const unitHint = normalizeUnitHint(candidate.unit);
          if (unitHint === sizeHint) score += 35;
          else if (unitFiltered.length === 0) score -= 15;
        }
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score >= 45) {
      return {
        product: best.candidate,
        mapKey,
        sizeHint,
        suggestedProductId: best.candidate.id,
      };
    }

    return {
      product: null,
      mapKey,
      sizeHint,
      suggestedProductId: best?.candidate?.id,
    };
  }, [menuProducts]);

  const resolveSalesOutletName = useCallback((rawOutletName: string | undefined) => {
    const fallback = salesOutlets[0]?.name || outlets[0]?.name || '';
    const normalizedCandidate = normalizeOutletName(rawOutletName);
    if (!normalizedCandidate) return fallback;

    const exact = salesOutlets.find((outlet) => normalizeOutletName(outlet.name) === normalizedCandidate);
    if (exact) return exact.name;

    const fuzzy = salesOutlets.find((outlet) => {
      const normalizedOutlet = normalizeOutletName(outlet.name);
      return normalizedCandidate.includes(normalizedOutlet) || normalizedOutlet.includes(normalizedCandidate);
    });
    return fuzzy?.name || fallback;
  }, [salesOutlets, outlets]);

  const mergeWebsiteItemMappings = useCallback(async (updates: Record<string, string>) => {
    if (Object.keys(updates).length === 0) return websiteItemMappings;
    const merged = {
      ...websiteItemMappings,
      ...updates,
    };
    await persistWebsiteItemMappings(merged);
    return merged;
  }, [persistWebsiteItemMappings, websiteItemMappings]);

  const pullWebsiteOrders = useCallback(async (options: WebsitePullOptions = {}): Promise<boolean> => {
    if (!currentUser) {
      if (!options.silent) {
        Alert.alert('Error', 'You must be logged in to pull website orders');
      }
      return false;
    }

    const settings = await loadWebsiteConnectionSettings();
    const username = String(settings.websiteOrdersUsername || '').trim();
    const password = String(settings.websiteOrdersPassword || '').trim();
    const bizId = String(settings.websiteOrdersBizId || '').trim();
    if (!username || !password || !bizId) {
      if (!options.silent) {
        Alert.alert('Missing Website Connection', 'Please add Appigo Username, Password, and Biz ID in Settings > Campaign Services > Website Orders Connection.');
      }
      return false;
    }

    setWebsiteOrdersSyncing(true);
    try {
      const purchaseStatus = options.purchaseStatus || 'all';
      const apiBase = getApiBaseUrl();
      const endpoint = `${apiBase}/Tracker/api/fetch-website-orders.php`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          bizId,
          purchaseStatus,
          tz: new Date().getTimezoneOffset(),
          timezone: 'Asia/Colombo',
          maxPages: 20,
        }),
      });

      const data = (await response.json()) as WebsiteOrdersResponse;
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || `Failed to pull website orders (HTTP ${response.status})`);
      }

      const now = Date.now();
      const incomingRows = Array.isArray(data.orders) ? data.orders : [];
      const importedOrders: WebsiteOrder[] = incomingRows
        .map((row) => toWebsiteOrder(row, now, currentUser.id))
        .filter((row): row is WebsiteOrder => row !== null);

      const merged = mergeWebsiteOrders(websiteOrders, importedOrders);
      await persistWebsiteOrders(merged, importedOrders);

      let activeMappings = websiteItemMappings;
      const unresolvedChoices = new Map<string, WebsiteUnmatchedChoice>();
      importedOrders.forEach((websiteOrder) => {
        websiteOrder.items.forEach((item) => {
          const qty = Number(item.itemQuantity) || 0;
          if (qty <= 0) return;
          const match = findMenuProductByWebsiteItem(item, activeMappings);
          if (match.product) return;
          const key = match.mapKey;
          const existingChoice = unresolvedChoices.get(key);
          if (existingChoice) {
            existingChoice.count += 1;
            if (!existingChoice.suggestedProductId && match.suggestedProductId) {
              existingChoice.suggestedProductId = match.suggestedProductId;
            }
            return;
          }
          unresolvedChoices.set(key, {
            key,
            itemName: String(item.itemName || '').trim() || 'Unnamed Item',
            variantName: String(item.variantName || '').trim() || undefined,
            sizeHint: match.sizeHint || undefined,
            count: 1,
            suggestedProductId: match.suggestedProductId,
          });
        });
      });

      if (unresolvedChoices.size > 0) {
        const promptResult = await promptWebsiteItemMappings(Array.from(unresolvedChoices.values()));
        if (!promptResult.proceed) {
          if (!options.silent) {
            Alert.alert('Import Cancelled', 'No website orders were imported.');
          }
          return false;
        }
        activeMappings = await mergeWebsiteItemMappings(promptResult.mappings);
      }

      const existingByWebsiteTx = new Map<string, CustomerOrder>();
      orders.forEach((order) => {
        const txId = websiteSourceIdFromOrder(order);
        if (!txId) return;
        if (!existingByWebsiteTx.has(txId)) {
          existingByWebsiteTx.set(txId, order);
        }
      });

      const unmatchedItems = new Set<string>();
      const mappedWebsiteOrders: Array<{
        source: WebsiteOrder;
        orderData: Omit<CustomerOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'>;
      }> = [];

      importedOrders.forEach((websiteOrder) => {
        const productMap = new Map<string, OrderProduct>();
        const unmatchedForOrder = new Set<string>();

        websiteOrder.items.forEach((item) => {
          const qty = Number(item.itemQuantity) || 0;
          if (qty <= 0) return;
          const matched = findMenuProductByWebsiteItem(item, activeMappings);
          if (!matched.product) {
            const label = String(item.itemName || '').trim();
            if (label) {
              unmatchedItems.add(label);
              unmatchedForOrder.add(label);
            }
            return;
          }
          const existingProduct = productMap.get(matched.product.id);
          if (existingProduct) {
            existingProduct.quantity += qty;
          } else {
            productMap.set(matched.product.id, {
              productId: matched.product.id,
              quantity: qty,
              unit: matched.product.unit,
            });
          }
        });

        if (productMap.size === 0) {
          return;
        }

        const outletFromWebsite =
          websiteOrder.pickupMethodSubtype ||
          (typeof websiteOrder.detail?.pickupMethodSubtype === 'string' ? String(websiteOrder.detail?.pickupMethodSubtype) : '') ||
          (typeof websiteOrder.additionalInfos?.pickupOutletName === 'string' ? String(websiteOrder.additionalInfos?.pickupOutletName) : '');
        const matchedOutlet = resolveSalesOutletName(outletFromWebsite);

        const deliveryText = `${websiteOrder.collectionMethod || ''} ${websiteOrder.pickupMethodSubtype || ''}`.toLowerCase();
        const isDelivery = deliveryText.includes('deliver');
        const deliveryMethod: DeliveryMethod = isDelivery ? 'deliver' : 'collection';

        const noteParts: string[] = [
          `${WEBSITE_NOTE_PREFIX} ${websiteOrder.transactionId}`,
          `Website Status: ${websiteOrder.status || '-'}`,
          `Channel: ${websiteOrder.channel || '-'}`,
          `Payment: ${websiteOrder.paymentStatus || '-'} (${websiteOrder.paymentType || '-'})`,
        ];
        if (websiteOrder.additionalComments) {
          noteParts.push(`Customer Comment: ${websiteOrder.additionalComments}`);
        }
        if (unmatchedForOrder.size > 0) {
          noteParts.push(`Unmatched website items skipped: ${Array.from(unmatchedForOrder).join(', ')}`);
        }

        const phone = String(websiteOrder.customerPhone || '').trim();
        const normalizedPhone = normalizePhone(phone);
        const matchedCustomer = normalizedPhone
          ? customers.find((customer) => normalizePhone(customer.phone || '') === normalizedPhone)
          : undefined;

        mappedWebsiteOrders.push({
          source: websiteOrder,
          orderData: {
            customerId: matchedCustomer?.id,
            customerName: String(websiteOrder.customerName || 'Website Customer').trim() || 'Website Customer',
            customerPhone: phone || 'N/A',
            customerEmail: String(websiteOrder.customerEmail || '').trim() || undefined,
            customerAddress: String(websiteOrder.customerAddress || '').trim() || undefined,
            products: Array.from(productMap.values()),
            orderDate: websiteOrder.orderDate,
            orderTime: websiteOrder.orderTime,
            deliveryMethod,
            deliveryAddress: deliveryMethod === 'deliver' ? (String(websiteOrder.customerAddress || '').trim() || undefined) : undefined,
            collectionOutlet: deliveryMethod === 'collection' ? matchedOutlet : undefined,
            outlet: matchedOutlet,
            orderReceivedFrom: 'via_website',
            notes: noteParts.join('\n'),
            createdBy: currentUser.id,
            externalSource: WEBSITE_SOURCE,
            externalSourceId: websiteOrder.transactionId,
          },
        });
      });

      const skippedNoMatchedProducts = importedOrders.length - mappedWebsiteOrders.length;
      let ordersCreated = 0;
      let ordersUpdated = 0;
      let ordersSkipped = 0;
      let requestRowsCreated = 0;

      for (const mapped of mappedWebsiteOrders) {
        const existing = existingByWebsiteTx.get(mapped.source.transactionId);
        if (existing && existing.status === 'fulfilled') {
          ordersSkipped += 1;
          continue;
        }

        if (existing) {
          await updateOrder(existing.id, {
            ...mapped.orderData,
          });
          ordersUpdated += 1;
          continue;
        }

        await addOrder(mapped.orderData);
        ordersCreated += 1;

        for (const productRow of mapped.orderData.products) {
          await addRequest({
            id: `req-web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            productId: productRow.productId,
            quantity: productRow.quantity,
            priority: 'high',
            notes: `Website Order ${mapped.source.transactionId}: ${mapped.orderData.customerName} (${mapped.orderData.customerPhone})`,
            requestedBy: currentUser.id,
            requestedAt: Date.now(),
            status: 'pending',
            fromOutlet: outlets.find((outlet) => outlet.outletType === 'production')?.name || outlets[0]?.name || 'Main',
            toOutlet: mapped.orderData.outlet,
            requestDate: mapped.orderData.orderDate,
            doneDate: new Date().toISOString().split('T')[0],
          });
          requestRowsCreated += 1;
        }
      }

      const knownPhones = new Set(
        customers.map((customer) => normalizePhone(customer.phone || '')).filter((p) => p !== '')
      );
      const newCustomers: Parameters<typeof importCustomers>[0] = [];
      mappedWebsiteOrders.forEach((entry) => {
        const phone = normalizePhone(entry.source.customerPhone);
        if (!phone || knownPhones.has(phone)) return;
        knownPhones.add(phone);
        newCustomers.push({
          name: entry.source.customerName || 'Website Customer',
          phone: entry.source.customerPhone,
          email: entry.source.customerEmail,
          address: entry.source.customerAddress,
          notes: `Imported from Website Order ${entry.source.transactionId}`,
        });
      });

      let customersAdded = 0;
      if (newCustomers.length > 0) {
        customersAdded = await importCustomers(newCustomers);
      }

      if (data.range?.startDate && data.range?.endDate) {
        setWebsiteRangeLabel(`${data.range.startDate} to ${data.range.endDate}`);
      }

      if (!options.silent) {
        const apiSkipped = data.summary?.skipped ?? 0;
        const unmatchedCount = unmatchedItems.size;
        Alert.alert(
          'Website Orders Pulled',
          `Fetched: ${importedOrders.length}\nCreated: ${ordersCreated}\nUpdated: ${ordersUpdated}\nSkipped (no matched products): ${skippedNoMatchedProducts}\nSkipped (fulfilled/already final): ${ordersSkipped}\nUnmatched website item names: ${unmatchedCount}\nRequests created: ${requestRowsCreated}\nNew customers added: ${customersAdded}\nAPI skipped: ${apiSkipped}`
        );
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull website orders';
      console.error('Website order pull failed:', error);
      if (!options.silent) {
        Alert.alert('Pull Failed', message);
      }
      return false;
    } finally {
      setWebsiteOrdersSyncing(false);
    }
  }, [
    currentUser,
    loadWebsiteConnectionSettings,
    getApiBaseUrl,
    mergeWebsiteOrders,
    websiteOrders,
    persistWebsiteOrders,
    websiteItemMappings,
    findMenuProductByWebsiteItem,
    promptWebsiteItemMappings,
    mergeWebsiteItemMappings,
    orders,
    resolveSalesOutletName,
    customers,
    updateOrder,
    addOrder,
    addRequest,
    outlets,
    importCustomers,
  ]);

  const handlePullWebsiteOrders = useCallback(async () => {
    await pullWebsiteOrders({
      purchaseStatus: 'all',
      silent: false,
      source: 'manual',
    });
  }, [pullWebsiteOrders]);

  const pullUberEatsOrders = useCallback(async (): Promise<boolean> => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to pull Uber Eats orders');
      return false;
    }

    const settings = await loadWebsiteConnectionSettings();
    const clientId = String(settings.uberEatsClientId || '').trim();
    const clientSecret = String(settings.uberEatsClientSecret || '').trim();
    const outletConfigs = settings.uberEatsOutletConfigs && typeof settings.uberEatsOutletConfigs === 'object'
      ? settings.uberEatsOutletConfigs
      : {};
    const hasMappedStore = Object.values(outletConfigs).some((row: any) => String(row?.storeId || '').trim() !== '');
    if (!clientId || !clientSecret || !hasMappedStore) {
      Alert.alert(
        'Missing Uber Eats Setup',
        'Please add Uber Client ID, Client Secret, and at least one Uber Store ID mapping in Settings > Campaign Services.'
      );
      return false;
    }

    setUberEatsOrdersSyncing(true);
    try {
      const endpoint = `${getApiBaseUrl()}/Tracker/api/uber-eats-orders.php?action=sync`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletName: uberOutletFilter || '',
        }),
      });
      const data = (await response.json()) as UberEatsSyncResponse;
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || `Failed to pull Uber Eats orders (HTTP ${response.status})`);
      }

      await loadUberEatsOrders();
      const counts = Array.isArray(data.counts) ? data.counts : [];
      const summaryText = counts.map((row) => `${row.outletName || 'Outlet'}: ${Number(row.loaded || 0)}`).join('\n');
      Alert.alert(
        'Uber Eats Orders Synced',
        `Saved ${Number(data.savedCount || 0)} order(s).${summaryText ? `\n\n${summaryText}` : ''}`
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull Uber Eats orders';
      Alert.alert('Uber Eats Sync Failed', message);
      return false;
    } finally {
      setUberEatsOrdersSyncing(false);
    }
  }, [currentUser, loadWebsiteConnectionSettings, getApiBaseUrl, uberOutletFilter, loadUberEatsOrders]);

  const getKnownWebsiteTransactionIds = useCallback(() => {
    const known = new Set<string>();
    websiteOrders.forEach((order) => {
      if (order.transactionId) known.add(order.transactionId);
    });
    orders.forEach((order) => {
      const tx = websiteSourceIdFromOrder(order);
      if (tx) known.add(tx);
    });
    return known;
  }, [websiteOrders, orders]);

  const pingWebsitePendingOrders = useCallback(async () => {
    if (!currentUser || websiteOrdersSyncing || websiteMatchModalVisible) return;

    const now = Date.now();
    if (now - lastWebsitePingAtRef.current < 45000) {
      return;
    }
    lastWebsitePingAtRef.current = now;

    const settings = await loadWebsiteConnectionSettings();
    const username = String(settings.websiteOrdersUsername || '').trim();
    const password = String(settings.websiteOrdersPassword || '').trim();
    const bizId = String(settings.websiteOrdersBizId || '').trim();
    if (!username || !password || !bizId) return;

    try {
      const apiBase = getApiBaseUrl();
      const endpoint = `${apiBase}/Tracker/api/fetch-website-orders.php`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          bizId,
          purchaseStatus: 'pending',
          tz: new Date().getTimezoneOffset(),
          timezone: 'Asia/Colombo',
          maxPages: 10,
          summaryOnly: true,
        }),
      });
      const data = (await response.json()) as WebsiteOrdersResponse;
      if (!response.ok || data.success !== true) return;
      const pendingIds = Array.isArray(data.orderIds) ? data.orderIds.filter(Boolean) : [];
      if (pendingIds.length === 0) return;

      const knownIds = getKnownWebsiteTransactionIds();
      const hasNew = pendingIds.some((txId) => !knownIds.has(txId));
      if (!hasNew) return;

      await pullWebsiteOrders({
        purchaseStatus: 'pending',
        silent: true,
        source: 'auto',
      });
    } catch (error) {
      console.error('Website pending ping failed:', error);
    }
  }, [
    currentUser,
    websiteOrdersSyncing,
    websiteMatchModalVisible,
    loadWebsiteConnectionSettings,
    getApiBaseUrl,
    getKnownWebsiteTransactionIds,
    pullWebsiteOrders,
  ]);

  useEffect(() => {
    pingWebsitePendingOrders().catch(() => {});
    const interval = setInterval(() => {
      pingWebsitePendingOrders().catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [pingWebsitePendingOrders]);

  useFocusEffect(
    useCallback(() => {
      pingWebsitePendingOrders().catch(() => {});
    }, [pingWebsitePendingOrders])
  );

  const resetForm = useCallback(() => {
    setSelectedCustomer('new');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
    setOrderProducts([]);
    setOrderDate(new Date().toISOString().split('T')[0]);
    setOrderTime(new Date().toTimeString().slice(0, 5));
    setDeliveryMethod('collection');
    setDeliveryAddress('');
    setCollectionOutlet(outlets.filter(o => o.outletType === 'sales')[0]?.name || '');
    setOrderOutlet(outlets.filter(o => o.outletType === 'sales')[0]?.name || '');
    setOrderReceivedFrom('at_outlet');
    setOrderReceivedFromOther('');
    setOrderNotes('');
    setSelectedProductId('');
    setProductQuantity('');
    setProductSearchQuery('');
  }, [outlets]);

  const handleAddProduct = useCallback(() => {
    if (!selectedProductId || !productQuantity) {
      Alert.alert('Error', 'Please select a product and enter quantity');
      return;
    }

    const product = products.find(p => p.id === selectedProductId);
    if (!product) {
      Alert.alert('Error', 'Product not found');
      return;
    }

    const qty = parseFloat(productQuantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return;
    }

    const existingIndex = orderProducts.findIndex(p => p.productId === selectedProductId);
    if (existingIndex >= 0) {
      const updated = [...orderProducts];
      updated[existingIndex].quantity += qty;
      setOrderProducts(updated);
    } else {
      setOrderProducts([...orderProducts, {
        productId: selectedProductId,
        quantity: qty,
        unit: product.unit,
      }]);
    }

    setSelectedProductId('');
    setProductQuantity('');
  }, [selectedProductId, productQuantity, orderProducts, products]);

  const handleRemoveProduct = useCallback((productId: string) => {
    setOrderProducts(orderProducts.filter(p => p.productId !== productId));
  }, [orderProducts]);

  const handleSubmitOrder = useCallback(async () => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be logged in to create orders');
      return;
    }

    if (!customerName.trim()) {
      Alert.alert('Error', 'Please enter customer name');
      return;
    }

    if (!customerPhone.trim()) {
      Alert.alert('Error', 'Please enter customer phone number');
      return;
    }

    if (orderProducts.length === 0) {
      Alert.alert('Error', 'Please add at least one product');
      return;
    }

    if (deliveryMethod === 'deliver' && !deliveryAddress.trim()) {
      Alert.alert('Error', 'Please enter delivery address');
      return;
    }

    if (deliveryMethod === 'collection' && !collectionOutlet) {
      Alert.alert('Error', 'Please select collection outlet');
      return;
    }

    if (orderReceivedFrom === 'other' && !orderReceivedFromOther.trim()) {
      Alert.alert('Error', 'Please specify how the order was received');
      return;
    }

    try {
      setIsSubmitting(true);

      let customerId: string | undefined;
      if (selectedCustomer === 'new') {
        const existingCustomer = customers.find(c => c.phone === customerPhone.trim());
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          await addCustomer({
            name: customerName.trim(),
            phone: customerPhone.trim(),
            email: customerEmail.trim() || undefined,
            address: customerAddress.trim() || undefined,
          });
          const newCustomer = customers.find(c => c.phone === customerPhone.trim());
          customerId = newCustomer?.id;
        }
      } else {
        customerId = selectedCustomer;
        const customer = customers.find(c => c.id === selectedCustomer);
        if (customer) {
          setCustomerName(customer.name);
          setCustomerPhone(customer.phone || '');
          setCustomerEmail(customer.email || '');
          setCustomerAddress(customer.address || '');
        }
      }

      await addOrder({
        customerId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        products: orderProducts,
        orderDate,
        orderTime,
        deliveryMethod,
        deliveryAddress: deliveryMethod === 'deliver' ? deliveryAddress.trim() : undefined,
        collectionOutlet: deliveryMethod === 'collection' ? collectionOutlet : undefined,
        outlet: orderOutlet,
        orderReceivedFrom,
        orderReceivedFromOther: orderReceivedFrom === 'other' ? orderReceivedFromOther.trim() : undefined,
        notes: orderNotes.trim() || undefined,
        createdBy: currentUser.id,
      });

      for (const orderProduct of orderProducts) {
        const requestNotes = `Customer Order: ${customerName.trim()} (${customerPhone.trim()})${orderNotes.trim() ? ` - ${orderNotes.trim()}` : ''}`;
        await addRequest({
          id: `req-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          productId: orderProduct.productId,
          quantity: orderProduct.quantity,
          priority: 'high',
          notes: requestNotes,
          requestedBy: currentUser.id,
          requestedAt: Date.now(),
          status: 'pending',
          fromOutlet: outlets.find(o => o.outletType === 'production')?.name || outlets[0]?.name || 'Main',
          toOutlet: orderOutlet,
          requestDate: orderDate,
          doneDate: new Date().toISOString().split('T')[0],
        });
      }

      Alert.alert('Success', 'Order created successfully!');
      resetForm();
      setShowNewOrderModal(false);
    } catch (error) {
      console.error('Failed to create order:', error);
      Alert.alert('Error', 'Failed to create order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [currentUser, customerName, customerPhone, customerEmail, customerAddress, orderProducts, orderDate, orderTime, deliveryMethod, deliveryAddress, collectionOutlet, orderOutlet, orderReceivedFrom, orderReceivedFromOther, orderNotes, selectedCustomer, customers, addCustomer, addOrder, resetForm, addRequest, outlets]);

  const handleFulfillOrder = useCallback(async (orderId: string) => {
    if (!currentUser) return;
    
    try {
      await fulfillOrder(orderId, currentUser.id);
      Alert.alert('Success', 'Order marked as fulfilled!');
    } catch (error) {
      console.error('Failed to fulfill order:', error);
      Alert.alert('Error', 'Failed to fulfill order. Please try again.');
    }
  }, [currentUser, fulfillOrder]);

  const handleDeleteOrder = useCallback((orderId: string) => {
    setOrderToDelete(orderId);
    setDeleteConfirmVisible(true);
  }, []);

  const confirmDeleteOrder = useCallback(async () => {
    if (orderToDelete) {
      try {
        await deleteOrder(orderToDelete);
        setDeleteConfirmVisible(false);
        setOrderToDelete(null);
        Alert.alert('Success', 'Order deleted successfully!');
      } catch (error) {
        console.error('Failed to delete order:', error);
        Alert.alert('Error', 'Failed to delete order. Please try again.');
      }
    }
  }, [orderToDelete, deleteOrder]);

  const handleEditOrder = useCallback((orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    setEditingOrder(orderId);
    setSelectedCustomer(order.customerId || 'new');
    setCustomerName(order.customerName);
    setCustomerPhone(order.customerPhone);
    setCustomerEmail(order.customerEmail || '');
    setCustomerAddress(order.customerAddress || '');
    setOrderProducts(order.products);
    setOrderDate(order.orderDate);
    setOrderTime(order.orderTime);
    setDeliveryMethod(order.deliveryMethod);
    setDeliveryAddress(order.deliveryAddress || '');
    setCollectionOutlet(order.collectionOutlet || outlets.filter(o => o.outletType === 'sales')[0]?.name || '');
    setOrderOutlet(order.outlet);
    setOrderReceivedFrom(order.orderReceivedFrom || 'at_outlet');
    setOrderReceivedFromOther(order.orderReceivedFromOther || '');
    setOrderNotes(order.notes || '');
    setShowNewOrderModal(true);
  }, [orders, outlets]);

  const handleUpdateOrder = useCallback(async () => {
    if (!editingOrder) return;
    if (!currentUser) return;

    if (!customerName.trim()) {
      Alert.alert('Error', 'Please enter customer name');
      return;
    }

    if (!customerPhone.trim()) {
      Alert.alert('Error', 'Please enter customer phone number');
      return;
    }

    if (orderProducts.length === 0) {
      Alert.alert('Error', 'Please add at least one product');
      return;
    }

    if (deliveryMethod === 'deliver' && !deliveryAddress.trim()) {
      Alert.alert('Error', 'Please enter delivery address');
      return;
    }

    if (deliveryMethod === 'collection' && !collectionOutlet) {
      Alert.alert('Error', 'Please select collection outlet');
      return;
    }

    if (orderReceivedFrom === 'other' && !orderReceivedFromOther.trim()) {
      Alert.alert('Error', 'Please specify how the order was received');
      return;
    }

    try {
      setIsSubmitting(true);

      await updateOrder(editingOrder, {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        products: orderProducts,
        orderDate,
        orderTime,
        deliveryMethod,
        deliveryAddress: deliveryMethod === 'deliver' ? deliveryAddress.trim() : undefined,
        collectionOutlet: deliveryMethod === 'collection' ? collectionOutlet : undefined,
        outlet: orderOutlet,
        orderReceivedFrom,
        orderReceivedFromOther: orderReceivedFrom === 'other' ? orderReceivedFromOther.trim() : undefined,
        notes: orderNotes.trim() || undefined,
      });

      Alert.alert('Success', 'Order updated successfully!');
      resetForm();
      setEditingOrder(null);
      setShowNewOrderModal(false);
    } catch (error) {
      console.error('Failed to update order:', error);
      Alert.alert('Error', 'Failed to update order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [editingOrder, currentUser, customerName, customerPhone, customerEmail, customerAddress, orderProducts, orderDate, orderTime, deliveryMethod, deliveryAddress, collectionOutlet, orderOutlet, orderReceivedFrom, orderReceivedFromOther, orderNotes, updateOrder, resetForm]);

  const handleExportFulfilledOrders = useCallback(async () => {
    try {
      let csvContent = 'Order ID,Customer Name,Phone,Email,Address,Products,Order Date,Order Time,Delivery Method,Outlet,Order Received From,Fulfilled Date,Notes\n';

      fulfilledOrders.forEach(order => {
        const productsStr = order.products.map(p => {
          const product = products.find(pr => pr.id === p.productId);
          return `${product?.name || 'Unknown'} (${p.quantity} ${p.unit})`;
        }).join('; ');

        const fulfilledDate = order.fulfilledAt ? new Date(order.fulfilledAt).toLocaleString() : '';
        
        const receivedFromLabel = order.orderReceivedFrom 
          ? (order.orderReceivedFrom === 'other' 
              ? order.orderReceivedFromOther || 'Other'
              : order.orderReceivedFrom.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))
          : 'N/A';

        const escapedNotes = (order.notes || '').replace(/"/g, '""');
        csvContent += `${order.id},${order.customerName},"${order.customerPhone}","${order.customerEmail || ''}","${order.customerAddress || ''}","${productsStr}",${order.orderDate},${order.orderTime},${order.deliveryMethod},${order.outlet},"${receivedFromLabel}",${fulfilledDate},"${escapedNotes}"\n`;
      });

      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `fulfilled_orders_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        Alert.alert('Success', 'Fulfilled orders exported!');
      } else {
        Alert.alert('Export', 'CSV Export is only available on web. Use the share feature instead.');
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export orders. Please try again.');
    }
  }, [fulfilledOrders, products]);

  const isOrderDelayed = useCallback((order: typeof activeOrders[0]) => {
    const now = new Date();
    const orderDateTime = new Date(`${order.orderDate}T${order.orderTime}`);
    return orderDateTime < now;
  }, []);

  const groupOrdersByDate = useCallback((ordersList: typeof activeOrders) => {
    const grouped = new Map<string, typeof activeOrders>();
    ordersList.forEach(order => {
      const existing = grouped.get(order.orderDate) || [];
      grouped.set(order.orderDate, [...existing, order]);
    });
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  const getOrderReceivedFromLabel = (receivedFrom?: OrderReceivedFrom, other?: string) => {
    if (!receivedFrom) return 'N/A';
    if (receivedFrom === 'other') return other || 'Other';
    
    const labels: Record<OrderReceivedFrom, string> = {
      at_outlet: 'At Outlet',
      on_phone: 'On Phone',
      via_website: 'Via Website',
      ubereats: 'UberEats',
      pickme: 'PickMe',
      other: 'Other'
    };
    return labels[receivedFrom];
  };

  const allWebsiteMappingsSelected = useMemo(() => {
    if (websiteMatchChoices.length === 0) return false;
    return websiteMatchChoices.every((choice) => {
      const selected = String(websiteMatchSelections[choice.key] || '').trim();
      return selected !== '';
    });
  }, [websiteMatchChoices, websiteMatchSelections]);

  const handleCancelWebsiteMapping = useCallback(() => {
    closeWebsiteMappingPrompt({ proceed: false, mappings: {} });
  }, [closeWebsiteMappingPrompt]);

  const handleConfirmWebsiteMapping = useCallback(() => {
    if (!allWebsiteMappingsSelected) {
      Alert.alert('Select Products', 'Please select a system menu product for each unmatched website item.');
      return;
    }
    closeWebsiteMappingPrompt({
      proceed: true,
      mappings: websiteMatchSelections,
    });
  }, [allWebsiteMappingsSelected, closeWebsiteMappingPrompt, websiteMatchSelections]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
      </View>
    );
  }

  const displayOrders = showViewMode === 'active' ? activeOrders : fulfilledOrders;
  const groupedOrders = groupOrdersByDate(displayOrders);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, showViewMode === 'active' && styles.toggleButtonActive]}
            onPress={() => setShowViewMode('active')}
          >
            <Text style={[styles.toggleText, showViewMode === 'active' && styles.toggleTextActive]}>
              Active ({activeOrders.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, showViewMode === 'fulfilled' && styles.toggleButtonActive]}
            onPress={() => setShowViewMode('fulfilled')}
          >
            <Text style={[styles.toggleText, showViewMode === 'fulfilled' && styles.toggleTextActive]}>
              Fulfilled ({fulfilledOrders.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, showViewMode === 'website' && styles.toggleButtonActive]}
            onPress={() => setShowViewMode('website')}
          >
            <Text style={[styles.toggleText, showViewMode === 'website' && styles.toggleTextActive]}>
              Website ({websiteOrders.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, showViewMode === 'uber' && styles.toggleButtonActive]}
            onPress={() => setShowViewMode('uber')}
          >
            <Text style={[styles.toggleText, showViewMode === 'uber' && styles.toggleTextActive]}>
              Uber Eats ({uberEatsOrders.length})
            </Text>
          </TouchableOpacity>
        </View>
        {showViewMode === 'fulfilled' && fulfilledOrders.length > 0 && (
          <TouchableOpacity style={styles.exportButton} onPress={handleExportFulfilledOrders}>
            <Download size={18} color={Colors.light.tint} />
          </TouchableOpacity>
        )}
        {showViewMode === 'website' && (
          <View style={styles.websiteActions}>
            <TouchableOpacity
              style={[styles.exportButton, websiteOrdersSyncing && styles.disabledActionButton]}
              onPress={handlePullWebsiteOrders}
              disabled={websiteOrdersSyncing}
            >
              {websiteOrdersSyncing ? (
                <ActivityIndicator size="small" color={Colors.light.tint} />
              ) : (
                <RefreshCw size={18} color={Colors.light.tint} />
              )}
            </TouchableOpacity>
          </View>
        )}
        {showViewMode === 'uber' && (
          <View style={styles.websiteActions}>
            <TouchableOpacity
              style={[styles.exportButton, uberEatsOrdersSyncing && styles.disabledActionButton]}
              onPress={() => {
                pullUberEatsOrders().catch(() => {});
              }}
              disabled={uberEatsOrdersSyncing}
            >
              {uberEatsOrdersSyncing ? (
                <ActivityIndicator size="small" color={Colors.light.tint} />
              ) : (
                <RefreshCw size={18} color={Colors.light.tint} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {showViewMode === 'website' && websiteRangeLabel ? (
        <View style={styles.websiteConfigCard}>
          <Text style={styles.websiteConfigHint}>Last pulled range: {websiteRangeLabel}</Text>
        </View>
      ) : null}

      {showViewMode === 'uber' ? (
        <View style={styles.websiteConfigCard}>
          <Text style={styles.websiteConfigHint}>Show Uber Eats orders for the selected sales outlet.</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={uberOutletFilter}
              onValueChange={(value: string) => setUberOutletFilter(value)}
              style={styles.picker}
            >
              <Picker.Item label="All Outlets" value="" />
              {salesOutlets.map((outlet) => (
                <Picker.Item key={`uber_filter_${outlet.id}`} label={outlet.name} value={outlet.name} />
              ))}
            </Picker>
          </View>
        </View>
      ) : null}

      {showViewMode === 'website' ? (
        websiteOrdersLoading ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
          </View>
        ) : websiteOrders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Globe size={64} color={Colors.light.muted} />
            <Text style={styles.emptyTitle}>No Website Orders</Text>
            <Text style={styles.emptyText}>Use the refresh button to pull website orders. Credentials are in Settings.</Text>
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {groupedWebsiteOrders.map(([date, dateOrders]) => (
              <View key={date} style={styles.dateGroup}>
                <Text style={styles.dateGroupTitle}>{date}</Text>
                {dateOrders.map((order) => (
                  <View key={order.id} style={styles.orderCard}>
                    <View style={styles.orderHeader}>
                      <View style={styles.orderHeaderLeft}>
                        <Text style={styles.customerName}>{order.customerName}</Text>
                        <Text style={styles.orderDateTime}>
                          {order.orderDate} at {order.orderTime}  |  {order.transactionId}
                        </Text>
                      </View>
                      <View style={styles.websiteStatusChip}>
                        <Text style={styles.websiteStatusText}>{order.status || 'UNKNOWN'}</Text>
                      </View>
                    </View>

                    <View style={styles.orderDetails}>
                      <View style={styles.orderDetailRow}>
                        <Phone size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>{order.customerPhone || 'No phone'}</Text>
                      </View>
                      {order.customerEmail ? (
                        <View style={styles.orderDetailRow}>
                          <Mail size={14} color={Colors.light.muted} />
                          <Text style={styles.orderDetailText}>{order.customerEmail}</Text>
                        </View>
                      ) : null}
                      <View style={styles.orderDetailRow}>
                        <MapPin size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>{order.customerAddress || 'No address'}</Text>
                      </View>
                      <View style={styles.orderDetailRow}>
                        <Package size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>
                          Method: {order.collectionMethod || '-'} | Channel: {order.channel || '-'}
                        </Text>
                      </View>
                      <View style={styles.orderDetailRow}>
                        <ShoppingBag size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>
                          Payment: {order.paymentStatus || '-'} ({order.paymentType || '-'})
                        </Text>
                      </View>
                      <View style={styles.orderDetailRow}>
                        <Text style={styles.websiteMoneyLabel}>Total:</Text>
                        <Text style={styles.websiteMoneyValue}>LKR {order.grandTotalPrice?.toFixed(2) || '0.00'}</Text>
                      </View>
                      {typeof order.serviceCharge === 'number' ? (
                        <View style={styles.orderDetailRow}>
                          <Text style={styles.websiteMoneyLabel}>Service Charge:</Text>
                          <Text style={styles.websiteMoneyValue}>LKR {order.serviceCharge.toFixed(2)}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.productsSection}>
                      <Text style={styles.productsSectionTitle}>Items:</Text>
                      {order.items.length === 0 ? (
                        <Text style={styles.notesText}>No item rows found.</Text>
                      ) : (
                        order.items.map((item, idx) => (
                          <View key={`${order.id}_${idx}`} style={styles.productItem}>
                            <Text style={styles.productName}>
                              {item.itemName}
                              {item.variantName ? ` (${item.variantName})` : ''}
                            </Text>
                            <Text style={styles.productQuantity}>
                              {item.itemQuantity} x {item.unitPrice?.toFixed(2) || '0.00'}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>

                    {order.additionalComments ? (
                      <View style={styles.notesSection}>
                        <Text style={styles.notesLabel}>Customer Comment:</Text>
                        <Text style={styles.notesText}>{order.additionalComments}</Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={styles.websiteRawToggle}
                      onPress={() => toggleWebsiteRaw(order.id)}
                    >
                      <Text style={styles.websiteRawToggleText}>
                        {websiteRawVisible[order.id] ? 'Hide Raw Details' : 'Show Raw Details'}
                      </Text>
                    </TouchableOpacity>
                    {websiteRawVisible[order.id] ? (
                      <View style={styles.websiteRawBlock}>
                        <Text style={styles.websiteRawText}>
                          {JSON.stringify(order.detail || {}, null, 2)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )
      ) : showViewMode === 'uber' ? (
        uberEatsOrdersLoading ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
          </View>
        ) : filteredUberEatsOrders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <ShoppingBag size={64} color={Colors.light.muted} />
            <Text style={styles.emptyTitle}>No Uber Eats Orders</Text>
            <Text style={styles.emptyText}>Use the refresh button to sync Uber Eats orders for the selected outlet.</Text>
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {groupedUberEatsOrders.map(([date, dateOrders]) => (
              <View key={`uber_${date}`} style={styles.dateGroup}>
                <Text style={styles.dateGroupTitle}>{date}</Text>
                {dateOrders.map((order) => (
                  <View key={order.id} style={styles.orderCard}>
                    <View style={styles.orderHeader}>
                      <View style={styles.orderHeaderLeft}>
                        <Text style={styles.customerName}>{order.customerName || order.displayId || order.id}</Text>
                        <Text style={styles.orderDateTime}>
                          {order.orderDate} at {order.orderTime}
                          {order.displayId ? `  |  ${order.displayId}` : ''}
                        </Text>
                      </View>
                      <View style={styles.websiteStatusChip}>
                        <Text style={styles.websiteStatusText}>{order.currentState || 'UNKNOWN'}</Text>
                      </View>
                    </View>

                    <View style={styles.orderDetails}>
                      <View style={styles.orderDetailRow}>
                        <Package size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>
                          Outlet: {order.outletName || '-'} | Store: {order.storeName || order.storeId || '-'}
                        </Text>
                      </View>
                      <View style={styles.orderDetailRow}>
                        <ShoppingBag size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>
                          Type: {order.fulfillmentType || '-'}
                          {order.scheduledAt ? ` | Scheduled: ${order.scheduledAt}` : ''}
                        </Text>
                      </View>
                      {order.customerPhone ? (
                        <View style={styles.orderDetailRow}>
                          <Phone size={14} color={Colors.light.muted} />
                          <Text style={styles.orderDetailText}>{order.customerPhone}</Text>
                        </View>
                      ) : null}
                      {order.customerAddress ? (
                        <View style={styles.orderDetailRow}>
                          <MapPin size={14} color={Colors.light.muted} />
                          <Text style={styles.orderDetailText}>{order.customerAddress}</Text>
                        </View>
                      ) : null}
                      <View style={styles.orderDetailRow}>
                        <Text style={styles.websiteMoneyLabel}>Total:</Text>
                        <Text style={styles.websiteMoneyValue}>
                          {order.currency || 'LKR'} {typeof order.totalAmount === 'number' ? order.totalAmount.toFixed(2) : '0.00'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.productsSection}>
                      <Text style={styles.productsSectionTitle}>Items:</Text>
                      {order.items.length === 0 ? (
                        <Text style={styles.notesText}>No item rows found.</Text>
                      ) : (
                        order.items.map((item, idx) => (
                          <View key={`${order.id}_uber_${idx}`} style={styles.productItem}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.productName}>{item.title}</Text>
                              {item.customizations && item.customizations.length > 0 ? (
                                <Text style={styles.notesText}>{item.customizations.join(', ')}</Text>
                              ) : null}
                              {item.specialInstructions ? (
                                <Text style={styles.notesText}>{item.specialInstructions}</Text>
                              ) : null}
                            </View>
                            <Text style={styles.productQuantity}>
                              {item.quantity} x {typeof item.price === 'number' ? item.price.toFixed(2) : '0.00'}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )
      ) : displayOrders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ShoppingBag size={64} color={Colors.light.muted} />
          <Text style={styles.emptyTitle}>No {showViewMode === 'active' ? 'Active' : 'Fulfilled'} Orders</Text>
          <Text style={styles.emptyText}>
            {showViewMode === 'active' 
              ? 'Tap + to create a new order'
              : 'Fulfilled orders will appear here'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {groupedOrders.map(([date, dateOrders]) => (
            <View key={date} style={styles.dateGroup}>
              <Text style={styles.dateGroupTitle}>{date}</Text>
              {dateOrders.map(order => {
                const isDelayed = showViewMode === 'active' && isOrderDelayed(order);
                return (
                  <View key={order.id} style={[styles.orderCard, isDelayed && styles.orderCardDelayed]}>
                    {isDelayed && (
                      <View style={styles.delayedBadge}>
                        <AlertCircle size={14} color="#fff" />
                        <Text style={styles.delayedText}>Delayed</Text>
                      </View>
                    )}
                    <View style={styles.orderHeader}>
                      <View style={styles.orderHeaderLeft}>
                        <Text style={styles.customerName}>{order.customerName}</Text>
                        <Text style={styles.orderDateTime}>{order.orderDate} at {order.orderTime}</Text>
                      </View>
                      <View style={styles.orderHeaderRight}>
                        {showViewMode === 'active' && (
                          <>
                            <TouchableOpacity
                              style={styles.iconButton}
                              onPress={() => handleEditOrder(order.id)}
                            >
                              <Edit2 size={18} color={Colors.light.tint} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.iconButton}
                              onPress={() => handleDeleteOrder(order.id)}
                            >
                              <Trash2 size={18} color={Colors.light.danger} />
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>

                    <View style={styles.orderDetails}>
                      <View style={styles.orderDetailRow}>
                        <Phone size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>{order.customerPhone}</Text>
                      </View>
                      {order.customerEmail && (
                        <View style={styles.orderDetailRow}>
                          <Mail size={14} color={Colors.light.muted} />
                          <Text style={styles.orderDetailText}>{order.customerEmail}</Text>
                        </View>
                      )}
                      <View style={styles.orderDetailRow}>
                        <MapPin size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>
                          {order.deliveryMethod === 'deliver' 
                            ? `Deliver to: ${order.deliveryAddress}` 
                            : `Collection from: ${order.collectionOutlet}`}
                        </Text>
                      </View>
                      <View style={styles.orderDetailRow}>
                        <Package size={14} color={Colors.light.muted} />
                        <Text style={styles.orderDetailText}>Outlet: {order.outlet}</Text>
                      </View>
                      {order.orderReceivedFrom && (
                        <View style={styles.orderDetailRow}>
                          <ShoppingBag size={14} color={Colors.light.muted} />
                          <Text style={styles.orderDetailText}>
                            Received: {getOrderReceivedFromLabel(order.orderReceivedFrom, order.orderReceivedFromOther)}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.productsSection}>
                      <Text style={styles.productsSectionTitle}>Products:</Text>
                      {order.products.map((p, idx) => {
                        const product = products.find(pr => pr.id === p.productId);
                        return (
                          <View key={idx} style={styles.productItem}>
                            <Text style={styles.productName}>{product?.name || 'Unknown'}</Text>
                            <Text style={styles.productQuantity}>{p.quantity} {p.unit}</Text>
                          </View>
                        );
                      })}
                    </View>

                    {order.notes && (
                      <View style={styles.notesSection}>
                        <Text style={styles.notesLabel}>Notes:</Text>
                        <Text style={styles.notesText}>{order.notes}</Text>
                      </View>
                    )}

                    {showViewMode === 'active' && (
                      <TouchableOpacity
                        style={styles.fulfillButton}
                        onPress={() => handleFulfillOrder(order.id)}
                      >
                        <Check size={18} color="#fff" />
                        <Text style={styles.fulfillButtonText}>Mark as Fulfilled</Text>
                      </TouchableOpacity>
                    )}

                    {showViewMode === 'fulfilled' && order.fulfilledAt && (
                      <View style={styles.fulfilledInfo}>
                        <Clock size={14} color={Colors.light.success} />
                        <Text style={styles.fulfilledText}>
                          Fulfilled on {new Date(order.fulfilledAt).toLocaleString()}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {showViewMode !== 'website' && showViewMode !== 'uber' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            resetForm();
            setEditingOrder(null);
            setShowNewOrderModal(true);
          }}
        >
          <Plus size={28} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal
        visible={showNewOrderModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {
          setShowNewOrderModal(false);
          setEditingOrder(null);
          resetForm();
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editingOrder ? 'Edit Order' : 'New Order'}</Text>
            <TouchableOpacity onPress={() => {
              setShowNewOrderModal(false);
              setEditingOrder(null);
              resetForm();
            }}>
              <X size={24} color={Colors.light.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <Text style={styles.sectionTitle}>Customer Details</Text>
            
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={selectedCustomer}
                onValueChange={(value: string) => {
                  setSelectedCustomer(value);
                  if (value !== 'new') {
                    const customer = customers.find(c => c.id === value);
                    if (customer) {
                      setCustomerName(customer.name);
                      setCustomerPhone(customer.phone || '');
                      setCustomerEmail(customer.email || '');
                      setCustomerAddress(customer.address || '');
                    }
                  } else {
                    setCustomerName('');
                    setCustomerPhone('');
                    setCustomerEmail('');
                    setCustomerAddress('');
                  }
                }}
                style={styles.picker}
              >
                <Picker.Item label="New Customer" value="new" />
                {customers.map(customer => (
                  <Picker.Item
                    key={customer.id}
                    label={`${customer.name} (${customer.phone})`}
                    value={customer.id}
                  />
                ))}
              </Picker>
            </View>

            <Text style={styles.label}>Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Customer Name"
              value={customerName}
              onChangeText={setCustomerName}
              placeholderTextColor={Colors.light.muted}
            />

            <Text style={styles.label}>Phone *</Text>
            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              value={customerPhone}
              onChangeText={setCustomerPhone}
              keyboardType="phone-pad"
              placeholderTextColor={Colors.light.muted}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Email Address"
              value={customerEmail}
              onChangeText={setCustomerEmail}
              keyboardType="email-address"
              placeholderTextColor={Colors.light.muted}
            />

            <Text style={styles.label}>Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Customer Address"
              value={customerAddress}
              onChangeText={setCustomerAddress}
              placeholderTextColor={Colors.light.muted}
            />

            <Text style={styles.sectionTitle}>Order Details</Text>

            <View style={styles.dateTimeContainer}>
              <View style={styles.dateTimeLeft}>
                <Text style={styles.label}>Order Date & Time</Text>
                <View style={styles.dateTimeRow}>
                  <TouchableOpacity 
                    style={styles.datePickerButton}
                    onPress={() => setShowCalendar(true)}
                  >
                    <Calendar size={16} color={Colors.light.tint} />
                    <Text style={styles.datePickerText}>{orderDate}</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.input, styles.timeInput]}
                    placeholder="HH:MM"
                    value={orderTime}
                    onChangeText={setOrderTime}
                    placeholderTextColor={Colors.light.muted}
                  />
                </View>
              </View>

              <View style={styles.orderReceivedContainer}>
                <Text style={styles.label}>Order Received</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={orderReceivedFrom}
                    onValueChange={(value: OrderReceivedFrom) => setOrderReceivedFrom(value)}
                    style={styles.picker}
                  >
                    <Picker.Item label="At Outlet" value="at_outlet" />
                    <Picker.Item label="On Phone" value="on_phone" />
                    <Picker.Item label="Via Website" value="via_website" />
                    <Picker.Item label="UberEats" value="ubereats" />
                    <Picker.Item label="PickMe" value="pickme" />
                    <Picker.Item label="Other" value="other" />
                  </Picker>
                </View>
                {orderReceivedFrom === 'other' && (
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="Specify other source..."
                    value={orderReceivedFromOther}
                    onChangeText={setOrderReceivedFromOther}
                    placeholderTextColor={Colors.light.muted}
                  />
                )}
              </View>
            </View>

            <Text style={styles.label}>Delivery Method *</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={deliveryMethod}
                onValueChange={(value: DeliveryMethod) => setDeliveryMethod(value)}
                style={styles.picker}
              >
                <Picker.Item label="Collection" value="collection" />
                <Picker.Item label="Delivery" value="deliver" />
              </Picker>
            </View>

            {deliveryMethod === 'deliver' && (
              <>
                <Text style={styles.label}>Delivery Address *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter delivery address"
                  value={deliveryAddress}
                  onChangeText={setDeliveryAddress}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor={Colors.light.muted}
                />
              </>
            )}

            {deliveryMethod === 'collection' && (
              <>
                <Text style={styles.label}>Collection Outlet *</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={collectionOutlet}
                    onValueChange={(value: string) => setCollectionOutlet(value)}
                    style={styles.picker}
                  >
                    {salesOutlets.map(outlet => (
                      <Picker.Item
                        key={outlet.id}
                        label={outlet.name}
                        value={outlet.name}
                      />
                    ))}
                  </Picker>
                </View>
              </>
            )}

            <Text style={styles.label}>Order Taken From</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={orderOutlet}
                onValueChange={(value: string) => setOrderOutlet(value)}
                style={styles.picker}
              >
                {salesOutlets.map(outlet => (
                  <Picker.Item
                    key={outlet.id}
                    label={outlet.name}
                    value={outlet.name}
                  />
                ))}
              </Picker>
            </View>

            <Text style={styles.sectionTitle}>Products *</Text>
            
            <View style={styles.searchInputContainer}>
              <Search size={18} color={Colors.light.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search menu products..."
                value={productSearchQuery}
                onChangeText={setProductSearchQuery}
                placeholderTextColor={Colors.light.muted}
              />
              {productSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setProductSearchQuery('')}>
                  <X size={18} color={Colors.light.muted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.productAddRow}>
              <View style={styles.productPickerContainer}>
                <Picker
                  selectedValue={selectedProductId}
                  onValueChange={(value: string) => setSelectedProductId(value)}
                  style={styles.picker}
                >
                  <Picker.Item label="Select Product" value="" />
                  {filteredMenuProducts.map(product => (
                    <Picker.Item
                      key={product.id}
                      label={`${product.name} (${product.unit})`}
                      value={product.id}
                    />
                  ))}
                </Picker>
              </View>
              <TextInput
                style={styles.quantityInput}
                placeholder="Qty"
                value={productQuantity}
                onChangeText={setProductQuantity}
                keyboardType="decimal-pad"
                placeholderTextColor={Colors.light.muted}
              />
              <TouchableOpacity style={styles.addProductButton} onPress={handleAddProduct}>
                <Plus size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {orderProducts.length > 0 && (
              <View style={styles.orderProductsList}>
                {orderProducts.map((p, idx) => {
                  const product = products.find(pr => pr.id === p.productId);
                  return (
                    <View key={idx} style={styles.orderProductItem}>
                      <View style={styles.orderProductInfo}>
                        <Text style={styles.orderProductName}>{product?.name || 'Unknown'}</Text>
                        <Text style={styles.orderProductQuantity}>{p.quantity} {p.unit}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRemoveProduct(p.productId)}
                        style={styles.removeProductButton}
                      >
                        <X size={18} color={Colors.light.danger} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            <Text style={styles.label}>Notes (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add any notes..."
              value={orderNotes}
              onChangeText={setOrderNotes}
              multiline
              numberOfLines={3}
              placeholderTextColor={Colors.light.muted}
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={editingOrder ? handleUpdateOrder : handleSubmitOrder}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>{editingOrder ? 'Update Order' : 'Create Order'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={websiteMatchModalVisible}
        animationType="slide"
        transparent
        onRequestClose={handleCancelWebsiteMapping}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.websiteMatchCard}>
            <View style={styles.websiteMatchHeader}>
              <Text style={styles.websiteMatchTitle}>Match Website Products</Text>
              <Text style={styles.websiteMatchSubtitle}>Select the correct system menu product for each unmatched item.</Text>
            </View>

            <ScrollView style={styles.websiteMatchScroll}>
              {websiteMatchChoices.map((choice) => (
                <View key={choice.key} style={styles.websiteMatchRow}>
                  <Text style={styles.websiteMatchItemLabel}>
                    {choice.itemName}
                    {choice.variantName ? ` (${choice.variantName})` : ''}
                  </Text>
                  <Text style={styles.websiteMatchMeta}>
                    {choice.sizeHint ? `Size hint: ${choice.sizeHint} • ` : ''}Count: {choice.count}
                  </Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={websiteMatchSelections[choice.key] || ''}
                      onValueChange={(value: string) => {
                        setWebsiteMatchSelections((prev) => ({
                          ...prev,
                          [choice.key]: value,
                        }));
                      }}
                      style={styles.picker}
                    >
                      <Picker.Item label="Select menu product" value="" />
                      {menuProducts.map((product) => (
                        <Picker.Item
                          key={`map_${choice.key}_${product.id}`}
                          label={`${product.name} (${product.unit})`}
                          value={product.id}
                        />
                      ))}
                    </Picker>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.websiteMatchActions}>
              <TouchableOpacity style={[styles.submitButton, styles.websiteMatchCancelButton, { flex: 1 }]} onPress={handleCancelWebsiteMapping}>
                <Text style={styles.submitButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, { flex: 1 }, !allWebsiteMappingsSelected && styles.submitButtonDisabled]}
                onPress={handleConfirmWebsiteMapping}
                disabled={!allWebsiteMappingsSelected}
              >
                <Text style={styles.submitButtonText}>Continue Import</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CalendarModal
        visible={showCalendar}
        initialDate={orderDate}
        onClose={() => setShowCalendar(false)}
        onSelect={(date) => {
          setOrderDate(date);
          setShowCalendar(false);
        }}
      />

      <ConfirmDialog
        visible={deleteConfirmVisible}
        title="Delete Order"
        message="Are you sure you want to delete this order?"
        confirmText="Delete"
        destructive={true}
        onCancel={() => {
          setDeleteConfirmVisible(false);
          setOrderToDelete(null);
        }}
        onConfirm={confirmDeleteOrder}
      />
    </View>
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
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.light.card,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  toggleContainer: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  toggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flexShrink: 1,
  },
  toggleButtonActive: {
    backgroundColor: Colors.light.tint,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.muted,
  },
  toggleTextActive: {
    color: '#fff',
  },
  exportButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  websiteActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  disabledActionButton: {
    opacity: 0.6,
  },
  websiteConfigCard: {
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  websiteConfigTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  websiteConfigHint: {
    fontSize: 12,
    color: Colors.light.muted,
    marginTop: 4,
  },
  websitePullButton: {
    marginTop: 14,
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  websitePullButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  websiteRangeText: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.light.muted,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.light.muted,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  dateGroup: {
    marginBottom: 24,
  },
  dateGroupTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  orderCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  orderCardDelayed: {
    borderColor: Colors.light.danger,
    borderWidth: 2,
  },
  delayedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.light.danger,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start' as const,
    marginBottom: 12,
  },
  delayedText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700' as const,
  },
  orderHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  orderHeaderLeft: {
    flex: 1,
  },
  orderHeaderRight: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  websiteStatusChip: {
    backgroundColor: Colors.light.tint,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start' as const,
  },
  websiteStatusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700' as const,
  },
  customerName: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 4,
  },
  orderDateTime: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  iconButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
  },
  orderDetails: {
    gap: 8,
    marginBottom: 12,
  },
  orderDetailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  orderDetailText: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
  },
  websiteMoneyLabel: {
    fontSize: 13,
    color: Colors.light.muted,
    fontWeight: '700' as const,
  },
  websiteMoneyValue: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '700' as const,
  },
  productsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  productsSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginBottom: 8,
  },
  productItem: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 6,
  },
  productName: {
    fontSize: 14,
    color: Colors.light.text,
  },
  productQuantity: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  notesSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.muted,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    color: Colors.light.text,
    fontStyle: 'italic' as const,
  },
  websiteRawToggle: {
    marginTop: 12,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignSelf: 'flex-start' as const,
  },
  websiteRawToggleText: {
    fontSize: 12,
    color: Colors.light.tint,
    fontWeight: '700' as const,
  },
  websiteRawBlock: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 10,
    maxHeight: 220,
  },
  websiteRawText: {
    fontSize: 11,
    color: Colors.light.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : Platform.OS === 'android' ? 'monospace' : 'monospace',
  },
  fulfillButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.success,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  fulfillButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
  },
  fulfilledInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 12,
    padding: 8,
    backgroundColor: Colors.light.success + '20',
    borderRadius: 6,
  },
  fulfilledText: {
    fontSize: 12,
    color: Colors.light.success,
    fontWeight: '600' as const,
  },
  fab: {
    position: 'absolute' as const,
    right: 20,
    bottom: 100,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: Colors.light.card,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
      },
      android: {
        elevation: 12,
      },
      web: {
        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.25)',
      },
    }),
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
    paddingTop: 60,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
    marginTop: 20,
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
  dateTimeContainer: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  dateTimeLeft: {
    flex: 1,
  },
  dateTimeRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  datePickerButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  datePickerText: {
    fontSize: 16,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  timeInput: {
    flex: 1,
  },
  orderReceivedContainer: {
    flex: 1,
  },
  pickerContainer: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden' as const,
  },
  picker: {
    backgroundColor: Colors.light.card,
    color: Colors.light.text,
  },
  searchInputContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.light.text,
  },
  productAddRow: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  productPickerContainer: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden' as const,
  },
  quantityInput: {
    width: 80,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.light.text,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  addProductButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  orderProductsList: {
    gap: 8,
    marginBottom: 16,
  },
  orderProductItem: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.light.card,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  orderProductInfo: {
    flex: 1,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginRight: 12,
  },
  orderProductName: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  orderProductQuantity: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '600' as const,
  },
  removeProductButton: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: Colors.light.danger + '20',
  },
  modalFooter: {
    padding: 24,
    backgroundColor: Colors.light.card,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  submitButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center' as const,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 16,
  },
  websiteMatchCard: {
    width: '100%',
    maxWidth: 860,
    maxHeight: '88%',
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden' as const,
  },
  websiteMatchHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  websiteMatchTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  websiteMatchSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: Colors.light.muted,
  },
  websiteMatchScroll: {
    maxHeight: 420,
  },
  websiteMatchRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border + '80',
    gap: 8,
  },
  websiteMatchItemLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  websiteMatchMeta: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  websiteMatchActions: {
    flexDirection: 'row' as const,
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  websiteMatchCancelButton: {
    backgroundColor: Colors.light.muted,
  },
});
