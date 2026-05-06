/** Контур геймпада для марки бренда / заголовка поиска; цвет через `currentColor`. */
export function GamepadMarkIcon({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      shapeRendering="geometricPrecision"
    >
      <path
        d="M6.5 9.5h11a4.5 4.5 0 0 1 4.5 4.5v.5a3 3 0 0 1-3 3h-.5a3 3 0 0 1-2.1-.9l-1.1-1.1a1.5 1.5 0 0 0-2.2 0l-1.1 1.1a3 3 0 0 1-2.1.9H6a3 3 0 0 1-3-3V14a4.5 4.5 0 0 1 4.5-4.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 12h2M9 11v2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="16.25" cy="10.25" r="0.65" fill="currentColor" />
      <circle cx="18.25" cy="12.25" r="0.65" fill="currentColor" />
      <circle cx="14.25" cy="12.25" r="0.65" fill="currentColor" />
      <circle cx="16.25" cy="14.25" r="0.65" fill="currentColor" />
      <circle cx="10" cy="15.5" r="1.15" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="14.5" cy="15.5" r="1.15" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
