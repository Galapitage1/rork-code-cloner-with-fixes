import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { RefreshCw, X } from 'lucide-react-native';

export function UpdatePrompt() {
  const { updateAvailable, reloadApp, dismissUpdate } = useAppUpdate();

  if (Platform.OS !== 'web' || !updateAvailable) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <RefreshCw size={20} color="#fff" style={styles.icon} />
        <View style={styles.textContainer}>
          <Text style={styles.title}>Update Available</Text>
          <Text style={styles.message}>A new version is available. Reload to get the latest features.</Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={reloadApp}>
          <Text style={styles.buttonText}>Reload</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissButton} onPress={dismissUpdate}>
          <X size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: Platform.select({ web: 16, default: 0 }),
  },
  content: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  icon: {
    flexShrink: 0,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  message: {
    color: '#e0e7ff',
    fontSize: 12,
  },
  button: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flexShrink: 0,
  },
  buttonText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
  dismissButton: {
    padding: 8,
    flexShrink: 0,
  },
});
