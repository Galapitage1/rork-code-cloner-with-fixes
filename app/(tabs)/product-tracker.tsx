import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  TextInput,
} from 'react-native';
import { Stack } from 'expo-router';
import { Calendar, RefreshCw, Search } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Colors from '@/constants/colors';
import { useStock } from '@/contexts/StockContext';
import { useStores } from '@/contexts/StoresContext';
import { useProduction } from '@/contexts/ProductionContext';
import { useRecipes } from '@/contexts/RecipeContext';
import { Product, ProductConversion, Recipe, SalesReconciliationHistory } from '@/types';

type ViewType = 'weekly' | 'monthly';

type RawTrackerRow = {
  rawProductId: string;
  rawProductName: string;
  unit: string;
  isConvertedUnitGroup: boolean;
  estimatedOpeningStores: number;
  grnReceived: number;
  totalAvailable: number;
  currentStores: number;
  issuedToProduction: number;
  soldByRecipes: number;
  discrepancy: number; // production issued - sales implied
};

type ConversionMeta = {
  baseProductId: string;
  factorToBase: number;
  displayUnit: string;
  displayName: string;
  isConvertedUnitGroup: boolean;
};

export default function ProductTrackerScreen() {
  const {
    products,
    productConversions,
    reconcileHistory,
    outlets,
    syncAll: syncStock,
    isLoading: isStockLoading,
    isSyncing: isStockSyncing,
  } = useStock();
  const {
    storeProducts,
    grns,
    syncAll: syncStores,
    isLoading: isStoresLoading,
    isSyncing: isStoresSyncing,
  } = useStores();
  const {
    approvedProductions,
    syncAll: syncProduction,
    isLoading: isProductionLoading,
    isSyncing: isProductionSyncing,
  } = useProduction();
  const {
    recipes,
    syncRecipes,
    isLoading: isRecipesLoading,
    isSyncing: isRecipesSyncing,
  } = useRecipes();
  const [selectedOutlet, setSelectedOutlet] = useState<string>('ALL');
  const [viewType, setViewType] = useState<ViewType>('weekly');
  const [startDate, setStartDate] = useState<Date>(getWeekStart(new Date()));
  const [endDate, setEndDate] = useState<Date>(getWeekEnd(new Date()));
  const [showStartPicker, setShowStartPicker] = useState<boolean>(false);
  const [showEndPicker, setShowEndPicker] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  const applyStartDate = useCallback((date: Date) => {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    setStartDate(next);
    setEndDate((prev) => (next > prev ? endOfDay(next) : prev));
  }, []);

  const applyEndDate = useCallback((date: Date) => {
    const next = endOfDay(date);
    setEndDate(next);
    setStartDate((prev) => (next < prev ? startOfDay(next) : prev));
  }, []);

  const salesOutlets = useMemo(() => {
    return outlets.filter((o) => !o.deleted && o.outletType === 'sales');
  }, [outlets]);

  useEffect(() => {
    if (viewType === 'weekly') {
      setStartDate(getWeekStart(new Date()));
      setEndDate(getWeekEnd(new Date()));
      return;
    }
    setStartDate(getMonthStart(new Date()));
    setEndDate(getMonthEnd(new Date()));
  }, [viewType]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        syncStock(true),
        syncStores(true),
        syncProduction(true),
        syncRecipes(true),
      ]);
    } catch (error) {
      console.error('ProductTracker(raw): refresh failed', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [syncStock, syncStores, syncProduction, syncRecipes]);

  const isLoading = isStockLoading || isStoresLoading || isProductionLoading || isRecipesLoading;
  const isSyncing = isStockSyncing || isStoresSyncing || isProductionSyncing || isRecipesSyncing || isRefreshing;

  const trackerState = useMemo(() => {
    const startIso = toIsoDate(startDate);
    const endIso = toIsoDate(endDate);

    const activeProducts = products.filter((p) => !p.deleted);
    const rawProducts = activeProducts.filter((p) => p.type === 'raw');
    const productsById = new Map(activeProducts.map((p) => [p.id, p] as const));

    const conversionByFrom = new Map<string, ProductConversion>();
    const conversionByTo = new Map<string, ProductConversion>();
    productConversions
      .filter((c) => !c.deleted)
      .forEach((c) => {
        conversionByFrom.set(c.fromProductId, c);
        conversionByTo.set(c.toProductId, c);
      });

    const getConversionMeta = (productId: string): ConversionMeta | null => {
      const product = productsById.get(productId);
      if (!product) return null;

      const asSlice = conversionByTo.get(productId);
      if (asSlice && asSlice.conversionFactor > 0) {
        const baseProduct = productsById.get(asSlice.fromProductId);
        return {
          baseProductId: asSlice.fromProductId,
          factorToBase: 1 / asSlice.conversionFactor,
          displayUnit: baseProduct?.unit || product.unit,
          displayName: baseProduct?.name || product.name,
          isConvertedUnitGroup: true,
        };
      }

      const asWhole = conversionByFrom.get(productId);
      if (asWhole) {
        return {
          baseProductId: productId,
          factorToBase: 1,
          displayUnit: product.unit,
          displayName: product.name,
          isConvertedUnitGroup: true,
        };
      }

      return {
        baseProductId: productId,
        factorToBase: 1,
        displayUnit: product.unit,
        displayName: product.name,
        isConvertedUnitGroup: false,
      };
    };

    const toBaseQuantity = (productId: string, qty: number): { baseProductId: string; qty: number; meta: ConversionMeta } | null => {
      if (!Number.isFinite(qty) || qty === 0) return null;
      const meta = getConversionMeta(productId);
      if (!meta) return null;
      return {
        baseProductId: meta.baseProductId,
        qty: qty * meta.factorToBase,
        meta,
      };
    };

    const rawByExactNameUnit = new Map<string, Product>();
    const rawByName = new Map<string, Product[]>();
    rawProducts.forEach((p) => {
      rawByExactNameUnit.set(`${normalize(p.name)}__${normalize(p.unit)}`, p);
      const list = rawByName.get(normalize(p.name)) || [];
      list.push(p);
      rawByName.set(normalize(p.name), list);
    });

    const storeProductsById = new Map(storeProducts.map((sp) => [sp.id, sp] as const));

    const resolveRawProductForStoreProduct = (storeProductId: string): Product | null => {
      const sp = storeProductsById.get(storeProductId);
      if (!sp || sp.deleted) return null;

      const exact = rawByExactNameUnit.get(`${normalize(sp.name)}__${normalize(sp.unit)}`);
      if (exact) return exact;

      const sameName = rawByName.get(normalize(sp.name)) || [];
      if (sameName.length === 1) return sameName[0];

      return null;
    };

    const addToMetric = (
      map: Map<string, number>,
      productId: string,
      qty: number,
      rowMeta: Map<string, ConversionMeta>
    ) => {
      const normalized = toBaseQuantity(productId, qty);
      if (!normalized) return;
      map.set(normalized.baseProductId, (map.get(normalized.baseProductId) || 0) + normalized.qty);
      if (!rowMeta.has(normalized.baseProductId)) {
        rowMeta.set(normalized.baseProductId, normalized.meta);
      }
    };

    const rowMeta = new Map<string, ConversionMeta>();
    const currentStoresByRaw = new Map<string, number>();
    const grnReceivedByRaw = new Map<string, number>();
    const issuedToProductionByRaw = new Map<string, number>();
    const soldByRecipesByRaw = new Map<string, number>();

    let unmatchedStoreMappings = 0;
    let salesFallbackCount = 0;

    // Current store totals (live quantity in stores)
    storeProducts.forEach((sp) => {
      if (sp.deleted) return;
      const raw = resolveRawProductForStoreProduct(sp.id);
      if (!raw) {
        unmatchedStoreMappings++;
        return;
      }
      addToMetric(currentStoresByRaw, raw.id, sp.quantity || 0, rowMeta);
    });

    // GRN received within selected range (by GRN entry date)
    grns.forEach((grn) => {
      if (grn.deleted) return;
      const grnDate = timestampToIso(grn.createdAt || grn.updatedAt || 0);
      if (!isIsoDateInRange(grnDate, startIso, endIso)) return;

      (grn.items || []).forEach((item) => {
        const raw = resolveRawProductForStoreProduct(item.storeProductId);
        if (!raw) return;
        addToMetric(grnReceivedByRaw, raw.id, item.quantity || 0, rowMeta);
      });
    });

    // Raw issued to production (approved productions in selected range)
    approvedProductions.forEach((approval) => {
      if ((approval as any).deleted) return;
      const approvalDate = approval.approvalDate || approval.date;
      if (!isIsoDateInRange(approvalDate, startIso, endIso)) return;

      (approval.items || []).forEach((approvedItem) => {
        (approvedItem.ingredients || []).forEach((ingredient) => {
          addToMetric(issuedToProductionByRaw, ingredient.rawProductId, ingredient.quantity || 0, rowMeta);
        });
      });
    });

    // Sales-implied raw usage from reconciliation history (prefer stored rawConsumption)
    const recipeByMenuId = new Map<string, Recipe>();
    recipes.forEach((r) => recipeByMenuId.set(r.menuProductId, r));

    const addFallbackSalesConsumption = (history: SalesReconciliationHistory) => {
      salesFallbackCount++;
      (history.salesData || []).forEach((sale) => {
        if (!sale.productId || !Number.isFinite(sale.sold) || sale.sold <= 0) return;
        const soldProduct = productsById.get(sale.productId);
        if (!soldProduct || soldProduct.deleted || soldProduct.type !== 'menu') return;
        const recipe = recipeByMenuId.get(sale.productId);
        if (!recipe) return;
        recipe.components.forEach((component) => {
          addToMetric(soldByRecipesByRaw, component.rawProductId, (sale.sold || 0) * (component.quantityPerUnit || 0), rowMeta);
        });
      });
    };

    reconcileHistory.forEach((history) => {
      if (history.deleted) return;
      if (!isIsoDateInRange(history.date, startIso, endIso)) return;
      if (selectedOutlet !== 'ALL' && (history.outlet || '').toLowerCase() !== selectedOutlet.toLowerCase()) return;

      if (history.rawConsumption && history.rawConsumption.length > 0) {
        history.rawConsumption.forEach((raw) => {
          addToMetric(soldByRecipesByRaw, raw.rawProductId, raw.consumed || 0, rowMeta);
        });
      } else {
        addFallbackSalesConsumption(history);
      }
    });

    // Seed rows with known raw products so names/units remain stable.
    rawProducts.forEach((raw) => {
      const meta = getConversionMeta(raw.id);
      if (meta && !rowMeta.has(meta.baseProductId)) {
        rowMeta.set(meta.baseProductId, meta);
      }
    });

    const allBaseIds = new Set<string>([
      ...Array.from(rowMeta.keys()),
      ...Array.from(currentStoresByRaw.keys()),
      ...Array.from(grnReceivedByRaw.keys()),
      ...Array.from(issuedToProductionByRaw.keys()),
      ...Array.from(soldByRecipesByRaw.keys()),
    ]);

    const rows: RawTrackerRow[] = Array.from(allBaseIds).map((baseId) => {
      const meta = rowMeta.get(baseId);
      const baseProduct = productsById.get(baseId);

      const currentStores = round3(currentStoresByRaw.get(baseId) || 0);
      const grnReceived = round3(grnReceivedByRaw.get(baseId) || 0);
      const issuedToProduction = round3(issuedToProductionByRaw.get(baseId) || 0);
      const soldByRecipes = round3(soldByRecipesByRaw.get(baseId) || 0);
      const estimatedOpeningStores = round3(currentStores + issuedToProduction - grnReceived);
      const totalAvailable = round3(estimatedOpeningStores + grnReceived);
      const discrepancy = round3(issuedToProduction - soldByRecipes);

      return {
        rawProductId: baseId,
        rawProductName: meta?.displayName || baseProduct?.name || 'Unknown Raw Material',
        unit: meta?.displayUnit || baseProduct?.unit || '',
        isConvertedUnitGroup: !!meta?.isConvertedUnitGroup,
        estimatedOpeningStores,
        grnReceived,
        totalAvailable,
        currentStores,
        issuedToProduction,
        soldByRecipes,
        discrepancy,
      };
    });

    const filteredRows = rows
      .filter((row) => {
        const hasAnyData =
          row.estimatedOpeningStores !== 0 ||
          row.grnReceived !== 0 ||
          row.currentStores !== 0 ||
          row.issuedToProduction !== 0 ||
          row.soldByRecipes !== 0;
        if (!hasAnyData) return false;
        if (!search.trim()) return true;
        return row.rawProductName.toLowerCase().includes(search.trim().toLowerCase());
      })
      .sort((a, b) => {
        const absDiff = Math.abs(b.discrepancy) - Math.abs(a.discrepancy);
        if (absDiff !== 0) return absDiff;
        return a.rawProductName.localeCompare(b.rawProductName);
      });

    const totals = filteredRows.reduce(
      (acc, row) => {
        acc.opening += row.estimatedOpeningStores;
        acc.received += row.grnReceived;
        acc.totalAvailable += row.totalAvailable;
        acc.current += row.currentStores;
        acc.issued += row.issuedToProduction;
        acc.sold += row.soldByRecipes;
        acc.discrepancy += row.discrepancy;
        return acc;
      },
      { opening: 0, received: 0, totalAvailable: 0, current: 0, issued: 0, sold: 0, discrepancy: 0 }
    );

    return {
      rows: filteredRows,
      totals: {
        opening: round3(totals.opening),
        received: round3(totals.received),
        totalAvailable: round3(totals.totalAvailable),
        current: round3(totals.current),
        issued: round3(totals.issued),
        sold: round3(totals.sold),
        discrepancy: round3(totals.discrepancy),
      },
      meta: {
        unmatchedStoreMappings,
        salesFallbackCount,
        startIso,
        endIso,
      },
    };
  }, [
    startDate,
    endDate,
    products,
    productConversions,
    storeProducts,
    grns,
    approvedProductions,
    reconcileHistory,
    recipes,
    selectedOutlet,
    search,
  ]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Product Tracker' }} />
      <View style={styles.container}>
        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        >
          <View style={styles.filtersContainer}>
            <Text style={styles.sectionTitle}>Raw Material Tracker</Text>
            <Text style={styles.sectionSubtitle}>
              GRN received + store totals + approved production usage vs sales-based recipe consumption.
            </Text>

            <View style={styles.outletSwitcher}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TouchableOpacity
                  style={[styles.outletButton, selectedOutlet === 'ALL' && styles.outletButtonActive]}
                  onPress={() => setSelectedOutlet('ALL')}
                >
                  <Text style={[styles.outletButtonText, selectedOutlet === 'ALL' && styles.outletButtonTextActive]}>ALL SALES</Text>
                </TouchableOpacity>
                {salesOutlets.map((outlet) => (
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

            {Platform.OS === 'web' ? (
              <View style={styles.dateRangeContainer}>
                <View style={styles.webDateInputWrap}>
                  <Calendar size={16} color={Colors.light.tint} />
                  <input
                    type="date"
                    value={toIsoDate(startDate)}
                    max={toIsoDate(endDate)}
                    onChange={(e: any) => {
                      const parsed = parseIsoDateInput(e?.target?.value);
                      if (parsed) applyStartDate(parsed);
                    }}
                    style={styles.webDateInput as any}
                  />
                </View>

                <Text style={styles.dateSeparator}>to</Text>

                <View style={styles.webDateInputWrap}>
                  <Calendar size={16} color={Colors.light.tint} />
                  <input
                    type="date"
                    value={toIsoDate(endDate)}
                    min={toIsoDate(startDate)}
                    onChange={(e: any) => {
                      const parsed = parseIsoDateInput(e?.target?.value);
                      if (parsed) applyEndDate(parsed);
                    }}
                    style={styles.webDateInput as any}
                  />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.dateRangeContainer}>
                  <TouchableOpacity style={styles.dateButton} onPress={() => setShowStartPicker(true)}>
                    <Calendar size={16} color={Colors.light.tint} />
                    <Text style={styles.dateText}>{formatDate(startDate)}</Text>
                  </TouchableOpacity>

                  <Text style={styles.dateSeparator}>to</Text>

                  <TouchableOpacity style={styles.dateButton} onPress={() => setShowEndPicker(true)}>
                    <Calendar size={16} color={Colors.light.tint} />
                    <Text style={styles.dateText}>{formatDate(endDate)}</Text>
                  </TouchableOpacity>
                </View>

                {showStartPicker && (
                  <DateTimePicker
                    value={startDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, date) => {
                      setShowStartPicker(Platform.OS === 'ios');
                      if (date) applyStartDate(date);
                    }}
                  />
                )}

                {showEndPicker && (
                  <DateTimePicker
                    value={endDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, date) => {
                      setShowEndPicker(Platform.OS === 'ios');
                      if (date) applyEndDate(date);
                    }}
                  />
                )}
              </>
            )}

            <View style={styles.searchRow}>
              <Search size={16} color={Colors.light.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search raw material..."
                placeholderTextColor={Colors.light.muted}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            <TouchableOpacity
              style={[styles.refreshButton, isSyncing && styles.refreshButtonDisabled]}
              onPress={handleRefresh}
              disabled={isSyncing}
            >
              <RefreshCw size={18} color="#fff" />
              <Text style={styles.refreshButtonText}>{isSyncing ? 'Syncing...' : 'Refresh Data'}</Text>
            </TouchableOpacity>

            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                Date range: {trackerState.meta.startIso} to {trackerState.meta.endIso}
              </Text>
              {selectedOutlet !== 'ALL' && (
                <Text style={styles.infoText}>
                  Note: Sales is filtered by outlet, but GRN / Stores / Production are global (no outlet is stored for those records).
                </Text>
              )}
              {trackerState.meta.salesFallbackCount > 0 && (
                <Text style={styles.infoText}>
                  {trackerState.meta.salesFallbackCount} reconciliation record(s) had no saved raw consumption, so sales usage was recalculated from recipe + sales data.
                </Text>
              )}
              {trackerState.meta.unmatchedStoreMappings > 0 && (
                <Text style={styles.warningText}>
                  {trackerState.meta.unmatchedStoreMappings} store item(s) could not be matched to a raw product (name/unit mismatch), so they were excluded.
                </Text>
              )}
            </View>

            <View style={styles.summaryGrid}>
              <SummaryCard label="GRN Received" value={trackerState.totals.received} />
              <SummaryCard label="Current Stores" value={trackerState.totals.current} />
              <SummaryCard label="Issued Prod." value={trackerState.totals.issued} />
              <SummaryCard label="Sold (Recipes)" value={trackerState.totals.sold} />
              <SummaryCard
                label="Variance"
                value={trackerState.totals.discrepancy}
                highlight={trackerState.totals.discrepancy !== 0}
              />
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.light.tint} />
              <Text style={styles.loadingText}>Loading raw material tracker...</Text>
            </View>
          ) : (
            <ScrollView horizontal style={styles.tableContainer}>
              <View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.headerCell, styles.nameCell]}>Raw Material</Text>
                  <Text style={styles.headerCell}>Unit</Text>
                  <Text style={styles.headerCell}>Opening{'\n'}Stores (Est)</Text>
                  <Text style={styles.headerCell}>GRN{'\n'}Received</Text>
                  <Text style={styles.headerCell}>Total{'\n'}Available</Text>
                  <Text style={styles.headerCell}>Current{'\n'}Stores</Text>
                  <Text style={styles.headerCell}>Issued to{'\n'}Production</Text>
                  <Text style={styles.headerCell}>Sold by{'\n'}Recipes</Text>
                  <Text style={styles.headerCell}>Discrepancy{'\n'}(Prod-Sales)</Text>
                </View>

                {trackerState.rows.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No raw material data found for the selected range.</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.tableBody}>
                    {trackerState.rows.map((row, index) => (
                      <View key={row.rawProductId} style={[styles.tableRow, index % 2 === 0 && styles.tableRowEven]}>
                        <View style={[styles.cell, styles.nameCell]}>
                          <Text style={styles.productName}>{row.rawProductName}</Text>
                          {row.isConvertedUnitGroup && <Text style={styles.metaText}>Unit-converted group</Text>}
                        </View>
                        <Text style={styles.cell}>{row.unit || '-'}</Text>
                        <Text style={styles.cell}>{formatQty(row.estimatedOpeningStores)}</Text>
                        <Text style={styles.cell}>{formatQty(row.grnReceived)}</Text>
                        <Text style={styles.cell}>{formatQty(row.totalAvailable)}</Text>
                        <Text style={styles.cell}>{formatQty(row.currentStores)}</Text>
                        <Text style={styles.cell}>{formatQty(row.issuedToProduction)}</Text>
                        <Text style={styles.cell}>{formatQty(row.soldByRecipes)}</Text>
                        <Text
                          style={[
                            styles.cell,
                            row.discrepancy !== 0 && (row.discrepancy > 0 ? styles.positiveCell : styles.negativeCell),
                          ]}
                        >
                          {formatQty(row.discrepancy)}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            </ScrollView>
          )}
        </ScrollView>
      </View>
    </>
  );
}

