import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { SMSProviderSettings, SMSCampaign, SMSRecipient, SMSDeliveryEvent } from '@/types';
import { useAuth } from './AuthContext';

const SMS_SETTINGS_KEY = '@sms_provider_settings';
const SMS_CAMPAIGNS_KEY = '@sms_campaigns';
const SMS_RECIPIENTS_KEY = '@sms_recipients';
const SMS_DELIVERY_EVENTS_KEY = '@sms_delivery_events';

const BACKEND_URL = process.env.EXPO_PUBLIC_RORK_API_BASE_URL || '';

export const [SMSCampaignContext, useSMSCampaign] = createContextHook(() => {
  const { currentUser } = useAuth();
  const [settings, setSettings] = useState<SMSProviderSettings | null>(null);
  const [campaigns, setCampaigns] = useState<SMSCampaign[]>([]);
  const [recipients, setRecipients] = useState<SMSRecipient[]>([]);
  const [deliveryEvents, setDeliveryEvents] = useState<SMSDeliveryEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [settingsData, campaignsData, recipientsData, eventsData] = await Promise.all([
        AsyncStorage.getItem(SMS_SETTINGS_KEY),
        AsyncStorage.getItem(SMS_CAMPAIGNS_KEY),
        AsyncStorage.getItem(SMS_RECIPIENTS_KEY),
        AsyncStorage.getItem(SMS_DELIVERY_EVENTS_KEY),
      ]);

      if (settingsData) {
        setSettings(JSON.parse(settingsData));
      }
      if (campaignsData) {
        setCampaigns(JSON.parse(campaignsData));
      }
      if (recipientsData) {
        setRecipients(JSON.parse(recipientsData));
      }
      if (eventsData) {
        setDeliveryEvents(JSON.parse(eventsData));
      }
    } catch (error) {
      console.error('[SMS Context] Load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async (newSettings: Omit<SMSProviderSettings, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      setIsSaving(true);
      const settingsToSave: SMSProviderSettings = {
        ...newSettings,
        id: settings?.id || `sms_settings_${Date.now()}`,
        createdAt: settings?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      await AsyncStorage.setItem(SMS_SETTINGS_KEY, JSON.stringify(settingsToSave));
      setSettings(settingsToSave);
      return { success: true };
    } catch (error: any) {
      console.error('[SMS Context] Save settings error:', error);
      return { success: false, error: error.message };
    } finally {
      setIsSaving(false);
    }
  };

  const testLogin = async (username: string, password: string): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/sms/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          esms_username: username,
          esms_password: password,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('[SMS Context] Test login error:', error);
      return { success: false, error: error.message };
    }
  };

  const sendTestSMS = async (mobile: string, message: string): Promise<{ success: boolean; message?: string; error?: string }> => {
    if (!settings) {
      return { success: false, error: 'SMS settings not configured' };
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/sms/send-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            esms_username: settings.esms_username,
            esms_password: settings.esms_password_encrypted,
            default_source_address: settings.default_source_address,
            default_payment_method: settings.default_payment_method,
          },
          mobile,
          message,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('[SMS Context] Send test error:', error);
      return { success: false, error: error.message };
    }
  };

  const sendCampaign = async (
    message: string,
    recipientMobiles: string[],
    sourceAddress?: string,
    paymentMethod?: 0 | 4
  ): Promise<{ success: boolean; campaign?: SMSCampaign; error?: string; data?: any }> => {
    if (!settings) {
      return { success: false, error: 'SMS settings not configured' };
    }

    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/sms/send-campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            esms_username: settings.esms_username,
            esms_password: settings.esms_password_encrypted,
            default_source_address: settings.default_source_address,
            default_payment_method: settings.default_payment_method,
            push_notification_url: settings.push_notification_url,
          },
          message,
          recipients: recipientMobiles.map(mobile => ({ mobile })),
          source_address: sourceAddress,
          payment_method: paymentMethod,
        }),
      });

      const result = await response.json();

      if (result.success) {
        const campaign: SMSCampaign = {
          id: `campaign_${Date.now()}`,
          provider_settings_id: settings.id,
          transaction_id: result.data.transaction_id,
          message,
          source_address: sourceAddress || settings.default_source_address,
          payment_method: paymentMethod ?? settings.default_payment_method,
          recipient_count: result.data.recipients.length,
          campaign_id: result.data.campaign_id,
          campaign_cost: result.data.campaign_cost,
          wallet_balance: result.data.wallet_balance,
          duplicates_removed: result.data.duplicates_removed,
          invalid_numbers: result.data.invalid_numbers,
          mask_blocked_numbers: result.data.mask_blocked_numbers,
          status: result.data.errCode ? 'failed' : 'pending',
          comment: result.data.comment,
          errCode: result.data.errCode,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: currentUser.username,
        };

        const newCampaigns = [...campaigns, campaign];
        await AsyncStorage.setItem(SMS_CAMPAIGNS_KEY, JSON.stringify(newCampaigns));
        setCampaigns(newCampaigns);

        const newRecipients: SMSRecipient[] = result.data.recipients.map((r: any) => ({
          id: `recipient_${Date.now()}_${Math.random()}`,
          campaign_id: campaign.id,
          mobile_original: r.original,
          mobile_normalized: r.mobile,
          delivery_status: 'pending' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));

        const allRecipients = [...recipients, ...newRecipients];
        await AsyncStorage.setItem(SMS_RECIPIENTS_KEY, JSON.stringify(allRecipients));
        setRecipients(allRecipients);

        return { success: true, campaign, data: result.data };
      }

      return { success: false, error: result.data?.comment || result.error || 'Failed to send campaign' };
    } catch (error: any) {
      console.error('[SMS Context] Send campaign error:', error);
      return { success: false, error: error.message };
    }
  };

  const checkCampaignStatus = async (transactionId: number): Promise<{ success: boolean; data?: any; error?: string }> => {
    if (!settings) {
      return { success: false, error: 'SMS settings not configured' };
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/sms/check-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            esms_username: settings.esms_username,
            esms_password: settings.esms_password_encrypted,
          },
          transaction_id: transactionId,
        }),
      });

      const result = await response.json();
      return result;
    } catch (error: any) {
      console.error('[SMS Context] Check status error:', error);
      return { success: false, error: error.message };
    }
  };

  const getCampaignRecipients = useCallback((campaignId: string): SMSRecipient[] => {
    return recipients.filter(r => r.campaign_id === campaignId);
  }, [recipients]);

  const getCampaignDeliveryEvents = useCallback((campaignId: string): SMSDeliveryEvent[] => {
    return deliveryEvents.filter(e => e.campaign_id === campaignId);
  }, [deliveryEvents]);

  const clearAllData = async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(SMS_SETTINGS_KEY),
        AsyncStorage.removeItem(SMS_CAMPAIGNS_KEY),
        AsyncStorage.removeItem(SMS_RECIPIENTS_KEY),
        AsyncStorage.removeItem(SMS_DELIVERY_EVENTS_KEY),
      ]);
      setSettings(null);
      setCampaigns([]);
      setRecipients([]);
      setDeliveryEvents([]);
      return { success: true };
    } catch (error: any) {
      console.error('[SMS Context] Clear error:', error);
      return { success: false, error: error.message };
    }
  };

  return {
    settings,
    campaigns,
    recipients,
    deliveryEvents,
    isLoading,
    isSaving,
    saveSettings,
    testLogin,
    sendTestSMS,
    sendCampaign,
    checkCampaignStatus,
    getCampaignRecipients,
    getCampaignDeliveryEvents,
    clearAllData,
  };
});
