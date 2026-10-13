import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_RULESET_ID, defaultConfig, getRuleSet, normalizeConfig } from '../rules';
import { getStore } from '../store';
import { type Msg, type Room, type RoomView, msg } from '../types';
import { HttpError } from './http';
import { secureRng } from './rng';

export const MAX_PLAYERS = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O
const MAX_RETRIES = 5;

type Member = Room['players'][number];

/* ------------------------------- utilidades ------------------------------- */

function randomCode(): string {
  const bytes = randomBytes(4);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const newId = () => randomBytes(8).toString('hex');
const newToken = () => randomBytes(32).toString('hex');

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'error.nickRequired');
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 1) throw new HttpError(400, 'error.nickRequired');
  if (name.length > 20) throw new HttpError(400, 'error.nickTooLong', { max: 20 });
  return name;
}

function tokenMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function authenticate(room: Room, token: string | null): Member {
  const me = token ? room.players.find((p) => tokenMatches(p.token, token)) : undefined;
  if (!me) throw new HttpError(401, 'error.notMember');
  return me;
}

/* --------------------------------- vistas --------------------------------- */

export function roomView(room: Room, playerId: string): RoomView {
  const rs = getRuleSet(room.ruleSetId);
  if (!rs) throw new HttpError(500, 'error.unknownRuleSet');
  return {
    code: room.code,
    version: room.version,
    phase: room.phase,
    me: playerId,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
    ruleSet: { id: rs.id, config: rs.config },
    config: room.config,
    game: room.game ? rs.getView(room.game, playerId) : null,
    notice: room.notice ?? null,
    startedAt: room.startedAt ?? null,
    finishedAt: room.finishedAt ?? null
  };
}

/* ------------------------------ lectura / CAS ----------------------------- */

export async function loadRoom(code: string): Promise<Room> {
  const room = await getStore().get(normalizeCode(code));
  if (!room) throw new HttpError(404, 'error.roomNotFound');
  return room;
}

/** Con token, una sala inexistente responde igual que un token inválido (401): no se pueden enumerar salas. */
async function loadRoomForMember(code: string): Promise<Room> {
  const room = await getStore().get(normalizeCode(code));
  if (!room) throw new HttpError(401, 'error.notMember');
  return room;
}

/** Vista de la sala para un miembro (401 tanto si no hay sala como si el token no vale). */
export async function getRoomView(
  code: string,
  token: string | null,
  since: number | null
): Promise<RoomView | { unchanged: true }> {
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
  apply: (room: Room, me: Member | null) => { room: Room; result: T }
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
  throw new HttpError(409, 'error.roomBusy');
}

/* -------------------------------- operaciones ----------------------------- */

export async function createRoom(rawName: unknown) {
  const name = cleanName(rawName);
  const store = getStore();
  const rs = getRuleSet(DEFAULT_RULESET_ID);
  if (!rs) throw new HttpError(500, 'error.missingDefaultRuleSet');
  const playerId = newId();
  const token = newToken();
  for (let attempt = 0; attempt < 20; attempt++) {
    const room: Room = {
      code: randomCode(),
      version: 1,
      createdAt: Date.now(),
      phase: 'lobby',
      hostId: playerId,
      players: [{ id: playerId, name, token }],
      ruleSetId: rs.id,
      config: defaultConfig(rs.config),
      game: null,
      notice: null,
      startedAt: null,
      finishedAt: null
    };
    if (await store.create(room)) return { code: room.code, playerId, token };
  }
  throw new HttpError(503, 'error.createFailed');
}

export async function joinRoom(code: string, rawName: unknown) {
  const name = cleanName(rawName);
  const playerId = newId();
  const token = newToken();
  await mutateRoom(code, null, (room) => {
    if (room.players.length === 0) throw new HttpError(404, 'error.roomNotFound');
    if (room.phase !== 'lobby') throw new HttpError(409, 'error.gameInProgress');
    if (room.players.length >= MAX_PLAYERS) throw new HttpError(409, 'error.roomFull', { max: MAX_PLAYERS });
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, 'error.nameTaken');
    }
    room.players.push({ id: playerId, name, token });
    return { room, result: null };
  });
  return { code: normalizeCode(code), playerId, token };
}

function requireHost(room: Room, me: Member | null): Member {
  if (!me || me.id !== room.hostId) throw new HttpError(403, 'error.hostOnly');
  return me;
}

export async function setConfig(code: string, token: string, body: Record<string, unknown>) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase !== 'lobby') throw new HttpError(409, 'error.configLobbyOnly');
    const rs = typeof body.ruleSetId === 'string' ? getRuleSet(body.ruleSetId) : null;
    if (!rs) throw new HttpError(400, 'error.unknownRuleSet');
    const norm = normalizeConfig(rs.config, body.config);
    if (!norm.ok) throw new HttpError(400, norm.error.code, norm.error.params);
    room.ruleSetId = rs.id;
    room.config = norm.config;
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

