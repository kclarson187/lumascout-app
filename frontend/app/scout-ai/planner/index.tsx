import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, CalendarDays, MapPinned, FolderPlus, Sparkles } from 'lucide-react-native';
import { colors, font, space, radii } from '../../../src/theme';

const PLANNERS = [
  {
    id: 'weekend',
    route: '/scout-ai/planner/weekend',
    title: 'Weekend shoot planner',
    description: 'Tell Scout AI a city and a focus — it maps an ordered itinerary of spots across Saturday & Sunday light windows.',
    Icon: CalendarDays,
    tint: '#ffb547',
  },
  {
    id: 'route',
    route: '/scout-ai/planner/route',
    title: 'Photo route planner',
    description: 'Pick a starting point. Scout AI orders nearby spots into a driving route that respects golden hour and minimises back-tracking.',
    Icon: MapPinned,
    tint: '#6aa9ff',
  },
  {
    id: 'collection',
    route: '/scout-ai/planner/collection',
    title: 'Collection planner',
    description: 'Describe a theme or vibe — Scout AI assembles a named collection of matching existing spots you can save in one tap.',
    Icon: FolderPlus,
    tint: '#74d88f',
  },
];

export default function PlannerHub() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headTitle}>Scout AI planners</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroBubble}>
            <Sparkles size={20} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Plan your next shoot in seconds</Text>
          <Text style={styles.heroBody}>
            Scout AI uses public spots, light windows, and your preferences to
            hand you a ready-to-shoot plan. Review and edit anything before you go.
          </Text>
        </View>

        {PLANNERS.map(p => (
          <TouchableOpacity
            key={p.id}
            style={styles.card}
            onPress={() => router.push(p.route as any)}
            testID={`planner-${p.id}`}
            activeOpacity={0.85}
          >
            <View style={[styles.cardIcon, { backgroundColor: `${p.tint}20`, borderColor: `${p.tint}55` }]}>
              <p.Icon size={20} color={p.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{p.title}</Text>
              <Text style={styles.cardBody}>{p.description}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 17 },
  hero: { marginBottom: space.xl },
  heroBubble: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(32,130,255,0.12)', borderWidth: 1, borderColor: 'rgba(32,130,255,0.35)',
    marginBottom: space.md,
  },
  heroTitle: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.5 },
  heroBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 21, marginTop: 6 },
  card: {
    flexDirection: 'row', gap: 12,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: space.md,
    marginBottom: space.md,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  cardTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  cardBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
});
