import {
  DISCOVERY_RADIUS_OPTIONS_MILES,
  type DiscoveryRadiusMiles,
  type OriginMatchMode,
} from "@second-home/shared";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dismissOrReturnHome } from "@/lib/navigation";
import { useAppFlow } from "@/state/AppFlowContext";

export default function FiltersSheet() {
  const router = useRouter();
  const { state, updateFilters } = useAppFlow();

  function setOriginMode(originMode: OriginMatchMode) {
    updateFilters({ originMode });
  }

  function setRadius(radiusMiles: DiscoveryRadiusMiles) {
    updateFilters({ radiusMiles });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>DISCOVERY FILTERS · SHELL</Text>
      <Text style={styles.title}>Filter San Antonio Matches</Text>

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
            Exact Town
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
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{miles} mi</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={styles.primaryButton} onPress={() => dismissOrReturnHome(router)}>
        <Text style={styles.primaryButtonText}>Done</Text>
      </Pressable>
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
  primaryButton: {
    marginTop: 12,
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
