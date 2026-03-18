# Svelte 5 & SvelteKit Frontend Guide

A comprehensive guide to building production Svelte 5 applications with SvelteKit -- runes, component patterns, state management, service architecture, data streaming, and Tailwind CSS integration. Companion to `BUN_RUNTIME_GUIDE.md` (runtime/infrastructure), `UI_UX_STYLE_GUIDE.md` (visual design), and `LANGGRAPH_WORKFLOW_GUIDE.md` (AI backend).

### How to Read This Guide

This guide describes **portable patterns** for building reactive frontends with Svelte 5 and SvelteKit. The patterns -- runes-based reactivity, singleton service layers, streaming data consumption, store-driven state management -- apply to any Svelte 5 project.

Code snippets throughout are **reference implementations** from the AWS Cost Analyzer frontend. When adapting to a different domain:

- **Keep the architecture**: three-panel layout, service singletons, store patterns, streaming infrastructure, chart wrappers, error boundaries
- **Replace the domain layer**: swap cost-analysis routes for your domain's pages, replace organizational services with your data services
- **Scale as needed**: the patterns work for small single-page apps too -- just drop the multi-route layout

Each section opens with the **pattern** (what and why), then shows the **implementation** (how, with source references). The patterns are the point; the code is the proof.

---

## Table of Contents

