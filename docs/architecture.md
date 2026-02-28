# LLM Life Simulator — Research & Architecture Notes

## Existing Work / Prior Art

### Stanford "Generative Agents" / Smallville (2023) — The Foundation
- 25 LLM-powered agents in a Sims-inspired sandbox town
- Each agent initialized with a single paragraph of natural language describing identity, occupation, relationships
- Agents autonomously plan days, form relationships, spread information, coordinate group activities (e.g., Valentine's Day party emerged from a single seed intent)
- Built on ChatGPT (gpt-3.5-turbo), open source on GitHub
- Paper: https://arxiv.org/abs/2304.03442
- Repo: https://github.com/joonspk-research/generative_agents

### AI Town (a16z) — Best Starting Point to Fork
- JS/TS reimplementation inspired by Stanford paper, designed to be extended
- Supports Ollama for local LLM inference out of the box
- Built on Convex for backend state management
- Repo: https://github.com/a16z-infra/ai-town

### AgentSociety (Tsinghua, 2024)
- Large-scale simulation with agents that have profiles, mental states, economic status, social relationships
- Three levels of mental processes: emotions, needs, cognition
- Built distributed engine using Ray framework for horizontal scaling
- Paper: https://arxiv.org/html/2502.08691v1

### Needs-Driven Personality Emergence (Univ. of Electro-Communications, 2025)
- Modeled agent choices on Maslow's hierarchy instead of preset personality traits
- Distinct personalities emerged naturally through interaction without predefined roles
- Key insight: needs-driven decision-making produces more diverse, human-like behavior than role assignment

### Spontaneous Individuality Research (PMC, 2024)
- Agents starting with nearly identical personalities developed distinct types through group interactions
- Measured via MBTI assessments — differentiation was measurable and consistent
- Agents spontaneously generated hashtags and hallucinations to sustain communication diversity

---

## Stanford Paper — Key Architecture Details

### Memory Stream
- Comprehensive record of all agent experiences stored as natural language descriptions
- Each memory object: natural language description + creation timestamp + last access timestamp
- Basic unit is an "observation" — events directly perceived by the agent

### Memory Retrieval (Three-Factor Scoring)
- **Recency**: Exponential decay (factor 0.995) over game hours since last retrieval
- **Importance**: LLM-rated 1-10 at creation time (brushing teeth = ~2, asking crush on date = ~8)
- **Relevance**: Cosine similarity between memory embedding and query embedding
- Final score: weighted combination, all weights = 1, top-ranked memories fed to LLM context

### Reflections
- Higher-level abstract thoughts synthesized from observations
- Triggered when sum of importance scores for recent events exceeds threshold (150)
- In practice: ~2-3 reflections per agent per game day
- Process: query LLM with 100 most recent memories → generate salient questions → retrieve relevant memories per question → extract insights with cited evidence
- Reflections stored back into memory stream alongside observations
- Recursive: reflections can reflect on other reflections → tree structure (leaves = observations, higher nodes = increasingly abstract thoughts)

### Planning
- Top-down recursive decomposition: day plan → hour chunks → 5-15 minute chunks
- Plans stored in memory stream, included in retrieval alongside observations and reflections
- At each timestep: agent perceives environment → decides whether to continue plan or react
- Reacting: when observation warrants response, regenerate plan from that point forward

### Dialogue Generation
- Conditioned on each agent's summarized memories about the other agent
- Context retrieved via queries like "What is [observer]'s relationship with [observed]?"
- Each utterance generated with full dialogue history + relevant memory context

### Environment Representation
- Tree data structure: world → areas → subareas → objects
- Converted to natural language for LLM prompts
- Agents maintain individual subgraphs (not omniscient — only know areas they've visited)
- Location selection: recursive traversal prompting LLM at each level

---

## Stanford Paper — Known Weaknesses (Opportunities for Us)

### Agents are too cooperative / too formal
- Attributed to instruction tuning in underlying LLM
- Isabella says yes to every party suggestion regardless of her character
- No mechanism for agents to push back based on identity or preferences
- **Root cause**: No internal tension system — nothing creates resistance to social pressure

### Memory retrieval failures
- Agents sometimes fail to retrieve relevant memories
- Incomplete fragments: knows what to do at a party but not that the party exists
- Hallucinated embellishments: adding details that never happened (e.g., "he's making an announcement tomorrow")

### Location/norm confusion
- Agents enter closed stores, crowd into single-occupancy bathrooms
- Physical/social norms don't transfer well through natural language alone
- Agents started going to the bar for lunch after learning about it

### Cost and performance
- Hundreds of LLM API calls per game hour for 25 agents
- Thousands of dollars in token costs for 2 game days
- Multiple real days to complete the simulation

---

## Architecture Design — Psyche System

### Core Principle: LLM Proposes, Psyche Disposes
- LLM generates menus of possible actions/responses (the creative/generative step)
- Deterministic psyche system evaluates and selects from options (the control step)
- No free-form LLM output directly controls behavior
- Solves both the "going off the rails" problem and the "too cooperative" problem

### Three Interacting Psyche Subsystems

#### 1. Needs (Numeric, Depleting/Replenishing, Data-Driven)
- Based on Maslow's hierarchy as the starting set, but **needs are a generic type, not an enumerated list**
- Each need is defined as: `{name, currentValue, maxValue, depletionRate, priorityWeight}`
- Maslow's five (physiological, safety, social belonging, esteem, self-actualization) are just the initial entries
- Future world systems add new needs by registering new entries (e.g., "financial security" when economy is added)
- The psyche's scoring logic never changes — it just iterates over whatever needs exist
- Deplete over time or through events, replenish through actions
- Create urgency that biases decision-making
- Example: critically low social belonging → prioritize relationships over productivity even if plan says work

#### 2. Wants & Fears (Emergent, Contextual)
- Develop over time from experiences and reflections
- Unlike needs, these are specific: "I want to impress Maria", "I fear being seen as incompetent"
- Generated by LLM during reflection periods but stored as structured data:
  - Target (person/thing/state)
  - Intensity (numeric)
  - Source memories (pointers)
- Influence action selection by adding weight to relevant choices

#### 3. Moral Compass (Weighted Values)
- Set of weighted values: honesty, loyalty, self-interest, fairness, tradition, authority, care, etc.
- Acts as a filter/scorer on possible actions
- Each character has different weights → different moral profiles
- High loyalty + low self-interest = covers for friend at personal cost
- Gap between societal rules and personal morals = where interesting behavior emerges

#### 4. Relationship Graph (Structured, Numeric)
- Directed, weighted social graph between all known agents
- Each edge tracks: trust, affinity, communication frequency, familiarity
- Updated deterministically after interactions (positive interaction → trust++, betrayal → trust--)
- Gives the psyche concrete data to score against — "I need social belonging, this person has high trust, I'll seek them out"
- Replaces Stanford's fuzzy approach of hoping the LLM retrieves the right relationship memories
- Feeds into dialogue generation as context alongside memory retrieval

#### 5. Opinion Tracking (Lightweight, Per-Topic)
- Simple numeric attitude per topic (0-10 scale, supportive ↔ opposed)
- Updated deterministically when relevant events/conversations occur
- "How do I feel about the mayor" is a number lookup, not a reflection cycle
- Feeds into dialogue generation and decision-making as part of agent state
- Topics are a registry — new topics get created as agents encounter them

#### 6. Emotional Contagion
- Russell's circumplex model: each agent has continuous `{ valence: -1..1, arousal: -1..1 }`
  - Valence: miserable (-1) ↔ joyful (+1)
  - Arousal: lethargic (-1) ↔ agitated (+1)
- Per-character **emotional baseline** they decay toward (not zero — personality-driven resting state)
- Per-character **traits**: receptivity (0..1, how susceptible to contagion) and charisma (0..1, how strongly emotions radiate)
- **Emotion sources**: actions set baseline shifts (eating → valence +0.2), conversations set stronger shifts from outcomes
- **Contagion**: nearby agents' emotions transfer, weighted by proximity × relationship closeness × receptivity × charisma
  - Transfer formula pulls receiver toward sender's state: `delta = (sender - receiver) × transferStrength`
  - Runs in agentDoSomething alongside need depletion — no separate tick loop needed
- **Decay**: exponential toward baseline with half-life (valence ~120 game-min, arousal ~60 game-min)
  - `current = baseline + (current - baseline) × 2^(-elapsed / halfLife)`
- **Label mapping**: 10 anchor points on circumplex (excited, happy, content, calm, bored, sad, stressed, angry, afraid, neutral) — nearest-neighbor lookup for prompt injection and UI
- **Prompt injection**: emotional state injected into conversation prompts ("You're feeling stressed and on edge")
- Creates emergent crowd dynamics (fear spreads, excitement spreads) without LLM involvement
- Purely deterministic — no LLM calls needed
- Scorer effects (impulsivity from high arousal, withdrawal from low valence) deferred to Phase 4

### Internal Conflict & Resolution

#### Priority Cascade (Deterministic Resolution)
1. **Needs with urgency weighting** — critical needs override everything (starving > all other concerns)
2. **Morals as vetoes/penalties** — moral compass applies hard vetoes (won't do it) or soft penalties (score reduction) to options
3. **Wants/fears as tiebreakers** — when multiple options score similarly after needs + morals, wants and fears differentiate
4. **Relationship and opinion modifiers** — context from relationship graph and opinion tracking adjust final scores

#### Visible Conflict
- When the top-scoring option still carries a moral penalty above a configurable threshold → internal conflict is flagged
- Manifestations:
  - Hesitation (longer decision time, visible to observer)
  - Regret (doing one thing but expressing discomfort after)
  - Dialogue that reveals the conflict ("I shouldn't have done that")
  - Changed behavior over time as conflicts accumulate or resolve
- This is the differentiator — no existing project models internal conflict well

### Memory System — Full Design

The memory system is the connective tissue between the LLM domain (unstructured text, creativity, context-sensitivity) and the psyche domain (numbers, graphs, registries, determinism). Memory is where unstructured LLM output gets crystallized into structured psyche state, and where structured psyche state gets contextualized back into LLM prompts.

#### Memory Creation Pathways

Four pathways create memories. Only the first exists today; the others are planned.

**1. Conversation Memories (EXISTS)**
- Created when conversations end via `rememberConversation` in `convex/agent/memory.ts`
- LLM summarizes conversation from agent's first-person perspective + rates importance (0-9)
- Text embedded for vector search retrieval
- Stored as type `'conversation'` with participant IDs

**2. Action Log + Selective Action Memories (PLANNED)**

Two-tier approach — cheap tracking for all actions, expensive memories only for notable ones.

*Action Log* (lightweight, no LLM cost):
- Every completed action writes a row: `{ agentId, actionId, timestamp, location, needsBefore, needsAfter }`
- Used by the habit formation system to detect repetition patterns
- Not part of the memory stream — pure structured data, cheap to store and query

*Selective Action Memories* (LLM-scored, only notable actions):
- Created only when the action meets a novelty threshold:
  - First time performing this action
  - Action taken during internal conflict (moral penalty flagged)
  - Action that broke a habit (overrode a cached routine)
  - Action taken at critical need level (desperate behavior)
  - Action involving a commitment (honored or broken)
- For qualifying actions, LLM summarizes from first-person perspective and rates importance + emotional weight
- Stored in memory stream alongside conversation memories
- Example: "I skipped Maya's party because I was starving" (high importance, high emotion) gets a full memory. Mundane "ate at cafe" gets only an action log entry — no LLM cost.

**3. Commitment Memories (PLANNED)**
- Created at three lifecycle points:
  - When a commitment is made: "I promised Maya I'd come to her party" (importance ~5)
  - When a commitment is honored: "I went to Maya's party as promised" (importance ~4)
  - When a commitment is broken: "I skipped Maya's party despite promising to go" (importance ~8, high emotion)
- Breaking a commitment triggers: relationship penalty + moral penalty + high-importance memory → ensures the agent "remembers" the betrayal and it influences future decisions via retrieval

**4. Observation/Event Memories (FUTURE — not yet designed)**
- Created when something notable happens in the agent's perception that they didn't participate in
- World events: "the cafe closed early today", "heard loud music from the park"
- Social observations: "saw Maya arguing with someone at the park" (not a conversation the agent joined)
- Requires a perception/awareness system that doesn't exist yet
- Design principle: agents are not omniscient — they only observe events within their proximity radius

#### Four-Factor Retrieval

The current memory retrieval system uses three-factor scoring (in `convex/agent/memory.ts`, `rankAndTouchMemories`): relevance (embedding cosine similarity) + importance (LLM-rated 0-9) + recency (exponential decay). We add a fourth factor: **emotional weight**.

- Each memory gets an emotional intensity score (0-1) at creation time, alongside importance
- Strong emotions (anger, joy, fear, surprise) get higher weight; neutral events get low weight
- The combined retrieval score: `normalize(relevance) + normalize(importance) + normalize(recency) + normalize(emotionalWeight)` — equally weighted initially, tunable
- Emotional weight is assigned by the same LLM call that assigns importance (modify `calculateImportance` to also return an emotional intensity rating)
- Memories with high emotional weight surface even when they have moderate relevance — this mirrors how humans recall traumatic or joyful events more readily than mundane ones

#### Memory-to-Action-Menu Data Flow

When the action menu LLM call is prepared (see Action Menu System section), memory retrieval runs first:

1. Build a query embedding from the agent's current situation (location, nearby agents, time of day, current needs summary)
2. Run four-factor retrieval to get top 5-8 memories
3. Inject retrieved memories + active commitments into the action menu prompt
4. The LLM uses this context to curate the action shortlist — e.g., if memories include "I always feel better after exercising when stressed," the LLM is more likely to include `exercise_at_park` in the shortlist when the agent is stressed

This is the primary pathway through which past experience influences present decisions, without the psyche needing to understand natural language.

#### Reflection-to-Psyche Extraction Pipeline

The current reflection system (`reflectOnMemories` in `memory.ts`) generates unstructured insights as natural language strings (e.g., "Maya doesn't seem to respect my feelings"). These insights are stored as reflection memories but don't yet feed structured data into the psyche subsystems.

**Enhancement:** After the existing reflection LLM call, add a second structured extraction call. This call receives the reflection insights and returns structured data:

```
Given this reflection insight:
  "Maya doesn't seem to respect my feelings — she interrupted me twice
   and dismissed my idea at the cafe."

Extract structured psyche updates (JSON):
{
  "wants": [{ "target": "earn_respect_from_Maya", "intensity": 0.4 }],
  "fears": [{ "target": "public_embarrassment", "intensity": 0.6 }],
  "opinionDeltas": [{ "topic": "Maya", "delta": -2 }]
}
```

These structured outputs feed directly into the psyche subsystems:
- **Wants/Fears** are inserted into the desires table (subsystem #2)
- **Opinion deltas** are applied via the opinion tracking system (subsystem #5)
- The extraction step uses constrained JSON output to avoid parsing failures

This is how wants and fears **emerge from lived experience** rather than being preset at character creation. The LLM generates the insight; the extraction step converts it into psyche data that influences future scoring.

#### Habit Formation

Routine behaviors that repeat consistently should bypass the LLM entirely. This is the primary mechanism for making large agent counts feasible on local hardware.

**Tracking:** Every completed action is recorded in the action log (see Memory Creation Pathways). The habit system scans this log for repetition patterns.

**Context hashing:** Each action occurrence is tagged with a context hash capturing: time-of-day bucket (morning/afternoon/evening/night) + location + approximate need state (which needs are low). This groups similar situations together.

**Promotion:** After N repetitions (configurable, default N=5) of the same action in the same context hash, the action is promoted to a habit:
```typescript
{
  agentId: string;
  actionId: string;
  contextHash: string;
  strength: number;      // 0..1, increases with reinforcement
  createdAt: number;
}
```

**Execution:** When an agent's current context matches a habit's `contextHash` and habit strength is above threshold, the habit fires directly — no LLM call, no scorer evaluation.

**Override conditions:**
- A need reaches critical threshold that the habit does NOT address
- A novel situation is detected (new agent nearby with no relationship, world event, active commitment conflict)
- Habit strength decays slowly if not reinforced; below 0.2 it is removed

**Example:** Alex eats at the cafe every morning for 5 consecutive days. On day 6, when the morning time bucket arrives and Alex is near the cafe, `eat_at_cafe` fires directly. No LLM is called, no scorer runs. But if Alex's energy is critically low (a novel critical need the habit doesn't address), the habit is overridden and the full pipeline runs.

#### Memory Consolidation

Over time the memory stream grows unbounded. Consolidation compresses related mundane memories while preserving novel ones.

**Process:** Periodically (every N game-hours, or during reflection), scan for clusters of similar low-importance memories:
- Similarity determined by embedding cosine distance — memories within a threshold are candidates
- Consolidation creates one summary memory; originals are archived (excluded from retrieval, not deleted)
- The summary inherits the highest importance and emotional weight from its source memories, plus the combined source memory IDs
- Novel or high-emotional-weight memories are never consolidated — they are preserved intact

**Example:**
```
Before consolidation:
  "Ate at cafe Monday morning"     (importance: 2, emotion: 0.1)
  "Ate at cafe Tuesday morning"    (importance: 2, emotion: 0.1)
  "Ate at cafe Wednesday morning"  (importance: 2, emotion: 0.1)
  "Barista recommended a new blend on Wednesday" (importance: 4, emotion: 0.5)
  "Ate at cafe Thursday morning"   (importance: 2, emotion: 0.1)

After consolidation:
  "I eat at the cafe most mornings — it's become routine"  (importance: 2, emotion: 0.1)
  "Barista recommended a new blend on Wednesday"           (preserved — novel + higher emotion)
```

The mundane gets compressed. The novel survives. This keeps the retrieval pool manageable for prompt construction and mirrors how human memory works.

---

## Societal Rules System

### Rule Types by Enforcement Level
- **Hard environmental constraints**: "stores close at 5pm" — physically enforced, cannot be violated
- **Social norms**: "don't enter occupied bathrooms" — violatable with social consequences
- **Cultural expectations**: "be polite to strangers" — personality-dependent adherence
- **Laws**: "don't steal" — violatable with risk of punishment proportional to enforcement

### Generic Constraint Format
- All rules follow the same shape: `{blocks: action, condition: expression, enforcement: level, penalty: effect}`
- Examples:
  - `{blocks: "enter_store", condition: "time > 17:00", enforcement: "hard"}`
  - `{blocks: "sell_action", condition: "agent.permit == false", enforcement: "law", penalty: "fine"}`
  - `{blocks: "enter_bathroom", condition: "bathroom.occupied == true", enforcement: "social_norm", penalty: "reputation_loss"}`
- Future world systems (economy, law, class) just add new constraint entries — engine doesn't change

### World Generation
- Worlds generated based on defined societal rule changes (with safeguards)
- Rules exist as external constraints; moral compass determines how much each character respects them
- Safeguards needed: prevent generating rule sets that produce degenerate or harmful simulations

---

## Scalability & Extensibility Architecture

### Core Principle: Everything is a Typed Entry in a Registry, the Engine is Generic

The decision engine and psyche system should never know about specific world systems (money, jobs, class). They operate on abstract types. New systems expand the world by adding data, not rewriting logic.

### Agent State as a Single Abstract Object
- All psyche subsystems (needs, morals, wants, fears, relationships, opinions) plus any future systems (wealth, occupation, social class) live as properties on a single agent state object
- The scoring function iterates over the full state generically
- Adding a job system = adding new properties to agent state, not modifying the scorer

### Actions Declare Their Own Effects as Metadata
- Each available action carries a declaration of what state it affects:
  ```
  {
    name: "eat_at_cafe",
    replenishes: [{need: "hunger", amount: 30}],
    costs: [{resource: "money", amount: 5}],
    requires: [{location: "cafe"}, {condition: "cafe.open == true"}],
    social: [{affects_relationship: "cafe_owner", delta: +1}]
  }
  ```
- The engine reads metadata generically — it doesn't need to understand what "money" is, just that this action costs a resource the agent has and replenishes a need they're low on
- Future systems just introduce new effect types and resource types

### Needs, Resources, and Modifiers are All Registries
- **Needs registry**: starts with Maslow's five, expandable (e.g., "financial_security" when economy is added)
- **Resource registry**: starts empty, expandable (e.g., "money", "food", "building_materials")
- **Modifier registry**: things that adjust scoring weights (e.g., social class could multiply reputation effects)
- **Action registry**: all available actions with their metadata
- **Rule registry**: all societal constraints in generic format

### How Future Systems Plug In (Not Designed Yet, Just Interface Points)
- **Economy**: adds "money" to resource registry, "financial_security" to needs, cost/income effects to actions, economic constraints to rules
- **Jobs**: adds occupation as an agent state property, recurring action sources with associated effects, role-based available actions
- **Class/Status**: adds modifiers to how other agents perceive you, adjusts what actions are available, influences relationship graph initial weights

---

## LLM Usage Optimization

### When to Call the LLM
- **Yes**: Generating menu of possible actions, reflection/insight synthesis, dialogue generation, novel situation response
- **No**: Routine/habitual behaviors, movement/pathfinding, need depletion math, action selection from generated options (psyche handles this deterministically)

### Batching & Caching
- Routine behaviors become cached habit patterns after repetition
- LLM only invoked on novelty: new social encounter, unexpected event, need reaching critical threshold
- Batch reflection calls — process multiple agents' reflections together where possible

### Choice Architecture
- No direct text boxes to prompt (user observes, doesn't direct)
- Limited choices generated by LLM, filtered and scored by psyche system
- Choices can include: actions, dialogue options, internal reactions, plan modifications

---

## Action Menu System

The action menu is the bridge between the LLM (creative/generative) and the psyche (deterministic/evaluative). The LLM generates a curated shortlist of contextually relevant actions; the psyche scorer makes the final decision. This preserves the "LLM Proposes, Psyche Disposes" principle while giving the LLM the ability to filter out nonsensical options and surface context-sensitive ones.

### Registry Action Curation

The action registry (`src/psyche/data/actions.ts`) is serialized into the LLM prompt as structured data. The LLM's job is to curate a shortlist of 3-5 actions from the full registry based on the agent's personality, memories, and current context. The psyche scorer then re-scores only the shortlisted actions through the full pipeline (needs → morals → desires → relationships).

**What the LLM receives:**
1. Serialized action registry — action ID, name, description, location requirement, effects summary
2. Agent personality and identity
3. Retrieved memories (via 4-factor scoring — see Memory System)
4. Current needs snapshot
5. Active commitments

**Example prompt:**
```
You are Alex, a curious and practical person who values routine but enjoys surprises.

Your current state:
  Hunger: 12/100 (CRITICAL)
  Energy: 45/100
  Social: 60/100
  Location: home
  Time: Friday 4:00pm

Active commitments:
  - Attend Maya's party (tonight 7pm, promised yesterday)

Recent memories:
  - "Maya invited me to her party tonight" (yesterday)
  - "Last time I cooked, I burned the pasta and felt embarrassed" (3 days ago)
  - "Had a great conversation with Maya at the cafe" (2 days ago)

Available actions:
  [cook_at_home] Cook a meal — replenishes hunger (+35), costs energy (-10). Requires: home
  [sleep_at_home] Sleep — replenishes energy (+60), comfort (+20). Requires: home
  [nap] Take a nap — replenishes energy (+25). Requires: home
  [play_game] Play a game — replenishes fun (+30), costs energy (-5). Requires: home
  [eat_at_cafe] Eat at cafe — replenishes hunger (+40), costs energy (-5). Requires: cafe
  [socialize_at_cafe] Chat at cafe — replenishes social (+30), fun (+10). Requires: cafe
  [exercise_at_park] Exercise — replenishes fun (+20), costs energy (-15). Requires: park
  [chat_with_nearby] Chat with someone — replenishes social (+25). Anywhere
  [wander] Wander around — replenishes fun (+5). Anywhere

Select 3-4 actions Alex would realistically consider right now, given his
personality, memories, and current state. Return JSON array of action IDs.
```

**What the LLM returns:** `["eat_at_cafe", "cook_at_home", "nap"]`

Note that the LLM excluded `cook_at_home` or ranked it lower because of the embarrassing cooking memory — this is contextual filtering the psyche can't do. The psyche then re-scores these three options using its full pipeline and selects the winner.

**Graceful fallback:** If the LLM is unavailable or too slow, the scorer runs on the full action set, exactly as it does today. The LLM adds quality but is never required for the system to function.

### Conversation Response Options

During conversations, agents sometimes face socially-meaningful proposals (invitations, requests, questions that require a stance). In these moments, the LLM generates 3-4 structured response options instead of free-form dialogue. Each option carries typed effects that the psyche can evaluate.

**Response option type:**
```typescript
{
  id: string;
  type: 'accept' | 'decline' | 'counter' | 'deflect';
  text: string;               // What the agent actually says
  effects: {
    relationship: InteractionOutcome;    // positive_social, negative_social, neutral, etc.
    needs: ActionEffect[];               // [{needId: 'social', amount: 20}]
    commitment?: CommitmentDef;          // If this response creates a social agreement
    moralCosts?: MoralTag[];             // If this response has moral implications
  }
}
```

**Example — Maya invites Alex to a party:**

| Option | Type | Text | Effects |
|--------|------|------|---------|
| `accept` | accept | "That sounds fun, I'll be there!" | positive_social, social +20, energy -5, creates commitment |
| `decline_soft` | decline | "I appreciate the invite, but I'm pretty tired." | neutral, no need change |
| `counter` | counter | "How about just a quiet dinner instead?" | positive_social, social +15, energy -2 |
| `deflect` | deflect | "Maybe, let me see how I feel tomorrow." | neutral, no commitment |

**Psyche scoring of these options:**
- If Alex has **low social need** and **high trust/affinity** with Maya → `accept` wins
- If Alex has **low energy** and **low trust** with Maya → `decline_soft` or `deflect` wins
- If Alex's **moral compass** has high `care` and Maya has expressed loneliness recently → `accept` gets a boost even with low energy (the care value penalizes declining when someone is vulnerable)
- If Alex has a **fear of social rejection** (from prior reflections) → `deflect` gets a small boost

The winning option's `text` is spoken in the conversation, and its `effects` are applied deterministically.

### Ephemeral Actions

Certain conversation outcomes or world events create temporary actions that didn't exist in the registry. These are identical in shape to registry actions but have an additional `expiresAt` field (game-time). They slot directly into the existing scoring pipeline — the scorer doesn't know or care whether an action is permanent or ephemeral.

**Example — after accepting Maya's party invite:**
```typescript
{
  id: 'attend_maya_party_001',
  name: "Attend Maya's Party",
  description: "Going to Maya's evening party as promised",
  emoji: '🎉',
  locationRequirement: 'cafe',       // wherever the party is held
  duration: 60,
  expiresAt: partyTime + 120,        // gone 2 hours after party starts
  replenishes: [
    { needId: 'social', amount: 40 },
    { needId: 'fun', amount: 25 }
  ],
  costs: [
    { needId: 'energy', amount: 20 },
    { needId: 'hunger', amount: 10 }
  ],
  socialWeights: { affinity: 0.4, trust: 0.3, frequency: 0.3 },
}
```

Expired ephemeral actions are automatically pruned. The engine never needs modification — ephemeral actions declare their own effects as metadata, following the extensibility rule.

### Commitments

When an agent accepts a social agreement (party invite, promise to help, meeting arrangement), a commitment is created. Commitments are future-dated entries that persist across ticks and create social pressure to follow through.

**Commitment type:**
```typescript
{
  id: string;
  actionId: string;               // the ephemeral action to perform
  targetTime: number;              // when the commitment should be honored
  expiresAt: number;               // deadline after which commitment lapses
  createdFrom: 'conversation' | 'reflection' | 'world_event';
  otherAgentId?: string;           // who the commitment is with
  breakCost: {
    relationship: InteractionOutcome;    // e.g., 'betrayal' or 'negative_social'
    moralPenalty?: MoralTag[];           // e.g., [{value: 'loyalty', severity: 0.6}]
  }
}
```

**How commitments affect scoring:**
- When the committed time arrives, the commitment's associated action competes in the scoring pipeline normally
- The `breakCost` is applied as a penalty on all *alternative* actions — effectively, the cost of NOT doing the committed action pushes all other options down
- Breaking a commitment is possible when critical needs override (e.g., a starving agent skips the party), but carries the defined relationship and moral penalties
- Internal conflict is flagged when an agent considers breaking a commitment with high `breakCost`

**Design note:** Commitments extend the existing intent system in `convex/aiTown/agentOperations.ts`. The current `agentIntent` table stores a single pending action with a target location. Commitments are future-dated intents with break costs. When the time arrives, the commitment is loaded into the intent slot and competes normally through the psyche pipeline.

---

## Complete Agent Decision Lifecycle

This section traces the full lifecycle of a single agent decision, from perception through execution to memory formation. Every subsystem participates.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT TICK CYCLE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. PERCEPTION                                                  │
│     ├── Current needs (depleted since last tick)                │
│     ├── Current location + nearby agents                        │
│     ├── Active commitments                                      │
│     └── World state (time of day, events)                       │
│              │                                                   │
│  2. HABIT CHECK                                                  │
│     ├── Context hash matches a habit? ──YES──▶ Execute habit    │
│     │   (skip steps 3-5)                      (go to step 6)   │
│     └── NO ↓                                                    │
│                                                                 │
│  3. MEMORY RETRIEVAL (4-factor)                                 │
│     ├── Build query from current situation                      │
│     ├── Score: recency + importance + relevance + emotion       │
│     └── Return top-N memories + active commitments              │
│              │                                                   │
│  4. LLM ACTION MENU GENERATION                                  │
│     ├── Input: action registry + memories + personality +       │
│     │         needs snapshot + commitments                      │
│     ├── Output: shortlist of 3-5 actions with rationale         │
│     └── Fallback: if LLM unavailable, use full registry        │
│              │                                                   │
│  5. PSYCHE SCORING (deterministic)                              │
│     ├── 5a: Need-based scoring (scorer.ts)                      │
│     ├── 5b: Relationship modifiers (relationships.ts)           │
│     ├── 5c: Moral filter — vetoes + penalties (morals.ts)       │
│     ├── 5d: Desire modifiers — wants/fears (desires.ts)         │
│     ├── 5e: Commitment break-cost penalties                     │
│     ├── 5f: Opinion context adjustments                         │
│     └── Winner selected + internal conflict flagged if needed   │
│              │                                                   │
│  6. EXECUTION                                                    │
│     ├── If at correct location: perform action                  │
│     ├── If not: walk to location (store intent)                 │
│     └── Apply action effects to needs                           │
│              │                                                   │
│  7. POST-EXECUTION UPDATES (deterministic, no LLM)             │
│     ├── Relationship updates (if social action)                 │
│     ├── Opinion updates (if relevant topic encountered)         │
│     ├── Emotional contagion (proximity-based transfer)          │
│     └── Action log entry (every action, for habit tracking)     │
│              │                                                   │
│  8. MEMORY CREATION (see Memory Creation Pathways)              │
│     ├── Conversation memories: always (existing system)         │
│     ├── Action log: every action (lightweight, no LLM)          │
│     ├── Selective action memories: only notable actions (LLM)   │
│     ├── Commitment memories: on create/honor/break (LLM)        │
│     ├── LLM assigns importance + emotional weight               │
│     └── Check reflection trigger (importance sum > threshold)   │
│              │                                                   │
│  9. REFLECTION (if triggered, ~2-3 per game day)               │
│     ├── LLM generates high-level insights from recent memories  │
│     ├── Structured extraction: wants, fears, opinion deltas     │
│     ├── Store reflection as memory (feeds back into retrieval)  │
│     └── Feed structured data into psyche subsystems             │
│              │                                                   │
│ 10. MEMORY CONSOLIDATION (periodic, low priority)               │
│     ├── Cluster similar low-importance memories by embedding    │
│     ├── Compress into summary memories                          │
│     └── Archive originals (excluded from retrieval, not deleted)│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Walkthrough: The Alex/Maya Party Scenario

This traces a complete agent decision through every step of the lifecycle.

**1. Perception:** Alex is at the park, afternoon. Energy 45/100 (moderate), social 25/100 (low). Maya is nearby. No active commitments. No critical needs.

**2. Habit check:** Alex has no consistent afternoon-at-park habit yet. Context hash doesn't match any habit entry. Full pipeline runs.

**3. Memory retrieval:** Query built from: "Alex is at the park, afternoon, low social need, Maya nearby." Four-factor scoring returns:
- "Had a fun conversation with Maya at the cafe yesterday" (high recency + high emotion)
- "Maya mentioned she's planning a party this weekend" (high relevance)
- "I felt lonely last week" (reflection, high importance)
- "Exercised at the park and felt good" (moderate recency)

**4. LLM action menu:** Given the memories (loneliness reflection, Maya nearby, party mention) and low social need, the LLM shortlists: `chat_with_nearby` (Maya is right there), `exercise_at_park`, `read_at_park`. The LLM omits `rest_on_bench` because nothing in Alex's memories or personality suggests it.

**5. Psyche scoring:**
- `chat_with_nearby`: social urgency is high (25/100 with weight 0.8), Maya has high affinity (+70) boosting social weight, relationship modifier pushes score up. **Score: highest.**
- `exercise_at_park`: fun replenishment moderate, energy cost notable. Score: moderate.
- `read_at_park`: fun + comfort, no cost. Score: moderate-low.

Winner: `chat_with_nearby`. No moral conflict flagged.

**6. Execution:** Alex initiates conversation with Maya. During the conversation, Maya invites Alex to a party tomorrow evening. The conversation response system activates:
- LLM generates 4 structured options (accept, decline_soft, counter, deflect)
- Psyche scores them: low social need (urgency) + high affinity with Maya + no moral conflict → `accept` wins
- Alex says: "That sounds fun, I'll be there!"

**7. Post-execution updates:**
- Relationship: Maya → frequency +10, familiarity +3 (positive_social interaction)
- Opinion of Maya: unchanged (positive interaction, no strong topic)
- Emotional contagion: Maya is excited → Alex absorbs +2 mood (weighted by relationship closeness × receptivity)
- Action log: `{ actionId: 'chat_with_nearby', timestamp: ..., location: 'park' }`

**8. Memory creation:**
- Conversation memory: "Chatted with Maya at the park. She invited me to her party tomorrow and I said yes." (importance: 6, emotional weight: 0.7)
- Commitment created: `{ actionId: 'attend_maya_party_001', targetTime: tomorrow_7pm, breakCost: { relationship: 'negative_social', moralPenalty: [{value: 'loyalty', severity: 0.5}] } }`
- Commitment memory: "I promised Maya I'd come to her party tomorrow evening." (importance: 5, emotional weight: 0.5)
- Ephemeral action injected: `attend_maya_party_001` with social +40, fun +25, energy -20

**9. Reflection:** (Triggered later when importance sum crosses threshold.) Recent memories fed to LLM produce the insight: "I'm becoming closer friends with Maya — she's someone I genuinely enjoy spending time with." Structured extraction:
- Want: `{ target: "deepen_friendship_with_Maya", intensity: 0.5, sourceMemories: [...] }`
- This want will slightly boost Maya-related social actions in future scoring.

**10. Memory consolidation:** Not triggered yet (not enough similar memories to cluster). After several more park visits, multiple "exercised at the park" memories might consolidate into "I exercise at the park regularly."

---

## Performance & Feasibility

### What's Cheap vs. What's Expensive
- **Psyche system is practically free**: needs depletion, moral scoring, relationship graph updates, emotional contagion, priority cascade, rule constraint checks — all basic arithmetic. Could run 1,000+ agents without issue on any modern hardware.
- **LLM inference is the entire bottleneck**: a 7-8B local model generates ~20-50 tokens/sec. A single action-menu prompt needing 300-500 tokens = 6-25 seconds per call per agent. Running 25 agents sequentially = minutes per tick. Must be mitigated.

### Mitigation Strategies (Built Into the Architecture)

#### Habit Caching (Already Planned)
- Most agents on most ticks don't need an LLM call — morning routines, commutes, habitual meals are all cached
- In a stable simulation, maybe 3-5 out of 25 agents need LLM calls on any given tick
- The rest run purely on deterministic psyche systems

#### Staggered Processing
- Not every agent evaluates on every tick
- Agents doing routine things run on longer cycles (evaluate every 5-10 ticks)
- Agents in active situations (conversations, novel events, critical needs) evaluate more frequently
- Sprite movement and need depletion happen every tick regardless — only decision-making is staggered

#### Tiered Inference
- Not every LLM call needs the same model
- **Fast/small model (3B)**: action menu generation, routine choices — near-instant
- **Larger model (7-8B+)**: dialogue, reflections, complex novel situations — higher quality
- Two models can run simultaneously on the same GPU with different contexts

#### Speculative Generation
- While an agent executes their current action (which takes game-time), pre-generate their next set of options in the background
- By the time they need to decide, options are already waiting for the psyche to score

#### Prompt Batching
- If multiple agents need action menus at the same tick, batch into one LLM call
- Faster than sequential calls on most inference engines

### Deployment Scenarios

#### Local LLMs (Consumer Hardware)
- **Target**: 10-20 agents on a gaming PC with a 3070+
- **Speed**: not real-time — adjustable game speed (e.g., 1 game hour = 30 real seconds)
- **UX fit**: "sit back and watch" observation gameplay suits a Dwarf Fortress-style speed slider, not real-time
- **Trajectory**: gets better as local models get faster and more efficient — building slightly ahead of hardware curve

#### Cloud API
- LLM calls can be parallelized — all agents fire simultaneously, wait on slowest (~1-3 seconds), not the sum
- **Cost estimate**: 25 active agents ≈ $2-5/hour at current Sonnet-tier pricing
- Viable for a subscription game model
- Can use cheaper models for routine generation, escalate to better models for important moments (first meetings, conflicts, reflections)

#### Hybrid (Best for Released Product)
- Run deterministic psyche system + small model inference locally
- Offload complex dialogue and reflection to cloud API
- User's GPU handles the 90% of ticks that don't need heavy inference
- Cloud handles the interesting moments
- Graceful degradation: if cloud is unavailable, fall back to local-only with reduced dialogue quality

---

## Next Steps

### Completed
- [x] Clone and explore AI Town codebase — understand the simulation loop and state management
- [x] Design the agent state object and registry system (needs, resources, actions, rules as generic typed entries)
- [x] Define the action metadata schema (effects, costs, requirements)
- [x] Design data models for psyche subsystems (needs, wants/fears, moral compass, relationship graph, opinions)
- [x] Implement needs system — Maslow-based, depleting/replenishing, data-driven
- [x] Implement the priority cascade scorer (needs urgency scoring with critical multiplier)
- [x] Implement relationship graph — directed, weighted edges with 5 dimensions
- [x] Wire psyche scorer + relationships into agent decision loop

### Remaining (see `docs/plans/2026-02-26-next-steps-roadmap.md` for detailed tasks)
- [ ] Phase 0: Deploy to Convex and smoke test
- [ ] Phase 1: Moral compass — vetoes, soft penalties, internal conflict detection
- [ ] Phase 2: Opinion tracking — per-topic numeric attitudes
- [ ] Phase 3: Emotional contagion — proximity-based emotion transfer
- [ ] Phase 4: Wants/fears + reflection pipeline — emergent desires, 4-factor memory retrieval
- [ ] Phase 4.5: Action menu pipeline — LLM curation, conversation responses, ephemeral actions, commitments, habits, memory consolidation
- [ ] Phase 5: Full integration, tuning, and end-to-end scenario testing
- [ ] Validate that adding a new need/resource/rule type requires zero engine changes
