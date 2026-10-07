import React from 'react';
import Link from '@docusaurus/Link';

// The base14.io wordmark: the isometric cube mark beside "base14", with "14"
// in the accent. Mirrors Wordmark and B14Mark in the base14.io repo
// (src/components/b14/navbar.tsx and src/components/b14/logo.tsx).

const FACES = [
  '0.953,-0.550 0.000,0.000 0.000,-1.950 0.953,-2.500',
  '-0.953,-0.550 0.000,0.000 0.000,-1.950 -0.953,-2.500',
  '0.000,-3.050 0.953,-2.500 0.000,-1.950 -0.953,-2.500',
  '0.953,0.550 0.000,0.000 1.689,-0.975 2.641,-0.425',
  '-0.000,-1.100 0.000,0.000 1.689,-0.975 1.689,-2.075',
  '2.641,-1.525 2.641,-0.425 1.689,-0.975 1.689,-2.075',
  '0.000,1.100 -0.000,0.000 1.689,0.975 1.689,2.075',
  '0.953,-0.550 -0.000,0.000 1.689,0.975 2.641,0.425',
  '2.641,1.525 1.689,2.075 1.689,0.975 2.641,0.425',
  '-0.953,0.550 -0.000,0.000 0.000,1.950 -0.953,2.500',
  '0.953,0.550 -0.000,0.000 0.000,1.950 0.953,2.500',
  '0.000,3.050 -0.953,2.500 0.000,1.950 0.953,2.500',
  '-0.953,-0.550 0.000,-0.000 -1.689,0.975 -2.641,0.425',
  '0.000,1.100 0.000,-0.000 -1.689,0.975 -1.689,2.075',
  '-2.641,1.525 -2.641,0.425 -1.689,0.975 -1.689,2.075',
  '0.000,-1.100 0.000,0.000 -1.689,-0.975 -1.689,-2.075',
  '-0.953,0.550 0.000,0.000 -1.689,-0.975 -2.641,-0.425',
  '-2.641,-1.525 -1.689,-2.075 -1.689,-0.975 -2.641,-0.425',
];

// The top cube is drawn again, clipped to its upper-left wedge, to cover the
// seam where the side cubes' edges would otherwise show through it.
const SEAM_FACES = FACES.slice(0, 3);

function B14Mark() {
  return (
    <svg
      viewBox="-3.25 -3.35 6.5 6.7"
      className="b14-mark"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="b14-mark-seam">
          <polygon points="0,0 -3.464,-2 0,-4" />
        </clipPath>
      </defs>
      <g stroke="currentColor" strokeWidth="0.2" strokeLinejoin="round" fill="var(--b14-black)">
        {FACES.map((points) => (
          <polygon key={points} points={points} />
        ))}
        <g clipPath="url(#b14-mark-seam)">
          {SEAM_FACES.map((points) => (
            <polygon key={points} points={points} />
          ))}
        </g>
      </g>
    </svg>
  );
}

export default function NavbarLogo() {
  return (
    <Link to="/" className="navbar__brand b14-wordmark" aria-label="base14 home">
      <B14Mark />
      <span className="b14-wordmark__text">
        base<span className="b14-wordmark__accent">14</span>
      </span>
    </Link>
  );
}
