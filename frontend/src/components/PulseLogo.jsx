export default function PulseLogo({ size = 20, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5"
        fill="hsl(var(--card))"
        stroke="hsl(var(--border))"
        strokeWidth="1.2"
      />
      <path
        d="M5 12 H8 L9.6 7.8 L12.8 16.2 L15 9.4 L16.5 12 H19"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
