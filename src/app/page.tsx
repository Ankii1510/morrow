"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, Quote, ShieldCheck } from "lucide-react";
import { api, ApiError, type Me } from "@/lib/client/api";
import { Wordmark } from "@/components/shell";
import { ErrorNote, Note, Spinner } from "@/components/ui";

const POINTS = [
  { icon: FileText, title: "Bring your documents together", body: "PDFs, notes and Markdown become one searchable library that stays on the machine running Morrow." },
  { icon: Quote, title: "Answers you can check", body: "Every claim links to the passage and page it came from. If your documents do not say, Morrow says so." },
  { icon: ShieldCheck, title: "Private AI, with proof", body: "Questions are encrypted to a hardware enclave on NEAR AI Cloud. Morrow verifies the enclave before sending anything and keeps the evidence." },
];

export default function Welcome() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/api/me")
      .then((m) => {
        if (m.user) router.replace("/library");
        else {
          setMe(m);
          if (!m.allowSignup) setMode("login");
        }
      })
      .catch(() => setError("Could not reach the Morrow server."));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ pending?: boolean; message?: string }>(`/api/auth/${mode}`, { method: "POST", json: { email, password } });
      if (r.pending) {
        // Email confirmation is required: no session yet, and the same message whatever the address.
        setNotice(r.message || "Check your email to finish creating your library.");
        setPassword("");
        setBusy(false);
        return;
      }
      router.replace("/library");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-[1120px] items-center gap-x-20 gap-y-12 px-6 py-12 md:grid-cols-[1.1fr_0.9fr] md:px-10">
      <section>
        <Wordmark className="text-[1.7rem]" />
        <h1 className="display mt-10 text-[2.6rem] leading-[1.05] md:text-[3.4rem]">
          Your knowledge.
          <br />
          Your space.
          <br />
          <span className="italic text-moss">Your future.</span>
        </h1>
        <p className="mt-6 max-w-md text-[1.05rem] text-ink-2">A personal knowledge library that reads your documents, answers from them with citations, and proves the AI ran privately.</p>
        <ul className="mt-10 space-y-6">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <Icon size={19} strokeWidth={1.6} className="mt-1 shrink-0 text-moss" aria-hidden />
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 max-w-md text-[0.93rem] text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="auth-title" className="sheet p-7 md:p-9">
        {!me && !error ? (
          <Spinner label="Loading" />
        ) : (
          <>
            <h2 id="auth-title" className="display text-[1.7rem]">
              {mode === "signup" ? "Create your library" : "Welcome back"}
            </h2>
            <p className="mt-1.5 text-sm text-ink-2">{mode === "signup" ? "Your account lives on this Morrow server only." : "Sign in to open your library."}</p>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <input id="email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                  Password
                </label>
                <input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={10} aria-describedby="pw-hint" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
                {mode === "signup" ? (
                  <p id="pw-hint" className="mt-1.5 text-xs text-ink-3">
                    At least 10 characters. Stored only as a salted scrypt hash.
                  </p>
                ) : null}
              </div>
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              {notice ? <Note tone="moss">{notice}</Note> : null}
              <button type="submit" className="btn btn-primary h-11 w-full text-[0.95rem]" disabled={busy || !email || !password}>
                {busy ? <Spinner /> : mode === "signup" ? "Create library" : "Sign in"}
              </button>
            </form>
            {me?.allowSignup ? (
              <p className="mt-5 text-sm text-ink-2">
                {mode === "signup" ? "Already have a library?" : "New here?"}{" "}
                <button className="link" onClick={() => (setMode(mode === "signup" ? "login" : "signup"), setError(null), setNotice(null))}>
                  {mode === "signup" ? "Sign in" : "Create one"}
                </button>
              </p>
            ) : null}
            {mode === "login" ? (
              <p className="mt-2 text-sm text-ink-2">
                {me?.features.passwordReset ? (
                  <Link href="/reset" className="link">
                    Forgot your password?
                  </Link>
                ) : (
                  <span className="text-ink-3">Password reset is not available on this server: it has no email delivery configured.</span>
                )}
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
