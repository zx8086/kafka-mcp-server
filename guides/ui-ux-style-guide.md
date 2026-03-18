# UI/UX Styling Guide

Complete design system reference for the AWS Cost Analyzer frontend. Use this guide to replicate the same look and feel in another Svelte 5 chat application.

---

## Theming for Your Brand

This guide uses Tommy Hilfiger brand colors as its reference implementation. The color tokens in Section 2 are the **only brand-specific layer** -- all layout, animation, spacing, and component patterns are reusable as-is.

To re-theme for a different brand, replace the `--color-tommy-*` tokens in `src/tailwind.css`:

```css
@theme {
  /* Replace these with your brand colors */
  --color-tommy-navy: #YOUR_PRIMARY;
  --color-tommy-dark-navy: #YOUR_PRIMARY_DARK;
  --color-tommy-red: #YOUR_ACCENT;
  --color-tommy-red-ui: #YOUR_ACCENT_INTERACTIVE;
  --color-tommy-offwhite: #YOUR_BACKGROUND;
  --color-tommy-accent-blue: #YOUR_SECONDARY;
  --color-tommy-cream: #YOUR_SURFACE;
  --color-tommy-slate: #YOUR_TEXT;
}
```

Everything else -- the gray scale, semantic colors, animations, stagger utilities, and the `--color-blue-*` Tailwind mappings -- can stay unchanged or be adjusted independently. The animations and layout patterns in Sections 2-11 have no brand coupling.

---

## 1. Tech Stack & Dependencies

```json
{
  "dependencies": {
    "@shimmer-from-structure/svelte": "^2.3.4",
    "@types/marked": "^6.0.0",
    "echarts": "^6.0.0",
    "highlight.js": "^11.11.1",
    "marked": "^17.0.4"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "^7.0.1",
    "@sveltejs/kit": "catalog:frontend",
    "@sveltejs/vite-plugin-svelte": "catalog:frontend",
    "@tailwindcss/vite": "^4.2.1",
    "svelte": "catalog:frontend",
    "svelte-check": "^4.4.5",
    "tailwindcss": "^4.2.1",
    "typescript": "catalog:",
    "vite": "catalog:frontend"
  }
}
```

Key choices:
- **Tailwind CSS v4** via Vite plugin (`@tailwindcss/vite`)
- **ECharts 6** for data visualization
- **marked + highlight.js** for markdown rendering with syntax highlighting
- **@shimmer-from-structure/svelte** for loading skeleton placeholders

---

## 2. Tailwind CSS v4 Theme

Place in `src/tailwind.css`. This is the complete theme file with all custom tokens and animations.

```css
@import "tailwindcss";

@theme {
  /* --- Brand Color Tokens (replace for your brand) --- */

  /* Tommy Hilfiger Brand Colors */
  --color-tommy-navy: #02154E;
  --color-tommy-dark-navy: #1B2651;
  --color-tommy-red: #D61233;
  --color-tommy-red-ui: #CD2028;
  --color-tommy-offwhite: #EDEAE1;
  --color-tommy-accent-blue: #166C96;
  --color-tommy-cream: #F5F3EC;
  --color-tommy-slate: #1B2651;

  /* --- Reusable Tokens (brand-independent) --- */

  /* Gray scale */
  --color-gray-50: #f9fafb;
  --color-gray-100: #f3f4f6;
  --color-gray-200: #e5e7eb;
  --color-gray-500: #6b7280;
  --color-gray-600: #4b5563;
  --color-gray-800: #1f2937;
  --color-gray-900: #111827;

  /* Blue mapped to brand navy (for existing Tailwind classes) */
  --color-blue-50: #F5F3EC;
  --color-blue-100: #EDEAE1;
  --color-blue-500: #166C96;
  --color-blue-600: #02154E;
  --color-blue-700: #1B2651;

  /* Semantic colors (data visualization) */
  --color-green-600: #16a34a;
  --color-yellow-600: #ca8a04;
  --color-red-600: #dc2626;
  --color-purple-600: #9333ea;

  /* --- Reusable Animations (brand-independent) --- */

  /* Custom animations */
  --animate-pulse-dot: pulse-dot 1.5s ease-in-out infinite;
  --animate-fade-in: fade-in 0.2s ease-out;
  --animate-pulse-glow: pulse-glow 1.5s ease-in-out infinite;
  --animate-slide-up-fade: slide-up-fade 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  --animate-pop-in: pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  --animate-cascade-in: cascade-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  --animate-fade-slide-up: fade-slide-up 0.7s ease-out forwards;
}

/* --- Keyframes --- */

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 8px 2px rgba(22, 108, 150, 0.4), 0 4px 6px -1px rgba(22, 108, 150, 0.3);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 16px 4px rgba(22, 108, 150, 0.6), 0 4px 6px -1px rgba(22, 108, 150, 0.4);
    transform: scale(1.02);
  }
}

@keyframes slide-up-fade {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pop-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes fade-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes cascade-in {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}

/* --- Stagger delay utilities --- */
.animation-delay-75 { animation-delay: 75ms; }
.animation-delay-150 { animation-delay: 150ms; }
.animation-delay-225 { animation-delay: 225ms; }
.animation-delay-300 { animation-delay: 300ms; }
.animation-delay-375 { animation-delay: 375ms; }
.animation-delay-450 { animation-delay: 450ms; }

/* --- Accessibility --- */
.focus-ring { outline: none; }
.focus-ring:focus-visible {
  outline: 2px solid var(--color-tommy-navy);
  outline-offset: 2px;
}
```

Usage: `bg-tommy-navy`, `text-tommy-cream`, `border-tommy-offwhite`, `animate-pulse-dot`, etc.

---

## 3. Global CSS Resets

Place in `src/app.css`. Minimal resets only.

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background-color: #fafafa;
  color: #1a1a1a;
}

table {
  border-collapse: collapse;
}
```

Import order in `+layout.svelte`:
```svelte
<script lang="ts">
  import '../app.css';
  import '../tailwind.css';
</script>
```

---

## 4. Color System

### Brand Colors

| Token | Hex | Tailwind Class | Usage |
|-------|-----|----------------|-------|
| `tommy-navy` | `#02154E` | `bg-tommy-navy` | Headers, buttons, primary icons, send button, user message bubbles |
| `tommy-dark-navy` | `#1B2651` | `bg-tommy-dark-navy` | Hover states, emphasis text, chart chrome |
| `tommy-red` | `#D61233` | `text-tommy-red` | Brand accent in charts |
| `tommy-red-ui` | `#CD2028` | `text-tommy-red-ui` | UI delete/danger actions |
| `tommy-accent-blue` | `#166C96` | `text-tommy-accent-blue` | Links, highlights, active ring on streaming nodes |
| `tommy-cream` | `#F5F3EC` | `bg-tommy-cream` | Info banners, follow-up/quick-action backgrounds |
| `tommy-offwhite` | `#EDEAE1` | `bg-tommy-offwhite` | Borders, progress tracks, streaming progress background |

### Semantic Colors (never replaced with brand colors)

| Name | Hex | Usage |
|------|-----|-------|
| Savings/Positive | `#16a34a` (green-600) | Cost decreases, completed steps, success states |
| Cost Increase/Negative | `#dc2626` (red-600) | Cost spikes, severe anomalies, errors |
| Warning | `#ca8a04` (yellow-600) | Medium priority, caution states |
| Info | `#9333ea` (purple-600) | Informational, previous period comparisons |

### Chart Series Palette (12 colors)

Used for ECharts series. Position matters - first 4 are brand-anchored:

```typescript
export const chartSeriesPalette = [
  '#02154E',  // tommy-navy (primary)
  '#16a34a',  // green-600 (savings)
  '#D61233',  // tommy-red (brand accent)
  '#166C96',  // tommy-accent-blue (secondary)
  '#ea580c',  // orange-600
  '#1B2651',  // tommy-dark-navy
  '#9333ea',  // purple-600
  '#0891b2',  // cyan-600
  '#db2777',  // pink-600
  '#65a30d',  // lime-600
  '#0d9488',  // teal-600
  '#f59e0b',  // amber-500
] as const;
```

### Chart Chrome Colors

