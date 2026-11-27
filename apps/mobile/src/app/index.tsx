import {
  DEFAULT_DISCOVERY_FILTERS,
  GUJARAT_ALL_ZOOM,
  GUJARAT_DEFAULT_CENTER,
  GUJARAT_DISTRICT_ZOOM,
  GUJARAT_TOWN_ZOOM,
  PRIVACY_RING_DISPLAY_RADIUS_MILES,
  SAN_ANTONIO_DEFAULT_CENTER,
  SAN_ANTONIO_DEFAULT_ZOOM,
  evaluateBlurredPreviewMatches,
  evaluateDiscoveryMatches,
  parseOriginDeepLinkParam,
  projectGujaratDiscoveryPins,
  type ConfirmedNeighborhood,
  type DiscoveryRadiusMiles,
  type GujaratLocation,
} from "@second-home/shared";
import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapCanvas, type MapCameraTarget, type MapSyncCamera } from "@/components/MapCanvas";
import {
  DiscoveryBottomTray,
  DiscoveryTopControls,
  MapFlipButton,
} from "@/components/discovery/DiscoveryHud";
import { BlurredPreviewCard } from "@/components/onboarding/BlurredPreviewCard";
import { GujaratAutocompleteCard } from "@/components/onboarding/GujaratAutocompleteCard";
import { NeighborhoodConfirmCard } from "@/components/onboarding/NeighborhoodConfirmCard";
import { PersonalizeCard } from "@/components/onboarding/PersonalizeCard";
import { MOCK_SAN_ANTONIO_HOUSEHOLDS } from "@/data/mockHouseholds";
import { useSanAntonioLocation } from "@/hooks/useSanAntonioLocation";
import { useAppFlow } from "@/state/AppFlowContext";

const DISCOVERY_ZOOM_BY_RADIUS: Record<DiscoveryRadiusMiles, number> = {
  2: 12.6,
  5: 11.7,
  10: 11.0,
  25: 9.8,
};

