import { Ionicons } from "@expo/vector-icons";
import {
  SAN_ANTONIO_DEFAULT_CENTER,
  SAN_ANTONIO_DEFAULT_ZOOM,
  createCirclePolygonGeoJSON,
  haversineDistanceMeters,
  type GujaratProjectedPin,
  type LatLng,
  type MapRegion,
  type MatchedHouseholdPin,
} from "@second-home/shared";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  getMapboxPublicToken,
  hasNativeMapboxModule,
  loadMapboxModule,
  type MapboxModule,
} from "@/lib/mapbox";

type CameraRef = ComponentRef<MapboxModule["Camera"]>;
type MapIdleState = Parameters<
  NonNullable<ComponentProps<MapboxModule["MapView"]>["onMapIdle"]>
>[0];

const DEFAULT_STYLE_URL = "mapbox://styles/mapbox/streets-v12";
const PIN_PALETTE = ["#0F766E", "#0369A1", "#B45309", "#7C3AED", "#BE123C"] as const;

export type MapCameraTarget = {
  center: LatLng;
  zoomLevel: number;
  key: number;
  animationMode?: "easeTo" | "flyTo";
  animationDuration?: number;
};

export type MapSyncCamera = {
  center: LatLng;
  zoomLevel: number;
  key: string;
  region?: MapRegion;
  animationMode?: "easeTo" | "flyTo";
  animationDuration?: number;
};

export type MapCanvasProps = {
  mapRegion?: MapRegion;
  cameraTarget?: MapCameraTarget;
  syncCamera?: MapSyncCamera | null;
  privacyRing?: { center: LatLng; radiusMiles: number } | null;
  originAnchor?: { center: LatLng; label: string } | null;
  blurredPins?: readonly MatchedHouseholdPin[];
  onPressBlurredPin?: (householdId: string) => void;
  discoveryPins?: readonly MatchedHouseholdPin[];
  gujaratPins?: readonly GujaratProjectedPin[];
  selectedHouseholdId?: string | null;
  onPressDiscoveryPin?: (householdId: string) => void;
  interactiveDragAdjust?: boolean;
  onMapIdleCenterChange?: (center: LatLng) => void;
};

const DEFAULT_CAMERA_TARGET: MapCameraTarget = {
  center: SAN_ANTONIO_DEFAULT_CENTER,
  zoomLevel: SAN_ANTONIO_DEFAULT_ZOOM,
  key: 0,
};

function getMemberInitial(firstName: string): string {
  return firstName.trim().slice(0, 1).toUpperCase() || "?";
}

function getShortHouseholdLabel(displayLabel: string): string {
  const firstWord = displayLabel.trim().split(/\s+/)[0];
  return firstWord && firstWord.length > 0 ? firstWord : displayLabel;
}

