import { useSyncExternalStore } from 'react';
import { type CardId, type Suit, RANKS, parseCard } from '@/lib/rules/cards';

/**
 * Orden de la mano propia: preferencia solo de visualización (no toca el servidor ni la API).
 * - `suit`: agrupada por palo y, dentro de cada palo, de menor a mayor.
 * - `asc` / `desc`: por número (A, 2 … 10, J, Q, K); a igual número, por palo.
 * El A cuenta como 1 (bajo), igual que en el orden de la SPEC; sin comodines en la baraja.
 */
export type HandOrder = 'suit' | 'asc' | 'desc';
export const HAND_ORDERS: readonly HandOrder[] = ['suit', 'asc', 'desc'];
export const DEFAULT_HAND_ORDER: HandOrder = 'suit';

/** Palos alternando color (negro, rojo, negro, rojo) para que dos grupos contiguos no se confundan. */
const SUIT_DISPLAY_ORDER: readonly Suit[] = ['S', 'H', 'C', 'D'];

const STORAGE_KEY = 'macao:handOrder';
const CHANGE_EVENT = 'macao:handOrder';

export function sortHand(hand: readonly CardId[], order: HandOrder): CardId[] {
  const key = (id: CardId) => {
    const { rank, suit } = parseCard(id);
    return { r: RANKS.indexOf(rank), s: SUIT_DISPLAY_ORDER.indexOf(suit) };
  };
  return [...hand].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (order === 'suit') return ka.s - kb.s || ka.r - kb.r;
    const byRank = order === 'asc' ? ka.r - kb.r : kb.r - ka.r;
    return byRank || ka.s - kb.s;
  });
}

const isHandOrder = (v: unknown): v is HandOrder => typeof v === 'string' && (HAND_ORDERS as string[]).includes(v);

/** Respaldo en memoria si `localStorage` no está disponible (modo privado, cuota llena). */
let memory: HandOrder | null = null;

export function loadHandOrder(): HandOrder {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isHandOrder(raw)) return raw;
  } catch {
    /* sin acceso a localStorage */
  }
  return memory ?? DEFAULT_HAND_ORDER;
}

export function saveHandOrder(order: HandOrder): void {
  memory = order;
  try {
    localStorage.setItem(STORAGE_KEY, order);
  } catch {
    /* modo privado: queda el respaldo en memoria mientras dure la pestaña */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && onChange();
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Preferencia vigente, sincronizada entre componentes y pestañas. En el servidor, el valor por defecto. */
export function useHandOrder(): [HandOrder, (order: HandOrder) => void] {
  const order = useSyncExternalStore(subscribe, loadHandOrder, () => DEFAULT_HAND_ORDER);
  return [order, saveHandOrder];
}
