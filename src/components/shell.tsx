"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BookOpen, LogOut, MessageSquareText, Search, Settings, ShieldCheck } from "lucide-react";
import { api, type Me } from "@/lib/client/api";
import { Spinner, ToastProvider } from "./ui";

const MeCtx = createContext<{ me: Me; refresh: () => Promise<void> } | null>(null);
export function useMe() {
  const v = useContext(MeCtx);
  if (!v) throw new Error("useMe outside AppShell");
  return v;
}

const NAV = [
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/ask", label: "Ask", icon: MessageSquareText },
  { href: "/search", label: "Search", icon: Search },
  { href: "/privacy", label: "Privacy", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`display inline-flex items-baseline text-[1.55rem] ${className}`}>
      Morrow
      <span aria-hidden className="ml-[3px] inline-block h-[5px] w-[5px] translate-y-[-1px] rounded-full bg-moss" />
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>("/api/me");
      if (!m.user) {
        router.replace("/");
        return;
      }
      setMe(m);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial session load
    void refresh();
  }, [refresh]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/");
  }

  if (failed) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="display text-2xl">Morrow is not responding.</p>
          <p className="mt-2 text-ink-2">Check that the server is running, then try again.</p>
          <button className="btn btn-quiet mt-5" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!me) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Spinner label="Opening your library" />
      </main>
    );
  }

  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <MeCtx.Provider value={{ me, refresh }}>
      <ToastProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-surface">
          Skip to content
        </a>
        <div className="mx-auto flex min-h-screen max-w-[1400px]">
          {/* Desktop navigation */}
          <aside className="sticky top-0 hidden h-screen w-[212px] shrink-0 flex-col border-r border-rule px-5 py-7 md:flex">
            <Link href="/library" aria-label="Morrow, go to library">
              <Wordmark />
            </Link>
            <nav aria-label="Primary" className="mt-9 flex flex-col gap-0.5">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={active(href) ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.92rem] transition-colors ${active(href) ? "bg-sunk font-medium text-ink" : "text-ink-2 hover:bg-sunk/60 hover:text-ink"}`}
                >
                  <Icon size={16} strokeWidth={1.75} aria-hidden />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto space-y-3 text-[0.8rem] text-ink-3">
              <Link href="/privacy" className="flex items-start gap-2 rounded-md border border-rule px-2.5 py-2 hover:bg-sunk/60">
                <span aria-hidden className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${me.near.configured ? "bg-moss-2" : "bg-[#c9a227]"}`} />
                <span className="leading-snug text-ink-2">{me.near.configured ? "Private AI connected. Every answer is verified." : "Private AI not connected. Search works locally."}</span>
              </Link>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" title={me.user!.email}>
                  {me.user!.email}
                </span>
                <button onClick={signOut} className="btn btn-ghost h-7 shrink-0 px-1.5" aria-label="Sign out" title="Sign out">
                  <LogOut size={15} aria-hidden />
                </button>
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile top bar */}
            <div className="flex items-center justify-between border-b border-rule px-4 py-3 md:hidden">
              <Link href="/library" aria-label="Morrow, go to library">
                <Wordmark className="text-[1.35rem]" />
              </Link>
              <button onClick={signOut} className="btn btn-ghost h-8" aria-label="Sign out">
                <LogOut size={16} aria-hidden />
              </button>
            </div>
            <main id="main" className="flex-1 px-4 pb-28 pt-6 md:px-10 md:pb-16 md:pt-10">
              {children}
            </main>
          </div>
        </div>

        {/* Mobile tab bar */}
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.68rem] ${active(href) ? "font-medium text-ink" : "text-ink-3"}`}>
              <Icon size={19} strokeWidth={active(href) ? 2 : 1.6} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
