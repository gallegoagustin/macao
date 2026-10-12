import {
  type ActionResult,
  type ConfigField,
  type Msg,
  type MsgParam,
  type PlayerRef,
  type RuleSet,
  msg
} from '../types';
import { type CardId, type Rank, type Suit, isCardId, makeDeck, parseCard } from './cards';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                       */
/* -------------------------------------------------------------------------- */

export type DemandRank = '5' | '6' | '7' | '8' | '9' | '10';
const DEMAND_RANKS: readonly string[] = ['5', '6', '7', '8', '9', '10'];

export type Pending =
  | { kind: 'skip'; count: number }
  | { kind: 'draw'; amount: number }
  | { kind: 'king'; from: string; target: string; card: CardId };

export type Demand =
  | { kind: 'rank'; rank: DemandRank; by: string; turnsLeft: number }
  | { kind: 'suit'; suit: Suit; by: string; turnsLeft: number };

export type PolacoAction =
  | { type: 'play'; cards: CardId[]; demandRank?: DemandRank | null; demandSuit?: Suit }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'accept' };

export interface PolacoState {
  players: PlayerRef[];
  hands: Record<string, CardId[]>;
  /** El tope del mazo es el último elemento. */
  deck: CardId[];
  /** La carta de arriba de la mesa es el último elemento. */
  discard: CardId[];
  /** Índice del jugador que tiene que actuar (con K pendiente, el objetivo de la K). */
  turn: number;
  /** Índice del jugador que abrió la partida. */
  starter: number;
  pending: Pending | null;
  demand: Demand | null;
  freePlay: boolean;
  /** Carta robada este turno que se puede jugar (o pasar). */
  drawn: CardId | null;
  winner: string | null;
  /** Entradas del registro de la mesa: mensajes estables que traduce el cliente. */
  log: Msg[];
}

export interface PolacoView {
  me: string;
  hand: CardId[];
  players: { id: string; name: string; cards: number }[];
  /** Quién tiene que actuar ahora. */
  actorId: string;
  top: CardId;
  deckCount: number;
  pending: Pending | null;
  demand: Demand | null;
  freePlay: boolean;
  drawn: CardId | null;
  legal: {
    plays: CardId[];
    canDraw: boolean;
    canPass: boolean;
    canAccept: boolean;
  };
  winnerId: string | null;
  log: Msg[];
}

/* -------------------------------------------------------------------------- */
/* Configuración                                                               */
/* -------------------------------------------------------------------------- */

const CONFIG: ConfigField[] = [
  {
    key: 'handSize',
    min: 3,
    max: 10,
    default: 5,
    perPlayerBudget: 40
  }
];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
const MAX_DEALT = 40;
const LOG_KEEP = 8;
const LOG_VIEW = 5;

/* -------------------------------------------------------------------------- */
/* Aleatoriedad                                                                */
/* -------------------------------------------------------------------------- */

/** El RNG siempre se inyecta (cripto en producción, determinista en tests); el estado no guarda semilla. */
type Rng = () => number;

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* -------------------------------------------------------------------------- */
/* Utilidades de cartas                                                        */
/* -------------------------------------------------------------------------- */

/** Especiales: 2, 3, 4, J, Q, A, K♥ y K♠. No especiales: 5-10, K♣ y K♦. */
export function isSpecial(card: CardId): boolean {
  const { rank, suit } = parseCard(card);
  if (rank === 'K') return suit === 'H' || suit === 'S';
  return ['2', '3', '4', 'J', 'Q', 'A'].includes(rank);
}

function isRedKing(card: CardId): boolean {
  return card === 'KH';
}
function isBlackKing(card: CardId): boolean {
  return card === 'KS';
}
function oppositeKing(card: CardId): CardId {
  return card === 'KH' ? 'KS' : 'KH';
}

/* -------------------------------------------------------------------------- */
/* Utilidades de estado                                                        */
/* -------------------------------------------------------------------------- */

function clone(s: PolacoState): PolacoState {
  return structuredClone(s);
}

