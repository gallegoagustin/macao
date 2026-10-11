import { describe, expect, it } from "vitest";
import { type CardId, makeDeck, parseCard } from "@/lib/rules/cards";
import {
  type PolacoAction,
  type PolacoState,
  isSpecial,
  polaco,
} from "@/lib/rules/polaco";

/* ---------------------------- helpers de test ----------------------------- */

const NAMES = ["Ana", "Bian", "Cris", "Dani", "Eva", "Fran", "Gus", "Hugo"];

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
    hands[p.id] = o.hands?.[i] ?? ["9C", "9D", "8C"];
  });
  const used = new Set<CardId>([...Object.values(hands).flat(), o.top ?? "7H", ...(o.discardBelow ?? [])]);
  const deck = o.deck ?? makeDeck().filter((c) => !used.has(c));
  return {
    players,
    hands,
    deck,
    discard: [...(o.discardBelow ?? []), o.top ?? "7H"],
    turn: o.turn ?? 0,
    starter: 0,
    pending: null,
    demand: null,
    freePlay: false,
    drawn: null,
    winner: null,
    log: [],
    ...o.patch,
  };
}

function act(s: PolacoState, pid: number, a: PolacoAction, rng = seqRng(1)): PolacoState {
  const r = polaco.applyAction(s, `p${pid}`, a, rng);
  if (!r.ok) throw new Error(`Acción rechazada: ${r.error}`);
  return r.state;
}
function fail(s: PolacoState, pid: number, a: PolacoAction): string {
  const r = polaco.applyAction(s, `p${pid}`, a, seqRng(1));
  if (r.ok) throw new Error("Se esperaba un rechazo");
  return r.error;
}
const play = (card: CardId, extra: Partial<Extract<PolacoAction, { type: "play" }>> = {}): PolacoAction => ({
  type: "play",
  card,
  ...extra,
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

describe("jugada normal", () => {
  it("acepta palo o número y rechaza lo demás", () => {
    const s = mk({ top: "7H", hands: { 0: ["7S", "KH", "9C", "5C"] } });
    expect(polaco.getView(s, "p0").legal.plays.sort()).toEqual(["7S", "KH"].sort());
    expect(fail(s, 0, play("9C"))).toMatch(/no encaja/);
    const s2 = act(s, 0, play("7S"));
    expect(top(s2)).toBe("7S");
    expect(turnOf(s2)).toBe(1);
    const s3 = act(mk({ top: "7H", hands: { 0: ["7S", "KH", "9C", "5C"] } }), 0, play("KH"));
    expect(top(s3)).toBe("KH");
  });

  it("rechaza jugar fuera de turno y cartas que no tienes", () => {
    const s = mk({ top: "7H" });
    expect(fail(s, 1, play("9C"))).toMatch(/turno/);
    expect(fail(s, 0, play("5H"))).toMatch(/No tienes/);
  });
});

describe("robar", () => {
  it("solo se puede robar sin jugada legal", () => {
    const s = mk({ top: "7H", hands: { 0: ["7S", "9C"] } });
    expect(fail(s, 0, { type: "draw" })).toMatch(/jugadas posibles/);
    const s2 = mk({ top: "7H", hands: { 0: ["9S", "9C"] }, deck: ["5D", "5C"] });
    expect(polaco.getView(s2, "p0").legal.canDraw).toBe(true);
    const r = act(s2, 0, { type: "draw" });
    expect(r.hands.p0).toHaveLength(3);
  });

  it("si la carta robada no se puede jugar, el turno pasa solo", () => {
    const s = mk({ top: "7H", hands: { 0: ["9S", "9C"] }, deck: ["5D", "5C"] });
    const r = act(s, 0, { type: "draw" }); // roba 5C: no encaja con 7H
    expect(r.hands.p0).toContain("5C");
    expect(turnOf(r)).toBe(1);
    expect(r.drawn).toBeNull();
  });

  it("si la carta robada se puede jugar: se juega esa carta o se pasa", () => {
    const s = mk({ top: "7H", hands: { 0: ["9S", "9C"] }, deck: ["5D", "KH"] });
    const r = act(s, 0, { type: "draw" }); // roba KH: encaja por palo
    expect(turnOf(r)).toBe(0);
    expect(r.drawn).toBe("KH");
    expect(polaco.getView(r, "p0").legal.plays).toEqual(["KH"]);
    expect(fail(r, 0, play("9S"))).toMatch(/robado/);
    expect(fail(r, 0, { type: "draw" })).toMatch(/Ya has robado/);
    const played = act(r, 0, play("KH"));
    expect(top(played)).toBe("KH");
    const passed = act(r, 0, { type: "pass" });
    expect(turnOf(passed)).toBe(1);
    expect(passed.hands.p0).toContain("KH");
  });

  it("no se puede pasar sin haber robado", () => {
    const s = mk({ top: "7H", hands: { 0: ["9S", "9C"] } });
    expect(fail(s, 0, { type: "pass" })).toMatch(/pasar/);
  });

  it("mazo vacío: se remezcla el descarte menos la carta de arriba", () => {
    const s = mk({
      top: "7H",
      hands: { 0: ["9S", "9C"] },
      deck: [],
      discardBelow: ["5D", "6D", "8D", "10D"],
    });
    const r = act(s, 0, { type: "draw" });
    expect(r.hands.p0).toHaveLength(3);
    expect(top(r)).toBe("7H");
    expect(r.discard).toEqual(["7H"]);
    expect(r.deck.length).toBe(3); // 4 remezcladas, 1 robada
    // Es determinista con la misma semilla
    expect(act(s, 0, { type: "draw" })).toEqual(r);
  });

  it("si no alcanza ni con el descarte, se roba lo que haya", () => {
    const s = mk({
      top: "2H",
      hands: { 0: ["9S", "9C"] },
      deck: ["5D"],
      patch: { pending: { kind: "draw", amount: 7 } },
    });
    const r = act(s, 0, { type: "accept" });
    expect(r.hands.p0).toHaveLength(3); // solo había 1 carta
    expect(r.pending).toBeNull();
  });
});

/* ------------------------- 2 y 3: robo acumulable ------------------------- */

describe("robo acumulable (2 y 3)", () => {
  it("cadena 2+3+2 y el siguiente acepta 7", () => {
    let s = mk({ top: "7H", hands: { 0: ["2H", "9C"], 1: ["3S", "9S"], 2: ["2D", "9D"], 3: ["8S", "8H", "8D"] } });
    s = act(s, 0, play("2H"));
    expect(s.pending).toEqual({ kind: "draw", amount: 2 });
    s = act(s, 1, play("3S"));
    expect(s.pending).toEqual({ kind: "draw", amount: 5 });
    s = act(s, 2, play("2D"));
    expect(s.pending).toEqual({ kind: "draw", amount: 7 });
    expect(turnOf(s)).toBe(3);
    const before = s.hands.p3.length;
    s = act(s, 3, { type: "accept" });
    expect(s.hands.p3).toHaveLength(before + 7);
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0); // pierde el turno
  });

  it("se puede responder a un 2 con un 3 de otro palo", () => {
    let s = mk({ top: "7H", hands: { 0: ["2H", "9C"], 1: ["3C", "9S"] } });
    s = act(s, 0, play("2H"));
    expect(top(s)).toBe("2H");
    s = act(s, 1, play("3C"));
    expect(s.pending).toEqual({ kind: "draw", amount: 5 });
  });

  it("bajo robo pendiente solo valen 2 y 3 (ni Q, ni K, ni 4, ni carta normal)", () => {
    const s = mk({
      top: "2H",
      hands: { 0: ["QH", "KH", "4H", "9H", "3S"] },
      patch: { pending: { kind: "draw", amount: 2 } },
    });
    expect(fail(s, 0, play("QH"))).toMatch(/robo pendiente/);
    expect(fail(s, 0, play("KH"))).toMatch(/robo pendiente/);
    expect(fail(s, 0, play("4H"))).toMatch(/robo pendiente/);
    expect(fail(s, 0, play("9H"))).toMatch(/robo pendiente/);
    expect(fail(s, 0, { type: "draw" })).toBeTruthy();
    expect(polaco.getView(s, "p0").legal.plays).toEqual(["3S"]);
  });
});

/* ------------------------------- 4: salto --------------------------------- */

describe("salto acumulable (4)", () => {
  it("ejemplo con 4 jugadores: A 4, B 4, C acepta, D acepta, A juega normal", () => {
    let s = mk({
      top: "7H",
      hands: { 0: ["4H", "5S", "8H"], 1: ["4S", "9S"], 2: ["9D", "8D"], 3: ["9C", "8C"] },
    });
    s = act(s, 0, play("4H"));
    expect(s.pending).toEqual({ kind: "skip", count: 1 });
    expect(turnOf(s)).toBe(1);
    s = act(s, 1, play("4S")); // otro palo
    expect(s.pending).toEqual({ kind: "skip", count: 2 });
    expect(turnOf(s)).toBe(2);
    s = act(s, 2, { type: "accept" });
    expect(s.pending).toEqual({ kind: "skip", count: 1 });
    expect(turnOf(s)).toBe(3);
    s = act(s, 3, { type: "accept" });
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0);
    s = act(s, 0, play("5S")); // juega normal sobre el 4♠
    expect(top(s)).toBe("5S");
  });

  it("bajo salto pendiente solo se puede tirar un 4 o aceptar", () => {
    const s = mk({
      top: "4H",
      hands: { 0: ["9H", "QH", "4C"] },
      patch: { pending: { kind: "skip", count: 1 } },
    });
    expect(fail(s, 0, play("9H"))).toMatch(/salto pendiente/);
    expect(fail(s, 0, play("QH"))).toMatch(/salto pendiente/);
    expect(fail(s, 0, { type: "draw" })).toBeTruthy();
  });

  it("con 2 jugadores: A tira 4, B acepta y A vuelve a jugar", () => {
    let s = mk({ n: 2, top: "7H", hands: { 0: ["4H", "9H"], 1: ["9S", "8S"] } });
    s = act(s, 0, play("4H"));
    expect(turnOf(s)).toBe(1);
    s = act(s, 1, { type: "accept" });
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0);
  });

  it("con 2 jugadores: 4 contra 4 acumula y se resuelve", () => {
    let s = mk({ n: 2, top: "7H", hands: { 0: ["4H", "9H", "8H"], 1: ["4S", "9S"] } });
    s = act(s, 0, play("4H"));
    s = act(s, 1, play("4S"));
    expect(s.pending).toEqual({ kind: "skip", count: 2 });
    s = act(s, 0, { type: "accept" }); // 1
    expect(turnOf(s)).toBe(1);
    s = act(s, 1, { type: "accept" }); // 0
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(0);
  });
});

