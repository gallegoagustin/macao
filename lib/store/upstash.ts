import { Redis } from "@upstash/redis";
import type { Room } from "../types";
import { ROOM_TTL_SECONDS, type RoomStore } from "./types";

const key = (code: string) => `macao:room:${code}`;

/** Compara `version` y escribe de forma atómica; renueva el TTL. */
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local obj = cjson.decode(cur)
if tonumber(obj.version) ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

export class UpstashRoomStore implements RoomStore {
  constructor(private redis: Redis) {}

  async get(code: string) {
    const raw = await this.redis.get<unknown>(key(code));
    if (raw === null || raw === undefined) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Room;
  }

  async create(room: Room) {
    const res = await this.redis.set(key(room.code), JSON.stringify(room), { nx: true, ex: ROOM_TTL_SECONDS });
    return res === "OK";
  }

  async compareAndSet(code: string, expectedVersion: number, next: Room) {
    const res = await this.redis.eval(
      CAS_SCRIPT,
      [key(code)],
      [String(expectedVersion), JSON.stringify(next), String(ROOM_TTL_SECONDS)],
    );
    return Number(res) === 1;
  }
}