function idxOf(s: PolacoState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}
function nameOf(s: PolacoState, id: string): string {
  return s.players.find((p) => p.id === id)?.name ?? '?';
}
function nextIdx(s: PolacoState, i: number): number {
  return (i + 1) % s.players.length;
}
function prevIdx(s: PolacoState, i: number): number {
  return (i - 1 + s.players.length) % s.players.length;
}
function topCard(s: PolacoState): CardId {
  return s.discard[s.discard.length - 1];
}
function log(s: PolacoState, entry: Msg): void {
  s.log.push(entry);
  if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
}

/** Cartas que se pueden robar ahora mismo (mazo + descarte sin la de arriba). */
function drawableCount(s: PolacoState): number {
  return s.deck.length + Math.max(0, s.discard.length - 1);
}

/** Roba hasta `n` cartas (con remezcla del descarte). Devuelve las robadas. */
function drawCards(s: PolacoState, playerId: string, n: number, rng: Rng): CardId[] {
  const got: CardId[] = [];
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      if (s.discard.length <= 1) break;
      const top = s.discard.pop() as CardId;
      s.deck = s.discard;
      s.discard = [top];
      shuffleInPlace(s.deck, rng);
    }
    const c = s.deck.pop() as CardId;
    s.hands[playerId].push(c);
    got.push(c);
  }
  return got;
}

/** Cada turno que termina resta uno a la demanda vigente. */
function tickDemand(s: PolacoState, steps: number): void {
  if (!s.demand) return;
  s.demand.turnsLeft -= steps;
  if (s.demand.turnsLeft <= 0) s.demand = null;
}

/**
 * Pasa el turno de `from` a `to`. `steps` es el número de turnos que han terminado
 * (por defecto, los que hay entre `from` y `to`, contando el de `from`); cada uno resta
 * uno a la demanda vigente.
 */
function endTurn(s: PolacoState, from: number, to: number, steps?: number): void {
  const n = s.players.length;
  tickDemand(s, steps ?? ((((to - from) % n) + n) % n || n));
  s.turn = to;
  s.drawn = null;
  s.freePlay = false; // un robo voluntario o un pase no deben heredar la jugada libre al siguiente
}

/* -------------------------------------------------------------------------- */
/* Legalidad                                                                   */
/* -------------------------------------------------------------------------- */

/** Lo que hace falta para validar una jugada: tu mano + estado público. Sin información oculta. */
export interface PlayCtx {
  hand: CardId[];
  top: CardId;
  pending: Pending | null;
  demand: Demand | null;
  freePlay: boolean;
  drawn: CardId | null;
  /** Te toca actuar (con K pendiente, eres el objetivo) y la partida sigue. */
  isActor: boolean;
  finished: boolean;
}

export function ctxFromState(s: PolacoState, playerId: string): PlayCtx {
  return {
    hand: s.hands[playerId] ?? [],
    top: topCard(s),
    pending: s.pending,
    demand: s.demand,
    freePlay: s.freePlay,
    drawn: s.drawn,
    isActor: !s.winner && actorId(s) === playerId,
    finished: s.winner !== null
  };
}

/** Contexto a partir de la vista del jugador (lo que tiene el cliente). */
export function ctxFromView(v: PolacoView): PlayCtx {
  return {
    hand: v.hand,
    top: v.top,
    pending: v.pending,
    demand: v.demand,
    freePlay: v.freePlay,
    drawn: v.drawn,
    isActor: v.winnerId === null && v.actorId === v.me,
    finished: v.winnerId !== null
  };
}

function matchesNormal(card: CardId, top: CardId): boolean {
  const c = parseCard(card);
  const t = parseCard(top);
  return c.suit === t.suit || c.rank === t.rank;
}

