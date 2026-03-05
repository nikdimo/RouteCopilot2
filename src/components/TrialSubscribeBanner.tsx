import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Zap, Check, X } from 'lucide-react-native';

/** Basic plan benefits (from pricing table) – shown during 30-day trial to encourage subscribe */
const BASIC_BENEFITS = [
  '1 Outlook calendar sync',
  'Contact creation tool',
  'Google Geocoding Pro',
  'Priority route resolution',
  '24h support response',
];

export type TrialSubscribeBannerProps = {
  /** When true, banner is visible. Logic to be wired (e.g. profileAccess?.source === 'trial'). */
  visible?: boolean;
  /** Optional trial end date label (e.g. "Dec 15, 2025"). */
  trialEndsAtLabel?: string;
  /** Called when user taps Subscribe. Logic to be wired (e.g. navigate to billing). */
  onSubscribe?: () => void;
  /** Called when user dismisses the banner. Logic to be wired (e.g. hide for session). */
  onDismiss?: () => void;
};

export default function TrialSubscribeBanner({
  visible = true,
  trialEndsAtLabel,
  onSubscribe,
  onDismiss,
}: TrialSubscribeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const handleClose = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  if (!visible || dismissed) return null;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close banner"
        >
          <X size={18} color="#64748b" strokeWidth={2.5} />
        </TouchableOpacity>

        <View style={styles.iconRow}>
          <View style={styles.iconBadge}>
            <Zap size={24} color="#2563EB" strokeWidth={2} />
          </View>
          <View style={styles.textBlock}>
            <Text style={styles.headline} numberOfLines={2}>
              You're on a 30-day free trial of WisePlan Basic
            </Text>
            <Text style={styles.subtext}>
              Subscribe to keep enjoying these benefits after your trial.
            </Text>
            {trialEndsAtLabel ? (
              <Text style={styles.trialEnd}>
                Trial ends {trialEndsAtLabel}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.benefitsBox}>
          {BASIC_BENEFITS.map((label, i) => (
            <View key={i} style={styles.benefitRow}>
              <View style={styles.checkCircle}>
                <Check size={12} color="#fff" strokeWidth={3} />
              </View>
              <Text style={styles.benefitText}>{label}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={onSubscribe}
          activeOpacity={0.88}
        >
          <Text style={styles.ctaButtonText}>Subscribe to keep Basic</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 28,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 100,
    pointerEvents: 'box-none',
  },
  card: {
    maxWidth: 440,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    paddingTop: 18,
    paddingRight: 48,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.12)',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    zIndex: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.15)',
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
    flex: 1,
    minWidth: 0,
    letterSpacing: 0.2,
  },
  subtext: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
  },
  trialEnd: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 6,
    fontWeight: '600',
  },
  benefitsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  benefitText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  ctaButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
