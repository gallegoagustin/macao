# Macao Web: spec

Juego de cartas Macao multijugador para jugar entre amigos. Alguien crea una sala, recibe un código de 4 letras, el resto entra con ese código y juegan. El host elige el set de reglas. Primer set: **Polaco**.

## Stack

- Next.js (última estable, App Router), TypeScript strict, Tailwind v4.
- Deploy en Vercel. Estado en **Upstash Redis** (`@upstash/redis`, instalado desde el Marketplace de Vercel).
- Sin WebSockets: el cliente hace polling cada ~1 s.
- Gestor de paquetes: **npm** (pnpm no está instalado en esta máquina).
- Tests: vitest para el motor de reglas.
- UI en castellano neutro con tuteo (sin voseo) e inglés, con `next-intl` sin prefijo en la URL (cookie `NEXT_LOCALE` → `Accept-Language` → `es`). Textos en `messages/{es,en}.json`. Mobile-first.

## Arquitectura

### Servidor autoritativo

Toda la lógica corre en Route Handlers. El cliente nunca recibe el mazo ni las manos ajenas, solo su mano y el número de cartas de los demás.

### Identidad

Sin cuentas. Al crear o unirse a una sala, el servidor devuelve `playerId` + `token` (random, 32 bytes). El cliente los guarda en `localStorage` con la clave del código de sala y manda el token en el header `x-player-token` en cada request. Al recargar la página, se reengancha solo.

### Store

```ts
interface RoomStore {
  get(code: string): Promise<Room | null>;
  create(room: Room): Promise<boolean>; // false si el código ya existe (SET NX)
  compareAndSet(code: string, expectedVersion: number, next: Room): Promise<boolean>;
}
```

- `UpstashRoomStore`: el CAS se hace con un script Lua (`EVAL`) que compara `version` antes de escribir. TTL de 24 h, que se renueva en cada escritura.
- `MemoryRoomStore`: un `Map` en `globalThis`. Se usa cuando no hay variables de entorno de Redis, para que `npm run dev` funcione sin configurar nada.
- Variables de entorno: aceptar `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` **o** `KV_REST_API_URL`/`KV_REST_API_TOKEN` (la integración de Vercel puede inyectar cualquiera de los dos pares).
- Las acciones se aplican con un bucle leer → aplicar → CAS, con hasta 5 reintentos.

### API

