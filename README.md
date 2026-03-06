# NeoBIM Workflow Builder

> **No-Code Workflow Builder for AEC** -- Accelerate architectural concept design from weeks to hours with AI-powered generative workflows.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Live:** https://neo-bim-workflow-builder.vercel.app

---

## Overview

**NeoBIM** is a visual workflow builder that helps architects, engineers, and AEC professionals generate building designs in minutes instead of weeks. Drag-and-drop AI-powered nodes to create workflows that turn text prompts into 3D models, visualizations, and IFC exports.

### Key Features
- **Visual Workflow Builder** -- Drag-and-drop interface powered by React Flow
- **AI-Powered Nodes** -- Text-to-space, generation, IFC export, rendering, analysis
- **Multi-Format Exports** -- IFC, JSON, PNG, OBJ
- **Real-Time Execution** -- See results as you build with live node execution
- **Auth & Billing** -- NextAuth v5 (Google + credentials), Stripe subscriptions
- **Community Templates** -- Browse, clone, and share workflows

---

## Tech Stack

- **Framework:** Next.js 16 (App Router) / React 19 / TypeScript 5
- **Canvas:** React Flow (@xyflow/react)
- **Styling:** Tailwind CSS 4 / Framer Motion
- **Database:** Prisma 7 + Neon PostgreSQL (serverless)
- **Auth:** Auth.js v5 (NextAuth) -- Google OAuth + email/password
- **AI:** OpenAI (GPT-4o-mini + DALL-E 3)
- **Payments:** Stripe (checkout + webhooks)
- **Rate Limiting:** Upstash Redis
- **Hosting:** Vercel

---

## Getting Started

```bash
git clone https://github.com/rutikerole/NeoBIM_Workflow_Builder.git
cd NeoBIM_Workflow_Builder/workflow_builder
npm install
cp .env.example .env.local  # fill in your env vars
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

See [`.env.example`](.env.example) for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Auth secret (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `OPENAI_API_KEY` | OpenAI API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PRICE_ID` | Stripe price ID for Pro plan |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis for rate limiting |

---

## Project Structure

```
src/
  app/
    (auth)/          # Login / register pages
    dashboard/       # Main app (canvas, billing, templates, etc.)
    api/             # API routes (auth, stripe, workflows, execution)
    page.tsx         # Landing page
  components/
    canvas/          # React Flow workflow canvas
    dashboard/       # Dashboard UI components
    landing/         # Landing page sections
  lib/               # Auth, DB, Stripe, analytics, rate limiting
  stores/            # Zustand state management
  constants/         # Node catalogue, prebuilt workflows
  types/             # TypeScript type definitions
prisma/
  schema.prisma      # Database schema
```

---

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build (includes prisma generate)
npm start            # Start production server
npm run lint         # ESLint
npm test             # Run tests (vitest)
```

---

## License

MIT

---

Built by [Rutik Erole](https://github.com/rutikerole)
