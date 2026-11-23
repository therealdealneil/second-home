import { Ionicons } from "@expo/vector-icons";
import type { ConfirmedNeighborhood, LatLng } from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { LocationCaptureStatus } from "@/hooks/useSanAntonioLocation";

const DEV_PRESETS: readonly { label: string; point: LatLng }[] = [
  { label: "Med Center", point: { lat: 29.5124, lng: -98.5742 } },
  { label: "Stone Oak", point: { lat: 29.6472, lng: -98.4864 } },
  { label: "NW SA", point: { lat: 29.5562, lng: -98.6684 } },
  { label: "Austin (Waitlist)", point: { lat: 30.2672, lng: -97.7431 } },
];

type NeighborhoodConfirmCardProps = {
  status: LocationCaptureStatus;
  candidate: ConfirmedNeighborhood | null;
  offsetMiles: number | null;
  errorMessage: string | null;
  onCaptureGps: () => void;
  onConfirm: (neighborhood: ConfirmedNeighborhood) => void;
  onRecenter: () => void;
  onOpenWaitlist: () => void;
  onSimulateGps: (point: LatLng) => void;
};

export function NeighborhoodConfirmCard({
  status,
  candidate,
  offsetMiles,
  errorMessage,
  onCaptureGps,
  onConfirm,
  onRecenter,
  onOpenWaitlist,
  onSimulateGps,
}: NeighborhoodConfirmCardProps) {
  const isSnapped = status === "snapped" && candidate !== null;
  const isLocating = status === "locating";

  function handleConfirmPress() {
    if (!candidate) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm(candidate);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>STEP 1 OF 2 · SAN ANTONIO PRESENCE</Text>

      {isSnapped ? (
        <>
          <Text style={styles.title}>Near {candidate.label}</Text>
          <View style={styles.privacyBanner}>
            <Ionicons name="shield-checkmark" size={16} color="#0F766E" />
            <Text style={styles.privacyBannerText}>
              ~1 mi privacy ring{offsetMiles ? ` (${offsetMiles.toFixed(2)} mi static offset)` : ""}
              {" · "}Exact address hidden
            </Text>
          </View>
          <Text style={styles.body}>
            Drag the map slightly if you want to fine-tune within your local area, then confirm your
            neighborhood.
          </Text>

          <View style={styles.actionsRow}>
            <Pressable style={styles.primaryButton} onPress={handleConfirmPress}>
              <Text style={styles.primaryButtonText}>Confirm Neighborhood</Text>
            </Pressable>
            <Pressable
              style={styles.iconButton}
              onPress={onRecenter}
              accessibilityLabel="Re-center"
            >
              <Ionicons name="locate" size={18} color="#0F172A" />
            </Pressable>
            <Pressable
              style={styles.iconButton}
              onPress={onCaptureGps}
              accessibilityLabel="Refresh GPS"
            >
              <Ionicons name="refresh" size={18} color="#0F172A" />
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.title}>Confirm your neighborhood in San Antonio</Text>
          <Text style={styles.body}>
            We check your hardware GPS once and snap your pin inside a 0.5–1.5 mi privacy ring. Your
            exact home coordinates are never shared.
          </Text>

          {errorMessage ? (
            <View style={styles.errorBanner}>
              <Ionicons name="warning" size={16} color="#B45309" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.primaryButton, isLocating && styles.buttonDisabled]}
              onPress={onCaptureGps}
              disabled={isLocating}
            >
              {isLocating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="navigate" size={16} color="#FFFFFF" />
              )}
              <Text style={styles.primaryButtonText}>
                {isLocating ? "Locating..." : "Confirm My Location"}
              </Text>
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={onOpenWaitlist}>
              <Text style={styles.secondaryButtonText}>Outside SA?</Text>
            </Pressable>
          </View>
        </>
      )}

      {__DEV__ ? (
        <View style={styles.devRow}>
          <Text style={styles.devLabel}>DEV GPS:</Text>
          {DEV_PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              style={styles.devChip}
              onPress={() => onSimulateGps(preset.point)}
            >
              <Text style={styles.devChipText}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
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
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0F766E",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: "#475569",
  },
  privacyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0FDFA",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  privacyBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#115E59",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: "#92400E",
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0F766E",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 14,
  },
  buttonDisabled: {
    opacity: 0.75,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "600",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  devRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  devLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  devChip: {
    backgroundColor: "#F8FAFC",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  devChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
  },
});
