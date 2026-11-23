import { describe, expect, it } from "vitest";
import {
  INITIAL_APP_FLOW_STATE,
  appFlowReducer,
  parsePersistedFlowSnapshot,
  serializeFlowSnapshot,
} from "./appFlow";
import { getGujaratLocationById } from "./locations";

const AHMEDABAD = getGujaratLocationById("ahmedabad-navrangpura")!;
const SURAT = getGujaratLocationById("surat-vesu")!;
const MEDICAL_CENTER = {
  label: "Medical Center",
  fuzzedCenter: { lat: 29.5215, lng: -98.5647 },
};

describe("appFlowReducer Flow B -> Soft Auth -> Flow C", () => {
  it("walks through standard onboarding without upfront auth wall", () => {
    let state = INITIAL_APP_FLOW_STATE;
    expect(state.phase).toBe("confirm_neighborhood");

    state = appFlowReducer(state, {
      type: "CONFIRM_NEIGHBORHOOD",
      neighborhood: MEDICAL_CENTER,
    });
    expect(state.phase).toBe("select_hometown");

    state = appFlowReducer(state, { type: "SELECT_ORIGIN", origin: AHMEDABAD });
    expect(state.phase).toBe("blurred_preview");

    state = appFlowReducer(state, {
      type: "SET_PENDING_INTENT",
      intent: { type: "open_household", householdId: "hh-1" },
    });
    state = appFlowReducer(state, { type: "COMPLETE_MOCK_AUTH" });
    expect(state.isAuthenticated).toBe(true);
    expect(state.phase).toBe("personalize");
    expect(state.pendingIntent).toEqual({ type: "open_household", householdId: "hh-1" });

    state = appFlowReducer(state, { type: "COMPLETE_PERSONALIZATION" });
    expect(state.phase).toBe("discovery");
    expect(state.pendingIntent).toEqual({ type: "open_household", householdId: "hh-1" });

    state = appFlowReducer(state, { type: "CLEAR_PENDING_INTENT" });
    expect(state.pendingIntent).toBeNull();
  });

  it("pre-fills ?origin_id without skipping San Antonio GPS confirmation", () => {
    let state = appFlowReducer(INITIAL_APP_FLOW_STATE, {
      type: "APPLY_ORIGIN_DEEP_LINK",
      origin: SURAT,
    });
    expect(state.phase).toBe("confirm_neighborhood");
    expect(state.selectedOrigin?.id).toBe(SURAT.id);

    state = appFlowReducer(state, {
      type: "CONFIRM_NEIGHBORHOOD",
      neighborhood: MEDICAL_CENTER,
    });
    expect(state.phase).toBe("blurred_preview");
  });

  it("does not overwrite onboarded user's hometown when opening ?origin_id in discovery", () => {
    const onboarded = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery" as const,
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
    };

    const next = appFlowReducer(onboarded, {
      type: "APPLY_ORIGIN_DEEP_LINK",
      origin: SURAT,
    });
    expect(next.selectedOrigin?.id).toBe(AHMEDABAD.id);
    expect(next.phase).toBe("discovery");
  });

  it("enforces location and auth prerequisites on COMPLETE_MOCK_AUTH and COMPLETE_PERSONALIZATION", () => {
    const authWithoutLocation = appFlowReducer(INITIAL_APP_FLOW_STATE, {
      type: "COMPLETE_MOCK_AUTH",
    });
    expect(authWithoutLocation.isAuthenticated).toBe(true);
    expect(authWithoutLocation.phase).toBe("confirm_neighborhood");

    const authWithoutOrigin = appFlowReducer(
      {
        ...INITIAL_APP_FLOW_STATE,
        confirmedNeighborhood: MEDICAL_CENTER,
      },
      { type: "COMPLETE_MOCK_AUTH" },
    );
    expect(authWithoutOrigin.phase).toBe("select_hometown");

    const personalizeWithoutAuth = appFlowReducer(
      {
        ...INITIAL_APP_FLOW_STATE,
        phase: "blurred_preview",
        confirmedNeighborhood: MEDICAL_CENTER,
        selectedOrigin: AHMEDABAD,
      },
      { type: "COMPLETE_PERSONALIZATION" },
    );
    expect(personalizeWithoutAuth.phase).toBe("blurred_preview");
  });

  it("clears unlock_map pendingIntent after auth/personalization", () => {
    const ready = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "blurred_preview" as const,
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      pendingIntent: { type: "unlock_map" as const },
    };

    const afterAuth = appFlowReducer(ready, { type: "COMPLETE_MOCK_AUTH" });
    expect(afterAuth.pendingIntent).toBeNull();
    expect(afterAuth.phase).toBe("personalize");
  });
});

describe("persisted flow snapshot serialization and repair", () => {
  it("repairs invalid phase combinations and drops corrupt JSON", () => {
    const badSnapshot = serializeFlowSnapshot({
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery",
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: false,
      hasCompletedPersonalization: false,
    });

    const restored = parsePersistedFlowSnapshot(badSnapshot);
    expect(restored?.phase).toBe("blurred_preview");

    const discoveryWithoutPersonalization = serializeFlowSnapshot({
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery",
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: true,
      hasCompletedPersonalization: false,
    });
    expect(parsePersistedFlowSnapshot(discoveryWithoutPersonalization)?.phase).toBe("personalize");

    const missingNeighborhood = serializeFlowSnapshot({
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery",
      confirmedNeighborhood: null,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
    });
    expect(parsePersistedFlowSnapshot(missingNeighborhood)?.phase).toBe("confirm_neighborhood");

    expect(parsePersistedFlowSnapshot("{not-json")).toBeNull();
    expect(parsePersistedFlowSnapshot(JSON.stringify({ phase: "unknown" }))).toBeNull();
  });

  it("preserves concurrent deep-link state during HYDRATE_STATE", () => {
    const withInvite = appFlowReducer(INITIAL_APP_FLOW_STATE, {
      type: "SET_PENDING_INVITE_CODE",
      code: "mockinv0001",
    });

    const hydrated = appFlowReducer(withInvite, {
      type: "HYDRATE_STATE",
      payload: {
        phase: "blurred_preview",
        confirmedNeighborhood: MEDICAL_CENTER,
        selectedOrigin: AHMEDABAD,
        pendingInviteCode: null,
        isAuthenticated: false,
        hasCompletedPersonalization: false,
      },
    });

    expect(hydrated.pendingInviteCode).toBe("mockinv0001");
    expect(hydrated.phase).toBe("blurred_preview");
    expect(hydrated.confirmedNeighborhood).toEqual(MEDICAL_CENTER);
  });
});
