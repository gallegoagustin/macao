import type { ActionResult, ConfigField, PlayerRef, RuleSet } from '../types';
import { type CardId, type Rank, type Suit, SUIT_GLYPH, cardLabel, isCardId, makeDeck, parseCard } from './cards';

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
  log: string[];
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
  log: string[];
}

/* -------------------------------------------------------------------------- */
/* Configuración                                                               */
/* -------------------------------------------------------------------------- */

const CONFIG: ConfigField[] = [
  {
    key: 'handSize',
    label: 'Cartas por jugador',
    help: 'Entre 3 y 10. Cartas por jugador × jugadores no puede pasar de 40.',
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
function log(s: PolacoState, msg: string): void {
  s.log.push(msg);
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

function illegalReason(ctx: PlayCtx, card: CardId): string {
  const { rank } = parseCard(card);
  const p = ctx.pending;
  if (p?.kind === 'king') {
    return `Solo puedes responder con ${cardLabel(oppositeKing(p.card))} o aceptar y robar 5.`;
  }
  if (p?.kind === 'skip') return 'Tienes un salto pendiente: tira un 4 o acepta perder el turno.';
  if (p?.kind === 'draw') return 'Tienes un robo pendiente: responde con un 2 o un 3, o acepta y roba.';
  if (ctx.drawn) return `Solo puedes jugar la carta que has robado (${cardLabel(ctx.drawn)}) o pasar.`;
  const d = ctx.demand;
  if (d?.kind === 'rank') {
    if (rank === 'Q') return 'No puedes tirar una Q bajo la demanda de una J.';
    return `Te exigen un ${d.rank}: tira un ${d.rank} (de cualquier palo) u otra J.`;
  }
  if (d?.kind === 'suit') {
    if (rank === 'Q') return `Bajo la demanda de una A, la única Q válida es la de ${SUIT_GLYPH[d.suit]}.`;
    return `Te exigen ${SUIT_GLYPH[d.suit]}: tira una carta de ese palo u otra A.`;
  }
  return `Esa carta no encaja con ${cardLabel(ctx.top)}: tiene que coincidir en palo o número.`;
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
      label: string;
    }
  | { ok: false; error: string };

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
  const fail = (error: string): PlayCheck => ({ ok: false, error });
  if (ctx.finished) return fail('La partida ha terminado.');
  if (!ctx.isActor) return fail('No es tu turno.');
  if (cards.length === 0) return fail('Elige al menos una carta.');
  if (new Set(cards).size !== cards.length) return fail('No puedes repetir una carta.');
  for (const c of cards) if (!ctx.hand.includes(c)) return fail('No tienes esa carta.');

  const first = cards[0];
  const last = cards[cards.length - 1];
  const win = cards.length === ctx.hand.length;
  const lastRank = parseCard(last).rank;
  const needsDemand = win ? null : lastRank === 'J' ? 'rank' : lastRank === 'A' ? 'suit' : null;

  if (cards.length === 1) {
    if (!isPlayableCtx(ctx, first)) return fail(illegalReason(ctx, first));
    return { ok: true, kind: 'single', last, needsDemand, label: 'Tirar' };
  }

  // ---- varias cartas ----
  const p = ctx.pending;
  if (p?.kind === 'king') return fail('Una K pendiente solo se responde con la K opuesta (una carta) o aceptando.');
  if (ctx.drawn) return fail(`Solo puedes jugar la carta que has robado (${cardLabel(ctx.drawn)}) o pasar.`);

  const ranks = cards.map((c) => parseCard(c).rank);
  const group = ranks.every((r) => r === ranks[0]);
  if (!group && !isStraightRanks(ranks)) {
    return fail('Varias cartas deben formar una escalera (números consecutivos) o un grupo del mismo número.');
  }
  if (!partial && cards.length < 3) {
    return fail('Para tirar varias cartas hacen falta al menos 3 (escalera o grupo del mismo número).');
  }

  if (p?.kind === 'draw' && !(group && (ranks[0] === '2' || ranks[0] === '3'))) {
    return fail('Con un robo pendiente solo responde un grupo de 2 o de 3 (o aceptar).');
  }
  if (p?.kind === 'skip' && !(group && ranks[0] === '4')) {
    return fail('Con un salto pendiente solo responde un grupo de 4 (o aceptar).');
  }

  if (!isPlayableCtx(ctx, first)) {
    if (group && cards.some((c) => isPlayableCtx(ctx, c))) {
      return fail('Pon primero la carta que encaja con la mesa.');
    }
    return fail(
      group || !partial
        ? `La primera carta debe poder tirarse sola. ${illegalReason(ctx, first)}`
        : illegalReason(ctx, first)
    );
  }

  const kind: PlayKind = group ? 'group' : 'straight';
  const label = group
    ? `Tirar ${cards.length === 3 ? 'trío' : 'grupo'} (${cards.length})`
    : `Tirar escalera (${cards.length})`;
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

const err = (error: string): ActionResult<PolacoState> => ({ ok: false, error });

function applyAction(state: PolacoState, playerId: string, action: PolacoAction, rng: Rng): ActionResult<PolacoState> {
  if (state.winner) return err('La partida ha terminado.');
  const s = clone(state);
  const pi = idxOf(s, playerId);
  if (pi < 0) return err('No estás en esta partida.');

  if (pi !== s.turn) {
    if (s.pending?.kind === 'king') {
      return err(`Esperando a que ${nameOf(s, s.pending.target)} responda a la K.`);
    }
    return err('No es tu turno.');
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
      return err('Acción no válida.');
  }
}

function describePlay(kind: PlayKind, cards: CardId[]): string {
  const labels = cards.map(cardLabel).join(' ');
  if (kind === 'straight') return `escalera ${labels}`;
  if (kind === 'group') return `${cards.length} cartas iguales ${labels}`;
  return labels;
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
  if (!check.ok) return err(check.error);

  const wasKingPending = s.pending?.kind === 'king';
  const last = check.last;
  const { rank } = parseCard(last);
  const willWin = cards.length === hand.length;

  // Validar la elección de J / A antes de mutar nada (si ganas con la jugada no hace falta).
  let demandRank: DemandRank | null = null;
  let demandSuit: Suit | null = null;
  if (!wasKingPending && !willWin) {
    if (rank === 'J') {
      if (action.demandRank === undefined) return err('Elige un número del 5 al 10 o «Nada».');
      if (action.demandRank !== null) {
        if (!DEMAND_RANKS.includes(action.demandRank)) return err('Solo puedes exigir un número del 5 al 10.');
        demandRank = action.demandRank;
      }
    }
    if (rank === 'A') {
      if (!action.demandSuit) return err('Elige el palo que quieres exigir.');
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
    log(s, `${me} tiró ${what} y se queda sin cartas: ¡gana!`);
    return { ok: true, state: s };
  }

  /* ---- Respuesta a una K (siempre una sola carta) ---- */
  if (wasKingPending && s.pending?.kind === 'king') {
    const k = s.pending;
    log(s, `${me} responde con ${cardLabel(last)}: ${nameOf(s, k.from)} roba 10`);
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
      log(s, `${me} tiró ${what}, salta ${count}`);
      endTurn(s, pi, next);
      return { ok: true, state: s };
    }
    case '2':
    case '3': {
      const add = (rank === '2' ? 2 : 3) * mult;
      const amount = (s.pending?.kind === 'draw' ? s.pending.amount : 0) + add;
      s.pending = { kind: 'draw', amount };
      log(s, `${me} tiró ${what}, +${amount} acumulado`);
      endTurn(s, pi, next);
      return { ok: true, state: s };
    }
    case 'J': {
      s.demand = null; // la nueva J reemplaza cualquier demanda (con número o con nada)
      endTurn(s, pi, next);
      if (demandRank) {
        s.demand = { kind: 'rank', rank: demandRank, by: pid, turnsLeft: n };
        log(s, `${me} tiró ${what} y exige un ${demandRank}`);
      } else {
        log(s, `${me} tiró ${what} sin exigir nada`);
      }
      return { ok: true, state: s };
    }
    case 'A': {
      s.demand = null;
      endTurn(s, pi, next);
      s.demand = { kind: 'suit', suit: demandSuit as Suit, by: pid, turnsLeft: n };
      log(s, `${me} tiró ${what} y exige ${SUIT_GLYPH[demandSuit as Suit]}`);
      return { ok: true, state: s };
    }
    case 'Q': {
      // Bajo una demanda (solo cabe la Q del palo exigido de una A) la demanda sigue su vuelta completa
      // y manda sobre la jugada libre; fuera de una demanda, la Q da jugada libre al siguiente.
      const underDemand = s.demand !== null;
      endTurn(s, pi, next);
      if (underDemand) {
        log(s, `${me} tiró ${what}`);
      } else {
        s.freePlay = true;
        log(s, `${me} tiró ${what}: ${nameOf(s, s.players[next].id)} tira lo que quiera`);
      }
      return { ok: true, state: s };
    }
    case 'K': {
      if (isRedKing(last) || isBlackKing(last)) {
        const targetIdx = isRedKing(last) ? nextIdx(s, pi) : prevIdx(s, pi);
        const target = s.players[targetIdx].id;
        s.pending = { kind: 'king', from: pid, target, card: last };
        s.turn = targetIdx;
        log(s, `${me} tiró ${what} contra ${nameOf(s, target)}: roba 5 o responde`);
        return { ok: true, state: s };
      }
      break; // K♣ y K♦ son cartas normales
    }
    default:
      break;
  }

  log(s, `${me} tiró ${what}`);
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
  if (s.pending) return err('Tienes algo pendiente: acepta para robar.');
  if (s.drawn) return err('Ya has robado en este turno: juega esa carta o pasa.');
  if (drawableCount(s) === 0) return err('No quedan cartas para robar.');

  const [card] = drawCards(s, pid, 1, rng);
  if (isPlayable(s, card)) {
    s.drawn = card;
    log(s, `${me} roba una carta`);
  } else {
    log(s, `${me} roba una carta y pasa`);
    endTurn(s, pi, nextIdx(s, pi));
  }
  return { ok: true, state: s };
}

function pass(s: PolacoState, pi: number): ActionResult<PolacoState> {
  const pid = s.players[pi].id;
  if (!canPassNow(s, pid)) return err('Solo puedes pasar después de robar una carta jugable.');
  log(s, `${s.players[pi].name} pasa`);
  endTurn(s, pi, nextIdx(s, pi));
  return { ok: true, state: s };
}

function accept(s: PolacoState, pi: number, rng: Rng): ActionResult<PolacoState> {
  const pid = s.players[pi].id;
  const me = s.players[pi].name;
  const p = s.pending;
  if (!p) return err('No hay nada que aceptar.');

  if (p.kind === 'skip') {
    p.count -= 1;
    log(s, `${me} acepta el salto y pierde el turno`);
    if (p.count <= 0) s.pending = null;
    endTurn(s, pi, nextIdx(s, pi));
    return { ok: true, state: s };
  }
  if (p.kind === 'draw') {
    s.pending = null;
    drawCards(s, pid, p.amount, rng);
    log(s, `${me} acepta y roba ${p.amount}, pierde el turno`);
    endTurn(s, pi, nextIdx(s, pi));
    return { ok: true, state: s };
  }
  log(s, `${me} acepta la K y roba 5`);
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
  log(s, `${name} abandona la partida`);
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
    log: [`Empieza ${players[starter].name}`]
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

function validate(playerCount: number, config: Record<string, number>): string | null {
  if (playerCount < MIN_PLAYERS) return 'Hacen falta al menos 2 jugadores.';
  if (playerCount > MAX_PLAYERS) return 'Máximo 8 jugadores.';
  const handSize = config.handSize ?? CONFIG[0].default;
  if (handSize * playerCount > MAX_DEALT) {
    return `Con ${playerCount} jugadores el máximo es ${Math.floor(MAX_DEALT / playerCount)} cartas por jugador.`;
  }
  return null;
}

export const polaco: RuleSet<PolacoState, PolacoAction, PolacoView> = {
  id: 'polaco',
  name: 'Polaco',
  description:
    'Baraja francesa de 52 cartas. 2 y 3 acumulan robo, 4 acumula salto, J exige un número, A exige un palo, Q es comodín, K♥ y K♠ atacan. Puedes tirar escaleras y grupos de 3 o más cartas. Quien se queda con 1 carta lo anuncia con un ¡Macao! automático.',
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
