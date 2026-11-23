import {
  SAN_ANTONIO_DEFAULT_CENTER,
  getGujaratLocationById,
  parseOriginDeepLinkParam,
} from "@second-home/shared";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapCanvas } from "@/components/MapCanvas";
import { useAppFlow } from "@/state/AppFlowContext";

const SAMPLE_FUZZED_NEIGHBORHOOD = {
  label: "Medical Center",
  fuzzedCenter: {
    lat: 29.5215,
    lng: -98.5647,
  },
};

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

  const mapCenter = state.confirmedNeighborhood?.fuzzedCenter ?? SAN_ANTONIO_DEFAULT_CENTER;

  return (
    <View style={styles.container}>
      <MapCanvas center={mapCenter} />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={styles.topBar}>
          <View style={styles.badge}>
            <Text style={styles.badgeTitle}>Second Home · San Antonio</Text>
            <Text style={styles.badgeSub}>Phase: {state.phase}</Text>
          </View>

          {state.selectedOrigin ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>Origin: {state.selectedOrigin.displayName}</Text>
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

        <View style={styles.bottomCard}>
          {state.phase === "confirm_neighborhood" ? (
            <>
              <Text style={styles.cardTitle}>Confirm your neighborhood in San Antonio</Text>
              <Text style={styles.cardBody}>
                Map-first launch with zero upfront login wall. Step 2.2 replaces this card with live
                GPS capture & ~1 mi fuzzing ring.
              </Text>
              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => confirmNeighborhood(SAMPLE_FUZZED_NEIGHBORHOOD)}
                >
                  <Text style={styles.primaryButtonText}>Confirm Neighborhood</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => router.push("/waitlist")}>
                  <Text style={styles.secondaryButtonText}>Outside SA?</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {state.phase === "select_hometown" ? (
            <>
              <Text style={styles.cardTitle}>Where in Gujarat is home?</Text>
              <Text style={styles.cardBody}>
                Step 2.2 adds instant gazetteer autocomplete. Test a sample origin below:
              </Text>
              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    const fallbackOrigin = getGujaratLocationById("ahmedabad-navrangpura");
                    if (fallbackOrigin) {
                      dispatch({ type: "SELECT_ORIGIN", origin: fallbackOrigin });
                    }
                  }}
                >
                  <Text style={styles.primaryButtonText}>Select Navrangpura, Ahmedabad</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {state.phase === "blurred_preview" ? (
            <>
              <Text style={styles.cardTitle}>Blurred Match Preview</Text>
              <Text style={styles.cardBody}>
                Neighborhood: {state.confirmedNeighborhood?.label ?? "San Antonio"} · Origin:{" "}
                {state.selectedOrigin?.displayName ?? "Gujarat"}
              </Text>
              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => openAuthForIntent({ type: "unlock_map" })}
                >
                  <Text style={styles.primaryButtonText}>Unlock Neighbors</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() =>
                    openAuthForIntent({
                      type: "open_household",
                      householdId: SAMPLE_MOCK_HOUSEHOLD_ID,
                    })
                  }
                >
                  <Text style={styles.secondaryButtonText}>Tap Blurred Pin</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {state.phase === "personalize" ? (
            <>
              <Text style={styles.cardTitle}>3-Second Personalization</Text>
              <Text style={styles.cardBody}>
                Step 2.2 renders 1-tap Age Bracket, Life Stage & Interest pills here.
              </Text>
              <View style={styles.actionsRow}>
                <Pressable style={styles.primaryButton} onPress={() => completePersonalization()}>
                  <Text style={styles.primaryButtonText}>Continue to Discovery</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {state.phase === "discovery" ? (
            <>
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
            </>
          ) : null}

          {state.phase !== "confirm_neighborhood" ? (
            <Pressable style={styles.resetLink} onPress={resetPrototypeFlow}>
              <Text style={styles.resetLinkText}>Reset prototype flow</Text>
            </Pressable>
          ) : null}
        </View>
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
  resetLink: {
    alignSelf: "flex-start",
    paddingTop: 2,
  },
  resetLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
});