/** ¿Se puede tirar esta carta SOLA (o como primera de una jugada múltiple)? */
function isPlayableCtx(ctx: PlayCtx, card: CardId): boolean {
  const { rank, suit } = parseCard(card);
  const p = ctx.pending;

  if (p?.kind === 'king') return card === oppositeKing(p.card);
  if (p?.kind === 'skip') return rank === '4';
  if (p?.kind === 'draw') return rank === '2' || rank === '3';
  if (ctx.drawn) return card === ctx.drawn;
  if (ctx.freePlay) return true;

  const d = ctx.demand;
  if (d?.kind === 'rank') return rank === d.rank || rank === 'J'; // la Q nunca encaja aquí
  if (d?.kind === 'suit') return suit === d.suit || rank === 'A'; // solo la Q del palo exigido
  if (rank === 'Q') return true;
  return matchesNormal(card, ctx.top);
}

function isPlayable(s: PolacoState, card: CardId): boolean {
  return isPlayableCtx(ctxFromState(s, s.players[s.turn].id), card);
}

function playableCards(s: PolacoState, playerId: string): CardId[] {
  if (s.winner) return [];
  const ctx = ctxFromState(s, playerId);
  return ctx.hand.filter((c) => isPlayableCtx(ctx, c));
}

function illegalReason(ctx: PlayCtx, card: CardId): Msg {
  const { rank } = parseCard(card);
  const p = ctx.pending;
  if (p?.kind === 'king') {
    return msg('rule.kingOnlyRespond', { card: oppositeKing(p.card) });
  }
  if (p?.kind === 'skip') return msg('rule.skipPending');
  if (p?.kind === 'draw') return msg('rule.drawPending');
  if (ctx.drawn) return msg('rule.drawnOnly', { card: ctx.drawn });
  const d = ctx.demand;
  if (d?.kind === 'rank') {
    if (rank === 'Q') return msg('rule.noQUnderJ');
    return msg('rule.demandRank', { rank: d.rank });
  }
  if (d?.kind === 'suit') {
    if (rank === 'Q') return msg('rule.qUnderAce', { suit: d.suit });
    return msg('rule.demandSuit', { suit: d.suit });
  }
  return msg('rule.noFit', { card: ctx.top });
}

/* ---- Jugadas de varias cartas ---- */

export type PlayKind = 'single' | 'straight' | 'group';

export type PlayCheck =
  | {
      ok: true;
      kind: PlayKind;
      /** Carta que queda arriba y cuyo efecto aplica. */
      last: CardId;
      /** Demanda que hay que elegir antes de tirar (null si no hace falta, p. ej. si ganas con esta jugada). */
      needsDemand: 'rank' | 'suit' | null;
      /** Texto del botón: "Tirar", "Tirar escalera (3)", "Tirar trío (3)"... */
      label: Msg;
    }
  | { ok: false; error: Msg };

const RANK_VALUE: Record<Rank, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13
};

/** Números consecutivos (ascendente o descendente), A bajo o alto, sin vuelta (K-A-2 no vale). */
function isStraightRanks(ranks: Rank[]): boolean {
  if (ranks.length < 2) return true;
  for (const aHigh of [false, true]) {
    const v = ranks.map((r) => (r === 'A' && aHigh ? 14 : RANK_VALUE[r]));
    const d = v[1] - v[0];
    if (d !== 1 && d !== -1) continue;
    if (v.every((x, i) => i === 0 || x - v[i - 1] === d)) return true;
  }
  return false;
}

/**
 * Valida una jugada (una o varias cartas, en orden: la primera toca la mesa, la última queda arriba).
 * Con `partial` acepta también prefijos de jugadas (para resaltar qué cartas pueden ampliar la selección).
 */
