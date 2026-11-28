import { validateIcebreaker, type ReportReasonCode } from "./discovery";
import type { ConnectionRecord } from "./enums";
import { getGujaratLocationById, type GujaratLocation } from "./locations";
import {
  DEFAULT_DISCOVERY_FILTERS,
  PersistedFlowSnapshotSchema,
  type AppFlowPhase,
  type ConfirmedNeighborhood,
  type DiscoveryFilters,
  type MapRegion,
  type PersistedFlowSnapshot,
  type PersonalizationDraft,
} from "./navigation";

export type PendingAuthIntent =
  { type: "unlock_map" } | { type: "open_household"; householdId: string } | null;

export type AppFlowState = {
  phase: AppFlowPhase;
  confirmedNeighborhood: ConfirmedNeighborhood | null;
  selectedOrigin: GujaratLocation | null;
  pendingInviteCode: string | null;
  pendingIntent: PendingAuthIntent;
  isAuthenticated: boolean;
  hasCompletedPersonalization: boolean;
  personalization: PersonalizationDraft;
  filters: DiscoveryFilters;
  mapRegion: MapRegion;
  isGhostMode: boolean;
  blockedHouseholdIds: string[];
  vouchedUserIds: string[];
  reportedUserIds: string[];
  connectionsByUserId: Record<string, ConnectionRecord>;
};

// Pre-seed 1 mutually accepted mock connection (Kunal from Shah Household)
// matching supabase/seed/san_antonio_mock_households.sql so reviewers can test
// WhatsApp handoff and peer vouching immediately in Flow C.
const SEEDED_CONNECTIONS: Record<string, ConnectionRecord> = {
  "10000000-0000-4000-8000-000000000003": {
    status: "accepted",
    icebreakerText: "Kem cho! Saw you are also from Ahmedabad and near Medical Center.",
    updatedAt: "2026-11-20T12:00:00.000Z",
  },
};

export const INITIAL_APP_FLOW_STATE: AppFlowState = {
  phase: "confirm_neighborhood",
  confirmedNeighborhood: null,
  selectedOrigin: null,
  pendingInviteCode: null,
  pendingIntent: null,
  isAuthenticated: false,
  hasCompletedPersonalization: false,
  personalization: {
    ageBracket: null,
    lifeStage: null,
    interests: [],
  },
  filters: DEFAULT_DISCOVERY_FILTERS,
  mapRegion: "san_antonio",
  isGhostMode: false,
  blockedHouseholdIds: [],
  vouchedUserIds: [],
  reportedUserIds: [],
  connectionsByUserId: SEEDED_CONNECTIONS,
};

export type AppFlowAction =
  | { type: "HYDRATE_STATE"; payload: Partial<AppFlowState> }
  | { type: "APPLY_ORIGIN_DEEP_LINK"; origin: GujaratLocation }
  | { type: "SET_PENDING_INVITE_CODE"; code: string }
  | { type: "CLEAR_PENDING_INVITE_CODE" }
  | { type: "CONFIRM_NEIGHBORHOOD"; neighborhood: ConfirmedNeighborhood }
  | { type: "EDIT_NEIGHBORHOOD" }
  | { type: "SELECT_ORIGIN"; origin: GujaratLocation }
  | { type: "EDIT_ORIGIN" }
  | { type: "SET_PENDING_INTENT"; intent: PendingAuthIntent }
  | { type: "COMPLETE_AUTH" }
  | { type: "RECONCILE_AUTH_SESSION"; isAuthenticated: boolean }
  | { type: "COMPLETE_PERSONALIZATION"; personalization?: PersonalizationDraft }
  | { type: "CLEAR_PENDING_INTENT" }
  | { type: "UPDATE_FILTERS"; filters: Partial<DiscoveryFilters> }
  | { type: "SET_MAP_REGION"; region: MapRegion }
  | { type: "TOGGLE_MAP_REGION" }
  | { type: "TOGGLE_GHOST_MODE"; enabled?: boolean }
  | {
      type: "SEND_CONNECTION_REQUEST";
      userId: string;
      householdId: string;
      icebreakerText: string;
      timestamp?: string;
    }
  | { type: "ACCEPT_MOCK_CONNECTION"; userId: string; timestamp?: string }
  | { type: "VOUCH_MEMBER"; userId: string }
  | {
      type: "BLOCK_HOUSEHOLD";
      householdId: string;
      memberUserIds: readonly string[];
      timestamp?: string;
    }
  | { type: "REPORT_MEMBER"; userId: string; reasonCode: ReportReasonCode }
  | { type: "RESET_FLOW" };

