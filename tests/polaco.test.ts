import { describe, expect, it } from 'vitest';
import { type CardId, makeDeck, parseCard } from '@/lib/rules/cards';
import {
  type PolacoAction,
  type PolacoState,
  checkPlay,
  ctxFromState,
  isSpecial,
  polaco,
  validatePlay
} from '@/lib/rules/polaco';
import type { Msg } from '@/lib/types';

/* ---------------------------- helpers de test ----------------------------- */

const NAMES = ['Ana', 'Bian', 'Cris', 'Dani', 'Eva', 'Fran', 'Gus', 'Hugo'];

interface Setup {
  n?: number;
  hands?: Record<number, CardId[]>;
  top?: CardId;
  turn?: number;
  deck?: CardId[];
  discardBelow?: CardId[];
  patch?: Partial<PolacoState>;
}

/** Construye un estado a mano. Los jugadores son p0..p{n-1}. */
function mk(o: Setup = {}): PolacoState {
  const n = o.n ?? 4;
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: NAMES[i] }));
  const hands: Record<string, CardId[]> = {};
  players.forEach((p, i) => {
    hands[p.id] = o.hands?.[i] ?? ['9C', '9D', '8C'];
  });
  const used = new Set<CardId>([...Object.values(hands).flat(), o.top ?? '7H', ...(o.discardBelow ?? [])]);
  const deck = o.deck ?? makeDeck().filter((c) => !used.has(c));
  return {
    players,
    hands,
    deck,
    discard: [...(o.discardBelow ?? []), o.top ?? '7H'],
    turn: o.turn ?? 0,
    starter: 0,
    pending: null,
    demand: null,
    freePlay: false,
    drawn: null,
    winner: null,
    log: [],
    ...o.patch
  };
}

function act(s: PolacoState, pid: number, a: PolacoAction, rng = seqRng(1)): PolacoState {
  const r = polaco.applyAction(s, `p${pid}`, a, rng);
  if (!r.ok) throw new Error(`Acción rechazada: ${r.error.code}`);
  return r.state;
}
function failMsg(s: PolacoState, pid: number, a: PolacoAction): Msg {
  const r = polaco.applyAction(s, `p${pid}`, a, seqRng(1));
  if (r.ok) throw new Error('Se esperaba un rechazo');
  return r.error;
}
function fail(s: PolacoState, pid: number, a: PolacoAction): string {
  return failMsg(s, pid, a).code;
}
/** Código del motivo cuando el rechazo envuelve otro (`rule.firstMustPlay`). */
function failReason(s: PolacoState, pid: number, a: PolacoAction): string {
  const m = failMsg(s, pid, a);
  return m.code === 'rule.firstMustPlay' ? (m.params?.reason as Msg).code : m.code;
}
type PlayExtra = { demandRank?: '5' | '6' | '7' | '8' | '9' | '10' | null; demandSuit?: 'H' | 'S' | 'D' | 'C' };
const play = (card: CardId | CardId[], extra: PlayExtra = {}): PolacoAction => ({
  type: 'play',
  cards: Array.isArray(card) ? card : [card],
  ...extra
});
const turnOf = (s: PolacoState) => s.turn;
const top = (s: PolacoState) => s.discard[s.discard.length - 1];

function seqRng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------- Básico ----------------------------------- */

describe('jugada normal', () => {
  it('acepta palo o número y rechaza lo demás', () => {
    const s = mk({ top: '7H', hands: { 0: ['7S', 'KH', '9C', '5C'] } });
    expect(polaco.getView(s, 'p0').legal.plays.sort()).toEqual(['7S', 'KH'].sort());
    expect(fail(s, 0, play('9C'))).toBe('rule.noFit');
    const s2 = act(s, 0, play('7S'));
    expect(top(s2)).toBe('7S');
    expect(turnOf(s2)).toBe(1);
    const s3 = act(mk({ top: '7H', hands: { 0: ['7S', 'KH', '9C', '5C'] } }), 0, play('KH'));
    expect(top(s3)).toBe('KH');
  });

  it('rechaza jugar fuera de turno y cartas que no tienes', () => {
    const s = mk({ top: '7H' });
    expect(fail(s, 1, play('9C'))).toBe('rule.notYourTurn');
    expect(fail(s, 0, play('5H'))).toBe('rule.notInHand');
  });
});

describe('robar', () => {
  it('robo voluntario: se puede robar aunque haya jugadas legales', () => {
    const s = mk({ top: '7H', hands: { 0: ['7S', '9C'] }, deck: ['5D', '6C'] });
    expect(polaco.getView(s, 'p0').legal.canDraw).toBe(true);
    const r = act(s, 0, { type: 'draw' });
    expect(r.hands.p0).toHaveLength(3);
    expect(r.hands.p0).toContain('6C');
    expect(turnOf(r)).toBe(1); // la robada no encaja: el turno pasa
  });

  it('robo voluntario con jugada legal: si la robada es jugable, solo esa carta o pasar', () => {
    const s = mk({ top: '7H', hands: { 0: ['7S', '9C'] }, deck: ['5D', 'KH'] });
    const r = act(s, 0, { type: 'draw' });
    expect(r.drawn).toBe('KH');
    expect(turnOf(r)).toBe(0);
    expect(polaco.getView(r, 'p0').legal.plays).toEqual(['KH']);
    expect(fail(r, 0, play('7S'))).toBe('rule.drawnOnly');
    expect(fail(r, 0, play(['KH', '7S', '9C']))).toBeTruthy();
    expect(act(r, 0, play('KH')).pending?.kind).toBe('king');
  });

  it('no se puede robar con un pending (aceptar es el robo)', () => {
    const s = mk({ top: '2H', hands: { 0: ['9S', '9C'] }, patch: { pending: { kind: 'draw', amount: 2 } } });
    expect(polaco.getView(s, 'p0').legal.canDraw).toBe(false);
    expect(fail(s, 0, { type: 'draw' })).toBe('rule.drawPendingAccept');
  });

  it('robar voluntariamente y pasar no hereda la jugada libre de una Q', () => {
    let s = mk({ top: '7H', hands: { 0: ['QC', '9C'], 1: ['5S', '9D'] }, deck: ['8D', 'KH'] });
    s = act(s, 0, play('QC'));
    expect(s.freePlay).toBe(true);
    s = act(s, 1, { type: 'draw' }); // roba KH, jugable por jugada libre
    expect(s.drawn).toBe('KH');
    s = act(s, 1, { type: 'pass' });
    expect(s.freePlay).toBe(false);
  });

  it('si la carta robada no se puede jugar, el turno pasa solo', () => {
    const s = mk({ top: '7H', hands: { 0: ['9S', '9C'] }, deck: ['5D', '5C'] });
    const r = act(s, 0, { type: 'draw' }); // roba 5C: no encaja con 7H
    expect(r.hands.p0).toContain('5C');
    expect(turnOf(r)).toBe(1);
    expect(r.drawn).toBeNull();
  });

  it('si la carta robada se puede jugar: se juega esa carta o se pasa', () => {
    const s = mk({ top: '7H', hands: { 0: ['9S', '9C'] }, deck: ['5D', 'KH'] });
    const r = act(s, 0, { type: 'draw' }); // roba KH: encaja por palo
    expect(turnOf(r)).toBe(0);
    expect(r.drawn).toBe('KH');
    expect(polaco.getView(r, 'p0').legal.plays).toEqual(['KH']);
    expect(fail(r, 0, play('9S'))).toBe('rule.drawnOnly');
    expect(fail(r, 0, { type: 'draw' })).toBe('rule.alreadyDrew');
    const played = act(r, 0, play('KH'));
    expect(top(played)).toBe('KH');
    const passed = act(r, 0, { type: 'pass' });
    expect(turnOf(passed)).toBe(1);
    expect(passed.hands.p0).toContain('KH');
  });

  it('no se puede pasar sin haber robado', () => {
    const s = mk({ top: '7H', hands: { 0: ['9S', '9C'] } });
    expect(fail(s, 0, { type: 'pass' })).toBe('rule.passOnly');
  });

  it('mazo vacío: se remezcla el descarte menos la carta de arriba', () => {
    const s = mk({
      top: '7H',
      hands: { 0: ['9S', '9C'] },
      deck: [],
      discardBelow: ['5D', '6D', '8D', '10D']
    });
    const r = act(s, 0, { type: 'draw' });
    expect(r.hands.p0).toHaveLength(3);
    expect(top(r)).toBe('7H');
    expect(r.discard).toEqual(['7H']);
    expect(r.deck.length).toBe(3); // 4 remezcladas, 1 robada
    // Es determinista con la misma semilla
    expect(act(s, 0, { type: 'draw' })).toEqual(r);
  });

  it('si no alcanza ni con el descarte, se roba lo que haya', () => {
    const s = mk({
      top: '2H',
      hands: { 0: ['9S', '9C'] },
      deck: ['5D'],
      patch: { pending: { kind: 'draw', amount: 7 } }
    });
    const r = act(s, 0, { type: 'accept' });
    expect(r.hands.p0).toHaveLength(3); // solo había 1 carta
    expect(r.pending).toBeNull();
  });
});

