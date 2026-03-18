# Bun Profiling Guide

Standalone guide to CPU and heap profiling for any Bun HTTP server application. Drop this file into your project and start profiling.

## Quick Start

```bash
# CPU profile (markdown format, grep/LLM-friendly)
bun --cpu-prof-md --cpu-prof-dir ./profiles src/index.ts

# Heap profile (markdown format)
bun --heap-prof-md --heap-prof-dir ./profiles src/index.ts

# Both CPU + heap
bun --cpu-prof --cpu-prof-md --heap-prof-md --cpu-prof-dir ./profiles --heap-prof-dir ./profiles src/index.ts
```

Profiles are written on process exit. Send `SIGTERM` to stop the server and capture the profile. **Never use `SIGKILL` (`kill -9`)** -- it terminates immediately without writing profiles.

```bash
# Start server with profiling
bun --cpu-prof-md --heap-prof-md --cpu-prof-dir ./profiles --heap-prof-dir ./profiles src/index.ts &
SERVER_PID=$!

# Generate load (see Load Testing section)
bombardier -c 50 -d 60s http://localhost:3000/health

# Stop server gracefully -- profiles are written on exit
kill -SIGTERM $SERVER_PID
```

---

## Profile Types

### CPU Profile

Shows which functions consume the most CPU time during the profiling window.

| Format | Flag | Output | Best For |
|--------|------|--------|----------|
| Chrome DevTools | `--cpu-prof` | `.cpuprofile` | Visual flame chart analysis |
| Markdown | `--cpu-prof-md` | `.md` | Grep, diff, LLM analysis, code review |

**When to use**: Identifying computational bottlenecks, optimizing hot paths, finding unexpected CPU consumers.

**Key sections in markdown output**:
- `Duration` / `Samples` -- how long the profile ran and how many samples were collected
- `Hot Functions (Self Time)` -- functions ranked by CPU time spent in the function itself (not callees)
- `Self%` vs `Total%` -- self time is the function's own work; total includes callees

### Heap Profile

Shows memory allocation patterns at the moment the profile is captured (process exit).

| Format | Flag | Output | Best For |
|--------|------|--------|----------|
| Chrome DevTools | `--heap-prof` | `.heapsnapshot` | Interactive object inspection |
| Markdown | `--heap-prof-md` | `.md` | Grep, diff, LLM analysis, comparison |

**When to use**: Investigating memory leaks, assessing dependency update impact, understanding memory footprint.

**Key sections in markdown output**:
- `Summary` -- total heap size, object count, edge count, GC roots
- `Top 50 Types by Retained Size` -- which object types hold the most memory
- `Top 50 Largest Objects` -- individual objects retaining the most memory
- `Retainer Chains` -- path from GC root to object (why something is kept alive)

### Understanding Self Size vs Retained Size

- **Self size**: Memory used by the object itself (its fields, not what it references)
- **Retained size**: Memory that would be freed if this object were garbage collected (includes everything it keeps alive)

A 32-byte `string` object with 156 KB retained size means the string header is 32 bytes, but it references a 156 KB character buffer.

---

## Profiling Flags Reference

| Flag | Description |
|------|-------------|
| `--cpu-prof` | Generate `.cpuprofile` (Chrome DevTools format) |
| `--cpu-prof-md` | Generate markdown CPU profile |
| `--cpu-prof-name <file>` | Custom CPU profile filename |
| `--cpu-prof-dir <dir>` | CPU profile output directory |
| `--heap-prof` | Generate `.heapsnapshot` on exit |
| `--heap-prof-md` | Generate markdown heap profile on exit |
| `--heap-prof-name <file>` | Custom heap profile filename |
| `--heap-prof-dir <dir>` | Heap profile output directory |

All flags can be combined. Profiles are written when the process exits.

---

## Package.json Scripts

Add these scripts to your `package.json`. Adjust `src/index.ts` to match your entry point.

