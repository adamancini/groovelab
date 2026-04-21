# Tier 0 — Build It (Demo Script)

**Target length:** 4:30. **Epic:** GRO-gc9z. **UAT:** `.vault/knowledge/uat/uat-GRO-gc9z-tier0-build-it.md`

## Goal

Show that Groovelab — the app itself — is real and end-to-end: guest learners
can use it, registered users can, and the first user becomes admin with an
admin panel.

## Setup (do before hitting record)

```bash
# Warm the cluster (CMX k3s or local kind)
kubectl -n groovelab get pods
# Two port-forwards, backgrounded
kubectl port-forward svc/groovelab-backend 18080:8080 -n groovelab &
kubectl port-forward svc/groovelab-frontend 18443:443 -n groovelab &
# Browser tabs primed (not logged in):
#   1: http://localhost:18443/learn
#   2: http://localhost:18443/fretboard
#   3: http://localhost:18443/  (sign-in)
# Terminal visible, cwd = repo root
# Close any DevTools, close distracting tabs
```

## Script

### 0:00 – 0:20 — Intro

> "Hi, this is the Tier 0 walking-skeleton demo for Groovelab — a guitar/bass
> learning app we're using as the vehicle for this Replicated distribution
> bootcamp. In Tier 0 we built the app itself: a flashcard learner, a
> fretboard reference, and an admin panel, all running on a first-party
> Kubernetes stack — no Bitnami anywhere. Let me show you it working."

### 0:20 – 0:45 — Health & proof it's on Kubernetes

Terminal:
```bash
kubectl -n groovelab get pods
curl -s http://localhost:18080/healthz | jq
```

> "Four pods — frontend, backend, CloudNativePG Postgres, and Valkey for
> cache. Health endpoint reports database and redis both OK."

### 0:45 – 1:45 — Flashcards as a guest

Browser → `/learn`:
1. Grid of topic cards — call out mastery dots (12/card) and accuracy %.
2. Click **Major Chords**.
3. Answer one correctly — green feedback, explanation, Continue.
4. Answer one wrong — point out the framing: "The correct answer is…"
   not "Wrong!" — we deliberately keep punishment language out.
5. Click **Skip** — next card appears, no accuracy hit.
6. Finish a short session → summary (accuracy, streak, new/reviewed),
   non-blocking "Sign in to save your progress" prompt.

### 1:45 – 2:45 — Fretboard reference

Browser → `/fretboard`:
1. Standard 4-string bass, open strings G-D-A-E.
2. Click open **G** — every G on the board highlights cyan.
3. Scale dropdown → **Major**, key **C** — members filled, non-members dim,
   tonic in amber with a double ring. Call out: distinction is not
   color-only, tonic is shape-differentiated for accessibility.
4. String-count button → **5** — fretboard re-renders instantly.
5. Tuning dropdown → **Drop D** — low string opens on D.
6. **Custom** → change one string inline — updates live.

### 2:45 – 3:45 — Registration and admin

Browser → sign-in page:
1. Register a brand-new user. Log in.
2. Open avatar → **Admin Panel** is visible (first user auto-becomes admin).
3. Sidebar: Updates, Users, Tracks, License, Support.
4. Users table — show the admin row. Try to disable the current user →
   rejected: "cannot disable your own account."
5. Log out, register a second user, log in. No Admin Panel link in the
   avatar dropdown — RBAC works.

### 3:45 – 4:15 — Resilience beat (optional, can cut if tight)

Terminal:
```bash
kubectl -n groovelab delete pod -l app.kubernetes.io/component=backend
kubectl -n groovelab get pods -w   # let it come back, then Ctrl-C
curl -s http://localhost:18080/healthz | jq .status
```

> "Backend pod killed, new one comes up in under a minute, healthz is green
> again. This is the baseline we build Tiers 1–4 on."

### 4:15 – 4:30 — Close

> "Tier 0 delivered the app — flashcards, fretboard, admin, first-party
> dependencies, health probe, pod-level resilience. Tier 1 puts CI/CD
> and signed images in front of this. Thanks for watching."

## Beats to cut if you run long

- Resilience section (4th priority)
- Custom tuning demo (keep the preset switch only)
- Second-user RBAC check (show only that first user is admin)