/* ------------------------- 2 y 3: robo acumulable ------------------------- */

describe('robo acumulable (2 y 3)', () => {
  it('cadena 2+3+2 y el siguiente acepta 7', () => {
    let s = mk({ top: '7H', hands: { 0: ['2H', '9C'], 1: ['3S', '9S'], 2: ['2D', '9D'], 3: ['8S', '8H', '8D'] } });
    s = act(s, 0, play('2H'));
    expect(s.pending).toEqual({ kind: 'draw', amount: 2 });
    s = act(s, 1, play('3S'));
    expect(s.pending).toEqual({ kind: 'draw', amount: 5 });
    s = act(s, 2, play('2D'));
    expect(s.pending).toEqual({ kind: 'draw', amount: 7 });
    expect(turnOf(s)).toBe(3);
    const before = s.hands.p3.length;
    s = act(s, 3, { type: 'accept' });
    expect(s.hands.p3).toHaveLength(before + 7);
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0); // pierde el turno
  });

  it('se puede responder a un 2 con un 3 de otro palo', () => {
    let s = mk({ top: '7H', hands: { 0: ['2H', '9C'], 1: ['3C', '9S'] } });
    s = act(s, 0, play('2H'));
    expect(top(s)).toBe('2H');
    s = act(s, 1, play('3C'));
    expect(s.pending).toEqual({ kind: 'draw', amount: 5 });
  });

  it('bajo robo pendiente solo valen 2 y 3 (ni Q, ni K, ni 4, ni carta normal)', () => {
    const s = mk({
      top: '2H',
      hands: { 0: ['QH', 'KH', '4H', '9H', '3S'] },
      patch: { pending: { kind: 'draw', amount: 2 } }
    });
    expect(fail(s, 0, play('QH'))).toBe('rule.drawPending');
    expect(fail(s, 0, play('KH'))).toBe('rule.drawPending');
    expect(fail(s, 0, play('4H'))).toBe('rule.drawPending');
    expect(fail(s, 0, play('9H'))).toBe('rule.drawPending');
    expect(fail(s, 0, { type: 'draw' })).toBeTruthy();
    expect(polaco.getView(s, 'p0').legal.plays).toEqual(['3S']);
  });
});

/* ------------------------------- 4: salto --------------------------------- */

describe('salto acumulable (4)', () => {
  it('ejemplo con 4 jugadores: A 4, B 4, C acepta, D acepta, A juega normal', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['4H', '5S', '8H'], 1: ['4S', '9S'], 2: ['9D', '8D'], 3: ['9C', '8C'] }
    });
    s = act(s, 0, play('4H'));
    expect(s.pending).toEqual({ kind: 'skip', count: 1 });
    expect(turnOf(s)).toBe(1);
    s = act(s, 1, play('4S')); // otro palo
    expect(s.pending).toEqual({ kind: 'skip', count: 2 });
    expect(turnOf(s)).toBe(2);
    s = act(s, 2, { type: 'accept' });
    expect(s.pending).toEqual({ kind: 'skip', count: 1 });
    expect(turnOf(s)).toBe(3);
    s = act(s, 3, { type: 'accept' });
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0);
    s = act(s, 0, play('5S')); // juega normal sobre el 4♠
    expect(top(s)).toBe('5S');
  });

  it('bajo salto pendiente solo se puede tirar un 4 o aceptar', () => {
    const s = mk({
      top: '4H',
      hands: { 0: ['9H', 'QH', '4C'] },
      patch: { pending: { kind: 'skip', count: 1 } }
    });
    expect(fail(s, 0, play('9H'))).toBe('rule.skipPending');
    expect(fail(s, 0, play('QH'))).toBe('rule.skipPending');
    expect(fail(s, 0, { type: 'draw' })).toBeTruthy();
  });

  it('con 2 jugadores: A tira 4, B acepta y A vuelve a jugar', () => {
    let s = mk({ n: 2, top: '7H', hands: { 0: ['4H', '9H'], 1: ['9S', '8S'] } });
    s = act(s, 0, play('4H'));
    expect(turnOf(s)).toBe(1);
    s = act(s, 1, { type: 'accept' });
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0);
  });

  it('con 2 jugadores: 4 contra 4 acumula y se resuelve', () => {
    let s = mk({ n: 2, top: '7H', hands: { 0: ['4H', '9H', '8H'], 1: ['4S', '9S'] } });
    s = act(s, 0, play('4H'));
    s = act(s, 1, play('4S'));
    expect(s.pending).toEqual({ kind: 'skip', count: 2 });
    s = act(s, 0, { type: 'accept' }); // 1
    expect(turnOf(s)).toBe(1);
    s = act(s, 1, { type: 'accept' }); // 0
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0);
  });
});

/* ------------------------------ Q comodín --------------------------------- */

describe('Q (comodín)', () => {
  it('se puede tirar sobre cualquier carta y da jugada libre al siguiente', () => {
    let s = mk({ top: '7H', hands: { 0: ['QC', '9C'], 1: ['5S', '9D'] } });
    expect(polaco.getView(s, 'p0').legal.plays).toContain('QC');
    s = act(s, 0, play('QC'));
    expect(s.freePlay).toBe(true);
    expect(polaco.getView(s, 'p1').legal.plays.sort()).toEqual(['5S', '9D']);
    s = act(s, 1, play('5S'));
    expect(s.freePlay).toBe(false);
  });

  it('rechazada sobre una cadena de robo, un salto o una K', () => {
    const base = { top: '2H' as CardId, hands: { 0: ['QH', 'QS', '3S'] as CardId[] } };
    expect(fail(mk({ ...base, patch: { pending: { kind: 'draw', amount: 2 } } }), 0, play('QH'))).toBe(
      'rule.drawPending'
    );
    expect(fail(mk({ ...base, patch: { pending: { kind: 'skip', count: 1 } } }), 0, play('QH'))).toBe(
      'rule.skipPending'
    );
    const k = mk({
      top: 'KH',
      hands: { 0: ['QH', 'KS'] },
      turn: 0,
      patch: { pending: { kind: 'king', from: 'p3', target: 'p0', card: 'KH' } }
    });
    expect(fail(k, 0, play('QH'))).toBe('rule.kingOnlyRespond');
  });
});

/* -------------------------------- J --------------------------------------- */

