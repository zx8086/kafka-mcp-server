# Bun Kubernetes Deployment Guide

Standalone guide to deploying Bun HTTP server applications on Kubernetes with production-grade security, scaling, and monitoring. Drop this file into your project and start deploying.

## Quick Start

This guide covers everything needed to run a Bun-based HTTP service on Kubernetes:

- **Deployment** with security hardening, health probes, and resource limits
- **Service** exposure within the cluster
- **Configuration** via ConfigMaps and Secrets
- **Rolling updates** with pod anti-affinity for high availability
- **Autoscaling** with HPA and Pod Disruption Budgets
- **Network policies** for ingress and egress control
- **RBAC** for least-privilege access
- **Secret management** decision matrix (K8s Secrets, Sealed Secrets, External Secrets)
- **Monitoring** with Prometheus ServiceMonitor
- **Troubleshooting** runbook for common issues

All manifests use `my-service` as the placeholder name. Replace it with your actual service name.

---

## Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
    version: v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-service
  template:
    metadata:
      labels:
        app: my-service
        version: v1
    spec:
      serviceAccountName: my-service
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: my-service
          image: my-registry/my-service:latest
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3000"
            - name: TELEMETRY_MODE
              valueFrom:
                configMapKeyRef:
                  name: my-service-config
                  key: telemetry-mode
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: my-service-secrets
                  key: db-password
            - name: API_KEY
              valueFrom:
                secretKeyRef:
                  name: my-service-secrets
                  key: api-key
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 2
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 10
          securityContext:
            runAsNonRoot: true
            runAsUser: 65532
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 64Mi
```

**Key decisions:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| `runAsUser: 65532` | Distroless `nonroot` user | Standard UID for distroless images |
| `readOnlyRootFilesystem` | `true` | Prevents runtime filesystem tampering |
| `capabilities.drop: ALL` | Drop all Linux capabilities | Least-privilege principle |
| `/tmp` emptyDir | Writable temp directory | Required by Bun for temporary files with read-only root |
| `startupProbe` | 10 attempts, 5s interval | Allows up to 50s for cold start without affecting liveness |
| `seccompProfile: RuntimeDefault` | Default seccomp profile | Blocks dangerous syscalls |

---

## Service Manifest

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 3000
      protocol: TCP
  selector:
    app: my-service
```

Other pods in the cluster reach the service at `http://my-service.default.svc.cluster.local` (or simply `http://my-service` within the same namespace).

---

## Configuration Management

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-service-config
  namespace: default
  labels:
    app: my-service
data:
  telemetry-mode: "otel"
  traces-endpoint: "http://otel-collector.monitoring:4318/v1/traces"
  metrics-endpoint: "http://otel-collector.monitoring:4318/v1/metrics"
  service-name: "my-service"
  service-version: "1.0.0"
```

### Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-service-secrets
  namespace: default
  labels:
    app: my-service
type: Opaque
data:
  # echo -n 'your-db-password' | base64
  db-password: eW91ci1kYi1wYXNzd29yZA==
  # echo -n 'your-api-key' | base64
  api-key: eW91ci1hcGkta2V5
```

**Important**: Base64 is encoding, not encryption. Kubernetes Secrets are stored in etcd. For production workloads, enable etcd encryption at rest and consider External Secrets or Sealed Secrets (see Secret Management Decision Matrix below).

---

## Rolling Update Strategy

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: my-service
  template:
    metadata:
      labels:
        app: my-service
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values:
                        - my-service
                topologyKey: kubernetes.io/hostname
      terminationGracePeriodSeconds: 30
      containers:
        - name: my-service
          image: my-registry/my-service:latest
          ports:
            - name: http
              containerPort: 3000
```

**Rolling update behavior:**

| Setting | Value | Effect |
|---------|-------|--------|
| `maxUnavailable: 1` | At most 1 pod down during update | Maintains capacity during rollouts |
| `maxSurge: 1` | At most 1 extra pod during update | Limits resource consumption during rollouts |
| `podAntiAffinity` | Prefer different nodes | Spreads replicas across nodes for fault tolerance |
| `terminationGracePeriodSeconds: 30` | 30s to drain connections | Allows in-flight requests to complete |

With 3 replicas and `maxUnavailable: 1`, at least 2 pods serve traffic at all times during a rolling update.

---

## Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

**Scaling behavior explained:**

| Direction | Stabilization | Policy | Effect |
|-----------|--------------|--------|--------|
| Scale up | 60s | 100% increase per 15s | Aggressive scale-up: can double pods every 15s after 60s stabilization |
| Scale down | 300s | 10% decrease per 60s | Conservative scale-down: removes at most 10% of pods per minute after 5min stabilization |

The asymmetric behavior (fast up, slow down) prevents flapping during traffic spikes. The HPA requires the Kubernetes Metrics Server to be installed in the cluster.

```bash
# Verify Metrics Server is running
kubectl get deployment metrics-server -n kube-system

