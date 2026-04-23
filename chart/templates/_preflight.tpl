{{/*
Preflight spec, rendered into a Secret in preflight.yaml via `{{ include }}`.
Structured per Replicated docs:
https://docs.replicated.com/vendor/preflight-sb-helm-templates-about#helm-template-example
*/}}
{{- define "groovelab.preflight.spec" -}}
apiVersion: troubleshoot.sh/v1beta2
kind: Preflight
metadata:
  name: {{ include "groovelab.fullname" . }}-preflight
spec:
  collectors:
    {{- if not (index .Values "cloudnative-pg" "enabled") }}
    - run:
        collectorName: "db-connectivity"
        image: postgres:16-alpine
        command: ["pg_isready"]
        args:
          - "-h"
          - {{ .Values.externalDatabase.host | quote }}
          - "-p"
          - {{ .Values.externalDatabase.port | quote }}
          - "-U"
          - {{ .Values.externalDatabase.username | quote }}
          - "-d"
          - {{ .Values.externalDatabase.database | quote }}
        timeout: "10s"
    {{- end }}
    - run:
        collectorName: "external-endpoint"
        image: busybox:1.36
        command: ["nc"]
        args:
          - "-zv"
          - "-w"
          - "5"
          - "replicated.app"
          - "443"
        timeout: "15s"
  analyzers:
    {{- if not (index .Values "cloudnative-pg" "enabled") }}
    - textAnalyze:
        checkName: "External Database Connectivity"
        fileName: db-connectivity/db-connectivity.log
        outcomes:
          - pass:
              when: "Contains accepting connections"
              message: "External database at {{ .Values.externalDatabase.host }}:{{ .Values.externalDatabase.port }} is reachable"
          - fail:
              message: "Cannot connect to external database at {{ .Values.externalDatabase.host }}:{{ .Values.externalDatabase.port }}. Verify the host, port, and credentials are correct and the database server allows connections from this cluster."
    {{- end }}
    - textAnalyze:
        checkName: "External Endpoint Connectivity"
        fileName: external-endpoint/external-endpoint.log
        outcomes:
          - pass:
              when: "Contains open"
              message: "Successfully connected to replicated.app:443"
          - fail:
              message: "Cannot connect to replicated.app:443. Verify outbound HTTPS access from this cluster to the internet."
    - clusterVersion:
        checkName: "Kubernetes Version"
        outcomes:
          - pass:
              when: ">= 1.28.0"
              message: "Kubernetes version is {{ "{{" }} .Value {{ "}}" }}, which meets the minimum requirement of 1.28.0"
          - fail:
              when: "< 1.28.0"
              message: "Kubernetes version {{ "{{" }} .Value {{ "}}" }} does not meet the minimum requirement of 1.28.0. Please upgrade your cluster to Kubernetes 1.28.0 or later."
    - nodeResources:
        checkName: "Cluster CPU Resources"
        outcomes:
          - pass:
              when: "sum(cpuAllocatable) >= 4"
              message: "Cluster has sufficient CPU resources (4+ cores allocatable)"
          - fail:
              when: "sum(cpuAllocatable) < 4"
              message: "Cluster has fewer than 4 allocatable CPU cores. Add more nodes or use nodes with more CPU capacity."
    - nodeResources:
        checkName: "Cluster Memory Resources"
        outcomes:
          - pass:
              when: "sum(memoryAllocatable) >= 8Gi"
              message: "Cluster has sufficient memory resources (8+ GiB allocatable)"
          - fail:
              when: "sum(memoryAllocatable) < 8Gi"
              message: "Cluster has less than 8 GiB allocatable memory. Add more nodes or use nodes with more memory."
    - distribution:
        checkName: "Kubernetes Distribution"
        outcomes:
          - fail:
              when: "== docker-desktop"
              message: "Docker Desktop is not supported. Please use a production-grade Kubernetes distribution such as k3s, EKS, GKE, AKS, or OpenShift."
          - fail:
              when: "== microk8s"
              message: "MicroK8s is not supported. Please use a production-grade Kubernetes distribution such as k3s, EKS, GKE, AKS, or OpenShift."
          - pass:
              message: "Kubernetes distribution is supported"
{{- end }}
