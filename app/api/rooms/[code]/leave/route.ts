import { leaveRoom } from '@/lib/server/rooms';
import { HttpError, handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const token = req.headers.get('x-player-token');
    if (!token) throw new HttpError(401, 'error.notMember');
    return json(await leaveRoom(code, token));
  });
}