function resolveValidatedPhase(
  requestedPhase: AppFlowPhase,
  prereqs: Pick<
    AppFlowState,
    "confirmedNeighborhood" | "selectedOrigin" | "isAuthenticated" | "hasCompletedPersonalization"
  >,
): AppFlowPhase {
  if (!prereqs.confirmedNeighborhood) {
    return "confirm_neighborhood";
  }
  if (!prereqs.selectedOrigin) {
    return requestedPhase === "confirm_neighborhood" ? "confirm_neighborhood" : "select_hometown";
  }
  if (!prereqs.isAuthenticated) {
    return requestedPhase === "personalize" || requestedPhase === "discovery"
      ? "blurred_preview"
      : requestedPhase;
  }
  if (prereqs.hasCompletedPersonalization) {
    return "discovery";
  }
  return "personalize";
}

export function appFlowReducer(state: AppFlowState, action: AppFlowAction): AppFlowState {
  switch (action.type) {
    case "HYDRATE_STATE": {
      const merged: AppFlowState = {
        ...state,
        ...action.payload,
        // Preserve any deep-link state captured concurrently while storage loaded
        pendingInviteCode: state.pendingInviteCode ?? action.payload.pendingInviteCode ?? null,
        selectedOrigin: state.selectedOrigin ?? action.payload.selectedOrigin ?? null,
        // Cold launches always open on the San Antonio map
        mapRegion: "san_antonio",
        // Transient navigation intents shouldn't survive cold restarts
        pendingIntent: null,
      };
      return {
        ...merged,
        phase: resolveValidatedPhase(merged.phase, merged),
      };
    }

    case "APPLY_ORIGIN_DEEP_LINK": {
      // Do not overwrite an onboarded user's chosen hometown once in discovery.
      if (state.phase === "discovery" || state.phase === "personalize") {
        return state;
      }
      const nextPhase: AppFlowPhase =
        state.phase === "select_hometown" ? "blurred_preview" : state.phase;
      return {
        ...state,
        selectedOrigin: action.origin,
        phase: nextPhase,
      };
    }

    case "SET_PENDING_INVITE_CODE": {
      return {
        ...state,
        pendingInviteCode: action.code,
      };
    }

    case "CLEAR_PENDING_INVITE_CODE": {
      return {
        ...state,
        pendingInviteCode: null,
      };
    }

    case "CONFIRM_NEIGHBORHOOD": {
      if (state.isAuthenticated && state.confirmedNeighborhood !== null) {
        return state;
      }
      const nextPhase = resolveValidatedPhase(
        state.selectedOrigin ? "blurred_preview" : "select_hometown",
        {
          confirmedNeighborhood: action.neighborhood,
          selectedOrigin: state.selectedOrigin,
          isAuthenticated: state.isAuthenticated,
          hasCompletedPersonalization: state.hasCompletedPersonalization,
        },
      );
      return {
        ...state,
        confirmedNeighborhood: action.neighborhood,
        phase: nextPhase,
      };
    }

    case "EDIT_NEIGHBORHOOD": {
      if (state.isAuthenticated) {
        return state;
      }
      return {
        ...state,
        phase: "confirm_neighborhood",
      };
    }

    case "SELECT_ORIGIN": {
      const nextPhase: AppFlowPhase =
        state.phase === "select_hometown" ? "blurred_preview" : state.phase;
      return {
        ...state,
        selectedOrigin: action.origin,
        phase: nextPhase,
      };
    }

    case "EDIT_ORIGIN": {
      if (state.phase !== "blurred_preview") {
        return state;
      }
      return {
        ...state,
        phase: "select_hometown",
      };
    }

    case "SET_PENDING_INTENT": {
      return {
        ...state,
        pendingIntent: action.intent,
      };
    }

    case "COMPLETE_AUTH": {
      const desiredPhase: AppFlowPhase = state.hasCompletedPersonalization
        ? "discovery"
        : "personalize";
      const nextPhase = resolveValidatedPhase(desiredPhase, {
        confirmedNeighborhood: state.confirmedNeighborhood,
        selectedOrigin: state.selectedOrigin,
        isAuthenticated: true,
        hasCompletedPersonalization: state.hasCompletedPersonalization,
      });
      return {
        ...state,
        isAuthenticated: true,
        phase: nextPhase,
        pendingIntent: state.pendingIntent?.type === "unlock_map" ? null : state.pendingIntent,
      };
    }

    case "RECONCILE_AUTH_SESSION": {
      if (state.isAuthenticated === action.isAuthenticated) {
        return state;
      }
      const desiredPhase: AppFlowPhase = action.isAuthenticated
        ? state.hasCompletedPersonalization
          ? "discovery"
          : "personalize"
        : state.phase;
      const nextPhase = resolveValidatedPhase(desiredPhase, {
        confirmedNeighborhood: state.confirmedNeighborhood,
        selectedOrigin: state.selectedOrigin,
        isAuthenticated: action.isAuthenticated,
        hasCompletedPersonalization: state.hasCompletedPersonalization,
      });
      return {
        ...state,
        isAuthenticated: action.isAuthenticated,
        phase: nextPhase,
      };
    }

    case "COMPLETE_PERSONALIZATION": {
      const nextPhase = resolveValidatedPhase("discovery", {
        confirmedNeighborhood: state.confirmedNeighborhood,
        selectedOrigin: state.selectedOrigin,
        isAuthenticated: state.isAuthenticated,
        hasCompletedPersonalization: true,
      });
      return {
        ...state,
        hasCompletedPersonalization: true,
        personalization: action.personalization ?? state.personalization,
        phase: nextPhase,
        pendingIntent: state.pendingIntent?.type === "unlock_map" ? null : state.pendingIntent,
      };
    }

    case "CLEAR_PENDING_INTENT": {
      return {
        ...state,
        pendingIntent: null,
      };
    }

    case "UPDATE_FILTERS": {
      return {
        ...state,
        filters: {
          ...state.filters,
          ...action.filters,
        },
      };
    }

    case "SET_MAP_REGION": {
      if (state.phase !== "discovery") {
        return {
          ...state,
          mapRegion: "san_antonio",
        };
      }
      return {
        ...state,
        mapRegion: action.region,
      };
    }

    case "TOGGLE_MAP_REGION": {
      if (state.phase !== "discovery") {
        return {
          ...state,
          mapRegion: "san_antonio",
        };
      }
      return {
        ...state,
        mapRegion: state.mapRegion === "san_antonio" ? "gujarat" : "san_antonio",
      };
    }

    case "TOGGLE_GHOST_MODE": {
      return {
        ...state,
        isGhostMode: action.enabled ?? !state.isGhostMode,
      };
    }

    case "SEND_CONNECTION_REQUEST": {
      if (!state.isAuthenticated || state.blockedHouseholdIds.includes(action.householdId)) {
        return state;
      }
      const existing = state.connectionsByUserId[action.userId];
      if (existing) {
        return state;
      }
      const checked = validateIcebreaker(action.icebreakerText);
      if (!checked.ok) {
        return state;
      }
      return {
        ...state,
        connectionsByUserId: {
          ...state.connectionsByUserId,
          [action.userId]: {
            status: "pending",
            icebreakerText: checked.text,
            updatedAt: action.timestamp ?? "1970-01-01T00:00:00.000Z",
          },
        },
      };
    }

    case "ACCEPT_MOCK_CONNECTION": {
      const existing = state.connectionsByUserId[action.userId];
      if (!existing || existing.status !== "pending") {
        return state;
      }
      return {
        ...state,
        connectionsByUserId: {
          ...state.connectionsByUserId,
          [action.userId]: {
            ...existing,
            status: "accepted",
            updatedAt: action.timestamp ?? existing.updatedAt,
          },
        },
      };
    }

    case "VOUCH_MEMBER": {
      const conn = state.connectionsByUserId[action.userId];
      if (!state.isAuthenticated || conn?.status !== "accepted") {
        return state;
      }
      if (state.vouchedUserIds.includes(action.userId)) {
        return state;
      }
      return {
        ...state,
        vouchedUserIds: [...state.vouchedUserIds, action.userId],
      };
    }

    case "BLOCK_HOUSEHOLD": {
      const blockedHouseholdIds = state.blockedHouseholdIds.includes(action.householdId)
        ? state.blockedHouseholdIds
        : [...state.blockedHouseholdIds, action.householdId];

      const nextConnections = { ...state.connectionsByUserId };
      const timestamp = action.timestamp ?? "1970-01-01T00:00:00.000Z";
      for (const memberId of action.memberUserIds) {
        const existing = nextConnections[memberId];
        nextConnections[memberId] = {
          status: "blocked",
          icebreakerText: existing?.icebreakerText ?? "",
          updatedAt: timestamp,
        };
      }

      return {
        ...state,
        blockedHouseholdIds,
        connectionsByUserId: nextConnections,
      };
    }

    case "REPORT_MEMBER": {
      if (!state.isAuthenticated || state.reportedUserIds.includes(action.userId)) {
        return state;
      }
      return {
        ...state,
        reportedUserIds: [...state.reportedUserIds, action.userId],
      };
    }

    case "RESET_FLOW": {
      return INITIAL_APP_FLOW_STATE;
    }
  }
}

