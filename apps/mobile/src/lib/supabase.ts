import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const CHUNK_SIZE = 1800;

/**
 * Chunked SecureStore adapter so Supabase JWT sessions (which frequently exceed
 * the 2048-byte SecureStore per-item limit) persist safely in Keychain / Keystore.
 */
const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    }

    const chunkCountRaw = await SecureStore.getItemAsync(`${key}.chunks`);
    if (chunkCountRaw !== null) {
      const chunkCount = Number.parseInt(chunkCountRaw, 10);
      if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
        return null;
      }
      const parts = await Promise.all(
        Array.from({ length: chunkCount }, (_, i) => SecureStore.getItemAsync(`${key}.chunk.${i}`)),
      );
      if (parts.some((part) => part === null)) {
        return null;
      }
      return parts.join("");
    }

    return SecureStore.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
      return;
    }

    const previousCountRaw = await SecureStore.getItemAsync(`${key}.chunks`);
    const previousCount = previousCountRaw ? Number.parseInt(previousCountRaw, 10) : 0;

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(`${key}.chunks`);
      for (let i = 0; i < previousCount; i++) {
        await SecureStore.deleteItemAsync(`${key}.chunk.${i}`);
      }
      return;
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(`${key}.chunk.${index}`, chunk)),
    );
    await SecureStore.setItemAsync(`${key}.chunks`, String(chunks.length));
    await SecureStore.deleteItemAsync(key);

    for (let i = chunks.length; i < previousCount; i++) {
      await SecureStore.deleteItemAsync(`${key}.chunk.${i}`);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(key);
      }
      return;
    }

    const chunkCountRaw = await SecureStore.getItemAsync(`${key}.chunks`);
    const chunkCount = chunkCountRaw ? Number.parseInt(chunkCountRaw, 10) : 0;

    await Promise.all([
      SecureStore.deleteItemAsync(key),
      SecureStore.deleteItemAsync(`${key}.chunks`),
      ...Array.from({ length: chunkCount }, (_, i) =>
        SecureStore.deleteItemAsync(`${key}.chunk.${i}`),
      ),
    ]);
  },
};

let cachedClient: SupabaseClient | null = null;

export function getSupabaseConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClient(config.url, config.publishableKey, {
      auth: {
        storage: secureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }

  return cachedClient;
}