describe('J (exige un número)', () => {
  it('J con número: solo se juega ese número u otra J; cumplir levanta la exigencia en su turno', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['JH', '9C'], 1: ['9S', '5D', '8S'], 2: ['8D', '8C'], 3: ['JC', '5C'] }
    });
    s = act(s, 0, play('JH', { demandRank: '9' }));
    expect(s.demand).toEqual({ kind: 'rank', rank: '9', by: 'p0', turnsLeft: 4 });
    expect(failMsg(s, 1, play('5D'))).toEqual({ code: 'rule.demandRank', params: { rank: '9' } });
    expect(polaco.getView(s, 'p1').legal.plays.sort()).toEqual(['9S']);
    s = act(s, 1, play('9S')); // cumple
    expect(top(s)).toBe('9S');
    expect(s.demand?.turnsLeft).toBe(3);
  });

  it('J sobre J reemplaza la demanda y reinicia turnsLeft', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['JH', '9C'], 1: ['JS', '5D'], 2: ['8D', '8C'], 3: ['9S', '5C'] }
    });
    s = act(s, 0, play('JH', { demandRank: '9' }));
    s = act(s, 1, play('JS', { demandRank: '6' }));
    expect(s.demand).toEqual({ kind: 'rank', rank: '6', by: 'p1', turnsLeft: 4 });
  });

  it('J con «Nada» es carta normal y limpia la demanda previa', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['JH', '9C'], 1: ['JS', '5D'], 2: ['8D', '8C'], 3: ['9S', '5C'] }
    });
    s = act(s, 0, play('JH', { demandRank: '9' }));
    s = act(s, 1, play('JS', { demandRank: null }));
    expect(s.demand).toBeNull();
    // Y sobre una J "nada" se juega normal (palo ♠ o J)
    expect(polaco.getView(s, 'p2').legal.plays).toEqual([]);
  });

  it('hay que elegir número o «Nada» al tirar una J', () => {
    const s = mk({ top: '7H', hands: { 0: ['JH', '9C'] } });
    expect(fail(s, 0, play('JH'))).toBe('rule.pickRank');
    expect(fail(s, 0, play('JH', { demandRank: '4' as never }))).toBeTruthy();
  });

  it('Q bloqueada bajo demanda de J', () => {
    let s = mk({ top: '7H', hands: { 0: ['JH', '9C'], 1: ['QH', '9S'] } });
    s = act(s, 0, play('JH', { demandRank: '9' }));
    expect(fail(s, 1, play('QH'))).toBe('rule.noQUnderJ');
  });

  it('quien no puede cumplir roba 1 y puede jugar la robada si cumple', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['JH', '9C'], 1: ['5D', '6D'], 2: ['8D', '8C'] },
      n: 3,
      deck: ['8S', '9D'] // se roba 9D primero (tope = final)
    });
    s = act(s, 0, play('JH', { demandRank: '9' }));
    expect(polaco.getView(s, 'p1').legal.canDraw).toBe(true);
    s = act(s, 1, { type: 'draw' });
    expect(s.drawn).toBe('9D');
    s = act(s, 1, play('9D'));
    expect(top(s)).toBe('9D');
  });

  it('la demanda caduca tras una vuelta y quien la tiró también tiene que cumplirla', () => {
    // 3 jugadores. Nadie puede cumplir salvo el que tiró la J.
    let s = mk({
      n: 3,
      top: '7H',
      hands: { 0: ['JH', '9C', '9D'], 1: ['5D', '6D'], 2: ['5S', '6S'] },
      deck: ['8C', '8D', '8S', '10C', '10D', '10S']
    });
    s = act(s, 0, play('JH', { demandRank: '9' })); // turnsLeft 3
    s = act(s, 1, { type: 'draw' }); // roba 10S: no cumple, pasa → 2
    expect(s.demand?.turnsLeft).toBe(2);
    s = act(s, 2, { type: 'draw' }); // → 1
    expect(s.demand?.turnsLeft).toBe(1);
    expect(turnOf(s)).toBe(0);
    // El que tiró la J tiene que cumplir su propia demanda
    expect(fail(s, 0, play('JH' as CardId))).toBeTruthy(); // ya no tiene la J
    expect(polaco.getView(s, 'p0').legal.plays.sort()).toEqual(['9C', '9D']);
    s = act(s, 0, play('9C'));
    expect(s.demand).toBeNull(); // una vuelta completa: ya caducó
    expect(turnOf(s)).toBe(1);
    // Ahora se juega normal sobre el 9♣
    const v = polaco.getView(s, 'p1');
    expect(v.legal.plays.every((c) => parseCard(c).suit === 'C' || parseCard(c).rank === '9')).toBe(true);
  });
});

/* -------------------------------- A --------------------------------------- */

describe('A (exige un palo)', () => {
  it('A con palo: solo ese palo u otra A', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['AH', '9C'], 1: ['5D', '5S', 'AC', '9H'], 2: ['8S', '8C'] },
      n: 3
    });
    s = act(s, 0, play('AH', { demandSuit: 'S' }));
    expect(s.demand).toEqual({ kind: 'suit', suit: 'S', by: 'p0', turnsLeft: 3 });
    expect(polaco.getView(s, 'p1').legal.plays.sort()).toEqual(['5S', 'AC']);
    expect(fail(s, 1, play('9H'))).toMatch(/^rule\.demand(Rank|Suit)$/);
  });

  it('hay que elegir palo', () => {
    const s = mk({ top: '7H', hands: { 0: ['AH', '9C'] } });
    expect(fail(s, 0, play('AH'))).toBe('rule.pickSuit');
  });

  it('A sobre A reemplaza la demanda', () => {
    let s = mk({ top: '7H', hands: { 0: ['AH', '9C'], 1: ['AC', '9S'] } });
    s = act(s, 0, play('AH', { demandSuit: 'S' }));
    s = act(s, 1, play('AC', { demandSuit: 'D' }));
    expect(s.demand).toEqual({ kind: 'suit', suit: 'D', by: 'p1', turnsLeft: 4 });
  });

  it('solo la Q del palo exigido es válida bajo A', () => {
    let s = mk({ top: '7H', hands: { 0: ['AH', '9C'], 1: ['QH', 'QS', '5S'] } });
    s = act(s, 0, play('AH', { demandSuit: 'S' }));
    expect(fail(s, 1, play('QH'))).toBe('rule.qUnderAce');
    s = act(s, 1, play('QS'));
    expect(s.freePlay).toBe(false);
    expect(s.demand?.kind).toBe('suit');
  });

  it('una especial del palo exigido aplica su efecto', () => {
    let s = mk({ top: '7H', hands: { 0: ['AH', '9C'], 1: ['2S', '9S'], 2: ['8S', '8C'] }, n: 3 });
    s = act(s, 0, play('AH', { demandSuit: 'S' }));
    s = act(s, 1, play('2S'));
    expect(s.pending).toEqual({ kind: 'draw', amount: 2 });
    expect(turnOf(s)).toBe(2);
    // Y una K♠ del palo exigido genera su pending
    let k = mk({ top: '7H', hands: { 0: ['AH', '9C'], 1: ['KS', '9S'], 2: ['8S', '8C'] }, n: 3 });
    k = act(k, 0, play('AH', { demandSuit: 'S' }));
    k = act(k, 1, play('KS'));
    expect(k.pending).toEqual({ kind: 'king', from: 'p1', target: 'p0', card: 'KS' });
  });
});

/* -------------------------------- K --------------------------------------- */

