import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { ingestDocument, listDocuments, resumePendingEmbeddings } from "@/lib/documents";
import { AppError, json, rateLimit, route } from "@/lib/http";

export const GET = route(async (req) => {
  const user = requireUser(req);
  resumePendingEmbeddings(user.id);
  return json({ documents: listDocuments(user.id) });
});

export const POST = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`upload:${user.id}`, 60, 10 * 60_000);
  // Reject oversized bodies before buffering them.
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > config.limits.maxUploadBytes + 64 * 1024) {
    throw new AppError(413, "too_large", `File is larger than the ${Math.round(config.limits.maxUploadBytes / 1048576)} MB limit.`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(400, "invalid", "Upload must be multipart form data with a file.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "invalid", "No file was provided.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await ingestDocument(user.id, file.name, bytes);
  return json({ document }, { status: 201 });
});
