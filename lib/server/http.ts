import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
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

/** Envuelve un handler: convierte HttpError en respuesta JSON `{error, code?}`. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error(e);
    return json({ error: 'Error interno del servidor.' }, 500);
  }
}
