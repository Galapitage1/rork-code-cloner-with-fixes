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
  Modal,
  Linking,
} from 'react-native';


import { Mail, MessageSquare, Send, ChevronDown, ChevronUp, X, CheckSquare, Square, Paperclip, Settings, Phone, Inbox, Image as ImageIcon, FileText, Video, Music } from 'lucide-react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCustomers } from '@/contexts/CustomerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSMSCampaign } from '@/contexts/SMSCampaignContext';
import { Picker } from '@react-native-picker/picker';
import Colors from '@/constants/colors';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFromServer, saveDeltaToServer } from '@/utils/directSync';


type CampaignType = 'email' | 'sms' | 'whatsapp';
type EmailFormat = 'text' | 'html';

interface Attachment {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

const CAMPAIGN_SETTINGS_KEY = '@campaign_settings';
const FAILED_SMS_BATCH_QUEUE_KEY = '@sms_failed_batch_queue';
const EMAIL_CAMPAIGN_REMAINING_KEY = '@email_campaign_remaining';
const EMAIL_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
const DIALOG_ESMS_PORTAL_URL = 'https://e-sms.dialog.lk/';

type FailedSMSBatchJob = {
  id: string;
  provider: 'dialog' | 'legacy';
  message: string;
  recipients: Array<{ name?: string; phone: string }>;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string;
};

type EmailCampaignRecipient = {
  id: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
};

type NewsletterTextBlock = {
  id: string;
  type: 'text';
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
};

type NewsletterImageBlock = {
  id: string;
  type: 'image';
  imageUrl: string;
  caption: string;
  widthPercent: number;
  heightPx: number;
};

type NewsletterBlock = NewsletterTextBlock | NewsletterImageBlock;

type PendingEmailCampaign = {
  id: string;
  createdAt: number;
  updatedAt: number;
  senderName: string;
  senderEmail: string;
  replyToEmail: string;
  replyToName: string;
  subject: string;
  message: string;
  htmlContent: string;
  format: EmailFormat;
  attachments: Attachment[];
  maxPerWindow: number;
  waitUntil: number | null;
  lastSuccessAt: number | null;
  recipients: EmailCampaignRecipient[];
};

type ServerQueuedEmailRecipient = {
  id: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
};

type ServerQueuedEmailJob = {
  id: string;
  campaignKey: string;
  waitUntil: number;
  maxPerWindow: number;
  batchDelayMs: number;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number;
  lastRunSuccess: number;
  lastRunFailed: number;
  lastRunAttempted: number;
  remainingRecipients: number;
  due: boolean;
  recipients: ServerQueuedEmailRecipient[];
  recipientsPreviewTruncated: boolean;
};

export default function CampaignsScreen() {
  const { customers } = useCustomers();
  const { currentUser } = useAuth();
  const {
    settings: dialogSMSSettings,
    campaigns: smsCampaigns,
    sendCampaign: sendDialogSMSCampaign,
    testLogin: testDialogSMSLogin,
  } = useSMSCampaign();
  const [isPageLoading, setIsPageLoading] = React.useState(true);
  
  const [campaignType, setCampaignType] = useState<CampaignType>('email');
  const [emailFormat, setEmailFormat] = useState<EmailFormat>('text');
  
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [emailNoReplyMode, setEmailNoReplyMode] = useState(false);
  const [emailBatchSize, setEmailBatchSize] = useState<string>('25');
  const [emailBatchDelayMs, setEmailBatchDelayMs] = useState<string>('1500');
  const [emailDailyLimitEnabled, setEmailDailyLimitEnabled] = useState(false);
  const [emailDailyLimitMax, setEmailDailyLimitMax] = useState<string>('500');
  
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  
  const [isSending, setIsSending] = useState(false);
  const [testingSMS, setTestingSMS] = useState(false);
  const [loadingDialogCredit, setLoadingDialogCredit] = useState(false);
  const [dialogCreditRemaining, setDialogCreditRemaining] = useState<number | string | null>(null);
  const [dialogCreditSource, setDialogCreditSource] = useState<'live' | 'last_known' | null>(null);
  const [dialogCreditError, setDialogCreditError] = useState<string>('');
  const [dialogCreditUpdatedAt, setDialogCreditUpdatedAt] = useState<number | null>(null);
  const [loadingFailedSmsBatches, setLoadingFailedSmsBatches] = useState(false);
  const [retryingFailedSmsBatches, setRetryingFailedSmsBatches] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [failedSmsBatches, setFailedSmsBatches] = useState<FailedSMSBatchJob[]>([]);
  const [pendingEmailCampaign, setPendingEmailCampaign] = useState<PendingEmailCampaign | null>(null);
  const [emailWindowNow, setEmailWindowNow] = useState<number>(Date.now());
  const [loadingServerEmailQueue, setLoadingServerEmailQueue] = useState(false);
  const [serverEmailQueueJobs, setServerEmailQueueJobs] = useState<ServerQueuedEmailJob[]>([]);
  const [serverEmailQueueLength, setServerEmailQueueLength] = useState(0);
  const [serverEmailQueueDueJobs, setServerEmailQueueDueJobs] = useState(0);
  const [showAdvancedSettingsModal, setShowAdvancedSettingsModal] = useState(false);
  const [useNewsletterBuilder, setUseNewsletterBuilder] = useState(false);
  const [newsletterBlocks, setNewsletterBlocks] = useState<NewsletterBlock[]>([
    {
      id: 'newsletter-text-initial',
      type: 'text',
      content: 'Write your headline or story here',
      fontFamily: 'Arial, sans-serif',
      fontSize: 20,
      color: '#111111',
    },
  ]);
  
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
  const [sendingWhatsAppTest, setSendingWhatsAppTest] = useState(false);
  const [showWhatsAppInbox, setShowWhatsAppInbox] = useState(false);
  const [whatsappMessages, setWhatsappMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showWhatsAppStatusEvents, setShowWhatsAppStatusEvents] = useState(false);
  const [whatsappStatusEvents, setWhatsappStatusEvents] = useState<any[]>([]);
  const [loadingStatusEvents, setLoadingStatusEvents] = useState(false);
  const [whatsappMediaUri, setWhatsappMediaUri] = useState<string>('');
  const [whatsappMediaType, setWhatsappMediaType] = useState<'image' | 'video' | 'document' | 'audio'>('image');
  const [whatsappCaption, setWhatsappCaption] = useState<string>('');
  const [whatsappTestPhone, setWhatsappTestPhone] = useState<string>('');
  const [whatsappTestMessage, setWhatsappTestMessage] = useState<string>('Hello from The Cakery test message.');
  const [whatsappTestUseTemplate, setWhatsappTestUseTemplate] = useState<boolean>(false);
  const [whatsappTestTemplateName, setWhatsappTestTemplateName] = useState<string>('');
  const [whatsappTestTemplateLanguage, setWhatsappTestTemplateLanguage] = useState<string>('en_US');
  const [whatsappTestTemplateParamsText, setWhatsappTestTemplateParamsText] = useState<string>('');
  const [whatsappTestTemplateHeaderParamsText, setWhatsappTestTemplateHeaderParamsText] = useState<string>('');
  const [whatsappTestTemplateHeaderMediaUrl, setWhatsappTestTemplateHeaderMediaUrl] = useState<string>('');
  const [whatsappTestTemplateHeaderMediaType, setWhatsappTestTemplateHeaderMediaType] = useState<'image' | 'video' | 'document'>('image');
  const [whatsappTestTemplateButtonParamsText, setWhatsappTestTemplateButtonParamsText] = useState<string>('');
  const [whatsappCampaignUseTemplate, setWhatsappCampaignUseTemplate] = useState<boolean>(true);
  const [whatsappLinkCampaignTemplateToTest, setWhatsappLinkCampaignTemplateToTest] = useState<boolean>(true);
  const [whatsappCampaignTemplateName, setWhatsappCampaignTemplateName] = useState<string>('');
  const [whatsappCampaignTemplateLanguage, setWhatsappCampaignTemplateLanguage] = useState<string>('en_US');
  const [whatsappCampaignTemplateParamsText, setWhatsappCampaignTemplateParamsText] = useState<string>('');
  const [whatsappCampaignTemplateHeaderParamsText, setWhatsappCampaignTemplateHeaderParamsText] = useState<string>('');
  const [whatsappCampaignTemplateHeaderMediaUrl, setWhatsappCampaignTemplateHeaderMediaUrl] = useState<string>('');
  const [whatsappCampaignTemplateHeaderMediaType, setWhatsappCampaignTemplateHeaderMediaType] = useState<'image' | 'video' | 'document'>('image');
  const [whatsappCampaignTemplateButtonParamsText, setWhatsappCampaignTemplateButtonParamsText] = useState<string>('');

  const lastKnownDialogBalance = React.useMemo(() => {
    const withBalance = [...smsCampaigns]
      .filter((campaign) => campaign.wallet_balance !== null && campaign.wallet_balance !== undefined && String(campaign.wallet_balance).trim() !== '')
      .sort((a, b) => {
        const timeA = a.updatedAt || a.createdAt || 0;
        const timeB = b.updatedAt || b.createdAt || 0;
        return timeB - timeA;
      });

    if (withBalance.length === 0) {
      return null;
    }

    const latest = withBalance[0];
    return {
      value: latest.wallet_balance as number | string,
      timestamp: latest.updatedAt || latest.createdAt || Date.now(),
    };
  }, [smsCampaigns]);

  const applyCampaignSettings = (parsed: any) => {
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
    setWhatsappTestUseTemplate(!!parsed.whatsappTestUseTemplate);
    setWhatsappTestTemplateName(parsed.whatsappTestTemplateName || '');
    setWhatsappTestTemplateLanguage(parsed.whatsappTestTemplateLanguage || 'en_US');
    setWhatsappTestTemplateParamsText(parsed.whatsappTestTemplateParamsText || '');
    setWhatsappTestTemplateHeaderParamsText(parsed.whatsappTestTemplateHeaderParamsText || '');
    setWhatsappTestTemplateHeaderMediaUrl(parsed.whatsappTestTemplateHeaderMediaUrl || '');
    setWhatsappTestTemplateHeaderMediaType((parsed.whatsappTestTemplateHeaderMediaType as 'image' | 'video' | 'document') || 'image');
    setWhatsappTestTemplateButtonParamsText(parsed.whatsappTestTemplateButtonParamsText || '');
    setWhatsappCampaignUseTemplate(parsed.whatsappCampaignUseTemplate !== false);
    setWhatsappLinkCampaignTemplateToTest(parsed.whatsappLinkCampaignTemplateToTest !== false);
    setWhatsappCampaignTemplateName(parsed.whatsappCampaignTemplateName || '');
    setWhatsappCampaignTemplateLanguage(parsed.whatsappCampaignTemplateLanguage || 'en_US');
    setWhatsappCampaignTemplateParamsText(parsed.whatsappCampaignTemplateParamsText || '');
    setWhatsappCampaignTemplateHeaderParamsText(parsed.whatsappCampaignTemplateHeaderParamsText || '');
    setWhatsappCampaignTemplateHeaderMediaUrl(parsed.whatsappCampaignTemplateHeaderMediaUrl || '');
    setWhatsappCampaignTemplateHeaderMediaType((parsed.whatsappCampaignTemplateHeaderMediaType as 'image' | 'video' | 'document') || 'image');
    setWhatsappCampaignTemplateButtonParamsText(parsed.whatsappCampaignTemplateButtonParamsText || '');
    setEmailNoReplyMode(!!parsed.emailNoReplyMode);
    setEmailBatchSize(String(parsed.emailBatchSize ?? '25'));
    setEmailBatchDelayMs(String(parsed.emailBatchDelayMs ?? '1500'));
    setEmailDailyLimitEnabled(!!parsed.emailDailyLimitEnabled);
    setEmailDailyLimitMax(String(parsed.emailDailyLimitMax ?? '500'));
    setSenderEmail(parsed.senderEmail || '');
    setSenderName(parsed.senderName || '');
  };

  const loadCampaignSettings = async () => {
    try {
      console.log('[CAMPAIGNS] Loading campaign settings from AsyncStorage + server...');
      let activeSettings: any | null = null;

      const localSettingsRaw = await AsyncStorage.getItem(CAMPAIGN_SETTINGS_KEY);
      if (localSettingsRaw) {
        const localParsed = JSON.parse(localSettingsRaw);
        activeSettings = localParsed;
        applyCampaignSettings(localParsed);
      }

      if (currentUser) {
        try {
          const remoteRecords = await getFromServer<any>({
            userId: currentUser.id,
            dataType: 'campaign_settings',
            includeDeleted: true,
            minDays: 3650,
          });
          const latestRemote = remoteRecords
            .filter((item: any) => item && item.deleted !== true)
            .sort((a: any, b: any) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];

          if (latestRemote) {
            const localUpdatedAt = Number(activeSettings?.updatedAt) || 0;
            const remoteUpdatedAt = Number(latestRemote.updatedAt) || 0;
            if (!activeSettings || remoteUpdatedAt >= localUpdatedAt) {
              activeSettings = latestRemote;
              applyCampaignSettings(latestRemote);
              await AsyncStorage.setItem(CAMPAIGN_SETTINGS_KEY, JSON.stringify(latestRemote));
            }
          }
        } catch (remoteError) {
          console.warn('[CAMPAIGNS] Failed to load campaign_settings from server:', remoteError);
        }
      }

      if (activeSettings) {
        console.log('[CAMPAIGNS] Settings loaded:', {
          hasSmtp: !!activeSettings.smtpHost,
          hasWhatsApp: !!activeSettings.whatsappAccessToken,
          hasSms: !!activeSettings.smsApiKey,
        });
      } else {
        console.log('[CAMPAIGNS] No settings found in AsyncStorage/server, using defaults');
      }
      await loadPendingEmailCampaign();
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
        whatsappTestUseTemplate,
        whatsappTestTemplateName,
        whatsappTestTemplateLanguage,
        whatsappTestTemplateParamsText,
        whatsappTestTemplateHeaderParamsText,
        whatsappTestTemplateHeaderMediaUrl,
        whatsappTestTemplateHeaderMediaType,
        whatsappTestTemplateButtonParamsText,
        whatsappCampaignUseTemplate,
        whatsappLinkCampaignTemplateToTest,
        whatsappCampaignTemplateName,
        whatsappCampaignTemplateLanguage,
        whatsappCampaignTemplateParamsText,
        whatsappCampaignTemplateHeaderParamsText,
        whatsappCampaignTemplateHeaderMediaUrl,
        whatsappCampaignTemplateHeaderMediaType,
        whatsappCampaignTemplateButtonParamsText,
        emailNoReplyMode,
        emailBatchSize: Math.max(1, Math.min(100, parseInt(emailBatchSize || '0', 10) || 25)),
        emailBatchDelayMs: Math.max(0, Math.min(60000, parseInt(emailBatchDelayMs || '0', 10) || 0)),
        emailDailyLimitEnabled,
        emailDailyLimitMax: getEffectiveEmailWindowMax(),
        senderEmail,
        senderName,
        dialogSMSSettings: dialogSMSSettings
          ? {
              provider: 'dialog_esms',
              esms_username: dialogSMSSettings.esms_username || '',
              esms_password_encrypted: dialogSMSSettings.esms_password_encrypted || '',
              default_source_address: dialogSMSSettings.default_source_address || '',
              default_payment_method: dialogSMSSettings.default_payment_method ?? 0,
              push_notification_url: dialogSMSSettings.push_notification_url || '',
            }
          : null,
        esms_username: dialogSMSSettings?.esms_username || '',
        esms_password: dialogSMSSettings?.esms_password_encrypted || '',
        default_source_address: dialogSMSSettings?.default_source_address || '',
        default_payment_method: dialogSMSSettings?.default_payment_method ?? 0,
        push_notification_url: dialogSMSSettings?.push_notification_url || '',
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
      if (currentUser) {
        try {
          await saveDeltaToServer<any>(
            [settings],
            { userId: currentUser.id, dataType: 'campaign_settings' }
          );
        } catch (syncError) {
          console.error('[CAMPAIGNS] Failed to sync campaign settings to server:', syncError);
          Alert.alert('Warning', 'Settings saved locally, but server sync failed. Run manual sync in Settings.');
          return;
        }
      }
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

  const parseWhatsAppTemplateParameters = (raw: string): string[] =>
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const parseJsonResponseSafe = React.useCallback(async (response: Response): Promise<any> => {
    const rawText = await response.text();
    try {
      return rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`Server returned non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 160)}`);
    }
  }, []);

  const normalizeServerQueuedEmailJob = (raw: any, now: number): ServerQueuedEmailJob | null => {
    if (!raw || typeof raw !== 'object') return null;
    const recipients: ServerQueuedEmailRecipient[] = (Array.isArray(raw.recipients) ? raw.recipients : [])
      .map((recipient: any) => ({
        id: String(recipient?.id || ''),
        name: String(recipient?.name || '').trim(),
        email: normalizeEmailForCampaign(recipient?.email),
        company: typeof recipient?.company === 'string' ? recipient.company : '',
        phone: typeof recipient?.phone === 'string' ? recipient.phone : '',
      }))
      .filter((recipient) => !!recipient.email);

    const waitUntil = Math.max(0, Number(raw.waitUntil) || 0);
    const remainingRecipients = Math.max(0, Number(raw.remainingRecipients) || recipients.length);
    const due = !!raw.due || (waitUntil > 0 && waitUntil <= now);

    return {
      id: String(raw.id || ''),
      campaignKey: String(raw.campaignKey || ''),
      waitUntil,
      maxPerWindow: Math.max(1, Math.min(5000, Number(raw.maxPerWindow) || 500)),
      batchDelayMs: Math.max(0, Math.min(60000, Number(raw.batchDelayMs) || 0)),
      createdAt: Math.max(0, Number(raw.createdAt) || 0),
      updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
      lastRunAt: Math.max(0, Number(raw.lastRunAt) || 0),
      lastRunSuccess: Math.max(0, Number(raw.lastRunSuccess) || 0),
      lastRunFailed: Math.max(0, Number(raw.lastRunFailed) || 0),
      lastRunAttempted: Math.max(0, Number(raw.lastRunAttempted) || 0),
      remainingRecipients,
      due,
      recipients,
      recipientsPreviewTruncated: !!raw.recipientsPreviewTruncated,
    };
  };

  const refreshServerEmailQueueStatus = React.useCallback(async (showErrorAlert = false) => {
    try {
      setLoadingServerEmailQueue(true);
      const apiUrl =
        process.env.EXPO_PUBLIC_RORK_API_BASE_URL ||
        (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const endpoint = apiUrl.includes('tracker.tecclk.com')
        ? `${apiUrl}/Tracker/api/email-queue.php?action=status&details=1&recipientLimit=300`
        : `${apiUrl}/api/email-queue?action=status&details=1&recipientLimit=300`;
      const response = await fetch(endpoint, {
        method: 'GET',
      });
      const result = await parseJsonResponseSafe(response);
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load server email queue');
      }

      const now = Date.now();
      const jobs = (Array.isArray(result.jobs) ? result.jobs : [])
        .map((job: any) => normalizeServerQueuedEmailJob(job, now))
        .filter((job: ServerQueuedEmailJob | null): job is ServerQueuedEmailJob => !!job)
        .sort((a, b) => {
          if (a.due !== b.due) return a.due ? -1 : 1;
          return (a.waitUntil || 0) - (b.waitUntil || 0);
        });

      const queueLength = Math.max(0, Number(result.queueLength) || jobs.length);
      const dueJobs = Math.max(0, Number(result.dueJobs) || jobs.filter((job) => job.due).length);
      setServerEmailQueueJobs(jobs);
      setServerEmailQueueLength(queueLength);
      setServerEmailQueueDueJobs(dueJobs);
    } catch (error) {
      console.error('[EMAIL QUEUE] Failed to load server queue:', error);
      if (showErrorAlert) {
        Alert.alert('Queue Load Failed', (error as Error).message);
      }
    } finally {
      setLoadingServerEmailQueue(false);
    }
  }, [parseJsonResponseSafe]);

  const chunkArray = <T,>(items: T[], size: number): T[][] =>
    items.reduce((chunks, item, index) => {
      const chunkIndex = Math.floor(index / size);
      if (!chunks[chunkIndex]) chunks[chunkIndex] = [];
      chunks[chunkIndex].push(item);
      return chunks;
    }, [] as T[][]);

  const normalizeEmailForCampaign = (email?: string | null): string => {
    const value = (email || '').trim().toLowerCase();
    if (!value) return '';
    const simpleEmailRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
    return simpleEmailRegex.test(value) ? value : '';
  };

  const normalizePhoneForCampaign = (phone?: string | null): string => {
    const raw = (phone || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/[^\d+]/g, '');
    const normalized = digits.startsWith('+') ? digits.slice(1) : digits;
    const finalDigits = normalized.replace(/\D/g, '');
    return finalDigits.length >= 8 ? finalDigits : '';
  };

  const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const newsletterColorPalette = ['#111111', '#334155', '#0369A1', '#0F766E', '#B45309', '#B91C1C', '#7C3AED', '#FFFFFF'];
  const newsletterFontOptions = [
    { label: 'Arial', value: 'Arial, sans-serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Verdana', value: 'Verdana, sans-serif' },
    { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
    { label: 'Courier New', value: '"Courier New", monospace' },
  ];

  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const addNewsletterTextBlock = () => {
    const id = `newsletter-text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNewsletterBlocks((prev) => [
      ...prev,
      {
        id,
        type: 'text',
        content: 'New text box',
        fontFamily: 'Arial, sans-serif',
        fontSize: 16,
        color: '#111111',
      },
    ]);
  };

  const addNewsletterImageBlock = () => {
    const id = `newsletter-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNewsletterBlocks((prev) => [
      ...prev,
      {
        id,
        type: 'image',
        imageUrl: '',
        caption: 'Image caption',
        widthPercent: 100,
        heightPx: 0,
      },
    ]);
  };

  const moveNewsletterBlock = (blockId: string, direction: 'up' | 'down') => {
    setNewsletterBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === blockId);
      if (index < 0) return prev;
      if (direction === 'up' && index === 0) return prev;
      if (direction === 'down' && index === prev.length - 1) return prev;
      const next = [...prev];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      const temp = next[index];
      next[index] = next[swapIndex];
      next[swapIndex] = temp;
      return next;
    });
  };

