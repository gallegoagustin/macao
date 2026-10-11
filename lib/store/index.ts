import { Redis } from "@upstash/redis";
import { MemoryRoomStore } from "./memory";
import type { RoomStore } from "./types";
import { UpstashRoomStore } from "./upstash";

let store: RoomStore | null = null;

/** Acepta las variables UPSTASH_REDIS_REST_* o KV_REST_API_* (según inyecte la integración de Vercel). */
export function redisEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function getStore(): RoomStore {
  if (!store) {
    const env = redisEnv();
    store = env ? new UpstashRoomStore(new Redis({ url: env.url, token: env.token })) : new MemoryRoomStore();
  }
  return store;
}

export type { RoomStore };
