# UX-Auditor

Paste a URL, get verified UX fixes. Dual-engine analysis (deterministic rules + AI) audits live websites, then proves fixes actually work.

## Architecture

| Layer | Tech | Port |
|---|---|---|
| Frontend + API routes | Next.js 15 (App Router) | `localhost:3000` |
| Audit engine | Python FastAPI + browser-use | `localhost:8001` |
| Next.js database | Prisma + SQLite | `prisma/dev.db` |
| Audit engine database | None | N/A (Stateless / In-memory transient state only) |

The Next.js app is the canonical application controller and database owner. It submits audit requests to the FastAPI backend, polls for results, and stores the completed report (issues, score, etc.) in its own Prisma-managed SQLite database. When executing AI chat follow-ups, Next.js sends the full report context and chat history from Prisma to the stateless FastAPI backend, ensuring chat history is stored only once in Prisma.

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| **Node.js** | ≥ 18 | `node --version` |
| **npm** | ≥ 9 | `npm --version` |
| **Python** | ≥ 3.10 | `python --version` |
| **Git** | any | `git --version` |

---

## Quick Start (Windows)

### 1. Clone and install Node dependencies

```powershell
git clone https://github.com/Sarasbari/UX-Auditor.git
cd UX-Auditor
npm install
```

### 2. Set up environment variables

```powershell
copy .env.example .env
```

Edit `.env` and fill in **at minimum**:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Pre-filled as `file:./dev.db` (SQLite) — keep as-is |
| `OPENAI_API_KEY` | ✅ | Needed by both the FastAPI audit engine and the Next.js chat route |
| `NEXTAUTH_SECRET` | ✅ | Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXTAUTH_URL` | ✅ | Pre-filled as `http://localhost:3000` — keep as-is |
| `GITHUB_ID` / `GITHUB_SECRET` | ❌ | Only needed for GitHub OAuth login |
| `GOOGLE_ID` / `GOOGLE_SECRET` | ❌ | Only needed for Google OAuth login |

> **Note:** Credentials-based sign-in (email + password) works without any OAuth keys configured.

### 3. Initialize the database

```powershell
npm run db:setup
```

This generates the Prisma client and pushes the schema to a local SQLite file at `prisma/dev.db`.

### 4. Set up the Python backend

```powershell
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
deactivate
cd ..
```

> **Why `playwright install chromium`?** The audit engine uses `browser-use` which drives a headless Chromium browser to capture and analyze web pages.

### 5. Start both servers

**Option A — Single command (opens FastAPI in a separate window):**

```powershell
npm run dev:all
```

This starts FastAPI at `localhost:8001` in a new terminal window and Next.js at `localhost:3000` in the current terminal.

**Option B — Two separate terminals:**

```powershell
# Terminal 1: FastAPI backend
npm run dev:server

# Terminal 2: Next.js frontend
npm run dev
```

### 6. Verify everything is running

| Check | URL | Expected |
|---|---|---|
| Next.js frontend | http://localhost:3000 | Landing page with URL input |
| FastAPI docs (Swagger) | http://localhost:8001/docs | Interactive API documentation |
| FastAPI dashboard | http://localhost:8001 | Built-in audit dashboard UI |
| FastAPI health check | http://localhost:8001/openapi.json | JSON OpenAPI schema |

---

## npm Scripts Reference

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js dev server only |
| `npm run dev:next` | Alias for `npm run dev` |
| `npm run dev:server` | Start FastAPI backend only (uses `server/.venv`) |
| `npm run dev:all` | Start both FastAPI + Next.js (Windows) |
| `npm run build` | Production build (auto-cleans `.next` cache) |
| `npm run build:ci` | TypeScript check + production build |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint |
| `npm run db:setup` | Generate Prisma client + push schema to SQLite |
| `npm run db:generate` | Generate Prisma client only |
| `npm run db:push` | Push schema to database only |
| `npm run db:migrate` | Create a new Prisma migration |
| `npm run db:studio` | Open Prisma Studio (database GUI) |

---

## Project Structure

```
UX-Auditor/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/
│   │   │   ├── audit/          # POST /api/audit, GET /api/audit
│   │   │   │   └── [id]/       # GET /api/audit/:id
│   │   │   │       └── chat/   # POST /api/audit/:id/chat
│   │   │   └── auth/
│   │   │       └── [...nextauth]/  # NextAuth.js handlers
│   │   ├── audit/[id]/         # Audit report page
│   │   ├── dashboard/          # User dashboard
│   │   ├── login/              # Sign-in page
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Landing page
│   ├── components/ui/          # Shared UI components
│   ├── lib/                    # Server utilities
│   │   ├── db/
│   │   │   └── prisma.ts       # Prisma client singleton
│   │   ├── services/
│   │   │   ├── auth.ts         # NextAuth config
│   │   │   └── audit-job.ts    # Background job runner
│   │   └── utils.ts            # UI helpers
│   ├── experimental/           # Unused/Experimental TypeScript engine
│   │   ├── audit-orchestrator.ts
│   │   └── engines/
│   └── types/                  # TypeScript type definitions
├── server/                     # Python FastAPI backend
│   ├── main.py                 # FastAPI app (endpoints + dashboard)
│   ├── auditor.py              # Browser-use agent + axe-core runner
│   ├── heuristics.py           # Custom UX heuristic rules
│   ├── llm_layer.py            # LLM reranking + fix generation
│   ├── db.py                   # SQLite storage for audits/chat
│   └── requirements.txt        # Python dependencies
├── prisma/
│   └── schema.prisma           # Database schema (SQLite)
├── .env.example                # Environment template
└── package.json                # Scripts and Node dependencies
```

---

## Troubleshooting

### `next build` fails with PageNotFoundError

The `.next` cache is stale. Run `npm run build` — the `prebuild` script automatically cleans it.

### FastAPI won't start — "No module named 'server'"

Uvicorn must run from the **project root**, not from inside `server/`. Use `npm run dev:server` which handles this automatically.

### Prisma errors about missing client

Run `npm run db:setup` to regenerate the Prisma client and push the schema.

### `playwright install chromium` fails

Make sure you're running inside the activated venv (`server\.venv\Scripts\activate`) and have network access. On corporate networks, you may need to set `HTTPS_PROXY`.

### OAuth login doesn't work

OAuth is optional. Email/password sign-in works without `GITHUB_ID` or `GOOGLE_ID`. If you want OAuth, create apps at [GitHub Developer Settings](https://github.com/settings/developers) or [Google Cloud Console](https://console.cloud.google.com/) and add the credentials to `.env`.