```typescript
export const chartChrome = {
  text: '#1B2651',          // tommy-dark-navy
  axisLine: '#e5e7eb',      // gray-200
  gridLine: '#f3f4f6',      // gray-100
  tooltipBg: '#1B2651',     // tommy-dark-navy
  dataZoomHandle: '#02154E', // tommy-navy
  dataZoomBorder: '#e5e7eb', // gray-200
  dataZoomFiller: 'rgba(2, 21, 78, 0.1)',
};
```

---

## 5. Typography

### Font Stack

```css
font-family: system-ui, -apple-system, sans-serif;
```

Monospace (code blocks):
```css
font-family: 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', Consolas, 'Courier New', monospace;
```

### Size Hierarchy (Chat Panel Context)

All sizes are optimized for a sidebar chat panel (~320-700px wide):

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Markdown body | `0.75rem` (12px) | 400 | `#111827` |
| Markdown H1 | `1rem` (16px) | 700 | `#111827` |
| Markdown H2 | `0.875rem` (14px) | 600 | `#111827` |
| Markdown H3 | `0.8125rem` (13px) | 600 | `#1f2937` |
| Markdown H4-H6 | `0.75rem` (12px) | 500 | `#1f2937` / `#374151` |
| Table headers | `0.5rem` (8px) | 600 | `#6b7280` (uppercase, tracked) |
| Table cells | `0.5rem` (8px) | 400 | `#111827` |
| Inline code | `0.6875rem` (11px) | 400 | `#1f2937` on `#f3f4f6` bg |
| Code blocks | `0.6875rem` (11px) | 400 | `#f3f4f6` on `#111827` bg |
| Chat header title | `text-sm` (14px) | 600 (`font-semibold`) | `text-gray-900` |
| Chat timestamp | `text-xs` (12px) | 400 | `text-gray-500` |
| Node/tool labels | `0.625rem` (10px) | 500 | Varies by status |
| Section headers (e.g. "Tool Use:") | `0.625rem` (10px) | 600 | `#64748b` (uppercase, tracked) |
| Follow-up/Quick action header | `0.6875rem` (11px) | 600 | `#02154E` (uppercase) |
| Follow-up/Quick action button text | `0.6875rem` (11px) | 500 | `#1B2651` |
| Agent info labels | `0.6875rem` (11px) | 500 | `#64748b` |
| Entity badges | `0.625rem` (10px) | 500 | Gradient backgrounds per type |

### Responsive Adjustments

```css
@media (max-width: 640px) {
  .markdown-content { font-size: 0.6875rem; }
  .markdown-content h1 { font-size: 0.875rem; }
  .markdown-content h2 { font-size: 0.8125rem; }
  .markdown-content pre { font-size: 0.625rem; padding: 0.5rem; }
  .markdown-content .markdown-table th,
  .markdown-content .markdown-table td { padding: 0.375rem 0.5rem; font-size: 0.625rem; }
}
```

---

## 6. Layout System

### Three-Panel Architecture

```
+------------------+---+---------------------+---+------------------+
|   Left Panel     | R |   Center Panel      | R |   Right Panel    |
|   (Navigation)   | e |   (Main Content)    | e |   (Chat)         |
|                  | s |                     | s |                  |
|   200-480px      | i |   min 400px         | i |   320-700px      |
|   default: 384px | z |   flex: 1           | z |   default: 384px |
|                  | e |                     | e |                  |
|   Always visible | r |                     | r |   Collapsible    |
+------------------+---+---------------------+---+------------------+
```

### Panel Constraints

```typescript
const CONSTRAINTS = {
  left:   { min: 200, max: 480 },
  right:  { min: 320, max: 700 },
  center: { min: 400 }
};
```

### Container

```svelte
<div class="flex h-screen w-screen overflow-hidden bg-gray-100">
  <!-- Left Panel -->
  <div class="shrink-0 overflow-hidden" style:width="{leftWidth}px">
    <SplitNavigation />
  </div>

  <PanelResizer position="left" onResize={handleLeftResize} />

  <!-- Center Panel -->
  <div class="flex-1 flex flex-col min-w-0">
    <main id="main-content" class="flex-1 overflow-y-auto bg-gray-50">
      {@render children()}
    </main>
  </div>

  <PanelResizer position="right" onResize={handleRightResize}
    onDoubleClick={toggleRightCollapse} isCollapsed={rightCollapsed} />

  <!-- Right Panel -->
  <div class="shrink-0 overflow-hidden transition-[width] duration-200 ease-out
    {rightCollapsed || isNarrowScreen.current ? '' : 'border-l border-gray-200'}"
    style:width={rightCollapsed || isNarrowScreen.current ? '0px' : `${effectiveRightWidth}px`}>
    {#if !rightCollapsed && !isNarrowScreen.current}
      <ChatInterface />
    {/if}
  </div>
</div>
```

### Responsive Breakpoints

```typescript
// Svelte 5 reactive MediaQuery
const isNarrowScreen = new MediaQuery('max-width: 1024px', false);
const isMobileScreen = new MediaQuery('max-width: 768px', false);
```

- **<= 1024px**: Right panel auto-collapses; expand button shown
- **<= 768px**: Mobile layout adjustments

### Panel Persistence

Panel sizes are persisted to `localStorage` under key `aws-cost-analyzer-panel-sizes`, debounced at 100ms:

```json
{
  "leftWidth": 384,
  "rightWidth": 384,
  "rightCollapsed": false,
  "rightWidthBeforeCollapse": 384
}
```

### Right Panel Collapse

- Double-click the right resizer to toggle collapse
- Collapsed state shows a fixed expand button:

```svelte
<button class="fixed right-0 top-1/2 -translate-y-1/2 z-50 w-6 h-12
  bg-white/95 border border-gray-200 rounded-l-md
  flex items-center justify-center cursor-pointer
  transition-colors duration-200 shadow-sm hover:bg-slate-100">
```

### Panel Resizer Component

Interactive drag handle with keyboard support:

```svelte
<button class="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent
  border-0 p-0 transition-colors duration-150 z-10
  hover:bg-blue-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
  <!-- Visual handle indicator (centered pill) -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
    w-1 h-10 bg-gray-300 rounded-sm
    opacity-0 transition-all duration-150
    group-hover:opacity-100 group-hover:bg-blue-500"></div>
</button>
```

- Arrow keys resize (10px per step, 50px with Shift)
- Enter/Space toggles collapse (right panel only)

---

## 7. Chat Interface Patterns

### Chat Container

```svelte
<div class="flex flex-col h-full bg-white border-l border-gray-200">
  <!-- Header -->
  <!-- Messages -->
  <!-- Quick Actions (when no messages) -->
  <!-- Input Area -->
</div>
```

### Chat Header

```svelte
<div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
  <div class="flex flex-col gap-0.5">
    <div class="flex items-center gap-2">
      <div class="flex items-center justify-center w-7 h-7 bg-[#02154E] rounded-full">
        <Icon name="message-circle" class="w-4 h-4 text-white" />
      </div>
      <h3 class="font-semibold text-gray-900 text-sm">AWS Cost Intelligence</h3>
    </div>
    <!-- Scope indicator (when a node is selected) -->
    {#if selectedNode}
      <div class="flex items-center gap-1.5 ml-9 text-xs text-gray-500">
        <Icon name="filter" class="w-3 h-3" />
        <span>Scope: <span class="font-medium text-[#02154E]">{selectedNode.name}</span></span>
        <span class="text-gray-400">({selectedNode.type})</span>
      </div>
    {/if}
  </div>
  <!-- Action buttons: Reset conversation + Connection status -->
</div>
```

### Message Bubbles

**User messages** (right-aligned, navy background):
```svelte
<div class="px-3 py-2 rounded-lg bg-[#02154E] text-white">
  <p class="text-sm whitespace-pre-wrap break-words">{message.content}</p>
</div>
```

**AI messages** (left-aligned, light border):
```svelte
<div class="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
  <CompletedProgress ... />
  <MessageRenderer ... />
</div>
```

**Avatar pattern**:
- Bot: `w-7 h-7 bg-[#EDEAE1] rounded-full` with navy icon
- User: `w-7 h-7 bg-gray-100 rounded-full` with gray icon
- Max message width: `max-w-[85%]`

### Message Status Indicators

Small dots next to timestamps:
```svelte
<!-- Sending -->  <div class="w-1.5 h-1.5 bg-tommy-navy rounded-full animate-pulse"></div>
<!-- Sent -->     <div class="w-1.5 h-1.5 bg-[#02154E] rounded-full"></div>
<!-- Delivered --> <div class="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
<!-- Failed -->   <div class="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
```