export function checkPlay(ctx: PlayCtx, cards: CardId[], opts: { partial?: boolean } = {}): PlayCheck {
  const partial = opts.partial === true;
  const fail = (error: Msg): PlayCheck => ({ ok: false, error });
  if (ctx.finished) return fail(msg('rule.gameOver'));
  if (!ctx.isActor) return fail(msg('rule.notYourTurn'));
  if (cards.length === 0) return fail(msg('rule.pickOne'));
  if (new Set(cards).size !== cards.length) return fail(msg('rule.noRepeat'));
  for (const c of cards) if (!ctx.hand.includes(c)) return fail(msg('rule.notInHand'));

  const first = cards[0];
  const last = cards[cards.length - 1];
  const win = cards.length === ctx.hand.length;
  const lastRank = parseCard(last).rank;
  const needsDemand = win ? null : lastRank === 'J' ? 'rank' : lastRank === 'A' ? 'suit' : null;

  if (cards.length === 1) {
    if (!isPlayableCtx(ctx, first)) return fail(illegalReason(ctx, first));
    return { ok: true, kind: 'single', last, needsDemand, label: msg('play.single') };
  }

  // ---- varias cartas ----
  const p = ctx.pending;
  if (p?.kind === 'king') return fail(msg('rule.kingMulti'));
  if (ctx.drawn) return fail(msg('rule.drawnOnly', { card: ctx.drawn }));

  const ranks = cards.map((c) => parseCard(c).rank);
  const group = ranks.every((r) => r === ranks[0]);
  if (!group && !isStraightRanks(ranks)) {
    return fail(msg('rule.multiShape'));
  }
  if (!partial && cards.length < 3) {
    return fail(msg('rule.multiMin'));
  }

  if (p?.kind === 'draw' && !(group && (ranks[0] === '2' || ranks[0] === '3'))) {
    return fail(msg('rule.drawGroupOnly'));
  }
  if (p?.kind === 'skip' && !(group && ranks[0] === '4')) {
    return fail(msg('rule.skipGroupOnly'));
  }

  if (!isPlayableCtx(ctx, first)) {
    if (group && cards.some((c) => isPlayableCtx(ctx, c))) {
      return fail(msg('rule.firstFirst'));
    }
    return fail(
      group || !partial ? msg('rule.firstMustPlay', { reason: illegalReason(ctx, first) }) : illegalReason(ctx, first)
    );
  }

  const kind: PlayKind = group ? 'group' : 'straight';
  const label = group
    ? msg(cards.length === 3 ? 'play.trio' : 'play.group', { count: cards.length })
    : msg('play.straight', { count: cards.length });
  return { ok: true, kind, last, needsDemand: partial ? null : needsDemand, label };
}

/** API pública pedida: valida una jugada para un jugador concreto sobre el estado completo. */
export function validatePlay(state: PolacoState, playerId: string, cards: CardId[]): PlayCheck {
  return checkPlay(ctxFromState(state, playerId), cards);
}

function actorId(s: PolacoState): string {
  return s.players[s.turn].id;
}

function canDrawNow(s: PolacoState, playerId: string): boolean {
  // Robo voluntario: siempre que sea tu turno, no haya pending y queden cartas.
  return !s.winner && actorId(s) === playerId && !s.pending && !s.drawn && drawableCount(s) > 0;
}

function canPassNow(s: PolacoState, playerId: string): boolean {
  if (s.winner || actorId(s) !== playerId || s.pending) return false;
  if (s.drawn) return true;
  // Caso límite: sin jugadas y sin cartas que robar, no se puede bloquear la partida.
  return playableCards(s, playerId).length === 0 && drawableCount(s) === 0;
}

/* -------------------------------------------------------------------------- */
/* Acciones                                                                    */
/* -------------------------------------------------------------------------- */

const err = (code: string, params?: Record<string, MsgParam>): ActionResult<PolacoState> => ({
  ok: false,
  error: msg(code, params)
});

function applyAction(state: PolacoState, playerId: string, action: PolacoAction, rng: Rng): ActionResult<PolacoState> {
  if (state.winner) return err('rule.gameOver');
  const s = clone(state);
  const pi = idxOf(s, playerId);
  if (pi < 0) return err('rule.notInGame');

  if (pi !== s.turn) {
    if (s.pending?.kind === 'king') {
      return err('rule.waitingKing', { name: nameOf(s, s.pending.target) });
    }
    return err('rule.notYourTurn');
  }

  switch (action.type) {
    case 'play':
      return play(s, pi, action, rng);
    case 'draw':
      return draw(s, pi, rng);
    case 'pass':
      return pass(s, pi);
    case 'accept':
      return accept(s, pi, rng);
    default:
      return err('error.invalidAction');
  }
}

