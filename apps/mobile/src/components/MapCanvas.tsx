import { SAN_ANTONIO_DEFAULT_CENTER, SAN_ANTONIO_DEFAULT_ZOOM } from "@second-home/shared";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getMapboxPublicToken, hasNativeMapboxModule, loadMapboxModule } from "@/lib/mapbox";

const DEFAULT_STYLE_URL = "mapbox://styles/mapbox/streets-v12";

export type MapCanvasProps = {
  center?: { lat: number; lng: number };
  zoomLevel?: number;
};

export function MapCanvas({
  center = SAN_ANTONIO_DEFAULT_CENTER,
  zoomLevel = SAN_ANTONIO_DEFAULT_ZOOM,
}: MapCanvasProps) {
  const token = getMapboxPublicToken();
  const hasNative = hasNativeMapboxModule();
  const mapbox = useMemo(() => (token ? loadMapboxModule() : null), [token]);
  const [tokenReady, setTokenReady] = useState(false);

  const centerCoordinate = useMemo<[number, number]>(
    () => [center.lng, center.lat],
    [center.lat, center.lng],
  );
  const defaultSettings = useMemo(
    () => ({
      centerCoordinate,
      zoomLevel,
    }),
    [centerCoordinate, zoomLevel],
  );

  useEffect(() => {
    let cancelled = false;

    async function configureToken() {
      if (!mapbox || !token) {
        setTokenReady(false);
        return;
      }
      try {
        await mapbox.setAccessToken(token);
        if (!cancelled) {
          setTokenReady(true);
        }
      } catch {
        if (!cancelled) {
          setTokenReady(false);
        }
      }
    }

    void configureToken();
    return () => {
      cancelled = true;
    };
  }, [mapbox, token]);

  if (!mapbox || !token) {
    return (
      <View style={styles.fallbackContainer}>
        <View style={styles.fallbackGrid} />
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackEyebrow}>SAN ANTONIO CORRIDOR MAP</Text>
          <Text style={styles.fallbackTitle}>
            {hasNative ? "Mapbox Public Token Needed" : "Development Build Required for Mapbox"}
          </Text>
          <Text style={styles.fallbackBody}>
            {hasNative && !token
              ? "Set EXPO_PUBLIC_MAPBOX_TOKEN in apps/mobile/.env to render live Mapbox vector tiles."
              : "Native Mapbox bindings are unavailable in this runtime (e.g., Expo Go). Run a Development Build (expo-dev-client) for interactive map rendering."}
          </Text>
          <Text style={styles.fallbackCoords}>
            Focal Point: {center.lat.toFixed(4)}, {center.lng.toFixed(4)} (z{zoomLevel})
          </Text>
        </View>
      </View>
    );
  }

  if (!tokenReady) {
    return <View style={styles.fallbackContainer} />;
  }

  const { MapView, Camera } = mapbox;

  return (
    <MapView style={styles.map} styleURL={DEFAULT_STYLE_URL} projection="mercator">
      <Camera
        defaultSettings={defaultSettings}
        centerCoordinate={centerCoordinate}
        zoomLevel={zoomLevel}
        animationMode="easeTo"
        animationDuration={600}
      />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  fallbackContainer: {
    flex: 1,
    backgroundColor: "#EBF2F7",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  fallbackGrid: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#E4EEF5",
  },
  fallbackCard: {
    maxWidth: 340,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: "#D6E3EE",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  fallbackEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0F766E",
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  fallbackBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  fallbackCoords: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
});
