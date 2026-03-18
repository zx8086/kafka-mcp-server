# Bun Docker Security Guide

Standalone guide to building secure, production-ready Docker containers for Bun HTTP server applications. Drop this file into your project and start hardening.

## Quick Start

Minimal secure Dockerfile for a Bun application using a distroless base image:

```dockerfile
# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/

FROM gcr.io/distroless/static-debian12:nonroot AS production
COPY --from=oven/bun:1.3.9-alpine /usr/local/bin/bun /usr/local/bin/bun
COPY --from=builder --chown=65532:65532 /app /app
WORKDIR /app
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/bun", "--eval", "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"]
CMD ["/usr/local/bin/bun", "src/index.ts"]
```

This gets you a working distroless container in under 80MB. The sections below cover the full production-grade setup with signal handling, library copying, build metadata, and supply chain security.

---

## Multi-Stage Dockerfile

Full multi-stage Dockerfile pattern with all production hardening features. Copy this file as `Dockerfile` into your project root and adjust the entry point and build steps to match your application.

```dockerfile
# Multi-stage optimized Dockerfile for Bun applications
# Designed for minimal build time and maximum security

# syntax=docker/dockerfile:1

# -------------------------------------------------------------------
# Stage 1: deps-base -- Alpine with system dependencies
# -------------------------------------------------------------------
FROM oven/bun:1.3.9-alpine AS deps-base
WORKDIR /app

# Install minimal system dependencies
# Alpine drops old package versions, so pinning breaks builds
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    --mount=type=cache,target=/var/lib/apk,sharing=locked \
    apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache \
        ca-certificates \
        dumb-init && \
    rm -rf /var/cache/apk/*

# -------------------------------------------------------------------
# Stage 2: deps-prod -- Production dependencies only
# -------------------------------------------------------------------
FROM deps-base AS deps-prod
COPY package.json bun.lock ./
# If you use patchedDependencies, uncomment:
# COPY patches/ ./patches/
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    --mount=type=cache,target=/root/.cache/bun,sharing=locked \
    bun install --frozen-lockfile --production

# -------------------------------------------------------------------
# Stage 3: builder -- Full install and build
# -------------------------------------------------------------------
FROM deps-base AS builder
COPY package.json bun.lock ./
# If you use patchedDependencies, uncomment:
# COPY patches/ ./patches/
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    --mount=type=cache,target=/root/.cache/bun,sharing=locked \
    bun install --frozen-lockfile

COPY . .

# Build the application (adjust to your build script)
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    --mount=type=cache,target=/root/.cache/bun,sharing=locked \
    --mount=type=cache,target=/tmp/bun-build,sharing=locked \
    bun run build && \
    # Clean up unnecessary files for smaller image
    rm -rf .git .github node_modules/.cache test/ tests/ \
           *.test.* *.spec.* *.md docs/ coverage/ \
           .vscode .idea *.log

# -------------------------------------------------------------------
# Stage 4: production -- Distroless runtime
# -------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS production

# Copy Bun runtime binary
COPY --from=oven/bun:1.3.9-alpine --chown=65532:65532 \
    /usr/local/bin/bun /usr/local/bin/bun

# Copy dumb-init for PID 1 signal handling
COPY --from=deps-base --chown=65532:65532 \
    /usr/bin/dumb-init /usr/bin/dumb-init

# Copy musl dynamic linker (required for Bun to run)
COPY --from=deps-base --chown=65532:65532 \
    /lib/ld-musl-*.so.1 /lib/

# Copy shared libraries required by Bun
COPY --from=deps-base --chown=65532:65532 \
    /usr/lib/libgcc_s.so.1 \
    /usr/lib/libstdc++.so.6 \
    /usr/lib/

WORKDIR /app

# Copy production dependencies
COPY --from=deps-prod --chown=65532:65532 \
    /app/node_modules ./node_modules
COPY --from=deps-prod --chown=65532:65532 \
    /app/package.json ./package.json

# Copy application source
COPY --from=builder --chown=65532:65532 /app/src ./src

# If your build produces a dist/ or public/ directory, copy it:
# COPY --from=builder --chown=65532:65532 /app/dist ./dist
# COPY --from=builder --chown=65532:65532 /app/public ./public

# Run as nonroot user (65532 is the standard nonroot UID in distroless)
USER 65532:65532

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# Health check using Bun native fetch (no curl available in distroless)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/local/bin/bun", "--eval", "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"]

# Use dumb-init as PID 1 for proper SIGTERM/SIGINT signal forwarding
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/usr/local/bin/bun", "src/index.ts"]

# OCI image labels (values passed via --build-arg from build script)
ARG BUILD_DATE
ARG VCS_REF
ARG SERVICE_NAME
ARG SERVICE_VERSION
ARG SERVICE_DESCRIPTION
ARG SERVICE_AUTHOR
ARG SERVICE_LICENSE

LABEL org.opencontainers.image.title="${SERVICE_NAME}" \
    org.opencontainers.image.description="${SERVICE_DESCRIPTION}" \
    org.opencontainers.image.vendor="${SERVICE_AUTHOR}" \
    org.opencontainers.image.version="${SERVICE_VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.licenses="${SERVICE_LICENSE}" \
    org.opencontainers.image.base.name="gcr.io/distroless/static-debian12:nonroot" \
    security.scan.disable="false" \
    security.attestation.required="true" \
    security.sbom.required="true"
```