export async function kick(code: string, token: string, targetId: unknown) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase !== 'lobby') throw new HttpError(409, 'error.kickLobbyOnly');
    if (typeof targetId !== 'string' || !room.players.some((p) => p.id === targetId)) {
      throw new HttpError(404, 'error.playerNotInRoom');
    }
    if (targetId === room.hostId) throw new HttpError(400, 'error.kickSelf');
    room.players = room.players.filter((p) => p.id !== targetId);
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

export async function startGame(code: string, token: string) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase === 'playing') throw new HttpError(409, 'error.alreadyPlaying');
    const rs = getRuleSet(room.ruleSetId);
    if (!rs) throw new HttpError(500, 'error.unknownRuleSet');
    const problem = rs.validate?.(room.players.length, room.config) ?? null;
    if (problem) throw new HttpError(400, problem.code, problem.params);
    const players = room.players.map((p) => ({ id: p.id, name: p.name }));
    const prev = room.phase === 'finished' ? room.game : undefined;
    room.game = rs.createGame(players, room.config, secureRng(), prev ?? undefined);
    room.phase = 'playing';
    room.notice = null;
    room.startedAt = Date.now();
    room.finishedAt = null;
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

export async function gameAction(code: string, token: string, rawAction: unknown) {
  return mutateRoom(code, token, (room, me) => {
    if (room.phase !== 'playing' || !room.game) throw new HttpError(409, 'error.noGame');
    const rs = getRuleSet(room.ruleSetId);
    if (!rs) throw new HttpError(500, 'error.unknownRuleSet');
    const action = rs.parseAction(rawAction);
    if (!action) throw new HttpError(400, 'error.invalidAction');
    const res = rs.applyAction(room.game, (me as Member).id, action, secureRng());
    if (!res.ok) throw new HttpError(400, res.error.code, res.error.params);
    room.game = res.state;
    if (rs.getStatus(res.state).finished) {
      room.phase = 'finished';
      room.finishedAt = Date.now();
    }
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}

async function roomViewAfter(code: string, playerId: string): Promise<RoomView> {
  return roomView(await loadRoom(code), playerId);
}

function backToLobby(room: Room, notice: Msg): void {
  room.phase = 'lobby';
  room.game = null;
  room.notice = notice;
  room.startedAt = null;
  room.finishedAt = null;
}

/**
 * Un jugador abandona la sala (lobby o partida). En partida su mano vuelve al mazo; si queda 1 solo
 * jugador la partida se cancela y la sala vuelve al lobby; si era el host, pasa al siguiente en orden
 * de asiento; si no queda nadie, la sala se borra.
 */
export async function leaveRoom(code: string, token: string): Promise<{ left: true }> {
  const store = getStore();
  const c = normalizeCode(code);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await loadRoomForMember(c);
    const me = authenticate(current, token);
    const room = structuredClone(current);
    const idx = room.players.findIndex((p) => p.id === me.id);
    room.players.splice(idx, 1);
    room.version = current.version + 1;

    if (room.players.length === 0) {
      // Primero se vacía con CAS (un join concurrente falla) y luego se borra.
      if (await store.compareAndSet(c, current.version, room)) {
        await store.delete(c);
        return { left: true };
      }
      continue;
    }

    if (room.hostId === me.id) room.hostId = room.players[idx % room.players.length].id;

    if (room.phase === 'playing' && room.game) {
      if (room.players.length < 2) {
        backToLobby(room, msg('notice.matchCancelled', { name: me.name }));
      } else {
        const rs = getRuleSet(room.ruleSetId);
        if (!rs) throw new HttpError(500, 'error.unknownRuleSet');
        room.game = rs.removePlayer(room.game, me.id, secureRng());
      }
    } else if (room.phase === 'finished' && room.players.length < 2) {
      backToLobby(room, msg('notice.notEnoughPlayers', { name: me.name }));
    }

    if (await store.compareAndSet(c, current.version, room)) return { left: true };
  }
  throw new HttpError(409, 'error.roomBusy');
}

/** El host finaliza la partida para todos: vuelve al lobby con los mismos jugadores y configuración. */
export async function endGame(code: string, token: string) {
  return mutateRoom(code, token, (room, me) => {
    requireHost(room, me);
    if (room.phase === 'lobby') throw new HttpError(409, 'error.noGame');
    backToLobby(room, msg('notice.hostEnded'));
    return { room, result: (me as Member).id };
  }).then((me) => roomViewAfter(code, me));
}
