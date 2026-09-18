import type { NextConfig } from "next";
const config: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./.runtime/**/*", "./.private-data/**/*", "./.env*"],
  },
  serverExternalPackages: ["pdfjs-dist", "mammoth", "yauzl"],
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
