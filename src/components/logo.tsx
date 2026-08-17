/**
 * Sentinel mark — a shield with radar sweep rings, drawn inline so there is no
 * image asset to load or generate.
 */

export function SentinelLogo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Sentinel Memory"
      className="shrink-0"
    >
      <path
        d="M16 2.5 4.5 7v9.2c0 6.9 4.7 11.8 11.5 13.8 6.8-2 11.5-6.9 11.5-13.8V7L16 2.5Z"
        fill="#0D1B2A"
        stroke="#38BDF8"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3" stroke="#38BDF8" strokeWidth="1.2" opacity="0.85" />
      <circle cx="16" cy="16" r="6.6" stroke="#38BDF8" strokeWidth="1" opacity="0.45" />
      <circle cx="16" cy="16" r="10" stroke="#38BDF8" strokeWidth="0.9" opacity="0.22" />
      <path d="M16 16 24 10.6" stroke="#F59E0B" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.4" fill="#F59E0B" />
    </svg>
  );
}

export function SentinelWordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <SentinelLogo />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-ink">SENTINEL</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-info/80">Memory</div>
      </div>
    </div>
  );
}
