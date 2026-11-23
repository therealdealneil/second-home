import { Ionicons } from "@expo/vector-icons";
import {
  WAITLIST_TARGET_METROS,
  validateWaitlistSubmission,
  type WaitlistMetro,
} from "@second-home/shared";
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

export default function MetroWaitlistSheet() {
  const router = useRouter();
  const [metro, setMetro] = useState<WaitlistMetro>("Austin, TX");
  const [customCity, setCustomCity] = useState("");
  // Kept strictly in ephemeral local state — never persisted in AsyncStorage
  const [contact, setContact] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedCity, setSubmittedCity] = useState<string | null>(null);

  function handleSubmit() {
    const validated = validateWaitlistSubmission({
      metro,
      customCity: metro === "Other" ? customCity : undefined,
      contact,
    });
    if (!validated.ok) {
      setErrorMessage(validated.error);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setErrorMessage(null);
    setSubmittedCity(validated.data.resolvedCity);
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
        <Text style={styles.eyebrow}>METRO EXPANSION WAITLIST · F-17</Text>
        <Text style={styles.title}>We&apos;re currently live in San Antonio!</Text>
        <Text style={styles.body}>
          Your GPS appears to be outside the Greater San Antonio launch corridor. Tell us which
          metro to unlock next and we&apos;ll notify you when your corridor opens.
        </Text>

        {submittedCity ? (
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={20} color="#0F766E" />
            <View style={styles.successTextCol}>
              <Text style={styles.successTitle}>You&apos;re on the list for {submittedCity}</Text>
              <Text style={styles.successBody}>
                Prototype mode: we&apos;ll wire waitlist submissions to Supabase in Step 3.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={styles.label}>Next Corridor City</Text>
            <View accessibilityRole="radiogroup" style={styles.pillsRow}>
              {WAITLIST_TARGET_METROS.map((option) => {
                const selected = metro === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMetro(option);
                      setErrorMessage(null);
                    }}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {metro === "Other" ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Your City</Text>
                <TextInput
                  accessibilityLabel="Your City"
                  style={styles.input}
                  value={customCity}
                  onChangeText={(txt) => {
                    setCustomCity(txt);
                    setErrorMessage(null);
                  }}
                  placeholder="e.g., Sugar Land, TX"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="words"
                />
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email or Mobile Number</Text>
              <TextInput
                accessibilityLabel="Email or Mobile Number"
                style={styles.input}
                value={contact}
                onChangeText={(txt) => {
                  setContact(txt);
                  setErrorMessage(null);
                }}
                placeholder="you@example.com or +1 (512) 555-0199"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            {errorMessage ? (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {errorMessage}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={handleSubmit}
            >
              <Text style={styles.primaryButtonText}>Join Waitlist</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => dismissOrReturnHome(router)}
        >
          <Text style={styles.secondaryButtonText}>Back to San Antonio Map</Text>
        </Pressable>
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
  form: {
    gap: 10,
    marginTop: 4,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  pillSelected: {
    backgroundColor: "#0F766E",
    borderColor: "#0F766E",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  pillTextSelected: {
    color: "#FFFFFF",
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
  successCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#F0FDFA",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#CCFBF1",
    marginTop: 4,
  },
  successTextCol: {
    flex: 1,
    gap: 4,
  },
  successTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#115E59",
  },
  successBody: {
    fontSize: 13,
    lineHeight: 18,
    color: "#0F766E",
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
