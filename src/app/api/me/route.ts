import { config, mailEnabled, nearConfigured } from "@/lib/config";
import { encryptionEnabled } from "@/lib/storage";
import { currentUser } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const GET = route(async (req) => {
  const user = currentUser(req);
  return json({
    user: user ? { id: user.id, email: user.email, createdAt: user.createdAt } : null,
    allowSignup: config.allowSignup,
    features: { passwordReset: mailEnabled(), emailVerification: config.mail.requireVerification, encryptionAtRest: encryptionEnabled() },
    near: {
      configured: nearConfigured(),
      baseUrl: config.near.baseUrl,
      chatModel: config.near.chatModel,
      embeddingModel: config.near.embeddingModel,
      rerankModel: config.near.rerankModel,
      attestationTtlMinutes: Math.round(config.near.attestationTtlMs / 60_000),
    },
    limits: { maxUploadMb: Math.round(config.limits.maxUploadBytes / 1048576), maxPdfPages: config.limits.maxPdfPages },
  });
});
