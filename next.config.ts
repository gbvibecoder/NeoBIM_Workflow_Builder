import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';
const R2_CDN_BASE = process.env.R2_PUBLIC_URL || "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || "buildflow-files";

const nextConfig: NextConfig = {
  // ⚡ PERFORMANCE: Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "oaidalleapiprodscus.blob.core.windows.net",
      },
    ],
    formats: ["image/avif", "image/webp"], // Modern formats first
    minimumCacheTTL: 31536000, // Cache images for 1 year
  },

  // ⚡ PERFORMANCE: Optimize CSS
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-tooltip",
      "framer-motion",
    ],
  },

  async headers() {
    // unsafe-eval needed for Three.js shader compilation (new Function()) in blob: iframe
    const scriptSrc = "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com https://checkout.razorpay.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://connect.facebook.net https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms blob: data:";

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `
              default-src 'self' blob: data:;
              ${scriptSrc};
              style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
              img-src 'self' blob: data: https://oaidalleapiprodscus.blob.core.windows.net https://picsum.photos https://images.unsplash.com https://lh3.googleusercontent.com https://*.vercel.app https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com https://www.clarity.ms https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev;
              font-src 'self' https://fonts.gstatic.com data:;
              media-src 'self' blob: data: https://*.klingai.com https://*.kuaishou.com https://*.ksyun.com https://*.ks-cdn.com https://*.kscampus.com https://*;
              connect-src 'self' blob: data: https://api.openai.com https://api.stability.ai https://*.upstash.io https://api.stripe.com https://api.razorpay.com https://*.razorpay.com https://lumberjack.razorpay.com https://api.klingai.com https://*.klingai.com https://*.fal.ai https://fal.run https://www.facebook.com https://connect.facebook.net https://*.r2.cloudflarestorage.com https://www.google-analytics.com https://analytics.google.com https://*.google-analytics.com https://*.googletagmanager.com https://www.clarity.ms https://*.clarity.ms ${R2_CDN_BASE};
              frame-src 'self' blob: https://js.stripe.com https://api.razorpay.com https://checkout.razorpay.com;
              worker-src 'self' blob:;
              object-src 'none';
              base-uri 'self';
              form-action 'self';
              frame-ancestors 'none';
              upgrade-insecure-requests;
            `.replace(/\s{2,}/g, ' ').trim(),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      // ⚡ PERFORMANCE: Cache static assets
      {
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // Proxy R2 through same origin to avoid CORS issues
  async rewrites() {
    return [
      {
        source: '/r2-models/:path*',
        destination: `${R2_CDN_BASE}/models/:path*`,
      },
      {
        source: '/r2-textures/:path*',
        destination: `${R2_CDN_BASE}/textures/:path*`,
      },
      // Proxy presigned URL uploads through our domain → eliminates CORS entirely
      ...(R2_ACCOUNT_ID ? [{
        source: '/r2-upload/:path*',
        destination: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/:path*`,
      }] : []),
    ];
  },
};

// Only wrap with Sentry when DSN is configured — otherwise it instruments
// routes at build time and can crash at runtime when no DSN is present.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true, disableLogger: true })
  : nextConfig;
