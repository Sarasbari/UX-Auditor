# Current Architecture (MVP)

This document describes the active MVP architecture of the UX-Auditor project as implemented.

---

## High-Level Architecture Overview

The system runs as a dual-service architecture split between a Next.js web application and a Python FastAPI background worker:

```
                  ┌──────────────────────────────┐
                  │      Next.js Web App         │
                  │   Port 3000 (Local Dev)      │
                  └──────────────┬───────────────┘
                                 │
                 Submits Audits  │  Polls Results &
                 & Context       │  Stateless Chat
                                 ▼
                  ┌──────────────────────────────┐
                  │     FastAPI Worker API       │
                  │   Port 8001 (Local Dev)      │
                  └──────────────┬───────────────┘
                                 │
                                 │ Drives Headless Chromium
                                 ▼
                  ┌──────────────────────────────┐
                  │    Playwright / axe-core     │
                  │   Custom Heuristics / LLM    │
                  └──────────────────────────────┘
```

### 1. Frontend & Client Portal (Next.js)
* **Pages & Routing**: Managed under `src/app/` using Next.js App Router (Landing Page, User Dashboard, Login Page, and Audit Detail/Report Page).
* **Database**: Local **SQLite** database (`prisma/dev.db`) accessed via **Prisma ORM** as the canonical application database. All completed audits, issues, and chat histories are stored here.
* **Authentication**: Credentials (email/password) and optional OAuth provider authentication handled via **NextAuth.js**.
* **Chat Engine**: Chat follow-ups are executed directly inside Next.js API Routes using the `openai` SDK, with a local keyword-matching algorithm fallback when no LLM key is available. Next.js stores both user and assistant chat message records in Prisma.

### 2. Audit Worker & Inference Service (FastAPI)
* **Endpoints**: Exposes `POST /audit` (to queue background jobs), `GET /report/{id}` (to query running logs and outputs), and `GET /progress/{id}` (transient status).
* **Execution Engine**:
  * **Agentic Mode**: Spawns an agent using the `browser-use` library and OpenAI `gpt-4o` to interactively navigate paths on the target website.
  * **Deterministic Fallback**: Directly opens Playwright, navigates to the URL, and performs single-page analysis if the OpenAI key is missing or the agent encounters rate limits/errors.
* **Rules & Heuristics**: Runs `axe-core` in-browser alongside custom checks in Python ([heuristics.py](file:///c:/coding/UX-Auditor/server/heuristics.py)) covering contrast, tap-target size, missing input labels, and broken links.
* **State Management**: **Stateless & Database-free**. No persistent SQLite file or external DB is used. Active audit reports, progress steps, and logs are kept in transient, in-memory structures and returned during polling.

---

## Data & Lifecycles

### Audit Lifecycle
1. User enters a URL on the dashboard. Next.js submits it to `POST /api/audit` which creates a `QUEUED` audit in Prisma and triggers the FastAPI `/audit` background task.
2. Next.js starts polling the FastAPI `/report/{id}` endpoint and updates the UI status (`QUEUED` -> `PROCESSING`).
3. The FastAPI worker runs the audit, builds the raw list of violations, and runs LLM-reranking to generate scores, severities, and HTML/CSS fix suggestions.
4. Next.js polling detects the completed status, writes the parsed findings (issues, score, timestamps) directly into Prisma, and transitions the UI to `COMPLETED` (or `FAILED` with details). Polling is immediately terminated.

### Chat Lifecycle
1. User types a question about their audit findings. Next.js API route loads the exact issues list and chat history directly from Prisma.
2. Next.js passes this context directly to its local chat service.
3. If an `OPENAI_API_KEY` is present, Next.js calls OpenAI chat completions directly to synthesize an answer. If key is missing, it runs a local keyword match search.
4. Next.js saves the user and assistant chat messages in Prisma in a single database transaction, returning the response to the user. No duplicate records are written on the FastAPI side.

---

## TODO / Future Production Architecture Roadmap

The current architecture is optimized for lightweight local development. Moving to a production-grade, multi-user environment requires implementing a robust queuing and scaling pipeline:

### 1. Worker Queue Migration (BullMQ / Celery)
* **Problem**: In-process background tasks (`BackgroundTasks` in FastAPI) and in-memory polling structures will lose data if the process restarts or scales horizontally.
* **Roadmap**:
  * Deploy a **Redis** instance.
  * Migrate the background task queue to **BullMQ** (Node.js) or **Celery** (Python) to support decoupled workers, automatic retries, job scaling, and rate-limiting.

### 2. Database Migration (PostgreSQL)
* **Problem**: SQLite locks the database file on concurrent writes, causing transaction timeouts under multi-user workloads.
* **Roadmap**:
  * Migrate the Prisma database datasource and FastAPI schemas to **PostgreSQL**.
  * Use a connection pooler (e.g., PgBouncer) to handle database connections from stateless serverless/container runtimes.

### 3. File & Image Storage (S3 / R2)
* **Problem**: Storing raw base64 screenshots inside database JSON blocks degrades query performance and increases database size.
* **Roadmap**:
  * Upload screenshots captured during browser audits to an S3-compatible cloud object store (such as Cloudflare R2 or AWS S3).
  * Reference the resulting public/presigned URLs in the issue records.
