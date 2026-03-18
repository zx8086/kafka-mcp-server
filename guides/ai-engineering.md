# AI Prompting & Engineering Guide

A comprehensive guide to prompt design, response validation, hallucination prevention, and quality assurance patterns for LLM-powered agent systems. Companion to `LANGGRAPH_WORKFLOW_GUIDE.md` -- that guide covers graph topology and node responsibilities (WHAT); this guide covers prompt engineering and quality strategies (HOW and WHY).

### How to Read This Guide

This guide describes **framework-agnostic patterns** -- layered prompt architecture, structured output engineering, hallucination defense, response validation pipelines, and more. These patterns apply to any LLM-powered system, not just AWS cost analysis.

Code snippets throughout are **reference implementations** from the AWS Cost Analyzer project. They demonstrate how each pattern is concretely realized in TypeScript/Bun with LangGraph, AWS Bedrock, and Zod. When adapting to a different domain:

- **Keep the strategies**: prompt layering, dynamic context injection, validation pipelines, hallucination detection, confidence scoring, caching hierarchies
- **Replace the domain layer**: swap cost-analysis prompts for your domain's prompts, replace cost validation thresholds with your domain's constraints, adapt entity schemas to your entity types
- **Swap infrastructure as needed**: Bedrock -> OpenAI/Anthropic API, LangGraph -> any agent framework, Zod -> any validation library

Each section opens with the **pattern** (what and why), then shows the **implementation** (how, with source references). The patterns are the point; the code is the proof.

---

## Table of Contents

