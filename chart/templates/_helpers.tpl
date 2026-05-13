{{/*
Expand the name of the chart.
*/}}
{{- define "groovelab.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "groovelab.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label.
*/}}
{{- define "groovelab.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "groovelab.labels" -}}
helm.sh/chart: {{ include "groovelab.chart" . }}
{{ include "groovelab.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "groovelab.selectorLabels" -}}
app.kubernetes.io/name: {{ include "groovelab.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Construct a fully-qualified container image reference from registry,
repository, and tag. If registry is empty, returns repository:tag.
Usage:
  {{ include "groovelab.imageRef" (dict "registry" .Values.image.frontend.registry "repository" .Values.image.frontend.repository "tag" (.Values.image.frontend.tag | default .Chart.AppVersion)) }}
*/}}
{{- define "groovelab.imageRef" -}}
{{- $registry := .registry | default "" -}}
{{- $repository := .repository -}}
{{- $tag := .tag -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end -}}

{{/*
Pod-level security context (PodSecurityContext).
Usage: {{ include "groovelab.podSecurityContext" . | nindent 8 }}

NOTE: runAsNonRoot is intentionally omitted. The container images (nginx,
Go binary, redis/valkey) do not declare a non-root USER in their Dockerfile.
With runAsNonRoot: true, Kubernetes rejects pods because the effective user
is root (uid 0). OpenShift SCCs handle non-root enforcement via random UID
assignment. Container-level protections (allowPrivilegeEscalation: false,
readOnlyRootFilesystem) provide defense in depth.
*/}}
{{- define "groovelab.podSecurityContext" -}}
seccompProfile:
  type: {{ .Values.securityContext.pod.seccompProfile.type }}
{{- end -}}

{{/*
Container-level security context (SecurityContext).
Usage: {{ include "groovelab.containerSecurityContext" . | nindent 12 }}
*/}}
{{- define "groovelab.containerSecurityContext" -}}
allowPrivilegeEscalation: {{ .Values.securityContext.container.allowPrivilegeEscalation }}
readOnlyRootFilesystem: {{ .Values.securityContext.container.readOnlyRootFilesystem }}
{{- end -}}

{{/*
Standard emptyDir volumes needed when readOnlyRootFilesystem is true.
Usage: {{ include "groovelab.emptyDirVolumes" . | nindent 8 }}
*/}}
{{- define "groovelab.emptyDirVolumes" -}}
- name: tmp
  emptyDir: {}
{{- end -}}

{{/*
Standard volume mounts for emptyDir volumes.
Usage: {{ include "groovelab.emptyDirVolumeMounts" . | nindent 12 }}
*/}}
{{- define "groovelab.emptyDirVolumeMounts" -}}
- name: tmp
  mountPath: /tmp
{{- end -}}

{{/*
Image pull secrets — merges global.imagePullSecrets, images.pullSecrets,
and the SDK-managed enterprise-pull-secret when dockerconfigjson is present.
*/}}
{{- define "groovelab.imagePullSecrets" -}}
  {{- $pullSecrets := list }}
  {{- with ((.Values.global).imagePullSecrets) -}}
    {{- range . -}}
      {{- if kindIs "map" . -}}
        {{- $pullSecrets = append $pullSecrets .name -}}
      {{- else -}}
        {{- $pullSecrets = append $pullSecrets . -}}
      {{- end }}
    {{- end -}}
  {{- end -}}
  {{- with .Values.images -}}
    {{- range .pullSecrets -}}
      {{- if kindIs "map" . -}}
        {{- $pullSecrets = append $pullSecrets .name -}}
      {{- else -}}
        {{- $pullSecrets = append $pullSecrets . -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
  {{- if ((.Values.global).replicated).dockerconfigjson }}
    {{- $pullSecrets = append $pullSecrets "enterprise-pull-secret" -}}
  {{- end -}}
  {{- if (not (empty $pullSecrets)) -}}
imagePullSecrets:
    {{- range $pullSecrets | uniq }}
  - name: {{ . }}
    {{- end }}
  {{- end }}
{{- end -}}
