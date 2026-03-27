import React from 'react';
import { Stack } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const TRACKER_WEBSITE_PATH = '/website/';
const TRACKER_WEBSITE_FALLBACK = 'https://tracker.tecclk.com/website/';

function getWebsiteManagerUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}${TRACKER_WEBSITE_PATH}`;
  }
  return TRACKER_WEBSITE_FALLBACK;
}

export default function WebsiteScreen() {
  const managerUrl = getWebsiteManagerUrl();

  const openManager = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = managerUrl;
      return;
    }
    await Linking.openURL(managerUrl);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Website' }} />
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Tracker Website Hub</Text>
        <Text style={styles.title}>Manage website content from Tracker</Text>
        <Text style={styles.body}>
          Open the Website manager to update Featured Items, Highlights, Social, and Online Shop sync settings.
        </Text>
        <Pressable onPress={openManager} style={styles.button}>
          <Text style={styles.buttonText}>Open Website Manager</Text>
        </Pressable>
        <Text style={styles.note}>{managerUrl}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F9FB',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#D6E4EC',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#0D4F78',
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#17313B',
    marginBottom: 10,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#4F6B75',
    marginBottom: 18,
  },
  button: {
    backgroundColor: '#C5962E',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignSelf: 'flex-start',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#221A08',
  },
  note: {
    fontSize: 13,
    color: '#5B7782',
    marginTop: 16,
  },
});