  const removeNewsletterBlock = (blockId: string) => {
    setNewsletterBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const updateNewsletterTextBlock = (
    blockId: string,
    updates: Partial<Omit<NewsletterTextBlock, 'id' | 'type'>>,
  ) => {
    setNewsletterBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId || block.type !== 'text') return block;
        return { ...block, ...updates };
      }),
    );
  };

  const updateNewsletterImageBlock = (
    blockId: string,
    updates: Partial<Omit<NewsletterImageBlock, 'id' | 'type'>>,
  ) => {
    setNewsletterBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId || block.type !== 'image') return block;
        return { ...block, ...updates };
      }),
    );
  };

  const pickNewsletterImageForBlock = async (blockId: string) => {
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== 'granted') {
          Alert.alert('Permission Required', 'Please grant media library permissions to browse images.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];
      let dataUrl = '';
      const mime = asset.mimeType || 'image/jpeg';

      if (asset.base64) {
        dataUrl = `data:${mime};base64,${asset.base64}`;
      } else if (Platform.OS !== 'web') {
        const base64Content = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
        dataUrl = `data:${mime};base64,${base64Content}`;
      } else {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const reader = new FileReader();
        dataUrl = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }

      updateNewsletterImageBlock(blockId, { imageUrl: dataUrl });
    } catch (error) {
      console.error('[NEWSLETTER] Failed to pick image:', error);
      Alert.alert('Image Attach Failed', 'Could not attach image for this newsletter block.');
    }
  };

  const newsletterHtmlContent = useMemo(() => {
    if (!useNewsletterBuilder || newsletterBlocks.length === 0) return '';
    const blockHtml = newsletterBlocks
      .map((block) => {
        if (block.type === 'text') {
          const safeText = escapeHtml(block.content || '').replace(/\n/g, '<br/>');
          const safeColor = (block.color || '#111111').trim();
          const safeFont = (block.fontFamily || 'Arial, sans-serif').trim();
          const safeSize = Math.max(10, Math.min(72, Number(block.fontSize) || 16));
          return `<div style="margin: 14px 0; font-family: ${safeFont}; font-size: ${safeSize}px; color: ${safeColor}; line-height: 1.6;">${safeText || '&nbsp;'}</div>`;
        }
        const safeUrl = escapeHtml((block.imageUrl || '').trim());
        const safeCaption = escapeHtml((block.caption || '').trim());
        const safeWidth = Math.max(10, Math.min(100, Number(block.widthPercent) || 100));
        const safeHeight = Math.max(0, Math.min(1200, Number(block.heightPx) || 0));
        const sizeStyle = safeHeight > 0
          ? `width:${safeWidth}%;height:${safeHeight}px;object-fit:cover;`
          : `width:${safeWidth}%;max-width:100%;`;
        if (!safeUrl) {
          return `<div style="margin: 14px 0; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 24px; text-align: center; color: #64748b; font-family: Arial, sans-serif;">Image Placeholder</div>`;
        }
        return `<div style="margin: 14px 0; text-align:center;"><img src="${safeUrl}" alt="${safeCaption || 'Newsletter image'}" style="${sizeStyle} border-radius: 8px; display: inline-block;" />${safeCaption ? `<div style="margin-top: 8px; color: #475569; font-size: 13px; font-family: Arial, sans-serif;">${safeCaption}</div>` : ''}</div>`;
      })
      .join('');
    return `<!doctype html><html><body style="margin:0; padding:20px; background:#f8fafc;"><div style="max-width:680px; margin:0 auto; background:#ffffff; border-radius:12px; padding:24px;">${blockHtml}</div></body></html>`;
  }, [useNewsletterBuilder, newsletterBlocks]);

  const getEffectiveEmailWindowMax = (): number =>
    Math.max(1, Math.min(5000, parseInt(emailDailyLimitMax || '0', 10) || 500));

  const formatWaitDuration = (ms: number): string => {
    const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    if (minutes <= 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  const normalizePendingEmailCampaign = (raw: any): PendingEmailCampaign | null => {
    if (!raw || typeof raw !== 'object') return null;
    const recipients = (Array.isArray(raw.recipients) ? raw.recipients : [])
      .map((item: any) => ({
        id: String(item?.id || ''),
        name: String(item?.name || '').trim() || 'Unknown',
        email: normalizeEmailForCampaign(item?.email),
        company: typeof item?.company === 'string' ? item.company : '',
        phone: typeof item?.phone === 'string' ? item.phone : '',
      }))
      .filter((item: EmailCampaignRecipient) => !!item.id && !!item.email);

    if (recipients.length === 0) return null;

    const attachments: Attachment[] = (Array.isArray(raw.attachments) ? raw.attachments : [])
      .map((item: any) => ({
        uri: String(item?.uri || ''),
        name: String(item?.name || ''),
        mimeType: String(item?.mimeType || 'application/octet-stream'),
        size: Number(item?.size || 0),
      }))
      .filter((item) => !!item.uri && !!item.name);

    const maxPerWindow = Math.max(1, Math.min(5000, Number(raw.maxPerWindow) || 500));

    return {
      id: String(raw.id || `pending-email-${Date.now()}`),
      createdAt: Number(raw.createdAt || Date.now()),
      updatedAt: Number(raw.updatedAt || Date.now()),
      senderName: String(raw.senderName || '').trim(),
      senderEmail: String(raw.senderEmail || '').trim(),
      replyToEmail: String(raw.replyToEmail || '').trim(),
      replyToName: String(raw.replyToName || '').trim(),
      subject: String(raw.subject || ''),
      message: String(raw.message || ''),
      htmlContent: String(raw.htmlContent || ''),
      format: raw.format === 'html' ? 'html' : 'text',
      attachments,
      maxPerWindow,
      waitUntil: raw.waitUntil ? Number(raw.waitUntil) : null,
      lastSuccessAt: raw.lastSuccessAt ? Number(raw.lastSuccessAt) : null,
      recipients,
    };
  };

  const savePendingEmailCampaign = async (campaign: PendingEmailCampaign | null) => {
    try {
      if (!campaign || campaign.recipients.length === 0) {
        await AsyncStorage.removeItem(EMAIL_CAMPAIGN_REMAINING_KEY);
        setPendingEmailCampaign(null);
        return;
      }
      const sanitized = normalizePendingEmailCampaign(campaign);
      if (!sanitized) {
        await AsyncStorage.removeItem(EMAIL_CAMPAIGN_REMAINING_KEY);
        setPendingEmailCampaign(null);
        return;
      }
      await AsyncStorage.setItem(EMAIL_CAMPAIGN_REMAINING_KEY, JSON.stringify(sanitized));
      setPendingEmailCampaign(sanitized);
    } catch (error) {
      console.error('[EMAIL CAMPAIGN] Failed to persist pending campaign:', error);
    }
  };

  const loadPendingEmailCampaign = async () => {
    try {
      const raw = await AsyncStorage.getItem(EMAIL_CAMPAIGN_REMAINING_KEY);
      if (!raw) {
        setPendingEmailCampaign(null);
        return;
      }
      const parsed = JSON.parse(raw);
      const normalized = normalizePendingEmailCampaign(parsed);
      if (!normalized) {
        await AsyncStorage.removeItem(EMAIL_CAMPAIGN_REMAINING_KEY);
        setPendingEmailCampaign(null);
        return;
      }
      setPendingEmailCampaign(normalized);
    } catch (error) {
      console.error('[EMAIL CAMPAIGN] Failed to load pending campaign:', error);
      setPendingEmailCampaign(null);
    }
  };

  const enqueueRemainingEmailsForAutomation = async (options: {
    campaignKey: string;
    waitUntil: number;
    maxPerWindow: number;
    recipients: EmailCampaignRecipient[];
    emailData: {
      senderName: string;
      senderEmail: string;
      replyToEmail: string;
      replyToName: string;
      subject: string;
      message: string;
      htmlContent: string;
      format: EmailFormat;
      attachments: Attachment[];
    };
  }): Promise<{ queued: boolean; message: string }> => {
    if (!options.recipients.length) {
      return { queued: false, message: 'No remaining recipients to automate.' };
    }

    if (options.emailData.attachments.length > 0) {
      return {
        queued: false,
        message: 'Auto-send is skipped when attachments are used. Use "Send Remaining" manually for this campaign.',
      };
    }

    try {
      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const endpoint = apiUrl.includes('tracker.tecclk.com')
        ? `${apiUrl}/Tracker/api/email-queue.php`
        : `${apiUrl}/api/email-queue`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enqueue',
          campaignKey: options.campaignKey,
          waitUntil: options.waitUntil,
          maxPerWindow: options.maxPerWindow,
          batchDelayMs: Math.max(0, Math.min(60000, parseInt(emailBatchDelayMs || '0', 10) || 0)),
          smtpConfig: {
            host: smtpHost,
            port: smtpPort,
            username: smtpUsername,
            password: smtpPassword,
          },
          emailData: {
            ...options.emailData,
            attachments: [],
          },
          recipients: options.recipients.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            company: r.company,
            phone: r.phone,
          })),
        }),
      });

      const result = await parseJsonResponseSafe(response);
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to queue automated remaining emails');
      }

      return {
        queued: true,
        message: `Auto-send queued for ${options.recipients.length} remaining email(s) after 24 hours.`,
      };
    } catch (error) {
      console.error('[EMAIL AUTO QUEUE] Failed to queue automated remaining emails:', error);
      return {
        queued: false,
        message: `Auto-send queue failed: ${(error as Error).message}`,
      };
    }
  };

  const buildFailedSMSBatchFingerprint = (job: Pick<FailedSMSBatchJob, 'provider' | 'message' | 'recipients'>): string => {
    const phones = [...job.recipients.map((r) => (r.phone || '').trim())].sort().join('|');
    return `${job.provider}::${job.message.trim()}::${phones}`;
  };

  const readFailedSMSBatchQueue = React.useCallback(async (): Promise<FailedSMSBatchJob[]> => {
    try {
      const raw = await AsyncStorage.getItem(FAILED_SMS_BATCH_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && Array.isArray(item.recipients) && typeof item.message === 'string')
        .map((item) => ({
          id: String(item.id || `sms-batch-${Date.now()}`),
          provider: item.provider === 'legacy' ? 'legacy' : 'dialog',
          message: String(item.message || ''),
          recipients: (item.recipients || [])
            .filter((r: any) => r && typeof r.phone === 'string' && r.phone.trim())
            .map((r: any) => ({ name: typeof r.name === 'string' ? r.name : undefined, phone: String(r.phone) })),
          createdAt: Number(item.createdAt || Date.now()),
          updatedAt: Number(item.updatedAt || Date.now()),
          attempts: Number(item.attempts || 0),
          lastError: String(item.lastError || ''),
        })) as FailedSMSBatchJob[];
    } catch (error) {
      console.error('[SMS FAILED BATCHES] Failed to read queue:', error);
      return [];
    }
  }, []);

  const writeFailedSMSBatchQueue = React.useCallback(async (jobs: FailedSMSBatchJob[]) => {
    const sanitized = jobs
      .filter((job) => job.recipients.length > 0 && job.message.trim())
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    await AsyncStorage.setItem(FAILED_SMS_BATCH_QUEUE_KEY, JSON.stringify(sanitized));
    setFailedSmsBatches(sanitized);
  }, []);

  const refreshFailedSMSBatchQueue = React.useCallback(async () => {
    try {
      setLoadingFailedSmsBatches(true);
      const jobs = await readFailedSMSBatchQueue();
      setFailedSmsBatches(jobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    } catch (error) {
      console.error('[SMS FAILED BATCHES] Refresh error:', error);
    } finally {
      setLoadingFailedSmsBatches(false);
    }
  }, [readFailedSMSBatchQueue]);

  const queueFailedSMSBatch = React.useCallback(async (
    provider: 'dialog' | 'legacy',
    batchMessage: string,
    recipients: Array<{ name?: string; phone: string }>,
    errorMessage: string,
  ) => {
    const normalizedRecipients = recipients
      .map((r) => ({ name: r.name, phone: normalizePhoneForCampaign(r.phone) || (r.phone || '').trim() }))
      .filter((r) => !!r.phone);
    if (normalizedRecipients.length === 0) return;

    const now = Date.now();
    const newJobBase: Pick<FailedSMSBatchJob, 'provider' | 'message' | 'recipients'> = {
      provider,
      message: batchMessage,
      recipients: normalizedRecipients,
    };
    const newFingerprint = buildFailedSMSBatchFingerprint(newJobBase);
    const existing = await readFailedSMSBatchQueue();
    const next: FailedSMSBatchJob[] = [];
    let replaced = false;

    for (const job of existing) {
      const same = buildFailedSMSBatchFingerprint(job) === newFingerprint;
      if (same) {
        replaced = true;
        next.push({
          ...job,
          recipients: normalizedRecipients,
          updatedAt: now,
          attempts: (job.attempts || 0) + 1,
          lastError: errorMessage,
        });
      } else {
        next.push(job);
      }
    }

    if (!replaced) {
      next.push({
        id: `sms-failed-batch-${now}-${Math.random().toString(36).slice(2, 8)}`,
        provider,
        message: batchMessage,
        recipients: normalizedRecipients,
        createdAt: now,
        updatedAt: now,
        attempts: 1,
        lastError: errorMessage,
      });
    }

    await writeFailedSMSBatchQueue(next);
  }, [normalizePhoneForCampaign, readFailedSMSBatchQueue, writeFailedSMSBatchQueue]);

  const retryFailedSMSBatchesNow = React.useCallback(async () => {
    const hasDialogSMSConfig = !!(
      dialogSMSSettings?.esms_username &&
      dialogSMSSettings?.esms_password_encrypted
    );
    const hasLegacySMSConfig = !!(smsApiUrl && smsApiKey);

    try {
      setRetryingFailedSmsBatches(true);
      const queue = await readFailedSMSBatchQueue();
      if (queue.length === 0) {
        Alert.alert('No Failed SMS Batches', 'There are no queued SMS failed batches to retry.');
        return;
      }

      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const legacyEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-sms.php` : `${apiUrl}/api/send-sms`;

      let retriedOk = 0;
      let retriedFailed = 0;
      const notes: string[] = [];
      const remaining: FailedSMSBatchJob[] = [];

      for (const job of queue) {
        try {
          if (job.provider === 'dialog') {
            if (!hasDialogSMSConfig) {
              throw new Error('Dialog eSMS settings not configured');
            }
            const result = await sendDialogSMSCampaign(job.message, job.recipients.map((r) => r.phone));
            if (!result.success) {
              throw new Error(result.error || 'Dialog eSMS retry failed');
            }
          } else {
            if (!hasLegacySMSConfig) {
              throw new Error('Legacy SMS settings not configured');
            }
            const response = await fetch(legacyEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: job.message,
                recipients: job.recipients.map((r) => ({ name: r.name, phone: r.phone })),
                transaction_id: Date.now(),
              }),
            });
            const result = await parseJsonResponseSafe(response);
            if (!response.ok || !result.success) {
              throw new Error(result.error || 'Legacy SMS retry failed');
            }
          }

          retriedOk += 1;
        } catch (error) {
          retriedFailed += 1;
          const msg = (error as Error).message;
          notes.push(`Batch ${job.id.slice(-6)}: ${msg}`);
          remaining.push({
            ...job,
            updatedAt: Date.now(),
            attempts: (job.attempts || 0) + 1,
            lastError: msg,
          });
        }
      }

      await writeFailedSMSBatchQueue(remaining);

      Alert.alert(
        'SMS Failed Batch Retry Complete',
        `Retried Successfully: ${retriedOk}\nStill Failed: ${retriedFailed}\nRemaining Queued: ${remaining.length}${
          notes.length ? '\n\nNotes:\n' + notes.slice(0, 5).join('\n') : ''
        }`
      );
    } catch (error) {
      console.error('[SMS FAILED BATCHES] Retry error:', error);
      Alert.alert('Retry Failed', (error as Error).message);
    } finally {
      setRetryingFailedSmsBatches(false);
      refreshFailedSMSBatchQueue();
    }
  }, [
    dialogSMSSettings,
    smsApiUrl,
    smsApiKey,
    readFailedSMSBatchQueue,
    sendDialogSMSCampaign,
    parseJsonResponseSafe,
    writeFailedSMSBatchQueue,
    refreshFailedSMSBatchQueue,
  ]);

  const getEffectiveWhatsAppCampaignTemplateConfig = () => {
    if (whatsappLinkCampaignTemplateToTest) {
      return {
        source: 'linked-test' as const,
        name: whatsappTestTemplateName.trim(),
        language: whatsappTestTemplateLanguage.trim() || 'en_US',
        paramsText: whatsappTestTemplateParamsText,
        params: parseWhatsAppTemplateParameters(whatsappTestTemplateParamsText),
        headerParamsText: whatsappTestTemplateHeaderParamsText,
        headerParams: parseWhatsAppTemplateParameters(whatsappTestTemplateHeaderParamsText),
        headerMediaUrl: whatsappTestTemplateHeaderMediaUrl.trim(),
        headerMediaType: whatsappTestTemplateHeaderMediaType,
        buttonParamsText: whatsappTestTemplateButtonParamsText,
        buttonParams: parseWhatsAppTemplateParameters(whatsappTestTemplateButtonParamsText),
      };
    }

    return {
      source: 'campaign' as const,
      name: whatsappCampaignTemplateName.trim(),
      language: whatsappCampaignTemplateLanguage.trim() || 'en_US',
      paramsText: whatsappCampaignTemplateParamsText,
      params: parseWhatsAppTemplateParameters(whatsappCampaignTemplateParamsText),
      headerParamsText: whatsappCampaignTemplateHeaderParamsText,
      headerParams: parseWhatsAppTemplateParameters(whatsappCampaignTemplateHeaderParamsText),
      headerMediaUrl: whatsappCampaignTemplateHeaderMediaUrl.trim(),
      headerMediaType: whatsappCampaignTemplateHeaderMediaType,
      buttonParamsText: whatsappCampaignTemplateButtonParamsText,
      buttonParams: parseWhatsAppTemplateParameters(whatsappCampaignTemplateButtonParamsText),
    };
  };

  const buildWhatsAppSendDebugSummary = (options: {
    mode: 'test' | 'campaign';
    useTemplate: boolean;
    templateName?: string;
    templateLanguage?: string;
    templateParameters?: string[];
    templateHeaderParameters?: string[];
    templateHeaderMediaUrl?: string;
    templateHeaderMediaType?: string;
    templateButtonParameters?: string[];
    recipients: Array<{ name?: string; phone?: string }>;
    backendDebug?: any;
    backendErrors?: string[];
  }): string => {
    const lines: string[] = [];
    lines.push(`Mode: ${options.mode}`);
    lines.push(`Send Type: ${options.useTemplate ? 'template' : 'text/media'}`);

    if (options.useTemplate) {
      lines.push(`Template: ${options.templateName || '(blank)'}`);
      lines.push(`Language: ${options.templateLanguage || 'en_US'}`);
      lines.push(`Template Params: ${(options.templateParameters || []).length}`);
      if ((options.templateParameters || []).length > 0) {
        lines.push(`Params: ${(options.templateParameters || []).join(' | ')}`);
      }
      lines.push(`Header Text Params: ${(options.templateHeaderParameters || []).length}`);
      if ((options.templateHeaderParameters || []).length > 0) {
        lines.push(`Header Params: ${(options.templateHeaderParameters || []).join(' | ')}`);
      }
      if (options.templateHeaderMediaUrl) {
        lines.push(`Header Media: ${(options.templateHeaderMediaType || 'image')} ${options.templateHeaderMediaUrl}`);
      }
      lines.push(`Button URL Params: ${(options.templateButtonParameters || []).length}`);
      if ((options.templateButtonParameters || []).length > 0) {
        lines.push(`Button Params: ${(options.templateButtonParameters || []).join(' | ')}`);
      }
    }

    const normalizedPreview = Array.isArray(options.backendDebug?.recipients)
      ? options.backendDebug.recipients.slice(0, 5)
      : [];
    if (normalizedPreview.length > 0) {
      lines.push('');
      lines.push('Recipients (input -> normalized):');
      normalizedPreview.forEach((recipient: any) => {
        lines.push(
          `${recipient.name || 'Unknown'}: ${recipient.inputPhone || '-'} -> ${recipient.normalizedPhone || '-'}`
        );
      });
      if ((options.backendDebug?.recipients?.length || 0) > normalizedPreview.length) {
        lines.push(`... +${options.backendDebug.recipients.length - normalizedPreview.length} more`);
      }
    } else if (options.recipients.length > 0) {
      lines.push('');
      lines.push(`Recipients: ${options.recipients.slice(0, 5).map((r) => r.phone || '-').join(', ')}`);
    }

    if (Array.isArray(options.backendErrors) && options.backendErrors.length > 0) {
      lines.push('');
      lines.push(`First Error: ${options.backendErrors[0]}`);
    }

    return lines.join('\n');
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
    refreshFailedSMSBatchQueue();
  }, [refreshFailedSMSBatchQueue]);

  React.useEffect(() => {
    if (campaignType === 'sms') {
      refreshFailedSMSBatchQueue();
    }
  }, [campaignType, refreshFailedSMSBatchQueue]);

  React.useEffect(() => {
    if (campaignType !== 'email') {
      return;
    }
    refreshServerEmailQueueStatus(false);
  }, [
    campaignType,
    pendingEmailCampaign?.id,
    pendingEmailCampaign?.recipients.length,
    refreshServerEmailQueueStatus,
  ]);

  React.useEffect(() => {
    console.log('[CAMPAIGNS] WhatsApp credentials updated:', {
      hasToken: !!whatsappAccessToken,
      hasPhoneId: !!whatsappPhoneNumberId,
      tokenLength: whatsappAccessToken?.length || 0
    });
  }, [whatsappAccessToken, whatsappPhoneNumberId]);

  const derivedNoReplyEmail = useMemo(() => {
    const email = senderEmail.trim();
    const atIndex = email.indexOf('@');
    if (atIndex < 0) return '';
    const domain = email.slice(atIndex + 1).trim();
    if (!domain) return '';
    return `noreply@${domain}`;
  }, [senderEmail]);

  React.useEffect(() => {
    const waitUntil = pendingEmailCampaign?.waitUntil;
    if (!waitUntil || waitUntil <= Date.now()) {
      return;
    }
    setEmailWindowNow(Date.now());
    const timer = setInterval(() => {
      const now = Date.now();
      setEmailWindowNow(now);
      if (now >= waitUntil) {
        clearInterval(timer);
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [pendingEmailCampaign?.waitUntil]);

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

  const emailRemainingWaitMs = useMemo(() => {
    if (!pendingEmailCampaign?.waitUntil) return 0;
    return Math.max(0, pendingEmailCampaign.waitUntil - emailWindowNow);
  }, [pendingEmailCampaign?.waitUntil, emailWindowNow]);

  const canSendEmailRemaining = useMemo(() => {
    return !!pendingEmailCampaign && pendingEmailCampaign.recipients.length > 0 && emailRemainingWaitMs <= 0;
  }, [pendingEmailCampaign, emailRemainingWaitMs]);

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

  const extractDialogCreditValue = (result: any): number | string | null => {
    const candidates = [
      result?.remainingCount,
      result?.walletBalance,
      result?.data?.remainingCount,
      result?.data?.walletBalance,
    ];

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim() !== '') {
        return candidate;
      }
    }
    return null;
  };

  const refreshDialogCredit = React.useCallback(async (showAlert: boolean = false) => {
    const hasDialogSMSConfig = !!(
      dialogSMSSettings?.esms_username &&
      dialogSMSSettings?.esms_password_encrypted
    );

    if (!hasDialogSMSConfig) {
      setDialogCreditRemaining(null);
      setDialogCreditSource(null);
      setDialogCreditError('Dialog eSMS is not configured');
      setDialogCreditUpdatedAt(null);
      if (showAlert) {
        Alert.alert('Dialog eSMS Not Configured', 'Please save Dialog eSMS username/password in Settings first.');
      }
      return;
    }

    try {
      setLoadingDialogCredit(true);
      setDialogCreditError('');

      const result: any = await testDialogSMSLogin(
        dialogSMSSettings!.esms_username,
        dialogSMSSettings!.esms_password_encrypted
      );

      if (!result?.success) {
        throw new Error(result?.error || result?.message || 'Failed to fetch Dialog credit');
      }

      const credit = extractDialogCreditValue(result);

      if (credit === null) {
        if (lastKnownDialogBalance) {
          setDialogCreditRemaining(lastKnownDialogBalance.value);
          setDialogCreditSource('last_known');
          setDialogCreditUpdatedAt(lastKnownDialogBalance.timestamp);
          setDialogCreditError(
            result?.dashboardError || result?.comment || 'Dialog login works, but current balance is not returned by the API. Showing last known balance from recent campaign activity.'
          );
        } else {
          setDialogCreditRemaining(null);
          setDialogCreditSource(null);
          setDialogCreditUpdatedAt(Date.now());
          const noBalanceMsg = result?.dashboardError || result?.comment || 'Login successful, but Dialog did not return a credit value.';
          setDialogCreditError(noBalanceMsg);
        }
      } else {
        setDialogCreditRemaining(credit);
        setDialogCreditSource('live');
        setDialogCreditUpdatedAt(Date.now());
      }

      if (showAlert) {
        Alert.alert(
          'Dialog Credit Updated',
          credit === null
            ? 'Login successful, but no credit value was returned.'
            : `Credit remaining: ${credit}`
        );
      }
    } catch (error) {
      const message = (error as Error).message || 'Failed to fetch Dialog credit';
      if (lastKnownDialogBalance) {
        setDialogCreditRemaining(lastKnownDialogBalance.value);
        setDialogCreditSource('last_known');
        setDialogCreditUpdatedAt(lastKnownDialogBalance.timestamp);
        setDialogCreditError(`${message} Showing last known balance from recent campaign activity.`);
      } else {
        setDialogCreditRemaining(null);
        setDialogCreditSource(null);
        setDialogCreditError(message);
      }
      if (showAlert) {
        Alert.alert('Failed to Refresh Credit', message);
      }
    } finally {
      setLoadingDialogCredit(false);
    }
  }, [dialogSMSSettings, testDialogSMSLogin, lastKnownDialogBalance]);

  const openDialogTopUp = React.useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(DIALOG_ESMS_PORTAL_URL);
      if (!supported) {
        throw new Error('Cannot open Dialog eSMS portal URL');
      }
      await Linking.openURL(DIALOG_ESMS_PORTAL_URL);
    } catch (error) {
      Alert.alert('Unable to Open Dialog Portal', (error as Error).message);
    }
  }, []);

  React.useEffect(() => {
    const hasDialogSMSConfig = !!(
      dialogSMSSettings?.esms_username &&
      dialogSMSSettings?.esms_password_encrypted
    );

    if (campaignType === 'sms' && hasDialogSMSConfig && !loadingDialogCredit) {
      refreshDialogCredit(false);
    }
  }, [
    campaignType,
    dialogSMSSettings?.esms_username,
    dialogSMSSettings?.esms_password_encrypted,
    refreshDialogCredit,
  ]);

  const testSMSConnection = async () => {
    const hasDialogSMSConfig = !!(
      dialogSMSSettings?.esms_username &&
      dialogSMSSettings?.esms_password_encrypted
    );

    if (!hasDialogSMSConfig && (!smsApiUrl || !smsApiKey)) {
      Alert.alert('Configuration Missing', 'Please configure Dialog eSMS settings (preferred) or legacy SMS API settings before testing.');
      return;
    }

    try {
      setTestingSMS(true);
      console.log('[SMS Test] Starting connection test...');

      if (hasDialogSMSConfig) {
        const result: any = await testDialogSMSLogin(
          dialogSMSSettings!.esms_username,
          dialogSMSSettings!.esms_password_encrypted
        );

        if (!result.success) {
          throw new Error(result.error || result.message || 'Dialog eSMS login test failed');
        }

        const credit = extractDialogCreditValue(result);
        if (credit === null && lastKnownDialogBalance) {
          setDialogCreditRemaining(lastKnownDialogBalance.value);
          setDialogCreditSource('last_known');
          setDialogCreditUpdatedAt(lastKnownDialogBalance.timestamp);
          setDialogCreditError('Dialog login succeeded, but current balance is not returned by the API. Showing last known balance.');
        } else {
          setDialogCreditRemaining(credit);
          setDialogCreditSource(credit === null ? null : 'live');
          setDialogCreditUpdatedAt(Date.now());
          setDialogCreditError('');
        }

        Alert.alert(
          'Connection Test Successful',
          credit === null
            ? (lastKnownDialogBalance
              ? `Dialog eSMS login is configured correctly.\nCurrent balance is unavailable from API.\nLast known balance: ${lastKnownDialogBalance.value}`
              : 'Dialog eSMS login is configured correctly')
            : `Dialog eSMS login is configured correctly.\nCredit remaining: ${credit}`
        );
        return;
      }

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
    const effectiveHtml = useNewsletterBuilder ? newsletterHtmlContent : htmlContent;
    if (!normalizeEmailForCampaign(senderEmail)) {
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
    if (emailFormat === 'html' && useNewsletterBuilder && newsletterBlocks.length === 0) {
      return 'Please add at least one newsletter block';
    }
    if (emailFormat === 'html' && !effectiveHtml.trim()) {
      return useNewsletterBuilder ? 'Please add newsletter content' : 'Please enter HTML content';
    }
    if (selectedCustomers.length === 0) {
      return 'Please select at least one customer';
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
    return null;
  };

  const validateWhatsAppCampaign = (): string | null => {
    if (whatsappCampaignUseTemplate) {
      const templateConfig = getEffectiveWhatsAppCampaignTemplateConfig();
      if (!templateConfig.name) {
        return whatsappLinkCampaignTemplateToTest
          ? 'Please enter an approved WhatsApp template name in the WhatsApp Test Template settings (campaign is linked to test template).'
          : 'Please enter an approved WhatsApp template name';
      }
      if (whatsappMediaUri) {
        return 'Media campaigns are not supported in template mode yet. Turn template mode OFF to send text/media campaigns.';
      }
    } else if (!message.trim() && !whatsappMediaUri) {
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

    const mapSelectedRecipients: EmailCampaignRecipient[] = selectedCustomers.map((c) => ({
      id: c.id,
      name: c.name || 'Unknown',
      email: normalizeEmailForCampaign(c.email),
      company: c.company,
      phone: c.phone,
    }));
    const invalidEmailRecipients = mapSelectedRecipients.filter((r) => !r.email);
    const validEmailRecipients = mapSelectedRecipients.filter((r) => !!r.email);
    if (validEmailRecipients.length === 0) {
      Alert.alert('Validation Error', 'No valid email addresses found in selected customers');
      return;
    }

    const effectiveWindowMax = getEffectiveEmailWindowMax();
    const targetSuccessfulSends = emailDailyLimitEnabled
      ? Math.min(effectiveWindowMax, validEmailRecipients.length)
      : validEmailRecipients.length;
    const normalizedSenderEmail = normalizeEmailForCampaign(senderEmail);
    if (!normalizedSenderEmail) {
      Alert.alert('Validation Error', 'Sender email format is invalid.');
      return;
    }
    const effectiveHtmlForSend = useNewsletterBuilder ? newsletterHtmlContent : htmlContent;
    const replacingPendingCount = pendingEmailCampaign?.recipients.length || 0;

    const processAttachmentsForSend = async (sourceAttachments: Attachment[]) => Promise.all(
      sourceAttachments.map(async (att) => {
        let base64Content = '';

        if (Platform.OS !== 'web') {
          base64Content = await FileSystem.readAsStringAsync(att.uri, {
            encoding: 'base64',
          });
        } else {
          const response = await fetch(att.uri);
          const blob = await response.blob();
          const reader = new FileReader();
          base64Content = await new Promise<string>((resolve) => {
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

    const executeEmailSend = async (
      recipientsToSend: EmailCampaignRecipient[],
      emailPayload: {
        senderName: string;
        senderEmail: string;
        replyToEmail: string;
        replyToName: string;
        subject: string;
        message: string;
        htmlContent: string;
        format: EmailFormat;
        attachments: Attachment[];
      },
      targetSuccessCount: number,
    ) => {
      const processedAttachments = await processAttachmentsForSend(emailPayload.attachments);
      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-email.php` : `${apiUrl}/api/send-email`;
      const EMAIL_CHUNK_SIZE = Math.max(1, Math.min(100, parseInt(emailBatchSize || '0', 10) || 25));
      const effectiveEmailBatchDelayMs = Math.max(0, Math.min(60000, parseInt(emailBatchDelayMs || '0', 10) || 0));
      const aggregatedResults = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };
      const chunkFailures: string[] = [];
      let processedRecipientsCount = 0;
      let sentChunks = 0;

      while (processedRecipientsCount < recipientsToSend.length && aggregatedResults.success < targetSuccessCount) {
        const neededSuccesses = targetSuccessCount - aggregatedResults.success;
        const chunkSizeForTarget = Math.min(
          EMAIL_CHUNK_SIZE,
          neededSuccesses,
          recipientsToSend.length - processedRecipientsCount,
        );
        const chunk = recipientsToSend.slice(
          processedRecipientsCount,
          processedRecipientsCount + chunkSizeForTarget,
        );
        processedRecipientsCount += chunk.length;
        sentChunks += 1;

        try {
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
                senderName: emailPayload.senderName,
                senderEmail: emailPayload.senderEmail,
                replyToEmail: emailPayload.replyToEmail,
                replyToName: emailPayload.replyToName,
                subject: emailPayload.subject,
                message: emailPayload.message,
                htmlContent: emailPayload.htmlContent,
                format: emailPayload.format,
                attachments: processedAttachments,
              },
              recipients: chunk.map(c => ({
                name: c.name,
                email: c.email,
                company: c.company,
                phone: c.phone,
              })),
            }),
          });

          const result = await parseJsonResponseSafe(response);
          if (!response.ok || !result.success) {
            throw new Error(result.error || `Chunk ${sentChunks} failed`);
          }

          const chunkResults = result.results || { success: 0, failed: 0, errors: [] };
          aggregatedResults.success += Number(chunkResults.success || 0);
          aggregatedResults.failed += Number(chunkResults.failed || 0);
          if (Array.isArray(chunkResults.errors)) {
            aggregatedResults.errors.push(...chunkResults.errors);
          }
        } catch (chunkError) {
          const chunkMsg = `Chunk ${sentChunks}: ${(chunkError as Error).message}`;
          console.error('[EMAIL CAMPAIGN] Chunk error:', chunkMsg);
          chunkFailures.push(chunkMsg);
          aggregatedResults.failed += chunk.length;
          aggregatedResults.errors.push(chunkMsg);
        }

        if (
          processedRecipientsCount < recipientsToSend.length &&
          aggregatedResults.success < targetSuccessCount &&
          effectiveEmailBatchDelayMs > 0
        ) {
          await sleepMs(effectiveEmailBatchDelayMs);
        }
      }

      return {
        aggregatedResults,
        chunkFailures,
        recipientChunksCount: sentChunks,
        chunkSize: EMAIL_CHUNK_SIZE,
        batchDelayMs: effectiveEmailBatchDelayMs,
        processedRecipientsCount,
      };
    };

    setConfirmState({
      title: 'Send Email Campaign',
      message: `Send email campaign now? Target successful sends this run: ${targetSuccessfulSends}.${
        emailDailyLimitEnabled
          ? `\n\nDaily cap is enabled (${effectiveWindowMax}/24h). Sending continues until ${targetSuccessfulSends} are sent successfully or recipients run out.`
          : ''
      }${
        replacingPendingCount > 0
          ? `\n\nThis will replace the existing remaining queue (${replacingPendingCount} email(s)).`
          : ''
      }`,
      onConfirm: async () => {
        try {
          setIsSending(true);
          const emailPayload = {
            senderName,
            senderEmail: normalizedSenderEmail,
            replyToEmail: emailNoReplyMode ? (derivedNoReplyEmail || normalizedSenderEmail) : normalizedSenderEmail,
            replyToName: senderName,
            subject,
            message,
            htmlContent: effectiveHtmlForSend,
            format: emailFormat,
            attachments,
          };

          const result = await executeEmailSend(validEmailRecipients, emailPayload, targetSuccessfulSends);
          const aggregatedResults = {
            ...result.aggregatedResults,
            failed: result.aggregatedResults.failed + invalidEmailRecipients.length,
            errors: [...result.aggregatedResults.errors],
          };
          if (invalidEmailRecipients.length > 0) {
            aggregatedResults.errors.push(
              ...invalidEmailRecipients.slice(0, 20).map(r => `${r.name || 'Unknown'}: Invalid/missing email`)
            );
            if (invalidEmailRecipients.length > 20) {
              aggregatedResults.errors.push(`... and ${invalidEmailRecipients.length - 20} more invalid/missing emails`);
            }
          }

          let queuedRemaining = 0;
          let waitUntil: number | null = null;
          let automationNote = '';
          const unattemptedRecipients = validEmailRecipients.slice(result.processedRecipientsCount);
          if (emailDailyLimitEnabled && unattemptedRecipients.length > 0) {
            const now = Date.now();
            waitUntil = aggregatedResults.success > 0 ? now + EMAIL_SEND_WINDOW_MS : null;
            const campaignId = `email-campaign-${now}`;
            const nextPending: PendingEmailCampaign = {
              id: campaignId,
              createdAt: now,
              updatedAt: now,
              senderName: emailPayload.senderName,
              senderEmail: emailPayload.senderEmail,
              replyToEmail: emailPayload.replyToEmail,
              replyToName: emailPayload.replyToName,
              subject: emailPayload.subject,
              message: emailPayload.message,
              htmlContent: emailPayload.htmlContent,
              format: emailPayload.format,
              attachments: emailPayload.attachments,
              maxPerWindow: effectiveWindowMax,
              waitUntil,
              lastSuccessAt: aggregatedResults.success > 0 ? now : null,
              recipients: unattemptedRecipients,
            };
            await savePendingEmailCampaign(nextPending);
            queuedRemaining = unattemptedRecipients.length;
            setSelectedCustomerIds(new Set(unattemptedRecipients.map((r) => r.id)));

            if (waitUntil) {
              const autoQueue = await enqueueRemainingEmailsForAutomation({
                campaignKey: campaignId,
                waitUntil,
                maxPerWindow: effectiveWindowMax,
                recipients: unattemptedRecipients,
                emailData: emailPayload,
              });
              automationNote = autoQueue.message;
              if (autoQueue.queued) {
                // Auto-scheduled on server: clear local manual queue to avoid duplicate sends.
                await savePendingEmailCampaign(null);
                setSelectedCustomerIds(new Set());
              }
            }
          } else if (replacingPendingCount > 0) {
            await savePendingEmailCampaign(null);
          }

          const resultMessage = `Sent: ${aggregatedResults.success}\nTarget Successful This Run: ${targetSuccessfulSends}\nAttempted: ${result.processedRecipientsCount}\nFailed: ${aggregatedResults.failed}\nSkipped Invalid Emails: ${invalidEmailRecipients.length}\nBatches: ${result.recipientChunksCount}\nBatch Size: ${result.chunkSize}\nBatch Delay: ${result.batchDelayMs} ms${result.chunkFailures.length ? `\nBatch Errors: ${result.chunkFailures.length}` : ''}${
            queuedRemaining > 0 ? `\nQueued Remaining: ${queuedRemaining}` : ''
          }${
            queuedRemaining > 0 && waitUntil ? `\nNext Send Remaining: ${new Date(waitUntil).toLocaleString()}` : ''
          }${
            automationNote ? `\n${automationNote}` : ''
          }${
            aggregatedResults.errors.length > 0 ? '\n\nErrors:\n' + aggregatedResults.errors.slice(0, 8).join('\n') : ''
          }`;

          Alert.alert('Email Campaign Complete', resultMessage, [{ text: 'OK' }]);

          if (queuedRemaining === 0 && aggregatedResults.success > 0) {
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
      setConfirmVisible(true);
    }, 100);
  };

  const sendRemainingEmailCampaign = async () => {
    if (!pendingEmailCampaign || pendingEmailCampaign.recipients.length === 0) {
      Alert.alert('No Remaining Emails', 'There are no queued remaining campaign emails.');
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
    if (emailRemainingWaitMs > 0) {
      Alert.alert(
        'Daily Send Window Active',
        `You can send the next batch in ${formatWaitDuration(emailRemainingWaitMs)}.`,
        [{ text: 'OK' }]
      );
      return;
    }

    const maxPerWindow = Math.max(1, pendingEmailCampaign.maxPerWindow || 1);
    const targetSuccessfulSends = Math.min(maxPerWindow, pendingEmailCampaign.recipients.length);

    const processAttachmentsForSend = async (sourceAttachments: Attachment[]) => Promise.all(
      sourceAttachments.map(async (att) => {
        let base64Content = '';

        if (Platform.OS !== 'web') {
          base64Content = await FileSystem.readAsStringAsync(att.uri, {
            encoding: 'base64',
          });
        } else {
          const response = await fetch(att.uri);
          const blob = await response.blob();
          const reader = new FileReader();
          base64Content = await new Promise<string>((resolve) => {
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

    const executeEmailSend = async (
      recipientsToSend: EmailCampaignRecipient[],
      emailPayload: PendingEmailCampaign,
      targetSuccessCount: number,
    ) => {
      const processedAttachments = await processAttachmentsForSend(emailPayload.attachments);
      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-email.php` : `${apiUrl}/api/send-email`;
      const EMAIL_CHUNK_SIZE = Math.max(1, Math.min(100, parseInt(emailBatchSize || '0', 10) || 25));
      const effectiveEmailBatchDelayMs = Math.max(0, Math.min(60000, parseInt(emailBatchDelayMs || '0', 10) || 0));
      const aggregatedResults = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };
      const chunkFailures: string[] = [];
      let processedRecipientsCount = 0;
      let sentChunks = 0;

      while (processedRecipientsCount < recipientsToSend.length && aggregatedResults.success < targetSuccessCount) {
        const neededSuccesses = targetSuccessCount - aggregatedResults.success;
        const chunkSizeForTarget = Math.min(
          EMAIL_CHUNK_SIZE,
          neededSuccesses,
          recipientsToSend.length - processedRecipientsCount,
        );
        const chunk = recipientsToSend.slice(
          processedRecipientsCount,
          processedRecipientsCount + chunkSizeForTarget,
        );
        processedRecipientsCount += chunk.length;
        sentChunks += 1;

        try {
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
                senderName: emailPayload.senderName,
                senderEmail: emailPayload.senderEmail,
                replyToEmail: emailPayload.replyToEmail,
                replyToName: emailPayload.replyToName,
                subject: emailPayload.subject,
                message: emailPayload.message,
                htmlContent: emailPayload.htmlContent,
                format: emailPayload.format,
                attachments: processedAttachments,
              },
              recipients: chunk.map(c => ({
                name: c.name,
                email: c.email,
                company: c.company,
                phone: c.phone,
              })),
            }),
          });

          const result = await parseJsonResponseSafe(response);
          if (!response.ok || !result.success) {
            throw new Error(result.error || `Chunk ${sentChunks} failed`);
          }
          const chunkResults = result.results || { success: 0, failed: 0, errors: [] };
          aggregatedResults.success += Number(chunkResults.success || 0);
          aggregatedResults.failed += Number(chunkResults.failed || 0);
          if (Array.isArray(chunkResults.errors)) {
            aggregatedResults.errors.push(...chunkResults.errors);
          }
        } catch (chunkError) {
          const chunkMsg = `Chunk ${sentChunks}: ${(chunkError as Error).message}`;
          chunkFailures.push(chunkMsg);
          aggregatedResults.failed += chunk.length;
          aggregatedResults.errors.push(chunkMsg);
        }

        if (
          processedRecipientsCount < recipientsToSend.length &&
          aggregatedResults.success < targetSuccessCount &&
          effectiveEmailBatchDelayMs > 0
        ) {
          await sleepMs(effectiveEmailBatchDelayMs);
        }
      }

      return {
        aggregatedResults,
        chunkFailures,
        recipientChunksCount: sentChunks,
        chunkSize: EMAIL_CHUNK_SIZE,
        batchDelayMs: effectiveEmailBatchDelayMs,
        processedRecipientsCount,
      };
    };

    setConfirmState({
      title: 'Send Remaining Emails',
      message: `Send remaining campaign now? Target successful sends this run: ${targetSuccessfulSends}.`,
      onConfirm: async () => {
        try {
          setIsSending(true);
          const result = await executeEmailSend(pendingEmailCampaign.recipients, pendingEmailCampaign, targetSuccessfulSends);
          const futureRecipients = pendingEmailCampaign.recipients.slice(result.processedRecipientsCount);
          let queuedRemaining = futureRecipients.length;
          let waitUntil: number | null = null;
          let automationNote = '';

          if (futureRecipients.length > 0) {
            const now = Date.now();
            waitUntil = result.aggregatedResults.success > 0 ? now + EMAIL_SEND_WINDOW_MS : null;
            const updatedPending: PendingEmailCampaign = {
              ...pendingEmailCampaign,
              updatedAt: now,
              lastSuccessAt: result.aggregatedResults.success > 0 ? now : pendingEmailCampaign.lastSuccessAt,
              waitUntil,
              recipients: futureRecipients,
            };
            await savePendingEmailCampaign(updatedPending);
            setSelectedCustomerIds(new Set(futureRecipients.map((r) => r.id)));

            if (waitUntil) {
              const autoQueue = await enqueueRemainingEmailsForAutomation({
                campaignKey: updatedPending.id,
                waitUntil,
                maxPerWindow: maxPerWindow,
                recipients: futureRecipients,
                emailData: {
                  senderName: updatedPending.senderName,
                  senderEmail: updatedPending.senderEmail,
                  replyToEmail: updatedPending.replyToEmail,
                  replyToName: updatedPending.replyToName,
                  subject: updatedPending.subject,
                  message: updatedPending.message,
                  htmlContent: updatedPending.htmlContent,
                  format: updatedPending.format,
                  attachments: updatedPending.attachments,
                },
              });
              automationNote = autoQueue.message;
              if (autoQueue.queued) {
                await savePendingEmailCampaign(null);
                setSelectedCustomerIds(new Set());
              }
            }
          } else {
            queuedRemaining = 0;
            await savePendingEmailCampaign(null);
          }

          const resultMessage = `Sent: ${result.aggregatedResults.success}\nTarget Successful This Run: ${targetSuccessfulSends}\nAttempted: ${result.processedRecipientsCount}\nFailed: ${result.aggregatedResults.failed}\nBatches: ${result.recipientChunksCount}\nBatch Size: ${result.chunkSize}\nBatch Delay: ${result.batchDelayMs} ms${result.chunkFailures.length ? `\nBatch Errors: ${result.chunkFailures.length}` : ''}${
            queuedRemaining > 0 ? `\nQueued Remaining: ${queuedRemaining}` : '\nQueued Remaining: 0'
          }${
            queuedRemaining > 0 && waitUntil ? `\nNext Send Remaining: ${new Date(waitUntil).toLocaleString()}` : ''
          }${
            automationNote ? `\n${automationNote}` : ''
          }${
            result.aggregatedResults.errors.length > 0 ? '\n\nErrors:\n' + result.aggregatedResults.errors.slice(0, 8).join('\n') : ''
          }`;
          Alert.alert('Email Campaign Complete', resultMessage, [{ text: 'OK' }]);
        } catch (error) {
          console.error('[EMAIL CAMPAIGN] Send remaining error:', error);
          Alert.alert('Error', 'Failed to send remaining emails: ' + (error as Error).message);
        } finally {
          setIsSending(false);
        }
      },
    });

    setTimeout(() => {
      setConfirmVisible(true);
    }, 100);
  };

  const sendSMSCampaign = async () => {
    const validationError = validateSMSCampaign();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    const hasDialogSMSConfig = !!(
      dialogSMSSettings?.esms_username &&
      dialogSMSSettings?.esms_password_encrypted
    );
    const hasLegacySMSConfig = !!(smsApiUrl && smsApiKey);

    if (!hasDialogSMSConfig && !hasLegacySMSConfig) {
      Alert.alert(
        'SMS Not Configured',
        'Please configure Dialog eSMS settings (preferred) or legacy SMS API settings before sending messages.',
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
          const mappedSmsRecipients = selectedCustomers.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
          }));
          const invalidSmsRecipients = mappedSmsRecipients.filter(r => !normalizePhoneForCampaign(r.phone));
          const validSmsRecipients = mappedSmsRecipients
            .map(r => ({ ...r, normalizedPhone: normalizePhoneForCampaign(r.phone) }))
            .filter(r => !!r.normalizedPhone);

          if (validSmsRecipients.length === 0) {
            throw new Error('No valid phone numbers found in selected customers');
          }

          if (hasDialogSMSConfig) {
            const SMS_DIALOG_CHUNK_SIZE = 1000;
            const mobileChunks = chunkArray(validSmsRecipients.map(r => r.normalizedPhone), SMS_DIALOG_CHUNK_SIZE);
            let totalSubmitted = 0;
            let totalInvalid = invalidSmsRecipients.length;
            let totalDuplicates = 0;
            let totalCost = 0;
            const providerNotes: string[] = [];
            const chunkErrors: string[] = [];
            let queuedFailedBatches = 0;

            for (let i = 0; i < mobileChunks.length; i++) {
              const chunk = mobileChunks[i];
              console.log(`[SMS CAMPAIGN] Dialog chunk ${i + 1}/${mobileChunks.length} (${chunk.length} recipients)`);
              try {
                const result = await sendDialogSMSCampaign(message, chunk);
                console.log('[SMS CAMPAIGN] Dialog eSMS chunk response:', result);

                if (!result.success) {
                  throw new Error(result.error || 'Failed to send SMS messages');
                }

                totalSubmitted += result.data?.recipients?.length ?? chunk.length;
                totalInvalid += Number(result.data?.invalid_numbers ?? 0);
                totalDuplicates += Number(result.data?.duplicates_removed ?? 0);
                if (typeof result.data?.campaign_cost !== 'undefined' && result.data?.campaign_cost !== null) {
                  totalCost += Number(result.data.campaign_cost) || 0;
                }
                if (result.data?.comment) {
                  providerNotes.push(`Chunk ${i + 1}: ${result.data.comment}`);
                }
              } catch (chunkError) {
                const msg = `Chunk ${i + 1}/${mobileChunks.length}: ${(chunkError as Error).message}`;
                console.error('[SMS CAMPAIGN] Dialog chunk error:', msg);
                chunkErrors.push(msg);
                await queueFailedSMSBatch(
                  'dialog',
                  message,
                  chunk.map((phone) => ({ phone })),
                  msg
                );
                queuedFailedBatches += 1;
                continue;
              }
            }

            let resultMessage = `Submitted: ${totalSubmitted}\nInvalid/Skipped: ${totalInvalid}\nDuplicates Removed: ${totalDuplicates}\nBatches: ${mobileChunks.length}`;
            if (totalCost > 0) {
              resultMessage += `\nTotal Cost (reported): Rs ${totalCost}`;
            }
            if (chunkErrors.length > 0) {
              resultMessage += `\nBatch Errors: ${chunkErrors.length}`;
            }
            if (queuedFailedBatches > 0) {
              resultMessage += `\nQueued Failed Batches: ${queuedFailedBatches}`;
            }
            const allSmsNotes = [...chunkErrors, ...providerNotes];
            if (allSmsNotes.length > 0) {
              resultMessage += `\n\nDetails:\n${allSmsNotes.slice(0, 6).join('\n')}`;
            }

            Alert.alert('SMS Campaign Submitted', resultMessage, [{ text: 'OK' }]);
            await refreshFailedSMSBatchQueue();

            if (totalSubmitted > 0) {
              setMessage('');
              setSelectedCustomerIds(new Set());
            }
          } else {
            const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
            const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-sms.php` : `${apiUrl}/api/send-sms`;
            const LEGACY_SMS_CHUNK_SIZE = 200;
            const recipientChunks = chunkArray(
              validSmsRecipients.map(r => ({ name: r.name, phone: r.normalizedPhone })),
              LEGACY_SMS_CHUNK_SIZE
            );
            const aggregatedResults = {
              success: 0,
              failed: 0,
              errors: [] as string[],
            };
            const chunkErrors: string[] = [];
            let queuedFailedBatches = 0;

            for (let i = 0; i < recipientChunks.length; i++) {
              const chunk = recipientChunks[i];
              console.log(`[SMS CAMPAIGN] Legacy chunk ${i + 1}/${recipientChunks.length} (${chunk.length} recipients)`);
              try {
                const response = await fetch(phpEndpoint, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    message: message,
                    recipients: chunk,
                    transaction_id: Date.now() + i,
                  }),
                });

                const result = await parseJsonResponseSafe(response);
                console.log('[SMS CAMPAIGN] Legacy SMS chunk response:', result);

                if (!response.ok || !result.success) {
                  throw new Error(result.error || 'Failed to send SMS messages');
                }

                const chunkResults = result.results || { success: 0, failed: 0, errors: [] };
                aggregatedResults.success += Number(chunkResults.success || 0);
                aggregatedResults.failed += Number(chunkResults.failed || 0);
                if (Array.isArray(chunkResults.errors)) {
                  aggregatedResults.errors.push(...chunkResults.errors);
                }
              } catch (chunkError) {
                const msg = `Chunk ${i + 1}/${recipientChunks.length}: ${(chunkError as Error).message}`;
                console.error('[SMS CAMPAIGN] Legacy chunk error:', msg);
                chunkErrors.push(msg);
                aggregatedResults.failed += chunk.length;
                aggregatedResults.errors.push(msg);
                await queueFailedSMSBatch('legacy', message, chunk, msg);
                queuedFailedBatches += 1;
                continue;
              }
            }

            if (invalidSmsRecipients.length > 0) {
              aggregatedResults.failed += invalidSmsRecipients.length;
              aggregatedResults.errors.push(
                ...invalidSmsRecipients.slice(0, 20).map(r => `${r.name || 'Unknown'}: Invalid/missing phone`)
              );
              if (invalidSmsRecipients.length > 20) {
                aggregatedResults.errors.push(`... and ${invalidSmsRecipients.length - 20} more invalid/missing phones`);
              }
            }

            const resultMessage = `Sent: ${aggregatedResults.success}\nFailed: ${aggregatedResults.failed}\nSkipped Invalid Phones: ${invalidSmsRecipients.length}\nBatches: ${recipientChunks.length}${chunkErrors.length ? `\nBatch Errors: ${chunkErrors.length}` : ''}${queuedFailedBatches ? `\nQueued Failed Batches: ${queuedFailedBatches}` : ''}${
              aggregatedResults.errors.length > 0 ? '\n\nErrors:\n' + aggregatedResults.errors.slice(0, 8).join('\n') : ''
            }`;

            Alert.alert(
              'SMS Campaign Complete',
              resultMessage,
              [{ text: 'OK' }]
            );
            await refreshFailedSMSBatchQueue();

            if (aggregatedResults.success > 0) {
              setMessage('');
              setSelectedCustomerIds(new Set());
            }
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

  const loadWhatsAppStatusEvents = async () => {
    console.log('[WhatsApp Status] === loadWhatsAppStatusEvents called ===');
    try {
      setLoadingStatusEvents(true);
      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com')
        ? `${apiUrl}/Tracker/api/get-whatsapp-statuses.php?limit=200`
        : `${apiUrl}/api/get-whatsapp-statuses?limit=200`;

      console.log('[WhatsApp Status] Fetching from:', phpEndpoint);
      const response = await fetch(phpEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to load WhatsApp status events');
      }

      const statuses = Array.isArray(result.statuses) ? result.statuses : [];
      setWhatsappStatusEvents(statuses);
      console.log('[WhatsApp Status] Loaded events:', statuses.length);
    } catch (error) {
      console.error('[WhatsApp Status] Error:', error);
      Alert.alert('Error', 'Failed to load WhatsApp delivery status events: ' + (error as Error).message);
    } finally {
      setLoadingStatusEvents(false);
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

  const sendWhatsAppTestMessage = async () => {
    try {
      if (!whatsappAccessToken || !whatsappPhoneNumberId) {
        Alert.alert('Configuration Missing', 'Please configure WhatsApp settings before sending a test message.');
        return;
      }
      if (!whatsappTestPhone.trim()) {
        Alert.alert('Missing Number', 'Please enter a test WhatsApp number.');
        return;
      }
      if (!whatsappTestUseTemplate && !whatsappTestMessage.trim()) {
        Alert.alert('Missing Message', 'Please enter a test message.');
        return;
      }
      if (whatsappTestUseTemplate && !whatsappTestTemplateName.trim()) {
        Alert.alert('Missing Template Name', 'Please enter an approved WhatsApp template name.');
        return;
      }

      setSendingWhatsAppTest(true);
      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8081');
      const phpEndpoint = apiUrl.includes('tracker.tecclk.com') ? `${apiUrl}/Tracker/api/send-whatsapp.php` : `${apiUrl}/api/send-whatsapp`;

      const templateParameters = parseWhatsAppTemplateParameters(whatsappTestTemplateParamsText);
      const templateHeaderParameters = parseWhatsAppTemplateParameters(whatsappTestTemplateHeaderParamsText);
      const templateButtonParameters = parseWhatsAppTemplateParameters(whatsappTestTemplateButtonParamsText);
      const testRecipients = [
        {
          name: 'Test Recipient',
          phone: whatsappTestPhone.trim(),
        },
      ];

      const response = await fetch(phpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accessToken: whatsappAccessToken,
          phoneNumberId: whatsappPhoneNumberId,
          message: whatsappTestMessage.trim(),
          useTemplate: whatsappTestUseTemplate,
          templateName: whatsappTestUseTemplate ? whatsappTestTemplateName.trim() : undefined,
          templateLanguage: whatsappTestUseTemplate ? (whatsappTestTemplateLanguage.trim() || 'en_US') : undefined,
          templateParameters: whatsappTestUseTemplate ? templateParameters : undefined,
          templateHeaderParameters: whatsappTestUseTemplate ? templateHeaderParameters : undefined,
          templateHeaderMediaUrl: whatsappTestUseTemplate ? whatsappTestTemplateHeaderMediaUrl.trim() : undefined,
          templateHeaderMediaType: whatsappTestUseTemplate ? whatsappTestTemplateHeaderMediaType : undefined,
          templateButtonParameters: whatsappTestUseTemplate ? templateButtonParameters : undefined,
          recipients: testRecipients,
        }),
      });

      const rawText = await response.text();
      let result: any;
      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Server returned non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 160)}`);
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to send WhatsApp test message');
      }

      const accepted = result.results?.accepted ?? result.results?.success ?? 0;
      const rejected = result.results?.failed ?? 0;
      const pending = result.results?.delivery_pending ?? 0;
      const firstError = Array.isArray(result.results?.errors) && result.results.errors.length > 0
        ? `\n\nError: ${result.results.errors[0]}`
        : '';
      const debugSummary = buildWhatsAppSendDebugSummary({
        mode: 'test',
        useTemplate: whatsappTestUseTemplate,
        templateName: whatsappTestUseTemplate ? whatsappTestTemplateName.trim() : undefined,
        templateLanguage: whatsappTestUseTemplate ? (whatsappTestTemplateLanguage.trim() || 'en_US') : undefined,
        templateParameters: whatsappTestUseTemplate ? templateParameters : undefined,
        templateHeaderParameters: whatsappTestUseTemplate ? templateHeaderParameters : undefined,
        templateHeaderMediaUrl: whatsappTestUseTemplate ? whatsappTestTemplateHeaderMediaUrl.trim() : undefined,
        templateHeaderMediaType: whatsappTestUseTemplate ? whatsappTestTemplateHeaderMediaType : undefined,
        templateButtonParameters: whatsappTestUseTemplate ? templateButtonParameters : undefined,
        recipients: testRecipients,
        backendDebug: result.debug,
        backendErrors: result.results?.errors,
      });

      Alert.alert(
        'WhatsApp Test Queued',
        `Queued by WhatsApp API: ${accepted}\nAPI Rejected: ${rejected}\nDelivery Pending: ${pending}${firstError}\n\n${debugSummary}\n\nFinal delivery depends on policy window/templates and webhook status events.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('[WhatsApp Test Send] Error:', error);
      Alert.alert('WhatsApp Test Failed', (error as Error).message);
    } finally {
      setSendingWhatsAppTest(false);
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
      title: 'Send WhatsApp Cloud API Campaign',
      message: whatsappCampaignUseTemplate
        ? `Send WhatsApp template "${getEffectiveWhatsAppCampaignTemplateConfig().name || '(template)'}" to ${selectedCustomers.length} customer(s)?`
        : `Send WhatsApp message to ${selectedCustomers.length} customer(s)?`,
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
          console.log('[WhatsApp CAMPAIGN] Sending via single backend request (Cloud API pattern)...');

          const effectiveTemplateConfig = getEffectiveWhatsAppCampaignTemplateConfig();
          const templateParameters = effectiveTemplateConfig.params;
          const templateHeaderParameters = effectiveTemplateConfig.headerParams || [];
          const templateButtonParameters = effectiveTemplateConfig.buttonParams || [];
          const campaignRecipients = selectedCustomers.map(c => ({
            name: c.name,
            phone: c.phone,
          }));

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
              useTemplate: whatsappCampaignUseTemplate,
              templateName: whatsappCampaignUseTemplate ? effectiveTemplateConfig.name : undefined,
              templateLanguage: whatsappCampaignUseTemplate ? effectiveTemplateConfig.language : undefined,
              templateParameters: whatsappCampaignUseTemplate ? templateParameters : undefined,
              templateHeaderParameters: whatsappCampaignUseTemplate ? templateHeaderParameters : undefined,
              templateHeaderMediaUrl: whatsappCampaignUseTemplate ? (effectiveTemplateConfig.headerMediaUrl || '') : undefined,
              templateHeaderMediaType: whatsappCampaignUseTemplate ? (effectiveTemplateConfig.headerMediaType || 'image') : undefined,
              templateButtonParameters: whatsappCampaignUseTemplate ? templateButtonParameters : undefined,
              recipients: campaignRecipients,
            }),
          });

          const rawText = await response.text();
          let result: any;
          try {
            result = rawText ? JSON.parse(rawText) : {};
          } catch {
            throw new Error(`Server returned non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 160)}`);
          }

          if (!response.ok || !result.success) {
            throw new Error(result.error || result.results?.errors?.[0] || 'Failed to send WhatsApp campaign');
          }

          const successCount = result.results?.accepted ?? result.results?.success ?? 0;
          const failCount = result.results?.failed ?? 0;
          const pendingCount = result.results?.delivery_pending ?? 0;
          const errors: string[] = Array.isArray(result.results?.errors) ? result.results.errors : [];
          const debugSummary = buildWhatsAppSendDebugSummary({
            mode: 'campaign',
            useTemplate: whatsappCampaignUseTemplate,
            templateName: whatsappCampaignUseTemplate ? effectiveTemplateConfig.name : undefined,
            templateLanguage: whatsappCampaignUseTemplate ? effectiveTemplateConfig.language : undefined,
            templateParameters: whatsappCampaignUseTemplate ? templateParameters : undefined,
            templateHeaderParameters: whatsappCampaignUseTemplate ? templateHeaderParameters : undefined,
            templateHeaderMediaUrl: whatsappCampaignUseTemplate ? effectiveTemplateConfig.headerMediaUrl : undefined,
            templateHeaderMediaType: whatsappCampaignUseTemplate ? effectiveTemplateConfig.headerMediaType : undefined,
            templateButtonParameters: whatsappCampaignUseTemplate ? templateButtonParameters : undefined,
            recipients: campaignRecipients,
            backendDebug: result.debug,
            backendErrors: errors,
          });

          if (successCount > 0) {
            setSelectedCustomerIds(prev => {
              const next = new Set(prev);
              selectedCustomers.forEach(c => next.delete(c.id));
              return next;
            });
          }

          const resultMessage = `Queued by WhatsApp API: ${successCount}\nAPI Rejected: ${failCount}\nDelivery Pending: ${pendingCount}${
            errors.length > 0 ? '\n\nErrors:\n' + errors.slice(0, 5).join('\n') : ''
          }\n\n${debugSummary}\n\nNote: "Queued" means WhatsApp accepted the request for processing. Final delivery depends on recipient status, policy window, templates, and webhook delivery events (sent/delivered/read/failed).`;

          Alert.alert(
            'WhatsApp Campaign Queued',
            resultMessage,
            [{ text: 'OK' }]
          );

          if (successCount > 0) {
            if (!whatsappCampaignUseTemplate) {
              setMessage('');
              setWhatsappMediaUri('');
              setWhatsappCaption('');
            }
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

        {(campaignType === 'email' || campaignType === 'sms') && (
          <TouchableOpacity
            style={styles.advancedSettingsTrigger}
            onPress={() => setShowAdvancedSettingsModal(true)}
          >
            <Settings size={18} color={Colors.light.tint} />
            <Text style={styles.advancedSettingsTriggerText}>
              {campaignType === 'email' ? 'Email Advanced Settings' : 'SMS Settings'}
            </Text>
          </TouchableOpacity>
        )}

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

              <TouchableOpacity
                style={styles.selectAllButton}
                onPress={() => setEmailNoReplyMode(!emailNoReplyMode)}
              >
                {emailNoReplyMode ? (
                  <CheckSquare size={20} color={Colors.light.tint} />
                ) : (
                  <Square size={20} color={Colors.light.tabIconDefault} />
                )}
                <Text style={styles.selectAllText}>No-reply mode (set Reply-To to noreply@...)</Text>
              </TouchableOpacity>
              {emailNoReplyMode && (
                <Text style={styles.charCount}>
                  Reply-To will be: {derivedNoReplyEmail || 'Enter a valid Sender Email first'}
                </Text>
              )}

              <Text style={styles.helpText}>
                Batch controls are in Email Advanced Settings (button above).
              </Text>

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

              <TouchableOpacity
                style={styles.selectAllButton}
                onPress={() => setEmailDailyLimitEnabled(!emailDailyLimitEnabled)}
              >
                {emailDailyLimitEnabled ? (
                  <CheckSquare size={20} color={Colors.light.tint} />
                ) : (
                  <Square size={20} color={Colors.light.tabIconDefault} />
                )}
                <Text style={styles.selectAllText}>Enable campaign daily send cap (24h)</Text>
              </TouchableOpacity>

              {emailDailyLimitEnabled && (
                <>
                  <Text style={styles.label}>Max Emails Per 24 Hours</Text>
                  <TextInput
                    style={styles.input}
                    value={emailDailyLimitMax}
                    onChangeText={setEmailDailyLimitMax}
                    placeholder="500"
                    keyboardType="number-pad"
                  />
                  <Text style={styles.helpText}>
                    Sends up to this amount now, then queues the rest for "Send remaining" after 24 hours.
                  </Text>
                </>
              )}

              <Text style={styles.label}>Subject *</Text>
              <TextInput
                style={styles.input}
                value={subject}
                onChangeText={setSubject}
                placeholder="Email subject"
              />
              <Text style={styles.charCount}>Placeholders: {'{{name}}'}, {'{{first_name}}'}, {'{{company}}'}</Text>

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
                  <Text style={styles.charCount}>Placeholders: {'{{name}}'}, {'{{first_name}}'}, {'{{company}}'}</Text>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.selectAllButton}
                    onPress={() => setUseNewsletterBuilder(!useNewsletterBuilder)}
                  >
                    {useNewsletterBuilder ? (
                      <CheckSquare size={20} color={Colors.light.tint} />
                    ) : (
                      <Square size={20} color={Colors.light.tabIconDefault} />
                    )}
                    <Text style={styles.selectAllText}>Newsletter Builder Mode</Text>
                  </TouchableOpacity>
                  <Text style={styles.helpText}>
                    Add movable text boxes and image holders. Text supports font, size, and color settings.
                  </Text>

                  {useNewsletterBuilder ? (
                    <View style={styles.newsletterBuilderCard}>
                      <View style={styles.newsletterBuilderActions}>
                        <TouchableOpacity style={styles.newsletterActionButton} onPress={addNewsletterTextBlock}>
                          <Text style={styles.newsletterActionButtonText}>Add Text Box</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.newsletterActionButton} onPress={addNewsletterImageBlock}>
                          <Text style={styles.newsletterActionButtonText}>Add Image Holder</Text>
                        </TouchableOpacity>
                      </View>

                      {newsletterBlocks.map((block, index) => (
                        <View key={block.id} style={styles.newsletterBlockCard}>
                          <View style={styles.newsletterBlockHeader}>
                            <Text style={styles.newsletterBlockTitle}>
                              {block.type === 'text' ? `Text Box ${index + 1}` : `Image Holder ${index + 1}`}
                            </Text>
                            <View style={styles.newsletterBlockHeaderActions}>
                              <TouchableOpacity
                                style={styles.newsletterMiniButton}
                                onPress={() => moveNewsletterBlock(block.id, 'up')}
                                disabled={index === 0}
                              >
                                <Text style={styles.newsletterMiniButtonText}>Up</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.newsletterMiniButton}
                                onPress={() => moveNewsletterBlock(block.id, 'down')}
                                disabled={index === newsletterBlocks.length - 1}
                              >
                                <Text style={styles.newsletterMiniButtonText}>Down</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.newsletterMiniDeleteButton}
                                onPress={() => removeNewsletterBlock(block.id)}
                              >
                                <Text style={styles.newsletterMiniDeleteButtonText}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          </View>

                          {block.type === 'text' ? (
                            <>
                              <TextInput
                                style={[styles.input, styles.newsletterTextArea]}
                                value={block.content}
                                onChangeText={(value) => updateNewsletterTextBlock(block.id, { content: value })}
                                placeholder="Write text content..."
                                multiline
                                numberOfLines={5}
                                textAlignVertical="top"
                              />
                              <Text style={styles.label}>Font Family</Text>
                              <View style={styles.newsletterPickerWrap}>
                                <Picker
                                  selectedValue={block.fontFamily}
                                  onValueChange={(value) => updateNewsletterTextBlock(block.id, { fontFamily: String(value) })}
                                  style={styles.newsletterPicker}
                                >
                                  {newsletterFontOptions.map((fontOption) => (
                                    <Picker.Item
                                      key={`${block.id}-${fontOption.label}`}
                                      label={fontOption.label}
                                      value={fontOption.value}
                                    />
                                  ))}
                                </Picker>
                              </View>
                              <Text style={styles.label}>Font Size (px)</Text>
                              <TextInput
                                style={styles.input}
                                value={String(block.fontSize)}
                                onChangeText={(value) => {
                                  const parsed = parseInt(value || '0', 10);
                                  updateNewsletterTextBlock(block.id, { fontSize: Number.isFinite(parsed) ? parsed : 16 });
                                }}
                                placeholder="16"
                                keyboardType="number-pad"
                              />
                              <Text style={styles.label}>Font Color Picker</Text>
                              <View style={styles.newsletterColorRow}>
                                {newsletterColorPalette.map((color) => (
                                  <TouchableOpacity
                                    key={`${block.id}-${color}`}
                                    style={[
                                      styles.newsletterColorSwatch,
                                      { backgroundColor: color },
                                      block.color === color && styles.newsletterColorSwatchActive,
                                      color === '#FFFFFF' && styles.newsletterColorSwatchWhite,
                                    ]}
                                    onPress={() => updateNewsletterTextBlock(block.id, { color })}
                                  />
                                ))}
                              </View>
                              <TextInput
                                style={styles.input}
                                value={block.color}
                                onChangeText={(value) => updateNewsletterTextBlock(block.id, { color: value })}
                                placeholder="#111111"
                                autoCapitalize="none"
                              />
                            </>
                          ) : (
                            <>
                              <Text style={styles.label}>Attach Image</Text>
                              <TouchableOpacity
                                style={styles.newsletterAttachButton}
                                onPress={() => pickNewsletterImageForBlock(block.id)}
                              >
                                <ImageIcon size={20} color={Colors.light.tint} />
                                <Text style={styles.newsletterAttachButtonText}>
                                  {block.imageUrl ? 'Browse & Replace Image' : 'Browse & Attach Image'}
                                </Text>
                              </TouchableOpacity>
                              {block.imageUrl ? (
                                <View style={styles.newsletterImagePreviewWrap}>
                                  <Image
                                    source={{ uri: block.imageUrl }}
                                    style={[
                                      styles.newsletterImagePreview,
                                      {
                                        width: `${Math.max(10, Math.min(100, Number(block.widthPercent) || 100))}%`,
                                        height: (Number(block.heightPx) || 0) > 0 ? Number(block.heightPx) : 180,
                                      },
                                    ]}
                                    resizeMode={(Number(block.heightPx) || 0) > 0 ? 'cover' : 'contain'}
                                  />
                                </View>
                              ) : (
                                <View style={styles.newsletterImagePlaceholder}>
                                  <ImageIcon size={28} color={Colors.light.tabIconDefault} />
                                  <Text style={styles.newsletterImagePlaceholderText}>No image attached</Text>
                                </View>
                              )}
                              <Text style={styles.helpText}>
                                You can also paste an external image URL (optional).
                              </Text>
                              <TextInput
                                style={styles.input}
                                value={block.imageUrl.startsWith('data:') ? '' : block.imageUrl}
                                onChangeText={(value) => updateNewsletterImageBlock(block.id, { imageUrl: value })}
                                placeholder="https://example.com/image.jpg"
                                autoCapitalize="none"
                                keyboardType="url"
                              />
                              <Text style={styles.label}>Image Width (%)</Text>
                              <TextInput
                                style={styles.input}
                                value={String(block.widthPercent)}
                                onChangeText={(value) => {
                                  const parsed = parseInt(value || '0', 10);
                                  updateNewsletterImageBlock(block.id, {
                                    widthPercent: Number.isFinite(parsed) ? parsed : 100,
                                  });
                                }}
                                placeholder="100"
                                keyboardType="number-pad"
                              />
                              <Text style={styles.label}>Image Height (px, 0 = auto)</Text>
                              <TextInput
                                style={styles.input}
                                value={String(block.heightPx)}
                                onChangeText={(value) => {
                                  const parsed = parseInt(value || '0', 10);
                                  updateNewsletterImageBlock(block.id, {
                                    heightPx: Number.isFinite(parsed) ? parsed : 0,
                                  });
                                }}
                                placeholder="0"
                                keyboardType="number-pad"
                              />
                              <Text style={styles.label}>Caption (optional)</Text>
                              <TextInput
                                style={styles.input}
                                value={block.caption}
                                onChangeText={(value) => updateNewsletterImageBlock(block.id, { caption: value })}
                                placeholder="Image caption"
                              />
                            </>
                          )}
                        </View>
                      ))}

                      <Text style={styles.label}>Live Newsletter Preview</Text>
                      <View style={styles.newsletterLivePreview}>
                        {newsletterBlocks.map((previewBlock) =>
                          previewBlock.type === 'text' ? (
                            <Text
                              key={`preview-${previewBlock.id}`}
                              style={{
                                marginVertical: 8,
                                color: previewBlock.color || '#111111',
                                fontFamily: previewBlock.fontFamily,
                                fontSize: Math.max(10, Math.min(72, Number(previewBlock.fontSize) || 16)),
                                lineHeight: Math.max(16, (Number(previewBlock.fontSize) || 16) + 6),
                              }}
                            >
                              {previewBlock.content || ' '}
                            </Text>
                          ) : (
                            <View key={`preview-${previewBlock.id}`} style={styles.newsletterLivePreviewImageWrap}>
                              {previewBlock.imageUrl ? (
                                <Image
                                  source={{ uri: previewBlock.imageUrl }}
                                  style={{
                                    width: `${Math.max(10, Math.min(100, Number(previewBlock.widthPercent) || 100))}%`,
                                    height: (Number(previewBlock.heightPx) || 0) > 0
                                      ? Number(previewBlock.heightPx)
                                      : 180,
                                    alignSelf: 'center',
                                    borderRadius: 8,
                                  }}
                                  resizeMode={(Number(previewBlock.heightPx) || 0) > 0 ? 'cover' : 'contain'}
                                />
                              ) : (
                                <View style={styles.newsletterImagePlaceholder}>
                                  <ImageIcon size={28} color={Colors.light.tabIconDefault} />
                                  <Text style={styles.newsletterImagePlaceholderText}>No image attached</Text>
                                </View>
                              )}
                              {!!previewBlock.caption && (
                                <Text style={styles.newsletterPreviewCaption}>{previewBlock.caption}</Text>
                              )}
                            </View>
                          ),
                        )}
                      </View>
                      <Text style={styles.helpText}>
                        HTML is generated from this layout automatically when sending.
                      </Text>
                    </View>
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
                  <Text style={styles.charCount}>Placeholders: {'{{name}}'}, {'{{first_name}}'}, {'{{company}}'}</Text>
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
            <Text style={styles.helpText}>
              SMS configuration is available in the SMS Settings popup (button above).
            </Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Dialog Credit Remaining</Text>
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  {loadingDialogCredit
                    ? 'Checking Dialog eSMS credit...'
                    : `Credit remaining${dialogCreditSource === 'last_known' ? ' (last known)' : ''}: ${dialogCreditRemaining !== null ? dialogCreditRemaining : 'Not available'}`}
                </Text>

                {dialogCreditUpdatedAt ? (
                  <Text style={styles.helpText}>
                    {dialogCreditSource === 'last_known' ? 'Last known from campaign: ' : 'Last checked: '}
                    {new Date(dialogCreditUpdatedAt).toLocaleString()}
                  </Text>
                ) : null}

                {!!dialogCreditError && (
                  <Text style={styles.dialogCreditErrorText}>{dialogCreditError}</Text>
                )}

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.testButton]}
                    onPress={() => refreshDialogCredit(true)}
                    disabled={loadingDialogCredit}
                  >
                    {loadingDialogCredit ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <Text style={styles.testButtonText}>Refresh Credit</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.saveSettingsButton]}
                    onPress={openDialogTopUp}
                  >
                    <Text style={styles.saveSettingsButtonText}>Top Up in Dialog</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

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

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Failed SMS Batches</Text>

              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Queued failed SMS batches: {loadingFailedSmsBatches ? '...' : failedSmsBatches.length}. Batch-level failures (network/provider/server) can be retried later without resending successful batches.
                </Text>
              </View>

              {failedSmsBatches.length > 0 && (
                <Text style={styles.helpText}>
                  Oldest queued batch: {new Date(Math.min(...failedSmsBatches.map((b) => b.createdAt))).toLocaleString()}
                  {'\n'}Latest error: {failedSmsBatches[0]?.lastError || '-'}
                </Text>
              )}

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.testButton]}
                  onPress={refreshFailedSMSBatchQueue}
                  disabled={loadingFailedSmsBatches || retryingFailedSmsBatches}
                >
                  {loadingFailedSmsBatches ? (
                    <ActivityIndicator size="small" color={Colors.light.tint} />
                  ) : (
                    <Text style={styles.testButtonText}>Refresh Queue</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.saveSettingsButton, failedSmsBatches.length === 0 && { opacity: 0.6 }]}
                  onPress={retryFailedSMSBatchesNow}
                  disabled={retryingFailedSmsBatches || failedSmsBatches.length === 0}
                >
                  {retryingFailedSmsBatches ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveSettingsButtonText}>Retry Failed Batches</Text>
                  )}
                </TouchableOpacity>
              </View>
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

                <Text style={styles.label}>Test WhatsApp Number</Text>
                <TextInput
                  style={styles.input}
                  value={whatsappTestPhone}
                  onChangeText={setWhatsappTestPhone}
                  placeholder="e.g., 0771234567 or 94771234567"
                  keyboardType="phone-pad"
                />

                <Text style={styles.label}>Test WhatsApp Message</Text>
                <TextInput
                  style={[styles.input, styles.captionInput]}
                  value={whatsappTestMessage}
                  onChangeText={setWhatsappTestMessage}
                  placeholder="Enter a short test WhatsApp message"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  editable={!whatsappTestUseTemplate}
                />

                <TouchableOpacity
                  style={[styles.actionButton, styles.saveSettingsButton, { marginTop: 12 }]}
                  onPress={() => setWhatsappTestUseTemplate((prev) => !prev)}
                >
                  <Text style={styles.saveSettingsButtonText}>
                    {whatsappTestUseTemplate ? 'Template Mode: ON (Tap to use text)' : 'Template Mode: OFF (Tap to use template)'}
                  </Text>
                </TouchableOpacity>

                {whatsappTestUseTemplate && (
                  <>
                    <Text style={[styles.label, { marginTop: 12 }]}>Template Name *</Text>
                    <TextInput
                      style={styles.input}
                      value={whatsappTestTemplateName}
                      onChangeText={setWhatsappTestTemplateName}
                      placeholder="Approved template name (e.g. order_update)"
                      autoCapitalize="none"
                    />

                    <Text style={styles.label}>Template Language Code *</Text>
                    <TextInput
                      style={styles.input}
                      value={whatsappTestTemplateLanguage}
                      onChangeText={setWhatsappTestTemplateLanguage}
                      placeholder="e.g. en_US"
                      autoCapitalize="none"
                    />

                    <Text style={styles.label}>Template Variables (optional, comma-separated)</Text>
                    <TextInput
                      style={[styles.input, styles.captionInput]}
                      value={whatsappTestTemplateParamsText}
                      onChangeText={setWhatsappTestTemplateParamsText}
                      placeholder="e.g. John, Order #1234"
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                    />
                    <Text style={styles.helpText}>
                      Use this for body placeholders in the same order as the template variables.
                    </Text>

                    <Text style={[styles.label, { marginTop: 12 }]}>Header Text Variables (optional, comma-separated)</Text>
                    <TextInput
                      style={[styles.input, styles.captionInput]}
                      value={whatsappTestTemplateHeaderParamsText}
                      onChangeText={setWhatsappTestTemplateHeaderParamsText}
                      placeholder="For header text placeholders only (if template header has {{ }} )"
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                    />
                    <Text style={styles.helpText}>
                      Leave blank for static header text. Footer is static and does not need parameters.
                    </Text>

                    <Text style={[styles.label, { marginTop: 12 }]}>Header Media URL (optional, for image/video/document header templates)</Text>
                    <TextInput
                      style={styles.input}
                      value={whatsappTestTemplateHeaderMediaUrl}
                      onChangeText={setWhatsappTestTemplateHeaderMediaUrl}
                      placeholder="https://... (must be publicly accessible)"
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                    <Text style={styles.label}>Header Media Type</Text>
                    <View style={styles.mediaButtonsRow}>
                      {(['image', 'video', 'document'] as const).map((type) => (
                        <TouchableOpacity
                          key={`wa-test-header-${type}`}
                          style={[
                            styles.mediaButton,
                            whatsappTestTemplateHeaderMediaType === type && {
                              borderColor: Colors.light.tint,
                              backgroundColor: Colors.light.secondary,
                            },
                          ]}
                          onPress={() => setWhatsappTestTemplateHeaderMediaType(type)}
                        >
                          <Text style={styles.mediaButtonText}>{type.toUpperCase()}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={[styles.label, { marginTop: 12 }]}>Button URL Variables (optional, comma-separated)</Text>
                    <TextInput
                      style={[styles.input, styles.captionInput]}
                      value={whatsappTestTemplateButtonParamsText}
                      onChangeText={setWhatsappTestTemplateButtonParamsText}
                      placeholder="For dynamic URL button suffix params (button 1, button 2...)"
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                    />
                    <Text style={styles.helpText}>
                      Enter button URL variables in button order. Quick reply buttons usually need no parameters.
                    </Text>
                  </>
                )}

                <TouchableOpacity
                  style={[styles.actionButton, styles.testButton, { marginTop: 12 }]}
                  onPress={sendWhatsAppTestMessage}
                  disabled={sendingWhatsAppTest}
                >
                  {sendingWhatsAppTest ? (
                    <ActivityIndicator size="small" color={Colors.light.tint} />
                  ) : (
                    <Text style={styles.testButtonText}>
                      {whatsappTestUseTemplate ? 'Send Test WhatsApp Template' : 'Send Test WhatsApp Message'}
                    </Text>
                  )}
                </TouchableOpacity>

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

                <TouchableOpacity
                  style={styles.inboxToggle}
                  onPress={() => {
                    const newState = !showWhatsAppStatusEvents;
                    console.log('[WhatsApp Status] Toggling status panel:', newState);
                    setShowWhatsAppStatusEvents(newState);
                    if (newState) {
                      loadWhatsAppStatusEvents();
                    }
                  }}
                >
                  <View style={styles.settingsToggleLeft}>
                    <MessageSquare size={20} color={Colors.light.tint} />
                    <Text style={styles.settingsToggleText}>Delivery Status Events ({whatsappStatusEvents.length})</Text>
                  </View>
                  {showWhatsAppStatusEvents ? (
                    <ChevronUp size={20} color={Colors.light.tint} />
                  ) : (
                    <ChevronDown size={20} color={Colors.light.tint} />
                  )}
                </TouchableOpacity>

                {showWhatsAppStatusEvents && (
                  <View style={styles.inboxContainer}>
                    <View style={styles.inboxHeader}>
                      <Text style={styles.inboxTitle}>Delivery Status Events</Text>
                      <TouchableOpacity
                        style={styles.refreshButton}
                        onPress={() => loadWhatsAppStatusEvents()}
                        disabled={loadingStatusEvents}
                      >
                        {loadingStatusEvents ? (
                          <ActivityIndicator size="small" color={Colors.light.tint} />
                        ) : (
                          <Text style={styles.refreshButtonText}>Refresh</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {whatsappStatusEvents.length === 0 && !loadingStatusEvents && (
                      <View style={styles.emptyInbox}>
                        <MessageSquare size={48} color={Colors.light.tabIconDefault} />
                        <Text style={styles.emptyInboxText}>No delivery events yet</Text>
                        <Text style={styles.emptyInboxSubtext}>
                          WhatsApp webhook status callbacks (sent/delivered/read/failed) will appear here
                        </Text>
                      </View>
                    )}

                    {whatsappStatusEvents.length > 0 && (
                      <View style={styles.messageListContainer}>
                        {whatsappStatusEvents.map((event, index) => {
                          const eventTs = Number(event.timestamp || event.receivedAt || 0);
                          const eventMs = eventTs > 0 ? (eventTs > 9999999999 ? eventTs : eventTs * 1000) : Date.now();
                          const status = String(event.status || 'unknown').toLowerCase();
                          const isFailure = status === 'failed' || !!event.errorTitle || !!event.errorMessage;
                          return (
                            <View key={event.id || `${event.wamid || 'wa'}_${index}`} style={styles.messageItem}>
                              <View style={styles.messageHeader}>
                                <Text style={styles.messageSender}>{(event.recipient_id || 'Unknown recipient').toString()}</Text>
                                <Text style={styles.messageTime}>{new Date(eventMs).toLocaleString()}</Text>
                              </View>
                              <View style={styles.statusRow}>
                                <View
                                  style={[
                                    styles.statusBadge,
                                    status === 'delivered' && styles.statusBadgeDelivered,
                                    status === 'read' && styles.statusBadgeRead,
                                    status === 'sent' && styles.statusBadgeSent,
                                    isFailure && styles.statusBadgeFailed,
                                  ]}
                                >
                                  <Text style={styles.statusBadgeText}>{status.toUpperCase()}</Text>
                                </View>
                                {event.conversationOriginType ? (
                                  <Text style={styles.messageTypeLabel}>Origin: {event.conversationOriginType}</Text>
                                ) : null}
                              </View>
                              {event.wamid ? (
                                <Text style={styles.messageTypeLabel}>WAMID: {String(event.wamid)}</Text>
                              ) : null}
                              {event.pricingCategory || event.pricingModel ? (
                                <Text style={styles.messageTypeLabel}>
                                  Pricing: {event.pricingCategory || 'n/a'} {event.pricingModel ? `(${event.pricingModel})` : ''}
                                </Text>
                              ) : null}
                              {(event.errorTitle || event.errorMessage || event.errorCode) ? (
                                <Text style={styles.statusErrorText}>
                                  {event.errorCode ? `[${event.errorCode}] ` : ''}
                                  {event.errorTitle || event.errorMessage || 'Delivery failed'}
                                  {event.errorMessage && event.errorTitle && event.errorMessage !== event.errorTitle ? ` - ${event.errorMessage}` : ''}
                                </Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>WhatsApp Message</Text>
              <Text style={styles.helpText}>
                Cloud API best practice: use approved templates for campaigns (especially outside the 24-hour window). Text/media mode is available for service-window messaging.
              </Text>

              <TouchableOpacity
                style={[styles.actionButton, styles.saveSettingsButton, { marginTop: 8 }]}
                onPress={() => setWhatsappCampaignUseTemplate((prev) => !prev)}
              >
                <Text style={styles.saveSettingsButtonText}>
                  {whatsappCampaignUseTemplate ? 'Campaign Mode: TEMPLATE (Tap for text/media)' : 'Campaign Mode: TEXT/MEDIA (Tap for template)'}
                </Text>
              </TouchableOpacity>

              {whatsappCampaignUseTemplate ? (
                <View style={[styles.mediaSection, { marginTop: 12 }]}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.saveSettingsButton, { marginBottom: 12 }]}
                    onPress={() => setWhatsappLinkCampaignTemplateToTest((prev) => !prev)}
                  >
                    <Text style={styles.saveSettingsButtonText}>
                      {whatsappLinkCampaignTemplateToTest
                        ? 'Campaign Template Source: LINKED TO TEST (Tap for separate campaign template)'
                        : 'Campaign Template Source: SEPARATE (Tap to reuse test template)'}
                    </Text>
                  </TouchableOpacity>

                  {whatsappLinkCampaignTemplateToTest && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.helpText}>
                        Campaign sends will use the same template settings as the test sender above.
                      </Text>
                      <Text style={styles.helpText}>
                        Current linked template: {whatsappTestTemplateName.trim() || '(not set)'} / {(whatsappTestTemplateLanguage.trim() || 'en_US')}
                      </Text>
                      <Text style={styles.helpText}>
                        Linked template params: {parseWhatsAppTemplateParameters(whatsappTestTemplateParamsText).length}
                      </Text>
                      <Text style={styles.helpText}>
                        Linked header params: {parseWhatsAppTemplateParameters(whatsappTestTemplateHeaderParamsText).length} | linked button params: {parseWhatsAppTemplateParameters(whatsappTestTemplateButtonParamsText).length}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.label}>Approved Template Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={whatsappLinkCampaignTemplateToTest ? whatsappTestTemplateName : whatsappCampaignTemplateName}
                    onChangeText={whatsappLinkCampaignTemplateToTest ? setWhatsappTestTemplateName : setWhatsappCampaignTemplateName}
                    placeholder="e.g. promo_update_jan"
                    autoCapitalize="none"
                    editable={!whatsappLinkCampaignTemplateToTest}
                  />

                  <Text style={styles.label}>Template Language Code *</Text>
                  <TextInput
                    style={styles.input}
                    value={whatsappLinkCampaignTemplateToTest ? whatsappTestTemplateLanguage : whatsappCampaignTemplateLanguage}
                    onChangeText={whatsappLinkCampaignTemplateToTest ? setWhatsappTestTemplateLanguage : setWhatsappCampaignTemplateLanguage}
                    placeholder="e.g. en_US"
                    autoCapitalize="none"
                    editable={!whatsappLinkCampaignTemplateToTest}
                  />

                  <Text style={styles.label}>Template Variables (optional, shared for all recipients)</Text>
                  <TextInput
                    style={[styles.input, styles.captionInput]}
                    value={whatsappLinkCampaignTemplateToTest ? whatsappTestTemplateParamsText : whatsappCampaignTemplateParamsText}
                    onChangeText={whatsappLinkCampaignTemplateToTest ? setWhatsappTestTemplateParamsText : setWhatsappCampaignTemplateParamsText}
                    placeholder="e.g. January Offers, Colombo 05"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    editable={!whatsappLinkCampaignTemplateToTest}
                  />
                  <Text style={styles.helpText}>
                    Comma-separated values are sent as template body parameters in order. Example: `John, Order #123`.
                    {whatsappLinkCampaignTemplateToTest ? ' (Editing here updates the test template config because campaign is linked.)' : ''}
                  </Text>

                  <Text style={[styles.label, { marginTop: 12 }]}>Header Text Variables (optional, comma-separated)</Text>
                  <TextInput
                    style={[styles.input, styles.captionInput]}
                    value={whatsappLinkCampaignTemplateToTest ? whatsappTestTemplateHeaderParamsText : whatsappCampaignTemplateHeaderParamsText}
                    onChangeText={whatsappLinkCampaignTemplateToTest ? setWhatsappTestTemplateHeaderParamsText : setWhatsappCampaignTemplateHeaderParamsText}
                    placeholder="For header text placeholders only"
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    editable={!whatsappLinkCampaignTemplateToTest}
                  />

                  <Text style={[styles.label, { marginTop: 12 }]}>Header Media URL (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={whatsappLinkCampaignTemplateToTest ? whatsappTestTemplateHeaderMediaUrl : whatsappCampaignTemplateHeaderMediaUrl}
                    onChangeText={whatsappLinkCampaignTemplateToTest ? setWhatsappTestTemplateHeaderMediaUrl : setWhatsappCampaignTemplateHeaderMediaUrl}
                    placeholder="https://... for header media templates"
                    autoCapitalize="none"
                    keyboardType="url"
                    editable={!whatsappLinkCampaignTemplateToTest}
                  />

                  <Text style={styles.label}>Header Media Type</Text>
                  <View style={styles.mediaButtonsRow}>
                    {(['image', 'video', 'document'] as const).map((type) => {
                      const selectedType = whatsappLinkCampaignTemplateToTest
                        ? whatsappTestTemplateHeaderMediaType
                        : whatsappCampaignTemplateHeaderMediaType;
                      return (
                        <TouchableOpacity
                          key={`wa-campaign-header-${type}`}
                          style={[
                            styles.mediaButton,
                            selectedType === type && {
                              borderColor: Colors.light.tint,
                              backgroundColor: Colors.light.secondary,
                            },
                            whatsappLinkCampaignTemplateToTest && { opacity: 0.7 },
                          ]}
                          onPress={() => {
                            if (whatsappLinkCampaignTemplateToTest) return;
                            setWhatsappCampaignTemplateHeaderMediaType(type);
                          }}
                          disabled={whatsappLinkCampaignTemplateToTest}
                        >
                          <Text style={styles.mediaButtonText}>{type.toUpperCase()}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.label, { marginTop: 12 }]}>Button URL Variables (optional, comma-separated)</Text>
                  <TextInput
                    style={[styles.input, styles.captionInput]}
                    value={whatsappLinkCampaignTemplateToTest ? whatsappTestTemplateButtonParamsText : whatsappCampaignTemplateButtonParamsText}
                    onChangeText={whatsappLinkCampaignTemplateToTest ? setWhatsappTestTemplateButtonParamsText : setWhatsappCampaignTemplateButtonParamsText}
                    placeholder="Dynamic URL button params in order"
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    editable={!whatsappLinkCampaignTemplateToTest}
                  />
                  <Text style={styles.helpText}>
                    Footer is static. Use body/header/button variables only if your approved template has placeholders.
                    {whatsappLinkCampaignTemplateToTest ? ' (Campaign template fields are linked to test template settings.)' : ''}
                  </Text>
                </View>
              ) : (
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

        {campaignType === 'email' && pendingEmailCampaign && pendingEmailCampaign.recipients.length > 0 && (
          <>
            <TouchableOpacity
              style={[
                styles.sendRemainingButton,
                (!canSendEmailRemaining || isSending) && styles.sendButtonDisabled,
              ]}
              onPress={sendRemainingEmailCampaign}
              disabled={!canSendEmailRemaining || isSending}
            >
              <Text style={styles.sendRemainingButtonText}>
                Send Remaining ({Math.min(pendingEmailCampaign.maxPerWindow, pendingEmailCampaign.recipients.length)})
              </Text>
            </TouchableOpacity>
            <Text style={styles.remainingInfoText}>
              Queued: {pendingEmailCampaign.recipients.length} email(s) | Max per 24h: {pendingEmailCampaign.maxPerWindow}
            </Text>
            {!canSendEmailRemaining && (
              <Text style={styles.remainingWaitText}>
                Available in: {formatWaitDuration(emailRemainingWaitMs)}
              </Text>
            )}
          </>
        )}

        {campaignType === 'email' && (
          <View style={styles.serverQueueCard}>
            <View style={styles.serverQueueHeader}>
              <Text style={styles.serverQueueTitle}>Server Auto Queue</Text>
              <TouchableOpacity
                style={[styles.serverQueueRefreshButton, loadingServerEmailQueue && styles.sendButtonDisabled]}
                onPress={() => refreshServerEmailQueueStatus(true)}
                disabled={loadingServerEmailQueue || isSending}
              >
                {loadingServerEmailQueue ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <Text style={styles.serverQueueRefreshButtonText}>Refresh</Text>
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.serverQueueSummary}>
              Jobs: {serverEmailQueueLength} | Due now: {serverEmailQueueDueJobs}
            </Text>

            {serverEmailQueueJobs.length === 0 ? (
              <Text style={styles.serverQueueEmptyText}>No server queued recipients.</Text>
            ) : (
              serverEmailQueueJobs.map((job) => (
                <View key={job.id} style={styles.serverQueueJobCard}>
                  <Text style={styles.serverQueueJobTitle}>
                    {job.campaignKey ? `Campaign: ${job.campaignKey}` : `Job: ${job.id}`}
                  </Text>
                  <Text style={styles.serverQueueJobMeta}>
                    Next send: {job.waitUntil > 0 ? new Date(job.waitUntil).toLocaleString() : 'Now'}
                  </Text>
                  <Text style={styles.serverQueueJobMeta}>
                    Remaining: {job.remainingRecipients} | Max per 24h: {job.maxPerWindow}
                  </Text>
                  {job.lastRunAt > 0 && (
                    <Text style={styles.serverQueueJobMeta}>
                      Last run: {new Date(job.lastRunAt).toLocaleString()} (Success {job.lastRunSuccess}, Failed {job.lastRunFailed})
                    </Text>
                  )}
                  <Text style={styles.serverQueueRecipientsTitle}>Recipients</Text>
                  {job.recipients.length === 0 ? (
                    <Text style={styles.serverQueueRecipientText}>No recipient preview available.</Text>
                  ) : (
                    job.recipients.map((recipient, idx) => (
                      <Text key={`${job.id}-${recipient.email}-${idx}`} style={styles.serverQueueRecipientText}>
                        {idx + 1}. {recipient.name || 'Unknown'} - {recipient.email}
                      </Text>
                    ))
                  )}
                  {job.recipientsPreviewTruncated && (
                    <Text style={styles.serverQueueTruncatedText}>
                      Showing first {job.recipients.length} recipients for this job.
                    </Text>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={showAdvancedSettingsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAdvancedSettingsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {campaignType === 'email' ? 'Email Advanced Settings' : 'SMS Settings'}
              </Text>
              <TouchableOpacity onPress={() => setShowAdvancedSettingsModal(false)}>
                <X size={20} color={Colors.light.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {campaignType === 'email' && (
                <>
                  <Text style={styles.label}>Email Batch Size</Text>
                  <TextInput
                    style={styles.input}
                    value={emailBatchSize}
                    onChangeText={setEmailBatchSize}
                    placeholder="25"
                    keyboardType="number-pad"
                  />
                  <Text style={styles.helpText}>
                    Number of emails sent per batch request (1-100). Smaller is slower but more reliable on shared hosting.
                  </Text>

                  <Text style={styles.label}>Email Batch Delay (ms)</Text>
                  <TextInput
                    style={styles.input}
                    value={emailBatchDelayMs}
                    onChangeText={setEmailBatchDelayMs}
                    placeholder="1500"
                    keyboardType="number-pad"
                  />
                  <Text style={styles.helpText}>
                    Delay between email batches to reduce SMTP/server overload.
                  </Text>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.saveSettingsButton, { marginTop: 12 }]}
                    onPress={saveCampaignSettings}
                  >
                    <Text style={styles.saveSettingsButtonText}>Save Settings</Text>
                  </TouchableOpacity>
                </>
              )}

              {campaignType === 'sms' && (
                <>
                  <Text style={styles.sectionTitle}>Dialog eSMS Configuration</Text>
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      {dialogSMSSettings?.esms_username
                        ? 'SMS campaigns use Dialog eSMS settings from the Settings page. These details show the active configuration.'
                        : 'Dialog eSMS is not configured yet. Configure it in Settings > Dialog eSMS Settings. Legacy SMS settings are retained as fallback.'}
                    </Text>
                  </View>

                  <Text style={styles.label}>Provider</Text>
                  <Text style={styles.configValueText}>
                    {dialogSMSSettings?.esms_username ? 'Dialog eSMS (Active)' : (smsApiUrl && smsApiKey ? 'Legacy SMS API (Fallback only)' : 'Not configured')}
                  </Text>

                  <Text style={styles.label}>Dialog Username</Text>
                  <Text style={styles.configValueText}>
                    {dialogSMSSettings?.esms_username || 'Not set'}
                  </Text>

                  <Text style={styles.label}>Source Address / Mask</Text>
                  <Text style={styles.configValueText}>
                    {dialogSMSSettings?.default_source_address || 'Not set'}
                  </Text>

                  <Text style={styles.label}>Payment Method</Text>
                  <Text style={styles.configValueText}>
                    {dialogSMSSettings
                      ? (dialogSMSSettings.default_payment_method === 4 ? 'Package (4)' : 'Wallet (0)')
                      : 'Not set'}
                  </Text>

                  <Text style={styles.label}>Delivery Report Webhook</Text>
                  <Text style={styles.configValueText} numberOfLines={2}>
                    {dialogSMSSettings?.push_notification_url || 'Not set'}
                  </Text>

                  {(smsApiUrl && smsApiKey) && (
                    <>
                      <Text style={styles.label}>Legacy Fallback</Text>
                      <Text style={styles.configValueText}>Configured (hidden fields retained for fallback only)</Text>
                    </>
                  )}

                  <TouchableOpacity
                    style={[styles.actionButton, styles.testButton, { marginTop: 12 }]}
                    onPress={testSMSConnection}
                    disabled={testingSMS}
                  >
                    {testingSMS ? (
                      <ActivityIndicator size="small" color={Colors.light.tint} />
                    ) : (
                      <Text style={styles.testButtonText}>Test Connection</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  advancedSettingsTrigger: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginBottom: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  advancedSettingsTriggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.light.tint,
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
  newsletterBuilderCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 10,
  },
  newsletterBuilderActions: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  newsletterActionButton: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
  },
  newsletterActionButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  newsletterBlockCard: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: Colors.light.background,
  },
  newsletterBlockHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 8,
    gap: 8,
  },
  newsletterBlockTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  newsletterBlockHeaderActions: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  newsletterMiniButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  newsletterMiniButtonText: {
    fontSize: 12,
    color: Colors.light.text,
  },
  newsletterMiniDeleteButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  newsletterMiniDeleteButtonText: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600' as const,
  },
  newsletterTextArea: {
    minHeight: 90,
  },
  newsletterPickerWrap: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: Colors.light.card,
    overflow: 'hidden' as const,
  },
  newsletterPicker: {
    height: 48,
    color: Colors.light.text,
  },
  newsletterColorRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 8,
  },
  newsletterColorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  newsletterColorSwatchActive: {
    borderColor: Colors.light.tint,
    borderWidth: 3,
  },
  newsletterColorSwatchWhite: {
    borderColor: '#CBD5E1',
  },
  newsletterAttachButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.secondary,
  },
  newsletterAttachButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  newsletterImagePreviewWrap: {
    marginTop: 10,
    borderRadius: 8,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  newsletterImagePreview: {
    width: '100%',
    height: 180,
    backgroundColor: Colors.light.background,
    alignSelf: 'center' as const,
  },
  newsletterImagePlaceholder: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderStyle: 'dashed' as const,
    borderRadius: 8,
    paddingVertical: 24,
    alignItems: 'center' as const,
    gap: 6,
  },
  newsletterImagePlaceholderText: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  newsletterPreview: {
    minHeight: 130,
    color: Colors.light.tabIconDefault,
  },
  newsletterLivePreview: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  newsletterLivePreviewImageWrap: {
    marginVertical: 8,
    alignItems: 'center' as const,
  },
  newsletterPreviewCaption: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    textAlign: 'center' as const,
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
  sendRemainingButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 12,
  },
  sendRemainingButtonText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  remainingInfoText: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.light.tabIconDefault,
    textAlign: 'center' as const,
  },
  remainingWaitText: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.light.danger,
    textAlign: 'center' as const,
  },
  serverQueueCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
    gap: 8,
  },
  serverQueueHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
  },
  serverQueueTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  serverQueueRefreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.secondary,
    minWidth: 90,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  serverQueueRefreshButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.tint,
  },
  serverQueueSummary: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  serverQueueEmptyText: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  serverQueueJobCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    gap: 3,
  },
  serverQueueJobTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  serverQueueJobMeta: {
    fontSize: 12,
    color: Colors.light.tabIconDefault,
  },
  serverQueueRecipientsTitle: {
    marginTop: 5,
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  serverQueueRecipientText: {
    fontSize: 12,
    color: Colors.light.text,
  },
  serverQueueTruncatedText: {
    marginTop: 4,
    fontSize: 11,
    color: Colors.light.tabIconDefault,
    fontStyle: 'italic' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center' as const,
    padding: 16,
  },
  modalCard: {
    maxHeight: '85%',
    backgroundColor: Colors.light.background,
    borderRadius: 12,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  modalBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  dialogCreditErrorText: {
    marginTop: 8,
    fontSize: 12,
    color: Colors.light.danger,
    lineHeight: 16,
  },
  configValueText: {
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
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
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap' as const,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  statusBadgeSent: {
    backgroundColor: '#DBEAFE',
    borderColor: '#93C5FD',
  },
  statusBadgeDelivered: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  statusBadgeRead: {
    backgroundColor: '#EDE9FE',
    borderColor: '#C4B5FD',
  },
  statusBadgeFailed: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  statusErrorText: {
    fontSize: 13,
    color: Colors.light.danger,
    lineHeight: 18,
    marginTop: 6,
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
  helpText: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
    marginTop: 6,
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
