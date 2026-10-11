import { getRoomView } from "@/lib/server/rooms";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const raw = new URL(req.url).searchParams.get("since");
    const since = raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null;
    return json(await getRoomView(code, req.headers.get("x-player-token"), since));
  });
}
