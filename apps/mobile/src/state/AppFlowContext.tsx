import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  INITIAL_APP_FLOW_STATE,
  appFlowReducer,
  isPermittedAccountStatus,
  parsePersistedFlowSnapshot,
  serializeFlowSnapshot,
  type AppFlowAction,
  type AppFlowState,
  type ConfirmedNeighborhood,
  type DiscoveryFilters,
  type MapRegion,
  type PendingAuthIntent,
  type PersonalizationDraft,
  type ReportReasonCode,
} from "@second-home/shared";
import type { Session } from "@supabase/supabase-js";
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
import { fetchCurrentAccountStatus, signOutAuthProviders, type ActivationStatus } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

const STORAGE_KEY = "second_home.app_flow.v1";

type ScopedAccountStatus = {
  userId: string;
  status: ActivationStatus | null;
};

type AppFlowContextValue = {
  state: AppFlowState;
  isHydrated: boolean;
  authSession: Session | null;
  accountStatus: ActivationStatus | null;
  dispatch: React.Dispatch<AppFlowAction>;
  confirmNeighborhood: (neighborhood: ConfirmedNeighborhood) => void;
  openAuthForIntent: (intent: PendingAuthIntent) => void;
  completeAuth: (status?: ActivationStatus, userId?: string) => void;
  completePersonalization: (draft?: PersonalizationDraft) => void;
  updateFilters: (filters: Partial<DiscoveryFilters>) => void;
  setMapRegion: (region: MapRegion) => void;
  toggleMapRegion: () => void;
  toggleGhostMode: (enabled?: boolean) => void;
  sendConnectionRequest: (params: {
    userId: string;
    householdId: string;
    icebreakerText: string;
  }) => void;
  acceptMockConnection: (userId: string) => void;
  vouchMember: (userId: string) => void;
  blockHousehold: (params: { householdId: string; memberUserIds: readonly string[] }) => void;
  reportMember: (userId: string, reasonCode: ReportReasonCode) => void;
  resetPrototypeFlow: () => void;
};

const AppFlowContext = createContext<AppFlowContextValue | null>(null);

