import { createRoom } from "@/lib/server/rooms";
import { handle, json, readBody } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const body = await readBody(req);
    return json(await createRoom(body.name), 201);
  });
}