describe('K de corazones / picas', () => {
  /** K♥ de p0 y respuestas, con n jugadores. */
  function kingGame(n: number, card: 'KH' | 'KS') {
    const opposite: CardId = card === 'KH' ? 'KS' : 'KH';
    const hands: Record<number, CardId[]> = {};
    for (let i = 0; i < n; i++) hands[i] = ['9C', '9D', '8C'];
    hands[0] = [card, '9C', '9D'];
    const target = card === 'KH' ? 1 % n : (n - 1) % n;
    hands[target] = [...hands[target], opposite];
    const top: CardId = card === 'KH' ? '7H' : '7S';
    return { s: mk({ n, top, hands }), target };
  }

  it('K♥ aceptada (4 jug.): objetivo roba 5 y pierde turno → next(next(p))', () => {
    const { s: s0 } = kingGame(4, 'KH');
    let s = act(s0, 0, play('KH'));
    expect(s.pending).toEqual({ kind: 'king', from: 'p0', target: 'p1', card: 'KH' });
    expect(turnOf(s)).toBe(1);
    expect(failMsg(s, 2, { type: 'accept' })).toEqual({ code: 'rule.waitingKing', params: { name: 'Bian' } });
    const before = s.hands.p1.length;
    s = act(s, 1, { type: 'accept' });
    expect(s.hands.p1).toHaveLength(before + 5);
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(2);
    expect(top(s)).toBe('KH');
  });

  it('K♥ respondida con K♠ (4 jug.): p roba 10, turno next(target)', () => {
    const { s: s0 } = kingGame(4, 'KH');
    let s = act(s0, 0, play('KH'));
    const before = s.hands.p0.length;
    s = act(s, 1, play('KS'));
    expect(s.hands.p0).toHaveLength(before + 10);
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(2);
    expect(top(s)).toBe('KS');
  });

  it('K♠ aceptada (4 jug.): el objetivo (prev) roba 5, turno next(p)', () => {
    const { s: s0 } = kingGame(4, 'KS');
    let s = act(s0, 0, play('KS'));
    expect(s.pending).toEqual({ kind: 'king', from: 'p0', target: 'p3', card: 'KS' });
    expect(turnOf(s)).toBe(3); // actúa el objetivo aunque no sea su turno
    const before = s.hands.p3.length;
    s = act(s, 3, { type: 'accept' });
    expect(s.hands.p3).toHaveLength(before + 5);
    expect(turnOf(s)).toBe(1);
  });

  it('K♠ respondida con K♥ (4 jug.): p roba 10 y se avanza uno', () => {
    const { s: s0 } = kingGame(4, 'KS');
    let s = act(s0, 0, play('KS'));
    const before = s.hands.p0.length;
    s = act(s, 3, play('KH'));
    expect(s.hands.p0).toHaveLength(before + 10);
    expect(turnOf(s)).toBe(1); // p0 es el loser: next(p0)
    expect(top(s)).toBe('KH');
  });

  it('2 jugadores: K♥ aceptada → vuelve a jugar p', () => {
    const { s: s0 } = kingGame(2, 'KH');
    let s = act(s0, 0, play('KH'));
    s = act(s, 1, { type: 'accept' });
    expect(turnOf(s)).toBe(0);
  });

  it('2 jugadores: K♥ respondida con K♠ → juega el objetivo (p es el loser)', () => {
    const { s: s0 } = kingGame(2, 'KH');
    let s = act(s0, 0, play('KH'));
    s = act(s, 1, play('KS'));
    expect(s.hands.p0.length).toBeGreaterThanOrEqual(12);
    expect(turnOf(s)).toBe(1);
  });

  it('2 jugadores: K♠ aceptada → vuelve a jugar p', () => {
    const { s: s0 } = kingGame(2, 'KS');
    let s = act(s0, 0, play('KS'));
    expect(s.pending).toMatchObject({ target: 'p1' });
    s = act(s, 1, { type: 'accept' });
    expect(turnOf(s)).toBe(0);
  });

  it('2 jugadores: K♠ respondida con K♥ → juega el objetivo', () => {
    const { s: s0 } = kingGame(2, 'KS');
    let s = act(s0, 0, play('KS'));
    s = act(s, 1, play('KH'));
    expect(turnOf(s)).toBe(1);
  });

  it('ni Q, ni 2, 3 o 4, ni la misma K responden a una K', () => {
    const s = mk({
      top: 'KH',
      turn: 1,
      hands: { 1: ['QH', '2H', '3H', '4H', 'KH', 'KS'] },
      patch: { pending: { kind: 'king', from: 'p0', target: 'p1', card: 'KH' } }
    });
    for (const c of ['QH', '2H', '3H', '4H', 'KH'] as CardId[]) {
      expect(failMsg(s, 1, play(c))).toEqual({ code: 'rule.kingOnlyRespond', params: { card: 'KS' } });
    }
    expect(polaco.getView(s, 'p1').legal.plays).toEqual(['KS']);
    expect(polaco.getView(s, 'p1').legal.canAccept).toBe(true);
  });

  it('K♣ y K♦ son cartas normales', () => {
    let s = mk({ top: '7C', hands: { 0: ['KC', '9C'] } });
    s = act(s, 0, play('KC'));
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(1);
  });

  it('K♥ solo se tira con corazones u otra K', () => {
    const s = mk({ top: '7S', hands: { 0: ['KH', '9C'] } });
    expect(fail(s, 0, play('KH'))).toBe('rule.noFit');
    const s2 = mk({ top: 'KC', hands: { 0: ['KH', '9C'] } });
    expect(act(s2, 0, play('KH')).pending?.kind).toBe('king');
  });
});

/* ------------------------- Carta inicial y reparto ------------------------ */

describe('createGame', () => {
  it('la carta inicial nunca es especial (muchas semillas)', () => {
    const players = NAMES.slice(0, 4).map((name, i) => ({ id: `p${i}`, name }));
    for (let seed = 1; seed <= 300; seed++) {
      const s = polaco.createGame(players, { handSize: 5 }, seqRng(seed));
      expect(isSpecial(s.discard[0])).toBe(false);
      for (const p of players) expect(s.hands[p.id]).toHaveLength(5);
      expect(s.deck.length + s.discard.length + 20).toBe(52);
      expect(new Set([...s.deck, ...s.discard, ...Object.values(s.hands).flat()]).size).toBe(52);
    }
  });

  it('incluso con 40 cartas repartidas siempre hay carta inicial no especial', () => {
    const players = NAMES.slice(0, 8).map((name, i) => ({ id: `p${i}`, name }));
    for (let seed = 1; seed <= 100; seed++) {
      const s = polaco.createGame(players, { handSize: 5 }, seqRng(seed));
      expect(isSpecial(s.discard[0])).toBe(false);
    }
  });

  it('una carta especial en el tope se devuelve al mazo y se remezcla (determinista)', () => {
    const players = NAMES.slice(0, 2).map((name, i) => ({ id: `p${i}`, name }));
    const a = polaco.createGame(players, { handSize: 5 }, seqRng(7));
    const b = polaco.createGame(players, { handSize: 5 }, seqRng(7));
    expect(a).toEqual(b);
    const c = polaco.createGame(players, { handSize: 5 }, seqRng(8));
    expect(c).not.toEqual(a);
  });

  it('revancha: empieza el siguiente al que empezó la anterior', () => {
    const players = NAMES.slice(0, 4).map((name, i) => ({ id: `p${i}`, name }));
    const g1 = polaco.createGame(players, { handSize: 5 }, seqRng(3));
    const g2 = polaco.createGame(players, { handSize: 5 }, seqRng(4), g1);
    expect(g2.starter).toBe((g1.starter + 1) % 4);
    expect(g2.turn).toBe(g2.starter);
  });

  it('validación: 2-8 jugadores y cartas × jugadores <= 40', () => {
    expect(polaco.validate?.(1, { handSize: 5 })).toEqual({ code: 'validate.minPlayers', params: { min: 2 } });
    expect(polaco.validate?.(9, { handSize: 3 })).toEqual({ code: 'validate.maxPlayers', params: { max: 8 } });
    expect(polaco.validate?.(8, { handSize: 6 })).toEqual({
      code: 'validate.maxPerPlayer',
      params: { players: 8, max: 5 }
    });
    expect(polaco.validate?.(8, { handSize: 5 })).toBeNull();
    expect(polaco.validate?.(4, { handSize: 10 })).toBeNull();
    expect(polaco.validate?.(5, { handSize: 9 })).toEqual({
      code: 'validate.maxPerPlayer',
      params: { players: 5, max: 8 }
    });
  });
});

/* ------------------------- Macao (solo indicador) -------------------------- */

describe('Macao automático', () => {
  it('no hay acciones ni estado de Macao: quedarse con 1 carta no cambia las reglas', () => {
    expect(polaco.parseAction({ type: 'declareMacao' })).toBeNull();
    expect(polaco.parseAction({ type: 'denounce', targetId: 'p0' })).toBeNull();
    let s = mk({ top: '7H', hands: { 0: ['7S', '9C'], 1: ['5D', '6D'] }, n: 3 });
    s = act(s, 0, play('7S')); // a p0 le queda 1 carta
    expect(s.hands.p0).toHaveLength(1);
    expect(s).not.toHaveProperty('macao');
    const v = polaco.getView(s, 'p1');
    expect(v.players.find((p) => p.id === 'p0')?.cards).toBe(1); // la UI deriva el badge de aquí
    expect(Object.keys(v.legal).sort()).toEqual(['canAccept', 'canDraw', 'canPass', 'plays']);
    expect(v.players[0]).not.toHaveProperty('vulnerable');
    expect(v.players[0]).not.toHaveProperty('declared');
  });
});

/* -------------------------------- Victoria -------------------------------- */

describe('victoria', () => {
  it('gana quien se queda sin cartas, incluso con una especial (efecto ignorado)', () => {
    let s = mk({ top: '7H', hands: { 0: ['2H'], 1: ['5D', '6D'] } });
    s = act(s, 0, play('2H'));
    expect(s.winner).toBe('p0');
    expect(s.pending).toBeNull();
    expect(polaco.getStatus(s)).toEqual({ finished: true, winnerId: 'p0' });
    expect(fail(s, 1, play('5D'))).toBe('rule.gameOver');
  });

  it('ganar con una J no exige elegir número', () => {
    const s = act(mk({ top: '7H', hands: { 0: ['JH'] } }), 0, play('JH'));
    expect(s.winner).toBe('p0');
  });

  it('ganar con la K opuesta como respuesta', () => {
    const s = mk({
      top: 'KH',
      turn: 1,
      hands: { 1: ['KS'] },
      patch: { pending: { kind: 'king', from: 'p0', target: 'p1', card: 'KH' } }
    });
    expect(act(s, 1, play('KS')).winner).toBe('p1');
  });
});

/* ------------------------------ Pureza y vistas --------------------------- */

