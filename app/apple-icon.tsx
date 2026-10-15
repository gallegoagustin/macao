import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, #0f3b2e 0%, #061a14 100%)'
      }}>
      <svg width='140' height='140' viewBox='0 0 64 64'>
        <g transform='translate(32 32) rotate(-8)'>
          <rect x='-18' y='-25.2' width='36' height='50.4' rx='4.5' fill='#f8f1df' stroke='#dfae4d' strokeWidth='1.8' />
          <path
            fill='#17171c'
            d='M0-13C4-8 12-4 12 3C12 7.2 8.8 9.6 5.4 9.6C3.8 9.6 2.4 9 1.5 8C1.7 10.6 2.6 12.6 4.4 14H-4.4C-2.6 12.6 -1.7 10.6 -1.5 8C-2.4 9 -3.8 9.6 -5.4 9.6C-8.8 9.6 -12 7.2 -12 3C-12 -4 -4 -8 0-13Z'
          />
        </g>
      </svg>
    </div>,
    { ...size }
  );
}