### Typing Indicator

Three pulsing dots with staggered delays:
```svelte
<div class="flex space-x-1">
  <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse"></div>
  <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style="animation-delay: 0.2s"></div>
  <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style="animation-delay: 0.4s"></div>
</div>
<p class="text-xs text-gray-500 mt-0.5">AI is thinking...</p>
```

### Input Area

```svelte
<div class="px-4 py-3 border-t border-gray-200 bg-white">
  <!-- Error banner (conditional) -->
  <div class="flex gap-2 items-end">
    <textarea
      class="flex-1 px-3 py-2 border border-gray-300 rounded-md resize-none
        focus:ring-1 focus:ring-[#02154E] focus:border-[#02154E]
        disabled:bg-gray-50 text-sm"
      rows="2"
    ></textarea>
    <button
      class="min-w-[44px] min-h-[44px] px-3 py-2 bg-[#02154E] text-white rounded-md
        hover:bg-[#1B2651] disabled:opacity-50 disabled:cursor-not-allowed
        flex items-center justify-center transition-colors shrink-0"
    >
      <Icon name="send" class="w-5 h-5" />
    </button>
  </div>
  <!-- Status line below -->
  <div class="mt-1.5 flex items-center justify-between">
    <div class="flex items-center gap-2 text-xs text-gray-400">
      <!-- "Processing with AI..." / "X messages" / etc. -->
    </div>
  </div>
</div>
```

Key: Enter sends, Shift+Enter creates newline. Minimum touch target: 44x44px.

### Error Banner (in input area)

```svelte
<div class="mb-2 p-2 bg-red-50 border border-red-200 rounded-md">
  <div class="flex items-center gap-2">
    <Icon name="alert-circle" class="w-4 h-4 text-red-600" />
    <span class="text-xs text-red-700">{chatState.lastError}</span>
  </div>
</div>
```

---

## 8. Streaming Progress: State Management Flow

This section explains how the streaming system tracks nodes and tools through the AI processing pipeline, driving the progress UI in real time.

### State Variables

```typescript
let isStreaming = $state(false);
let currentNode = $state<string | null>(null);
let completedNodes = $state<string[]>([]);
let activeTools = $state<string[]>([]);
let completedTools = $state<{ name: string; duration?: number }[]>([]);
let streamingContent = $state("");
let displayedContent = $state("");
let pendingNodeCompletions = $state<string[]>([]);

// Timing trackers (Svelte 5 reactive Maps)
let toolStartTimes = new SvelteMap<string, number>();
let nodeStartTimes = new SvelteMap<string, number>();

const MIN_NODE_VISUAL_DURATION = 300; // ms - prevents flickering for fast nodes
```

### The Streaming Callback Flow

When a user sends a message, the chat calls `sendMessageWithStreaming()` which registers callbacks that fire as the AI graph executes. Here is the full lifecycle:

```
User sends message
  |
  v
resetStreamingState()     -- Clear all tracking arrays, maps, content
isStreaming = true         -- Show StreamingProgress component
  |
  v
[Backend starts graph execution, emits SSE events]
  |
  +-- onNodeStart("classify")
  |     currentNode = "classify"
  |     nodeStartTimes.set("classify", Date.now())
  |     -> UI: "classify" pill turns ACTIVE (spinner + ring)
  |
  +-- onNodeEnd("classify")
  |     elapsed = Date.now() - startTime
  |     if elapsed < 300ms:
  |       pendingNodeCompletions.push("classify")  -- keep spinner visible
  |       setTimeout(markComplete, remaining_ms)
  |     else:
  |       completedNodes.push("classify")           -- immediately mark done
  |       currentNode = null
  |     -> UI: "classify" pill turns COMPLETED (checkmark, green)
  |
  +-- onNodeStart("entityExtractor") ... onNodeEnd("entityExtractor")
  +-- onNodeStart("toolRouter") ... onNodeEnd("toolRouter")
  +-- onNodeStart("retriever") ... onNodeEnd("retriever")
  +-- onNodeStart("agent") ... onNodeEnd("agent")
  |
  +-- onToolStart("spending_analysis_tool")
  |     activeTools.push("spending_analysis_tool")
  |     toolStartTimes.set("spending_analysis_tool", Date.now())
  |     -> UI: amber "Spending Analysis" badge appears under "Executing:"
  |
  +-- onToolEnd("spending_analysis_tool", serverDuration?)
  |     activeTools.remove("spending_analysis_tool")
  |     duration = serverDuration ?? (Date.now() - startTime)
  |     completedTools.push({ name: "spending_analysis_tool", duration })
  |     -> UI: amber badge disappears, green badge with duration appears under "Tool Use:"
  |
  +-- onNodeStart("tools") ... onNodeEnd("tools")
  |     NOTE: "tools" node has special handling (see below)
  |
  +-- onNodeStart("responder") ...
  |
  +-- onToken("Here are ")
  |     streamingContent += "Here are "
  |     displayedContent = streamingContent
  |     currentNode forced to "responder" (ensures spinner stays)
  |     -> UI: markdown text appears below progress bar
  |
  +-- onToken("the results...")
  |     streamingContent += "the results..."
  |     displayedContent = streamingContent
  |     -> UI: text grows, cursor blinks at end
  |
  +-- onDone({ responseTime, runId, toolsUsed, ... })
        finalCompletedNodes = union(completedNodes, all graph nodes)
        Create final Message object with:
          - content: sanitized streamingContent
          - processingSteps: { completedNodes, completedTools }
          - metadata: { responseTime, tokens, toolsUsed }
          - runId (for LangSmith feedback)
        addMessageToConversation(aiMessage)
        resetStreamingState()
        isStreaming = false
        -> UI: StreamingProgress disappears, CompletedProgress appears
  |
  +-- onSuggestions(["Follow-up 1", "Follow-up 2"])  (async, arrives after onDone)
        updateMessageSuggestions(lastStreamingMessageId, suggestions)
        -> UI: follow-up buttons animate in below the message
```

### Minimum Visual Duration

Nodes that complete in under 300ms get a delayed completion to prevent UI flickering:

```typescript
onNodeEnd: (nodeName) => {
  const elapsed = Date.now() - (nodeStartTimes.get(nodeName) ?? Date.now());
  const remainingTime = MIN_NODE_VISUAL_DURATION - elapsed;

  if (remainingTime > 0) {
    // Node stays "active" (spinner) until minimum time elapses
    pendingNodeCompletions = [...pendingNodeCompletions, nodeName];
    setTimeout(() => {
      completedNodes = [...completedNodes, nodeName];
      pendingNodeCompletions = pendingNodeCompletions.filter(n => n !== nodeName);
    }, remainingTime);
  } else {
    completedNodes = [...completedNodes, nodeName];
  }
}
```

### Special "tools" Node Handling

The "tools" node has unique logic because the agent may invoke tools multiple times:

```typescript
function getNodeStatus(nodeId: string): "completed" | "active" | "pending" {
  if (nodeId === "tools") {
    // Only mark complete when responder has started
    // (keeps tools spinning while agent is still analyzing tool results)
    const responderStarted = completedNodes.includes("responder") || currentNode === "responder";
    if (responderStarted && completedNodes.includes("tools")) return "completed";
    if (completedNodes.includes("tools") || activeTools.length > 0) return "active";
    return "pending";
  }
  // Normal nodes
  if (completedNodes.includes(nodeId)) return "completed";
  if (currentNode === nodeId) return "active";
  if (pendingNodeCompletions.includes(nodeId)) return "active";
  return "pending";
}
```

### Token Guarding

The `onToken` callback validates content before appending, preventing `[object Object]` or empty strings:

```typescript
onToken: (content) => {
  if (typeof content !== 'string' || content.length === 0) return;
  streamingContent += content;
  updateDisplayedContent(streamingContent);
  // Force responder node active while tokens stream
  if (currentNode !== 'responder') {
    currentNode = 'responder';
    completedNodes = completedNodes.filter(n => n !== 'responder');
  }
}
```

### Node Definitions (Ordered)

These map to the actual graph workflow:

| Node ID | UI Label (Active) | UI Label (Complete) | Description |
|---------|-------------------|---------------------|-------------|
| `classify` | Analyzing | Analyzed | Query complexity classification |
| `entityExtractor` | Extracting | Extracted | Entity and timeframe identification |
| `toolRouter` | Routing | Routed | Deterministic tool selection |
| `retriever` | Fetching | Fetched | Cost data retrieval |
| `agent` | Reasoning | Reasoned | LLM analysis |
| `tools` | Tools | Tools | Database query execution |
| `responder` | Generating | Generated | Response creation |
| `suggester` | (n/a) | Suggested | Follow-up generation (async) |

Note: `validator` is excluded because it is a pure JS function that doesn't emit LangChain streaming events.

### Tool Display Name Formatting

Tool names from the backend arrive in `snake_case`. The UI transforms them:

```typescript
function getToolDisplayName(toolName: string): string {
  return toolName
    .replace(/_tool$/, '')  // "spending_analysis_tool" -> "spending_analysis"
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');             // -> "Spending Analysis"
}
```

### Duration Formatting

```typescript
function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
```

### Lifecycle Summary

| Phase | `isStreaming` | StreamingProgress visible | CompletedProgress visible | Content visible |
|-------|:------------:|:------------------------:|:------------------------:|:---------------:|
| Before send | false | No | No (previous messages have theirs) | No |
| Processing | true | Yes (nodes + tools updating) | No | Grows as tokens arrive |
| After onDone | false | No | Yes (collapsed by default) | Full message |
| After onSuggestions | false | No | Yes | Full + follow-up buttons |

---

## 9. Streaming Progress UI (Styling)

### Active Streaming Progress

Shown during AI processing. Gradient background with node timeline:

```svelte
<div class="bg-gradient-to-br from-tommy-offwhite/80 to-tommy-offwhite
  border border-tommy-offwhite rounded-xl p-3 mb-3 text-xs">
```

**Status bar** (top row):
```svelte
<div class="flex items-center gap-2">
  <span class="w-2 h-2 rounded-full bg-tommy-navy animate-pulse-dot"></span>
  <span class="font-medium text-tommy-navy">{activeNodeLabel}...</span>
</div>
```

**Node timeline** (horizontal pill badges):

| Status | Classes |
|--------|---------|
| Pending | `text-gray-400 bg-gray-100` |
| Active | `text-tommy-navy bg-tommy-offwhite ring-2 ring-tommy-accent-blue` + spinner |
| Completed | `text-green-700 bg-green-100` + checkmark |

Badge: `py-1 px-2 rounded-full text-[0.625rem] font-medium transition-all duration-200`

**Active tools** (amber badges):
```
py-1 px-2 rounded-md text-[0.625rem] font-medium text-amber-700 bg-amber-100 border border-amber-300
```

**Completed tools** (green badges):
```
py-1 px-2 rounded-md text-[0.625rem] font-medium text-green-700 bg-green-100 border border-green-300
```

### Completed Progress (Collapsible)

Green gradient toggle button that expands to show step details:

```css
.toggle-button {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border: 1px solid #bbf7d0;
  border-radius: 0.5rem;
}
.toggle-button:hover {
  background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
}
.summary-text { color: #166534; font-weight: 500; }
.details { background-color: #f0fdf4; border: 1px solid #bbf7d0; }
.node-item { color: #15803d; background-color: #dcfce7; border-radius: 9999px; }
```

### Streaming Text Cursor

While content is still streaming, a blinking cursor block appears:
```svelte
<span class="inline-block w-2 h-4 bg-[#02154E] animate-pulse ml-0.5 align-middle"></span>
```

---

## 10. Follow-Up Questions & Quick Actions

Both share the same visual pattern: a cream-gradient container with a navy left border.

### Container

```css
.follow-up-container,
.quick-actions-container {
  padding: 0.75rem;
  background: linear-gradient(135deg, #F5F3EC 0%, #EDEAE1 100%);
  border: 1px solid #EDEAE1;
  border-radius: 0.5rem;
  border-left: 2px solid #02154E;
}
```

### Header

```css
.follow-up-header,
.quick-actions-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #02154E;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}
```

### Pill Buttons (shared pattern)

```css
.follow-up-button,
.quick-action-button {
  display: inline-flex;
  align-items: center;
  padding: 0.375rem 0.625rem;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: 9999px;
  border: 1px solid #EDEAE1;
  background-color: white;
  color: #1B2651;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  position: relative;
  overflow: hidden;
}
```

**Hover effect** (lift + glow + shimmer sweep):
```css
.follow-up-button:hover {
  border-color: #02154E;
  background: linear-gradient(135deg, #F5F3EC 0%, #EDEAE1 100%);
  color: #02154E;
  box-shadow: 0 4px 12px rgba(2, 21, 78, 0.25), 0 2px 4px rgba(2, 21, 78, 0.15);
  transform: translateY(-2px) scale(1.02);
}

/* Light sweep animation on hover */
.follow-up-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(2, 21, 78, 0.1), transparent);
  transition: left 0.4s ease;
}
.follow-up-button:hover::before { left: 100%; }
```

**Press effect**:
```css
.follow-up-button:active {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  transition: all 0.1s ease;
}
```

### Staggered Animation on Follow-up Suggestions

Each follow-up button enters with a staggered delay:
```svelte
{#each message.followUpSuggestions as suggestion, index}
  <button
    class="follow-up-button animate-fade-slide-up"
    style="animation-delay: {50 + index * 60}ms; opacity: 0;"
  >
    {suggestion}
  </button>
{/each}
```

---

## 11. Feedback System

Action bar below AI messages with copy + thumbs up/down:

```svelte
<div class="flex items-center gap-2 mt-3 p-2 bg-white border border-gray-200 rounded-lg shadow-sm"
  in:fly={{ y: 10, duration: 300, easing: cubicOut }}>
  <!-- Copy button -->
  <button class="flex items-center gap-1 px-2 py-1 text-xs text-gray-500
    hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
    <Icon name="copy" class="w-3.5 h-3.5" />
    <span>Copy</span>
  </button>

  <!-- Feedback buttons (right-aligned) -->
  <div class="flex items-center gap-1 ml-auto">
    <span class="text-xs text-gray-400 mr-1">Helpful?</span>
    <!-- Thumbs up -->
    <button class="flex items-center justify-center w-7 h-7 rounded transition-colors
      {feedbackState === 'positive' ? 'bg-green-100 text-green-600' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}">
      <Icon name={feedbackState === 'positive' ? 'thumbs-up-filled' : 'thumbs-up'} class="w-4 h-4" />
    </button>
    <!-- Thumbs down (same pattern with red) -->
  </div>
</div>
```

---

## 12. Component Patterns

### Anomaly Card

Data card with severity-colored left border:

```svelte
<div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
  <!-- Header: gradient from-red-50 to-amber-50 -->
  <div class="px-4 py-3 bg-gradient-to-r from-red-50 to-amber-50 border-b border-gray-200">
    ...
  </div>
  <!-- Summary stats: 2x4 grid -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3"> ... </div>
  <!-- Anomaly rows with severity borders -->
  <div class="px-4 py-3 border-l-4 {styles.border} {styles.bg}"> ... </div>
</div>
```

**Severity styles**:

| Severity | Border | Background | Badge BG | Badge Text |
|----------|--------|------------|----------|------------|
| Severe | `border-l-red-500` | `bg-red-50` | `bg-red-100` | `text-red-800` |
| Moderate | `border-l-amber-500` | `bg-amber-50` | `bg-amber-100` | `text-amber-800` |
| Minor | `border-l-amber-300` | `bg-amber-50/50` | `bg-amber-50` | `text-amber-700` |

Badge labels: `HIGH`, `MED`, `LOW` in `text-[10px] font-semibold px-1.5 py-0.5 rounded`.

### Entity Badges (Debug Panel)

Color-coded gradient badges per entity type:

| Entity | Gradient | Text |
|--------|----------|------|
| Domains | `from-violet-100 to-violet-200` | `text-violet-700` |
| Departments | `from-sky-100 to-sky-200` | `text-sky-700` |
| Accounts | `from-green-100 to-green-200` | `text-green-700` |
| Services | `from-orange-100 to-orange-200` | `text-orange-700` |
| Categories | `from-cyan-100 to-cyan-200` | `text-cyan-700` |
| Environments | `from-indigo-100 to-indigo-200` | `text-indigo-700` |
| Timeframe | `from-amber-100 to-amber-200` | `text-amber-700` |