/* ------------------------------ Q comodín --------------------------------- */

describe("Q (comodín)", () => {
  it("se puede tirar sobre cualquier carta y da jugada libre al siguiente", () => {
    let s = mk({ top: "7H", hands: { 0: ["QC", "9C"], 1: ["5S", "9D"] } });
    expect(polaco.getView(s, "p0").legal.plays).toContain("QC");
    s = act(s, 0, play("QC"));
    expect(s.freePlay).toBe(true);
    expect(polaco.getView(s, "p1").legal.plays.sort()).toEqual(["5S", "9D"]);
    s = act(s, 1, play("5S"));
    expect(s.freePlay).toBe(false);
  });

  it("rechazada sobre una cadena de robo, un salto o una K", () => {
    const base = { top: "2H" as CardId, hands: { 0: ["QH", "QS", "3S"] as CardId[] } };
    expect(fail(mk({ ...base, patch: { pending: { kind: "draw", amount: 2 } } }), 0, play("QH"))).toMatch(
      /robo pendiente/,
    );
    expect(fail(mk({ ...base, patch: { pending: { kind: "skip", count: 1 } } }), 0, play("QH"))).toMatch(
      /salto pendiente/,
    );
    const k = mk({
      top: "KH",
      hands: { 0: ["QH", "KS"] },
      turn: 0,
      patch: { pending: { kind: "king", from: "p3", target: "p0", card: "KH" } },
    });
    expect(fail(k, 0, play("QH"))).toMatch(/K/);
  });
});

