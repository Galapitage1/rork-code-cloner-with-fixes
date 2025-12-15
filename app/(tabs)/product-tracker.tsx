import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { Calendar, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useProductTracker } from '@/contexts/ProductTrackerContext';
import { useStock } from '@/contexts/StockContext';
import { useAuth } from '@/contexts/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';

type ViewType = 'weekly' | 'monthly';

export default function ProductTrackerScreen() {
  const { trackerData, isLoading, isSyncing, refreshTrackerData } = useProductTracker();
  const { outlets, syncAll } = useStock();
  const { currentUser } = useAuth();
  
  const [selectedOutlet, setSelectedOutlet] = useState<string>('ALL');
  const [viewType, setViewType] = useState<ViewType>('weekly');
  const [startDate, setStartDate] = useState<Date>(getWeekStart(new Date()));
  const [endDate, setEndDate] = useState<Date>(getWeekEnd(new Date()));
  const [showStartPicker, setShowStartPicker] = useState<boolean>(false);
  const [showEndPicker, setShowEndPicker] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const activeOutlets = useMemo(() => {
    return outlets.filter(o => !o.deleted);
  }, [outlets]);

  useEffect(() => {
    if (viewType === 'weekly') {
      const weekStart = getWeekStart(new Date());
      const weekEnd = getWeekEnd(new Date());
      setStartDate(weekStart);
      setEndDate(weekEnd);
    } else {
      const monthStart = getMonthStart(new Date());
      const monthEnd = getMonthEnd(new Date());
      setStartDate(monthStart);
      setEndDate(monthEnd);
    }
  }, [viewType]);

  const loadData = useCallback(async () => {
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];
    console.log('ProductTracker: Loading data with userId:', currentUser?.id);
    await refreshTrackerData(selectedOutlet, start, end, currentUser?.id);
  }, [selectedOutlet, startDate, endDate, refreshTrackerData, currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncAll(true);
      await loadData();
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredData = useMemo(() => {
    return trackerData.filter(d => {
      const dataDate = new Date(d.date);
      return dataDate >= startDate && dataDate <= endDate;
    });
  }, [trackerData, startDate, endDate]);

  const aggregatedProducts = useMemo(() => {
    const productMap = new Map<string, {
      productId: string;
      productName: string;
      unit: string;
      hasConversion: boolean;
      openingWhole: number;
      openingSlices: number;
      receivedWhole: number;
      receivedSlices: number;
      wastageWhole: number;
      wastageSlices: number;
      soldWhole: number;
      soldSlices: number;
      currentWhole: number;
      currentSlices: number;
      discrepancyWhole: number;
      discrepancySlices: number;
    }>();

    filteredData.forEach(dayData => {
      dayData.movements.forEach(movement => {
        const existing = productMap.get(movement.productId);
        if (existing) {
          existing.receivedWhole += movement.receivedWhole;
          existing.receivedSlices += movement.receivedSlices;
          existing.wastageWhole += movement.wastageWhole;
          existing.wastageSlices += movement.wastageSlices;
          existing.soldWhole += movement.soldWhole;
          existing.soldSlices += movement.soldSlices;
          existing.discrepancyWhole += movement.discrepancyWhole;
          existing.discrepancySlices += movement.discrepancySlices;
          existing.currentWhole = movement.currentWhole;
          existing.currentSlices = movement.currentSlices;
        } else {
          productMap.set(movement.productId, { ...movement });
        }
      });
    });

    return Array.from(productMap.values()).sort((a, b) => 
      a.productName.localeCompare(b.productName)
    );
  }, [filteredData]);

  return (
    <>
      <Stack.Screen options={{ 
        headerShown: true,
        title: 'Product Tracker'
      }} />
      <View style={styles.container}>
        <View style={styles.filtersContainer}>
          <View style={styles.outletSwitcher}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.outletButton, selectedOutlet === 'ALL' && styles.outletButtonActive]}
                onPress={() => setSelectedOutlet('ALL')}
              >
                <Text style={[styles.outletButtonText, selectedOutlet === 'ALL' && styles.outletButtonTextActive]}>
                  ALL
                </Text>
              </TouchableOpacity>
              {activeOutlets.map(outlet => (
                <TouchableOpacity
                  key={outlet.id}
                  style={[styles.outletButton, selectedOutlet === outlet.name && styles.outletButtonActive]}
                  onPress={() => setSelectedOutlet(outlet.name)}
                >
                  <Text style={[styles.outletButtonText, selectedOutlet === outlet.name && styles.outletButtonTextActive]}>
                    {outlet.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.viewTypeContainer}>
            <TouchableOpacity
              style={[styles.viewTypeButton, viewType === 'weekly' && styles.viewTypeButtonActive]}
              onPress={() => setViewType('weekly')}
            >
              <Text style={[styles.viewTypeText, viewType === 'weekly' && styles.viewTypeTextActive]}>Weekly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewTypeButton, viewType === 'monthly' && styles.viewTypeButtonActive]}
              onPress={() => setViewType('monthly')}
            >
              <Text style={[styles.viewTypeText, viewType === 'monthly' && styles.viewTypeTextActive]}>Monthly</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dateRangeContainer}>
            <TouchableOpacity 
              style={styles.dateButton}
              onPress={() => setShowStartPicker(true)}
            >
              <Calendar size={16} color={Colors.light.tint} />
              <Text style={styles.dateText}>{formatDate(startDate)}</Text>
            </TouchableOpacity>
            
            <Text style={styles.dateSeparator}>to</Text>
            
            <TouchableOpacity 
              style={styles.dateButton}
              onPress={() => setShowEndPicker(true)}
            >
              <Calendar size={16} color={Colors.light.tint} />
              <Text style={styles.dateText}>{formatDate(endDate)}</Text>
            </TouchableOpacity>
          </View>

          {showStartPicker && (
            <DateTimePicker
              value={startDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                setShowStartPicker(Platform.OS === 'ios');
                if (date) setStartDate(date);
              }}
            />
          )}

          {showEndPicker && (
            <DateTimePicker
              value={endDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                setShowEndPicker(Platform.OS === 'ios');
                if (date) setEndDate(date);
              }}
            />
          )}

          <TouchableOpacity
            style={styles.refreshButton}
            onPress={handleRefresh}
            disabled={isSyncing || isRefreshing}
          >
            <RefreshCw size={20} color="#fff" />
            <Text style={styles.refreshButtonText}>
              {isSyncing || isRefreshing ? 'Syncing...' : 'Refresh Data'}
            </Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.tint} />
            <Text style={styles.loadingText}>Loading tracker data...</Text>
          </View>
        ) : (
          <ScrollView 
            style={styles.tableContainer}
            horizontal
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
            }
          >
            <View>
              <View style={styles.tableHeader}>
                <Text style={[styles.headerCell, styles.productNameCell]}>Product</Text>
                <Text style={styles.headerCell}>Opening{'\n'}Whole</Text>
                <Text style={styles.headerCell}>Opening{'\n'}Slices</Text>
                <Text style={styles.headerCell}>Received{'\n'}Whole</Text>
                <Text style={styles.headerCell}>Received{'\n'}Slices</Text>
                <Text style={styles.headerCell}>Wastage{'\n'}Whole</Text>
                <Text style={styles.headerCell}>Wastage{'\n'}Slices</Text>
                <Text style={styles.headerCell}>Sold{'\n'}Whole</Text>
                <Text style={styles.headerCell}>Sold{'\n'}Slices</Text>
                <Text style={styles.headerCell}>Current{'\n'}Whole</Text>
                <Text style={styles.headerCell}>Current{'\n'}Slices</Text>
                <Text style={styles.headerCell}>Discrepancy{'\n'}Whole</Text>
                <Text style={styles.headerCell}>Discrepancy{'\n'}Slices</Text>
              </View>

              <ScrollView style={styles.tableBody}>
                {aggregatedProducts.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No data available for selected date range</Text>
                  </View>
                ) : (
                  aggregatedProducts.map((product, index) => (
                    <View 
                      key={product.productId} 
                      style={[
                        styles.tableRow,
                        index % 2 === 0 && styles.tableRowEven
                      ]}
                    >
                      <View style={[styles.cell, styles.productNameCell]}>
                        <Text style={styles.productName}>{product.productName}</Text>
                        <Text style={styles.productUnit}>{product.unit}</Text>
                      </View>
                      <Text style={styles.cell}>{product.openingWhole}</Text>
                      <Text style={[styles.cell, !product.hasConversion && styles.cellDisabled]}>
                        {product.hasConversion ? product.openingSlices : '-'}
                      </Text>
                      <Text style={styles.cell}>{product.receivedWhole}</Text>
                      <Text style={[styles.cell, !product.hasConversion && styles.cellDisabled]}>
                        {product.hasConversion ? product.receivedSlices : '-'}
                      </Text>
                      <Text style={styles.cell}>{product.wastageWhole}</Text>
                      <Text style={[styles.cell, !product.hasConversion && styles.cellDisabled]}>
                        {product.hasConversion ? product.wastageSlices : '-'}
                      </Text>
                      <Text style={styles.cell}>{product.soldWhole}</Text>
                      <Text style={[styles.cell, !product.hasConversion && styles.cellDisabled]}>
                        {product.hasConversion ? product.soldSlices : '-'}
                      </Text>
                      <Text style={styles.cell}>{product.currentWhole}</Text>
                      <Text style={[styles.cell, !product.hasConversion && styles.cellDisabled]}>
                        {product.hasConversion ? product.currentSlices : '-'}
                      </Text>
                      <Text style={[
                        styles.cell,
                        product.discrepancyWhole !== 0 && styles.discrepancyCell
                      ]}>
                        {product.discrepancyWhole}
                      </Text>
                      <Text style={[
                        styles.cell,
                        !product.hasConversion && styles.cellDisabled,
                        product.hasConversion && product.discrepancySlices !== 0 && styles.discrepancyCell
                      ]}>
                        {product.hasConversion ? product.discrepancySlices : '-'}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getMonthStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthEnd(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  filtersContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  outletSwitcher: {
    marginBottom: 12,
  },
  outletButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginRight: 8,
  },
  outletButtonActive: {
    backgroundColor: Colors.light.tint,
  },
  outletButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#666',
  },
  outletButtonTextActive: {
    color: '#fff',
  },
  viewTypeContainer: {
    flexDirection: 'row' as const,
    marginBottom: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 4,
  },
  viewTypeButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center' as const,
    borderRadius: 6,
  },
  viewTypeButtonActive: {
    backgroundColor: '#fff',
  },
  viewTypeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#666',
  },
  viewTypeTextActive: {
    color: Colors.light.tint,
  },
  dateRangeContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
    gap: 8,
  },
  dateButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    padding: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  dateText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500' as const,
  },
  dateSeparator: {
    fontSize: 14,
    color: '#666',
  },
  refreshButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    padding: 12,
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  tableContainer: {
    flex: 1,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.tint,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#ddd',
  },
  headerCell: {
    width: 100,
    paddingHorizontal: 8,
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#fff',
    textAlign: 'center' as const,
  },
  productNameCell: {
    width: 180,
    textAlign: 'left' as const,
  },
  tableBody: {
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row' as const,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  tableRowEven: {
    backgroundColor: '#f9f9f9',
  },
  cell: {
    width: 100,
    paddingHorizontal: 8,
    fontSize: 14,
    color: '#333',
    textAlign: 'center' as const,
  },
  cellDisabled: {
    color: '#ccc',
  },
  discrepancyCell: {
    color: '#ff3b30',
    fontWeight: '700' as const,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#333',
  },
  productUnit: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center' as const,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});