describe('pureza y vistas', () => {
  it('applyAction no muta el estado de entrada', () => {
    const s = mk({ top: '7H', hands: { 0: ['7S', '9C'] } });
    const snapshot = structuredClone(s);
    act(s, 0, play('7S'));
    fail(s, 0, play('9C'));
    expect(s).toEqual(snapshot);
  });

  it('la vista no expone el mazo ni las manos ajenas', () => {
    const s = mk({ top: '7H', hands: { 0: ['7S', '9C'], 1: ['5D', '6D'] } });
    const v = polaco.getView(s, 'p0');
    const json = JSON.stringify(v);
    expect(v.hand).toEqual(['7S', '9C']);
    expect(json).not.toContain('5D');
    expect(json).not.toContain('6D');
    expect(v.players.find((p) => p.id === 'p1')?.cards).toBe(2);
    expect(v).not.toHaveProperty('deck');
    expect(v).not.toHaveProperty('hands');
    expect(JSON.stringify(v)).not.toContain('seed');
    expect(v.deckCount).toBe(s.deck.length);
  });

  it('parseAction valida el JSON de entrada', () => {
    expect(polaco.parseAction({ type: 'play', cards: ['7S'] })).toEqual({ type: 'play', cards: ['7S'] });
    expect(polaco.parseAction({ type: 'play', cards: ['7S', '8S', '9S'] })).toEqual({
      type: 'play',
      cards: ['7S', '8S', '9S']
    });
    expect(polaco.parseAction({ type: 'play', cards: ['ZZ'] })).toBeNull();
    expect(polaco.parseAction({ type: 'play', cards: [] })).toBeNull();
    expect(polaco.parseAction({ type: 'play', card: '7S' })).toBeNull();
    expect(polaco.parseAction({ type: 'play', cards: ['JH'], demandRank: '7' })).toEqual({
      type: 'play',
      cards: ['JH'],
      demandRank: '7'
    });
    expect(polaco.parseAction({ type: 'play', cards: ['JH'], demandRank: '3' })).toBeNull();
    expect(polaco.parseAction({ type: 'nope' })).toBeNull();
    expect(polaco.parseAction(null)).toBeNull();
    expect(polaco.parseAction({ type: 'declareMacao' })).toBeNull();
  });

  it('fuzz: partidas completas con jugadas, combos, robos voluntarios y abandonos conservan las 52 cartas', () => {
    const players = NAMES.slice(0, 5).map((name, i) => ({ id: `p${i}`, name }));
    let combos = 0;
    let leaves = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seqRng(seed * 101);
      let s = polaco.createGame(players, { handSize: 6 }, rng);
      for (let step = 0; step < 3000 && !s.winner; step++) {
        const pid = s.players[s.turn].id;
        const v = polaco.getView(s, pid);
        let a: PolacoAction;
        const r = rng();
        if (r < 0.03 && s.players.length > 2) {
          const leaver = s.players[Math.floor(rng() * s.players.length)].id;
          s = polaco.removePlayer(s, leaver, rng);
          leaves++;
        } else {
          const options = candidatePlays(s, pid);
          if (options.length && r < 0.9) {
            const cards = options[Math.floor(rng() * options.length)];
            if (cards.length > 1) combos++;
            const lastRank = parseCard(cards[cards.length - 1]).rank;
            a = {
              type: 'play',
              cards,
              demandRank: lastRank === 'J' ? '7' : undefined,
              demandSuit: lastRank === 'A' ? 'H' : undefined
            };
          } else if (v.legal.canAccept) a = { type: 'accept' };
          else if (v.legal.canDraw) a = { type: 'draw' };
          else if (options.length) a = { type: 'play', cards: options[0], demandRank: null, demandSuit: 'H' };
          else a = { type: 'pass' };
          const res = polaco.applyAction(s, pid, a, rng);
          expect(res.ok, JSON.stringify([seed, step, a, res])).toBe(true);
          if (res.ok) s = res.state;
        }
        const total = s.deck.length + s.discard.length + Object.values(s.hands).reduce((n, h) => n + h.length, 0);
        expect(total).toBe(52);
        expect(Object.keys(s.hands).sort()).toEqual(s.players.map((p) => p.id).sort());
        expect(s.turn).toBeGreaterThanOrEqual(0);
        expect(s.turn).toBeLessThan(s.players.length);
        if (s.pending?.kind === 'king') expect(s.players[s.turn].id).toBe(s.pending.target);
      }
    }
    expect(combos).toBeGreaterThan(20);
    expect(leaves).toBeGreaterThan(5);
  });
});

/** Todas las jugadas legales (sueltas, grupos y escaleras) que puede hacer el jugador, para el fuzz. */
function candidatePlays(s: PolacoState, pid: string): CardId[][] {
  const ctx = ctxFromState(s, pid);
  const out: CardId[][] = [];
  const singles = polaco.getView(s, pid).legal.plays;
  for (const c of singles) out.push([c]);
  for (const first of singles) {
    const rest = ctx.hand.filter((c) => c !== first);
    // grupos
    const same = rest.filter((c) => parseCard(c).rank === parseCard(first).rank);
    if (same.length >= 2 && checkPlay(ctx, [first, ...same]).ok) out.push([first, ...same]);
    // escaleras (voraz en ambos sentidos)
    for (const dir of [1, -1]) {
      const seq = [first];
      for (;;) {
        const next = rest.find(
          (c) =>
            !seq.includes(c) &&
            checkPlay(ctx, [...seq, c], { partial: true }).ok &&
            !same.includes(c) &&
            !(parseCard(c).rank === parseCard(seq[seq.length - 1]).rank)
        );
        if (!next) break;
        seq.push(next);
        if (dir === -1 && seq.length > 2) break;
      }
      if (seq.length >= 3 && checkPlay(ctx, seq).ok) out.push(seq);
    }
  }
  return out;
}

/* ------------------------ Correcciones de revisión ------------------------ */

describe('RNG inyectado y sin semilla en el estado', () => {
  it('el estado y las vistas no contienen semilla', () => {
    const players = NAMES.slice(0, 3).map((name, i) => ({ id: `p${i}`, name }));
    const s = polaco.createGame(players, { handSize: 5 }, seqRng(5));
    expect(s).not.toHaveProperty('seed');
    expect(JSON.stringify(s)).not.toMatch(/seed/i);
    for (const p of players) expect(JSON.stringify(polaco.getView(s, p.id))).not.toMatch(/seed/i);
  });

  it('el remezclado usa el RNG que se inyecta en applyAction (mismo RNG, mismo resultado; otro RNG, otro orden)', () => {
    const s = mk({
      top: '7H',
      hands: { 0: ['9S', '9C'] },
      deck: [],
      discardBelow: ['5D', '6D', '8D', '10D', '2D', '3D', '4D', 'AD']
    });
    const a = act(s, 0, { type: 'draw' }, seqRng(11));
    const b = act(s, 0, { type: 'draw' }, seqRng(11));
    const c = act(s, 0, { type: 'draw' }, seqRng(12));
    expect(a).toEqual(b);
    expect([...a.deck, ...a.hands.p0]).not.toEqual([...c.deck, ...c.hands.p0]);
  });

  it('un rng constante no rompe el motor', () => {
    const players = NAMES.slice(0, 2).map((name, i) => ({ id: `p${i}`, name }));
    const s = polaco.createGame(players, { handSize: 5 }, () => 0.5);
    expect(isSpecial(s.discard[0])).toBe(false);
  });
});

describe('la carta robada solo se ve para quien decide', () => {
  it('drawn es null para el resto de jugadores', () => {
    const s = mk({ top: '7H', hands: { 0: ['9S', '9C'], 1: ['5D', '6D'] }, deck: ['5D', 'KH'] });
    const r = act(s, 0, { type: 'draw' });
    expect(r.drawn).toBe('KH');
    expect(polaco.getView(r, 'p0').drawn).toBe('KH');
    expect(polaco.getView(r, 'p1').drawn).toBeNull();
    expect(JSON.stringify(polaco.getView(r, 'p1'))).not.toContain('KH');
  });
});