### Why dumb-init?

Distroless images have no shell, so the container process runs as PID 1. Without `dumb-init`:

- `SIGTERM` is not forwarded to child processes (orphan zombies accumulate)
- Graceful shutdown does not work (Kubernetes sends SIGTERM before SIGKILL)
- Health check processes are not reaped

`dumb-init` acts as a minimal init system: it forwards signals, reaps zombies, and exits cleanly.

### Why musl Libraries?

Bun is compiled against musl libc on Alpine. The distroless base image does not include musl, so you must copy three files:

1. `/lib/ld-musl-*.so.1` -- the musl dynamic linker
2. `/usr/lib/libgcc_s.so.1` -- GCC runtime support
3. `/usr/lib/libstdc++.so.6` -- C++ standard library

Without these, Bun will fail with `No such file or directory` even though the binary exists (the kernel cannot find the dynamic linker).

---

## Container Hardening Features

| Feature | Configuration |
|---------|---------------|
| User | Nonroot (65532:65532) |
| Filesystem | Read-only (`--read-only` flag at runtime) |
| Capabilities | All dropped (`--cap-drop=ALL`) |
| Privileges | No new privileges (`--security-opt=no-new-privileges:true`) |
| Base Image | Distroless (no shell, no package manager, no coreutils) |
| PID 1 | dumb-init for signal forwarding and zombie reaping |
| Health Check | Bun native fetch (no external binaries required) |
| Ownership | All files owned by 65532:65532 (nonroot) |

### Defense in Depth

These features work together to minimize the blast radius of a container compromise:

- **No shell**: An attacker who gains code execution cannot spawn a shell
- **No package manager**: Cannot install tools or download additional payloads
- **Read-only filesystem**: Cannot write backdoors, cron jobs, or modified binaries
- **Dropped capabilities**: Cannot mount filesystems, change network config, or trace processes
- **No new privileges**: Cannot escalate via setuid/setgid binaries (none exist anyway)
- **Nonroot user**: Cannot access host resources even if container escape occurs

---

## Build Metadata from package.json

Use a build script to extract metadata from `package.json` and pass it as build arguments. This populates OCI labels for image inspection, scanning tools, and registry metadata.

### Build Script

Save as `scripts/docker-build.sh`:

```bash
#!/bin/bash

# docker-build.sh - Build Docker image with metadata from package.json

set -e

# Extract metadata from package.json using native tools (no jq dependency)
SERVICE_NAME=$(grep '"name"' package.json | head -1 | cut -d'"' -f4)
SERVICE_VERSION=$(grep '"version"' package.json | head -1 | cut -d'"' -f4)
SERVICE_DESCRIPTION=$(grep '"description"' package.json | head -1 | cut -d'"' -f4)
SERVICE_AUTHOR=$(grep '"author"' package.json | head -1 | cut -d'"' -f4)
SERVICE_LICENSE=$(grep '"license"' package.json | head -1 | cut -d'"' -f4)

# Build metadata
BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
VCS_REF=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Image name from package name or override with arguments
IMAGE_NAME=${1:-$SERVICE_NAME}
IMAGE_TAG=${2:-$SERVICE_VERSION}

echo "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "----------------------------------------"
echo "Service: ${SERVICE_NAME} v${SERVICE_VERSION}"
echo "Description: ${SERVICE_DESCRIPTION}"
echo "Author: ${SERVICE_AUTHOR}"
echo "License: ${SERVICE_LICENSE}"
echo "Build Date: ${BUILD_DATE}"
echo "Git Commit: ${VCS_REF}"
echo "----------------------------------------"

DOCKER_BUILDKIT=1 docker build \
  --target production \
  --platform linux/amd64 \
  --build-arg SERVICE_NAME="${SERVICE_NAME}" \
  --build-arg SERVICE_VERSION="${SERVICE_VERSION}" \
  --build-arg SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION}" \
  --build-arg SERVICE_AUTHOR="${SERVICE_AUTHOR}" \
  --build-arg SERVICE_LICENSE="${SERVICE_LICENSE}" \
  --build-arg BUILD_DATE="${BUILD_DATE}" \
  --build-arg VCS_REF="${VCS_REF}" \
  -t "${IMAGE_NAME}:${IMAGE_TAG}" \
  -t "${IMAGE_NAME}:latest" \
  .

echo "Successfully built: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Also tagged as: ${IMAGE_NAME}:latest"
docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
```

### package.json Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "docker:build": "bash scripts/docker-build.sh",
    "docker:local": "bash scripts/docker-build.sh && docker run -d --name my-service --env-file .env -p 3000:3000 my-service:latest",
    "docker:stop": "docker stop my-service && docker rm my-service"
  }
}
```

### Verifying Labels

After building, inspect the OCI labels:

```bash
docker inspect my-service:latest --format '{{json .Config.Labels}}' | python3 -m json.tool
```

---

## Docker Run with Security Flags

Run the container with full security hardening at the runtime level:

```bash
docker run -d \
  --name my-service \
  --env-file .env \
  -p 3000:3000 \
  --user 65532:65532 \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=100m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  my-service:latest
```

### Flag Reference

| Flag | Purpose |
|------|---------|
| `--user 65532:65532` | Run as nonroot user (matches distroless nonroot UID/GID) |
| `--read-only` | Mount the container filesystem as read-only |
| `--tmpfs /tmp:noexec,nosuid,size=100m` | Writable temp directory with no execute permission |
| `--cap-drop=ALL` | Drop all Linux capabilities |
| `--security-opt=no-new-privileges:true` | Prevent privilege escalation via setuid/setgid |
| `--env-file .env` | Load environment variables from file (never bake secrets into the image) |

### With Additional Environment Variables

```bash
docker run -d \
  --name my-service \
  -p 3000:3000 \
  --user 65532:65532 \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=100m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e LOG_LEVEL=info \
  -e TELEMETRY_MODE=otlp \
  my-service:latest
```

---

## Docker Compose Production Setup

Save as `docker-compose.yml`:

```yaml
version: "3.8"

