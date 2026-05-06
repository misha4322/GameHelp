import type { ReactNode } from "react";

export default function MessagesLayout({ children }: { children: ReactNode }) {
  return <div className="messages-layout-shell">{children}</div>;
}
