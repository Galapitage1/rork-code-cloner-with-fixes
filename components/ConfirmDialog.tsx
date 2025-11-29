import { memo, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Colors from '@/constants/colors';
import { AlertTriangle, Check, X } from 'lucide-react-native';

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  testID?: string;
};

function ConfirmDialogComponent({
  visible,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
  loading = false,
  onCancel,
  onConfirm,
  testID,
}: ConfirmDialogProps) {
  const confirmColor = useMemo(() => (destructive ? Colors.light.danger : Colors.light.tint), [destructive]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <AlertTriangle size={22} color={confirmColor} />
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={loading}
              onPress={onCancel}
              style={[styles.button, styles.secondaryBtn]}
              testID={testID ? `${testID}-cancel` : undefined}
            >
              <X size={18} color={Colors.light.text} />
              <Text style={[styles.btnText, styles.secondaryText]}>{cancelText}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              disabled={loading}
              onPress={onConfirm}
              style={[styles.button, { backgroundColor: confirmColor }]}
              testID={testID ? `${testID}-confirm` : undefined}
            >
              <Check size={18} color={Colors.light.card} />
              <Text style={[styles.btnText, { color: Colors.light.card }]}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 20,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
    zIndex: 10000,
    elevation: 10000,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  message: {
    fontSize: 14,
    color: Colors.light.muted,
    lineHeight: 20,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryBtn: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  secondaryText: {
    color: Colors.light.text,
  },
});

export const ConfirmDialog = memo(ConfirmDialogComponent);
