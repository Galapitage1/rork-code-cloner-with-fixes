import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';


import { Mail, MessageSquare, Send, ChevronDown, ChevronUp, X, CheckSquare, Square, Paperclip, Settings, Phone } from 'lucide-react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCustomers } from '@/contexts/CustomerContext';
import Colors from '@/constants/colors';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';


type CampaignType = 'email' | 'sms' | 'whatsapp';
type EmailFormat = 'text' | 'html';

interface Attachment {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

const CAMPAIGN_SETTINGS_KEY = '@campaign_settings';

export default function CampaignsScreen() {
  const { customers } = useCustomers();
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  
  const [campaignType, setCampaignType] = useState<CampaignType>('email');
  const [emailFormat, setEmailFormat] = useState<EmailFormat>('text');
  
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  
  const [isSending, setIsSending] = useState(false);
  const [testingSMS, setTestingSMS] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  
  const [smtpHost, setSmtpHost] = useState<string>('');
  const [smtpPort, setSmtpPort] = useState<string>('587');
  const [smtpUsername, setSmtpUsername] = useState<string>('');
  const [smtpPassword, setSmtpPassword] = useState<string>('');
  const [imapHost, setImapHost] = useState<string>('');
  const [imapPort, setImapPort] = useState<string>('993');
  const [imapUsername, setImapUsername] = useState<string>('');
  const [imapPassword, setImapPassword] = useState<string>('');
  const [smsApiUrl, setSmsApiUrl] = useState<string>('https://app.notify.lk/api/v1/send');
  const [smsApiKey, setSmsApiKey] = useState<string>('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTEyMTcsImlhdCI6MTY4MDA4NDgxMywiZXhwIjo0ODA0Mjg3MjEzfQ.KUbNVxzp2U7lx6ChLMLbMQ3ht0iClOFHowcd52QXLEs');
  
  const [whatsappAccessToken, setWhatsappAccessToken] = useState<string>('EAAMu0FWFiRgBQOiKZCI05pdADdVTYhCRmjq2mRhpOGd9CkeOEd5AumZCvPZC6fe7wD9svBkGSf2Hf0VzlF8bQ7ME3Q1JIMweLU1hkLV2CSEXhT8MzOBFx2BsXIFkh64B3N5T2xy0LWDoCNtHttmMCPNS17yLnmmgOQ0WJKEy690yOf6tKVDncQK3KPiw6O7VuFfC3ZCFWYfUC67SwIZCpCTk7e4TGZCqHP66EQZBiVMjHUSR338wZATo39HiNhOlcxjXkfpESlfpnccANLY4mGXTxboGZCPbZC5aoZD');
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState<string>('1790691781257415');
  const [whatsappBusinessId, setWhatsappBusinessId] = useState<string>('895897253021976');
  const [showWhatsAppSettings, setShowWhatsAppSettings] = useState(false);
  const [testingWhatsApp, setTestingWhatsApp] = useState(false);

  const loadCampaignSettings = async () => {
    try {
      const settings = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        setSmtpHost(parsed.smtpHost || '');
        setSmtpPort(parsed.smtpPort || '587');
        setSmtpUsername(parsed.smtpUsername || '');
        setSmtpPassword(parsed.smtpPassword || '');
        setImapHost(parsed.imapHost || '');
        setImapPort(parsed.imapPort || '993');
        setImapUsername(parsed.imapUsername || '');
        setImapPassword(parsed.imapPassword || '');
        setSmsApiUrl(parsed.smsApiUrl || 'https://app.notify.lk/api/v1/send');
        setSmsApiKey(parsed.smsApiKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTEyMTcsImlhdCI6MTY4MDA4NDgxMywiZXhwIjo0ODA0Mjg3MjEzfQ.KUbNVxzp2U7lx6ChLMLbMQ3ht0iClOFHowcd52QXLEs');
        setWhatsappAccessToken(parsed.whatsappAccessToken || 'EAAMu0FWFiRgBQOiKZCI05pdADdVTYhCRmjq2mRhpOGd9CkeOEd5AumZCvPZC6fe7wD9svBkGSf2Hf0VzlF8bQ7ME3Q1JIMweLU1hkLV2CSEXhT8MzOBFx2BsXIFkh64B3N5T2xy0LWDoCNtHttmMCPNS17yLnmmgOQ0WJKEy690yOf6tKVDncQK3KPiw6O7VuFfC3ZCFWYfUC67SwIZCpCTk7e4TGZCqHP66EQZBiVMjHUSR338wZATo39HiNhOlcxjXkfpESlfpnccANLY4mGXTxboGZCPbZC5aoZD');
        setWhatsappPhoneNumberId(parsed.whatsappPhoneNumberId || '1790691781257415');
        setWhatsappBusinessId(parsed.whatsappBusinessId || '895897253021976');
      }
    } catch (error) {
      console.error('Failed to load campaign settings:', error);
    }
  };

  const saveCampaignSettings = async () => {
    try {
      console.log('[CAMPAIGNS] Saving campaign settings...');
      const settings = {
        id: 'campaign_settings',
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        imapHost,
        imapPort,
        imapUsername,
        imapPassword,
        smsApiUrl,
        smsApiKey,
        whatsappAccessToken,
        whatsappPhoneNumberId,
        whatsappBusinessId,
        updatedAt: Date.now(),
      };
      
      console.log('[CAMPAIGNS] Settings to save:', { 
        hasSmtp: !!smtpHost, 
        hasImap: !!imapHost,
        smtpPort,
        imapPort 
      });
      
      await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(settings));
      console.log('[CAMPAIGNS] Settings saved to AsyncStorage');
      
      Alert.alert('Success', 'Email settings saved successfully');
    } catch (error) {
      console.error('[CAMPAIGNS] Failed to save campaign settings:', error);
      Alert.alert('Error', 'Failed to save settings');
    }
  };

