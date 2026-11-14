import { requireUser } from "@/lib/auth";
import { deleteAnswer, getAnswer } from "@/lib/ask/answer";
import { json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctx) => json({ answer: getAnswer(requireUser(req).id, (await ctx.params).id) }));

export const DELETE = route<Ctx>(async (req, ctx) => {
  deleteAnswer(requireUser(req).id, (await ctx.params).id);
  return json({ ok: true });
});
