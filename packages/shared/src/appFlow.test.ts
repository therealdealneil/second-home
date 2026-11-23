import { describe, expect, it } from "vitest";
import {
  INITIAL_APP_FLOW_STATE,
  appFlowReducer,
  parsePersistedFlowSnapshot,
  serializeFlowSnapshot,
  type AppFlowState,
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

  it("supports pre-auth editing of neighborhood and Gujarat origin", () => {
    const atOrigin = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "select_hometown" as const,
      confirmedNeighborhood: MEDICAL_CENTER,
    };
    const backToMap = appFlowReducer(atOrigin, { type: "EDIT_NEIGHBORHOOD" });
    expect(backToMap.phase).toBe("confirm_neighborhood");
    expect(backToMap.confirmedNeighborhood).toEqual(MEDICAL_CENTER);

    const atPreview = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "blurred_preview" as const,
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
    };
    const backToOrigin = appFlowReducer(atPreview, { type: "EDIT_ORIGIN" });
    expect(backToOrigin.phase).toBe("select_hometown");

    const authed = {
      ...atPreview,
      phase: "discovery" as const,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
    };
    expect(appFlowReducer(authed, { type: "EDIT_NEIGHBORHOOD" }).phase).toBe("discovery");
    expect(appFlowReducer(authed, { type: "EDIT_ORIGIN" }).phase).toBe("discovery");
    expect(
      appFlowReducer(authed, {
        type: "CONFIRM_NEIGHBORHOOD",
        neighborhood: { label: "Stone Oak", fuzzedCenter: { lat: 29.65, lng: -98.48 } },
      }).phase,
    ).toBe("discovery");

    // Authenticated user missing a neighborhood can still confirm it and advance
    const authedMissingNeighborhood = {
      ...INITIAL_APP_FLOW_STATE,
      isAuthenticated: true,
      selectedOrigin: AHMEDABAD,
    };
    const confirmed = appFlowReducer(authedMissingNeighborhood, {
      type: "CONFIRM_NEIGHBORHOOD",
      neighborhood: MEDICAL_CENTER,
    });
    expect(confirmed.confirmedNeighborhood).toEqual(MEDICAL_CENTER);
    expect(confirmed.phase).toBe("personalize");
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

describe("Flow C social actions, safety blocks, and Ghost Mode", () => {
  it("validates icebreakers, accepts connections, supports peer vouching, and blocks cleanly", () => {
    let state: AppFlowState = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery",
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
    };

    // Invalid icebreaker with URL is ignored
    const rejected = appFlowReducer(state, {
      type: "SEND_CONNECTION_REQUEST",
      userId: "u-rohan",
      householdId: "hh-patel",
      icebreakerText: "Join https://spam.test",
    });
    expect(rejected.connectionsByUserId["u-rohan"]).toBeUndefined();

    // Valid icebreaker -> pending -> accept -> vouch
    state = appFlowReducer(state, {
      type: "SEND_CONNECTION_REQUEST",
      userId: "u-rohan",
      householdId: "hh-patel",
      icebreakerText: "Kem cho Rohan! Would love to connect.",
      timestamp: "2026-11-22T20:00:00.000Z",
    });
    expect(state.connectionsByUserId["u-rohan"]?.status).toBe("pending");

    // Cannot vouch before mutual acceptance
    expect(
      appFlowReducer(state, { type: "VOUCH_MEMBER", userId: "u-rohan" }).vouchedUserIds,
    ).toEqual([]);

    state = appFlowReducer(state, {
      type: "ACCEPT_MOCK_CONNECTION",
      userId: "u-rohan",
      timestamp: "2026-11-22T20:05:00.000Z",
    });
    expect(state.connectionsByUserId["u-rohan"]?.status).toBe("accepted");

    state = appFlowReducer(state, { type: "VOUCH_MEMBER", userId: "u-rohan" });
    state = appFlowReducer(state, { type: "VOUCH_MEMBER", userId: "u-rohan" });
    expect(state.vouchedUserIds).toEqual(["u-rohan"]);

    // Blocking household revokes connection and records household ID
    state = appFlowReducer(state, {
      type: "BLOCK_HOUSEHOLD",
      householdId: "hh-patel",
      memberUserIds: ["u-rohan", "u-priya"],
      timestamp: "2026-11-22T20:10:00.000Z",
    });
    expect(state.blockedHouseholdIds).toEqual(["hh-patel"]);
    expect(state.connectionsByUserId["u-rohan"]?.status).toBe("blocked");
    expect(state.connectionsByUserId["u-priya"]?.status).toBe("blocked");

    // Ghost Mode & Report
    state = appFlowReducer(state, { type: "TOGGLE_GHOST_MODE" });
    expect(state.isGhostMode).toBe(true);
    state = appFlowReducer(state, {
      type: "REPORT_MEMBER",
      userId: "u-rohan",
      reasonCode: "spam",
    });
    expect(state.reportedUserIds).toEqual(["u-rohan"]);
  });

  it("blocks duplicate SEND_CONNECTION_REQUEST over pending, accepted, or blocked states", () => {
    const authedState: AppFlowState = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery",
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
    };

    // Unauthenticated requests are ignored
    expect(
      appFlowReducer(INITIAL_APP_FLOW_STATE, {
        type: "SEND_CONNECTION_REQUEST",
        userId: "u-test",
        householdId: "hh-test",
        icebreakerText: "Kem cho neighbor!",
      }).connectionsByUserId["u-test"],
    ).toBeUndefined();
    expect(
      appFlowReducer(INITIAL_APP_FLOW_STATE, {
        type: "VOUCH_MEMBER",
        userId: "10000000-0000-4000-8000-000000000003",
      }).vouchedUserIds,
    ).toEqual([]);

    // Cannot overwrite existing pending connection
    const pendingState = appFlowReducer(authedState, {
      type: "SEND_CONNECTION_REQUEST",
      userId: "u-rohan",
      householdId: "hh-patel",
      icebreakerText: "First greeting!",
      timestamp: "2026-11-22T20:00:00.000Z",
    });
    const duplicatePending = appFlowReducer(pendingState, {
      type: "SEND_CONNECTION_REQUEST",
      userId: "u-rohan",
      householdId: "hh-patel",
      icebreakerText: "Second overwrite attempt!",
      timestamp: "2026-11-22T20:05:00.000Z",
    });
    expect(duplicatePending.connectionsByUserId["u-rohan"]?.icebreakerText).toBe("First greeting!");

    // Blocked households reject new requests and vouches
    const blockedState = appFlowReducer(authedState, {
      type: "BLOCK_HOUSEHOLD",
      householdId: "hh-patel",
      memberUserIds: ["u-priya"],
    });
    expect(
      appFlowReducer(blockedState, {
        type: "SEND_CONNECTION_REQUEST",
        userId: "u-priya",
        householdId: "hh-patel",
        icebreakerText: "Should not send",
      }).connectionsByUserId["u-priya"]?.status,
    ).toBe("blocked");
  });

  it("round-trips Flow C snapshot state and preserves seeded connections for legacy Step 2.1 snapshots", () => {
    let state: AppFlowState = {
      ...INITIAL_APP_FLOW_STATE,
      phase: "discovery",
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOrigin: AHMEDABAD,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
    };
    state = appFlowReducer(state, { type: "TOGGLE_GHOST_MODE", enabled: true });
    state = appFlowReducer(state, {
      type: "SEND_CONNECTION_REQUEST",
      userId: "u-rohan",
      householdId: "hh-patel",
      icebreakerText: "Kem cho Rohan!",
      timestamp: "2026-11-22T21:00:00.000Z",
    });
    state = appFlowReducer(state, {
      type: "VOUCH_MEMBER",
      userId: "10000000-0000-4000-8000-000000000003",
    });
    state = appFlowReducer(state, {
      type: "BLOCK_HOUSEHOLD",
      householdId: "hh-blocked",
      memberUserIds: ["u-blocked"],
    });

    const serialized = serializeFlowSnapshot(state);
    const parsed = parsePersistedFlowSnapshot(serialized);
    expect(parsed).not.toBeNull();
    const rehydrated = appFlowReducer(INITIAL_APP_FLOW_STATE, {
      type: "HYDRATE_STATE",
      payload: parsed!,
    });
    expect(rehydrated.isGhostMode).toBe(true);
    expect(rehydrated.vouchedUserIds).toEqual(["10000000-0000-4000-8000-000000000003"]);
    expect(rehydrated.blockedHouseholdIds).toEqual(["hh-blocked"]);
    expect(rehydrated.connectionsByUserId["u-rohan"]?.status).toBe("pending");
    expect(rehydrated.connectionsByUserId["u-blocked"]?.status).toBe("blocked");

    // Pre-Step-2.2 snapshot missing Flow C keys should retain INITIAL_APP_FLOW_STATE seeded connection
    const legacySnapshot = JSON.stringify({
      phase: "discovery",
      confirmedNeighborhood: MEDICAL_CENTER,
      selectedOriginId: AHMEDABAD.id,
      pendingInviteCode: null,
      isAuthenticated: true,
      hasCompletedPersonalization: true,
      personalization: { ageBracket: "30s", lifeStage: "couple", interests: ["Cricket"] },
      filters: { originMode: "exact_town", radiusMiles: 10, ageBrackets: [], lifeStages: [] },
    });
    const parsedLegacy = parsePersistedFlowSnapshot(legacySnapshot);
    expect(parsedLegacy?.connectionsByUserId).toBeUndefined();
    const hydratedLegacy = appFlowReducer(INITIAL_APP_FLOW_STATE, {
      type: "HYDRATE_STATE",
      payload: parsedLegacy!,
    });
    expect(hydratedLegacy.connectionsByUserId["10000000-0000-4000-8000-000000000003"]?.status).toBe(
      "accepted",
    );

    // RESET_FLOW restores INITIAL_APP_FLOW_STATE cleanly
    const resetState = appFlowReducer(rehydrated, { type: "RESET_FLOW" });
    expect(resetState).toEqual(INITIAL_APP_FLOW_STATE);
  });
});
