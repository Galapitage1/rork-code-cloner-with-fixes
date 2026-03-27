import { memo, useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { ChevronLeft, ChevronRight, X, CalendarDays } from 'lucide-react-native';
import Colors from '@/constants/colors';

export type CalendarModalProps = {
  visible: boolean;
  initialDate?: string;
  onClose: () => void;
  onSelect: (isoDate: string) => void;
  testID?: string;
};

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function CalendarModalComponent({ visible, initialDate, onClose, onSelect, testID }: CalendarModalProps) {
  const initial = useMemo(() => {
    if (!initialDate) return new Date();
    const parts = initialDate.split('-').map((p) => parseInt(p, 10));
    if (parts.length === 3 && !parts.some(isNaN)) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date();
  }, [initialDate]);

  const [cursor, setCursor] = useState<Date>(startOfMonth(initial));

  const monthLabel = useMemo(() =>
    cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  [cursor]);

  const daysGrid = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);

    const firstWeekday = start.getDay(); // 0 = Sun
    const totalDays = end.getDate();

    const cells: { key: string; date: Date | null }[] = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ key: `empty-${i}`, date: null });
    }
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
      cells.push({ key: `d-${d}`, date });
    }

    const remainder = cells.length % 7;
    if (remainder !== 0) {
      for (let i = remainder; i < 7; i++) {
        cells.push({ key: `post-${i}`, date: null });
      }
    }

    const rows: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [cursor]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <CalendarDays size={18} color={Colors.light.tint} />
              <Text style={styles.title}>Select date</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} testID={testID ? `${testID}-close` : undefined}>
              <X size={18} color={Colors.light.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthBar}>
            <TouchableOpacity
              onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              style={styles.navBtn}
              testID={testID ? `${testID}-prev` : undefined}
            >
              <ChevronLeft size={16} color={Colors.light.text} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity
              onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              style={styles.navBtn}
              testID={testID ? `${testID}-next` : undefined}
            >
              <ChevronRight size={16} color={Colors.light.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekHeader}>
            {['S','M','T','W','T','F','S'].map((d) => (
              <Text key={d} style={styles.weekLabel}>{d}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {daysGrid.map((row, ri) => (
              <View key={`r-${ri}`} style={styles.row}>
                {row.map((cell) => {
                  if (!cell.date) return <View style={styles.cell} key={cell.key} />;
                  const iso = toISO(cell.date);
                  const isToday = iso === toISO(new Date());
                  return (
                    <TouchableOpacity
                      key={cell.key}
                      style={[styles.cell, isToday && styles.todayCell]}
                      onPress={() => onSelect(iso)}
                      testID={testID ? `${testID}-day-${iso}` : undefined}
                    >
                      <Text style={[styles.dayText, isToday && styles.todayText]}>{cell.date.getDate()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
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
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 12,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  monthBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 8,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.light.text,
  },
  navBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  weekHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  weekLabel: {
    width: `${100/7}%`,
    textAlign: 'center' as const,
    fontSize: 12,
    color: Colors.light.muted,
    fontWeight: '600' as const,
  },
  grid: {
    gap: 4,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    gap: 4,
  },
  cell: {
    width: `${100/7 - 0.5}%`,
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  todayCell: {
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.tint + '10',
  },
  dayText: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '600' as const,
  },
  todayText: {
    color: Colors.light.tint,
    fontWeight: '700' as const,
  },
});

export const CalendarModal = memo(CalendarModalComponent);
