# Baukalo — Onboarding Flow Design Spec

> **Stitch handoff document** — All screens, copy, animations, and deliverables for a 4-screen animated onboarding experience.

---

## 1. Brand Context

### App Identity

- **App name:** Baukalo
- **What it is:** A voice-to-text desktop app personified as a shy, cute cat. Baukalo IS the app — the cat character is not a mascot, it's the product itself.
- **Platform:** Desktop (macOS, Windows, Linux) via Tauri

### Design Tokens

| Token | Light Mode | Dark Mode |
|---|---|---|
| Primary / accent | `#A78BFA` (purple) | `#A78BFA` |
| Background | `#fbfbfb` | `#2c2b29` |
| Text primary | `#1a1a1a` | `#f5f5f5` |
| Text secondary | `#6b7280` | `#9ca3af` |
| Surface / card | `#ffffff` | `#3a3936` |
| Border | `#e5e7eb` | `#4a4845` |
| Success | `#34d399` | `#34d399` |
| Error | `#f87171` | `#f87171` |

### Typography

- **Headings:** System sans-serif (SF Pro on macOS, Segoe UI on Windows), semibold
- **Body:** System sans-serif, regular
- **Baukalo speech:** Slightly smaller, italic or stylized to feel like a speech bubble / personality text

### Light & Dark Mode

- All screens must support both modes
- Baukalo character art should work on both backgrounds (transparent PNGs or Lottie with no baked-in background)
- Use the background and surface tokens above — never hardcode colors

---

## 2. Baukalo Character Brief

### Personality

Baukalo is a **shy, cute cat** who is the app itself. Think: a cat that slowly warms up to a stranger.

- Starts timid and uncertain
- Gains confidence as the user progresses
- Becomes an eager, enthusiastic helper
- Full happy meltdown when everything works

### Emotional Arc Across Screens

| Screen | Emotion | Energy |
|---|---|---|
| 1 — Welcome | Shy, curious, peeking | Low |
| 2 — Permissions | Nervous → confident | Rising |
| 3 — Model Select | Eager, knowledgeable | High |
| 4 — Voice Test | Ecstatic, proud | Maximum |

### 7 Animated Poses (Lottie)

Each pose has an **entrance animation** (played once on screen load) and an **idle loop** (plays continuously after entrance).

| # | Pose Name | Description | Used On |
|---|---|---|---|
| 1 | `peek` | Cat peeking in from the side/bottom of frame. Ears visible first, then eyes, cautious. | Screen 1 — initial state |
| 2 | `fidget` | Nervous fidgeting, maybe tail twitch or paw shuffle. Avoiding eye contact. | Screen 2 — before permissions granted |
| 3 | `perk` | Ears perk up, eyes widen, small excited bounce. "Oh! You said yes!" | Screen 2 — after a permission is granted |
| 4 | `cool` | Trying to play it cool but clearly happy. Maybe a little head tilt or slow blink. | Screen 2 — all permissions granted |
| 5 | `eager` | Leaning forward, wide eyes, tail up. "I know things!" energy. | Screen 3 — model selection |
| 6 | `celebrate` | Full happy meltdown — jumping, spinning, maybe confetti-adjacent energy. Pure joy. | Screen 4 — successful test |
| 7 | `listen` | Ears perked toward user, attentive, focused. Slight head tilt. | Screen 4 — during voice recording |

---

## 3. Screen Designs

### Screen 1 — Welcome

**Purpose:** First impression. Baukalo peeks in and introduces itself shyly.

