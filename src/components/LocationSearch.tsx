import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
} from 'react-native';
import { X } from 'lucide-react-native';
import type { ContactSearchResult } from '../services/graph';
import type { AddressSuggestion } from '../utils/geocoding';
import type { Coordinate } from '../utils/scheduler';

const MS_BLUE = '#0078D4';
const DEBOUNCE_MS = 300;

export type LocationSelection =
  | { type: 'none' }
  | { type: 'contact'; contact: ContactSearchResult; coords: Coordinate }
  | { type: 'address'; address: string; coords: Coordinate };

export type LocationSearchProps = {
  token: string | null;
  searchContacts: (token: string, query: string) => Promise<{
    success: boolean;
    contacts?: ContactSearchResult[];
    error?: string;
    needsConsent?: boolean;
  }>;
  getAddressSuggestions: (query: string) => Promise<{
    success: boolean;
    suggestions?: AddressSuggestion[];
    error?: string;
  }>;
  geocodeAddress: (address: string) => Promise<{
    success: boolean;
    lat?: number;
    lon?: number;
    fromCache?: boolean;
    error?: string;
  }>;
  /** Optional: geocode contact address with fallback (uses address parts for progressive tries) */
  geocodeContactAddress?: (
    formattedAddress: string,
    parts: { street?: string; city?: string; state?: string; postalCode?: string; countryOrRegion?: string } | null
  ) => Promise<{
    success: boolean;
    lat?: number;
    lon?: number;
    fromCache?: boolean;
    error?: string;
  }>;
  selection: LocationSelection;
  onSelectionChange: (sel: LocationSelection) => void;
  onGraphError?: (msg: string, needsConsent?: boolean) => void;
  placeholder?: string;
  /** DEV: callback for diagnostics */
  onDebug?: (info: Record<string, unknown>) => void;
};

