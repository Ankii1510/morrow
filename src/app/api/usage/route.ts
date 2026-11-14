import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { quotaLimits, usageHistory, userUsageToday } from "@/lib/usage";

/** The caller's own AI usage. App-wide totals and other users' usage are never included. */
export const GET = route(async (req) => {
  const user = requireUser(req);
  return json({
    today: userUsageToday(user.id),
    limits: quotaLimits(),
    history: usageHistory(user.id, 50),
    notes: [
      "Token counts are the provider's own figures and are recorded only when NEAR AI Cloud returns them.",
      "Morrow does not convert tokens to money.",
      "Budgets reset at midnight UTC.",
    ],
  });
});
