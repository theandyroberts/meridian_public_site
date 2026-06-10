import Link from "next/link";

/** The mark: wireframe globe, orange horizon, warm wires above, cool below. */
export function GlobeMark({ size = 36 }: { size?: number }) {
  const warm = "#C56B3E";
  const cool = "#8A8780";
  const wires = (
    <>
      <ellipse cx="50" cy="50" rx="17" ry="45" fill="none" strokeWidth="1.5" />
      <ellipse cx="50" cy="50" rx="33" ry="45" fill="none" strokeWidth="1.3" />
      <ellipse cx="50" cy="50" rx="44" ry="45" fill="none" strokeWidth="1.1" />
      <ellipse cx="50" cy="28" rx="36" ry="9" fill="none" strokeWidth="1.4" />
      <ellipse cx="50" cy="40" rx="43" ry="11" fill="none" strokeWidth="1.4" />
      <ellipse cx="50" cy="60" rx="43" ry="11" fill="none" strokeWidth="1.4" />
      <ellipse cx="50" cy="72" rx="36" ry="9" fill="none" strokeWidth="1.4" />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id="plab-top">
          <rect x="0" y="0" width="100" height="50" />
        </clipPath>
        <clipPath id="plab-bottom">
          <rect x="0" y="50" width="100" height="50" />
        </clipPath>
      </defs>
      <g clipPath="url(#plab-top)" stroke={warm} opacity="0.95">
        {wires}
      </g>
      <g clipPath="url(#plab-bottom)" stroke={cool} opacity="0.8">
        {wires}
      </g>
      <circle cx="50" cy="50" r="45" fill="none" stroke="#F4F1EA" strokeWidth="4" />
      <line x1="5" y1="50" x2="95" y2="50" stroke={warm} strokeWidth="5" />
      <circle cx="50" cy="50" r="4.5" fill={warm} />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      style={{ display: "flex", alignItems: "center", gap: 14 }}
      aria-label="The Plate Lab home"
    >
      <GlobeMark size={38} />
      <span style={{ display: "grid", lineHeight: 1 }}>
        <span className="mono accent" style={{ fontSize: 9 }}>
          The
        </span>
        <span
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "0.06em",
            marginTop: 2,
          }}
        >
          PLATE LAB
        </span>
        <span className="mono dimmer" style={{ fontSize: 8, marginTop: 3 }}>
          360×180 Environments
        </span>
      </span>
    </Link>
  );
}