export function AppFlowProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(appFlowReducer, INITIAL_APP_FLOW_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [hasResolvedSession, setHasResolvedSession] = useState(() => getSupabaseClient() === null);
  const [scopedAccountStatus, setScopedAccountStatus] = useState<ScopedAccountStatus | null>(null);
  const userMutatedBeforeHydrationRef = useRef(false);
  const authSyncGenerationRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);

  const accountStatus: ActivationStatus | null =
    authSession?.user && scopedAccountStatus?.userId === authSession.user.id
      ? scopedAccountStatus.status
      : null;

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    let cancelled = false;

    async function syncSession(session: Session | null) {
      const generation = ++authSyncGenerationRef.current;
      if (cancelled) {
        return;
      }
      setAuthSession(session);
      setHasResolvedSession(true);
      currentUserIdRef.current = session?.user?.id ?? null;
      if (!session?.user) {
        setScopedAccountStatus(null);
        return;
      }
      const sessionUserId = session.user.id;
      setScopedAccountStatus((prev) => (prev?.userId === sessionUserId ? prev : null));
      const nextStatus = await fetchCurrentAccountStatus(sessionUserId);
      if (!cancelled && generation === authSyncGenerationRef.current) {
        setScopedAccountStatus({ userId: sessionUserId, status: nextStatus });
      }
    }

    void supabase.auth.getSession().then(({ data }) => syncSession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !hasResolvedSession || !getSupabaseClient()) {
      return;
    }
    if (!authSession?.user) {
      dispatch({ type: "RECONCILE_AUTH_SESSION", isAuthenticated: false });
      return;
    }
    const currentUserStatus =
      scopedAccountStatus?.userId === authSession.user.id ? scopedAccountStatus.status : null;
    const isConfirmedAndPermitted =
      Boolean(authSession.user.phone_confirmed_at) && isPermittedAccountStatus(currentUserStatus);
    dispatch({ type: "RECONCILE_AUTH_SESSION", isAuthenticated: isConfirmedAndPermitted });
  }, [authSession, hasResolvedSession, isHydrated, scopedAccountStatus]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) {
          return;
        }
        if (userMutatedBeforeHydrationRef.current) {
          setCanPersist(true);
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
        setCanPersist(true);
      } catch {
        // Non-blocking hydration: keep map responsive without overwriting unread storage
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
    if (!isHydrated || !canPersist) {
      return;
    }
    void AsyncStorage.setItem(STORAGE_KEY, serializeFlowSnapshot(state)).catch(() => {
      // Ignore persistence failures in prototype mode
    });
  }, [canPersist, isHydrated, state]);

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

  const completeAuth = useCallback(
    (status?: ActivationStatus, userId?: string) => {
      if (userId && userId !== currentUserIdRef.current) {
        return;
      }
      if (status) {
        authSyncGenerationRef.current += 1;
        const resolvedUserId = userId ?? currentUserIdRef.current;
        if (resolvedUserId) {
          currentUserIdRef.current = resolvedUserId;
          setScopedAccountStatus({ userId: resolvedUserId, status });
        }
      }
      trackedDispatch({ type: "COMPLETE_AUTH" });
    },
    [trackedDispatch],
  );

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

  const setMapRegion = useCallback(
    (region: MapRegion) => {
      trackedDispatch({ type: "SET_MAP_REGION", region });
    },
    [trackedDispatch],
  );

  const toggleMapRegion = useCallback(() => {
    trackedDispatch({ type: "TOGGLE_MAP_REGION" });
  }, [trackedDispatch]);

  const toggleGhostMode = useCallback(
    (enabled?: boolean) => {
      trackedDispatch({ type: "TOGGLE_GHOST_MODE", enabled });
    },
    [trackedDispatch],
  );

  const sendConnectionRequest = useCallback(
    (params: { userId: string; householdId: string; icebreakerText: string }) => {
      trackedDispatch({
        type: "SEND_CONNECTION_REQUEST",
        ...params,
        timestamp: new Date().toISOString(),
      });
    },
    [trackedDispatch],
  );

  const acceptMockConnection = useCallback(
    (userId: string) => {
      trackedDispatch({
        type: "ACCEPT_MOCK_CONNECTION",
        userId,
        timestamp: new Date().toISOString(),
      });
    },
    [trackedDispatch],
  );

  const vouchMember = useCallback(
    (userId: string) => {
      trackedDispatch({ type: "VOUCH_MEMBER", userId });
    },
    [trackedDispatch],
  );

  const blockHousehold = useCallback(
    (params: { householdId: string; memberUserIds: readonly string[] }) => {
      trackedDispatch({
        type: "BLOCK_HOUSEHOLD",
        ...params,
        timestamp: new Date().toISOString(),
      });
    },
    [trackedDispatch],
  );

  const reportMember = useCallback(
    (userId: string, reasonCode: ReportReasonCode) => {
      trackedDispatch({ type: "REPORT_MEMBER", userId, reasonCode });
    },
    [trackedDispatch],
  );

  const resetPrototypeFlow = useCallback(() => {
    authSyncGenerationRef.current += 1;
    currentUserIdRef.current = null;
    setCanPersist(true);
    setAuthSession(null);
    setScopedAccountStatus(null);
    void signOutAuthProviders();
    trackedDispatch({ type: "RESET_FLOW" });
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, [trackedDispatch]);

  const value = useMemo<AppFlowContextValue>(
    () => ({
      state,
      isHydrated,
      authSession,
      accountStatus,
      dispatch: trackedDispatch,
      confirmNeighborhood,
      openAuthForIntent,
      completeAuth,
      completePersonalization,
      updateFilters,
      setMapRegion,
      toggleMapRegion,
      toggleGhostMode,
      sendConnectionRequest,
      acceptMockConnection,
      vouchMember,
      blockHousehold,
      reportMember,
      resetPrototypeFlow,
    }),
    [
      state,
      isHydrated,
      authSession,
      accountStatus,
      trackedDispatch,
      confirmNeighborhood,
      openAuthForIntent,
      completeAuth,
      completePersonalization,
      updateFilters,
      setMapRegion,
      toggleMapRegion,
      toggleGhostMode,
      sendConnectionRequest,
      acceptMockConnection,
      vouchMember,
      blockHousehold,
      reportMember,
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
