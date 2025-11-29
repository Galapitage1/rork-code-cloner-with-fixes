import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useState, useMemo, useCallback } from 'react';
import { ShoppingBag, Plus, X, Download, Edit2, Check, Clock, AlertCircle, Phone, Mail, MapPin, Package, Trash2, Calendar, Search } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useOrders } from '@/contexts/OrderContext';
import { useCustomers } from '@/contexts/CustomerContext';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import { DeliveryMethod, OrderProduct, OrderReceivedFrom } from '@/types';
import { CalendarModal } from '@/components/CalendarModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export default function OrdersScreen() {
  const { orders, addOrder, updateOrder, deleteOrder, fulfillOrder, getActiveOrders, getFulfilledOrders, isLoading } = useOrders();
  const { customers, addCustomer } = useCustomers();
  const { products, outlets, addRequest } = useStock();
  const { currentUser } = useAuth();

  const [showNewOrderModal, setShowNewOrderModal] = useState<boolean>(false);
  const [showViewMode, setShowViewMode] = useState<'active' | 'fulfilled'>('active');
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
        </View>
        {showViewMode === 'fulfilled' && fulfilledOrders.length > 0 && (
          <TouchableOpacity style={styles.exportButton} onPress={handleExportFulfilledOrders}>
            <Download size={18} color={Colors.light.tint} />
          </TouchableOpacity>
        )}
      </View>

      {displayOrders.length === 0 ? (
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
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 4,
  },
  toggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
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
});
