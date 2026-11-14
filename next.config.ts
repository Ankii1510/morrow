import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy for Morrow's own pages.
 *
 * Everything is same-origin: no third-party scripts, styles, fonts, images, frames or network calls.
 * `connect-src 'self'` means that even if a script were injected it could not send data to another host.
 * Limitation: Next.js injects inline bootstrap scripts, so `script-src` allows 'unsafe-inline'. A nonce-based
 * policy would be stricter; see docs/SECURITY_MODEL.md.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // These packages use Node built-ins, native TLS and WASM; keep them out of the bundle.
  serverExternalPackages: ["@nearai/inference-sdk", "pdfjs-dist"],
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // API responses (JSON and file downloads) set their own, stricter policies where needed.
      { source: "/((?!api/).*)", headers: securityHeaders },
      { source: "/api/:path*", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
    ];
  },
};

export default nextConfig;
