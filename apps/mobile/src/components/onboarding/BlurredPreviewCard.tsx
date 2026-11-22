import { Ionicons } from "@expo/vector-icons";
import type { BlurredPreviewResult, GujaratLocation } from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";

type BlurredPreviewCardProps = {
  preview: BlurredPreviewResult;
  selectedOrigin: GujaratLocation;
  neighborhoodLabel: string;
  onChangeOrigin: () => void;
  onEditNeighborhood: () => void;
  onUnlock: () => void;
};

export function BlurredPreviewCard({
  preview,
  selectedOrigin,
  neighborhoodLabel,
  onChangeOrigin,
  onEditNeighborhood,
  onUnlock,
}: BlurredPreviewCardProps) {
  const count = preview.households.length;
  const householdNoun = count === 1 ? "household" : "households";

  function handleUnlockPress() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onUnlock();
  }

  return (
    <View style={styles.card}>
      <View style={styles.badgesRow}>
        <View
          style={[
            styles.scopeBadge,
            preview.fallbackTriggered ? styles.fallbackBadge : styles.exactBadge,
          ]}
        >
          <Ionicons
            name={preview.fallbackTriggered ? "expand" : "sparkles"}
            size={12}
            color={preview.fallbackTriggered ? "#92400E" : "#0F766E"}
          />
          <Text
            style={[
              styles.scopeBadgeText,
              preview.fallbackTriggered ? styles.fallbackBadgeText : styles.exactBadgeText,
            ]}
          >
            {preview.fallbackTriggered
              ? `Dynamic Zoom · All Gujarat (${preview.activeRadiusMiles} mi)`
              : `${selectedOrigin.name} · ${preview.activeRadiusMiles} mi`}
          </Text>
        </View>
      </View>

      <Text style={styles.title}>
        {preview.fallbackTriggered
          ? count === 0
            ? `No Gujarati households within ${preview.activeRadiusMiles} miles yet`
            : `${count} Gujarati ${householdNoun} live within ${preview.activeRadiusMiles} miles of you`
          : `${count} ${householdNoun} from ${selectedOrigin.name} live within ${preview.activeRadiusMiles} miles of you`}
      </Text>

      <Text style={styles.body}>
        {preview.fallbackTriggered
          ? count === 0
            ? `You're pioneering this corner of ${neighborhoodLabel}! Unlock your profile so incoming neighbors from ${selectedOrigin.name} can find you.`
            : `${preview.exactMatchCount} from ${selectedOrigin.name} within 10 mi so far · showing all Gujarati neighbors within ${preview.activeRadiusMiles} mi (${preview.withinTwoMilesCount} within 2 mi of ${neighborhoodLabel}).`
          : `${preview.withinTwoMilesCount} within 2 miles of ${neighborhoodLabel}. Tap any blurred pin on the map or unlock below to connect.`}
      </Text>

      <View style={styles.chipsRow}>
        <Pressable style={styles.metaChip} onPress={onEditNeighborhood}>
          <Ionicons name="location" size={12} color="#334155" />
          <Text style={styles.metaChipText}>{neighborhoodLabel}</Text>
        </Pressable>
        <Pressable style={styles.metaChip} onPress={onChangeOrigin}>
          <Ionicons name="swap-horizontal" size={12} color="#334155" />
          <Text style={styles.metaChipText}>{selectedOrigin.name} · Change</Text>
        </Pressable>
      </View>

      <Pressable style={styles.primaryButton} onPress={handleUnlockPress}>
        <Ionicons name="lock-open" size={16} color="#FFFFFF" />
        <Text style={styles.primaryButtonText}>Unlock Neighbors</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    borderRadius: 22,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  scopeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  exactBadge: {
    backgroundColor: "#F0FDFA",
    borderColor: "#99F6E4",
  },
  fallbackBadge: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
  },
  scopeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  exactBadgeText: {
    color: "#0F766E",
  },
  fallbackBadgeText: {
    color: "#92400E",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 24,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: "#475569",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  primaryButton: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0F766E",
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