/* -------------------------------- J --------------------------------------- */

describe("J (exige un número)", () => {
  it("J con número: solo se juega ese número u otra J; cumplir levanta la exigencia en su turno", () => {
    let s = mk({
      top: "7H",
      hands: { 0: ["JH", "9C"], 1: ["9S", "5D", "8S"], 2: ["8D", "8C"], 3: ["JC", "5C"] },
    });
    s = act(s, 0, play("JH", { demandRank: "9" }));
    expect(s.demand).toEqual({ kind: "rank", rank: "9", by: "p0", turnsLeft: 4 });
    expect(fail(s, 1, play("5D"))).toMatch(/exigen un 9/i);
    expect(polaco.getView(s, "p1").legal.plays.sort()).toEqual(["9S"]);
    s = act(s, 1, play("9S")); // cumple
    expect(top(s)).toBe("9S");
    expect(s.demand?.turnsLeft).toBe(3);
  });

  it("J sobre J reemplaza la demanda y reinicia turnsLeft", () => {
    let s = mk({
      top: "7H",
      hands: { 0: ["JH", "9C"], 1: ["JS", "5D"], 2: ["8D", "8C"], 3: ["9S", "5C"] },
    });
    s = act(s, 0, play("JH", { demandRank: "9" }));
    s = act(s, 1, play("JS", { demandRank: "6" }));
    expect(s.demand).toEqual({ kind: "rank", rank: "6", by: "p1", turnsLeft: 4 });
  });

  it("J con «Nada» es carta normal y limpia la demanda previa", () => {
    let s = mk({
      top: "7H",
      hands: { 0: ["JH", "9C"], 1: ["JS", "5D"], 2: ["8D", "8C"], 3: ["9S", "5C"] },
    });
    s = act(s, 0, play("JH", { demandRank: "9" }));
    s = act(s, 1, play("JS", { demandRank: null }));
    expect(s.demand).toBeNull();
    // Y sobre una J "nada" se juega normal (palo ♠ o J)
    expect(polaco.getView(s, "p2").legal.plays).toEqual([]);
  });

  it("hay que elegir número o «Nada» al tirar una J", () => {
    const s = mk({ top: "7H", hands: { 0: ["JH", "9C"] } });
    expect(fail(s, 0, play("JH"))).toMatch(/Elige/);
    expect(fail(s, 0, play("JH", { demandRank: "4" as never }))).toBeTruthy();
  });

  it("Q bloqueada bajo demanda de J", () => {
    let s = mk({ top: "7H", hands: { 0: ["JH", "9C"], 1: ["QH", "9S"] } });
    s = act(s, 0, play("JH", { demandRank: "9" }));
    expect(fail(s, 1, play("QH"))).toMatch(/Q bajo la demanda/);
  });

  it("quien no puede cumplir roba 1 y puede jugar la robada si cumple", () => {
    let s = mk({
      top: "7H",
      hands: { 0: ["JH", "9C"], 1: ["5D", "6D"], 2: ["8D", "8C"] },
      n: 3,
      deck: ["8S", "9D"], // se roba 9D primero (tope = final)
    });
    s = act(s, 0, play("JH", { demandRank: "9" }));
    expect(polaco.getView(s, "p1").legal.canDraw).toBe(true);
    s = act(s, 1, { type: "draw" });
    expect(s.drawn).toBe("9D");
    s = act(s, 1, play("9D"));
    expect(top(s)).toBe("9D");
  });

  it("la demanda caduca tras una vuelta y quien la tiró también tiene que cumplirla", () => {
    // 3 jugadores. Nadie puede cumplir salvo el que tiró la J.
    let s = mk({
      n: 3,
      top: "7H",
      hands: { 0: ["JH", "9C", "9D"], 1: ["5D", "6D"], 2: ["5S", "6S"] },
      deck: ["8C", "8D", "8S", "10C", "10D", "10S"],
    });
    s = act(s, 0, play("JH", { demandRank: "9" })); // turnsLeft 3
    s = act(s, 1, { type: "draw" }); // roba 10S: no cumple, pasa → 2
    expect(s.demand?.turnsLeft).toBe(2);
    s = act(s, 2, { type: "draw" }); // → 1
    expect(s.demand?.turnsLeft).toBe(1);
    expect(turnOf(s)).toBe(0);
    // El que tiró la J tiene que cumplir su propia demanda
    expect(fail(s, 0, play("JH" as CardId))).toBeTruthy(); // ya no tiene la J
    expect(polaco.getView(s, "p0").legal.plays.sort()).toEqual(["9C", "9D"]);
    s = act(s, 0, play("9C"));
    expect(s.demand).toBeNull(); // una vuelta completa: ya caducó
    expect(turnOf(s)).toBe(1);
    // Ahora se juega normal sobre el 9♣
    const v = polaco.getView(s, "p1");
    expect(v.legal.plays.every((c) => parseCard(c).suit === "C" || parseCard(c).rank === "9")).toBe(true);
  });
});

