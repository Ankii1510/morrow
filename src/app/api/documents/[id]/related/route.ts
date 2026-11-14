import { requireUser } from "@/lib/auth";
import { relatedDocuments } from "@/lib/connections";
import { json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  return json({ connections: relatedDocuments(user.id, id) });
});
