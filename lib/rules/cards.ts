export type Suit = "H" | "S" | "D" | "C"; // corazones, picas, diamantes, tréboles
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type CardId = `${Rank}${Suit}`;

export const SUITS: readonly Suit[] = ["S", "H", "D", "C"];
export const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const SUIT_GLYPH: Record<Suit, string> = { H: "♥", S: "♠", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { H: "corazones", S: "picas", D: "diamantes", C: "tréboles" };

export function parseCard(id: CardId): { rank: Rank; suit: Suit } {
  return { rank: id.slice(0, -1) as Rank, suit: id.slice(-1) as Suit };
}

export function makeCard(rank: Rank, suit: Suit): CardId {
  return `${rank}${suit}`;
}

export function makeDeck(): CardId[] {
  const deck: CardId[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(makeCard(r, s));
  return deck;
}

export function isRedSuit(suit: Suit): boolean {
  return suit === "H" || suit === "D";
}

export function cardLabel(id: CardId): string {
  const { rank, suit } = parseCard(id);
  return `${rank}${SUIT_GLYPH[suit]}`;
}

export function isCardId(v: unknown): v is CardId {
  if (typeof v !== "string" || v.length < 2 || v.length > 3) return false;
  const rank = v.slice(0, -1);
  const suit = v.slice(-1);
  return (RANKS as readonly string[]).includes(rank) && (SUITS as readonly string[]).includes(suit);
}
