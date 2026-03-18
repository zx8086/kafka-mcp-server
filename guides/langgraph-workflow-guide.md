# LangGraph Workflow Guide

A comprehensive guide to building an AI-powered analysis backend using LangGraph, AWS Bedrock, and a multi-database architecture. Companion to `UI_UX_STYLE_GUIDE.md` -- together these documents provide everything needed to replicate the full application.

### How to Read This Guide

This guide describes **framework-agnostic patterns** -- graph-based agent orchestration, entity extraction with context inheritance, scope-constrained tool execution, streaming transport, and more. These patterns apply to any domain, not just AWS cost analysis.

Code snippets throughout are **reference implementations** from the AWS Cost Analyzer project. They demonstrate how each pattern is concretely realized in TypeScript/Bun with LangGraph, AWS Bedrock, Couchbase, and Neo4j. When adapting to a different domain:

- **Keep the architecture**: graph topology, node responsibilities, state schema design, streaming protocol, validation pipeline
- **Replace the domain layer**: swap cost-analysis tools for your domain's tools, replace cost schemas with your data models, adapt entity extraction prompts to your entity types
- **Swap infrastructure as needed**: Bedrock -> OpenAI/Anthropic API, Couchbase -> your document store, Neo4j -> your graph store (or drop it if you don't need hierarchical relationships)

Each section opens with the **pattern** (what and why), then shows the **implementation** (how, with source references). The patterns are the point; the code is the proof.

---

## Table of Contents

1. [Tech Stack & Dependencies](#1-tech-stack--dependencies)
2. [Architecture Overview](#2-architecture-overview)
3. [LLM Client Layer](#3-llm-client-layer)
4. [Model Configuration](#4-model-configuration)
5. [Graph State Schema](#5-graph-state-schema)
6. [Graph Topology & Edges](#6-graph-topology--edges)
7. [Node: Classifier](#7-node-classifier)
8. [Node: Entity Extractor](#8-node-entity-extractor)
9. [Node: Tool Router](#9-node-tool-router)
10. [Node: Retriever](#10-node-retriever)
11. [Node: Agent (ReAct Loop)](#11-node-agent-react-loop)
12. [Dynamic Prompt Context](#12-dynamic-prompt-context)
13. [Node: Tool Executor](#13-node-tool-executor)
14. [Tool System Architecture](#14-tool-system-architecture)
15. [Tool Catalog](#15-tool-catalog)
16. [Node: Response Validator](#16-node-response-validator)
17. [Node: Responder](#17-node-responder)
18. [Streaming & SSE Transport](#18-streaming--sse-transport)
19. [API Layer](#19-api-layer)
20. [Session Memory & State Pruning](#20-session-memory--state-pruning)
21. [Observability (LangSmith)](#21-observability-langsmith)
22. [Error Resilience & Retry](#22-error-resilience--retry)
23. [Supervisor-Driven Tool Planning](#23-supervisor-driven-tool-planning)
24. [Cross-Agent Data Alignment](#24-cross-agent-data-alignment)

---

## 1. Tech Stack & Dependencies

### Runtime

- **Bun** (v1.3+) -- TypeScript-first JavaScript runtime
- Hot reload during development via `bun --hot`
- Native `.env` loading (no dotenv needed)
- Build: `bun build src/index.ts --outdir=./dist --target=bun --minify`

### Core Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@langchain/core` | ^1.1.31 | Base types: messages, tools, callbacks |
| `@langchain/langgraph` | ^1.2.2 | StateGraph, MemorySaver, ToolNode |
| `@langchain/aws` | ^1.3.1 | AWS Bedrock integration (unused -- custom client used instead) |
| `@langchain/community` | ^1.1.22 | Community integrations |
| `langsmith` | ^0.5.9 | Observability, tracing, feedback |
| `zod` | ^4.3.6 | Runtime schema validation for tool inputs |
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP server integration |
| `couchbase` | ^4.6.1 | Couchbase Capella SDK (cost data) |
| `neo4j-driver` | ^6.0.1 | Neo4j driver (org relationships) |

### AWS SDK Packages

| Package | Purpose |
|---------|---------|
| `@aws-sdk/client-bedrock-runtime` | LLM inference via Converse API |
| `@aws-sdk/client-cost-explorer` | Cost and usage data |
| `@aws-sdk/client-cloudwatch` | Utilization metrics |
| `@aws-sdk/client-compute-optimizer` | Rightsizing recommendations |
| `@aws-sdk/client-pricing` | On-demand pricing |
| `@aws-sdk/client-ec2` | Instance metadata |
| `@aws-sdk/client-rds` | RDS instance details |
| `@aws-sdk/client-s3-control` | S3 storage lens |
| `@aws-sdk/client-support` | Trusted Advisor |
| `@aws-sdk/client-cost-optimization-hub` | Cost Optimization Hub |

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AWS_BEARER_TOKEN_BEDROCK` | Yes | Bearer token for Bedrock Converse API |
| `AWS_BEDROCK_REGION` | No | AWS region (default: `eu-central-1`) |
| `AWS_BEDROCK_MODEL_ID` | No | Default model ID (fallback) |
| `COUCHBASE_CONNECTION_STRING` | Yes | Couchbase Capella connection |
| `COUCHBASE_USERNAME` | Yes | Couchbase credentials |
| `COUCHBASE_PASSWORD` | Yes | Couchbase credentials |
| `NEO4J_URI` | Yes | Neo4j connection URI |
| `NEO4J_USER` | Yes | Neo4j credentials |
| `NEO4J_PASSWORD` | Yes | Neo4j credentials |
| `LANGSMITH_TRACING` | No | Enable LangSmith (`true`/`false`) |
| `LANGSMITH_API_KEY` | No | LangSmith API key |
| `LANGSMITH_PROJECT` | No | LangSmith project name (default: `aws-cost-analyzer`) |
| `LANGSMITH_ENDPOINT` | No | LangSmith API endpoint |

---

## 2. Architecture Overview

### System Flow Diagram

```
HTTP Request (POST /api/ai/stream)
    |
    v
+--[CostAnalysisService]-----------------------------------------+
|                                                                  |
|   Initial State = { query, messages, organizationalContext, ... } |
|                                                                  |
|   +---------+     +-----------------+     +------------+         |
|   | classify |---->| entityExtractor |---->| toolRouter |         |
|   +---------+     +-----------------+     +------------+         |
|       |                                        |                 |
|       | (simple)                               v                 |
|       |                               +------------+             |
|       |                               |  retriever  |             |
|       |                               +------------+             |
|       |                                    |                     |
|       |                                    v                     |
|       |                               +--------+                |
|       |                          +--->|  agent  |<---+           |
|       |                          |    +--------+     |           |
|       |                          |        |          |           |
|       |                          |        v          |           |
|       |                          |    +-------+      |           |
|       |                          +----| tools |------+           |
|       |                               +-------+                 |
|       |                                   |                      |
|       |                                   v                      |
|       |                            +-----------+                 |
|       |                            | validator  |                 |
|       |                            +-----------+                 |
|       |                                |                         |
|       |                     pass /     | \ retry                 |
|       |                         v      |  v                      |
|       |                   +-----------+   (back to agent)        |
|       +------------------>| responder |                          |
|                           +-----------+                          |
|                                |                                 |
|                                v                                 |
|                           Final Answer                           |
+------------------------------------------------------------------+
    |
    v
SSE Stream -> Frontend
    |
    v
Async Follow-Up Suggestions (separate SSE event)
```

### Data Flow: HTTP to SSE

1. **HTTP POST** arrives at `/api/ai/stream` with JSON body
2. **CostAnalysisService** creates initial state, detects follow-ups
3. **StateGraph** executes nodes sequentially via `graph.streamEvents()`
4. **SSE events** are yielded as an `AsyncGenerator<StreamEvent>`
5. **ReadableStream** wraps the generator for the HTTP response
6. **Final answer** is streamed character-by-character with adaptive delays
7. **Follow-up suggestions** arrive as a separate SSE event after the answer

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Custom LLM client (not `@langchain/aws`) | Bearer token auth required; native SDK uses SigV4 |
| Metadata-only retriever | Forces deterministic tool usage; prevents agent from skipping tools |
| LLM-based tool routing | Semantic understanding of user intent; regex patterns were brittle |
| Block + retry validation | Catches hallucinations before they reach the user |
| Dual follow-up path | Tool-generated suggestions are immediate; async fallback handles edge cases |
| Adaptive streaming chunks | Short responses stream faster; long responses maintain reading pace |
| Scope constraint injection | Prevents tool parameter drift from organizational context |

---

## 3. LLM Client Layer

### Why a Custom Client

The standard `@langchain/aws` ChatBedrock class uses AWS SigV4 credentials. This application authenticates via **Bearer tokens** against the Bedrock Converse API, requiring a custom `BaseChatModel` implementation.

### ChatBedrockBearer Class

Source: `src/ai/clients/chat-bedrock-bearer.ts`

```typescript
export class ChatBedrockBearer extends BaseChatModel {
  private bearerToken: string;
  private baseUrl: string;
  private modelId: string;
  private temperature: number;
  private maxTokens: number;
  private boundTools: StructuredToolInterface[] = [];

  constructor(fields: ChatBedrockBearerInput) {
    super(fields);
    this.modelId = fields.model;
    this.bearerToken = fields.bearerToken.replace(/^"|"$/g, "");
    this.baseUrl = `https://bedrock-runtime.${fields.region}.amazonaws.com`;
    this.temperature = fields.temperature ?? 0.1;
    this.maxTokens = fields.maxTokens ?? 4096;
  }
}
```

### Message Conversion (LangChain -> Bedrock Converse)

The `convertMessages()` method handles the critical translation between LangChain's message format and Bedrock's Converse API format.

**Key constraint**: Claude 4.x requires all `toolResult` blocks from the same assistant turn to be in a **single user message**. The converter merges consecutive `ToolMessage` instances:

```typescript
private convertMessages(messages: BaseMessage[]): {
  system: string | undefined;
  messages: BedrockConverseMessage[];
} {
  let systemPrompt: string | undefined;
  const converseMessages: BedrockConverseMessage[] = [];
  let pendingToolResults: BedrockContentBlock[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      converseMessages.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const message of messages) {
    if (message instanceof SystemMessage) {
      systemPrompt = convertSystemMessage(message);
      continue;
    }
    if (message instanceof HumanMessage) {
      flushToolResults();
      converseMessages.push(convertHumanMessage(message));
      continue;
    }
    if (message instanceof AIMessage) {
      flushToolResults();
      const converted = convertAIMessage(message);
      if (converted) converseMessages.push(converted);
      continue;
    }
    if (message instanceof ToolMessage) {
      pendingToolResults.push({
        toolResult: {
          toolUseId: message.tool_call_id,
          content: [{ text: typeof message.content === "string" ? message.content : "" }],
        },
      });
    }
  }

  flushToolResults();
  return { system: systemPrompt, messages: converseMessages };
}
```

### Tool Schema Conversion (Zod -> JSON Schema -> Bedrock)

Tool schemas defined in Zod are converted to JSON Schema for the Bedrock API:

```typescript
function convertZodSchema(schema: unknown): Record<string, unknown> {
  const zodSchema = schema as { toJSONSchema?: () => Record<string, unknown> };

  if (typeof zodSchema.toJSONSchema === "function") {
    try {
      const converted = zodSchema.toJSONSchema();
      if (converted.$schema) converted.$schema = undefined;
      if (converted.type === "object" && !("additionalProperties" in converted)) {
        converted.additionalProperties = false;
      }
      return converted;
    } catch (error) {
      // Zod v4's toJSONSchema() fails with "Transforms cannot be represented"
      // Fallback to minimal schema -- runtime validation still works via Zod
      return { type: "object", properties: {}, additionalProperties: false };
    }
  }

  return { type: "object", properties: {}, additionalProperties: false };
}
```

### Streaming Implementation

The `/converse-stream` endpoint returns a binary event stream. The client:

1. Reads chunks from the `ReadableStream`
2. Parses AWS binary event framing (4-byte length prefix + headers + payload)
3. Extracts text deltas, tool use starts/deltas, and metadata
4. Yields `ChatGenerationChunk` instances back to LangChain

```typescript
async *_stream(
  messages: BaseMessage[],
  _options: this["ParsedCallOptions"],
  runManager?: CallbackManagerForLLMRun
): AsyncGenerator<ChatGenerationChunk> {
  const response = await this.initiateStreamRequest(messages);
  const state = createStreamState();
  const decoder = new TextDecoder();
  yield* this.processStreamResponse(response, state, decoder, runManager);
}
```

### Factory Functions

```typescript
// Sonnet 4.5 (default) -- complex reasoning
export function createChatBedrockBearer(options?: {
  model?: string; temperature?: number; maxTokens?: number;
}): ChatBedrockBearer

// Haiku 4.5 -- fast, cheap tasks
export function createChatBedrockBearerHaiku(options?: {
  temperature?: number; maxTokens?: number;
}): ChatBedrockBearer
```

### Swapping LLM Providers

`ChatBedrockBearer` is one implementation of LangChain's `BaseChatModel`. To swap to a different LLM provider, implement the same contract:

```typescript
interface ChatModelAdapter {
  // The two methods LangGraph nodes call
  _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult>;
  _stream(messages: BaseMessage[], options: this["ParsedCallOptions"]): AsyncGenerator<ChatGenerationChunk>;

  // Tool binding for ReAct agent
  bindTools(tools: StructuredToolInterface[]): this;
}
```

`ChatBedrockBearer` satisfies this via `BaseChatModel`. To swap providers, create a new adapter:

```typescript
// OpenAI adapter skeleton
import { ChatOpenAI } from "@langchain/openai";

export function createOpenAIAdapter(options?: {
  model?: string; temperature?: number; maxTokens?: number;
}): ChatOpenAI {
  return new ChatOpenAI({
    modelName: options?.model ?? "gpt-4o",
    temperature: options?.temperature ?? 0.0,
    maxTokens: options?.maxTokens ?? 4096,
  });
}

// Anthropic API adapter skeleton (direct, not via Bedrock)
import { ChatAnthropic } from "@langchain/anthropic";

export function createAnthropicAdapter(options?: {
  model?: string; temperature?: number; maxTokens?: number;
}): ChatAnthropic {
  return new ChatAnthropic({
    modelName: options?.model ?? "claude-sonnet-4-5-20250514",
    temperature: options?.temperature ?? 0.0,
    maxTokens: options?.maxTokens ?? 4096,
  });
}
```

All three adapters are interchangeable in the graph nodes because they extend `BaseChatModel`. The factory functions in Section 3 (`createChatBedrockBearer`, `createChatBedrockBearerHaiku`) are the only call sites that need to change -- the graph topology, tool definitions, and node logic stay the same.

### Retry Wrappers

Source: `src/ai/clients/bedrock-retry.ts`

Both `_generate` and `_stream` wrap their fetch calls with retry logic:

- `withBedrockRetry()` -- retries the full Converse API call
- `withBedrockStreamRetry()` -- retries the stream initiation (not mid-stream)

Retried on: `429 Too Many Requests`, `500/502/503` server errors, network failures.

---

## 4. Model Configuration

Source: `src/ai/config/bedrock-config.ts`

### Model IDs

```typescript
export const MODEL_IDS = {
  HAIKU: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  SONNET: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
} as const;
```

### Node-to-Model Assignments

| Node | Model | Rationale |
|------|-------|-----------|
| `classifier` | Haiku 4.5 | Binary classification is trivial |
| `toolRouter` | Haiku 4.5 | Semantic classification does not need Sonnet |
| `entityExtractor` | Haiku 4.5 | Structured extraction is Haiku's sweet spot |
| `agent` | Sonnet 4.5 | ReAct reasoning benefits most from upgraded model |
| `responder` | Haiku 4.5 | Simple responses do not need heavy reasoning |
| `followUpGenerator` | Haiku 4.5 | Direct upgrade from Haiku 3 |

```typescript
export const MODEL_CONFIG = {
  classifier: MODEL_IDS.HAIKU,
  toolRouter: MODEL_IDS.HAIKU,
  entityExtractor: MODEL_IDS.HAIKU,
  agent: MODEL_IDS.SONNET,
  responder: MODEL_IDS.HAIKU,
  followUpGenerator: MODEL_IDS.HAIKU,
} as const;
```

### Configuration Profiles

```typescript
export const SIMPLE_QUERY_CONFIG: BedrockConfig = {
  ...BEDROCK_CONFIG,
  maxTokens: 1024,
  temperature: 0.0,
};

export const COMPLEX_QUERY_CONFIG: BedrockConfig = {
  ...BEDROCK_CONFIG,
  maxTokens: 4096,
  temperature: 0.0,
};
```

### Cost/Latency Rationale

- **Haiku 4.5** runs 5 nodes (classifier, toolRouter, entityExtractor, responder, followUpGenerator). Each call is 50-200 tokens output. Total Haiku cost per query: ~$0.001-0.003.
- **Sonnet 4.5** runs 1 node (agent) but generates the bulk of output (1000-4000 tokens). This is the primary cost driver at ~$0.02-0.08 per query.
- Net effect: ~80% cost reduction vs running Sonnet for all nodes, with no quality degradation on classification/extraction tasks.

---

## 5. Graph State Schema

Source: `src/ai/graph/state.ts`

The state schema is the central contract -- every node reads from and writes to this annotation. All interfaces referenced throughout the system are defined here.

### Interfaces

```typescript
export interface OrganizationalContext {
  nodeId: string;
  nodeName: string;
  nodeType: "organization" | "domain" | "department" | "account" | "service";
  accountId?: string;
  costData?: {
    currentMonthCost: number;
    previousMonthCost: number;
    trend: number;
  };
  metadata?: Record<string, string>;
}

export interface PageContext {
  route: string;
  pageName: string;
  pageDescription?: string;
}

export interface TimeframeRange {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
}

export interface ExtractedEntities {
  accounts: Array<{
    id: string;
    name: string;
    environment: string;
    mentionedAs: string;
  }>;
  departments: Array<{ id: string; name: string; mentionedAs: string }>;
  domains: Array<{ id: string; name: string; mentionedAs: string }>;
  services: Array<{
    name: string;
    shortName: string;
    category: string;
    mentionedAs: string;
  }>;
  categories: string[];
  environments: string[];
  timeframe: {
    type: "relative" | "absolute" | "comparison" | null;
    description: string | null;
    resolved?: TimeframeRange;
  };
  tags?: Record<string, string>;
}

export interface ToolPlan {
  bundle: string;
  allowedTools: string[];
  maxTools: number;
  scopeConstraints: ScopeConstraints;
  confidence: number;
}

export interface ScopeConstraints {
  accountId?: string;
  service?: string;
  department?: string;
  domain?: string;
  timeframe?: TimeframeRange;
}

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  corrections?: string;
}

export interface ValidationIssue {
  type: "impossible_value" | "math_error" | "scope_mismatch"
    | "hallucination_risk" | "sign_inversion" | "fabricated_claim";
  severity: "warning" | "error";
  message: string;
  field?: string;
  expected?: string;
  actual?: string;
}

export interface ContextSource {
  type: "EXPLICIT" | "INHERITED";
  service?: string;
  timeframe?: string;
  scope?: string;
  inheritedFrom?: string;
}

export type ResponseMode = "dashboard" | "detailed";

export interface CostContext {
  totalCost: number;
  recordCount: number;
  period: string;
  scope: {
    type: "organization" | "domain" | "department" | "account" | "service";
    id?: string;
    name?: string;
  };
  resolvedTimeframe?: TimeframeRange;
}
```

### Complete State Annotation

```typescript
export const CostAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,

  // Query input
  query: Annotation<string>({
    reducer: (_, b) => b,
    default: () => "",
  }),
  queryComplexity: Annotation<"simple" | "complex">({
    reducer: (_, b) => b,
    default: () => "simple",
  }),

  organizationalContext: Annotation<OrganizationalContext | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  pageContext: Annotation<PageContext | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  extractedEntities: Annotation<ExtractedEntities | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  previousEntities: Annotation<ExtractedEntities | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  // Additional context
  accountId: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  timeframe: Annotation<TimeframeRange | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  costContext: Annotation<CostContext | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  // Execution tracking -- APPEND reducers
  toolsUsed: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  routingPath: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  toolExecutions: Annotation<Array<{ name: string; duration: number; timestamp: number }>>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  reasoningSteps: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  // Output -- REPLACE reducers
  finalAnswer: Annotation<string>({
    reducer: (_, b) => b,
    default: () => "",
  }),
  confidence: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  tokensUsed: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  suggestedFollowUps: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  contentType: Annotation<"text" | "anomalies" | "chart" | "table" | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  structuredData: Annotation<Record<string, unknown> | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  // Session
  threadId: Annotation<string>({
    reducer: (_, b) => b,
    default: () => "",
  }),
  isFollowUp: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
  suggestFollowupsExecuted: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),

  // Router + Validation Framework
  toolPlan: Annotation<ToolPlan | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  scopeConstraints: Annotation<ScopeConstraints | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  validationResult: Annotation<ValidationResult | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  retryCount: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  contextSource: Annotation<ContextSource | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  responseMode: Annotation<ResponseMode>({
    reducer: (_, b) => b,
    default: () => "dashboard",
  }),
});
```

### Reducer Strategies

| Strategy | Fields | Behavior |
|----------|--------|----------|
| **Replace** `(_, b) => b` | Most fields | Latest value wins |
| **Append** `(a, b) => [...a, ...b]` | `toolsUsed`, `routingPath`, `toolExecutions`, `reasoningSteps` | Accumulates across nodes |
| **Sum** `(a, b) => a + b` | `tokensUsed` | Running total |
| **MessagesAnnotation** | `messages` | Built-in LangGraph message handling with deduplication by ID |

---

## 6. Graph Topology & Edges

Source: `src/ai/graph/workflow.ts`, `src/ai/graph/edges.ts`

### Graph Construction

```typescript
export function buildCostAnalysisGraph(dbManager: DatabaseManager) {
  initializeLangSmith();

  const tools = createTools(dbManager);
  const toolNode = createToolNode(dbManager);
  const retrieverNode = createRetrieverNode(dbManager);
  const agentNode = createAgentNode(tools);

  const graph = new StateGraph(CostAnalysisState)
    .addNode("classify", classifierNode)
    .addNode("entityExtractor", entityExtractorNode)
    .addNode("toolRouter", toolRouterNode)
    .addNode("retriever", retrieverNode)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addNode("validator", responseValidatorNode)
    .addNode("responder", responderNode)

    .addEdge(START, "classify")

    .addConditionalEdges("classify", routeAfterClassifier, {
      simple: "responder",
      complex: "entityExtractor",
    })

    .addEdge("entityExtractor", "toolRouter")
    .addEdge("toolRouter", "retriever")
    .addEdge("retriever", "agent")

    .addConditionalEdges("agent", routeAfterAgent)
    .addConditionalEdges("tools", routeAfterTools)

    .addConditionalEdges("validator", routeAfterValidation, {
      pass: "responder",
      retry: "agent",
    })

    .addEdge("responder", END);

  return graph;
}
```

### Compilation Modes

```typescript
// With MemorySaver for session persistence (thread-based conversations)
export function compileGraphWithMemory(dbManager: DatabaseManager) {
  const graph = buildCostAnalysisGraph(dbManager);
  const checkpointer = new MemorySaver();
  return graph.compile({ checkpointer });
}

// Without memory (stateless, one-off queries)
export function compileGraph(dbManager: DatabaseManager) {
  const graph = buildCostAnalysisGraph(dbManager);
  return graph.compile();
}
```

### Conditional Edge Functions

**1. `routeAfterClassifier`** -- Binary routing based on query complexity

```typescript
export function routeAfterClassifier(state: CostAnalysisStateType): "simple" | "complex" {
  // Follow-ups always go complex (need conversation context)
  if (state.isFollowUp) return "complex";
  if (state.queryComplexity === "simple") return "simple";
  return "complex";
}
```

**2. `routeAfterAgent`** -- Route to tools or validator

```typescript
export function routeAfterAgent(state: CostAnalysisStateType): "tools" | "validator" {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage) {
    const toolCalls = lastMessage.tool_calls || [];
    if (toolCalls.length > 0) return "tools";
  }
  return "validator";
}
```

**3. `routeAfterTools`** -- Terminal routing for `suggest_followups`

```typescript
export function routeAfterTools(state: CostAnalysisStateType): "agent" | "validator" {
  if (state.suggestFollowupsExecuted) return "validator";
  return "agent";
}
```

When `suggest_followups` is called, the agent has already provided its full answer WITH the tool call. Going back to agent would produce an empty message.

**4. `routeAfterValidation`** -- Retry or pass through

```typescript
export function routeAfterValidation(state: CostAnalysisStateType): "retry" | "pass" {
  if (!state.validationResult?.passed && state.retryCount < 2) return "retry";
  return "pass";
}
```

### Execution Paths

**Simple query** (e.g., "Hello", "What can you do?"):
```
START -> classify -> responder -> END
```

**Complex query** (e.g., "Show December 2025 costs"):
```
START -> classify -> entityExtractor -> toolRouter -> retriever -> agent -> tools -> agent -> tools (suggest_followups) -> validator -> responder -> END
```

**Validation retry** (hallucination detected):
```
... -> agent -> validator -> agent (with corrections) -> validator -> responder -> END
```

---

## 7. Node: Classifier

Source: `src/ai/graph/nodes/classifier.ts`

### Purpose

Binary routing: determines if a query needs database access ("complex") or can be answered directly ("simple").

### LLM Configuration

- **Model**: Haiku 4.5
- **Temperature**: 0
- **Max tokens**: 50

### Classification Prompt

```
You are a query classifier for an AWS cost analysis system.

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
- Organizational governance queries about account ownership, approvers, or managers

Query: "{query}"

Respond with only one word: SIMPLE or COMPLEX
```

### Cache Layer

Source: `src/ai/graph/cache/classifier-cache.ts`

- **Max entries**: 500
- **TTL**: 10 minutes (all entries)
- **Pattern matching**: Common query types are matched by regex before cache lookup
- **Eviction**: LRU-style, prefers evicting exact matches over patterns

Pattern categories cached:
- **Simple**: greetings, help, capabilities, thanks, goodbye, identity
- **Complex**: cost queries, comparisons, trends, forecasts, optimization, service mentions, organizational queries

### Follow-Up Bypass

Follow-up queries (`state.isFollowUp === true`) always route to "complex" regardless of classification. This ensures conversation context is preserved through the entity extraction pipeline.

### Fallback

If the LLM call fails, defaults to "complex" to ensure data is fetched.

---

## 8. Node: Entity Extractor

Source: `src/ai/graph/nodes/entity-extractor.ts`

### Purpose

Named Entity Recognition (NER) that resolves natural language mentions to canonical organizational IDs. Supports context inheritance for follow-up queries.

### LLM Configuration

- **Model**: Haiku 4.5
- **Temperature**: 0
- **Max tokens**: 1024

### Extraction Prompt Structure

The prompt is built dynamically with:
1. **Available entities reference** -- all accounts, departments, domains, services from `organizational-structure.ts`
2. **Extraction rules** -- case-insensitive matching, alias resolution, timeframe classification
3. **Previous context section** (conditional) -- injected for follow-up queries

### Context Inheritance Rules

For follow-up queries where `previousEntities` exist:

| Rule | Example | Behavior |
|------|---------|----------|
| **Pronouns** | "What about that?" | Inherit all previous entities |
| **Comparison** | "Compare to last month" | Keep previous + add new |
| **Same timeframe** | "Same period" | Inherit previous timeframe exactly |
| **No explicit entities** | "What about the trend?" | Inherit ALL previous entities |
| **Explicit override** | "Show EC2 costs" | Replace with explicit mention |

Inherited entities have `mentionedAs: "(inherited from context)"` for tracing.

### Organizational Context Merging

After LLM extraction, `mergeOrganizationalContext()` enriches entities with the frontend's `selectedNode` context:

```typescript
function mergeOrganizationalContext(
  entities: ExtractedEntities,
  context: OrganizationalContext | null
): void {
  if (!context) return;

  switch (context.nodeType) {
    case "department":
      mergeDepartmentContext(entities, context);    // Add department
      addDepartmentParentDomain(entities, context); // Add parent domain
      break;
    case "domain":
      mergeDomainContext(entities, context);         // Add domain
      break;
    case "account":
      mergeAccountContext(entities, context);        // Add account
      addAccountParentHierarchy(entities, context);  // Add parent dept + domain
      break;
  }
}
```

### Tag Extraction

Account-level tags from `organizationalContext.metadata` are extracted:

```typescript
if (organizationalContext?.metadata) {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(organizationalContext.metadata)) {
    if (key.startsWith("tag") && typeof value === "string") {
      tags[key.replace(/^tag/, "")] = value;
    }
  }
  if (Object.keys(tags).length > 0) {
    extractedEntities.tags = tags;
  }
}
```

---

## 9. Node: Tool Router

Source: `src/ai/graph/nodes/tool-router.ts`, `src/ai/graph/query-patterns.ts`

### Purpose

Classifies user intent into one of 10 tool bundles via LLM semantic classification.

### Classification Prompt

```
You are a query classifier for an AWS cost analysis system. Classify the user's INTENT into exactly ONE category.

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

CATEGORIES WITH EXAMPLES:
[Each category includes examples, intent description, and keywords]

Query: "{query}"

Respond with ONLY the category name.
```

### Tool Bundles

```typescript
export const TOOL_BUNDLES = {
  single_query: {
    tools: ["cost_query_tool"],
    maxTools: 1,
    description: "Simple cost lookups",
  },
  period_comparison: {
    tools: ["compare_periods_tool", "cost_query_tool"],
    maxTools: 2,
    description: "Period-over-period comparisons",
  },
  root_cause: {
    tools: ["root_cause_tool", "cost_query_tool", "trend_analysis_tool"],
    maxTools: 2,
    description: "Root cause analysis",
  },
  trend_forecast: {
    tools: ["trend_analysis_tool", "cost_query_tool"],
    maxTools: 2,
    description: "Trend analysis and forecasting",
  },
  recommendations: {
    tools: ["recommendations_tool", "optimization_tool"],
    maxTools: 2,
    description: "AWS Trusted Advisor cost optimization recommendations",
  },
  anomaly_analysis: {
    tools: ["anomaly_detection_tool", "root_cause_tool", "cost_query_tool"],
    maxTools: 2,
    description: "Anomaly detection and analysis",
  },
  scenario_modeling: {
    tools: ["scenario_modeling_tool", "recommendations_tool"],
    maxTools: 2,
    description: "What-if scenario modeling",
  },
  utilization: {
    tools: ["optimization_tool", "recommendations_tool"],
    maxTools: 2,
    description: "Resource utilization analysis with CloudWatch metrics",
  },
  comprehensive: {
    tools: ["spending_overview_tool", "trend_analysis_tool", "recommendations_tool"],
    maxTools: 3,
    description: "Comprehensive spending overview with trends and anomalies",
  },
  organizational: {
    tools: ["query_accounts_by_tags"],
    maxTools: 1,
    description: "Organizational queries for account tags",
  },
} as const;
```

`suggest_followups` is always appended to `allowedTools` and `maxTools` is incremented by 1.

### Scope Constraint Building

```typescript
function buildScopeConstraints(state: CostAnalysisStateType): ScopeConstraints {
  const constraints: ScopeConstraints = {};

  // From organizational context (frontend selectedNode)
  if (state.organizationalContext) {
    const ctx = state.organizationalContext;
    if (ctx.nodeType === "account" && ctx.accountId) constraints.accountId = ctx.accountId;
    if (ctx.nodeType === "department") constraints.department = ctx.nodeId;
    if (ctx.nodeType === "domain") constraints.domain = ctx.nodeId;
  }

  // From extracted entities
  if (state.extractedEntities) {
    if (state.extractedEntities.services?.length > 0)
      constraints.service = state.extractedEntities.services[0].name;
    if (state.extractedEntities.timeframe?.resolved)
      constraints.timeframe = state.extractedEntities.timeframe.resolved;
  }

  // Fallback to direct state timeframe
  if (!constraints.timeframe && state.timeframe)
    constraints.timeframe = state.timeframe;

  return constraints;
}
```

### Response Mode Detection

```typescript
export const DASHBOARD_PATTERNS = [
  /^show\s+(costs?|spending)/i,
  /^what\s+(are|is)\s+the\s+cost/i,
  /^how\s+much/i,
  /total\s+cost/i,
];

export const DETAILED_PATTERNS = [
  /why/i, /explain/i, /analyze/i, /breakdown/i,
  /detail/i, /root\s*cause/i, /what\s+caused/i,
];

// Detailed patterns checked first (higher priority)
export function detectResponseMode(query: string): "dashboard" | "detailed"
```

### LRU Cache

Source: `src/ai/graph/cache/tool-router-cache.ts`

Same pattern as classifier cache -- prevents redundant LLM calls for repeated query patterns.

---

## 10. Node: Retriever

Source: `src/ai/graph/nodes/retriever.ts`

### Design Principle: Metadata Only

The retriever provides **lightweight metadata only** -- total cost, record count, period, scope. The agent MUST use tools for detailed breakdowns (service costs, account costs, trends).

This ensures deterministic behavior: tools are always used for detailed analysis, preventing non-deterministic cases where the agent might skip tools if it already has "enough" data.

### Timeframe Resolution

The retriever resolves relative timeframe descriptions to concrete date ranges:

| Input | Resolution |
|-------|------------|
| `"past 6 months"` / `"last 6 months"` | Current month - 5 to current month |
| `"this month"` / `"current month"` | Current month only |
| `"last month"` / `"previous month"` | Previous month only |
| `"this year"` / `"YTD"` | January to current month |
| `"past year"` / `"last 12 months"` | 12 months back to current |
| No description | Current month (default) |

### Parallel Multi-Month Fetching

For multi-month ranges, all months are fetched in parallel via `Promise.all`:

```typescript
const monthResults = await Promise.all(
  months.map(async ({ year, month }) => {
    const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
    const endDate = `${year}-${month.toString().padStart(2, "0")}-31`;
    return dbManager.couchbase.getCostRecordsByAccount(accountId, startDate, endDate);
  })
);
```

### CostContext Output

```typescript
interface CostContext {
  totalCost: number;     // Sum of all costs in range
  recordCount: number;   // Number of cost records
  period: string;        // "2025-12" or "2025-07 to 2025-12"
  scope: {
    type: "organization" | "domain" | "department" | "account" | "service";
    id?: string;
    name?: string;
  };
  resolvedTimeframe?: TimeframeRange;
}
```

### Scope Resolution Order

1. Direct `accountId` (from context or state)
2. Service scope (org-wide query filtered by service)
3. Department scope (accounts resolved from org config)
4. Domain scope (accounts resolved from org config)
5. Organization scope (all accounts)

---

## 11. Node: Agent (ReAct Loop)

Source: `src/ai/graph/nodes/agent.ts`

### Purpose

The ReAct (Reasoning + Acting) loop where Sonnet 4.5 decides which tools to call and generates the final answer.

### LLM Configuration

- **Model**: Sonnet 4.5
- **Temperature**: 0.0
- **Max tokens**: 4096
- Tools bound via `model.bindTools(tools)`

### System Prompt

The system prompt is ~1,200 tokens base with ~500 tokens of dynamic context. Key sections:

1. **Identity**: "You are an AWS cost analysis agent for PVH Corp."
2. **Data presentation**: Markdown tables, cost formatting, account name rules
3. **Tool usage**: Router pre-selects tools, key parameter guidance
4. **Root cause vs trend analysis**: When to use each
5. **Projection/forecast queries**: `use_projections: true` parameter
6. **Context filtering**: Pass organizational scope to tools
7. **Error recovery**: Graceful failure protocol
8. **Scope boundaries**: What the tool can and cannot do
9. **Data fidelity**: All numbers must come from tool output
10. **Follow-up suggestions**: Call `suggest_followups` in same message, then STOP

### Message Array Construction

```typescript
function buildMessagesArray(state: CostAnalysisStateType, hasToolMessages: boolean): BaseMessage[] {
  const messages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(...)),
    ...state.messages,
  ];

  // Only add cost metadata on FIRST agent call (before any tools executed)
  if (state.costContext && !hasToolMessages) {
    messages.push(new HumanMessage(`
COST METADATA for ${state.costContext.period}:
- Scope: ${scopeDesc}
- Total Cost: $${state.costContext.totalCost.toFixed(2)}
- Records: ${state.costContext.recordCount}

To answer this query, use the cost_query_tool to get the detailed breakdown.
`));
  }

  return messages;
}
```

### Tool Call Response Handling

When the model outputs content WITH a `suggest_followups` tool call, the content is captured as `finalAnswer` immediately:

```typescript
function handleToolCallResponse(response: AIMessage, reasoningSteps: string[]) {
  const rawContent = extractTextContent(response.content);
  const hasSuggestFollowups = toolCalls.some(tc => tc.name === "suggest_followups");

  if (hasSubstantiveContent && hasSuggestFollowups) {
    return {
      messages: [response],
      finalAnswer: sanitizedContent,
      confidence: 0.8,
      routingPath: ["agent"],
    };
  }

  return { messages: [response], routingPath: ["agent"] };
}
```

### Empty Response Fallback

If the agent returns an empty message (edge case after tool execution), a fallback searches previous messages for substantive content:

```typescript
function extractContentFromPreviousMessages(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isAIMessage(message)) continue;
    const rawContent = extractTextContent(message.content);
    if (!rawContent.trim()) continue;
    if (isFollowUpOnlyContent(rawContent)) continue;
    return sanitizeLLMOutput(rawContent, "Agent");
  }
  return null;
}
```

---

## 12. Dynamic Prompt Context

Source: `src/ai/graph/helpers/prompt-context.ts`

### Strategy

Keep the base prompt lean (~1,400 tokens). Inject relevant sections (~300-500 tokens) based on the tool bundle detected by the router.

### Always-Included Rules

| Rule Set | Purpose |
|----------|---------|
| `LANGUAGE_RULES` | No subjective superlatives, quantitative descriptions only |
| `DATA_VALIDATION_RULES` | Percentages 0-100%, positive savings, no same-to-same |
| `PARALLEL_EXECUTION_RULES` | Call independent tools in parallel |
| `ERROR_RECOVERY_RULES` | Graceful handling of wrong dates, no data, partial data |

### Conditional Sections

| Condition | Injected Rules |
|-----------|---------------|
| Dashboard page (`/`) | `DASHBOARD_RULES` -- max 3 observations, bullet points |
| `trend_forecast` bundle | `FORECASTING_RULES` -- confidence labeling, month alignment |
| `trend_forecast` / `scenario_modeling` | `FORECASTING_RULES` |
| `comprehensive` / `period_comparison` / `trend_forecast` | `DATA_QUALITY_RULES` |
| `comprehensive` / `trend_forecast` / `anomaly_analysis` | `COMPLETE_MONTHS_RULES` |
| No tool bundle (general) | `CONTEXT_INHERITANCE_RULES` |
| Query matches "each/all/every/per department" | Department enumeration list |
| Always | `FOLLOWUP_RULES` |
| Always | Bundle-specific `QUERY_GUIDANCE` |

### Token Budget

- Base prompt: ~1,400 tokens
- Dynamic context: ~300-500 tokens depending on bundle
- Total system prompt: ~1,700-1,900 tokens

---

## 13. Node: Tool Executor

Source: `src/ai/graph/tools.ts`

### Purpose

Custom wrapper around LangGraph's `ToolNode` that adds scope constraint enforcement, timing tracking, metadata extraction, and terminal routing.

### Tool Creation

All 11 tools are wrapped with retry middleware:

```typescript
export function createTools(dbManager: DatabaseManager): StructuredToolInterface[] {
  return [
    withDatabaseRetry(new CostQueryTool(dbManager)),
    withDatabaseRetry(new OptimizationTool(dbManager)),
    withDatabaseRetry(new TrendAnalysisTool(dbManager)),
    withDatabaseRetry(new RecommendationsTool(dbManager)),
    withDatabaseRetry(new SpendingOverviewTool(dbManager)),
    withDatabaseRetry(new ComparePeriodsTool(dbManager)),
    withDatabaseRetry(new AnomalyDetectionTool(dbManager)),
    withDatabaseRetry(new ScenarioModelingTool(dbManager)),
    withDatabaseRetry(new RootCauseTool(dbManager)),
    withDatabaseRetry(new QueryAccountsByTagsTool(dbManager)),
    new SuggestFollowupsTool(), // No database access needed
  ];
}
```

### Scope Constraint Enforcement

```typescript
function enforceScopeConstraints(
  toolName: string,
  toolArgs: Record<string, unknown>,
  constraints: CostAnalysisStateType["scopeConstraints"]
): Record<string, unknown> {
  if (!constraints) return toolArgs;

  const supported = getSupportedConstraints(toolName, constraints);
  const enforced = { ...toolArgs };

  // Service constraint (uses correct parameter name per tool)
  if (supported.service) {
    const caps = TOOL_CAPABILITIES[toolName];
    const paramName = caps?.parameterNames.service || "service_name";
    if (!enforced[paramName]) enforced[paramName] = constraints.service;
  }

  // Account constraint
  if (supported.account && !enforced.account_id) {
    enforced.account_id = constraints.accountId;
  }

  // Department constraint
  if (constraints.department && !enforced.department) {
    enforced.department = constraints.department;
  }

  // Domain constraint
  if (constraints.domain && !enforced.domain) {
    enforced.domain = constraints.domain;
  }

  // Timeframe constraint
  if (constraints.timeframe && !enforced.start_date && !enforced.end_date) {
    const { startYear, startMonth, endYear, endMonth } = constraints.timeframe;
    const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    enforced.start_date = startDate;
    enforced.end_date = endDate;
  }

  return enforced;
}
```

### Tool Capabilities Registry

Each tool declares its scope support:

```typescript
const TOOL_CAPABILITIES: Record<string, ToolCapabilities> = {
  cost_query_tool: {
    supportsServiceFilter: true,
    supportsAccountFilter: true,
    supportsTimeframe: true,
    parameterNames: { service: "service_name" },
  },
  optimization_tool: {
    supportsServiceFilter: true,
    supportsAccountFilter: true,
    supportsTimeframe: true,
    parameterNames: { service: "service" }, // Different param name!
  },
  recommendations_tool: {
    supportsServiceFilter: false,
    supportsAccountFilter: true,
    supportsTimeframe: false,
    parameterNames: {},
  },
  // ... etc
};
```

### Metadata Extraction

Tools embed metadata in their output using markers:

```
[ANALYSIS_METADATA]{"confidence":"high","source":"database","recordCount":42}[/ANALYSIS_METADATA]
```

The tool node extracts this and adds it to `state.structuredData.analysisMetadata`.

### Terminal Routing Flag

When `suggest_followups` is called, `suggestFollowupsExecuted` is set to `true`. This causes `routeAfterTools` to route directly to the validator instead of back to the agent.

---

## 14. Tool System Architecture

### BaseAnalysisTool

Source: `src/ai/tools/base-tool.ts`

```typescript
export abstract class BaseAnalysisTool extends DynamicStructuredTool {
  static readonly capabilities: ToolCapabilities = DEFAULT_CAPABILITIES;

  get capabilities(): ToolCapabilities {
    return (this.constructor as typeof BaseAnalysisTool).capabilities;
  }
}
```

### Shared Zod Schemas

Source: `src/ai/tools/helpers/shared-schemas.ts`

```typescript
// Account IDs -- z.coerce handles Claude passing numbers
export const AccountIdSchema = z.coerce.string().optional()
  .describe('AWS account ID as a STRING (12-digit format).');

// Organizational scope
export const ScopeSchema = z.object({
  account_id: AccountIdSchema,
  account_ids: AccountIdsSchema,
  department: DepartmentSchema,
  domain: DomainSchema,
  organization: OrganizationSchema,
});

export const ExtendedScopeSchema = ScopeSchema.extend({
  environment: EnvironmentSchema,
});

// Factory functions
export function createToolInputSchema<T extends z.ZodRawShape>(additionalFields: T) {
  return z.object({
    ...ScopeSchema.shape,
    period: PeriodSchema,
    timeframe: TimeframeObjectSchema.describe(TIMEFRAME_DESCRIPTION),
    ...additionalFields,
  });
}

export function createExtendedToolInputSchema<T>(additionalFields: T) { ... }
export function createScopeOnlySchema<T>(additionalFields: T) { ... }
export function createExtendedScopeOnlySchema<T>(additionalFields: T) { ... }
```

### Timeframe Resolver

Source: `src/ai/tools/helpers/timeframe-resolver.ts`

Resolution priority chain:

1. `period` as specific month (`"2025-12"`)
2. `period` as relative (`"3m"`, `"6m"`, `"1y"`)
3. `timeframe` object (`{start_year, start_month, end_year, end_month}`)
4. `start_date` + `end_date` strings
5. `year` + `month` individual fields
6. `start_year` + `start_month` + `end_year` + `end_month` individual fields
7. Default: last 3 months

### Cost Record Fetcher

Source: `src/ai/tools/helpers/cost-record-fetcher.ts`

```typescript
export async function fetchCostRecords(
  couchbase: CouchbaseRepository,
  options: FetchCostRecordsOptions
): Promise<CostRecord[]> {
  const { accountIds, startDate, endDate } = options;

  // Single account: direct query
  if (accountIds.length === 1) {
    return couchbase.getCostRecordsByAccount(accountIds[0], startDate, endDate);
  }

  // Multiple accounts: batch method if available, otherwise filter
  if (accountIds.length > 1) {
    if (typeof couchbase.getCostRecordsByAccountsAndDateRange === "function") {
      return couchbase.getCostRecordsByAccountsAndDateRange(accountIds, startDate, endDate);
    }
    const allResults = await couchbase.getCostRecordsByDateRange(startDate, endDate);
    return allResults.filter(r => r.accountId && accountIds.includes(r.accountId));
  }

  // No specific accounts: fetch all
  return couchbase.getCostRecordsByDateRange(startDate, endDate);
}
```

---

## 15. Tool Catalog

### Overview

| # | Tool Name | Schema Factory | Purpose |
|---|-----------|---------------|---------|
| 1 | `cost_query_tool` | `createToolInputSchema` | Query cost data with filtering and aggregation |
| 2 | `compare_periods_tool` | `createToolInputSchema` | Period-over-period comparison |
| 3 | `trend_analysis_tool` | `createToolInputSchema` | Trend detection with forecasting |
| 4 | `anomaly_detection_tool` | `createToolInputSchema` | Statistical outlier detection |
| 5 | `root_cause_tool` | `createExtendedToolInputSchema` | Drill-down into cost drivers with CloudWatch correlation |
| 6 | `spending_overview_tool` | `createToolInputSchema` | Multi-faceted spending overview |
| 7 | `optimization_tool` | `createExtendedScopeOnlySchema` | Rightsizing, reservations, waste identification |
| 8 | `recommendations_tool` | `createScopeOnlySchema` | AWS Trusted Advisor integration |
| 9 | `scenario_modeling_tool` | `createScopeOnlySchema` | What-if analysis |
| 10 | `query_accounts_by_tags` | Custom | Tag-based account filtering |
| 11 | `suggest_followups` | Custom | Follow-up question generation |

### Tool Details

**1. cost_query_tool** -- Core cost data retrieval
- Key fields: `account_id`, `service_name`, `period`, `timeframe`, `department`, `domain`
- Output: Cost records aggregated by service and/or account with totals
- Algorithm: Fetch records -> group by service/account -> calculate totals -> format

**2. compare_periods_tool** -- Period comparison
- Key fields: `period_1`, `period_2`, `comparison_type`, `service_name`
- Output: Side-by-side costs with changes and percentage differences
- Algorithm: Fetch both periods -> align services -> calculate deltas

**3. trend_analysis_tool** -- Trend detection and forecasting
- Key fields: `period`, `analysis_type` (required), `forecast_months`, `service_name`
- Output: Monthly cost progression, trend direction/velocity, optional forecasts
- Algorithm: Multi-month fetch -> linear regression -> AWS forecast integration

**4. anomaly_detection_tool** -- Statistical outlier detection
- Key fields: `period`, `threshold`, `service_name`
- Output: Anomalies with severity scores and auto root-cause analysis
- Algorithm: Calculate mean/stddev per service -> flag deviations > threshold

**5. root_cause_tool** -- Cost change driver analysis
- Key fields: `period`, `service_name`, `use_projections`
- Output: Service-level changes with CloudWatch utilization correlation
- Algorithm: Compare two periods -> correlate with CloudWatch -> verdict (LEGITIMATE/INVESTIGATE)

**6. spending_overview_tool** -- Comprehensive spending analysis
- Key fields: `period`, `exclude_incomplete`
- Output: Multi-month overview with trends, anomalies, savings calculations
- Algorithm: Fetch multi-month data -> calculate net changes -> identify patterns

**7. optimization_tool** -- Resource optimization
- Key fields: `service`, `resource_type`, `cpu_threshold`, `memory_threshold`
- Output: Rightsizing recommendations with CloudWatch correlation
- Algorithm: Fetch CloudWatch metrics -> identify underutilized -> calculate savings

**8. recommendations_tool** -- AWS Trusted Advisor
- Key fields: `account_id`, `department`, `domain`
- Output: Pre-computed AWS recommendations with estimated savings
- Algorithm: Query Couchbase recommendations collection -> filter by scope -> format

**9. scenario_modeling_tool** -- What-if analysis
- Key fields: `scenario_type`, `instance_type`, `quantity`, `region`
- Output: Cost projections for infrastructure changes
- Algorithm: Fetch current pricing -> apply scenario parameters -> project costs

**10. query_accounts_by_tags** -- Organizational tag queries
- Key fields: `tag_name`, `tag_value`
- Output: Accounts matching tag criteria with full metadata
- Algorithm: Query Neo4j for accounts with matching tags

**11. suggest_followups** -- Follow-up question generation
- Key fields: `context_summary`, `tools_used`
- Output: 4 contextual follow-up questions for pill buttons
- Algorithm: Use Haiku to generate questions based on conversation context

---

## 16. Node: Response Validator

Source: `src/ai/graph/nodes/response-validator.ts`

### Purpose

Validation gate between agent and responder. Implements block + retry strategy to catch hallucinations and impossible values.

### Validation Rules

```typescript
const VALIDATION_RULES = [
  {
    name: "utilization_bounds",
    // Catches: CPU: 5,300,000,000% or memory utilization of 53 billion%
    // Threshold: VALIDATION_CONSTANTS.UTILIZATION_MAX (100%)
  },
  {
    name: "negative_savings",
    // Catches: Response mentions "savings" AND "cost increase"
    // Severity: warning (sign inversion risk)
  },
  {
    name: "scope_alignment",
    // Catches: Response discusses wrong service (e.g., EC2 when RDS was asked)
    // Severity: warning
  },
  {
    name: "empty_data_acknowledgment",
    // Catches: Hallucinated explanations for missing data
    // Uses containsHallucinatedReason() from no-data-handler.ts
    // Severity: error (upgraded -- hallucinations must be blocked)
  },
  {
    name: "fabricated_discount",
    // Catches: Discount claims exceeding AWS maximum
    // Threshold: VALIDATION_CONSTANTS.AWS_MAX_DISCOUNT
    // Severity: error
  },
];
```

### Block + Retry Strategy

1. Run all validation rules on `state.finalAnswer`
2. Separate errors from warnings
3. If errors exist AND `retryCount < 1`:
   - Build correction prompt from errors
   - Set `validationResult.passed = false`
   - Increment `retryCount`
   - Route back to agent with corrections
4. If errors persist after retry:
   - Append disclaimer: `_Note: Some values could not be verified._`
   - Allow through with `passed = true`
5. Warnings are logged but never block

### Correction Prompt Generation

```typescript
function buildCorrectionPrompt(issues: ValidationIssue[]): string {
  return issues
    .filter(i => i.severity === "error")
    .map(issue => {
      switch (issue.type) {
        case "hallucination_risk":
          return `HALLUCINATION RISK: ${issue.message}. Use only factual statements.`;
        case "fabricated_claim":
          return `FABRICATED CLAIM: ${issue.message}. Remove or correct this claim.`;
        // ... etc
      }
    })
    .join("\n");
}
```

---

## 17. Node: Responder

Source: `src/ai/graph/nodes/responder.ts`

### Purpose

Final response formatting and confidence calculation. Handles both complex queries (where `finalAnswer` already exists from the agent) and simple queries (which need LLM generation).

### Confidence Calculation Algorithm

```typescript
function calculateResponseConfidence(
  toolsUsed: string[],
  reasoningSteps: string[],
  hasContext: boolean
): number {
  let confidence = 0.5;                                    // Base

  confidence += Math.min(0.2, toolsUsed.length * 0.05);   // +0.05 per tool, max +0.2
  confidence += Math.min(0.15, reasoningSteps.length * 0.02); // +0.02 per step, max +0.15
  if (hasContext) confidence += 0.1;                       // +0.1 for org context

  return Math.min(0.95, confidence);                       // Cap at 0.95
}
```

### Answer Extraction

For complex queries, extracts the answer from message history:

```typescript
function extractAnswer(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isAIMessage(message)) continue;
    if (!message.content) continue;

    const rawContent = extractTextContent(message.content);
    if (!rawContent.trim()) continue;
    if (isFollowUpOnlyContent(rawContent)) continue;

    return sanitizeLLMOutput(rawContent, "Responder");
  }
  return "";
}
```

### Simple Query Generation

For simple queries that bypass the agent:

```typescript
async function generateSimpleResponse(
  query: string,
  organizationalContext, pageContext
): Promise<{ answer: string; tokensUsed: number }> {
  const systemPrompt = buildSimpleResponsePrompt(organizationalContext, pageContext);
  const response = await simpleLLM.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ]);
  return { answer: sanitizeLLMOutput(response.content), tokensUsed };
}
```

Also supports streaming via `generateSimpleResponseStreaming()` async generator.

---

## 18. Streaming & SSE Transport

Source: `src/ai/graph/service.ts`

### StreamEvent Interface

```typescript
export interface StreamEvent {
  type:
    | "start"           // Query started processing
    | "node_start"      // Graph node began execution
    | "node_end"        // Graph node completed
    | "tool_start"      // Tool began execution
    | "tool_end"        // Tool completed (includes duration)
    | "token"           // Text chunk for final answer
    | "done"            // Processing complete (includes metadata)
    | "suggestions"     // Async follow-up suggestions (fallback)
    | "error";          // Error occurred
  content?: string;
  nodeName?: string;
  toolName?: string;
  toolDuration?: number;
  threadId?: string;
  requestId?: string;
  responseTime?: number;
  tokensUsed?: number;
  toolsUsed?: string[];
  suggestedFollowUps?: string[];
  message?: string;
  confidence?: number;
  runId?: string;
  contentType?: "text" | "anomalies" | "chart" | "table";
  structuredData?: Record<string, unknown>;
  routingPath?: string[];
  routingDecision?: string;
  extractedEntities?: Record<string, unknown>;
}
```

### processQueryStream() Async Generator

```typescript
async *processQueryStream(request: CostAnalysisRequest): AsyncGenerator<StreamEvent> {
  const startTime = Date.now();
  const requestId = this.generateRequestId();
  const threadId = request.threadId || this.generateThreadId();

  yield { type: "start", threadId, requestId };

  try {
    const { graph, config, initialState } = await this.prepareStreamExecution(request, threadId);
    const state = this.createStreamState();

    for await (const event of graph.streamEvents(initialState, { ...config, version: "v2" })) {
      // Check for final answer (streamed separately with delays)
      const finalAnswerResult = this.checkForFinalAnswer(event, state);
      if (finalAnswerResult) {
        yield* this.streamFinalAnswerWithDelay(finalAnswerResult.answer, finalAnswerResult.nodeName);
        continue;
      }

      // Process node lifecycle, tool events, LLM stream
      const events = this.processStreamEvent(event, state);
      for (const streamEvent of events) {
        yield streamEvent;
      }
    }

    await awaitAllCallbacks(); // Flush LangSmith callbacks

    // Done event (includes tool-generated suggestions if available)
    yield this.buildStreamDoneEvent(state, responseTime, threadId, requestId);

    // Async fallback suggestions (only if tool didn't generate them)
    const suggestionsEvent = await this.generateStreamSuggestions(state, requestId, threadId);
    if (suggestionsEvent) yield suggestionsEvent;
  } catch (error) {
    yield { type: "error", message: error.message, requestId, responseTime };
  }
}
```

### Adaptive Streaming Chunking

Final answers are streamed character-by-character with adaptive chunk sizes:

```typescript
async *streamFinalAnswerWithDelay(finalAnswer: string, nodeName: string) {
  const responseLength = finalAnswer.length;
  let chunkSize: number;
  let delayMs: number;

  if (responseLength < 200) {
    chunkSize = 5;  delayMs = 18;   // Short: faster delivery
  } else if (responseLength < 1000) {
    chunkSize = 4;  delayMs = 22;   // Medium: moderate pace
  } else {
    chunkSize = 3;  delayMs = 25;   // Long: comfortable reading pace
  }

  for (let i = 0; i < finalAnswer.length; i += chunkSize) {
    const chunk = finalAnswer.slice(i, i + chunkSize);
    yield { type: "token", content: chunk };
    if (i + chunkSize < finalAnswer.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
```

### Dual Follow-Up Path

1. **Primary (immediate)**: Tool-generated suggestions from `suggest_followups` tool are included in the `done` event's `suggestedFollowUps` field.
2. **Fallback (async)**: If the agent did not call `suggest_followups`, `generateSuggestionsAsync()` runs after the done event and emits a separate `suggestions` event.

---

## 19. API Layer

Source: `src/routes/ai.ts`, `src/routes/middleware.ts`

### REST Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/api/ai/analyze` | `analyzeQuery` | Non-streaming cost analysis |
| POST | `/api/ai/query` | `analyzeQuery` | Legacy alias |
| POST | `/api/ai/stream` | `analyzeQueryStream` | SSE streaming analysis |
| POST | `/api/ai/feedback` | `submitFeedback` | LangSmith feedback submission |
| GET | `/api/ai/capabilities` | `getCapabilities` | Feature/tool listing |
| GET | `/api/ai/health` | `healthCheck` | Service health status |

### Request Schema

```typescript
interface CostAnalysisRequest {
  query: string;                                    // Required
  accountId?: string;
  threadId?: string;                                // For session persistence
  organizationalContext?: OrganizationalContext;     // Frontend selectedNode
  pageContext?: PageContext;                         // Current page/route
  timeframe?: TimeframeRange;
}
```

### Response Schema

```typescript
interface CostAnalysisResponse {
  answer: string;
  responseTime: number;
  tokensUsed: number;
  toolsUsed: string[];
  reasoningSteps: string[];
  confidence: number;
  threadId: string;
  agentUsed: "langgraph";
  suggestedFollowUps?: string[];
  requestId: string;
  timestamp: string;
  langsmithEnabled: boolean;
  runId?: string;
  contentType?: "text" | "anomalies" | "chart" | "table";
  structuredData?: Record<string, unknown>;
}
```

### CORS Middleware

```typescript
export function withCors(handler: RouteHandler): RouteHandler {
  return async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);
    try {
      const response = await handler(req);
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        if (!newHeaders.has(key)) newHeaders.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers: newHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: "Internal server error" }), {
        status: 500, headers: corsHeaders,
      });
    }
  };
}
```

### SSE Middleware

```typescript
export function withSSE(handler: RouteHandler): RouteHandler {
  return async (req: Request) => {
    const response = await handler(req);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      },
    });
  };
}
```

### ReadableStream Creation

The SSE endpoint wraps the async generator:

```typescript
const stream = new ReadableStream({
  async start(controller) {
    try {
      for await (const event of service.processQueryStream(analysisRequest)) {
        const sseData = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(sseData));
      }
    } catch (error) {
      const errorEvent = { type: "error", message: error.message };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
    } finally {
      controller.close();
    }
  },
});
```

---

## 20. Session Memory & State Pruning

### Thread-Based Persistence

The service maintains two compiled graphs:

```typescript
this.graph = compileGraphWithMemory(dbManager);      // With MemorySaver
this.statelessGraph = compileGraph(dbManager);        // Without memory
```

Session selection:
- If `request.threadId` is provided: use memory-backed graph
- Otherwise: use stateless graph

### Follow-Up Detection

```typescript
private async checkIfFollowUp(graph, threadId, useMemory): Promise<boolean> {
  if (!useMemory) return false;
  try {
    const existingState = await graph.getState({ configurable: { thread_id: threadId } });
    const existingMessages = existingState?.values?.messages;
    return Array.isArray(existingMessages) && existingMessages.length > 0;
  } catch {
    return false;
  }
}
```

### State Pruning

Source: `src/ai/graph/state-pruning.ts`

Prevents unbounded state growth in long conversations.

**Configuration**:

```typescript
export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  maxMessages: 10,
  maxToolResults: 5,
  maxReasoningSteps: 15,
  maxToolExecutions: 20,
  preserveSystemMessages: true,
};
```

**pruneMessages() Algorithm**:

1. Separate system messages from non-system messages
2. Calculate available slots: `maxMessages - systemMessages.length`
3. Keep the most recent non-system messages within available slots
4. Remove orphaned tool messages (tool messages before any non-tool message)
5. Combine: `[...systemMessages, ...sanitizedNonSystem]`

**pruneState() Function**:

```typescript
export function pruneState(
  state: Partial<CostAnalysisStateType>,
  config: Partial<PruningConfig> = {}
): { updates: Partial<CostAnalysisStateType>; stats: PruningStats } {
  // Prune messages (keep most recent)
  // Prune tool executions (keep most recent)
  // Prune reasoning steps (keep most recent)
  // Deduplicate tools used
  return { updates, stats };
}
```

**needsPruning() Check**:

```typescript
export function needsPruning(state, config): boolean {
  if ((state.messages?.length ?? 0) > config.maxMessages) return true;
  if ((state.toolExecutions?.length ?? 0) > config.maxToolExecutions) return true;
  if ((state.reasoningSteps?.length ?? 0) > config.maxReasoningSteps) return true;
  return false;
}
```

Pruning is applied after each graph execution for memory-based sessions.

---

## 21. Observability (LangSmith)

Source: `src/ai/config/langsmith.config.ts`

### Configuration

```typescript
export const LANGSMITH_CONFIG: LangSmithConfig = {
  tracing: Bun.env.LANGSMITH_TRACING === "true",
  apiKey: Bun.env.LANGSMITH_API_KEY,
  project: Bun.env.LANGSMITH_PROJECT || "aws-cost-analyzer",
  endpoint: Bun.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
};
```

### Initialization

Called once during graph construction:

```typescript
export function initializeLangSmith(): void {
  if (!LANGSMITH_CONFIG.tracing || !LANGSMITH_CONFIG.apiKey) return;

  process.env.LANGCHAIN_TRACING_V2 = "true";
  process.env.LANGCHAIN_API_KEY = LANGSMITH_CONFIG.apiKey;
  process.env.LANGCHAIN_PROJECT = LANGSMITH_CONFIG.project;
  process.env.LANGCHAIN_ENDPOINT = LANGSMITH_CONFIG.endpoint;
}
```

### Run ID Capture

The root `run_id` is captured from the first stream event:

```typescript
if (!state.rootRunId && event.run_id) {
  state.rootRunId = event.run_id;
}
```

This `runId` is included in the `done` event and `CostAnalysisResponse` for feedback linking.

### Thread Grouping

Traces are grouped by `session_id` metadata:

```typescript
const config = useMemory
  ? {
      configurable: { thread_id: threadId },
      recursionLimit: 50,
      metadata: { session_id: threadId },
    }
  : { recursionLimit: 50 };
```

Note: Due to SDK limitation (issue #839), `session_id` only propagates for follow-up queries. First queries start a new thread.

### Feedback Loop API

The `/api/ai/feedback` endpoint submits user ratings to LangSmith:

```typescript
// POST /api/ai/feedback
{
  runId: string;        // From done event
  score: 1 | -1 | 0;   // Thumbs up / down / neutral
  comment?: string;
  userId?: string;
  threadId?: string;
}
```

Score mapping: `1 -> 1.0`, `-1 -> 0.0`, `0 -> 0.5` (LangSmith expects 0-1 range).

### Callback Flushing

After graph execution, callbacks are flushed to ensure trace completion:

```typescript
await awaitAllCallbacks();
```

---

## 22. Error Resilience & Retry

### Tool Retry Middleware

Source: `src/ai/middleware/tool-retry.ts`

**Configuration**:

```typescript
interface RetryConfig {
  maxRetries: number;       // Default: 2
  backoffFactor: number;    // Default: 2
  initialDelayMs: number;   // Default: 500
  maxDelayMs: number;       // Default: 5000
  jitter: boolean;          // Default: true
  retryOn?: (error: Error) => boolean;
  onFailure: "error" | "continue" | ((error: Error) => string);
}
```

**Exponential Backoff with Jitter**:

```typescript
function calculateDelay(config: RetryConfig, attempt: number): number {
  const baseDelay = config.initialDelayMs * config.backoffFactor ** attempt;
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);

  if (config.jitter) {
    const jitterAmount = cappedDelay * Math.random() * 0.5; // 0-50% jitter
    return Math.round(cappedDelay + jitterAmount);
  }

  return cappedDelay;
}
```

Delay progression (with jitter range):
- Attempt 0: 500ms (500-750ms)
- Attempt 1: 1000ms (1000-1500ms)
- Attempt 2: 2000ms (2000-3000ms)

**Default Retryable Patterns**:

```typescript
const retryablePatterns = [
  "timeout", "timed out", "connection", "network",
  "econnreset", "econnrefused", "socket hang up",
  "is not a function", "cannot read properties",
  "temporarily unavailable", "service unavailable",
  "rate limit", "throttl",
];
```

### Database-Specific Retry

```typescript
export function withDatabaseRetry(tool: DynamicStructuredTool): StructuredToolInterface {
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
      message: `Database query failed: ${error.message}. Try a different query type or time period.`,
      suggestion: "The database may be temporarily unavailable. You can try: 1) A different time range, 2) A simpler query, or 3) Wait a moment and retry.",
    }),
  });
}
```

### Bedrock API Retry

Source: `src/ai/clients/bedrock-retry.ts`

Both `withBedrockRetry()` and `withBedrockStreamRetry()` handle:
- `429 Too Many Requests` (rate limiting)
- `500/502/503` server errors
- Network failures (`ECONNRESET`, `ECONNREFUSED`)

### No-Data Handler

Source: `src/ai/tools/helpers/no-data-handler.ts`

Prevents hallucinated explanations for missing data:

```typescript
export const NO_DATA_RESPONSES = {
  historical: "No data available for the requested period.",
  scope: "No data found for this scope.",
  service: "No costs recorded for this service in the specified period.",
  general: "No cost data found matching your criteria.",
  anomalies: "No anomalies detected in the specified period.",
  recommendations: "No optimization recommendations available for this scope.",
  forecast: "Unable to generate forecast - insufficient historical data.",
  trend: "Insufficient data to calculate trends for this period.",
  comparison: "Unable to compare periods - data unavailable for one or both periods.",
} as const;
```

**Hallucination Detection**:

```typescript
export function containsHallucinatedReason(response: string): boolean {
  const hallucinationPatterns = [
    /data (?:only )?(?:goes|starts|is available|begins) (?:back|from)/i,
    /doesn't (?:go|extend|include) back/i,
    /wasn't (?:available|collected|recorded) (?:until|before)/i,
    /(?:this|the) data (?:is|was) (?:not|never) (?:collected|recorded|tracked)/i,
    /(?:may|might|could) not have been (?:tracked|recorded|available)/i,
    // ... more patterns
  ];
  return hallucinationPatterns.some(pattern => pattern.test(response));
}
```

### Follow-Up Generator Resilience

Source: `src/ai/services/follow-up-generator.ts`

The follow-up generator has its own fallback chain:

1. **Primary**: LLM generates 4 contextual questions (Haiku 4.5)
2. **Validation**: Questions must be 10-70 characters (pill button constraint)
3. **Fallback**: Template-based questions if LLM fails or returns invalid output
4. **Condensation**: Optional second LLM call to shorten verbose questions

```typescript
function getFallbackQuestions(context: FollowUpGeneratorContext): string[] {
  const questions: string[] = [];

  if (context.organizationalContext) {
    switch (context.organizationalContext.nodeType) {
      case "organization": questions.push("Which dept costs most?"); break;
      case "department": questions.push("Compare costs by account?"); break;
      case "account": questions.push("Top cost drivers?"); break;
      case "service": questions.push("Cost change over time?"); break;
    }
  }

  // Fill with generic questions
  const genericQuestions = [
    "Breakdown by service?",
    "Any optimization tips?",
    "Compare to last month?",
    "Fastest growing services?",
  ];

  while (questions.length < 4 && genericQuestions.length > 0) {
    const q = genericQuestions.shift();
    if (q && !questions.includes(q)) questions.push(q);
  }

  return questions.slice(0, 4);
}
```

---

## 23. Supervisor-Driven Tool Planning

### Pattern

When a supervisor dispatches sub-agents to parallel targets (deployments, databases, clusters), each sub-agent typically runs a full ReAct loop -- the LLM reasons about which tools to call, interprets results, and decides when to stop. This is powerful for exploratory queries but introduces three problems for predictable queries:

1. **Non-determinism** -- Two sub-agents hitting identical clusters may call different tools, producing structurally different results that are hard to aggregate
2. **Latency** -- Each sub-agent incurs multiple LLM round-trips for tool selection reasoning
3. **Cost** -- ReAct reasoning tokens are wasted when the tool sequence is known in advance

Supervisor-driven tool planning addresses all three by having the supervisor pre-compute a deterministic tool call plan for predictable queries. Sub-agents then execute the plan sequentially without any LLM calls.

### State Schema Extensions

The graph state needs two new fields to carry the plan from supervisor to sub-agent:

```typescript
interface ToolPlanStep {
  tool: string;
  args: Record<string, unknown>;
}

// Added to the per-deployment result type
interface DeploymentResult {
  // ...existing fields...
  mode: "planned" | "autonomous";
  toolPlan: ToolPlanStep[];
}
```

The `mode` field lets downstream nodes (aggregator, alignment) know how the sub-agent operated. The `toolPlan` travels with each deployment dispatch so the sub-agent knows exactly what to execute.

### Supervisor Resolution

The supervisor resolves the tool plan once, before dispatching to any sub-agents. This means all sub-agents for a given query use the same plan:

```typescript
// In supervisor node, after routing to deployments
const { mode, toolPlan } = await resolveToolPlan(classifierLLM, userQuery);

// Attach plan to each deployment dispatch
for (const deployment of targetDeployments) {
  deploymentResults.push({
    deploymentId: deployment.id,
    mode,
    toolPlan,
    // ...other dispatch fields
  });
}
```

The resolution uses a lightweight LLM call (Haiku-class) that classifies the query into a template name. See AI Engineering Guide, Section 14 for the prompt design.

### Sub-Agent Branching

The sub-agent node branches at the top based on mode:

```
[Sub-Agent Entry]
       |
       +-- mode === "planned"?
       |       |
       |       +--> YES: executePlan(tools, toolPlan)
       |       |         - Loop through plan steps sequentially
       |       |         - Call each tool with pre-configured args
       |       |         - Collect ToolMessages
       |       |         - Return results (no LLM)
       |       |
       |       +--> NO:  runReActAgent(llm, tools, messages)
       |                  - Standard ReAct loop (existing behavior)
       |                  - LLM decides tools, interprets results
       |                  - Returns when LLM generates final answer
```

```typescript
async function subAgentNode(state: SubAgentState): Promise<Partial<SubAgentState>> {
  if (state.mode === "planned" && state.toolPlan.length > 0) {
    const results = await executePlan(state.tools, state.toolPlan);
    return {
      messages: results,
      toolsUsed: state.toolPlan.map(step => step.tool),
    };
  }

  // Autonomous mode: existing ReAct behavior
  return runReActAgent(state);
}
```

### Aggregator Considerations

When sub-agents run in planned mode, their results are tool output messages without a synthesized natural-language answer (no LLM was involved). The aggregator must handle this:

- **Planned mode**: Extract structured data directly from tool output JSON. Each tool's output schema is known, so the aggregator uses typed extractors.
- **Autonomous mode**: The sub-agent already produced a natural-language answer. The aggregator merges these narrative answers.

```typescript
function aggregateResults(deploymentResults: DeploymentResult[]): AggregatedResult {
  const plannedResults = deploymentResults.filter(r => r.mode === "planned");
  const autonomousResults = deploymentResults.filter(r => r.mode === "autonomous");

  if (plannedResults.length > 0) {
    // Extract metrics from raw tool output using typed extractors
    return extractAndMergeMetrics(plannedResults);
  }

  // Merge narrative answers from autonomous sub-agents
  return mergeNarrativeResults(autonomousResults);
}
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Plan resolved once by supervisor, not per sub-agent | Ensures structural consistency across parallel targets |
| Haiku-class model for plan resolution | Binary classification task; does not need reasoning |
| Empty plan = autonomous mode | Clean signal, no special casing in sub-agent branching |
| Fallback to autonomous on any resolution failure | Planned mode is an optimization, not a requirement |
| Plan includes tool arguments | Prevents sub-agents from using wrong defaults (e.g., missing metric filters) |

---

## 24. Cross-Agent Data Alignment

### Pattern

When a supervisor dispatches sub-agents to multiple parallel targets, each sub-agent operates independently. Even with identical tool plans (Section 23), individual targets may return partial results due to timeouts, permission differences, or version-specific tool availability. The result: one target returns CPU/heap/disk metrics while another returns only CPU/heap, producing tables with "-" gaps.

**Cross-agent data alignment** is a post-collection, pre-aggregation node that detects metric gaps across target results and re-dispatches targeted retries to fill them.

### Position in the Graph

```
[Supervisor]
     |
     v
[Sub-Agent per target] (parallel fan-out)
     |
     v
[Alignment Node]  <-- NEW: detects gaps, retries
     |
     v
[Aggregator]
     |
     v
[Responder]
```

The alignment node sits between the fan-out sub-agents and the aggregator. It sees all target results together and can compare them.

### Gap Detection

The alignment node extracts the set of tools called by each target and compares them:

```typescript
interface AlignmentGap {
  targetId: string;
  missingTools: string[];
  presentIn: string[];  // which targets have the data
}

function detectGaps(
  results: DeploymentResult[],
  extractors: Map<string, MetricExtractor>,
): AlignmentGap[] {
  // Build a tool-call matrix: target x tool -> boolean
  const toolMatrix = new Map<string, Set<string>>();
  for (const result of results) {
    toolMatrix.set(result.targetId, new Set(result.toolsUsed));
  }

  // Find the union of all tools called across all targets
  const allTools = new Set<string>();
  for (const tools of toolMatrix.values()) {
    for (const tool of tools) allTools.add(tool);
  }

  // Identify gaps: tools present in some targets but missing in others
  const gaps: AlignmentGap[] = [];
  for (const [targetId, tools] of toolMatrix) {
    const missing = [...allTools].filter(t =>
      !tools.has(t) && extractors.has(t)  // only care about tools we can extract metrics from
    );
    if (missing.length > 0) {
      const presentIn = [...toolMatrix.entries()]
        .filter(([, t]) => missing.some(m => t.has(m)))
        .map(([id]) => id);
      gaps.push({ targetId, missingTools: missing, presentIn });
    }
  }

  return gaps;
}
```

**Key filtering**: Only flag gaps for tools that have metric extractors. If a tool was called on one target but there is no extractor to process its output, missing it on another target does not create a data gap.

### Targeted Retry

When gaps are detected, the alignment node re-dispatches sub-agents to only the targets with missing tools, using a reduced tool plan:

```typescript
async function alignResults(
  gaps: AlignmentGap[],
  originalResults: DeploymentResult[],
): Promise<DeploymentResult[]> {
  if (gaps.length === 0) return originalResults;

  const retryPromises = gaps.map(gap => {
    const reducedPlan: ToolPlanStep[] = gap.missingTools.map(tool => ({
      tool,
      args: getDefaultArgs(tool),  // e.g., { metric: "os,jvm,fs" } for nodes_stats
    }));

    return dispatchSubAgent({
      targetId: gap.targetId,
      mode: "planned",
      toolPlan: reducedPlan,
      isAlignmentRetry: true,
    });
  });

  const retryResults = await Promise.all(retryPromises);

  // Merge retry results into original results
  return mergeRetryResults(originalResults, retryResults);
}
```

**Design choices**:
- Retries always use planned mode (sequential tool execution, no LLM) regardless of the original query mode
- The `isAlignmentRetry` flag prevents infinite retry loops -- alignment retries are never themselves aligned
- Retry dispatches run in parallel since they target different deployments

### Merge Strategy

Retry results are merged into the original results by appending tool messages:

```typescript
function mergeRetryResults(
  originals: DeploymentResult[],
  retries: DeploymentResult[],
): DeploymentResult[] {
  const retryMap = new Map(retries.map(r => [r.targetId, r]));

  return originals.map(original => {
    const retry = retryMap.get(original.targetId);
    if (!retry) return original;

    return {
      ...original,
      messages: [...original.messages, ...retry.messages],
      toolsUsed: [...original.toolsUsed, ...retry.toolsUsed],
    };
  });
}
```

The aggregator then sees a complete set of tool results for every target, eliminating "-" gaps in comparison tables.

### Routing Logic

The alignment node routes conditionally:

```typescript
function routeAfterAlignment(state: GraphState): "aggregate" | "retry" {
  const gaps = detectGaps(state.deploymentResults, TOOL_METRIC_EXTRACTORS);

  if (gaps.length === 0) return "aggregate";       // No gaps, proceed
  if (state.isAlignmentRetry) return "aggregate";   // Already retried, don't loop
  return "retry";                                    // Gaps found, retry
}
```

This guarantees at most one retry pass. If the retry also produces incomplete results (e.g., a target is genuinely down), the aggregator handles the remaining gaps with "N/A" values.

### Relationship to Other Patterns

- **Section 23 (Tool Planning)**: Alignment retries always use planned mode with a reduced plan, even if the original query used autonomous mode. This ensures retries are fast and deterministic.
- **Section 22 (Error Resilience)**: Tool-level retries handle transient failures (timeouts, connection errors) within a single sub-agent. Alignment handles structural inconsistency across sub-agents -- a different failure mode.
- **AI Engineering Guide, Section 13 (Complementary Tool Pairing)**: Alignment leverages the same tool-to-metric mapping used by complementary pairing. If tool A and tool B are complementary, and one target only called tool A, alignment re-dispatches tool B.

---

## Appendix: File Index

| Section | Primary Source File |
|---------|-------------------|
| 1 | `packages/backend/package.json` |
| 2 | `src/ai/graph/workflow.ts` |
| 3 | `src/ai/clients/chat-bedrock-bearer.ts` |
| 4 | `src/ai/config/bedrock-config.ts` |
| 5 | `src/ai/graph/state.ts` |
| 6 | `src/ai/graph/workflow.ts`, `src/ai/graph/edges.ts` |
| 7 | `src/ai/graph/nodes/classifier.ts`, `src/ai/graph/cache/classifier-cache.ts` |
| 8 | `src/ai/graph/nodes/entity-extractor.ts` |
| 9 | `src/ai/graph/nodes/tool-router.ts`, `src/ai/graph/query-patterns.ts` |
| 10 | `src/ai/graph/nodes/retriever.ts` |
| 11 | `src/ai/graph/nodes/agent.ts` |
| 12 | `src/ai/graph/helpers/prompt-context.ts` |
| 13 | `src/ai/graph/tools.ts` |
| 14 | `src/ai/tools/base-tool.ts`, `src/ai/tools/helpers/shared-schemas.ts`, `src/ai/tools/helpers/timeframe-resolver.ts`, `src/ai/tools/helpers/cost-record-fetcher.ts` |
| 15 | Individual tool files in `src/ai/tools/` |
| 16 | `src/ai/graph/nodes/response-validator.ts` |
| 17 | `src/ai/graph/nodes/responder.ts` |
| 18 | `src/ai/graph/service.ts` |
| 19 | `src/routes/ai.ts`, `src/routes/middleware.ts` |
| 20 | `src/ai/graph/service.ts`, `src/ai/graph/state-pruning.ts` |
| 21 | `src/ai/config/langsmith.config.ts` |
| 22 | `src/ai/middleware/tool-retry.ts`, `src/ai/tools/helpers/no-data-handler.ts`, `src/ai/services/follow-up-generator.ts` |
| 23 | `src/ai/graph/helpers/tool-plan.ts`, `src/ai/graph/nodes/supervisor.ts`, `src/ai/graph/nodes/sub-agent.ts` |
| 24 | `src/ai/graph/nodes/alignment.ts`, `src/ai/graph/helpers/metric-extractors.ts` |

All source paths are relative to `packages/backend/`.
