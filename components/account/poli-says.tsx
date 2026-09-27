import type { ReactNode } from 'react';
import { Art } from '../art';

export type PoliPose = 'welcome' | 'encourage' | 'thinking' | 'rest';

/**
 * Poli at the top of a sign-in or account card, with one short line in a
 * speech bubble (docs/design.md: companion-led). The picture is decoration,
 * so it has no alt text; the line is read as part of the card. The art is
 * drawn at under 100px, so `sizes` asks for the smallest file.
 */
export function PoliSays({
  pose,
  children,
}: {
  pose: PoliPose;
  children: ReactNode;
}) {
  return (
    <div className="poli-says">
      <Art
        name={`poli-${pose}`}
        alt=""
        className="poli-says-art"
        sizes="88px"
        width={900}
        height={900}
        priority
      />
      <p className="poli-says-bubble">{children}</p>
    </div>
  );
}