function describePlay(kind: PlayKind, cards: CardId[]): Msg {
  if (kind === 'straight') return msg('what.straight', { cards });
  if (kind === 'group') return msg('what.group', { count: cards.length, cards });
  return msg('what.single', { cards });
}

function play(
  s: PolacoState,
  pi: number,
  action: Extract<PolacoAction, { type: 'play' }>,
  rng: Rng
): ActionResult<PolacoState> {
  const pid = s.players[pi].id;
  const me = s.players[pi].name;
  const cards = action.cards;
  const hand = s.hands[pid];

  const check = checkPlay(ctxFromState(s, pid), cards);
  if (!check.ok) return { ok: false, error: check.error };

  const wasKingPending = s.pending?.kind === 'king';
  const last = check.last;
  const { rank } = parseCard(last);
  const willWin = cards.length === hand.length;

  // Validar la elección de J / A antes de mutar nada (si ganas con la jugada no hace falta).
  let demandRank: DemandRank | null = null;
  let demandSuit: Suit | null = null;
  if (!wasKingPending && !willWin) {
    if (rank === 'J') {
      if (action.demandRank === undefined) return err('rule.pickRank');
      if (action.demandRank !== null) {
        if (!DEMAND_RANKS.includes(action.demandRank)) return err('rule.rankRange');
        demandRank = action.demandRank;
      }
    }
    if (rank === 'A') {
      if (!action.demandSuit) return err('rule.pickSuit');
      demandSuit = action.demandSuit;
    }
  }

  for (const c of cards) hand.splice(hand.indexOf(c), 1);
  for (const c of cards) s.discard.push(c);
  s.freePlay = false;
  s.drawn = null;
  const what = describePlay(check.kind, cards);

  // Gana el primero que se queda sin cartas (el efecto de la jugada se ignora).
  if (hand.length === 0) {
    s.winner = pid;
    s.pending = null;
    s.demand = null;
    log(s, msg('log.win', { me, what }));
    return { ok: true, state: s };
  }

  /* ---- Respuesta a una K (siempre una sola carta) ---- */
  if (wasKingPending && s.pending?.kind === 'king') {
    const k = s.pending;
    log(s, msg('log.kingResponded', { me, card: last, from: nameOf(s, k.from) }));
    resolveKing(s, 'respond', rng);
    return { ok: true, state: s };
  }

  const n = s.players.length;
  const next = nextIdx(s, pi);
  // En un grupo los efectos se suman; en una escalera solo cuenta la última carta.
  const mult = check.kind === 'group' ? cards.length : 1;

  switch (rank) {
    case '4': {
      const count = (s.pending?.kind === 'skip' ? s.pending.count : 0) + mult;
      s.pending = { kind: 'skip', count };
      log(s, msg('log.skip', { me, what, count }));
      endTurn(s, pi, next);
      return { ok: true, state: s };
    }
    case '2':
    case '3': {
      const add = (rank === '2' ? 2 : 3) * mult;
      const amount = (s.pending?.kind === 'draw' ? s.pending.amount : 0) + add;
      s.pending = { kind: 'draw', amount };
      log(s, msg('log.drawStack', { me, what, amount }));
      endTurn(s, pi, next);
      return { ok: true, state: s };
    }
    case 'J': {
      s.demand = null; // la nueva J reemplaza cualquier demanda (con número o con nada)
      endTurn(s, pi, next);
      if (demandRank) {
        s.demand = { kind: 'rank', rank: demandRank, by: pid, turnsLeft: n };
        log(s, msg('log.demandRank', { me, what, rank: demandRank }));
      } else {
        log(s, msg('log.noDemand', { me, what }));
      }
      return { ok: true, state: s };
    }
    case 'A': {
      s.demand = null;
      endTurn(s, pi, next);
      s.demand = { kind: 'suit', suit: demandSuit as Suit, by: pid, turnsLeft: n };
      log(s, msg('log.demandSuit', { me, what, suit: demandSuit as Suit }));
      return { ok: true, state: s };
    }
    case 'Q': {
      // Bajo una demanda (solo cabe la Q del palo exigido de una A) la demanda sigue su vuelta completa
      // y manda sobre la jugada libre; fuera de una demanda, la Q da jugada libre al siguiente.
      const underDemand = s.demand !== null;
      endTurn(s, pi, next);
      if (underDemand) {
        log(s, msg('log.played', { me, what }));
      } else {
        s.freePlay = true;
        log(s, msg('log.queenFree', { me, what, next: nameOf(s, s.players[next].id) }));
      }
      return { ok: true, state: s };
    }
    case 'K': {
      if (isRedKing(last) || isBlackKing(last)) {
        const targetIdx = isRedKing(last) ? nextIdx(s, pi) : prevIdx(s, pi);
        const target = s.players[targetIdx].id;
        s.pending = { kind: 'king', from: pid, target, card: last };
        s.turn = targetIdx;
        log(s, msg('log.king', { me, what, target: nameOf(s, target) }));
        return { ok: true, state: s };
      }
      break; // K♣ y K♦ son cartas normales
    }
    default:
      break;
  }

  log(s, msg('log.played', { me, what }));
  endTurn(s, pi, next);
  return { ok: true, state: s };
}

