import { Redirect } from "expo-router";

/**
 * Fallback for unmatched Universal Links / paths so visitors always land on the map.
 */
export default function NotFoundScreen() {
  return <Redirect href="/" />;
}
