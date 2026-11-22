import { parseHouseholdIdParam } from "@second-home/shared";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getMockHouseholdById } from "@/data/mockHouseholds";
import { dismissOrReturnHome } from "@/lib/navigation";
import { useAppFlow } from "@/state/AppFlowContext";

export default function HouseholdDrawerSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const { state, isHydrated } = useAppFlow();
  const householdId = parseHouseholdIdParam(params.id);
  const household = householdId ? getMockHouseholdById(householdId) : undefined;

  if (!isHydrated) {
    return null;
  }

  // Never allow direct deep links into /household/[id] to bypass the soft auth wall.
  if (!state.isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>HOUSEHOLD DRAWER · FLOW C SHELL</Text>
      <Text style={styles.title}>
        {household
          ? household.displayLabel
          : householdId
            ? `Household ${householdId.slice(0, 8)}`
            : "Unknown Household"}
      </Text>
      {household ? (
        <Text style={styles.meta}>
          Near {household.neighborhoodName} · {household.members.length} linked member
          {household.members.length !== 1 ? "s" : ""}
          {household.isVerifiedLocal ? " · Verified Local" : ""}
        </Text>
      ) : null}
      <Text style={styles.body}>
        This native formSheet leaves the map undimmed above at the half-height detent. Flow C
        renders full member profiles, trust badges, 1-tap icebreakers, and WhatsApp handoff here.
      </Text>

      <Pressable style={styles.secondaryButton} onPress={() => dismissOrReturnHome(router)}>
        <Text style={styles.secondaryButtonText}>Close Drawer</Text>
      </Pressable>
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
  meta: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F766E",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  secondaryButton: {
    marginTop: 8,
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
