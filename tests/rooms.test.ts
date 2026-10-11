import { describe, expect, it } from "vitest";
import { createRoom, gameAction, getRoomView, joinRoom, startGame } from "@/lib/server/rooms";
import { HttpError } from "@/lib/server/http";

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

describe("servicio de salas", () => {
  it("GET sin token válido responde 401 exista o no la sala (no se pueden enumerar salas)", async () => {
    const { code } = await createRoom("Ana");
    expect(await status(getRoomView(code, null, null))).toBe(401);
    expect(await status(getRoomView(code, "token-falso", null))).toBe(401);
    expect(await status(getRoomView("ZZZZ", null, null))).toBe(401);
    expect(await status(getRoomView("ZZZZ", "token-falso", null))).toBe(401);
  });

  it("unirse a una sala inexistente sigue diciendo que no existe (404)", async () => {
    expect(await status(joinRoom("ZZZY", "Bian"))).toBe(404);
  });

  it("acciones con token sobre una sala inexistente también dan 401", async () => {
    expect(await status(startGame("ZZZX", "token"))).toBe(401);
    expect(await status(gameAction("ZZZX", "token", { type: "draw" }))).toBe(401);
  });

  it("las vistas de los jugadores no filtran semilla, mazo ni la carta robada ajena", async () => {
    const a = await createRoom("Ana");
    const b = await joinRoom(a.code, "Bian");
    await startGame(a.code, a.token);
    const va = (await getRoomView(a.code, a.token, null)) as { game: Record<string, unknown> };
    const vb = (await getRoomView(b.code, b.token, null)) as { game: Record<string, unknown> };
    for (const v of [va, vb]) {
      expect(JSON.stringify(v)).not.toMatch(/seed/i);
      expect(v.game).not.toHaveProperty("deck");
      expect(v.game).not.toHaveProperty("hands");
    }
    const handA = va.game.hand as string[];
    for (const c of handA) expect(JSON.stringify(vb.game)).not.toContain(`"${c}"`);
    expect(await getRoomView(a.code, a.token, (va as unknown as { version: number }).version)).toEqual({ unchanged: true });
  });
});
