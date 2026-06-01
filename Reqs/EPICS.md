# Product Epics — Бункер для команди

**Project:** bunker-team-game
**Version:** 0.1
**Last Updated:** 2026-05-06
**Source:** PRODUCT_VISION.md

Epics are grouped by phase. **MVP epics are required for Phase 1 release.** Phase 2+ epics are tracked here so architecture decisions account for them, but they will not be implemented in MVP.

---

## Epic 1 — Lobby & Room Management 🚀 MVP

**Priority:** High
**Goal:** A host can create a room in seconds and share a join link with their team.

**Features:**
- Host creates a room — gets a unique room code and shareable URL
- Players join via URL — enter nickname only (no signup)
- Lobby shows connected players in real time
- Host sees a "Start game" button once 6+ players are in
- Lobby supports up to 10 players (hard cap, soft warning at 11)
- If a player closes their browser tab, they can rejoin the same room with the same nickname
- Empty rooms auto-expire after 30 minutes of inactivity

**Non-goals:** Public room browsing, lobby chat, custom room themes (Phase 2).

---

## Epic 2 — Apocalypse Scenario System 🚀 MVP

**Priority:** High
**Goal:** Each game starts with a clear apocalypse scenario that frames the debate.

**Features:**
- Library of 3-5 hand-written scenarios in Ukrainian (e.g., nuclear war, pandemic, climate collapse, alien contact, AI uprising)
- Each scenario includes: title, description text, bunker conditions (size, supply duration, environment outside)
- Host picks a scenario at game start (or "random")
- Scenario stays visible to all players throughout the game
- Scenario data stored as structured content (easy to add more later)

**Non-goals:** User-authored scenarios, AI-generated scenarios, branching scenarios (Phase 2/3).

---

## Epic 3 — Character Cards & Secret Identity 🚀 MVP

**Priority:** High
**Goal:** Each player gets a unique secret character with traits to reveal over the game.

**Features:**
- Each player is dealt a random character with 7 trait categories:
  1. **Стать / вік** (Sex / age)
  2. **Професія** (Profession)
  3. **Здоров'я** (Health condition)
  4. **Хобі** (Hobby)
  5. **Фобія** (Phobia)
  6. **Багаж** (Baggage / item brought to the bunker)
  7. **Факт** (Secret fact)
- Trait pool of ~30 options per category, all written in Ukrainian
- Random draw guarantees no two players get identical characters in one session
- Player sees their own card in full at all times; sees what others have **revealed** only

**Non-goals:** Action cards / special abilities (Phase 3), custom character creation, character art / illustrations (post-MVP polish).

---

## Epic 4 — Round Structure & Reveal Mechanics 🚀 MVP

**Priority:** High
**Goal:** Three structured rounds with reveals → debate → vote.

**Features:**
- 3 rounds per game (configurable in code, default 3)
- **Round 1:** each player must reveal 2 traits of their choice
- **Round 2:** each player must reveal 2 more traits
- **Round 3:** each player must reveal 1 trait
- After each round of reveals, players debate (out of band on Zoom/Meet)
- After debate, voting opens (see Epic 5)
- One player is eliminated per round
- Game tracks who has revealed what and shows it on every player's screen

**Non-goals:** Action cards mid-round, mid-game scenario twists (Phase 3).

---

## Epic 5 — Voting & Elimination 🚀 MVP

**Priority:** High
**Goal:** A clear, fair vote at the end of each round to remove one player.

**Features:**
- Open voting — every player sees who voted for whom
- Players cannot vote for themselves
- Each player has one vote per round
- Eliminated player is marked "out" — their card is fully revealed to all
- Eliminated players can still watch but cannot vote in subsequent rounds
- Tiebreaker: re-vote between tied players; if still tied, host casts deciding vote

**Non-goals:** Secret ballot, ranked-choice voting, weighted votes (Phase 3 if requested).

---

## Epic 6 — Game End & Reveal 🚀 MVP

**Priority:** High
**Goal:** A satisfying conclusion that reveals all surviving characters.

**Features:**
- Game ends after Round 3 elimination
- Final survivors (3-7 players depending on starting count) revealed in full
- Eliminated players' cards also shown (already public after each round)
- Brief "outcome" text — narrative wrap-up of who's in the bunker (template-based, e.g., "У бункері залишились…")
- Host can start a new game with the same lobby (one click, keeps players)
- Host can close the room

**Non-goals:** Cinematic "what happened in the bunker" generated text (Phase 3, AI), shareable result cards (Phase 2).

