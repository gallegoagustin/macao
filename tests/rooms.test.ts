import { describe, expect, it } from 'vitest';
import {
  createRoom,
  endGame,
  gameAction,
  getRoomView,
  joinRoom,
  kick,
  leaveRoom,
  loadRoom,
  setConfig,
  startGame
} from '@/lib/server/rooms';
import { HttpError } from '@/lib/server/http';
import type { Msg } from '@/lib/types';

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

describe('servicio de salas', () => {
  it('GET sin token válido responde 401 exista o no la sala (no se pueden enumerar salas)', async () => {
    const { code } = await createRoom('Ana');
    expect(await status(getRoomView(code, null, null))).toBe(401);
    expect(await status(getRoomView(code, 'token-falso', null))).toBe(401);
    expect(await status(getRoomView('ZZZZ', null, null))).toBe(401);
    expect(await status(getRoomView('ZZZZ', 'token-falso', null))).toBe(401);
  });

  it('unirse a una sala inexistente sigue diciendo que no existe (404)', async () => {
    expect(await status(joinRoom('ZZZY', 'Bian'))).toBe(404);
  });

  it('acciones con token sobre una sala inexistente también dan 401', async () => {
    expect(await status(startGame('ZZZX', 'token'))).toBe(401);
    expect(await status(gameAction('ZZZX', 'token', { type: 'draw' }))).toBe(401);
  });

  it('las vistas de los jugadores no filtran semilla, mazo ni la carta robada ajena', async () => {
    const a = await createRoom('Ana');
    const b = await joinRoom(a.code, 'Bian');
    await startGame(a.code, a.token);
    const va = (await getRoomView(a.code, a.token, null)) as { game: Record<string, unknown> };
    const vb = (await getRoomView(b.code, b.token, null)) as { game: Record<string, unknown> };
    for (const v of [va, vb]) {
      expect(JSON.stringify(v)).not.toMatch(/seed/i);
      expect(v.game).not.toHaveProperty('deck');
      expect(v.game).not.toHaveProperty('hands');
    }
    const handA = va.game.hand as string[];
    for (const c of handA) expect(JSON.stringify(vb.game)).not.toContain(`"${c}"`);
    expect(await getRoomView(a.code, a.token, (va as unknown as { version: number }).version)).toEqual({
      unchanged: true
    });
  });
});

describe('salir y finalizar', () => {
  async function room3() {
    const a = await createRoom('Ana');
    const b = await joinRoom(a.code, 'Bian');
    const c = await joinRoom(a.code, 'Cris');
    return { code: a.code, a, b, c };
  }

  it('en el lobby: sale el jugador y, si era el host, pasa al siguiente en orden de asiento', async () => {
    const { code, a, b, c } = await room3();
    await leaveRoom(code, a.token);
    const r = await loadRoom(code);
    expect(r.players.map((p) => p.name)).toEqual(['Bian', 'Cris']);
    expect(r.hostId).toBe(b.playerId); // el siguiente al que se fue
    expect(await status(getRoomView(code, a.token, null))).toBe(401); // ya no es miembro
    // si se va el último asiento siendo host, pasa al primero
    await kick(code, b.token, c.playerId).catch(() => null); // Bian ya es host
    const only = await loadRoom(code);
    expect(only.players).toHaveLength(1);
  });

  it('a mitad de partida: la mano vuelve al mazo y el juego continúa', async () => {
    const { code, a, b, c } = await room3();
    await startGame(code, a.token);
    const before = await loadRoom(code);
    const g0 = before.game as { deck: unknown[]; hands: Record<string, unknown[]> };
    const bHand = g0.hands[b.playerId].length;
    await leaveRoom(code, b.token);
    const after = await loadRoom(code);
    const g1 = after.game as { deck: unknown[]; hands: Record<string, unknown[]>; players: { id: string }[] };
    expect(after.phase).toBe('playing');
    expect(after.players).toHaveLength(2);
    expect(g1.players.map((p) => p.id)).not.toContain(b.playerId);
    expect(g1.deck.length).toBe(g0.deck.length + bHand);
    const v = (await getRoomView(code, c.token, null)) as { game: { players: unknown[] } };
    expect(v.game.players).toHaveLength(2);
  });

  it('si queda 1 solo jugador la partida termina y la sala vuelve al lobby con un aviso', async () => {
    const a = await createRoom('Ana');
    const b = await joinRoom(a.code, 'Bian');
    await startGame(a.code, a.token);
    await leaveRoom(a.code, b.token);
    const r = await loadRoom(a.code);
    expect(r.phase).toBe('lobby');
    expect(r.game).toBeNull();
    expect(r.players).toHaveLength(1);
    expect(r.notice).toEqual({ code: 'notice.matchCancelled', params: { name: 'Bian' } });
    const v = (await getRoomView(a.code, a.token, null)) as { notice: Msg | null };
    expect(v.notice?.params).toMatchObject({ name: 'Bian' });
  });

  it('si no queda nadie la sala se borra', async () => {
    const a = await createRoom('Ana');
    await leaveRoom(a.code, a.token);
    expect(await status(loadRoom(a.code))).toBe(404);
    expect(await status(joinRoom(a.code, 'Bian'))).toBe(404);
  });

  it('el host finaliza la partida: lobby con los mismos jugadores y configuración', async () => {
    const { code, a, b } = await room3();
    await setConfig(code, a.token, { ruleSetId: 'polaco', config: { handSize: 4 } });
    await startGame(code, a.token);
    expect(await status(endGame(code, b.token))).toBe(403);
    await endGame(code, a.token);
    const r = await loadRoom(code);
    expect(r.phase).toBe('lobby');
    expect(r.game).toBeNull();
    expect(r.players).toHaveLength(3);
    expect(r.config).toEqual({ handSize: 4 });
    expect(r.notice).toEqual({ code: 'notice.hostEnded' });
    expect(await status(endGame(code, a.token))).toBe(409); // ya no hay partida
    await startGame(code, a.token); // se puede volver a empezar y limpia el aviso
    expect((await loadRoom(code)).notice).toBeNull();
  });
});

describe('cronómetro de partida', () => {
  it('startedAt se fija al empezar, sale en la vista y se limpia al volver al lobby', async () => {
    const a = await createRoom('Ana');
    await joinRoom(a.code, 'Bian');
    const lobby = (await getRoomView(a.code, a.token, null)) as { startedAt: number | null; finishedAt: number | null };
    expect(lobby.startedAt).toBeNull();
    expect(lobby.finishedAt).toBeNull();

    const t0 = Date.now();
    await startGame(a.code, a.token);
    const playing = (await getRoomView(a.code, a.token, null)) as {
      startedAt: number | null;
      finishedAt: number | null;
    };
    expect(playing.startedAt).toBeGreaterThanOrEqual(t0);
    expect(playing.startedAt).toBeLessThanOrEqual(Date.now());
    expect(playing.finishedAt).toBeNull();

    await endGame(a.code, a.token);
    const back = await loadRoom(a.code);
    expect(back.startedAt).toBeNull();
    expect(back.finishedAt).toBeNull();
  });
});