```json
{
  "scripts": {
    "profile:cpu": "bun --cpu-prof --cpu-prof-dir ./profiles src/index.ts",
    "profile:cpu:md": "bun --cpu-prof-md --cpu-prof-dir ./profiles src/index.ts",
    "profile:cpu:both": "bun --cpu-prof --cpu-prof-md --cpu-prof-dir ./profiles src/index.ts",
    "profile:heap": "bun --heap-prof --heap-prof-dir ./profiles src/index.ts",
    "profile:heap:md": "bun --heap-prof-md --heap-prof-dir ./profiles src/index.ts",
    "profile:full": "bun --cpu-prof --cpu-prof-md --heap-prof-md --cpu-prof-dir ./profiles --heap-prof-dir ./profiles src/index.ts"
  }
}
```

### Directory Setup

```bash
mkdir -p profiles/archive profiles/baselines
```

### .gitignore

Add to your `.gitignore`:
```
profiles/*.cpuprofile
profiles/*.heapsnapshot
profiles/heap-safari-*.json
```

Markdown profiles (`*.md`) are intentionally not ignored -- they are useful to commit as baselines for comparison.

---

## Profiling a Running Server

### Basic Workflow

```bash
# 1. Start server with profiling enabled
bun --cpu-prof-md --heap-prof-md \
  --cpu-prof-dir ./profiles --heap-prof-dir ./profiles \
  src/index.ts &
SERVER_PID=$!

# 2. Wait for server to be ready
sleep 2
curl -s http://localhost:3000/health > /dev/null

# 3. Generate load (choose one)
bombardier -c 50 -d 120s http://localhost:3000/your-endpoint
# or: oha -c 50 -n 10000 http://localhost:3000/your-endpoint
# or: k6 run your-test.js

# 4. Stop server gracefully to capture profiles
kill -SIGTERM $SERVER_PID
wait $SERVER_PID

# 5. Review profiles
ls -lh profiles/
```

### Duration Guidelines

| Goal | Minimum Duration | Notes |
|------|-----------------|-------|
| Quick sanity check | 30 seconds | Enough for hot function identification |
| Optimization cycle | 2-5 minutes | Good balance of data vs turnaround |
| Memory leak detection | 1+ hours | Need time for leaks to manifest |
| Dependency comparison | 3+ hours under load | Ensures heap has stabilized |
| Soak test | 6+ hours | Full stabilization, catches slow leaks |

---

## Reading Heap Profiles

### Summary Section

```markdown
| Metric | Value |
|--------|------:|
| Total Heap Size | 17.5 MB (18366656 bytes) |
| Total Objects | 231492 |
| Total Edges | 911734 |
| Unique Types | 408 |
| GC Roots | 3055 |
```

- **Total Heap Size**: Current JavaScript heap usage. For a typical Bun HTTP server, 15-50 MB is normal at steady state.
- **Total Objects**: Number of live JS objects. Higher counts from more dependencies.
- **GC Roots**: Entry points the garbage collector uses. Stable count across runs indicates no root leaks.

### Top Types Table

```markdown
| Rank | Type | Count | Self Size | Retained Size | Largest Instance |
|-----:|------|------:|----------:|--------------:|-----------------:|
| 1 | `Structure` | 15043 | 1.6 MB | 16.6 MB | 127.7 KB |
| 2 | `Function` | 87060 | 2.7 MB | 5.4 MB | 37.7 KB |
| 3 | `JSLexicalEnvironment` | 25087 | 1.2 MB | 3.3 MB | 121.9 KB |
```

**Common Bun/JSC types and what they mean:**

| Type | What It Is | Typical Behavior |
|------|-----------|-----------------|
| `Structure` | JSC internal metadata for object shapes | Scales with unique object shapes. Large count is normal for module-heavy apps. |
| `Function` | JavaScript function objects | Loaded at startup from all modules. Count should be stable after init. |
| `JSLexicalEnvironment` | Closure scopes | One per closure. Count correlates with `Function` count. |
| `FunctionCodeBlock` | Compiled bytecode for functions | Managed by JIT. Count may decrease over time as unused code is reclaimed. |
| `FunctionExecutable` | Function metadata (name, source location) | One per unique function definition. |
| `GetterSetter` | Property accessor pairs | From `Object.defineProperty()` / class getters. |
| `JSModuleEnvironment` | Module-level scope | One per imported module. Count equals number of modules loaded. |
| `ModuleRecord` | Module metadata (imports, exports) | Static after startup. |
| `string` | JavaScript string objects | Count and retained size can fluctuate as JSC caches/evicts source text. |
| `UnlinkedFunctionExecutable` | Pre-linked function metadata | Internal to JSC module loading. |
| `Cell Butterfly` | Backing storage for object properties/array elements | Named after JSC's internal "butterfly" data structure. |

