# DESIGN.md -- Groovelab

## Design Principles

1. **Learn by doing, not reading**: Every screen invites interaction. Theory is embedded in practice, not presented as walls of text.
2. **Progressive disclosure**: Start simple. Reveal complexity as the user demonstrates readiness. The app adapts to the learner, not the other way around.
3. **Transparency of progress**: The user should always know where they stand -- what they have mastered, what needs work, and what comes next. No black boxes.
4. **Offline-first**: Core learning and practice features work without any network connectivity. Connectivity unlocks distribution concerns (updates, license checks), not learning.
5. **Instrument-native thinking**: Every interaction is grounded in the physical reality of a bass guitar -- frets, strings, positions. Abstract music theory is always anchored to the instrument.
6. **Errors are teaching moments**: Wrong answers teach. Audio failures degrade gracefully. System errors are reported honestly. Nothing is silently swallowed.
7. **Dark by default, easy on the eyes**: The visual language of a practice room, not a classroom. Dark backgrounds reduce eye strain during long practice sessions.

---

## User Personas

### P1: Noa -- Beginner Bassist

| Attribute | Detail |
|-----------|--------|
| **Role** | Beginner learning music theory for bass guitar |
| **Goal** | Understand chord types, scales, and note positions across all 12 keys |
| **Frustration** | Traditional theory resources are abstract; hard to connect written theory to the fretboard |
| **Tech comfort** | Comfortable with web apps; not a developer |
| **Session pattern** | 10-20 minute daily study sessions; short bursts on mobile during breaks |
| **Success looks like** | "I can name the notes in a Bb major scale and find them on my bass without hesitating" |

### P2: Jordan -- Intermediate Bassist

| Attribute | Detail |
|-----------|--------|
| **Role** | Intermediate player who knows basics but wants structured practice |
| **Goal** | Create custom backing tracks to practice chord progressions and timing |
| **Frustration** | Existing practice tools are either too simple (metronome only) or too complex (full DAW) |
| **Tech comfort** | Uses multiple music apps; comfortable with sequencers and click tracks |
| **Session pattern** | 30-60 minute focused practice sessions; builds tracks then loops them |
| **Success looks like** | "I built a 12-bar blues in E and practiced my walking bassline over it for 20 minutes" |

### P3: Riley -- Replicated Evaluator

| Attribute | Detail |
|-----------|--------|
| **Role** | Bootcamp reviewer assessing rubric compliance across Tiers 0-7 |
| **Goal** | Verify all rubric requirements are met with real functionality, not stubs |
| **Frustration** | Submissions that look complete on paper but fall apart during hands-on testing |
| **Tech comfort** | Expert Kubernetes operator; evaluates Helm charts, RBAC, support bundles daily |
| **Session pattern** | Methodical walkthrough of each tier; installs, upgrades, breaks things, collects support bundles |
| **Success looks like** | "Every tier checks out. The app has real features, the SDK integration is correct, and the support tooling works" |

### P4: Sam -- Site Administrator

| Attribute | Detail |
|-----------|--------|
| **Role** | Operator who deploys and maintains the Groovelab instance |
| **Goal** | Keep the application running, updated, and users managed |
| **Frustration** | Admin tasks buried in Kubernetes CLI; no visibility into app health from within the application |
| **Tech comfort** | Kubernetes-literate; expects a web-based admin panel for routine tasks |
| **Session pattern** | Periodic check-ins; responds to update notifications; manages user accounts as needed |
| **Success looks like** | "I saw the update banner, applied the update from the admin panel, and verified everything is healthy" |

### P5: Casey -- Guest / Casual User

| Attribute | Detail |
|-----------|--------|
| **Role** | Curious visitor who found Groovelab and wants to try it without commitment |
| **Goal** | Explore flashcards, poke around the fretboard reference, maybe build a quick beat |
| **Frustration** | Apps that force account creation before showing any value |
| **Tech comfort** | Varies widely |
| **Session pattern** | One-off exploration; may return if the experience is good |
| **Success looks like** | "I tried a few flashcards and checked out the fretboard tool. Pretty cool. Maybe I will sign up to save my progress" |

---

## User Journeys

### J1: Guest Exploration (Casey)

```
Landing Page ──> Choose activity
   │
   ├── Learn ──> Flashcard session (no save) ──> "Sign in to save progress" prompt (non-blocking)
   │
   ├── Play ──> Build a quick track ──> Play along ──> "Sign in to save tracks" prompt (non-blocking)
   │
   ├── Fretboard ──> Explore notes and scales ──> Full functionality (no auth required)
   │
   └── [Guest can use all features except: saving progress, saving tracks, export]
```

**Key design decisions:**
- No sign-in wall. The landing page leads directly to activities.
- Save/export prompts appear contextually (after a session ends, when tapping "save"), never as pop-up interruptions.
- Guest sessions are ephemeral -- progress exists only for the current browser session.

### J2: Learner Progression (Noa)

```
Sign in ──> Home (dashboard) ──> Learn
   │
   ├── Pick topic (e.g., "Major Chord Tones")
   │     │
   │     ├── Flashcard: "What are the notes in a C major chord?" ──> Multiple choice (beginner)
   │     │     │
   │     │     ├── Correct ──> Positive feedback ──> Next card
   │     │     └── Wrong ──> Teaching moment: show correct answer + explanation ──> Re-queue card
   │     │
   │     ├── [After mastery threshold] ──> Input method advances to typed answers
   │     │
   │     └── [After higher threshold] ──> Input method advances to fretboard tap
   │
   ├── Progress dashboard ──> View mastery by topic, streaks, accuracy
   │
   └── Fretboard reference ──> Look up any note/scale/chord position
```

### J3: Practice Session (Jordan)