  React.useEffect(() => {
    loadCampaignSettings().finally(() => setIsPageLoading(false));
  }, []);

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return customers;
    
    return customers.filter(c => 
      c.name.toLowerCase().includes(query) ||
      c.email?.toLowerCase().includes(query) ||
      c.phone?.includes(query) ||
      c.company?.toLowerCase().includes(query)
    );
  }, [customers, searchQuery]);

  const eligibleCustomers = useMemo(() => {
    if (campaignType === 'email') {
      return filteredCustomers.filter(c => c.email && c.email.trim() !== '');
    } else if (campaignType === 'sms' || campaignType === 'whatsapp') {
      return filteredCustomers.filter(c => c.phone && c.phone.trim() !== '');
    }
    return filteredCustomers;
  }, [filteredCustomers, campaignType]);

  const selectedCustomers = useMemo(() => {
    return eligibleCustomers.filter(c => selectedCustomerIds.has(c.id));
  }, [eligibleCustomers, selectedCustomerIds]);

  const toggleCustomer = (customerId: string) => {
    const newSet = new Set(selectedCustomerIds);
    if (newSet.has(customerId)) {
      newSet.delete(customerId);
    } else {
      newSet.add(customerId);
    }
    setSelectedCustomerIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedCustomerIds.size === eligibleCustomers.length) {
      setSelectedCustomerIds(new Set());
    } else {
      setSelectedCustomerIds(new Set(eligibleCustomers.map(c => c.id)));
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled) return;

      const newAttachments: Attachment[] = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
        size: asset.size || 0,
      }));

      setAttachments([...attachments, ...newAttachments]);
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const testEmailConnection = async () => {
    try {
      setTestingEmail(true);
      console.log('[Email Test] Starting connection test...');

      const smtpConfig = smtpHost && smtpUsername && smtpPassword ? {
        host: smtpHost,
        port: smtpPort,
        username: smtpUsername,
        password: smtpPassword,
      } : null;

      const imapConfig = imapHost && imapUsername && imapPassword ? {
        host: imapHost,
        port: imapPort,
        username: imapUsername,
        password: imapPassword,
      } : null;

      if (!smtpConfig && !imapConfig) {
        Alert.alert('Configuration Missing', 'Please configure at least SMTP or IMAP settings before testing.');
        return;
      }

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:8081';
      const response = await fetch(`${apiUrl}/api/test-email-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          smtpConfig,
          imapConfig,
        }),
      });

      const result = await response.json();
      console.log('[Email Test] Response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Connection test failed');
      }

      const { results } = result;
      let message = '';

      if (results.smtp.message) {
        message += `SMTP: ${results.smtp.message}\n`;
      }
      if (results.imap.message) {
        message += `IMAP: ${results.imap.message}`;
      }

      const allSuccess = (!smtpConfig || results.smtp.success) && (!imapConfig || results.imap.success);

      Alert.alert(
        allSuccess ? 'Connection Test Successful' : 'Connection Test Results',
        message.trim(),
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('[Email Test] Error:', error);
      Alert.alert('Connection Test Failed', (error as Error).message);
    } finally {
      setTestingEmail(false);
    }
  };

  const testSMSConnection = async () => {
    try {
      setTestingSMS(true);
      const response = await fetch(smsApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${smsApiKey}`,
        },
        body: JSON.stringify({
          user_id: '11217',
          api_key: smsApiKey,
          sender_id: 'NotifyDEMO',
          to: '94777123456',
          message: 'Test message from Campaign Manager',
        }),
      });

      const data = await response.json();
      console.log('SMS Test Response:', data);

      if (response.ok) {
        Alert.alert('Success', 'SMS API connection is working! Response: ' + JSON.stringify(data));
      } else {
        Alert.alert('API Response', `Status: ${response.status}\n${JSON.stringify(data, null, 2)}`);
      }
    } catch (error) {
      console.error('SMS test error:', error);
      Alert.alert('Error', 'Failed to test SMS connection: ' + (error as Error).message);
    } finally {
      setTestingSMS(false);
    }
  };

  const validateEmailCampaign = (): string | null => {
    if (!senderEmail || !senderEmail.includes('@')) {
      return 'Please enter a valid sender email address';
    }
    if (!senderName.trim()) {
      return 'Please enter sender name';
    }
    if (!subject.trim()) {
      return 'Please enter email subject';
    }
    if (emailFormat === 'text' && !message.trim()) {
      return 'Please enter message content';
    }
    if (emailFormat === 'html' && !htmlContent.trim()) {
      return 'Please enter HTML content';
    }
    if (selectedCustomers.length === 0) {
      return 'Please select at least one customer';
    }
    const noEmailCustomers = selectedCustomers.filter(c => !c.email);
    if (noEmailCustomers.length > 0) {
      return `${noEmailCustomers.length} selected customer(s) don't have email addresses`;
    }
    return null;
  };

  const validateSMSCampaign = (): string | null => {
    if (!message.trim()) {
      return 'Please enter SMS message';
    }
    if (selectedCustomers.length === 0) {
      return 'Please select at least one customer';
    }
    const noPhoneCustomers = selectedCustomers.filter(c => !c.phone);
    if (noPhoneCustomers.length > 0) {
      return `${noPhoneCustomers.length} selected customer(s) don't have phone numbers`;
    }
    return null;
  };

  const validateWhatsAppCampaign = (): string | null => {
    if (!message.trim()) {
      return 'Please enter WhatsApp message';
    }
    if (selectedCustomers.length === 0) {
      return 'Please select at least one customer';
    }
    const noPhoneCustomers = selectedCustomers.filter(c => !c.phone);
    if (noPhoneCustomers.length > 0) {
      return `${noPhoneCustomers.length} selected customer(s) don't have phone numbers`;
    }
    return null;
  };

  const sendEmailCampaign = async () => {
    const validationError = validateEmailCampaign();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    if (!smtpHost || !smtpUsername || !smtpPassword) {
      Alert.alert(
        'SMTP Not Configured',
        'Please configure SMTP settings in the Settings page before sending emails.',
        [{ text: 'OK' }]
      );
      return;
    }

    console.log('[EMAIL CAMPAIGN] Opening confirm dialog...');
    console.log('[EMAIL CAMPAIGN] confirmVisible before:', confirmVisible);
    console.log('[EMAIL CAMPAIGN] Setting confirmState and visible...');
    
    setConfirmState({
      title: 'Send Email Campaign',
      message: `Send ${selectedCustomers.length} email(s) via SMTP?`,
      onConfirm: async () => {
        console.log('[EMAIL CAMPAIGN] User confirmed, starting send...');
        try {
          setIsSending(true);

          const processedAttachments = await Promise.all(
            attachments.map(async (att) => {
              let base64Content = '';

              if (Platform.OS !== 'web') {
                base64Content = await FileSystem.readAsStringAsync(att.uri, {
                  encoding: 'base64',
                });
              } else {
                const response = await fetch(att.uri);
                const blob = await response.blob();
                const reader = new FileReader();
                base64Content = await new Promise((resolve) => {
                  reader.onloadend = () => {
                    const base64 = reader.result as string;
                    resolve(base64.split(',')[1]);
                  };
                  reader.readAsDataURL(blob);
                });
              }

              return {
                filename: att.name,
                content: base64Content,
                encoding: 'base64' as const,
                contentType: att.mimeType,
              };
            })
          );

          console.log('[EMAIL CAMPAIGN] Sending to backend...');
          const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:8081';
          const response = await fetch(`${apiUrl}/api/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              smtpConfig: {
                host: smtpHost,
                port: smtpPort,
                username: smtpUsername,
                password: smtpPassword,
              },
              emailData: {
                senderName,
                senderEmail,
                subject,
                message,
                htmlContent,
                format: emailFormat,
                attachments: processedAttachments,
              },
              recipients: selectedCustomers.map(c => ({
                name: c.name,
                email: c.email,
              })),
            }),
          });

          const result = await response.json();
          console.log('[EMAIL CAMPAIGN] Backend response:', result);

          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to send emails');
          }

          const { results } = result;
          const resultMessage = `Sent: ${results.success}\nFailed: ${results.failed}${
            results.errors.length > 0 ? '\n\nErrors:\n' + results.errors.slice(0, 5).join('\n') : ''
          }`;

          Alert.alert(
            'Email Campaign Complete',
            resultMessage,
            [{ text: 'OK' }]
          );

          if (results.success > 0) {
            setSubject('');
            setMessage('');
            setHtmlContent('');
            setAttachments([]);
            setSelectedCustomerIds(new Set());
          }

        } catch (error) {
          console.error('[EMAIL CAMPAIGN] Error:', error);
          Alert.alert('Error', 'Failed to send email campaign: ' + (error as Error).message);
        } finally {
          setIsSending(false);
        }
      },
    });
    
    setTimeout(() => {
      console.log('[EMAIL CAMPAIGN] Setting confirmVisible to true...');
      setConfirmVisible(true);
      console.log('[EMAIL CAMPAIGN] confirmVisible set to:', true);
    }, 100);
  };

  const sendSMSCampaign = async () => {
    const validationError = validateSMSCampaign();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    console.log('[SMS CAMPAIGN] Opening confirm dialog...');
    setConfirmState({
      title: 'Send SMS Campaign',
      message: `Send SMS to ${selectedCustomers.length} customer(s)?`,
      onConfirm: async () => {
        console.log('[SMS CAMPAIGN] User confirmed, starting send...');
        try {
          setIsSending(true);
          let successCount = 0;
          let failCount = 0;
          const errors: string[] = [];

          for (const customer of selectedCustomers) {
            if (!customer.phone) continue;

            try {
              let phone = customer.phone.trim();
              if (phone.startsWith('0')) {
                phone = '94' + phone.substring(1);
              } else if (!phone.startsWith('94')) {
                phone = '94' + phone;
              }

              const response = await fetch(smsApiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${smsApiKey}`,
                },
                body: JSON.stringify({
                  user_id: '11217',
                  api_key: smsApiKey,
                  sender_id: 'NotifyDEMO',
                  to: phone,
                  message: message,
                }),
              });

              const data = await response.json();
              console.log(`SMS to ${customer.name} (${phone}):`, data);

              if (response.ok) {
                successCount++;
              } else {
                failCount++;
                errors.push(`${customer.name}: ${data.message || 'Failed'}`);
              }

              await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
              failCount++;
              errors.push(`${customer.name}: ${(error as Error).message}`);
              console.error(`Failed to send SMS to ${customer.name}:`, error);
            }
          }

          const resultMessage = `Sent: ${successCount}\nFailed: ${failCount}${
            errors.length > 0 ? '\n\nErrors:\n' + errors.slice(0, 5).join('\n') : ''
          }`;

          Alert.alert(
            'SMS Campaign Complete',
            resultMessage,
            [{ text: 'OK' }]
          );

        } catch (error) {
          console.error('[SMS CAMPAIGN] Error:', error);
          Alert.alert('Error', 'Failed to send SMS campaign: ' + (error as Error).message);
        } finally {
          setIsSending(false);
        }
      },
    });
    setConfirmVisible(true);
    console.log('[SMS CAMPAIGN] Confirm dialog should be visible');
  };

  const testWhatsAppConnection = async () => {
    try {
      setTestingWhatsApp(true);
      console.log('[WhatsApp Test] Starting connection test...');

      if (!whatsappAccessToken || !whatsappPhoneNumberId) {
        Alert.alert('Configuration Missing', 'Please configure WhatsApp settings before testing.');
        return;
      }

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:8081';
      const response = await fetch(`${apiUrl}/api/test-whatsapp-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accessToken: whatsappAccessToken,
          phoneNumberId: whatsappPhoneNumberId,
        }),
      });

      const result = await response.json();
      console.log('[WhatsApp Test] Response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Connection test failed');
      }

      Alert.alert('Connection Test Successful', result.message || 'WhatsApp API is configured correctly');
    } catch (error) {
      console.error('[WhatsApp Test] Error:', error);
      Alert.alert('Connection Test Failed', (error as Error).message);
    } finally {
      setTestingWhatsApp(false);
    }
  };

  const sendWhatsAppCampaign = async () => {
    const validationError = validateWhatsAppCampaign();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    if (!whatsappAccessToken || !whatsappPhoneNumberId) {
      Alert.alert(
        'WhatsApp Not Configured',
        'Please configure WhatsApp Business API settings before sending messages.',
        [{ text: 'OK' }]
      );
      return;
    }

    console.log('[WhatsApp CAMPAIGN] Opening confirm dialog...');
    setConfirmState({
      title: 'Send WhatsApp Campaign',
      message: `Send WhatsApp message to ${selectedCustomers.length} customer(s)?`,
      onConfirm: async () => {
        console.log('[WhatsApp CAMPAIGN] User confirmed, starting send...');
        try {
          setIsSending(true);

          const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:8081';
          const response = await fetch(`${apiUrl}/api/send-whatsapp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              accessToken: whatsappAccessToken,
              phoneNumberId: whatsappPhoneNumberId,
              message: message,
              recipients: selectedCustomers.map(c => ({
                name: c.name,
                phone: c.phone,
              })),
            }),
          });

          const result = await response.json();
          console.log('[WhatsApp CAMPAIGN] Backend response:', result);

          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to send WhatsApp messages');
          }

          const { results } = result;
          const resultMessage = `Sent: ${results.success}\nFailed: ${results.failed}${
            results.errors.length > 0 ? '\n\nErrors:\n' + results.errors.slice(0, 5).join('\n') : ''
          }`;

          Alert.alert(
            'WhatsApp Campaign Complete',
            resultMessage,
            [{ text: 'OK' }]
          );

          if (results.success > 0) {
            setMessage('');
            setSelectedCustomerIds(new Set());
          }

        } catch (error) {
          console.error('[WhatsApp CAMPAIGN] Error:', error);
          Alert.alert('Error', 'Failed to send WhatsApp campaign: ' + (error as Error).message);
        } finally {
          setIsSending(false);
        }
      },
    });
    setConfirmVisible(true);
  };

  const handleSendCampaign = () => {
    if (campaignType === 'email') {
      sendEmailCampaign();
    } else if (campaignType === 'sms') {
      sendSMSCampaign();
    } else if (campaignType === 'whatsapp') {
      sendWhatsAppCampaign();
    }
  };

  if (isPageLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.light.tint} />
        <Text style={{ marginTop: 16, color: Colors.light.text }}>Loading campaign settings...</Text>
      </View>
    );
  }

  console.log('[CAMPAIGNS] Render - isPageLoading:', isPageLoading, 'customers:', customers.length);
  console.log('[CAMPAIGNS] confirmVisible:', confirmVisible, 'confirmState:', !!confirmState);
  console.log('[CAMPAIGNS] SMTP configured:', { host: !!smtpHost, user: !!smtpUsername, pass: !!smtpPassword });
  console.log('[CAMPAIGNS] IMAP configured:', { host: !!imapHost, user: !!imapUsername, pass: !!imapPassword });
  
  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.typeSelector}>
          <TouchableOpacity
            style={[
              styles.typeButton,
              campaignType === 'email' && styles.typeButtonActive,
            ]}
            onPress={() => setCampaignType('email')}
          >
            <Mail
              size={20}
              color={campaignType === 'email' ? Colors.light.tint : Colors.light.tabIconDefault}
            />
            <Text
              style={[
                styles.typeButtonText,
                campaignType === 'email' && styles.typeButtonTextActive,
              ]}
            >
              Email Campaign
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.typeButton,
              campaignType === 'sms' && styles.typeButtonActive,
            ]}
            onPress={() => setCampaignType('sms')}
          >
            <MessageSquare
              size={20}
              color={campaignType === 'sms' ? Colors.light.tint : Colors.light.tabIconDefault}
            />
            <Text
              style={[
                styles.typeButtonText,
                campaignType === 'sms' && styles.typeButtonTextActive,
              ]}
            >
              SMS Campaign
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.typeButton,
              campaignType === 'whatsapp' && styles.typeButtonActive,
            ]}
            onPress={() => setCampaignType('whatsapp')}
          >
            <Phone
              size={20}
              color={campaignType === 'whatsapp' ? Colors.light.tint : Colors.light.tabIconDefault}
            />
            <Text
              style={[
                styles.typeButtonText,
                campaignType === 'whatsapp' && styles.typeButtonTextActive,
              ]}
            >
              WhatsApp
            </Text>
          </TouchableOpacity>
        </View>

        {campaignType === 'email' && (
          <>
            <TouchableOpacity
              style={styles.settingsToggle}
              onPress={() => setShowEmailSettings(!showEmailSettings)}
            >
              <View style={styles.settingsToggleLeft}>
                <Settings size={20} color={Colors.light.tint} />
                <Text style={styles.settingsToggleText}>Email Configuration</Text>
              </View>
              {showEmailSettings ? (
                <ChevronUp size={20} color={Colors.light.tint} />
              ) : (
                <ChevronDown size={20} color={Colors.light.tint} />
              )}
            </TouchableOpacity>

            {showEmailSettings && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SMTP Settings (Outgoing Mail)</Text>
                
                <Text style={styles.label}>SMTP Host *</Text>
                <TextInput
                  style={styles.input}
                  value={smtpHost}
                  onChangeText={setSmtpHost}
                  placeholder="smtp.gmail.com"
                  autoCapitalize="none"
                />

                <Text style={styles.label}>SMTP Port *</Text>
                <TextInput
                  style={styles.input}
                  value={smtpPort}
                  onChangeText={setSmtpPort}
                  placeholder="587"
                  keyboardType="number-pad"
                />

                <Text style={styles.label}>SMTP Username *</Text>
                <TextInput
                  style={styles.input}
                  value={smtpUsername}
                  onChangeText={setSmtpUsername}
                  placeholder="your@email.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />

                <Text style={styles.label}>SMTP Password *</Text>
                <TextInput
                  style={styles.input}
                  value={smtpPassword}
                  onChangeText={setSmtpPassword}
                  placeholder="Your password or app password"
                  secureTextEntry
                  autoCapitalize="none"
                />

                <View style={styles.divider} />

                <Text style={styles.sectionTitle}>IMAP Settings (Incoming Mail)</Text>
                
                <Text style={styles.label}>IMAP Host</Text>
                <TextInput
                  style={styles.input}
                  value={imapHost}
                  onChangeText={setImapHost}
                  placeholder="imap.gmail.com"
                  autoCapitalize="none"
                />

                <Text style={styles.label}>IMAP Port</Text>
                <TextInput
                  style={styles.input}
                  value={imapPort}
                  onChangeText={setImapPort}
                  placeholder="993"
                  keyboardType="number-pad"
                />

                <Text style={styles.label}>IMAP Username</Text>
                <TextInput
                  style={styles.input}
                  value={imapUsername}
                  onChangeText={setImapUsername}
                  placeholder="your@email.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />

                <Text style={styles.label}>IMAP Password</Text>
                <TextInput
                  style={styles.input}
                  value={imapPassword}
                  onChangeText={setImapPassword}
                  placeholder="Your password or app password"
                  secureTextEntry
                  autoCapitalize="none"
                />

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.testButton]}
                    onPress={testEmailConnection}
                    disabled={testingEmail}
                  >
                    {testingEmail ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <Text style={styles.testButtonText}>Test Connection</Text>
                    )}
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.actionButton, styles.saveSettingsButton]}
                    onPress={saveCampaignSettings}
                  >
                    <Text style={styles.saveSettingsButtonText}>Save Settings</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Email Campaign</Text>
              
              <Text style={styles.label}>Sender Email *</Text>
              <TextInput
                style={styles.input}
                value={senderEmail}
                onChangeText={setSenderEmail}
                placeholder="your@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.label}>Sender Name *</Text>
              <TextInput
                style={styles.input}
                value={senderName}
                onChangeText={setSenderName}
                placeholder="Your Company Name"
              />

              <Text style={styles.label}>Email Format</Text>
              <View style={styles.formatSelector}>
                <TouchableOpacity
                  style={[
                    styles.formatButton,
                    emailFormat === 'text' && styles.formatButtonActive,
                  ]}
                  onPress={() => setEmailFormat('text')}
                >
                  <Text
                    style={[
                      styles.formatButtonText,
                      emailFormat === 'text' && styles.formatButtonTextActive,
                    ]}
                  >
                    Plain Text
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.formatButton,
                    emailFormat === 'html' && styles.formatButtonActive,
                  ]}
                  onPress={() => setEmailFormat('html')}
                >
                  <Text
                    style={[
                      styles.formatButtonText,
                      emailFormat === 'html' && styles.formatButtonTextActive,
                    ]}
                  >
                    HTML
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Subject *</Text>
              <TextInput
                style={styles.input}
                value={subject}
                onChangeText={setSubject}
                placeholder="Email subject"
              />

              {emailFormat === 'text' ? (
                <>
                  <Text style={styles.label}>Message *</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={message}
                    onChangeText={setMessage}
                    placeholder="Your email message..."
                    multiline
                    numberOfLines={8}
                    textAlignVertical="top"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.label}>HTML Content *</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={htmlContent}
                    onChangeText={setHtmlContent}
                    placeholder="<html><body>Your HTML content...</body></html>"
                    multiline
                    numberOfLines={10}
                    textAlignVertical="top"
                  />
                </>
              )}

              <Text style={styles.label}>Attachments</Text>
              <TouchableOpacity style={styles.attachmentButton} onPress={pickDocument}>
                <Paperclip size={20} color={Colors.light.tint} />
                <Text style={styles.attachmentButtonText}>Add Attachments</Text>
              </TouchableOpacity>

              {attachments.map((attachment, index) => (
                <View key={index} style={styles.attachmentItem}>
                  <View style={styles.attachmentInfo}>
                    <Text style={styles.attachmentName} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    <Text style={styles.attachmentSize}>
                      {(attachment.size / 1024).toFixed(1)} KB
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => removeAttachment(index)}>
                    <X size={20} color={Colors.light.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {campaignType === 'sms' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SMS Settings</Text>
            
            <TouchableOpacity
              style={styles.smsTestButton}
              onPress={testSMSConnection}
              disabled={testingSMS}
            >
              {testingSMS ? (
                <ActivityIndicator size="small" color={Colors.light.tint} />
              ) : (
                <Text style={styles.smsTestButtonText}>Test SMS Connection</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.label}>Message * (Max 160 characters)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={message}
              onChangeText={setMessage}
              placeholder="Your SMS message..."
              multiline
              numberOfLines={4}
              maxLength={160}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{message.length}/160 characters</Text>
          </View>
        )}

        {campaignType === 'whatsapp' && (
          <>
            <TouchableOpacity
              style={styles.settingsToggle}
              onPress={() => setShowWhatsAppSettings(!showWhatsAppSettings)}
            >
              <View style={styles.settingsToggleLeft}>
                <Settings size={20} color={Colors.light.tint} />
                <Text style={styles.settingsToggleText}>WhatsApp Business API</Text>
              </View>
              {showWhatsAppSettings ? (
                <ChevronUp size={20} color={Colors.light.tint} />
              ) : (
                <ChevronDown size={20} color={Colors.light.tint} />
              )}
            </TouchableOpacity>

            {showWhatsAppSettings && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>WhatsApp Business Configuration</Text>
                
                <Text style={styles.label}>Access Token *</Text>
                <TextInput
                  style={styles.input}
                  value={whatsappAccessToken}
                  onChangeText={setWhatsappAccessToken}
                  placeholder="Your WhatsApp Business API access token"
                  autoCapitalize="none"
                  multiline
                />

                <Text style={styles.label}>Phone Number ID *</Text>
                <TextInput
                  style={styles.input}
                  value={whatsappPhoneNumberId}
                  onChangeText={setWhatsappPhoneNumberId}
                  placeholder="e.g., 1790691781257415"
                  keyboardType="number-pad"
                />

                <Text style={styles.label}>Business Account ID</Text>
                <TextInput
                  style={styles.input}
                  value={whatsappBusinessId}
                  onChangeText={setWhatsappBusinessId}
                  placeholder="e.g., 895897253021976 (Optional)"
                  keyboardType="number-pad"
                />

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.testButton]}
                    onPress={testWhatsAppConnection}
                    disabled={testingWhatsApp}
                  >
                    {testingWhatsApp ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <Text style={styles.testButtonText}>Test Connection</Text>
                    )}
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.actionButton, styles.saveSettingsButton]}
                    onPress={saveCampaignSettings}
                  >
                    <Text style={styles.saveSettingsButtonText}>Save Settings</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>WhatsApp Message</Text>
              
              <Text style={styles.label}>Message *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={message}
                onChangeText={setMessage}
                placeholder="Your WhatsApp message..."
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{message.length} characters</Text>
            </View>
          </>
        )}

        <View style={styles.section}>
          <View style={styles.customerHeader}>
            <Text style={styles.sectionTitle}>
              Recipients ({selectedCustomers.length}/{eligibleCustomers.length})
            </Text>
            <TouchableOpacity
              style={styles.expandButton}
              onPress={() => setShowCustomerList(!showCustomerList)}
            >
              {showCustomerList ? (
                <ChevronUp size={20} color={Colors.light.tint} />
              ) : (
                <ChevronDown size={20} color={Colors.light.tint} />
              )}
            </TouchableOpacity>
          </View>

          {showCustomerList && (
            <>
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={`Search customers with ${campaignType === 'email' ? 'email' : 'phone'}...`}
              />

              <TouchableOpacity
                style={styles.selectAllButton}
                onPress={toggleSelectAll}
              >
                {selectedCustomerIds.size === eligibleCustomers.length ? (
                  <CheckSquare size={20} color={Colors.light.tint} />
                ) : (
                  <Square size={20} color={Colors.light.tabIconDefault} />
                )}
                <Text style={styles.selectAllText}>
                  {selectedCustomerIds.size === eligibleCustomers.length
                    ? 'Deselect All'
                    : 'Select All'}
                </Text>
              </TouchableOpacity>

              <ScrollView style={styles.customerList} nestedScrollEnabled>
                {eligibleCustomers.map((customer) => (
                  <TouchableOpacity
                    key={customer.id}
                    style={styles.customerItem}
                    onPress={() => toggleCustomer(customer.id)}
                  >
                    <View style={styles.customerInfo}>
                      <Text style={styles.customerName}>{customer.name}</Text>
                      <Text style={styles.customerContact}>
                        {campaignType === 'email' ? customer.email : customer.phone}
                      </Text>
                      {customer.company && (
                        <Text style={styles.customerCompany}>{customer.company}</Text>
                      )}
                    </View>
                    {selectedCustomerIds.has(customer.id) ? (
                      <CheckSquare size={24} color={Colors.light.tint} />
                    ) : (
                      <Square size={24} color={Colors.light.tabIconDefault} />
                    )}
                  </TouchableOpacity>
                ))}

                {eligibleCustomers.length === 0 && (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                      No customers with {campaignType === 'email' ? 'email addresses' : 'phone numbers'} found
                    </Text>
                  </View>
                )}
              </ScrollView>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
          onPress={handleSendCampaign}
          disabled={isSending || selectedCustomers.length === 0}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Send size={20} color="#FFFFFF" />
              <Text style={styles.sendButtonText}>
                Send to {selectedCustomers.length} Customer{selectedCustomers.length !== 1 ? 's' : ''}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <ConfirmDialog
        visible={confirmVisible}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onCancel={() => {
          console.log('[CAMPAIGN] User cancelled');
          setConfirmVisible(false);
        }}
        onConfirm={async () => {
          console.log('[CAMPAIGN] Confirm button pressed');
          try {
            await confirmState?.onConfirm?.();
          } finally {
            setConfirmVisible(false);
          }
        }}
        testID="campaign-confirm-dialog"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  typeSelector: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
    marginBottom: 20,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeButtonActive: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.secondary,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tabIconDefault,
  },
  typeButtonTextActive: {
    color: Colors.light.tint,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
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
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 14,
    color: Colors.light.text,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top' as const,
  },
  formatSelector: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  formatButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 2,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
  },
  formatButtonActive: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.secondary,
  },
  formatButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tabIconDefault,
  },
  formatButtonTextActive: {
    color: Colors.light.tint,
  },
  attachmentButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  attachmentButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  attachmentItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
    borderRadius: 6,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  attachmentInfo: {
    flex: 1,
    marginRight: 12,
  },
  attachmentName: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  attachmentSize: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  smsTestButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  smsTestButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  charCount: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    textAlign: 'right' as const,
    marginTop: 4,
  },
  customerHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  expandButton: {
    padding: 4,
  },
  searchInput: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 14,
    color: Colors.light.text,
    marginTop: 12,
  },
  selectAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  customerList: {
    maxHeight: 300,
    marginTop: 12,
  },
  customerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  customerInfo: {
    flex: 1,
    marginRight: 12,
  },
  customerName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginBottom: 2,
  },
  customerContact: {
    fontSize: 13,
    color: Colors.light.tint,
    marginBottom: 2,
  },
  customerCompany: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center' as const,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.tabIconDefault,
    textAlign: 'center' as const,
  },
  sendButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.tint,
    marginTop: 24,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  settingsToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  settingsToggleLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  settingsToggleText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 20,
  },
  buttonRow: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  testButton: {
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  testButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  saveSettingsButton: {
    backgroundColor: Colors.light.tint,
  },
  saveSettingsButtonText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
});