Badge: `text-[10px] font-medium px-1.5 py-0.5 rounded bg-gradient-to-br cursor-default`

### Confidence/Source Badges (Agent Info)

| Badge | Text Color | Gradient |
|-------|-----------|----------|
| `confidence-high` | `#15803d` | `from-green-100 to-green-200` |
| `confidence-medium` | `#a16207` | `from-yellow-100 to-yellow-200` |
| `confidence-low` | `#b91c1c` | `from-red-100 to-red-200` |
| `source-aws_forecast` | `#0369a1` | `from-sky-100 to-sky-200` |
| `source-database` | `#15803d` | `from-green-100 to-green-200` |
| `source-calculated` | `#a16207` | `from-yellow-100 to-yellow-200` |
| `source-projected` | `#7c3aed` | `from-violet-100 to-violet-200` |

### Agent Info (Collapsible Debug Panel)

The Agent Info section appears below each delivered AI message (only in development mode via `import.meta.env.DEV`). It shows routing decisions, timing, extracted entities, and analysis quality metadata. It enters with `in:fly={{ y: 10, duration: 300, easing: cubicOut }}` as part of the staggered reveal (400ms after message delivery).

#### Visibility Conditions

```typescript
// Only shown for real AI responses, excluding welcome/streaming messages
const isDeliveredAIMessage = $derived(
  message.type === 'text' &&
  !message.isUser &&
  typeof message.content === 'string' &&
  message.status === 'delivered' &&
  !message.id.startsWith('welcome_') &&
  !message.id.startsWith('streaming_') &&
  message.agentType !== undefined
);

// Staggered reveal timing
setTimeout(() => { showActions = true; }, 100);    // Copy + feedback bar
setTimeout(() => { showFollowUp = true; }, 250);   // Follow-up questions
setTimeout(() => { showAgentInfo = true; }, 400);   // Agent info section
```

#### Toggle Button

Compact collapsible trigger with slate gradient:

```css
.agent-info-container {
  margin-top: 0.5rem;
  font-size: 0.6875rem;
}

.agent-info-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.25rem 0.5rem;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #e2e8f0;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.agent-info-toggle.expanded {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: transparent;
}

.agent-info-toggle:hover {
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
}

.agent-info-summary {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-weight: 500;
  color: #64748b;
}

.agent-info-chevron {
  width: 0.875rem;
  height: 0.875rem;
  color: #64748b;
  transition: transform 0.2s ease;
}

.agent-info-chevron.expanded {
  transform: rotate(180deg);
}
```

#### Expanded Details Panel

```css
.agent-info-details {
  padding: 0.5rem 0.625rem;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-top: none;
  border-bottom-left-radius: 0.375rem;
  border-bottom-right-radius: 0.375rem;
}
```

The details panel expands with `transition:fly={{ y: -5, duration: 200, easing: cubicOut }}`.

#### Information Rows

Key-value pairs for core agent metadata:

```css
.agent-info-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.125rem 0;
}

.agent-info-label {
  color: #64748b;
  font-weight: 500;
}

.agent-info-value {
  color: #334155;
}
```

**Displayed fields** (all conditional on availability):

| Field | Source | Example |
|-------|--------|---------|
| Agent | `message.agentType` | `langgraph` |
| Processing | `message.agentInfo.processingTime` | `12s` (via `formatDuration()`) |
| Routing | `message.agentInfo.routingDecision` | `LangGraph workflow` |
| Tokens | `message.metadata.tokens` | `4,231` |

#### Extracted Entities Section

Displayed when `message.extractedEntities` contains any entities. Each entity type gets its own labeled group with color-coded gradient badges:

```svelte
<div class="mt-2 pt-2 border-t border-slate-200">
  <span class="agent-info-label">Extracted Entities:</span>
  <div class="flex flex-col gap-1.5 mt-1">
    <!-- Entity groups: Domains, Departments, Accounts, Services, Categories, Environments, Timeframe -->
  </div>
</div>
```

**Entity type labels**: `text-[9px] text-slate-500 uppercase tracking-wide`

**Entity badges**: `text-[10px] font-medium px-1.5 py-0.5 rounded bg-gradient-to-br cursor-default`

| Entity Type | Gradient | Text Color |
|-------------|----------|------------|
| Domains | `from-violet-100 to-violet-200` | `text-violet-700` |
| Departments | `from-sky-100 to-sky-200` | `text-sky-700` |
| Accounts | `from-green-100 to-green-200` | `text-green-700` |
| Services | `from-orange-100 to-orange-200` | `text-orange-700` |
| Categories | `from-cyan-100 to-cyan-200` | `text-cyan-700` |
| Environments | `from-indigo-100 to-indigo-200` | `text-indigo-700` |
| Timeframe | `from-amber-100 to-amber-200` | `text-amber-700` |

Timeframe badges include a resolved date range in `text-[9px] text-stone-500 ml-1`.

#### Account Tags Section

When `message.extractedEntities.tags` has entries, displayed as key-value pairs:

```svelte
<div class="mt-2 pt-2 border-t border-slate-200">
  <span class="agent-info-label">Account Tags:</span>
  <div class="flex flex-col gap-1.5 mt-1">
    {#each Object.entries(tags) as [key, value]}
      <div class="flex items-start gap-1.5">
        <span class="text-[9px] text-slate-500 uppercase tracking-wide min-w-[80px]">{key}:</span>
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded
          bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700
          cursor-default whitespace-pre-line">{value}</span>
      </div>
    {/each}
  </div>
</div>
```

#### Reasoning Steps

When `message.metadata.reasoningSteps` is available:

```css
.agent-info-reasoning {
  margin-top: 0.375rem;
  padding-top: 0.375rem;
  border-top: 1px dashed #e2e8f0;
}

.agent-info-steps {
  margin: 0.25rem 0 0 1rem;
  padding: 0;
  font-size: 0.625rem;
  color: #475569;
}

.agent-info-steps li {
  padding: 0.125rem 0;
}
```

Displayed as a numbered `<ol>` with the step count in the header: `Reasoning (N steps):`.

#### Analysis Metadata Section

When `message.metadata.analysisMetadata` is present, shows a grid of quality indicators:

```css
.agent-info-analysis {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e2e8f0;
}

.agent-info-analysis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.375rem;
  margin-top: 0.25rem;
}

.agent-info-analysis-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.agent-info-sublabel {
  font-size: 0.5625rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.agent-info-subvalue {
  font-size: 0.625rem;
  color: #334155;
  font-weight: 500;
}
```

**Grid fields** (all conditional):

| Field | Source | Display |
|-------|--------|---------|
| Data Confidence | `overall_confidence` or `confidence` | Badge (high/medium/low colored) with optional months ratio |
| Data Source | `source` | Badge (`AWS Forecast` / `Database` / `Calculated` / `Projected`) |
| Records | `recordCount` | Formatted number with `.toLocaleString()` |
| Date Range | `dateRange.start` to `dateRange.end` | Date string |
| Completeness | `dataCompleteness` | Percentage |

**Confidence badge colors**:

```css
.confidence-high   { color: #15803d; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); }
.confidence-medium { color: #a16207; background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%); }
.confidence-low    { color: #b91c1c; background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); }
```

**Source badge colors**:

```css
.source-aws_forecast { color: #0369a1; background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); }
.source-database     { color: #15803d; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); }
.source-calculated   { color: #a16207; background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%); }
.source-projected    { color: #7c3aed; background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%); }
.source-avg          { color: #6b7280; background: #f3f4f6; }
```

All badges: `padding: 0.125rem 0.375rem; border-radius: 0.25rem; display: inline-block;`

#### Methodology & Assumptions

Below the grid, optional text sections:

```css
.agent-info-methodology-text {
  margin: 0.125rem 0 0 0;
  font-size: 0.5625rem;
  color: #475569;
  line-height: 1.4;
  font-style: italic;
}

.agent-info-assumptions-list,
.agent-info-caveats-list {
  margin: 0.125rem 0 0 1rem;
  padding: 0;
  font-size: 0.5625rem;
}

.agent-info-assumptions-list { color: #64748b; }
.agent-info-caveats-list { color: #b45309; }

.agent-info-assumptions-list li,
.agent-info-caveats-list li {
  padding: 0.0625rem 0;
  list-style-type: disc;
}
```

