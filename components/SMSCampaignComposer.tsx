import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useState } from 'react';
import { Send, Users } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface SMSCampaignComposerProps {
  onSend: (
    message: string,
    recipients: string[],
    sourceAddress?: string,
    paymentMethod?: 0 | 4
  ) => Promise<{ success: boolean; campaign?: any; error?: string; data?: any }>;
  defaultSourceAddress?: string;
  defaultPaymentMethod?: 0 | 4;
}

export function SMSCampaignComposer({ onSend, defaultSourceAddress, defaultPaymentMethod }: SMSCampaignComposerProps) {
  const [message, setMessage] = useState<string>('');
  const [recipientsText, setRecipientsText] = useState<string>('');
  const [sourceAddress, setSourceAddress] = useState<string>(defaultSourceAddress || '');
  const [paymentMethod, setPaymentMethod] = useState<0 | 4>(defaultPaymentMethod || 0);
  const [isSending, setIsSending] = useState<boolean>(false);

  const parseRecipients = (text: string): string[] => {
    return text
      .split(/[,\n\s]+/)
      .map(r => r.trim())
      .filter(r => r.length > 0);
  };

  const handleSend = async () => {
    if (!message.trim()) {
      Alert.alert('Error', 'Please enter a message');
      return;
    }

    const recipients = parseRecipients(recipientsText);
    if (recipients.length === 0) {
      Alert.alert('Error', 'Please add at least one recipient');
      return;
    }

    if (recipients.length > 1000) {
      Alert.alert('Error', 'Maximum 1000 recipients per campaign');
      return;
    }

    Alert.alert(
      'Confirm Send',
      `Send SMS to ${recipients.length} recipient(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          style: 'default',
          onPress: async () => {
            setIsSending(true);
            const result = await onSend(
              message,
              recipients,
              sourceAddress || undefined,
              paymentMethod
            );
            setIsSending(false);

            if (result.success) {
              Alert.alert(
                'Campaign Sent',
                `Successfully sent to ${result.data?.recipients?.length || 0} recipients.\n` +
                `Cost: Rs ${result.data?.campaign_cost || 0}\n` +
                `Invalid numbers: ${result.data?.invalid_numbers || 0}`,
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      setMessage('');
                      setRecipientsText('');
                    },
                  },
                ]
              );
            } else {
              Alert.alert('Error', result.error || 'Failed to send campaign');
            }
          },
        },
      ]
    );
  };

  const recipientCount = parseRecipients(recipientsText).length;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Send size={24} color={Colors.light.tint} />
        <Text style={styles.title}>Compose SMS Campaign</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Message *</Text>
        <TextInput
          style={[styles.input, styles.messageInput]}
          value={message}
          onChangeText={setMessage}
          placeholder="Enter your SMS message..."
          placeholderTextColor="#999"
          multiline
          numberOfLines={5}
        />
        <Text style={styles.charCount}>{message.length} characters</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Recipients *</Text>
          <View style={styles.badge}>
            <Users size={14} color="#fff" />
            <Text style={styles.badgeText}>{recipientCount}</Text>
          </View>
        </View>
        <TextInput
          style={[styles.input, styles.recipientsInput]}
          value={recipientsText}
          onChangeText={setRecipientsText}
          placeholder="Enter mobile numbers (one per line or comma-separated)&#10;07XXXXXXXX&#10;07XXXXXXXX&#10;..."
          placeholderTextColor="#999"
          multiline
          numberOfLines={6}
        />
        <Text style={styles.hint}>
          Format: 07XXXXXXXX, 947XXXXXXXX, or 7XXXXXXXX
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Source Address / Mask (Optional)</Text>
        <TextInput
          style={styles.input}
          value={sourceAddress}
          onChangeText={(text) => setSourceAddress(text.substring(0, 11))}
          placeholder={defaultSourceAddress || 'e.g., MyCompany'}
          placeholderTextColor="#999"
          maxLength={11}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Payment Method</Text>
        <View style={styles.paymentRow}>
          <TouchableOpacity
            style={[styles.paymentButton, paymentMethod === 0 && styles.paymentButtonActive]}
            onPress={() => setPaymentMethod(0)}
          >
            <Text style={[styles.paymentText, paymentMethod === 0 && styles.paymentTextActive]}>
              Wallet
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paymentButton, paymentMethod === 4 && styles.paymentButtonActive]}
            onPress={() => setPaymentMethod(4)}
          >
            <Text style={[styles.paymentText, paymentMethod === 4 && styles.paymentTextActive]}>
              Package
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.sendButton, (isSending || !message.trim() || recipientCount === 0) && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={isSending || !message.trim() || recipientCount === 0}
      >
        {isSending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Send size={20} color="#fff" />
            <Text style={styles.sendButtonText}>Send to {recipientCount} recipient(s)</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  section: {
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.tint,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#1f2937',
    backgroundColor: '#fff',
  },
  messageInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  recipientsInput: {
    minHeight: 140,
    textAlignVertical: 'top',
    fontFamily: 'monospace' as any,
  },
  charCount: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'right',
  },
  hint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  paymentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  paymentButtonActive: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.tint + '10',
  },
  paymentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  paymentTextActive: {
    color: Colors.light.tint,
  },
  sendButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 32,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