describe('la demanda cuenta los turnos realmente terminados al resolver una K', () => {
  /** Demanda de palo vigente (para poder tirar la K del palo exigido) y una K con su respuesta. */
  function kingWithDemand(n: number, card: 'KH' | 'KS') {
    const hands: Record<number, CardId[]> = {};
    for (let i = 0; i < n; i++) hands[i] = ['9C', '9D', '8C'];
    hands[0] = [card, '9C', '9D'];
    const target = card === 'KH' ? 1 % n : (n - 1) % n;
    hands[target] = [...hands[target], card === 'KH' ? 'KS' : 'KH'];
    const suit = card === 'KH' ? 'H' : 'S';
    const s = mk({
      n,
      top: '7H',
      hands,
      patch: { demand: { kind: 'suit', suit, by: 'p0', turnsLeft: n + 3 } }
    });
    return { s, target };
  }
  const left = (s: PolacoState) => s.demand?.turnsLeft ?? 0;

  it('4 jugadores: K♥ cuenta el turno de quien la tira y el del objetivo (2), acepte o responda', () => {
    const a = kingWithDemand(4, 'KH');
    const accepted = act(act(a.s, 0, play('KH')), 1, { type: 'accept' });
    expect(left(accepted)).toBe(7 - 2);
    const b = kingWithDemand(4, 'KH');
    const answered = act(act(b.s, 0, play('KH')), 1, play('KS'));
    expect(left(answered)).toBe(7 - 2);
    expect(turnOf(answered)).toBe(2);
  });

  it('4 jugadores: K♠ solo cuenta el turno de quien la tira (1), acepte o responda; la respuesta fuera de turno no cuenta', () => {
    const a = kingWithDemand(4, 'KS');
    const accepted = act(act(a.s, 0, play('KS')), 3, { type: 'accept' });
    expect(left(accepted)).toBe(7 - 1);
    expect(turnOf(accepted)).toBe(1);
    const b = kingWithDemand(4, 'KS');
    const answered = act(act(b.s, 0, play('KS')), 3, play('KH'));
    expect(left(answered)).toBe(7 - 1);
    expect(turnOf(answered)).toBe(1);
  });

  it('2 jugadores: cada turno consumido cuenta, sin quedarse corto por el módulo', () => {
    const d = (n: number, card: 'KH' | 'KS') => kingWithDemand(n, card).s;
    // K♥ aceptada: turno de p + turno (penalizado) del objetivo = 2
    expect(left(act(act(d(2, 'KH'), 0, play('KH')), 1, { type: 'accept' }))).toBe(5 - 2);
    // K♥ respondida con K♠: p, objetivo y el turno perdido de p = 3
    expect(left(act(act(d(2, 'KH'), 0, play('KH')), 1, play('KS')))).toBe(5 - 3);
    // K♠ aceptada: p y el turno perdido del objetivo = 2
    expect(left(act(act(d(2, 'KS'), 0, play('KS')), 1, { type: 'accept' }))).toBe(5 - 2);
    // K♠ respondida: solo el de p = 1
    expect(left(act(act(d(2, 'KS'), 0, play('KS')), 1, play('KH')))).toBe(5 - 1);
  });
});

describe('la Q y la demanda', () => {
  it('bajo demanda de A, la Q del palo exigido no limpia la demanda ni da jugada libre', () => {
    let s = mk({ n: 3, top: '7H', hands: { 0: ['AH', '9C'], 1: ['QS', '5S'], 2: ['8S', '8C', 'AC'] } });
    s = act(s, 0, play('AH', { demandSuit: 'S' }));
    expect(s.demand?.turnsLeft).toBe(3);
    s = act(s, 1, play('QS'));
    expect(s.freePlay).toBe(false);
    expect(s.demand).toEqual({ kind: 'suit', suit: 'S', by: 'p0', turnsLeft: 2 }); // sigue contando la vuelta
    // El siguiente sigue obligado: palo exigido u otra A (o robar)
    expect(polaco.getView(s, 'p2').legal.plays.sort()).toEqual(['8S', 'AC']);
    expect(fail(s, 2, play('8C'))).toMatch(/^rule\.demand(Rank|Suit)$/);
  });

  it('la demanda sigue su vuelta completa tras la Q y caduca a su hora', () => {
    let s = mk({ n: 3, top: '7H', hands: { 0: ['AH', '9C', '9D'], 1: ['QS', '5S'], 2: ['8S', '8C'] } });
    s = act(s, 0, play('AH', { demandSuit: 'S' })); // 3
    s = act(s, 1, play('QS')); // 2
    s = act(s, 2, play('8S')); // 1
    expect(s.demand?.turnsLeft).toBe(1);
    expect(turnOf(s)).toBe(0);
    expect(fail(s, 0, play('9C'))).toMatch(/^rule\.demand(Rank|Suit)$/); // quien la tiró también cumple
  });

  it('bajo demanda de J la Q sigue siendo ilegal', () => {
    let s = mk({ top: '7H', hands: { 0: ['JH', '9C'], 1: ['QH', '9S'] } });
    s = act(s, 0, play('JH', { demandRank: '9' }));
    expect(fail(s, 1, play('QH'))).toBe('rule.noQUnderJ');
  });

  it('fuera de una demanda la Q sigue dando jugada libre', () => {
    let s = mk({ top: '7H', hands: { 0: ['QC', '9C'], 1: ['5S', '9D'] } });
    s = act(s, 0, play('QC'));
    expect(s.freePlay).toBe(true);
  });
});

/* ------------------------------- Escaleras -------------------------------- */

