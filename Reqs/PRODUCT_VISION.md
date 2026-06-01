# Product Vision: Бункер для команди (Bunker Team Game)

**Project:** bunker-team-game
**Version:** 0.1 (POC / MVP definition)
**Last Updated:** 2026-05-06
**Status:** Approved direction — Concept A, Ukrainian-only, Stripe deferred to Phase 2
**Owner:** Mike (Product Owner)
**PM Agent:** product-manager

---

## Executive Summary

A lightweight, browser-based online version of the discussion game **«Бункер»** — inspired by the moral thought-experiment from the film *After the Dark / The Philosophers* (2013). The MVP is built first for the product owner's own team to play during regular meetings (Zoom / Google Meet / Teams). The game provides the structure — secret character cards, apocalypse scenarios, round-based reveals, voting — while the team uses their existing video conference for the debate itself.

The MVP intentionally stays small: no accounts, no payments, Ukrainian-only content, six to ten players per session, a handful of pre-written scenarios. Once the team validates that it's fun and replayable, Phase 2 adds Stripe payments, accounts, and a public lobby for paying users.

---

## Problem Statement

Remote and hybrid teams need short, replayable social activities for meetings — icebreakers, retros with a twist, after-standup energizers. Existing options have clear gaps:

- **Most online Bunker games are Russian-only** and built for hobbyists, with dated UX and no monetization model
- **No Ukrainian-language online Bunker game** of comparable quality exists
- **Generic team-building tools** (Jackbox, GeoGuessr, Brightful) lack the deep persuasion / moral-debate hook of Bunker
- Existing free competitors **don't sustain themselves** — donation-based, slow updates, no path to a paid product

The owner wants a tool he can ship to his own team in a few weeks, then evolve into a product strangers will pay a small fee to use.

---

## Target Audience

### Phase 1 (MVP) — Internal team use
- **Primary:** Mike's own team during work meetings
- **Size:** 6-10 players per session
- **Language:** Ukrainian
- **Context:** Players are already on a Zoom / Meet / Teams call; the game runs in their browser alongside

### Phase 2 (after validation) — Paying users
- Ukrainian-speaking teams looking for online Bunker
- Friend groups hosting game nights remotely
- Small companies that want a recurring icebreaker
- Game hosts who'll pay a small fee to host private rooms with custom scenarios

### Out of scope for now
- English-speaking market (deferred — opportunity exists but not the immediate goal)
- Mobile-native apps (web-first; mobile browser supported, native later)
- Enterprise / B2B sales (Concept C path, not chosen)

---

## Goals & Objectives

1. **Ship a playable MVP in 2-3 weeks** that the owner's team can use in a real meeting
2. **Make a single game session feel finished** — clear start, three rounds, satisfying reveal
3. **Keep the host's setup time under 60 seconds** — open room, share link, start
4. **Stay below 5 minutes of "explaining the rules"** for a team that's never played
5. **Design data model and architecture so accounts + Stripe can be added in Phase 2** without rewrites
6. **Use Ukrainian throughout** — UI, cards, scenarios, error messages

---

## Success Metrics

### MVP success (Phase 1)
- Owner's team plays the game **at least 3 times** in the first month
- **At least 2 of those plays are spontaneous** (someone other than the owner suggests it)
- Average session completes successfully (no crashes / disconnects forcing abandonment): **≥ 90 %**
- Onboarding time for a new player (join → understand what to do): **< 2 minutes**
- Host setup time (create room → share link → start): **< 60 seconds**

### Phase 2 success criteria (later)
- 100 unique hosts in first 90 days after public launch
- 5 % free-to-paid conversion on Stripe paywall
- ≥ 4.0/5.0 average satisfaction in post-game feedback

---

## Differentiation

What makes this product different from the seven existing Russian-language Bunker sites and the physical board game:

