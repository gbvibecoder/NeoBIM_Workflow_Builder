# NeoBIM Workflow Builder

> **No-Code Workflow Builder for AEC** — Accelerate architectural concept design from weeks to hours with AI-powered generative workflows.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Beta-yellow)]()

---

## 🎯 Overview

**NeoBIM** is a visual workflow builder that helps architects, engineers, and AEC professionals generate building designs in minutes instead of weeks. Drag-and-drop AI-powered nodes to create workflows that turn text prompts into 3D models, visualizations, and IFC exports — no coding required.

### Built For
- **Small AEC firms** (8-20 people) looking to compete on speed
- **Freelance architects** who need faster client presentations  
- **Engineering students** learning computational design
- **Developers** building AEC automation tools

### Key Features
- 🧠 **5 Production AI Nodes** — Text-to-space (TR-003), generation (GN-003), IFC export, rendering, and more
- 🔗 **Visual Workflow Builder** — Drag-and-drop interface powered by React Flow
- 📊 **Multi-Format Exports** — IFC, JSON, PNG, OBJ for seamless integration
- ⚡ **Real-Time Execution** — See results as you build with live node execution
- 🔐 **Enterprise-Ready** — Rate limiting, auth (NextAuth v5), Stripe billing, analytics
- 🎨 **Beautiful UI** — Modern design with Radix UI and Tailwind CSS 4

---

## 🚀 Tech Stack

