import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  activateVerifiedAccount,
  isAppleSignInAvailable,
  isAuthCanceledError,
  sendTwilioPhoneOtp,
  signInWithApple,
  signInWithGoogle,
  verifyTwilioPhoneOtp,
} from "@/lib/auth";
import { dismissOrReturnHome } from "@/lib/navigation";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAppFlow } from "@/state/AppFlowContext";

type AuthStep = "provider" | "phone_otp";

export default function SoftAuthSheet() {
  const router = useRouter();
  const { state, authSession, completeAuth } = useAppFlow();

  const [manualStep, setManualStep] = useState<AuthStep | null>(null);
  const hasUnverifiedSession = Boolean(authSession?.user && !authSession.user.phone_confirmed_at);
  const step: AuthStep = manualStep ?? (hasUnverifiedSession ? "phone_otp" : "provider");
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === "ios");
  const [loadingAction, setLoadingAction] = useState<
    "apple" | "google" | "send_otp" | "verify_otp" | null
  >(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Kept strictly in ephemeral local state — never persisted in AppFlowState/AsyncStorage
  const [phoneInput, setPhoneInput] = useState("");
  const [sentPhoneE164, setSentPhoneE164] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isAppleSignInAvailable().then((available) => {
      if (!cancelled) {
        setAppleAvailable(available);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAppleSignIn() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAuthError(null);
    setLoadingAction("apple");
    try {
      const { user } = await signInWithApple();
      if (user.phone_confirmed_at) {
        const result = await activateVerifiedAccount();
        completeAuth(result.status);
        dismissOrReturnHome(router);
        return;
      }
      setManualStep("phone_otp");
    } catch (error) {
      if (!isAuthCanceledError(error)) {
        setAuthError(error instanceof Error ? error.message : "Unable to sign in with Apple.");
      }
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleGoogleSignIn() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAuthError(null);
    setLoadingAction("google");
    try {
      const { user } = await signInWithGoogle();
      if (user.phone_confirmed_at) {
        const result = await activateVerifiedAccount();
        completeAuth(result.status);
        dismissOrReturnHome(router);
        return;
      }
      setManualStep("phone_otp");
    } catch (error) {
      if (!isAuthCanceledError(error)) {
        setAuthError(error instanceof Error ? error.message : "Unable to sign in with Google.");
      }
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSendOtp() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAuthError(null);
    setLoadingAction("send_otp");
    try {
      const normalized = await sendTwilioPhoneOtp(phoneInput);
      setSentPhoneE164(normalized);
      setOtpCode("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to send verification code.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleVerifyOtp() {
    setAuthError(null);
    setLoadingAction("verify_otp");
    try {
      if (!otpVerified) {
        await verifyTwilioPhoneOtp({
          rawPhone: sentPhoneE164 ?? phoneInput,
          otpCode,
        });
        setOtpVerified(true);
      }
      const result = await activateVerifiedAccount();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      completeAuth(result.status);
      dismissOrReturnHome(router);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to verify SMS code.");
    } finally {
      setLoadingAction(null);
    }
  }

  const isBusy = loadingAction !== null;
  const supabaseReady = isSupabaseConfigured();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>VERIFIED COMMUNITY ACCESS</Text>
        <Text style={styles.title}>
          {step === "phone_otp" ? "Verify your WhatsApp number" : "Unlock nearby neighbors"}
        </Text>
        <Text style={styles.body}>
          {step === "phone_otp"
            ? "SMS OTP lets neighbors connect with you via 1-tap WhatsApp handoff. Your number stays private until you mutually accept."
            : "Sign in in 1 tap to unlock full household profiles, send introductions, and connect on WhatsApp."}
        </Text>

        {!supabaseReady ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Supabase Auth environment variables are not configured in this build.
            </Text>
          </View>
        ) : null}

        {state.pendingInviteCode ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Joining household invite: {state.pendingInviteCode}
            </Text>
          </View>
        ) : null}

        {step === "provider" ? (
          <View style={styles.actions}>
            {appleAvailable ? (
              <Pressable
                style={[styles.appleButton, isBusy && styles.buttonDisabled]}
                disabled={isBusy}
                onPress={() => void handleAppleSignIn()}
              >
                {loadingAction === "apple" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="logo-apple" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.appleButtonText}>Continue with Apple</Text>
              </Pressable>
            ) : null}

            <Pressable
              style={[styles.googleButton, isBusy && styles.buttonDisabled]}
              disabled={isBusy}
              onPress={() => void handleGoogleSignIn()}
            >
              {loadingAction === "google" ? (
                <ActivityIndicator size="small" color="#0F172A" />
              ) : (
                <Ionicons name="logo-google" size={16} color="#0F172A" />
              )}
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>

            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

            <Pressable
              style={styles.secondaryButton}
              disabled={isBusy}
              onPress={() => dismissOrReturnHome(router)}
            >
              <Text style={styles.secondaryButtonText}>Back to Map Preview</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.otpBox}>
            <Text style={styles.inputLabel}>Mobile Number (for WhatsApp)</Text>
            <TextInput
              style={styles.input}
              value={phoneInput}
              onChangeText={(txt) => {
                setPhoneInput(txt);
                setAuthError(null);
                setOtpVerified(false);
                if (sentPhoneE164) {
                  setSentPhoneE164(null);
                }
              }}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              editable={!isBusy}
              placeholder="+1 (210) 555-0199"
              placeholderTextColor="#94A3B8"
            />

            {!sentPhoneE164 ? (
              <Pressable
                style={[styles.primaryButton, isBusy && styles.buttonDisabled]}
                disabled={isBusy}
                onPress={() => void handleSendOtp()}
              >
                {loadingAction === "send_otp" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send SMS Code</Text>
                )}
              </Pressable>
            ) : (
              <>
                <View style={styles.otpHeader}>
                  <Text style={styles.inputLabel}>6-Digit SMS Code</Text>
                  <Pressable disabled={isBusy} onPress={() => void handleSendOtp()}>
                    <Text style={styles.resendLink}>
                      {loadingAction === "send_otp" ? "Sending..." : "Resend Code"}
                    </Text>
                  </Pressable>
                </View>
                <TextInput
                  style={styles.input}
                  value={otpCode}
                  onChangeText={(txt) => {
                    setOtpCode(txt.replace(/\D/g, "").slice(0, 6));
                    setAuthError(null);
                  }}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={6}
                  editable={!isBusy}
                  placeholder="6-digit code"
                  placeholderTextColor="#94A3B8"
                />

                <Pressable
                  style={[styles.primaryButton, isBusy && styles.buttonDisabled]}
                  disabled={isBusy}
                  onPress={() => void handleVerifyOtp()}
                >
                  {loadingAction === "verify_otp" ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {otpVerified ? "Retry Activation" : "Verify & Unlock"}
                    </Text>
                  )}
                </Pressable>
              </>
            )}

            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

            <Pressable
              style={styles.secondaryButton}
              disabled={isBusy}
              onPress={() => {
                setAuthError(null);
                setSentPhoneE164(null);
                setOtpCode("");
                setManualStep("provider");
              }}
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 36,
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0F766E",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0F172A",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  banner: {
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
  },
  actions: {
    gap: 10,
    marginTop: 8,
  },
  appleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0F172A",
    paddingVertical: 14,
    borderRadius: 14,
  },
  appleButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  googleButtonText: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "600",
  },
  otpBox: {
    gap: 8,
    marginTop: 4,
  },
  otpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  resendLink: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F766E",
  },
  input: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    fontSize: 15,
    color: "#0F172A",
  },
  errorText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#B45309",
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: "#0F766E",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#F1F5F9",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
