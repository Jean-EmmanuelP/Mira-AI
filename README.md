# Mira - AI Companion That Remembers You

**She remembers your dog's name. She asks about your job interview. She notices when you're stressed.**

## Quick Start

```bash
git clone https://github.com/Jean-EmmanuelP/Mira-AI.git
cd Mira-AI
cp .env.example .env   # Add at least one LLM API key
./start.sh
```

This starts all services with logs visible in your terminal:
- **Mira API** on `http://localhost:3000`
- **MongoDB** for data storage
- **Redis** for caching
- **Qdrant** for vector search (semantic memory)

Press `Ctrl+C` to stop all services.

## Test the API with Postman

Import the included Postman collection to test all endpoints:

**`Mira-API.postman_collection.json`**

The collection includes:
- **Health & System** - Health check, API test, system stats
- **Chat** - Send messages, test memory recall, language support (EN/FR)
- **Memory** - View stored memories by user/category
- **Profile** - Get AI-generated user summaries
- **User Management** - List users, delete user data
- **Messages API** - Greetings, full chat endpoint, conversation history

### Quick Test with curl

```bash
# 1. Introduce yourself
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"Hi! I am Sophie, I have a job interview at Google tomorrow. My dog Max helps me relax."}'

# 2. Test recall
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"Hey, do you remember me?"}'

# Expected: Mira mentions Sophie, Google interview, and Max!
```

---

## How It Works

### Memory Pipeline

```
User Message → Fact Extraction → Semantic Dedup → Vector Storage → Context Retrieval → Response
                    ↓                  ↓                ↓
              "Sophie has          Cosine sim       Qdrant +
               dog Max"            > 85% ?          MongoDB
```

**Key insight:** When user says "I'm a software developer" then later "my coding job", keyword search fails. Vector embeddings capture meaning - these have ~0.87 similarity, so Mira knows they're related.

### Making It Feel Human

The hardest part isn't memory - it's **not sounding like a bot**.

**Problem:** LLMs default to assistant mode. They give advice, ask too many questions, use formal language, and produce long responses.

**Solution:** Multi-layer humanity system:

| Layer | What It Does |
|-------|-------------|
| **Personality Prompts** | Strict rules: 1-2 sentences max, no lists, no unsolicited advice, emojis ~30% |
| **Humanity Score** | Scores responses 0-100 on lexical diversity, structure, formality. Rejects < 50 |
| **Robot Detector** | Catches AI phrases ("I understand", "Feel free to", "That's a great question") |
| **Context Validator** | Ensures response uses actual memories, not hallucinations |
| **Relationship Depth** | 4 levels (stranger→deep). Prevents being too intimate too fast |

**DialoGPT influence:** We analyzed DialoGPT's conversational patterns to inform our prompts - short responses, natural reactions ("damn that's crazy"), not always ending with questions.

### The "Mirror" Concept

Mira doesn't have a fixed personality. She adapts:
- User is chill → Mira is chill
- User is stressed → Mira is supportive
- User talks tech → Mira gets interested in tech

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     POST /chat                            │
├──────────────────────────────────────────────────────────┤
│  MessageService                                           │
│  ├── Retrieve memories (Qdrant semantic search)          │
│  ├── Build context (profile + goals + history)           │
│  ├── Generate response (LLM with fallback)               │
│  ├── Validate humanity (score + robot detection)         │
│  └── Extract & store new memories (async)                │
├──────────────────────────────────────────────────────────┤
│  LLM Fallback: Gemini → Claude → DeepSeek → Mistral      │
├──────────────────────────────────────────────────────────┤
│  MongoDB (messages, memories, goals)                      │
│  Qdrant (vector search)                                   │
│  Redis (profile cache)                                    │
└──────────────────────────────────────────────────────────┘
```

---

## Key Tradeoffs

| Decision | Why | Tradeoff |
|----------|-----|----------|
| **Qdrant + MongoDB** | Vector search needs dedicated DB. 10x faster than MongoDB $vectorSearch | Two DBs to maintain |
| **Async memory extraction** | Don't block response for slow embedding generation | First message might not be memorized before second |
| **Multi-layer validation** | Each layer catches different bot patterns | Adds ~200ms latency |
| **4 LLM fallback** | High availability, cost optimization | Slightly different response styles |

---

## API

### POST /chat
```json
// Request
{"userId": "user123", "message": "Hi!"}

// Response
{"success": true, "response": "Hey! What's up?", "conversationId": "..."}
```

### GET /api/v1/memories?userId=xxx
Returns stored facts about the user.

### GET /api/v1/profile/:userId
Returns AI-generated summary of who the user is.

---

## Environment Variables

```env
# LLM (at least one required)
GOOGLE_GENERATIVE_AI_API_KEY=
ANTHROPIC_API_KEY=
MISTRAL_API_KEY=
DEEPSEEK_API_KEY=

# Databases (auto-configured with docker compose)
MONGODB_URI=mongodb://localhost:27017/mira
QDRANT_HOST=localhost
REDIS_HOST=localhost
```

See `.env.example` for all options.

---

## What Makes Mira Different

1. **Semantic memory** - Understands meaning, not keywords
2. **Time awareness** - Knows what time it is and adapts greetings ("Tu dors pas ?" at 2am)
3. **Proactive reminders** - Detects events and follows up ("How did your Google interview go?")
4. **Goal tracking** - Proactively follows up on goals weeks later
5. **Humanity checks** - Multiple layers ensure natural responses
6. **Relationship depth** - Adapts intimacy over time
7. **Mirror personality** - Reflects user's energy and style

The goal: **make users forget they're talking to an AI**.

---

## Proactive Reminders

When you mention an event with a date, Mira automatically schedules reminders:

```bash
# User says:
"J'ai un entretien chez Google demain matin"

# Mira creates:
# 1. BEFORE reminder (evening before): "Bonne chance pour demain !"
# 2. AFTER reminder (next evening): "Alors, ça s'est passé comment chez Google ?"
```

### API

```bash
# Get due notifications
GET /api/v1/reminders/notifications?userId=xxx

# Get upcoming reminders
GET /api/v1/reminders/upcoming?userId=xxx

# Mark as sent
POST /api/v1/reminders/notifications/:id/sent

# Snooze (delay 2 hours)
POST /api/v1/reminders/notifications/:id/snooze
```