# If not installed
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## Pod Disruption Budget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: my-service
```

The PDB ensures that voluntary disruptions (node drains, cluster upgrades, spot instance reclamation) never take down more than 1 pod at a time. With 3 replicas, at least 2 are always available.

**Testing the PDB:**

```bash
# Check PDB status
kubectl get pdb my-service -n default

# Simulate a node drain (dry run)
kubectl drain <node-name> --dry-run=client --ignore-daemonsets

# Verify disruptions are blocked when budget is exhausted
kubectl get events --field-selector reason=TooManyDisruptions -n default
```

**Alternative configurations:**

| Strategy | Use Case |
|----------|----------|
| `maxUnavailable: 1` | General purpose, simple to reason about |
| `minAvailable: 2` | Guarantees minimum capacity, equivalent to above with 3 replicas |
| `minAvailable: "50%"` | Percentage-based, adapts to current replica count |

---

## Network Policies

### Ingress Network Policy

Allow inbound traffic only from specific namespaces on port 3000.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-service-ingress
  namespace: default
  labels:
    app: my-service
spec:
  podSelector:
    matchLabels:
      app: my-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: api-gateway
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 3000
```

### Egress Network Policy

Allow outbound traffic only to specific destinations.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-service-egress
  namespace: default
  labels:
    app: my-service
spec:
  podSelector:
    matchLabels:
      app: my-service
  policyTypes:
    - Egress
  egress:
    # DNS resolution (required for service discovery)
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # Database access
    - to:
        - namespaceSelector:
            matchLabels:
              name: databases
      ports:
        - protocol: TCP
          port: 5432
        - protocol: TCP
          port: 6379
    # External HTTPS APIs
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
          port: 443
    # Telemetry collector
    - to:
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 4318
```

**Important**: Network Policies require a CNI plugin that supports them (Calico, Cilium, Weave Net). The default kubenet CNI does not enforce NetworkPolicy.

```bash
# Verify your CNI supports NetworkPolicy
kubectl get pods -n kube-system | grep -E 'calico|cilium|weave'
```

---

## RBAC

### ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
automountServiceAccountToken: false
```

### Role

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]
```

### RoleBinding

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
subjects:
  - kind: ServiceAccount
    name: my-service
    namespace: default
roleRef:
  kind: Role
  name: my-service
  apiGroup: rbac.authorization.k8s.io
```

**Notes:**

- `automountServiceAccountToken: false` prevents the service account token from being mounted into the pod. Set to `true` only if the application needs to call the Kubernetes API.
- The Role grants read-only access to ConfigMaps and Secrets in the same namespace. Remove the `secrets` resource if the application does not read secrets via the Kubernetes API (most applications consume secrets via environment variables instead).

---

## Pod Security Context

Complete security context example covering both pod-level and container-level settings.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
  namespace: default
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-service
  template:
    metadata:
      labels:
        app: my-service
    spec:
      # Pod-level security context (applies to all containers)
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
        supplementalGroups: []
      containers:
        - name: my-service
          image: my-registry/my-service:latest
          # Container-level security context (overrides pod-level where applicable)
          securityContext:
            runAsNonRoot: true
            runAsUser: 65532
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            privileged: false
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 64Mi
```

**Security context breakdown:**

| Level | Setting | Purpose |
|-------|---------|---------|
| Pod | `runAsNonRoot: true` | Kubernetes rejects the pod if the image runs as root |
| Pod | `runAsUser: 65532` | Standard distroless nonroot UID |
| Pod | `fsGroup: 65532` | Volumes are owned by this group, enabling writes to emptyDir |
| Pod | `fsGroupChangePolicy: OnRootMismatch` | Only chown volumes if ownership differs (faster pod startup) |
| Pod | `seccompProfile: RuntimeDefault` | Restricts available syscalls to a safe default set |
| Container | `readOnlyRootFilesystem: true` | Container cannot write to its own filesystem |
| Container | `allowPrivilegeEscalation: false` | Prevents gaining additional privileges via setuid/setgid |
| Container | `privileged: false` | Explicit denial of privileged mode |
| Container | `capabilities.drop: ALL` | Removes all Linux capabilities |

---

## Secret Management Decision Matrix

| Requirement | K8s Secrets | Sealed Secrets | External Secrets |
|-------------|:-----------:|:--------------:|:----------------:|
| Setup complexity | Simple | Medium | Complex |
| GitOps compatible | No | Yes | Yes |
| Secret rotation | Manual | Manual | Automatic |
| Audit logging | K8s audit log | K8s audit log | Backend audit log |
| SOC2 / PCI compliance | Maybe | Maybe | Yes |
| Multi-cluster | Manual sync | Per-cluster | Centralized |
| Encryption at rest | etcd encryption | Asymmetric crypto | Backend-managed |
| Secret versioning | No | No | Yes (backend) |
| Cloud provider integration | No | No | Yes |
| Offline capability | Yes | Yes | No (needs backend) |

### Kubernetes Secrets (Default)

Already shown above. Suitable for development and non-regulated environments.

```bash
# Create a secret from the command line
kubectl create secret generic my-service-secrets \
  --from-literal=db-password='your-password' \
  --from-literal=api-key='your-api-key' \
  -n default

