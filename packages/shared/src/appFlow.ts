import { getGujaratLocationById, type GujaratLocation } from "./locations";
import {
  DEFAULT_DISCOVERY_FILTERS,
  PersistedFlowSnapshotSchema,
  type AppFlowPhase,
  type ConfirmedNeighborhood,
  type DiscoveryFilters,
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
};

export type AppFlowAction =
  | { type: "HYDRATE_STATE"; payload: Partial<AppFlowState> }
  | { type: "APPLY_ORIGIN_DEEP_LINK"; origin: GujaratLocation }
  | { type: "SET_PENDING_INVITE_CODE"; code: string }
  | { type: "CLEAR_PENDING_INVITE_CODE" }
  | { type: "CONFIRM_NEIGHBORHOOD"; neighborhood: ConfirmedNeighborhood }
  | { type: "SELECT_ORIGIN"; origin: GujaratLocation }
  | { type: "SET_PENDING_INTENT"; intent: PendingAuthIntent }
  | { type: "COMPLETE_MOCK_AUTH" }
  | { type: "COMPLETE_PERSONALIZATION"; personalization?: PersonalizationDraft }
  | { type: "CLEAR_PENDING_INTENT" }
  | { type: "UPDATE_FILTERS"; filters: Partial<DiscoveryFilters> }
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
  if (requestedPhase === "discovery" || prereqs.hasCompletedPersonalization) {
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
      // Never skip San Antonio GPS confirmation, even with ?origin_id deep link;
      // once confirmed, jump straight to blurred_preview if origin is already pre-filled.
      const nextPhase: AppFlowPhase = state.selectedOrigin ? "blurred_preview" : "select_hometown";
      return {
        ...state,
        confirmedNeighborhood: action.neighborhood,
        phase: nextPhase,
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

    case "SET_PENDING_INTENT": {
      return {
        ...state,
        pendingIntent: action.intent,
      };
    }

    case "COMPLETE_MOCK_AUTH": {
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
    };
  } catch {
    return null;
  }
}
