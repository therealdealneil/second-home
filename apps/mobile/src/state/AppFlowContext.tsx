import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  INITIAL_APP_FLOW_STATE,
  appFlowReducer,
  parsePersistedFlowSnapshot,
  serializeFlowSnapshot,
  type AppFlowAction,
  type AppFlowState,
  type ConfirmedNeighborhood,
  type DiscoveryFilters,
  type PendingAuthIntent,
  type PersonalizationDraft,
} from "@second-home/shared";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "second_home.app_flow.v1";

type AppFlowContextValue = {
  state: AppFlowState;
  isHydrated: boolean;
  dispatch: React.Dispatch<AppFlowAction>;
  confirmNeighborhood: (neighborhood: ConfirmedNeighborhood) => void;
  openAuthForIntent: (intent: PendingAuthIntent) => void;
  completeMockAuth: () => void;
  completePersonalization: (draft?: PersonalizationDraft) => void;
  updateFilters: (filters: Partial<DiscoveryFilters>) => void;
  resetPrototypeFlow: () => void;
};

const AppFlowContext = createContext<AppFlowContextValue | null>(null);

export function AppFlowProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(appFlowReducer, INITIAL_APP_FLOW_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const userMutatedBeforeHydrationRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled || userMutatedBeforeHydrationRef.current) {
          return;
        }
        if (raw) {
          const restored = parsePersistedFlowSnapshot(raw);
          if (restored) {
            dispatch({ type: "HYDRATE_STATE", payload: restored });
          } else {
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch {
        // Non-blocking hydration: ignore storage errors so map stays responsive
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const trackedDispatch = useCallback<React.Dispatch<AppFlowAction>>(
    (action) => {
      if (
        !isHydrated &&
        action.type !== "HYDRATE_STATE" &&
        action.type !== "APPLY_ORIGIN_DEEP_LINK" &&
        action.type !== "SET_PENDING_INVITE_CODE" &&
        action.type !== "SET_PENDING_INTENT"
      ) {
        userMutatedBeforeHydrationRef.current = true;
      }
      dispatch(action);
    },
    [isHydrated],
  );

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    void AsyncStorage.setItem(STORAGE_KEY, serializeFlowSnapshot(state)).catch(() => {
      // Ignore persistence failures in prototype mode
    });
  }, [isHydrated, state]);

  const confirmNeighborhood = useCallback(
    (neighborhood: ConfirmedNeighborhood) => {
      trackedDispatch({ type: "CONFIRM_NEIGHBORHOOD", neighborhood });
    },
    [trackedDispatch],
  );

  const openAuthForIntent = useCallback(
    (intent: PendingAuthIntent) => {
      trackedDispatch({ type: "SET_PENDING_INTENT", intent });
      router.push("/auth");
    },
    [router, trackedDispatch],
  );

  const completeMockAuth = useCallback(() => {
    trackedDispatch({ type: "COMPLETE_MOCK_AUTH" });
  }, [trackedDispatch]);

  const completePersonalization = useCallback(
    (draft?: PersonalizationDraft) => {
      trackedDispatch({ type: "COMPLETE_PERSONALIZATION", personalization: draft });
    },
    [trackedDispatch],
  );

  const updateFilters = useCallback(
    (filters: Partial<DiscoveryFilters>) => {
      trackedDispatch({ type: "UPDATE_FILTERS", filters });
    },
    [trackedDispatch],
  );

  const resetPrototypeFlow = useCallback(() => {
    trackedDispatch({ type: "RESET_FLOW" });
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, [trackedDispatch]);

  const value = useMemo<AppFlowContextValue>(
    () => ({
      state,
      isHydrated,
      dispatch: trackedDispatch,
      confirmNeighborhood,
      openAuthForIntent,
      completeMockAuth,
      completePersonalization,
      updateFilters,
      resetPrototypeFlow,
    }),
    [
      state,
      isHydrated,
      trackedDispatch,
      confirmNeighborhood,
      openAuthForIntent,
      completeMockAuth,
      completePersonalization,
      updateFilters,
      resetPrototypeFlow,
    ],
  );

  return <AppFlowContext.Provider value={value}>{children}</AppFlowContext.Provider>;
}

export function useAppFlow(): AppFlowContextValue {
  const ctx = useContext(AppFlowContext);
  if (!ctx) {
    throw new Error("useAppFlow must be used within an AppFlowProvider");
  }
  return ctx;
}
