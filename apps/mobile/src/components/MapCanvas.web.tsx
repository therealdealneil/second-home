import { SAN_ANTONIO_DEFAULT_CENTER, SAN_ANTONIO_DEFAULT_ZOOM } from "@second-home/shared";
import { StyleSheet, Text, View } from "react-native";
import type { MapCanvasProps } from "./MapCanvas";

// Web stub: mobile registration and pin creation are native-only per AGENTS.md guardrail #3.
export function MapCanvas({
  center = SAN_ANTONIO_DEFAULT_CENTER,
  zoomLevel = SAN_ANTONIO_DEFAULT_ZOOM,
}: MapCanvasProps) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SECOND HOME MOBILE</Text>
        <Text style={styles.title}>San Antonio Map Preview</Text>
        <Text style={styles.body}>
          Interactive Mapbox discovery & pin verification run on iOS and Android builds.
        </Text>
        <Text style={styles.meta}>
          {center.lat.toFixed(4)}, {center.lng.toFixed(4)} · z{zoomLevel}
        </Text>
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
});
