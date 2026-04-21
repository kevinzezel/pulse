'use client';

export default function SidebarCard({
  active = false,
  activeColor = null,
  onClick,
  onClickTitle,
  title,
  subtitle,
  actions,
  alwaysExpanded = false,
}) {
  const customActive = active && activeColor;
  const wrapperStyle = customActive
    ? {
        borderColor: `hsla(${activeColor} / 0.4)`,
        backgroundColor: `hsla(${activeColor} / 0.1)`,
      }
    : undefined;

  return (
    <div
      className={`group rounded-md mb-1 border transition-colors relative ${
        active
          ? (customActive ? '' : 'border-primary/40 bg-primary/10')
          : 'border-transparent hover:bg-muted/40'
      }`}
      style={wrapperStyle}
    >
      <div
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        title={onClickTitle}
      >
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm truncate flex items-center gap-1 ${
              active && !customActive ? 'text-primary' : 'text-foreground'
            }`}
          >
            {title}
          </div>
          {subtitle && (
            <div className="text-[10px] text-muted-foreground truncate">
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {actions && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center gap-0.5 px-3 transition-all overflow-hidden ${
            alwaysExpanded
              ? 'max-h-8 opacity-100 pb-1.5'
              : 'max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100 group-hover:pb-1.5'
          }`}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