```
Sign in ──> Home ──> Play
   │
   ├── Chord picker ──> Select chords (e.g., E7, A7, B7)
   │     │
   │     └── Sequence chords ──> Arrange in order with duration per chord
   │
   ├── Drum rack ──> Program a beat on the step sequencer grid
   │     │
   │     └── Fixed kit: kick, snare, hi-hat, toms, crash, ride
   │
   ├── Playback controls ──> Set BPM (tap tempo or type), toggle metronome, set count-in, define loop
   │
   └── Play ──> Playback screen:
         │
         ├── Large chord name display (current chord, prominent)
         ├── Fretboard overlay (toggleable, shows chord tones)
         ├── Timeline bar (progress through sequence)
         ├── Drum pattern visualization (step grid, current step highlighted)
         └── Transport controls (play/pause/stop, loop toggle, tempo)
```

### J4: Administration (Sam)

```
Sign in (admin role) ──> Admin panel (via nav link, visible only to admins)
   │
   ├── App Updates ──> View current version, available updates, apply update
   │
   ├── User Management ──> List users, view progress, disable/enable accounts
   │
   ├── Track Administration ──> View saved tracks across users, moderate content
   │
   ├── License Status ──> View license details, entitlements, expiry
   │
   └── Support ──> Generate support bundle, upload to vendor portal
```

### J5: Replicated Evaluation (Riley)

```
Install via Helm or EC ──> Verify health endpoint
   │
   ├── Check update banner ──> Navigate to admin ──> Apply update
   ├── Verify license enforcement ──> Try gated feature without entitlement ──> See locked state
   ├── Generate support bundle from UI ──> Download/upload
   ├── Test air-gap install ──> Verify zero outbound traffic
   ├── Verify preflight checks ──> Run preflights ──> See pass/fail
   └── Test config screen ──> Change settings ──> Verify they take effect
```

---

## Information Architecture and Navigation

### Primary Navigation

A persistent top navigation bar with five sections:

```
┌──────────────────────────────────────────────────────────────┐
│  [GL logo]   Home    Learn    Play    Fretboard    [avatar]  │
└──────────────────────────────────────────────────────────────┘
```

| Nav Item | Description |
|----------|-------------|
| **Home** | Dashboard: recent activity, progress summary, quick-start cards |
| **Learn** | Flashcard-based theory drilling with adaptive delivery |
| **Play** | Practice track builder: chord sequencer + drum rack + playback |
| **Fretboard** | Interactive fretboard reference tool |
| **Avatar** | User menu: settings, sign in/out, admin panel (if admin) |

**Guest state:** Avatar shows a generic icon with "Sign in" link. All four main sections are accessible.

**Admin visibility:** The admin panel link appears only in the avatar dropdown menu for users with the admin role. It is not a primary nav item.

### Update Banner

When an update is available (detected via Replicated SDK), a subtle, dismissible banner appears at the top of every page:

```
┌──────────────────────────────────────────────────────────────┐
│  A new version of Groovelab is available. [View in Admin →]  │
└──────────────────────────────────────────────────────────────┘
```

- Background color: muted accent (not red, not alarming). Informational tone.
- Appears on all pages. Dismissible per session (returns on next session if update is still pending).
- "View in Admin" links to the admin panel updates section.
- Non-admin users see: "A new version is available. Contact your administrator."

---

## Learn Mode

### Overview

Learn mode is a flashcard-based drilling system covering chord types, scales, and note positions across all 12 keys. Cards are delivered adaptively based on user performance.

### Topic Selection

On entering Learn, the user sees a grid of topic cards:

```
┌───────────────────────────────────────────┐
│  Learn                                     │
│                                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │ Major   │ │ Minor   │ │ Dom 7th │     │
│  │ Chords  │ │ Chords  │ │ Chords  │     │
│  │ ●●●○○   │ │ ●●○○○   │ │ ○○○○○   │     │
│  └─────────┘ └─────────┘ └─────────┘     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │ Maj 7th │ │ Min 7th │ │  Scales │     │
│  │ Chords  │ │ Chords  │ │         │     │
│  │ ○○○○○   │ │ ○○○○○   │ │ ○○○○○   │     │
│  └─────────┘ └─────────┘ └─────────┘     │
│                                           │
│  ● = mastered    ○ = not started          │
└───────────────────────────────────────────┘
```

Each topic card shows:
- Topic name
- Mastery indicator (filled/empty dots representing progress across the 12 keys)
- Inline accuracy percentage (e.g., "87% accuracy")

### Card Directions

Every flashcard concept supports two directions:

| Direction | Example |
|-----------|---------|
| **Name to notes** | "What are the notes in a G major chord?" -- answer: G, B, D |
| **Notes to name** | "G, B, D form which chord?" -- answer: G major |

Both directions appear in the card pool. The adaptive algorithm treats them as independent mastery items -- a user may master one direction before the other.

### Adaptive Input Method Progression

The app selects the input method based on the user's mastery stage for each card. Users do not choose their input method -- the system adapts.

| Mastery Stage | Input Method | Description |
|---------------|-------------|-------------|
| **New / Struggling** | Multiple choice (4 options) | Lowest barrier. Recognition-based. One correct answer, three plausible distractors. |
| **Developing** | Reduced multiple choice (3 options) | Slightly harder. Fewer options to guess from. |
| **Proficient** | Typed answer | Recall-based. User types note names (e.g., "G B D"). Forgiving parser: accepts various formats, case-insensitive, order-insensitive where musically appropriate. |
| **Advanced** | Fretboard tap | User taps the correct positions on an interactive fretboard diagram. Most instrument-native method. |

**Progression rules:**
- Advancement requires N consecutive correct answers at the current stage (threshold TBD by algorithm, suggested starting point: 3).
- Regression: two consecutive wrong answers at any stage drops the user back one stage for that card.
- The mastery stage is per-card, per-direction. A user might be at "proficient" for "name the notes in C major" but still at "developing" for "what chord is C E G?"

### Wrong Answer Flow (Teaching-First)

