import { randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_RULESET_ID, defaultConfig, getRuleSet, normalizeConfig } from "../rules";
import { getStore } from "../store";
import type { Room, RoomView } from "../types";
import { HttpError } from "./http";
import { secureRng } from "./rng";

export const MAX_PLAYERS = 8;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O
const MAX_RETRIES = 5;

type Member = Room["players"][number];

/* ------------------------------- utilidades ------------------------------- */

function randomCode(): string {
  const bytes = randomBytes(4);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const newId = () => randomBytes(8).toString("hex");
const newToken = () => randomBytes(32).toString("hex");

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "Escribe tu apodo.");
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 1) throw new HttpError(400, "Escribe tu apodo.");
  if (name.length > 20) throw new HttpError(400, "El apodo no puede pasar de 20 caracteres.");
  return name;
}

function tokenMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function authenticate(room: Room, token: string | null): Member {
  const me = token ? room.players.find((p) => tokenMatches(p.token, token)) : undefined;
  if (!me) throw new HttpError(401, "No formas parte de esta sala.", "not_member");
  return me;
}

/* --------------------------------- vistas --------------------------------- */

export function roomView(room: Room, playerId: string): RoomView {
  const rs = getRuleSet(room.ruleSetId);
  if (!rs) throw new HttpError(500, "Set de reglas desconocido.");
  return {
    code: room.code,
    version: room.version,
    phase: room.phase,
    me: playerId,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
    ruleSet: { id: rs.id, name: rs.name, description: rs.description, config: rs.config },
    config: room.config,
    game: room.game ? rs.getView(room.game, playerId) : null,
  };
}

/* ------------------------------ lectura / CAS ----------------------------- */

export async function loadRoom(code: string): Promise<Room> {
  const room = await getStore().get(normalizeCode(code));
  if (!room) throw new HttpError(404, "No existe ninguna sala con ese código.", "not_found");
  return room;
}

/** Con token, una sala inexistente responde igual que un token inválido (401): no se pueden enumerar salas. */
async function loadRoomForMember(code: string): Promise<Room> {
  const room = await getStore().get(normalizeCode(code));
  if (!room) throw new HttpError(401, "No formas parte de esta sala.", "not_member");
  return room;
}

/** Vista de la sala para un miembro (401 tanto si no hay sala como si el token no vale). */
export async function getRoomView(code: string, token: string | null, since: number | null): Promise<RoomView | { unchanged: true }> {
  const room = await loadRoomForMember(code);
  const me = authenticate(room, token);
  if (since !== null && since === room.version) return { unchanged: true };
  return roomView(room, me.id);
}

/**
 * Bucle leer -> aplicar -> CAS (hasta 5 reintentos). `apply` recibe una copia
 * de la sala y devuelve la sala siguiente; si lanza HttpError no se reintenta.
 */
export async function mutateRoom<T>(
  code: string,
  token: string | null,
  apply: (room: Room, me: Member | null) => { room: Room; result: T },
): Promise<T> {
  const store = getStore();
  const c = normalizeCode(code);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = token === null ? await loadRoom(c) : await loadRoomForMember(c);
    const me = token === null ? null : authenticate(current, token);
    const { room: next, result } = apply(structuredClone(current), me);
    next.version = current.version + 1;
    if (await store.compareAndSet(c, current.version, next)) return result;
  }
  throw new HttpError(409, "La sala está muy ocupada. Inténtalo de nuevo.", "conflict");
}

/* -------------------------------- operaciones ----------------------------- */

export async function createRoom(rawName: unknown) {
  const name = cleanName(rawName);
  const store = getStore();
  const rs = getRuleSet(DEFAULT_RULESET_ID);
  if (!rs) throw new HttpError(500, "Falta el set de reglas por defecto.");
  const playerId = newId();
  const token = newToken();
  for (let attempt = 0; attempt < 20; attempt++) {
    const room: Room = {
      code: randomCode(),
      version: 1,
      createdAt: Date.now(),
      phase: "lobby",
      hostId: playerId,
      players: [{ id: playerId, name, token }],
      ruleSetId: rs.id,
      config: defaultConfig(rs.config),
      game: null,
    };
    if (await store.create(room)) return { code: room.code, playerId, token };
  }
  throw new HttpError(503, "No se ha podido crear la sala. Inténtalo de nuevo.");
}

export async function joinRoom(code: string, rawName: unknown) {
  const name = cleanName(rawName);
  const playerId = newId();
  const token = newToken();
  await mutateRoom(code, null, (room) => {
    if (room.phase !== "lobby") throw new HttpError(409, "La partida ya ha empezado.", "in_progress");
    if (room.players.length >= MAX_PLAYERS) throw new HttpError(409, "La sala está llena (máximo 8 jugadores).");
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, "Ese apodo ya está en uso en la sala. Elige otro.", "name_taken");
    }
    room.players.push({ id: playerId, name, token });
    return { room, result: null };
  });
  return { code: normalizeCode(code), playerId, token };
}

function requireHost(room: Room, me: Member | null): Member {
  if (!me || me.id !== room.hostId) throw new HttpError(403, "Solo el anfitrión puede hacer eso.");
  return me;
}

export async function setConfig(code: string, token: string, body: Record<string, unknown>) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase !== "lobby") throw new HttpError(409, "La configuración solo se cambia en el lobby.");
    const rs = typeof body.ruleSetId === "string" ? getRuleSet(body.ruleSetId) : null;
    if (!rs) throw new HttpError(400, "Set de reglas desconocido.");
    const norm = normalizeConfig(rs.config, body.config);
    if (!norm.ok) throw new HttpError(400, norm.error);
    room.ruleSetId = rs.id;
    room.config = norm.config;
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

export async function kick(code: string, token: string, targetId: unknown) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase !== "lobby") throw new HttpError(409, "Solo puedes echar jugadores en el lobby.");
    if (typeof targetId !== "string" || !room.players.some((p) => p.id === targetId)) {
      throw new HttpError(404, "Ese jugador no está en la sala.");
    }
    if (targetId === room.hostId) throw new HttpError(400, "No puedes echarte a ti mismo.");
    room.players = room.players.filter((p) => p.id !== targetId);
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

export async function startGame(code: string, token: string) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase === "playing") throw new HttpError(409, "La partida ya está en marcha.");
    const rs = getRuleSet(room.ruleSetId);
    if (!rs) throw new HttpError(500, "Set de reglas desconocido.");
    const problem = rs.validate?.(room.players.length, room.config) ?? null;
    if (problem) throw new HttpError(400, problem);
    const players = room.players.map((p) => ({ id: p.id, name: p.name }));
    const prev = room.phase === "finished" ? room.game : undefined;
    room.game = rs.createGame(players, room.config, secureRng(), prev ?? undefined);
    room.phase = "playing";
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

export async function gameAction(code: string, token: string, rawAction: unknown) {
  return mutateRoom(code, token, (room, me) => {
    if (room.phase !== "playing" || !room.game) throw new HttpError(409, "No hay ninguna partida en marcha.");
    const rs = getRuleSet(room.ruleSetId);
    if (!rs) throw new HttpError(500, "Set de reglas desconocido.");
    const action = rs.parseAction(rawAction);
    if (!action) throw new HttpError(400, "Acción no válida.");
    const res = rs.applyAction(room.game, (me as Member).id, action, secureRng());
    if (!res.ok) throw new HttpError(400, res.error, "illegal_action");
    room.game = res.state;
    if (rs.getStatus(res.state).finished) room.phase = "finished";
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

async function roomViewAfter(code: string, playerId: string): Promise<RoomView> {
  return roomView(await loadRoom(code), playerId);
}
