import { Ionicons } from "@expo/vector-icons";
import {
  AGE_BRACKETS,
  AGE_BRACKET_LABELS,
  LIFE_STAGES,
  LIFE_STAGE_LABELS,
  ONBOARDING_INTERESTS,
  buildHouseholdInviteWhatsappUrl,
  type AgeBracket,
  type LifeStage,
  type OnboardingInterest,
  type PersonalizationDraft,
} from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { openWhatsappUrl } from "@/lib/whatsappHandoff";

type PersonalizeCardProps = {
  initialDraft: PersonalizationDraft;
  pendingInviteCode: string | null;
  onComplete: (draft?: PersonalizationDraft) => void;
};

export function PersonalizeCard({
  initialDraft,
  pendingInviteCode,
  onComplete,
}: PersonalizeCardProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [ageBracket, setAgeBracket] = useState<AgeBracket | null>(initialDraft.ageBracket);
  const [lifeStage, setLifeStage] = useState<LifeStage | null>(initialDraft.lifeStage);
  const [interests, setInterests] = useState<OnboardingInterest[]>(initialDraft.interests);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  function toggleInterest(item: OnboardingInterest) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInterests((prev) => {
      if (prev.includes(item)) {
        return prev.filter((x) => x !== item);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), item];
      }
      return [...prev, item];
    });
  }

  async function handleInviteFamily() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = buildHouseholdInviteWhatsappUrl("mockinv0001");
    const opened = await openWhatsappUrl(url);
    setInviteStatus(
      opened
        ? "WhatsApp invite opened."
        : "WhatsApp unavailable on this simulator — invite link ready: /join-household?code=mockinv0001",
    );
  }

  return (
    <View style={[styles.card, { maxHeight: Math.max(320, Math.round(windowHeight * 0.62)) }]}>
      <Text style={styles.eyebrow}>3-SECOND PERSONALIZATION · SKIPPABLE</Text>
      <Text style={styles.title}>Help neighbors know your household</Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {pendingInviteCode ? (
          <View style={styles.linkedBanner}>
            <Ionicons name="people" size={14} color="#0F766E" />
            <Text style={styles.linkedBannerText}>
              Linked to household invite {pendingInviteCode}
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Age Bracket</Text>
        <View style={styles.pillsRow}>
          {AGE_BRACKETS.map((value) => {
            const active = ageBracket === value;
            return (
              <Pressable
                key={value}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setAgeBracket((prev) => (prev === value ? null : value));
                }}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {AGE_BRACKET_LABELS[value]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Life Stage</Text>
        <View style={styles.pillsRow}>
          {LIFE_STAGES.map((value) => {
            const active = lifeStage === value;
            return (
              <Pressable
                key={value}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setLifeStage((prev) => (prev === value ? null : value));
                }}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {LIFE_STAGE_LABELS[value]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Interests (up to 3)</Text>
        <View style={styles.pillsRow}>
          {ONBOARDING_INTERESTS.map((value) => {
            const active = interests.includes(value);
            return (
              <Pressable
                key={value}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => toggleInterest(value)}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{value}</Text>
              </Pressable>
            );
          })}
        </View>

        {!pendingInviteCode ? (
          <Pressable style={styles.whatsappInviteButton} onPress={() => void handleInviteFamily()}>
            <Ionicons name="logo-whatsapp" size={16} color="#15803D" />
            <Text style={styles.whatsappInviteText}>Add Spouse / Family in Your Home</Text>
          </Pressable>
        ) : null}

        {inviteStatus ? <Text style={styles.inviteStatus}>{inviteStatus}</Text> : null}
      </ScrollView>

      <View style={styles.actionsRow}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onComplete({ ageBracket, lifeStage, interests });
          }}
        >
          <Text style={styles.primaryButtonText}>Save & Explore Map</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => onComplete()}>
          <Text style={styles.secondaryButtonText}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    borderRadius: 22,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0F766E",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  scrollContent: {
    gap: 8,
    paddingBottom: 4,
  },
  linkedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0FDFA",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  linkedBannerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F766E",
  },
  sectionLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  pillActive: {
    backgroundColor: "#0F766E",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  pillTextActive: {
    color: "#FFFFFF",
  },
  whatsappInviteButton: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#DCFCE7",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  whatsappInviteText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#15803D",
  },
  inviteStatus: {
    fontSize: 11,
    color: "#475569",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: "#0F766E",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "600",
  },
});
