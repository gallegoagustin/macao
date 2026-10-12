import { NextResponse } from 'next/server';
import { type Msg, type MsgParam, msg } from '../types';

/** Error HTTP con un mensaje estable (`code` + `params`): el cliente lo traduce, el servidor no emite texto. */
export class HttpError extends Error {
  public msg: Msg;
  constructor(
    public status: number,
    code: string,
    params?: Record<string, MsgParam>
  ) {
    super(code);
    this.msg = msg(code, params);
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Envuelve un handler: convierte HttpError en respuesta JSON `{code, params?}`. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json(e.msg, e.status);
    console.error(e);
    return json(msg('error.internal'), 500);
  }
}