describe('escaleras', () => {
  const tableHand = (cards: CardId[], extra: Partial<Parameters<typeof mk>[0]> = {}) =>
    mk({ top: '7H', hands: { 0: [...cards, '2C'] }, ...extra });

  it('ascendente: la primera toca la mesa, queda arriba la última', () => {
    const s = act(tableHand(['7S', '8D', '9C']), 0, play(['7S', '8D', '9C']));
    expect(top(s)).toBe('9C');
    expect(s.hands.p0).toEqual(['2C']);
    expect(turnOf(s)).toBe(1);
  });

  it('descendente', () => {
    const s = act(tableHand(['8H', '7D', '6C']), 0, play(['8H', '7D', '6C']));
    expect(top(s)).toBe('6C');
  });

  it('el A puede ser bajo (A-2-3, y 3-2-A) y alto (Q-K-A, y A-K-Q)', () => {
    const low = act(tableHand(['AH', '2S', '3D']), 0, play(['AH', '2S', '3D']));
    expect(low.pending).toEqual({ kind: 'draw', amount: 3 }); // acaba en 3
    const low2 = tableHand(['3H', '2S', 'AD']);
    expect(validatePlay(low2, 'p0', ['3H', '2S', 'AD']).ok).toBe(true);
    const high = act(tableHand(['QH', 'KC', 'AD']), 0, play(['QH', 'KC', 'AD'], { demandSuit: 'S' }));
    expect(high.demand).toMatchObject({ kind: 'suit', suit: 'S' });
    const high2 = tableHand(['AH', 'KC', 'QD']);
    expect(validatePlay(high2, 'p0', ['AH', 'KC', 'QD']).ok).toBe(true);
  });

  it('K-A-2 (con vuelta) se rechaza, igual que 2-A-K', () => {
    const s = tableHand(['KH', 'AS', '2D']);
    expect(fail(s, 0, play(['KH', 'AS', '2D']))).toBe('rule.multiShape');
    expect(fail(tableHand(['2H', 'AS', 'KD']), 0, play(['2H', 'AS', 'KD']))).toBe('rule.multiShape');
  });

  it('cualquier longitud >= 3, pero con 2 cartas no hay escalera', () => {
    const five = tableHand(['5H', '6S', '7D', '8C', '9H']);
    const r = act(five, 0, play(['5H', '6S', '7D', '8C', '9H']));
    expect(r.hands.p0).toEqual(['2C']);
    expect(fail(tableHand(['7S', '8D']), 0, play(['7S', '8D']))).toBe('rule.multiMin');
  });

  it('los números deben ser consecutivos', () => {
    expect(fail(tableHand(['7S', '9D', '10C']), 0, play(['7S', '9D', '10C']))).toBe('rule.multiShape');
    expect(fail(tableHand(['7S', '8D', '8C']), 0, play(['7S', '8D', '8C']))).toBe('rule.multiShape');
  });

  it('la primera carta tiene que encajar en la mesa', () => {
    expect(failReason(tableHand(['8S', '9S', '10S']), 0, play(['8S', '9S', '10S']))).toBe('rule.noFit');
    // aunque otra carta de la escalera sí encajara, la primera es la que cuenta
    expect(failReason(tableHand(['6D', '7S', '8D']), 0, play(['6D', '7S', '8D']))).toBe('rule.noFit');
  });

  it('bajo demanda, la primera carta debe cumplirla y la demanda sigue su vuelta', () => {
    const suitDemand = { demand: { kind: 'suit', suit: 'S', by: 'p3', turnsLeft: 4 } as const };
    const okS = act(tableHand(['5S', '6H', '7C'], { patch: suitDemand }), 0, play(['5S', '6H', '7C']));
    expect(okS.demand?.turnsLeft).toBe(3);
    expect(failReason(tableHand(['5H', '6H', '7H'], { patch: suitDemand }), 0, play(['5H', '6H', '7H']))).toMatch(
      /^rule\.demand(Rank|Suit)$/
    );
    const rankDemand = { demand: { kind: 'rank', rank: '6', by: 'p3', turnsLeft: 4 } as const };
    expect(
      act(tableHand(['6H', '7H', '8H'], { patch: rankDemand }), 0, play(['6H', '7H', '8H'])).demand?.turnsLeft
    ).toBe(3);
    expect(failReason(tableHand(['7H', '8H', '9H'], { patch: rankDemand }), 0, play(['7H', '8H', '9H']))).toMatch(
      /^rule\.demand(Rank|Suit)$/
    );
  });

  it('solo aplica el efecto de la última carta', () => {
    expect(act(tableHand(['2H', '3S', '4D']), 0, play(['2H', '3S', '4D'])).pending).toEqual({ kind: 'skip', count: 1 });
    expect(act(tableHand(['4H', '3S', '2D']), 0, play(['4H', '3S', '2D'])).pending).toEqual({
      kind: 'draw',
      amount: 2
    });
    // acabar en J pide demanda
    expect(fail(tableHand(['9H', '10S', 'JD']), 0, play(['9H', '10S', 'JD']))).toBe('rule.pickRank');
    const j = act(tableHand(['9H', '10S', 'JD']), 0, play(['9H', '10S', 'JD'], { demandRank: '6' }));
    expect(j.demand).toMatchObject({ kind: 'rank', rank: '6' });
    // acabar en Q da jugada libre
    expect(act(tableHand(['10H', 'JD', 'QS']), 0, play(['10H', 'JD', 'QS'])).freePlay).toBe(true);
    // acabar en K♥ dispara la K (las anteriores no tienen efecto)
    const k = act(tableHand(['10H', 'JS', 'QD', 'KH']), 0, play(['10H', 'JS', 'QD', 'KH']));
    expect(k.pending).toEqual({ kind: 'king', from: 'p0', target: 'p1', card: 'KH' });
    // 10-J-Q: la Q es la última y la J del medio no pide demanda
    expect(act(tableHand(['10H', 'JS', 'QD']), 0, play(['10H', 'JS', 'QD'])).demand).toBeNull();
  });

  it('una escalera que termina en Q bajo demanda no da jugada libre', () => {
    const s = act(
      tableHand(['10S', 'JD', 'QS'], { patch: { demand: { kind: 'suit', suit: 'S', by: 'p3', turnsLeft: 4 } } }),
      0,
      play(['10S', 'JD', 'QS'])
    );
    expect(s.freePlay).toBe(false);
    expect(s.demand?.kind).toBe('suit');
  });

  it('no puede responder a un robo, un salto ni una K pendientes', () => {
    const draw = mk({
      top: '2H',
      hands: { 0: ['2D', '3S', '4C', '9C'] },
      patch: { pending: { kind: 'draw', amount: 2 } }
    });
    expect(fail(draw, 0, play(['2D', '3S', '4C']))).toBe('rule.drawGroupOnly');
    const skip = mk({
      top: '4H',
      hands: { 0: ['4D', '5S', '6C', '9C'] },
      patch: { pending: { kind: 'skip', count: 1 } }
    });
    expect(fail(skip, 0, play(['4D', '5S', '6C']))).toBe('rule.skipGroupOnly');
    const king = mk({
      top: 'KH',
      hands: { 0: ['KS', 'QD', 'JH', '9C'] },
      patch: { pending: { kind: 'king', from: 'p3', target: 'p0', card: 'KH' } }
    });
    expect(fail(king, 0, play(['KS', 'QD', 'JH']))).toBe('rule.kingMulti');
  });

  it('tras robar solo se puede jugar la carta robada, no una escalera', () => {
    const s = mk({ top: '7H', hands: { 0: ['7S', '8D', '9C', '2C'] }, deck: ['4C', '7D'] });
    const r = act(s, 0, { type: 'draw' }); // roba 7D (jugable)
    expect(r.drawn).toBe('7D');
    expect(fail(r, 0, play(['7S', '8D', '9C']))).toBe('rule.drawnOnly');
  });

  it('ganar con una escalera con toda la mano ignora el efecto y no pide demanda', () => {
    const s = mk({ top: '7H', hands: { 0: ['9H', '10S', 'JD'] } });
    const r = act(s, 0, play(['9H', '10S', 'JD']));
    expect(r.winner).toBe('p0');
  });

  it('checkPlay en modo parcial acepta prefijos y validatePlay de vista coincide con el estado', () => {
    const s = tableHand(['7S', '8D', '9C']);
    const ctx = ctxFromState(s, 'p0');
    expect(checkPlay(ctx, ['7S', '8D'], { partial: true }).ok).toBe(true);
    expect(checkPlay(ctx, ['7S', '9C'], { partial: true }).ok).toBe(false);
    const viewCtx = (cards: CardId[]) => {
      const v = polaco.getView(s, 'p0');
      return checkPlay(
        {
          hand: v.hand,
          top: v.top,
          pending: v.pending,
          demand: v.demand,
          freePlay: v.freePlay,
          drawn: v.drawn,
          isActor: v.actorId === v.me,
          finished: false
        },
        cards
      );
    };
    expect(viewCtx(['7S', '8D', '9C'])).toEqual(validatePlay(s, 'p0', ['7S', '8D', '9C']));
  });
});

/* --------------------------------- Grupos --------------------------------- */

