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

### 0:45 – 1:55 — Flashcards as a guest

Browser → `/learn`:
1. Grid of topic cards — call out mastery dots (12/card) and accuracy %.
2. Click **Major Chords**.
3. Question stage: a chord-shape diagram renders below the question text.
   Call out the mini fretboard layout — root + chord type as the label,
   one voicing per row, all in the user's current tuning.
4. Answer one correctly — green feedback, explanation, Continue.
5. Answer one wrong — the feedback view shows two things side by side: the
   correct positions on the fretboard you just tapped, plus the chord-shape
   diagram with valid voicings. Framing: "The correct answer is…" — no
   punishment language.
6. Switch to an **Intervals** topic. The chord-shape diagram does not render
   here; intervals are key-agnostic and have no chord shape.
7. Click **Skip** — next card appears, no accuracy hit.
8. Finish a short session → summary (accuracy, streak, new/reviewed),
   non-blocking "Sign in to save your progress" prompt.

### 1:55 – 2:55 — Fretboard reference and shared tuning

Browser → `/fretboard`:
1. Standard 4-string bass, open strings G-D-A-E.
2. Click open **G** — every G on the board highlights cyan.
3. Scale dropdown → **Major**, key **C** — members filled, non-members dim,
   tonic in amber with a double ring. The distinction is not color-only;
   tonic shape differs for accessibility.
4. String-count button → **5** — fretboard re-renders instantly.
5. Tuning dropdown → **Drop D** — low string opens on D.
6. **Custom** → change one string inline — updates live.

Now navigate back to `/learn` and start a chord session. The chord-shape
diagram and the fret-tap input both render in the new 5-string Drop-D tuning.

> "One InstrumentContext, every fretboard view stays in sync. Switch your
> tuning once and the flashcards follow."

### 2:55 – 3:55 — Registration and admin

Browser → sign-in page:
1. Register a brand-new user. Log in.
2. Open avatar → **Admin Panel** is visible (first user auto-becomes admin).
3. Sidebar: Updates, Users, Tracks, License, Support.
4. Users table — show the admin row. Try to disable the current user →
   rejected: "cannot disable your own account."
5. Log out, register a second user, log in. No Admin Panel link in the
   avatar dropdown — RBAC works.

### 3:55 – 4:15 — Resilience beat (optional, can cut if tight)

Terminal:
```bash
kubectl -n groovelab delete pod -l app.kubernetes.io/component=backend
kubectl -n groovelab get pods -w   # let it come back, then Ctrl-C
curl -s http://localhost:18080/healthz | jq .status
```

> "Backend pod killed, new one comes up in under a minute, healthz is green
> again. This is the baseline we build Tiers 1–4 on."

### 4:15 – 4:30 — Close

> "Tier 0 delivered the app: flashcards with chord-shape hints, a fretboard
> reference, an admin panel, first-party dependencies, health probe,
> pod-level resilience, and tuning state shared across every view. Tier 1
> puts CI/CD and signed images in front of this. Thanks for watching."

## Beats to cut if you run long

- Resilience section (4th priority)
- Custom tuning inline edit (keep the preset switch only)
- Second-user RBAC check (show only that first user is admin)
- Tuning-follows-flashcards beat (mention in voiceover)

## Friction notes (for the voiceover, optional)

Three things in this stack look the way they do because we paid for them in
debugging time. Pick one if a beat runs short:

- The backend's `DB_HOST` points at `groovelab-postgresql-rw`, not
  `groovelab-postgresql`. CNPG creates `<cluster>-rw`, `<cluster>-r`, and
  `<cluster>-ro` services — never a plain `<cluster>` service.
  ([FRICTION_LOG.md Entry 18](../../FRICTION_LOG.md#entry-18--2026-04-17--blocker))
- The CNPG bootstrap secret has a `lookup` guard so the password survives
  `helm upgrade`. Without it, every upgrade rewrites the password and the
  backend fails authentication. ([Entry 9](../../FRICTION_LOG.md#entry-9--2026-04-16--annoyance))
- The frontend's `transformSessionCard` exists because the backend's wire
  shape and the React component's props diverged. The transform is the
  contract boundary. ([Entry 24](../../FRICTION_LOG.md#entry-24--2026-04-17--blocker))
