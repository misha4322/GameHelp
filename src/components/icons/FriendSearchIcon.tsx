/** Иконка «поиск друга»: лупа + силуэт; цвет через `currentColor`. */
export function FriendSearchIcon({
  size = 24,
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
    >
      <circle
        cx="10.5"
        cy="10.5"
        r="5.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14.5 14.5 19 19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8.2 9.1c.35-.55 1-.9 1.75-.9s1.4.35 1.75.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8.35" cy="8.1" r="0.55" fill="currentColor" />
      <circle cx="11.65" cy="8.1" r="0.55" fill="currentColor" />
    </svg>
  );
}