export default function MapHomeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ origin_id?: string | string[] }>();
  const {
    state,
    isHydrated,
    dispatch,
    confirmNeighborhood,
    openAuthForIntent,
    completePersonalization,
    updateFilters,
    toggleMapRegion,
    toggleGhostMode,
    resetPrototypeFlow,
  } = useAppFlow();

  const lastOriginParamRef = useRef<string | null>(null);
  const [cameraTarget, setCameraTarget] = useState<MapCameraTarget>({
    center: SAN_ANTONIO_DEFAULT_CENTER,
    zoomLevel: SAN_ANTONIO_DEFAULT_ZOOM,
    key: 0,
  });

  const moveCamera = useCallback((center: { lat: number; lng: number }, zoomLevel: number) => {
    setCameraTarget((prev) => ({
      center,
      zoomLevel,
      key: prev.key + 1,
    }));
  }, []);

  const handleSnappedLocation = useCallback(
    (neighborhood: ConfirmedNeighborhood) => {
      moveCamera(neighborhood.fuzzedCenter, 13.2);
    },
    [moveCamera],
  );

  const handleOutsideSanAntonio = useCallback(() => {
    router.push("/waitlist");
  }, [router]);

  const location = useSanAntonioLocation({
    existingNeighborhood: state.confirmedNeighborhood,
    onSnapped: handleSnappedLocation,
    onOutsideSanAntonio: handleOutsideSanAntonio,
  });

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const rawOrigin = Array.isArray(params.origin_id) ? params.origin_id[0] : params.origin_id;
    if (!rawOrigin) {
      lastOriginParamRef.current = null;
      return;
    }
    if (rawOrigin === lastOriginParamRef.current) {
      return;
    }
    const resolved = parseOriginDeepLinkParam(rawOrigin);
    lastOriginParamRef.current = resolved ? rawOrigin : null;
    if (resolved) {
      dispatch({ type: "APPLY_ORIGIN_DEEP_LINK", origin: resolved });
    }
  }, [dispatch, isHydrated, params.origin_id]);

  useFocusEffect(
    useCallback(() => {
      if (state.phase === "discovery" && state.pendingIntent?.type === "open_household") {
        const targetId = state.pendingIntent.householdId;
        dispatch({ type: "CLEAR_PENDING_INTENT" });
        router.push({ pathname: "/household/[id]", params: { id: targetId } });
      }
    }, [dispatch, router, state.pendingIntent, state.phase]),
  );

  const blurredPreview = useMemo(() => {
    if (!state.confirmedNeighborhood || !state.selectedOrigin) {
      return null;
    }
    return evaluateBlurredPreviewMatches({
      households: MOCK_SAN_ANTONIO_HOUSEHOLDS,
      neighborhoodCenter: state.confirmedNeighborhood.fuzzedCenter,
      selectedOrigin: state.selectedOrigin,
    });
  }, [state.confirmedNeighborhood, state.selectedOrigin]);

  const discoveryMatches = useMemo(() => {
    if (state.phase !== "discovery" || !state.confirmedNeighborhood) {
      return [];
    }
    return evaluateDiscoveryMatches({
      households: MOCK_SAN_ANTONIO_HOUSEHOLDS,
      neighborhoodCenter: state.confirmedNeighborhood.fuzzedCenter,
      selectedOrigin: state.selectedOrigin,
      filters: state.filters,
      blockedHouseholdIds: new Set(state.blockedHouseholdIds),
    });
  }, [
    state.blockedHouseholdIds,
    state.confirmedNeighborhood,
    state.filters,
    state.phase,
    state.selectedOrigin,
  ]);

  const isGujaratView = state.phase === "discovery" && state.mapRegion === "gujarat";

  const gujaratPins = useMemo(
    () => (isGujaratView ? projectGujaratDiscoveryPins(discoveryMatches) : []),
    [discoveryMatches, isGujaratView],
  );

  const syncCamera = useMemo<MapSyncCamera | null>(() => {
    if (!isHydrated || !state.confirmedNeighborhood) {
      return null;
    }
    if (state.phase === "select_hometown") {
      return {
        center: state.confirmedNeighborhood.fuzzedCenter,
        zoomLevel: 12.6,
        key: `select_hometown:${state.confirmedNeighborhood.fuzzedCenter.lat}:${state.confirmedNeighborhood.fuzzedCenter.lng}`,
      };
    }
    if (state.phase === "discovery") {
      if (state.mapRegion === "gujarat") {
        if (state.filters.originMode === "exact_town" && state.selectedOrigin) {
          const originZoom =
            state.selectedOrigin.type === "district" ? GUJARAT_DISTRICT_ZOOM : GUJARAT_TOWN_ZOOM;
          return {
            center: { lat: state.selectedOrigin.lat, lng: state.selectedOrigin.lng },
            zoomLevel: originZoom,
            key: `discovery:gujarat:${state.selectedOrigin.id}:${originZoom}`,
            region: "gujarat",
          };
        }
        return {
          center: GUJARAT_DEFAULT_CENTER,
          zoomLevel: GUJARAT_ALL_ZOOM,
          key: `discovery:gujarat:all:${GUJARAT_ALL_ZOOM}`,
          region: "gujarat",
        };
      }

      const discoveryZoom = DISCOVERY_ZOOM_BY_RADIUS[state.filters.radiusMiles];
      return {
        center: state.confirmedNeighborhood.fuzzedCenter,
        zoomLevel: discoveryZoom,
        key: `discovery:sa:${state.filters.radiusMiles}:${state.confirmedNeighborhood.fuzzedCenter.lat}:${state.confirmedNeighborhood.fuzzedCenter.lng}`,
        region: "san_antonio",
      };
    }
    if (state.phase === "blurred_preview" || state.phase === "personalize") {
      const zoom = blurredPreview?.recommendedZoom ?? 11.1;
      return {
        center: state.confirmedNeighborhood.fuzzedCenter,
        zoomLevel: zoom,
        key: `${state.phase}:${state.selectedOrigin?.id ?? "none"}:${zoom}`,
      };
    }
    return {
      center: state.confirmedNeighborhood.fuzzedCenter,
      zoomLevel: 13.2,
      key: `confirm_neighborhood:${state.confirmedNeighborhood.fuzzedCenter.lat}:${state.confirmedNeighborhood.fuzzedCenter.lng}`,
    };
  }, [
    blurredPreview?.recommendedZoom,
    isHydrated,
    state.confirmedNeighborhood,
    state.filters.originMode,
    state.filters.radiusMiles,
    state.mapRegion,
    state.phase,
    state.selectedOrigin,
  ]);

  const handleConfirmNeighborhood = useCallback(
    (neighborhood: ConfirmedNeighborhood) => {
      confirmNeighborhood(neighborhood);
      if (state.selectedOrigin) {
        const nextPreview = evaluateBlurredPreviewMatches({
          households: MOCK_SAN_ANTONIO_HOUSEHOLDS,
          neighborhoodCenter: neighborhood.fuzzedCenter,
          selectedOrigin: state.selectedOrigin,
        });
        moveCamera(neighborhood.fuzzedCenter, nextPreview.recommendedZoom);
      } else {
        moveCamera(neighborhood.fuzzedCenter, 12.6);
      }
    },
    [confirmNeighborhood, moveCamera, state.selectedOrigin],
  );

  const handleSelectOrigin = useCallback(
    (origin: GujaratLocation) => {
      dispatch({ type: "SELECT_ORIGIN", origin });
      if (state.confirmedNeighborhood) {
        const nextPreview = evaluateBlurredPreviewMatches({
          households: MOCK_SAN_ANTONIO_HOUSEHOLDS,
          neighborhoodCenter: state.confirmedNeighborhood.fuzzedCenter,
          selectedOrigin: origin,
        });
        moveCamera(state.confirmedNeighborhood.fuzzedCenter, nextPreview.recommendedZoom);
      }
    },
    [dispatch, moveCamera, state.confirmedNeighborhood],
  );

  const handleEditNeighborhood = useCallback(() => {
    dispatch({ type: "EDIT_NEIGHBORHOOD" });
    const focusCenter =
      location.candidate?.fuzzedCenter ??
      state.confirmedNeighborhood?.fuzzedCenter ??
      SAN_ANTONIO_DEFAULT_CENTER;
    moveCamera(focusCenter, 13.2);
  }, [dispatch, location.candidate, moveCamera, state.confirmedNeighborhood]);

  const handleEditOrigin = useCallback(() => {
    dispatch({ type: "EDIT_ORIGIN" });
    if (state.confirmedNeighborhood) {
      moveCamera(state.confirmedNeighborhood.fuzzedCenter, 12.6);
    }
  }, [dispatch, moveCamera, state.confirmedNeighborhood]);

  const handleReset = useCallback(() => {
    lastOriginParamRef.current = null;
    location.resetLocationCapture();
    resetPrototypeFlow();
    moveCamera(SAN_ANTONIO_DEFAULT_CENTER, SAN_ANTONIO_DEFAULT_ZOOM);
  }, [location, moveCamera, resetPrototypeFlow]);

  const privacyRing = useMemo(() => {
    if (isGujaratView) {
      return null;
    }
    if (state.phase === "confirm_neighborhood") {
      return location.candidate
        ? {
            center: location.candidate.fuzzedCenter,
            radiusMiles: PRIVACY_RING_DISPLAY_RADIUS_MILES,
          }
        : null;
    }
    if (
      (state.phase === "select_hometown" ||
        state.phase === "blurred_preview" ||
        (state.phase === "discovery" && !state.isGhostMode)) &&
      state.confirmedNeighborhood
    ) {
      return {
        center: state.confirmedNeighborhood.fuzzedCenter,
        radiusMiles: PRIVACY_RING_DISPLAY_RADIUS_MILES,
      };
    }
    return null;
  }, [
    isGujaratView,
    location.candidate,
    state.confirmedNeighborhood,
    state.isGhostMode,
    state.phase,
  ]);

  const originAnchor = useMemo(
    () =>
      isGujaratView && state.selectedOrigin
        ? {
            center: { lat: state.selectedOrigin.lat, lng: state.selectedOrigin.lng },
            label: state.selectedOrigin.displayName,
          }
        : null,
    [isGujaratView, state.selectedOrigin],
  );

  const activeBlurredPins = useMemo(
    () => (state.phase === "blurred_preview" && blurredPreview ? blurredPreview.households : []),
    [blurredPreview, state.phase],
  );

  const handlePressBlurredPin = useCallback(
    (householdId: string) => {
      openAuthForIntent({ type: "open_household", householdId });
    },
    [openAuthForIntent],
  );

  const selectedHouseholdId = useMemo(
    () => (pathname.startsWith("/household/") ? pathname.slice("/household/".length) : null),
    [pathname],
  );

  const handlePressDiscoveryPin = useCallback(
    (householdId: string) => {
      const target = { pathname: "/household/[id]" as const, params: { id: householdId } };
      if (pathname === `/household/${householdId}`) {
        return;
      }
      if (pathname.startsWith("/household/")) {
        router.replace(target);
        return;
      }
      router.push(target);
    },
    [pathname, router],
  );

  return (
    <View style={styles.container}>
      <MapCanvas
        mapRegion={isGujaratView ? "gujarat" : "san_antonio"}
        cameraTarget={cameraTarget}
        syncCamera={syncCamera}
        privacyRing={privacyRing}
        originAnchor={originAnchor}
        blurredPins={activeBlurredPins}
        onPressBlurredPin={handlePressBlurredPin}
        discoveryPins={isGujaratView ? [] : discoveryMatches}
        gujaratPins={gujaratPins}
        selectedHouseholdId={selectedHouseholdId}
        onPressDiscoveryPin={handlePressDiscoveryPin}
        interactiveDragAdjust={
          state.phase === "confirm_neighborhood" && location.status === "snapped"
        }
        onMapIdleCenterChange={location.adjustCandidateCenter}
      />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={styles.topBar}>
          <View style={[styles.badge, isGujaratView && styles.badgeGujarat]}>
            <Text style={[styles.badgeTitle, isGujaratView && styles.badgeTitleGujarat]}>
              {isGujaratView ? "Second Home · Gujarat" : "Second Home · San Antonio"}
            </Text>
            <Text style={styles.badgeSub}>
              {isGujaratView
                ? state.filters.originMode === "exact_town" && state.selectedOrigin
                  ? `Roots: ${state.selectedOrigin.displayName}`
                  : "All Gujarat hometowns"
                : state.confirmedNeighborhood
                  ? `Near ${state.confirmedNeighborhood.label}`
                  : "Gujarat → San Antonio"}
            </Text>
          </View>

          {state.phase === "discovery" ? (
            <DiscoveryTopControls
              filters={state.filters}
              selectedOrigin={state.selectedOrigin}
              isGhostMode={state.isGhostMode}
              onToggleOriginMode={() =>
                updateFilters({
                  originMode:
                    state.filters.originMode === "exact_town" ? "all_gujarat" : "exact_town",
                })
              }
              onOpenFilters={() => router.push("/filters")}
              onToggleGhostMode={() => toggleGhostMode()}
            />
          ) : null}

          {state.selectedOrigin && state.phase === "confirm_neighborhood" ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>Pre-selected origin: {state.selectedOrigin.name}</Text>
            </View>
          ) : null}

          {state.pendingInviteCode ? (
            <View style={styles.inviteChip}>
              <Text style={styles.inviteChipText}>
                Household invite ready ({state.pendingInviteCode})
              </Text>
            </View>
          ) : null}
        </View>

        <KeyboardAvoidingView
          behavior="padding"
          pointerEvents="box-none"
          style={styles.bottomStack}
        >
          {state.phase === "confirm_neighborhood" ? (
            <NeighborhoodConfirmCard
              status={location.status}
              candidate={location.candidate}
              offsetMiles={location.offsetMiles}
              errorMessage={location.errorMessage}
              onCaptureGps={() => void location.captureHardwareGps()}
              onConfirm={handleConfirmNeighborhood}
              onRecenter={location.recenterToAnchor}
              onOpenWaitlist={() => router.push("/waitlist")}
              onSimulateGps={location.simulateGpsFix}
            />
          ) : null}

          {state.phase === "select_hometown" ? (
            <GujaratAutocompleteCard
              neighborhoodLabel={state.confirmedNeighborhood?.label ?? "San Antonio"}
              selectedOrigin={state.selectedOrigin}
              onSelectOrigin={handleSelectOrigin}
              onEditNeighborhood={handleEditNeighborhood}
            />
          ) : null}

          {state.phase === "blurred_preview" && blurredPreview && state.selectedOrigin ? (
            <BlurredPreviewCard
              preview={blurredPreview}
              selectedOrigin={state.selectedOrigin}
              neighborhoodLabel={state.confirmedNeighborhood?.label ?? "San Antonio"}
              onChangeOrigin={handleEditOrigin}
              onEditNeighborhood={handleEditNeighborhood}
              onUnlock={() => openAuthForIntent({ type: "unlock_map" })}
            />
          ) : null}

          {state.phase === "personalize" ? (
            <PersonalizeCard
              initialDraft={state.personalization}
              pendingInviteCode={state.pendingInviteCode}
              onComplete={completePersonalization}
            />
          ) : null}

          {state.phase === "discovery" ? (
            <>
              <MapFlipButton mapRegion={state.mapRegion} onFlip={toggleMapRegion} />
              <DiscoveryBottomTray
                households={discoveryMatches}
                neighborhoodLabel={state.confirmedNeighborhood?.label ?? "San Antonio"}
                mapRegion={state.mapRegion}
                isGhostMode={state.isGhostMode}
                onSelectHousehold={handlePressDiscoveryPin}
                onShowAllGujarat={() =>
                  updateFilters({ originMode: "all_gujarat", radiusMiles: 25 })
                }
                onResetFilters={() => updateFilters(DEFAULT_DISCOVERY_FILTERS)}
              />
            </>
          ) : null}

          {state.phase !== "confirm_neighborhood" || location.status === "snapped" ? (
            <Pressable style={styles.resetPill} onPress={handleReset}>
              <Text style={styles.resetPillText}>Reset prototype flow</Text>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EBF2F7",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "space-between",
    padding: 16,
  },
  topBar: {
    gap: 8,
    alignItems: "flex-start",
  },
  badge: {
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  badgeGujarat: {
    borderColor: "#FDE68A",
    backgroundColor: "rgba(255, 251, 235, 0.96)",
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  badgeTitleGujarat: {
    color: "#92400E",
  },
  badgeSub: {
    fontSize: 12,
    color: "#475569",
  },
  chip: {
    backgroundColor: "#CCFBF1",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#99F6E4",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#115E59",
  },
  inviteChip: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  inviteChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400E",
  },
  bottomStack: {
    gap: 8,
  },
  resetPill: {
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  resetPillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
});
