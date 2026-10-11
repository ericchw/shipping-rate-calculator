import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./env/*.env", "./.env*", "./doc/**/*", "./*.db*", "./*.sqlite*", "./*.dump", "./*.backup", "./*.pem", "./*.key"],
  },
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${process.env.NODE_ENV === "development" ? " ws://localhost:3000 ws://127.0.0.1:3000" : ""}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
