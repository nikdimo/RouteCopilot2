
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {
  Calendar,
  Car,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  LogOut,
  MapPin,
  MessageSquare,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import LocationSearch, { type LocationSelection } from '../components/LocationSearch';
import AuthPromptModal from '../components/AuthPromptModal';
import OutlookConnectModal from '../components/OutlookConnectModal';
import { useAuth } from '../context/AuthContext';
import { useRoute as useRouteContext } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { searchContacts } from '../services/graph';
import { clearGraphSession, hasValidGraphSession } from '../services/graphAuth';
import { MS_CLIENT_ID } from '../config/auth';
import { BACKEND_API_ENABLED } from '../config/backend';
import {
  backendCreateBillingPortalSession,
  backendDeleteMyAccount,
  backendGetBillingSnapshot,
  backendGetFeatureAccess,
  backendGetProfileSettings,
  backendRequestUpgradeInterest,
  backendUpdateProfileSettings,
  type BackendBillingSnapshot,
  type BackendProfileSettingsPatch,
  type BackendProfileSettingsResponse,
} from '../services/backendApi';
import {
  geocodeAddress,
  geocodeAddressGoogle,
  geocodeContactAddress,
  getAddressSuggestions,
  getAddressSuggestionsGoogle,
  getCoordsForPlaceId,
} from '../utils/geocoding';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';
import { DEFAULT_USER_PREFERENCES, DEFAULT_WORKING_DAYS, type WorkingDays } from '../types';
import { styles } from '../components/profile/ProfileStyles';
import { clearLocalDataNow, MAX_SLOT, parseNumber, slotToTime, timeToSlot } from '../components/profile/ProfileHelpers';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_BILLING_URL = 'https://www.wiseplan.dk/account/billing';

function toPlanName(tier: 'free' | 'basic' | 'pro' | 'premium') {
  if (tier === 'premium') return 'Premium Plan';
  if (tier === 'pro') return 'Pro Plan';
  if (tier === 'basic') return 'Basic Plan';
  return 'Free Plan Member';
}

function toRequiredPlanName(tier: 'basic' | 'pro' | 'premium') {
  if (tier === 'premium') return 'Premium Plan';
  if (tier === 'pro') return 'Pro Plan';
  return 'Basic Plan';
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return null;
  }
}

function inferCountryCodeFromHomeBase(homeBase?: { lat: number; lon: number } | null) {
  if (!homeBase) return undefined;
  const { lat, lon } = homeBase;
  // Denmark bounding box (approx), used only as a search bias.
  if (lat >= 54.4 && lat <= 57.9 && lon >= 7.8 && lon <= 15.4) {
    return 'dk';
  }
  return undefined;
}

type WebDialogHost = {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
};

function showPlatformAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    const host = globalThis as WebDialogHost;
    if (typeof host.alert === 'function') {
      host.alert(message ? `${title}\n\n${message}` : title);
      return;
    }
  }
  if (typeof message === 'string') {
    Alert.alert(title, message);
    return;
  }
  Alert.alert(title);
}