#### Complete Agent Info Data Flow

```
Message delivered with agentType
  |
  v
isDeliveredAIMessage = true
  |
  v  (after 400ms delay)
showAgentInfo = true
  |
  v
Agent Info toggle renders (collapsed by default)
  |
  v  (user clicks toggle)
agentInfoExpanded = true
  |
  v
Details panel flies in (y: -5, 200ms)
  |
  +-- Row: Agent type (message.agentType)
  +-- Row: Processing time (message.agentInfo.processingTime -> formatDuration)
  +-- Row: Routing decision (message.agentInfo.routingDecision)
  +-- Row: Tokens (message.metadata.tokens)
  |
  +-- Section: Extracted Entities (if any exist)
  |     +-- Domains (violet badges)
  |     +-- Departments (sky badges)
  |     +-- Accounts (green badges)
  |     +-- Services (orange badges)
  |     +-- Categories (cyan badges)
  |     +-- Environments (indigo badges)
  |     +-- Timeframe (amber badge with resolved dates)
  |
  +-- Section: Account Tags (if tags exist)
  |     +-- Key-value pairs with slate badges
  |
  +-- Section: Reasoning Steps (if reasoningSteps exist)
  |     +-- Ordered list of steps
  |
  +-- Section: Analysis Metadata (if analysisMetadata exists)
        +-- Grid: Confidence, Source, Records, Date Range, Completeness
        +-- Methodology (italic paragraph)
        +-- Assumptions (bulleted list, gray)
        +-- Caveats (bulleted list, amber/warning)
```

---

### Tooltip

1-second delay, positioned below trigger:

```svelte
<div class="tooltip absolute top-full left-1/2 -translate-x-1/2 mt-2
  px-2.5 py-1.5 bg-black/90 text-white text-xs leading-snug rounded
  whitespace-nowrap pointer-events-none z-[9999] animate-fade-in">
  {text}
</div>
```

Arrow (CSS pseudo-element, cannot be done with Tailwind):
```css
.tooltip::after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: rgba(0, 0, 0, 0.9);
}
```

### Modal/Dialog (Export)

Backdrop + centered card:
```svelte
<div class="fixed absolute bg-black bg-opacity-50 flex items-center justify-center p-4"
  role="dialog" aria-modal="true">
  <div class="bg-white rounded-lg shadow w-80 w-full overflow-y-auto">
    <!-- Header: p-6 border-b -->
    <!-- Content: p-6 space-y-6 -->
    <!-- Actions: p-6 border-t flex flex-col gap-3 -->
  </div>
</div>
```

Closes on: backdrop click, Escape key, or close button.

### Carousel

Horizontal snap-scroll carousel with:
- `snap-x snap-mandatory overflow-x-auto scroll-smooth`
- Hidden scrollbar: `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`
- Dot navigation: `h-2 w-2 rounded-full` (active: `scale-125 bg-blue-500`)
- Counter: `text-xs text-gray-500 tabular-nums`
- Auto-play support with pause-on-hover
- `prefers-reduced-motion` respected

### Reset Conversation Button

Destructive action with color-shifting hover:
```svelte
<button class="min-w-[44px] min-h-[44px] p-2 text-red-500
  hover:text-white hover:bg-red-500 bg-transparent
  border-2 border-transparent hover:border-red-500 rounded-lg
  transition-all disabled:text-gray-300">
  <Icon name="trash-2" class="w-5 h-5" />
</button>
```

---

## 13. Animation System

### Named Animations (via Tailwind theme)

| Class | Keyframes | Duration | Easing | Usage |
|-------|-----------|----------|--------|-------|
| `animate-pulse-dot` | Scale 1 -> 1.2 + opacity | 1.5s infinite | ease-in-out | Active node indicator |
| `animate-fade-in` | Opacity + translateY(-4px) | 0.2s | ease-out | Tooltip entrance |
| `animate-pulse-glow` | Box-shadow + scale(1.02) | 1.5s infinite | ease-in-out | Highlighted elements |
| `animate-slide-up-fade` | Opacity + translateY(12px) | 0.4s | cubic-bezier(0.16,1,0.3,1) | Container entrance |
| `animate-pop-in` | Opacity + scale(0.8) | 0.35s | cubic-bezier(0.34,1.56,0.64,1) | Button entrance |
| `animate-cascade-in` | Opacity + translateX(-8px) | 0.4s | cubic-bezier(0.22,1,0.36,1) | Staggered list items |
| `animate-fade-slide-up` | Opacity + translateY(8px) | 0.7s | ease-out | Follow-up buttons |

### Svelte Transitions

Used via `svelte/transition`:
```typescript
import { fly, fade } from 'svelte/transition';
import { cubicOut } from 'svelte/easing';

// Action bar entrance
in:fly={{ y: 10, duration: 300, easing: cubicOut }}

// Agent info expand
transition:fly={{ y: -5, duration: 200, easing: cubicOut }}
```

### Stagger Pattern

Follow-up buttons use inline `animation-delay` with a per-item offset:
```svelte
style="animation-delay: {50 + index * 60}ms; opacity: 0;"
```

The `opacity: 0` initial state is necessary because `forwards` fill mode keeps the final keyframe value (`opacity: 1`), but the element needs to start invisible.

### Staggered Reveal (Message Actions)

After a delivered AI message, elements reveal sequentially:
```typescript
setTimeout(() => { showActions = true; }, 100);
setTimeout(() => { showFollowUp = true; }, 250);
setTimeout(() => { showAgentInfo = true; }, 400);
setTimeout(() => { scrollToShowContent(); }, 750);
```

### Stagger Delay Utilities

Pre-defined CSS classes for use with `animate-cascade-in`:
```css
.animation-delay-75  { animation-delay: 75ms; }
.animation-delay-150 { animation-delay: 150ms; }
.animation-delay-225 { animation-delay: 225ms; }
.animation-delay-300 { animation-delay: 300ms; }
.animation-delay-375 { animation-delay: 375ms; }
.animation-delay-450 { animation-delay: 450ms; }
```

---

## 14. Icon System

### Architecture

All icons are inline SVGs rendered via a single `Icon.svelte` component. No external icon library.

```svelte
<script lang="ts">
  let { name, size = '24', class: className = '', ...props } = $props();
  const icons: Record<string, string> = { /* SVG path data */ };
  const svgContent = $derived(icons[name] || '');
</script>

<svg width={size} height={size} viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" class={className}>
  {@html svgContent}
</svg>
```

### Usage

```svelte
<Icon name="send" class="w-5 h-5" />
<Icon name="bot" class="w-3.5 h-3.5 text-[#02154E]" />
<Icon name="trending-up" class="w-4 h-4 text-red-600" />
```

### Available Icons (69 icons)

**Navigation & UI**: `chevron-down`, `chevron-right`, `chevron-left`, `chevron-up`, `menu`, `x`, `search`, `filter`, `home`, `settings`, `sidebar`, `panel-left`, `panel-right`, `layout-sidebar`, `arrow-right`, `grid-3x3`

**Communication**: `message-circle`, `message-square`, `send`, `inbox`

**Data & Charts**: `bar-chart`, `bar-chart-2`, `bar-chart-3`, `line-chart`, `pie-chart`, `trending-up`, `trending-down`, `activity`, `layers`

**Finance**: `dollar-sign`, `piggy-bank`

**Status & Alerts**: `alert-triangle`, `alert-circle`, `check-circle`, `check`, `info`, `loader-2`

**Actions**: `download`, `share-2`, `copy`, `refresh-cw`, `trash-2`

**Users & Org**: `user`, `users`, `building-2`, `globe`

**Tech**: `bot`, `code`, `braces`, `database`, `server`, `hard-drive`, `cpu`

**Time**: `clock`, `calendar`, `calendar-clock`

**Connectivity**: `wifi`, `wifi-off`

**Misc**: `file-text`, `lightbulb`, `zap`, `scaling`, `pause-circle`, `bars-arrow-up`

**Feedback**: `thumbs-up`, `thumbs-down`, `thumbs-up-filled`, `thumbs-down-filled`

The "filled" variants use `fill="currentColor" stroke="currentColor"` on their paths.

---

## 15. Markdown Rendering

### Dependencies

```typescript
import { marked } from 'marked';
import hljs from 'highlight.js';
```

