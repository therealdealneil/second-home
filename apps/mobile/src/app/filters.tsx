import {
  AGE_BRACKETS,
  AGE_BRACKET_LABELS,
  DEFAULT_DISCOVERY_FILTERS,
  DISCOVERY_RADIUS_OPTIONS_MILES,
  LIFE_STAGES,
  LIFE_STAGE_LABELS,
  type AgeBracket,
  type DiscoveryRadiusMiles,
  type LifeStage,
  type OriginMatchMode,
} from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { dismissOrReturnHome } from "@/lib/navigation";
import { useAppFlow } from "@/state/AppFlowContext";

export default function FiltersSheet() {
  const router = useRouter();
  const { state, updateFilters } = useAppFlow();

  function setOriginMode(originMode: OriginMatchMode) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateFilters({ originMode });
  }

  function setRadius(radiusMiles: DiscoveryRadiusMiles) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateFilters({ radiusMiles });
  }

  function toggleAgeBracket(bracket: AgeBracket) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const current = state.filters.ageBrackets;
    const next = current.includes(bracket)
      ? current.filter((b) => b !== bracket)
      : [...current, bracket];
    updateFilters({ ageBrackets: next });
  }

  function toggleLifeStage(stage: LifeStage) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const current = state.filters.lifeStages;
    const next = current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage];
    updateFilters({ lifeStages: next });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>DISCOVERY FILTERS</Text>
      <Text style={styles.title}>Filter San Antonio Matches</Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
        <Text style={styles.sectionLabel}>Origin Match</Text>
        <View style={styles.pillsRow}>
          <Pressable
            style={[styles.pill, state.filters.originMode === "exact_town" && styles.pillSelected]}
            onPress={() => setOriginMode("exact_town")}
          >
            <Text
              style={[
                styles.pillText,
                state.filters.originMode === "exact_town" && styles.pillTextSelected,
              ]}
            >
              Exact Town{state.selectedOrigin ? ` (${state.selectedOrigin.name})` : ""}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.pill, state.filters.originMode === "all_gujarat" && styles.pillSelected]}
            onPress={() => setOriginMode("all_gujarat")}
          >
            <Text
              style={[
                styles.pillText,
                state.filters.originMode === "all_gujarat" && styles.pillTextSelected,
              ]}
            >
              All Gujarat
            </Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>San Antonio Radius (max 25 mi)</Text>
        <View style={styles.pillsRow}>
          {DISCOVERY_RADIUS_OPTIONS_MILES.map((miles) => {
            const selected = state.filters.radiusMiles === miles;
            return (
              <Pressable
                key={miles}
                style={[styles.pill, selected && styles.pillSelected]}
                onPress={() => setRadius(miles)}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {miles} mi
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Age Bracket</Text>
        <View style={styles.pillsRow}>
          {AGE_BRACKETS.map((bracket) => {
            const selected = state.filters.ageBrackets.includes(bracket);
            return (
              <Pressable
                key={bracket}
                style={[styles.pill, selected && styles.pillSelected]}
                onPress={() => toggleAgeBracket(bracket)}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {AGE_BRACKET_LABELS[bracket]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Life Stage</Text>
        <View style={styles.pillsRow}>
          {LIFE_STAGES.map((stage) => {
            const selected = state.filters.lifeStages.includes(stage);
            return (
              <Pressable
                key={stage}
                style={[styles.pill, selected && styles.pillSelected]}
                onPress={() => toggleLifeStage(stage)}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {LIFE_STAGE_LABELS[stage]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footerRow}>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => updateFilters(DEFAULT_DISCOVERY_FILTERS)}
        >
          <Text style={styles.secondaryButtonText}>Reset</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={() => dismissOrReturnHome(router)}>
          <Text style={styles.primaryButtonText}>Apply Filters</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: 24,
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0F766E",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0F172A",
  },
  scrollBody: {
    gap: 10,
    paddingBottom: 12,
  },
  sectionLabel: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  pillSelected: {
    backgroundColor: "#0F766E",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  pillTextSelected: {
    color: "#FFFFFF",
  },
  footerRow: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 4,
  },
  secondaryButton: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "600",
  },
  primaryButton: {
    flex: 1,
    backgroundColor: "#0F766E",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
