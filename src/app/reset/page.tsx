"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Wordmark } from "@/components/shell";
import { ErrorNote, Note, Spinner } from "@/components/ui";

function Reset() {
  const token = useSearchParams().get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (token) {
        await api("/api/auth/reset/confirm", { method: "POST", json: { token, password } });
        setDone("Your password has been changed and every device has been signed out. You can sign in with the new password now.");
      } else {
        const r = await api<{ message: string }>("/api/auth/reset/request", { method: "POST", json: { email } });
        setDone(r.message);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center px-6 py-12">
      <Link href="/" aria-label="Morrow home">
        <Wordmark className="text-[1.7rem]" />
      </Link>
      <section aria-labelledby="reset-title" className="sheet mt-8 p-7">
        <h1 id="reset-title" className="display text-[1.7rem]">
          {token ? "Choose a new password" : "Reset your password"}
        </h1>
        {done ? (
          <div className="mt-5 space-y-4">
            <Note tone="moss">{done}</Note>
            <Link href="/" className="btn btn-primary w-full">
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            {token ? (
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">
                  New password
                </label>
                <input id="new-password" type="password" autoComplete="new-password" minLength={10} required autoFocus className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="mt-1.5 text-xs text-ink-3">At least 10 characters. Changing it signs you out on every device.</p>
              </div>
            ) : (
              <div>
                <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <input id="reset-email" type="email" autoComplete="email" required autoFocus className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
                <p className="mt-1.5 text-xs text-ink-3">If an account exists for this address, we will email a link that works once and expires in 30 minutes.</p>
              </div>
            )}
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <button type="submit" className="btn btn-primary h-11 w-full" disabled={busy || (token ? password.length < 10 : !email)}>
              {busy ? <Spinner /> : token ? "Set new password" : "Send reset link"}
            </button>
            <p className="text-sm text-ink-2">
              <Link href="/" className="link">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <Reset />
    </Suspense>
  );
}
