/** RNG criptográfico en [0, 1): 32 bits por llamada, suficiente para barajar 52 cartas. */
export function secureRng(): () => number {
  const buf = new Uint32Array(1);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}
