import type { ConfigContext, ExpoConfig } from "expo/config";

function buildGoogleIosUrlScheme(iosClientId: string | undefined): string | null {
  const trimmed = iosClientId?.trim();
  if (!trimmed) {
    return null;
  }
  const suffix = ".apps.googleusercontent.com";
  const prefix = trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed;
  return prefix ? `com.googleusercontent.apps.${prefix}` : null;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = buildGoogleIosUrlScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (plugin === "@react-native-google-signin/google-signin" && iosUrlScheme) {
      return ["@react-native-google-signin/google-signin", { iosUrlScheme }] as const;
    }
    return plugin;
  });

  return {
    ...config,
    name: config.name ?? "Second Home",
    slug: config.slug ?? "second-home",
    plugins: plugins as ExpoConfig["plugins"],
  };
};
