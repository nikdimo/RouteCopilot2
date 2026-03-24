import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Home, ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';

type HomeBaseCheckpointRowProps = {
  kind: 'depart' | 'return';
  timeLabel: string;
  homeBaseLabel: string;
};

const NODE_GREEN = '#16A34A';
const NODE_GREEN_DARK = '#15803D';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';

export default function HomeBaseCheckpointRow({
  kind,
  timeLabel,
  homeBaseLabel,
}: HomeBaseCheckpointRowProps) {
  const isDepart = kind === 'depart';
  const title = isDepart ? 'Depart from base' : 'Return to base';
  const subtitle = isDepart ? 'Route start checkpoint' : 'Route end checkpoint';

  return (
    <View style={styles.container}>
      <View style={styles.timelineCol}>
        <Text style={styles.timeText}>{timeLabel}</Text>
      </View>

      <View style={styles.nodeCol}>
        {!isDepart ? <View style={styles.connectorTop} /> : null}
        <View style={styles.nodeOuter}>
          <View style={styles.nodeInner}>
            <Home color="#FFFFFF" size={10} />
          </View>
        </View>
        {isDepart ? <View style={styles.connectorBottom} /> : null}
      </View>

      <View style={styles.cardBox}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.pill}>
            {isDepart ? <ArrowUpRight color={NODE_GREEN_DARK} size={12} /> : <ArrowDownLeft color={NODE_GREEN_DARK} size={12} />}
            <Text style={styles.pillText}>{isDepart ? 'Start' : 'ETA'}</Text>
          </View>
        </View>
        <Text style={styles.homeBaseLabel} numberOfLines={1}>
          {homeBaseLabel}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 64,
  },
  timelineCol: {
    width: 50,
    alignItems: 'flex-end',
    paddingTop: 8,
    paddingRight: 10,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_DARK,
  },
  nodeCol: {
    width: 24,
    alignItems: 'center',
    paddingTop: 8,
    position: 'relative',
    marginRight: 10,
  },
  connectorTop: {
    position: 'absolute',
    top: -8,
    width: 2,
    height: 10,
    backgroundColor: '#BBF7D0',
  },
  connectorBottom: {
    position: 'absolute',
    top: 28,
    width: 2,
    height: 10,
    backgroundColor: '#BBF7D0',
  },
  nodeOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 2,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 6px rgba(22, 163, 74, 0.28)',
      },
      default: {
        shadowColor: '#16A34A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
      },
    }),
  },
  nodeInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: NODE_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    backgroundColor: '#F0FDF4',
    paddingVertical: 8,
    paddingHorizontal: 10,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(22, 163, 74, 0.08)',
      },
      default: {
        shadowColor: '#16A34A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 1,
      },
    }),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_DARK,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#86EFAC',
    backgroundColor: '#ECFDF5',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    color: NODE_GREEN_DARK,
  },
  homeBaseLabel: {
    fontSize: 13,
    color: '#166534',
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginTop: 2,
  },
});