function SummaryCard({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={[styles.summaryCard, highlight && styles.summaryCardHighlight]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, highlight && styles.summaryValueHighlight]}>{formatQty(value)}</Text>
    </View>
  );
}

function round3(value: number): number {
  return Number((value || 0).toFixed(3));
}

function normalize(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

function toIsoDate(date: Date): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timestampToIso(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  return toIsoDate(new Date(timestamp));
}

function isIsoDateInRange(dateIso: string, startIso: string, endIso: string): boolean {
  if (!dateIso) return false;
  return dateIso >= startIso && dateIso <= endIso;
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 0.0005) return '0';
  const rounded = round3(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB');
}

function parseIsoDateInput(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, (m || 1) - 1, d || 1);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
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
  const d = getWeekStart(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getMonthStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthEnd(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    flex: 1,
  },
  filtersContainer: {
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.light.muted,
    lineHeight: 18,
  },
  outletSwitcher: {
    marginTop: 4,
  },
  outletButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
    marginRight: 8,
  },
  outletButtonActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  outletButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.text,
  },
  outletButtonTextActive: {
    color: '#fff',
  },
  viewTypeContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  viewTypeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewTypeButtonActive: {
    backgroundColor: Colors.light.tint,
  },
  viewTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  viewTypeTextActive: {
    color: '#fff',
  },
  dateRangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateText: {
    fontSize: 13,
    color: Colors.light.text,
    fontWeight: '500',
  },
  dateSeparator: {
    fontSize: 12,
    color: Colors.light.muted,
  },
  webDateInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  webDateInput: {
    flex: 1,
    border: 'none',
    outlineStyle: 'none',
    backgroundColor: 'transparent',
    color: Colors.light.text,
    fontSize: 13,
    minWidth: 0,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  searchInput: {
    flex: 1,
    color: Colors.light.text,
    fontSize: 14,
    paddingVertical: 10,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.light.tint,
    borderRadius: 10,
    paddingVertical: 12,
  },
  refreshButtonDisabled: {
    opacity: 0.7,
  },
  refreshButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  infoCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 12,
    gap: 6,
  },
  infoText: {
    fontSize: 12,
    color: Colors.light.muted,
    lineHeight: 16,
  },
  warningText: {
    fontSize: 12,
    color: Colors.light.warning || '#B45309',
    lineHeight: 16,
    fontWeight: '600',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryCard: {
    minWidth: 130,
    flexGrow: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 10,
  },
  summaryCardHighlight: {
    borderColor: Colors.light.tint,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.light.muted,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  summaryValueHighlight: {
    color: Colors.light.tint,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.light.muted,
    fontSize: 14,
  },
  tableContainer: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: Colors.light.tint,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  headerCell: {
    width: 110,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.2)',
  },
  tableBody: {
    maxHeight: 520,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  tableRowEven: {
    backgroundColor: '#FAFBFC',
  },
  cell: {
    width: 110,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 12,
    color: Colors.light.text,
    textAlign: 'center',
    borderRightWidth: 1,
    borderRightColor: Colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameCell: {
    width: 220,
    alignItems: 'flex-start',
    textAlign: 'left',
  },
  productName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
  },
  metaText: {
    fontSize: 10,
    color: Colors.light.muted,
    marginTop: 2,
  },
  positiveCell: {
    color: '#B91C1C',
    fontWeight: '700',
  },
  negativeCell: {
    color: '#047857',
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: Colors.light.muted,
    fontSize: 14,
  },
});