1. [Why Svelte 5 + SvelteKit](#1-why-svelte-5--sveltekit)
2. [Project Architecture](#2-project-architecture)
3. [Runes System](#3-runes-system)
4. [Component Patterns](#4-component-patterns)
5. [State Management](#5-state-management)
6. [Service Layer](#6-service-layer)
7. [Data Streaming](#7-data-streaming)
8. [SvelteKit Routing & Layouts](#8-sveltekit-routing--layouts)
9. [Tailwind CSS Integration](#9-tailwind-css-integration)
10. [TypeScript Integration](#10-typescript-integration)
11. [UI Component Library](#11-ui-component-library)
12. [Chart & Visualization](#12-chart--visualization)
13. [Svelte MCP Workflow](#13-svelte-mcp-workflow)
14. [Testing & Quality](#14-testing--quality)

---

## 1. Why Svelte 5 + SvelteKit

### Pattern

Svelte 5 is chosen for data-heavy internal tooling because it compiles reactivity into vanilla JavaScript at build time. There is no virtual DOM diffing at runtime, no framework overhead during renders, and no reconciliation step. For dashboards that re-render frequently as cost data streams in, this means fewer dropped frames and lower memory pressure. The runes system (`$state`, `$derived`, `$effect`) replaces Svelte 4's implicit reactivity with explicit, fine-grained signals that are easier to reason about in complex component trees.

### Reference Implementation

**Framework comparison:**

| Dimension | Svelte 5 | React 19 | Vue 3 |
|-----------|----------|----------|-------|
| Reactivity model | Compile-time signals (runes) | Runtime hooks + fiber | Runtime proxies (ref/reactive) |
| Bundle size (baseline) | ~2 KB | ~40 KB | ~33 KB |
| Runtime overhead | Near-zero (compiled) | VDOM diffing | Proxy tracking |
| SSR support | SvelteKit (built-in) | Next.js / Remix (separate) | Nuxt (separate) |
| Learning curve | Low (HTML-first) | Medium (JSX, hooks rules) | Medium (Options + Composition) |
| TypeScript support | First-class (runes are typed) | First-class | First-class |

### When to Choose Svelte 5

**Good fit:**

- Data dashboards with frequent reactive updates
- Internal tools where bundle size matters less than developer velocity
- Real-time UIs consuming streaming data (SSE, WebSocket)
- Streaming chat interfaces with progressive rendering
- Rapid prototyping where compile-time checks catch errors early

**Proceed with caution:**

- Large teams with deep React expertise and existing component libraries
- Projects requiring a massive third-party ecosystem (React has more packages)
- Existing React or Vue codebase where migration cost outweighs benefits

### SvelteKit

SvelteKit is the official application framework for Svelte. It provides file-based routing (directory structure maps to URL paths), server-side rendering and static site generation, platform adapters (Vercel, Netlify, Node, auto-detect), load functions for data fetching at the route level, and structured error handling with `+error.svelte` boundaries. In this project, SvelteKit handles the routing and layout layer while Svelte 5 runes handle component-level reactivity.

---

## 2. Project Architecture

### Pattern

In a Bun monorepo, the SvelteKit frontend lives as its own workspace package that communicates with the backend exclusively through HTTP APIs and streaming connections. The frontend never imports backend code directly. State flows one direction: routes consume services, services talk to the backend API, stores provide reactive state to components, and TypeScript types flow through all layers.

### Reference Implementation

**Directory structure:**

```
packages/frontend/
  src/
    routes/                    -- SvelteKit pages and layouts
      +layout.svelte           -- Root layout (ErrorBoundary, ThreePanelLayout)
      +page.svelte             -- Dashboard
      cost-analysis/           -- Historical trends
      category-analysis/       -- Service breakdown
      anomalies/               -- Anomaly detection
      recommendations/         -- Optimization recommendations
      settings/                -- Application settings
    lib/
      components/              -- Reusable UI components
        charts/                -- ECharts wrappers
        chat/                  -- Chat/AI interface components
        cost/                  -- Cost display components
        recommendations/       -- Recommendation display components
        ui/                    -- Generic UI primitives
      services/                -- API communication layer
      stores/                  -- Reactive state management
      types/                   -- TypeScript type definitions
      utils/                   -- Utility functions
      theme/                   -- Chart color palettes
      mocks/                   -- Development mock data
    app.css                    -- Global styles
    tailwind.css               -- Tailwind theme configuration
    app.d.ts                   -- SvelteKit type declarations
```

**Architecture flow:** Routes consume Services, Services talk to the Backend API, Stores provide reactive state to Components, Types flow through all layers.

**SvelteKit configuration** (`svelte.config.js`):

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),

	compilerOptions: {
		runes: true
	},

	kit: {
		adapter: adapter()
	}
};

export default config;
```

**Vite configuration** (`vite.config.ts`):

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit()
	],
	server: {
		host: true
	},
	preview: {
		host: true
	}
});
```

**Frontend package scripts and dependencies** (`package.json`):

```json
{
  "name": "@aws-cost-analyzer/frontend",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "typecheck": "bun run check"
  },
  "dependencies": {
    "@shimmer-from-structure/svelte": "^2.3.4",
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

**API URL discovery** -- every service resolves the backend URL the same way:

```ts
const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

**Key decisions:**

| Decision | Choice | Why |
|----------|--------|-----|
| Adapter | `adapter-auto` | Flexible deployment, auto-detects platform |
| Tailwind plugin | `@tailwindcss/vite` | Faster than PostCSS, simpler config |
| Runes mode | `runes: true` | Opt-in to Svelte 5 reactivity globally |
| Styling | Tailwind-only | No `<style>` blocks, consistency, no specificity wars |
| State | Stores + runes | Stores for cross-component, runes for local |
| API layer | Service classes | Singleton services, never `fetch()` in components |

---

## 3. Runes System

### Pattern

Svelte 5 replaces Svelte 4's implicit `$:` reactive declarations with explicit runes. Each rune has a clear purpose: `$state` for reactive values, `$derived` for computed values, `$effect` for side effects, `$props` for component inputs, and `$bindable` for two-way binding. This explicitness eliminates the "magic" of Svelte 4 where reactivity was inferred from syntax, making dependency tracking predictable and debuggable. The compiler uses runes to generate fine-grained subscriptions -- only the exact DOM nodes that depend on a reactive value update when it changes.

### Reference Implementation

#### `$state`

`$state` declares a reactive variable. Assigning to a `$state` variable triggers reactivity -- any `$derived` values, `$effect` blocks, or template expressions that read the variable will update automatically. Use it for any value that changes over time and should cause the UI to react.

Panel dimensions and collapse state in the three-panel layout:

```ts
let leftWidth = $state(384);
let rightWidth = $state(384);
let rightCollapsed = $state(false);
```

Source: `packages/frontend/src/lib/components/ThreePanelLayout.svelte`

Tooltip visibility toggle:

```ts
let showTooltip = $state(false);
```

Source: `packages/frontend/src/lib/components/Tooltip.svelte`

#### `$derived`

`$derived` creates a computed value that automatically recalculates when any reactive dependency it reads changes. It takes a single expression (no function body). The Svelte compiler tracks which `$state` or other `$derived` values are read inside the expression and rebuilds the derived value only when those specific dependencies change.

Effective right panel width that accounts for collapse state and screen size:

```ts
let effectiveRightWidth = $derived(rightCollapsed || isNarrowScreen.current ? 0 : rightWidth);
```

Source: `packages/frontend/src/lib/components/ThreePanelLayout.svelte`

Services sorted by previous month cost for display:

```ts
let sortedServices = $derived(
    category.services
        ? [...category.services].sort((a, b) => b.previousMonthCost - a.previousMonthCost)
        : []
);
```

Source: `packages/frontend/src/lib/components/cost/CategoryCard.svelte`

#### `$derived.by`

`$derived.by` is the block form of `$derived` for computations that need multiple statements, conditionals, or branching logic. It takes a function that returns the derived value. Use `$derived.by` when the computation cannot be expressed as a single inline expression -- for example, when you need early returns, intermediate variables, or array lookups.

Active node label lookup with null handling:

```ts
const activeNodeLabel = $derived.by(() => {
    if (!currentNode) return null;
    const node = nodes.find((n) => n.id === currentNode);
    return node?.description || currentNode;
});
```

Source: `packages/frontend/src/lib/components/chat/StreamingProgress.svelte`

**When to use `$derived` vs `$derived.by`**: If the computation fits in a single expression (a ternary, a method chain, a property access), use `$derived`. If it needs `if` statements, `for` loops, intermediate `const` declarations, or early returns, use `$derived.by`.

#### `$effect`

`$effect` runs side effects when reactive dependencies change. The Svelte compiler automatically tracks which reactive values are read inside the effect body and re-runs the effect when any of them change. Effects can return a cleanup function that runs before the next execution and when the component is destroyed. This replaces Svelte 4's `onMount`, `onDestroy`, and reactive statement patterns.

**Basic pattern with cleanup** -- timer cleanup on component unmount:

```ts
$effect(() => {
    return () => {
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
    };
});
```

Source: `packages/frontend/src/lib/components/Tooltip.svelte`

**SSR guard** -- effects that access browser APIs must guard against server-side execution. SvelteKit renders components on the server where `localStorage`, `window`, and `document` do not exist. The `browser` constant from `$app/environment` is `false` during SSR and `true` in the browser:

```ts
$effect(() => {
    if (!browser) return;
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const p = JSON.parse(saved);
            leftWidth = p.leftWidth ?? 384;
            rightWidth = p.rightWidth ?? 384;
            rightCollapsed = p.rightCollapsed ?? false;
            rightWidthBeforeCollapse = p.rightWidthBeforeCollapse ?? 384;
        }
    } catch {
        /* ignore */
    }
    initialized = true;
});
```

Source: `packages/frontend/src/lib/components/ThreePanelLayout.svelte`

**Store subscriptions with cleanup** -- subscribing to Svelte stores inside an effect, with all unsubscribe functions called in the cleanup return. This pattern bridges Svelte 4 stores with Svelte 5 runes:

```ts
$effect(() => {
    if (!browser) return;

    // Subscribe to stores only in browser context
    const unsubRealTime = orgService.realTimeEnabled?.subscribe(value => {
        realTimeEnabled = value;
    });

    const unsubConnection = wsService?.connectionStatus?.subscribe(value => {
        connectionStatus = { connected: value.connected, reconnectAttempts: value.reconnectAttempts };
    });

    // Subscribe to selectedNode store to sync with external changes (Dashboard clicks)
    const unsubSelectedNode = orgService.selectedNode?.subscribe(value => {
        if (value && value.id !== selectedNode?.id) {
            selectedNode = value;
        }
    });

    // Enable real-time by default
    orgService.enableRealTime();

    return () => {
        unsubRealTime?.();
        unsubConnection?.();
        unsubSelectedNode?.();
    };
});
```

Source: `packages/frontend/src/routes/+layout.svelte`

**Debounced localStorage persistence** -- an effect that debounces writes to localStorage. The `initialized` guard prevents saving default values before the stored preferences have been loaded. The destructured read of `leftWidth`, `rightWidth`, and `rightCollapsed` ensures the effect re-runs when any panel dimension changes:

```ts
let saveTimeout: ReturnType<typeof setTimeout>;
$effect(() => {
    if (!initialized) return;
    // Track all values to trigger on changes
    const _ = { leftWidth, rightWidth, rightCollapsed };
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    leftWidth,
                    rightWidth,
                    rightCollapsed,
                    rightWidthBeforeCollapse
                })
            );
        } catch {
            /* ignore */
        }
    }, 100);
});
```

Source: `packages/frontend/src/lib/components/ThreePanelLayout.svelte`

#### `$props`

`$props` declares the inputs a component accepts from its parent. Props are defined by writing a TypeScript `interface Props` and destructuring the result of `$props()`. Default values are assigned in the destructuring pattern. This replaces Svelte 4's `export let` declarations with a single, typed entry point for all component inputs.

Simple props with an interface and defaults:

```ts
interface Props {
    position: 'left' | 'right';
    onResize: (delta: number) => void;
    onDoubleClick?: () => void;
    isCollapsed?: boolean;
}

let { position, onResize, onDoubleClick, isCollapsed = false }: Props = $props();
```

Source: `packages/frontend/src/lib/components/PanelResizer.svelte`

Complex generic props with defaults, snippets, callbacks, and `$bindable`:

```ts
interface Props {
    slides: CarouselSlide<T>[];
    activeIndex?: number;
    showDots?: boolean;
    showCounter?: boolean;
    gap?: string;
    peekAmount?: string;
    class?: string;
    /** Enable auto-play rotation */
    autoPlay?: boolean;
    /** Auto-play interval in milliseconds (default: 5000) */
    autoPlayInterval?: number;
    /** Pause auto-play on hover */
    pauseOnHover?: boolean;
    children: Snippet<[CarouselSlide<T>, number, boolean]>;
    onchange?: (event: { index: number; slide: CarouselSlide<T> }) => void;
}

let {
    slides,
    activeIndex = $bindable(0),
    showDots = true,
    showCounter = true,
    gap = '1rem',
    peekAmount = '15%',
    class: className = '',
    autoPlay = false,
    autoPlayInterval = 5000,
    pauseOnHover = true,
    children,
    onchange
}: Props = $props();
```

Source: `packages/frontend/src/lib/components/ui/Carousel.svelte`

#### `$bindable`

`$bindable` marks a prop as two-way bindable. When a parent uses `bind:propName`, changes from either the parent or the child propagate in both directions. The value passed to `$bindable()` is the default when the parent does not bind. Without `$bindable`, props flow one direction (parent to child); with it, the child can update the parent's state directly.

Carousel active index that the parent can bind to and the child updates via intersection observer:

```ts
activeIndex = $bindable(0),
```

The parent binds with `<Carousel bind:activeIndex>`, and when the carousel's `IntersectionObserver` detects a new slide is visible, it assigns `activeIndex = index`, which propagates back to the parent.

Source: `packages/frontend/src/lib/components/ui/Carousel.svelte`

### When to Use Which Rune

| Rune | Use When | Example |
|------|----------|---------|
| `$state` | You need a reactive value that changes over time | Panel width, loading flag, form input |
| `$derived` | Value is computed from other reactive values (simple expression) | Effective width, sorted list |
| `$derived.by` | Computed value needs logic, conditionals, or multiple statements | Complex label derivation, filtered lists |
| `$effect` | Need to run side effects when dependencies change | API calls, DOM manipulation, subscriptions |
| `$props` | Declaring component inputs from parent | All component props |
| `$bindable` | Parent and child need to update the same value | Carousel index, form fields |

### Common Pitfalls

1. **Effect dependency tracking** -- effects auto-track reactive reads inside them. If you read a `$state` value conditionally (inside an `if` block), the effect only tracks it when that branch executes. Move reads before conditionals if the effect must always react to them, or explicitly reference values before the conditional (as in the debounced save example where `const _ = { leftWidth, rightWidth, rightCollapsed }` ensures tracking).

2. **Infinite loops** -- an effect that writes to a `$state` value it also reads creates an infinite loop. The effect triggers itself endlessly. To break the cycle, use a guard condition (like `if (!initialized) return`), move the write into a `setTimeout`, or restructure so the read and write target different reactive variables.

3. **SSR safety** -- always guard browser-only code with `if (!browser) return` in effects. `localStorage`, `document`, `window`, `IntersectionObserver`, and other Web APIs do not exist during server-side rendering. Import `browser` from `$app/environment`.

4. **Cleanup** -- always return a cleanup function from effects that set up subscriptions, timers, or event listeners. Without cleanup, subscriptions accumulate on re-runs and listeners leak on component destruction. The cleanup function runs before the next effect execution and when the component unmounts.

---

## 4. Component Patterns

### Pattern

Svelte 5 components use TypeScript interfaces for props, snippets for composition (replacing Svelte 4 slots), and callback props for events (replacing `createEventDispatcher`). These three mechanisms cover the full range of component communication: data in (props), content projection (snippets), and notifications out (callback props). Together they produce components that are fully typed, composable, and explicit about their contracts.

### Props with TypeScript Interfaces

Define an `interface Props` inside the component's `<script>` block and destructure the result of `$props()`. Default values go in the destructuring pattern. This replaces Svelte 4's `export let` declarations with a single, typed entry point.

```svelte
<script lang="ts">
	interface Props {
		position: 'left' | 'right';
		onResize: (delta: number) => void;
		onDoubleClick?: () => void;
		isCollapsed?: boolean;
	}

	let { position, onResize, onDoubleClick, isCollapsed = false }: Props = $props();
</script>
```

Source: `packages/frontend/src/lib/components/PanelResizer.svelte`

The interface declares the component's public API: required props have no `?`, optional props do, and callback props use function types. The destructuring default (`isCollapsed = false`) provides fallback values when the parent omits the prop.

### Snippet-Based Composition

Svelte 5 replaces `<slot>` with snippets. Snippets are typed, can receive parameters, and render with `{@render}`. There are three levels of complexity.

#### Basic children snippet

The simplest composition pattern: accept a `children: Snippet` prop and render it with `{@render children()}`. This is equivalent to Svelte 4's default `<slot />`.

```svelte
<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        text: string;
        children: Snippet;
    }

    let { text, children }: Props = $props();
</script>

<div
    role="presentation"
    class="relative inline-block"
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
>
    {@render children()}
    {#if showTooltip}
        <div role="tooltip" class="...">
            {text}
        </div>
    {/if}
</div>
```

Source: `packages/frontend/src/lib/components/Tooltip.svelte`

The parent uses it naturally: `<Tooltip text="Delete item"><button>X</button></Tooltip>`. The content between the tags becomes the `children` snippet.

#### Named snippets with parameters

Named snippets replace Svelte 4's named slots and can receive parameters from the component. The `{#snippet name(params)}` syntax defines the snippet at the call site, and the component renders it with `{@render}`.

```svelte
<svelte:boundary {onerror}>
	{@render children()}

	{#snippet failed(error, reset)}
		<div class="flex items-center justify-center min-h-screen p-8 bg-gradient-to-br from-red-50 to-red-100">
			<div class="max-w-[600px] w-full bg-white rounded-xl shadow-2xl overflow-hidden">
				<div class="flex flex-col items-center gap-4 p-8 pb-6 bg-gradient-to-br from-red-100 to-red-200 border-b-2 border-red-300">
					<Icon name="alert-triangle" class="w-8 h-8 text-red-500" />
					<h2 class="text-2xl font-bold text-red-800 m-0">Something went wrong</h2>
				</div>

				<div class="p-8">
					<p class="text-base text-gray-700 leading-relaxed mb-6">{getErrorMessage(error)}</p>
				</div>

				<div class="flex gap-4 px-8 pb-8">
					<button onclick={reset} class="...">
						<Icon name="refresh-cw" class="w-4 h-4" />
						Try again
					</button>
					<button onclick={() => window.location.reload()} class="...">
						<Icon name="rotate-ccw" class="w-4 h-4" />
						Reload page
					</button>
				</div>
			</div>
		</div>
	{/snippet}
</svelte:boundary>
```

Source: `packages/frontend/src/lib/components/ErrorBoundary.svelte`

Here `<svelte:boundary>` provides the `failed` snippet with two parameters: the caught `error` and a `reset` callback. The snippet uses both to display the error and offer a retry button.

#### Parameterized snippets with generics

For reusable components that render caller-provided content for each item, snippets accept typed parameter tuples. Combined with generic components, this provides full type safety.

```ts
children: Snippet<[CarouselSlide<T>, number, boolean]>;
```

Source: `packages/frontend/src/lib/components/ui/Carousel.svelte`

The parent provides the rendering logic:

```svelte
<Carousel slides={mySlides} bind:activeIndex>
	{#snippet children(slide, index, isActive)}
		<div class:opacity-50={!isActive}>
			<h3>{slide.title}</h3>
			<p>{slide.description}</p>
		</div>
	{/snippet}
</Carousel>
```

The component renders each slide by calling `{@render children(slide, index, index === activeIndex)}`, passing the current slide data, its index, and whether it is active.

### Generic Components

Svelte 5 supports generic components with `<script lang="ts" generics="T">`. The generic parameter flows through props, snippets, and callbacks, ensuring type safety without the caller needing explicit type annotations.

```svelte
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { CarouselSlide } from '$lib/types/ui.js';

	interface Props {
		slides: CarouselSlide<T>[];
		activeIndex?: number;
		children: Snippet<[CarouselSlide<T>, number, boolean]>;
		onchange?: (event: { index: number; slide: CarouselSlide<T> }) => void;
	}

	let {
		slides,
		activeIndex = $bindable(0),
		children,
		onchange
	}: Props = $props();
</script>
```

Source: `packages/frontend/src/lib/components/ui/Carousel.svelte`

When the parent passes `slides={accountSlides}` where `accountSlides` is `CarouselSlide<AccountInfo>[]`, TypeScript infers `T = AccountInfo` and the `children` snippet parameters, `onchange` callback, and all internal logic are typed accordingly.

### Event Handling

Svelte 5 replaces `createEventDispatcher` with callback props. Events are plain functions passed as props, making them fully typed and explicit.

**Callback props in the interface:**

```ts
interface Props {
	position: 'left' | 'right';
	onResize: (delta: number) => void;
	onDoubleClick?: () => void;
	isCollapsed?: boolean;
}
```

Source: `packages/frontend/src/lib/components/PanelResizer.svelte`

The parent passes handlers directly: `<PanelResizer position="left" onResize={handleResize} onDoubleClick={toggleCollapse} />`. Required callbacks (`onResize`) must be provided; optional ones (`onDoubleClick?`) are guarded before calling.

**DOM event handlers in templates** use the `on` prefix directly on elements:

```svelte
<button
	onmousedown={handleMouseDown}
	ondblclick={handleDoubleClick}
	onkeydown={handleKeyDown}
	aria-label="{position} panel resizer"
>
```

Source: `packages/frontend/src/lib/components/PanelResizer.svelte`

This replaces Svelte 4's `on:mousedown`, `on:dblclick`, `on:keydown` directive syntax.

### Conditional Class Binding

Svelte provides two approaches for conditional classes.

**Ternary in class attribute** -- inline conditional within a template expression:

```svelte
<div class="w-1 h-10 {isDragging ? 'opacity-100 !bg-blue-500' : ''}"></div>
```

**`class:name` directive** -- toggles a single class based on a boolean:

```svelte
<div class:opacity-50={!isActive}>
	<!-- content -->
</div>
```

Both patterns work with Tailwind utility classes. Use ternaries when swapping between two class sets; use `class:name` when toggling a single class on or off.

### Svelte Transitions

Svelte provides built-in transition directives for enter/exit animations:

```svelte
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
</script>

{#if visible}
	<div transition:fade={{ duration: 200 }}>
		Fades in and out
	</div>
{/if}

{#if showPanel}
	<div in:fly={{ y: 20, duration: 300 }} out:fade={{ duration: 150 }}>
		Flies in from below, fades out
	</div>
{/if}
```

Use `transition:` for symmetric enter/exit animations, or separate `in:` and `out:` directives for asymmetric transitions. Common transitions: `fade`, `fly`, `slide`, `scale`, `blur`, `draw`.

### Controlled vs Uncontrolled

Components that toggle state (expand/collapse, open/close) should support both controlled mode (parent owns the state) and uncontrolled mode (component manages its own state). A `$derived` value selects between them.

```ts
interface Props {
    category: CategoryData;
    initialExpanded?: boolean;
    isExpanded?: boolean;
    onToggle?: (categoryName: string) => void;
    monthMetadata?: any;
}

let { category, initialExpanded = false, isExpanded: controlledExpanded, onToggle, monthMetadata }: Props = $props();

let internalExpanded = $state(false);

// Use controlled state if provided, otherwise use internal state
let expanded = $derived(controlledExpanded !== undefined ? controlledExpanded : internalExpanded);

// Sync initialExpanded prop to internal state when it changes (only for uncontrolled mode)
$effect(() => {
    if (controlledExpanded === undefined) {
        internalExpanded = initialExpanded;
    }
});

function toggleExpanded() {
    if (onToggle) {
        onToggle(category.categoryName);
    } else {
        internalExpanded = !internalExpanded;
    }
}
```

Source: `packages/frontend/src/lib/components/cost/CategoryCard.svelte`

**How it works:**

- **Uncontrolled mode**: parent omits `isExpanded`. The component uses `internalExpanded` and toggles it directly. `initialExpanded` sets the starting value.
- **Controlled mode**: parent passes `isExpanded={someState}` and an `onToggle` callback. The component delegates toggle to the parent via `onToggle` and reads `controlledExpanded` through `$derived`.
- **Selection logic**: `$derived(controlledExpanded !== undefined ? controlledExpanded : internalExpanded)` picks the active source based on whether the parent provided a value.

### Key Principles

1. Props interfaces live in the component file, not a shared types file -- each component owns its contract
2. Use snippets instead of slots for composition -- they are typed and can receive parameters
3. Use callback props instead of event dispatching -- fully typed, no string-based event names
4. Support both controlled and uncontrolled modes when components have toggle state
5. Always include ARIA attributes for interactive elements (`aria-label`, `aria-expanded`, `role`)

---

## 5. State Management

### Pattern

Three approaches to state management, chosen by scope and sharing needs. Rune-based stores (`.svelte.ts` modules) for complex state with methods, traditional Svelte stores (`writable`/`derived`) for cross-component state machines, and component-local `$state` for simple local state.

Rune-based stores are the Svelte 5-native approach and should be the default for new code. Traditional stores are still useful when you need a state machine with many derived views or need to interoperate with Svelte 4 patterns. Component-local `$state` is the simplest option and needs no abstraction.

### Rune-Based Stores (.svelte.ts)

A `.svelte.ts` module exports a class whose properties are declared with `$state`. Because `$state` works at the module level in `.svelte.ts` files, instances of the class are reactive outside components -- any component that reads a `$state` property will re-render when it changes.

From the conversation context store:

```ts
// lib/stores/conversation-context.svelte.ts
import type { Message } from "../types/chat.js";

interface AnalysisResult {
	agentType?: string;
	timestamp: Date;
	metadata: any;
	contentType: string;
}

export class ConversationContext {
	totalMessages = $state(0);
	topicHistory = $state<string[]>([]);
	lastActivity = $state<Date | null>(null);
	analysisMemory = $state<Record<string, AnalysisResult>>({});
	userPreferences = $state({
		preferredChartTypes: ["line", "bar"],
		frequentTimeframes: ["last 30 days", "this month"],
		favoriteServices: [] as string[],
	});

	private readonly MAX_TOPICS = 10;
	private readonly MAX_ANALYSIS_MEMORY = 20;
	private readonly MAX_PREFERENCES = 5;

	updateFromMessage(message: Message): void {
		this.totalMessages++;
		this.lastActivity = new Date();

		if (message.isUser && typeof message.content === "string") {
			const topics = this.extractTopics(message.content);
			this.topicHistory = [...this.topicHistory, ...topics].slice(
				-this.MAX_TOPICS,
			);

			this.updateUserPreferences(message.content);
		}

		if (!message.isUser && message.metadata) {
			const key = `msg_${Date.now()}`;
			this.analysisMemory[key] = {
				agentType: message.agentType,
				timestamp: message.timestamp,
				metadata: message.metadata,
				contentType: message.type,
			};

			const memoryKeys = Object.keys(this.analysisMemory);
			if (memoryKeys.length > this.MAX_ANALYSIS_MEMORY) {
				const keysToRemove = memoryKeys.slice(
					0,
					memoryKeys.length - this.MAX_ANALYSIS_MEMORY,
				);
				for (const key of keysToRemove) {
					delete this.analysisMemory[key];
				}
			}
		}
	}

	reset(): void {
		this.totalMessages = 0;
		this.topicHistory = [];
		this.lastActivity = null;
		this.analysisMemory = {};
		this.userPreferences = {
			preferredChartTypes: ["line", "bar"],
			frequentTimeframes: ["last 30 days", "this month"],
			favoriteServices: [],
		};
	}
}
```

Source: `packages/frontend/src/lib/stores/conversation-context.svelte.ts`

**Key details:**

- Every property that should trigger reactivity is declared with `$state`. Primitive values (`totalMessages`), arrays (`topicHistory`), and objects (`analysisMemory`, `userPreferences`) all work.
- **Immutable array pattern**: `this.topicHistory = [...this.topicHistory, ...topics].slice(-this.MAX_TOPICS)` creates a new array reference on every mutation. This is required because `$state` tracks reference identity for arrays -- mutating in place (e.g., `push()`) would not trigger reactive updates.
- Methods like `updateFromMessage()` and `reset()` mutate `$state` properties directly. Any component reading those properties re-renders automatically.
- Instantiate once at the module level (`export const context = new ConversationContext()`) and import the singleton wherever needed. No providers, no context API.

### Traditional Svelte Stores

`writable`/`derived` stores are the Svelte 4 pattern and remain useful for state machines with many derived views. The store factory pattern encapsulates transition methods, and `derived` stores project specific slices for component consumption.

From the loading state store:

```ts
// lib/stores/loading-state.ts
import { writable, derived, type Readable } from 'svelte/store';
import type { OrganizationNode } from '../types/organizational.js';

export type LoadingState =
  | { status: 'idle' }
  | { status: 'loading-tree' }
  | { status: 'loading-node'; nodeId: string }
  | { status: 'loading-services'; accountId: string }
  | { status: 'ready'; node: OrganizationNode; children: OrganizationNode[] }
  | { status: 'error'; error: string; retryAction?: () => void };
```

The discriminated union type ensures each state carries exactly the data it needs -- `loading-node` has a `nodeId`, `ready` has the full `node` and `children`, `error` has the error message and optional retry function. TypeScript narrows the type when you check `status`.

The factory function creates a `writable` and returns named transition methods:

```ts
function createLoadingStore() {
  const initialState: LoadingState = { status: 'idle' };
  const state = writable<LoadingState>(initialState);

  let lastValidState: LoadingState & { status: 'ready' } | null = null;

  return {
    subscribe: state.subscribe,

    startLoadingTree: () => {
      state.set({ status: 'loading-tree' });
    },

    startLoadingNode: (nodeId: string) => {
      state.set({ status: 'loading-node', nodeId });
    },

    startLoadingServices: (accountId: string) => {
      state.set({ status: 'loading-services', accountId });
    },

    setReady: (node: OrganizationNode, children: OrganizationNode[]) => {
      const readyState: LoadingState = { status: 'ready', node, children };
      lastValidState = readyState as LoadingState & { status: 'ready' };
      state.set(readyState);
    },

    setError: (error: string, retryAction?: () => void) => {
      state.set({ status: 'error', error, retryAction });
    },

    reset: () => {
      state.set({ status: 'idle' });
    },

    getLastValidState: (): (LoadingState & { status: 'ready' }) | null => {
      return lastValidState;
    },

    updateChildren: (children: OrganizationNode[]) => {
      state.update(current => {
        if (current.status === 'ready') {
          return { ...current, children };
        }
        return current;
      });
    }
  };
}

export const loadingState = createLoadingStore();
```

Derived stores project boolean flags and typed slices from the state machine for direct use in templates:

```ts
export const isLoading: Readable<boolean> = derived(
  loadingState,
  $state => $state.status === 'loading-tree' ||
            $state.status === 'loading-node' ||
            $state.status === 'loading-services'
);

export const hasError: Readable<boolean> = derived(
  loadingState,
  $state => $state.status === 'error'
);

export const currentNode: Readable<OrganizationNode | null> = derived(
  loadingState,
  $state => $state.status === 'ready' ? $state.node : null
);

export const loadingMessage: Readable<string> = derived(
  loadingState,
  $state => {
    switch ($state.status) {
      case 'loading-tree':
        return 'Loading organization tree...';
      case 'loading-node':
        return 'Loading node details...';
      case 'loading-services':
        return 'Loading services...';
      default:
        return '';
    }
  }
);
```

Source: `packages/frontend/src/lib/stores/loading-state.ts`

**Why this pattern works for state machines**: The factory encapsulates all legal transitions -- callers cannot set arbitrary states, only call named methods like `startLoadingNode()` or `setReady()`. The derived stores mean components subscribe to exactly the slice they need (`isLoading`, `currentNode`, `loadingMessage`) rather than switching on the full discriminated union in every template.

### Component-Local State

When state does not need to be shared across components, use `$state` directly inside the component's `<script>` block. No store abstraction is needed. This is the simplest and most common pattern -- panel collapsed flags, form inputs, tooltip visibility, hover states.

```ts
let leftWidth = $state(384);
let rightCollapsed = $state(false);
let showTooltip = $state(false);
```

If a value is derived from local state, use `$derived`:

```ts
let effectiveRightWidth = $derived(rightCollapsed ? 0 : rightWidth);
```

No code beyond this is needed. The Svelte compiler handles subscriptions and teardown.

### SSR-Safe Store Utilities

SvelteKit runs components on the server where browser APIs (`localStorage`, `window`, `WebSocket`) are unavailable. Stores that depend on browser APIs will throw during SSR. The SSR-safe utilities provide safe defaults during server-side rendering and normal reactivity in the browser.

```ts
// lib/utils/ssr-safe-stores.ts
import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export function createSSRSafeStore<T>(
  defaultValue: T,
  browserInitializer?: () => T
): Writable<T> {
  const initialValue = browser && browserInitializer ? browserInitializer() : defaultValue;
  return writable<T>(initialValue);
}

export function createSSRSafeDerived<T, U>(
  store: Writable<T> | null,
  deriver: (value: T) => U,
  defaultValue: U
): Writable<U> {
  if (!store || !browser) {
    return writable<U>(defaultValue);
  }

  const derived = writable<U>(defaultValue);

  store.subscribe((value) => {
    try {
      const derivedValue = deriver(value);
      derived.set(derivedValue);
    } catch (error) {
      console.warn('SSR-safe derived store error:', error);
      derived.set(defaultValue);
    }
  });

  return derived;
}

export function safeSubscribe<T>(
  store: Writable<T> | null,
  callback: (value: T) => void,
  defaultValue?: T
): (() => void) | null {
  if (!store || !browser) {
    if (defaultValue !== undefined) {
      callback(defaultValue);
    }
    return null;
  }

  return store.subscribe(callback);
}
```

Source: `packages/frontend/src/lib/utils/ssr-safe-stores.ts`

**How each utility works:**

- `createSSRSafeStore()` -- returns a `writable` with a safe default during SSR. The optional `browserInitializer` callback runs only in the browser, so it can safely access `localStorage` or other browser APIs.
- `createSSRSafeDerived()` -- creates a derived-like store that handles `null` source stores (which happen when a service has not been initialized during SSR). Falls back to `defaultValue` on error.
- `safeSubscribe()` -- wraps `store.subscribe()` with null and SSR guards. Returns the unsubscribe function in the browser, `null` during SSR. Optionally fires the callback with a default value during SSR so components have initial data.

Usage example from the WebSocket connection status:

```ts
export function createConnectionStatusStore() {
  return createSSRSafeStore({
    connected: false,
    lastHeartbeat: 0,
    reconnectAttempts: 0,
    error: undefined as string | undefined
  });
}
```

Source: `packages/frontend/src/lib/utils/ssr-safe-stores.ts`

### Fallback State Pattern

When navigating between nodes, there is a brief period where the new node's data has not loaded yet. Without a fallback, the UI flashes to empty. The fallback state pattern preserves the last valid data during transitions:

```ts
let lastValidNode = $state<OrganizationNode | null>(null);

const displayNode = $derived($selectedNode?.costData ? $selectedNode : lastValidNode);
```

Source: `packages/frontend/src/routes/+page.svelte`

The `displayNode` derived value checks whether the currently selected node has cost data loaded. If it does, use it. If not (mid-transition), fall back to the last node that had valid data. The `lastValidNode` is updated whenever a node with cost data arrives, so the fallback always reflects the most recent complete state. This prevents the UI from showing empty cards or zero values during navigation.

### localStorage Persistence with Debounce

State that should survive page reloads (panel dimensions, user preferences) is persisted to `localStorage` via a debounced `$effect`. The debounce prevents excessive writes during rapid changes like panel resizing.

```ts
let saveTimeout: ReturnType<typeof setTimeout>;
$effect(() => {
    if (!initialized) return;
    // Track all values to trigger on changes
    const _ = { leftWidth, rightWidth, rightCollapsed };
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    leftWidth,
                    rightWidth,
                    rightCollapsed,
                    rightWidthBeforeCollapse
                })
            );
        } catch {
            /* ignore */
        }
    }, 100);
});
```

Source: `packages/frontend/src/lib/components/ThreePanelLayout.svelte`

**How it works:**

1. The `initialized` guard prevents saving default values before stored preferences have been loaded from `localStorage`.
2. `const _ = { leftWidth, rightWidth, rightCollapsed }` explicitly reads all reactive values so the effect re-runs when any of them change. Without this line, the compiler would only track values read synchronously before the `setTimeout` -- values read inside the timeout callback would not be tracked because they execute asynchronously.
3. `clearTimeout(saveTimeout)` cancels any pending save, so rapid changes (dragging a panel resizer) only write once after the user stops, 100ms later.
4. The `try/catch` handles `localStorage` quota errors and private browsing restrictions gracefully.

### When to Use Which

| Approach | Scope | Best For | Example |
|----------|-------|----------|---------|
| `$state` in component | Component-local | Simple toggle, form input | Panel collapsed state |
| `.svelte.ts` class with `$state` | Cross-component | Complex state with methods | Conversation context |
| `writable`/`derived` stores | Cross-component | State machines, many derived views | Loading state |
| SSR-safe wrappers | Cross-component (SSR) | Stores accessed during SSR | WebSocket connection status |

**Decision flow:**

1. Does the state stay inside one component? Use `$state` directly.
2. Does the state need methods and encapsulation? Use a `.svelte.ts` class with `$state` properties.
3. Does the state represent a finite state machine with many derived projections? Use `writable`/`derived`.
4. Will the store be read during SSR? Wrap it with `createSSRSafeStore()`.

---

## 6. Service Layer

### Pattern

Services encapsulate API communication, response transformation, and store management. Components never call `fetch()` directly -- they go through service classes. Services are singletons accessed via `getXxxService()` factory functions, ensuring a single instance per application lifecycle. This avoids duplicated connections, inconsistent caches, and scattered API logic across components.

### Generic Service Skeleton

Before looking at domain-specific examples, here is the generic pattern every service follows. Copy this skeleton and fill in your domain methods:

```typescript
import { writable, type Writable } from 'svelte/store';

export class DataService<T> {
  private baseUrl: string;
  private abortController: AbortController | null = null;

  // Expose reactive state to components
  public data: Writable<T | null> = writable(null);
  public loading: Writable<boolean> = writable(false);
  public error: Writable<string | null> = writable(null);

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  protected async fetch<R>(path: string, options?: RequestInit): Promise<R> {
    this.abortController = new AbortController();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      signal: this.abortController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  cancelCurrentRequest(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

// Singleton factory -- one per service type
let instance: DataService<YourType> | null = null;

export function getDataService(): DataService<YourType> {
  if (!instance) {
    const url = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    instance = new DataService<YourType>(url);
  }
  return instance;
}

export function resetDataService(): void {
  instance?.cancelCurrentRequest();
  instance = null;
}
```

The three key parts: (1) a class with `baseUrl` and reactive stores, (2) a module-level nullable singleton, and (3) a factory function for lazy initialization. The domain-specific examples below follow this exact shape.

### Service Factory Pattern

Each service follows the same structure: a class with a `baseUrl` constructor parameter, a module-level nullable reference, and a factory function that lazily initializes the singleton.

*Source: `packages/frontend/src/lib/services/ai-service.ts`*

```typescript
export class AIService {
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  // ... service methods
}

// Singleton instance for global use
let aiService: AIService | null = null;

export function getAIService(): AIService {
  if (!aiService) {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    aiService = new AIService(apiUrl);
  }
  return aiService;
}

export function resetAIService(): void {
  if (aiService) {
    aiService.cancelCurrentRequest();
    aiService = null;
  }
}
```

The factory function `getAIService()` uses lazy initialization -- the instance is only created on first call. The URL is discovered from `import.meta.env.VITE_API_URL`, falling back to `localhost:3000` for local development. The `resetAIService()` function cancels in-flight requests and clears the singleton, which is useful during navigation teardown or testing.

Components consume the service by calling the factory:

```typescript
const ai = getAIService();
const response = await ai.sendMessage(threadId, query, context);
```

They never construct `new AIService()` directly. This guarantees every component shares the same instance, the same abort controller, and the same connection state.

### Service-Store Integration

Services own `writable` stores as public properties. Components subscribe to these stores for reactive updates, but never write to them directly -- only the service's internal methods mutate store values.

*Source: `packages/frontend/src/lib/services/organizational-service.ts`*

```typescript
export class OrganizationalService {
  private baseUrl: string;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private wsService: WebSocketService | null = getWebSocketService();

  // Reactive stores for real-time updates
  public organizationTree = writable<OrganizationTreeResponse | null>(null);
  public selectedNode = writable<OrganizationNode | null>(null);
  public realTimeEnabled = writable<boolean>(false);

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || import.meta.env.VITE_API_URL || 'http://localhost:3000';
    this.initializeWebSocketListeners();
  }

  // Service methods call this.organizationTree.set(...) internally
}
```

The separation is deliberate: the service fetches data, transforms it, and pushes it into stores. Components subscribe with `$organizationTree` (auto-subscription) or `store.subscribe()` and render reactively. This means:

- **Data flow is unidirectional**: Backend -> Service -> Store -> Component.
- **Components are decoupled from fetch logic**: They do not know whether data came from a REST call, a WebSocket message, or a cache hit.
- **Store updates are centralized**: If the organizational tree changes, there is exactly one place that calls `this.organizationTree.set()`.

A component subscribing to the service's stores:

```svelte
<script lang="ts">
  import { getOrganizationalService } from '$lib/services/organizational-service';

  const orgService = getOrganizationalService();
  const tree = orgService.organizationTree;
</script>

{#if $tree}
  <OrgTree data={$tree} />
{/if}
```

### Request Deduplication

When multiple components mount simultaneously and each requests the same data, the application would normally fire duplicate HTTP requests. The `RequestDeduplicator` class prevents this by tracking in-flight requests by key and sharing the same `Promise` across callers.

*Source: `packages/frontend/src/lib/utils/request-deduplication.ts`*

```typescript
class RequestDeduplicator {
  private inFlight: Map<string, InFlightRequest<any>> = new Map();
  private cache: Map<string, CacheEntry<any>> = new Map();

  async dedupe<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { cacheTTL?: number; bypassCache?: boolean } = {}
  ): Promise<T> {
    const { cacheTTL = getDynamicCacheTTL(key), bypassCache = false } = options;

    // Check cache first (unless bypassing)
    if (!bypassCache) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
    }

    // Check for in-flight request
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    // Create new request, cache result, clean up in-flight tracker
    const request = fetcher()
      .then((data) => {
        this.cache.set(key, { data, timestamp: Date.now() });
        return data;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    return request;
  }
}
```

Cache TTL is dynamic based on endpoint type, matching data freshness requirements:

```typescript
const CACHE_TTL_CONFIG: Record<string, number> = {
  'organization-tree': 15 * 60 * 1000,   // 15 min - structure rarely changes
  'service-hierarchy': 10 * 60 * 1000,   // 10 min - services list stable
  'cost-history': 2 * 60 * 1000,         // 2 min - may update during day
  'cost-breakdown': 1 * 60 * 1000,       // 1 min - current month changes
  'node-costs': 1 * 60 * 1000,           // 1 min - current month changes
  'recommendations': 5 * 60 * 1000,      // 5 min - moderate freshness
};
```

A global singleton instance and convenience function simplify usage:

```typescript
export const requestDeduplicator = new RequestDeduplicator();

export function deduplicatedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { cacheTTL?: number; bypassCache?: boolean }
): Promise<T> {
  return requestDeduplicator.dedupe(key, fetcher, options);
}
```

Services use `deduplicatedFetch()` instead of raw `fetch()` for all cacheable GET requests. POST requests (like AI queries) bypass deduplication since they are not idempotent.

### API URL Discovery

All services resolve the backend URL from the same environment variable:

```typescript
const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

Vite injects `VITE_`-prefixed variables at build time. In development, this falls back to `localhost:3000`. In production, the build pipeline sets `VITE_API_URL` to the deployed backend. Because the factory function reads this once during lazy initialization, the URL is consistent across the entire application.

### Key Principles

1. **Components -> Services -> Backend API** -- components never call `fetch()` directly.
2. **Services are singletons via factory functions** -- `getXxxService()` guarantees one instance per app.
3. **Services own and update stores; components only subscribe** -- unidirectional data flow from backend through service into reactive stores.
4. **Request deduplication prevents redundant API calls** -- multiple components requesting the same data share a single in-flight request.
5. **Dynamic cache TTL matches data freshness requirements per endpoint** -- frequently changing data (current month costs) expires in 1 minute, stable data (org tree) caches for 15 minutes.

---

## 7. Data Streaming

### Pattern

Real-time data flows through two channels: Server-Sent Events (SSE) for request/response streaming and WebSocket for push updates. SSE handles AI query responses where the client initiates a request and progressively receives structured events as the backend pipeline executes. WebSocket handles server-initiated broadcasts like cost data changes that arrive independently of any client action. The two protocols complement each other -- SSE for "client asks, server streams back," WebSocket for "server pushes when something changes."

### SSE Consumption

The core streaming pattern uses `fetch()` with a `ReadableStream` reader rather than the browser's `EventSource` API. This is necessary because the AI endpoint requires POST requests with JSON bodies, while `EventSource` only supports GET. The reader accumulates raw bytes into a text buffer, splits on double-newline SSE boundaries, strips the `data:` prefix, and dispatches parsed events through typed callbacks.

*Source: `packages/frontend/src/lib/services/ai-service.ts`*

```typescript
async queryAIStream(request: AIQueryRequest, callbacks: StreamingCallbacks): Promise<void> {
  this.abortController = new AbortController();

  try {
    const response = await fetch(`${this.baseUrl}/api/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';  // Last element is incomplete, keep buffered

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'start':
                  callbacks.onStart?.({
                    threadId: event.threadId || '',
                    requestId: event.requestId || '',
                  });
                  break;
                case 'node_start':
                  if (event.nodeName) callbacks.onNodeStart?.(event.nodeName);
                  break;
                case 'node_end':
                  if (event.nodeName) callbacks.onNodeEnd?.(event.nodeName);
                  break;
                case 'tool_start':
                  if (event.toolName) callbacks.onToolStart?.(event.toolName);
                  break;
                case 'tool_end':
                  if (event.toolName) callbacks.onToolEnd?.(event.toolName, event.toolDuration);
                  break;
                case 'token':
                  if (typeof event.content === 'string' && event.content.length > 0) {
                    callbacks.onToken?.(event.content);
                  }
                  break;
                case 'done':
                  callbacks.onDone?.({
                    responseTime: event.responseTime || 0,
                    tokensUsed: event.tokensUsed,
                    toolsUsed: event.toolsUsed,
                    suggestedFollowUps: event.suggestedFollowUps,
                    confidence: event.confidence,
                    threadId: event.threadId,
                    requestId: event.requestId,
                    runId: event.runId,
                    structuredData: event.structuredData,
                    routingDecision: event.routingDecision,
                    extractedEntities: event.extractedEntities,
                  });
                  break;
                case 'suggestions':
                  if (event.suggestedFollowUps?.length) {
                    callbacks.onSuggestions?.(event.suggestedFollowUps);
                  }
                  break;
                case 'error':
                  callbacks.onError?.(event.message || 'Unknown streaming error');
                  break;
              }
            } catch (parseError) {
              // Malformed SSE frame -- log and continue processing remaining events
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Streaming request was cancelled');
    }
    throw new Error(`AI streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    this.abortController = null;
  }
}
```

Key details in the buffer management: `decoder.decode(value, { stream: true })` tells the decoder not to flush multi-byte characters split across chunks. Splitting on `\n\n` aligns with the SSE spec where events are delimited by blank lines. The `lines.pop()` retains any incomplete trailing data for the next iteration -- without this, events split across TCP frames would silently fail to parse.

### StreamEvent Type

Every SSE frame carries a typed `StreamEvent` that maps to a specific phase of the AI pipeline. The `type` discriminator drives the `switch` dispatch above.

*Source: `packages/frontend/src/lib/services/ai-service.ts`*

```typescript
export interface StreamEvent {
  type: 'start' | 'node_start' | 'node_end' | 'tool_start' | 'tool_end' | 'token' | 'done' | 'suggestions' | 'error';
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
  structuredData?: Record<string, unknown>;
  routingDecision?: string;
  routingPath?: string[];
  extractedEntities?: ExtractedEntities;
}
```

The event taxonomy follows the LangGraph execution lifecycle:

| Event | When Emitted | Payload |
|-------|-------------|---------|
| `start` | Request accepted | `threadId`, `requestId` for correlation |
| `node_start` | Graph node begins execution | `nodeName` (classify, entityExtractor, etc.) |
| `node_end` | Graph node completes | `nodeName` |
| `tool_start` | Tool invocation begins | `toolName` (cost_query, trend_analysis, etc.) |
| `tool_end` | Tool invocation completes | `toolName`, `toolDuration` in milliseconds |
| `token` | LLM produces text | `content` -- the incremental text chunk |
| `done` | Full pipeline complete | `responseTime`, `tokensUsed`, `toolsUsed`, `suggestedFollowUps`, `runId`, `structuredData`, `extractedEntities` |
| `suggestions` | Follow-up questions generated | `suggestedFollowUps` array |
| `error` | Pipeline or tool failure | `message` with error description |

Not all fields are populated on every event -- the interface is a union of all possible payloads discriminated by `type`. Consumers check for presence before using optional fields.

### StreamingCallbacks Interface

The callbacks interface decouples the transport layer (SSE parsing in `queryAIStream`) from the UI layer (ChatInterface component). Each callback maps to a `StreamEvent` type, allowing consumers to update UI state progressively as events arrive.

*Source: `packages/frontend/src/lib/services/ai-service.ts`*

```typescript
export interface StreamingCallbacks {
  onStart?: (data: { threadId: string; requestId: string }) => void;
  onNodeStart?: (nodeName: string) => void;
  onNodeEnd?: (nodeName: string) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, duration?: number) => void;
  onToken?: (content: string) => void;
  onDone?: (data: {
    responseTime: number;
    tokensUsed?: number;
    toolsUsed?: string[];
    suggestedFollowUps?: string[];
    confidence?: number;
    threadId?: string;
    requestId?: string;
    runId?: string;
    structuredData?: Record<string, unknown>;
    routingDecision?: string;
    extractedEntities?: ExtractedEntities;
  }) => void;
  onSuggestions?: (suggestions: string[]) => void;
  onError?: (message: string) => void;
}
```

All callbacks are optional. A consumer only implements what it needs -- for example, a progress indicator needs `onNodeStart`/`onNodeEnd`/`onToolStart`/`onToolEnd` but not `onToken`, while a text display needs `onToken` but not the node lifecycle callbacks. The ChatInterface implements all of them to drive both the streaming progress pills and the progressive markdown rendering simultaneously.

### Streaming Progress UI

The `StreamingProgress` component renders a visual timeline of the AI pipeline as events stream in. It receives reactive props driven by the streaming callbacks and renders each graph node as a status pill.

*Source: `packages/frontend/src/lib/components/chat/StreamingProgress.svelte`*

```typescript
interface Props {
  currentNode: string | null;
  completedNodes: string[];
  activeTools: string[];
  completedTools: { name: string; duration?: number }[];
  isStreaming: boolean;
  pendingNodeCompletions?: string[];
}
```

The node configuration array defines the pipeline stages in execution order. Each entry maps a graph node ID to a user-facing label and description:

```typescript
const nodes = [
  { id: "classify",        label: "Analyzing",  description: "Classifying query complexity" },
  { id: "entityExtractor", label: "Extracting", description: "Identifying entities and timeframes" },
  { id: "toolRouter",      label: "Routing",    description: "Selecting optimal tools" },
  { id: "retriever",       label: "Fetching",   description: "Loading relevant cost data" },
  { id: "agent",           label: "Reasoning",  description: "Analyzing data with AI" },
  { id: "tools",           label: "Tools",      description: "Executing database queries" },
  { id: "responder",       label: "Generating", description: "Creating response" },
];
```

The `getNodeStatus()` function determines whether each pill shows as completed (checkmark), active (spinner), or pending (dot). The `tools` node has special handling because the agent may loop back to select additional tools -- the tools node only marks as completed once the responder has started, preventing premature completion signals during multi-tool queries:

```typescript
function getNodeStatus(nodeId: string): "completed" | "active" | "pending" {
  if (nodeId === "tools") {
    const responderStarted = completedNodes.includes("responder") || currentNode === "responder";
    if (responderStarted && completedNodes.includes("tools")) return "completed";
    if (completedNodes.includes("tools") || activeTools.length > 0) return "active";
    return "pending";
  }

  if (completedNodes.includes(nodeId)) return "completed";
  if (currentNode === nodeId) return "active";
  if (pendingNodeCompletions.includes(nodeId)) return "active";
  return "pending";
}
```

The template renders the node timeline as a horizontal row of pills using Tailwind classes that switch based on status. Active tools and completed tools (with durations) appear in separate sections below the node timeline, giving the user a complete picture of what the AI is doing at any moment.

### Request Cancellation

Long-running AI queries need cancellation support. The service stores an `AbortController` per active request, and the `cancelCurrentRequest()` method aborts the in-flight fetch. The `AbortError` is caught inside `queryAIStream` and re-thrown as a descriptive error that the UI can handle gracefully.

*Source: `packages/frontend/src/lib/services/ai-service.ts`*

```typescript
cancelCurrentRequest(): void {
  if (this.abortController) {
    this.abortController.abort();
    this.abortController = null;
  }
}
```

The controller is wired into `fetch()` via the `signal` option: `fetch(url, { signal: this.abortController.signal })`. When aborted, the `ReadableStream` reader throws an `AbortError`, the `finally` block releases the reader lock, and the outer `finally` nullifies the controller. This guarantees no dangling connections or orphaned stream readers.

### WebSocket Integration

WebSocket provides the second data channel -- server-initiated push updates for cost data and organizational node changes. The `WebSocketService` is a singleton class that manages connection lifecycle, heartbeat, and exponential-backoff reconnection.

*Source: `packages/frontend/src/lib/services/websocket-service.ts`*

```typescript
export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval = 30000;

  // SSR-safe Svelte stores for reactive updates
  public connectionStatus = createConnectionStatusStore();
  public costUpdates = createCostUpdatesStore();
  public nodeUpdates = createNodeUpdatesStore<OrganizationNode>();

  // ...
}
```

The service exposes three Svelte stores: `connectionStatus` for connection health, `costUpdates` for incoming cost data keyed by node ID, and `nodeUpdates` for organizational node changes. The stores are created via SSR-safe factory functions that return inert stubs on the server and real `writable` stores in the browser.

Message dispatch follows the same switch-on-type pattern as SSE, updating the appropriate store based on `message.type`:

```typescript
private handleMessage(message: WebSocketMessage): void {
  switch (message.type) {
    case 'cost_update':
      this.costUpdates.update(costs => {
        const newCosts = new Map(costs);
        const { nodeId, costData } = message.data;
        newCosts.set(nodeId, costData);
        return newCosts;
      });
      break;
    case 'node_update':
      this.nodeUpdates.set(message.data);
      break;
    case 'health_check':
      this.connectionStatus.update(status => ({
        ...status,
        lastHeartbeat: Date.now()
      }));
      break;
  }
}
```

**Store-based subscription model.** The `OrganizationalService` consumes WebSocket updates by subscribing to the WebSocket stores and merging incoming data into its own reactive stores. This keeps the WebSocket transport decoupled from domain logic:

*Source: `packages/frontend/src/lib/services/organizational-service.ts`*

```typescript
private initializeWebSocketListeners(): void {
  if (!this.wsService) return;

  // Cost updates flow: WebSocket -> costUpdates store -> organizationTree store
  this.wsService.costUpdates.subscribe(costUpdates => {
    this.organizationTree.update(currentTree => {
      if (!currentTree?.data?.rootNode) return currentTree;
      // Merge cost updates into the organization tree
      // ...
      return currentTree;
    });
  });

  // Node updates flow: WebSocket -> nodeUpdates store -> selectedNode store
  this.wsService.nodeUpdates.subscribe(nodeUpdate => {
    if (nodeUpdate) {
      this.selectedNode.update(current => {
        if (current?.id === nodeUpdate.id) return nodeUpdate;
        return current;
      });
    }
  });
}
```

**Layout wiring.** The root `+layout.svelte` initializes both services and subscribes to connection status for UI indicators. On node selection, the organizational service sends WebSocket subscribe/unsubscribe messages to scope server-side updates to the active node:

*Source: `packages/frontend/src/routes/+layout.svelte`*

```typescript
const orgService = getOrganizationalService();
const wsService = getWebSocketService();

$effect(() => {
  if (!browser) return;

  const unsubConnection = wsService?.connectionStatus?.subscribe(value => {
    connectionStatus = { connected: value.connected, reconnectAttempts: value.reconnectAttempts };
  });

  orgService.enableRealTime();

  return () => {
    unsubConnection?.();
  };
});
```

### SSE vs WebSocket Decision Table

| | SSE | WebSocket |
|---|-----|-----------|
| Direction | Server to client only | Bidirectional |
| Protocol | HTTP (standard fetch) | WebSocket (upgrade handshake) |
| Auto-reconnect | Built into EventSource API | Manual (exponential backoff) |
| Request method | POST via ReadableStream (not EventSource) | N/A -- persistent connection |
| Use case | Progress updates, streaming responses | Real-time push updates |
| In this project | AI query streaming (`queryAIStream`) | Cost update broadcasts (`WebSocketService`) |
| Lifecycle | Per-request (created and destroyed with each query) | Application-wide singleton (lives for session duration) |

### Key Principles

1. **SSE for request-scoped streaming, WebSocket for session-scoped push** -- each protocol matches its data flow pattern.
2. **Buffer management prevents data loss across TCP frames** -- incomplete SSE events are retained and joined with the next chunk.
3. **Typed callbacks decouple transport from UI** -- the streaming parser dispatches to callback interfaces, and components implement only the callbacks they need.
4. **Stores bridge WebSocket events into Svelte reactivity** -- WebSocket messages update Svelte stores, which components subscribe to through services.
5. **Cancellation is first-class** -- `AbortController` cleanly terminates both the HTTP connection and the stream reader without resource leaks.
6. **SSR safety is enforced at every layer** -- WebSocket connections, store subscriptions, and browser APIs are gated behind `browser` checks.

---

## 8. SvelteKit Routing & Layouts

### Pattern

File-based routing with layouts as persistent shells. State flows through stores, not SvelteKit load functions. The root layout wraps all pages with error boundaries, navigation, and a three-panel layout. Each route maps to a directory under `src/routes/`, and the root `+layout.svelte` provides the chrome that persists across all page transitions -- organizational navigation on the left, page content in the center, and an AI chat panel on the right.

### Route Structure

Every route in the application maps to a `+page.svelte` file inside the `src/routes/` directory. There are no nested layouts or load functions -- the root layout handles all shared concerns, and individual pages receive their data through store subscriptions rather than SvelteKit's data loading pipeline.

```
src/routes/
  +layout.svelte          -- Root layout shell (ErrorBoundary + ThreePanelLayout)
  +page.svelte            -- Dashboard (/)
  cost-analysis/
    +page.svelte          -- Historical trends
  category-analysis/
    +page.svelte          -- Service breakdown
  anomalies/
    +page.svelte          -- Cost anomaly detection
  recommendations/
    +page.svelte          -- Optimization recommendations
  settings/
    +page.svelte          -- Application settings
```

Six routes, all siblings at one nesting level. No `+layout.ts` or `+page.ts` files exist -- there are no server-side data loaders. This is deliberate: cost data arrives through service singletons that maintain their own caches, and the organizational tree is fetched once and shared via stores.

### Root Layout

The root `+layout.svelte` is the outermost shell for every page. It composes three concerns: global metadata, error recovery, and the three-panel layout.

*Source: `packages/frontend/src/routes/+layout.svelte`*

```svelte
<script lang="ts">
    import { browser } from '$app/environment';
    import ThreePanelLayout from '$lib/components/ThreePanelLayout.svelte';
    import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
    import { getOrganizationalService } from '$lib/services/organizational-service.js';
    import { getWebSocketService } from '$lib/services/websocket-service.js';

    let { children } = $props();

    let selectedNode = $state<OrganizationNode | null>(null);
    let realTimeEnabled = $state<boolean>(false);
    let connectionStatus = $state<{ connected: boolean; reconnectAttempts: number }>(
        { connected: false, reconnectAttempts: 0 }
    );

    const orgService = getOrganizationalService();
    const wsService = getWebSocketService();

    // Subscribe to stores with SSR-safe pattern
    $effect(() => {
        if (!browser) return;

        const unsubRealTime = orgService.realTimeEnabled?.subscribe(value => {
            realTimeEnabled = value;
        });
        const unsubConnection = wsService?.connectionStatus?.subscribe(value => {
            connectionStatus = {
                connected: value.connected,
                reconnectAttempts: value.reconnectAttempts
            };
        });
        const unsubSelectedNode = orgService.selectedNode?.subscribe(value => {
            if (value && value.id !== selectedNode?.id) {
                selectedNode = value;
            }
        });

        orgService.enableRealTime();

        return () => {
            unsubRealTime?.();
            unsubConnection?.();
            unsubSelectedNode?.();
        };
    });
</script>

<svelte:head>
    <title>AWS Cost Analyzer - Professional Cost Management</title>
    <meta name="description" content="..." />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</svelte:head>

<ErrorBoundary>
    <a href="#main-content" class="sr-only focus:not-sr-only ...">
        Skip to main content
    </a>
    <ThreePanelLayout {selectedNode} onNodeSelect={handleNodeSelect}
        {connectionStatus} {realTimeEnabled}>
        {@render children()}
    </ThreePanelLayout>
</ErrorBoundary>
```

**How it works:**

1. **SSR guard** -- the `$effect` checks `browser` before subscribing to stores. During server-side rendering, Svelte executes effects but `browser` is `false`, so no subscriptions are created. This prevents errors from WebSocket and localStorage access during SSR.
2. **Store subscription pattern** -- each service exposes Svelte stores (`writable`/`derived`). The layout subscribes to them inside a single `$effect` and copies their values into local `$state` variables. The effect's cleanup function calls every unsubscribe, preventing memory leaks on navigation.
3. **Selected node bridging** -- the `orgService.selectedNode` store is the source of truth for which organizational node is active. The layout subscribes to it and passes the value down as a prop. When a child component or the org tree updates the store, the layout picks up the change and propagates it to `ThreePanelLayout`.
4. **Composition order** -- `ErrorBoundary` wraps everything, so even fatal layout errors get caught and surfaced with a recovery UI instead of a white screen.

### Page Metadata

The root layout sets global `<head>` metadata using `<svelte:head>`, which SvelteKit hoists into the document head. Individual pages can add their own `<svelte:head>` blocks to append page-specific titles or meta tags -- SvelteKit merges them.

```svelte
<svelte:head>
    <title>AWS Cost Analyzer - Professional Cost Management</title>
    <meta name="description" content="Professional AWS cost analysis and optimization tool" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</svelte:head>
```

Because the viewport meta tag is set in the layout rather than `app.html`, it participates in SvelteKit's head management and can be overridden per route if needed.

### Accessibility

The root layout includes a skip-to-content link that is visually hidden but becomes visible on keyboard focus. This lets keyboard users bypass the navigation panel and jump directly to the main content area.

*Source: `packages/frontend/src/routes/+layout.svelte`*

```svelte
<a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100]
        focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg
        focus:ring-2 focus:ring-tommy-navy focus:text-tommy-navy focus:font-medium"
>
    Skip to main content
</a>
```

The link targets `#main-content`, which is the `id` set on the `<main>` element inside `ThreePanelLayout`. Tailwind's `sr-only` class hides the link from sighted users, and `focus:not-sr-only` reveals it when it receives keyboard focus via Tab.

### Three-Panel Layout

`ThreePanelLayout` is the structural backbone of the application. It divides the viewport into three columns: a fixed-width left panel for organizational navigation, a flexible center panel for page content, and a collapsible right panel for the AI chat interface.

*Source: `packages/frontend/src/lib/components/ThreePanelLayout.svelte`*

```svelte
<div class="flex h-screen w-screen overflow-hidden bg-gray-100" bind:this={containerRef}>
    <!-- Left Panel (always visible) -->
    <div class="shrink-0 overflow-hidden" style:width="{leftWidth}px">
        <SplitNavigation {onNodeSelect} {connectionStatus} {realTimeEnabled} />
    </div>

    <!-- Left Resizer -->
    <PanelResizer position="left" onResize={handleLeftResize} />

    <!-- Center Panel -->
    <div class="flex-1 flex flex-col min-w-0">
        <main id="main-content" class="flex-1 overflow-y-auto bg-gray-50">
            {@render children()}
        </main>
    </div>

    <!-- Right Resizer -->
    <PanelResizer position="right" onResize={handleRightResize}
        onDoubleClick={toggleRightCollapse} isCollapsed={rightCollapsed} />

    <!-- Right Panel (auto-collapses on narrow screens) -->
    <div class="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
        style:width={rightCollapsed || isNarrowScreen.current ? '0px' : `${effectiveRightWidth}px`}>
        {#if !rightCollapsed && !isNarrowScreen.current}
            <ChatInterface {selectedNode} />
        {/if}
    </div>

    <!-- Expand button when right panel is collapsed -->
    {#if rightCollapsed || isNarrowScreen.current}
        <button class="fixed right-0 top-1/2 -translate-y-1/2 z-50 ..."
            onclick={toggleRightCollapse} aria-label="Expand chat">
            <!-- chevron icon -->
        </button>
    {/if}
</div>
```

**Layout mechanics:**

- **Left panel** (`shrink-0`, pixel width) -- always visible, holds the organizational tree navigation. Width is user-adjustable via the left resizer, constrained between 200px and 480px.
- **Center panel** (`flex-1`, `min-w-0`) -- takes all remaining horizontal space. The `min-w-0` override is critical: without it, flex children with long content (tables, code blocks) would push the center panel past its allocated space. A minimum of 400px is enforced by the resize handlers.
- **Right panel** (`shrink-0`, pixel width or 0) -- holds the AI chat interface. Collapses to zero width on screens narrower than 1024px (via Svelte 5's `MediaQuery` class) or when the user double-clicks the resizer. Width is constrained between 320px and 700px.
- **Expand button** -- appears as a fixed chevron on the right edge when the panel is collapsed, providing a click target to restore it.

**Responsive behavior** uses Svelte 5's `MediaQuery` reactive class rather than CSS media queries, because the component needs to conditionally render (not just hide) the chat panel:

```ts
const isNarrowScreen = new MediaQuery('max-width: 1024px', false);
const isMobileScreen = new MediaQuery('max-width: 768px', false);

let effectiveRightWidth = $derived(
    rightCollapsed || isNarrowScreen.current ? 0 : rightWidth
);
```

The second argument (`false`) is the SSR fallback value -- during server-side rendering, `matchMedia` is unavailable, so the panel defaults to visible.

**Persistence** -- panel widths and collapse state are saved to `localStorage` with a debounced `$effect` (covered in Section 5, localStorage Persistence with Debounce). On page load, saved dimensions are restored before the first paint.

### Panel Resizer

`PanelResizer` is a thin interactive strip between panels that supports three interaction modes: mouse drag, keyboard arrows, and double-click collapse.

*Source: `packages/frontend/src/lib/components/PanelResizer.svelte`*

```svelte
<script lang="ts">
    interface Props {
        position: 'left' | 'right';
        onResize: (delta: number) => void;
        onDoubleClick?: () => void;
        isCollapsed?: boolean;
    }

    let { position, onResize, onDoubleClick, isCollapsed = false }: Props = $props();
    let isDragging = $state(false);
    let startX = 0;

    const canCollapse = $derived(!!onDoubleClick);
</script>
```

**Mouse drag** -- on `mousedown`, the resizer captures the starting X position and attaches `mousemove`/`mouseup` listeners to `document` (not the element itself, so dragging works even if the cursor leaves the resizer). Each `mousemove` computes the delta and calls `onResize`. The direction is flipped for the right panel (`position === 'left' ? delta : -delta`) because dragging right should shrink the right panel but expand the left.

```ts
function handleMouseDown(event: MouseEvent) {
    event.preventDefault();
    isDragging = true;
    startX = event.clientX;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
}

function handleMouseMove(event: MouseEvent) {
    if (!isDragging) return;
    const delta = event.clientX - startX;
    startX = event.clientX;
    onResize(position === 'left' ? delta : -delta);
}
```

Setting `cursor` and `userSelect` on `document.body` during drag prevents the cursor from flickering and text from being selected as the user drags across content areas.

**Keyboard support** -- arrow keys resize by 10px (or 50px with Shift held). Enter and Space toggle collapse when the `onDoubleClick` callback is provided.

```ts
function handleKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 50 : 10;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -step : step;
        onResize(position === 'left' ? delta : -delta);
    } else if ((event.key === 'Enter' || event.key === ' ') && onDoubleClick) {
        event.preventDefault();
        onDoubleClick();
    }
}
```

**Double-click collapse** -- only available on the right resizer (where `onDoubleClick` is passed). The left panel is always visible since it contains essential navigation.

The resizer element itself is a `<button>` for native keyboard focusability, with a dynamic `aria-label` that describes both available actions:

```svelte
<button
    type="button"
    class="group relative w-1.5 shrink-0 cursor-col-resize ..."
    onmousedown={handleMouseDown}
    ondblclick={handleDoubleClick}
    onkeydown={handleKeyDown}
    aria-label={canCollapse
        ? `${position} panel resizer. Use arrow keys to resize, Enter to ${isCollapsed ? 'expand' : 'collapse'}.`
        : `${position} panel resizer. Use arrow keys to resize.`}
>
    <!-- Visual handle indicator (opacity transitions on hover/drag) -->
</button>
```

### Error Boundaries

Svelte 5 introduces `<svelte:boundary>` for catching component errors without crashing the entire application. The `ErrorBoundary` component wraps its children and provides a recovery UI when a child throws during rendering or in an effect.

*Source: `packages/frontend/src/lib/components/ErrorBoundary.svelte`*

```svelte
<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        children: Snippet;
        onerror?: (error: unknown, reset: () => void) => void;
    }

    let { children, onerror }: Props = $props();
</script>

<svelte:boundary {onerror}>
    {@render children()}

    {#snippet failed(error, reset)}
        <div class="flex items-center justify-center min-h-screen p-8 ...">
            <div class="max-w-[600px] w-full bg-white rounded-xl shadow-2xl overflow-hidden">
                <h2>Something went wrong</h2>
                <p>{getErrorMessage(error)}</p>

                {#if getErrorStack(error)}
                    <details>
                        <summary>Error details</summary>
                        <pre>{getErrorStack(error)}</pre>
                    </details>
                {/if}

                <button onclick={reset}>Try again</button>
                <button onclick={() => window.location.reload()}>Reload page</button>
            </div>
        </div>
    {/snippet}
</svelte:boundary>
```

**How it works:**

1. `<svelte:boundary>` wraps the children slot. When any descendant throws during rendering, Svelte catches the error and invokes the `failed` snippet instead of propagating the error up to crash the application.
2. The `onerror` callback prop allows parent components to hook into the error (for logging to an external service, for example) without replacing the fallback UI.
3. The `failed` snippet receives two arguments: the thrown `error` and a `reset` function. Calling `reset()` clears the error state and re-renders the children, giving the component tree a chance to recover without a full page reload.
4. A second button offers `window.location.reload()` as a hard reset for cases where re-rendering would hit the same error.
5. A collapsible `<details>` element shows the stack trace for debugging without cluttering the recovery screen.

In the root layout, `ErrorBoundary` wraps everything including `ThreePanelLayout`, so even a catastrophic rendering error in the layout itself gets caught and surfaced instead of producing a blank page.

### Navigation Patterns

Navigation in this application is store-driven, not route-driven. Clicking a node in the organizational tree does not trigger a SvelteKit route change -- it updates the `orgService.selectedNode` store, which the root layout subscribes to and passes as a prop to `ThreePanelLayout`. Pages react to the selected node through their own store subscriptions.

This design means the URL reflects *which page* the user is viewing (dashboard, cost analysis, anomalies), while the *scope* of the data (which account, department, or domain) is held in application state. Two users on the same route can see different data depending on their tree selection.

SvelteKit's `goto()` is not used for organizational tree navigation. Route transitions happen only through standard `<a>` links in the top navigation bar, which SvelteKit intercepts for client-side routing. The three-panel layout persists across these transitions because it lives in the root `+layout.svelte` -- only the center panel's content (the `{@render children()}` slot) swaps when the route changes.

### Key Principles

1. **Root layout wraps all routes with ErrorBoundary and ThreePanelLayout** -- error recovery and the panel shell persist across every page transition.
2. **Panel sizing persists to localStorage with debounce** -- user preferences survive reloads without excessive write operations during drag interactions.
3. **Store-driven navigation, not SvelteKit goto()** -- the URL tracks the active page, while stores track the active organizational scope.
4. **Error boundaries catch component errors without crashing the app** -- `<svelte:boundary>` with a `failed` snippet provides inline recovery and stack trace inspection.
5. **Skip-to-content link for keyboard navigation** -- visually hidden, revealed on focus, targets the `#main-content` element inside the center panel.

---

## 9. Tailwind CSS Integration

### Pattern

Tailwind CSS is the sole styling mechanism. No `<style>` blocks in components except for CSS features Tailwind cannot express -- pseudo-elements, scrollbar hiding, and complex stateful selectors that require custom CSS.

### Vite Plugin Setup

Tailwind v4 integrates through its dedicated Vite plugin rather than the traditional PostCSS pipeline. The Vite plugin is faster (processes only changed files during HMR) and requires no `tailwind.config.js` or `postcss.config.js` -- all configuration lives in `src/tailwind.css`.

```typescript
// packages/frontend/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit()
  ],
  server: { host: true },
  preview: { host: true }
});
```

The plugin order matters -- `tailwindcss()` must precede `sveltekit()` so that Tailwind processes CSS before SvelteKit bundles it.

### Custom Theme

The `@theme` directive in `src/tailwind.css` defines project-specific design tokens -- brand colors, spacing scales, and custom animations. These tokens generate corresponding Tailwind utilities (e.g., `--color-tommy-navy: #02154E` becomes `bg-tommy-navy`, `text-tommy-navy`, `border-tommy-navy`).

See `implementation/UI_UX_STYLE_GUIDE.md` for the full token definitions, color palette, and usage guidelines. The tokens are defined once in `tailwind.css` and referenced everywhere through Tailwind utility classes -- never through raw CSS custom properties.

### The Tailwind-Only Rule

All component styling uses Tailwind utility classes directly in the template markup. The `<style>` block is reserved for the rare cases where CSS features have no Tailwind equivalent. Two such exceptions exist in the codebase:

**Carousel scrollbar hiding** (`src/lib/components/ui/Carousel.svelte`, lines 174-189): Hiding native scrollbars requires `scrollbar-width: none` for Firefox, `::-webkit-scrollbar { display: none }` for Chrome/Safari, and a `prefers-reduced-motion` media query to disable smooth scrolling for accessibility. None of these have Tailwind utility equivalents.

```css
.carousel-track {
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.carousel-track::-webkit-scrollbar {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .carousel-track {
    scroll-behavior: auto;
  }
}
```

**Tooltip arrow** (`src/lib/components/Tooltip.svelte`, lines 58-68): The tooltip's directional arrow is a CSS triangle drawn with the `::after` pseudo-element and transparent borders. Pseudo-elements cannot be created through Tailwind classes.

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

Both exceptions are justified because pseudo-elements (`::after`, `::-webkit-scrollbar`) and vendor-prefixed scrollbar properties have no Tailwind equivalents. If a styling need can be expressed with Tailwind utilities, it must be -- the `<style>` block is not an escape hatch for convenience.

### Responsive Design

Svelte 5 provides the `MediaQuery` class from `svelte/reactivity` for JavaScript-side responsive logic. This is used when responsive behavior requires conditional rendering or state changes, not just visual adjustments.

```typescript
// src/lib/components/ThreePanelLayout.svelte
import { MediaQuery } from 'svelte/reactivity';

const isNarrowScreen = new MediaQuery('max-width: 1024px', false);
const isMobileScreen = new MediaQuery('max-width: 768px', false);
```

The second argument (`false`) is the SSR fallback value -- during server rendering, `MediaQuery` cannot evaluate the viewport, so it returns this default. The reactive `.current` property updates automatically when the viewport crosses the breakpoint threshold.

Use `MediaQuery` when the component needs to conditionally render different DOM structures (e.g., collapsing the right panel entirely on narrow screens). For purely visual responsive adjustments, use Tailwind's responsive prefixes instead:

```html
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
```

The two approaches complement each other: `MediaQuery` controls *what* renders, Tailwind prefixes control *how* it looks.

### Tailwind Animations vs Svelte Transitions

Both Tailwind and Svelte provide animation capabilities, but they serve different purposes. Choosing the wrong one leads to either lost functionality or unnecessary complexity.

| Use Case | Use | Example |
|----------|-----|---------|
| CSS property transitions | Tailwind `transition-*` | `transition-all duration-200` |
| Enter/exit animations | Svelte `transition:` | `transition:fly={{ y: 20 }}` |
| Infinite animations | Tailwind `animate-*` | `animate-spin`, `animate-pulse` |
| Coordinated mount/unmount | Svelte `in:`/`out:` | Different enter vs exit animations |

The deciding factor is whether the animation involves DOM insertion or removal. Tailwind handles steady-state transitions (hover, focus, color changes). Svelte handles mount/unmount transitions because it can delay DOM removal until the exit animation completes -- something CSS alone cannot coordinate.

---

## 10. TypeScript Integration

### Pattern

TypeScript in every component via `<script lang="ts">`. Types are organized by domain in `src/lib/types/`, with interfaces defined locally in components for props and imported from shared modules for domain data.

### Script Setup

Every Svelte component uses the `lang="ts"` attribute on its script tag. Svelte 5 has first-class TypeScript support -- the compiler understands TypeScript syntax natively, including generics, type guards, and `satisfies` expressions.

```svelte
<script lang="ts">
  // TypeScript is mandatory -- never use untyped <script> blocks
</script>
```

### Props Interfaces

Define the props interface locally in the component, then destructure with `$props()`. This keeps the contract visible at the point of use and ensures type inference flows through to parent components.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    children: Snippet;
  }

  let { text, children }: Props = $props();
</script>
```

The `interface Props` pattern is a project convention. Svelte 5 infers the props type from the `$props()` destructuring, but an explicit interface documents the component's contract and enables IDE autocompletion in parent components before the prop values are filled in.

### Type Definitions

Domain types live in `src/lib/types/`, organized by feature area:

| File | Purpose |
|------|---------|
| `chat.ts` | Message, StreamEvent, ChatState, and content union types (TableContent, ChartContent, etc.) |
| `organizational.ts` | OrganizationNode, tree response types, account/department structures |
| `cost.ts` | Cost data types for queries, breakdowns, and time-series data |
| `anomaly.ts` | Anomaly detection result types with severity scoring |
| `recommendations.ts` | Optimization recommendation types from AWS Trusted Advisor |
| `ui.ts` | CarouselSlide, generic UI component types |

Components import from these modules rather than defining domain types inline. The shared modules ensure that types stay consistent across components that display the same data -- a `Message` in `ChatInterface` has the same shape as a `Message` in `MessageRenderer`.

### Generic Components

Svelte 5 supports generic components through the `generics` attribute on the script tag. This makes a component type-safe for any data type the consumer provides, without the component needing to know that type in advance.

```svelte
<script lang="ts" generics="T">
  import type { CarouselSlide } from '$lib/types/ui.js';

  interface Props {
    slides: CarouselSlide<T>[];
    children: Snippet<[CarouselSlide<T>, number, boolean]>;
    onchange?: (event: { index: number; slide: CarouselSlide<T> }) => void;
  }

  let { slides, children, onchange }: Props = $props();
</script>
```

The `generics="T"` attribute declares a type parameter that flows through the entire component -- from the `slides` prop to the `children` snippet arguments to the `onchange` callback. When a parent passes `CarouselSlide<CostSummary>[]`, TypeScript infers `T = CostSummary` and type-checks the snippet's arguments accordingly.

Use generic components when the component operates on data structurally (iterating, selecting, reordering) without needing to know the specific domain type.

### Type Narrowing in Templates

Svelte's `{@const}` directive enables inline type computations within template blocks. This is the primary mechanism for narrowing union types at the point of use, avoiding the need to cast in multiple places.

```svelte
{:else if message.type === 'table'}
  {@const tableData = renderContent(message.content, message.type) as TableContent}
  <div class="overflow-x-auto">
    <table class="min-w-full bg-white border rounded-lg">
      <thead>
        <tr>
          {#each tableData.headers as header}
            <th class="px-4 py-2 text-left text-xs font-medium">{header}</th>
          {/each}
        </tr>
      </thead>
    </table>
  </div>
```

The `{@const}` declaration binds a narrowed variable scoped to that template branch. Combined with a type assertion, it gives the rest of the block full type safety for the specific content variant. This is cleaner than computing narrowed variables in the script block, because the narrowing happens at the exact point where the type is known.

### Union Type Rendering

When a component must render different content types, use an `if/else if` chain with `message.type` as the discriminant. Each branch narrows the content to its specific type and delegates to the appropriate rendering logic.

```svelte
{#if message.type === 'text'}
  <MarkdownRenderer content={message.content} />
{:else if message.type === 'table'}
  {@const tableData = renderContent(message.content, message.type) as TableContent}
  <!-- table rendering -->
{:else if message.type === 'chart'}
  {@const chartData = renderContent(message.content, message.type) as ChartContent}
  <!-- chart rendering -->
{:else if message.type === 'anomalies'}
  {@const anomalyData = message.content as AnomalyContent}
  <AnomalyCard data={anomalyData} />
{:else}
  <p class="text-sm">{String(message.content)}</p>
{/if}
```

This pattern from `MessageRenderer.svelte` handles 9 distinct content types (text, table, chart, code, progress, suggestion, cost-data, anomalies, error) plus a system message fallback. Each branch owns its rendering -- there is no shared template that tries to accommodate all types with conditionals. The discriminated union in TypeScript (`Message['type']`) guarantees exhaustiveness: adding a new type without a rendering branch produces a type error if the `else` clause does not handle it.

---

## 11. UI Component Library

### Pattern

Reusable components follow consistent patterns: TypeScript props interface, snippet composition, Tailwind styling, accessibility attributes. Each component is self-contained with no external CSS dependencies. The only exceptions are pseudo-element styles (arrows, shine effects, scrollbar hiding) that Tailwind cannot express -- these live in scoped `<style>` blocks within the component.

### Component Catalog

#### Carousel

Auto-playing slide carousel with IntersectionObserver-based active slide tracking, keyboard navigation, and pause-on-hover. The component uses `$bindable` for two-way index synchronization with the parent, and generic `T` for type-safe slide data.

The observer setup runs as an `$effect` that watches all slide elements and reports which one is more than 50% visible:

```svelte
<!-- src/lib/components/ui/Carousel.svelte -->
$effect(() => {
    if (!trackRef) return;

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
                    const index = slideRefs.indexOf(entry.target as HTMLDivElement);
                    if (index !== -1 && index !== activeIndex) {
                        activeIndex = index;
                        onchange?.({ index, slide: slides[index] });
                    }
                }
            }
        },
        { root: trackRef, threshold: 0.5 }
    );

    for (const slide of slideRefs) {
        if (slide) observer.observe(slide);
    }

    return () => observer.disconnect();
});
```

Auto-play is a separate `$effect` that cleans up its interval on teardown. It stops permanently once the user interacts (scroll, click, keyboard), preventing the carousel from fighting user intent:

```svelte
$effect(() => {
    if (!autoPlay || isPaused || userInteracted) return;

    const interval = setInterval(() => {
        const nextIndex = (activeIndex + 1) % slides.length;
        goToSlide(nextIndex);
    }, autoPlayInterval);

    return () => clearInterval(interval);
});
```

The `activeIndex` prop uses `$bindable(0)`, allowing parents to either read the current index reactively or set it programmatically -- the observer and the parent stay in sync without manual event wiring.

#### Tooltip

Wraps any content via `children: Snippet` and shows a tooltip after a 1-second hover delay. The delay prevents tooltips from flashing during casual mouse movement.

The delayed show pattern uses `setTimeout` with cleanup in both the mouse-leave handler and the `$effect` teardown to prevent orphaned timeouts:

```svelte
<!-- src/lib/components/Tooltip.svelte -->
let showTooltip = $state(false);
let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

function handleMouseEnter() {
    hoverTimeout = setTimeout(() => {
        showTooltip = true;
    }, 1000);
}

function handleMouseLeave() {
    if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
    }
    showTooltip = false;
}

$effect(() => {
    return () => {
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
    };
});
```

The double-cleanup pattern (both in `handleMouseLeave` and in the `$effect` return) is intentional: the mouse-leave handler covers the common case, while the effect teardown covers component unmounting during an active timeout.

#### Shimmer / Loading

The `@shimmer-from-structure/svelte` library provides skeleton loading states that match the actual component structure. Two patterns work together: a global theme configuration in the root layout, and per-component shimmer derivation.

Global configuration sets brand-consistent shimmer colors once, in `+layout.svelte`:

```svelte
<!-- src/routes/+layout.svelte -->
import { setShimmerConfig } from '@shimmer-from-structure/svelte';

setShimmerConfig({
    shimmerColor: 'rgba(22, 108, 150, 0.15)',
    backgroundColor: 'rgba(229, 231, 235, 0.8)',
    duration: 1.8,
    fallbackBorderRadius: 8,
});
```

Individual components derive a `showShimmer` flag that gates the skeleton. The derivation prevents shimmer from appearing when stale data is available -- it only shows on the true first load:

```svelte
<!-- src/lib/components/charts/StackedAreaChart.svelte -->
const showShimmer = $derived(isLoading && !data);
```

The `<Shimmer>` wrapper receives `templateProps` with mock data shaped like the real props, so the skeleton matches the eventual layout dimensions.

#### Accordion (CategoryCard)

Controlled vs uncontrolled expansion state for collapsible sections. When a parent provides `isExpanded` and `onToggle`, the component delegates state management upward (controlled mode). When those props are omitted, it manages its own `internalExpanded` state (uncontrolled mode). The pattern is covered in detail in Section 4, Controlled vs Uncontrolled State. The key derivation:

```svelte
let expanded = $derived(controlledExpanded !== undefined ? controlledExpanded : internalExpanded);
```

Source: `src/lib/components/cost/CategoryCard.svelte`.

#### Error Boundary

Svelte 5's `<svelte:boundary>` with a `failed` snippet for recovery UI. Covered in Section 8, Error Handling -- the `ErrorBoundary` component wraps `children` and renders a recovery dialog with "Try again" (calls `reset()`) and "Reload page" (calls `window.location.reload()`) buttons.

Source: `src/lib/components/ErrorBoundary.svelte`.

#### Streaming Progress

Node execution timeline showing classify, extract, route, fetch, reason, tools, and respond stages with real-time status indicators and active tool tracking. Covered in Section 7, Data Streaming -- the component maps graph node IDs to display labels and tracks completion, active, and pending states.

Source: `src/lib/components/chat/StreamingProgress.svelte`.

#### Panel Resizer

Draggable divider with keyboard support (Arrow keys resize, Enter/Space toggles collapse) and visual feedback. Covered in Section 8, Three-Panel Layout -- the component attaches document-level `mousemove`/`mouseup` listeners during drag and cleans them up on release.

Source: `src/lib/components/PanelResizer.svelte`.

#### Icon

SVG icon system using a `Record<string, string>` of path data with `{@html}` rendering. No external icon library -- all icons are inlined as SVG path strings, enabling tree-shaking by omission (unused icons are never defined).

The component stores SVG path fragments keyed by name, derives the content reactively, and renders it inside a single `<svg>` element:

```svelte
<!-- src/lib/components/Icon.svelte -->
const icons: Record<string, string> = {
    'trending-up': '<polyline points="22,7 13.5,15.5 8.5,10.5 2,17"/><polyline points="16,7 22,7 22,13"/>',
    'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>...',
    // 40+ icons
};

const svgContent = $derived(icons[name] || '');
```

```svelte
<svg width={size} height={size} viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" class={className}>
    {@html svgContent}
</svg>
```

The `{@html}` directive bypasses Svelte's HTML escaping. This is safe here because the SVG paths are hardcoded string literals -- never user input. The `stroke="currentColor"` attribute means icon color inherits from the parent's `color` or Tailwind `text-*` class.

#### Badges

Inline status indicators using Tailwind background and text color utilities. Badges communicate data freshness (partial vs complete months) and contextual state throughout the dashboard.

```svelte
<!-- src/routes/+page.svelte -->
{#if monthMetadata?.currentMonthIsPartial}
    <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
        Partial - {monthMetadata.currentMonthDaysElapsed} days
    </span>
{:else}
    <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
        Complete
    </span>
{/if}
```

The semantic color convention: `bg-orange-100 text-orange-800` for warnings or partial data, `bg-green-100 text-green-800` for confirmed or complete data. Badges are not extracted into a shared component because they carry domain-specific labels -- the Tailwind classes are the reusable pattern.

#### Progress Bars

Percentage-width bars with smooth transitions for visualizing time-based progress (month progress, loading states). The width is driven by a data-bound `style` attribute with a CSS transition for animation.

```svelte
<!-- src/routes/+page.svelte -->
<div class="w-full bg-tommy-offwhite rounded-full h-1.5">
    <div
        class="bg-tommy-navy h-1.5 rounded-full transition-all duration-500"
        style="width: {monthMetadata.currentMonthProgress}%"
    ></div>
</div>
```

The outer `div` provides the track (full width, muted background, rounded). The inner `div` fills proportionally via `style="width: {percentage}%"`. The `transition-all duration-500` class animates width changes when the percentage updates reactively.

### Building New Components

Checklist for creating reusable UI components in this codebase:

1. Define an `interface Props` with all inputs typed -- use `?` for optional props with defaults
2. Use `$props()` for destructuring with defaults in the declaration
3. Use `children: Snippet` for composition (not slots -- slots are Svelte 4)
4. Use callback props (`onclick`, `onchange`) for events (not `createEventDispatcher` -- that is Svelte 4)
5. Style with Tailwind utility classes only -- reserve `<style>` blocks for pseudo-elements and scrollbar hiding
6. Add `aria-*` attributes (`aria-label`, `aria-expanded`, `aria-selected`) and keyboard handlers (`onkeydown`) for interactive elements
7. Support both controlled and uncontrolled modes for toggle state when the component may be used standalone or orchestrated by a parent
8. Clean up timers, observers, and event listeners in `$effect` return functions to prevent memory leaks on unmount

---

## 12. Chart & Visualization

### Pattern

ECharts 6 with tree-shaking, reactive updates via `$effect`, and external HTML legend for responsive behavior. Charts use `onMount`/`onDestroy` for lifecycle and `ResizeObserver` for responsive sizing. Every chart pairs with a data table component for accessibility.

### ECharts Setup (Tree-Shaking)

ECharts supports modular imports where you register only the chart types, components, and renderers your application needs. This prevents the full 800 KB ECharts bundle from landing in your build -- you pay only for what you use.

```svelte
<!-- src/lib/components/charts/StackedAreaChart.svelte -->
<script lang="ts">
    import * as echarts from 'echarts/core';
    import { BarChart } from 'echarts/charts';
    import {
        GridComponent,
        TooltipComponent,
        LegendComponent,
        DataZoomComponent,
        TitleComponent,
    } from 'echarts/components';
    import { CanvasRenderer } from 'echarts/renderers';
    import type { EChartsCoreOption } from 'echarts/core';
    import type { BarSeriesOption } from 'echarts/charts';

    echarts.use([
        BarChart,
        GridComponent,
        TooltipComponent,
        LegendComponent,
        DataZoomComponent,
        TitleComponent,
        CanvasRenderer,
    ]);
</script>
```

Import from `echarts/core` instead of `echarts`, then pull individual chart types (`BarChart`, `LineChart`) from `echarts/charts`, layout and interaction components from `echarts/components`, and a renderer (`CanvasRenderer` for performance, `SVGRenderer` for crisp scaling). The `echarts.use()` call registers everything once at module scope -- it runs at import time, before any component mounts.

### Chart Component Lifecycle

Chart instances require explicit lifecycle management. The DOM container must exist before `echarts.init()`, and the instance must be disposed when the component unmounts to prevent memory leaks. Reactive data updates happen through `$effect`, which re-runs whenever the data prop changes.

```svelte
<!-- src/lib/components/charts/StackedAreaChart.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';

    let chartContainer: HTMLDivElement;
    let chart: echarts.ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function initChart() {
        if (!chartContainer) return;

        if (chart) {
            chart.dispose();
        }

        chart = echarts.init(chartContainer);

        if (data) {
            chart.setOption(buildChartOptions(data));
        }
    }

    function handleResize() {
        if (chart) {
            chart.resize();
        }
    }

    onMount(() => {
        initChart();

        resizeObserver = new ResizeObserver(() => {
            handleResize();
        });

        if (chartContainer) {
            resizeObserver.observe(chartContainer);
        }

        window.addEventListener('resize', handleResize);
    });

    onDestroy(() => {
        if (resizeObserver) {
            resizeObserver.disconnect();
        }
        window.removeEventListener('resize', handleResize);
        if (chart) {
            chart.dispose();
            chart = null;
        }
    });

    $effect(() => {
        if (chart && data) {
            chart.setOption(buildChartOptions(data), { notMerge: true });
        }
    });
</script>
```

Three phases:

1. **`onMount`**: Initialize the chart instance, attach a `ResizeObserver` on the container element, and add a window resize listener. The observer handles container-level size changes (panel resizing, layout shifts), while the window listener catches viewport changes.
2. **`$effect`**: Reactive option updates when the `data` prop changes. The `{ notMerge: true }` option tells ECharts to replace the entire configuration rather than deep-merging -- this prevents stale series from lingering when the data shape changes (different number of services, different date ranges).
3. **`onDestroy`**: Disconnect the observer, remove the window listener, and call `chart.dispose()` to free the canvas context and all internal ECharts state. Setting `chart = null` ensures no stale references survive.

### External Legend Pattern

ECharts' built-in legend component does not respond well to container resizing -- it clips, wraps unpredictably, and cannot be styled with Tailwind. The solution is to disable the internal legend (`legend: { show: false }`) and render an external HTML legend as Tailwind-styled buttons that dispatch toggle actions to the chart instance.

```svelte
<!-- src/lib/components/charts/StackedAreaChart.svelte -->
{#if showLegend && sortedServices().length > 0}
    <div class="flex flex-wrap gap-2 pt-3 justify-start">
        {#each sortedServices() as service}
            <button
                type="button"
                class="inline-flex items-center gap-[3px] py-0.5 px-1.5 text-[0.5625rem]
                       font-medium rounded-full border border-tommy-offwhite bg-white
                       text-tommy-slate transition-all cursor-pointer shadow-sm
                       {hiddenSeries.has(service) ? 'opacity-40 bg-gray-100' : ''}"
                onclick={() => toggleSeries(service)}
            >
                <span
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    style="background-color: {getColorForService(service)};"
                ></span>
                <span class="whitespace-nowrap">{service}</span>
            </button>
        {/each}
    </div>
{/if}
```

The toggle function dispatches a `legendToggleSelect` action to ECharts and tracks hidden state in a `Set<string>` for styling the dimmed button appearance:

```svelte
let hiddenSeries: Set<string> = $state(new Set());

function toggleSeries(serviceName: string) {
    if (!chart) return;

    if (hiddenSeries.has(serviceName)) {
        hiddenSeries.delete(serviceName);
    } else {
        hiddenSeries.add(serviceName);
    }
    hiddenSeries = new Set(hiddenSeries);

    chart.dispatchAction({
        type: 'legendToggleSelect',
        name: serviceName,
    });
}
```

The `hiddenSeries = new Set(hiddenSeries)` reassignment is necessary because Svelte 5's `$state` tracks identity, not mutations -- `Set.add()` and `Set.delete()` mutate in place without triggering reactivity. The reassignment creates a new reference that Svelte detects as a change.

### Chart Color Theming

All charts pull from a centralized color palette defined in `src/lib/theme/chart-colors.ts`. This prevents color inconsistency across chart and data table components, and ensures brand alignment.

```ts
// src/lib/theme/chart-colors.ts
export const tommyColors = {
    navy: '#02154E',
    darkNavy: '#1B2651',
    red: '#D61233',
    redUi: '#CD2028',
    offWhite: '#EDEAE1',
    accentBlue: '#166C96',
} as const;

export const chartSeriesPalette = [
    tommyColors.navy,       // primary brand
    '#16a34a',              // green-600 (semantic: savings)
    tommyColors.red,        // brand accent
    tommyColors.accentBlue, // secondary brand
    '#ea580c',              // orange-600
    tommyColors.darkNavy,   // brand variation
    '#9333ea',              // purple-600
    '#0891b2',              // cyan-600
    '#db2777',              // pink-600
    '#65a30d',              // lime-600
    '#0d9488',              // teal-600
    '#f59e0b',              // amber-500
] as const;

export const chartChrome = {
    text: tommyColors.darkNavy,
    axisLine: '#e5e7eb',
    gridLine: '#f3f4f6',
    tooltipBg: tommyColors.darkNavy,
    dataZoomHandle: tommyColors.navy,
    dataZoomBorder: '#e5e7eb',
    dataZoomFiller: 'rgba(2, 21, 78, 0.1)',
} as const;

export const semanticColors = {
    savings: '#16a34a',
    costIncrease: '#dc2626',
    warning: '#ca8a04',
    info: '#9333ea',
} as const;
```

Three exports serve distinct purposes: `chartSeriesPalette` provides the 12-color rotation for data series (charts with more than 12 series wrap around), `chartChrome` provides non-data UI elements (axis lines, grid, tooltip backgrounds), and `semanticColors` provides meaning-bearing colors that should never be swapped for brand colors (green always means savings, red always means cost increase).

Components consume the palette by index:

```ts
function getColorForService(serviceName: string): string {
    const services = sortedServices();
    const index = services.indexOf(serviceName);
    return chartSeriesPalette[index % chartSeriesPalette.length];
}
```

Both `StackedAreaChart` and `CostDataTable` use the same palette and the same index-to-color mapping, so a service's color dot in the legend matches its color dot in the table row.

### Shimmer Integration

Chart components derive a `showShimmer` flag that gates skeleton loading. The derivation ensures shimmer only appears on the true first load -- when there is no data at all. If stale data exists from a previous fetch, the chart continues to display it while the new data loads, avoiding a jarring skeleton flash on every navigation.

```svelte
const showShimmer = $derived(isLoading && !data);

<Shimmer loading={showShimmer}>
    <div bind:this={chartContainer} style="height: {computedChartHeight()}; width: 100%;"></div>
</Shimmer>
```

This pattern is shared by both `StackedAreaChart` and `CostDataTable`. See Section 11, Shimmer / Loading for the global theme configuration and the `$derived` pattern in detail.

### Data Table Companion

`CostDataTable.svelte` renders the same cost data as a sortable, searchable HTML table with per-column totals and period-over-period change percentages. It serves as an accessibility companion to the chart -- screen readers and keyboard users get full access to the data that the canvas-rendered chart cannot provide.

The table shares `chartSeriesPalette` with the chart component so that color indicator dots on each service row match the chart series colors. It supports sorting by any column (service name, date period, total, change percentage), text filtering via a search input, and progressive disclosure (shows 10 rows initially, with a "Show N more" toggle).

Source: `src/lib/components/charts/CostDataTable.svelte`.

### Key Points

1. **Tree-shake ECharts** -- import from `echarts/core` and register only the chart types, components, and renderers you need
2. **Lifecycle separation** -- `onMount`/`onDestroy` for chart instance creation and cleanup, `$effect` for reactive data updates with `{ notMerge: true }`
3. **External HTML legend** -- disable ECharts' built-in legend and render Tailwind-styled buttons that call `chart.dispatchAction({ type: 'legendToggleSelect' })`
4. **Centralized color palette** -- `chart-colors.ts` prevents inconsistency across charts and data tables, with separate exports for series colors, chrome colors, and semantic colors
5. **Always pair charts with data tables** -- canvas-rendered charts are invisible to screen readers, so a tabular representation of the same data is required for accessibility

---

## 13. Svelte MCP Workflow

### Pattern

Use the Svelte MCP server for documentation lookup and code validation during development. The workflow follows a three-step cycle: discover what documentation is available, fetch the sections relevant to the task, then validate the resulting code with the autofixer until it passes clean. This keeps component code aligned with official Svelte 5 patterns and catches runes migration issues before they reach the browser.

### Reference Implementation

**Development cycle:**

**Step 1 -- Discover documentation:**

```
mcp__svelte__list-sections
```

Returns all available Svelte 5 and SvelteKit documentation sections with descriptions of what each covers. Use this when starting a new component or exploring unfamiliar APIs to find the right section name before fetching.

**Step 2 -- Fetch relevant documentation:**

```
mcp__svelte__get-documentation section="$state"
```

Retrieves full documentation for a specific section. Accepts a single section name or an array of section names. Fetch multiple sections when a component touches several APIs -- for example, a form component might need both `$state` and `$bindable`.

**Step 3 -- Validate with autofixer:**

```
mcp__svelte__svelte-autofixer code="<component code>" desired_svelte_version=5
```

Pass the full component source as a string. Returns a list of suggestions to fix Svelte 5 compatibility issues, deprecated patterns, and common mistakes. Repeat until the autofixer returns no suggestions -- this confirms the component follows current Svelte 5 idioms.

**When to use this workflow:**

- Creating new Svelte components -- discover relevant runes and patterns before writing code
- Updating existing components to Svelte 5 patterns -- the autofixer catches Svelte 4 holdovers (e.g., `export let` instead of `$props()`, reactive declarations instead of `$derived`)
- Debugging Svelte-specific issues -- fetch the relevant documentation section to confirm correct API usage
- Learning new Svelte 5 features -- `list-sections` provides a navigable index of everything available

**Playground links (optional):**

```
mcp__svelte__playground-link name="Demo" files={...} tailwind=true
```

Generates a shareable Svelte REPL link with the provided files and optional Tailwind support. Use this for standalone examples, prototypes, and bug reproductions only -- never for project source files.

**Key Svelte 5 patterns (quick reference):**

| Rune | Purpose | Replaces (Svelte 4) |
|------|---------|---------------------|
| `$state` | Reactive state declaration | `let x = value` (top-level) |
| `$derived` | Computed values | `$: x = expression` |
| `$effect` | Side effects | `$: { statements }` |
| `$props` | Component props | `export let prop` |
| `$bindable` | Two-way binding props | `export let prop` with `bind:` |

**Component structure (Svelte 5 idiom):**

```svelte
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);

  $effect(() => {
    console.log('Count changed:', count);
  });
</script>

<button onclick={() => count++}>
  {count} (doubled: {doubled})
</button>
```

### Key Points

1. **Three-step cycle** -- discover, fetch, validate. The autofixer is the gate: code is not done until it returns clean
2. **Fetch before writing** -- checking documentation before implementation prevents runes misuse and catches API changes between Svelte versions
3. **Playground is for sharing, not development** -- use playground links for standalone reproductions and demos, never as a substitute for the project's dev server
4. **Autofixer catches migration debt** -- running existing Svelte 4 components through the autofixer with `desired_svelte_version=5` identifies all patterns that need updating

---

## 14. Testing & Quality

### Pattern

Type checking, linting, and visual validation ensure frontend quality through three complementary tools. `svelte-check` catches Svelte-specific diagnostics (accessibility warnings, unused props, type errors in template expressions). Biome enforces consistent code style and import hygiene across the monorepo. Chrome DevTools MCP provides snapshot-based visual validation during development, confirming layout and styling without manual browser inspection.

### Reference Implementation

**svelte-check -- type checking and Svelte diagnostics:**

```bash
# Generate types from routes first
svelte-kit sync

# Then run checks
svelte-check --tsconfig ./tsconfig.json
```

`svelte-kit sync` must run before `svelte-check` because it generates TypeScript types from SvelteKit's file-based routing -- load function return types, page parameter types, and form action types. Without this step, `svelte-check` reports false positives for any component that consumes route data. The `check` script in `packages/frontend/package.json` chains both commands:

```json
"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
```

`svelte-check` validates both TypeScript types and Svelte-specific issues: accessibility violations (missing `alt` attributes, non-interactive elements with click handlers), unused component props, invalid template syntax, and type mismatches in `{#each}` blocks and event handlers. It runs against the same `tsconfig.json` used by the IDE, so there is no divergence between editor squiggles and CI failures.

**Biome integration:**

A shared `biome.json` at the repository root governs all packages. Three rules are particularly relevant to frontend development:

| Rule | Level | Effect |
|------|-------|--------|
| `useImportType` | error | Forces `import type { ... }` for type-only imports -- reduces bundle size by ensuring types are erased at compile time |
| `useNodejsImportProtocol` | error | Forces `import { join } from "node:path"` -- makes Node.js built-in imports explicit and unambiguous |
| `useExportType` | error | Forces `export type { ... }` for type-only exports -- same erasure benefit as `useImportType` |

Biome replaces ESLint and Prettier with a single tool. It handles both linting (code quality rules) and formatting (whitespace, semicolons, quotes) in one pass, which is significantly faster than running two separate tools. The `biome:check:write` script auto-fixes both categories:

```bash
# Auto-fix lint and format issues in one pass
bun run biome:check:write
```

**Chrome DevTools MCP -- visual validation:**

After making UI changes, take a screenshot through Chrome DevTools MCP to verify layout and styling without manually inspecting the browser. This is especially useful for:

- Verifying responsive behavior at different viewport sizes
- Confirming Tailwind utility classes produce the expected visual result
- Catching layout regressions (overflow, misalignment, z-index issues)
- Validating chart rendering and color palette consistency

**Quality scripts:**

All quality scripts are defined in the root `package.json` and operate across the monorepo:

| Script | Command | Purpose |
|--------|---------|---------|
| `bun run check` | `svelte-kit sync && svelte-check` | Svelte type checking with route type generation (frontend only) |
| `bun run typecheck` | `bun run --recursive typecheck` | Type check all packages (frontend + backend) |
| `bun run biome:check:write` | `biome check --write .` | Auto-fix lint and format issues across the monorepo |
| `bun run quality:check` | `biome check && typecheck` | Full quality gate -- lint, format, and type check combined |
| `bun run quality:fix` | `biome check --write && typecheck` | Auto-fix what can be fixed, then type check the result |

The `quality:check` script is the recommended pre-commit gate. It runs Biome first (fast, catches style issues) and then type checking (slower, catches logic errors). If Biome fails, type checking still runs so you see all issues in one pass.

### Key Points

1. **Always run `svelte-kit sync` before `svelte-check`** -- without generated route types, the checker produces false positives for load function data
2. **Biome replaces ESLint + Prettier** -- one tool, one config, one pass. Use `biome:check:write` for auto-fixing, `biome:ci` for CI (exits non-zero on any issue)
3. **`useImportType` is not optional** -- type-only imports that are not marked with `import type` cause runtime import side effects and can break tree-shaking
4. **Visual validation catches what type checkers cannot** -- a component can be type-safe and lint-clean but still render incorrectly. Chrome DevTools MCP screenshots close this gap
5. **`quality:check` is the full gate** -- run it before pushing to catch both style and type issues in one command