function confirmDestructiveAction(
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void
) {
  if (Platform.OS === 'web') {
    const host = globalThis as WebDialogHost;
    if (typeof host.confirm === 'function') {
      if (host.confirm(`${title}\n\n${message}`)) {
        onConfirm();
      }
      return;
    }
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function ProfileScreen() {
  const { userToken, userData, signOut, getValidToken } = useAuth();
  const { triggerRefresh, resetRouteState } = useRouteContext();
  const { preferences, updatePreferences } = useUserPreferences();

  const [preBuffer, setPreBuffer] = useState((preferences.preMeetingBuffer ?? 15).toString());
  const [postBuffer, setPostBuffer] = useState((preferences.postMeetingBuffer ?? 15).toString());
  const [workStartSlot, setWorkStartSlot] = useState(() =>
    timeToSlot(preferences.workingHours?.start ?? '08:00')
  );
  const [workEndSlot, setWorkEndSlot] = useState(() =>
    timeToSlot(preferences.workingHours?.end ?? '17:00')
  );
  const [showHomeBaseEditor, setShowHomeBaseEditor] = useState(false);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authModalTitle, setAuthModalTitle] = useState('Sync your data');
  const [authModalSubtitle, setAuthModalSubtitle] = useState(
    'Sign in to keep your routes synced across devices and back up your data.'
  );
  const [featureUpdateKey, setFeatureUpdateKey] = useState<
    'advanced' | 'traffic' | 'calendar' | null
  >(null);
  const [billingActionInFlight, setBillingActionInFlight] = useState(false);
  const [deleteAccountInFlight, setDeleteAccountInFlight] = useState(false);
  const [billingSnapshotLoading, setBillingSnapshotLoading] = useState(false);
  const [billingSnapshot, setBillingSnapshot] = useState<BackendBillingSnapshot | null>(null);
  const [profileAccessLoaded, setProfileAccessLoaded] = useState(false);
  const [profileAccess, setProfileAccess] = useState<BackendProfileSettingsResponse['access'] | null>(
    null
  );
  const [graphConnected, setGraphConnected] = useState(false);
  const [graphConnectionLoaded, setGraphConnectionLoaded] = useState(false);
  const [showOutlookConnectModal, setShowOutlookConnectModal] = useState(false);

  const localTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const activeTier = profileAccess?.subscriptionTier ?? localTier;
  const {
    canUseBetterGeocoding,
    canSyncCalendar,
    canUseTrafficAwareRouting,
    canUseClientNotifications,
  } = getTierEntitlements(activeTier);
  const canEditSettings = BACKEND_API_ENABLED
    ? Boolean(
        profileAccess?.canEditSettings ?? (Boolean(userToken) && profileAccessLoaded)
      )
    : Boolean(profileAccess?.canEditSettings ?? (Boolean(userToken) && activeTier !== 'free'));
  const trialEndsAtLabel = formatShortDate(profileAccess?.trialEndsAt);
  const showTrialEndsLabel =
    Boolean(trialEndsAtLabel) &&
    profileAccess?.source === 'trial' &&
    profileAccess?.trialPlanCode != null &&
    profileAccess.trialPlanCode !== 'basic';

  const workingDays = preferences.workingDays ?? DEFAULT_WORKING_DAYS;
  const useGoogle = canUseBetterGeocoding && preferences.useGoogleGeocoding === true;
  const useTrafficRouting = canUseTrafficAwareRouting && preferences.useTrafficAwareRouting === true;
  const googleApiKey = (preferences.googleMapsApiKey ?? '').trim();
  const useGoogleWithKey = useGoogle && googleApiKey.length > 0;
  const preferredCountryCode = inferCountryCodeFromHomeBase(preferences.homeBase);
  const token = canSyncCalendar ? userToken ?? null : null;
  const calendarSyncEnabled = canSyncCalendar && graphConnected;

  const initials = useMemo(() => {
    if (!userData?.displayName) return 'G';
    const parts = userData.displayName.split(' ').filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return 'G';
  }, [userData]);
  const accountLabel = useMemo(() => {
    const email = userData?.email?.trim();
    if (email) return email.toLowerCase();
    const name = userData?.displayName?.trim();
    if (name) return name;
    return initials;
  }, [initials, userData]);
  const showEmailPill = Boolean(userToken && userData?.email?.trim());

  const planName = useMemo(() => {
    const tier = profileAccess?.subscriptionTier ?? billingSnapshot?.currentPlan ?? localTier;
    return toPlanName(tier);
  }, [billingSnapshot?.currentPlan, localTier, profileAccess?.subscriptionTier]);

  const promptSignIn = (title: string, subtitle: string) => {
    setAuthModalTitle(title);
    setAuthModalSubtitle(subtitle);
    setAuthModalVisible(true);
  };

  const resolveAuthToken = async () => {
    if (userToken) return userToken;
    return getValidToken();
  };

  const openExternalUrl = async (url: string, errorTitle: string) => {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      Alert.alert(errorTitle, 'Could not open the link on this device.');
      return false;
    }
  };

  const applyRemoteProfileSettings = (remote: BackendProfileSettingsResponse) => {
    setProfileAccess(remote.access);
    updatePreferences({
      subscriptionTier: remote.access.subscriptionTier,
      workingHours: remote.settings.workingHours,
      preMeetingBuffer: remote.settings.preMeetingBuffer,
      postMeetingBuffer: remote.settings.postMeetingBuffer,
      homeBase: {
        lat: remote.settings.homeBase.lat,
        lon: remote.settings.homeBase.lon,
      },
      homeBaseLabel: remote.settings.homeBaseLabel,
      workingDays: remote.settings.workingDays,
      distanceThresholdKm: remote.settings.distanceThresholdKm,
      alwaysStartFromHomeBase: remote.settings.alwaysStartFromHomeBase,
      useGoogleGeocoding: remote.settings.useGoogleGeocoding,
      useTrafficAwareRouting: remote.settings.useTrafficAwareRouting,
      googleMapsApiKey: remote.settings.googleMapsApiKey ?? undefined,
      calendarConnected: remote.settings.calendarConnected,
      calendarProvider: remote.settings.calendarProvider ?? undefined,
    });
  };

  const requestPlansEmailForFeature = async (
    requiredPlan: 'basic' | 'pro' | 'premium',
    featureName: string,
    featureKey?: string
  ) => {
    const authToken = await resolveAuthToken();
    if (!authToken) {
      promptSignIn(
        'Sign in to activate your free Basic plan',
        'Sign in with a magic link to activate your Basic plan and unlock Basic-level settings.'
      );
      return;
    }

    const requiredPlanName = toRequiredPlanName(requiredPlan);
    const result = BACKEND_API_ENABLED
      ? await backendRequestUpgradeInterest(
          {
            requiredPlan,
            featureName,
            ...(featureKey ? { featureKey } : {}),
          },
          authToken
        )
      : null;

    Alert.alert(
      `${featureName} requires ${requiredPlanName}`,
      result?.emailed
        ? 'We sent plan options to your email so you can upgrade when ready.'
        : 'This feature is locked on your current tier. Plan options will be available in your account email flow.'
    );
  };

  const showLockedSettingsMessage = () => {
    if (!userToken) {
      promptSignIn(
        'Sign in to activate your free Basic plan',
        'Create your profile with a magic link to activate your Basic plan and unlock Basic settings.'
      );
      return;
    }
    if (BACKEND_API_ENABLED && !profileAccessLoaded) {
      Alert.alert(
        'Finishing sign-in',
        'Your account is still syncing. Please wait a moment and try again.'
      );
      return;
    }

    Alert.alert(
      'Settings locked',
      'This setting is not included in your current plan.'
    );
  };

  const applyLocalPatch = (patch: BackendProfileSettingsPatch) => {
    const next: Record<string, unknown> = {};
    if (patch.workingHours) next.workingHours = patch.workingHours;
    if (patch.preMeetingBuffer !== undefined) next.preMeetingBuffer = patch.preMeetingBuffer;
    if (patch.postMeetingBuffer !== undefined) next.postMeetingBuffer = patch.postMeetingBuffer;
    if (patch.homeBase !== undefined) {
      next.homeBase = patch.homeBase ? { lat: patch.homeBase.lat, lon: patch.homeBase.lon } : undefined;
    }
    if (patch.homeBaseLabel !== undefined) next.homeBaseLabel = patch.homeBaseLabel ?? undefined;
    if (patch.workingDays !== undefined) next.workingDays = patch.workingDays;
    if (patch.distanceThresholdKm !== undefined) next.distanceThresholdKm = patch.distanceThresholdKm;
    if (patch.alwaysStartFromHomeBase !== undefined) {
      next.alwaysStartFromHomeBase = patch.alwaysStartFromHomeBase;
    }
    if (patch.useGoogleGeocoding !== undefined) next.useGoogleGeocoding = patch.useGoogleGeocoding;
    if (patch.useTrafficAwareRouting !== undefined) next.useTrafficAwareRouting = patch.useTrafficAwareRouting;
    if (patch.googleMapsApiKey !== undefined) next.googleMapsApiKey = patch.googleMapsApiKey ?? undefined;
    if (patch.calendarConnected !== undefined) next.calendarConnected = patch.calendarConnected;
    if (patch.calendarProvider !== undefined) next.calendarProvider = patch.calendarProvider ?? undefined;
    updatePreferences(next);
  };

  const saveProfilePatch = async (
    patch: BackendProfileSettingsPatch,
    key?: 'advanced' | 'traffic' | 'calendar'
  ) => {
    const authToken = await resolveAuthToken();
    if (!authToken || !canEditSettings) {
      showLockedSettingsMessage();
      return false;
    }

    if (!BACKEND_API_ENABLED) {
      applyLocalPatch(patch);
      return true;
    }

    if (key) setFeatureUpdateKey(key);
    try {
      const result = await backendUpdateProfileSettings(patch, authToken);
      if (!result) {
        Alert.alert('Sync failed', 'Could not save profile settings right now.');
        await refreshBackendProfileData();
        return false;
      }
      if (result.ok === false) {
        Alert.alert(result.status === 403 ? 'Settings locked' : 'Sync failed', result.error);
        await refreshBackendProfileData();
        return false;
      }

      applyRemoteProfileSettings(result.data);
      return true;
    } finally {
      if (key) setFeatureUpdateKey(null);
    }
  };

  const refreshBackendProfileData = async () => {
    if (!BACKEND_API_ENABLED) {
      setBillingSnapshot(null);
      setProfileAccess(null);
      setProfileAccessLoaded(true);
      return;
    }

    const authToken = await resolveAuthToken();
    if (!authToken) {
      setBillingSnapshot(null);
      setProfileAccess(null);
      setProfileAccessLoaded(true);
      updatePreferences(DEFAULT_USER_PREFERENCES);
      return;
    }

    setProfileAccessLoaded(false);
    setBillingSnapshotLoading(true);
    try {
      const [snapshot, featureAccess, profileSettings] = await Promise.all([
        backendGetBillingSnapshot(authToken),
        backendGetFeatureAccess(authToken),
        backendGetProfileSettings(authToken),
      ]);

      if (snapshot) {
        setBillingSnapshot(snapshot);
        updatePreferences({ subscriptionTier: snapshot.currentPlan });
      }

      if (profileSettings) {
        applyRemoteProfileSettings(profileSettings);
        return;
      }

      if (featureAccess) {
        updatePreferences({
          subscriptionTier: featureAccess.subscriptionTier,
          useGoogleGeocoding: featureAccess.preferences.useAdvancedGeocoding,
          useTrafficAwareRouting: featureAccess.preferences.useTrafficRouting,
        });
        setProfileAccess(
          featureAccess.access
            ? {
                subscriptionTier: featureAccess.subscriptionTier,
                ...featureAccess.access,
              }
            : {
                subscriptionTier: featureAccess.subscriptionTier,
                source: featureAccess.subscriptionTier === 'free' ? 'free' : 'signed_in',
                canEditSettings: featureAccess.subscriptionTier !== 'free',
                lockReason:
                  featureAccess.subscriptionTier === 'free'
                    ? 'requires_active_plan_or_trial'
                    : null,
                subscriptionStatus: null,
                subscriptionCurrentPeriodEnd: null,
                trialStartedAt: null,
                trialEndsAt: null,
                trialPlanCode: null,
              }
        );
        return;
      }

      setProfileAccess({
        subscriptionTier: 'basic',
        source: 'signed_in',
        canEditSettings: true,
        lockReason: null,
        subscriptionStatus: null,
        subscriptionCurrentPeriodEnd: null,
        trialStartedAt: null,
        trialEndsAt: null,
        trialPlanCode: null,
      });
      updatePreferences({ subscriptionTier: 'basic', useGoogleGeocoding: true });
    } catch {
      setProfileAccess({
        subscriptionTier: 'basic',
        source: 'signed_in',
        canEditSettings: true,
        lockReason: null,
        subscriptionStatus: null,
        subscriptionCurrentPeriodEnd: null,
        trialStartedAt: null,
        trialEndsAt: null,
        trialPlanCode: null,
      });
      updatePreferences({ subscriptionTier: 'basic', useGoogleGeocoding: true });
    } finally {
      setProfileAccessLoaded(true);
      setBillingSnapshotLoading(false);
    }
  };

  const handleManageBilling = async () => {
    const authToken = await resolveAuthToken();
    if (!authToken) {
      promptSignIn(
        'Sign in to manage billing',
        'Billing actions require a signed-in account. Sign in to open your billing portal.'
      );
      return;
    }

    if (!BACKEND_API_ENABLED) {
      await openExternalUrl(DEFAULT_BILLING_URL, 'Could not open billing portal');
      return;
    }

    setBillingActionInFlight(true);
    try {
      const result = await backendCreateBillingPortalSession(authToken);
      if (!result) {
        Alert.alert('Billing unavailable', 'Could not reach backend billing right now. Try again shortly.');
        return;
      }
      if (result.ok === false) {
        if (result.status === 409) {
          Alert.alert(
            'No active billing profile',
            'Your account has no billing profile yet. We can email you plan options.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Send Plans Email',
                onPress: () => {
                  void requestPlansEmailForFeature('basic', 'Billing and Plans', 'billing.portal');
                },
              },
            ]
          );
          return;
        }
        Alert.alert('Billing failed', result.error);
        return;
      }

      await openExternalUrl(result.portalUrl, 'Could not open billing portal');
      await refreshBackendProfileData();
    } finally {
      setBillingActionInFlight(false);
    }
  };

  const handleToggleAdvancedGeocoding = (value: boolean) => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    if (value && !canUseBetterGeocoding) {
      void requestPlansEmailForFeature('basic', 'High-Precision Search', 'geocode.provider.premium');
      return;
    }
    void saveProfilePatch({ useGoogleGeocoding: value }, 'advanced');
  };

  const handleToggleTrafficRouting = (value: boolean) => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    if (value && !canUseTrafficAwareRouting) {
      void requestPlansEmailForFeature('pro', 'Traffic-Aware Routing', 'routing.traffic.enabled');
      return;
    }
    void saveProfilePatch({ useTrafficAwareRouting: value }, 'traffic');
  };

  const handleOutlookConnected = () => {
    setGraphConnected(true);
    setShowOutlookConnectModal(false);
    updatePreferences({
      calendarConnected: true,
      calendarProvider: 'outlook',
    });
    triggerRefresh();
    void (async () => {
      if (!BACKEND_API_ENABLED) return;
      const authToken = await resolveAuthToken();
      if (!authToken) return;
      const result = await backendUpdateProfileSettings(
        {
          calendarConnected: true,
          calendarProvider: 'outlook',
        },
        authToken
      );
      if (result && result.ok) {
        applyRemoteProfileSettings(result.data);
      }
    })();
  };

  const handleToggleCalendarConnected = (value: boolean) => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    if (value && !canSyncCalendar) {
      void requestPlansEmailForFeature('basic', 'Calendar Sync', 'calendar.sync.enabled');
      return;
    }
    if (!value) {
      void clearGraphSession();
      setGraphConnected(false);
      void saveProfilePatch(
        {
          calendarConnected: false,
          calendarProvider: null,
        },
        'calendar'
      );
      return;
    }

    if (!graphConnected) {
      setShowOutlookConnectModal(true);
      return;
    }

    void saveProfilePatch(
      {
        calendarConnected: true,
        calendarProvider: 'outlook',
      },
      'calendar'
    );
    triggerRefresh();
  };

  const homeBaseSelection: LocationSelection = useMemo(() => {
    const hb = preferences.homeBase;
    const label = preferences.homeBaseLabel?.trim();
    if (hb && label) {
      return { type: 'address', address: label, coords: { lat: hb.lat, lon: hb.lon } };
    }
    return { type: 'none' };
  }, [preferences.homeBase, preferences.homeBaseLabel]);

  const handleHomeBaseChange = (sel: LocationSelection) => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }

    if (sel.type === 'contact' && sel.contact.hasAddress) {
      void saveProfilePatch({
        homeBase: { lat: sel.coords.lat, lon: sel.coords.lon },
        homeBaseLabel: sel.contact.formattedAddress || sel.contact.displayName,
      });
    } else if (sel.type === 'address') {
      void saveProfilePatch({
        homeBase: { lat: sel.coords.lat, lon: sel.coords.lon },
        homeBaseLabel: sel.address,
      });
    } else if (sel.type === 'none') {
      void saveProfilePatch({ homeBase: null, homeBaseLabel: null });
    }
  };

  useEffect(() => {
    const pre = Math.round((preferences.preMeetingBuffer ?? 15) / 5) * 5;
    const post = Math.round((preferences.postMeetingBuffer ?? 15) / 5) * 5;
    setPreBuffer(pre.toString());
    setPostBuffer(post.toString());
    setWorkStartSlot(timeToSlot(preferences.workingHours?.start ?? '08:00'));
    setWorkEndSlot(timeToSlot(preferences.workingHours?.end ?? '17:00'));
  }, [preferences]);

  useEffect(() => {
    if (userToken && authModalVisible) {
      setAuthModalVisible(false);
    }
  }, [authModalVisible, userToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!userToken) {
        setGraphConnected(false);
        setGraphConnectionLoaded(true);
        return;
      }
      setGraphConnectionLoaded(false);
      const connected = await hasValidGraphSession(MS_CLIENT_ID);
      if (cancelled) return;
      setGraphConnected(connected);
      setGraphConnectionLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userToken]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (!userToken) {
          setGraphConnected(false);
          setGraphConnectionLoaded(true);
          return;
        }
        setGraphConnectionLoaded(false);
        const connected = await hasValidGraphSession(MS_CLIENT_ID);
        if (cancelled) return;
        setGraphConnected(connected);
        setGraphConnectionLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [userToken])
  );

  useEffect(() => {
    void refreshBackendProfileData();
  }, [userToken]);

  const savePreBuffer = () => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    const n = Math.round(parseNumber(preBuffer, 0, 60) / 5) * 5;
    setPreBuffer(n.toString());
    void saveProfilePatch({ preMeetingBuffer: n });
  };

  const savePostBuffer = () => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    const n = Math.round(parseNumber(postBuffer, 0, 60) / 5) * 5;
    setPostBuffer(n.toString());
    void saveProfilePatch({ postMeetingBuffer: n });
  };

  const saveWorkingHours = (startSlot: number, endSlot: number) => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    const startVal = startSlot;
    const endVal = endSlot <= startVal ? Math.min(MAX_SLOT, startVal + 1) : endSlot;
    setWorkStartSlot(startVal);
    setWorkEndSlot(endVal);
    void saveProfilePatch({
      workingHours: { start: slotToTime(startVal), end: slotToTime(endVal) },
    });
  };

  const toggleWorkingDay = (dayIndex: number) => {
    if (!canEditSettings) {
      showLockedSettingsMessage();
      return;
    }
    const next: WorkingDays = [...workingDays] as WorkingDays;
    next[dayIndex] = !next[dayIndex];
    void saveProfilePatch({ workingDays: next });
  };

  const handleClearLocalData = () => {
    confirmDestructiveAction(
      'Clear local data?',
      'This removes local meetings, preferences, caches, and local session data on this device.',
      'Clear',
      () => {
        void (async () => {
          try {
            resetRouteState();
            await clearLocalDataNow(signOut, updatePreferences);
            triggerRefresh();
          } catch {
            showPlatformAlert('Clear failed', 'Could not clear all local data. Try again.');
          }
        })();
      }
    );
  };

  const runDeleteAccount = () => {
    void (async () => {
      const authToken = await resolveAuthToken();
      if (!authToken) {
        promptSignIn(
          'Sign in required',
          'You must be signed in to delete your account.'
        );
        return;
      }
      if (!BACKEND_API_ENABLED) {
        showPlatformAlert(
          'Delete unavailable',
          'Account deletion is unavailable while backend mode is disabled.'
        );
        return;
      }

      setDeleteAccountInFlight(true);
      try {
        const result = await backendDeleteMyAccount(authToken);
        if (!result) {
          showPlatformAlert('Delete failed', 'Could not reach backend right now.');
          return;
        }
        if (result.ok === false) {
          showPlatformAlert('Delete failed', result.error);
          return;
        }

        resetRouteState();
        await clearLocalDataNow(signOut, updatePreferences, {
          title: 'Account deleted',
          message:
            'Your account has been deleted and local data was removed from this device.',
        });
        triggerRefresh();
      } finally {
        setDeleteAccountInFlight(false);
      }
    })();
  };

  const handleDeleteAccount = () => {
    if (!userToken) {
      promptSignIn(
        'Sign in required',
        'You must be signed in to delete your account.'
      );
      return;
    }

    confirmDestructiveAction(
      'Delete account permanently?',
      'This will permanently remove your account data from WisePlan and clear local data from this device. This action cannot be undone.',
      'Delete Account',
      runDeleteAccount
    );
  };

  const handleBannerAction = () => {
    if (!userToken) {
      promptSignIn(
        'Sign in to activate your free Basic plan',
        'Create your profile with a magic link to activate your Basic plan and unlock Basic settings.'
      );
      return;
    }
    if (!canEditSettings) {
      void requestPlansEmailForFeature('basic', 'Profile Settings', 'profile.settings');
      return;
    }
    void handleManageBilling();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.planRow}>
            <CheckCircle2 size={16} color="#10B981" />
            <Text style={styles.planText}>{planName}</Text>
            {billingSnapshotLoading ? (
              <ActivityIndicator size="small" color="#64748B" style={{ marginLeft: 8 }} />
            ) : null}
          </View>
          {showTrialEndsLabel ? (
            <Text style={{ marginTop: 4, color: '#64748B', fontSize: 12, fontWeight: '500' }}>
              Trial ends on {trialEndsAtLabel}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.avatarPill, showEmailPill && styles.accountPill]}
          onPress={() => {
            if (!userToken) {
              promptSignIn(
                'Sign in to activate your free Basic plan',
                'Create your profile with a magic link to activate your Basic plan and unlock Basic settings.'
              );
            }
          }}
          activeOpacity={userToken ? 1 : 0.8}
        >
          <Text
            style={[styles.avatarText, showEmailPill && styles.accountPillText]}
            numberOfLines={1}
          >
            {accountLabel}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bannerCard}>
        <View style={styles.bannerPill}>
          <Text style={styles.bannerPillText}>WISER PLANNER</Text>
          <View style={styles.bannerPillDot} />
        </View>
        <Text style={styles.bannerTitle}>
          {!userToken
            ? 'Sign in to activate your free Basic plan'
            : !profileAccessLoaded
              ? 'Basic plan is loading'
              : canEditSettings
              ? `${planName} active`
              : 'Plan upgrade required'}
        </Text>
        <Text style={styles.bannerSubtitle}>
          {!userToken
            ? 'Sign in with a magic link to activate your free Basic plan and edit Basic-level settings.'
            : !profileAccessLoaded
              ? 'We are syncing your account access. Please wait a moment.'
              : canEditSettings
              ? 'Basic settings are unlocked. Features from Pro and Premium plans remain gated with plan badges.'
              : 'Your current plan does not include all profile controls. Tap a gated feature to request upgrade plans by email.'}
        </Text>
        <TouchableOpacity style={styles.bannerButton} onPress={handleBannerAction} disabled={billingActionInFlight}>
          <Text style={styles.bannerButtonText}>
            {!userToken
              ? 'Sign In with Magic Link'
              : !profileAccessLoaded
                ? 'Syncing Access...'
                : canEditSettings
                  ? 'Manage Billing'
                  : 'Request Plans by Email'}
          </Text>
        </TouchableOpacity>
        <View style={{ position: 'absolute', right: -10, top: 40, opacity: 0.15 }}>
          <Sparkles size={120} color="#FFFFFF" strokeWidth={1} />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, { backgroundColor: '#DBEAFE' }]}>
          <MapPin size={18} color="#2563EB" />
        </View>
        <Text style={styles.sectionTitle}>Smart Logistics</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.formLabelTop}>STARTING POINT</Text>
        <View style={styles.formRowBetween}>
          <Text style={styles.formValueBold}>Home Base Address</Text>
          <TouchableOpacity
            style={styles.changePill}
            onPress={() => {
              if (!canEditSettings) {
                showLockedSettingsMessage();
                return;
              }
              setShowHomeBaseEditor((prev) => !prev);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.changePillText}>{showHomeBaseEditor ? 'Done' : 'Change'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.dashedBox}
          onPress={() => {
            if (!canEditSettings) {
              showLockedSettingsMessage();
              return;
            }
            setShowHomeBaseEditor((prev) => !prev);
          }}
          activeOpacity={0.85}
        >
          <MapPin size={16} color="#3B82F6" />
          <Text style={styles.dashedBoxText} numberOfLines={1}>
            {preferences.homeBaseLabel || 'Search contacts or address...'}
          </Text>
        </TouchableOpacity>

        {showHomeBaseEditor ? (
          <LocationSearch
            token={token}
            searchContacts={async (t, q) => {
              const r = await searchContacts(t, q);
              return {
                success: r.success,
                contacts: r.success ? r.contacts : undefined,
                error: r.success === false ? r.error : undefined,
                needsConsent: r.success === false ? r.needsConsent : undefined,
              };
            }}
            getAddressSuggestions={async (q) => {
              if (useGoogleWithKey) {
                const r = await getAddressSuggestionsGoogle(q, googleApiKey);
                return {
                  success: r.success,
                  suggestions: r.success ? r.suggestions : undefined,
                  error: r.success === false ? r.error : undefined,
                };
              }
              const authToken = await resolveAuthToken();
              const r = await getAddressSuggestions(q, {
                authToken,
                ...(preferredCountryCode ? { countryCode: preferredCountryCode } : {}),
              });
              return {
                success: r.success,
                suggestions: r.success ? r.suggestions : undefined,
                error: r.success === false ? r.error : undefined,
              };
            }}
            geocodeAddress={async (addr) => {
              if (useGoogleWithKey) {
                const r = await geocodeAddressGoogle(addr, googleApiKey);
                return {
                  success: r.success,
                  lat: r.success ? r.lat : undefined,
                  lon: r.success ? r.lon : undefined,
                  fromCache: r.success ? r.fromCache : undefined,
                  error: r.success === false ? r.error : undefined,
                };
              }
              const authToken = await resolveAuthToken();
              const r = await geocodeAddress(addr, { authToken });
              return {
                success: r.success,
                lat: r.success ? r.lat : undefined,
                lon: r.success ? r.lon : undefined,
                fromCache: r.success ? r.fromCache : undefined,
                error: r.success === false ? r.error : undefined,
              };
            }}
            getCoordsForPlaceId={
              useGoogleWithKey
                ? async (placeId) => {
                    const r = await getCoordsForPlaceId(placeId, googleApiKey);
                    return r.success === true ? { lat: r.lat, lon: r.lon } : { error: r.error };
                  }
                : undefined
            }
            geocodeContactAddress={async (addr, parts) => {
              if (useGoogleWithKey) {
                const r = await geocodeAddressGoogle(addr, googleApiKey);
                return {
                  success: r.success,
                  lat: r.success ? r.lat : undefined,
                  lon: r.success ? r.lon : undefined,
                  fromCache: r.success ? r.fromCache : undefined,
                  error: r.success === false ? r.error : undefined,
                };
              }
              const authToken = await resolveAuthToken();
              const r = await geocodeContactAddress(addr, parts, { authToken });
              return {
                success: r.success,
                lat: r.success ? r.lat : undefined,
                lon: r.success ? r.lon : undefined,
                fromCache: r.success ? r.fromCache : undefined,
                error: r.success === false ? r.error : undefined,
              };
            }}
            selection={homeBaseSelection}
            onSelectionChange={handleHomeBaseChange}
            placeholder="Search contacts or address (e.g. Copenhagen, Office)"
          />
        ) : null}

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.toggleTitle}>Return to base daily</Text>
            <Text style={styles.toggleSubtitle}>
              Calculate routes based on returning home every evening.
            </Text>
          </View>
          <Switch
            value={preferences.alwaysStartFromHomeBase !== false}
            onValueChange={(value) => {
              if (!canEditSettings) {
                showLockedSettingsMessage();
                return;
              }
              void saveProfilePatch({ alwaysStartFromHomeBase: value });
            }}
            trackColor={{ false: '#E2E8F0', true: '#3B82F6' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.toggleTitle}>High-Precision Search</Text>
              <View style={styles.badgePill}>
                <Text style={styles.badgePillText}>BASIC+</Text>
              </View>
            </View>
            <Text style={styles.toggleSubtitle}>
              Power your search with Google Maps for 99.9% accuracy.
            </Text>
          </View>
          <Switch
            value={useGoogle}
            onValueChange={handleToggleAdvancedGeocoding}
            disabled={featureUpdateKey !== null}
            trackColor={{ false: '#E2E8F0', true: '#3B82F6' }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, { backgroundColor: '#EDE9FE' }]}>
          <Zap size={18} color="#8B5CF6" />
        </View>
        <Text style={styles.sectionTitle}>Advanced Planning</Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.toggleRow}>
          <View
            style={[
              styles.sectionIconBox,
              { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#F1F5F9', width: 44, height: 44, borderRadius: 12 },
            ]}
          >
            <Car size={20} color="#6366F1" />
          </View>
          <View style={styles.toggleTextCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.toggleTitle, { marginBottom: 2 }]}>Traffic-Aware Routing</Text>
              <View style={[styles.badgePill, styles.badgePillPro]}>
                <Text style={[styles.badgePillText, styles.badgePillTextPro]}>PRO</Text>
              </View>
            </View>
            <Text style={styles.toggleSubtitle}>
              Live traffic data adjusts your schedule automatically.
            </Text>
          </View>
          <Switch
            value={useTrafficRouting}
            onValueChange={handleToggleTrafficRouting}
            disabled={featureUpdateKey !== null}
            trackColor={{ false: '#E2E8F0', true: '#3B82F6' }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => {
            if (!canUseClientNotifications) {
              void requestPlansEmailForFeature('premium', 'AI Client Liaison', 'notifications.ai.client');
            }
          }}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.sectionIconBox,
              { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#F1F5F9', width: 44, height: 44, borderRadius: 12 },
            ]}
          >
            <MessageSquare size={20} color="#D946EF" />
          </View>
          <View style={styles.toggleTextCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.toggleTitle, { marginBottom: 2 }]}>AI Client Liaison</Text>
              <View style={[styles.badgePill, styles.badgePillPremium]}>
                <Text style={[styles.badgePillText, styles.badgePillTextPro]}>PREMIUM</Text>
              </View>
            </View>
            <Text style={styles.toggleSubtitle}>
              {canUseClientNotifications
                ? 'Included in your current plan.'
                : 'Draft professional ETA updates with one tap.'}
            </Text>
          </View>
          <ChevronRight size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, { backgroundColor: '#DCFCE7' }]}>
          <Calendar size={18} color="#16A34A" />
        </View>
        <Text style={styles.sectionTitle}>Calendar Sync</Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.toggleRow}>
          <View
            style={[
              styles.sectionIconBox,
              { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#F1F5F9', width: 44, height: 44, borderRadius: 12 },
            ]}
          >
            <Calendar size={20} color="#16A34A" />
          </View>
          <View style={styles.toggleTextCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.toggleTitle, { marginBottom: 2 }]}>Connect Outlook Calendar</Text>
              <View style={styles.badgePill}>
                <Text style={styles.badgePillText}>BASIC+</Text>
              </View>
            </View>
            <Text style={styles.toggleSubtitle}>
              {calendarSyncEnabled
                ? 'Calendar connected. Your profile is ready for sync-enabled planning.'
                : 'Connect your Microsoft account to enable calendar and contact sync.'}
            </Text>
          </View>
          <Switch
            value={calendarSyncEnabled}
            onValueChange={handleToggleCalendarConnected}
            disabled={featureUpdateKey !== null}
            trackColor={{ false: '#E2E8F0', true: '#3B82F6' }}
            thumbColor="#FFFFFF"
          />
        </View>
        {!calendarSyncEnabled && userToken && canSyncCalendar ? (
          <TouchableOpacity
            onPress={() => setShowOutlookConnectModal(true)}
            activeOpacity={0.8}
            style={{
              marginTop: 14,
              alignSelf: 'flex-start',
              backgroundColor: '#EFF6FF',
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: '#1D4ED8', fontWeight: '700', fontSize: 12 }}>
              Connect Microsoft Account
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, { backgroundColor: '#D1FAE5' }]}> 
          <Clock size={18} color="#10B981" />
        </View>
        <Text style={styles.sectionTitle}>Buffer Intervals</Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sliderBlock}>
          <View style={styles.sliderLabelRow}>
            <View>
              <Text style={styles.formLabelTop}>PREPARATION</Text>
              <Text style={styles.formValueBold}>Pre-Meeting Buffer</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.sliderValueText}>{parseInt(preBuffer, 10) || 0}</Text>
              <Text style={styles.sliderValueUnit}> MIN</Text>
            </View>
          </View>
          <Slider
            style={{ width: '100%', height: 32 }}
            minimumValue={0}
            maximumValue={60}
            step={5}
            value={Math.round((parseInt(preBuffer, 10) || 0) / 5) * 5}
            onValueChange={(v) => setPreBuffer(String(Math.round(v / 5) * 5))}
            onSlidingComplete={() => savePreBuffer()}
            minimumTrackTintColor="#2563EB"
            maximumTrackTintColor="#E2E8F0"
            thumbTintColor="#FFFFFF"
          />
          <View style={styles.sliderMarksRow}>
            <Text style={styles.sliderMarkText}>0m</Text>
            <Text style={styles.sliderMarkText}>30m</Text>
            <Text style={styles.sliderMarkText}>60m</Text>
          </View>
        </View>

        <View style={styles.sliderBlock}>
          <View style={styles.sliderLabelRow}>
            <View>
              <Text style={styles.formLabelTop}>DOCUMENTATION</Text>
              <Text style={styles.formValueBold}>Post-Meeting Buffer</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.sliderValueText}>{parseInt(postBuffer, 10) || 0}</Text>
              <Text style={styles.sliderValueUnit}> MIN</Text>
            </View>
          </View>
          <Slider
            style={{ width: '100%', height: 32 }}
            minimumValue={0}
            maximumValue={60}
            step={5}
            value={Math.round((parseInt(postBuffer, 10) || 0) / 5) * 5}
            onValueChange={(v) => setPostBuffer(String(Math.round(v / 5) * 5))}
            onSlidingComplete={() => savePostBuffer()}
            minimumTrackTintColor="#2563EB"
            maximumTrackTintColor="#E2E8F0"
            thumbTintColor="#FFFFFF"
          />
          <View style={styles.sliderMarksRow}>
            <Text style={styles.sliderMarkText}>0m</Text>
            <Text style={styles.sliderMarkText}>30m</Text>
            <Text style={styles.sliderMarkText}>60m</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.sliderBlock}>
          <View style={styles.sliderLabelRow}>
            <View>
              <Text style={styles.formLabelTop}>SCHEDULE</Text>
              <Text style={styles.formValueBold}>Work Start Time</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.sliderValueText}>{slotToTime(workStartSlot)}</Text>
            </View>
          </View>
          <Slider
            style={{ width: '100%', height: 32 }}
            minimumValue={0}
            maximumValue={MAX_SLOT}
            step={1}
            value={workStartSlot}
            onValueChange={(v) => setWorkStartSlot(Math.round(v))}
            onSlidingComplete={(v) => saveWorkingHours(Math.round(v), workEndSlot)}
            minimumTrackTintColor="#2563EB"
            maximumTrackTintColor="#E2E8F0"
            thumbTintColor="#FFFFFF"
          />
          <View style={styles.sliderMarksRow}>
            <Text style={styles.sliderMarkText}>00:00</Text>
            <Text style={styles.sliderMarkText}>12:00</Text>
            <Text style={styles.sliderMarkText}>23:55</Text>
          </View>
        </View>

        <View style={styles.sliderBlock}>
          <View style={styles.sliderLabelRow}>
            <View>
              <Text style={styles.formLabelTop}>SCHEDULE</Text>
              <Text style={styles.formValueBold}>Work End Time</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.sliderValueText}>{slotToTime(workEndSlot)}</Text>
            </View>
          </View>
          <Slider
            style={{ width: '100%', height: 32 }}
            minimumValue={0}
            maximumValue={MAX_SLOT}
            step={1}
            value={workEndSlot}
            onValueChange={(v) => setWorkEndSlot(Math.round(v))}
            onSlidingComplete={(v) => saveWorkingHours(workStartSlot, Math.round(v))}
            minimumTrackTintColor="#2563EB"
            maximumTrackTintColor="#E2E8F0"
            thumbTintColor="#FFFFFF"
          />
          <View style={styles.sliderMarksRow}>
            <Text style={styles.sliderMarkText}>00:00</Text>
            <Text style={styles.sliderMarkText}>12:00</Text>
            <Text style={styles.sliderMarkText}>23:55</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View>
          <Text style={styles.formLabelTop}>SCHEDULE</Text>
          <Text style={styles.formValueBold}>Working Days</Text>
          <View style={styles.workingDaysRow}>
            {DAY_LABELS.map((label, i) => (
              <TouchableOpacity
                key={label}
                style={[styles.dayPill, workingDays[i] && styles.dayPillActive]}
                onPress={() => toggleWorkingDay(i)}
                activeOpacity={0.8}
              >
                <Text style={[styles.dayPillText, workingDays[i] && styles.dayPillTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.footerLinkCard}
        onPress={() => {
          void handleManageBilling();
        }}
        disabled={billingActionInFlight}
        activeOpacity={0.8}
      >
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <CreditCard size={20} color="#64748B" />
            <Text style={styles.footerLinkText}>Manage Billing</Text>
          </View>
          {billingSnapshot?.subscription ? (
            <Text style={{ marginTop: 6, color: '#64748B', fontSize: 12, fontWeight: '500' }}>
              {`${billingSnapshot.subscription.status} - ${billingSnapshot.subscription.billingInterval}`}
            </Text>
          ) : null}
        </View>
        {billingActionInFlight ? (
          <ActivityIndicator size="small" color="#94A3B8" />
        ) : (
          <ChevronRight size={18} color="#94A3B8" />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={() => (userToken ? signOut() : handleClearLocalData())}
        activeOpacity={0.7}
      >
        <LogOut size={16} color="#EF4444" />
        <Text style={styles.signOutText}>{userToken ? 'Sign Out' : 'Clear Local Data'}</Text>
      </TouchableOpacity>

      {userToken ? (
        <TouchableOpacity
          style={styles.deleteAccountButton}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
          disabled={deleteAccountInFlight}
        >
          {deleteAccountInFlight ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Trash2 size={16} color="#FFFFFF" />
          )}
          <Text style={styles.deleteAccountText}>Delete Account</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.versionBox}>
        <Text style={styles.versionTitle}>WISEPLAN SECURE SHELL V2.4.0</Text>
        <Text style={styles.versionSubtitle}>
          Ensuring your data stays private and your routes stay optimized.
        </Text>
      </View>

      <OutlookConnectModal
        visible={showOutlookConnectModal}
        onClose={() => setShowOutlookConnectModal(false)}
        onConnected={handleOutlookConnected}
      />

      <AuthPromptModal
        visible={authModalVisible}
        onClose={() => setAuthModalVisible(false)}
        title={authModalTitle}
        subtitle={authModalSubtitle}
      />
    </ScrollView>
  );
}
