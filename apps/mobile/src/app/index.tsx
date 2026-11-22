import { MIN_HOUSEHOLDS_PER_HEX } from "@second-home/shared";
import { StyleSheet, Text, View } from "react-native";

// Placeholder screen. Flow B (Reverse Onboarding) replaces this in Step 2.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Second Home</Text>
      <Text>Gujarat → San Antonio</Text>
      <Text>k-anonymity threshold: {MIN_HOUSEHOLDS_PER_HEX}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  title: { fontSize: 28, fontWeight: "700" },
});