# Enable etcd encryption at rest (cluster-level configuration)
# See: https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/
```

### Sealed Secrets (Bitnami)

Encrypted secrets that are safe to store in Git. Only the cluster can decrypt them.

```bash
# Install Sealed Secrets controller
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system \
  --set-string fullnameOverride=sealed-secrets-controller

# Install kubeseal CLI
brew install kubeseal

# Seal a secret
kubectl create secret generic my-service-secrets \
  --from-literal=db-password='your-password' \
  --from-literal=api-key='your-api-key' \
  --dry-run=client -o yaml | \
  kubeseal --format yaml > my-service-sealed-secret.yaml

# Apply the sealed secret (safe to commit to Git)
kubectl apply -f my-service-sealed-secret.yaml
```

### External Secrets Operator

Syncs secrets from external backends (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager, Azure Key Vault).

```bash
# Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --set installCRDs=true
```

```yaml
# SecretStore (cluster-level or namespace-level)
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: my-secret-store
  namespace: default
spec:
  provider:
    aws:
      service: SecretsManager
      region: eu-west-1
      auth:
        secretRef:
          name: aws-credentials
          accessKeyIDSecretRef:
            name: aws-credentials
            key: access-key-id
          secretAccessKeySecretRef:
            name: aws-credentials
            key: secret-access-key
---
# ExternalSecret (syncs from backend to K8s Secret)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-service-secrets
  namespace: default
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: my-secret-store
    kind: SecretStore
  target:
    name: my-service-secrets
    creationPolicy: Owner
  data:
    - secretKey: db-password
      remoteRef:
        key: my-service/production
        property: db-password
    - secretKey: api-key
      remoteRef:
        key: my-service/production
        property: api-key
```

---

## ServiceMonitor for Prometheus

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-service
  namespace: default
  labels:
    app: my-service
    release: prometheus
spec:
  selector:
    matchLabels:
      app: my-service
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s
  namespaceSelector:
    matchNames:
      - default
```

**Prerequisites:**

- Prometheus Operator must be installed in the cluster (commonly via the `kube-prometheus-stack` Helm chart).
- The `release: prometheus` label must match the Prometheus Operator's `serviceMonitorSelector`. Check your Prometheus CR:

```bash
# Verify Prometheus Operator is running
kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus-operator

# Check which labels Prometheus uses to discover ServiceMonitors
kubectl get prometheus -n monitoring -o yaml | grep -A5 serviceMonitorSelector

# Verify the ServiceMonitor is discovered
kubectl get servicemonitor my-service -n default
```

**Common metrics endpoint patterns for Bun services:**

| Path | Format | Use Case |
|------|--------|----------|
| `/metrics` | Prometheus text exposition | Standard metrics scraping |
| `/metrics/json` | JSON | Debugging and ad-hoc queries |
| `/health` | JSON | Health check (not for Prometheus) |

---

## Resource Management Best Practices

### CPU Requests and Limits

| Guideline | Recommendation |
|-----------|---------------|
| Request | Set to the P50 CPU usage under normal load |
| Limit | Set to 5-10x the request to handle bursts |
| No limit | Consider removing CPU limits entirely if the cluster has headroom (Google recommendation) |
| Bun-specific | Bun is single-threaded; a single pod rarely exceeds 1 CPU core |

```bash
# Observe actual CPU usage before setting requests/limits
kubectl top pods -l app=my-service -n default

# Check CPU throttling (high throttle count = limit too low)
kubectl get --raw /api/v1/nodes/<node>/proxy/stats/summary | \
  jq '.pods[] | select(.podRef.name | contains("my-service")) | .containers[].cpu'
```

### Memory Requests and Limits

| Guideline | Recommendation |
|-----------|---------------|
| Request | Set to the P90 memory usage under normal load |
| Limit | Set to 1.5-2x the request for safety margin |
| Equal request/limit | Use when you need Guaranteed QoS class |
| Bun-specific | Bun heap typically stabilizes at 15-50 MB for HTTP services |

