"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSession } from "next-auth/react";

import { formatBanCountdown } from "@/lib/ban-countdown";

export type BanRestrictionValue = {
  loaded: boolean;
  restricted: boolean;
  permanent: boolean;
  bannedUntilMs: number | null;
  /** Оставшееся время до разбана (мс); 0 если нет ограничения по времени */
  remainingMs: number;
  countdownLabel: string | null;
  refresh: () => Promise<void>;
};

const BanRestrictionContext = createContext<BanRestrictionValue | null>(null);

export function BanRestrictionProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [permanent, setPermanent] = useState(false);
  const [bannedUntilMs, setBannedUntilMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") {
      setLoaded(true);
      setRestricted(false);
      setPermanent(false);
      setBannedUntilMs(null);
      return;
    }

    try {
      const res = await fetch("/api/users/me/ban-status", { cache: "no-store" });
      if (!res.ok) {
        setRestricted(false);
        setPermanent(false);
        setBannedUntilMs(null);
        return;
      }
      const data = (await res.json()) as {
        restricted?: boolean;
        permanent?: boolean;
        bannedUntil?: string | null;
      };
      const r = !!data.restricted;
      const p = !!data.permanent;
      setRestricted(r);
      setPermanent(p);
      if (data.bannedUntil && !p) {
        const t = Date.parse(data.bannedUntil);
        setBannedUntilMs(Number.isFinite(t) ? t : null);
      } else {
        setBannedUntilMs(null);
      }
    } catch {
      setRestricted(false);
      setPermanent(false);
      setBannedUntilMs(null);
    } finally {
      setLoaded(true);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== "authenticated" || !restricted || permanent || !bannedUntilMs) {
      return;
    }
    const id = window.setInterval(() => {
      setTick((x) => x + 1);
      if (Date.now() >= bannedUntilMs) {
        void refresh();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, restricted, permanent, bannedUntilMs, refresh]);

  const remainingMs = useMemo(() => {
    if (!bannedUntilMs || permanent) return 0;
    return Math.max(0, bannedUntilMs - Date.now());
  }, [bannedUntilMs, permanent, tick]);

  const countdownLabel = useMemo(() => {
    if (!restricted || permanent || !bannedUntilMs) return null;
    if (remainingMs <= 0) return null;
    return formatBanCountdown(remainingMs);
  }, [restricted, permanent, bannedUntilMs, remainingMs]);

  const value = useMemo<BanRestrictionValue>(
    () => ({
      loaded,
      restricted,
      permanent,
      bannedUntilMs,
      remainingMs,
      countdownLabel,
      refresh,
    }),
    [loaded, restricted, permanent, bannedUntilMs, remainingMs, countdownLabel, refresh]
  );

  return (
    <BanRestrictionContext.Provider value={value}>{children}</BanRestrictionContext.Provider>
  );
}

export function useBanRestriction(): BanRestrictionValue {
  const ctx = useContext(BanRestrictionContext);
  if (!ctx) {
    return {
      loaded: true,
      restricted: false,
      permanent: false,
      bannedUntilMs: null,
      remainingMs: 0,
      countdownLabel: null,
      refresh: async () => {},
    };
  }
  return ctx;
}