/**
 * Resuelve una K pendiente: el objetivo acepta (roba 5) o responde con la K opuesta (el autor roba 10).
 * Cada turno que termina resta uno a la demanda; la respuesta fuera de turno de la K♠ no cuenta.
 */
function resolveKing(s: PolacoState, how: 'accept' | 'respond', rng: Rng): void {
  const k = s.pending;
  if (!k || k.kind !== 'king') return;
  const pIdx = idxOf(s, k.from);
  const tIdx = idxOf(s, k.target);
  const hearts = isRedKing(k.card);

  if (how === 'accept') drawCards(s, k.target, 5, rng);
  else drawCards(s, k.from, 10, rng);

  // Turnos terminados: el de quien tiró la K, más el del objetivo si la K♥ lo deja en orden
  // (acepte o responda). El objetivo de la K♠ actúa fuera de turno y no cuenta.
  let steps = 1;
  let next: number;
  if (hearts) {
    steps += 1;
    next = nextIdx(s, tIdx);
    // Si responde con K♠ pierde el turno quien tiró la K♥: con 2 jugadores le tocaría justo ahora.
    if (how === 'respond' && next === pIdx) {
      steps += 1;
      next = nextIdx(s, next);
    }
  } else {
    next = nextIdx(s, pIdx);
    // K♠ aceptada con 2 jugadores: el objetivo es quien iba a jugar y pierde ese turno.
    if (how === 'accept' && next === tIdx) {
      steps += 1;
      next = nextIdx(s, next);
    }
  }

  s.pending = null;
  endTurn(s, pIdx, next, steps);
}

function draw(s: PolacoState, pi: number, rng: Rng): ActionResult<PolacoState> {
  const pid = s.players[pi].id;
  const me = s.players[pi].name;
  if (s.pending) return err('rule.drawPendingAccept');
  if (s.drawn) return err('rule.alreadyDrew');
  if (drawableCount(s) === 0) return err('rule.deckEmpty');

  const [card] = drawCards(s, pid, 1, rng);
  if (isPlayable(s, card)) {
    s.drawn = card;
    log(s, msg('log.draw', { me }));
  } else {
    log(s, msg('log.drawPass', { me }));
    endTurn(s, pi, nextIdx(s, pi));
  }
  return { ok: true, state: s };
}

function pass(s: PolacoState, pi: number): ActionResult<PolacoState> {
  const pid = s.players[pi].id;
  if (!canPassNow(s, pid)) return err('rule.passOnly');
  log(s, msg('log.pass', { me: s.players[pi].name }));
  endTurn(s, pi, nextIdx(s, pi));
  return { ok: true, state: s };
}

