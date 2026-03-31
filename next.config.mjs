import { readFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://steamcdn-a.akamaihd.net https://cdn.akamai.steamstatic.com https://avatars.steamstatic.com https://store.steampowered.com https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://cdn.fastly.steamstatic.com https://media.steampowered.com https://community.steamstatic.com https://community.fastly.steamstatic.com https://shared.steamstatic.com",
              "connect-src 'self' https://static.cloudflareinsights.com https://api.steampowered.com",
              "font-src 'self'",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
