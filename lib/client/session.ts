export interface Session {
  playerId: string;
  token: string;
}

const key = (code: string) => `macao:session:${code.toUpperCase()}`;
const NAME_KEY = "macao:name";

export function loadSession(code: string): Session | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, s: Session): void {
  try {
    localStorage.setItem(key(code), JSON.stringify(s));
  } catch {
    /* modo privado: la sesión vivirá solo mientras dure la pestaña */
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(key(code));
  } catch {
    /* noop */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* noop */
  }
}
