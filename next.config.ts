import type { NextConfig } from "next";


const nextConfig: NextConfig = {
  // ─── Image Optimization ────────────────────────────────────────────
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },

  // ─── Production Optimizations ──────────────────────────────────────
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  // ─── Experimental Performance Features ─────────────────────────────
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-tooltip",
      "sonner",
    ],
  },

  // ─── Turbopack Config (silences webpack warning) ──────────────────
  turbopack: {},

  // ─── Webpack Optimizations ─────────────────────────────────────────
  webpack: (config, { isServer }) => {
    // Exclude heavy libs from client bundle
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        // Force dynamic imports for heavy server-side libs
        "web-ifc": false,
        xlsx: false,
      };
    }

    return config;
  },

  // ─── Security Headers ──────────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // Cache static assets aggressively
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
