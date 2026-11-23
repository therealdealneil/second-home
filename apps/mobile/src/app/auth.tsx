import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { dismissOrReturnHome } from "@/lib/navigation";
import { useAppFlow } from "@/state/AppFlowContext";

export default function SoftAuthSheet() {
  const router = useRouter();
  const { state, completeMockAuth } = useAppFlow();
  const [provider, setProvider] = useState<"apple" | "google" | null>(null);
  // Kept strictly in ephemeral local state — never persisted in AppFlowState/AsyncStorage
  const [phoneInput, setPhoneInput] = useState("+1 (210) 555-0199");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);

  function handleSelectProvider(selected: "apple" | "google") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProvider(selected);
    setOtpError(null);
  }

  function handleVerifyOtp() {
    const digits = phoneInput.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      setOtpError("Enter a valid 10-15 digit phone number for WhatsApp handoffs.");
      return;
    }
    if (otpCode.trim().length !== 6) {
      setOtpError("Enter the 6-digit SMS code (demo: 123456).");
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    completeMockAuth();
    dismissOrReturnHome(router);
  }

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
        <Text style={styles.eyebrow}>SOFT AUTH WALL · PROTOTYPE</Text>
        <Text style={styles.title}>
          {provider ? "Verify your WhatsApp number" : "Unlock nearby neighbors"}
        </Text>
        <Text style={styles.body}>
          {provider
            ? "SMS OTP lets neighbors connect with you via 1-tap WhatsApp handoff. Your number stays private until you mutually accept."
            : "Sign in in 1 tap to unlock full household profiles, send introductions, and connect on WhatsApp."}
        </Text>

        {state.pendingInviteCode ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Joining household invite: {state.pendingInviteCode}
            </Text>
          </View>
        ) : null}

        {!provider ? (
          <View style={styles.actions}>
            <Pressable style={styles.appleButton} onPress={() => handleSelectProvider("apple")}>
              <Ionicons name="logo-apple" size={18} color="#FFFFFF" />
              <Text style={styles.appleButtonText}>Continue with Apple</Text>
            </Pressable>
            <Pressable style={styles.googleButton} onPress={() => handleSelectProvider("google")}>
              <Ionicons name="logo-google" size={16} color="#0F172A" />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => dismissOrReturnHome(router)}>
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
                setOtpError(null);
              }}
              keyboardType="phone-pad"
              placeholder="+1 (210) 555-0199"
              placeholderTextColor="#94A3B8"
            />

            <View style={styles.otpHeader}>
              <Text style={styles.inputLabel}>6-Digit SMS Code</Text>
              <Pressable
                onPress={() => {
                  setOtpCode("123456");
                  setOtpError(null);
                }}
              >
                <Text style={styles.demoFill}>Fill Demo (123456)</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={otpCode}
              onChangeText={(txt) => {
                setOtpCode(txt.replace(/\D/g, "").slice(0, 6));
                setOtpError(null);
              }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
              placeholderTextColor="#94A3B8"
            />

            {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}

            <Pressable style={styles.primaryButton} onPress={handleVerifyOtp}>
              <Text style={styles.primaryButtonText}>Verify & Unlock</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setProvider(null)}>
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
  demoFill: {
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
});
