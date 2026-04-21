'use client';

export default function ServerTag({ name, color, size = 'xs' }) {
  if (!name) return null;
  const hsl = color || '220 10% 55%';
  const textSize = size === 'xs' ? 'text-[9px]' : 'text-[10px]';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded ${textSize} font-medium flex-shrink-0`}
      style={{
        background: `hsl(${hsl} / 0.18)`,
        color: `hsl(${hsl})`,
      }}
      title={name}
    >
      <span className="truncate max-w-[80px]">{name}</span>
    </span>
  );
}
