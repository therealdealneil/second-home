import { SAN_ANTONIO_DEFAULT_CENTER, SAN_ANTONIO_DEFAULT_ZOOM } from "@second-home/shared";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MapCanvasProps } from "./MapCanvas";

// Web stub: mobile registration and pin creation are native-only per AGENTS.md guardrail #3.
export function MapCanvas({
  cameraTarget = {
    center: SAN_ANTONIO_DEFAULT_CENTER,
    zoomLevel: SAN_ANTONIO_DEFAULT_ZOOM,
    key: 0,
  },
  syncCamera = null,
  privacyRing = null,
  blurredPins = [],
  onPressBlurredPin,
  discoveryPins = [],
  onPressDiscoveryPin,
}: MapCanvasProps) {
  const displayFocus = syncCamera ?? cameraTarget;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SECOND HOME MOBILE</Text>
        <Text style={styles.title}>San Antonio Map Preview</Text>
        <Text style={styles.body}>
          Interactive Mapbox discovery & pin verification run on iOS and Android builds.
        </Text>
        <Text style={styles.meta}>
          {displayFocus.center.lat.toFixed(4)}, {displayFocus.center.lng.toFixed(4)} · z
          {displayFocus.zoomLevel}
        </Text>

        {privacyRing ? (
          <Text style={styles.ringMeta}>
            Privacy ring: ~{privacyRing.radiusMiles.toFixed(1)} mi at{" "}
            {privacyRing.center.lat.toFixed(4)}, {privacyRing.center.lng.toFixed(4)}
          </Text>
        ) : null}

        {blurredPins.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pinsRow}
          >
            {blurredPins.slice(0, 6).map((pin) => (
              <Pressable
                key={pin.householdId}
                style={styles.pinChip}
                onPress={() => onPressBlurredPin?.(pin.householdId)}
              >
                <Text style={styles.pinChipText}>
                  Blurred pin · {pin.distanceMiles.toFixed(1)} mi
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {discoveryPins.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pinsRow}
          >
            {discoveryPins.slice(0, 6).map((pin) => (
              <Pressable
                key={pin.householdId}
                style={styles.pinChip}
                onPress={() => onPressDiscoveryPin?.(pin.householdId)}
              >
                <Text style={styles.pinChipText}>
                  {pin.displayLabel} · {pin.distanceMiles.toFixed(1)} mi
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EBF2F7",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: "#D6E3EE",
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
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  meta: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  ringMeta: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F766E",
  },
  pinsRow: {
    gap: 8,
    paddingTop: 4,
  },
  pinChip: {
    backgroundColor: "#F0FDFA",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  pinChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#115E59",
  },
});
