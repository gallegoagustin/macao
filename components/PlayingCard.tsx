import { type CardId, type Suit, SUIT_NAME, isRedSuit, parseCard } from "@/lib/rules/cards";

const RANK_NAME: Record<string, string> = { A: "As", J: "Jota", Q: "Reina", K: "Rey" };

export function cardAriaLabel(id: CardId): string {
  const { rank, suit } = parseCard(id);
  return `${RANK_NAME[rank] ?? rank} de ${SUIT_NAME[suit]}`;
}

/** Símbolo de palo dibujado con SVG (viewBox 24x24), centrado en (x, y) con tamaño `size`. */
export function SuitMark({ suit, x, y, size, flip = false }: { suit: Suit; x: number; y: number; size: number; flip?: boolean }) {
  const s = size / 24;
  const transform = `translate(${x - size / 2} ${y - size / 2}) ${flip ? `rotate(180 ${size / 2} ${size / 2}) ` : ""}scale(${s})`;
  return (
    <g transform={transform} fill="currentColor" aria-hidden="true">
      {suit === "H" && (
        <path d="M12 21.5s-8.5-5.4-8.5-11.8C3.5 6.5 5.8 4.5 8.4 4.5c1.5 0 2.8.7 3.6 1.9.8-1.2 2.1-1.9 3.6-1.9 2.6 0 4.9 2 4.9 5.2 0 6.4-8.5 11.8-8.5 11.8z" />
      )}
      {suit === "D" && <path d="M12 1.5l7.5 10.5L12 22.5 4.5 12z" />}
      {suit === "S" && (
        <path d="M12 1.8C12 1.8 3.5 8.2 3.5 13.6a4.3 4.3 0 0 0 7.6 2.7c-.1 2.1-.9 3.7-2.3 5.4h6.4c-1.4-1.7-2.2-3.3-2.3-5.4a4.3 4.3 0 0 0 7.6-2.7C20.5 8.2 12 1.8 12 1.8z" />
      )}
      {suit === "C" && (
        <>
          <circle cx="12" cy="7.2" r="4.6" />
          <circle cx="6.3" cy="14.2" r="4.6" />
          <circle cx="17.7" cy="14.2" r="4.6" />
          <path d="M12 11l-3.2 11.2h6.4z" />
        </>
      )}
    </g>
  );
}

/** Posiciones (columna 0-2, fila 0-6) de los símbolos de las cartas numéricas. */
const PIPS: Record<string, [number, number][]> = {
  "2": [[1, 0], [1, 6]],
  "3": [[1, 0], [1, 3], [1, 6]],
  "4": [[0, 0], [2, 0], [0, 6], [2, 6]],
  "5": [[0, 0], [2, 0], [1, 3], [0, 6], [2, 6]],
  "6": [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6], [2, 6]],
  "7": [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [0, 6], [2, 6]],
  "8": [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [1, 4.5], [0, 6], [2, 6]],
  "9": [[0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 4], [2, 4], [0, 6], [2, 6]],
  "10": [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4], [1, 5], [0, 6], [2, 6]],
};

const PIP_X = [34, 50, 66];
const pipY = (row: number) => 36 + row * 11.5;

export function PlayingCard({ id, className = "" }: { id: CardId; className?: string }) {
  const { rank, suit } = parseCard(id);
  const red = isRedSuit(suit);
  const pips = PIPS[rank];
  return (
    <svg
      viewBox="0 0 100 140"
      className={`card-face ${red ? "text-ruby" : "text-ink"} ${className}`}
      role="img"
      aria-label={cardAriaLabel(id)}
    >
      <rect x="1" y="1" width="98" height="138" rx="9" className="card-paper" />
      <rect x="1" y="1" width="98" height="138" rx="9" fill="none" stroke="var(--color-paper-edge)" strokeWidth="1.5" />
      {/* Esquinas */}
      <g>
        <text x="9" y="23" className="card-rank" fill="currentColor" textAnchor="start" fontSize={rank === "10" ? 21 : 25}>
          {rank}
        </text>
        <SuitMark suit={suit} x={14} y={36} size={13} />
      </g>
      <g transform="rotate(180 50 70)">
        <text x="9" y="23" className="card-rank" fill="currentColor" textAnchor="start" fontSize={rank === "10" ? 21 : 25}>
          {rank}
        </text>
        <SuitMark suit={suit} x={14} y={36} size={13} />
      </g>
      {/* Centro */}
      {pips ? (
        pips.map(([c, r], i) => (
          <SuitMark key={i} suit={suit} x={PIP_X[c]} y={pipY(r) + 11} size={17} flip={r > 3} />
        ))
      ) : rank === "A" ? (
        <SuitMark suit={suit} x={50} y={70} size={46} />
      ) : (
        <g>
          <rect x="27" y="30" width="46" height="80" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
          <text x="50" y="82" className="card-rank" fill="currentColor" textAnchor="middle" fontSize="46">
            {rank}
          </text>
          <SuitMark suit={suit} x={50} y={42} size={13} />
          <SuitMark suit={suit} x={50} y={98} size={13} flip />
        </g>
      )}
    </svg>
  );
}

export function CardBack({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 140" className={`card-face ${className}`} aria-hidden="true">
      <defs>
        <pattern id="back-lattice" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#7d1d26" />
          <path d="M0 0H12M0 0V12" stroke="#d9a441" strokeOpacity="0.55" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill="#f7f0df" stroke="#e3d6b6" strokeWidth="1.5" />
      <rect x="7" y="7" width="86" height="126" rx="5" fill="url(#back-lattice)" stroke="#d9a441" strokeWidth="1.5" />
      <circle cx="50" cy="70" r="15" fill="#5c1119" stroke="#d9a441" strokeWidth="1.5" />
      <text x="50" y="77" textAnchor="middle" fontSize="20" fill="#f0cf86" className="card-rank">
        M
      </text>
    </svg>
  );
}
