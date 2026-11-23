import { NativeModules, Platform } from "react-native";

export type MapboxModule = typeof import("@rnmapbox/maps");

let cachedModule: MapboxModule | null = null;

export function getMapboxPublicToken(): string | null {
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function hasNativeMapboxModule(): boolean {
  return Platform.OS !== "web" && NativeModules.RNMBXModule != null;
}

export function isMapboxConfigured(): boolean {
  return hasNativeMapboxModule() && getMapboxPublicToken() !== null;
}

/**
 * Purely loads `@rnmapbox/maps` only when the native `RNMBXModule` bridge is present,
 * preventing synchronous import-time crashes in Expo Go or unconfigured environments.
 * Token configuration (`setAccessToken`) is handled asynchronously in a React effect.
 */
export function loadMapboxModule(): MapboxModule | null {
  if (!hasNativeMapboxModule()) {
    return null;
  }

  if (!cachedModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("@rnmapbox/maps") as MapboxModule;
  }

  return cachedModule;
}