/* -------------------------------- A --------------------------------------- */

describe("A (exige un palo)", () => {
  it("A con palo: solo ese palo u otra A", () => {
    let s = mk({
      top: "7H",
      hands: { 0: ["AH", "9C"], 1: ["5D", "5S", "AC", "9H"], 2: ["8S", "8C"] },
      n: 3,
    });
    s = act(s, 0, play("AH", { demandSuit: "S" }));
    expect(s.demand).toEqual({ kind: "suit", suit: "S", by: "p0", turnsLeft: 3 });
    expect(polaco.getView(s, "p1").legal.plays.sort()).toEqual(["5S", "AC"]);
    expect(fail(s, 1, play("9H"))).toMatch(/Te exigen/);
  });

  it("hay que elegir palo", () => {
    const s = mk({ top: "7H", hands: { 0: ["AH", "9C"] } });
    expect(fail(s, 0, play("AH"))).toMatch(/palo/);
  });

  it("A sobre A reemplaza la demanda", () => {
    let s = mk({ top: "7H", hands: { 0: ["AH", "9C"], 1: ["AC", "9S"] } });
    s = act(s, 0, play("AH", { demandSuit: "S" }));
    s = act(s, 1, play("AC", { demandSuit: "D" }));
    expect(s.demand).toEqual({ kind: "suit", suit: "D", by: "p1", turnsLeft: 4 });
  });

  it("solo la Q del palo exigido es válida bajo A", () => {
    let s = mk({ top: "7H", hands: { 0: ["AH", "9C"], 1: ["QH", "QS", "5S"] } });
    s = act(s, 0, play("AH", { demandSuit: "S" }));
    expect(fail(s, 1, play("QH"))).toMatch(/única Q válida/);
    s = act(s, 1, play("QS"));
    expect(s.freePlay).toBe(false);
    expect(s.demand?.kind).toBe("suit");
  });

  it("una especial del palo exigido aplica su efecto", () => {
    let s = mk({ top: "7H", hands: { 0: ["AH", "9C"], 1: ["2S", "9S"], 2: ["8S", "8C"] }, n: 3 });
    s = act(s, 0, play("AH", { demandSuit: "S" }));
    s = act(s, 1, play("2S"));
    expect(s.pending).toEqual({ kind: "draw", amount: 2 });
    expect(turnOf(s)).toBe(2);
    // Y una K♠ del palo exigido genera su pending
    let k = mk({ top: "7H", hands: { 0: ["AH", "9C"], 1: ["KS", "9S"], 2: ["8S", "8C"] }, n: 3 });
    k = act(k, 0, play("AH", { demandSuit: "S" }));
    k = act(k, 1, play("KS"));
    expect(k.pending).toEqual({ kind: "king", from: "p1", target: "p0", card: "KS" });
  });
});

/* -------------------------------- K --------------------------------------- */

