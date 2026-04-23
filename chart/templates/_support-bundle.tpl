{{/*
Support bundle spec, rendered into a Secret in support-bundle.yaml via `{{ include }}`.
Structured per Replicated docs:
https://docs.replicated.com/vendor/preflight-sb-helm-templates-about#helm-template-example
*/}}
{{- define "groovelab.supportBundle.spec" -}}
apiVersion: troubleshoot.sh/v1beta2
kind: SupportBundle
metadata:
  name: {{ include "groovelab.fullname" . }}-support-bundle
spec:
  collectors:
    - logs:
        collectorName: "frontend-logs"
        name: frontend/logs
        selector:
          - app.kubernetes.io/component=frontend
        namespace: {{ .Release.Namespace }}
        limits:
          maxLines: 5000
          maxAge: 72h
    - logs:
        collectorName: "backend-logs"
        name: backend/logs
        selector:
          - app.kubernetes.io/component=backend
        namespace: {{ .Release.Namespace }}
        limits:
          maxLines: 10000
          maxAge: 72h
    - logs:
        collectorName: "postgresql-logs"
        name: postgresql/logs
        selector:
          - app.kubernetes.io/name=postgresql
        namespace: {{ .Release.Namespace }}
        limits:
          maxLines: 5000
          maxAge: 48h
    - logs:
        collectorName: "redis-logs"
        name: redis/logs
        selector:
          - app.kubernetes.io/name=redis
        namespace: {{ .Release.Namespace }}
        limits:
          maxLines: 5000
          maxAge: 48h
    - logs:
        collectorName: "sdk-logs"
        name: sdk/logs
        selector:
          - app.kubernetes.io/name=replicated
        namespace: {{ .Release.Namespace }}
        limits:
          maxLines: 5000
          maxAge: 48h
    - http:
        collectorName: "health-endpoint"
        get:
          url: http://{{ include "groovelab.fullname" . }}-backend.{{ .Release.Namespace }}.svc.cluster.local:8080/healthz
          timeout: 10s
  analyzers:
    - textAnalyze:
        checkName: "App Health Status"
        fileName: health-endpoint/health-endpoint.json
        outcomes:
          - pass:
              when: 'Contains "status":\s*"ok"'
              message: "Application health check returned OK"
          - fail:
              message: "Application health check did not return OK. Check backend logs for errors."
    - deploymentStatus:
        checkName: "Frontend Deployment"
        name: {{ include "groovelab.fullname" . }}-frontend
        namespace: {{ .Release.Namespace }}
        outcomes:
          - pass:
              when: ">= 1"
              message: "Frontend deployment has at least 1 available replica"
          - fail:
              when: "< 1"
              message: "Frontend deployment has no available replicas. Check deployment events and pod logs."
    - deploymentStatus:
        checkName: "Backend Deployment"
        name: {{ include "groovelab.fullname" . }}-backend
        namespace: {{ .Release.Namespace }}
        outcomes:
          - pass:
              when: ">= 1"
              message: "Backend deployment has at least 1 available replica"
          - fail:
              when: "< 1"
              message: "Backend deployment has no available replicas. Check deployment events and pod logs."
    {{- if (index .Values "cloudnative-pg" "enabled") }}
    - statefulsetStatus:
        checkName: "PostgreSQL StatefulSet"
        name: {{ include "groovelab.fullname" . }}-postgresql
        namespace: {{ .Release.Namespace }}
        outcomes:
          - pass:
              when: ">= 1"
              message: "PostgreSQL StatefulSet has at least 1 ready replica"
          - fail:
              when: "< 1"
              message: "PostgreSQL StatefulSet has no ready replicas. Check StatefulSet events and pod logs."
    {{- end }}
    - deploymentStatus:
        checkName: "Redis Deployment"
        name: {{ include "groovelab.fullname" . }}-redis
        namespace: {{ .Release.Namespace }}
        outcomes:
          - pass:
              when: ">= 1"
              message: "Redis deployment has at least 1 available replica"
          - fail:
              when: "< 1"
              message: "Redis deployment has no available replicas. Check deployment events and pod logs."
    - textAnalyze:
        checkName: "DB Connection Exhaustion"
        fileName: backend/logs/*.log
        regex: "too many clients already|connection pool exhausted|FATAL.*max_connections"
        outcomes:
          - fail:
              when: "true"
              message: "Database connection exhaustion detected in backend logs. Consider increasing max_connections or optimizing connection pooling."
          - pass:
              when: "false"
              message: "No database connection exhaustion patterns detected"
    - storageClass:
        checkName: "Default Storage Class"
        outcomes:
          - pass:
              message: "A default storage class is configured"
          - fail:
              message: "No default storage class found. A default storage class is required for persistent volume claims."
    - nodeResources:
        checkName: "Node Readiness"
        outcomes:
          - pass:
              when: "ready == true"
              message: "All nodes are in Ready state"
          - warn:
              when: "ready == false"
              message: "One or more nodes are not in Ready state. Check node conditions for details."
{{- end }}
