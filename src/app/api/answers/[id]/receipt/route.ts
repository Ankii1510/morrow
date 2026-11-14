import { requireUser } from "@/lib/auth";
import { getAnswer } from "@/lib/ask/answer";
import { AppError, route } from "@/lib/http";
import { readReceipt } from "@/lib/near/receipt";

type Ctx = { params: Promise<{ id: string }> };

/** Download the raw attestation evidence for an answer, for independent re-verification. */
export const GET = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  getAnswer(user.id, id); // ownership check
  const receipt = readReceipt(user.id, id);
  if (!receipt) throw new AppError(404, "not_found", "No receipt is stored for this answer.");
  return new Response(receipt, {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="morrow-receipt-${id}.json"`, "Cache-Control": "private, no-store" },
  });
});