describe("K de corazones / picas", () => {
  /** K♥ de p0 y respuestas, con n jugadores. */
  function kingGame(n: number, card: "KH" | "KS") {
    const opposite: CardId = card === "KH" ? "KS" : "KH";
    const hands: Record<number, CardId[]> = {};
    for (let i = 0; i < n; i++) hands[i] = ["9C", "9D", "8C"];
    hands[0] = [card, "9C", "9D"];
    const target = card === "KH" ? 1 % n : (n - 1) % n;
    hands[target] = [...hands[target], opposite];
    const top: CardId = card === "KH" ? "7H" : "7S";
    return { s: mk({ n, top, hands }), target };
  }

  it("K♥ aceptada (4 jug.): objetivo roba 5 y pierde turno → next(next(p))", () => {
    const { s: s0 } = kingGame(4, "KH");
    let s = act(s0, 0, play("KH"));
    expect(s.pending).toEqual({ kind: "king", from: "p0", target: "p1", card: "KH" });
    expect(turnOf(s)).toBe(1);
    expect(fail(s, 2, { type: "accept" })).toMatch(/Esperando a que Bian/);
    const before = s.hands.p1.length;
    s = act(s, 1, { type: "accept" });
    expect(s.hands.p1).toHaveLength(before + 5);
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(2);
    expect(top(s)).toBe("KH");
  });

  it("K♥ respondida con K♠ (4 jug.): p roba 10, turno next(target)", () => {
    const { s: s0 } = kingGame(4, "KH");
    let s = act(s0, 0, play("KH"));
    const before = s.hands.p0.length;
    s = act(s, 1, play("KS"));
    expect(s.hands.p0).toHaveLength(before + 10);
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(2);
    expect(top(s)).toBe("KS");
  });

  it("K♠ aceptada (4 jug.): el objetivo (prev) roba 5, turno next(p)", () => {
    const { s: s0 } = kingGame(4, "KS");
    let s = act(s0, 0, play("KS"));
    expect(s.pending).toEqual({ kind: "king", from: "p0", target: "p3", card: "KS" });
    expect(turnOf(s)).toBe(3); // actúa el objetivo aunque no sea su turno
    const before = s.hands.p3.length;
    s = act(s, 3, { type: "accept" });
    expect(s.hands.p3).toHaveLength(before + 5);
    expect(turnOf(s)).toBe(1);
  });

  it("K♠ respondida con K♥ (4 jug.): p roba 10 y se avanza uno", () => {
    const { s: s0 } = kingGame(4, "KS");
    let s = act(s0, 0, play("KS"));
    const before = s.hands.p0.length;
    s = act(s, 3, play("KH"));
    expect(s.hands.p0).toHaveLength(before + 10);
    expect(turnOf(s)).toBe(1); // p0 es el loser: next(p0)
    expect(top(s)).toBe("KH");
  });

  it("2 jugadores: K♥ aceptada → vuelve a jugar p", () => {
    const { s: s0 } = kingGame(2, "KH");
    let s = act(s0, 0, play("KH"));
    s = act(s, 1, { type: "accept" });
    expect(turnOf(s)).toBe(0);
  });

  it("2 jugadores: K♥ respondida con K♠ → juega el objetivo (p es el loser)", () => {
    const { s: s0 } = kingGame(2, "KH");
    let s = act(s0, 0, play("KH"));
    s = act(s, 1, play("KS"));
    expect(s.hands.p0.length).toBeGreaterThanOrEqual(12);
    expect(turnOf(s)).toBe(1);
  });

  it("2 jugadores: K♠ aceptada → vuelve a jugar p", () => {
    const { s: s0 } = kingGame(2, "KS");
    let s = act(s0, 0, play("KS"));
    expect(s.pending).toMatchObject({ target: "p1" });
    s = act(s, 1, { type: "accept" });
    expect(turnOf(s)).toBe(0);
  });

  it("2 jugadores: K♠ respondida con K♥ → juega el objetivo", () => {
    const { s: s0 } = kingGame(2, "KS");
    let s = act(s0, 0, play("KS"));
    s = act(s, 1, play("KH"));
    expect(turnOf(s)).toBe(1);
  });

  it("ni Q, ni 2, 3 o 4, ni la misma K responden a una K", () => {
    const s = mk({
      top: "KH",
      turn: 1,
      hands: { 1: ["QH", "2H", "3H", "4H", "KH", "KS"] },
      patch: { pending: { kind: "king", from: "p0", target: "p1", card: "KH" } },
    });
    for (const c of ["QH", "2H", "3H", "4H", "KH"] as CardId[]) {
      expect(fail(s, 1, play(c))).toMatch(/KS|K♠/);
    }
    expect(polaco.getView(s, "p1").legal.plays).toEqual(["KS"]);
    expect(polaco.getView(s, "p1").legal.canAccept).toBe(true);
  });

  it("K♣ y K♦ son cartas normales", () => {
    let s = mk({ top: "7C", hands: { 0: ["KC", "9C"] } });
    s = act(s, 0, play("KC"));
    expect(s.pending).toBeNull();
    expect(turnOf(s)).toBe(1);
  });

  it("K♥ solo se tira con corazones u otra K", () => {
    const s = mk({ top: "7S", hands: { 0: ["KH", "9C"] } });
    expect(fail(s, 0, play("KH"))).toMatch(/no encaja/);
    const s2 = mk({ top: "KC", hands: { 0: ["KH", "9C"] } });
    expect(act(s2, 0, play("KH")).pending?.kind).toBe("king");
  });
});

/* ------------------------- Carta inicial y reparto ------------------------ */

