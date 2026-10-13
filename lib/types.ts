/** Tipos compartidos entre servidor, motor de reglas y cliente. */

/**
 * Mensaje estable para la UI: el servidor nunca emite texto, solo un código y sus parámetros.
 * El cliente lo traduce con la clave `msg.<code>` (ver messages/*.json). Los parámetros `card`, `cards`
 * (ids de carta) y `suit` los formatea el cliente; un `Msg` anidado se traduce recursivamente.
 */
export type MsgParam = string | number | string[] | Msg;
export interface Msg {
  code: string;
  params?: Record<string, MsgParam>;
}

export const msg = (code: string, params?: Record<string, MsgParam>): Msg => (params ? { code, params } : { code });

export interface PlayerRef {
  id: string;
  name: string;
}

export interface ConfigField {
  /** Clave de la config; el texto (etiqueta y ayuda) vive en messages/*.json. */
  key: string;
  min: number;
  max: number;
  default: number;
  /** Si existe, `valor × jugadores` no puede superar este presupuesto (la UI recorta el máximo). */
  perPlayerBudget?: number;
}

export type ActionResult<S> = { ok: true; state: S } | { ok: false; error: Msg };

export interface GameStatus {
  finished: boolean;
  winnerId: string | null;
}

export interface RuleSet<S = unknown, A = unknown, V = unknown> {
  /** El nombre y la descripción se traducen en el cliente: `rules.<id>.name` / `rules.<id>.description`. */
  id: string;
  config: ConfigField[];
  /** Validaciones cruzadas (p. ej. cartas * jugadores). Devuelve un mensaje o null. */
  validate?(playerCount: number, config: Record<string, number>): Msg | null;
  /** `prev` es el estado de la partida anterior (revancha), si existe. */
  createGame(players: PlayerRef[], config: Record<string, number>, rng: () => number, prev?: S): S;
  /** Valida y normaliza el JSON que llega por la API. null si no es una acción válida. */
  parseAction(raw: unknown): A | null;
  /** `rng` se inyecta (cripto en producción) para barajar/robar; el estado no guarda semillas. */
  applyAction(state: S, playerId: string, action: A, rng: () => number): ActionResult<S>;
  /** Quita a un jugador de una partida en curso (quedan >= 2) y deja el juego consistente. */
  removePlayer(state: S, playerId: string, rng: () => number): S;
  getView(state: S, playerId: string): V;
  getStatus(state: S): GameStatus;
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';

/** Sala tal como se guarda en el store (incluye tokens: nunca sale del servidor). */
export interface Room {
  code: string;
  version: number;
  createdAt: number;
  phase: RoomPhase;
  hostId: string;
  players: { id: string; name: string; token: string }[];
  ruleSetId: string;
  config: Record<string, number>;
  game: unknown | null;
  /** Aviso para el lobby (partida finalizada o cancelada). Se borra al empezar otra. */
  notice: Msg | null;
  /** Epoch ms del inicio de la partida en curso (o de la última terminada). Opcional: salas guardadas antes. */
  startedAt?: number | null;
  /** Epoch ms en que la partida terminó con un ganador; null mientras se juega. */
  finishedAt?: number | null;
}

/** Vista de sala para un jugador concreto. */
export interface RoomView<V = unknown> {
  code: string;
  version: number;
  phase: RoomPhase;
  me: string;
  hostId: string;
  players: { id: string; name: string; isHost: boolean }[];
  ruleSet: { id: string; config: ConfigField[] };
  config: Record<string, number>;
  game: V | null;
  notice: Msg | null;
  /** Inicio de la partida (epoch ms del servidor); null en el lobby. */
  startedAt: number | null;
  /** Fin de la partida (epoch ms del servidor); null si sigue en juego. */
  finishedAt: number | null;
}

export type Unchanged = { unchanged: true };
