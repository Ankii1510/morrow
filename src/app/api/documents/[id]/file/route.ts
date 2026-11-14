import { requireUser } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/documents";
import { AppError, route } from "@/lib/http";
import { documentFiles } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The original uploaded bytes. Requires a session, then a database ownership check, and only then
 * reads from the owner's own storage directory using the validated id. PDFs open inline in the
 * browser's own viewer; text files are download-only and never rendered as HTML.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  const doc = getOwnedDocument(user.id, id);
  const bytes = documentFiles.read(user.id, doc.id);
  if (!bytes) throw new AppError(404, "not_found", "The original file is no longer stored.");
  const name = encodeURIComponent(doc.filename);
  const isPdf = doc.kind === "pdf";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": isPdf ? "application/pdf" : "text/plain; charset=utf-8",
      "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      // Text is locked down completely. PDFs carry no CSP of their own because the browser's built-in
      // viewer needs to run; they are only ever framed by this origin (X-Frame-Options: SAMEORIGIN).
      ...(isPdf ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
    },
  });
});
