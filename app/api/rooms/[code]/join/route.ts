import { joinRoom } from "@/lib/server/rooms";
import { handle, json, readBody } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readBody(req);
    return json(await joinRoom(code, body.name));
  });
}