function accept(s: PolacoState, pi: number, rng: Rng): ActionResult<PolacoState> {
  const pid = s.players[pi].id;
  const me = s.players[pi].name;
  const p = s.pending;
  if (!p) return err('rule.nothingToAccept');

  if (p.kind === 'skip') {
    p.count -= 1;
    log(s, msg('log.acceptSkip', { me }));
    if (p.count <= 0) s.pending = null;
    endTurn(s, pi, nextIdx(s, pi));
    return { ok: true, state: s };
  }
  if (p.kind === 'draw') {
    s.pending = null;
    drawCards(s, pid, p.amount, rng);
    log(s, msg('log.acceptDraw', { me, amount: p.amount }));
    endTurn(s, pi, nextIdx(s, pi));
    return { ok: true, state: s };
  }
  log(s, msg('log.acceptKing', { me }));
  resolveKing(s, 'accept', rng);
  return { ok: true, state: s };
}

/* -------------------------------------------------------------------------- */
/* Un jugador abandona la partida                                              */
/* -------------------------------------------------------------------------- */

/**
 * Quita a un jugador de una partida en curso (quedan >= 2): su mano vuelve al mazo (barajado) y el
 * juego sigue. Si era su turno pasa al siguiente; un robo/salto pendiente pasa tal cual; una K
 * tirada por él o que lo tenía como objetivo se cancela; la demanda se recorta al nuevo número de jugadores.
 */
function removePlayer(state: PolacoState, playerId: string, rng: Rng): PolacoState {
  const s = clone(state);
  const i = idxOf(s, playerId);
  if (i < 0) return s;
  const name = s.players[i].name;

  const king = s.pending?.kind === 'king' ? s.pending : null;
  const wasActor = s.turn === i;
  const kingThrowerIdx = king ? idxOf(s, king.from) : -1;

  // Mano de vuelta al mazo.
  s.deck.push(...s.hands[playerId]);
  shuffleInPlace(s.deck, rng);
  delete s.hands[playerId];
  s.players.splice(i, 1);
  const n = s.players.length;
  const shift = (idx: number) => (idx > i ? idx - 1 : idx); // índice tras quitar al jugador i
  const afterLeaver = i % n; // el siguiente en orden al que se va

  if (king && (king.from === playerId || king.target === playerId)) {
    // K cancelada: el turno sigue con el siguiente a quien la tiró.
    s.pending = null;
    s.turn = kingThrowerIdx === i ? afterLeaver : (shift(kingThrowerIdx) + 1) % n;
  } else if (wasActor) {
    s.turn = afterLeaver; // el robo/salto pendiente pasa tal cual al siguiente
  } else {
    s.turn = shift(s.turn);
  }
  if (wasActor) s.drawn = null;
  s.starter = s.starter === i ? (i - 1 + n) % n : shift(s.starter);
  if (s.demand) s.demand.turnsLeft = Math.min(s.demand.turnsLeft, n);
  log(s, msg('log.leave', { name }));
  return s;
}

/* -------------------------------------------------------------------------- */
/* Creación de partida                                                         */
/* -------------------------------------------------------------------------- */

