import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppFlowProvider } from "@/state/AppFlowContext";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppFlowProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="join-household"
              options={{ headerShown: false, animation: "none" }}
            />
            <Stack.Screen
              name="auth"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: [0.65, 0.9],
                sheetInitialDetentIndex: 0,
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
              }}
            />
            <Stack.Screen
              name="household/[id]"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: [0.55, 0.9],
                sheetInitialDetentIndex: 0,
                sheetGrabberVisible: true,
                sheetLargestUndimmedDetentIndex: 0,
                sheetCornerRadius: 24,
              }}
            />
            <Stack.Screen
              name="filters"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: [0.7, 0.9],
                sheetInitialDetentIndex: 0,
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
              }}
            />
            <Stack.Screen
              name="waitlist"
              options={{
                presentation: "formSheet",
                headerShown: false,
                sheetAllowedDetents: [0.6],
                sheetInitialDetentIndex: 0,
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
              }}
            />
          </Stack>
        </AppFlowProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
