import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dismissOrReturnHome } from "@/lib/navigation";

export default function MetroWaitlistSheet() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>METRO EXPANSION WAITLIST · F-17 SHELL</Text>
      <Text style={styles.title}>We&apos;re currently live in San Antonio!</Text>
      <Text style={styles.body}>
        Your GPS appears to be outside the Greater San Antonio launch corridor. Join the waitlist
        for Austin, DFW, or Houston, or return to preview the San Antonio map.
      </Text>

      <Pressable style={styles.primaryButton} onPress={() => dismissOrReturnHome(router)}>
        <Text style={styles.primaryButtonText}>Back to San Antonio Map</Text>
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
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  primaryButton: {
    marginTop: 8,
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
});