describe('grupos del mismo número', () => {
  it('tres doses suman +6 y el siguiente puede responder con un grupo de treses', () => {
    let s = mk({
      top: '7H',
      hands: { 0: ['2H', '2S', '2D', '9C'], 1: ['3S', '3C', '3D', '9D', '8C'] }
    });
    s = act(s, 0, play(['2H', '2S', '2D']));
    expect(s.pending).toEqual({ kind: 'draw', amount: 6 });
    expect(top(s)).toBe('2D');
    s = act(s, 1, play(['3S', '3C', '3D']));
    expect(s.pending).toEqual({ kind: 'draw', amount: 15 });
    expect(turnOf(s)).toBe(2);
  });

  it('un grupo de doses responde a una cadena de robo; uno de otro número no', () => {
    const chain = (cards: CardId[]) =>
      mk({ top: '3H', hands: { 0: [...cards, '9C'] }, patch: { pending: { kind: 'draw', amount: 3 } } });
    const ok = act(chain(['2S', '2C', '2D']), 0, play(['2S', '2C', '2D']));
    expect(ok.pending).toEqual({ kind: 'draw', amount: 9 });
    expect(fail(chain(['5S', '5C', '5D']), 0, play(['5S', '5C', '5D']))).toBe('rule.drawGroupOnly');
  });

  it('n treses = +3n, n cuatros = n saltos (también sobre una cadena de saltos)', () => {
    expect(
      act(mk({ top: '7H', hands: { 0: ['3H', '3S', '3D', '3C', '9C'] } }), 0, play(['3H', '3S', '3D', '3C'])).pending
    ).toEqual({
      kind: 'draw',
      amount: 12
    });
    expect(act(mk({ top: '7H', hands: { 0: ['4H', '4S', '4D', '9C'] } }), 0, play(['4H', '4S', '4D'])).pending).toEqual(
      {
        kind: 'skip',
        count: 3
      }
    );
    const chain = mk({
      top: '4H',
      hands: { 0: ['4S', '4C', '4D', '9C'] },
      patch: { pending: { kind: 'skip', count: 1 } }
    });
    expect(act(chain, 0, play(['4S', '4C', '4D'])).pending).toEqual({ kind: 'skip', count: 4 });
    // un grupo de otro número no responde a un salto, ni un grupo de 4 a un robo
    expect(
      fail({ ...chain, hands: { ...chain.hands, p0: ['5S', '5C', '5D', '9C'] } }, 0, play(['5S', '5C', '5D']))
    ).toBe('rule.skipGroupOnly');
    const drawChain = mk({
      top: '2H',
      hands: { 0: ['4S', '4C', '4D', '9C'] },
      patch: { pending: { kind: 'draw', amount: 2 } }
    });
    expect(fail(drawChain, 0, play(['4S', '4C', '4D']))).toBe('rule.drawGroupOnly');
  });

  it('un grupo de J o de A pide una sola demanda', () => {
    const j = mk({ top: '7H', hands: { 0: ['JH', 'JS', 'JD', '9C'] } });
    expect(fail(j, 0, play(['JH', 'JS', 'JD']))).toBe('rule.pickRank');
    const r = act(j, 0, play(['JH', 'JS', 'JD'], { demandRank: '8' }));
    expect(r.demand).toEqual({ kind: 'rank', rank: '8', by: 'p0', turnsLeft: 4 });
    const a = act(
      mk({ top: '7H', hands: { 0: ['AH', 'AS', 'AD', '9C'] } }),
      0,
      play(['AH', 'AS', 'AD'], { demandSuit: 'C' })
    );
    expect(a.demand).toMatchObject({ kind: 'suit', suit: 'C' });
  });

  it('un grupo de K solo aplica el efecto de la carta de arriba', () => {
    const hand = ['KC', 'KD', 'KH', '9S'] as CardId[];
    const heartsOnTop = act(mk({ top: '7C', hands: { 0: hand } }), 0, play(['KC', 'KD', 'KH']));
    expect(heartsOnTop.pending).toEqual({ kind: 'king', from: 'p0', target: 'p1', card: 'KH' });
    const diamondsOnTop = act(mk({ top: '7C', hands: { 0: hand } }), 0, play(['KC', 'KH', 'KD']));
    expect(diamondsOnTop.pending).toBeNull();
    expect(turnOf(diamondsOnTop)).toBe(1);
    const spades = act(mk({ top: '7C', hands: { 0: ['KC', 'KH', 'KS', '9S'] } }), 0, play(['KC', 'KH', 'KS']));
    expect(spades.pending).toMatchObject({ card: 'KS', target: 'p3' });
  });

  it('basta con que una carta encaje, pero esa va primera', () => {
    const s = mk({ top: '7H', hands: { 0: ['9S', '9D', '9H', '2C'] } });
    expect(fail(s, 0, play(['9S', '9D', '9H']))).toBe('rule.firstFirst');
    const r = act(s, 0, play(['9H', '9S', '9D']));
    expect(top(r)).toBe('9D');
    expect(fail(mk({ top: '7H', hands: { 0: ['9S', '9D', '9C', '2C'] } }), 0, play(['9S', '9D', '9C']))).toBe(
      'rule.firstMustPlay'
    );
  });

  it('un grupo de Q cuenta como una Q: jugada libre fuera de demanda, y bajo demanda de A la primera debe ser del palo', () => {
    const free = act(mk({ top: '7H', hands: { 0: ['QS', 'QD', 'QC', '9C'] } }), 0, play(['QS', 'QD', 'QC']));
    expect(free.freePlay).toBe(true);
    const demand = { demand: { kind: 'suit', suit: 'S', by: 'p3', turnsLeft: 4 } as const };
    const under = act(
      mk({ top: '7H', hands: { 0: ['QS', 'QD', 'QC', '9C'] }, patch: demand }),
      0,
      play(['QS', 'QD', 'QC'])
    );
    expect(under.freePlay).toBe(false);
    expect(under.demand?.turnsLeft).toBe(3);
    expect(
      failReason(mk({ top: '7H', hands: { 0: ['QS', 'QD', 'QC', '9C'] }, patch: demand }), 0, play(['QD', 'QS', 'QC']))
    ).toBeTruthy();
    const jDemand = { demand: { kind: 'rank', rank: '9', by: 'p3', turnsLeft: 4 } as const };
    expect(
      failReason(mk({ top: '7H', hands: { 0: ['QS', 'QD', 'QC', '9C'] }, patch: jDemand }), 0, play(['QS', 'QD', 'QC']))
    ).toBe('rule.noQUnderJ');
  });

  it('bajo demanda de J, vale un grupo del número exigido', () => {
    const s = mk({
      top: '7H',
      hands: { 0: ['9S', '9D', '9C', '2C'] },
      patch: { demand: { kind: 'rank', rank: '9', by: 'p3', turnsLeft: 4 } }
    });
    const r = act(s, 0, play(['9S', '9D', '9C']));
    expect(r.demand?.turnsLeft).toBe(3);
  });

  it('dos cartas iguales no son jugada múltiple', () => {
    expect(fail(mk({ top: '7H', hands: { 0: ['7S', '7D', '2C'] } }), 0, play(['7S', '7D']))).toBe('rule.multiMin');
  });
});

/* ----------------------------- Abandonar partida -------------------------- */

describe('un jugador abandona (removePlayer)', () => {
  const ids = (s: PolacoState) => s.players.map((p) => p.id);
  const actor = (s: PolacoState) => s.players[s.turn].id;

  it('en su turno: su mano vuelve al mazo y el turno pasa al siguiente', () => {
    const s = mk({ turn: 1, hands: { 1: ['9C', '9D', '8C'] } });
    const total = (x: PolacoState) => x.deck.length + x.discard.length + Object.values(x.hands).flat().length;
    const r = polaco.removePlayer(s, 'p1', seqRng(2));
    expect(ids(r)).toEqual(['p0', 'p2', 'p3']);
    expect(r.hands).not.toHaveProperty('p1');
    expect(actor(r)).toBe('p2');
    expect(r.deck.length).toBe(s.deck.length + 3);
    expect(total(r)).toBe(total(s));
    expect(r.log[r.log.length - 1]).toEqual({ code: 'log.leave', params: { name: expect.any(String) } });
  });

  it('el último de la ronda: el turno pasa al primero', () => {
    const r = polaco.removePlayer(mk({ turn: 3 }), 'p3', seqRng(2));
    expect(actor(r)).toBe('p0');
  });

  it('fuera de su turno el turno de los demás se conserva', () => {
    expect(actor(polaco.removePlayer(mk({ turn: 2 }), 'p0', seqRng(2)))).toBe('p2');
    expect(actor(polaco.removePlayer(mk({ turn: 1 }), 'p3', seqRng(2)))).toBe('p1');
  });

  it('con una cadena de robo o salto pendiente, pasa tal cual al siguiente', () => {
    const draw = mk({ turn: 1, patch: { pending: { kind: 'draw', amount: 5 } } });
    const r = polaco.removePlayer(draw, 'p1', seqRng(2));
    expect(r.pending).toEqual({ kind: 'draw', amount: 5 });
    expect(actor(r)).toBe('p2');
    const skip = polaco.removePlayer(mk({ turn: 2, patch: { pending: { kind: 'skip', count: 2 } } }), 'p2', seqRng(2));
    expect(skip.pending).toEqual({ kind: 'skip', count: 2 });
    expect(actor(skip)).toBe('p3');
  });

  it('una K cancelada si se va el objetivo o quien la tiró; si se va otro, sigue', () => {
    const king = (card: CardId, from: string, target: string, turn: number) =>
      mk({ top: card, turn, patch: { pending: { kind: 'king', from, target, card } } });
    // objetivo (p1) se va: el turno sigue con el siguiente a quien tiró (p0 -> p2)
    const target = polaco.removePlayer(king('KH', 'p0', 'p1', 1), 'p1', seqRng(2));
    expect(target.pending).toBeNull();
    expect(actor(target)).toBe('p2');
    // quien la tiró (p0, K♠ contra p3) se va: sigue p1
    const thrower = polaco.removePlayer(king('KS', 'p0', 'p3', 3), 'p0', seqRng(2));
    expect(thrower.pending).toBeNull();
    expect(actor(thrower)).toBe('p1');
    // se va otro (p2): la K sigue y el objetivo sigue siendo el que actúa
    const other = polaco.removePlayer(king('KH', 'p0', 'p1', 1), 'p2', seqRng(2));
    expect(other.pending).toMatchObject({ kind: 'king', target: 'p1' });
    expect(actor(other)).toBe('p1');
  });

  it('la demanda se recorta al nuevo número de jugadores', () => {
    const s = mk({ patch: { demand: { kind: 'rank', rank: '7', by: 'p0', turnsLeft: 4 } } });
    expect(polaco.removePlayer(s, 'p2', seqRng(2)).demand?.turnsLeft).toBe(3);
    const low = mk({ patch: { demand: { kind: 'rank', rank: '7', by: 'p0', turnsLeft: 2 } } });
    expect(polaco.removePlayer(low, 'p2', seqRng(2)).demand?.turnsLeft).toBe(2);
  });

  it('la carta robada del que decide se conserva si se va otro', () => {
    const s = mk({ turn: 0, patch: { drawn: '9C' } });
    expect(polaco.removePlayer(s, 'p2', seqRng(2)).drawn).toBe('9C');
    expect(polaco.removePlayer(s, 'p0', seqRng(2)).drawn).toBeNull();
  });
});
