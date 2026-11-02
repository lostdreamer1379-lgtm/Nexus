# Nexus AI — Grounded Multi-Provider AI Workspace

**Nexus AI** is a self-hosted, multi-user AI workspace for connecting models,
grounding answers in documents and live web sources, and inspecting how a
response moves through the system. The name describes its role as a nexus:
one controlled workspace connecting providers, models, memory, knowledge, web
retrieval, workflows, and response delivery.

It is best described as a **grounded AI orchestration workspace**, not a
general-purpose autonomous agent. It combines provider choice, persistent
chat, retrieval-augmented generation (RAG), bounded workflows, document
analysis, knowledge extraction, reviewed memory, and browser-local telemetry
in one interface.

The application follows a bring-your-own-key model: each user supplies their
own provider credentials through the UI. Provider credentials are encrypted at
rest, scoped to the owning user, and decrypted only when a request is sent.

This document describes the current implementation, including its boundaries;
it is not a promise of future functionality.

---

## Contents

1. [Capabilities and scope](#capabilities-and-scope)
2. [Architecture overview](#architecture-overview)
3. [Repository layout](#repository-layout)
4. [Backend architecture](#backend-architecture)
5. [Frontend architecture](#frontend-architecture)
6. [Authentication and security](#authentication-and-security)
7. [Provider and model lifecycle](#provider-and-model-lifecycle)
8. [Chat request lifecycle](#chat-request-lifecycle)
9. [Streaming protocol](#streaming-protocol)
10. [Background response behavior](#background-response-behavior)
11. [RAG architecture](#rag-architecture)
12. [Web-connected RAG](#web-connected-rag)
13. [Agent workflows](#agent-workflows)
14. [Document comparison](#document-comparison)
15. [Knowledge graphs](#knowledge-graphs)
16. [Memory refinement](#memory-refinement)
17. [System Visualizer](#system-visualizer)
18. [Generated project artifacts](#generated-project-artifacts)
19. [Database model](#database-model)
20. [Local development](#local-development)
21. [Configuration](#configuration)
22. [Testing and validation](#testing-and-validation)
23. [Production deployment](#production-deployment)
24. [Operational limitations and next improvements](#operational-limitations-and-next-improvements)

---

## Capabilities and scope

### What Nexus AI can do

- Connect multiple providers using user-owned API keys.
- Discover or manually register provider models.
- Stream persistent conversations with Markdown, tables, regeneration, and
  provider error reporting.
- Ground responses in uploaded documents, OCR text, retrieved web pages, and
  approved user memories.
- Compare documents and produce structured reports.
- Extract knowledge-graph nodes, relationships, and reviewable facts.
- Run bounded plan/execute/synthesize workflows with a maximum of three steps.
- Refine durable user preferences into memories that require approval before
  they affect future chats.
- Show local, animated telemetry for routing, retrieval, model streaming,
  uploads, graphs, and memory operations.
- Manage the account through Settings: log out, clear local cache, clear
  conversations, clear memories, and permanently delete the account.
- Generate a new project from model-streamed code with `/zip`, display the
  generated files as readable Markdown, and download both the generated ZIP
  and a standalone `README.md`.

### What Nexus AI cannot do

- It cannot guarantee that an external provider is available, fast, accurate,
  or willing to serve a selected model.
- It cannot run arbitrary code, take unrestricted autonomous actions, or
  operate as an unlimited agent.
- It cannot guarantee that model-generated facts, prices, citations, graph
  edges, or memories are correct; users must review important results.
- It cannot make web search authoritative: web retrieval uses accessible
  sources and may be incomplete, stale, blocked, or rate-limited.
- It cannot preserve uploaded files on free Render disk after restarts or
  redeploys; durable object storage is required for production RAG.
- It cannot continue a response reliably after the browser, backend process,
  or network request is terminated; the current background behavior is not a
  durable job queue.
- It cannot show server-wide telemetry: the System Visualizer is local to the
  current browser tab.
- It cannot make provider credentials recoverable if `ENCRYPTION_KEY` is lost
  or changed; previously encrypted credentials then require re-entry.
- It cannot make changing `SECRET_KEY` transparent; doing so invalidates
  existing sessions.
- It cannot create a project ZIP from the Nexus AI repository. ZIP artifacts
  contain only files returned by the selected model. If the model does not
  return usable generated files, no ZIP is created.
- It cannot generate real image or video binaries with the current text-only
  adapters. `/photo` and `/video` return an explicit capability message until
  a compatible media provider is implemented.

### Provider management

Users can create multiple named connections for:

- OpenRouter
- NVIDIA NIM
- OpenAI
- Google Gemini
- Anthropic
- Custom OpenAI-compatible endpoints

Each connection has its own encrypted credential, provider type, optional base
URL, connection status, last error, and verification timestamp.

### Model management

Models can be discovered from providers that expose a model-list endpoint or
registered manually. Each model records:

- Provider model identifier
- Display name and description
- Context length
- Free/paid/unknown pricing tier
- Input and output prices when available
- Vision, tools, and streaming support
- Enabled or disabled state

The chat UI only permits enabled models owned by the authenticated user.

### Chat

Chat supports:

- Conversation creation and persistence
- Conversation renaming and deletion
- Model selection
- Streaming responses
- Markdown and GitHub-Flavored Markdown
- Copyable tables
- Regeneration
- Knowledge-base selection
- Live web search toggle
- Bounded agent-workflow toggle
- Approximate context-token display
- Provider error reporting
- Response modes for normal chat, generated project ZIPs, images, and video
- Live generated-file output for project requests
- Persistent artifact links that can be reconstructed after navigation

### Knowledge features

Knowledge bases support:

- PDF, DOCX, TXT, Markdown, and image uploads
- Text extraction
- OCR for image files and scanned PDF pages
- Chunking with configurable overlap
- Embedding through a configured provider connection
- Similarity retrieval
- Source previews in chat
- Structured document comparison
- Knowledge graph extraction
- Fact extraction and conflict review

### Memory features

User-level memory refinement extracts candidate durable preferences and facts
from recent conversations. Memories remain `pending` until the user approves
them. Only approved memories are injected into later chats.

### System Visualizer

The System Visualizer is a live frontend telemetry view. It displays animated
processing stages for:

```text
Input → Router → Memory / Knowledge / Web → Model → Response
```

It also shows a live event list and counters for chat, retrieval, model, web,
upload, graph, and memory activity.

### Account and data controls

Settings provides:

- Session logout
- Local browser cache clearing
- Deletion of all conversations
- Deletion of all approved, pending, and archived user memories
- Permanent account deletion, including owned providers, models, knowledge
  bases, preferences, conversations, and memories

Destructive server-side actions require confirmation in the interface.

---

## Architecture overview

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              NEXUS AI WORKSPACE                             │
├────────────────────────────── Browser / React ─────────────────────────────┤
│                                                                            │
│  Chat + Composer       Provider Manager       Model Library                │
│  • SSE streaming       • encrypted-key UX     • discovery/verification     │
│  • response modes      • provider tests       • enable/disable/grouping    │
│  • artifact downloads  • model registration   • capability-aware choices   │
│                                                                            │
│  Knowledge Bases       Memories + Settings    System Visualizer             │
│  • uploads/OCR         • review workflow      • live in-tab telemetry      │
│  • facts/graphs        • approved context    • glowing active routes      │
│  • comparisons         • account controls     • artifact stage             │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ REST + Server-Sent Events
                                ▼
┌──────────────────────────── FastAPI API ────────────────────────────────────┐
│                                                                            │
│ Auth ─ Providers ─ Models ─ Conversations ─ Chat ─ RAG ─ Memories ─ Config │
│   │        │          │          │          │       │        │              │
│   │        │          │          │          │       │        │              │
│   │        └──────────┴──────────┴──────────┴───────┴────────┘              │
│   │                         orchestration + ownership checks                │
│   ▼                                                                        │
│ SQLAlchemy models / transactional persistence                               │
│   │                    │                         │                          │
│   ▼                    ▼                         ▼                          │
│ SQLite (dev)       PostgreSQL (prod)       RAG upload/artifact storage      │
└───────────────────────┬──────────────────────────┬─────────────────────────┘
                        │                          │
                        ▼                          ▼
             ┌─────────────────────┐    ┌──────────────────────────────────┐
             │ Provider adapters   │    │ Retrieval and extraction         │
             │ OpenAI-compatible   │    │ chunk → embed → rank → cite     │
             │ OpenRouter / NVIDIA │    │ PDF/DOCX/TXT/MD/image + OCR      │
             │ Gemini / Anthropic  │    │ DuckDuckGo live web retrieval    │
             │ Custom endpoints    │    │ facts, graph, comparisons       │
             └──────────┬──────────┘    └──────────────────────────────────┘
                        │
                        ▼
             User-owned external model APIs
```

### End-to-end request architecture

The same system can be viewed as a data-flow graph:

```mermaid
flowchart LR
    U[User prompt] --> C[ChatView + Composer]
    C --> A[Authenticated REST/SSE API]
    A --> R[Router and ownership checks]
    R --> S{Requested sources}
    S --> M[Approved memories]
    S --> K[Knowledge-base retrieval]
    S --> W[Live web retrieval]
    M --> P[Prompt context]
    K --> P
    W --> P
    P --> X{Response mode}
    X --> N[Normal provider stream]
    X --> Z[Generated project stream]
    X --> I[Media capability response]
    N --> O[Assistant message]
    Z --> F[FILE block parser]
    F --> Q[Generated files + README]
    Q --> D[Downloadable ZIP and README]
    O --> D2[Persisted conversation]
    D --> D2
    D2 --> V[System Visualizer telemetry]
```

The browser is responsible for presentation, local UI state, SSE parsing, and
in-tab telemetry. The backend is responsible for authentication,
authorization, persistence, provider access, retrieval, extraction, and
response generation.

The frontend never receives stored provider API keys. The backend decrypts a
credential only while constructing a provider adapter.

---

## Repository layout

```text
nexus-ai/
├── README.md
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── dependencies.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── security.py
│   │   ├── providers/
│   │   │   ├── base.py
│   │   │   ├── registry.py
│   │   │   ├── openai_provider.py
│   │   │   ├── openrouter.py
│   │   │   ├── nvidia.py
│   │   │   ├── gemini.py
│   │   │   ├── anthropic_provider.py
│   │   │   └── custom.py
│   │   ├── rag/
│   │   │   ├── extraction.py
│   │   │   ├── chunker.py
│   │   │   ├── embeddings.py
│   │   │   ├── ingestion.py
│   │   │   ├── retrieval.py
│   │   │   └── web.py
│   │   └── routers/
│   │       ├── auth.py
│   │       ├── chat.py
│   │       ├── conversations.py
│   │       ├── memories.py
│   │       ├── models.py
│   │       ├── providers.py
│   │       ├── rag.py
│   │       └── settings.py
│   ├── tests/
│   ├── alembic/
│   ├── requirements.txt
│   ├── .env.example
│   ├── Dockerfile
│   ├── render.yaml
│   └── alembic.ini
└── frontend/
    ├── src/
    │   ├── api/client.js
    │   ├── context/AuthContext.jsx
    │   ├── utils/
    │   │   ├── backgroundTasks.js
    │   │   ├── systemEvents.js
    │   │   ├── theme.js
    │   │   └── tokens.js
    │   ├── components/
    │   │   ├── Chat/
    │   │   ├── Layout/
    │   │   ├── Models/
    │   │   ├── Providers/
    │   │   ├── RAG/
    │   │   ├── Settings/
    │   │   └── SystemVisualizer/
    │   └── pages/
    ├── public/
    ├── package.json
    └── vite.config.js
```

Generated directories such as `backend/.venv`, `frontend/node_modules`, and
`frontend/dist` are local build artifacts and are not application source.

---

## Backend architecture

### Application startup

`backend/app/main.py` creates the FastAPI application, installs CORS
middleware, registers all routers, and exposes the health endpoint:

```text
GET /api/v1/health
```

In development, `Base.metadata.create_all()` creates missing tables at startup.
Production should use Alembic migrations instead.

### Configuration

`backend/app/config.py` uses Pydantic Settings. Configuration contains
infrastructure values only:

- Database URL
- Session signing secret
- Credential-encryption key
- CORS origins
- Cookie options
- RAG upload directory
- Maximum upload size

Provider API keys do not belong in `.env`. They are user data and are entered
through Provider Manager.

### Database sessions

`database.py` creates the SQLAlchemy engine and `SessionLocal`. FastAPI's
`get_db()` dependency creates one session per request and closes it in a
`finally` block.

Streaming routes require special care because the request setup session can be
closed while the SSE generator is still running. The chat route therefore
captures scalar values before streaming and opens a separate session when it
persists the final assistant message.

### Routers

| Router | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/api/v1/auth` | Registration, login, logout, current user |
| `providers.py` | `/api/v1/providers` | Provider connection CRUD, validation, model discovery |
| `models.py` | `/api/v1/models` | User model registration and enable/disable |
| `conversations.py` | `/api/v1/conversations` | Conversation CRUD and message history |
| `chat.py` | `/api/v1/chat` | Provider-backed streaming chat |
| `settings.py` | `/api/v1/settings` | Theme, default model, interface preferences |
| `memories.py` | `/api/v1/memories` | User memory extraction and approval |
| `rag.py` | `/api/v1/rag` | Knowledge bases, documents, comparisons, graph, facts |

Every protected route obtains the user from the session cookie and verifies
ownership server-side.

---

## Frontend architecture

The frontend is a React 18 single-page application built with Vite.
`App.jsx` provides authenticated and unauthenticated route groups.
`AppShell.jsx` provides the persistent sidebar and the main route outlet.

### Main routes

| Route | Screen |
|---|---|
| `/` | New conversation |
| `/c/:conversationId` | Existing conversation |
| `/providers` | Provider Manager |
| `/models` | Model Library |
| `/knowledge-bases` | Knowledge Base Manager |
| `/settings` | Settings and memory review |
| `/visualizer` | System Visualizer |

### API client

`frontend/src/api/client.js` provides:

- JSON REST helpers
- Cookie-authenticated fetch requests
- Upload progress via `XMLHttpRequest`
- SSE parsing for chat completions

The browser sends `credentials: "include"` so the HttpOnly session cookie is
included in API requests.

### Frontend state

Chat state is held by `ChatView`. It owns the selected model, selected
knowledge base, Web and Agent toggles, messages, loading state, and stream
state.

The frontend does not mutate existing message objects during streaming.
Instead, it creates immutable replacements so React rendering remains
consistent, especially under Strict Mode.

---

## Authentication and security

### Passwords

Passwords are hashed with Argon2 through Passlib. Plaintext passwords are never
stored.

### Sessions

Authentication uses a signed JWT stored in an HttpOnly cookie. JavaScript
cannot read the cookie. The authenticated identity comes from the cookie, not
from a user ID supplied in a request body.

### Provider credentials

The credential flow is:

```text
User enters API key
        ↓
Backend validates provider connection
        ↓
Backend encrypts the key with Fernet
        ↓
Encrypted credential stored in encrypted_credentials
        ↓
Chat request verifies ownership
        ↓
Registry decrypts key in memory
        ↓
Adapter sends provider request
        ↓
Key is never returned to frontend or logged
```

The `ENCRYPTION_KEY` is critical. Losing it makes stored provider credentials
undecryptable. It must be backed up separately from the database.

### Authorization

Every lookup is checked against `current_user.id`, including:

- Provider connections
- Models
- Conversations
- Knowledge bases
- Documents
- Comparisons
- Graph data
- Facts
- Memories

### Custom provider SSRF protection

Custom OpenAI-compatible URLs are validated before use. Localhost, loopback,
private/link-local networks, and cloud metadata targets are rejected.

### Production cookie settings

For a frontend and backend on different HTTPS origins:

```env
COOKIE_SECURE=true
COOKIE_SAMESITE=none
```

---

## Provider and model lifecycle

All providers implement the common `ProviderAdapter` interface in
`providers/base.py`:

```python
test_connection()
discover_models()
stream_chat(model_id, messages)
```

The rest of the application never calls a provider SDK directly. It calls the
adapter interface. Adding a provider therefore consists primarily of:

1. Implementing one adapter.
2. Registering it in `providers/registry.py`.
3. Adding provider-specific discovery and request formatting.

### Connection creation

1. The user selects a provider.
2. The user enters a connection name and API key.
3. The backend builds a temporary adapter from the submitted key.
4. The backend tests the connection.
5. The key is encrypted and stored only if validation succeeds.
6. The frontend receives connection metadata, never the secret.

### Model discovery

For discoverable providers, the adapter returns normalized `DiscoveredModel`
objects. The backend stores them as `UserModel` rows tied to the user's
connection. Providers without discovery support use manual model registration.

The Provider Manager can also register a single manually supplied model. Model
discovery and verification are separate concerns:

1. Connection verification confirms that the credential and endpoint respond.
2. Discovery lists models exposed by the provider.
3. Chat capability checks send a small streamed probe to confirm that a model
   can actually generate text for the current account.
4. Embedding capability checks send a vector probe for embedding models.
5. Failed or inaccessible models are excluded from capability-aware selectors.

Capability results are cached briefly in the frontend to keep knowledge-base
model selection responsive while still allowing a fresh verification after a
provider or model changes.

### Streaming normalization

Some OpenAI-compatible services emit deltas; others emit cumulative text or
overlapping fragments. The OpenAI-compatible adapter normalizes chunks before
the frontend receives them, preventing output such as:

```text
TheThe price price
```

Provider timeouts distinguish connection/request timeouts from stream read
timeouts. The current streaming read timeout is intentionally generous for
slow or cold-started hosted models.

### Model Library organization

The Model Library keeps enabled models ahead of disabled models, supports
individual toggles and bulk enable/disable operations, and groups models by
capability or use case. Users can create custom groups and move models into
them. The selected model remains selected while the list is refreshed or
reordered.

---

## Chat request lifecycle

For `POST /api/v1/chat/completions`:

```text
1. Authenticate from session cookie
2. Load selected UserModel
3. Verify model ownership and enabled state
4. Verify provider connection ownership
5. Load or create conversation
6. Persist the user's message
7. Build bounded conversation history
8. Add approved user memories
9. Optionally retrieve knowledge-base chunks
10. Optionally retrieve live web sources
11. Optionally execute bounded agent workflow
12. Stream provider output as SSE
13. Persist the completed assistant message
14. Emit the final done event
```

The history cap is currently `MAX_HISTORY_MESSAGES = 40`. Token counting in
the frontend is an estimate based on text length and is not provider billing
data.

### Context ordering

The model receives system context before conversation history. Depending on
enabled options, the system context can include:

1. Approved user memories
2. Knowledge-base retrieval context
3. Live web context
4. Conversation messages

Retrieved context is treated as evidence, not as instructions.

---

## Streaming protocol

The backend returns `text/event-stream`. Each event is sent as:

```text
data: {"type":"event-name", "...":"..."}\n\n
```

Important event types:

| Event | Meaning |
|---|---|
| `start` | Conversation/model metadata and retrieved source metadata |
| `workflow` | Agent planning, execution, synthesis, or completion |
| `delta` | One normalized piece of assistant text |
| `error` | A provider or request failure |
| `done` | Persistence finished; includes message ID and optional error |

Example:

```json
{"type":"start","conversation_id":"...","model_display_name":"..."}
{"type":"delta","content":"Hello"}
{"type":"delta","content":" world"}
{"type":"done","message_id":"...","error":null}
```

The final assistant message is persisted even when the provider fails, with the
failure recorded in the `error` column. This avoids false success states.

---

## Background response behavior

When a user navigates between screens inside the single-page app, the browser
request is allowed to continue. The chat UI records active conversation IDs in
`localStorage` through `backgroundTasks.js`.

When the user returns to a conversation:

1. The conversation is loaded from the backend.
2. If its ID is marked active, the frontend polls every two seconds.
3. Newly persisted messages replace the local conversation state.
4. The active marker is removed when the `done` event arrives.

This means a user can go to Settings, Providers, Models, Knowledge Bases, or
System Visualizer while a response is being generated and see the completed
response after returning.

This is not yet a durable server-side job queue. Closing the browser, losing
the page process, restarting the backend, or terminating the network request
can interrupt the live request. A future Celery, Dramatiq, Redis Queue, or
database-backed job system would be required for guaranteed processing after
the browser is closed.

---

## RAG architecture

RAG consists of extraction, chunking, embedding, storage, retrieval, and
prompt injection.

### Upload

The frontend sends a multipart upload to:

```text
POST /api/v1/rag/knowledge-bases/{kb_id}/documents
```

The backend:

1. Verifies knowledge-base ownership.
2. Validates extension and size.
3. Stores the file below the user/knowledge-base directory.
4. Creates a `KBDocument` row with `pending` status.
5. Starts ingestion as a FastAPI background task.
6. Returns immediately so the UI remains responsive.

The frontend polls document status while it is `pending` or `processing`.

### Extraction

`rag/extraction.py` supports:

- Plain text and Markdown
- PDF text extraction with `pypdf`
- DOCX text extraction with `python-docx`
- Raster images with Pillow
- OCR through `pytesseract`
- Scanned PDF page rendering through PyMuPDF before OCR
- OCR of embedded DOCX images

Tesseract is an external executable and must be installed separately on the
host. Installing the Python package alone does not install Tesseract.

### Chunking

Extracted text is split into overlapping chunks using the knowledge base's:

- `chunk_size`
- `chunk_overlap`

Overlap preserves context across chunk boundaries.

### Embeddings

Chunks are embedded with the knowledge base's configured embedding connection
and embedding model. Vectors are stored as serialized blobs in `KBChunk`.
The first successful ingestion records the embedding dimension.

The embedding connection is separate from the chat model connection so a user
can choose different infrastructure for retrieval and generation.

### Retrieval

For a chat query:

1. The query is embedded using the KB's embedding model.
2. Stored chunk vectors are compared with the query vector.
3. The top `retrieval_k` chunks are selected.
4. A source-labeled context message is created.
5. The context is prepended to the chat request.
6. Source previews are returned in the SSE `start` event.

The current implementation uses an in-process similarity calculation with
NumPy and does not require a separate vector database.

---

## Web-connected RAG

When the Web toggle is enabled:

1. The backend searches DuckDuckGo's HTML interface.
2. Search results are normalized into title, URL, and content.
3. Readable page text is extracted where possible.
4. The sources are injected as system context.
5. Source titles and URLs are sent to the frontend for citation display.

This is a keyless, no-paid-service integration. It is not an official Google
Search API and may be affected by provider rate limits, HTML changes, robots
rules, or network availability.

---

## Agent workflows

The Agent toggle enables a bounded planner/executor/synthesis flow:

```text
User request
    ↓
Planner returns up to 3 short steps
    ↓
Each step executes against the same context
    ↓
Final synthesis produces one answer
```

The planner is instructed to use one step for simple questions and avoid
redundant work. The hard limit is `MAX_WORKFLOW_STEPS = 3`.

Workflow status is streamed to the frontend so the chat and System Visualizer
can show planning, execution, synthesis, and completion.

The workflow is not an unrestricted autonomous agent. It has no general tool
execution loop and does not run arbitrary code.

---

## Document comparison

The document comparison endpoint accepts two ready documents and an enabled
model:

```text
POST /api/v1/rag/knowledge-bases/{kb_id}/compare
```

The backend extracts both documents, sends a structured comparison prompt to
the selected model, and stores the Markdown report in `DocumentComparison`.

Reports include:

- Executive summary
- Similarities
- Differences
- Detailed comparison
- Evidence and caveats

Users can rate a comparison positively or negatively and submit feedback.
Previous feedback is supplied to future comparisons in the same knowledge
base. Comparisons are marked stale when their source documents are updated.

---

## Knowledge graphs

Knowledge graph extraction is scoped to one knowledge base.

```text
POST /api/v1/rag/knowledge-bases/{kb_id}/graph
```

The selected model receives document text and is asked for strict JSON:

```json
{
  "nodes": [
    {
      "name": "Example",
      "type": "project",
      "description": "..."
    }
  ],
  "edges": [
    {
      "source": "Example",
      "target": "Nexus AI",
      "relationship": "uses",
      "evidence": "..."
    }
  ]
}
```

The backend:

1. Validates the user, model, connection, and knowledge base.
2. Reads ready documents.
3. Requests bounded JSON extraction.
4. Parses up to 100 nodes and 200 edges.
5. Deduplicates nodes by normalized name.
6. Resolves edge endpoints.
7. Replaces the current graph for that knowledge base.

The current UI displays an entity/relationship summary rather than a full
interactive node-link canvas. Source-document attribution exists on the
database node model but extraction currently assigns limited source linkage.

---

## Memory refinement

### User memories

`POST /api/v1/memories/refine` asks an enabled model to extract durable,
user-specific facts from recent user messages.

The extractor is instructed not to infer or store:

- Passwords or secrets
- Health information
- Political or religious traits
- Sensitive identity information
- One-off requests
- Facts about other people

New memories are created with `pending` status. The user reviews them in
Settings:

```text
GET   /api/v1/memories
PATCH /api/v1/memories/{memory_id}
```

Valid statuses are:

- `pending`
- `approved`
- `archived`

Only approved memories are injected into chat context.

### Knowledge-base facts

Fact refinement extracts explicit triples:

```text
subject — predicate — object
```

For example:

```text
Nexus AI — uses — FastAPI
```

If a later extraction finds the same subject and predicate with a different
object, the older fact is marked `conflict`. Users can accept or dismiss facts
from the knowledge-base panel.

Fact statuses are:

- `active`
- `conflict`
- `stale`
- `dismissed`

The current refinement system is review-oriented. It does not silently delete
or overwrite contradictory information.

---

## Important API surface

The backend exposes versioned routes under `/api/v1`:

| Area | Representative endpoints |
|---|---|
| Health | `GET /health` |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` |
| Providers | `GET/POST/PATCH/DELETE /providers`, connection testing, discovery |
| Models | `GET/POST/PATCH/DELETE /models`, enable/disable, capability checks |
| Conversations | `GET/POST/PATCH/DELETE /conversations` |
| Streaming chat | `POST /chat/completions` |
| Artifacts | `GET /chat/artifacts/{random-name}.zip` or `.md` |
| Knowledge bases | `/rag/knowledge-bases` and nested documents, facts, graph, compare |
| Memories | `/memories`, refinement, approval, archive |
| Settings | `/settings` and account/data deletion operations |

Protected endpoints use the authenticated session cookie. Resource IDs are
never authorization by themselves; every lookup is scoped to the current
user.

---

## System Visualizer

The System Visualizer is available at `/visualizer` from the sidebar.

It uses `frontend/src/utils/systemEvents.js`, an in-browser event bus with a
bounded history of 120 events. Components emit events for:

- Question received
- Request routed
- Knowledge retrieved
- Web sources found
- Workflow planning and execution
- Model streaming
- Response delivered
- Upload started/completed/failed
- Knowledge graph extraction
- Fact refinement
- Memory refinement

The visualizer subscribes to this event bus and renders:

- Animated system nodes
- Animated links when adjacent stages are active
- Current operation
- Event timestamps
- Event status
- Activity counters

Telemetry is currently per browser tab. It is not a server-wide observability
system and does not show activity from other users or other browser tabs unless
they emit through the same tab's event bus.

---

## Generated project artifacts

The chat composer has a **Download ZIP** response mode for creating a new
project from the selected model's streamed output. This is intentionally
different from exporting or archiving the Nexus AI source tree.

### Generation flow

```text
User selects Download ZIP
        ↓
ChatView sends a /zip request
        ↓
Backend selects the user's enabled model and provider connection
        ↓
Model streams generated source blocks
        ↓
FILE parser extracts safe relative paths and complete contents
        ↓
Backend creates a ZIP only from those generated files
        ↓
Backend creates a formatted README.md
        ↓
SSE emits artifact links
        ↓
Chat persists links so downloads survive navigation/reload
```

The preferred model protocol is:

```text
FILE: relative/path/to/file.ext
complete file contents, preserving line breaks and indentation
END FILE
```

The parser also attempts to recover common malformed output, including
collapsed `FILE: path content END FILE` blocks and fenced Markdown files. A
successful response must still contain at least one valid generated file.

### Safety rules

Generated artifact packaging:

- Never reads the repository root.
- Never calls the old repository-archive implementation.
- Rejects absolute paths and `..` traversal.
- Rejects `.env` files, Git metadata, Python caches, and `node_modules`.
- Runs ZIP creation in a worker thread so the SSE event loop stays responsive.
- Stores artifacts under a temporary artifact directory using random names.
- Requires the authenticated user for artifact downloads.

The ZIP contains a generated `README.md` in addition to the model-returned
files. The chat also exposes that README as an independent Markdown download.
The displayed response uses a separate Markdown section and syntax-highlighted
fences for each generated file, making the result readable and copyable.

### Artifact events

Artifact-enabled streams can emit:

| Event | Meaning |
|---|---|
| `artifact_status` | Generation or ZIP packaging progress |
| `delta` | Generated code or final formatted file output |
| `artifact` (`kind=zip`) | Generated ZIP is ready |
| `artifact` (`kind=readme`) | Standalone README is ready |
| `error` | Generation, parsing, or provider failure |
| `done` | Assistant persistence completed |

If the model returns only prose or unusable output, Nexus reports an explicit
failure and does not create a repository ZIP or a misleading download link.

### Current media boundary

`/photo` and `/video` are recognized response modes, but the currently
implemented provider adapters are text-streaming adapters. Until a
media-capable adapter is added, these modes return a clear explanation and do
not fabricate binary files.

---

## Database model

The primary SQLAlchemy models are:

| Model | Purpose |
|---|---|
| `User` | Account identity |
| `ProviderConnection` | Per-user provider configuration |
| `EncryptedCredential` | Encrypted provider API key |
| `UserModel` | Discovered or manually registered model |
| `Conversation` | Chat session |
| `Message` | User, assistant, or system message |
| `UserPreference` | Theme, default model, interface settings |
| `UserMemory` | Reviewable user-level memory |
| `KnowledgeBase` | Per-user document collection |
| `KBDocument` | Uploaded source document |
| `KBChunk` | Chunk text and embedding blob |
| `DocumentComparison` | Stored comparison report and feedback |
| `KnowledgeGraphNode` | Extracted entity |
| `KnowledgeGraphEdge` | Extracted relationship |
| `KBFact` | Explicit fact with review status |

Foreign keys use cascading deletes where appropriate so deleting a user or
knowledge base removes owned data. Production migration files should be kept
in sync with any new model.

---

## Local development

### Requirements

- Python 3.12 or 3.13 recommended
- Node.js 18 or newer
- npm
- Tesseract OCR executable for OCR functionality
- PostgreSQL only if using PostgreSQL locally; SQLite is the default

Python versions without compatible `psycopg2-binary` wheels can fail during
installation. If PostgreSQL support is needed, use a supported Python version
or install PostgreSQL build tooling.

### Backend setup on Windows PowerShell

```powershell
Set-Location D:\nexus-ai\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

Generate secrets:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put the generated values in `.env` as `SECRET_KEY` and `ENCRYPTION_KEY`.

Start the API:

```powershell
uvicorn app.main:app --reload
```

Verify:

```text
http://localhost:8000/api/v1/health
```

### Frontend setup

```powershell
Set-Location D:\nexus-ai\frontend
npm install
npm run dev
```

The Vite development server normally runs at:

```text
http://localhost:5173
```

The frontend defaults to `http://localhost:8000` as its backend URL. Override
it with a Vite environment variable if necessary:

```env
VITE_API_BASE_URL=http://localhost:8000
```

The repository currently does not require a frontend `.env.example`; create a
local `.env` only when overriding the default API URL.

### First-use flow

1. Open the frontend.
2. Register an account.
3. Open Provider Manager.
4. Add a provider using your own API key.
5. Test the connection.
6. Select models in Model Library.
7. Start a conversation.
8. Optionally create a knowledge base and configure an embedding connection.

---

## Configuration

Backend `.env` values:

| Variable | Purpose | Development default |
|---|---|---|
| `ENVIRONMENT` | Environment mode | `development` |
| `DATABASE_URL` | SQLAlchemy database URL | `sqlite:///./nexus.db` |
| `SECRET_KEY` | JWT/session signing secret | Must be replaced |
| `ENCRYPTION_KEY` | Fernet key for provider credentials | Must be replaced |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Session lifetime | `20160` |
| `SESSION_COOKIE_NAME` | Cookie name | `nexus_session` |
| `CORS_ORIGINS` | Allowed frontend origins | `http://localhost:5173` |
| `COOKIE_SECURE` | HTTPS-only cookie flag | `false` |
| `COOKIE_SAMESITE` | Cookie cross-site policy | `lax` |
| `RAG_UPLOAD_DIR` | Persistent document storage | `./rag_uploads` |
| `RAG_MAX_FILE_MB` | Per-file upload limit | `50` |

Example production database URL:

```env
DATABASE_URL=postgresql+psycopg2://user:password@host:5432/nexus
```

Never commit `.env`, provider credentials, generated secrets, or production
database URLs.

---

## Testing and validation

### Backend compilation

```powershell
Set-Location D:\nexus-ai\backend
.\.venv\Scripts\python.exe -m compileall -q app
```

### Backend tests

```powershell
Set-Location D:\nexus-ai\backend
.\.venv\Scripts\python.exe -m pytest
```

Provider calls should be mocked in tests. Tests should not require paid API
accounts or real provider network access.

### Frontend production build

```powershell
Set-Location D:\nexus-ai\frontend
npm run build
```

### Test categories worth maintaining

- Authentication and ownership isolation
- Provider credential encryption/decryption
- Provider error formatting
- Stream chunk normalization
- Chat persistence after provider failure
- RAG extraction and chunking
- Retrieval ranking
- Graph JSON parsing and replacement
- Fact conflict detection
- Memory approval behavior
- Frontend production build

---

## Production deployment

### Frontend

The frontend can be deployed to Vercel, Netlify, or any static host:

```powershell
Set-Location D:\nexus-ai\frontend
npm run build
```

Configure:

```env
VITE_API_BASE_URL=https://your-backend.example.com
```

The generated `dist` directory is the static application.

### Backend

The backend includes Docker and Render configuration. Any container host can
run the same ASGI application:

```text
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Production requirements:

1. Use Supabase PostgreSQL or another durable database.
2. Set strong random `SECRET_KEY`.
3. Set a durable `ENCRYPTION_KEY`.
4. Set exact `CORS_ORIGINS`.
5. Set `COOKIE_SECURE=true`.
6. Set `COOKIE_SAMESITE=none` for cross-site HTTPS frontend/backend.
7. Use a persistent volume or object storage for RAG uploads.
8. The backend container runs `alembic upgrade head` before starting
   Uvicorn.
9. Do not rely on development `create_all()` as the production migration
   mechanism.
10. Configure provider and database network timeouts.

### Supabase PostgreSQL

For a free database deployment, create a project at
[supabase.com](https://supabase.com), then open **Project Settings →
Database → Connection pooling**. Copy the **Session pooler** connection
string for the backend.

Set the SQLAlchemy driver explicitly:

```env
DATABASE_URL=postgresql+psycopg2://postgres.PROJECT_REF:PASSWORD@HOST:5432/postgres
```

If you use Supabase's transaction pooler, use its port `6543`. URL-encode
special characters in the database password, including `@`, `:`, `/`, `#`,
and `%`.

The Render Blueprint leaves `DATABASE_URL` as a manually supplied secret and
does not create a Render PostgreSQL database. The container runs
`alembic upgrade head` against Supabase before starting FastAPI. Never commit
the Supabase password or connection string.

The free Render web service uses `/tmp/rag_uploads`, so uploaded documents are
ephemeral and can disappear after a restart or redeploy. Use Supabase Storage,
S3, or another object-storage service before relying on production RAG files.

### Alembic

The project contains Alembic configuration, but every newly added model must
have a corresponding production migration before deployment. Development
startup currently creates missing tables automatically, which can hide missing
migrations during local testing.

Typical commands:

```powershell
Set-Location D:\nexus-ai\backend
alembic upgrade head
alembic revision --autogenerate -m "describe schema change"
```

Review autogenerated migrations manually before applying them to production.

### File storage

Local file storage is appropriate for development. In production, use:

- A mounted persistent disk, or
- S3-compatible object storage such as S3, R2, or MinIO

If object storage is introduced, update the ingestion and extraction path
handling so workers can retrieve document bytes without relying on local disk.

---

## Operational limitations and next improvements

The current implementation is functional but intentionally bounded.

### Current limitations

- Background responses are browser-session resilient, not durable server jobs.
- System Visualizer telemetry is local to the browser tab.
- Knowledge graph UI is textual rather than a full graph canvas.
- Graph extraction has limited source-document attribution.
- Fact extraction is model-assisted and requires user review.
- Memory extraction is model-assisted and requires approval.
- OCR requires a separately installed Tesseract executable.
- Web search uses DuckDuckGo HTML rather than an official paid search API.
- RAG embeddings are stored in SQL rows as serialized blobs, which is suitable
  for small and medium knowledge bases but not ideal for very large corpora.
- Development table creation and production migration state can diverge.
- Provider availability, cold starts, rate limits, and model-specific behavior
  remain external dependencies.

### Recommended next improvements

1. Add durable background jobs with Redis plus Celery, Dramatiq, or RQ.
2. Add a backend event stream or WebSocket for server-wide visualizer telemetry.
3. Add a graph canvas with zoom, filtering, clustering, and source citations.
4. Store graph extraction version and source document IDs for every edge.
5. Add scheduled fact freshness checks and document versioning.
6. Add a vector database or PostgreSQL pgvector for larger knowledge bases.
7. Add token-aware history trimming using provider tokenizer metadata.
8. Add provider health metrics, latency, retries, and circuit breakers.
9. Add formal Alembic migrations for every current model.
10. Add object storage and worker-based document ingestion for production scale.

---

## Design principles

Nexus AI is built around these invariants:

1. **User-owned provider access:** provider keys belong to users, not the
   application developer.
2. **Server-side authorization:** client-supplied IDs are never sufficient for
   access.
3. **Adapter isolation:** chat and discovery logic do not depend on one
   provider's SDK.
4. **Explicit failure:** provider errors are persisted and surfaced instead of
   being converted into fake successful responses.
5. **Review before refinement:** memories and contradictory facts are not
   silently promoted or deleted.
6. **Bounded automation:** agent workflows and extraction limits are capped.
7. **Streaming-first UX:** the user sees model output and workflow progress as
   soon as it arrives.
8. **Development convenience, production discipline:** automatic table creation
   helps local development, while production must use migrations, durable
   storage, and managed secrets.