When the user answers incorrectly:

1. **Show the correct answer prominently** -- not just "Wrong!" but the full correct answer displayed clearly.
2. **Show a brief explanation** -- contextual teaching. For example: "A C major chord contains C, E, and G -- the 1st, 3rd, and 5th of the C major scale."
3. **Highlight on fretboard** -- if the card involves note positions, show the correct positions on a mini fretboard diagram within the feedback area.
4. **Re-queue the card** -- the card returns to the session queue, appearing again soon (not immediately, to avoid rote clicking, but within the next few cards).
5. **No punishment framing** -- language is neutral and instructive. "The correct answer is..." not "You got it wrong."

### Flashcard Session Screen

```
┌──────────────────────────────────────────────────────────┐
│  Learn > Major Chords          Session: 8/20   ●●●●○○○  │
│──────────────────────────────────────────────────────────│
│                                                          │
│              What are the notes in                       │
│              an Eb major chord?                          │
│                                                          │
│  ┌────────────┐ ┌────────────┐                          │
│  │  Eb G Bb   │ │  Eb Gb Bb  │                          │
│  └────────────┘ └────────────┘                          │
│  ┌────────────┐ ┌────────────┐                          │
│  │  Eb Ab Bb  │ │  E G# B    │                          │
│  └────────────┘ └────────────┘                          │
│                                                          │
│──────────────────────────────────────────────────────────│
│  [Skip]                              Streak: 5 correct  │
└──────────────────────────────────────────────────────────┘
```

**Correct answer feedback:**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              ✓ Correct!                                  │
│                                                          │
│              Eb major: Eb, G, Bb                         │
│              (1, 3, 5 of the Eb major scale)             │
│                                                          │
│  [Continue]                                              │
└──────────────────────────────────────────────────────────┘
```

**Wrong answer feedback (teaching moment):**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              The correct answer is:                      │
│              Eb, G, Bb                                   │
│                                                          │
│              An Eb major chord uses the 1st, 3rd,        │
│              and 5th of the Eb major scale.              │
│              The 3rd is G (natural), not Gb.             │
│                                                          │
│              ┌──── mini fretboard ────┐                  │
│              │  showing Eb, G, Bb     │                  │
│              │  positions on bass     │                  │
│              └────────────────────────┘                  │
│                                                          │
│  [Got it]                                                │
└──────────────────────────────────────────────────────────┘
```

### Typed Answer Input (Proficient Stage)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              What are the notes in                       │
│              an A minor chord?                           │
│                                                          │
│              ┌──────────────────────────────┐            │
│              │  Type note names...          │            │
│              └──────────────────────────────┘            │
│              [Submit]                                    │
│                                                          │
│              Accepts: "A C E", "a, c, e", "A,C,E"       │
└──────────────────────────────────────────────────────────┘
```

- Parser is forgiving: case-insensitive, accepts commas or spaces as separators.
- For chord-name answers (notes-to-name direction): accepts common variations ("Amin", "Am", "A minor", "A min").
- Order-insensitive where musically appropriate (chord tones can be in any order; scale degrees should be in order).

### Fretboard Tap Input (Advanced Stage)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              Tap the notes of a C major                  │
│              chord on the fretboard:                     │
│                                                          │
│  ┌──────────────────────────────────────────────┐        │
│  │  G ──●──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  │  D ──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  │  A ──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  │  E ──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  └──────────────────────────────────────────────┘        │
│                                                          │
│  Tapped: C (3rd fret, A string)                         │
│  [Submit]   [Clear]                                     │
└──────────────────────────────────────────────────────────┘
```

- The fretboard renders according to the user's instrument/tuning settings (defaulting to 4-string bass, EADG).
- Tapped notes highlight with a distinct color.
- User must tap one valid position for each chord/scale tone, then submit.
- Partial credit is not given -- all required tones must be present and correct.

---

## Play Mode

### Overview

Play mode is a practice track builder combining a chord sequencer, step-sequencer drum rack, and audio playback powered by the Web Audio API. The user builds a track, then plays along with it.

### Build Screen Layout

The build screen has three vertically stacked panels:

