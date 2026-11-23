import { parseInviteCodeParam } from "@second-home/shared";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAppFlow } from "@/state/AppFlowContext";

/**
 * Deep-link intake for `/join-household?code=<invite_code>`.
 * Waits for AsyncStorage hydration so existing user state is preserved, then
 * persists the invite code and routes straight to `/` for live San Antonio GPS check.
 */
export default function JoinHouseholdRedirect() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const { state, dispatch, isHydrated } = useAppFlow();
  const validCode = parseInviteCodeParam(params.code);

  useEffect(() => {
    if (!isHydrated || !validCode || state.pendingInviteCode === validCode) {
      return;
    }
    dispatch({ type: "SET_PENDING_INVITE_CODE", code: validCode });
  }, [dispatch, isHydrated, state.pendingInviteCode, validCode]);

  if (!isHydrated || (validCode !== null && state.pendingInviteCode !== validCode)) {
    return null;
  }

  return <Redirect href="/" />;
}