---

## Epic 7 — Host Controls 🚀 MVP

**Priority:** Medium
**Goal:** The host has minimal but sufficient controls to keep the game flowing.

**Features:**
- Host badge visible to all
- Host can: start game, kick a disruptive player from lobby, force-advance to next round, end game early
- If host disconnects, host status auto-transfers to the longest-connected player after 60 seconds
- Host UI is the same as everyone else's plus a "Host actions" panel

**Non-goals:** Co-hosts, host-only chat, scheduled rooms (Phase 2).

---

## Epic 8 — Ukrainian Content & Localisation Foundation 🚀 MVP

**Priority:** High
**Goal:** All content (UI, cards, scenarios, errors) is in Ukrainian. Architecture supports adding languages later.

**Features:**
- All UI strings in a single i18n source file (Ukrainian only at MVP, but i18n-ready)
- All character traits and scenarios in structured JSON / YAML files separated from code
- Date / time formatting respects Ukrainian locale
- Error messages translated and human-friendly
- Onboarding tooltip ("Як грати") in Ukrainian

**Non-goals:** Other languages (Phase 4), right-to-left support.

---

## Epic 9 — Reconnect & Resilience 🚀 MVP

**Priority:** Medium
**Goal:** A dropped player or refreshed tab does not break the game.

**Features:**
- Player can refresh / close / reopen tab — server holds their session for 5 minutes
- Reconnect re-syncs full game state to that player's view
- Other players see "[name] перепідключається…" indicator
- If player doesn't return within 5 minutes mid-game, they are auto-eliminated (their card is revealed)

**Non-goals:** Spectator-mode rejoin, replay of missed events (Phase 2).

---

## Epic 10 — Accounts (Foundation) 📦 PHASE 2

**Priority:** Future (designed for, not built in MVP)
**Goal:** Hosts can sign in to track their hosted games and unlock paid features.

**Features (Phase 2):**
- Google OAuth sign-in for hosts
- Anonymous players still join with a link, no account needed
- Host's room history persists across sessions
- Account links to Stripe customer in Phase 2

**MVP impact:** Data model includes `host_user_id` field (nullable in MVP, FK in Phase 2).

---

## Epic 11 — Stripe Monetization 📦 PHASE 2

**Priority:** Future
**Goal:** Hosts pay a small fee for premium access (paid scenario packs and/or per-host subscription).

**Features (Phase 2 — pricing tbd):**
- Free tier: 3 scenarios, up to N games per month
- Paid tier: full scenario library, custom rooms, no limits
- Stripe Checkout for one-time pack purchases
- Stripe Subscription for monthly host plan
- Owner / admin dashboard for revenue & usage

**MVP impact:** Scenario data model has `is_premium` boolean field (always `false` in MVP).

---

## Epic 12 — Action Cards & Game Twists 📦 PHASE 3

**Priority:** Future
**Goal:** Add depth and replayability via mid-game special action cards.

**Features (Phase 3):**
- Action cards drawn each round (e.g., "swap a trait with another player", "force a player to reveal a specific trait", "skip the next vote")
- Configurable action card pool per game
- Tutorials for each action card

**MVP impact:** None — no schema changes needed in MVP for this.

---

## Epic 13 — Custom Scenarios & Sharing 📦 PHASE 3

**Priority:** Future
**Goal:** Hosts can author and share their own scenarios.

**Features (Phase 3):**
- Scenario authoring UI for paid hosts
- Public scenario gallery
- Scenario rating system

---

## Summary

| # | Epic | Priority | Phase |
|---|---|---|---|
| 1 | Lobby & Room Management | High | MVP |
| 2 | Apocalypse Scenario System | High | MVP |
| 3 | Character Cards & Secret Identity | High | MVP |
| 4 | Round Structure & Reveal Mechanics | High | MVP |
| 5 | Voting & Elimination | High | MVP |
| 6 | Game End & Reveal | High | MVP |
| 7 | Host Controls | Medium | MVP |
| 8 | Ukrainian Content & Localisation | High | MVP |
| 9 | Reconnect & Resilience | Medium | MVP |
| 10 | Accounts (Foundation) | — | Phase 2 |
| 11 | Stripe Monetization | — | Phase 2 |
| 12 | Action Cards & Game Twists | — | Phase 3 |
| 13 | Custom Scenarios & Sharing | — | Phase 3 |

**MVP scope:** Epics 1-9.