| Método | Ruta                                | Qué hace                                                                 |
| ------ | ----------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/rooms`                        | `{name}` → crea la sala, el creador es host → `{code, playerId, token}`  |
| POST   | `/api/rooms/[code]/join`            | `{name}` → solo en lobby, máximo 8 jugadores, nombre único en la sala    |
| GET    | `/api/rooms/[code]?since=<version>` | vista del jugador. Si `version === since` → `{unchanged: true}`          |
| POST   | `/api/rooms/[code]/config`          | host, solo en lobby: `{ruleSetId, config}`                               |
| POST   | `/api/rooms/[code]/kick`            | host, solo en lobby                                                      |
| POST   | `/api/rooms/[code]/start`           | host: reparte y empieza. También sirve para la revancha desde `finished` |
| POST   | `/api/rooms/[code]/action`          | acción de juego (ver abajo)                                              |
| POST   | `/api/rooms/[code]/leave`           | cualquier jugador abandona la sala (lobby o partida)                     |
| POST   | `/api/rooms/[code]/end`             | host: finaliza la partida para todos y vuelve al lobby                   |

Código de sala: 4 letras mayúsculas sin ambiguas (sin I, O). Si colisiona, se reintenta.

### Motor de reglas (pluggable)

```ts
interface RuleSet<S, A, V> {
  id: string; // 'polaco'
  name: string; // 'Polaco'
  description: string;
  config: ConfigField[]; // para pintar el form del host (p. ej. handSize: min 3, max 10, default 5)
  createGame(players: PlayerRef[], config: Record<string, number>, rng: () => number): S;
  applyAction(state: S, playerId: string, action: A): { ok: true; state: S } | { ok: false; error: string };
  getView(state: S, playerId: string): V; // incluye las jugadas legales de ese jugador
}
```

- Registro en `lib/rules/index.ts`. Añadir una variante es añadir un fichero, sin tocar ni la API ni la mesa más allá de lo que use la variante.
- **Funciones puras y deterministas** (RNG inyectado) para poder testearlas.
- El servidor no emite texto: errores, avisos y registro de la mesa son `{ code, params? }` (tipo `Msg`) y el cliente los traduce con la clave `msg.<code>`. Un código nuevo exige añadir la clave en `es.json` y `en.json` (un test comprueba que tienen las mismas claves).

### Salir y finalizar

- **Salir (`leave`)**, en lobby o en partida. En partida, su mano se baraja de vuelta en el mazo y el juego continúa. Si era su turno, el turno pasa al siguiente. Un `pending` de robo o salto pasa tal cual al siguiente jugador. Una K pendiente que el jugador que sale ha tirado o que le tenía como objetivo se cancela (el turno sigue con el siguiente a quien la tiró). `turnsLeft` de una demanda se recorta al nuevo número de jugadores. Si queda 1 solo jugador, la partida termina y la sala vuelve al lobby. Si el que sale era el host, pasa al siguiente en orden de asiento. Si no queda nadie, la sala se borra. El cliente borra su identidad de `localStorage` y vuelve a Home.
- **Finalizar (`end`)**: solo el host; vuelve al lobby con los mismos jugadores y la misma configuración.
- Se avisa a los demás: línea en el log al salir un jugador y aviso en el lobby al finalizar o cancelarse la partida.

## Reglas: Polaco

### Básico

- Una baraja francesa de 52 cartas, sin comodines.
- De 2 a 8 jugadores. Cartas por jugador configurables por el host (default 5, de 3 a 10). Validar `handSize * jugadores <= 40`.
- Carta inicial: se da vuelta la de arriba del mazo. Si es especial, vuelve al mazo, se mezcla y se saca otra hasta que salga una no especial. **No especiales:** 5 a 10, K de tréboles y K de diamantes.
- El orden de turno es fijo (no hay cartas que inviertan el sentido). En la primera partida empieza un jugador al azar. En la revancha empieza el siguiente al que empezó la anterior.
- **Jugada normal:** tirar una carta que coincida en palo o número con la de arriba de la mesa.
- **Robar (voluntario):** en tu turno puedes robar 1 carta del mazo aunque tengas jugadas legales, siempre que no haya un `pending` (con un `pending`, "aceptar" es el robo). Si la carta robada se puede jugar, puedes tirar **esa carta sola** en el mismo turno o pasar. Si no se puede jugar, el turno pasa solo. Si la jugada no tiene salida (sin jugadas ni cartas que robar) se puede pasar.

### Jugadas de varias cartas

Una acción `play` lleva un array ordenado de cartas: la primera toca la mesa y la última queda arriba. Una carta sola es un array de 1. Se valida todo en el servidor; el motor expone `validatePlay` (puro, solo usa tu mano y el estado público) y el cliente lo importa para dar feedback en vivo.

**Escalera (>= 3 cartas de números consecutivos, cualquier palo)**

- Ascendente o descendente, el jugador elige el orden. Orden de números: A,2,...,10,J,Q,K,A. El A puede ser bajo (A-2-3) o alto (Q-K-A). Sin vuelta (K-A-2 no vale). Cualquier longitud >= 3.
- La **primera** carta tiene que ser legal sobre la mesa con las reglas normales de una carta suelta (palo/número, Q comodín, jugada libre tras una Q; bajo demanda de J/A, la primera debe cumplir la demanda). Las demás solo tienen que continuar la escalera.
- Solo cuenta el efecto de la **última** carta: 2-3-4 deja un salto, 4-3-2 deja +2, acabar en J/A pide demanda, acabar en Q da jugada libre (salvo demanda activa), acabar en K♥/K♠ dispara la K. Las anteriores no tienen efecto.
- Una escalera **no** puede responder a un `pending` (robo, salto o K).
- Bajo demanda, la demanda sigue corriendo su vuelta como con cualquier jugada.

**Grupo (>= 3 cartas del mismo número)**

- Al menos una debe ser legal sobre la mesa y esa va primera (el jugador ordena; la última queda arriba y su palo es el que sigue).
- Los efectos se suman: n doses = +2n, n treses = +3n, n cuatros = n saltos. J/A: una sola demanda (se elige una vez). Grupo de Q: como una Q (la primera respeta las restricciones de la Q). Grupo de K: solo cuenta el efecto de la carta de arriba si es K♥/K♠ (K♣/K♦ arriba = sin efecto).
- Un grupo **sí** puede responder a su propia cadena: un grupo de 2 o de 3 responde a un robo acumulado (suma su total) y un grupo de 4 responde a un salto (suma n). Los grupos de otros números no pueden responder a un `pending`.
- Bajo demanda de J de un número, vale un grupo de ese número; bajo demanda de A, la primera carta debe ser del palo exigido.
- Con 2 cartas no hay jugada múltiple (hacen falta >= 3).
- Mazo vacío: se mezcla el descarte menos la carta de arriba. Si aun así no alcanza, se roba lo que haya.

### Cartas especiales

**4 (salto acumulable)**

- Al tirar un 4 se crea `pending = {kind:'skip', count:1}` y el turno pasa al siguiente.
- El jugador que tiene un salto pendiente puede:
  - tirar **cualquier 4** (de cualquier palo): `count + 1` y el turno pasa al siguiente, o
  - aceptar: pierde el turno, `count - 1` y el turno pasa al siguiente.
- Cuando `count` llega a 0, el pending se limpia y ese jugador juega normal sobre el 4.
- Ejemplo: A tira 4, B tira 4 (count 2), C acepta (1), D acepta (0), A juega normal.

**2 y 3 (robo acumulable)**

- Al tirar un 2 se crea `pending = {kind:'draw', amount:2}` (un 3 suma 3). El turno pasa al siguiente.
- El jugador que tiene un robo pendiente puede:
  - tirar **cualquier 2 o 3** (de cualquier palo): suma al `amount` y el turno pasa al siguiente, o
  - aceptar: roba `amount` cartas y **pierde el turno**.
- Mientras hay robo pendiente, solo se puede responder con 2 o 3. Ni Q, ni K, ni 4.

**J (exige un número)**

- Al tirarla, quien la tira elige un número del 5 al 10 **o "nada"**. Si elige nada, la J es una carta normal.
- Si exige un número: `demand = {kind:'rank', rank, by, turnsLeft: nJugadores}`.
- Mientras dura la demanda solo se puede tirar una carta de ese número (cualquier palo) **u otra J**. La nueva J reemplaza la demanda (con un número nuevo o con nada) y reinicia `turnsLeft`.
- Bajo demanda de J **no se puede tirar Q**.
- Quien no puede cumplir roba 1 (la regla de jugar la carta robada aplica si cumple la demanda).

**A (exige un palo)**

- Al tirarla, quien la tira elige un palo: `demand = {kind:'suit', suit, by, turnsLeft: nJugadores}`.
- Mientras dura la demanda solo se puede tirar una carta de ese palo (incluidas las especiales de ese palo, que aplican su efecto) **u otra A**, que reemplaza la demanda y reinicia `turnsLeft`.
- Bajo demanda de A, la única Q válida es la del palo exigido (y no cancela la demanda, ver Q).

**Duración de la demanda:** una vuelta completa. `turnsLeft` empieza en el número de jugadores y baja 1 cada vez que termina el turno de alguien (juegue, robe, pase, sea saltado o acepte una penalización). Así, quien tiró la J o la A también tiene que cumplir su propia demanda cuando le vuelve el turno. Cuando `turnsLeft` llega a 0, la demanda desaparece y se juega normal sobre la carta de arriba.

**Q (comodín)**

- Se puede tirar sobre cualquier carta, sin importar palo o número, **excepto**:
  - si hay cualquier `pending` (robo, salto o K), y
  - bajo demanda de J (nunca), o bajo demanda de A (solo la Q del palo exigido).
- Fuera de una demanda, después de una Q el siguiente jugador puede tirar **cualquier carta** (`freePlay = true`). Se limpia después de esa jugada.
- Bajo una demanda de A, la Q del palo exigido **no** limpia la demanda (sigue corriendo su vuelta completa) y **no** da jugada libre: la demanda manda. El siguiente jugador sigue obligado a tirar el palo exigido u otra A, o robar.

**K de corazones / K de picas**

- Para tirarlas se siguen las reglas normales (corazones u otra K para la K de corazones; picas u otra K para la de picas). Las K de tréboles y diamantes son cartas normales.
- K de corazones tirada por `p`: `target = next(p)`. K de picas tirada por `p`: `target = prev(p)`.
- Se crea `pending = {kind:'king', from:p, target, card}`. **Quien tiene que actuar es `target`**, aunque no sea su turno (en el caso de la K de picas, normalmente no lo es).
- `target` puede:
  - responder con la **K opuesta** (corazones contra picas y viceversa): `p` roba **10**, o
  - aceptar: `target` roba **5**.
- Quien roba pierde su próximo turno si le tocaba justo después. Turno siguiente, con `loser` = quien robó:

| Caso                               | Turno base     | Ajuste                                     |
| ---------------------------------- | -------------- | ------------------------------------------ |
| K corazones aceptada               | `next(p)`      | es el loser → `next(next(p))`              |
| K corazones respondida con K picas | `next(target)` | si es `p` → avanzar uno                    |
| K picas aceptada                   | `next(p)`      | si es el loser (2 jugadores) → avanzar uno |
| K picas respondida con K corazones | `next(p)`      | `p` es el loser → avanzar uno              |

- La carta de arriba queda siendo la última K tirada.
- Ni Q, ni 2, ni 3, ni 4 responden a una K.

### Macao

Sin acciones ni estado de juego: es un indicador puramente visual y automático. Cuando un jugador tiene exactamente 1 carta, la UI muestra un badge "¡Macao!" en su ficha de rival (y en la cabecera de tu propia mano). No hay declarar, denunciar ni penalizaciones.

### Fin

- Gana el primero que se queda sin cartas. Se puede ganar con una especial (su efecto se ignora). Estado `finished`, se muestra el ganador y el host puede lanzar la revancha.

### Acciones

```ts
type Action =
  | { type: 'play'; cards: CardId[]; demandRank?: '5' | '6' | '7' | '8' | '9' | '10' | null; demandSuit?: Suit }
  | { type: 'draw' } // robo voluntario (sin pending); la carta robada, si se puede, se juega sola o se pasa
  | { type: 'pass' } // solo después de robar una carta jugable
  | { type: 'accept' }; // aceptar el pending (robar N / ser saltado / robar 5 por K)