### Configuration

```typescript
marked.setOptions({
  renderer,  // Custom renderer (see below)
  pedantic: false,
  gfm: true,
  breaks: true,
});
```

### Custom Renderers

- **Code blocks**: highlight.js with language detection
- **Inline code**: `.inline-code` class
- **Tables**: Custom `.markdown-table` with responsive `.table-container`
- **Links**: `target="_blank" rel="noopener noreferrer"`

### Syntax Highlighting Theme (VS Code Dark-inspired)

```css
:global(.hljs) { background: #1a1a1a; color: #e6e6e6; }
:global(.hljs-keyword) { color: #569cd6; }
:global(.hljs-string) { color: #ce9178; }
:global(.hljs-number) { color: #b5cea8; }
:global(.hljs-comment) { color: #6a9955; font-style: italic; }
:global(.hljs-function) { color: #dcdcaa; }
:global(.hljs-class) { color: #4ec9b0; }
:global(.hljs-variable) { color: #9cdcfe; }
:global(.hljs-operator) { color: #d4d4d4; }
:global(.hljs-built_in) { color: #4fc1ff; }
:global(.hljs-type) { color: #4ec9b0; }
:global(.hljs-literal) { color: #569cd6; }
:global(.hljs-punctuation) { color: #d4d4d4; }
```

### Complete Markdown Stylesheet

The `MarkdownRenderer.svelte` uses scoped `:global()` styles. This is the full CSS required to replicate the markdown rendering appearance. All selectors are scoped under `.markdown-content`.

```css
/* --- Base --- */
:global(.markdown-content) {
  color: #111827;
  line-height: 1.6;
  font-size: 0.75rem; /* 12px - optimized for chat panel */
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* --- Headings (scaled for chat panel) --- */
:global(.markdown-content h1) {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  margin-top: 0.75rem;
  color: #111827;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.375rem;
}

:global(.markdown-content h2) {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.375rem;
  margin-top: 0.75rem;
  color: #111827;
}

:global(.markdown-content h3) {
  font-size: 0.8125rem;
  font-weight: 600;
  margin-bottom: 0.375rem;
  margin-top: 0.625rem;
  color: #1f2937;
}

:global(.markdown-content h4) {
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  margin-top: 0.5rem;
  color: #1f2937;
}

:global(.markdown-content h5),
:global(.markdown-content h6) {
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  margin-top: 0.5rem;
  color: #374151;
}

/* --- Paragraphs --- */
:global(.markdown-content p) {
  margin-bottom: 0.5rem;
  line-height: 1.6;
}

:global(.markdown-content strong) {
  font-weight: 600;
  color: #111827;
}

:global(.markdown-content em) {
  font-style: italic;
}

/* --- Lists --- */
:global(.markdown-content ul) {
  list-style-type: disc;
  list-style-position: outside;
  margin-bottom: 0.5rem;
  margin-left: 1.25rem;
  padding-left: 0;
}

:global(.markdown-content ul > li) {
  margin-bottom: 0.25rem;
}

:global(.markdown-content ol) {
  list-style-type: decimal;
  list-style-position: outside;
  margin-bottom: 0.5rem;
  margin-left: 1.25rem;
  padding-left: 0;
}

:global(.markdown-content ol > li) {
  margin-bottom: 0.25rem;
}

:global(.markdown-content li) {
  line-height: 1.6;
}

:global(.markdown-content li > ul),
:global(.markdown-content li > ol) {
  margin-top: 0.25rem;
  margin-bottom: 0;
}

/* --- Code Blocks --- */
:global(.markdown-content pre) {
  background-color: #111827;
  color: #f3f4f6;
  border-radius: 0.375rem;
  padding: 0.75rem;
  margin-bottom: 0.625rem;
  overflow-x: auto;
  max-width: 100%;
  font-family: 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', Consolas, 'Courier New', monospace;
  line-height: 1.4;
}

:global(.markdown-content pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
  border-radius: 0;
  font-size: 0.6875rem;
  white-space: pre-wrap;
  word-break: break-word;
}

/* --- Inline Code --- */
:global(.markdown-content .inline-code) {
  background-color: #f3f4f6;
  color: #1f2937;
  padding: 0.125rem 0.25rem;
  border-radius: 0.1875rem;
  font-size: 0.6875rem;
  font-family: 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', Consolas, 'Courier New', monospace;
  word-break: break-word;
}

/* --- Tables --- */
:global(.markdown-content .table-container) {
  overflow-x: auto;
  margin-bottom: 0.625rem;
  width: 100%;
  -webkit-overflow-scrolling: touch;
}

:global(.markdown-content .markdown-table) {
  min-width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 0.375rem;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

:global(.markdown-content .markdown-table th) {
  background-color: #f9fafb;
  padding: 0.25rem 0.375rem;
  text-align: left;
  font-size: 0.5rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  border-bottom: 1px solid #e5e7eb;
  white-space: nowrap;
}

:global(.markdown-content .markdown-table td) {
  padding: 0.25rem 0.375rem;
  font-size: 0.5rem;
  color: #111827;
  border-bottom: 1px solid #e5e7eb;
  white-space: nowrap;
}

:global(.markdown-content .markdown-table tr:last-child td) {
  border-bottom: 0;
}

/* --- Blockquotes --- */
:global(.markdown-content blockquote) {
  border-left: 3px solid #3b82f6;
  padding-left: 0.75rem;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
  margin-bottom: 0.625rem;
  background-color: #eff6ff;
  font-style: italic;
  color: #374151;
}

/* --- Links --- */
:global(.markdown-content a) {
  color: #2563eb;
  text-decoration: underline;
  transition: color 0.2s ease;
}

:global(.markdown-content a:hover) {
  color: #1e40af;
}

/* --- Horizontal Rules --- */
:global(.markdown-content hr) {
  border: 0;
  border-top: 1px solid #d1d5db;
  margin: 1rem 0;
}

/* --- Images --- */
:global(.markdown-content img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.375rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  margin-bottom: 0.625rem;
}

/* --- Responsive --- */
@media (max-width: 640px) {
  :global(.markdown-content) { font-size: 0.6875rem; }
  :global(.markdown-content h1) { font-size: 0.875rem; }
  :global(.markdown-content h2) { font-size: 0.8125rem; }
  :global(.markdown-content pre) { font-size: 0.625rem; padding: 0.5rem; }
  :global(.markdown-content .markdown-table th),
  :global(.markdown-content .markdown-table td) { padding: 0.375rem 0.5rem; font-size: 0.625rem; }
}
```

### Custom Table Renderer

Tables use a custom `marked` renderer to properly handle inline formatting (bold, italic) within cells. The renderer wraps tables in a scrollable `.table-container` div:

```typescript
renderer.table = function(token) {
  const renderCellContent = (cell) => {
    if (cell.tokens && cell.tokens.length > 0) {
      return marked.parser([{ type: 'paragraph', tokens: cell.tokens, raw: cell.text, text: cell.text }])
        .replace(/<\/?p>/g, '');
    }
    return cell.text;
  };

  // Builds <table class="markdown-table"> with <thead> and <tbody>
  // Respects column alignment from token.align[]
};
```

### Custom Code Renderer

```typescript
renderer.code = function({ text, lang }) {
  if (lang) {
    try {
      const highlighted = hljs.highlight(text, { language: lang }).value;
      return `<pre class="hljs"><code class="language-${lang}">${highlighted}</code></pre>`;
    } catch {
      // Fallback to auto-detection, then plain text
    }
  }
  return `<pre class="hljs"><code>${text}</code></pre>`;
};

renderer.codespan = function({ text }) {
  return `<code class="inline-code">${text}</code>`;
};
```

### Custom Link Renderer

All links open in new tabs with security attributes:
```typescript
renderer.link = function({ href, title, text }) {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
};
```

### Re-highlighting After Content Changes

Syntax highlighting is applied both on mount and reactively when content updates:
```typescript
$effect(() => {
  if (renderedContent && enableSyntaxHighlighting && containerElement) {
    setTimeout(() => {
      const codeBlocks = containerElement.querySelectorAll('pre code:not(.hljs)');
      codeBlocks.forEach((block) => hljs.highlightElement(block));
    }, 0);
  }
});
```

---

## 16. Loading Skeleton (Shimmer)

Global shimmer config in `+layout.svelte`:

