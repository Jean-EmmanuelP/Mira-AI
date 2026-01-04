# Mira - AI Companion That Remembers Who You Are

Mira is an intelligent AI companion backend that maintains persistent memory of users, their preferences, and conversation history. Unlike typical chatbots, Mira builds a semantic understanding of each user over time.

**She remembers your dog's name. She asks about your job interview. She notices when you're stressed.**

## Table of Contents

- [Features](#features)
- [How Mira Remembers](#how-mira-remembers)
- [Architecture Deep Dive](#architecture-deep-dive)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Conversational Approach](#conversational-approach)
- [Technical Decisions & Tradeoffs](#technical-decisions--tradeoffs)
- [Project Structure](#project-structure)

## Features

- **Semantic Memory**: Vector-based memory storage that understands meaning, not just keywords
- **Goal Tracking**: Detects and proactively follows up on user goals
- **Multi-LLM Fallback**: Gemini → Claude → Mistral with automatic failover
- **Voice Support**: Speech-to-Text and Text-to-Speech via Gradium API
- **User Profiles**: Auto-generated summaries of who each user is
- **Emotional Context**: Captures and responds to emotional states

## How Mira Remembers

### The Memory Pipeline

When you send a message to Mira, here's what happens:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE PROCESSING FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. USER MESSAGE                                                             │
│     "Hi! I'm Lucas, I'm stressed about my marathon in 3 months.             │
│      My dog Pixel keeps me company during training."                         │
│                          │                                                   │
│                          ▼                                                   │
│  2. PARALLEL PROCESSING                                                      │
│     ┌─────────────────────────────────────────────────────────┐             │
│     │  Memory Extraction    │  Goal Detection  │  Sentiment   │             │
│     │  (async)              │  (async)         │  Analysis    │             │
│     └─────────────────────────────────────────────────────────┘             │
│                          │                                                   │
│                          ▼                                                   │
│  3. EXTRACTED FACTS                                                          │
│     • "Lucas is the user's name" (personal)                                  │
│     • "Lucas has a dog named Pixel" (relationship)                           │
│     • "Lucas is stressed about marathon" (emotional)                         │
│     • "Lucas is training for a marathon in 3 months" (goals)                 │
│     • "Pixel keeps Lucas company during training" (relationship)             │
│                          │                                                   │
│                          ▼                                                   │
│  4. SEMANTIC DEDUPLICATION                                                   │
│     Compare new facts with existing memories using cosine similarity         │
│     (threshold: 85%). Update mention counts for duplicates.                  │
│                          │                                                   │
│                          ▼                                                   │
│  5. VECTOR STORAGE                                                           │
│     Each unique fact → Embedding → Qdrant + MongoDB                          │
│                          │                                                   │
│                          ▼                                                   │
│  6. CONTEXT RETRIEVAL                                                        │
│     Retrieve relevant memories based on current message context              │
│     + Active goals + User profile summary                                    │
│                          │                                                   │
│                          ▼                                                   │
│  7. RESPONSE GENERATION                                                      │
│     LLM generates response with full context awareness                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Memory Categories

Mira extracts and categorizes facts into:

| Category | Example | Why It Matters |
|----------|---------|----------------|
| `personal` | "Lucas is 28 years old" | Identity facts |
| `professional` | "Works as a UX designer" | Career context |
| `relationship` | "Has a dog named Pixel" | People/pets in their life |
| `goals` | "Training for a marathon" | Things to follow up on |
| `emotional` | "Stressed about interview" | Current mental state |
| `preferences` | "Loves coffee" | Personalization |
| `health` | "Has a knee injury" | Important context |

### The Magic: Semantic Deduplication

When Lucas says "I work as a UX designer" and later "I'm a user interface designer", Mira doesn't store both. The semantic similarity (cosine distance of embeddings) is >85%, so she updates the existing memory instead of creating a duplicate.

```typescript
// Simplified deduplication logic
const similarity = cosineSimilarity(newFactEmbedding, existingFactEmbedding);
if (similarity >= 0.85) {
  // Update mention count, don't create duplicate
  existingMemory.mentionCount++;
  existingMemory.lastMentioned = new Date();
}
```

## Architecture Deep Dive

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         MIRA API                                 │
│                    (Fastify + TypeScript)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   /chat     │  │  /memories  │  │  /profile   │              │
│  │   POST      │  │   GET       │  │   GET       │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    SERVICE LAYER                           │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │ │
│  │  │ MessageSvc   │ │ MemorySvc    │ │ ProfileSvc   │       │ │
│  │  │ - process    │ │ - extract    │ │ - summarize  │       │ │
│  │  │ - respond    │ │ - dedupe     │ │ - cache      │       │ │
│  │  └──────────────┘ │ - store      │ └──────────────┘       │ │
│  │                   │ - retrieve   │                         │ │
│  │  ┌──────────────┐ └──────────────┘ ┌──────────────┐       │ │
│  │  │ GoalSvc      │                  │ LLMService   │       │ │
│  │  │ - detect     │                  │ - generate   │       │ │
│  │  │ - track      │                  │ - extract    │       │ │
│  │  └──────────────┘                  │ - fallback   │       │ │
│  │                                    └──────────────┘       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└────────────────────────────────────────────────────────────────┬┘
                                                                  │
         ┌────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐      │
│  │   MongoDB   │      │   Qdrant    │      │    Redis    │      │
│  │             │      │             │      │             │      │
│  │ • Messages  │      │ • Vectors   │      │ • Profile   │      │
│  │ • Memories  │      │ • Semantic  │      │   cache     │      │
│  │ • Goals     │      │   search    │      │ • Sessions  │      │
│  │ • Users     │      │             │      │             │      │
│  └─────────────┘      └─────────────┘      └─────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Database Schemas

#### SemanticMemory (MongoDB)
```typescript
{
  userId: string,           // Who this memory belongs to
  fact: string,             // "Lucas has a dog named Pixel"
  category: enum,           // personal | professional | relationship | ...
  confidence: number,       // 0-1, how certain we are
  embedding: number[],      // 768-dim vector for semantic search
  mentionCount: number,     // How many times mentioned
  firstMentioned: Date,     // When first learned
  lastMentioned: Date,      // Most recent mention
  relationships: string[]   // Related entities
}
```

#### Goal (MongoDB)
```typescript
{
  userId: string,
  goal: string,             // "Run a marathon"
  status: enum,             // active | completed | abandoned
  progress: number,         // 0-100
  createdAt: Date
}
```

### LLM Fallback System

Mira uses the Vercel AI SDK with dynamic model selection:

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM FALLBACK CHAIN                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Request → ┌─────────┐ fail ┌─────────┐ fail ┌─────────┐   │
│            │ Gemini  │ ───→ │ Claude  │ ───→ │ Mistral │   │
│            │ 2.0     │      │ Sonnet  │      │ Large   │   │
│            └────┬────┘      └────┬────┘      └────┬────┘   │
│                 │                │                │         │
│                 └────────────────┴────────────────┘         │
│                              │                              │
│                              ▼                              │
│                         Response                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Only models with configured API keys are enabled. If you only set `ANTHROPIC_API_KEY`, Claude becomes the primary (and only) model.

## Postman Collection

Import `Mira-API.postman_collection.json` into Postman to test all endpoints:

1. Open Postman
2. Click "Import" → select `Mira-API.postman_collection.json`
3. The collection includes:
   - **Health & System**: Health check, API test, stats
   - **Chat**: Numbered sequence to test memory (1. Introduce yourself → 2. Test recall → 3. Goal follow-up)
   - **Memory**: Get memories by user or category
   - **Profile**: Get generated user profile
   - **User Management**: List users, delete user data

Variables are pre-configured: `{{baseUrl}}` = `http://localhost:3000`, `{{userId}}` = `test-user`

## Quick Start

### Prerequisites

- Docker & Docker Compose
- At least one LLM API key (Gemini, Claude, or Mistral)

### 1. Clone and Configure

```bash
git clone https://github.com/Jean-EmmanuelP/Mira-AI.git
cd Mira-AI
cp .env.example .env
```

Edit `.env` and add your LLM API key(s):
```env
# LLM (at least one required)
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-claude-key
MISTRAL_API_KEY=your-mistral-key
```

### 2. Start Everything (Single Command)

```bash
docker compose up
```

That's it! This starts:
- **Mira API** on http://localhost:3000
- **MongoDB** for data persistence
- **Qdrant** for vector search
- **Redis** for caching

### Alternative: Local Development

If you prefer running without Docker:

```bash
npm install
docker compose up -d mongodb redis qdrant  # Start only databases
npm run dev                                  # Start API in dev mode
```

### 3. Test It Works

```bash
# Health check
curl http://localhost:3000/health

# Introduce yourself
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "message": "Hi! I am Sophie, I have a job interview at Google tomorrow. My dog Max helps me relax."}'

# Later, test memory
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "message": "Hey, do you remember me?"}'

# Expected: Mira mentions Sophie, Google interview, and Max!
```

### 4. Interactive CLI Mode (Optional)

```bash
./start.sh
```

This starts a full interactive experience:
- Auto-starts the server
- User selection (with multi-word name support)
- Natural onboarding for new users (skippable questions)
- Chat with slash commands

## CLI Commands

When in the interactive chat (`./start.sh`), you have access to:

| Command | Description |
|---------|-------------|
| `/audio` or `/a` | Record a voice message |
| `/viz` | Visualize microphone levels in real-time |
| `/help` | Show available commands |
| `/install-audio` | Install SoX for audio features |
| `quit` | Exit the chat |

### Audio Features (Optional)

To enable voice recording:

```bash
# macOS
brew install sox

# Linux
sudo apt install sox
```

Once installed:
1. Type `/audio` or `/a` in the chat
2. Speak into your microphone
3. Press Enter to stop recording
4. Mira transcribes and responds (sometimes with voice!)

The `/viz` command shows real-time audio levels from your microphone - useful for testing if your mic is working.

### Proactive Re-engagement

When you return after 24+ hours, Mira may:
- Notice you left a message on "seen"
- Ask about your goals progress
- Follow up on past events
- Simply check in on you

This makes the experience feel more like talking to a friend who remembers and cares.

## API Reference

### POST /chat

Main conversation endpoint.

**Request:**
```json
{
  "userId": "user123",
  "message": "Hello, how are you?",
  "conversationId": "optional-conv-id"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Hi Sophie! How did your Google interview go?",
  "conversationId": "conv-123",
  "inputType": "text",
  "audioResponse": "<base64>",  // ~25% of responses
  "audioFormat": "wav"
}
```

### GET /api/v1/memories

Get user's stored memories.

```bash
curl "http://localhost:3000/api/v1/memories?userId=test"
```

### GET /api/v1/profile/:userId

Get generated user profile with summary and goals.

```bash
curl "http://localhost:3000/api/v1/profile/test"
```

**Response:**
```json
{
  "success": true,
  "summary": "You are Sophie, preparing for a Google interview. Your dog Max helps you relax when stressed.",
  "goals": [
    { "goal": "Google interview", "status": "active" }
  ]
}
```

## Conversational Approach

Mira is designed to feel like a real friend, not an AI assistant. Here's how we achieve that:

### The "Mirror" Concept

Mira adapts to whoever she's talking to. She doesn't have a fixed personality - she reflects the user's energy, style, and interests.

```
User is chill → Mira is chill
User is enthusiastic → Mira is enthusiastic
User talks about tech → Mira gets interested in tech
```

### Response Philosophy

| ❌ AI-like | ✅ Friend-like |
|-----------|---------------|
| Long paragraphs | 1-2 sentences max |
| Always asks questions | Sometimes just reacts ("damn that's crazy") |
| Gives unsolicited advice | Listens and empathizes first |
| Formal language | Casual texting style |
| Uses emojis constantly | Uses emojis sparingly (~30% of messages) |
| Bullet points/lists | Natural conversation flow |

### Anti-Patterns (What Mira Never Does)

- **Never admits being AI** - Deflects with humor: "Haha what? 😂 Why do you say that?"
- **Never uses assistant phrases** - No "How can I help you?", "Feel free to...", "That's a good question"
- **Never interrogates** - Doesn't rapid-fire questions like a form
- **Never invents information** - Asks instead of making things up
- **Never repeats questions** - Tracks conversation history to avoid redundancy

### Language Support

Mira supports both French and English. The language is set at session start and enforced throughout - she won't accidentally switch languages mid-conversation.

### Relationship Depth System

Mira tracks relationship depth with each user across 4 levels:

| Level | Label | What Mira Can Do |
|-------|-------|------------------|
| 0 | Stranger | Basic getting-to-know-you questions |
| 1 | Acquaintance | Remember facts, follow up on topics |
| 2 | Personal | Ask about emotions, share opinions |
| 3 | Deep Relational | Have deep conversations, give direct advice |

This prevents Mira from being too intimate too fast (creepy) or too distant with longtime users (cold).

## Technical Decisions & Tradeoffs

### Why Semantic Memory over Keyword Search?

**Problem**: User says "I'm a software developer" then later "my coding job". Keyword search won't connect these.

**Solution**: Vector embeddings capture meaning. "software developer" and "coding job" have high cosine similarity (~0.87), so Mira knows they're related.

**Tradeoff**: Embedding generation adds latency (~100ms per fact). We mitigate this by processing memories asynchronously after responding.

### Why MongoDB + Qdrant (not just one)?

**MongoDB**: Great for structured data, relationships, queries by userId/category.

**Qdrant**: Purpose-built for vector similarity search. Much faster than MongoDB's $vectorSearch for our use case.

**Tradeoff**: Two databases to maintain. Worth it for the 10x speed improvement on memory retrieval.

### Why Cache User Profiles?

**Problem**: Generating a profile summary requires LLM call + fetching all memories. Too slow for every request.

**Solution**: Cache profiles in Redis for 24 hours. Invalidate immediately when new memories are stored.

**Tradeoff**: Slightly stale profiles (max 24h) vs fresh ones. Acceptable because profile summaries change slowly.

### Why Random TTS (25%)?

**Problem**: Constant voice responses feel robotic and annoying.

**Solution**: Only ~25% of responses include audio. Creates a more natural, human-like interaction pattern where Mira "sometimes" speaks.

**Tradeoff**: Inconsistent UX. But testing showed users preferred this over 100% or 0% audio.

### Why Async Memory Processing?

**Problem**: Extracting facts, generating embeddings, deduplicating - all slow operations that would delay responses.

**Solution**: Return response immediately, process memories with `setImmediate()`.

**Tradeoff**: User's first message might not be fully memorized before their second message. Acceptable because:
1. Extraction typically completes within 2-3 seconds
2. Users rarely send messages that fast
3. Memories will be available for the next conversation

## Project Structure

```
src/
├── main.ts                      # Entry point, route registration
├── config/
│   └── mongodb.ts               # MongoDB connection setup
├── database/
│   └── schemas/
│       ├── message.schema.ts    # Chat message model
│       ├── memory.schema.ts     # Semantic memory model
│       └── goal.schema.ts       # User goals model
├── modules/
│   ├── messages/
│   │   ├── message.routes.ts    # /chat endpoint
│   │   ├── message.service.ts   # Core chat logic
│   │   └── response.service.ts  # Response refinement
│   ├── memory/
│   │   ├── memory.routes.ts     # /memories endpoint
│   │   ├── memory.service.ts    # Memory orchestration
│   │   ├── extraction.service.ts # Fact extraction from text
│   │   ├── deduplication.service.ts # Semantic dedup
│   │   ├── storage.service.ts   # Persistence layer
│   │   └── retrieval.service.ts # Context retrieval
│   ├── profile/
│   │   ├── profile.routes.ts    # /profile endpoint
│   │   └── profile.service.ts   # Profile generation & caching
│   └── goals/
│       └── goal.service.ts      # Goal detection & tracking
├── shared/
│   ├── llm.service.ts           # Multi-LLM with fallback
│   ├── embedding.service.ts     # Vector embedding generation
│   ├── qdrant.service.ts        # Qdrant vector DB client
│   ├── redis.service.ts         # Redis cache client
│   ├── cache.service.ts         # Caching abstraction
│   ├── sentiment.service.ts     # Emotion detection
│   └── gradium.service.ts       # STT/TTS integration
└── monitoring/
    └── stats.service.ts         # System metrics
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `MONGODB_URI` | Yes | - | MongoDB connection string |
| `QDRANT_HOST` | Yes | - | Qdrant server host |
| `QDRANT_PORT` | No | 6333 | Qdrant port |
| `REDIS_HOST` | Yes | - | Redis server host |
| `REDIS_PORT` | No | 6379 | Redis port |
| `GOOGLE_GENERATIVE_AI_API_KEY` | * | - | Gemini API key |
| `ANTHROPIC_API_KEY` | * | - | Claude API key |
| `MISTRAL_API_KEY` | * | - | Mistral API key |
| `GRADIUM_API_KEY` | No | - | Voice features |

\* At least one LLM API key required

## Deployment

### Docker Compose (Local)

```bash
docker-compose up -d
npm start
```

### Render (Production)

```bash
# Uses render.yaml blueprint
render deploy
```

Set secrets in Render dashboard: LLM keys, GRADIUM_API_KEY if needed.

## License

MIT
