import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const CHUNK_SIZE = 1800;

const keyQueues = new Map<string, Promise<unknown>>();

function enqueueKeyOp<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = keyQueues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(op);
  keyQueues.set(key, next);
  const cleanup = () => {
    if (keyQueues.get(key) === next) {
      keyQueues.delete(key);
    }
  };
  void next.then(cleanup, cleanup);
  return next;
}

type ChunkManifest = {
  gen: string;
  count: number;
};

function parseManifest(raw: string | null): ChunkManifest | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChunkManifest>;
    if (
      typeof parsed.gen === "string" &&
      parsed.gen.length > 0 &&
      typeof parsed.count === "number" &&
      Number.isInteger(parsed.count) &&
      parsed.count > 0
    ) {
      return { gen: parsed.gen, count: parsed.count };
    }
  } catch {
    return null;
  }
  return null;
}

function chunkKey(baseKey: string, gen: string, index: number): string {
  return `${baseKey}.g.${gen}.chunk.${index}`;
}

async function deleteManifestChunks(
  baseKey: string,
  manifest: ChunkManifest | null,
): Promise<void> {
  if (!manifest) {
    return;
  }
  await Promise.all(
    Array.from({ length: manifest.count }, (_, i) =>
      SecureStore.deleteItemAsync(chunkKey(baseKey, manifest.gen, i)),
    ),
  );
}

/**
 * Generation-scoped chunked SecureStore adapter so Supabase JWT sessions (which frequently
 * exceed the 2048-byte SecureStore per-item limit) persist atomically in Keychain / Keystore.
 */
const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    }

    return enqueueKeyOp(key, async () => {
      const manifest = parseManifest(await SecureStore.getItemAsync(`${key}.chunks`));
      if (manifest) {
        const parts = await Promise.all(
          Array.from({ length: manifest.count }, (_, i) =>
            SecureStore.getItemAsync(chunkKey(key, manifest.gen, i)),
          ),
        );
        if (parts.some((part) => part === null)) {
          return null;
        }
        return parts.join("");
      }

      return SecureStore.getItemAsync(key);
    });
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
      return;
    }

    return enqueueKeyOp(key, async () => {
      const previousManifest = parseManifest(await SecureStore.getItemAsync(`${key}.chunks`));

      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        await SecureStore.deleteItemAsync(`${key}.chunks`);
        await deleteManifestChunks(key, previousManifest);
        return;
      }

      const chunks: string[] = [];
      for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
        chunks.push(value.slice(offset, offset + CHUNK_SIZE));
      }

      const gen = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      await Promise.all(
        chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, gen, index), chunk)),
      );
      await SecureStore.setItemAsync(
        `${key}.chunks`,
        JSON.stringify({ gen, count: chunks.length } satisfies ChunkManifest),
      );
      await SecureStore.deleteItemAsync(key);
      await deleteManifestChunks(key, previousManifest);
    });
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(key);
      }
      return;
    }

    return enqueueKeyOp(key, async () => {
      const manifest = parseManifest(await SecureStore.getItemAsync(`${key}.chunks`));
      await Promise.all([
        SecureStore.deleteItemAsync(key),
        SecureStore.deleteItemAsync(`${key}.chunks`),
        deleteManifestChunks(key, manifest),
      ]);
    });
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
