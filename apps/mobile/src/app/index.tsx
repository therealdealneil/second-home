import {
  PRIVACY_RING_DISPLAY_RADIUS_MILES,
  SAN_ANTONIO_DEFAULT_CENTER,
  SAN_ANTONIO_DEFAULT_ZOOM,
  evaluateBlurredPreviewMatches,
  parseOriginDeepLinkParam,
  type ConfirmedNeighborhood,
  type GujaratLocation,
} from "@second-home/shared";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapCanvas, type MapCameraTarget, type MapSyncCamera } from "@/components/MapCanvas";
import { BlurredPreviewCard } from "@/components/onboarding/BlurredPreviewCard";
import { GujaratAutocompleteCard } from "@/components/onboarding/GujaratAutocompleteCard";
import { NeighborhoodConfirmCard } from "@/components/onboarding/NeighborhoodConfirmCard";
import { MOCK_SAN_ANTONIO_HOUSEHOLDS } from "@/data/mockHouseholds";
import { useSanAntonioLocation } from "@/hooks/useSanAntonioLocation";
import { useAppFlow } from "@/state/AppFlowContext";

const SAMPLE_MOCK_HOUSEHOLD_ID = "20000000-0000-4000-8000-000000000001";

export default function MapHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ origin_id?: string | string[] }>();
  const {
    state,
    isHydrated,
    dispatch,
    confirmNeighborhood,
    openAuthForIntent,
    completePersonalization,
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
    if (
      state.phase === "blurred_preview" ||
      state.phase === "personalize" ||
      state.phase === "discovery"
    ) {
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
    state.phase,
    state.selectedOrigin?.id,
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
    location.resetLocationCapture();
    resetPrototypeFlow();
    moveCamera(SAN_ANTONIO_DEFAULT_CENTER, SAN_ANTONIO_DEFAULT_ZOOM);
  }, [location, moveCamera, resetPrototypeFlow]);

  const privacyRing = useMemo(() => {
    if (state.phase === "confirm_neighborhood") {
      return location.candidate
        ? {
            center: location.candidate.fuzzedCenter,
            radiusMiles: PRIVACY_RING_DISPLAY_RADIUS_MILES,
          }
        : null;
    }
    if (
      (state.phase === "select_hometown" || state.phase === "blurred_preview") &&
      state.confirmedNeighborhood
    ) {
      return {
        center: state.confirmedNeighborhood.fuzzedCenter,
        radiusMiles: PRIVACY_RING_DISPLAY_RADIUS_MILES,
      };
    }
    return null;
  }, [location.candidate, state.confirmedNeighborhood, state.phase]);

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

  return (
    <View style={styles.container}>
      <MapCanvas
        cameraTarget={cameraTarget}
        syncCamera={syncCamera}
        privacyRing={privacyRing}
        blurredPins={activeBlurredPins}
        onPressBlurredPin={handlePressBlurredPin}
        interactiveDragAdjust={
          state.phase === "confirm_neighborhood" && location.status === "snapped"
        }
        onMapIdleCenterChange={location.adjustCandidateCenter}
      />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={styles.topBar}>
          <View style={styles.badge}>
            <Text style={styles.badgeTitle}>Second Home · San Antonio</Text>
            <Text style={styles.badgeSub}>
              {state.confirmedNeighborhood
                ? `Near ${state.confirmedNeighborhood.label}`
                : "Gujarat → San Antonio"}
            </Text>
          </View>

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
            <View style={styles.bottomCard}>
              <Text style={styles.cardTitle}>3-Second Personalization</Text>
              <Text style={styles.cardBody}>
                Age Bracket, Life Stage & Interest pills land next in Flow B Step 5.
              </Text>
              <View style={styles.actionsRow}>
                <Pressable style={styles.primaryButton} onPress={() => completePersonalization()}>
                  <Text style={styles.primaryButtonText}>Continue to Discovery</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {state.phase === "discovery" ? (
            <View style={styles.bottomCard}>
              <Text style={styles.cardTitle}>Discovery Map Active</Text>
              <Text style={styles.cardBody}>
                Filters: {state.filters.originMode === "exact_town" ? "Exact Town" : "All Gujarat"}{" "}
                · {state.filters.radiusMiles} mi
              </Text>
              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() =>
                    router.push({
                      pathname: "/household/[id]",
                      params: { id: SAMPLE_MOCK_HOUSEHOLD_ID },
                    })
                  }
                >
                  <Text style={styles.primaryButtonText}>Open Household Sheet</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => router.push("/filters")}>
                  <Text style={styles.secondaryButtonText}>Filters</Text>
                </Pressable>
              </View>
            </View>
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
  badgeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
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
  bottomCard: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 20,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: "#0F766E",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "600",
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
