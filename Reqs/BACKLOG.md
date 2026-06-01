# Product Backlog — Бункер для команди

**Project:** bunker-team-game
**Version:** 0.1
**Last Updated:** 2026-05-06
**Source:** EPICS.md, SCENARIOS.md
**Format:** Tasks grouped by priority. Developer agent picks unchecked `[ ]` items in priority order (High → Medium → Low). Mark `[x]` when complete and Solution Architect has approved.

> Solution Architect should be invoked **before** the Developer starts coding. SA decides tech stack, hosting, real-time framework, data model, and quality mode. Tech-stack-specific tasks below are placeholders to be refined after SA review.

---

## High Priority — MVP Foundations

These tasks define the core architecture and the playable shell. They block everything else.

- [ ] **HP-1** Set up project repository (git init, README, .gitignore, license)
- [ ] **HP-2** Set up project structure per Solution Architect's tech stack decision (front-end app, back-end server, content folder for cards/scenarios)
- [ ] **HP-3** Set up real-time transport (WebSocket library per SA decision — likely Socket.IO or native WS) with basic connect/disconnect handling
- [ ] **HP-4** Implement room state model: `room_id`, `host_id`, `state` (lobby/in_game/ended), `players[]`, `created_at`, `host_user_id` (nullable, for Phase 2)
- [ ] **HP-5** Implement player session model: anonymous session token in `localStorage`, links to `room_id` + `nickname`
- [ ] **HP-6** Build home page: "Створити кімнату" + "Приєднатися за кодом" actions (Ukrainian UI)
- [ ] **HP-7** Build room creation flow (Scenario A): generate 6-char room code, create room state, redirect host to lobby
- [ ] **HP-8** Build join flow via invite link (Scenario B): nickname entry, validation, join lobby
- [ ] **HP-9** Build lobby UI: room code display, copy invite link button, real-time player list, host badge, "Почати гру" button (disabled until 6+ players)
- [ ] **HP-10** Implement player count enforcement (6 min, 10 max) — disable Start button outside that range with tooltip
- [ ] **HP-11** Author Ukrainian content for character traits — ~30 entries per category × 7 categories (Стать/вік, Професія, Здоров'я, Хобі, Фобія, Багаж, Факт). Store as structured JSON / YAML
- [ ] **HP-12** Author 3-5 Ukrainian apocalypse scenarios with title, description, bunker conditions
- [ ] **HP-13** Implement scenario picker modal at game start (random or pick)
- [ ] **HP-14** Implement character dealing: random unique character per player, no duplicates within session
- [ ] **HP-15** Implement game state transitions: `LOBBY → SCENARIO_PICK → ROUND_1_REVEAL → ROUND_1_DEBATE → ROUND_1_VOTE → ROUND_2_REVEAL → ... → ENDED`
- [ ] **HP-16** Build game view layout: scenario card top, players list with revealed traits, own card sidebar, action panel
- [ ] **HP-17** Implement reveal phase: per-round reveal count enforcement (2/2/1), trait selection UI, confirm action, broadcast to all players
- [ ] **HP-18** Implement debate phase: 5-minute timer, host extend/skip controls
- [ ] **HP-19** Implement voting phase: open vote, no self-vote, real-time tally display, tiebreaker logic (re-vote, then host decides)
- [ ] **HP-20** Implement elimination: mark player out, fully reveal their card, prevent vote in subsequent rounds
- [ ] **HP-21** Implement game end view (Scenario A of Game Conclusion): survivors panel, eliminated panel, outcome text, "Грати ще раз" + "Завершити" buttons
- [ ] **HP-22** Implement Ukrainian i18n source file with all UI strings; design folder structure to allow adding languages later (do NOT add other languages now)

---

## Medium Priority — Resilience & Polish

These improve the experience and prevent bad first impressions, but a smaller team could ship without them initially.

- [ ] **MP-1** Implement player reconnect within 5 minutes (Connection Scenario A): preserve player state, re-sync game on rejoin
- [ ] **MP-2** Implement host disconnect / auto-transfer after 60 seconds (Connection Scenario B)
- [ ] **MP-3** Implement transient disconnect handling during vote (Connection Scenario C): pause vote up to 30s, mark abstention if not back
- [ ] **MP-4** Implement player timeout in reveal phase: auto-pick random unrevealed traits
- [ ] **MP-5** Implement host kick from lobby (Host Control Scenario A)
- [ ] **MP-6** Implement host force-advance during debate (Host Control Scenario B)
- [ ] **MP-7** Implement host force-end-game with confirmation modal
- [ ] **MP-8** Build "Як грати" onboarding tooltip / first-time-player overlay (Ukrainian)
- [ ] **MP-9** Add error pages for: room not found, room full, room already started, network errors
- [ ] **MP-10** Empty-room cleanup job: rooms with 0 players for 30 min are deleted
- [ ] **MP-11** Mobile-browser-friendly responsive layout (no native app, but works on phones in landscape)
- [ ] **MP-12** Basic light visual style — clean typography, comfortable reading, adequate contrast (no heavy theming yet)
- [ ] **MP-13** Smoke-test playthrough script (manual or scripted) — start room, join 6 players, complete game

---

## Low Priority — Nice-to-have for MVP launch

- [ ] **LP-1** Add game session log per room (in-memory or simple table) — useful for debugging early
- [ ] **LP-2** Add basic analytics events: room_created, game_started, game_completed, player_joined (no PII, no third-party tracker yet)
- [ ] **LP-3** Add basic favicon and meta tags for shareable link previews (OG tags)
- [ ] **LP-4** Add a simple "/health" endpoint for hosting platform monitoring
- [ ] **LP-5** Document setup / run instructions in README

---

## Future Considerations (NOT MVP — Phase 2+)

Tracked here so architecture decisions account for them. **Do not implement now.**

### Phase 2 — Accounts & Monetization
- [ ] **F-1** Google OAuth host sign-in
- [ ] **F-2** Persistent host history page
- [ ] **F-3** Stripe Checkout integration for one-time scenario pack purchases
- [ ] **F-4** Stripe Subscription for monthly host plan
- [ ] **F-5** Free tier vs paid tier feature flagging
- [ ] **F-6** Owner / admin dashboard

### Phase 2 — Public lobby
- [ ] **F-7** Spectator mode: late joiners can watch active games
- [ ] **F-8** Public room browsing (opt-in)
- [ ] **F-9** Shareable result cards (image / link to past games)

### Phase 3 — Replayability
- [ ] **F-10** Action cards / mid-game special abilities
- [ ] **F-11** Custom scenario authoring UI for paid hosts
- [ ] **F-12** Public scenario gallery + ratings
- [ ] **F-13** Host stats and player insights

### Phase 4 — Scale (optional)
- [ ] **F-14** English content + multi-language switcher
- [ ] **F-15** AI-generated scenarios on demand
- [ ] **F-16** AI moderator / Game Master mode
- [ ] **F-17** Slack / Zoom apps for native meeting integration

---

## Dependencies & Sequencing Notes

- **HP-2 through HP-5 must precede everything else** — they define the project shell, transport, and data model
- **HP-11 and HP-12 (content) can run in parallel with HP-3 through HP-10** — different skill, no code dependency
- **HP-15 (state machine) is the keystone** — round, reveal, vote, elimination tasks all depend on it
- **MP-1 through MP-3 (resilience)** can be deferred until after a first end-to-end playable, but should land before any non-owner team plays
- **All MP and LP tasks are unblocked by HP-1 through HP-22 reaching "approved"** state

---

## Definition of Done (per task)

A task is `[x]` when:
1. Code is written following Solution Architect's CODE_STANDARDS.md
2. Solution Architect has reviewed and approved the change
3. Tests pass (per SA's testing requirements for MVP quality mode)
4. The relevant scenario(s) in SCENARIOS.md can be walked through end-to-end without manual hacks
5. The task is marked `[x]` here and in any open issue tracker if used

---

## Total

- **High Priority (MVP must-have):** 22 tasks
- **Medium Priority (MVP should-have):** 13 tasks
- **Low Priority (MVP nice-to-have):** 5 tasks
- **Future (Phase 2+):** 17 tasks
- **MVP scope total:** 40 tasks

Estimated MVP timeline at quality mode "MVP" with one developer: **2-3 weeks of focused work**, assuming Solution Architect provides the tech stack and architecture upfront.