describe("createGame", () => {
  it("la carta inicial nunca es especial (muchas semillas)", () => {
    const players = NAMES.slice(0, 4).map((name, i) => ({ id: `p${i}`, name }));
    for (let seed = 1; seed <= 300; seed++) {
      const s = polaco.createGame(players, { handSize: 5 }, seqRng(seed));
      expect(isSpecial(s.discard[0])).toBe(false);
      for (const p of players) expect(s.hands[p.id]).toHaveLength(5);
      expect(s.deck.length + s.discard.length + 20).toBe(52);
      expect(new Set([...s.deck, ...s.discard, ...Object.values(s.hands).flat()]).size).toBe(52);
    }
  });

  it("incluso con 40 cartas repartidas siempre hay carta inicial no especial", () => {
    const players = NAMES.slice(0, 8).map((name, i) => ({ id: `p${i}`, name }));
    for (let seed = 1; seed <= 100; seed++) {
      const s = polaco.createGame(players, { handSize: 5 }, seqRng(seed));
      expect(isSpecial(s.discard[0])).toBe(false);
    }
  });

  it("una carta especial en el tope se devuelve al mazo y se remezcla (determinista)", () => {
    const players = NAMES.slice(0, 2).map((name, i) => ({ id: `p${i}`, name }));
    const a = polaco.createGame(players, { handSize: 5 }, seqRng(7));
    const b = polaco.createGame(players, { handSize: 5 }, seqRng(7));
    expect(a).toEqual(b);
    const c = polaco.createGame(players, { handSize: 5 }, seqRng(8));
    expect(c).not.toEqual(a);
  });

  it("revancha: empieza el siguiente al que empezó la anterior", () => {
    const players = NAMES.slice(0, 4).map((name, i) => ({ id: `p${i}`, name }));
    const g1 = polaco.createGame(players, { handSize: 5 }, seqRng(3));
    const g2 = polaco.createGame(players, { handSize: 5 }, seqRng(4), g1);
    expect(g2.starter).toBe((g1.starter + 1) % 4);
    expect(g2.turn).toBe(g2.starter);
  });

  it("validación: 2-8 jugadores y cartas × jugadores <= 40", () => {
    expect(polaco.validate?.(1, { handSize: 5 })).toMatch(/2 jugadores/);
    expect(polaco.validate?.(9, { handSize: 3 })).toMatch(/Máximo 8/);
    expect(polaco.validate?.(8, { handSize: 6 })).toMatch(/máximo es 5/);
    expect(polaco.validate?.(8, { handSize: 5 })).toBeNull();
    expect(polaco.validate?.(4, { handSize: 10 })).toBeNull();
    expect(polaco.validate?.(5, { handSize: 9 })).toMatch(/máximo es 8/);
  });
});

/* ------------------------- Macao (solo indicador) -------------------------- */

describe("Macao automático", () => {
  it("no hay acciones ni estado de Macao: quedarse con 1 carta no cambia las reglas", () => {
    expect(polaco.parseAction({ type: "declareMacao" })).toBeNull();
    expect(polaco.parseAction({ type: "denounce", targetId: "p0" })).toBeNull();
    let s = mk({ top: "7H", hands: { 0: ["7S", "9C"], 1: ["5D", "6D"] }, n: 3 });
    s = act(s, 0, play("7S")); // a p0 le queda 1 carta
    expect(s.hands.p0).toHaveLength(1);
    expect(s).not.toHaveProperty("macao");
    const v = polaco.getView(s, "p1");
    expect(v.players.find((p) => p.id === "p0")?.cards).toBe(1); // la UI deriva el badge de aquí
    expect(Object.keys(v.legal).sort()).toEqual(["canAccept", "canDraw", "canPass", "plays"]);
    expect(v.players[0]).not.toHaveProperty("vulnerable");
    expect(v.players[0]).not.toHaveProperty("declared");
  });
});

/* -------------------------------- Victoria -------------------------------- */

describe("victoria", () => {
  it("gana quien se queda sin cartas, incluso con una especial (efecto ignorado)", () => {
    let s = mk({ top: "7H", hands: { 0: ["2H"], 1: ["5D", "6D"] } });
    s = act(s, 0, play("2H"));
    expect(s.winner).toBe("p0");
    expect(s.pending).toBeNull();
    expect(polaco.getStatus(s)).toEqual({ finished: true, winnerId: "p0" });
    expect(fail(s, 1, play("5D"))).toMatch(/terminado/);
  });

  it("ganar con una J no exige elegir número", () => {
    const s = act(mk({ top: "7H", hands: { 0: ["JH"] } }), 0, play("JH"));
    expect(s.winner).toBe("p0");
  });

  it("ganar con la K opuesta como respuesta", () => {
    const s = mk({
      top: "KH",
      turn: 1,
      hands: { 1: ["KS"] },
      patch: { pending: { kind: "king", from: "p0", target: "p1", card: "KH" } },
    });
    expect(act(s, 1, play("KS")).winner).toBe("p1");
  });
});

/* ------------------------------ Pureza y vistas --------------------------- */

