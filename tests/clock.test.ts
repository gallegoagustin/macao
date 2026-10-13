import { describe, expect, it } from 'vitest';
import { formatElapsed, isoDuration } from '@/lib/client/clock';

describe('cronómetro', () => {
  it('mm:ss por debajo de una hora', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(9_999)).toBe('00:09');
    expect(formatElapsed(61_000)).toBe('01:01');
    expect(formatElapsed(3_599_999)).toBe('59:59');
  });

  it('h:mm:ss desde una hora', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(36_000_000)).toBe('10:00:00');
  });

  it('nunca negativo (reloj del cliente por detrás del servidor)', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
    expect(isoDuration(-5_000)).toBe('PT0H0M0S');
  });

  it('duración ISO para <time datetime>', () => {
    expect(isoDuration(3_723_000)).toBe('PT1H2M3S');
  });
});
