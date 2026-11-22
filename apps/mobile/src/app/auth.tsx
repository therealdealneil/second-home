import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dismissOrReturnHome } from "@/lib/navigation";
import { useAppFlow } from "@/state/AppFlowContext";

export default function SoftAuthSheet() {
  const router = useRouter();
  const { state, completeMockAuth } = useAppFlow();

  function handleContinueMockAuth() {
    completeMockAuth();
    dismissOrReturnHome(router);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SOFT AUTH WALL · STEP 2.1 SHELL</Text>
      <Text style={styles.title}>Unlock nearby neighbors</Text>
      <Text style={styles.body}>
        Continue with 1-tap Apple/Google Sign-In + SMS OTP (mocked in Step 2) to view full household
        profiles and send introductions.
      </Text>

      {state.pendingInviteCode ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Joining household invite: {state.pendingInviteCode}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={handleContinueMockAuth}>
          <Text style={styles.primaryButtonText}>Continue (Mock Auth & OTP)</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => dismissOrReturnHome(router)}>
          <Text style={styles.secondaryButtonText}>Back to Map Preview</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: 24,
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
  primaryButton: {
    backgroundColor: "#0F766E",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
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
