import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import {
  ActivateAccountResponseSchema,
  OtpCodeSchema,
  UserStatusRowSchema,
  normalizePhoneE164,
  type ActivationStatus,
} from "@second-home/shared";
import type { Session, User } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { getSupabaseClient } from "./supabase";

export type { ActivationStatus };

let googleConfigured = false;

function ensureGoogleConfigured() {
  if (googleConfigured) {
    return;
  }
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!webClientId) {
    throw new Error(
      "Google Sign-In is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in your environment.",
    );
  }
  GoogleSignin.configure({
    webClientId,
    ...(iosClientId ? { iosClientId } : {}),
  });
  googleConfigured = true;
}

function requireSupabase() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return client;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") {
    return false;
  }
  return AppleAuthentication.isAvailableAsync();
}

export async function signInWithApple(): Promise<{ session: Session; user: User }> {
  if (Platform.OS !== "ios") {
    throw new Error("Sign in with Apple is only available on iOS devices.");
  }

  const supabase = requireSupabase();
  const rawNonceBytes = await Crypto.getRandomBytesAsync(16);
  const rawNonce = bytesToHex(rawNonceBytes);
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error("Apple Sign-In did not return an identity token.");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error || !data.session || !data.user) {
    throw new Error(error?.message ?? "Unable to sign in with Apple.");
  }

  // Apple only returns fullName on the user's very first sign-in.
  const givenName = credential.fullName?.givenName?.trim();
  if (givenName) {
    const fullName = [givenName, credential.fullName?.familyName?.trim()].filter(Boolean).join(" ");
    await supabase.auth.updateUser({
      data: {
        first_name: givenName,
        full_name: fullName,
      },
    });
  }

  return { session: data.session, user: data.user };
}

export async function signInWithGoogle(): Promise<{ session: Session; user: User }> {
  const supabase = requireSupabase();
  ensureGoogleConfigured();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type === "cancelled") {
      throw new Error("ERR_REQUEST_CANCELED");
    }

    const idToken = response.data?.idToken;
    if (!idToken) {
      throw new Error("Google Sign-In did not return an ID token.");
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error || !data.session || !data.user) {
      throw new Error(error?.message ?? "Unable to sign in with Google.");
    }

    return { session: data.session, user: data.user };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error("ERR_REQUEST_CANCELED");
    }
    throw err;
  }
}

export function isAuthCanceledError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_REQUEST_CANCELED"
  ) {
    return true;
  }
  return error instanceof Error && error.message === "ERR_REQUEST_CANCELED";
}

export async function sendTwilioPhoneOtp(rawPhone: string): Promise<string> {
  const normalized = normalizePhoneE164(rawPhone);
  if (!normalized) {
    throw new Error("Enter a valid phone number (e.g. +1 210 555 0199).");
  }

  const supabase = requireSupabase();
  const { error } = await supabase.auth.updateUser({ phone: normalized });
  if (error) {
    throw new Error(error.message);
  }

  return normalized;
}

async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error.trim().length > 0) {
          return body.error;
        }
      } catch {
        // Fall back to SDK error message
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function activateVerifiedAccount(): Promise<{
  status: ActivationStatus;
  phoneVerified: true;
}> {
  const supabase = requireSupabase();
  const { data: activationData, error: activationError } =
    await supabase.functions.invoke("activate-account");

  if (activationError) {
    const message = await extractFunctionErrorMessage(
      activationError,
      "Unable to activate your account.",
    );
    throw new Error(message);
  }

  const parsedResponse = ActivateAccountResponseSchema.safeParse(activationData);
  if (!parsedResponse.success) {
    throw new Error("Unexpected response while activating your account.");
  }

  return parsedResponse.data;
}

export async function verifyTwilioPhoneOtp(params: {
  rawPhone: string;
  otpCode: string;
}): Promise<User> {
  const normalized = normalizePhoneE164(params.rawPhone);
  if (!normalized) {
    throw new Error("Enter a valid phone number (e.g. +1 210 555 0199).");
  }

  const parsedOtp = OtpCodeSchema.safeParse(params.otpCode);
  if (!parsedOtp.success) {
    throw new Error("Enter the 6-digit SMS verification code.");
  }

  const supabase = requireSupabase();
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    phone: normalized,
    token: parsedOtp.data,
    type: "phone_change",
  });

  if (verifyError || !verifyData.user) {
    throw new Error(verifyError?.message ?? "Invalid or expired verification code.");
  }

  return verifyData.user;
}

export async function fetchCurrentAccountStatus(userId: string): Promise<ActivationStatus | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  // Explicit safe column list — never use select("*") due to column-level grants.
  const { data, error } = await supabase
    .from("users")
    .select("id, status")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return error ? null : "pending_household";
  }

  const parsed = UserStatusRowSchema.safeParse(data);
  return parsed.success ? parsed.data.status : null;
}

export async function signOutAuthProviders(): Promise<void> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" }).catch((err) => ({
      error: err,
    }));
    if (error) {
      // Local storage is already cleared by scope: "local" when possible; ignore reset errors.
    }
  }
  await GoogleSignin.signOut().catch(() => {});
}