describe("pureza y vistas", () => {
  it("applyAction no muta el estado de entrada", () => {
    const s = mk({ top: "7H", hands: { 0: ["7S", "9C"] } });
    const snapshot = structuredClone(s);
    act(s, 0, play("7S"));
    fail(s, 0, play("9C"));
    expect(s).toEqual(snapshot);
  });

  it("la vista no expone el mazo ni las manos ajenas", () => {
    const s = mk({ top: "7H", hands: { 0: ["7S", "9C"], 1: ["5D", "6D"] } });
    const v = polaco.getView(s, "p0");
    const json = JSON.stringify(v);
    expect(v.hand).toEqual(["7S", "9C"]);
    expect(json).not.toContain("5D");
    expect(json).not.toContain("6D");
    expect(v.players.find((p) => p.id === "p1")?.cards).toBe(2);
    expect(v).not.toHaveProperty("deck");
    expect(v).not.toHaveProperty("hands");
    expect(JSON.stringify(v)).not.toContain("seed");
    expect(v.deckCount).toBe(s.deck.length);
  });

  it("parseAction valida el JSON de entrada", () => {
    expect(polaco.parseAction({ type: "play", card: "7S" })).toEqual({ type: "play", card: "7S" });
    expect(polaco.parseAction({ type: "play", card: "ZZ" })).toBeNull();
    expect(polaco.parseAction({ type: "play", card: "JH", demandRank: "7" })).toEqual({
      type: "play",
      card: "JH",
      demandRank: "7",
    });
    expect(polaco.parseAction({ type: "play", card: "JH", demandRank: "3" })).toBeNull();
    expect(polaco.parseAction({ type: "nope" })).toBeNull();
    expect(polaco.parseAction(null)).toBeNull();
    expect(polaco.parseAction({ type: "declareMacao" })).toBeNull();
    expect(polaco.parseAction({ type: "denounce", targetId: "x" })).toBeNull();
  });

  it("una partida completa simulada con jugadas legales aleatorias termina o se mantiene consistente", () => {
    const players = NAMES.slice(0, 4).map((name, i) => ({ id: `p${i}`, name }));
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seqRng(seed * 101);
      let s = polaco.createGame(players, { handSize: 5 }, rng);
      for (let step = 0; step < 3000 && !s.winner; step++) {
        const pid = s.players[s.turn].id;
        const v = polaco.getView(s, pid);
        let a: PolacoAction;
        if (v.legal.plays.length) {
          const card = v.legal.plays[Math.floor(rng() * v.legal.plays.length)];
          const r = parseCard(card).rank;
          a = {
            type: "play",
            card,
            demandRank: r === "J" ? "7" : undefined,
            demandSuit: r === "A" ? "H" : undefined,
          };
        } else if (v.legal.canAccept) a = { type: "accept" };
        else if (v.legal.canDraw) a = { type: "draw" };
        else a = { type: "pass" };
        const res = polaco.applyAction(s, pid, a, rng);
        expect(res.ok, JSON.stringify([seed, step, a, res])).toBe(true);
        if (res.ok) s = res.state;
        const total =
          s.deck.length + s.discard.length + Object.values(s.hands).reduce((n, h) => n + h.length, 0);
        expect(total).toBe(52);
      }
    }
  });
});

/* ------------------------ Correcciones de revisión ------------------------ */

describe("RNG inyectado y sin semilla en el estado", () => {
  it("el estado y las vistas no contienen semilla", () => {
    const players = NAMES.slice(0, 3).map((name, i) => ({ id: `p${i}`, name }));
    const s = polaco.createGame(players, { handSize: 5 }, seqRng(5));
    expect(s).not.toHaveProperty("seed");
    expect(JSON.stringify(s)).not.toMatch(/seed/i);
    for (const p of players) expect(JSON.stringify(polaco.getView(s, p.id))).not.toMatch(/seed/i);
  });

  it("el remezclado usa el RNG que se inyecta en applyAction (mismo RNG, mismo resultado; otro RNG, otro orden)", () => {
    const s = mk({
      top: "7H",
      hands: { 0: ["9S", "9C"] },
      deck: [],
      discardBelow: ["5D", "6D", "8D", "10D", "2D", "3D", "4D", "AD"],
    });
    const a = act(s, 0, { type: "draw" }, seqRng(11));
    const b = act(s, 0, { type: "draw" }, seqRng(11));
    const c = act(s, 0, { type: "draw" }, seqRng(12));
    expect(a).toEqual(b);
    expect([...a.deck, ...a.hands.p0]).not.toEqual([...c.deck, ...c.hands.p0]);
  });

  it("un rng constante no rompe el motor", () => {
    const players = NAMES.slice(0, 2).map((name, i) => ({ id: `p${i}`, name }));
    const s = polaco.createGame(players, { handSize: 5 }, () => 0.5);
    expect(isSpecial(s.discard[0])).toBe(false);
  });
});

describe("la carta robada solo se ve para quien decide", () => {
  it("drawn es null para el resto de jugadores", () => {
    const s = mk({ top: "7H", hands: { 0: ["9S", "9C"], 1: ["5D", "6D"] }, deck: ["5D", "KH"] });
    const r = act(s, 0, { type: "draw" });
    expect(r.drawn).toBe("KH");
    expect(polaco.getView(r, "p0").drawn).toBe("KH");
    expect(polaco.getView(r, "p1").drawn).toBeNull();
    expect(JSON.stringify(polaco.getView(r, "p1"))).not.toContain("KH");
  });
});

