import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';

const MS_BLUE = '#0078D4';

type Section = 'User Story' | 'Roadmap' | 'Architecture' | 'Logic Specs';

const SECTIONS: Section[] = [
  'User Story',
  'Roadmap',
  'Architecture',
  'Logic Specs',
];

export default function DevDocsScreen() {
  const [section, setSection] = useState<Section>('User Story');

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segmentedScroll}
        contentContainerStyle={styles.segmentedContent}
      >
        {SECTIONS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.segment, section === tab && styles.segmentActive]}
            onPress={() => setSection(tab)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentText,
                section === tab && styles.segmentTextActive,
              ]}
              numberOfLines={1}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {section === 'User Story' && <UserStorySection />}
        {section === 'Roadmap' && <RoadmapSection />}
        {section === 'Architecture' && <ArchitectureSection />}
        {section === 'Logic Specs' && <LogicSpecsSection />}
      </ScrollView>
    </View>
  );
}

function UserStorySection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>User Story: Dave & Køge</Text>
      <Text style={styles.body}>
        Dave is a field rep based in the Copenhagen area. His calendar is packed
        with meetings across the week, but they’re scattered: some in central
        Copenhagen, some in Køge, others in suburbs. He wastes hours driving
        back and forth instead of batching visits by area.
      </Text>
      <Text style={styles.body}>
        RouteCopilot doesn’t just look for “empty slots” in his calendar. It
        scans the whole week to find geographic clusters: groups of existing
        meetings that are close to each other in location and time. When it
        finds a cluster (e.g. several commitments in or near Køge on Thursday),
        it suggests adding new meetings in that same area to minimize travel.
      </Text>
      <Text style={styles.body}>
        The goal: fewer miles, less stress, more face-to-face time with clients
        in the same region on the same day.
      </Text>
    </View>
  );
}

function RoadmapSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Roadmap</Text>

      <Text style={styles.h2}>Phase 1: Skeleton</Text>
      <Text style={styles.body}>
        MVP app shell: Day View, Map, Dev docs. Bottom tabs, hardcoded
        meetings, and this documentation screen. Establishes navigation and
        UI patterns.
      </Text>

      <Text style={styles.h2}>Phase 2: Outlook Brain</Text>
      <Text style={styles.body}>
        Connect to Microsoft Graph: read calendar events and contacts. Sync
        meetings and locations into the app. User sees real calendar data
        instead of placeholders. Auth (e.g. MSAL) and backend API for
        token exchange.
      </Text>

      <Text style={styles.h2}>Phase 3: Optimization Algorithm</Text>
      <Text style={styles.body}>
        Use Mapbox Matrix API (or similar) for travel times. Implement
        clustering and slot-suggestion logic: “You’re already in Køge on
        Thursday—here are 3 contacts nearby you could slot in.” Display
        suggested blocks and optional reordering on the map and day view.
      </Text>

      <Text style={styles.h2}>Phase 4: Admin View</Text>
      <Text style={styles.body}>
        Admin dashboard (web or in-app): manage users, view usage, configure
        regions or rules. Support for multiple reps and optional reporting.
      </Text>
    </View>
  );
}

function ArchitectureSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Architecture</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Expo — React Native app (this repo)</Text>
        <Text style={styles.stackItem}>Node.js on VPS — API and sync logic (Docker)</Text>
        <Text style={styles.stackItem}>PostgreSQL — Users, meetings, contacts, suggestions</Text>
        <Text style={styles.stackItem}>Mapbox Matrix API — Travel-time and distance matrix</Text>
        <Text style={styles.stackItem}>Microsoft Graph — Calendar and contacts (Outlook)</Text>
      </View>
      <Text style={styles.body}>
        Mobile talks to the Node backend; backend stores data in Postgres and
        calls Mapbox and Microsoft Graph as needed.
      </Text>
    </View>
  );
}

function LogicSpecsSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Logic Specs</Text>

      <Text style={styles.h2}>3-Hour Block Rule</Text>
      <Text style={styles.body}>
        Each suggested meeting block is treated as a 3-hour unit:
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• 1 hour — Travel (to the area or between nearby stops)</Text>
        <Text style={styles.ruleItem}>• 1 hour — Meeting (the actual appointment)</Text>
        <Text style={styles.ruleItem}>• 1 hour — Buffer (unexpected delays, wrap-up, next leg)</Text>
      </View>
      <Text style={styles.body}>
        When scanning the week, the algorithm looks for open 3-hour windows
        that align with geographic clusters. Shorter or longer blocks can be
        derived from this base rule (e.g. 2h for very local follow-ups).
      </Text>

      <Text style={styles.h2}>Outlook Contacts First</Text>
      <Text style={styles.body}>
        The search strategy prioritizes people the user already works with:
        contacts from Outlook (and later other sources) are considered first
        when suggesting “who to meet in this cluster.” The system may
        suggest: “You have meetings in Køge on Thursday; 4 of your contacts
        have offices there—consider scheduling one of them in the same
        block.”
      </Text>
      <Text style={styles.body}>
        This keeps suggestions relevant and increases the chance that
        suggested slots turn into real meetings with existing relationships.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  segmentedScroll: {
    maxHeight: 48,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  segmentedContent: {
    paddingHorizontal: 4,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    marginRight: 8,
  },
  segmentActive: {
    backgroundColor: MS_BLUE,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  h1: {
    fontSize: 22,
    fontWeight: '700',
    color: MS_BLUE,
    marginBottom: 16,
  },
  h2: {
    fontSize: 17,
    fontWeight: '700',
    color: MS_BLUE,
    marginTop: 16,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 12,
  },
  stackList: {
    marginBottom: 12,
  },
  stackItem: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 6,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: MS_BLUE,
  },
  ruleList: {
    marginBottom: 12,
  },
  ruleItem: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 4,
  },
});