1. [Prompt Architecture Fundamentals](#1-prompt-architecture-fundamentals)
2. [Per-Node Prompt Design Patterns](#2-per-node-prompt-design-patterns)
3. [Dynamic Context Injection System](#3-dynamic-context-injection-system)
4. [Structured Output Engineering](#4-structured-output-engineering)
5. [Response Formatting & Sanitization Pipeline](#5-response-formatting--sanitization-pipeline)
6. [Hallucination Prevention Framework](#6-hallucination-prevention-framework)
7. [Validation Engineering (Block + Retry)](#7-validation-engineering-block--retry)
8. [Tool Output Quality Assurance](#8-tool-output-quality-assurance)
9. [Follow-Up Question Generation](#9-follow-up-question-generation)
10. [Context Window & Token Budget Management](#10-context-window--token-budget-management)
11. [Classification Caching & Performance](#11-classification-caching--performance)
12. [Error Resilience & Graceful Degradation](#12-error-resilience--graceful-degradation)
13. [Complementary Tool Pairing](#13-complementary-tool-pairing)
14. [Supervisor-Driven Tool Planning](#14-supervisor-driven-tool-planning)

---

## 1. Prompt Architecture Fundamentals

### Pattern

LLM prompts in an agent system are not monolithic strings. They are **layered compositions** assembled at runtime from static templates and dynamic context. The goal is minimal token spend for maximum signal: keep the base prompt lean, inject additional context only when the query demands it.

A well-architected prompt system has three layers:

| Layer | Content | Token Cost | When Included |
|-------|---------|-----------|---------------|
| Static base | Role definition, formatting rules, scope boundaries | ~1,400 tokens | Always |
| Dynamic context | Domain rules, tool guidance, query-specific constraints | ~300-500 tokens | Conditional |
| Runtime state | Organizational context, extracted entities, page context | ~100-300 tokens | Per-request |

This layered approach keeps simple queries cheap (base + minimal state) while giving complex queries the full context they need.

### Model Assignment Strategy

Not every node in an agent graph needs the same model. Classification and extraction are structurally simpler than multi-step reasoning -- assign models accordingly.

**Reference implementation** (`src/ai/config/bedrock-config.ts`):

```typescript
const MODEL_IDS = {
  HAIKU: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  SONNET: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
} as const;

const MODEL_CONFIG = {
  classifier: MODEL_IDS.HAIKU,      // Binary output, trivial task
  toolRouter: MODEL_IDS.HAIKU,      // Semantic classification
  entityExtractor: MODEL_IDS.HAIKU, // Structured extraction
  agent: MODEL_IDS.SONNET,          // ReAct reasoning loop
  responder: MODEL_IDS.HAIKU,       // Format existing content
  followUpGenerator: MODEL_IDS.HAIKU,// Creative but constrained
} as const;
```

**Assignment rationale**:

| Node | Model | Max Tokens | Temperature | Rationale |
|------|-------|-----------|-------------|-----------|
| classifier | Haiku | 50 | 0.0 | Binary classification is trivial -- Haiku handles it in <100ms |
| toolRouter | Haiku | 50 | 0.0 | Semantic classification into 10 categories doesn't need Sonnet |
| entityExtractor | Haiku | 1,024 | 0.0 | Structured JSON extraction is Haiku's sweet spot |
| agent | Sonnet | 4,096 | 0.0 | ReAct reasoning with tool calls benefits most from model upgrade |
| responder | Haiku | 1,024 | 0.0 | Reformatting existing content doesn't need heavy reasoning |
| followUpGenerator | Haiku | 512 | 0.3 | Slight creativity for question variety, but still constrained |

### Temperature Selection Matrix

| Temperature | Use Case | Example |
|------------|----------|---------|
| 0.0 | Deterministic tasks: classification, extraction, data formatting | Classifier, entity extractor, agent |
| 0.3 | Controlled creativity: question generation, response variety | Follow-up generator |
| 0.7+ | Creative tasks: content generation, brainstorming | Not used in agent systems |

The rule: if the output has a "correct answer," use temperature 0.0. If you want variety across runs, use 0.3. Never use high temperature in agent reasoning -- it introduces non-determinism in tool selection.

### Configuration Presets

```typescript
const SIMPLE_QUERY_CONFIG = {
  maxTokens: 1024,
  temperature: 0.0,
};

const COMPLEX_QUERY_CONFIG = {
  maxTokens: 4096,
  temperature: 0.0,
};
```

Simple queries (greetings, general knowledge) get a 1,024-token budget. Complex queries (multi-tool analysis with tables and explanations) get 4,096 tokens. This prevents the model from over-generating on simple tasks.

---

## 2. Per-Node Prompt Design Patterns

### Pattern

Each node in the agent graph has a distinct prompt design optimized for its specific task. The key insight: prompt structure should match output structure. Single-word outputs get single-word instructions. JSON outputs get schema-in-prompt. Free-form outputs get formatting guidelines.

### Tool Descriptions as the Primary Prompt

When sub-agents have access to tools with rich descriptions (use cases, parameter guidance, warnings, examples), the system prompt should delegate domain knowledge to the tool descriptions rather than duplicating it. The tool descriptions *are* the prompts -- the system prompt only adds what the model cannot derive from them.

**System prompt structure for tool-heavy agents**:

| Section | Purpose | Example |
|---------|---------|---------|
| Role | One sentence: who the agent is | "You are an operations agent querying a single deployment." |
| Delegation | Tell the model to read tool descriptions | "Read each tool's description carefully -- they contain best practices and parameter guidance." |
| Operational constraints | Limits the model can't infer from tools | "Avoid wildcard queries on clusters with 8,000+ indices." |
| Output format | How to structure the response | "Present findings with exact numbers. No emojis. Plain text in table cells." |

**Anti-pattern: Kitchen sink prompt**

```
# Don't do this when tools already describe themselves
SYSTEM_PROMPT = `You are an operations agent.

When checking health, use the get_health tool with...
When listing resources, use the list tool with limit parameter...
When searching, always add a date filter because...
[300 more lines repeating what's in tool descriptions]`
```

This fails because: (1) the duplicated instructions drift out of sync with actual tool descriptions, (2) the prompt consumes tokens that could carry conversation context, and (3) contradictions between prompt and tool description confuse the model.

**When to apply**: When your tools have >50 words in their descriptions. For simple tools with one-line descriptions (e.g., `"Get the current time"`), the system prompt may need to carry the usage guidance.

### Classifier: Binary Single-Word Output

The classifier determines if a query needs database access (complex) or can be answered from general knowledge (simple).

**Prompt design principles**:
- Explicit output constraint: "Respond with only one word"
- Both positive and negative examples for each class
- Decision boundary made explicit with examples

**Reference implementation** (`src/ai/graph/nodes/classifier.ts`):

```typescript
const classificationPrompt = `You are a query classifier for an AWS cost analysis system.

Classify this query as either SIMPLE or COMPLEX:

SIMPLE queries:
- General questions about AWS services or concepts
- Greetings or conversational messages
- Questions that can be answered with general knowledge
- Clarifying questions or follow-ups that don't need new data

COMPLEX queries (require database access):
- Questions asking for specific cost data, amounts, or numbers
- Requests to show, list, or display costs
- Questions about trends, comparisons, or analysis
- Requests for optimization recommendations based on actual data
- Questions about specific accounts, services, or time periods
- Any query that needs real data to answer accurately
- Questions about WHO owns/approves/manages accounts or departments
- Organizational governance queries about account ownership

Query: "${query}"

Respond with only one word: SIMPLE or COMPLEX`;
```

**Key choices**:
- Single-word output prevents the model from hedging ("It's somewhat complex...")
- "WHO owns/approves/manages" is explicitly listed because organizational queries require database lookups but don't mention "costs"
- The parsing is forgiving: `content.includes("COMPLEX")` catches "COMPLEX", "COMPLEX.", or "It is COMPLEX"

**Follow-up short-circuit**: Follow-up queries in existing threads always take the complex path, regardless of content. A follow-up like "What about RDS?" looks simple in isolation but needs conversation context to resolve.

```typescript
if (state.isFollowUp) {
  return { queryComplexity: "complex" };
}
```

### Classifier Context Injection for Follow-Up Messages

The boolean bypass above works when conversation threads are explicit (a `isFollowUp` flag exists in state). But many systems lack that flag -- the classifier sees "try again" or "yes" with no signal that this is a follow-up to a complex query.

**Problem**: Short follow-up messages like "try again", "yes", "do that for production" are ambiguous in isolation. A classifier seeing just "yes" will almost always classify it as SIMPLE (it's a single word, no domain terms). But in context, "yes" means "yes, run that complex query again."

**Two strategies**:

| Strategy | How | Trade-off |
|----------|-----|-----------|
| Boolean bypass | Check `isFollowUp` flag, skip classification | Fast, but requires the flag to exist |
| Context injection | Inject recent conversation history into the classifier prompt | Slower (more tokens), but works without flags |

**Context injection implementation**:

```typescript
const MAX_CONTEXT_WORDS = 15;

function needsContext(query: string, messageCount: number): boolean {
  if (messageCount <= 1) return false;
  return query.trim().split(/\s+/).length <= MAX_CONTEXT_WORDS;
}
```

When context is needed, the classifier prompt gains a `CONVERSATION CONTEXT` section and an explicit instruction: "If the user's message is a follow-up that refers to a previous complex query (e.g., 'try again', 'do it again', 'yes'), classify as COMPLEX."

**Decision matrix**:

| Condition | Action |
|-----------|--------|
| Long query (>15 words) | Classify on the query alone -- it carries enough signal |
| Short query + conversation history | Inject context, skip cache |
| Short query + no history | Classify on the query alone (first message in thread) |

**Cache bypass**: Context-injected classifications must skip the cache. The same query ("yes") maps to different classifications depending on what came before it. Only cache classifications made on the query alone.

**Token cost**: Context injection adds ~200-400 tokens per classification (4 recent messages, 150 chars each). This is negligible compared to the cost of misrouting a query to the wrong handler.

### Entity Extractor: JSON Schema in Prompt

The entity extractor identifies accounts, departments, services, and timeframes from natural language queries.

**Prompt design principles**:
- Full JSON schema embedded in the prompt defines the expected output structure
- All valid entity values listed (accounts, departments, services) so the model can match fuzzy references
- Inheritance rules for follow-up queries are explicit with examples

**Key prompt sections**:

1. **Available entities listing**: All accounts with IDs, departments, domains, service aliases

2. **Output schema definition**: The exact JSON structure expected, with field descriptions

3. **Inheritance rules for follow-ups**:
```
CONTEXT INHERITANCE RULES (follow-up queries):
1. Pronouns ("that", "those", "it", "the same") refer to previous context
2. "Compare to X" keeps previous entities AND adds X
3. "Same timeframe/period" inherits previous timeframe exactly
4. No explicit entities = inherit ALL previous entities
5. Explicit mentions OVERRIDE inherited entities
6. For inherited entities, set mentionedAs to "(inherited from context)"
```

**Output structure**:

```typescript
{
  accounts: [{ id: string, name: string, environment: string, mentionedAs: string }],
  departments: [{ id: string, name: string, mentionedAs: string }],
  domains: [{ id: string, name: string, mentionedAs: string }],
  services: [{ name: string, shortName: string, category: string, mentionedAs: string }],
  categories: string[],
  environments: string[],
  timeframe: {
    type: "relative" | "absolute" | "comparison",
    description: string,
    resolved?: { start: string, end: string }
  },
  tags?: Record<string, string>
}
```

**The `mentionedAs` field**: Tracks how the user referenced each entity. "EC2" -> `mentionedAs: "EC2"`, resolved to `name: "Amazon Elastic Compute Cloud"`. For inherited entities: `mentionedAs: "(inherited from context)"`. This enables the responder to use the user's own terminology in the response.

**Timeframe resolution examples**:

| User Input | Type | Resolved |
|-----------|------|----------|
| "last 3 months" | relative | `{ start: "2025-12", end: "2026-03" }` |
| "December 2025" | absolute | `{ start: "2025-12", end: "2025-12" }` |
| "Dec vs Nov" | comparison | `{ start: "2025-11", end: "2025-12" }` |
| "Q4 2025" | absolute | `{ start: "2025-10", end: "2025-12" }` |
| (inherited) | (from previous) | Previous timeframe preserved |

**Context source tracking**: The state tracks whether entities came from the user's explicit query or were inherited from a previous turn:

```typescript
contextSource: "EXPLICIT" | "INHERITED"
```

This informs the responder: "Using your context (OIT, December 2025)" for inherited entities vs. direct acknowledgment for explicit entities.

### Tool Router: Decision Tree Classification

The tool router classifies queries into one of 10 tool bundles, each mapping to a set of tools the agent should use.

**Prompt design principles**:
- Decision tree structure (not keyword matching) for disambiguation
- User intent classification, not keyword detection
- Each bundle has a clear "user intent" description with example queries

**Decision tree in prompt**:

```
DECISION TREE FOR AMBIGUOUS QUERIES:
1. Is query asking "WHO owns/approves/manages?" -> organizational
2. Is query asking "WHY did cost change?" -> root_cause
3. Is query asking "WHAT is the trend/forecast?" -> trend_forecast
4. Is query asking "FIND unusual patterns/anomalies?" -> anomaly_analysis
5. Is query asking "SHOW spending overview/calculate savings?" -> comprehensive
6. Is query asking "WHAT IF I change X?" -> scenario_modeling
7. Is query asking "FIND underutilized/rightsizing?" -> utilization
8. Is query asking "AWS Trusted Advisor recommendations?" -> recommendations
9. Is query comparing TWO specific periods? -> period_comparison
10. Simple cost lookup for one period? -> single_query
```

**Tool bundle mapping** (10 bundles):

| Bundle | User Intent | Primary Tools |
|--------|-------------|---------------|
| `organizational` | WHO owns/approves/manages? | query_accounts_by_tags |
| `single_query` | Point-in-time cost lookup | cost_query |
| `trend_forecast` | Historical patterns OR future projections | trend_analysis, cost_query |
| `period_comparison` | Two-period side-by-side | compare_periods, cost_query |
| `root_cause` | WHY did costs change? | root_cause, cost_query, trend_analysis |
| `anomaly_analysis` | Unusual patterns | anomaly_detection, root_cause, cost_query |
| `utilization` | Resource efficiency | optimization, recommendations |
| `recommendations` | AWS-provided suggestions | recommendations, optimization |
| `scenario_modeling` | What-if simulations | scenario_modeling, recommendations |
| `comprehensive` | Multi-faceted overview | spending_overview, trend_analysis, recommendations |

**Why decision tree over keywords**: "Track RDS costs" contains "costs" (single_query?) and "track" (trend_forecast?). The decision tree resolves this: "WHAT is the trend?" -> trend_forecast. Keywords would misclassify.

### Agent: System Prompt Assembly

The agent node receives the most complex prompt -- assembled from base instructions, dynamic context, and tool descriptions.

**Prompt assembly order**:

```
1. Base prompt (~1,400 tokens)
   - Role definition
   - Data presentation rules
   - Account naming rules
   - Tool usage guidelines
   - Error recovery protocol
   - Scope boundaries
   - Data fidelity mandate

2. Dynamic context (~300-500 tokens, conditional)
   - Language rules
   - Data validation rules
   - Bundle-specific query guidance
   - Forecasting rules (if applicable)
   - Complete months handling (if applicable)

3. Runtime state (variable)
   - Organizational context (scope, cost data)
   - Page context (which UI page)
   - Extracted entities
   - Previous conversation context (follow-ups)
```

**Key base prompt sections** (`src/ai/graph/nodes/agent.ts`):

```
DATA FIDELITY (MANDATORY):
All numeric values MUST come directly from tool output.
- Quote exact figures (e.g., "$21,270.16" not "$21,000")
- NEVER fabricate, estimate, or extrapolate
- NEVER round unless tool output is rounded
- If not in tool output, say "data not available"
```

```
SCOPE BOUNDARIES:
This tool analyzes AWS COSTS and UTILIZATION METRICS. It CANNOT:
- Query AWS service configurations
- Modify or manage AWS resources
- Access real-time CloudWatch alarms
- Show currently running services
- Access AWS service quotas or limits
```

```
GRACEFUL FAILURE PROTOCOL:
1. Tool returns empty/no data? Acknowledge limitation clearly
2. After ONE failed attempt: don't retry
3. Explain what data IS available
4. Suggest alternative queries
```

### Responder: Answer Extraction with Fallback Chain

The responder extracts the final answer from the agent's conversation and formats it for the user. It handles two distinct paths: complex queries (where the agent has already generated a response) and simple queries (where the responder generates the response directly).

**Answer extraction logic** (`src/ai/graph/nodes/responder.ts`):

```typescript
function extractAnswer(messages: BaseMessage[]): string {
  // Walk messages from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Check for AI message using multiple methods for robustness
    // Messages may lose instanceof check after serialization
    const isAI =
      message instanceof AIMessage ||
      message._getType?.() === "ai" ||
      (message as { role?: string }).role === "assistant";
    if (!isAI) continue;

    // Skip messages with no content (tool-call-only messages)
    if (!message.content) continue;

    const rawContent = extractTextContent(message.content);
    if (!rawContent.trim()) continue;

    // Skip messages that are just follow-up question lists
    if (isFollowUpOnlyContent(rawContent)) continue;

    return sanitizeLLMOutput(rawContent);
  }

  return "";
}
```

**Key design decisions**:
- Messages with BOTH content AND tool_calls are not skipped -- the content is extracted. This handles the common case where the agent provides an answer and calls `suggest_followups` in the same message.
- Multiple AI message detection methods (`instanceof`, `_getType()`, `.role`) provide robustness against serialization/deserialization in LangGraph's memory saver.

**Confidence scoring**: The responder calculates a confidence score based on execution metrics (not data quality -- that's handled by `AnalysisMetadata`):

```typescript
function calculateResponseConfidence(
  toolsUsed: string[],
  reasoningSteps: string[],
  hasContext: boolean
): number {
  let confidence = 0.5;                                    // Base: 50%
  confidence += Math.min(0.2, toolsUsed.length * 0.05);   // +5% per tool, max +20%
  confidence += Math.min(0.15, reasoningSteps.length * 0.02); // +2% per step, max +15%
  if (hasContext) confidence += 0.1;                       // +10% for organizational context
  return Math.min(0.95, confidence);                       // Cap at 95%
}
```

**Simple response path**: Simple queries skip the agent entirely and go to a lightweight Haiku-based responder:

```typescript
function buildSimpleResponsePrompt(
  organizationalContext: OrganizationalContext | null,
  pageContext: PageContext | null
): string {
  const userContext = buildUserContextSection(pageContext, organizationalContext);

  return `You are an AWS cost analysis assistant for PVH Corp.
${userContext}

Today's date: ${new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  })}

Provide helpful, concise responses using the data available.

FORMATTING:
- Use markdown tables and bullet points for clarity
- Format costs with dollar sign and two decimals ($1,234.56)
- Format percentages with sign (+5.2% or -3.1%)
- ALWAYS use account names, never raw account IDs alone`;
}
```

**User context section**: Both simple and complex paths inject a "situation awareness" block that tells the LLM where the user is and what they're looking at:

```
== USER CONTEXT ==
Viewing: Cost Analysis page (/cost-analysis)
Analyzing: OIT department
Current costs: $45,231.89 (+3.2% vs last month)
==================
```

**Page-specific guidance** (injected based on `context.route`):

| Route | Context Purpose |
|-------|----------------|
| `/` | Dashboard -- executive summaries, high-level insights |
| `/cost-analysis` | Cost trend visualizations -- historical patterns |
| `/category-analysis` | Service category breakdowns |
| `/recommendations` | Cost optimization opportunities |
| `/anomalies` | Anomaly detection and spikes |

---

## 3. Dynamic Context Injection System

### Pattern

Not every query needs every prompt rule. A cost comparison query doesn't need forecasting rules. An anomaly detection query doesn't need comparison rules. **Dynamic context injection** adds prompt sections only when the query's tool bundle demands them, keeping token costs proportional to query complexity.

The architecture: always-on rules (included in every prompt) plus conditional sections (included based on the tool bundle, query content, or UI context).

### Always-On Rules

These four rule sets are included in every agent prompt, regardless of query type.

**Reference implementation** (`src/ai/graph/helpers/prompt-context.ts`):

```typescript
const LANGUAGE_RULES = `
LANGUAGE RULES:
- NO subjective superlatives: "substantial", "significant", "remarkable", "considerable"
- Use quantitative descriptions: "26% reduction" not "large reduction"
- NO speculation without evidence: "suggests X happened" - say "X changed, cause unknown"
- State facts from tool output only - never invent explanations`;

const DATA_VALIDATION_RULES = `
DATA VALIDATION (CHECK BEFORE PRESENTING):
- Percentages must be 0-100% (values like 17,000,000% are data errors - exclude)
- Savings must be positive (negative = cost INCREASE - label as "+$X increase")
- Same-to-same recommendations (e.g., "20GB to 20GB") are invalid - exclude
- 0% savings items are NOT cost optimizations - separate or exclude`;

const PARALLEL_EXECUTION_RULES = `
PARALLEL EXECUTION (CRITICAL):
When you need multiple independent tools, call them ALL in ONE response.
- cost_query + trend_analysis = PARALLEL (independent)
- cost_query then root_cause = SEQUENTIAL (dependent)
Never make 3+ identical calls hoping for different results.`;

const ERROR_RECOVERY_RULES = `
ERROR RECOVERY:
- Tool returns wrong date range: Acknowledge mismatch, try alternative approach
- Tool returns no data: State "No records found for [period]" - never speculate why
- Tool returns partial data: Label as "MTD" or "Partial" - don't compare to full months
- After 1 failed retry: Pivot to alternative approach, don't repeat identical calls`;
```

**Why always-on**: These rules prevent the most common and costly LLM mistakes. Language rules prevent vague qualitative claims. Data validation prevents impossible values from reaching the user. Parallel execution rules prevent redundant tool calls. Error recovery prevents hallucinated explanations.

### Conditional Context Sections

Additional rules are injected based on the tool bundle, query content, or UI context.

**Bundle-conditional rules**:

| Rule Set | Included When | Purpose |
|----------|--------------|---------|
| `DASHBOARD_RULES` | `isDashboard === true` | Concise executive summaries, max 3 observations |
| `FORECASTING_RULES` | Bundle is `trend_forecast` or `scenario_modeling` | Month alignment, confidence labeling |
| `COMPLETE_MONTHS_RULES` | Bundle is `comprehensive`, `trend_forecast`, or `anomaly_analysis` | Handle `exclude_incomplete` parameter |
| `DATA_QUALITY_RULES` | Bundle is `comprehensive`, `period_comparison`, or `trend_forecast` | Label data completeness |
| `CONTEXT_INHERITANCE_RULES` | Bundle is `general` or unset | Follow-up context handling |
| `FOLLOWUP_RULES` | Always | Zoom-out, zoom-in, temporal question mix |

**Conditional rule examples**:

```typescript
const DASHBOARD_RULES = `
DASHBOARD CONTEXT - CONCISE RESPONSES:
- Maximum 3 key observations
- Lead with most important insight
- Use bullet points, not paragraphs
- Executive summary first (2-3 sentences)
- Offer drill-down: "Would you like details on [specific item]?"`;

const FORECASTING_RULES = `
FORECASTING RULES:
- Align months EXACTLY to user request (Jan-Mar means Jan-Mar, not Feb-Apr)
- Current month (<50% complete): Use AWS forecast, label "LOW confidence"
- Future months (2-3 out): Label "MEDIUM confidence"
- Complete historical: Label "HIGH confidence"
- Explain counterintuitive confidence levels`;

const COMPLETE_MONTHS_RULES = `
COMPLETE MONTHS HANDLING:
When user asks for "complete months", "full months", or "last N complete months":
- Set exclude_incomplete: true on tools that support it
- This excludes the current (partial) month from analysis
- Example: "last 3 complete months" in January 2026 = October, November, December 2025
- Without exclude_incomplete, "3m" would incorrectly include incomplete January 2026`;
```

### Bundle-Specific Query Guidance

Each tool bundle has its own query guidance section -- a block of rules specific to that analysis type. These are the most impactful context injections because they encode domain-specific expertise.

**Reference**: `QUERY_GUIDANCE` map in `src/ai/graph/helpers/prompt-context.ts`

| Bundle | Key Rules |
|--------|-----------|
| `single_query` | 1-2 tools max, include STATUS column, label partial months |
| `trend_forecast` | Quantify rate changes, label confidence (HIGH/LOW), verify month alignment |
| `period_comparison` | Use "offset" only if diff <5%, verify percentage calculations |
| `root_cause` | Set `use_projections: true` for forecast queries, correlation is not causation |
| `utilization` | Filter max CPU >80% (need peak capacity), sort by savings |
| `recommendations` | Validate source != target, exclude 0% savings |
| `anomaly_analysis` | Distinguish MTD reductions from genuine anomalies |
| `scenario_modeling` | Lead with direct answer, don't talk user out of what-if questions |
| `comprehensive` | Use trend_analysis_tool for projections (cost_query cannot project) |
| `organizational` | Use query_accounts_by_tags, tabular format with tags |

**Example -- root cause guidance**:

```typescript
const ROOT_CAUSE_GUIDANCE = `
ROOT CAUSE RULES:
- For "projected", "forecast", or "month-end" queries: Set use_projections: true
  - This applies AWS forecast multiplier to current month data
  - Without use_projections, comparisons use MTD (partial) data which can mislead
- Only correct direction if user explicitly states wrong assumption
- If user asks about "increases", focus on increases
- Correlation is not causation - label speculative conclusions
- Include actionable next steps prioritized by impact`;
```

### Query-Pattern-Triggered Injection

Some context is injected based on regex matches against the query text, not the tool bundle.

```typescript
// Department enumeration pattern
if (/\b(each|all|every|per)\s+department/i.test(query)) {
  // Inject explicit department list to prevent hallucination
  context += DEPARTMENT_ENUMERATION_GUIDANCE;
}
```

This prevents the model from guessing department names. When the query says "for each department," the prompt explicitly lists all departments and their accounts.

### `buildDynamicContext()` Assembly

The assembly function composes the final dynamic context:

```typescript
function buildDynamicContext(
  toolBundle: ToolBundleName | null,
  isDashboard: boolean,
  query?: string
): string {
  const sections: string[] = [];

  // Always included
  sections.push(LANGUAGE_RULES);
  sections.push(DATA_VALIDATION_RULES);
  sections.push(PARALLEL_EXECUTION_RULES);
  sections.push(ERROR_RECOVERY_RULES);

  // Dashboard context
  if (isDashboard) sections.push(DASHBOARD_RULES);

  // Bundle-specific guidance
  if (toolBundle && QUERY_GUIDANCE[toolBundle]) {
    sections.push(QUERY_GUIDANCE[toolBundle]);
  }

  // Conditional rule sets based on bundle
  if (toolBundle === "trend_forecast" || toolBundle === "scenario_modeling") {
    sections.push(FORECASTING_RULES);
  }
  if (["comprehensive", "period_comparison", "trend_forecast"].includes(toolBundle)) {
    sections.push(DATA_QUALITY_RULES);
  }
  if (["comprehensive", "trend_forecast", "anomaly_analysis"].includes(toolBundle)) {
    sections.push(COMPLETE_MONTHS_RULES);
  }
  if (!toolBundle || toolBundle === "general") {
    sections.push(CONTEXT_INHERITANCE_RULES);
  }

  // Query-pattern-triggered injection
  if (query && /\b(each|all|every|per)\s+department/i.test(query)) {
    sections.push(DEPARTMENT_ENUMERATION_GUIDANCE);
  }

  // Always included
  sections.push(FOLLOWUP_RULES);

  return sections.join("\n\n");
}
```

### Minimal Context for Simple Queries

When a query is classified as simple, there's no need for the full dynamic context. A minimal context function provides just enough guidance for the responder:

```typescript
function getMinimalContext(): string {
  return [LANGUAGE_RULES, FOLLOWUP_RULES].join("\n\n");
}
```

This keeps simple query token costs to roughly 200 tokens of context instead of 500+.

### Token Budget Summary

| Query Type | Base Prompt | Dynamic Context | Runtime State | Total |
|-----------|-------------|----------------|---------------|-------|
| Simple (greeting) | 0 (responder prompt ~200) | ~200 (minimal) | ~100 | ~500 tokens |
| Simple (knowledge) | 0 (responder prompt ~200) | ~200 (minimal) | ~100 | ~500 tokens |
| Complex (single tool) | ~1,400 | ~300 (4 always-on + 1 bundle) | ~200 | ~1,900 tokens |
| Complex (multi-tool) | ~1,400 | ~500 (4 always-on + bundle + conditional) | ~300 | ~2,200 tokens |
| Complex (dashboard) | ~1,400 | ~400 (4 always-on + dashboard + bundle) | ~200 | ~2,000 tokens |

The 4x cost difference between simple and complex queries is intentional. Simple queries don't benefit from domain-specific rules; spending tokens on them would be waste.

---

## 4. Structured Output Engineering

### Pattern

Different agent nodes need different output formats. The key insight: **match the output format to the parsing strategy**. If you need a single classification, constrain to a single word. If you need structured data, embed the schema in the prompt. If you need machine-parseable metadata alongside human-readable text, use marker patterns.

### Output Format Taxonomy

| Format | Parser | When to Use | Example Node |
|--------|--------|-------------|-------------|
| Single word | `content.includes("COMPLEX")` | Binary/categorical classification | Classifier, tool router |
| JSON | `JSON.parse()` | Structured data extraction | Entity extractor, follow-up generator |
| Embedded markers | Regex extraction | Machine data in human text | Analysis metadata |
| Natural language | Pass-through | Free-form responses | Agent, responder |

### Single-Word Output

**Pattern**: Constrain the model to a single word by explicitly stating "Respond with only one word" and listing the valid options.

```
Respond with only one word: SIMPLE or COMPLEX
```

**Parsing strategy**: Forgiving matching that handles common model variations:

```typescript
const content = response.content.trim().toUpperCase();
const queryComplexity = content.includes("COMPLEX") ? "complex" : "simple";
```

This catches "COMPLEX", "COMPLEX.", "It is COMPLEX", and any other variation. The fallback to "simple" is intentional -- if the model outputs unexpected content, it's safer to handle it as a simple query (which goes to the responder) than to send it through the full tool pipeline.

### JSON Output

**Pattern**: Embed the exact JSON schema in the prompt with field descriptions and example values.

```
OUTPUT FORMAT (JSON only, no markdown):
[
  {"question": "...", "complexity": "simple", "category": "drill-down"},
  {"question": "...", "complexity": "medium", "category": "comparison"},
  {"question": "...", "complexity": "medium", "category": "trend"},
  {"question": "...", "complexity": "complex", "category": "optimization"}
]
```

**Parsing strategy**: Handle markdown code blocks (models sometimes wrap JSON in triple backticks):

```typescript
function parseResponse(response: string): StructuredFollowUp[] {
  let jsonStr = response.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr
      .replace(/```json?\n?/g, "")
      .replace(/```$/g, "")
      .trim();
  }
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(item =>
    item.question?.length >= 10 &&
    item.question?.length <= MAX_QUESTION_LENGTH
  ).slice(0, 4);
}
```

### Embedded Marker Pattern

**Pattern**: When a response needs both human-readable text and machine-parseable metadata, use XML-like markers to delimit the structured section.

```
[ANALYSIS_METADATA]{"confidence":"high","source":"database","completeness":100}[/ANALYSIS_METADATA]
```

This appears at the end of tool output. The human-readable analysis precedes it; the metadata block is extracted by the responder for confidence scoring and quality indicators.

**Why markers over separate fields**: Tool outputs flow through the LLM as conversation context. Separate JSON fields would require custom serialization. Markers keep everything in a single text stream that the LLM can read naturally while the system can parse programmatically.

### Zod `.describe()` for Tool Parameters

**Pattern**: Use Zod's `.describe()` method to document tool parameters. These descriptions are consumed by the LLM when it decides how to call tools -- they are LLM-facing documentation, not developer documentation.

```typescript
const AccountIdSchema = z.coerce.string()
  .optional()
  .describe("AWS account ID (12-digit string, e.g., '762715229080')");

const ExcludeIncompleteSchema = z.boolean()
  .optional()
  .describe("Exclude current incomplete month from analysis (set true for 'complete months' queries)");
```

**`createToolInputSchema()` factory pattern**: Shared schemas are composed into tool-specific input schemas using a factory function. This ensures consistency across tools while allowing each tool to add its own parameters.

```typescript
function createToolInputSchema(additionalFields?: ZodRawShape) {
  return z.object({
    accountId: AccountIdSchema,
    department: DepartmentSchema,
    domain: DomainSchema,
    service: ServiceSchema,
    ...additionalFields,
  });
}
```

---

## 5. Response Formatting & Sanitization Pipeline

### Pattern

LLM responses are messy. They may contain serialization artifacts (`[object Object]`), orphaned `undefined` tokens, excessive whitespace, or content that's just follow-up question lists without an actual answer. A three-stage sanitization pipeline cleans responses before they reach the user.

### Pipeline Stages

```
Raw LLM output
  |
  v
extractTextContent()     -- Handle content block arrays
  |
  v
sanitizeLLMOutput()      -- Remove artifacts, normalize whitespace
  |
  v
isFollowUpOnlyContent()  -- Detect answer-less responses
  |
  v
Clean output
```

### Stage 1: `extractTextContent()`

LLM APIs return content in different formats -- sometimes a plain string, sometimes an array of content blocks (text, tool_use, etc.). This function normalizes to a single string.

**Reference implementation** (`src/ai/graph/helpers/llm-output-utils.ts`):

```typescript
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(block => block.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("");
}
```

### Stage 2: `sanitizeLLMOutput()`

Removes common LLM serialization artifacts. The patterns are ordered from most specific to least specific to prevent partial matches.

```typescript
function sanitizeLLMOutput(content: string): string {
  return content
    .replace(/\[object Object\]undefined/g, "")   // Most specific first
    .replace(/\[object Object\]/g, "")             // Object artifacts
    .replace(/(\[object Object\])?undefined/g, "") // Optional object + undefined
    .replace(/^undefined\s*/gm, "")                // Line-start undefined
    .replace(/\s*undefined$/gm, "")                // Line-end undefined
    .replace(/\n{3,}/g, "\n\n")                    // Collapse excessive newlines
    .trim();
}
```

**Why these specific patterns**: These artifacts appear when the LLM concatenates a stringified object with an undefined variable (common in tool result formatting), or when content blocks have null text fields. Each pattern was added in response to a production incident.

### Table Cell Formatting

LLMs frequently add bold (`**`), italic (`*`), and emoji characters inside markdown table cells, even when instructed not to. This breaks table alignment in some renderers and creates visual noise.

**Two-pronged solution**:

1. **Prompt rules (~80% effective)**: Add explicit formatting constraints to the system prompt:
   ```
   No bold (**) or italic (*) formatting inside table cells.
   Keep cells as plain text and numbers only.
   ```

2. **Post-processing regex (catches the rest)**: Strip residual formatting from table rows after the LLM responds:
   ```typescript
   function sanitizeTableCells(content: string): string {
     return content.replace(
       /(\|[^\n]*\|)/g,
       (row) => row.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
     );
   }
   ```

**Lesson**: Prompt rules are the first line of defense but never achieve 100% compliance, especially across model versions. Post-processing provides a deterministic safety net. This two-layer approach applies to any LLM output constraint where formatting matters -- not just tables.

### Stage 3: `isFollowUpOnlyContent()`

Detects responses that contain only follow-up question suggestions without an actual answer. These occur when the agent generates follow-up questions as its "answer" instead of providing analysis.

```typescript
function isFollowUpOnlyContent(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed.startsWith("### Follow-up") ||
    trimmed.startsWith("## Follow-up") ||
    trimmed.startsWith("# Follow-up") ||
    trimmed.startsWith("Follow-up Questions") ||
    trimmed.startsWith("**Follow-up")
  );
}
```

When this returns `true`, the responder falls back to generating a response from tool results rather than using the agent's (non-)answer.

---

## 6. Hallucination Prevention Framework

### Pattern

Hallucination in agent systems is not just "making things up." It manifests in specific, predictable ways: fabricating reasons for missing data, inventing percentages, claiming discounts that exceed AWS maximums, and speculating about causes without evidence. A layered defense addresses each failure mode.

### 5-Layer Defense

| Layer | Mechanism | What It Catches | When Applied |
|-------|-----------|----------------|--------------|
| 1 | System prompt mandates | Sets behavioral constraints | Before LLM call |
| 2 | `NO_DATA_RESPONSES` | Standardized empty-data messages | In tool output |
| 3 | Hallucination regex detection | Fabricated explanations | Post-response |
| 4 | Output sanitization | Replaces hallucinated content | Post-detection |
| 5 | Response validation | Impossible values, scope mismatches | Before delivery |

### Layer 1: System Prompt Mandates

The base prompt includes explicit constraints against common hallucination patterns:

```
DATA FIDELITY (MANDATORY):
All numeric values MUST come directly from tool output.
- Quote exact figures (e.g., "$21,270.16" not "$21,000")
- NEVER fabricate, estimate, or extrapolate
- NEVER round unless tool output is rounded
- If not in tool output, say "data not available"
```

```
NEVER:
- Retry same tool 3+ times
- Pretend data exists when empty
- Make up explanations for missing data
```

### Layer 2: Standardized No-Data Responses

When a tool returns no data, it uses pre-defined responses instead of letting the LLM generate its own explanation.

**Reference implementation** (`src/ai/tools/helpers/no-data-handler.ts`):

```typescript
const NO_DATA_RESPONSES = {
  historical: "No data available for the requested period.",
  scope: "No data found for this scope.",
  service: "No costs recorded for this service in the specified period.",
  general: "No cost data found matching your criteria.",
  anomalies: "No anomalies detected in the specified period.",
  recommendations: "No optimization recommendations available for this scope.",
  forecast: "Unable to generate forecast - insufficient historical data.",
  trend: "Insufficient data to calculate trends for this period.",
  comparison: "Unable to compare periods - data unavailable for one or both periods.",
};
```

Each response is factual and makes no claims about why data is missing. Compare: "No data available for the requested period." vs. the hallucinated "Data collection wasn't enabled until 2024" -- the former states a fact, the latter fabricates an explanation.

### Layer 3: Hallucination Regex Detection

Even with system prompt constraints, models sometimes fabricate explanations for missing data. The `containsHallucinatedReason()` function catches these with 10 regex patterns.

```typescript
const HALLUCINATION_PATTERNS = [
  /data (?:only )?(?:goes|starts|is available|begins) (?:back|from)/i,
  /doesn't (?:go|extend|include) back/i,
  /wasn't (?:available|collected|recorded) (?:until|before)/i,
  /(?:this|the) data (?:is|was) (?:not|never) (?:collected|recorded|tracked)/i,
  /(?:may|might|could) not have been (?:tracked|recorded|available)/i,
  /(?:wasn't|has not been) (?:set up|configured|enabled)/i,
  /(?:may|might|could) not (?:exist|have existed)/i,
  /(?:wasn't) (?:in use|active|deployed)/i,
  /(?:back|prior to|before) (?:that|then|this) (?:time|date|period)/i,
  /historical (?:data|records) (?:aren't|are not|weren't) (?:available|kept|maintained)/i,
];
```

**What these catch**: The model saying "data doesn't go back that far" (fabricated limitation), "the service wasn't set up until 2024" (fabricated history), "historical records aren't maintained" (fabricated policy). None of these are facts from tool output -- they are confabulations.

### Layer 4: Sanitization

When a hallucinated reason is detected, it's replaced with the appropriate factual no-data response.

```typescript
function sanitizeNoDataResponse(
  response: string,
  noDataType: NoDataResponseType
): string {
  if (containsHallucinatedReason(response)) {
    console.warn("[NoDataHandler] Replacing hallucinated explanation");
    return NO_DATA_RESPONSES[noDataType];
  }
  return response;
}
```

### Layer 5: Response Validation

The response validator (Section 7) catches hallucinated values that pass through the earlier layers -- impossible percentages, fabricated discounts, scope mismatches.

### No-Data Type Detection

The `detectNoDataType()` function classifies the no-data scenario to select the right response:

```typescript
function detectNoDataType(content: string): NoDataResponseType | null {
  const lower = content.toLowerCase();

  if (/period|date|month|year|time/i.test(lower)) return "historical";
  if (/account|department|domain|scope/i.test(lower)) return "scope";
  if (/service/i.test(lower)) return "service";
  if (/anomal|spike|unusual/i.test(lower)) return "anomalies";
  if (/recommend|optimization|saving/i.test(lower)) return "recommendations";
  if (/forecast|predict|project/i.test(lower)) return "forecast";
  if (/trend|pattern|change over time/i.test(lower)) return "trend";
  if (/compare|comparison|versus|vs\b/i.test(lower)) return "comparison";
  if (isNoDataResponse(content)) return "general";

  return null;
}
```

### No-Data Response Detection

The `isNoDataResponse()` function determines if a tool output indicates no data was found:

```typescript
const NO_DATA_PATTERNS = [
  /no (?:cost )?data (?:found|available)/i,
  /no costs? recorded/i,
  /no (?:anomalies?|spikes?|patterns?) (?:found|detected)/i,
  /no (?:recommendations?|suggestions?) (?:found|available)/i,
  /insufficient (?:data|historical data)/i,
  /unable to (?:calculate|generate|compare|analyze)/i,
  /data (?:not available|unavailable)/i,
];

function isNoDataResponse(toolOutput: string | null): boolean {
  if (!toolOutput) return true;
  const lower = toolOutput.toLowerCase();
  return NO_DATA_PATTERNS.some(pattern => pattern.test(lower));
}
```

---

## 7. Validation Engineering (Block + Retry)

### Pattern

Response validation is a gate between the agent and the user. When the agent produces a response with impossible values, fabricated claims, or scope mismatches, the validator blocks the response and sends a correction prompt back to the agent for one retry. If the retry also fails, the response goes through with a disclaimer.

This is the **block + retry** strategy -- more thorough than log-and-pass, less disruptive than hard-fail.

### Validation Rules

Five validation rules run against every agent response before delivery.

**Reference implementation** (`src/ai/graph/nodes/response-validator.ts`):

| Rule | What It Catches | Severity | Example |
|------|----------------|----------|---------|
| `utilization_bounds` | Utilization percentages >100% | error | "CPU: 5,300,000,000%" |
| `negative_savings` | "Savings" described alongside cost increases | warning | "savings" + "costs increased" |
| `scope_alignment` | Response discusses wrong service | warning | Query asks about EC2, response discusses RDS |
| `empty_data_acknowledgment` | Hallucinated reasons for missing data | error | "Data wasn't collected until 2024" |
| `fabricated_discount` | Discount claims exceeding AWS maximum | error | "95% discount" (max is 72%) |

**Severity levels**:
- `error`: Blocks the response and triggers retry
- `warning`: Logged but doesn't block

### Block + Retry Flow

```
Agent generates response
  |
  v
Run all 5 validation rules
  |
  +-- No errors --> Pass to responder
  |
  +-- Errors found, retryCount < 1
  |     |
  |     v
  |   Build correction prompt from errors
  |   Increment retryCount
  |   Return to agent with corrections
  |     |
  |     v
  |   Agent generates corrected response
  |   Re-run validation
  |     |
  |     +-- No errors --> Pass to responder
  |     +-- Errors persist --> Add disclaimer, pass through
  |
  +-- Errors found, retryCount >= 1
        |
        v
      Append disclaimer: "_Note: Some values could not be verified._"
      Pass to responder
```

### Correction Prompt Generation

When errors are found, the validator builds a correction prompt from the specific issues:

```typescript
function buildCorrectionPrompt(issues: ValidationIssue[]): string {
  return issues
    .filter(i => i.severity === "error")
    .map(issue => {
      switch (issue.type) {
        case "impossible_value":
          return `CORRECTION NEEDED: ${issue.message}. Please verify the data.`;
        case "hallucination_risk":
          return `HALLUCINATION RISK: ${issue.message}. Use only factual statements.`;
        case "fabricated_claim":
          return `FABRICATED CLAIM: ${issue.message}. Remove or correct this claim.`;
        case "scope_mismatch":
          return `SCOPE ERROR: ${issue.message}. Focus only on the requested scope.`;
        case "sign_inversion":
          return `SIGN ERROR: ${issue.message}. Verify the direction of cost changes.`;
        default:
          return `CORRECTION: ${issue.message}`;
      }
    })
    .join("\n");
}
```

### Structured Failure Injection

The correction prompt above builds instructions from typed issue objects. A more powerful pattern stores the raw failure strings in graph state and injects them as a structured block into the retry prompt. This makes failures visible to any downstream node, not just the correction generator.

**Pattern**: Store `validationFailures: string[]` in graph state. When the downstream node (aggregator, responder, etc.) detects a non-empty array, it appends a `VALIDATION CORRECTIONS REQUIRED` block to its LLM prompt.

```typescript
// Validator stores typed failures in state
if (!result.passed) {
  return {
    validationResult: "fail",
    validationFailures: result.failures,  // e.g., ["[impossible_value] CPU at 340%"]
    retryCount: retryCount + 1,
  };
}

// Downstream node injects failures into its prompt
let correctionSuffix = "";
if (state.validationFailures.length > 0) {
  const failureList = state.validationFailures.map(f => `- ${f}`).join("\n");
  correctionSuffix = `\n\nVALIDATION CORRECTIONS REQUIRED:\n${failureList}\n\nFix these issues. Use only values present in the tool data.`;
}
```

**Key design decisions**:

| Decision | Why |
|----------|-----|
| Rule name as prefix (`[impossible_value]`) | Anchors the LLM to the specific failure type, reducing hallucinated "fixes" |
| Additive, not replacement | Failures are appended to the existing prompt -- the node retains full context |
| Typed array, not freeform string | Downstream nodes can count, filter, or format failures independently |
| Any node can read failures | The aggregator, responder, or formatter can all react to validation state |

**When this matters**: Without structured injection, the retry node regenerates a response from scratch with only a vague "try again" signal. With injection, the LLM knows *exactly* what went wrong and what to fix.

### Routing After Validation

```typescript
function routeAfterValidation(state: CostAnalysisStateType): "retry" | "pass" {
  if (!state.validationResult?.passed && state.retryCount < 2) {
    return "retry";
  }
  return "pass";
}
```

### Utilization Bounds Check (Example Rule Implementation)

> **Domain example (AWS Cost Analyzer):** This rule checks that CPU/memory utilization percentages don't exceed 100%. The reusable pattern is: regex-match numeric values in LLM output, then validate against domain bounds.

```typescript
{
  name: "utilization_bounds",
  check: (content: string): ValidationIssue | null => {
    const percentagePatterns = [
      /(CPU|memory|utilization)[^%]*?(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*%/gi,
      /(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*%\s*(CPU|memory|utilization)/gi,
    ];

    for (const pattern of percentagePatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const numStr = match[2]?.replace(/,/g, "") || match[1]?.replace(/,/g, "");
        if (numStr) {
          const value = parseFloat(numStr);
          if (value > VALIDATION_CONSTANTS.UTILIZATION_MAX) {
            return validateUtilization("utilization", value);
          }
        }
      }
    }
    return null;
  },
}
```

### Output Validation Constants

The **reusable pattern** is: define domain-specific thresholds as a typed constant object, then reference them in validation functions. This separates "what counts as invalid" (thresholds) from "how to check" (validation logic).

> **Domain example (AWS Cost Analyzer):** The constants below encode AWS-specific business rules. Replace these with your domain's thresholds -- e.g., SLA percentages, inventory limits, or financial tolerances.

The output validator (`src/ai/graph/helpers/output-validator.ts`) defines domain-specific thresholds:

```typescript
const VALIDATION_CONSTANTS = {
  UTILIZATION_MAX: 100,              // CPU/memory can't exceed 100%
  COST_PRECISION: 2,                 // 2 decimal places for costs
  PERCENTAGE_DISCREPANCY_THRESHOLD: 1, // 1% tolerance for percentage calculations
  SPIKE_THRESHOLD: 80,              // Max CPU >80% = not a rightsizing candidate
  AWS_MAX_DISCOUNT: 72,             // Max AWS discount: 3-year all-upfront reserved
  DATA_CONSISTENCY_TOLERANCE: 1.0,  // $1 tolerance for cross-tool total alignment
  MIN_COST_THRESHOLD: 0.01,        // Minimum cost to consider
};
```

### Output Validation Functions

The **reusable pattern** is: one validator per value type, each returning a `ValidationIssue | null`. The validator names and thresholds are domain-specific; the shape (field name pattern matching + bounds check + issue report) is reusable.

> **Domain example (AWS Cost Analyzer):** The functions below validate AWS cost and utilization data. In a different domain, you would replace these with validators for your value types -- e.g., `validateInventoryCount()`, `validateLatency()`, `validateSLACompliance()`.

Ten validation functions cover different value types:

| Function | What It Validates | Threshold |
|----------|------------------|-----------|
| `validatePercentage()` | Percentage in 0-100% range | Configurable max |
| `validateCost()` | Non-negative, finite cost values | >= $0.01 |
| `validateUtilization()` | Utilization in 0-100% range | Exactly 100% max |
| `validateAggregation()` | Parts sum to total | $1.00 tolerance |
| `verifyPercentageCalculation()` | Math accuracy of claimed percentages | 1% tolerance |
| `validateSavings()` | Correct sign (positive = decrease) | Sign check |
| `validateTimeframeMatch()` | Requested vs returned date alignment | Strict equality |
| `validateDataConsistency()` | Cross-tool total alignment | $1.00 tolerance |
| `detectFabricatedClaims()` | Discount <= 72% | AWS_MAX_DISCOUNT |
| `validateSpikePattern()` | Peak CPU >80% excludes rightsizing | 80% threshold |

### False Positive Mitigation

Validation rules that pattern-match against natural language responses will produce false positives. A rule checking for "fabricated identifiers" (names in backticks not found in tool output) will flag legitimate domain terms, field paths, and compound identifiers. Three strategies mitigate this without weakening the rules:

**Strategy 1: Exemption list for common domain terms**

Maintain a `Set` of terms that frequently appear in responses but don't come from tool output (e.g., `"index"`, `"shard"`, `"status"`, `"health"`). Check the exemption list before flagging.

```typescript
const COMMON_TERMS = new Set(["index", "cluster", "node", "shard", "replica", "health", "status"]);

function isCommonTerm(term: string): boolean {
  return COMMON_TERMS.has(term.toLowerCase());
}
```

**Strategy 2: Segment matching for dotted compound identifiers**

Field paths like `data_stream.dataset` or `service.name` should not be flagged as fabricated. Split on `.` and check if any segment is a common term.

```typescript
if (term.includes(".")) {
  return term.split(".").some(segment => COMMON_TERMS.has(segment));
}
```

**Strategy 3: Context-aware skip when no tool outputs exist**

When the response is based purely on conversation context (e.g., a follow-up question), there are no tool outputs to validate against. Attempting validation would flag every identifier. Skip the rule entirely.

```typescript
if (toolOutputs.length === 0) return null;
```

**Decision table**:

| Condition | Strategy | Why |
|-----------|----------|-----|
| Term is a known domain concept | Exemption list | It's vocabulary, not a fabricated name |
| Term contains `.` separators | Segment matching | Dotted paths are field references, not identifiers |
| No tool outputs in state | Context-aware skip | Nothing to validate against -- all matches are false positives |

**Lesson**: Start strict (flag everything that doesn't match tool output), then add exemptions incrementally from production incidents. Each exemption should be traceable to a specific false positive. Resist preemptive exemptions -- they mask real hallucinations.

### Automated Tool Output Scanning

The **reusable pattern** is: walk all numeric fields in tool output and dispatch to the appropriate validator based on field name patterns. The field-name-to-validator mapping is domain-specific.

> **Domain example (AWS Cost Analyzer):** The patterns below map AWS cost field names to validators. Replace with your domain's field naming conventions.

The `runToolOutputValidation()` function scans all numeric fields in tool output and applies appropriate validators based on field name patterns:

```typescript
function runToolOutputValidation(
  toolName: string,
  output: Record<string, unknown>
): ValidationIssue[] {
  // Scans all numeric fields:
  // - "utilization|cpu|memory" + "percent|%" -> validateUtilization
  // - "cost|spend|savings" -> validateCost
  // - "discount" -> validatePercentage (max: AWS_MAX_DISCOUNT)
}
```

---

## 8. Tool Output Quality Assurance

### Pattern

Every tool output should carry metadata about its quality: how confident are we in this data? What's the source? How complete is the date range? What caveats should the user know? This metadata serves two purposes: it helps the LLM frame its response appropriately, and it gives the user transparency about data quality.

### AnalysisMetadata Interface

The **reusable pattern** is: attach metadata to every tool output so the LLM can frame its response appropriately and users can assess data quality. The `source` enum values are domain-specific.

> **Domain example (AWS Cost Analyzer):** The `source` field includes `"aws_forecast"` which is AWS-specific. Replace with your domain's data sources (e.g., `"api"`, `"cache"`, `"user_input"`, `"ml_model"`).

**Reference implementation** (`src/ai/tools/helpers/analysis-metadata.ts`):

```typescript
interface AnalysisMetadata {
  confidence: "high" | "medium" | "low";
  source: "database" | "calculated" | "projected" | "aws_forecast";
  methodology: string;
  dataCompleteness: number; // 0-100
  dateRange?: { start: string; end: string };
  recordCount?: number;
  assumptions?: string[];
  caveats?: string[];
}
```

### Confidence Calculation Decision Tree

> **Domain example (AWS Cost Analyzer):** The branching logic below encodes AWS-specific confidence rules (e.g., AWS forecasts get high confidence). Replace the source-specific branches with your domain's confidence heuristics.

```typescript
function calculateConfidence(params: {
  recordCount: number;
  dataCompleteness: number;
  hasProjections: boolean;
  isPartialMonth: boolean;
  source: AnalysisMetadata["source"];
}): "high" | "medium" | "low" {
  // No records = no confidence
  if (params.recordCount === 0) return "low";

  // AWS forecasts with good data = high confidence
  if (params.source === "aws_forecast" && params.dataCompleteness >= 80) return "high";

  // Projections or partial months cap at medium
  if (params.hasProjections || params.isPartialMonth) {
    return params.dataCompleteness >= 80 ? "medium" : "low";
  }

  // Database queries
  if (params.source === "database") {
    if (params.dataCompleteness === 100 && params.recordCount >= 1) return "high";
    if (params.dataCompleteness >= 70 && params.recordCount >= 5) return "medium";
    return "low";
  }

  // Calculated/derived data caps at medium
  if (params.source === "calculated") {
    return params.dataCompleteness >= 80 ? "medium" : "low";
  }

  return "medium";
}
```

**Key design decisions**:
- AWS forecasts get `high` confidence because they use ML models trained on AWS's full dataset
- Projections and partial months cap at `medium` regardless of completeness -- they are estimates
- Database queries need both high completeness AND sufficient records for `high`
- Calculated/derived data never exceeds `medium` -- it's one step removed from source

### Standard Caveats

```typescript
function getStandardCaveats(params: {
  isPartialMonth?: boolean;
  hasProjections?: boolean;
  isCrossAccount?: boolean;
  hasSmallSampleSize?: boolean;
}): string[] {
  const caveats: string[] = [];
  if (params.isPartialMonth) caveats.push("Current month data is incomplete (MTD)");
  if (params.hasProjections) caveats.push("Projections are estimates based on current usage patterns");
  if (params.isCrossAccount) caveats.push("Aggregated across multiple accounts - individual account patterns may vary");
  if (params.hasSmallSampleSize) caveats.push("Limited data points - conclusions should be verified with longer time periods");
  return caveats;
}
```

### Dual Output Format

Tool outputs include both human-readable and machine-parseable metadata:

```typescript
function appendAnalysisMetadata(
  humanReadableOutput: string,
  metadata: AnalysisMetadata
): string {
  const formattedText = formatMetadataText(metadata);
  const jsonBlock = `[ANALYSIS_METADATA]${JSON.stringify(metadata)}[/ANALYSIS_METADATA]`;
  return `${humanReadableOutput}\n\n${formattedText}\n${jsonBlock}`;
}
```

**Human-readable format**:
```
--- Analysis Quality ---
Confidence: HIGH
Data Source: Database
Data Completeness: 100%
Records Analyzed: 847
Date Range: 2025-07 to 2025-12
Caveats:
  - Aggregated across multiple accounts - individual account patterns may vary
```

**Machine-parseable**: The `[ANALYSIS_METADATA]` block is extracted by downstream processing for confidence scoring.

### Partial Month Detection

```typescript
function isCurrentMonthPartial(
  queryEndDate?: string,
  actualDaysWithData?: number
): { isPartial: boolean; completeness: number } {
  // Past months are complete
  if (queryEndDate < currentMonth) return { isPartial: false, completeness: 100 };

  // Future months have no data
  if (queryEndDate > currentMonth) return { isPartial: true, completeness: 0 };

  // Current month: calculate from days with data
  const completeness = (actualDaysWithData / totalDaysInMonth) * 100;
  return { isPartial: true, completeness };
}
```

### Data Completeness Calculation

```typescript
function calculateDateRangeCompleteness(
  startDate: string,
  endDate: string,
  recordCount: number,
  expectedRecordsPerDay: number = 50
): number {
  const daysDiff = Math.ceil((end - start) / MS_PER_DAY);
  const expectedRecords = daysDiff * expectedRecordsPerDay;
  return Math.min(100, (recordCount / expectedRecords) * 100);
}
```

---

## 9. Follow-Up Question Generation

### Pattern

Follow-up questions are a self-contained subsystem with its own LLM call, prompt, validation, and fallback chain. They serve a dual purpose: guide the user toward deeper analysis, and demonstrate the system's capabilities. The key constraints are a 70-character maximum (for UI pill buttons) and a complexity distribution (1 simple, 2 medium, 1 complex).

### System Architecture

The follow-up generator runs independently of the main response pipeline:

```
Main response delivered
  |
  v
Follow-up generator (async via SSE)
  |
  +-- LLM generates 4 questions
  |     |
  |     v
  |   Parse JSON response
  |   Validate character limits (10-70 chars)
  |   Validate complexity distribution
  |     |
  |     +-- Valid questions --> Return
  |     +-- Parse failure --> Fallback templates
  |
  +-- LLM call fails --> Fallback templates
```

### Generation Prompt

**Reference implementation** (`src/ai/services/follow-up-generator.ts`):

The system prompt enforces character limits with examples:

```
CRITICAL CONSTRAINT (NON-NEGOTIABLE):
ALL questions MUST be under 70 characters total.
Questions display in pill buttons - keep them concise.

GOOD EXAMPLES (under 70 chars):
- "Top 3 OIT services?" (20 chars)
- "Compare to last month?" (22 chars)
- "What were the top services by cost?" (36 chars)

BAD EXAMPLES (too long - DO NOT USE):
- "How did the OIT department costs compare to the overall company budget this quarter?" (85 chars)
```

**Complexity distribution**:

| Count | Complexity | Purpose | Example |
|-------|-----------|---------|---------|
| 1 | simple | Direct lookup | "Total cost?", "Top service?" |
| 2 | medium | Comparison/analysis | "Compare to Oct?", "Cost by account?" |
| 1 | complex | Strategic synthesis | "Top savings?", "Q1 forecast?" |

**Category guidelines**:

| Category | Purpose |
|----------|---------|
| drill-down | Explore deeper into a specific aspect mentioned |
| comparison | Compare across time, accounts, or services |
| optimization | Focus on cost savings |
| trend | Analyze patterns over time |
| exploration | Discover related areas |

### Context Provided to Generator

The generator receives rich context to produce relevant questions:

```typescript
interface FollowUpGeneratorContext {
  finalAnswer: string;        // AI response (truncated to 600 chars)
  query: string;              // User's original query
  organizationalContext: {    // Scope and cost data
    nodeType: string;
    nodeName: string;
    costData?: { currentMonthCost: number; trend: number };
  } | null;
  extractedEntities: {        // Services, departments, accounts, timeframe
    services: Array<{ shortName: string }>;
    departments: Array<{ name: string }>;
    accounts: Array<{ name: string }>;
    timeframe: { description: string };
  } | null;
  toolsUsed: string[];        // Which tools were called
  pageContext: {               // Which UI page
    pageName: string;
    route: string;
  } | null;
}
```

### Validation

```typescript
const MAX_QUESTION_LENGTH = 70;
const validQuestions = parsed.filter(item =>
  item.question &&
  typeof item.question === "string" &&
  item.question.length >= 10 &&
  item.question.length <= MAX_QUESTION_LENGTH
).slice(0, 4);
```

Questions shorter than 10 characters are too vague ("Costs?"). Questions longer than 70 characters overflow the pill button UI.

### Length Limit Tuning

The max character limit is a domain-specific tuning parameter, not a universal constant. A fixed 70-character limit may work for simple domains but can cause a 100% filter rate in domains with long technical vocabulary (e.g., infrastructure names, compound field paths, service identifiers).

**Factors that determine the right limit**:

| Factor | Effect on limit |
|--------|----------------|
| UI container width | Hard ceiling -- questions must not wrap or truncate |
| Domain vocabulary | Long service/entity names push question length up |
| Question complexity | Multi-entity comparisons need more characters |
| Condensation system | A second LLM pass can compress, raising the effective ceiling |

**Pattern: Always fall back to templates when all suggestions are filtered**

```typescript
const filtered = parsed.filter(s => s.length >= MIN_LENGTH && s.length <= MAX_LENGTH);
if (filtered.length > 0) {
  return filtered.slice(0, 4);
}
// All LLM suggestions exceeded the length limit -- use templates
logger.warn("All LLM suggestions filtered by length constraints, using fallbacks");
return getFallbackSuggestions(context);
```

Log when all suggestions are filtered -- a sustained 100% filter rate means the limit needs adjustment. Typical range: 70-100 characters depending on domain.

### Condensation System

When the LLM generates questions over 70 characters, a second LLM call condenses them:

```
TASK: Reword verbose follow-up questions into concise, natural-sounding questions.

RULES:
1. Write complete, grammatically correct questions (not fragments)
2. Avoid abbreviations - write "compared to" not "vs"
3. Keep AWS service names readable
4. Start with action words: "Show", "Compare", "What", "Which", "How"
5. Target 30-50 characters when possible (max 70)
```

### Template Fallback

When LLM generation fails (parsing error, API failure), template-based questions provide a reliable fallback:

```typescript
function getFallbackQuestions(context: FollowUpGeneratorContext): string[] {
  const questions: string[] = [];

  // Context-aware templates
  switch (context.organizationalContext?.nodeType) {
    case "organization": questions.push("Which dept costs most?");      break;
    case "department":   questions.push("Compare costs by account?");   break;
    case "account":      questions.push("Top cost drivers?");           break;
    case "service":      questions.push("Cost change over time?");      break;
  }

  // Tool-aware templates
  if (context.toolsUsed.includes("trend_analysis_tool")) {
    questions.push("What drives this trend?");
  }
  if (context.toolsUsed.includes("optimization_tool")) {
    questions.push("Top savings opportunities?");
  }

  // Generic fill (all under 70 chars)
  const generic = [
    "Breakdown by service?",
    "Any optimization tips?",
    "Compare to last month?",
    "Fastest growing services?",
  ];

  while (questions.length < 4 && generic.length > 0) {
    const q = generic.shift();
    if (q && !questions.includes(q)) questions.push(q);
  }

  return questions.slice(0, 4);
}
```

### Model Configuration

```typescript
const llm = createChatBedrockBearerHaiku({
  temperature: 0.3,  // Some creativity for variety
  maxTokens: 512,    // Sufficient for 4 questions
});
```

Temperature 0.3 introduces enough variety that repeated queries get different follow-ups, while staying constrained enough that questions remain relevant and well-formed.

---

## 10. Context Window & Token Budget Management

### Pattern

Multi-turn conversations accumulate state: messages, tool results, reasoning steps, tool execution records. Without pruning, the context window fills up, causing either truncation (losing important context) or API errors. A state pruning system keeps the conversation within bounds while preserving the most important context.

### Pruning Configuration

**Reference implementation** (`src/ai/graph/state-pruning.ts`):

```typescript
const DEFAULT_PRUNING_CONFIG = {
  maxMessages: 10,           // Keep last 10 messages
  maxToolResults: 5,         // Keep last 5 tool results
  maxReasoningSteps: 15,     // Keep last 15 reasoning steps
  maxToolExecutions: 20,     // Keep last 20 tool execution records
  preserveSystemMessages: true, // Never prune system messages
};
```

### Trigger Conditions

Pruning is not applied on every turn. The `needsPruning()` function checks whether any state field exceeds its threshold:

```typescript
function needsPruning(state: CostAnalysisStateType, config: PruningConfig): boolean {
  return (
    state.messages.length > config.maxMessages ||
    state.toolExecutions.length > config.maxToolExecutions ||
    state.reasoningSteps.length > config.maxReasoningSteps
  );
}
```

### Message Pruning Strategy

```typescript
function pruneMessages(
  messages: BaseMessage[],
  maxMessages: number,
  preserveSystem: boolean
): BaseMessage[] {
  // 1. Separate system messages from non-system
  const system = messages.filter(m => m._getType() === "system");
  const nonSystem = messages.filter(m => m._getType() !== "system");

  // 2. Calculate available slots for non-system messages
  const availableSlots = Math.max(0, maxMessages - system.length);

  // 3. Keep most recent non-system messages
  const kept = nonSystem.slice(-availableSlots);

  // 4. Remove orphaned tool messages
  const sanitized = removeOrphanedToolMessages(kept);

  // 5. Combine: system first, then sanitized non-system
  return [...system, ...sanitized];
}
```

**Key design decisions**:
- System messages are always preserved (they contain the agent's instructions)
- Most recent messages are kept, oldest are dropped (recency bias is correct for conversations)
- Orphaned tool messages (tool results without a preceding human/AI message) are removed to prevent confusion

### Orphaned Tool Message Cleanup

```typescript
function removeOrphanedToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const result: BaseMessage[] = [];
  let foundNonToolMessage = false;

  for (const msg of messages) {
    if (msg._getType() !== "tool") {
      foundNonToolMessage = true;
      result.push(msg);
    } else if (foundNonToolMessage) {
      result.push(msg);
    }
    // Skip tool messages that appear before any non-tool message
  }

  return result;
}
```

### Other State Pruning

Tool executions, reasoning steps, and tools used are pruned with simpler strategies:

```typescript
// Keep most recent N entries
function pruneToolExecutions(executions: ToolExecution[], max: number): ToolExecution[] {
  return executions.slice(-max);
}

function pruneReasoningSteps(steps: string[], max: number): string[] {
  return steps.slice(-max);
}

// Deduplicate while preserving order
function pruneToolsUsed(tools: string[]): string[] {
  return [...new Set(tools)];
}
```

### Conversation Summary for Pruned Context

When messages are pruned, a summary preserves the gist of removed content:

```typescript
function createConversationSummary(prunedMessages: BaseMessage[]): string | null {
  const topics = prunedMessages
    .filter(m => m._getType() === "human")
    .map(m => typeof m.content === "string" ? m.content.slice(0, 100) : "")
    .filter(Boolean);

  if (topics.length === 0) return null;
  return `Previous conversation covered: ${topics.join("; ")}`;
}
```

### Pruning Statistics

Every pruning operation returns statistics for observability:

```typescript
interface PruningStats {
  messagesPruned: number;
  toolResultsPruned: number;
  reasoningStepsPruned: number;
  toolExecutionsPruned: number;
  originalMessageCount: number;
  finalMessageCount: number;
}
```

---

## 11. Classification Caching & Performance

### Pattern

Classification and tool routing are the most frequently called LLM operations -- every query triggers both. Caching their results avoids redundant LLM calls for repeated or structurally similar queries. The caching strategy uses two layers: pattern matching (for common query types) and exact matching (for repeated queries).

### Classifier Cache

**Reference implementation** (`src/ai/graph/cache/classifier-cache.ts`):

| Property | Value | Rationale |
|----------|-------|-----------|
| TTL | 10 minutes | Classifications are stable but not permanent |
| Max size | 500 entries | Bounded memory, covers typical session |
| Strategy | Pattern + exact match | Patterns for common types, exact for repeats |
| Eviction | LRU (non-pattern first) | Preserve pattern entries, evict exact matches |

**Pattern-based matching**: Pre-defined regex patterns match common query types without needing an LLM call.

```typescript
const patterns = [
  // Simple patterns (greetings, help)
  { regex: /^(hi|hello|hey|howdy|greetings)[\s!.,?]*$/i, key: "greeting", result: "simple" },
  { regex: /^help[\s!.,?]*$/i, key: "help", result: "simple" },
  { regex: /what (can you|are you able to) do/i, key: "capabilities", result: "simple" },
  { regex: /^(thanks|thank you|cheers)[\s!.,?]*$/i, key: "thanks", result: "simple" },
  { regex: /^(bye|goodbye|see you)[\s!.,?]*$/i, key: "goodbye", result: "simple" },
  { regex: /^who are you/i, key: "identity", result: "simple" },

  // Complex patterns (cost queries)
  { regex: /show.*costs?.*for/i, key: "show_costs", result: "complex" },
  { regex: /what.*spend|how much.*(cost|spend)/i, key: "cost_inquiry", result: "complex" },
  { regex: /compare.*costs?/i, key: "comparison", result: "complex" },
  { regex: /trend|trending|over time/i, key: "trend", result: "complex" },
  { regex: /forecast|predict|projection/i, key: "forecast", result: "complex" },
  { regex: /optimiz|recommend|savings?/i, key: "optimization", result: "complex" },
  { regex: /ec2|s3|rds|lambda|ebs|cloudfront/i, key: "service_mention", result: "complex" },
  { regex: /who (is|are) (the )?(approver|owner|manager)/i, key: "organizational_who", result: "complex" },
];
```

**Cache key strategy**:
- Pattern matches use `pattern:greeting`, `pattern:cost_inquiry`, etc.
- Exact matches use `exact:normalized_query`
- Normalization: lowercase, trim, collapse whitespace

**Eviction priority**: Non-pattern entries are evicted before pattern entries. Patterns are reusable across users; exact matches are session-specific.

```typescript
private findOldestNonPatternEntry(): string | null {
  let oldestKey: string | null = null;
  let oldestTimestamp = Infinity;

  // First pass: find oldest exact match
  for (const [key, entry] of this.cache.entries()) {
    if (!key.startsWith("pattern:") && entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
      oldestKey = key;
    }
  }

  // Second pass: if no exact matches, find oldest pattern
  if (!oldestKey) {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }
  }

  return oldestKey;
}
```

### Tool Router Cache

**Reference implementation** (`src/ai/graph/cache/tool-router-cache.ts`):

| Property | Value | Rationale |
|----------|-------|-----------|
| TTL | 15 minutes | Longer than classifier -- routing is more stable |
| Max size | 500 entries | Same as classifier |
| Strategy | Normalized exact match | No pattern matching needed |
| Eviction | Oldest entry first | Simple LRU |
| Module load | Cache cleared | Fresh classifications after code changes |

```typescript
class ToolRouterCache {
  private readonly TTL = 900_000; // 15 minutes
  private readonly MAX_SIZE = 500;

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, " ");
  }
}

// Clear on module load for fresh classifications after code changes
toolRouterCache.clear();
```

**Why clear on module load**: Tool routing logic evolves with code changes. Stale cache entries from before a deployment could route queries to the wrong tool bundle. Clearing on load is cheap (the cache refills quickly) and prevents stale routing.

### Cache Statistics

Both caches expose statistics for monitoring:

```typescript
// Classifier cache stats
{ size: number, patternEntries: number, exactEntries: number, totalHits: number }

// Tool router cache stats
{ size: number, totalHits: number }
```

### Performance Impact

Without caching, every query requires 2 LLM calls just for classification and routing (before the agent even starts). With caching:

- Greetings and common patterns: 0 LLM calls (pattern cache hit)
- Repeated queries in a session: 0 LLM calls (exact cache hit)
- Novel queries: 2 LLM calls (cache miss, then cached for next time)

The classifier uses Haiku with `maxTokens: 50` -- each uncached call is fast and cheap. But across thousands of queries per day, caching eliminates a significant portion of LLM API costs.

---

## 12. Error Resilience & Graceful Degradation

### Pattern

Tool executions in agent systems can fail for many reasons: database timeouts, API rate limits, network issues, or bugs. The error resilience strategy has three layers: retry transient failures, degrade gracefully for persistent failures, and never present errors as if they were answers.

### Tool Retry Middleware

**Reference implementation** (`src/ai/middleware/tool-retry.ts`):

The `withRetry()` wrapper adds retry logic to any LangGraph tool:

```typescript
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 2,
  backoffFactor: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  jitter: true,
  retryOn: defaultRetryCondition,
  onFailure: "continue",
};
```

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `maxRetries` | 2 | Total attempts = maxRetries + 1 = 3 |
| `backoffFactor` | 2 | Exponential: 500ms, 1000ms, 2000ms |
| `initialDelayMs` | 500 | First retry after 500ms |
| `maxDelayMs` | 5000 | Cap at 5 seconds regardless of exponential growth |
| `jitter` | true | Add 0-50% random delay to prevent thundering herd |
| `onFailure` | "continue" | Return error message instead of throwing |

### Backoff Calculation

```typescript
function calculateDelay(config: RetryConfig, attempt: number): number {
  const baseDelay = config.initialDelayMs * config.backoffFactor ** attempt;
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);

  if (config.jitter) {
    const jitterAmount = cappedDelay * Math.random() * 0.5;
    return Math.round(cappedDelay + jitterAmount);
  }

  return cappedDelay;
}
```

**Delay progression** (with jitter range):

| Attempt | Base Delay | Capped Delay | With Jitter |
|---------|-----------|-------------|-------------|
| 0 | 500ms | 500ms | 500-750ms |
| 1 | 1,000ms | 1,000ms | 1,000-1,500ms |
| 2 | 2,000ms | 2,000ms | 2,000-3,000ms |
| 3+ | 4,000ms+ | 5,000ms | 5,000-7,500ms |

### Retryable Error Classification

Not all errors should be retried. Transient errors (timeouts, connection issues) are retryable; permanent errors (invalid input, missing data) are not.

```typescript
function defaultRetryCondition(error: Error): boolean {
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    "timeout", "timed out",
    "connection", "network",
    "econnreset", "econnrefused",
    "socket hang up",
    "is not a function",
    "cannot read properties",
    "temporarily unavailable", "service unavailable",
    "rate limit", "throttl",
  ];
  return retryablePatterns.some(pattern => message.includes(pattern));
}
```

**Why "is not a function" and "cannot read properties"**: These JavaScript errors can indicate a timing issue -- a module not yet initialized, a connection not yet established. Retrying after a brief delay often succeeds.

### Failure Handling Modes

```typescript
type OnFailure = "error" | "continue" | ((error: Error) => string);
```

| Mode | Behavior | Use Case |
|------|----------|----------|
| `"error"` | Throw the error | Critical operations where the caller handles errors |
| `"continue"` | Return JSON error message | Tool calls where the agent should see the error and adapt |
| Custom function | Return custom error message | Database operations with specific retry guidance |

**Default "continue" behavior**:

```typescript
JSON.stringify({
  error: true,
  tool: toolName,
  message: `Tool "${toolName}" failed after 3 attempts: ${error.message}`,
  suggestion: "Try a different query type or time period.",
});
```

The agent sees this as a tool result and can decide how to proceed -- acknowledge the error, try a different tool, or report the limitation to the user.

### Database-Specific Retry

```typescript
function withDatabaseRetry(
  tool: DynamicStructuredTool,
  overrides?: Partial<RetryConfig>
): StructuredToolInterface {
  return withRetry(tool, {
    maxRetries: 2,
    retryOn: (error) => {
      const message = error.message.toLowerCase();
      return (
        message.includes("is not a function") ||
        message.includes("timeout") ||
        message.includes("connection") ||
        message.includes("econnreset") ||
        message.includes("cannot read properties")
      );
    },
    onFailure: (error) => JSON.stringify({
      error: true,
      message: `Database query failed: ${error.message}.`,
      suggestion: "Try: 1) A different time range, 2) A simpler query, or 3) Wait and retry.",
    }),
    ...overrides,
  });
}
```

### Graceful Degradation Hierarchy

When a tool fails permanently, the system degrades gracefully rather than crashing:

```
Tool succeeds
  --> Return full analysis

Tool fails, retry succeeds
  --> Return full analysis (user never knows)

Tool fails after all retries
  --> Agent receives error as tool result
  --> Agent acknowledges limitation in response
  --> Agent may try alternative tool/approach
  --> User sees partial analysis with explanation

All tools fail
  --> System prompt's GRACEFUL FAILURE PROTOCOL kicks in:
      1. Acknowledge limitation clearly
      2. Don't retry same tool
      3. Explain what data IS available
      4. Suggest alternative queries

Agent itself fails
  --> Responder generates basic response from available state
  --> User sees simplified answer with no tool-backed analysis
```

The key principle: **never present an error as if it were an answer**. The user should always know when data is missing, why it's missing (to the extent known), and what they can do instead.

---

## 13. Complementary Tool Pairing

### Pattern

Individual tools often return partial views of a system. Tool A might provide aggregate totals but no per-node breakdown; Tool B might provide per-node metrics but no aggregates. When the system prompt delegates tool selection to the model, the model has no way to know that Tool A and Tool B are complementary -- it calls whichever one seems most relevant and stops, leaving gaps in the response.

The fix is **complementary tool pairing**: explicit prompt guidance that tells the model which tools must be called together and why each one is insufficient alone.

### When to Apply

- A user question requires data that spans two or more tools with non-overlapping outputs
- Tool A returns metric X but not Y; Tool B returns Y but not X
- The model consistently calls only one tool and produces incomplete tables (diagnosed from traces or user feedback)
- Tool descriptions individually sound sufficient, but their actual return schemas have blind spots

### Prompt Structure

Add a dedicated constraint to the operational constraints section of the system prompt. The constraint must specify:

1. **The trigger** -- what kind of query activates this pairing
2. **Which tools to call** -- by name, with parameter recommendations
3. **What each tool contributes** -- so the model understands why both are needed
4. **What each tool lacks** -- so the model does not assume one is sufficient

```
For comprehensive overviews that include store size and resource utilization:
  call get_cluster_stats for document/store totals,
  AND get_nodes_stats with metric: "os,jvm,fs" for CPU, heap, and disk capacity.
Neither tool alone provides the complete picture --
  cluster_stats has store totals but not disk capacity;
  nodes_stats has disk/CPU/heap but not index counts.
```

### Anti-Patterns

**Vague guidance** -- "Call multiple tools for comprehensive queries" gives the model no signal about which tools to pair. It will still pick one and stop.

**Redundant pairing** -- If two tools return overlapping data, pairing them wastes tokens on duplicate results. Only pair tools with genuinely non-overlapping outputs.

**Parameter omission** -- Telling the model to call a tool without specifying the right parameters leads to partial data. If a metrics tool defaults to "os,jvm" but disk data requires the "fs" metric, the constraint must include `metric: "os,jvm,fs"`.

### Discovery Process

Complementary pairings are discovered empirically, not designed upfront:

1. **Observe gaps in traces** -- Look at LangSmith traces where the model produces "-" or "N/A" in response tables
2. **Compare tool schemas** -- Map the return fields of each tool to identify non-overlapping coverage
3. **Add the pairing constraint** -- Write the prompt guidance with explicit "has X but not Y" language
4. **Validate with the same query** -- Re-run the query that triggered the gap and confirm both tools are called

### Reference Implementation

**Before** (single constraint, model called only one tool):

```
Prefer indices_summary for cluster-wide overview (lightweight cat API).
Use get_cluster_stats only when you specifically need JVM/node-level metrics.
```

**After** (complementary pairing, model calls both):

```
Prefer indices_summary for cluster-wide overview (lightweight cat API).
For comprehensive overviews that include store size and resource utilization:
  call get_cluster_stats for document/store totals,
  AND get_nodes_stats with metric: "os,jvm,fs" for CPU, heap, and disk capacity.
Neither tool alone provides the complete picture --
  cluster_stats has store totals but not disk capacity;
  nodes_stats has disk/CPU/heap but not index counts.
```

Source: `packages/agent/src/prompt-context.ts` -- operational constraints section.

The "neither tool alone" phrasing is deliberate. It signals to the model that calling just one is insufficient, which overrides the model's default tendency to stop after a single satisfactory tool call.

---

## 14. Supervisor-Driven Tool Planning

### Pattern

In multi-agent systems, a supervisor node classifies incoming queries and routes them to sub-agents. The default approach is full autonomy: each sub-agent runs a ReAct loop, deciding which tools to call through LLM reasoning. This works well for open-ended, exploratory queries but is wasteful and non-deterministic for predictable queries like "give me an overview."

**Supervisor-driven tool planning** introduces a dual-mode execution model: the supervisor produces a tool call plan for predictable queries, and sub-agents execute the plan sequentially without an LLM. For exploratory queries, the existing ReAct behavior is preserved.

### When to Apply

- Some query types always need the same set of tools called in the same order
- You need deterministic, reproducible results for baseline/overview queries
- ReAct reasoning adds latency and token cost without adding value for predictable queries
- Sub-agents across parallel deployments should produce structurally identical results for aggregation

### Dual-Mode Execution

| Mode | Trigger | Sub-Agent Behavior | LLM Calls | Deterministic |
|------|---------|-------------------|-----------|---------------|
| Planned | Overview, baseline, index-focused queries | Sequential tool executor (no LLM) | 0 per sub-agent | Yes |
| Autonomous | Investigation, troubleshooting, search | Full ReAct loop with tool selection | N per sub-agent | No |

### Architecture

The supervisor resolves a tool plan before dispatching sub-agents:

```
User Query
    |
    v
[Supervisor]
    |
    +-- classify query intent (LLM call)
    |       |
    |       v
    |   { planTemplate: "overview" | "index_focus" | "autonomous" }
    |       |
    |       v
    +-- resolve plan template
    |       |
    |       +--> "overview" -> [health, cluster_stats, indices_summary, nodes_stats]
    |       +--> "index_focus" -> [health, indices_summary]
    |       +--> "autonomous" -> [] (empty plan, use ReAct)
    |
    v
[Sub-Agent per deployment]
    |
    +-- mode === "planned"?
    |       |
    |       +--> YES: call tools sequentially, collect results, return
    |       +--> NO:  run ReAct loop (existing behavior)
```

### Plan Template Design

Plan templates are static arrays of tool calls with pre-configured arguments:

```typescript
interface ToolPlanStep {
  tool: string;
  args: Record<string, unknown>;
}

const PLAN_TEMPLATES: Record<string, ToolPlanStep[]> = {
  overview: [
    { tool: "get_cluster_health", args: {} },
    { tool: "get_cluster_stats", args: {} },
    { tool: "get_indices_summary", args: { groupBy: "daily_rate" } },
    { tool: "get_nodes_stats", args: { metric: "os,jvm,fs" } },
  ],
  index_focus: [
    { tool: "get_cluster_health", args: {} },
    { tool: "get_indices_summary", args: { groupBy: "daily_rate" } },
  ],
};
```

**Key design decisions**:
- Templates include arguments that the model would otherwise forget (e.g., `metric: "os,jvm,fs"` -- see Section 13 on complementary tool pairing)
- Templates are ordered: health first (fast, confirms cluster is reachable), heavier tools second
- The `autonomous` template is an empty array, not a template -- it signals the sub-agent to use ReAct

### Plan Resolution Prompt

A lightweight LLM call (Haiku-class model) classifies the query into a template name:

```typescript
const TOOL_PLAN_PROMPT = `Analyze the user query and select the appropriate tool plan template.

Return ONLY a JSON object (no markdown, no explanation):
{"planTemplate": "<template_name>"}

Templates:
- "overview": For cluster health, node counts, index counts, document counts,
  ingestion rates, store sizes, resource utilization, baseline metrics,
  or any broad deployment comparison.
- "index_focus": For queries about specific index patterns or data streams.
- "autonomous": For search, investigation, troubleshooting, log analysis,
  or open-ended queries where the agent needs to explore and reason.

Select the template that best matches the query intent.`;
```

**Design principles**:
- Single JSON output, no explanation -- minimizes tokens and parsing complexity
- Template descriptions use concrete nouns ("node counts", "ingestion rates") rather than abstract intent
- `autonomous` is the catch-all: any query that does not clearly match a template falls through to ReAct

### Planned Executor

The planned executor is a simple sequential loop -- no LLM involved:

```typescript
async function executePlan(
  tools: Map<string, Tool>,
  plan: ToolPlanStep[],
): Promise<ToolMessage[]> {
  const results: ToolMessage[] = [];
  for (const step of plan) {
    const tool = tools.get(step.tool);
    if (!tool) continue;
    const result = await tool.invoke(step.args);
    results.push(new ToolMessage({
      content: typeof result === "string" ? result : JSON.stringify(result),
      tool_call_id: generateId(),
      name: step.tool,
    }));
  }
  return results;
}
```

This bypasses the LLM entirely for planned queries, eliminating per-sub-agent LLM costs and latency.

### Graceful Fallback

Plan resolution can fail (LLM returns unparseable JSON, unknown template name, network error). All failure paths default to autonomous mode:

```typescript
function resolvePlanTemplate(templateName: string): {
  mode: "planned" | "autonomous";
  toolPlan: ToolPlanStep[];
} {
  if (templateName === "autonomous") {
    return { mode: "autonomous", toolPlan: [] };
  }
  const template = PLAN_TEMPLATES[templateName];
  if (!template) {
    logger.warn("Unknown plan template, defaulting to autonomous", { templateName });
    return { mode: "autonomous", toolPlan: [] };
  }
  return { mode: "planned", toolPlan: template };
}
```

The design philosophy: planned mode is an optimization, not a requirement. If anything goes wrong, the system falls back to the more capable (but slower) ReAct path.

### Relationship to Other Patterns

- **Section 13 (Complementary Tool Pairing)**: Plan templates encode the same pairings as prompt constraints, but deterministically. The `overview` template includes both `cluster_stats` and `nodes_stats` because the prompt guidance says they are complementary.
- **Section 3 (Dynamic Context Injection)**: Planned mode skips dynamic context injection entirely -- there is no LLM to inject context into. Autonomous mode still uses the full injection pipeline.
- **Cross-Agent Data Alignment** (see LangGraph Workflow Guide, Section 24): When planned sub-agents run across parallel targets, alignment detects if any target returned incomplete results and retries with a reduced plan.

---

## Appendix: File Index

All source paths are relative to `packages/backend/`.

| Section | File | Key Exports |
|---------|------|-------------|
| 1. Prompt Architecture | `src/ai/config/bedrock-config.ts` | `MODEL_IDS`, `MODEL_CONFIG`, `SIMPLE_QUERY_CONFIG`, `COMPLEX_QUERY_CONFIG` |
| 2. Classifier | `src/ai/graph/nodes/classifier.ts` | `classifierNode()` |
| 2. Entity Extractor | `src/ai/graph/nodes/entity-extractor.ts` | `entityExtractorNode()` |
| 2. Tool Router | `src/ai/graph/nodes/tool-router.ts` | `toolRouterNode()` |
| 2. Agent | `src/ai/graph/nodes/agent.ts` | `createAgentNode()` |
| 2. Responder | `src/ai/graph/nodes/responder.ts` | `responderNode()` |
| 3. Dynamic Context | `src/ai/graph/helpers/prompt-context.ts` | `buildDynamicContext()`, all rule constants |
| 4. Shared Schemas | `src/ai/tools/helpers/shared-schemas.ts` | `createToolInputSchema()`, `AccountIdSchema` |
| 5. Sanitization | `src/ai/graph/helpers/llm-output-utils.ts` | `sanitizeLLMOutput()`, `extractTextContent()`, `isFollowUpOnlyContent()` |
| 6. Hallucination | `src/ai/tools/helpers/no-data-handler.ts` | `NO_DATA_RESPONSES`, `containsHallucinatedReason()`, `sanitizeNoDataResponse()` |
| 7. Response Validator | `src/ai/graph/nodes/response-validator.ts` | `responseValidatorNode()`, `routeAfterValidation()` |
| 7. Output Validator | `src/ai/graph/helpers/output-validator.ts` | `VALIDATION_CONSTANTS`, `validatePercentage()`, `validateUtilization()` |
| 8. Analysis Metadata | `src/ai/tools/helpers/analysis-metadata.ts` | `AnalysisMetadata`, `calculateConfidence()`, `getStandardCaveats()` |
| 9. Follow-Up Generator | `src/ai/services/follow-up-generator.ts` | `FollowUpGenerator`, `generateFollowUpQuestions()`, `condenseFollowUpQuestions()` |
| 10. State Pruning | `src/ai/graph/state-pruning.ts` | `pruneState()`, `needsPruning()`, `DEFAULT_PRUNING_CONFIG` |
| 11. Classifier Cache | `src/ai/graph/cache/classifier-cache.ts` | `ClassifierCache`, `classifierCache` |
| 11. Tool Router Cache | `src/ai/graph/cache/tool-router-cache.ts` | `ToolRouterCache`, `toolRouterCache` |
| 12. Tool Retry | `src/ai/middleware/tool-retry.ts` | `withRetry()`, `withDatabaseRetry()`, `RetryConfig` |
| 13. Complementary Pairing | `src/ai/graph/helpers/prompt-context.ts` | Operational constraint rules in system prompt |
| 14. Tool Planning | `src/ai/graph/helpers/tool-plan.ts` | `PLAN_TEMPLATES`, `resolveToolPlan()`, `resolvePlanTemplate()` |

---

## Appendix: Cross-Reference with Companion Guides

This guide focuses on prompt engineering and quality assurance (HOW and WHY). The companion guides cover related topics:

| Topic | This Guide | LANGGRAPH_WORKFLOW_GUIDE.md | BUN_RUNTIME_GUIDE.md | UI_UX_STYLE_GUIDE.md |
|-------|-----------|---------------------------|---------------------|---------------------|
| Graph topology & node flow | - | Sections 2, 6 | - | - |
| Node responsibilities | - | Sections 7-17 | - | - |
| Prompt design per node | Sections 1-2 | Brief overview | - | - |
| Dynamic context injection | Section 3 | Section 12 (overview) | - | - |
| Structured output parsing | Section 4 | - | - | - |
| Hallucination prevention | Section 6 | - | - | - |
| Response validation pipeline | Section 7 | Section 16 (overview) | - | - |
| Tool output metadata | Section 8 | Section 14 (tool system) | - | - |
| Follow-up generation | Section 9 | Section 17 (brief mention) | - | - |
| State pruning & memory | Section 10 | Section 20 | - | - |
| Caching architecture | Section 11 | - | - | - |
| Retry & error resilience | Section 12 | Section 22 (overview) | - | - |
| Complementary tool pairing | Section 13 | - | - | - |
| Supervisor-driven tool planning | Section 14 (prompt design) | Section 23 (graph topology) | - | - |
| Cross-agent data alignment | - | Section 24 | - | - |
| Streaming & SSE transport | - | Section 18 | - | - |
| API layer & routes | - | Section 19 | Section 7 | - |
| Observability (LangSmith) | - | Section 21 | - | - |
| Frontend components | - | - | - | All sections |
| Bun runtime patterns | - | - | All sections | - |

**Boundary rule**: If your question is "what nodes exist and how do they connect?" -> LANGGRAPH guide. If your question is "what does the prompt say and why?" -> this guide.

---

## Appendix: Pattern Summary for New Projects

When adapting these patterns to a new domain, implement in this order:

### Phase 1: Foundation (Essential)

1. **Model assignment matrix** -- Assign cheap/fast models to classification, expensive/capable models to reasoning
2. **Layered prompt architecture** -- Static base + dynamic injection, not monolithic prompts
3. **Output format matching** -- Single-word for classification, JSON for extraction, natural language for responses
4. **Sanitization pipeline** -- Clean LLM artifacts before they reach the user

### Phase 2: Quality (Important)

5. **Hallucination prevention** -- Standardized no-data responses, fabrication detection regexes
6. **Response validation** -- Block + retry for impossible values, scope mismatches
7. **Confidence scoring** -- Data quality metadata attached to tool outputs
8. **Follow-up generation** -- Character-limited, complexity-distributed, with template fallback

### Phase 3: Performance (Optimization)

9. **Classification caching** -- Pattern-based + exact match with TTL and LRU eviction
10. **Dynamic context pruning** -- Only inject rules relevant to the query's tool bundle
11. **State pruning** -- Keep conversations within context limits with smart summarization
12. **Retry middleware** -- Exponential backoff with jitter, retryable error classification

### Phase 4: Resilience (Production)

13. **Graceful degradation** -- Tool failure -> partial response -> user notification
14. **Error as tool result** -- Let the agent see and handle errors, not crash
15. **Validation constants** -- Domain-specific thresholds for impossible values
16. **Output scanning** -- Automated field-name-based validation of numeric outputs

### Phase 5: Optimization (Multi-Agent)

17. **Complementary tool pairing** -- Identify tools with non-overlapping outputs and add explicit "call both" constraints to prompts
18. **Supervisor-driven tool planning** -- Pre-compute deterministic tool plans for predictable queries, preserving ReAct autonomy for exploratory ones
19. **Cross-agent data alignment** -- Detect metric gaps when parallel agents return inconsistent results, re-dispatch targeted retries