```typescript
import { setShimmerConfig } from '@shimmer-from-structure/svelte';

setShimmerConfig({
  shimmerColor: 'rgba(22, 108, 150, 0.15)',    // tommy-accent-blue tint
  backgroundColor: 'rgba(229, 231, 235, 0.8)', // gray-200 at 80%
  duration: 1.8,
  fallbackBorderRadius: 8,
});
```

---

## 17. Svelte 5 Patterns

### Runes Used

| Rune | Usage |
|------|-------|
| `$props()` | All component props (interface-typed) |
| `$state()` | Local mutable state |
| `$derived()` | Computed values from state |
| `$derived.by()` | Computed values with logic |
| `$effect()` | Side effects (lifecycle, subscriptions) |
| `$bindable()` | Two-way bindable props (Carousel) |
| `$props.id()` | Unique IDs for accessible form elements |

### Snippet Pattern

Used in Carousel for render delegation:
```svelte
<!-- Parent -->
<Carousel slides={categorySlides}>
  {#snippet children(slide, index, isActive)}
    <div class="quick-actions-slide">
      <h5>{slide.data.category}</h5>
      <!-- ... -->
    </div>
  {/snippet}
</Carousel>

<!-- Carousel component -->
{@render children(slide, index, index === activeIndex)}
```

### Event Handling

Svelte 5 uses `on:event` shorthand syntax:
```svelte
<button onclick={handleClick}>
<div onmouseenter={handleMouseEnter} onmouseleave={handleMouseLeave}>
<textarea onkeypress={handleKeyPress}>
```

### Reactive MediaQuery

```typescript
import { MediaQuery } from 'svelte/reactivity';
const isNarrowScreen = new MediaQuery('max-width: 1024px', false);
// Use: isNarrowScreen.current (boolean)
```

### Reactive Maps

```typescript
import { SvelteMap } from 'svelte/reactivity';
let toolStartTimes = new SvelteMap<string, number>();
```

### SSR-Safe Pattern

Always gate browser APIs behind `$effect` + `browser` check:
```typescript
import { browser } from '$app/environment';

$effect(() => {
  if (!browser) return;
  // localStorage, WebSocket, DOM APIs, etc.
  return () => { /* cleanup */ };
});
```

### Transitions

```typescript
import { fly, fade } from 'svelte/transition';
import { cubicOut } from 'svelte/easing';

<div in:fly={{ y: 10, duration: 300, easing: cubicOut }}>
<div transition:fly={{ y: -5, duration: 200, easing: cubicOut }}>
```

### Generics in Components

```svelte
<script lang="ts" generics="T">
  interface Props {
    slides: CarouselSlide<T>[];
    children: Snippet<[CarouselSlide<T>, number, boolean]>;
  }
</script>
```

---

## 18. Accessibility

### Skip Link

```svelte
<a href="#main-content"
  class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100]
    focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg
    focus:ring-2 focus:ring-tommy-navy focus:text-tommy-navy focus:font-medium">
  Skip to main content
</a>
```

### Focus Rings

Utility class `.focus-ring` for interactive elements:
```css
.focus-ring:focus-visible {
  outline: 2px solid var(--color-tommy-navy);
  outline-offset: 2px;
}
```

Tailwind classes for inline use:
```
focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
focus-visible:ring-offset-2
```

### ARIA Patterns

- **Dialog**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- **Carousel**: `role="listbox"`, `aria-roledescription="carousel"`, `aria-activedescendant`, slides use `role="option"` + `aria-selected`
- **Carousel dots**: `role="tablist"` with `role="tab"` + `aria-selected` buttons
- **Panel resizer**: `aria-label` describing resize + collapse behavior
- **Tooltips**: `role="tooltip"` on tooltip element, `role="presentation"` on wrapper
- **Collapsible sections**: `aria-expanded` on toggle buttons
- **Form elements**: `<fieldset>` + `<legend>` for grouped controls
- **Unique IDs**: `$props.id()` for label/input association

### Keyboard Support

| Component | Key | Action |
|-----------|-----|--------|
| Panel resizer | Arrow Left/Right | Resize (10px, 50px with Shift) |
| Panel resizer | Enter/Space | Toggle collapse |
| Carousel | Arrow Left/Right | Navigate slides |
| Chat input | Enter | Send message |
| Chat input | Shift+Enter | New line |
| Dialog | Escape | Close |

### Minimum Touch Targets

Interactive elements use `min-w-[44px] min-h-[44px]` for WCAG compliance.

### Reduced Motion

Carousel respects `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .carousel-track { scroll-behavior: auto; }
}
```

---

## 19. TypeScript Interfaces

### Core Message Types

```typescript
type MessageType = 'text' | 'table' | 'chart' | 'code' | 'error' | 'system' | 'suggestion' | 'cost-data' | 'progress' | 'anomalies';
type MessageStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'failed' | 'streaming';

interface Message {
  id: string;
  content: MessageContent;
  type: MessageType;
  isUser: boolean;
  timestamp: Date;
  status: MessageStatus;
  agentType?: 'bedrock' | 'langchain' | 'coordinator' | 'langgraph';
  agentInfo?: { routingDecision?: string; processingTime?: number; confidence?: number };
  metadata?: {
    parentMessageId?: string;
    threadId?: string;
    tokens?: number;
    cost?: number;
    responseTime?: number;
    toolsUsed?: string[];
    reasoningSteps?: string[];
    analysisMetadata?: AnalysisMetadata;
  };
  processingSteps?: {
    completedNodes: string[];
    completedTools: { name: string; duration?: number }[];
  };
  reactions?: { helpful: boolean; unhelpful: boolean };
  followUpSuggestions?: string[];
  runId?: string;
  extractedEntities?: ExtractedEntities;
}
```

### Conversation

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
  summary?: string;
  totalTokens?: number;
  totalCost?: number;
}
```

### Quick Action

```typescript
interface QuickAction {
  id: string;
  label: string;
  description: string;
  query: string;
  category: 'cost' | 'optimization' | 'analysis' | 'settings';
  icon?: string;
}
```

### Carousel Slide (Generic)

```typescript
interface CarouselSlide<T> {
  id: string;
  title?: string;
  data: T;
}
```

---

## 20. ECharts Configuration

### Color Config

```typescript
const option = {
  color: chartSeriesPalette,
  textStyle: { color: chartChrome.text },
  // Axes
  xAxis: {
    axisLine: { lineStyle: { color: chartChrome.axisLine } },
    splitLine: { lineStyle: { color: chartChrome.gridLine } },
  },
  yAxis: {
    axisLine: { lineStyle: { color: chartChrome.axisLine } },
    splitLine: { lineStyle: { color: chartChrome.gridLine } },
  },
  // Tooltip
  tooltip: {
    backgroundColor: chartChrome.tooltipBg,
    textStyle: { color: '#ffffff' },
    borderWidth: 0,
  },
  // DataZoom
  dataZoom: [{
    handleStyle: { color: chartChrome.dataZoomHandle },
    borderColor: chartChrome.dataZoomBorder,
    fillerColor: chartChrome.dataZoomFiller,
  }],
};
```

---

## 21. File Organization

```
src/
  app.css              # Global resets
  tailwind.css         # Theme tokens, keyframes, utility classes
  routes/
    +layout.svelte     # Root layout (imports CSS, wraps in ThreePanelLayout)
    +page.svelte       # Dashboard
  lib/
    components/
      ThreePanelLayout.svelte   # Three-panel shell
      ChatInterface.svelte       # Chat container with messages + input
      MessageRenderer.svelte     # Message type dispatcher + feedback
      MarkdownRenderer.svelte    # Markdown -> HTML with syntax highlighting
      Icon.svelte                # SVG icon system
      Tooltip.svelte             # Hover tooltip with delay
      PanelResizer.svelte        # Drag handle for panel resize
      chat/
        StreamingProgress.svelte  # Active streaming node timeline
        CompletedProgress.svelte  # Collapsible completed steps
        QuerySuggestions.svelte   # Quick action carousel
        ExportDialog.svelte       # Export modal
        AnomalyCard.svelte        # Anomaly detection results card
      ui/
        Carousel.svelte           # Generic snap-scroll carousel
    theme/
      chart-colors.ts            # Chart palette + chrome config
    types/
      chat.ts                    # All TypeScript interfaces
```