export function serializeFlowSnapshot(state: AppFlowState): string {
  const payload: PersistedFlowSnapshot = {
    phase: state.phase,
    confirmedNeighborhood: state.confirmedNeighborhood,
    selectedOriginId: state.selectedOrigin?.id ?? null,
    pendingInviteCode: state.pendingInviteCode,
    isAuthenticated: state.isAuthenticated,
    hasCompletedPersonalization: state.hasCompletedPersonalization,
    personalization: state.personalization,
    filters: state.filters,
    isGhostMode: state.isGhostMode,
    blockedHouseholdIds: state.blockedHouseholdIds,
    vouchedUserIds: state.vouchedUserIds,
    reportedUserIds: state.reportedUserIds,
    connectionsByUserId: state.connectionsByUserId,
  };
  return JSON.stringify(payload);
}

export function parsePersistedFlowSnapshot(raw: string): Partial<AppFlowState> | null {
  try {
    const parsed = PersistedFlowSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }

    const data = parsed.data;
    const selectedOrigin = data.selectedOriginId
      ? (getGujaratLocationById(data.selectedOriginId) ?? null)
      : null;

    const repairedPhase = resolveValidatedPhase(data.phase, {
      confirmedNeighborhood: data.confirmedNeighborhood,
      selectedOrigin,
      isAuthenticated: data.isAuthenticated,
      hasCompletedPersonalization: data.hasCompletedPersonalization,
    });

    return {
      phase: repairedPhase,
      confirmedNeighborhood: data.confirmedNeighborhood,
      selectedOrigin,
      pendingInviteCode: data.pendingInviteCode,
      isAuthenticated: data.isAuthenticated,
      hasCompletedPersonalization: data.hasCompletedPersonalization,
      personalization: data.personalization,
      filters: data.filters,
      isGhostMode: data.isGhostMode,
      blockedHouseholdIds: data.blockedHouseholdIds,
      vouchedUserIds: data.vouchedUserIds,
      reportedUserIds: data.reportedUserIds,
      ...(data.connectionsByUserId !== undefined
        ? { connectionsByUserId: data.connectionsByUserId }
        : {}),
    };
  } catch {
    return null;
  }
}