services:
  my-service:
    image: my-service:latest
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    container_name: my-service
    restart: unless-stopped
    ports:
      - "3000:3000"

    # Security hardening
    user: "65532:65532"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:noexec,nosuid,size=100m

    # Resource limits
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M

    # Health check using Bun native fetch
    healthcheck:
      test:
        [
          "CMD",
          "/usr/local/bin/bun",
          "--eval",
          "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

    # Environment variables
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOST: "0.0.0.0"
      LOG_LEVEL: info
      TELEMETRY_MODE: otlp

    # Or load from file (preferred for secrets):
    # env_file:
    #   - .env
```

### Running with Docker Compose

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f my-service

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build --force-recreate
```

---

## Supply Chain Security

### SBOM Generation

Generate a Software Bill of Materials for vulnerability tracking and compliance:

```bash
# Generate SBOM using Docker BuildKit (SPDX format)
DOCKER_BUILDKIT=1 docker build \
  --target production \
  --sbom=true \
  -t my-service:latest \
  .

# Generate SBOM using syft (CycloneDX format)
syft my-service:latest -o cyclonedx-json > sbom.cyclonedx.json

# Generate SBOM using syft (SPDX format)
syft my-service:latest -o spdx-json > sbom.spdx.json
```

### Provenance Attestations

Build provenance records who built the image, when, and from what source:

```bash
# Build with provenance attestation
DOCKER_BUILDKIT=1 docker build \
  --target production \
  --provenance=true \
  --sbom=true \
  -t my-service:latest \
  .

# Inspect provenance
docker buildx imagetools inspect my-service:latest --format '{{json .Provenance}}'
```

### Docker Scout CVE Scanning

Scan for known vulnerabilities in your image:

```bash
# Quick scan
docker scout cves my-service:latest

# Detailed scan with recommendations
docker scout recommendations my-service:latest

# Compare two versions
docker scout compare my-service:latest --to my-service:1.0.0

# Check Docker Scout health score
docker scout quickview my-service:latest
```

### Security Validation Script

Save as `scripts/docker-security-check.sh`:

```bash
#!/bin/bash

# docker-security-check.sh - Validate container security posture

set -e

IMAGE=${1:-my-service:latest}

echo "Security validation for: ${IMAGE}"
echo "========================================"

# 1. Check image size
echo ""
echo "[1/6] Image size"
docker images "${IMAGE}" --format "{{.Size}}"

# 2. Verify nonroot user
echo ""
echo "[2/6] Default user"
USER=$(docker inspect "${IMAGE}" --format '{{.Config.User}}')
if [ "${USER}" = "65532:65532" ] || [ "${USER}" = "65532" ]; then
  echo "PASS: Runs as nonroot (${USER})"
else
  echo "FAIL: Runs as ${USER:-root}"
fi

# 3. Check health check is defined
echo ""
echo "[3/6] Health check"
HEALTHCHECK=$(docker inspect "${IMAGE}" --format '{{.Config.Healthcheck}}')
if [ "${HEALTHCHECK}" != "<nil>" ] && [ -n "${HEALTHCHECK}" ]; then
  echo "PASS: Health check defined"
else
  echo "FAIL: No health check defined"
fi

# 4. Verify no shell available
echo ""
echo "[4/6] Shell availability"
if docker run --rm "${IMAGE}" /bin/sh -c "echo shell" 2>/dev/null; then
  echo "FAIL: Shell is available"
else
  echo "PASS: No shell available (distroless)"
fi

# 5. Check OCI labels
echo ""
echo "[5/6] OCI labels"
docker inspect "${IMAGE}" --format '{{range $k, $v := .Config.Labels}}{{$k}}: {{$v}}{{"\n"}}{{end}}'

# 6. CVE scan (requires Docker Scout)
echo ""
echo "[6/6] CVE scan"
if command -v docker scout &> /dev/null 2>&1; then
  docker scout cves "${IMAGE}" --only-severity critical,high 2>/dev/null || echo "Scout scan completed"
else
  echo "SKIP: Docker Scout not available (install with: curl -sSfL https://raw.githubusercontent.com/docker/scout-cli/main/install.sh | sh)"
fi

echo ""
echo "========================================"
echo "Security validation complete"
```

```bash
chmod +x scripts/docker-security-check.sh
./scripts/docker-security-check.sh my-service:latest
```

---

## CVE Remediation SLA Framework

Define remediation timelines based on vulnerability severity. These targets align with industry standards and provide auditable compliance.

| Severity | CVSS Score | Remediation Time | Action Required |
|----------|-----------|-----------------|-----------------|
| CRITICAL | 9.0 - 10.0 | 7 days | Immediate triage, patch or mitigate, rebuild and deploy |
| HIGH | 7.0 - 8.9 | 7 days | Prioritize in current sprint, patch and rebuild |
| MEDIUM | 4.0 - 6.9 | 30 days | Schedule in next sprint, patch in regular release cycle |
| LOW | 0.1 - 3.9 | 90 days | Track in backlog, patch with next dependency update |

### Implementing the SLA

1. **Automated scanning**: Run `docker scout cves` in CI/CD on every build
2. **Gate deployment**: Fail the pipeline if CRITICAL or HIGH vulnerabilities exist
3. **Track remediation**: Log CVE IDs, discovery date, and resolution date
4. **Base image updates**: Schedule monthly base image rebuilds even without code changes
5. **Dependency updates**: Run `bun update` weekly and rebuild to pick up patched packages

### CI/CD Pipeline Gate

```bash
# Fail build if critical or high CVEs are found
docker scout cves my-service:latest --only-severity critical,high --exit-code
```

The `--exit-code` flag causes Docker Scout to return a non-zero exit code if vulnerabilities matching the severity filter are found, which fails the CI/CD pipeline.

---

## Performance Characteristics

Typical values for a Bun HTTP server in a distroless container. Actual numbers depend on application complexity, dependency count, and workload.

| Metric | Typical Value | Notes |
|--------|--------------|-------|
| Image Size | 50-80 MB | Distroless base + Bun runtime + musl libs + app |
| Memory Baseline | 50-80 MB | Idle server with dependencies loaded |
| Memory Limit (Production) | 512 MB - 1 GB | Set based on load testing results |
| CPU Overhead | Less than 2% | With observability (OpenTelemetry) enabled |
| Cold Start | Less than 100 ms | Time from container start to first request served |
| Health Check Overhead | Negligible | Bun fetch is lightweight, 30s interval is conservative |

### Sizing Guidelines

| Workload | CPU Limit | Memory Limit | Replicas |
|----------|----------|-------------|----------|
| Low (less than 100 req/s) | 0.5 | 256 MB | 2 |
| Medium (100-1000 req/s) | 1.0 | 512 MB | 3 |
| High (1000+ req/s) | 2.0 | 1 GB | 4+ |

Always load test with realistic traffic before setting resource limits. Use `docker stats` or Kubernetes metrics to observe actual usage.

---

## Privileged Port Configuration

Containers running as nonroot (UID 65532) cannot bind to ports below 1024. There are two approaches to serve traffic on port 80 or 443.

### Recommended: Port Mapping

Map the host's privileged port to the container's unprivileged port. No special capabilities required.

```bash
# Map host port 80 to container port 3000
docker run -d \
  --name my-service \
  -p 80:3000 \
  --user 65532:65532 \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  my-service:latest

# Map both HTTP and HTTPS
docker run -d \
  --name my-service \
  -p 80:3000 \
  -p 443:3443 \
  --user 65532:65532 \
  my-service:latest
```

This is the preferred approach because it requires zero additional capabilities.

### Alternative: CAP_NET_BIND_SERVICE

If you must bind directly to a privileged port inside the container (rare, not recommended):

```bash
docker run -d \
  --name my-service \
  -p 80:80 \
  --user 65532:65532 \
  --read-only \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  --security-opt=no-new-privileges:true \
  -e PORT=80 \
  my-service:latest
```

This adds a single capability back after dropping all. Only use this if your infrastructure requires the container to bind directly to port 80 (some service meshes or legacy load balancers).

---

## Health Endpoints

Implement these health endpoints in your Bun application to support container orchestration, load balancer routing, and monitoring.

| Endpoint | Purpose | Expected Response | Used By |
|----------|---------|-------------------|---------|
| `/health` | Liveness probe | `200 OK` with `{"status":"healthy"}` | Docker HEALTHCHECK, Kubernetes livenessProbe |
| `/health/ready` | Readiness probe | `200 OK` when dependencies are available | Kubernetes readinessProbe, load balancer |
| `/metrics` | Prometheus metrics | `200 OK` with metrics in Prometheus exposition format | Prometheus scraper, monitoring stack |

### Minimal Health Endpoint Implementation

```typescript
// src/health.ts
export function handleHealth(req: Request): Response {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({ status: "healthy", timestamp: new Date().toISOString() });
  }

  if (url.pathname === "/health/ready") {
    // Add dependency checks here (database, cache, external APIs)
    const ready = true; // Replace with actual readiness logic
    if (ready) {
      return Response.json({ status: "ready", timestamp: new Date().toISOString() });
    }
    return Response.json({ status: "not_ready" }, { status: 503 });
  }

  return new Response("Not Found", { status: 404 });
}
```

### Kubernetes Probe Configuration

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 15
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
```

---

## Monitoring and Debugging

### Container Logs

```bash
# Follow logs in real time
docker logs -f my-service

# Last 100 lines
docker logs --tail 100 my-service

# Logs since a specific time
docker logs --since 2h my-service

# Logs with timestamps
docker logs -t my-service
```

### Health Monitoring

```bash
# Check current health status
docker inspect my-service --format '{{.State.Health.Status}}'

# View health check history
docker inspect my-service --format '{{json .State.Health}}' | python3 -m json.tool

# Manual health check (from host)
curl -s http://localhost:3000/health | python3 -m json.tool

# Continuous health monitoring (every 5 seconds)
watch -n 5 'curl -s http://localhost:3000/health'
```

### Container Resource Usage

```bash
# Real-time CPU, memory, network, I/O stats
docker stats my-service

# One-shot stats (for scripting)
docker stats my-service --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

# Memory usage in bytes (for alerting)
docker stats my-service --no-stream --format '{{.MemUsage}}'
```

### Container Inspection

```bash
# Full container configuration
docker inspect my-service

# Check which user the container is running as
docker inspect my-service --format '{{.Config.User}}'

# Check environment variables (verify no secrets leaked into image)
docker inspect my-service --format '{{json .Config.Env}}' | python3 -m json.tool

# Check mounted volumes and tmpfs
docker inspect my-service --format '{{json .Mounts}}' | python3 -m json.tool

# Check security options
docker inspect my-service --format '{{json .HostConfig.SecurityOpt}}'

# Check dropped capabilities
docker inspect my-service --format '{{json .HostConfig.CapDrop}}'
```

### Debugging Without a Shell

Distroless containers have no shell. Use these techniques to debug running containers:

```bash
# Execute a Bun script inside the container
docker exec my-service /usr/local/bin/bun --eval "console.log(process.memoryUsage())"

# Check if the process is running
docker exec my-service /usr/local/bin/bun --eval "console.log('alive')"

# Dump environment variables
docker exec my-service /usr/local/bin/bun --eval "console.log(JSON.stringify(process.env, null, 2))"

# Check network connectivity from inside the container
docker exec my-service /usr/local/bin/bun --eval "fetch('http://example.com').then(r=>console.log(r.status)).catch(e=>console.error(e.message))"
```

If you need a full shell for deep debugging, use a debug sidecar:

```bash
# Attach a debug container to the same network namespace
docker run -it --rm \
  --network container:my-service \
  --pid container:my-service \
  alpine:latest sh
```

---

## Troubleshooting

### Read-Only Filesystem Errors

**Symptom**: Application fails with `EROFS: read-only file system` or `Permission denied` when writing temporary files.

**Cause**: The `--read-only` flag prevents all filesystem writes. Some libraries write to `/tmp` for caching, lock files, or temporary data.

**Solution**: Add a tmpfs mount for `/tmp`:

```bash
docker run -d \
  --name my-service \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=100m \
  my-service:latest
```

If your application writes to other directories, add additional tmpfs mounts:

```bash
--tmpfs /app/.cache:noexec,nosuid,size=50m
```

### Docker Scout Health Score Issues

**Symptom**: Docker Scout reports a low health score despite no CVEs.

**Common causes and fixes**:

| Issue | Fix |
|-------|-----|
| No health check defined | Add `HEALTHCHECK` instruction to Dockerfile |
| Running as root | Add `USER 65532:65532` instruction |
| No OCI labels | Add `LABEL org.opencontainers.image.*` instructions |
| Missing SBOM | Build with `--sbom=true` |
| No provenance | Build with `--provenance=true` |

### Container Will Not Start

**Symptom**: Container exits immediately after starting.

**Diagnostic steps**:

```bash
# Check exit code
docker inspect my-service --format '{{.State.ExitCode}}'

# Check logs for error messages
docker logs my-service

# Common exit codes:
# 0   - Normal exit (application completed or crashed gracefully)
# 1   - Application error (check logs for stack trace)
# 127 - Command not found (Bun binary missing or musl libraries not copied)
# 137 - OOM killed (increase memory limit)
# 139 - Segfault (check Bun version compatibility)
```

**Common fixes**:

```bash
# Exit code 127: Verify Bun and musl are properly copied
docker run --rm --entrypoint /usr/local/bin/bun my-service:latest --version

# Exit code 137: Increase memory limit
docker run -d --memory=512m my-service:latest

# Missing environment variables: Verify .env file
docker run --rm --env-file .env my-service:latest /usr/local/bin/bun --eval "console.log(process.env.PORT)"
```

### Health Check Failing

**Symptom**: Container shows `unhealthy` status.

**Diagnostic steps**:

```bash
# Check health check logs
docker inspect my-service --format '{{json .State.Health}}' | python3 -m json.tool

# Test health endpoint manually from host
curl -v http://localhost:3000/health

# Test health check command inside container
docker exec my-service /usr/local/bin/bun --eval "fetch('http://localhost:3000/health').then(r=>{console.log(r.status);return r.text()}).then(console.log).catch(console.error)"
```

**Common causes**:

| Cause | Fix |
|-------|-----|
| Application not listening on expected port | Verify `PORT` environment variable matches health check URL |
| Application not started yet | Increase `--start-period` in HEALTHCHECK |
| Health endpoint returns non-200 | Check application logs for errors |
| DNS resolution failure | Use `localhost` not `127.0.0.1` in health check |

### High Memory Usage

**Symptom**: Container memory usage grows over time or approaches the limit.

**Investigation steps**:

```bash
# Check current memory usage
docker stats my-service --no-stream

# Get detailed memory info from inside the container
docker exec my-service /usr/local/bin/bun --eval "
const mem = process.memoryUsage();
console.log('RSS:', (mem.rss / 1024 / 1024).toFixed(1), 'MB');
console.log('Heap Used:', (mem.heapUsed / 1024 / 1024).toFixed(1), 'MB');
console.log('Heap Total:', (mem.heapTotal / 1024 / 1024).toFixed(1), 'MB');
console.log('External:', (mem.external / 1024 / 1024).toFixed(1), 'MB');
"

# Force garbage collection and recheck
docker exec my-service /usr/local/bin/bun --eval "
Bun.gc(true);
const mem = process.memoryUsage();
console.log('After GC - RSS:', (mem.rss / 1024 / 1024).toFixed(1), 'MB');
console.log('After GC - Heap Used:', (mem.heapUsed / 1024 / 1024).toFixed(1), 'MB');
"
```

**If memory keeps growing**: Profile the application using heap profiling (see Bun Profiling Guide) to identify objects that are not being garbage collected.

### Distroless Container Limitations

Distroless containers intentionally lack common Linux utilities. Be aware of these limitations:

| Missing Tool | Workaround |
|-------------|------------|
| `sh`, `bash` | Use `docker exec ... /usr/local/bin/bun --eval "..."` |
| `curl`, `wget` | Use Bun's `fetch()` via `--eval` |
| `ls`, `cat`, `find` | Use Bun's file APIs via `--eval` |
| `ps`, `top` | Use `docker top my-service` from the host |
| `netstat`, `ss` | Use `docker exec ... /usr/local/bin/bun --eval "..."` with network APIs |
| Package manager | Not available by design -- rebuild the image to add dependencies |

### Build Cache Issues

**Symptom**: Docker build is slow despite no code changes.

**Fixes**:

```bash
# Clear BuildKit cache
docker builder prune

# Rebuild without cache (nuclear option)
docker build --no-cache -t my-service:latest .

# Verify cache mounts are working
DOCKER_BUILDKIT=1 docker build --progress=plain -t my-service:latest . 2>&1 | grep -i cache
```

**Best practice**: Order Dockerfile instructions from least-frequently-changed to most-frequently-changed. The layer order in the Multi-Stage Dockerfile template above is optimized for cache efficiency:

1. System packages (rarely change)
2. `package.json` and `bun.lock` (change on dependency updates)
3. Application source (changes frequently)

---

## Best Practices

1. **Never bake secrets into the image** -- use `--env-file`, Docker secrets, or a secrets manager at runtime
2. **Pin Bun version in the Dockerfile** -- use `oven/bun:1.3.9-alpine` not `oven/bun:latest`
3. **Use `--frozen-lockfile`** -- ensures reproducible builds from the lock file
4. **Rebuild regularly** -- schedule weekly rebuilds to pick up base image security patches
5. **Scan before deploying** -- gate CI/CD on `docker scout cves --exit-code`
6. **Set resource limits** -- always define CPU and memory limits in production
7. **Use read-only filesystem** -- add tmpfs mounts only where writes are necessary
8. **Test health checks locally** -- verify the health check works before deploying to orchestration
9. **Keep the image small** -- exclude dev dependencies, test files, documentation, and `.git` from the production stage
10. **Tag with version and latest** -- use semantic versioning for traceability, `latest` for convenience
