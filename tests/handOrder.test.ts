import { describe, expect, it } from 'vitest';
import { sortHand } from '@/lib/client/handOrder';
import type { CardId } from '@/lib/rules/cards';

const hand: CardId[] = ['QD', '3S', 'AH', 'KC', '3H', '10S', 'AC', '7D'];

describe('orden de la mano', () => {
  it('por palo: ♠ ♥ ♣ ♦ (alternando color) y de menor a mayor dentro de cada palo', () => {
    expect(sortHand(hand, 'suit')).toEqual(['3S', '10S', 'AH', '3H', 'AC', 'KC', '7D', 'QD']);
  });

  it('ascendente: A bajo, figuras al final; a igual número, por palo', () => {
    expect(sortHand(hand, 'asc')).toEqual(['AH', 'AC', '3S', '3H', '7D', '10S', 'QD', 'KC']);
  });

  it('descendente: K primero, A al final; a igual número, por palo', () => {
    expect(sortHand(hand, 'desc')).toEqual(['KC', 'QD', '10S', '7D', '3S', '3H', 'AH', 'AC']);
  });

  it('no muta la mano original', () => {
    const copy = [...hand];
    sortHand(hand, 'asc');
    expect(hand).toEqual(copy);
  });
});
