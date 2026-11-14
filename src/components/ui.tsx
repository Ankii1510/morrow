"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";

// ---------- Toasts: brief success / error feedback, announced to screen readers ----------
type Toast = { id: number; kind: "ok" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm shadow-lg ${t.kind === "ok" ? "border-ink bg-ink text-surface" : "border-[#d9b3a9] bg-clay-soft text-clay"}`}>
            {t.kind === "ok" ? <Check size={16} className="mt-0.5 shrink-0" aria-hidden /> : <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}
            <span>{t.text}</span>
            <button aria-label="Dismiss" className="ml-1 opacity-70 hover:opacity-100" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Modal: native <dialog> gives focus trapping, Esc to close and inert background ----------
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="modal-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <h2 id="modal-title" className="display text-2xl">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </dialog>
  );
}

export function Spinner({ label, size = 16 }: { label?: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-2" role="status">
      <Loader2 size={size} className="animate-spin" aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function PageHeader({ title, lede, actions }: { title: string; lede?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-6">
      <div className="min-w-0">
        <h1 className="display text-[2.1rem] md:text-[2.5rem]">{title}</h1>
        {lede ? <p className="mt-2 max-w-2xl text-ink-2">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function ErrorNote({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-[#d9b3a9] bg-clay-soft px-4 py-3 text-sm text-clay">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {onRetry ? (
        <button className="font-medium underline underline-offset-2" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Note({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "moss" | "amber" }) {
  const cls = tone === "moss" ? "border-[#c5d3c2] bg-moss-soft" : tone === "amber" ? "border-[#e3d08e] bg-amber-soft" : "border-rule bg-surface";
  return <div className={`rounded-md border px-4 py-3 text-sm text-ink-2 ${cls}`}>{children}</div>;
}

export function Mono({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <code title={title} className="break-all font-mono text-[0.78rem] text-ink-2">
      {children}
    </code>
  );
}
