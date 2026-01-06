import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { hasPendingOperations } from '@/utils/pendingSync';

export default function OfflineSyncIndicator() {
  const [hasPending, setHasPending] = useState<boolean>(false);

  useEffect(() => {
    const checkPending = async () => {
      const pending = await hasPendingOperations();
      setHasPending(pending);
    };

    checkPending();
    const interval = setInterval(checkPending, 5000);

    return () => clearInterval(interval);
  }, []);

  if (!hasPending) return null;

  return (
    <View style={styles.container}>
      <View style={styles.indicator} />
      <Text style={styles.text}>Syncing pending changes...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: '#FFA500',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 8,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
