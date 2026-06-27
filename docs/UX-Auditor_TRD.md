# UX-Auditor Technical Requirements Document (TRD)

> [!NOTE]
> **Historical Archive / Design Roadmap Only**
> This document refers to the historical system requirements. For details on the actual MVP implementation, architecture, and dev setup, please consult [CURRENT_ARCHITECTURE.md](file:///c:/coding/UX-Auditor/docs/CURRENT_ARCHITECTURE.md) and the root [README.md](file:///c:/coding/UX-Auditor/README.md).

**Document Version**: 1.0
**Date**: June 27, 2026
**Author**: Manus AI

## 1. Introduction

This Technical Requirements Document (TRD) outlines the technical specifications for the UX-Auditor platform, focusing on its architecture, core components, data models, and operational flows. It incorporates the refined product vision, emphasizing the agentic nature, Generative AI integration, and the unique verified-fix pipeline. This document serves as a guide for the development team, ensuring a clear understanding of the technical implementation details required to bring UX-Auditor to fruition.

## 2. System Architecture

UX-Auditor will adopt a modern, scalable microservices-oriented architecture, leveraging cloud-native principles for resilience, performance, and maintainability. The system will be composed of several interconnected services, each responsible for a specific domain function.

### 2.1 High-Level Overview

```mermaid
graph TD
    A[User Frontend] --> B(API Gateway)
    B --> C(Auth Service)
    B --> D(Audit Service)
    B --> E(LLM Service)
    B --> F(Chat Service)
    D --> G(Browser Automation Service)
    D --> H(Deterministic Engine)
    D --> E
    G --> I(S3/R2 Storage)
    D --> J(PostgreSQL DB)
    E --> J
    F --> J
    F --> E
    SubGraph Core Services
        C
        D
        E
        F
        G
    End
    SubGraph Data Stores
        J
        I
    End
```

### 2.2 Component Breakdown

#### 2.2.1 User Frontend

*   **Technology**: Next.js (React, TypeScript, TailwindCSS)
*   **Purpose**: Provides the user interface for submitting URLs, viewing audit reports, interacting with the chat assistant, and managing subscriptions.
*   **Key Features**: Server-Side Rendering (SSR) for initial page loads, API routes for backend communication, responsive design.

#### 2.2.2 API Gateway

*   **Technology**: Next.js API Routes or a dedicated API Gateway (e.g., AWS API Gateway, Nginx reverse proxy).
*   **Purpose**: Acts as the single entry point for all client requests, handling routing, authentication, and rate limiting.

#### 2.2.3 Auth Service

*   **Technology**: NextAuth.js for standard authentication flows (email/password, OAuth providers), integrated with a secure session management system.
*   **Purpose**: Manages user registration, login, session management, and authorization. Supports authenticated audits by securely handling user-provided session cookies or credentials.
*   **Security**: Implement industry-standard security practices, including password hashing, JWTs for API authentication, and secure cookie handling.

#### 2.2.4 Audit Service

*   **Technology**: Node.js with BullMQ for job queuing and processing.
*   **Purpose**: Orchestrates the entire audit process, from receiving user requests to generating final reports. Manages the lifecycle of audit jobs.
*   **Key Responsibilities**: Job scheduling, status tracking, result merging, and coordination with other services.

#### 2.2.5 Browser Automation Service

*   **Technology**: Node.js with Playwright.
*   **Purpose**: Executes headless browser sessions to load target URLs, capture page states (screenshots, DOM, computed styles, network requests), and perform in-memory DOM patching for verified fixes.
*   **Scalability**: Implement browser pooling and rate-limiting mechanisms to manage resource consumption and ensure efficient scaling.
*   **Authenticated Audits**: Will be enhanced to accept and inject user-provided session cookies or credentials into the headless browser context, allowing audits of authenticated pages.

#### 2.2.6 Deterministic Engine

*   **Technology**: axe-core (npm package) integrated into the Browser Automation Service.
*   **Purpose**: Performs rule-based accessibility and UX audits, identifying objective violations. Will be extended with custom rules for specific UX patterns not covered by axe-core.
*   **Output**: Structured JSON containing violation details, element selectors, severity, and rule IDs.

#### 2.2.7 LLM Service

*   **Technology**: Python (for model training and inference) with FastAPI for API exposure. Initially integrates with OpenAI GPT-4o (vision) or Claude 3.5 Sonnet APIs.
*   **Purpose**: Processes visual (screenshots) and contextual (DOM excerpts, computed styles) data to score Nielsen's 10 heuristics and identify nuanced UX issues.
*   **Custom Model Training**: Develop a strategy for training a custom LLM. This will involve:
    *   **Data Collection**: Curating a dataset of UI/UX designs, annotated with 
heuristic scores, "Impeccable" design principles, "Taste Skill" evaluations, and "Animate" interaction patterns.
    *   **Model Selection**: Choosing an appropriate base model (e.g., Llama 3, Mistral) for fine-tuning.
    *   **Training Process**: Utilizing techniques like Supervised Fine-Tuning (SFT) and Reinforcement Learning from Human Feedback (RLHF) to align the model with the desired UX evaluation criteria.
    *   **Deployment**: Deploying the custom model using optimized inference engines (e.g., vLLM, TensorRT-LLM) for low latency and high throughput.

#### 2.2.8 Chat Service

*   **Technology**: Node.js with LangChain or LlamaIndex for RAG implementation.
*   **Purpose**: Powers the agentic chat assistant, enabling users to query audit reports and receive contextual explanations and guidance.
*   **Key Features**: RAG over structured audit JSON, access to the full page source for deep debugging, and integration with the LLM Service for natural language processing.

#### 2.2.9 Data Stores

*   **PostgreSQL**: Relational database for storing structured data, including user profiles, project details, audit run metadata, issue records, and chat history.
*   **S3/R2 Storage**: Object storage for storing binary assets, such as screenshots, full DOM snapshots, and generated code diffs. Implement strict data retention policies to manage storage costs and ensure privacy compliance.

## 3. Data Models

The following simplified data models represent the core entities within the UX-Auditor system.

### 3.1 User

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | String | User's email address |
| `password_hash` | String | Hashed password |
| `subscription_tier` | Enum | Free, Pro, Team, Enterprise |
| `created_at` | Timestamp | Account creation date |

### 3.2 Project

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key to User |
| `name` | String | Project name |
| `url` | String | Base URL for the project |
| `created_at` | Timestamp | Project creation date |

### 3.3 AuditRun

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Foreign key to Project |
| `status` | Enum | Queued, Processing, Completed, Failed |
| `started_at` | Timestamp | Audit start time |
| `completed_at` | Timestamp | Audit completion time |
| `score` | Integer | Overall UX/Accessibility score |

### 3.4 Issue

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `audit_run_id` | UUID | Foreign key to AuditRun |
| `severity` | Enum | Low, Medium, High, Critical |
| `category` | String | Accessibility, UX Heuristic, Custom Rule |
| `element_selector` | String | CSS selector for the affected element |
| `description` | Text | Detailed description of the issue |
| `fix_suggestion` | Text | Suggested fix (textual description) |
| `verified_fix_status` | Enum | Pending, Success, Failed, N/A |
| `source` | Enum | Deterministic, LLM, Merged |

### 3.5 Screenshot

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `issue_id` | UUID | Foreign key to Issue |
| `type` | Enum | Original, Patched, Highlighted |
| `url` | String | S3/R2 URL to the image file |

### 3.6 DOMSnapshot

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `audit_run_id` | UUID | Foreign key to AuditRun |
| `url` | String | S3/R2 URL to the compressed DOM snapshot file |

### 3.7 ChatMessage

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `audit_run_id` | UUID | Foreign key to AuditRun |
| `role` | Enum | User, Assistant |
| `content` | Text | Message content |
| `cited_issue_ids` | Array[UUID] | List of cited Issue IDs |
| `created_at` | Timestamp | Message creation time |

## 4. Operational Flows

### 4.1 Audit Job Flow

1.  **Submission**: User submits a URL (and optionally authentication credentials) via the frontend.
2.  **Job Creation**: The API Gateway creates an `AuditRun` record (status: Queued) and pushes a job to the BullMQ queue.
3.  **Processing**: The Audit Service picks up the job and orchestrates the process.
4.  **Browser Capture**: The Browser Automation Service loads the page (injecting credentials if provided), captures screenshots, the full DOM, computed styles, and network requests.
5.  **Parallel Analysis**:
    *   The Deterministic Engine (axe-core) scans the captured state.
    *   The LLM Service analyzes the screenshots and DOM excerpts.
6.  **Result Merging**: The Audit Service merges findings, deduplicates overlapping issues, and assigns final severities.
7.  **Verified Fix Loop (Tier 1)**: For mechanically fixable issues, the Browser Automation Service generates and applies in-memory DOM patches, re-runs the Deterministic Engine, and updates the `verified_fix_status`.
8.  **Code Patch Generation (Tier 2)**: For other issues, the system generates HTML/CSS/JS diffs, supporting both generic DOM and framework-specific (React, Vue, Tailwind) patches.
9.  **Asset Storage**: Screenshots and DOM snapshots are uploaded to S3/R2.
10. **Completion**: The `AuditRun` status is updated to Completed, and the frontend is notified via WebSocket or polling.

### 4.2 Chat Assistant Flow

1.  **Query**: User submits a question via the chat interface.
2.  **Context Retrieval**: The Chat Service retrieves the relevant `AuditRun` data, including the structured JSON report and the full page source.
3.  **Prompt Construction**: The Chat Service constructs a prompt containing the user's query, the retrieved context, and instructions for the LLM.
4.  **LLM Inference**: The LLM Service processes the prompt and generates a response.
5.  **Response Delivery**: The Chat Service delivers the response to the frontend, including citations to specific issues where applicable.

## 5. Security and Privacy

*   **Data Retention**: Implement strict data retention policies. Automatically delete screenshots, DOM snapshots, and audit reports after a predefined period (e.g., 30 days for Pro users, 90 days for Team users).
*   **Data Minimization**: Do not index or store page content beyond what is necessary for the audit report.
*   **Authentication Security**: Securely handle user credentials for authenticated audits. Do not store plain-text passwords or sensitive session tokens persistently.
*   **Compliance**: Roadmap towards SOC2 compliance to ensure enterprise-grade security and privacy standards.

## 6. References

[1] BullMQ. *BullMQ Documentation*. [https://docs.bullmq.io/](https://docs.bullmq.io/)
[2] NextAuth.js. *NextAuth.js Documentation*. [https://next-auth.js.org/](https://next-auth.js.org/)
[3] LangChain. *LangChain Documentation*. [https://python.langchain.com/](https://python.langchain.com/)
[4] LlamaIndex. *LlamaIndex Documentation*. [https://docs.llamaindex.ai/](https://docs.llamaindex.ai/)
