import { Ionicons } from "@expo/vector-icons";
import {
  AGE_BRACKET_LABELS,
  ICEBREAKER_MAX_LENGTH,
  LIFE_STAGE_LABELS,
  METERS_PER_MILE,
  REPORT_REASON_OPTIONS,
  buildIcebreakerPresets,
  haversineDistanceMeters,
  parseHouseholdIdParam,
  validateIcebreaker,
  type PublicHouseholdMember,
  type ReportReasonCode,
} from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getMockHouseholdById } from "@/data/mockHouseholds";
import { dismissOrReturnHome } from "@/lib/navigation";
import { getMockWhatsappHandoffLink, openWhatsappUrl } from "@/lib/whatsappHandoff";
import { useAppFlow } from "@/state/AppFlowContext";

export default function HouseholdDrawerSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const {
    state,
    isHydrated,
    sendConnectionRequest,
    acceptMockConnection,
    vouchMember,
    blockHousehold,
    reportMember,
  } = useAppFlow();

  const householdId = parseHouseholdIdParam(params.id);
  const household = householdId ? getMockHouseholdById(householdId) : undefined;

  const [composingMemberId, setComposingMemberId] = useState<string | null>(null);
  const [icebreakerDraft, setIcebreakerDraft] = useState("");
  const [icebreakerError, setIcebreakerError] = useState<string | null>(null);
  const [whatsappFallbackNotice, setWhatsappFallbackNotice] = useState<string | null>(null);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);

  if (!isHydrated) {
    return null;
  }

  // Never allow direct deep links into /household/[id] to bypass the soft auth wall.
  if (!state.isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!household || state.blockedHouseholdIds.includes(household.householdId)) {
    return (
      <View style={styles.container}>
        <Text style={styles.eyebrow}>HOUSEHOLD DRAWER</Text>
        <Text style={styles.title}>
          {household ? "Household blocked" : "Household unavailable"}
        </Text>
        <Text style={styles.body}>
          {household
            ? "You blocked this household. It is hidden from your map and all WhatsApp handoffs are revoked."
            : "This household could not be found."}
        </Text>
        <Pressable style={styles.secondaryButton} onPress={() => dismissOrReturnHome(router)}>
          <Text style={styles.secondaryButtonText}>Back to Map</Text>
        </Pressable>
      </View>
    );
  }

  const distanceMiles = state.confirmedNeighborhood
    ? haversineDistanceMeters(state.confirmedNeighborhood.fuzzedCenter, {
        lat: household.publicLat,
        lng: household.publicLng,
      }) / METERS_PER_MILE
    : null;

  function openComposer(member: PublicHouseholdMember) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setComposingMemberId((prev) => (prev === member.userId ? null : member.userId));
    setIcebreakerDraft("");
    setIcebreakerError(null);
  }

  function handleSendIcebreaker(member: PublicHouseholdMember, rawText: string) {
    const validated = validateIcebreaker(rawText);
    if (!validated.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setIcebreakerError(validated.error);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    sendConnectionRequest({
      userId: member.userId,
      householdId: household!.householdId,
      icebreakerText: validated.text,
    });
    setComposingMemberId(null);
    setIcebreakerDraft("");
    setIcebreakerError(null);
  }

  async function handleOpenWhatsapp(member: PublicHouseholdMember) {
    const url = getMockWhatsappHandoffLink({
      member,
      connectionStatus: state.connectionsByUserId[member.userId]?.status,
    });
    if (!url) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const opened = await openWhatsappUrl(url);
    if (!opened) {
      setWhatsappFallbackNotice(
        `WhatsApp is unavailable in this simulator. Handoff link verified for ${member.firstName}.`,
      );
    }
  }

  function handleReport(memberId: string, reasonCode: ReportReasonCode) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    reportMember(memberId, reasonCode);
    setReportTargetId(null);
  }

  function confirmBlockHousehold() {
    Alert.alert(
      `Block ${household!.displayLabel}?`,
      "This immediately hides their household pin from your map and revokes WhatsApp handoffs.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            blockHousehold({
              householdId: household!.householdId,
              memberUserIds: household!.members.map((m) => m.userId),
            });
            dismissOrReturnHome(router);
          },
        },
      ],
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <View style={styles.headerBadges}>
            <View style={styles.lifeStageBadge}>
              <Text style={styles.lifeStageBadgeText}>
                {LIFE_STAGE_LABELS[household.lifeStage]}
              </Text>
            </View>
            {household.isVerifiedLocal ? (
              <View style={styles.verifiedBadge}>
                <Ionicons name="shield-checkmark" size={12} color="#0F766E" />
                <Text style={styles.verifiedBadgeText}>Verified Local</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.title}>{household.displayLabel}</Text>
          <Text style={styles.areaText}>
            Near {household.neighborhoodName}
            {distanceMiles !== null ? ` (~${distanceMiles.toFixed(1)} mi away)` : ""}
          </Text>
        </View>

        {whatsappFallbackNotice ? (
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeText}>{whatsappFallbackNotice}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionHeading}>
          Linked Household Members ({household.members.length})
        </Text>

        {household.members.map((member) => {
          const connection = state.connectionsByUserId[member.userId];
          const hasVouched = state.vouchedUserIds.includes(member.userId);
          const hasReported = state.reportedUserIds.includes(member.userId);
          const displayVouchCount = member.vouchCount + (hasVouched ? 1 : 0);
          const sharedInterests = member.interests.filter((i) =>
            state.personalization.interests.some((mine) => mine === i),
          );
          const presets = buildIcebreakerPresets({
            firstName: member.firstName,
            hometownName: member.hometownName,
            neighborhoodName: household.neighborhoodName,
            sharedInterests,
          });
          const isComposing = composingMemberId === member.userId;

          return (
            <View key={member.userId} style={styles.memberCard}>
              <View style={styles.memberTopRow}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarInitial}>
                    {member.firstName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>

                <View style={styles.memberInfoCol}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{member.firstName}</Text>
                    {member.ageBracket ? (
                      <View style={styles.agePill}>
                        <Text style={styles.agePillText}>
                          {AGE_BRACKET_LABELS[member.ageBracket]}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.hometownText}>{member.hometownName}</Text>
                  <View style={styles.vouchRow}>
                    <Ionicons name="ribbon" size={12} color="#B45309" />
                    <Text style={styles.vouchText}>
                      Vouched by {displayVouchCount} neighbor{displayVouchCount !== 1 ? "s" : ""}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() =>
                    setReportTargetId((prev) => (prev === member.userId ? null : member.userId))
                  }
                  accessibilityLabel={`Report ${member.firstName}`}
                  style={styles.reportIconBtn}
                >
                  <Ionicons
                    name="flag-outline"
                    size={16}
                    color={hasReported ? "#B45309" : "#64748B"}
                  />
                </Pressable>
              </View>

              {member.interests.length > 0 ? (
                <View style={styles.interestsRow}>
                  {member.interests.map((interest) => {
                    const isShared = sharedInterests.includes(interest);
                    return (
                      <View
                        key={interest}
                        style={[styles.interestChip, isShared && styles.interestChipShared]}
                      >
                        <Text
                          style={[
                            styles.interestChipText,
                            isShared && styles.interestChipTextShared,
                          ]}
                        >
                          {interest}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {reportTargetId === member.userId ? (
                <View style={styles.reportBox}>
                  <Text style={styles.reportTitle}>
                    {hasReported ? "Report recorded for review." : `Report ${member.firstName}`}
                  </Text>
                  {!hasReported ? (
                    <View style={styles.reportOptionsRow}>
                      {REPORT_REASON_OPTIONS.map((opt) => (
                        <Pressable
                          key={opt.code}
                          style={styles.reportOptionChip}
                          onPress={() => handleReport(member.userId, opt.code)}
                        >
                          <Text style={styles.reportOptionText}>{opt.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {!connection ? (
                <View style={styles.actionArea}>
                  <Pressable style={styles.sayHelloBtn} onPress={() => openComposer(member)}>
                    <Ionicons name="hand-right" size={15} color="#FFFFFF" />
                    <Text style={styles.sayHelloText}>
                      {isComposing ? "Hide Note" : `Say Hello to ${member.firstName}`}
                    </Text>
                  </Pressable>

                  {isComposing ? (
                    <View style={styles.composerBox}>
                      {presets.length > 0 ? (
                        <>
                          <Text style={styles.composerLabel}>
                            1-Tap Gujarati / English Icebreakers
                          </Text>
                          {presets.map((preset) => (
                            <Pressable
                              key={preset}
                              style={styles.presetPill}
                              onPress={() => handleSendIcebreaker(member, preset)}
                            >
                              <Text style={styles.presetPillText}>{preset}</Text>
                            </Pressable>
                          ))}
                        </>
                      ) : null}

                      <Text style={styles.composerLabel}>
                        Or write a short note ({icebreakerDraft.length}/{ICEBREAKER_MAX_LENGTH})
                      </Text>
                      <TextInput
                        style={styles.icebreakerInput}
                        value={icebreakerDraft}
                        onChangeText={(txt) => {
                          setIcebreakerDraft(txt);
                          setIcebreakerError(null);
                        }}
                        placeholder="Kem cho! Would love to connect..."
                        placeholderTextColor="#94A3B8"
                        multiline
                        maxLength={ICEBREAKER_MAX_LENGTH + 20}
                      />
                      {icebreakerError ? (
                        <Text style={styles.icebreakerErrorText}>{icebreakerError}</Text>
                      ) : null}
                      <Pressable
                        style={styles.sendNoteBtn}
                        onPress={() => handleSendIcebreaker(member, icebreakerDraft)}
                      >
                        <Text style={styles.sendNoteBtnText}>Send Introduction</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {connection?.status === "pending" ? (
                <View style={styles.pendingBox}>
                  <View style={styles.pendingHeader}>
                    <Ionicons name="time" size={14} color="#0369A1" />
                    <Text style={styles.pendingTitle}>Introduction Sent</Text>
                  </View>
                  <Text style={styles.pendingNote} numberOfLines={2}>
                    &ldquo;{connection.icebreakerText}&rdquo;
                  </Text>
                  <Pressable
                    style={styles.simAcceptBtn}
                    onPress={() => {
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      acceptMockConnection(member.userId);
                    }}
                  >
                    <Text style={styles.simAcceptText}>Simulate Mutual Accept (Prototype)</Text>
                  </Pressable>
                </View>
              ) : null}

              {connection?.status === "accepted" ? (
                <View style={styles.acceptedBox}>
                  <Pressable
                    style={styles.whatsappBtn}
                    onPress={() => void handleOpenWhatsapp(member)}
                  >
                    <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                    <Text style={styles.whatsappBtnText}>
                      Message {member.firstName} on WhatsApp
                    </Text>
                  </Pressable>

                  <View style={styles.vouchPromptBox}>
                    <Text style={styles.vouchPromptText}>
                      Did you meet {member.firstName}? Vouch that they&apos;re from{" "}
                      {member.hometownDistrict}.
                    </Text>
                    <Pressable
                      style={[styles.vouchBtn, hasVouched && styles.vouchBtnDone]}
                      disabled={hasVouched}
                      onPress={() => {
                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        vouchMember(member.userId);
                      }}
                    >
                      <Text style={[styles.vouchBtnText, hasVouched && styles.vouchBtnTextDone]}>
                        {hasVouched ? "Vouched ✓" : "Vouch"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        <View style={styles.safetyFooter}>
          <Pressable style={styles.blockButton} onPress={confirmBlockHousehold}>
            <Ionicons name="ban" size={15} color="#B91C1C" />
            <Text style={styles.blockButtonText}>Block {household.displayLabel}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => dismissOrReturnHome(router)}>
            <Text style={styles.secondaryButtonText}>Close Drawer</Text>
          </Pressable>
        </View>
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
    padding: 20,
    gap: 14,
    paddingBottom: 32,
  },
  header: {
    gap: 6,
  },
  headerBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  lifeStageBadge: {
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  lifeStageBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155",
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F0FDFA",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  verifiedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F766E",
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
  areaText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  noticeBanner: {
    backgroundColor: "#F0FDFA",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  noticeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#115E59",
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
    marginTop: 2,
  },
  memberCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 18,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  memberTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  memberInfoCol: {
    flex: 1,
    gap: 3,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  agePill: {
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  agePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155",
  },
  hometownText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F766E",
  },
  vouchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  vouchText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400E",
  },
  reportIconBtn: {
    padding: 6,
  },
  interestsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  interestChip: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  interestChipShared: {
    backgroundColor: "#CCFBF1",
    borderColor: "#99F6E4",
  },
  interestChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475569",
  },
  interestChipTextShared: {
    color: "#115E59",
  },
  reportBox: {
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  reportTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400E",
  },
  reportOptionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  reportOptionChip: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  reportOptionText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#92400E",
  },
  actionArea: {
    gap: 8,
  },
  sayHelloBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0F766E",
    borderRadius: 12,
    paddingVertical: 11,
  },
  sayHelloText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  composerBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  composerLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  presetPill: {
    backgroundColor: "#F0FDFA",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  presetPillText: {
    fontSize: 12,
    lineHeight: 17,
    color: "#115E59",
    fontWeight: "600",
  },
  icebreakerInput: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    fontSize: 13,
    color: "#0F172A",
    minHeight: 56,
    textAlignVertical: "top",
  },
  icebreakerErrorText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#B91C1C",
  },
  sendNoteBtn: {
    backgroundColor: "#0F172A",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  sendNoteBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  pendingBox: {
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pendingTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1E40AF",
  },
  pendingNote: {
    fontSize: 12,
    color: "#1E3A8A",
    fontStyle: "italic",
  },
  simAcceptBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#DBEAFE",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  simAcceptText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  acceptedBox: {
    gap: 8,
  },
  whatsappBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 12,
    paddingVertical: 12,
  },
  whatsappBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  vouchPromptBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  vouchPromptText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: "#92400E",
    fontWeight: "600",
  },
  vouchBtn: {
    backgroundColor: "#D97706",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  vouchBtnDone: {
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  vouchBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  vouchBtnTextDone: {
    color: "#92400E",
  },
  safetyFooter: {
    gap: 10,
    marginTop: 4,
  },
  blockButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  blockButtonText: {
    color: "#B91C1C",
    fontSize: 14,
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
