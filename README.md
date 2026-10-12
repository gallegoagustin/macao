# Macao Web

Macao (Polaco) multijugador para jugar entre amigos. Alguien crea una sala, recibe un código de 4 letras y el resto entra con él. Servidor autoritativo en Route Handlers, estado en Upstash Redis y polling cada ~1 s (sin WebSockets). La especificación completa está en [SPEC.md](./SPEC.md).

## Ejecutar en local

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Sin variables de entorno de Redis se usa un store en memoria (`MemoryRoomStore`), así que funciona sin configurar nada. Para probar con varios jugadores abre otra ventana de incógnito (la identidad se guarda en `localStorage`).

Otros comandos:

```bash
npm test           # vitest (motor de reglas)
pnpm typecheck  # tsc --noEmit
pnpm build
```

## Conectar Upstash en Vercel

El store en memoria **no sirve en Vercel** (cada invocación puede caer en una instancia distinta). En producción hace falta Redis:

1. En el proyecto de Vercel: **Storage → Upstash Redis → Connect to project** (Marketplace).
2. La integración inyecta las variables de entorno. Se aceptan cualquiera de los dos pares:
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN`
3. Redespliega. Para probar en local contra Redis, `vercel env pull .env.local`.

Las salas caducan a las 24 h desde la última escritura. Las escrituras usan un script Lua que compara `version` (CAS) y la API reintenta hasta 5 veces.

## Añadir un set de reglas

1. Crea `lib/rules/<nombre>.ts` y exporta un objeto que implemente `RuleSet<S, A, V>` (ver `lib/types.ts` y `lib/rules/polaco.ts` como referencia):
   - `createGame(players, config, rng, prev?)`, `applyAction(state, playerId, action)`, `getView(state, playerId)`: funciones puras, con el RNG inyectado (Polaco guarda la semilla dentro del estado).
   - `config`: campos que la UI del anfitrión pinta en el lobby; `validate` para comprobaciones cruzadas. Los textos (nombre, descripción, etiquetas, errores y registro) no van en el set: devuelve `Msg` (`code` + `params`) y añade las claves en `messages/*.json` (`rules.<id>.*`, `msg.*`).
   - `parseAction` valida el JSON que llega por la API y `getStatus` indica si la partida terminó.
   - La vista (`V`) nunca debe incluir mazo ni manos ajenas.
2. Regístralo en `lib/rules/index.ts`.
3. Añade tests en `tests/`. Si la vista no es compatible con `PolacoView`, la mesa (`components/Table.tsx`) necesitará su propia variante.

El selector de reglas del lobby todavía muestra un único set (Polaco): al añadir el segundo hay que alimentarlo con `listRuleSets()`.

## pnpm en Vercel

El proyecto usa `pnpm@11.5.2` (campo `packageManager`). Para que Vercel respete esa versión:

- Variable de entorno `ENABLE_EXPERIMENTAL_COREPACK=1` en el proyecto (desde el dashboard).
- Node.js Version 22.x o superior en Project Settings (pnpm 11 necesita Node >= 22.5).

`pnpm-workspace.yaml` declara `packages: ['.']`, así que también instala con pnpm 9 si Vercel lo elige por su cuenta.
