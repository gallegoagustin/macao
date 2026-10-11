/** Tipos compartidos entre servidor, motor de reglas y cliente. */

export interface PlayerRef {
  id: string;
  name: string;
}

export interface ConfigField {
  key: string;
  label: string;
  help?: string;
  min: number;
  max: number;
  default: number;
  /** Si existe, `valor × jugadores` no puede superar este presupuesto (la UI recorta el máximo). */
  perPlayerBudget?: number;
}

export type ActionResult<S> = { ok: true; state: S } | { ok: false; error: string };

export interface GameStatus {
  finished: boolean;
  winnerId: string | null;
}

export interface RuleSet<S = unknown, A = unknown, V = unknown> {
  id: string;
  name: string;
  description: string;
  config: ConfigField[];
  /** Validaciones cruzadas (p. ej. cartas * jugadores). Devuelve un error en castellano o null. */
  validate?(playerCount: number, config: Record<string, number>): string | null;
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
  notice: string | null;
}

/** Vista de sala para un jugador concreto. */
export interface RoomView<V = unknown> {
  code: string;
  version: number;
  phase: RoomPhase;
  me: string;
  hostId: string;
  players: { id: string; name: string; isHost: boolean }[];
  ruleSet: { id: string; name: string; description: string; config: ConfigField[] };
  config: Record<string, number>;
  game: V | null;
  notice: string | null;
}

export type Unchanged = { unchanged: true };
