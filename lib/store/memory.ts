import type { Room } from "../types";
import { ROOM_TTL_SECONDS, type RoomStore } from "./types";

interface Entry {
  room: string; // JSON, para no compartir referencias mutables
  expiresAt: number;
}

const g = globalThis as unknown as { __macaoMemoryRooms?: Map<string, Entry> };

/** Store en memoria (un Map en globalThis) para desarrollo sin Redis. */
export class MemoryRoomStore implements RoomStore {
  private rooms: Map<string, Entry>;

  constructor() {
    this.rooms = g.__macaoMemoryRooms ??= new Map();
  }

  private read(code: string): Room | null {
    const e = this.rooms.get(code);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.rooms.delete(code);
      return null;
    }
    return JSON.parse(e.room) as Room;
  }

  private write(room: Room): void {
    this.rooms.set(room.code, { room: JSON.stringify(room), expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 });
  }

  async get(code: string) {
    return this.read(code);
  }

  async create(room: Room) {
    if (this.read(room.code)) return false;
    this.write(room);
    return true;
  }

  async compareAndSet(code: string, expectedVersion: number, next: Room) {
    const cur = this.read(code);
    if (!cur || cur.version !== expectedVersion) return false;
    this.write(next);
    return true;
  }
}
