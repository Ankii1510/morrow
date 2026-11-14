import { requireUser } from "@/lib/auth";
import { retryEmbedding } from "@/lib/documents";
import { json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  retryEmbedding(user.id, id);
  return json({ ok: true });
});