### Retainer Chains

```
FunctionCodeBlock#232260 [ROOT] (6.5 KB)
    Object#5808 (160 B) .module ->
        ModuleRecord#5810 (25.6 KB) ->
            JSModuleEnvironment#5944 (608 B)
```

Read bottom-up: `JSModuleEnvironment#5944` is kept alive because `ModuleRecord#5810` references it, which is referenced by `Object#5808`, which is referenced by `FunctionCodeBlock#232260` (a GC root).

**What to look for**:
- Chains ending at `[ROOT]` are normal -- these are live references
- `(no path to GC root found)` means the object is eligible for collection but hasn't been collected yet
- Long chains through `Promise -> PromiseReaction -> Function` may indicate async operations holding references

---

## Comparing Heap Profiles

### Before You Compare: Check Duration

The CPU profile markdown header contains the profiling duration:

```markdown
| Duration | Samples | Interval | Functions |
|----------|---------|----------|----------|
| 11066.04s | 92780 | 1.0ms | 3258 |
```

**Both profiles must have comparable durations under similar load.** A 1-hour profile vs a 6-hour profile is not a valid comparison -- the longer run has more time to accumulate objects, grow caches, and exercise code paths.

If durations don't match, take a third profile at a matching duration.

### Comparison Steps

1. **Record durations** from both CPU profile headers
2. **Compare summary metrics**:

| Metric | Before (Xh) | After (Xh) | Delta |
|--------|------------:|------------:|-------|
| Total Heap | | | |
| Total Objects | | | |
| Total Edges | | | |
| GC Roots | | | |

3. **Build type-level comparison**:

| Type | Before Count | Before Retained | After Count | After Retained | Change |
|------|------------:|----------------:|------------:|---------------:|--------|
| `Function` | | | | | |
| `JSLexicalEnvironment` | | | | | |
| `GetterSetter` | | | | | |
| `string` | | | | | |
| `Object` | | | | | |
| (your app types) | | | | | |

4. **Verify static allocations** -- types that load at startup should be identical:

| Type | Before | After | Match? |
|------|-------:|------:|--------|
| `ModuleRecord` | | | |
| `JSModuleEnvironment` | | | |
| (framework singletons) | | | |

If static allocations differ, the comparison may not be valid (different code versions, different startup conditions).

5. **Analyze changes** using the patterns below

### What Changes Mean

| Observation | Likely Cause | Action |
|------------|-------------|--------|
| Object count down, retained size down | Genuine improvement (fewer allocations) | Document the win |
| Object count same, retained size changed | GC retained-size accounting shift | Not a real change -- verify total heap is stable |
| `Function` count changed | Different modules loaded | Check if dependency added/removed modules |
| `GetterSetter` count changed significantly | Dependency changed property definition patterns | Normal for major dependency updates |
| `string` retained size fluctuates | JSC lazily caches/evicts source text | Normal -- check string *count* instead |
| `FunctionCodeBlock` count decreased in longer run | JIT compiler reclaiming unused bytecode | Healthy behavior |
| Growing object count over time (same code) | Potential memory leak | Investigate retainer chains |

### Comparison Template

Copy this template for documenting comparisons:

```markdown
## Heap Comparison: [Context]

**Date**: YYYY-MM-DD
**Reason**: [dependency update / optimization / leak investigation]

### Profiles

| Profile | File | Duration |
|---------|------|----------|
| Before | `Heap.XXXX.md` | Xh (XXXXs) |
| After | `Heap.XXXX.md` | Xh (XXXXs) |

### Summary

| Metric | Before (Xh) | After (Xh) | Delta |
|--------|------------:|------------:|-------|
| Total Heap | | | |
| Total Objects | | | |

### Type-Level Changes

| Type | Before | After | Change |
|------|-------:|------:|--------|
| | | | |

### Static Allocation Sanity Check

| Type | Before | After |
|------|-------:|------:|
| `ModuleRecord` | | |

### Findings

1. ...
2. ...

### Verdict

[Summary: improvement / regression / neutral / leak detected]
```

---

## Memory Leak Detection

### Red Flags (Likely Leak)