```
┌──────────────────────────────────────────────────────────┐
│  Play > Build Track                        [Play ▶]     │
│──────────────────────────────────────────────────────────│
│                                                          │
│  CHORD SEQUENCE                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ [+]     │
│  │  E7  │ │  A7  │ │  E7  │ │  B7  │ │  A7  │         │
│  │ 4 bar│ │ 2 bar│ │ 2 bar│ │ 1 bar│ │ 1 bar│         │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         │
│                                                          │
│──────────────────────────────────────────────────────────│
│                                                          │
│  DRUM RACK                                              │
│          │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ ...│16│   │
│  Kick    │[●]│   │   │   │[●]│   │   │   │    │  │   │
│  Snare   │   │   │   │   │[●]│   │   │   │    │  │   │
│  Hi-hat  │[●]│   │[●]│   │[●]│   │[●]│   │    │  │   │
│  Tom Hi  │   │   │   │   │   │   │   │   │    │  │   │
│  Tom Lo  │   │   │   │   │   │   │   │   │    │  │   │
│  Crash   │[●]│   │   │   │   │   │   │   │    │  │   │
│  Ride    │   │   │   │   │   │   │   │   │    │  │   │
│                                                          │
│──────────────────────────────────────────────────────────│
│                                                          │
│  PLAYBACK CONTROLS                                      │
│  BPM: [120] [Tap Tempo]  [♩ Metronome: ON]             │
│  Count-in: [1 bar ▼]     Loop: [Entire track ▼]        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Chord Picker and Sequencer

The chord sequence area lets users build a progression:

**Adding a chord:**
1. Tap the [+] button at the end of the sequence.
2. A chord picker modal opens:

```
┌──────────────────────────────────────────────┐
│  Pick a Chord                                │
│                                              │
│  Root:  C  C#  D  Eb  E  F  F#  G  Ab  A  Bb B │
│         [E selected]                         │
│                                              │
│  Type:  Major  Minor  Dom7  Maj7  Min7       │
│         Dim  Aug                             │
│         [Dom7 selected]                      │
│                                              │
│  Duration: [4] bars                          │
│                                              │
│  Preview: E7 (E, G#, B, D)                  │
│                                              │
│  [Cancel]                    [Add to Track]  │
└──────────────────────────────────────────────┘
```

- Root note selection: 12 chromatic notes, displayed as buttons.
- Chord type selection: list of available chord qualities.
- Duration: number of bars (integer input, minimum 1).
- Preview: shows the selected chord name and its constituent notes.
- The picker uses standard music notation (flats vs sharps follow common convention per key).

**Editing a chord:** Tap an existing chord block in the sequence to edit its root, type, or duration. Long-press or right-click to delete.

**Reordering:** Drag-and-drop to rearrange chord blocks within the sequence.

### Step Sequencer Drum Rack

A grid-based step sequencer with a fixed kit:

| Instrument | Role |
|-----------|------|
| Kick | Bass drum |
| Snare | Snare drum |
| Hi-hat (closed) | Closed hi-hat |
| Hi-hat (open) | Open hi-hat |
| Tom High | High tom |
| Tom Low | Low/floor tom |
| Crash | Crash cymbal |
| Ride | Ride cymbal |

**Grid behavior:**
- Default: 16 steps per bar (16th-note resolution).
- Each cell is a toggle: tap to activate/deactivate.
- Active steps show as filled circles; inactive as empty.
- A per-instrument volume slider on the left edge of each row (simple, not dominant).
- The grid scrolls horizontally if the pattern exceeds screen width.
- The pattern loops for the duration of the track. One bar of drum pattern repeats across the entire chord sequence.

**Visual feedback during playback:** The current step column highlights as the pattern plays, providing visual confirmation of timing.

### Playback Controls

| Control | Behavior |
|---------|----------|
| **BPM** | Numeric input field (40-300 range). Direct entry or tap-tempo button. |
| **Tap Tempo** | Tap the button rhythmically. After 4+ taps, BPM is calculated from the average interval. Visual pulse feedback on each tap. |
| **Metronome** | Toggle on/off. When on, a click track plays alongside the drum pattern. |
| **Count-in** | Dropdown: None, 1 bar, 2 bars. Metronome clicks play for the count-in duration before the track begins. |
| **Loop section** | Dropdown: Entire track, or select a range of chord blocks to loop. |

### Playback Screen

When the user presses Play, the build screen transitions to the playback screen:

```
┌──────────────────────────────────────────────────────────┐
│  Play > Now Playing                          [■ Stop]    │
│──────────────────────────────────────────────────────────│
│                                                          │
│                         E7                               │
│                   (large, centered)                      │
│                                                          │
│  ┌──────────────────────────────────────────────┐        │
│  │             [Fretboard: E7 tones]            │        │
│  │  G ──┼──┼──┼──●──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  │  D ──┼──●──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  │  A ──┼──┼──┼──┼──┼──┼──●──┼──┼──┼──┼──┼──  │        │
│  │  E ──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──  │        │
│  └──────────────────────────────────────────────┘        │
│  [Toggle fretboard]                                     │
│                                                          │
│  ┌──────────────────────────────────────────────┐        │
│  │ E7 ████████████░░░ │ A7 ░░░░░░░░ │ B7 ░░░░ │        │
│  └──────────────────────────────────────────────┘        │
│  Timeline: chord blocks as segments, playhead moving     │
│                                                          │
│  BPM: 120  │  Bar 3 of 10  │  ▶ Playing  │  🔁 Loop   │
└──────────────────────────────────────────────────────────┘
```

**Layout hierarchy (top to bottom):**

1. **Current chord name** -- the largest element on screen. Clearly readable from a distance (the user is looking at their bass, glancing at the screen). Large, bold, high-contrast text.
2. **Fretboard overlay** -- toggleable. When visible, shows the tones of the current chord highlighted on a fretboard matching the user's instrument/tuning settings. Tonic is shown in anchor color.
3. **Timeline** -- horizontal bar segmented by chord blocks. A playhead (vertical line) moves across in real-time. The current chord segment is highlighted. Upcoming chords are visible for anticipation.
4. **Transport bar** -- BPM, current bar/total, play/pause/stop, loop indicator.

**The fretboard overlay updates in real-time** as the chord changes during playback, always reflecting the current chord's tones.

---

## Fretboard Reference Tool

### Overview

A standalone interactive fretboard tool for exploring notes, scales, and chord positions. Fully functional without authentication.

### Tuning Configurator

```
┌──────────────────────────────────────────────────────────┐
│  Fretboard Reference                                     │
│──────────────────────────────────────────────────────────│
│                                                          │
│  Instrument: [4-string bass ▼]  Tuning: [Standard ▼]    │
│                                                          │
│  String count: 4 / 5 / 6 (toggle buttons)               │
│  Tuning preset: Standard / Drop D / Half-step down /    │
│                  Custom                                  │
│                                                          │
│  Custom tuning (if selected):                            │
│  String 1 (lowest): [E ▼]                               │
│  String 2:          [A ▼]                                │
│  String 3:          [D ▼]                                │
│  String 4 (highest):[G ▼]                                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**String count options:** 4-string, 5-string, 6-string bass.

**Tuning presets by string count:**

| Strings | Presets |
|---------|---------|
| 4-string | Standard (EADG), Drop D (DADG), Half-step down (Eb Ab Db Gb) |
| 5-string | Standard (BEADG), Drop A (ABEADG -- if applicable) |
| 6-string | Standard (BEADGC), Custom entry (e.g., BEADGC for user's 6-string bass) |

**Custom tuning:** Each string's note is selectable from a dropdown of all chromatic notes.

**Persistence:** Authenticated users' tuning preferences are saved as their default. Guests use 4-string standard until changed.

### Fretboard Display

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Fret: 0  1  2  3  4  5  6  7  8  9  10 11 12          │
│  G ── G  Ab  A  Bb  B  C  Db  D  Eb  E  F  Gb  G       │
│  D ── D  Eb  E  F  Gb  G  Ab  A  Bb  B  C  Db  D       │
│  A ── A  Bb  B  C  Db  D  Eb  E  F  Gb  G  Ab  A       │
│  E ── E  F  Gb  G  Ab  A  Bb  B  C  Db  D  Eb  E       │
│                                                          │
│  Scale/chord filter: [None ▼]                            │
│  Key: [C ▼]                                              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Frets 0 (open) through 12 (or more, depending on display width).
- Horizontal scroll for frets beyond the visible area, or a configurable fret range.
- Fret markers at standard positions (3, 5, 7, 9, 12).
- Note names displayed at each fret intersection.

### Note Tap Interaction

When the user taps any note on the fretboard:

1. **All occurrences highlight**: every position on the fretboard where that note appears lights up in a distinct highlight color.
2. **Tonic anchor**: the tonic (the 1 of the currently selected scale/key, or the tapped note itself if no scale is selected) is always shown in a separate anchor color. This gives the user a reference point -- "where is the root relative to this note?"
3. **Note info panel**: a small info area below the fretboard shows the tapped note name and its interval relationship to the tonic (e.g., "Bb -- flat 7th of C").

**Color system:**
- **Default note**: muted/subtle (visible but not prominent).
- **Tapped note (all occurrences)**: bright highlight color (e.g., cyan/teal).
- **Tonic (1 of scale)**: anchor color (e.g., warm amber/gold), always visible when a key is selected.
- **Scale/chord tones** (when a filter is active): secondary highlight distinguishing chord/scale members from non-members.

### Scale and Chord Overlay

When a scale or chord filter is selected:

- All notes belonging to that scale/chord in the selected key are highlighted.
- Non-member notes are dimmed but remain visible and tappable.
- The tonic is always in anchor color.
- Tapping a non-member note still shows all its occurrences, but the tonic anchor remains visible for context.

---

## Adaptive Mastery Model UX

### Overview

The mastery system is transparent. The user always knows their progress, what they have mastered, and what needs work. No hidden scores or opaque algorithms.

### Mastery Metrics (Per Card, Per Direction)

| Metric | Description | Visibility |
|--------|-------------|------------|
| **Accuracy** | Percentage of correct answers (all time) | Shown inline on topic cards and in dashboard |
| **Current streak** | Consecutive correct answers | Shown during flashcard sessions |
| **Best streak** | Longest consecutive correct streak | Shown in dashboard |
| **Mastery stage** | Current input method stage (New/Developing/Proficient/Advanced) | Shown as a label on topic detail views |
| **Last practiced** | Timestamp of last interaction | Shown in dashboard |

### Progress Dashboard

Accessible from the Home screen or via a "Progress" link in Learn mode.

```
┌──────────────────────────────────────────────────────────┐
│  Your Progress                                           │
│──────────────────────────────────────────────────────────│
│                                                          │
│  Overall Accuracy: 78%    Current Streak: 12 days        │
│  Cards Mastered: 34/96    Best Streak: 18 days           │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Mastery by Topic                                │     │
│  │                                                  │     │
│  │  Major Chords    ████████████████░░  89%         │     │
│  │  Minor Chords    ██████████░░░░░░░░  62%         │     │
│  │  Dom 7th Chords  ████░░░░░░░░░░░░░░  28%         │     │
│  │  Maj 7th Chords  ░░░░░░░░░░░░░░░░░░   0%         │     │
│  │  Min 7th Chords  ░░░░░░░░░░░░░░░░░░   0%         │     │
│  │  Scales          ██████████████░░░░  74%         │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Weak Areas (needs practice)                     │     │
│  │                                                  │     │
│  │  - Eb minor chord tones (42% accuracy)          │     │
│  │  - F# dom7 to name (38% accuracy)              │     │
│  │  - Bb major scale on fretboard (50% accuracy)   │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Inline Indicators

Throughout the app, mastery information is shown contextually:

- **Topic selection cards** (Learn): mastery dots + accuracy percentage.
- **During flashcard sessions**: current streak counter, session progress (e.g., "8 of 20").
- **Fretboard reference**: when a user has practiced a scale, a subtle "practiced" badge may appear near the scale filter option (reinforcing that they have worked on it).

### Streak System

- **Daily practice streak**: increments when the user completes at least one flashcard session per day.
- **Session streak**: consecutive correct answers within a session (resets on wrong answer or session end).
- **Streak display**: daily streak shown on Home dashboard; session streak shown during flashcard sessions.
- **No punitive language**: missing a day resets the streak counter, but the UI does not shame. A simple "Start a new streak today" message.

---

## Admin Panel

### Access

- Visible only to users with the admin role.
- Accessed via the avatar dropdown menu: "Admin Panel".
- A separate set of pages, not a mode toggle. The admin panel has its own navigation sidebar.

### Admin Navigation

```
┌──────────────────────────────────────────────────────────┐
│  Admin Panel                              [← Back to App]│
│──────────────────────────────────────────────────────────│
│  │                                                       │
│  │ Updates        │  [Content area]                      │
│  │ Users          │                                      │
│  │ Tracks         │                                      │
│  │ License        │                                      │
│  │ Support        │                                      │
│  │                │                                      │
└──────────────────────────────────────────────────────────┘
```

### Admin Sections

#### Updates

- **Current version**: displayed prominently.
- **Available update**: version number, release notes summary.
- **Update action**: "Apply Update" button (triggers Replicated update flow).
- **Update history**: list of previously applied updates with timestamps.

#### User Management

- **User list**: table with username, email, role, last active, account status (enabled/disabled).
- **Actions**: enable/disable account, assign/revoke admin role, view user's progress summary.
- **No user deletion in v1**: disable only, to preserve data integrity.

#### Track Administration

- **Track list**: all saved tracks across all users. Table with track name, creator, created date, chord count.
- **Actions**: view track details, delete track (with confirmation).
- **Purpose**: moderation and cleanup, not editing other users' tracks.

#### License Status

- **License details**: license ID, type, expiry date, entitlements list.
- **Entitlement status**: for each entitlement, show enabled/disabled and what feature it gates.
- **License health**: visual indicator (green/yellow/red) based on license validity and expiry proximity.

#### Support

- **Generate support bundle**: button that triggers bundle collection from the running app.
- **Bundle status**: progress indicator during collection.
- **Upload to vendor portal**: button to upload the generated bundle to Replicated Vendor Portal via SDK.
- **Bundle history**: list of previously generated bundles with timestamps.

### Per-User Settings

Accessible from the avatar dropdown menu for all authenticated users (not admin-only).

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                                │
│──────────────────────────────────────────────────────────│
│                                                          │
│  Instrument                                              │
│  String count: [4] [5] [6]                               │
│  Tuning preset: [Standard ▼]                             │
│  Custom tuning: (appears if "Custom" selected)           │
│                                                          │
│  Theme                                                   │
│  [Dark ●] [Light ○]                                      │
│                                                          │
│  Account                                                 │
│  Email: ada@example.com                                  │
│  Connected: Google ✓, GitHub ✓                           │
│  [Change password]                                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Instrument and tuning defaults apply everywhere: fretboard reference, flashcard fretboard tap input, playback fretboard overlay.
- Changes take effect immediately (no "save" button needed -- auto-save with visual confirmation).

---

## Replicated Surfaces

### Update Banner (All Pages)

As described in the navigation section: a subtle, non-alarming banner at the top of every page when an update is available. Links to the admin panel for admins; informational message for non-admins.

### License Status

- **Admin panel**: dedicated license section with full details.
- **Health endpoint**: `/healthz` includes license validity check (for Kubernetes probes and Replicated evaluation).
- **In-app**: no license nag for end users. License is an operator concern, surfaced only in the admin panel.

### Support Bundle Upload

- **Admin panel > Support section**: generate and upload support bundles from the UI.
- **Not exposed to non-admin users**: support tooling is an operator workflow.

### Entitlement Gate UX

Features gated by license entitlements (e.g., practice track save/export) follow a consistent pattern:

```
┌─────────────────────────────────────────────┐
│                                              │
│  [🔒] Export Track                           │
│                                              │
│  Tooltip: "Track export requires a           │
│  Pro license entitlement. Contact your       │
│  administrator."                             │
│                                              │
└─────────────────────────────────────────────┘
```

- **Locked icon**: a small lock icon appears next to the gated feature's button/control.
- **Tooltip on hover/tap**: explains what entitlement is required and who to contact.
- **The feature is visible but not usable**: the user can see it exists (discoverability), but cannot activate it without the entitlement. This is preferable to hiding the feature entirely, which would make the entitlement gate invisible to evaluators.
- **No error modal or blocking dialog**: just the lock icon and tooltip. Minimal friction.

---

## Authentication UX

### Guest Mode (Default)

- The app opens without any sign-in requirement.
- All core features are available: Learn (flashcards), Play (track builder + playback), Fretboard (reference tool).
- Progress is not persisted. Guest sessions are ephemeral (browser session only).
- Saved tracks and progress persistence require authentication.

### Sign-In Prompts

Sign-in prompts appear contextually and non-intrusively:

| Trigger | Prompt |
|---------|--------|
| End of a flashcard session (guest) | "Sign in to save your progress and pick up where you left off." |
| Tapping "Save Track" (guest) | "Sign in to save tracks to your account." |
| Home dashboard (guest) | "Sign in to track your learning progress over time." |

Prompts are inline text with a "Sign in" link, not modal dialogs or pop-ups.

### Sign-In Screen

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                    Sign in to Groovelab                  │
│                                                          │
│  ┌──────────────────────────────────────┐                │
│  │  Continue with Google                │                │
│  └──────────────────────────────────────┘                │
│  ┌──────────────────────────────────────┐                │
│  │  Continue with GitHub                │                │
│  └──────────────────────────────────────┘                │
│                                                          │
│  ──────────── or ────────────                            │
│                                                          │
│  Email:    [________________________]                    │
│  Password: [________________________]                    │
│  [Sign in]                                               │
│                                                          │
│  Don't have an account? [Create one]                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- OAuth providers (Google, GitHub) are prominent -- large buttons at the top.
- Local account (email/password) is available below.
- Account creation is a separate form with email, password, and password confirmation.
- After sign-in, the user returns to exactly where they were.

---

## Responsive Design

### Breakpoint Strategy

| Breakpoint | Target | Layout Behavior |
|------------|--------|----------------|
| **Desktop** (>1024px) | Primary target | Full layout: side-by-side panels, full fretboard width, comfortable step sequencer grid |
| **Tablet** (768-1024px) | Secondary | Stacked panels, slightly compressed fretboard, horizontal scroll on step sequencer |
| **Phone** (<768px) | Tertiary | Single-column, fretboard in portrait scrolls horizontally, step sequencer is minimal (consider 8-step view with paging) |

### Key Responsive Decisions

- **Fretboard**: on narrow screens, show fewer frets with horizontal scroll. Fret labels remain visible.
- **Step sequencer**: on phone, reduce to 8 visible steps with page navigation (page 1: steps 1-8, page 2: steps 9-16). Or allow horizontal scroll.
- **Chord sequence**: wraps to multiple rows on narrow screens.
- **Playback screen**: chord name remains large. Fretboard overlay is toggleable (default off on phone to save space). Timeline compresses.
- **Navigation**: on phone, the top nav collapses to a hamburger menu.
- **Flashcard sessions**: work well at all sizes -- card content is centered and text-focused.

---

## Visual Design System

### Color Foundation

| Token | Purpose | Dark Mode | Light Mode |
|-------|---------|-----------|------------|
| `bg-primary` | Page background | #1a1a2e | #f5f5f5 |
| `bg-surface` | Card/panel backgrounds | #16213e | #ffffff |
| `bg-elevated` | Modals, dropdowns | #0f3460 | #f0f0f0 |
| `text-primary` | Body text | #e0e0e0 | #1a1a1a |
| `text-secondary` | Labels, hints | #a0a0b0 | #666666 |
| `accent-primary` | Interactive elements, buttons | #53d8fb (cyan) | #0077cc |
| `accent-correct` | Correct answers, positive states | #4ecca3 (green) | #2d8a56 |
| `accent-wrong` | Wrong answers, error states | #e84545 (muted red) | #cc3333 |
| `accent-tonic` | Tonic/root note anchor | #f0a500 (amber/gold) | #cc8800 |
| `accent-highlight` | Note highlighting, active states | #53d8fb (cyan) | #0077cc |
| `accent-locked` | Entitlement-gated features | #888899 | #999999 |
| `update-banner` | Update notification background | #2a2a4a | #e8e8ff |

### Typography

- **Headings**: Sans-serif, bold. Clean and modern.
- **Body**: Sans-serif, regular weight. High readability.
- **Chord names (playback)**: Extra-large (3-4rem on desktop), bold. Must be readable from arm's length.
- **Note names (fretboard)**: Monospace or tabular-number font for alignment consistency.
- **Code/technical (admin panel)**: Monospace for version numbers, license IDs.

### Design Aesthetic

The visual language is a "study app for musicians" -- not a flashy game, not a sterile tool.

- **Dark mode by default**: reduces eye strain during evening practice sessions. Feels like a practice room.
- **Light mode available**: for daytime use, outdoor settings, or accessibility preference.
- **Rounded corners**: moderate radius (8px) on cards and buttons. Friendly, not sharp.
- **Subtle shadows**: on dark mode, use lighter border treatments instead of shadows. On light mode, soft shadows.
- **Minimal animation**: transitions on page navigation and card flips. Step sequencer highlighting is snappy, not animated. Audio-related interactions prioritize responsiveness over visual flair.
- **No decorative elements**: every visual element serves a purpose. No background patterns, gradients, or ornamental graphics.

---

## Accessibility

### Color-Blind Friendly Design

- The fretboard color system does not rely solely on color to distinguish states. Each state also has a shape or pattern difference:
  - **Tonic**: amber/gold color + slightly larger circle or distinct border (double ring).
  - **Highlighted note**: cyan color + filled circle.
  - **Dimmed note**: gray + smaller or unfilled circle.
  - **Active step (sequencer)**: filled circle; inactive: empty circle (not just color difference).
- Correct/wrong answer feedback uses color + icon (checkmark / X) + text label.
- The update banner includes text, not just color, to communicate its purpose.

### Keyboard Navigation

- All interactive elements are reachable via Tab key.
- Flashcard answer selection: arrow keys to navigate choices, Enter to select.
- Step sequencer: arrow keys to move between cells, Space/Enter to toggle.
- Fretboard: arrow keys to move between fret positions, Enter to select/tap.
- Chord picker: Tab between root, type, and duration fields.
- Focus indicators: visible focus rings on all interactive elements (not browser default -- custom styled for visibility on dark backgrounds).
- Skip-to-content link for screen reader users.

### Screen Reader Support

- All images and icons have meaningful alt text.
- Fretboard: each position is an ARIA-labeled button (e.g., "A string, 3rd fret, C").
- Step sequencer: each cell is labeled (e.g., "Kick, step 5, active").
- Flashcard questions and answers are live regions that update screen readers on state change.
- Chord names during playback are announced as they change (ARIA live region).
- Progress bars and mastery indicators use `aria-valuenow` and `aria-valuemax`.
- Modal dialogs (chord picker, sign-in) trap focus and are properly labeled.

### Motion and Audio

- Respect `prefers-reduced-motion`: disable all non-essential animations when the user's OS setting requests it.
- Audio is never auto-played. All audio requires explicit user action (pressing Play, starting a flashcard session with audio).
- Visual-only fallback (see Offline / Audio Failure section) ensures the app remains usable without audio.

---

## Offline / Airgap Behavior

### Core Offline Functionality

Groovelab must support fully airgapped installations. The following features work without any network connectivity:

| Feature | Offline Status | Notes |
|---------|---------------|-------|
| Flashcard drilling | Fully functional | All card data is bundled with the app |
| Fretboard reference | Fully functional | Computed from tuning + music theory logic, no external data |
| Track builder | Fully functional | Web Audio API is browser-native |
| Playback | Fully functional | All drum samples are bundled; synthesis is local |
| Progress tracking | Fully functional | Reads/writes to local database |
| Authentication | Fully functional (local accounts) | OAuth requires connectivity for initial auth flow |
| Theme switching | Fully functional | CSS-only |

### Features Requiring Connectivity

| Feature | Connectivity Required | Behavior When Offline |
|---------|-----------------------|----------------------|
| Replicated license check | Yes (periodic) | App continues to function with cached license status. If license has never been validated, a warning appears in the admin panel only. |
| Replicated update check | Yes | Update banner does not appear. Admin panel shows "Unable to check for updates -- no connectivity." |
| Support bundle upload | Yes (upload only) | Bundle generation works offline. Upload button is disabled with tooltip: "Upload requires network connectivity. Download the bundle locally instead." A local download option is always available. |
| OAuth sign-in | Yes (initial flow) | OAuth buttons show tooltip: "OAuth sign-in requires network connectivity. Use a local account." Local account sign-in works offline. |

### Audio Failure Handling

When Web Audio API is unavailable (unsupported browser, hardware issue, autoplay policy blocking):

1. **Detection**: on app load, Groovelab attempts to initialize the Web Audio context. If it fails, the app enters visual-only mode.
2. **User notification**: a persistent, dismissible banner appears on Play-related pages: "Audio playback is unavailable. The app will display chord changes and timing visually. [Learn more]"
3. **Visual-only fallback**:
   - Playback screen shows chord changes on the timeline and large chord display, advancing in real-time based on BPM.
   - Step sequencer shows the current step highlighting without audio.
   - Metronome is replaced by a visual pulse (flashing element on each beat).
4. **No silent failures**: if audio was previously working and stops mid-session (e.g., hardware disconnect), an inline error appears: "Audio playback interrupted. Check your audio output." The session pauses; the user can resume or switch to visual-only mode.
5. **Retry**: a "Retry audio" button is available in the banner, which attempts to re-initialize the Web Audio context.

---

## System Boundaries for Changeability

These are the key abstraction boundaries advocated from a design perspective to support future changes without redesigning the experience.

### Instrument Abstraction

v1 is bass-only, but the UX is designed so that adding guitar, ukulele, or other fretted instruments requires only:
- New tuning presets.
- New default fret range.
- No changes to the flashcard engine, fretboard renderer, or mastery model.

The instrument is a configuration, not a hard-coded assumption.

### Input Method Abstraction

The adaptive input method progression (multiple choice -> typed -> fretboard tap) is designed as a pluggable system. Adding new input methods (e.g., audio recognition -- "play the note on your bass") should require adding a new input handler, not modifying existing ones.

### Content Abstraction

Flashcard content (chord types, scales, keys) is data, not code. Adding new chord types, scales, or keys should be a content addition, not a code change. The UI renders whatever content the data layer provides.

### Drum Kit Abstraction

v1 uses a fixed kit. The UX accommodates future user-uploadable samples by treating the kit as a named list of instruments with associated audio sources. The step sequencer grid does not assume a specific number of instruments.

### Entitlement Abstraction

Features gated by Replicated entitlements are identified by entitlement keys, not hard-coded feature names. Adding a new gated feature requires: (1) adding the entitlement key to the license, (2) wrapping the feature's UI control with the lock/tooltip pattern. No changes to the entitlement-checking infrastructure.

---

## Design Decisions Log

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| App selects input method, user does not choose | Prevents users from staying in their comfort zone (always choosing multiple choice). Forces genuine mastery progression. | User selects input method (rejected: undermines adaptive model). |
| Guest mode is the default entry state | Maximizes first-visit engagement. Forcing sign-in before any interaction loses casual users. | Sign-in required (rejected: business goal is accessibility and open-source sharing). |
| Dark mode as default | Musicians practice in low-light environments. Dark backgrounds reduce eye strain. Study-app aesthetic. | Light mode default (rejected: user's stated preference; dark fits the musician context). |
| Fretboard tonic always visible in anchor color | Provides constant orientation. Music theory is relative to the tonic; losing sight of it makes the fretboard a wall of notes. | Show tonic only when a scale is selected (rejected: tonic is useful context even for single-note exploration). |
| Wrong answers trigger teaching, not punishment | Learning is the goal. Shame-based feedback reduces engagement and increases anxiety. | Simple "wrong, try again" (rejected: misses the teaching opportunity). |
| Entitlement-gated features are visible but locked | Evaluators need to see that the gate exists. Users discover premium features. Hiding them would make the entitlement invisible. | Hide gated features entirely (rejected: fails Replicated evaluation requirement for visible gating). |
| One bar of drum pattern loops for entire track | Simplicity for v1. Most practice scenarios use a consistent beat. | Per-chord drum patterns (deferred: adds significant complexity to the build UX). |
| Fixed drum kit in v1 | Reduces scope. A good default kit covers the vast majority of practice needs. | User-uploadable samples (deferred to post-bootcamp as stated in BUSINESS.md). |
| Audio failures are reported, not silently ignored | User's explicit preference. Silent failure leads to confusion ("why is nothing playing?"). | Silent fallback (rejected by user in Round 2 answers). |
| Local download always available for support bundles | Airgap environments cannot upload. Operators need a way to get the bundle out of the cluster. | Upload-only (rejected: breaks airgap use case). |

---

## Appendix: Traceability to BUSINESS.md

| Business Requirement | Design Coverage |
|----------------------|-----------------|
| SC-1: Flashcard game | Learn mode: topic selection, adaptive delivery, two card directions, input method progression, teaching-first wrong-answer flow |
| SC-2: Practice track builder | Play mode: chord picker + sequencer, drum rack, playback controls, playback screen |
| SC-3-10: Bootcamp Tiers 0-7 | Admin panel (updates, license, support bundle), update banner, entitlement gate UX, health endpoint, offline/airgap behavior |
| SC-11: User accounts | Authentication UX: guest mode, local accounts, OAuth (Google, GitHub) |
| SC-12: Progress tracking | Adaptive mastery model: dashboard, inline indicators, streaks, accuracy percentages |
| Adaptive learning model | Input method progression, per-card per-direction mastery tracking, re-queue on wrong answer, weak area identification |
| Air-gap capable | Offline-first design, all core features work without connectivity, local download for support bundles |
| Instrument extensibility | Instrument abstraction, tuning configurator, string count selection |
| Web Audio API | Playback controls, audio failure detection and visual-only fallback, error reporting |
| License entitlement gate | Lock icon + tooltip pattern, visible but not usable, admin panel license section |
| Update awareness | Subtle banner on all pages, links to admin panel, different messaging for admin vs non-admin |
| Support bundle from UI | Admin panel support section: generate, download locally, upload to vendor portal |
