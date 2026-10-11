import type { Room } from '../types';

export interface RoomStore {
  get(code: string): Promise<Room | null>;
  /** false si el código ya existe (SET NX). */
  create(room: Room): Promise<boolean>;
  /** Escribe `next` solo si la versión guardada es `expectedVersion`. */
  /** Borra la sala (la última persona se ha ido). */
  delete(code: string): Promise<void>;
  compareAndSet(code: string, expectedVersion: number, next: Room): Promise<boolean>;
}

export const ROOM_TTL_SECONDS = 24 * 60 * 60;
