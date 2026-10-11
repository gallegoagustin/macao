import type { RoomView, Unchanged } from "../types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-player-token": token } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "Sin conexión con el servidor. Reintentando…", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Algo ha salido mal.", data.code);
  return data as T;
}

const post = <T>(path: string, token: string | undefined, body: unknown) =>
  request<T>(path, { method: "POST", token, body: JSON.stringify(body) });

export interface Credentials {
  code: string;
  playerId: string;
  token: string;
}

export const api = {
  createRoom: (name: string) => post<Credentials>("/api/rooms", undefined, { name }),
  joinRoom: (code: string, name: string) => post<Credentials>(`/api/rooms/${code}/join`, undefined, { name }),
  getRoom: (code: string, token: string, since?: number) =>
    request<RoomView | Unchanged>(`/api/rooms/${code}${since ? `?since=${since}` : ""}`, { token }),
  setConfig: (code: string, token: string, ruleSetId: string, config: Record<string, number>) =>
    post<RoomView>(`/api/rooms/${code}/config`, token, { ruleSetId, config }),
  kick: (code: string, token: string, playerId: string) =>
    post<RoomView>(`/api/rooms/${code}/kick`, token, { playerId }),
  start: (code: string, token: string) => post<RoomView>(`/api/rooms/${code}/start`, token, {}),
  action: (code: string, token: string, action: unknown) => post<RoomView>(`/api/rooms/${code}/action`, token, action),
};