export function MapCanvas({
  mapRegion = "san_antonio",
  cameraTarget = DEFAULT_CAMERA_TARGET,
  syncCamera = null,
  privacyRing = null,
  originAnchor = null,
  blurredPins = [],
  onPressBlurredPin,
  discoveryPins = [],
  gujaratPins = [],
  selectedHouseholdId = null,
  onPressDiscoveryPin,
  interactiveDragAdjust = false,
  onMapIdleCenterChange,
}: MapCanvasProps) {
  const token = getMapboxPublicToken();
  const hasNative = hasNativeMapboxModule();
  const mapbox = useMemo(() => (token ? loadMapboxModule() : null), [token]);
  const [tokenReady, setTokenReady] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(false);

  const cameraRef = useRef<CameraRef | null>(null);
  const prevTargetKeyRef = useRef(0);
  const prevSyncKeyRef = useRef<string | null>(null);
  const prevSyncRegionRef = useRef<MapRegion | undefined>(syncCamera?.region);
  const lastProgrammaticCameraMsRef = useRef(0);
  const lastProgrammaticDurationRef = useRef(550);
  const userInteractedSinceProgrammaticRef = useRef(false);
  const lastIdleZoomRef = useRef<number | null>(null);

  const privacyRingRef = useRef(privacyRing);
  const interactiveDragAdjustRef = useRef(interactiveDragAdjust);
  const onMapIdleCenterChangeRef = useRef(onMapIdleCenterChange);

  useEffect(() => {
    privacyRingRef.current = privacyRing;
    interactiveDragAdjustRef.current = interactiveDragAdjust;
    onMapIdleCenterChangeRef.current = onMapIdleCenterChange;
  }, [interactiveDragAdjust, onMapIdleCenterChange, privacyRing]);

  const [initialCameraSettings] = useState(() => ({
    centerCoordinate: [cameraTarget.center.lng, cameraTarget.center.lat] as [number, number],
    zoomLevel: cameraTarget.zoomLevel,
  }));

  const setCameraNode = useCallback((node: CameraRef | null) => {
    cameraRef.current = node;
    setCameraMounted(node !== null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function configureToken() {
      if (!mapbox || !token) {
        setTokenReady(false);
        return;
      }
      try {
        await Promise.resolve(mapbox.setAccessToken(token));
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

  useEffect(() => {
    if (!tokenReady || !cameraMounted || !cameraRef.current) {
      return;
    }

    const targetChanged = cameraTarget.key > 0 && cameraTarget.key !== prevTargetKeyRef.current;
    const syncChanged = Boolean(syncCamera && syncCamera.key !== prevSyncKeyRef.current);
    const regionFlipped = Boolean(
      syncCamera?.region &&
      prevSyncRegionRef.current &&
      syncCamera.region !== prevSyncRegionRef.current,
    );

    prevTargetKeyRef.current = cameraTarget.key;
    prevSyncKeyRef.current = syncCamera?.key ?? null;
    prevSyncRegionRef.current = syncCamera?.region;

    const chosen = targetChanged ? cameraTarget : syncChanged ? syncCamera : null;
    if (!chosen) {
      return;
    }

    const shouldFlyForRegionFlip = !targetChanged && syncChanged && regionFlipped;
    const duration = chosen.animationDuration ?? (shouldFlyForRegionFlip ? 1150 : 550);
    const animationMode = chosen.animationMode ?? (shouldFlyForRegionFlip ? "flyTo" : "easeTo");

    lastProgrammaticCameraMsRef.current = Date.now();
    lastProgrammaticDurationRef.current = duration;
    userInteractedSinceProgrammaticRef.current = false;
    lastIdleZoomRef.current = chosen.zoomLevel;
    cameraRef.current.setCamera({
      centerCoordinate: [chosen.center.lng, chosen.center.lat],
      zoomLevel: chosen.zoomLevel,
      animationDuration: duration,
      animationMode,
    });
  }, [cameraMounted, cameraTarget, syncCamera, tokenReady]);

  const ringShape = useMemo(() => {
    if (!privacyRing) {
      return null;
    }
    return createCirclePolygonGeoJSON(privacyRing.center, privacyRing.radiusMiles);
  }, [privacyRing]);

  const originAnchorCoord = useMemo<[number, number] | null>(
    () => (originAnchor ? [originAnchor.center.lng, originAnchor.center.lat] : null),
    [originAnchor],
  );

  const ringCenterCoord = useMemo<[number, number] | null>(
    () => (privacyRing ? [privacyRing.center.lng, privacyRing.center.lat] : null),
    [privacyRing],
  );

  const handleCameraChanged = useCallback((mapState: MapIdleState) => {
    if (mapState.gestures?.isGestureActive) {
      userInteractedSinceProgrammaticRef.current = true;
    }
  }, []);

  const handleMapIdle = useCallback((mapState: MapIdleState) => {
    const zoom = mapState.properties.zoom;
    const prevZoom = lastIdleZoomRef.current;
    if (typeof zoom === "number") {
      lastIdleZoomRef.current = zoom;
    }

    const hasUserGesture =
      mapState.gestures?.isGestureActive || userInteractedSinceProgrammaticRef.current;
    userInteractedSinceProgrammaticRef.current = false;

    if (!interactiveDragAdjustRef.current || !onMapIdleCenterChangeRef.current) {
      return;
    }
    if (
      Date.now() - lastProgrammaticCameraMsRef.current <
        lastProgrammaticDurationRef.current + 300 &&
      !hasUserGesture
    ) {
      return;
    }
    // Ignore pure pinch/double-tap zoom adjustments so zooming doesn't relocate the ring.
    if (typeof zoom === "number" && prevZoom !== null && Math.abs(zoom - prevZoom) > 0.15) {
      return;
    }

    const centerPos = mapState.properties.center;
    const lng = centerPos[0];
    const lat = centerPos[1];
    if (typeof lng !== "number" || typeof lat !== "number") {
      return;
    }
    const nextCenter = { lat, lng };
    const activeRing = privacyRingRef.current;
    if (activeRing && haversineDistanceMeters(activeRing.center, nextCenter) < 25) {
      return;
    }
    onMapIdleCenterChangeRef.current(nextCenter);
  }, []);

  const handleBlurredPinPress = useCallback(
    (householdId: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPressBlurredPin?.(householdId);
    },
    [onPressBlurredPin],
  );

  const handleDiscoveryPinPress = useCallback(
    (householdId: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPressDiscoveryPin?.(householdId);
    },
    [onPressDiscoveryPin],
  );

  const displayFocus = syncCamera ?? cameraTarget;

  if (!mapbox || !token) {
    return (
      <View style={styles.fallbackContainer}>
        <View style={styles.fallbackGrid} />
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackEyebrow}>
            {mapRegion === "gujarat" ? "GUJARAT HOMETOWN MAP" : "SAN ANTONIO CORRIDOR MAP"}
          </Text>
          <Text style={styles.fallbackTitle}>
            {hasNative ? "Mapbox Public Token Needed" : "Development Build Required for Mapbox"}
          </Text>
          <Text style={styles.fallbackBody}>
            {hasNative && !token
              ? "Set EXPO_PUBLIC_MAPBOX_TOKEN in apps/mobile/.env to render live Mapbox vector tiles."
              : "Native Mapbox bindings are unavailable in this runtime (e.g., Expo Go). Run a Development Build (expo-dev-client) for interactive map rendering."}
          </Text>
          <Text style={styles.fallbackCoords}>
            Focal Point: {displayFocus.center.lat.toFixed(4)}, {displayFocus.center.lng.toFixed(4)}{" "}
            (z{displayFocus.zoomLevel})
          </Text>

          {privacyRing ? (
            <View style={styles.fallbackRingBadge}>
              <Ionicons name="shield-checkmark" size={14} color="#0F766E" />
              <Text style={styles.fallbackRingText}>
                ~{privacyRing.radiusMiles.toFixed(1)} mi privacy ring active (
                {privacyRing.center.lat.toFixed(4)}, {privacyRing.center.lng.toFixed(4)})
              </Text>
            </View>
          ) : null}

          {blurredPins.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.fallbackPinsRow}
            >
              {blurredPins.slice(0, 8).map((pin, index) => (
                <Pressable
                  key={pin.householdId}
                  style={styles.fallbackPinPill}
                  onPress={() => handleBlurredPinPress(pin.householdId)}
                >
                  <View
                    style={[
                      styles.fallbackPinDot,
                      { backgroundColor: PIN_PALETTE[index % PIN_PALETTE.length] },
                    ]}
                  />
                  <Text style={styles.fallbackPinText}>
                    {pin.distanceMiles.toFixed(1)} mi · {pin.members.length} member
                    {pin.members.length !== 1 ? "s" : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {mapRegion === "gujarat" && gujaratPins.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.fallbackPinsRow}
            >
              {gujaratPins.slice(0, 8).map((pin, index) => (
                <Pressable
                  key={pin.pinId}
                  style={styles.fallbackPinPill}
                  onPress={() => handleDiscoveryPinPress(pin.householdId)}
                >
                  <View
                    style={[
                      styles.fallbackDiscoveryDot,
                      { backgroundColor: PIN_PALETTE[index % PIN_PALETTE.length] },
                    ]}
                  />
                  <Text style={styles.fallbackPinText}>
                    {pin.displayLabel} · {pin.hometownDistrict}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {mapRegion === "san_antonio" && discoveryPins.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.fallbackPinsRow}
            >
              {discoveryPins.slice(0, 8).map((pin, index) => (
                <Pressable
                  key={pin.householdId}
                  style={styles.fallbackPinPill}
                  onPress={() => handleDiscoveryPinPress(pin.householdId)}
                >
                  <View
                    style={[
                      styles.fallbackDiscoveryDot,
                      { backgroundColor: PIN_PALETTE[index % PIN_PALETTE.length] },
                    ]}
                  />
                  <Text style={styles.fallbackPinText}>
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

  if (!tokenReady) {
    return <View style={styles.fallbackContainer} />;
  }

  const { MapView, Camera, ShapeSource, FillLayer, LineLayer, MarkerView } = mapbox;

  return (
    <MapView
      style={styles.map}
      styleURL={DEFAULT_STYLE_URL}
      projection="mercator"
      onCameraChanged={handleCameraChanged}
      onMapIdle={handleMapIdle}
    >
      <Camera ref={setCameraNode} defaultSettings={initialCameraSettings} />

      {ringShape ? (
        <ShapeSource id="privacy-ring-source" shape={ringShape}>
          <FillLayer
            id="privacy-ring-fill"
            style={{
              fillColor: "#0F766E",
              fillOpacity: 0.14,
            }}
          />
          <LineLayer
            id="privacy-ring-outline"
            style={{
              lineColor: "#0F766E",
              lineWidth: 2.5,
              lineOpacity: 0.85,
            }}
          />
        </ShapeSource>
      ) : null}

      {ringCenterCoord ? (
        <MarkerView coordinate={ringCenterCoord} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
          <View style={styles.homeRingMarker}>
            <View style={styles.homeRingInner}>
              <Ionicons name="home" size={14} color="#FFFFFF" />
            </View>
          </View>
        </MarkerView>
      ) : null}

      {originAnchorCoord && originAnchor ? (
        <MarkerView coordinate={originAnchorCoord} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
          <View
            accessibilityLabel={`Your Gujarat hometown: ${originAnchor.label}`}
            style={styles.originAnchorMarker}
          >
            <View style={styles.originAnchorInner}>
              <Ionicons name="location" size={14} color="#FFFFFF" />
            </View>
          </View>
        </MarkerView>
      ) : null}

      {blurredPins.map((pin, index) => {
        const tintColor = PIN_PALETTE[index % PIN_PALETTE.length];
        return (
          <MarkerView
            key={pin.householdId}
            coordinate={[pin.publicLng, pin.publicLat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <Pressable
              accessibilityLabel="Blurred nearby household pin"
              accessibilityRole="button"
              style={styles.blurredPinWrapper}
              onPress={() => handleBlurredPinPress(pin.householdId)}
            >
              <View style={[styles.blurredAvatarBackdrop, { backgroundColor: tintColor }]}>
                {/* Pre-auth pins only render generic icons; Android defaults BlurView to translucent veil */}
                <Ionicons name="people" size={16} color="rgba(255,255,255,0.65)" />
                <BlurView intensity={36} tint="light" style={styles.blurredAvatarVeil} />
              </View>
              {pin.members.length > 1 ? (
                <View style={styles.stackedCountBadge}>
                  <Text style={styles.stackedCountText}>{pin.members.length}</Text>
                </View>
              ) : null}
              <View style={styles.pinLockDot}>
                <Ionicons name="lock-closed" size={9} color="#0F172A" />
              </View>
            </Pressable>
          </MarkerView>
        );
      })}

      {discoveryPins.map((pin, index) => {
        const visibleAvatars = pin.members.slice(0, 2);
        const extraCount = pin.members.length - visibleAvatars.length;
        const isSelected = selectedHouseholdId === pin.householdId;

        return (
          <MarkerView
            key={pin.householdId}
            coordinate={[pin.publicLng, pin.publicLat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <Pressable
              accessibilityLabel={`${pin.displayLabel}, ${pin.members.length} linked member${pin.members.length === 1 ? "" : "s"}`}
              accessibilityRole="button"
              style={styles.discoveryPinContainer}
              onPress={() => handleDiscoveryPinPress(pin.householdId)}
            >
              <View style={styles.stackedAvatarsRow}>
                {visibleAvatars.map((member, memberIndex) => {
                  const avatarColor = PIN_PALETTE[(index + memberIndex) % PIN_PALETTE.length];
                  return (
                    <View
                      key={member.userId}
                      style={[
                        styles.discoveryAvatar,
                        { backgroundColor: avatarColor },
                        memberIndex > 0 && styles.discoveryAvatarOverlap,
                        isSelected && styles.discoveryAvatarSelected,
                      ]}
                    >
                      <Text style={styles.discoveryAvatarText}>
                        {getMemberInitial(member.firstName)}
                      </Text>
                    </View>
                  );
                })}
                {extraCount > 0 ? (
                  <View style={styles.discoveryExtraBadge}>
                    <Text style={styles.discoveryExtraText}>+{extraCount}</Text>
                  </View>
                ) : null}
                {pin.isVerifiedLocal ? (
                  <View style={styles.verifiedPinDot}>
                    <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <View style={[styles.pinLabelPill, isSelected && styles.pinLabelPillSelected]}>
                <Text style={[styles.pinLabelText, isSelected && styles.pinLabelTextSelected]}>
                  {getShortHouseholdLabel(pin.displayLabel)}
                </Text>
              </View>
            </Pressable>
          </MarkerView>
        );
      })}

      {gujaratPins.map((pin, index) => {
        const visibleAvatars = pin.members.slice(0, 2);
        const extraCount = pin.members.length - visibleAvatars.length;
        const isSelected = selectedHouseholdId === pin.householdId;

        return (
          <MarkerView
            key={pin.pinId}
            coordinate={[pin.lng, pin.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <Pressable
              accessibilityLabel={`${pin.displayLabel} in ${pin.hometownName}`}
              accessibilityRole="button"
              style={styles.discoveryPinContainer}
              onPress={() => handleDiscoveryPinPress(pin.householdId)}
            >
              <View style={styles.stackedAvatarsRow}>
                {visibleAvatars.map((member, memberIndex) => {
                  const avatarColor = PIN_PALETTE[(index + memberIndex) % PIN_PALETTE.length];
                  return (
                    <View
                      key={member.userId}
                      style={[
                        styles.discoveryAvatar,
                        { backgroundColor: avatarColor },
                        memberIndex > 0 && styles.discoveryAvatarOverlap,
                        isSelected && styles.discoveryAvatarSelected,
                      ]}
                    >
                      <Text style={styles.discoveryAvatarText}>
                        {getMemberInitial(member.firstName)}
                      </Text>
                    </View>
                  );
                })}
                {extraCount > 0 ? (
                  <View style={styles.discoveryExtraBadge}>
                    <Text style={styles.discoveryExtraText}>+{extraCount}</Text>
                  </View>
                ) : null}
                {pin.isMultiOriginHousehold ? (
                  <View style={styles.multiOriginPinDot}>
                    <Ionicons name="git-branch" size={8} color="#FFFFFF" />
                  </View>
                ) : pin.isVerifiedLocal ? (
                  <View style={styles.verifiedPinDot}>
                    <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <View
                style={[
                  styles.pinLabelPill,
                  styles.gujaratPinLabelPill,
                  isSelected && styles.pinLabelPillSelected,
                ]}
              >
                <Text style={[styles.pinLabelText, isSelected && styles.pinLabelTextSelected]}>
                  {getShortHouseholdLabel(pin.displayLabel)}
                </Text>
              </View>
            </Pressable>
          </MarkerView>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  homeRingMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(15, 118, 110, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  homeRingInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#0F766E",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  originAnchorMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(180, 83, 9, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  originAnchorInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#B45309",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  blurredPinWrapper: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  blurredAvatarBackdrop: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  blurredAvatarVeil: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255, 255, 255, 0.42)",
  },
  stackedCountBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: "#0F172A",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  stackedCountText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  pinLockDot: {
    position: "absolute",
    bottom: 0,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  discoveryPinContainer: {
    alignItems: "center",
    gap: 2,
  },
  stackedAvatarsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  discoveryAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  discoveryAvatarOverlap: {
    marginLeft: -10,
  },
  discoveryAvatarSelected: {
    borderColor: "#0F172A",
  },
  discoveryAvatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  discoveryExtraBadge: {
    marginLeft: -8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#0F172A",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  discoveryExtraText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  verifiedPinDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#0F766E",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  multiOriginPinDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#B45309",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pinLabelPill: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  gujaratPinLabelPill: {
    borderColor: "#FDE68A",
  },
  pinLabelPillSelected: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  pinLabelText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0F172A",
  },
  pinLabelTextSelected: {
    color: "#FFFFFF",
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
  fallbackRingBadge: {
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
  fallbackRingText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#115E59",
  },
  fallbackPinsRow: {
    gap: 8,
    paddingTop: 6,
  },
  fallbackPinPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F8FAFC",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  fallbackPinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.5,
  },
  fallbackDiscoveryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fallbackPinText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
  },
});