function createGame(players: PlayerRef[], config: Record<string, number>, rng: Rng, prev?: PolacoState): PolacoState {
  const handSize = config.handSize ?? CONFIG[0].default;

  let deck: CardId[] = [];
  const hands: Record<string, CardId[]> = {};
  // Con muchas cartas repartidas podrían quedar solo especiales en el mazo: se vuelve a repartir.
  for (let attempt = 0; attempt < 1000; attempt++) {
    deck = makeDeck();
    shuffleInPlace(deck, rng);
    for (const p of players) hands[p.id] = [];
    for (let i = 0; i < handSize; i++) for (const p of players) hands[p.id].push(deck.pop() as CardId);
    if (deck.some((c) => !isSpecial(c))) break;
  }

  // Carta inicial: si es especial vuelve al mazo, se mezcla y se saca otra.
  let start = deck.pop() as CardId;
  while (isSpecial(start)) {
    deck.push(start);
    shuffleInPlace(deck, rng);
    start = deck.pop() as CardId;
  }

  let starter: number;
  if (prev) {
    const prevId = prev.players[prev.starter]?.id;
    const at = players.findIndex((p) => p.id === prevId);
    starter = at >= 0 ? (at + 1) % players.length : 0;
  } else {
    starter = Math.floor(rng() * players.length);
  }

  return {
    players: players.map((p) => ({ id: p.id, name: p.name })),
    hands,
    deck,
    discard: [start],
    turn: starter,
    starter,
    pending: null,
    demand: null,
    freePlay: false,
    drawn: null,
    winner: null,
    log: [msg('log.start', { name: players[starter].name })]
  };
}

/* -------------------------------------------------------------------------- */
/* Vista                                                                       */
/* -------------------------------------------------------------------------- */

function getView(s: PolacoState, playerId: string): PolacoView {
  const isActor = !s.winner && actorId(s) === playerId;
  const hand = s.hands[playerId] ?? [];
  return {
    me: playerId,
    hand: [...hand],
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      cards: s.hands[p.id].length
    })),
    actorId: actorId(s),
    top: topCard(s),
    deckCount: s.deck.length,
    pending: s.pending,
    demand: s.demand,
    freePlay: s.freePlay,
    // Solo quien tiene que decidir sobre la carta robada la ve.
    drawn: isActor ? s.drawn : null,
    legal: {
      plays: isActor ? playableCards(s, playerId) : [],
      canDraw: canDrawNow(s, playerId),
      canPass: canPassNow(s, playerId),
      canAccept: isActor && s.pending !== null
    },
    winnerId: s.winner,
    log: s.log.slice(-LOG_VIEW)
  };
}

/* -------------------------------------------------------------------------- */
/* Validación de entrada                                                       */
/* -------------------------------------------------------------------------- */

function parseAction(raw: unknown): PolacoAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'play': {
      if (!Array.isArray(a.cards) || a.cards.length < 1 || a.cards.length > 52) return null;
      if (!a.cards.every(isCardId)) return null;
      const out: Extract<PolacoAction, { type: 'play' }> = { type: 'play', cards: [...(a.cards as CardId[])] };
      if (a.demandRank === null) out.demandRank = null;
      else if (typeof a.demandRank === 'string' && DEMAND_RANKS.includes(a.demandRank)) {
        out.demandRank = a.demandRank as DemandRank;
      } else if (a.demandRank !== undefined) return null;
      if (typeof a.demandSuit === 'string' && ['H', 'S', 'D', 'C'].includes(a.demandSuit)) {
        out.demandSuit = a.demandSuit as Suit;
      } else if (a.demandSuit !== undefined) return null;
      return out;
    }
    case 'draw':
    case 'pass':
    case 'accept':
      return { type: a.type };
    default:
      return null;
  }
}

function validate(playerCount: number, config: Record<string, number>): Msg | null {
  if (playerCount < MIN_PLAYERS) return msg('validate.minPlayers', { min: MIN_PLAYERS });
  if (playerCount > MAX_PLAYERS) return msg('validate.maxPlayers', { max: MAX_PLAYERS });
  const handSize = config.handSize ?? CONFIG[0].default;
  if (handSize * playerCount > MAX_DEALT) {
    return msg('validate.maxPerPlayer', { players: playerCount, max: Math.floor(MAX_DEALT / playerCount) });
  }
  return null;
}

export const polaco: RuleSet<PolacoState, PolacoAction, PolacoView> = {
  id: 'polaco',
  config: CONFIG,
  validate,
  createGame,
  parseAction,
  applyAction,
  removePlayer,
  getView,
  getStatus: (s) => ({ finished: s.winner !== null, winnerId: s.winner })
};

/** Reexportado para los tests. */
export { drawableCount, isPlayable, playableCards };
export type { Rank };