**Baukalo pose:** `peek` → idle loop (gentle sway/ear twitch)

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│         ┌───────────┐               │
│         │           │               │
│         │  BAUKALO  │               │
│         │  (peek)   │               │
│         │           │               │
│         └───────────┘               │
│                                     │
│         um... hi!                   │
│         i'm baukalo.                │
│                                     │
│         i turn your voice           │
│         into words.                 │
│                                     │
│         (i'm a little shy           │
│          but i'm really good        │
│          at listening)              │
│                                     │
│                                     │
│         [ let's get started ]       │
│                                     │
│            ● ○ ○ ○                  │
│                                     │
└─────────────────────────────────────┘
```

**Copy:**

- **Baukalo speech:** "um... hi! i'm baukalo."
- **Subtitle:** "i turn your voice into words."
- **Aside:** "(i'm a little shy but i'm really good at listening)"
- **CTA button:** "let's get started"

---

### Screen 2 — Permissions

**Purpose:** Request microphone access (and accessibility on macOS). Baukalo is nervous asking but gains confidence as permissions are granted.

**Baukalo poses:**
- Before any permission granted: `fidget`
- After a permission granted: `perk`
- All permissions granted: `cool` → speech: "cool cool cool"

**Platform logic:**
- **macOS:** Microphone + Accessibility (2 permissions)
- **Windows/Linux:** Microphone only (1 permission)

```
┌─────────────────────────────────────┐
│                                     │
│     ┌───────────┐                   │
│     │  BAUKALO  │                   │
│     │ (fidget/  │                   │
│     │  perk/    │                   │
│     │  cool)    │                   │
│     └───────────┘                   │
│                                     │
│     i need a              │
│     couple things to work           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🎤  Microphone Access      │    │
│  │  so i can hear you          │    │
│  │               [ Grant ]     │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ♿  Accessibility Access    │    │  ← macOS only
│  │  so i can type for you      │    │
│  │               [ Grant ]     │    │
│  └─────────────────────────────┘    │
│                                     │
│     (after all granted:)            │
│     "cool cool cool"                │
│                                     │
│         [ continue ]                │
│                                     │
│            ○ ● ○ ○                  │
│                                     │
└─────────────────────────────────────┘
```

**Copy:**

- **Baukalo speech (before):** "so, um... i need a couple things to work"
- **Mic card:** "Microphone Access — so i can hear you"
- **Accessibility card (macOS only):** "Accessibility Access — so i can type for you"
- **Baukalo speech (after all granted):** "cool cool cool"
- **CTA button:** "continue" (enabled only when all permissions granted)

**States:**

| State | Baukalo | Button |
|---|---|---|
| No permissions granted | `fidget` | Disabled |
| Some granted (macOS) | `perk` | Disabled |
| All granted | `cool` + "cool cool cool" | Enabled |

---

### Screen 3 — Model Selection

**Purpose:** User picks a transcription model. Baukalo is eager and knowledgeable — this is its domain.

**Baukalo pose:** `eager` → idle loop (bouncy, excited)

```
┌─────────────────────────────────────┐
│                                     │
│     ┌───────────┐                   │
│     │  BAUKALO  │                   │
│     │  (eager)  │                   │
│     └───────────┘                   │
│                                     │
│     ooh! i know this!               │
│     pick a brain for me ↓           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ✦ Tiny                     │    │
│  │  Fast & light. Good for     │    │
│  │  quick notes.               │    │
│  │                    50 MB    │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ✦ Small  ★ Recommended    │    │
│  │  Best balance of speed      │    │
│  │  and accuracy.              │    │
│  │                   150 MB    │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ✦ Medium                   │    │
│  │  Most accurate. Needs a     │    │
│  │  beefy machine.             │    │
│  │                   500 MB    │    │
│  └─────────────────────────────┘    │
│                                     │
│         [ download & continue ]     │
│                                     │
│            ○ ○ ● ○                  │
│                                     │
└─────────────────────────────────────┘
```

**Copy:**

- **Baukalo speech:** "ooh! i know this! pick a brain for me ↓"
- **Model cards:** Show model name, short description, and size. Exact model names/sizes will come from the app's model list — the above are representative.
- **Recommended badge:** Highlight the recommended model
- **CTA button:** "download & continue"
- **Download state:** Button shows progress during download. Baukalo could have a waiting/watching idle animation during download.

---

### Screen 4 — Voice Test

**Purpose:** Live voice test. User speaks, Baukalo listens, transcription appears. Baukalo has a full happy meltdown when it works.

**Baukalo poses:**
- Before recording: `eager` (residual from previous screen)
- During recording: `listen`
- After successful transcription: `celebrate` → "WE DID IT!!"

```
┌─────────────────────────────────────┐
│                                     │
│     ┌───────────┐                   │
│     │  BAUKALO  │                   │
│     │ (listen/  │                   │
│     │celebrate) │                   │
│     └───────────┘                   │
│                                     │
│     try talking to me!              │
│                                     │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │   [ voice test area ]       │    │
│  │                             │    │
│  │   Live transcription        │    │
│  │   appears here as           │    │
│  │   user speaks...            │    │
│  │                             │    │
│  │          🎤 Hold to talk    │    │
│  └─────────────────────────────┘    │
│                                     │
│     (after success:)                │
│     "WE DID IT!!"                   │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  💡 psst... you can hold    │    │
│  │  [Cmd+Shift+Space] to talk  │    │
│  │  to me anytime!             │    │
│  └─────────────────────────────┘    │
│                                     │
│         [ finish setup ]            │
│                                     │
│            ○ ○ ○ ●                  │
│                                     │
└─────────────────────────────────────┘
```

**Copy:**

- **Baukalo speech (before):** "try talking to me!"
- **Voice test area:** Live transcription display with a hold-to-talk button
- **Baukalo speech (after success):** "WE DID IT!!"
- **Shortcut tip (from Baukalo):** "psst... you can hold [Cmd+Shift+Space] to talk to me anytime!"
  - Replace `Cmd` with `Ctrl` on Windows/Linux
- **CTA button:** "finish setup"

**States:**

| State | Baukalo | Voice Area |
|---|---|---|
| Idle | `eager` | "Hold to talk" prompt |
| Recording | `listen` | Waveform / recording indicator |
| Transcription appearing | `listen` | Live text appearing |
| Success | `celebrate` + "WE DID IT!!" | Completed transcription shown |

---

## 4. Animation System

### Baukalo-Driven Transitions

Screen transitions are driven by Baukalo's movement — the cat physically moves between screens, carrying the user's attention.

| Transition | Baukalo Motion | Duration |
|---|---|---|
| Screen 1 → 2 | **Scurry** — nervous, quick dash off-screen, reappears on next screen still fidgeting | ~600ms |
| Screen 2 → 3 | **Strut** — confident walk/trot, tail up, gaining swagger | ~600ms |
| Screen 3 → 4 | **Leap** — excited jump/bound, can't contain enthusiasm | ~600ms |

### Lottie Idle Loops

Every pose has a looping idle animation that plays continuously while on that screen:

| Pose | Idle Loop Behavior |
|---|---|
| `peek` | Gentle sway, occasional ear twitch, eyes dart around |
| `fidget` | Tail twitch, paw shuffle, looking away nervously |
| `perk` | Small bounce, ears up, alert and pleased |
| `cool` | Slow blink, slight head bob, relaxed confidence |
| `eager` | Bouncing in place, tail wagging, can't sit still |
| `listen` | Ears rotating toward sound source, focused stillness with occasional tilt |
| `celebrate` | Full body wiggle, jumping, maximum joy |

### Entrance vs. Idle Timing

1. Screen loads → background and UI elements fade in (~200ms)
2. Baukalo entrance animation plays (one-shot, ~400-800ms depending on pose)
3. Baukalo speech text fades in (~200ms after entrance completes)
4. Baukalo transitions to idle loop (seamless blend from entrance end-frame)
5. UI elements (cards, buttons) stagger in (~100ms apart)

---

## 5. Step Indicator

A dot-based progress indicator at the bottom of each screen.

### Layout

- **macOS:** 4 dots — `● ○ ○ ○` → `○ ● ○ ○` → `○ ○ ● ○` → `○ ○ ○ ●`
- **Windows/Linux:** 3 dots (no accessibility permission screen variant — Screen 2 still exists but has only mic permission, so the screen count stays at 4)

### Style

- Active dot: Filled, primary purple (`#A78BFA`)
- Inactive dot: Outlined or muted (`#6b7280` at 40% opacity)
- Dot size: ~8px diameter
- Dot spacing: ~12px gap
- Centered horizontally, fixed ~32px from bottom

### Transitions

- Active dot slides/morphs to new position (not instant swap)
- Duration matches screen transition (~600ms)

---

## 6. Responsive & Platform Notes

### Window Size

- Onboarding window: Fixed size, approximately **480 × 640px** (portrait-ish)
- Content centered vertically and horizontally within window
- No scrolling — all content fits in view

### Platform Variants

| Element | macOS | Windows | Linux |
|---|---|---|---|
| Permissions | Mic + Accessibility | Mic only | Mic only |
| Shortcut display | `Cmd+Shift+Space` | `Ctrl+Shift+Space` | `Ctrl+Shift+Space` |
| Window chrome | Native macOS | Native Windows | Native Linux |

---

## 7. Deliverables Checklist

Stitch should produce:

### Lottie Animations (7 files)
- [ ] `baukalo-peek.json` — Peek entrance + idle loop
- [ ] `baukalo-fidget.json` — Fidget entrance + idle loop
- [ ] `baukalo-perk.json` — Perk entrance + idle loop
- [ ] `baukalo-cool.json` — Cool entrance + idle loop
- [ ] `baukalo-eager.json` — Eager entrance + idle loop
- [ ] `baukalo-listen.json` — Listen entrance + idle loop
- [ ] `baukalo-celebrate.json` — Celebrate entrance + idle loop

### Transition Animations (3 files)
- [ ] `transition-scurry.json` — Screen 1→2 transition
- [ ] `transition-strut.json` — Screen 2→3 transition
- [ ] `transition-leap.json` — Screen 3→4 transition

### Screen Designs (8 files — light + dark)
- [ ] Screen 1 — Welcome (light + dark)
- [ ] Screen 2 — Permissions, all states (light + dark)
- [ ] Screen 3 — Model Select (light + dark)
- [ ] Screen 4 — Voice Test, all states (light + dark)

### Assets
- [ ] Baukalo character sheet (all 7 poses, static reference)
- [ ] Step indicator component (both 3-dot and 4-dot variants)
- [ ] Permission card component (granted / not-granted states)
- [ ] Model card component (selected / unselected / downloading states)
- [ ] Voice test area component (idle / recording / success states)

### Specs
- [ ] Animation timing sheet (entrance durations, idle loop frame counts, transition curves)
- [ ] Color token mapping (all tokens in light + dark)
- [ ] Component spacing/sizing reference

---

## 8. Open Questions for Stitch

- **Baukalo art style:** Should be cute, simple, expressive. Think Pusheen-level simplicity but with more personality in the ears and eyes. Final style TBD with illustrator.
- **Speech bubble vs. plain text:** Baukalo's words could appear in a speech bubble or as styled text below the character. Recommend trying both and seeing what feels better.
- **Confetti on celebrate:** The `celebrate` pose could optionally trigger particle confetti behind Baukalo. Nice-to-have, not required.
- **Sound effects:** Out of scope for this spec, but consider: soft meow on entrance, purr on idle, excited chirp on celebrate.