- **Object count grows with each profile** taken at increasing durations under the same load
- **GC root count grows** over time -- something is registering new roots
- **Retainer chains show request-scoped data held by long-lived objects** (e.g., request bodies retained by a global cache with no eviction)
- **`Promise` or `PromiseReaction` count grows** -- unresolved promises accumulating
- **`Map` or `Set` with growing retained size** -- unbounded collection without cleanup

### Normal Patterns (Not a Leak)

- **`string` retained size varies** between profiles -- JSC caches source text lazily
- **`FunctionCodeBlock` count decreases** in longer runs -- JIT reclamation
- **`Structure` count is high** (10K+) -- normal for apps with many dependencies
- **`Function` count is high** (50K+) -- normal for module-heavy apps, stable after startup
- **Total heap fluctuates by a few hundred KB** between runs -- GC timing

### Investigation Workflow

```bash
# 1. Take baseline profile after warmup (5 min under load)
bun --heap-prof-md --heap-prof-dir ./profiles src/index.ts &
PID=$!
sleep 300 && bombardier -c 10 -d 300s http://localhost:3000/endpoint
kill -SIGTERM $PID

# 2. Take second profile after longer run (2+ hours under load)
bun --heap-prof-md --heap-prof-dir ./profiles src/index.ts &
PID=$!
bombardier -c 10 -d 7200s http://localhost:3000/endpoint
kill -SIGTERM $PID

# 3. Compare the two profiles
# If total heap and object counts are significantly higher in profile 2,
# investigate the types that grew using retainer chains
```

---

## Bun Memory APIs

### Heap Stats (Runtime)

```typescript
import { heapStats } from "bun:jsc";

const stats = heapStats();
console.log("Heap size:", stats.heapSize);
console.log("Object count:", stats.objectCount);
console.log("Type counts:", stats.objectTypeCounts);
```

### Force Garbage Collection

```typescript
// Synchronous (blocks event loop)
Bun.gc(true);

// Asynchronous (non-blocking)
Bun.gc(false);

// Compare memory before/after
console.log("Before GC:", process.memoryUsage().heapUsed);
Bun.gc(true);
console.log("After GC:", process.memoryUsage().heapUsed);
```

### Programmatic Heap Snapshot

```typescript
import { generateHeapSnapshot } from "bun";

const snapshot = generateHeapSnapshot();
await Bun.write("profiles/heap-snapshot.json", JSON.stringify(snapshot));
// View in Safari: Developer Tools > Timeline > JavaScript Allocations > Import
```

### Native Heap Stats (mimalloc)

Bun uses mimalloc for non-JavaScript memory allocation:

```bash
MIMALLOC_SHOW_STATS=1 bun src/index.ts
# Stats print on process exit: reserved, committed, segments, pages
```

---

## Load Testing Integration

### Recommended Tools

