import { Ionicons } from "@expo/vector-icons";
import {
  LIFE_STAGE_LABELS,
  type DiscoveryFilters,
  type GujaratLocation,
  type MatchedHouseholdPin,
} from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type DiscoveryTopControlsProps = {
  filters: DiscoveryFilters;
  selectedOrigin: GujaratLocation | null;
  isGhostMode: boolean;
  onToggleOriginMode: () => void;
  onOpenFilters: () => void;
  onToggleGhostMode: () => void;
};

export function DiscoveryTopControls({
  filters,
  selectedOrigin,
  isGhostMode,
  onToggleOriginMode,
  onOpenFilters,
  onToggleGhostMode,
}: DiscoveryTopControlsProps) {
  const activeFilterCount = filters.ageBrackets.length + filters.lifeStages.length;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.topStrip}
    >
      <Pressable
        style={[styles.filterPill, filters.originMode === "exact_town" && styles.filterPillActive]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggleOriginMode();
        }}
      >
        <Ionicons
          name="compass"
          size={14}
          color={filters.originMode === "exact_town" ? "#FFFFFF" : "#0F172A"}
        />
        <Text
          style={[
            styles.filterPillText,
            filters.originMode === "exact_town" && styles.filterPillTextActive,
          ]}
        >
          {filters.originMode === "exact_town"
            ? (selectedOrigin?.name ?? "Exact Town")
            : "All Gujarat"}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.filterPill, activeFilterCount > 0 && styles.filterPillActive]}
        onPress={onOpenFilters}
      >
        <Ionicons name="options" size={14} color={activeFilterCount > 0 ? "#FFFFFF" : "#0F172A"} />
        <Text style={[styles.filterPillText, activeFilterCount > 0 && styles.filterPillTextActive]}>
          {filters.radiusMiles} mi · Filters
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.filterPill, isGhostMode && styles.ghostPillActive]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggleGhostMode();
        }}
      >
        <Ionicons
          name={isGhostMode ? "eye-off" : "eye"}
          size={14}
          color={isGhostMode ? "#92400E" : "#0F172A"}
        />
        <Text style={[styles.filterPillText, isGhostMode && styles.ghostPillText]}>
          {isGhostMode ? "Ghost Mode On" : "Visible"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

type DiscoveryBottomTrayProps = {
  households: readonly MatchedHouseholdPin[];
  neighborhoodLabel: string;
  isGhostMode: boolean;
  onSelectHousehold: (householdId: string) => void;
  onShowAllGujarat: () => void;
  onResetFilters: () => void;
};

export function DiscoveryBottomTray({
  households,
  neighborhoodLabel,
  isGhostMode,
  onSelectHousehold,
  onShowAllGujarat,
  onResetFilters,
}: DiscoveryBottomTrayProps) {
  return (
    <View style={styles.trayCard}>
      <View style={styles.trayHeader}>
        <Text style={styles.trayTitle}>
          {households.length} household{households.length !== 1 ? "s" : ""} near {neighborhoodLabel}
        </Text>
        {isGhostMode ? <Text style={styles.ghostHint}>Pin paused</Text> : null}
      </View>

      {households.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            No households match these filters within your radius.
          </Text>
          <View style={styles.emptyActions}>
            <Pressable style={styles.emptyPrimaryBtn} onPress={onShowAllGujarat}>
              <Text style={styles.emptyPrimaryText}>Show All Gujarat</Text>
            </Pressable>
            <Pressable style={styles.emptySecondaryBtn} onPress={onResetFilters}>
              <Text style={styles.emptySecondaryText}>Reset Filters</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardsRow}
        >
          {households.map((item) => {
            const originsSummary = Array.from(
              new Set(item.members.map((m) => m.hometownDistrict)),
            ).join(" & ");
            return (
              <Pressable
                key={item.householdId}
                style={styles.householdCard}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSelectHousehold(item.householdId);
                }}
              >
                <View style={styles.cardTopRow}>
                  <Text style={styles.householdTitle} numberOfLines={1}>
                    {item.displayLabel}
                  </Text>
                  {item.isVerifiedLocal ? (
                    <Ionicons name="shield-checkmark" size={14} color="#0F766E" />
                  ) : null}
                </View>
                <Text style={styles.householdMeta} numberOfLines={1}>
                  {LIFE_STAGE_LABELS[item.lifeStage]} · ~{item.distanceMiles.toFixed(1)} mi
                </Text>
                <Text style={styles.householdOrigins} numberOfLines={1}>
                  From {originsSummary} · {item.members.length} member
                  {item.members.length !== 1 ? "s" : ""}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topStrip: {
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  filterPillActive: {
    backgroundColor: "#0F766E",
    borderColor: "#0F766E",
  },
  ghostPillActive: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
  },
  ghostPillText: {
    color: "#92400E",
  },
  trayCard: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 22,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  trayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  trayTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  ghostHint: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  cardsRow: {
    gap: 10,
  },
  householdCard: {
    width: 196,
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  householdTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  householdMeta: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F766E",
  },
  householdOrigins: {
    fontSize: 11,
    color: "#475569",
  },
  emptyBox: {
    gap: 8,
    paddingVertical: 4,
  },
  emptyText: {
    fontSize: 13,
    color: "#475569",
  },
  emptyActions: {
    flexDirection: "row",
    gap: 8,
  },
  emptyPrimaryBtn: {
    backgroundColor: "#0F766E",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyPrimaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  emptySecondaryBtn: {
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptySecondaryText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F172A",
  },
});