export default function LocationSearch({
  token,
  searchContacts,
  getAddressSuggestions,
  geocodeAddress,
  geocodeContactAddress,
  selection,
  onSelectionChange,
  onGraphError,
  placeholder = 'Search Client or Address',
  onDebug,
}: LocationSearchProps) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactSearchResult[]>([]);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const selectingRef = useRef(false);
  const geocodeCacheRef = useRef<Map<string, { lat: number; lon: number }>>(new Map());
  const cancelSelectRef = useRef(false);
  const [resolvingContact, setResolvingContact] = useState<ContactSearchResult | null>(null);

  const propsRef = useRef({
    token,
    searchContacts,
    getAddressSuggestions,
    geocodeAddress,
    geocodeContactAddress,
    onGraphError,
    onDebug,
    onSelectionChange,
  });
  propsRef.current = {
    token,
    searchContacts,
    getAddressSuggestions,
    geocodeAddress,
    geocodeContactAddress,
    onGraphError,
    onDebug,
    onSelectionChange,
  };

  const runSearch = useCallback(async (q: string) => {
    const { token: t, searchContacts: sc, getAddressSuggestions: gas, onGraphError: oge, onDebug: od } = propsRef.current;
    const trimmed = q.trim();
    const id = ++requestIdRef.current;
    setLoading(true);
    setGraphError(null);

    const [contactsResult, addrResult] = await Promise.all([
      t ? sc(t, trimmed) : Promise.resolve({ success: false, contacts: [], error: 'Not signed in' }),
      gas(trimmed),
    ]);

    if (id !== requestIdRef.current) return;

    if (!contactsResult.success && contactsResult.error) {
      setGraphError(contactsResult.error);
      oge?.(contactsResult.error, contactsResult.needsConsent);
    } else {
      setGraphError(null);
    }

    const contactList = contactsResult.success ? contactsResult.contacts ?? [] : [];
    setContacts(contactList);
    setAddressSuggestions(addrResult.success ? addrResult.suggestions ?? [] : []);
    setLoading(false);

    if (contactList.length > 0 && propsRef.current.geocodeContactAddress) {
      contactList.slice(0, 5).forEach((c) => {
        if (c.hasAddress && !geocodeCacheRef.current.has(c.id)) {
          propsRef.current.geocodeContactAddress!(c.formattedAddress, c.bestAddress).then((r) => {
            if (r.success && r.lat != null && r.lon != null) {
              geocodeCacheRef.current.set(c.id, { lat: r.lat, lon: r.lon });
            }
          });
        }
      });
    }

    od?.({
      contactsCount: contactsResult.success ? (contactsResult.contacts?.length ?? 0) : 0,
      addressSuggestionsCount: addrResult.success ? (addrResult.suggestions?.length ?? 0) : 0,
      graphError: contactsResult.success ? null : contactsResult.error,
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setContacts([]);
      setAddressSuggestions([]);
      setLoading(false);
      setGraphError(null);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const handleSelectContact = useCallback(async (contact: ContactSearchResult) => {
    if (!contact.hasAddress) {
      propsRef.current.onGraphError?.('This contact has no address. Enter an address manually.');
      return;
    }
    if (selectingRef.current) return;
    selectingRef.current = true;
    setContacts([]);
    setAddressSuggestions([]);
    setQuery('');
    setResolvingContact(contact);
    Keyboard.dismiss();
    cancelSelectRef.current = false;

    try {
      const cached = geocodeCacheRef.current.get(contact.id);
      let result: { success: boolean; lat?: number; lon?: number; fromCache?: boolean };
      if (cached) {
        result = { success: true, lat: cached.lat, lon: cached.lon, fromCache: true };
      } else {
        result = propsRef.current.geocodeContactAddress
          ? await propsRef.current.geocodeContactAddress(contact.formattedAddress, contact.bestAddress)
          : await propsRef.current.geocodeAddress(contact.formattedAddress);
      }
      if (!result.success) {
        propsRef.current.onGraphError?.(result.error ?? 'Could not find location');
        propsRef.current.onDebug?.({ geocodeError: result.error });
        setResolvingContact(null);
        return;
      }

      if (cancelSelectRef.current) {
        setResolvingContact(null);
        return;
      }

      if (result.success && result.lat != null && result.lon != null) {
        geocodeCacheRef.current.set(contact.id, { lat: result.lat, lon: result.lon });
      }

      propsRef.current.onSelectionChange({
        type: 'contact',
        contact,
        coords: { lat: result.lat!, lon: result.lon! },
      });

      propsRef.current.onDebug?.({
        selectedContact: contact.displayName,
        selectedAddress: contact.formattedAddress,
        geocodeResult: `${result.lat}, ${result.lon}`,
        geocodeCacheHit: !!cached || result.fromCache,
      });
    } finally {
      selectingRef.current = false;
      setResolvingContact(null);
    }
  }, []);

  const handleSelectAddress = useCallback((suggestion: AddressSuggestion) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    propsRef.current.onSelectionChange({
      type: 'address',
      address: suggestion.displayName,
      coords: { lat: suggestion.lat, lon: suggestion.lon },
    });
    setContacts([]);
    setAddressSuggestions([]);
    setQuery('');
    Keyboard.dismiss();

    propsRef.current.onDebug?.({
      selectedAddress: suggestion.displayName,
      geocodeResult: `${suggestion.lat}, ${suggestion.lon}`,
      geocodeSource: 'nominatim_suggestion',
    });
    selectingRef.current = false;
  }, []);

  const handleClear = () => {
    cancelSelectRef.current = true;
    setResolvingContact(null);
    onSelectionChange({ type: 'none' });
    setQuery('');
    setContacts([]);
    setAddressSuggestions([]);
    setGraphError(null);
  };

  const hasSelection = selection.type !== 'none';
  const displayValue = resolvingContact
    ? `${resolvingContact.displayName} · Resolving…`
    : hasSelection
      ? selection.type === 'contact'
        ? selection.contact.displayName + (selection.contact.formattedAddress ? ` · ${selection.contact.formattedAddress}` : '')
        : selection.address
      : query;

  const showDropdown = !hasSelection && (contacts.length > 0 || addressSuggestions.length > 0);

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, hasSelection && styles.inputSelected]}
          placeholder={placeholder}
          placeholderTextColor="#605E5C"
          value={displayValue}
          onChangeText={(t) => {
            if (hasSelection) handleClear();
            setQuery(t);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={true}
        />
        {(hasSelection || resolvingContact) && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClear}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X color="#605E5C" size={20} />
          </TouchableOpacity>
        )}
      </View>

      {graphError && (
        <Text style={styles.errorText}>{graphError}</Text>
      )}

      {loading && query.trim() && !showDropdown && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={MS_BLUE} />
          <Text style={styles.loadingText}>Searching…</Text>
        </View>
      )}

      {showDropdown && (
        <ScrollView
          style={styles.dropdown}
          contentContainerStyle={styles.dropdownContent}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          showsVerticalScrollIndicator={true}
        >
          {loading && (
            <View style={styles.dropdownLoading}>
              <ActivityIndicator size="small" color={MS_BLUE} />
              <Text style={styles.loadingText}>Searching…</Text>
            </View>
          )}
          {contacts.length > 0 && (
            <Text style={styles.sectionLabel}>Contacts</Text>
          )}
          {contacts.map((c) => (
            <Pressable
              key={c.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => c.hasAddress && handleSelectContact(c)}
              disabled={!c.hasAddress}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>
                {c.displayName}
                {c.companyName ? ` · ${c.companyName}` : ''}
              </Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {c.hasAddress ? c.formattedAddress : 'No address'}
              </Text>
              {!c.hasAddress && (
                <Text style={styles.noAddressHint}>Select an address below</Text>
              )}
            </Pressable>
          ))}

          {addressSuggestions.length > 0 && (
            <Text style={[styles.sectionLabel, contacts.length > 0 && styles.sectionLabelSpaced]}>
              Address suggestions
            </Text>
          )}
          {addressSuggestions.map((a, i) => (
            <Pressable
              key={`addr-${i}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => handleSelectAddress(a)}
            >
              <Text style={styles.rowSubtitle} numberOfLines={2}>
                {a.displayName}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E1DFDD',
    borderRadius: 8,
    paddingRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1a1a1a',
    minHeight: 52,
  },
  inputSelected: {
    color: '#107C10',
  },
  clearBtn: {
    padding: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#d32f2f',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  loadingText: {
    fontSize: 14,
    color: '#605E5C',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 4,
    gap: 8,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E1DFDD',
    maxHeight: 280,
  },
  dropdownContent: {
    paddingVertical: 4,
  },
  dropdownLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  rowPressed: {
    backgroundColor: '#f1f5f9',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#605E5C',
    marginHorizontal: 12,
    marginTop: 8,
  },
  sectionLabelSpaced: {
    marginTop: 16,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1DFDD',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#605E5C',
    marginTop: 2,
  },
  noAddressHint: {
    fontSize: 12,
    color: '#d32f2f',
    marginTop: 4,
  },
});
