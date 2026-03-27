import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useState, useMemo, useEffect } from 'react';
import { Calendar, CheckCircle2, XCircle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useActivityLog } from '@/contexts/ActivityLogContext';
import { useStock } from '@/contexts/StockContext';
import { CalendarModal } from '@/components/CalendarModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export default function LogsScreen() {
  const router = useRouter();
  const { isSuperAdmin, currentUser } = useAuth();
  const activityLogContext = useActivityLog();
  const stockContext = useStock();
  
  console.log('[LogsScreen] Render - activityLogContext:', activityLogContext ? 'AVAILABLE' : 'UNDEFINED');
  console.log('[LogsScreen] Render - outlets from stock:', stockContext?.outlets?.length || 0);
  
  console.log('[LogsScreen] stockContext:', stockContext);
  console.log('[LogsScreen] activityLogContext:', activityLogContext);
  
  if (!stockContext) {
    console.error('[LogsScreen] ERROR: StockContext is undefined!');
  }
  
  if (!activityLogContext) {
    console.error('[LogsScreen] ERROR: ActivityLogContext is undefined!');
  }
  
  const outlets = stockContext?.outlets || [];
  const logs = activityLogContext?.logs || [];
  const clearAllLogs = activityLogContext?.clearAllLogs || (async () => {});
  const isLoading = activityLogContext?.isLoading || false;
  const setUser = activityLogContext?.setUser || (() => {});
  
  console.log('[LogsScreen] State - outlets:', outlets.length, 'logs:', logs.length, 'isLoading:', isLoading);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    console.log('[LogsScreen] Setting user:', currentUser);
    if (currentUser) {
      setUser(currentUser);
    }
  }, [currentUser, setUser]);

  useEffect(() => {
    console.log('[LogsScreen] Checking superadmin access, isSuperAdmin:', isSuperAdmin);
    if (!isSuperAdmin) {
      console.log('[LogsScreen] Not superadmin, redirecting to home');
      router.replace('/home');
    }
  }, [isSuperAdmin, router]);

  const selectedDateString = useMemo(() => {
    const date = new Date(selectedDate);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }, [selectedDate]);

  const getActivityStatus = useMemo(() => {
    return (date: string, outlet: string, activityType: 'stock_check' | 'requests' | 'reconciliation'): boolean => {
      const dateLogs = logs.filter(log => log.date === date && log.outlet === outlet);
      
      switch (activityType) {
        case 'stock_check':
          return dateLogs.some(log => log.type === 'stock_check');
        case 'requests': {
          const requestLogs = dateLogs.filter(log => 
            (log.metadata?.approvalPercentage !== undefined && log.metadata.approvalPercentage >= 80) ||
            log.metadata?.requestsApproved >= 0.8 * (log.metadata?.totalRequests || 1)
          );
          return requestLogs.length > 0;
        }
        case 'reconciliation':
          return dateLogs.some(log => log.type === 'reconciliation');
        default:
          return false;
      }
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const logsForDate = logs.filter(log => log.date === selectedDate);
    logsForDate.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return logsForDate;
  }, [selectedDate, logs]);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const handleClearLogs = async () => {
    try {
      await clearAllLogs();
      setShowClearConfirm(false);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  };

  if (!isSuperAdmin) {
    console.log('[LogsScreen] Access denied: Not superadmin, returning empty view');
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.background }}>
        <Text>Access Denied: Superadmin only</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen 
        options={{
          title: 'Activity Logs',
          headerStyle: {
            backgroundColor: Colors.light.card,
          },
          headerTintColor: Colors.light.text,
        }}
      />
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <View style={styles.header}>
            <View style={styles.datePickerContainer}>
              <Text style={styles.dateLabel}>Date:</Text>
              <TouchableOpacity
                style={styles.dateSelector}
                onPress={() => setShowCalendar(true)}
              >
                <Calendar size={18} color={Colors.light.tint} />
                <Text style={styles.dateText}>{selectedDateString}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setShowClearConfirm(true)}
            >
              <Trash2 size={18} color={Colors.light.danger} />
              <Text style={styles.clearButtonText}>Clear All</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Loading logs...</Text>
              </View>
            ) : outlets.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No outlets found</Text>
                <Text style={styles.emptySubtext}>Add outlets in Settings to start tracking activities</Text>
              </View>
            ) : (
              <View style={styles.content}>
                <View style={styles.tableContainer}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.tableHeader}>
                        <View style={styles.outletColumn}>
                          <Text style={styles.headerText}>Outlet</Text>
                        </View>
                        <View style={styles.statusColumn}>
                          <Text style={styles.headerText}>Stock Check</Text>
                        </View>
                        <View style={styles.statusColumn}>
                          <Text style={styles.headerText}>Requests</Text>
                        </View>
                        <View style={styles.statusColumn}>
                          <Text style={styles.headerText}>Reconciliation</Text>
                        </View>
                      </View>

                      {outlets.map((outlet) => {
                        const stockCheckDone = getActivityStatus(selectedDate, outlet.name, 'stock_check');
                        const requestsDone = getActivityStatus(selectedDate, outlet.name, 'requests');
                        const reconciliationDone = getActivityStatus(selectedDate, outlet.name, 'reconciliation');

                        return (
                          <View key={outlet.id} style={styles.tableRow}>
                            <View style={styles.outletColumn}>
                              <Text style={styles.outletText} numberOfLines={1}>{outlet.name}</Text>
                            </View>
                            <View style={styles.statusColumn}>
                              {stockCheckDone ? (
                                <CheckCircle2 size={24} color={Colors.light.success} />
                              ) : (
                                <XCircle size={24} color={Colors.light.danger} />
                              )}
                            </View>
                            <View style={styles.statusColumn}>
                              {requestsDone ? (
                                <CheckCircle2 size={24} color={Colors.light.success} />
                              ) : (
                                <XCircle size={24} color={Colors.light.danger} />
                              )}
                            </View>
                            <View style={styles.statusColumn}>
                              {reconciliationDone ? (
                                <CheckCircle2 size={24} color={Colors.light.success} />
                              ) : (
                                <XCircle size={24} color={Colors.light.danger} />
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>

                <View style={styles.expandableSection}>
                  <TouchableOpacity
                    style={styles.expandButton}
                    onPress={() => toggleDate(selectedDate)}
                  >
                    <Text style={styles.expandButtonText}>All Activities for {selectedDateString}</Text>
                    {expandedDates.has(selectedDate) ? (
                      <ChevronUp size={20} color={Colors.light.tint} />
                    ) : (
                      <ChevronDown size={20} color={Colors.light.tint} />
                    )}
                  </TouchableOpacity>

                  {expandedDates.has(selectedDate) && (
                    <View style={styles.activitiesList}>
                      {filteredLogs.length === 0 ? (
                        <View style={styles.emptyActivities}>
                          <Text style={styles.emptyActivitiesText}>No activities logged for this date</Text>
                        </View>
                      ) : (
                        filteredLogs.map((log) => (
                          <View key={log.id} style={styles.activityCard}>
                            <View style={styles.activityHeader}>
                              <View style={styles.activityTimeContainer}>
                                <Text style={styles.activityTime}>{log.time}</Text>
                                <View style={[styles.activityTypeBadge, { backgroundColor: getActivityTypeColor(log.type) }]}>
                                  <Text style={styles.activityTypeText}>{log.type.replace(/_/g, ' ').toUpperCase()}</Text>
                                </View>
                              </View>
                            </View>
                            <View style={styles.activityBody}>
                              <View style={styles.activityRow}>
                                <Text style={styles.activityLabel}>User:</Text>
                                <Text style={styles.activityValue}>{log.username}</Text>
                              </View>
                              <View style={styles.activityRow}>
                                <Text style={styles.activityLabel}>Outlet:</Text>
                                <Text style={styles.activityValue}>{log.outlet}</Text>
                              </View>
                              <View style={styles.activityRow}>
                                <Text style={styles.activityLabel}>Action:</Text>
                                <Text style={styles.activityValue}>{log.description}</Text>
                              </View>
                              {log.metadata && Object.keys(log.metadata).length > 0 && (
                                <View style={styles.metadataContainer}>
                                  <Text style={styles.metadataTitle}>Details:</Text>
                                  {Object.entries(log.metadata).map(([key, value]) => (
                                    <View key={key} style={styles.metadataRow}>
                                      <Text style={styles.metadataKey}>{key.replace(/_/g, ' ')}:</Text>
                                      <Text style={styles.metadataValue}>
                                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                            </View>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>

      <CalendarModal
        visible={showCalendar}
        initialDate={selectedDate}
        onClose={() => setShowCalendar(false)}
        onSelect={(iso) => {
          setSelectedDate(iso);
          setShowCalendar(false);
        }}
      />

      <ConfirmDialog
        visible={showClearConfirm}
        title="Clear All Logs"
        message="Are you sure you want to clear all activity logs? This action cannot be undone."
        confirmText="Clear All"
        cancelText="Cancel"
        onConfirm={handleClearLogs}
        onCancel={() => setShowClearConfirm(false)}
        destructive={true}
      />
    </>
  );
}

function getActivityTypeColor(type: string): string {
  switch (type) {
    case 'stock_check':
      return '#3B82F6';
    case 'stock_sent':
    case 'stock_received':
    case 'requests_approved':
      return '#10B981';
    case 'reconciliation':
      return '#EF4444';
    case 'inventory_edit':
      return '#8B5CF6';
    case 'production_request':
    case 'production_approved':
      return '#F59E0B';
    case 'order_created':
    case 'order_fulfilled':
      return '#EC4899';
    case 'grn_created':
      return '#14B8A6';
    default:
      return '#6B7280';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    backgroundColor: Colors.light.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  datePickerContainer: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.muted,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
  },
  dateSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  clearButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.danger,
    marginLeft: 12,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.danger,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  tableContainer: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.tint,
    paddingVertical: 20,
    paddingHorizontal: 12,
    minHeight: 60,
    zIndex: 10,
    elevation: 10,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  tableRow: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.light.card,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  outletColumn: {
    width: 150,
    justifyContent: 'center' as const,
  },
  outletText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  statusColumn: {
    width: 120,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  expandableSection: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden' as const,
  },
  expandButton: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    backgroundColor: Colors.light.card,
  },
  expandButtonText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  activitiesList: {
    padding: 12,
    paddingTop: 0,
  },
  emptyActivities: {
    paddingVertical: 32,
    alignItems: 'center' as const,
  },
  emptyActivitiesText: {
    fontSize: 14,
    color: Colors.light.muted,
  },
  activityCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden' as const,
  },
  activityHeader: {
    backgroundColor: Colors.light.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  activityTimeContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  activityTime: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  activityTypeBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  activityTypeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  activityBody: {
    padding: 12,
  },
  activityRow: {
    flexDirection: 'row' as const,
    marginBottom: 8,
  },
  activityLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.muted,
    width: 80,
  },
  activityValue: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.text,
  },
  metadataContainer: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  metadataTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.muted,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  metadataRow: {
    flexDirection: 'row' as const,
    marginBottom: 6,
  },
  metadataKey: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.muted,
    textTransform: 'capitalize' as const,
    width: 120,
  },
  metadataValue: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.text,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.muted,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.light.muted,
    marginTop: 8,
    textAlign: 'center' as const,
  },
});