```bash
# Observe actual memory usage
kubectl top pods -l app=my-service -n default

# Check for OOMKill events
kubectl get events -n default --field-selector reason=OOMKilling
```

### Health Check Configuration

| Probe | Initial Delay | Period | Timeout | Failure Threshold | Purpose |
|-------|--------------|--------|---------|-------------------|---------|
| Startup | 2s | 5s | 3s | 10 | Allow up to 50s for cold start |
| Liveness | 10s | 15s | 3s | 3 | Restart if unhealthy for 45s |
| Readiness | 5s | 10s | 3s | 3 | Remove from service if unable to handle requests |

**Bun-specific considerations:**

- Bun starts fast (typically under 1 second). The startup probe is insurance for environments with slow network or volume mounts.
- Set liveness probe path to a lightweight endpoint that does not call external dependencies. A simple `/health` that returns 200 is sufficient.
- Set readiness probe path to an endpoint that checks dependency connectivity (`/health/ready`). This should verify the application can actually serve requests.
- Do not use TCP probes when HTTP probes are available. HTTP probes verify the application logic is responding, not just that the port is open.

---

## Troubleshooting

### Pod Startup Issues

```bash
# Check pod status and events
kubectl get pods -l app=my-service -n default
kubectl describe pod <pod-name> -n default

# Check container logs
kubectl logs <pod-name> -n default
kubectl logs <pod-name> -n default --previous  # Logs from crashed container

# Check if image can be pulled
kubectl get events -n default --field-selector reason=Failed

# Check if security context is blocking startup
kubectl get pod <pod-name> -n default -o yaml | grep -A20 securityContext

# Debug with an ephemeral container (K8s 1.25+)
kubectl debug -it <pod-name> -n default --image=busybox --target=my-service
```

**Common startup failures:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `CrashLoopBackOff` | Application crashes on start | Check logs for error messages |
| `CreateContainerConfigError` | Missing ConfigMap or Secret | Verify all referenced ConfigMaps and Secrets exist |
| `ImagePullBackOff` | Image not found or auth failed | Check image name, tag, and pull secret |
| `RunAsNonRoot` error | Image runs as root | Use a distroless or nonroot base image |
| `readOnlyRootFilesystem` write error | App writes to filesystem | Mount an emptyDir at the write path |

### Configuration Issues

```bash
# Verify ConfigMap exists and has expected data
kubectl get configmap my-service-config -n default -o yaml

# Verify Secret exists (values are base64 encoded)
kubectl get secret my-service-secrets -n default -o yaml

# Decode a secret value
kubectl get secret my-service-secrets -n default -o jsonpath='{.data.db-password}' | base64 -d

# Check environment variables inside a running pod
kubectl exec <pod-name> -n default -- env | sort

# Verify the pod spec references the correct ConfigMap/Secret keys
kubectl get pod <pod-name> -n default -o yaml | grep -A5 -E 'configMapKeyRef|secretKeyRef'

# Check for ConfigMap/Secret update propagation (requires pod restart for env vars)
kubectl rollout restart deployment/my-service -n default
```

### Performance Issues

```bash
# Check current resource usage
kubectl top pods -l app=my-service -n default
kubectl top nodes

# Check HPA status and scaling decisions
kubectl get hpa my-service -n default
kubectl describe hpa my-service -n default

# Check for CPU throttling events
kubectl get events -n default --field-selector reason=CPUThrottling

# Check for OOMKill events
kubectl get events -n default --field-selector reason=OOMKilling

# Query the metrics endpoint directly
kubectl port-forward svc/my-service 8080:80 -n default &
curl -s http://localhost:8080/metrics | head -50

# Check pod restart count (frequent restarts indicate resource issues)
kubectl get pods -l app=my-service -n default -o custom-columns=\
NAME:.metadata.name,\
RESTARTS:.status.containerStatuses[0].restartCount,\
STATUS:.status.phase

# Check PDB status during maintenance
kubectl get pdb my-service -n default

# View resource quotas that might constrain scaling
kubectl get resourcequota -n default
```

**Common performance issues:**

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| High P99 latency | CPU throttling | Increase CPU limit or remove it |
| OOMKilled pods | Memory limit too low | Increase memory limit, check for leaks |
| HPA not scaling | Metrics Server missing | Install Metrics Server |
| HPA flapping | Stabilization too short | Increase `stabilizationWindowSeconds` |
| Uneven load distribution | Missing anti-affinity | Add pod anti-affinity rules |
| Slow rollouts | Readiness probe failing | Check `/health/ready` endpoint and dependencies |