describe("la demanda cuenta los turnos realmente terminados al resolver una K", () => {
  /** Demanda de palo vigente (para poder tirar la K del palo exigido) y una K con su respuesta. */
  function kingWithDemand(n: number, card: "KH" | "KS") {
    const hands: Record<number, CardId[]> = {};
    for (let i = 0; i < n; i++) hands[i] = ["9C", "9D", "8C"];
    hands[0] = [card, "9C", "9D"];
    const target = card === "KH" ? 1 % n : (n - 1) % n;
    hands[target] = [...hands[target], card === "KH" ? "KS" : "KH"];
    const suit = card === "KH" ? "H" : "S";
    const s = mk({
      n,
      top: "7H",
      hands,
      patch: { demand: { kind: "suit", suit, by: "p0", turnsLeft: n + 3 } },
    });
    return { s, target };
  }
  const left = (s: PolacoState) => s.demand?.turnsLeft ?? 0;

  it("4 jugadores: K♥ cuenta el turno de quien la tira y el del objetivo (2), acepte o responda", () => {
    const a = kingWithDemand(4, "KH");
    const accepted = act(act(a.s, 0, play("KH")), 1, { type: "accept" });
    expect(left(accepted)).toBe(7 - 2);
    const b = kingWithDemand(4, "KH");
    const answered = act(act(b.s, 0, play("KH")), 1, play("KS"));
    expect(left(answered)).toBe(7 - 2);
    expect(turnOf(answered)).toBe(2);
  });

  it("4 jugadores: K♠ solo cuenta el turno de quien la tira (1), acepte o responda; la respuesta fuera de turno no cuenta", () => {
    const a = kingWithDemand(4, "KS");
    const accepted = act(act(a.s, 0, play("KS")), 3, { type: "accept" });
    expect(left(accepted)).toBe(7 - 1);
    expect(turnOf(accepted)).toBe(1);
    const b = kingWithDemand(4, "KS");
    const answered = act(act(b.s, 0, play("KS")), 3, play("KH"));
    expect(left(answered)).toBe(7 - 1);
    expect(turnOf(answered)).toBe(1);
  });

  it("2 jugadores: cada turno consumido cuenta, sin quedarse corto por el módulo", () => {
    const d = (n: number, card: "KH" | "KS") => kingWithDemand(n, card).s;
    // K♥ aceptada: turno de p + turno (penalizado) del objetivo = 2
    expect(left(act(act(d(2, "KH"), 0, play("KH")), 1, { type: "accept" }))).toBe(5 - 2);
    // K♥ respondida con K♠: p, objetivo y el turno perdido de p = 3
    expect(left(act(act(d(2, "KH"), 0, play("KH")), 1, play("KS")))).toBe(5 - 3);
    // K♠ aceptada: p y el turno perdido del objetivo = 2
    expect(left(act(act(d(2, "KS"), 0, play("KS")), 1, { type: "accept" }))).toBe(5 - 2);
    // K♠ respondida: solo el de p = 1
    expect(left(act(act(d(2, "KS"), 0, play("KS")), 1, play("KH")))).toBe(5 - 1);
  });
});

describe("la Q y la demanda", () => {
  it("bajo demanda de A, la Q del palo exigido no limpia la demanda ni da jugada libre", () => {
    let s = mk({ n: 3, top: "7H", hands: { 0: ["AH", "9C"], 1: ["QS", "5S"], 2: ["8S", "8C", "AC"] } });
    s = act(s, 0, play("AH", { demandSuit: "S" }));
    expect(s.demand?.turnsLeft).toBe(3);
    s = act(s, 1, play("QS"));
    expect(s.freePlay).toBe(false);
    expect(s.demand).toEqual({ kind: "suit", suit: "S", by: "p0", turnsLeft: 2 }); // sigue contando la vuelta
    // El siguiente sigue obligado: palo exigido u otra A (o robar)
    expect(polaco.getView(s, "p2").legal.plays.sort()).toEqual(["8S", "AC"]);
    expect(fail(s, 2, play("8C"))).toMatch(/Te exigen/);
  });

  it("la demanda sigue su vuelta completa tras la Q y caduca a su hora", () => {
    let s = mk({ n: 3, top: "7H", hands: { 0: ["AH", "9C", "9D"], 1: ["QS", "5S"], 2: ["8S", "8C"] } });
    s = act(s, 0, play("AH", { demandSuit: "S" })); // 3
    s = act(s, 1, play("QS")); // 2
    s = act(s, 2, play("8S")); // 1
    expect(s.demand?.turnsLeft).toBe(1);
    expect(turnOf(s)).toBe(0);
    expect(fail(s, 0, play("9C"))).toMatch(/Te exigen/); // quien la tiró también cumple
  });

  it("bajo demanda de J la Q sigue siendo ilegal", () => {
    let s = mk({ top: "7H", hands: { 0: ["JH", "9C"], 1: ["QH", "9S"] } });
    s = act(s, 0, play("JH", { demandRank: "9" }));
    expect(fail(s, 1, play("QH"))).toMatch(/Q bajo la demanda/);
  });

  it("fuera de una demanda la Q sigue dando jugada libre", () => {
    let s = mk({ top: "7H", hands: { 0: ["QC", "9C"], 1: ["5S", "9D"] } });
    s = act(s, 0, play("QC"));
    expect(s.freePlay).toBe(true);
  });
});
