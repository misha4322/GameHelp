"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isAdminRole, isStaffRole } from "@/lib/roles";
import { useBanRestriction } from "@/contexts/BanRestrictionContext";

function getUnreadCountFromConversation(conversation: any) {
  const possibleNumbers = [
    conversation?.unreadCount,
    conversation?.unread,
    conversation?.unreadMessagesCount,
    conversation?.pendingCount,
  ];

  for (const value of possibleNumbers) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }

  if (conversation?.hasUnread === true) {
    return 1;
  }

  return 0;
}

function isActive(pathname: string, href: string) {
  const hrefPath = href.split("#")[0].split("?")[0];
  if (hrefPath === "/posts/new") {
    return pathname === "/posts/new" || pathname.startsWith("/posts/new/");
  }

  if (hrefPath === "/posts") {
    return (
      pathname === "/posts" ||
      (pathname.startsWith("/posts/") && !pathname.startsWith("/posts/new"))
    );
  }

  if (hrefPath === "/") {
    return pathname === "/";
  }

  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function ProfileWithBanLine({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "desktop" | "mobile";
}) {
  const { restricted, permanent, countdownLabel } = useBanRestriction();

  if (!restricted) {
    return <>{children}</>;
  }

  return (
    <div className={`nav-profile-wrap ${variant === "mobile" ? "nav-profile-wrap-mobile" : ""}`}>
      {children}
      {permanent ? (
        <div className="nav-ban-block nav-ban-block-permanent" role="status" aria-label="Блокировка навсегда">
          <span className="nav-ban-permanent-text">Блокировка</span>
        </div>
      ) : countdownLabel ? (
        <div className="nav-ban-block" role="status" aria-live="polite">
          <span className="nav-ban-timer-label">До разбана</span>
          <span className="nav-ban-timer-digits">{countdownLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function Navbar({ session }: { session: any }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [reportsQueueCount, setReportsQueueCount] = useState(0);

  const userId = session?.user?.id ?? null;
  const role = session?.user?.role;
  const staff = isStaffRole(role);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    let active = true;
    let intervalId: number | undefined;

    const loadUnread = async () => {
      try {
        const res = await fetch(`/api/messages/conversations/${userId}`, {
          cache: "no-store",
        });

        if (!res.ok) return;

        const data = await res.json();
        const list = Array.isArray(data?.conversations) ? data.conversations : [];

        const total = list.reduce((sum: number, conversation: any) => {
          return sum + getUnreadCountFromConversation(conversation);
        }, 0);

        if (active) {
          setUnreadCount(total);
        }
      } catch {
        // no-op
      }
    };

    void loadUnread();
    intervalId = window.setInterval(loadUnread, 15000);

    return () => {
      active = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [userId]);

  useEffect(() => {
    if (!staff) {
      setReportsQueueCount(0);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/reports/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (alive && typeof data.count === "number") {
          setReportsQueueCount(data.count);
        }
      } catch {
        /* no-op */
      }
    };
    void load();
    const intervalId = window.setInterval(load, 45000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [staff]);

  const navItems = useMemo(() => {
    const items = [
      { href: "/", label: "Главная" },
      { href: "/posts", label: "Форум" },
      { href: "/posts/new", label: "Создать пост" },
    ];

    if (userId) {
      items.push(
        { href: "/friends", label: "Друзья" },
        { href: "/messages", label: "Сообщения" }
      );
    }
    if (userId && isStaffRole(role)) {
      items.push(
        isAdminRole(role)
          ? { href: "/admin", label: "Админ" }
          : { href: "/admin?tab=moderation", label: "Модератор" }
      );
    }

    return items;
  }, [userId, role]);

  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <header className="nav">
      <div className="container nav-inner">
        <div className="nav-left">
          <Link className="nav-brand" href="/">
            <span className="nav-brand-mark">
              <img
                src="/brand-gamepad.png"
                alt=""
                className="nav-brand-gamepad-img"
                width={40}
                height={40}
                decoding="async"
              />
            </span>
            <span className="nav-brand-text">
              <span className="nav-brand-title">GameHelp</span>
              <span className="nav-brand-subtitle">форум • друзья • сообщения</span>
            </span>
          </Link>

          <nav className="nav-links">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              const isMessages = item.href === "/messages";
              const isAdminNav = item.href.startsWith("/admin");

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link ${active ? "active" : ""}`}
                >
                  <span>{item.label}</span>
                  {isMessages && unreadCount > 0 ? (
                    <span className="nav-badge">{unreadLabel}</span>
                  ) : null}
                  {isAdminNav && reportsQueueCount > 0 ? (
                    <span className="nav-badge nav-badge-warn">
                      {reportsQueueCount > 99 ? "99+" : String(reportsQueueCount)}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="nav-right">
          {session ? (
            <>
              <ProfileWithBanLine variant="desktop">
                <Link className="nav-profile-chip" href="/profile">
                  {session.user?.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user?.name ?? "Профиль"}
                      className="chip-avatar-image"
                    />
                  ) : (
                    <span className="chip-avatar">
                      {(session.user?.name?.[0] ?? session.user?.username?.[0] ?? "U").toUpperCase()}
                    </span>
                  )}
                  <span>Профиль</span>
                </Link>
              </ProfileWithBanLine>

              <button
                className="btn btn-ghost"
                onClick={() => signOut({ callbackUrl: "/" })}
                type="button"
              >
                Выйти
              </button>
            </>
          ) : (
            <>
              <Link className="btn btn-ghost" href="/auth/login">
                Войти
              </Link>
              <Link className="btn btn-primary" href="/auth/register">
                Регистрация
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="nav-toggle"
          aria-label="Открыть меню"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          <span className="nav-toggle-icon">{mobileOpen ? "✕" : "☰"}</span>
        </button>
      </div>

      {mobileOpen ? (
        <div className="container nav-mobile">
          <div className="nav-mobile-panel">
            <div className="nav-mobile-row">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                const isMessages = item.href === "/messages";
                const isAdminNav = item.href.startsWith("/admin");

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link ${active ? "active" : ""}`}
                  >
                    <span>{item.label}</span>
                    {isMessages && unreadCount > 0 ? (
                      <span className="nav-badge">{unreadLabel}</span>
                    ) : null}
                    {isAdminNav && reportsQueueCount > 0 ? (
                      <span className="nav-badge nav-badge-warn">
                        {reportsQueueCount > 99 ? "99+" : String(reportsQueueCount)}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>

            {session ? (
              <div className="nav-mobile-row">
                <ProfileWithBanLine variant="mobile">
                  <Link className="nav-profile-chip" href="/profile">
                    {session.user?.image ? (
                      <img
                        src={session.user.image}
                        alt={session.user?.name ?? "Профиль"}
                        className="chip-avatar-image"
                      />
                    ) : (
                      <span className="chip-avatar">
                        {(session.user?.name?.[0] ?? session.user?.username?.[0] ?? "U").toUpperCase()}
                      </span>
                    )}
                    <span>Открыть профиль</span>
                  </Link>
                </ProfileWithBanLine>

                <button
                  className="btn btn-ghost"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  type="button"
                >
                  Выйти
                </button>
              </div>
            ) : (
              <div className="nav-mobile-row">
                <Link className="btn btn-ghost" href="/auth/login">
                  Войти
                </Link>
                <Link className="btn btn-primary" href="/auth/register">
                  Регистрация
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
