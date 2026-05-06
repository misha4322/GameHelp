/** @type {import('next').NextConfig} */
/**
 * Dev: `next dev` подключает WebSocket к `/_next/webpack-hmr` (Fast Refresh).
 * Многие туннели (CloudPub и т.д.) не проксируют WSS — в консоли будет ошибка, страница всё равно работает;
 * для демо без шума: `npm run build && npm run demo` (production, без HMR).
 */

function parseAllowedDevOrigins() {
  const raw = process.env.ALLOWED_DEV_ORIGINS ?? "";
  const hosts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return entry.includes("://") ? new URL(entry).host : entry;
      } catch {
        return entry;
      }
    });
  return [...new Set(hosts)];
}

function s3PublicImagePattern() {
  const raw = process.env.S3_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      protocol: u.protocol.replace(":", "") === "https" ? "https" : "http",
      hostname: u.hostname,
      ...(u.port ? { port: u.port } : {}),
      pathname: "/**",
    };
  } catch {
    return null;
  }
}

const s3Pattern = s3PublicImagePattern();

const nextConfig = {
  /** Туннели (CloudPub и т.д.): иначе Next в dev режет запросы к /_next/* с другого origin */
  allowedDevOrigins: parseAllowedDevOrigins(),

  async rewrites() {
    return [
      {
        source: "/api/health",
        destination: "http://127.0.0.1:3001/api/health",
      },
      /** PATCH/POST постов идёт в Elysia (:3001), не в `src/app/api/posts/` — логику ревизии дублируем там. */
      {
        source: "/api/posts/:path*",
        destination: "http://127.0.0.1:3001/api/posts/:path*",
      },
      {
        source: "/api/posts/:slug/comments/:path*",
        destination: "http://127.0.0.1:3001/api/posts/:slug/comments/:path*",
      },
      {
        source: "/api/comments/:path*",
        destination: "http://127.0.0.1:3001/api/comments/:path*",
      },
      {
        source: "/api/messages/:path*",
        destination: "http://127.0.0.1:3001/api/messages/:path*",
      },
      {
        source: "/api/moderation/:path*",
        destination: "http://127.0.0.1:3001/api/moderation/:path*",
      },
      {
        source: "/api/forum/:path*",
        destination: "http://127.0.0.1:3001/api/forum/:path*",
      },
      {
        source: "/api/likes/:path*",
        destination: "http://127.0.0.1:3001/api/likes/:path*",
      },
    ];
  },

  images: {
    remotePatterns: [
      ...(s3Pattern ? [s3Pattern] : []),
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/gamehelp/**",
      },
      {
        protocol: "https",
        hostname: "avatars.steamstatic.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn.cloudflare.steamstatic.com",
        port: "",
        pathname: "/steam/apps/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.yandex.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.mds.yandex.net",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;