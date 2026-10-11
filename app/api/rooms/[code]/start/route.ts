import { startGame } from '@/lib/server/rooms';
import { HttpError, handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const token = req.headers.get('x-player-token');
    if (!token) throw new HttpError(401, 'No formas parte de esta sala.', 'not_member');
    return json(await startGame(code, token));
  });
}
