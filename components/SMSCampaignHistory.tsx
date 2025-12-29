import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useState } from 'react';
import { MessageSquare, Clock, CheckCircle, XCircle, ChevronRight, X } from 'lucide-react-native';
import { SMSCampaign, SMSRecipient } from '@/types';
import Colors from '@/constants/colors';

interface SMSCampaignHistoryProps {
  campaigns: SMSCampaign[];
  isLoading: boolean;
  onRefresh?: () => void;
  getCampaignRecipients: (campaignId: string) => SMSRecipient[];
}

export function SMSCampaignHistory({ campaigns, isLoading, onRefresh, getCampaignRecipients }: SMSCampaignHistoryProps) {
  const [selectedCampaign, setSelectedCampaign] = useState<SMSCampaign | null>(null);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#10b981';
      case 'failed':
        return '#ef4444';
      case 'pending':
      case 'sending':
        return '#f59e0b';
      default:
        return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={16} color="#10b981" />;
      case 'failed':
        return <XCircle size={16} color="#ef4444" />;
      default:
        return <Clock size={16} color="#f59e0b" />;
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const renderCampaign = ({ item }: { item: SMSCampaign }) => {
    const recipients = getCampaignRecipients(item.id);
    const deliveredCount = recipients.filter(r => r.delivery_status === 'delivered').length;

    return (
      <TouchableOpacity
        style={styles.campaignCard}
        onPress={() => setSelectedCampaign(item)}
      >
        <View style={styles.campaignHeader}>
          <View style={styles.statusBadge}>
            {getStatusIcon(item.status)}
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
              {item.status}
            </Text>
          </View>
          <ChevronRight size={20} color="#9ca3af" />
        </View>

        <Text style={styles.campaignMessage} numberOfLines={2}>
          {item.message}
        </Text>

        <View style={styles.campaignStats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Recipients</Text>
            <Text style={styles.statValue}>{item.recipient_count}</Text>
          </View>
          {item.campaign_cost !== undefined && (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Cost</Text>
              <Text style={styles.statValue}>Rs {item.campaign_cost}</Text>
            </View>
          )}
          {recipients.length > 0 && (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Delivered</Text>
              <Text style={styles.statValue}>{deliveredCount}/{recipients.length}</Text>
            </View>
          )}
        </View>

        <Text style={styles.campaignDate}>{formatDate(item.createdAt)}</Text>
      </TouchableOpacity>
    );
  };

  const renderDetailModal = () => {
    if (!selectedCampaign) return null;

    const recipients = getCampaignRecipients(selectedCampaign.id);

    return (
      <Modal
        visible={true}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedCampaign(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Campaign Details</Text>
              <TouchableOpacity onPress={() => setSelectedCampaign(null)}>
                <X size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Status</Text>
                <View style={styles.statusRow}>
                  {getStatusIcon(selectedCampaign.status)}
                  <Text style={[styles.detailValue, { color: getStatusColor(selectedCampaign.status) }]}>
                    {selectedCampaign.status}
                  </Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Message</Text>
                <Text style={styles.detailValue}>{selectedCampaign.message}</Text>
              </View>

              {selectedCampaign.source_address && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Source Address</Text>
                  <Text style={styles.detailValue}>{selectedCampaign.source_address}</Text>
                </View>
              )}

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Transaction ID</Text>
                <Text style={styles.detailValue}>{selectedCampaign.transaction_id}</Text>
              </View>

              {selectedCampaign.campaign_id && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Campaign ID</Text>
                  <Text style={styles.detailValue}>{selectedCampaign.campaign_id}</Text>
                </View>
              )}

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statBoxLabel}>Recipients</Text>
                  <Text style={styles.statBoxValue}>{selectedCampaign.recipient_count}</Text>
                </View>
                {selectedCampaign.campaign_cost !== undefined && (
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxLabel}>Cost</Text>
                    <Text style={styles.statBoxValue}>Rs {selectedCampaign.campaign_cost}</Text>
                  </View>
                )}
                {selectedCampaign.invalid_numbers !== undefined && selectedCampaign.invalid_numbers > 0 && (
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxLabel}>Invalid</Text>
                    <Text style={styles.statBoxValue}>{selectedCampaign.invalid_numbers}</Text>
                  </View>
                )}
                {selectedCampaign.duplicates_removed !== undefined && selectedCampaign.duplicates_removed > 0 && (
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxLabel}>Duplicates</Text>
                    <Text style={styles.statBoxValue}>{selectedCampaign.duplicates_removed}</Text>
                  </View>
                )}
              </View>

              {selectedCampaign.comment && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Comment</Text>
                  <Text style={styles.detailValue}>{selectedCampaign.comment}</Text>
                </View>
              )}

              {recipients.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Recipients ({recipients.length})</Text>
                  {recipients.map((recipient) => (
                    <View key={recipient.id} style={styles.recipientRow}>
                      <Text style={styles.recipientMobile}>{recipient.mobile_original}</Text>
                      <View style={[styles.deliveryBadge, { backgroundColor: getStatusColor(recipient.delivery_status) + '20' }]}>
                        <Text style={[styles.deliveryText, { color: getStatusColor(recipient.delivery_status) }]}>
                          {recipient.delivery_status}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Created</Text>
                <Text style={styles.detailValue}>{formatDate(selectedCampaign.createdAt)}</Text>
                <Text style={styles.detailSubValue}>By {selectedCampaign.createdBy}</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
        <Text style={styles.loadingText}>Loading campaigns...</Text>
      </View>
    );
  }

  if (campaigns.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <MessageSquare size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>No campaigns yet</Text>
        <Text style={styles.emptySubtext}>Send your first SMS campaign to get started</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={campaigns.sort((a, b) => b.createdAt - a.createdAt)}
        renderItem={renderCampaign}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onRefresh={onRefresh}
        refreshing={isLoading}
      />
      {renderDetailModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6b7280',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  campaignCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  campaignHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  campaignMessage: {
    fontSize: 15,
    color: '#1f2937',
    marginBottom: 12,
    lineHeight: 22,
  },
  campaignStats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  campaignDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  modalBody: {
    padding: 20,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  detailValue: {
    fontSize: 15,
    color: '#1f2937',
    lineHeight: 22,
  },
  detailSubValue: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  statBoxLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 4,
  },
  statBoxValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
  },
  recipientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
    marginBottom: 6,
  },
  recipientMobile: {
    fontSize: 14,
    color: '#374151',
    fontFamily: 'monospace' as any,
  },
  deliveryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  deliveryText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
