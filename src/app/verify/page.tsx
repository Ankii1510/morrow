"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Wordmark } from "@/components/shell";
import { ErrorNote, Note, Spinner } from "@/components/ui";

/**
 * Confirmation needs a click rather than happening on page load, so that mail scanners and link
 * previews that fetch the URL do not consume the one-time token.
 */
function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("busy");
    setError(null);
    try {
      await api("/api/auth/verify", { method: "POST", json: { token } });
      setState("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setState("idle");
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center px-6 py-12">
      <Link href="/" aria-label="Morrow home">
        <Wordmark className="text-[1.7rem]" />
      </Link>
      <section aria-labelledby="verify-title" className="sheet mt-8 space-y-5 p-7">
        <h1 id="verify-title" className="display text-[1.7rem]">
          Confirm your email
        </h1>
        {state === "done" ? (
          <>
            <Note tone="moss">Your address is confirmed. You can sign in now.</Note>
            <Link href="/" className="btn btn-primary w-full">
              Go to sign in
            </Link>
          </>
        ) : !token ? (
          <ErrorNote>This link is incomplete. Open the link from your email again.</ErrorNote>
        ) : (
          <>
            <p className="text-ink-2">Confirm that this address belongs to you to finish creating your Morrow library.</p>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <button className="btn btn-primary h-11 w-full" onClick={confirm} disabled={state === "busy"}>
              {state === "busy" ? <Spinner /> : "Confirm email"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <Verify />
    </Suspense>
  );
}
