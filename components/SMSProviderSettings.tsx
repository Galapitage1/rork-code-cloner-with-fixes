import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { MessageSquare, Check, X } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface SMSProviderSettingsProps {
  settings: {
    esms_username: string;
    esms_password_encrypted: string;
    default_source_address?: string;
    default_payment_method: 0 | 4;
    push_notification_url?: string;
  } | null;
  onSave: (settings: {
    provider: 'dialog_esms';
    esms_username: string;
    esms_password_encrypted: string;
    default_source_address?: string;
    default_payment_method: 0 | 4;
    push_notification_url?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onTestLogin: (username: string, password: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  onSendTest: (mobile: string, message: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  isSaving: boolean;
}

export function SMSProviderSettings({ settings, onSave, onTestLogin, onSendTest, isSaving }: SMSProviderSettingsProps) {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [sourceAddress, setSourceAddress] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<0 | 4>(0);
  const [pushNotificationUrl, setPushNotificationUrl] = useState<string>('');
  const [testMobile, setTestMobile] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>('This is a test SMS from your app.');
  const [isTestingLogin, setIsTestingLogin] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [loginTestResult, setLoginTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setUsername(settings.esms_username || '');
      setPassword(settings.esms_password_encrypted || '');
      setSourceAddress(settings.default_source_address || '');
      setPaymentMethod(settings.default_payment_method);
      setPushNotificationUrl(settings.push_notification_url || '');
    }
  }, [settings]);

  const handleTestLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please enter username and password');
      return;
    }

    setIsTestingLogin(true);
    setLoginTestResult(null);

    const result = await onTestLogin(username, password);
    setIsTestingLogin(false);

    if (result.success) {
      setLoginTestResult({ success: true, message: result.message || 'Login successful!' });
    } else {
      setLoginTestResult({ success: false, message: result.error || 'Login failed' });
    }
  };

  const handleSendTest = async () => {
    if (!testMobile || !testMessage) {
      Alert.alert('Error', 'Please enter mobile number and message');
      return;
    }

    if (!settings && (!username || !password)) {
      Alert.alert('Error', 'Please save settings first or enter credentials');
      return;
    }

    setIsSendingTest(true);
    const result = await onSendTest(testMobile, testMessage);
    setIsSendingTest(false);

    if (result.success) {
      Alert.alert('Success', result.message || 'Test SMS sent successfully!');
      setTestMobile('');
    } else {
      Alert.alert('Error', result.error || 'Failed to send test SMS');
    }
  };

  const handleSave = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Username and password are required');
      return;
    }

    const result = await onSave({
      provider: 'dialog_esms',
      esms_username: username,
      esms_password_encrypted: password,
      default_source_address: sourceAddress || undefined,
      default_payment_method: paymentMethod,
      push_notification_url: pushNotificationUrl || undefined,
    });

    if (result.success) {
      Alert.alert('Success', 'SMS settings saved successfully');
      setLoginTestResult(null);
    } else {
      Alert.alert('Error', result.error || 'Failed to save settings');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MessageSquare size={24} color={Colors.light.tint} />
        <Text style={styles.title}>Dialog eSMS Configuration</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Username *</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Enter eSMS username"
          placeholderTextColor="#999"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Password *</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Enter eSMS password"
          placeholderTextColor="#999"
          secureTextEntry
          autoCapitalize="none"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Source Address / Mask (Max 11 chars)</Text>
        <TextInput
          style={styles.input}
          value={sourceAddress}
          onChangeText={(text) => setSourceAddress(text.substring(0, 11))}
          placeholder="e.g., MyCompany"
          placeholderTextColor="#999"
          maxLength={11}
        />
        <Text style={styles.hint}>Optional - Sender name displayed to recipients</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Payment Method</Text>
        <View style={styles.paymentRow}>
          <TouchableOpacity
            style={[styles.paymentButton, paymentMethod === 0 && styles.paymentButtonActive]}
            onPress={() => setPaymentMethod(0)}
          >
            <Text style={[styles.paymentText, paymentMethod === 0 && styles.paymentTextActive]}>
              Wallet (0)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paymentButton, paymentMethod === 4 && styles.paymentButtonActive]}
            onPress={() => setPaymentMethod(4)}
          >
            <Text style={[styles.paymentText, paymentMethod === 4 && styles.paymentTextActive]}>
              Package (4)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Delivery Report Webhook URL</Text>
        <TextInput
          style={styles.input}
          value={pushNotificationUrl}
          onChangeText={setPushNotificationUrl}
          placeholder="https://yourapp.com/api/sms/dlr"
          placeholderTextColor="#999"
          autoCapitalize="none"
        />
        <Text style={styles.hint}>Optional - Receive delivery status updates</Text>
      </View>

      <TouchableOpacity
        style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveButtonText}>Save Settings</Text>
        )}
      </TouchableOpacity>

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Test Connection</Text>

      <TouchableOpacity
        style={[styles.testButton, isTestingLogin && styles.testButtonDisabled]}
        onPress={handleTestLogin}
        disabled={isTestingLogin}
      >
        {isTestingLogin ? (
          <ActivityIndicator color={Colors.light.tint} />
        ) : (
          <Text style={styles.testButtonText}>Test Login</Text>
        )}
      </TouchableOpacity>

      {loginTestResult && (
        <View style={[styles.testResult, loginTestResult.success ? styles.testResultSuccess : styles.testResultError]}>
          {loginTestResult.success ? (
            <Check size={20} color="#10b981" />
          ) : (
            <X size={20} color="#ef4444" />
          )}
          <Text style={[styles.testResultText, loginTestResult.success ? styles.testResultTextSuccess : styles.testResultTextError]}>
            {loginTestResult.message}
          </Text>
        </View>
      )}

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Send Test SMS</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Test Mobile Number</Text>
        <TextInput
          style={styles.input}
          value={testMobile}
          onChangeText={setTestMobile}
          placeholder="07XXXXXXXX or 947XXXXXXXX"
          placeholderTextColor="#999"
          keyboardType="phone-pad"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Test Message</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={testMessage}
          onChangeText={setTestMessage}
          placeholder="Enter test message"
          placeholderTextColor="#999"
          multiline
          numberOfLines={3}
        />
      </View>

      <TouchableOpacity
        style={[styles.testButton, isSendingTest && styles.testButtonDisabled]}
        onPress={handleSendTest}
        disabled={isSendingTest}
      >
        {isSendingTest ? (
          <ActivityIndicator color={Colors.light.tint} />
        ) : (
          <Text style={styles.testButtonText}>Send Test SMS</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
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
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
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
  saveButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 16,
  },
  testButton: {
    borderWidth: 1,
    borderColor: Colors.light.tint,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  testButtonDisabled: {
    opacity: 0.6,
  },
  testButtonText: {
    color: Colors.light.tint,
    fontSize: 15,
    fontWeight: '600',
  },
  testResult: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  testResultSuccess: {
    backgroundColor: '#d1fae5',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  testResultError: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  testResultText: {
    fontSize: 14,
    flex: 1,
  },
  testResultTextSuccess: {
    color: '#065f46',
  },
  testResultTextError: {
    color: '#991b1b',
  },
});