**Frontend**
- [Next.js 16](https://nextjs.org/) — React framework with App Router
- [React 19](https://react.dev/) — Latest with Server Components
- [TypeScript 5](https://www.typescriptlang.org/) — Type-safe development
- [Tailwind CSS 4](https://tailwindcss.com/) — Utility-first styling
- [Radix UI](https://www.radix-ui.com/) — Accessible component primitives
- [React Flow](https://reactflow.dev/) — Visual workflow canvas
- [Framer Motion](https://www.framer.com/motion/) — Smooth animations

**Backend & Database**
- [Prisma 7](https://www.prisma.io/) — Type-safe ORM
- [PostgreSQL](https://www.postgresql.org/) — Database (via [Neon](https://neon.tech/) serverless)
- [NextAuth.js v5](https://authjs.dev/) — Authentication (Google, GitHub)
- [Upstash Redis](https://upstash.com/) — Rate limiting & caching
- [Stripe](https://stripe.com/) — Payment processing

**AI & External Services**
- [OpenAI GPT-4](https://openai.com/) — Generative AI for design
- [Azure Document Intelligence](https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence) — Document parsing
- [AWS S3](https://aws.amazon.com/s3/) / [MinIO](https://min.io/) — Artifact storage
- [Rhino.Compute](https://www.rhino3d.com/compute/) — 3D geometry processing

**DevOps**
- [Vercel](https://vercel.com/) — Hosting & deployment
- [GitHub Actions](https://github.com/features/actions) — CI/CD (coming soon)
- [Sentry](https://sentry.io/) — Error monitoring (planned)

---

## 📦 Installation

### Prerequisites
- **Node.js 25+** ([download](https://nodejs.org/))
- **PostgreSQL** (recommended: [Neon](https://neon.tech/) serverless)
- **Redis** (optional: local via Docker, or [Upstash](https://upstash.com/))
- **Git** for version control

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/neobim-workflow-builder.git
cd neobim-workflow-builder
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy the example environment file and fill in your credentials:
```bash
cp .env.example .env.local
```

**Required variables:**
- `DATABASE_URL` — PostgreSQL connection string (Neon recommended)
- `NEXTAUTH_SECRET` — Generate with `openssl rand -base64 32`
- `OPENAI_API_KEY` — Your OpenAI API key

See [`.env.example`](.env.example) for full configuration details.

### 4. Set Up the Database
Run Prisma migrations to create database tables:
```bash
npx prisma generate
npx prisma migrate dev --name init
```

Optional: Seed the database with example workflows:
```bash
npx prisma db seed
```

### 5. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. 🎉

---

## 🗂️ Project Structure

```
workflow_builder/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # Login/signup pages
│   │   ├── dashboard/          # Main workflow builder
│   │   ├── api/                # API routes (nodes, workflows, billing)
│   │   └── page.tsx            # Landing page
│   ├── components/
│   │   ├── canvas/             # React Flow workflow canvas
│   │   ├── ui/                 # Radix UI component library
│   │   ├── dashboard/          # Workflow management
│   │   └── shared/             # Reusable components
│   ├── lib/
│   │   ├── services/           # OpenAI, IFC parser, S3 uploader
│   │   ├── utils/              # Helper functions, validation
│   │   └── auth.ts             # NextAuth configuration
│   ├── stores/                 # Zustand state management
│   ├── types/                  # TypeScript type definitions
│   └── constants/              # App configuration
├── prisma/
│   └── schema.prisma           # Database schema
├── public/                     # Static assets (logos, images)
├── docs/                       # Additional documentation
└── scripts/                    # Build/deployment scripts
```

---

## ✨ Key Features in Detail

### 🧠 5 Production-Ready AI Nodes
| Node ID  | Name             | Description                                      |
|----------|------------------|--------------------------------------------------|
| TR-003   | Text-to-Space    | Generate spatial programs from text prompts     |
| GN-003   | Generator        | Create 3D building geometry with constraints    |
| IF-003   | IFC Exporter     | Convert geometry to IFC format                  |
| RN-003   | Renderer         | Generate photorealistic visualizations          |
| AN-003   | Analyzer         | Compute area, cost, and compliance metrics      |

### 🔐 Security & Performance
- **Rate Limiting** — Upstash Redis prevents API abuse (50 req/min free tier, 200 req/min Pro)
- **Authentication** — Secure email/password + OAuth (Google, GitHub)
- **CSRF Protection** — Built-in via NextAuth
- **Input Validation** — All node inputs validated before execution
- **Error Handling** — User-friendly error messages with retry logic

### 💳 Billing & Subscriptions
- **Stripe Integration** — Pro ($79/mo) and Team ($149/mo) plans
- **Usage-Based Credits** — Free tier: 100 credits/mo, Pro: 2,000 credits/mo
- **Automatic Upgrades** — Seamless checkout flow with Stripe Elements

### 📊 Analytics & Monitoring
- **Vercel Analytics** — Real-time performance metrics
- **PostHog** — User behavior tracking (privacy-first)
- **Custom Events** — Workflow executions, node usage, errors

---

## 🛠️ Development

### Available Scripts
```bash
# Start dev server (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code (ESLint)
npm run lint

# Run Prisma Studio (database GUI)
npx prisma studio

# Generate Prisma client
npx prisma generate

# Create database migration
npx prisma migrate dev --name <migration_name>
```

### Testing the App
1. **Create an account** at `/login`
2. **Navigate to Dashboard** to see the workflow builder
3. **Drag a Text-to-Space node (TR-003)** onto the canvas
4. **Enter a prompt** like "3-bedroom house, 1500 sqft"
5. **Click Execute** and watch the AI generate a spatial program

### Local Database Setup
If using local PostgreSQL instead of Neon:
```bash
# Start PostgreSQL (via Docker)
docker run -d \
  --name neobim-postgres \
  -e POSTGRES_USER=neobim \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=neobim \
  -p 5432:5432 \
  postgres:16
```

Update `.env.local`:
```env
DATABASE_URL="postgresql://neobim:password@localhost:5432/neobim"
DIRECT_URL="postgresql://neobim:password@localhost:5432/neobim"
```

---

## 🚧 Roadmap

**Q1 2026 (Hackathon Release)**
- [x] 5 production AI nodes (TR-003, GN-003, IF-003, RN-003, AN-003)
- [x] Rate limiting & auth
- [x] Stripe billing integration
- [x] Visual workflow builder (React Flow)
- [x] IFC export functionality
- [ ] Public gallery of example workflows
- [ ] Mobile-responsive dashboard

**Q2 2026**
- [ ] 10 additional nodes (BIM integrations, GIS data, parametric design)
- [ ] Team collaboration (real-time editing)
- [ ] API for programmatic workflow execution
- [ ] Zapier/Make.com integrations
- [ ] Advanced analytics dashboard

**Q3 2026**
- [ ] Marketplace for community-built nodes
- [ ] On-premise deployment option
- [ ] Enterprise SSO (SAML, OIDC)
- [ ] Advanced 3D viewer (Three.js/Babylon.js)

---

## 🤝 Contributing

**NeoBIM** is a hackathon project built for the [Hackathon Name] (March 5-12, 2026). We're currently in **invite-only beta** but plan to open-source components post-hackathon.

### How to Help (Post-Hackathon)
- **Report bugs** — Open an issue with reproduction steps
- **Request features** — Share your use case in Discussions
- **Submit PRs** — Follow our [Git Workflow](GIT-WORKFLOW.md)

### Current Team
- **Rutik Erole** — Lead Developer ([GitHub](https://github.com/rutikerole))
- **Chhawa** — AI Assistant (18 agents orchestrated for 360 agent-hours/day)
- **Govind** — QA Engineer

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 📞 Contact

- **Website:** [neobim.app](https://neobim.app) *(coming soon)*
- **Email:** erolerutik9@gmail.com
- **LinkedIn:** [Rutik Erole](https://linkedin.com/in/rutikerole)
- **GitHub Issues:** [Report a bug](https://github.com/yourusername/neobim-workflow-builder/issues)

---

## 🙏 Acknowledgments

Built with ❤️ during the [Hackathon Name] using:
- [Next.js](https://nextjs.org/) for the incredible developer experience
- [Prisma](https://www.prisma.io/) for type-safe database access
- [OpenAI](https://openai.com/) for GPT-4 generative design
- [Vercel](https://vercel.com/) for seamless deployments
- [Radix UI](https://www.radix-ui.com/) for accessible components

Special thanks to the AEC community for feedback during development.

---

<div align="center">
  <strong>🚀 Ship faster. Build better. Win together.</strong>
  <br />
  <sub>Made with 🔥 by Chhawa & Rutik</sub>
</div>
