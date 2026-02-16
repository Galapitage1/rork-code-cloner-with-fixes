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
  Image,
} from 'react-native';


import { Mail, MessageSquare, Send, ChevronDown, ChevronUp, X, CheckSquare, Square, Paperclip, Settings, Phone, Inbox, Image as ImageIcon, FileText, Video, Music } from 'lucide-react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCustomers } from '@/contexts/CustomerContext';
import { useAuth } from '@/contexts/AuthContext';
import Colors from '@/constants/colors';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
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
  const { currentUser } = useAuth();
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
  const [showSMSSettings, setShowSMSSettings] = useState(false);
  const [showWhatsAppInbox, setShowWhatsAppInbox] = useState(false);
  const [whatsappMessages, setWhatsappMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [whatsappMediaUri, setWhatsappMediaUri] = useState<string>('');
  const [whatsappMediaType, setWhatsappMediaType] = useState<'image' | 'video' | 'document' | 'audio'>('image');
  const [whatsappCaption, setWhatsappCaption] = useState<string>('');

  const loadCampaignSettings = async () => {
    try {
      console.log('[CAMPAIGNS] Loading campaign settings from AsyncStorage...');
      const settings = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        console.log('[CAMPAIGNS] Settings loaded:', { 
          hasSmtp: !!parsed.smtpHost, 
          hasWhatsApp: !!parsed.whatsappAccessToken,
          hasSms: !!parsed.smsApiKey 
        });
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
      } else {
        console.log('[CAMPAIGNS] No settings found in AsyncStorage, using defaults');
      }
    } catch (error) {
      console.error('[CAMPAIGNS] Failed to load campaign settings:', error);
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
        hasWhatsApp: !!whatsappAccessToken,
        smtpPort,
        imapPort 
      });
      
      await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(settings));
      console.log('[CAMPAIGNS] Settings saved to AsyncStorage successfully');
      console.log('[CAMPAIGNS] Saved WhatsApp credentials:', {
        tokenLength: whatsappAccessToken?.length || 0,
        phoneId: whatsappPhoneNumberId
      });
      
      Alert.alert('Success', 'Settings saved successfully');
    } catch (error) {
      console.error('[CAMPAIGNS] Failed to save campaign settings:', error);
      Alert.alert('Error', 'Failed to save settings');
    }
  };

  React.useEffect(() => {
    console.log('[CAMPAIGNS] Component mounted, loading settings...');
    loadCampaignSettings().finally(() => {
      console.log('[CAMPAIGNS] Settings loaded, page ready');
      setIsPageLoading(false);
    });
  }, []);

  React.useEffect(() => {
    if (currentUser) {
      console.log('[CAMPAIGNS] User changed, reloading settings for:', currentUser.username);
      loadCampaignSettings().then(() => {
        console.log('[CAMPAIGNS] Settings reloaded after user change');
      });
    }
  }, [currentUser]);

  React.useEffect(() => {
    console.log('[CAMPAIGNS] WhatsApp credentials updated:', {
      hasToken: !!whatsappAccessToken,
      hasPhoneId: !!whatsappPhoneNumberId,
      tokenLength: whatsappAccessToken?.length || 0
    });
  }, [whatsappAccessToken, whatsappPhoneNumberId]);

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

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/test-email-connection.php` : `${apiUrl}/api/test-email-connection`;
      const response = await fetch(phpEndpoint, {
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
    if (!smsApiUrl || !smsApiKey) {
      Alert.alert('Configuration Missing', 'Please configure SMS API URL and API Key before testing.');
      return;
    }

    try {
      setTestingSMS(true);
      console.log('[SMS Test] Starting connection test...');

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/test-sms-connection.php` : `${apiUrl}/api/test-sms-connection`;
      console.log('[SMS Test] Using API URL:', apiUrl);
      console.log('[SMS Test] Full endpoint:', phpEndpoint);

      const response = await fetch(phpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          smsApiUrl,
          smsApiKey,
        }),
      });

      const result = await response.json();
      console.log('[SMS Test] Response:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Connection test failed');
      }

      Alert.alert('Connection Test Successful', result.message || 'SMS API is configured correctly');
    } catch (error) {
      console.error('[SMS Test] Error:', error);
      const errorMsg = (error as Error).message;
      const currentApiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = currentApiUrl.includes('tracker.tecclk.com') ? `${currentApiUrl}/Tracker/api/test-sms-connection.php` : `${currentApiUrl}/api/test-sms-connection`;
      
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('Network request failed')) {
        Alert.alert(
          'Backend Connection Error',
          `Cannot connect to: ${phpEndpoint}\n\nError: ${errorMsg}\n\nMake sure the backend is deployed and accessible.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Connection Test Failed', `${errorMsg}\n\nAPI: ${currentApiUrl}`);
      }
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
    if (!message.trim() && !whatsappMediaUri) {
      return 'Please enter a message or attach media';
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
          const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
          const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-email.php` : `${apiUrl}/api/send-email`;
          const response = await fetch(phpEndpoint, {
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

    if (!smsApiUrl || !smsApiKey) {
      Alert.alert(
        'SMS Not Configured',
        'Please configure SMS API settings before sending messages.',
        [{ text: 'OK' }]
      );
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

          const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
          const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-sms.php` : `${apiUrl}/api/send-sms`;
          
          const response = await fetch(phpEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: message,
              recipients: selectedCustomers.map(c => ({
                name: c.name,
                phone: c.phone,
              })),
              transaction_id: Date.now(),
            }),
          });

          const result = await response.json();
          console.log('[SMS CAMPAIGN] Backend response:', result);

          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to send SMS messages');
          }

          const { results } = result;
          const resultMessage = `Sent: ${results.success}\nFailed: ${results.failed}${
            results.errors.length > 0 ? '\n\nErrors:\n' + results.errors.slice(0, 5).join('\n') : ''
          }`;

          Alert.alert(
            'SMS Campaign Complete',
            resultMessage,
            [{ text: 'OK' }]
          );

          if (results.success > 0) {
            setMessage('');
            setSelectedCustomerIds(new Set());
          }

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

  const loadWhatsAppMessages = async () => {
    console.log('[WhatsApp Inbox] === loadWhatsAppMessages called ===');
    console.log('[WhatsApp Inbox] Current loadingMessages state:', loadingMessages);
    console.log('[WhatsApp Inbox] Current messages count:', whatsappMessages.length);
    
    try {
      setLoadingMessages(true);
      console.log('[WhatsApp Inbox] Loading messages...');

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/get-whatsapp-messages.php` : `${apiUrl}/api/get-whatsapp-messages`;
      
      console.log('[WhatsApp Inbox] API URL:', apiUrl);
      console.log('[WhatsApp Inbox] Fetching from:', phpEndpoint);
      console.log('[WhatsApp Inbox] Starting fetch request...');
      
      const response = await fetch(phpEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('[WhatsApp Inbox] Fetch completed');
      console.log('[WhatsApp Inbox] Response status:', response.status);
      console.log('[WhatsApp Inbox] Response ok:', response.ok);
      console.log('[WhatsApp Inbox] Response headers:', response.headers);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[WhatsApp Inbox] Error response body:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }
      
      const result = await response.json();
      console.log('[WhatsApp Inbox] Response data:', JSON.stringify(result, null, 2));

      if (!result.success) {
        throw new Error(result.error || 'Failed to load messages');
      }

      const messages = result.messages || [];
      console.log('[WhatsApp Inbox] Messages count:', messages.length);
      console.log('[WhatsApp Inbox] Messages array:', JSON.stringify(messages, null, 2));
      
      setWhatsappMessages(messages);
      console.log('[WhatsApp Inbox] State updated with', messages.length, 'messages');
      
      if (messages.length === 0) {
        console.log('[WhatsApp Inbox] No messages found. Webhook messages are stored in: public/Tracker/data/whatsapp-messages.json');
        Alert.alert('Info', 'No messages received yet. Messages from WhatsApp webhook will appear here.');
      } else {
        Alert.alert('Success', `Loaded ${messages.length} message(s)`);
      }
    } catch (error) {
      console.error('[WhatsApp Inbox] Error caught:', error);
      console.error('[WhatsApp Inbox] Error message:', (error as Error).message);
      console.error('[WhatsApp Inbox] Error stack:', (error as Error).stack);
      Alert.alert('Error', 'Failed to load WhatsApp messages: ' + (error as Error).message);
    } finally {
      setLoadingMessages(false);
      console.log('[WhatsApp Inbox] Loading complete, loadingMessages set to false');
    }
  };

  const testWhatsAppConnection = async () => {
    try {
      setTestingWhatsApp(true);
      console.log('[WhatsApp Test] Starting connection test...');

      if (!whatsappAccessToken || !whatsappPhoneNumberId) {
        Alert.alert('Configuration Missing', 'Please configure WhatsApp settings before testing.');
        return;
      }

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/test-whatsapp-connection.php` : `${apiUrl}/api/test-whatsapp-connection`;
      console.log('[WhatsApp Test] Using API URL:', apiUrl);
      console.log('[WhatsApp Test] Full endpoint:', phpEndpoint);
      console.log('[WhatsApp Test] Phone Number ID:', whatsappPhoneNumberId);
      
      const response = await fetch(phpEndpoint, {
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
      console.error('[WhatsApp Test] Error stack:', (error as Error).stack);
      const errorMsg = (error as Error).message;
      const currentApiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      
      const phpEndpoint = currentApiUrl.includes('tracker.tecclk.com') ? `${currentApiUrl}/Tracker/api/test-whatsapp-connection.php` : `${currentApiUrl}/api/test-whatsapp-connection`;
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('Network request failed')) {
        Alert.alert(
          'Backend Connection Error',
          `Cannot connect to: ${phpEndpoint}\n\nError: ${errorMsg}\n\nMake sure the backend is deployed and accessible.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Connection Test Failed', `${errorMsg}\n\nAPI: ${currentApiUrl}`);
      }
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

    console.log('[WhatsApp CAMPAIGN] Checking credentials before send...');
    console.log('[WhatsApp CAMPAIGN] Current credentials:', {
      hasToken: !!whatsappAccessToken,
      hasPhoneId: !!whatsappPhoneNumberId,
      tokenLength: whatsappAccessToken?.length || 0,
      phoneId: whatsappPhoneNumberId
    });

    if (!whatsappAccessToken || !whatsappPhoneNumberId) {
      console.log('[WhatsApp CAMPAIGN] Missing credentials, reloading from storage...');
      await loadCampaignSettings();
      
      if (!whatsappAccessToken || !whatsappPhoneNumberId) {
        Alert.alert(
          'WhatsApp Not Configured',
          'Please configure WhatsApp Business API settings before sending messages.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    console.log('[WhatsApp CAMPAIGN] Opening confirm dialog...');
    setConfirmState({
      title: 'Send WhatsApp Campaign',
      message: `Send WhatsApp message to ${selectedCustomers.length} customer(s)?`,
      onConfirm: async () => {
        console.log('[WhatsApp CAMPAIGN] User confirmed, starting send...');
        console.log('[WhatsApp CAMPAIGN] Using credentials:', {
          hasToken: !!whatsappAccessToken,
          hasPhoneId: !!whatsappPhoneNumberId,
          tokenLength: whatsappAccessToken?.length || 0
        });
        try {
          setIsSending(true);

          const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
          
          let publicMediaUrl = '';
          if (whatsappMediaUri) {
            console.log('[WhatsApp CAMPAIGN] Uploading media file first...');
            const uploadEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/upload-media.php` : `${apiUrl}/api/upload-media`;
            
            const formData = new FormData();
            
            if (Platform.OS === 'web') {
              const response = await fetch(whatsappMediaUri);
              const blob = await response.blob();
              const filename = whatsappMediaUri.split('/').pop() || 'media.jpg';
              formData.append('file', blob, filename);
            } else {
              const filename = whatsappMediaUri.split('/').pop() || 'media.jpg';
              const fileType = whatsappMediaType === 'image' ? 'image/jpeg' : 
                              whatsappMediaType === 'video' ? 'video/mp4' : 
                              whatsappMediaType === 'audio' ? 'audio/mpeg' : 
                              'application/pdf';
              
              formData.append('file', {
                uri: whatsappMediaUri,
                name: filename,
                type: fileType,
              } as any);
            }
            
            const uploadResponse = await fetch(uploadEndpoint, {
              method: 'POST',
              body: formData,
            });
            
            const uploadResult = await uploadResponse.json();
            console.log('[WhatsApp CAMPAIGN] Upload response:', uploadResult);
            
            if (!uploadResponse.ok || !uploadResult.success) {
              throw new Error(uploadResult.error || 'Failed to upload media');
            }
            
            publicMediaUrl = uploadResult.url;
            console.log('[WhatsApp CAMPAIGN] Media uploaded to:', publicMediaUrl);
          }
          
          const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-whatsapp.php` : `${apiUrl}/api/send-whatsapp`;
          console.log('[WhatsApp CAMPAIGN] Sending to:', phpEndpoint);
          console.log('[WhatsApp CAMPAIGN] Sending messages in parallel batches...');
          
          let successCount = 0;
          let failCount = 0;
          const errors: string[] = [];
          const successfulCustomerIds: string[] = [];
          
          const BATCH_SIZE = 10;
          const sendMessage = async (customer: typeof selectedCustomers[0]) => {
            try {
              console.log(`[WhatsApp CAMPAIGN] Sending to ${customer.name} (${customer.phone})...`);
              
              const response = await fetch(phpEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  accessToken: whatsappAccessToken,
                  phoneNumberId: whatsappPhoneNumberId,
                  message: publicMediaUrl ? whatsappCaption : message,
                  mediaUrl: publicMediaUrl,
                  mediaType: whatsappMediaType,
                  caption: whatsappCaption,
                  recipients: [{
                    name: customer.name,
                    phone: customer.phone,
                  }],
                }),
              });

              const responseText = await response.text();
              
              let result;
              try {
                result = JSON.parse(responseText);
              } catch (parseError) {
                console.error(`[WhatsApp CAMPAIGN] Failed to parse response for ${customer.name}:`, parseError);
                throw new Error('Invalid server response');
              }

              if (response.ok && result.success && result.results?.success > 0) {
                console.log(`[WhatsApp CAMPAIGN] Successfully sent to ${customer.name}`);
                return { success: true, customerId: customer.id };
              } else {
                const detailedError = result.error || result.results?.errors?.[0] || 'Unknown error';
                console.error(`[WhatsApp CAMPAIGN] Failed to send to ${customer.name}:`, detailedError);
                return { success: false, error: `${customer.name}: ${detailedError}` };
              }
            } catch (error) {
              console.error(`[WhatsApp CAMPAIGN] Error sending to ${customer.name}:`, error);
              return { success: false, error: `${customer.name}: ${(error as Error).message}` };
            }
          };
          
          for (let i = 0; i < selectedCustomers.length; i += BATCH_SIZE) {
            const batch = selectedCustomers.slice(i, i + BATCH_SIZE);
            console.log(`[WhatsApp CAMPAIGN] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(selectedCustomers.length / BATCH_SIZE)}`);
            
            const results = await Promise.all(batch.map(sendMessage));
            
            results.forEach(result => {
              if (result.success) {
                successCount++;
                if (result.customerId) {
                  successfulCustomerIds.push(result.customerId);
                }
              } else {
                failCount++;
                if (result.error) {
                  errors.push(result.error);
                }
              }
            });
            
            if (successfulCustomerIds.length > 0) {
              setSelectedCustomerIds(prev => {
                const newSet = new Set(prev);
                successfulCustomerIds.forEach(id => newSet.delete(id));
                return newSet;
              });
              successfulCustomerIds.length = 0;
            }
          }

          const resultMessage = `Accepted by WhatsApp API: ${successCount}\nFailed: ${failCount}${
            errors.length > 0 ? '\n\nErrors:\n' + errors.slice(0, 5).join('\n') : ''
          }\n\nNote: "Accepted" means WhatsApp queued it. Final delivery depends on recipient status, policy window, and webhook delivery events.`;

          Alert.alert(
            'WhatsApp Campaign Complete',
            resultMessage,
            [{ text: 'OK' }]
          );

          if (successCount > 0) {
            setMessage('');
            setWhatsappMediaUri('');
            setWhatsappCaption('');
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
          <>
            <TouchableOpacity
              style={styles.settingsToggle}
              onPress={() => setShowSMSSettings(!showSMSSettings)}
            >
              <View style={styles.settingsToggleLeft}>
                <Settings size={20} color={Colors.light.tint} />
                <Text style={styles.settingsToggleText}>SMS Configuration</Text>
              </View>
              {showSMSSettings ? (
                <ChevronUp size={20} color={Colors.light.tint} />
              ) : (
                <ChevronDown size={20} color={Colors.light.tint} />
              )}
            </TouchableOpacity>

            {showSMSSettings && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SMS Service Configuration</Text>
                
                <Text style={styles.label}>SMS API URL *</Text>
                <TextInput
                  style={styles.input}
                  value={smsApiUrl}
                  onChangeText={setSmsApiUrl}
                  placeholder="https://app.notify.lk/api/v1/send"
                  autoCapitalize="none"
                  keyboardType="url"
                />

                <Text style={styles.label}>SMS API Key *</Text>
                <TextInput
                  style={styles.input}
                  value={smsApiKey}
                  onChangeText={setSmsApiKey}
                  placeholder="Your SMS service API key"
                  autoCapitalize="none"
                  multiline
                />

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.testButton]}
                    onPress={testSMSConnection}
                    disabled={testingSMS}
                  >
                    {testingSMS ? (
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
              <Text style={styles.sectionTitle}>SMS Message</Text>
              
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
          </>
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

                <TouchableOpacity
                  style={styles.inboxToggle}
                  onPress={() => {
                    const newState = !showWhatsAppInbox;
                    console.log('[WhatsApp Inbox] Toggling inbox:', newState);
                    setShowWhatsAppInbox(newState);
                    if (newState) {
                      console.log('[WhatsApp Inbox] Loading messages on toggle...');
                      loadWhatsAppMessages();
                    }
                  }}
                >
                  <View style={styles.settingsToggleLeft}>
                    <Inbox size={20} color={Colors.light.tint} />
                    <Text style={styles.settingsToggleText}>WhatsApp Inbox ({whatsappMessages.length})</Text>
                  </View>
                  {showWhatsAppInbox ? (
                    <ChevronUp size={20} color={Colors.light.tint} />
                  ) : (
                    <ChevronDown size={20} color={Colors.light.tint} />
                  )}
                </TouchableOpacity>

                {showWhatsAppInbox && (
                  <View style={styles.inboxContainer}>
                    <View style={styles.inboxHeader}>
                      <Text style={styles.inboxTitle}>Received Messages</Text>
                      <TouchableOpacity
                        style={styles.refreshButton}
                        onPress={() => {
                          console.log('[WhatsApp Inbox] Refresh button pressed');
                          loadWhatsAppMessages();
                        }}
                        disabled={loadingMessages}
                      >
                        {loadingMessages ? (
                          <ActivityIndicator size="small" color={Colors.light.tint} />
                        ) : (
                          <Text style={styles.refreshButtonText}>Refresh</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {whatsappMessages.length === 0 && !loadingMessages && (
                      <View style={styles.emptyInbox}>
                        <Inbox size={48} color={Colors.light.tabIconDefault} />
                        <Text style={styles.emptyInboxText}>No messages received yet</Text>
                        <Text style={styles.emptyInboxSubtext}>
                          Messages received via WhatsApp webhook will appear here
                        </Text>
                      </View>
                    )}

                    {whatsappMessages.length > 0 && (
                      <View style={styles.messageListContainer}>
                        {whatsappMessages.map((msg, index) => (
                          <View key={msg.id || index} style={styles.messageItem}>
                            <View style={styles.messageHeader}>
                              <Text style={styles.messageSender}>{msg.fromName || msg.from}</Text>
                              <Text style={styles.messageTime}>
                                {new Date(msg.timestamp * 1000).toLocaleString()}
                              </Text>
                            </View>
                            <Text style={styles.messagePhone}>{msg.from}</Text>
                            {msg.type === 'text' && msg.text && (
                              <Text style={styles.messageText}>{msg.text}</Text>
                            )}
                            {msg.type !== 'text' && (
                              <Text style={styles.messageTypeLabel}>Type: {msg.type}</Text>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>WhatsApp Message</Text>
              
              <View style={styles.mediaSection}>
                <Text style={styles.label}>Media Attachment (Optional)</Text>
                
                {whatsappMediaUri ? (
                  <View style={styles.mediaPreviewContainer}>
                    {whatsappMediaType === 'image' && (
                      <Image 
                        source={{ uri: whatsappMediaUri }} 
                        style={styles.mediaPreview}
                        resizeMode="cover"
                      />
                    )}
                    {whatsappMediaType === 'video' && (
                      <View style={styles.mediaPlaceholder}>
                        <Video size={48} color={Colors.light.tint} />
                        <Text style={styles.mediaPlaceholderText}>Video attached</Text>
                      </View>
                    )}
                    {whatsappMediaType === 'document' && (
                      <View style={styles.mediaPlaceholder}>
                        <FileText size={48} color={Colors.light.tint} />
                        <Text style={styles.mediaPlaceholderText}>Document attached</Text>
                      </View>
                    )}
                    {whatsappMediaType === 'audio' && (
                      <View style={styles.mediaPlaceholder}>
                        <Music size={48} color={Colors.light.tint} />
                        <Text style={styles.mediaPlaceholderText}>Audio attached</Text>
                      </View>
                    )}
                    <TouchableOpacity 
                      style={styles.removeMediaButton}
                      onPress={() => {
                        setWhatsappMediaUri('');
                        setWhatsappCaption('');
                      }}
                    >
                      <X size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.mediaButtonsRow}>
                    <TouchableOpacity
                      style={styles.mediaButton}
                      onPress={async () => {
                        try {
                          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                          if (status !== 'granted') {
                            Alert.alert('Permission Required', 'Please grant media library permissions');
                            return;
                          }
                          
                          const result = await ImagePicker.launchImageLibraryAsync({
                            mediaTypes: ImagePicker.MediaTypeOptions.Images,
                            allowsEditing: true,
                            quality: 0.8,
                          });
                          
                          if (!result.canceled && result.assets[0]) {
                            setWhatsappMediaUri(result.assets[0].uri);
                            setWhatsappMediaType('image');
                          }
                        } catch {
                          Alert.alert('Error', 'Failed to pick image');
                        }
                      }}
                    >
                      <ImageIcon size={24} color={Colors.light.tint} />
                      <Text style={styles.mediaButtonText}>Image</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.mediaButton}
                      onPress={async () => {
                        try {
                          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                          if (status !== 'granted') {
                            Alert.alert('Permission Required', 'Please grant media library permissions');
                            return;
                          }
                          
                          const result = await ImagePicker.launchImageLibraryAsync({
                            mediaTypes: ImagePicker.MediaTypeOptions.Videos,
                            allowsEditing: false,
                            quality: 0.8,
                          });
                          
                          if (!result.canceled && result.assets[0]) {
                            setWhatsappMediaUri(result.assets[0].uri);
                            setWhatsappMediaType('video');
                          }
                        } catch {
                          Alert.alert('Error', 'Failed to pick video');
                        }
                      }}
                    >
                      <Video size={24} color={Colors.light.tint} />
                      <Text style={styles.mediaButtonText}>Video</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.mediaButton}
                      onPress={async () => {
                        try {
                          const result = await DocumentPicker.getDocumentAsync({
                            type: '*/*',
                            copyToCacheDirectory: true,
                          });
                          
                          if (result.assets && result.assets[0]) {
                            setWhatsappMediaUri(result.assets[0].uri);
                            const mimeType = result.assets[0].mimeType || '';
                            if (mimeType.startsWith('audio/')) {
                              setWhatsappMediaType('audio');
                            } else {
                              setWhatsappMediaType('document');
                            }
                          }
                        } catch {
                          Alert.alert('Error', 'Failed to pick document');
                        }
                      }}
                    >
                      <FileText size={24} color={Colors.light.tint} />
                      <Text style={styles.mediaButtonText}>File</Text>
                    </TouchableOpacity>
                  </View>
                )}
                
                {whatsappMediaUri && (
                  <View>
                    <Text style={styles.label}>Caption</Text>
                    <TextInput
                      style={[styles.input, styles.captionInput]}
                      value={whatsappCaption}
                      onChangeText={setWhatsappCaption}
                      placeholder="Add a caption for your media..."
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                  </View>
                )}
                
                <View style={styles.mediaTip}>
                  <Text style={styles.mediaTipText}>
                    💡 Tip: Media URLs must be publicly accessible. Supported: Images (JPG, PNG), Videos (MP4), Documents (PDF, etc.)
                  </Text>
                </View>
              </View>
              
              {!whatsappMediaUri && (
                <>
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
                </>
              )}
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
  infoBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  infoText: {
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  inboxToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  inboxContainer: {
    marginTop: 16,
    backgroundColor: Colors.light.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 16,
  },
  inboxHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 16,
  },
  inboxTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  messageList: {
    maxHeight: 400,
  },
  emptyInbox: {
    paddingVertical: 40,
    alignItems: 'center' as const,
  },
  emptyInboxText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 12,
  },
  emptyInboxSubtext: {
    fontSize: 13,
    color: Colors.light.tabIconDefault,
    marginTop: 4,
    textAlign: 'center' as const,
  },
  messageItem: {
    backgroundColor: Colors.light.background,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  messageHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  messageSender: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.light.text,
    flex: 1,
  },
  messageTime: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  messagePhone: {
    fontSize: 13,
    color: Colors.light.tint,
    marginBottom: 8,
  },
  messageText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
  },
  messageTypeLabel: {
    fontSize: 13,
    color: Colors.light.tabIconDefault,
    fontStyle: 'italic' as const,
  },
  messageListContainer: {
    gap: 8,
  },
  mediaSection: {
    marginVertical: 12,
  },
  mediaButtonsRow: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 8,
  },
  mediaButton: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 16,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    gap: 6,
  },
  mediaButtonText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.tint,
  },
  mediaPreviewContainer: {
    position: 'relative' as const,
    marginTop: 8,
    marginBottom: 12,
  },
  mediaPreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
  },
  mediaPlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  mediaPlaceholderText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.light.tint,
  },
  removeMediaButton: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  captionInput: {
    minHeight: 80,
  },
  mediaTip: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  mediaTipText: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 18,
  },
});