1. **Native Ukrainian content** — characters, scenarios, hobbies, biographies all written in Ukrainian, not machine-translated
2. **Built for video-meeting workflows** — assumes you're already on Zoom/Meet, doesn't try to be the chat app
3. **Modern, host-friendly UX** — Jackbox-style "share a link" flow, no accounts to start
4. **Designed to be paid eventually** — clean architecture from day one supports the Stripe / accounts overlay in Phase 2
5. **Curated scenario quality over quantity** — start with 3-5 well-written scenarios instead of 50 mediocre ones

---

## Market Opportunity

The Ukrainian-language game market is underserved online. Russian competitors (bunker-online.com, Shelter42, putnov.ru) all run free / donation models with no Ukrainian product equivalent. The English market has the physical board game (Economicus) but no dominant online play.

Adjacent market — virtual team-building tools — sees pricing of $4-25 per user/month (Jackbox, Brightful, GeoGuessr, Donut, Doodle Duel). A $5-10/month or $4.99 one-time pack model is well within precedent.

For Phase 1, we're not chasing market size — we're validating the game with a real team. Phase 2 will reassess the market based on actual usage data.

---

## Competitive Landscape

| Competitor | Position | Our Advantage |
|---|---|---|
| bunker-online.com | RU-language, free + sub, AI bots | Ukrainian-first; cleaner UX; meeting-native |
| Shelter42 | RU-language, donations | Native Ukrainian; modern stack; sustainable monetization in Phase 2 |
| putnov.ru | RU-language, hobbyist-tier | Higher polish; better scenarios |
| BUNKER The Board Game | English, physical only | Online; instant remote play |
| Jackbox / Brightful | EN team building, no Bunker | Bunker-specific moral-debate gameplay |

We don't compete head-on with any of them — we own a niche they're not serving (Ukrainian + meeting-native + paid path).

---

## Constraints & Assumptions

### Constraints
- **Solo developer / small team** — scope must stay small
- **No real-time voice/video infrastructure** — relies on Zoom/Meet/Teams already in use
- **Stripe deferred** — no payment plumbing in MVP, but data model leaves room
- **No accounts in MVP** — but session/lobby IDs designed so account FK can be added later

### Assumptions (to validate)
- Players are willing to open a browser tab in addition to their video call
- Host is comfortable being the implicit Game Master (no AI-driven moderation in MVP)
- Six to ten players is the right target — most work meetings fit this range
- Three rounds with one elimination per round is the right session length (~15-20 min)

---

## Out of Scope (MVP)

Explicitly NOT in MVP — these belong to Phase 2 or later:

- User accounts and authentication
- Stripe payments and paywalls
- Custom scenario authoring by users
- Action cards / special abilities mid-game
- AI-generated scenarios or AI moderator
- Voice / video built into the product
- Mobile-native apps
- English (or any non-Ukrainian) content
- Spectator mode
- Persistent stats / leaderboards across sessions

---

## Phased Roadmap

| Phase | Goal | Key Capability |
|---|---|---|
| **1 — MVP (now)** | Working game for owner's team | Lobby, cards, 3 rounds, voting, 3-5 scenarios |
| **2 — Public + monetization** | Open to paying users | Accounts, Stripe, scenario packs |
| **3 — Replayability** | Keep players coming back | Action cards, custom scenarios, host stats |
| **4 — Scale (optional)** | Reach beyond Ukrainian market | English content, AI moderator, Slack/Zoom apps |

---

## Open Questions for Solution Architect

To be answered when SA runs the architecture interview:

- Real-time framework choice (WebSocket library, e.g. Socket.IO vs native WS)
- Hosting provider and cost target
- State storage (in-memory vs Redis vs Postgres) — depends on Phase 2 plans
- Domain name and deployment pipeline
- Quality mode (likely **MVP** based on this vision, but SA confirms with owner)

---

## Approval

- [ ] Product Owner approval
- [ ] Solution Architect handoff (next: SA interview about tech stack, then Architecture/ docs)
- [ ] Developer handoff (after SA + approved BACKLOG)