```

### Tests imprescindibles

Mínimo: matching normal; robar solo sin jugada legal; jugar la carta robada; cadena 2+3+2 y aceptar 7; respuesta a un 2 con un 3 de otro palo; Q rechazada sobre una cadena; salto acumulado con 4 jugadores (el ejemplo de arriba); salto con 2 jugadores; J con número, cumplir, J sobre J, J con "nada"; Q bloqueada bajo J; A con palo, solo la Q de ese palo; la demanda caduca tras una vuelta y el que la tiró también tiene que cumplir; especial del palo exigido aplica su efecto; las 4 filas de la tabla de K, también con 2 jugadores; carta inicial no especial; remezcla del mazo; robo voluntario con jugadas legales; escaleras (ascendente, descendente, A bajo y alto, K-A-2 rechazada, primera carta que cumple mesa/demanda, efecto de la última carta, no responden a un pending); grupos (suma de efectos, responden a su cadena, una sola demanda, K de arriba, primera carta legal); salir (turno propio, cadena pendiente, K pendiente, host, quedar 1 jugador); finalizar; victoria con una especial.

## UI

- **Home:** apodo + "Crear sala" | código + "Unirse".
- **Lobby** (`/sala/[code]`): código grande con copiar y compartir (`navigator.share` con el link), lista de jugadores, host marcado. El host ve el selector de set de reglas (solo Polaco, con su descripción), el campo cartas por jugador, puede echar jugadores y tiene el botón Empezar (con 2 o más jugadores). El resto ve la config en solo lectura.
- **Mesa:**
  - arriba: los rivales con nombre, número de cartas, indicador de turno y badge "¡Macao!" cuando les queda 1 carta;
  - centro: el mazo (botón Robar) y el descarte (carta de arriba), con chips de estado: "+7 acumulado", "Salta 2", "Exige un 7", "Exige ♥", "Q: tiras lo que quieras", "K♥: robas 5 o respondes";
  - abajo: tu mano en abanico o scroll horizontal. Tocar una carta la **selecciona** (se eleva y muestra una insignia con el orden de jugada; volver a tocarla la quita). Aparece el botón "Tirar" ("Tirar escalera (3)", "Tirar trío (3)"), activo solo si `validatePlay` da el visto bueno; si no, se muestra el motivo. Doble toque sobre una carta jugable la tira directamente. Sin selección se resaltan las cartas con las que se puede empezar una jugada legal; con selección, las que la pueden ampliar;
  - al pulsar "Tirar", si la última carta es una J sale un selector 5-10 + "Nada"; si es una A, un selector de palo;
  - botones según el contexto: Robar (siempre visible en tu turno si no hay pending), Pasar, Aceptar (con el texto de lo que implica), Tirar;
  - botón Salir (con confirmación) en lobby y mesa; el host tiene además "Finalizar partida" (con confirmación) en la mesa;
  - un log corto de las últimas ~5 jugadas ("Bian tiró 2♠, +4 acumulado").
- **Fin:** ganador + Revancha (host).
- Cartas dibujadas con CSS/SVG (sin imágenes), palos rojos y negros, que se lean bien en el móvil.
- El polling se pausa con `document.hidden` y se recupera al volver.

## Fuera de alcance (v1)

Reconexión con otro dispositivo, timeouts de turno, chat, cuentas, animaciones elaboradas.