| Tool | Install | Best For |
|------|---------|----------|
| [bombardier](https://github.com/codesenberg/bombardier) | `brew install bombardier` | Quick HTTP benchmarks, simple to use |
| [oha](https://github.com/hatoo/oha) | `brew install oha` | Detailed latency histograms |
| [k6](https://k6.io/) | `brew install k6` | Scripted scenarios, CI integration |

**Avoid** Node.js-based tools like `autocannon` -- they cannot generate enough load to properly stress a Bun server.

### Profile Under Load

```bash
# Start server with profiling
bun --cpu-prof-md --heap-prof-md \
  --cpu-prof-dir ./profiles --heap-prof-dir ./profiles \
  src/index.ts &
SERVER_PID=$!
sleep 2

# bombardier: 50 concurrent connections for 2 minutes
bombardier -c 50 -d 120s http://localhost:3000/your-endpoint

# oha: 10,000 requests with 50 concurrent connections
oha -c 50 -n 10000 http://localhost:3000/your-endpoint

# Stop and capture
kill -SIGTERM $SERVER_PID
```

### K6 with Profiling

```bash
# Start server with profiling in background
bun --cpu-prof-md --heap-prof-md \
  --cpu-prof-dir ./profiles --heap-prof-dir ./profiles \
  src/index.ts &
SERVER_PID=$!
sleep 2

# Run K6 test
k6 run your-test.js

# Stop server
kill -SIGTERM $SERVER_PID
```

---

## Profile Management

### Recommended Directory Structure

```
profiles/
├── *.cpuprofile           # Raw CPU profiles (Chrome DevTools)
├── *.md                   # Markdown profiles (CPU/Heap)
├── heap-safari-*.json     # Safari heap snapshots
├── archive/               # Date-organized archived profiles
│   └── 20260307_143022/
│       ├── CPU.*.cpuprofile
│       ├── CPU.*.md
│       └── Heap.*.md
└── baselines/             # Permanent baseline profiles
    └── v1.0-baseline.md
```

### Archiving Profiles

```bash
# Archive current profiles to dated folder
ARCHIVE_DIR="profiles/archive/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$ARCHIVE_DIR"
mv profiles/CPU.* profiles/Heap.* profiles/heap-safari-*.json "$ARCHIVE_DIR/" 2>/dev/null
echo "Archived to $ARCHIVE_DIR"
```

### Understanding Profile Filenames

Bun generates filenames like `Heap.531728834279.99694.md`:
- `Heap` / `CPU` -- profile type
- `531728834279` -- monotonic system timestamp (nanoseconds)
- `99694` -- process ID (PID)
- `.md` / `.cpuprofile` -- format

The timestamps are system monotonic clocks (time since boot), not process-relative. Use the CPU profile `Duration` field for actual process runtime.

---

## Viewing Profiles in DevTools

### Chrome DevTools (CPU Profiles)

1. Open Chrome DevTools (`F12`)
2. Go to **Performance** tab
3. Click **Load profile** (upload icon)
4. Select the `.cpuprofile` file
5. Use the flame chart to identify hot functions

### Chrome DevTools (Heap Snapshots)

1. Open Chrome DevTools (`F12`)
2. Go to **Memory** tab
3. Click **Load** at the bottom
4. Select the `.heapsnapshot` file
5. Use Summary/Comparison/Containment views

### Safari (Heap Snapshots)

For `.json` snapshots generated via `generateHeapSnapshot()`:

1. Open Safari Developer Tools (`Cmd + Option + I`)
2. Go to **Timeline** tab
3. Click **JavaScript Allocations**
4. Click **Import** and select the `.json` file

---

## Troubleshooting

### No Profile Files Generated

- **Check Bun version**: Profiling requires Bun 1.3+. Run `bun --version`.
- **Check exit signal**: Profiles are written on graceful exit. Use `kill -SIGTERM`, not `kill -9`.
- **Check output directory**: Ensure the `--cpu-prof-dir` / `--heap-prof-dir` directory exists and is writable.
- **Check server started**: Verify `curl http://localhost:3000/health` works before generating load.

### Empty or Incomplete Profile

- Ensure load was generated during the profiling window. A profile of an idle server has minimal useful data.
- Check the server didn't crash (look for exit code != 0).
- Increase profiling duration -- 30 seconds minimum for meaningful CPU data.

### Profile Is Very Large

Heap markdown profiles can be 500KB+ for complex applications. Use `grep` to search:

```bash
# Find all Function objects
grep '| `Function`' profiles/Heap.*.md

# Find GC roots
grep 'gcroot=1' profiles/Heap.*.md

# Find specific object by ID
grep '| 12345 |' profiles/Heap.*.md
```

### High Memory Usage During Profiling

Profiling adds overhead. Expect:
- **CPU profiling**: ~1-2% CPU overhead from sampling
- **Heap profiling**: Heap snapshot is computed at exit, brief spike in memory usage
- Both are safe for production use with appropriate duration limits

---

## Best Practices

1. **Always baseline before optimizing** -- take a profile before making changes so you can measure the impact
2. **Match durations when comparing** -- check the CPU profile `Duration` field before drawing conclusions
3. **Profile under realistic load** -- use request rates and patterns that match production
4. **Use SIGTERM, never SIGKILL** -- profiles are only written on graceful exit
5. **Commit baseline profiles** -- markdown profiles in version control enable historical comparison
6. **Archive regularly** -- move old profiles to `profiles/archive/` to keep the root clean
7. **Check static allocations** -- module records and framework singletons should be identical across runs
8. **Focus on object counts, not just retained size** -- retained size can shift due to GC accounting without any real change
9. **Take multiple profiles** -- if results seem unexpected, take a third profile to confirm
10. **Document findings** -- use the comparison template to record what changed and why
