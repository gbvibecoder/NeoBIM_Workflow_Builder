# BuildFlow

> **No-Code Workflow Builder for AEC** — Accelerate architectural concept design from weeks to hours with AI-powered generative workflows.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Live:** https://neo-bim-workflow-builder.vercel.app

---

## Overview

**BuildFlow** is a visual workflow builder that helps architects, engineers, and AEC professionals generate building designs in minutes instead of weeks. Drag-and-drop AI-powered nodes to create workflows that turn text prompts into 3D models, visualizations, and IFC exports.

### Key Features
- **Visual Workflow Builder** — Drag-and-drop interface powered by React Flow
- **AI-Powered Nodes** — Text-to-space, generation, IFC export, rendering, analysis
- **Multi-Format Exports** — IFC, JSON, PNG, PDF, SVG
- **Real-Time Execution** — See results as you build with live node execution
- **Auth & Billing** — Auth.js v5 (Google OAuth), Stripe subscriptions
- **Community Templates** — Browse, clone, and share workflows
- **Public Demo** — Try the builder at `/demo` without signing up

---

## Tech Stack

- **Framework:** Next.js 16 (App Router) / React 19 / TypeScript 5
- **Canvas:** React Flow (@xyflow/react)
- **Styling:** Tailwind CSS 4 / Framer Motion
- **Database:** Prisma 7 + Neon PostgreSQL (serverless)
- **Auth:** Auth.js v5 (NextAuth) — Google OAuth + email/password
- **AI:** OpenAI (GPT-4o-mini + DALL-E 3)
- **Payments:** Stripe (checkout + webhooks)
- **Rate Limiting:** Upstash Redis
- **Hosting:** Vercel

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+
- A Neon PostgreSQL database
- OpenAI API key

### Setup

```bash
git clone https://github.com/rutikerole/NeoBIM_Workflow_Builder.git
cd NeoBIM_Workflow_Builder/workflow_builder
npm install
cp .env.example .env.local   # fill in your env vars
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

See [`.env.example`](.env.example) for all required variables. Key ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Auth secret (`openssl rand -base64 32`) |
| `AUTH_SECRET` | Yes | Same as NEXTAUTH_SECRET |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI nodes |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `STRIPE_PRICE_ID` | Yes | Stripe price ID for Pro plan |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis URL for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis token |
| `NEXT_PUBLIC_APP_URL` | Yes | Public app URL |
| `NEXT_PUBLIC_ENABLE_MOCK_EXECUTION` | No | Set to `"true"` for mock mode (no API keys needed) |
| `ADMIN_EMAILS` | No | Comma-separated admin emails |

---

## Project Structure

```
src/
  app/
    (auth)/          # Login / register pages
    dashboard/       # Main app (canvas, billing, templates, history)
    demo/            # Public demo page (no auth required)
    api/             # API routes (auth, stripe, workflows, execution)
    page.tsx         # Landing page
  components/
    canvas/          # React Flow workflow canvas + node renderers
    dashboard/       # Dashboard UI components
    ai/              # AI chat prompt input
    community/       # Community workflow cards
    ui/              # Shared UI components (command palette)
  hooks/             # Custom React hooks (useExecution, etc.)
  lib/               # Auth, DB, Stripe, analytics, rate limiting
  stores/            # Zustand state management
  services/          # OpenAI, IFC parser, mock executor, PDF report
  constants/         # Node catalogue, prebuilt workflows
  types/             # TypeScript type definitions
prisma/
  schema.prisma      # Database schema
tests/
  unit/              # Unit tests
  integration/       # Integration tests
```

---

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build (includes prisma generate)
npm start            # Start production server
npm run lint         # ESLint
npm test             # Run tests (vitest)
npm run test:coverage # Run tests with coverage
```

---

## License

MIT

---

Built by [Rutik Erole and Govind Bhujbal](https://github.com/rutikerole)
