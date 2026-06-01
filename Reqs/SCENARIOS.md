# Product Scenarios — Бункер для команди

**Project:** bunker-team-game
**Version:** 0.1
**Last Updated:** 2026-05-06
**Source:** EPICS.md (MVP scope)
**Format:** A-Z scenarios per use case (NOT user stories)

Each scenario has: preconditions, numbered steps, expected outcome, edge cases.

---

## Table of Contents

1. [Use Case: Room Creation & Joining](#use-case-room-creation--joining)
2. [Use Case: Game Setup](#use-case-game-setup)
3. [Use Case: Character Reveal](#use-case-character-reveal)
4. [Use Case: Round Voting & Elimination](#use-case-round-voting--elimination)
5. [Use Case: Game Conclusion](#use-case-game-conclusion)
6. [Use Case: Connection & Reconnect](#use-case-connection--reconnect)
7. [Use Case: Host Controls](#use-case-host-controls)

---

## Use Case: Room Creation & Joining

### Scenario A: Host creates a new room

**Preconditions:**
- Host has a modern browser
- Host opens the game site

**Steps:**
1. Host lands on home page
2. Host clicks "Створити кімнату"
3. Host enters their nickname (validated: 2-20 characters, no profanity check needed in MVP)
4. Server generates a unique 6-character room code (e.g., `BNK7R2`)
5. Server returns shareable URL (e.g., `https://bunker-game.app/r/BNK7R2`)
6. Host lands in the lobby view as host

**Expected Outcome:**
The host is in an empty lobby with a visible room code, a "Copy invite link" button, and a player list showing only themselves with a host badge.

**Edge Cases:**
- **Nickname empty / too short:** show inline error, do not create room
- **Nickname too long (>20):** truncate visually, show counter
- **Server error generating room code:** show retry button, do not advance
- **Same nickname collision in same lobby:** auto-append `(2)`, `(3)`, etc.

---

### Scenario B: Player joins via invite link

**Preconditions:**
- A room exists in lobby state
- Player has the URL

**Steps:**
1. Player opens URL
2. Player sees the room code and host's nickname
3. Player enters their nickname
4. Player clicks "Приєднатися"
5. Server validates the room exists and has < 10 players
6. Player appears in the lobby player list for everyone
7. Player sees the lobby with the start button (greyed out — only host can start)

**Expected Outcome:**
Player is in the lobby; all other players see the new player appear in real time.

**Edge Cases:**
- **Room not found / expired:** show "Кімнату не знайдено", offer "Створити нову кімнату"
- **Room is full (10 players):** show "Кімната повна", offer to join waitlist (Phase 2 — for MVP, just show the message)
- **Room already started:** show "Гра вже триває", offer to spectate (Phase 2 — for MVP, just show the message)
- **Network drop during join:** show retry option, do not duplicate player on success

---

### Scenario C: Player leaves the lobby

**Preconditions:**
- Player is in a lobby (not yet started)

**Steps:**
1. Player closes their tab OR clicks "Покинути кімнату"
2. Server detects disconnect within 10 seconds
3. Server removes the player from the lobby
4. All other players see the player removed from the list

**Expected Outcome:**
Player count decreases; if the leaving player was the host, host status auto-transfers (see Scenario S).

**Edge Cases:**
- **Player drops mid-disconnect detection:** if they reopen tab within 30s, restore them silently to the lobby
- **Last player leaves:** room marked for cleanup, deleted after 30 minutes

---

## Use Case: Game Setup

### Scenario A: Host starts the game with valid player count

**Preconditions:**
- 6-10 players in lobby (host included)
- Host is connected

**Steps:**
1. Host clicks "Почати гру"
2. Modal opens: "Виберіть сценарій"
3. Host picks one of 3-5 scenarios OR clicks "Випадково"
4. Server picks scenario, generates character cards for all players, transitions room to `IN_GAME` state
5. All players' screens transition simultaneously to the game view
6. Game view shows: scenario card on top, list of all players (no traits revealed yet), player's own character card fully visible to them only

**Expected Outcome:**
The game has started, every player sees the scenario, every player sees their own character, and Round 1 begins.

**Edge Cases:**
- **Less than 6 players:** start button disabled with tooltip "Потрібно щонайменше 6 гравців"
- **More than 10 players:** start button disabled with tooltip "Максимум 10 гравців"
- **A player disconnects during start animation:** game still starts; that player will need to reconnect (see reconnect scenarios)

---

### Scenario B: Host attempts to start with too few players

**Preconditions:**
- Fewer than 6 players in lobby

**Steps:**
1. Host hovers / taps the "Почати гру" button
2. Button is greyed out
3. Tooltip / inline message shows the requirement

**Expected Outcome:**
Game does not start; host sees clear messaging on what's missing.

---

## Use Case: Character Reveal

### Scenario A: Player reveals required traits in Round 1

**Preconditions:**
- Round 1 is active (reveal phase)
- Player has not yet confirmed their selection for this round

**Steps:**
1. Player sees their character card with all 7 traits visible to them (privately)
2. Player sees "Розкрийте 2 характеристики" prompt
3. Player taps 2 traits (visual selection — checkbox or highlight); selection is private until confirmed
4. Player clicks "Підтвердити" — this action is final and cannot be undone
5. Server immediately marks those 2 traits as publicly revealed for that player
6. All other players' screens update in real time — they see that player's 2 revealed traits the moment confirmation is submitted (rolling visibility — they do not wait for everyone to confirm)
7. Player's own card now visually marks the revealed traits as "shown to others"

**Expected Outcome:**
Player has confirmed 2 traits; those traits are immediately visible to all other players; the reveal phase continues for players who have not yet confirmed.

**Edge Cases:**
- **Player tries to reveal fewer/more than required:** confirm button stays disabled until exactly 2 selected
- **Player has not yet confirmed while others already have:** that player can see other players' already-revealed traits before they confirm their own — this is intentional and part of the strategy
- **Player tries to change selection after confirming:** not allowed; confirmed selection is locked
- **Player doesn't reveal in time (timer expires — see X):** server auto-picks 2 random traits from unrevealed pool and confirms them on the player's behalf

---

### Scenario B: All players have revealed → debate phase begins

**Preconditions:**
- All non-eliminated players have confirmed their reveals for this round

**Steps:**
1. Server detects that the last player has confirmed their reveal
2. UI transitions to "Час обговорення" (debate phase)
3. A countdown timer starts (default 5 minutes, host can extend / skip)
4. Players debate verbally on Zoom/Meet
5. Voting opens automatically when timer ends OR when host clicks "Голосування"

**Expected Outcome:**
Debate phase is active; all reveals from this round are visible; voting is queued.

**Edge Cases:**
- **Host wants more time:** host clicks "+1 хв" to extend timer
- **Host wants to skip ahead:** host clicks "Голосувати зараз"
- **Player disconnects mid-debate:** their reveals stay visible, they can still rejoin

---

### Scenario C: Player tries to reveal a trait already publicly revealed

**Preconditions:**
- Round 2+ is active (player revealed traits in Round 1 already)

**Steps:**
1. Player sees their card; previously revealed traits are visually marked
2. Already-revealed traits are not selectable
3. Player picks from the unrevealed set only

**Expected Outcome:**
Player can only reveal traits they have not yet shown.

**Edge Cases:**
- **All 7 traits already revealed (shouldn't happen given 2+2+1 = 5 max):** N/A in MVP

---

## Use Case: Round Voting & Elimination

### Scenario A: Open voting in a round

**Preconditions:**
- Debate phase has ended OR host triggered voting
- ≥ 2 non-eliminated players remain

**Steps:**
1. Voting UI opens for all non-eliminated players
2. Each player sees the list of all non-eliminated players (excluding themselves)
3. Each player picks one player to vote out
4. Votes are visible in real time as each player commits (open vote)
5. Once every player has voted, server tallies
6. Player with most votes is marked eliminated
7. Eliminated player's full character card is publicly revealed
8. UI transitions to next round (or game end if Round 3 just ended)

**Expected Outcome:**
One player is eliminated per round; their full character is publicly visible.

**Edge Cases:**
- **Tie vote:** automatic re-vote between tied players only (max 1 retry)
- **Tie persists after re-vote:** host casts deciding vote
- **Player doesn't vote within time limit:** their vote is skipped (counted as abstention)
- **Player tries to vote for themselves:** disabled, cannot select self

---

### Scenario B: Player gets eliminated mid-game

**Preconditions:**
- Player loses the vote in a given round

**Steps:**
1. UI shows "Тебе виключено з бункера" message
2. Player's character card is fully revealed to all
3. Player remains in the game view (can watch)
4. Player cannot vote in subsequent rounds
5. Player's view shows the spectator label

**Expected Outcome:**
Eliminated player can still watch but cannot influence the game.

**Edge Cases:**
- **Eliminated player closes tab:** no impact, game continues for others

---

### Scenario C: Re-vote on tie

**Preconditions:**
- A round vote ended in a tie

**Steps:**
1. UI shows "Нічия — переголосування"
2. Voting UI reopens with only the tied players as options
3. Each player votes again
4. If still tied, see Scenario D

**Expected Outcome:**
Tie resolved by re-vote OR escalates to host tiebreaker.

---

### Scenario D: Persistent tie → host tiebreaker

**Preconditions:**
- Re-vote also resulted in a tie

**Steps:**
1. UI shows "Голос ведучого вирішує"
2. Host alone gets a vote between the tied players
3. Host's pick is eliminated

**Expected Outcome:**
Tie is broken; round proceeds.

**Edge Cases:**
- **Host is eliminated and a tie still occurs:** longest-connected non-eliminated player casts the deciding vote (rare — only matters in Round 3)

---

## Use Case: Game Conclusion

### Scenario A: Game ends after Round 3

**Preconditions:**
- Round 3 elimination has just completed

**Steps:**
1. UI transitions to "Бункер закрито" view
2. Survivors panel shows full character cards of all survivors (3-7 players)
3. Eliminated panel shows all eliminated players in elimination order
4. Outcome text appears (template-based, e.g., "У бункері: лікар, інженер, поетеса. Ваш бункер протримається 1 рік.")
5. Two buttons appear: "Грати ще раз" (start new game with same lobby) and "Завершити" (close room)

**Expected Outcome:**
The game has a clear, satisfying ending; the host can immediately replay or end.

**Edge Cases:**
- **Host clicks "Грати ще раз":** scenario picker always appears (host must choose a new scenario or click "Випадково" to randomize); new character cards are dealt to the same players in the same room; the room code does not change
- **Host clicks "Завершити":** room closed, all players see "Дякуємо за гру" with option to create a new room

---

### Scenario B: Host ends game early

**Preconditions:**
- Game is in any active round

**Steps:**
1. Host clicks "Завершити гру" in host actions panel
2. Confirmation dialog: "Завершити поточну гру?"
3. Host confirms
4. Game jumps to conclusion view, all remaining cards revealed
5. Outcome text shows "Гру завершено достроково"

**Expected Outcome:**
Game ends; everyone sees full reveal; host can start a new game.

---

## Use Case: Connection & Reconnect

### Scenario A: Player refreshes browser mid-game

**Preconditions:**
- Player is in an active game (any round)
- Player closes / refreshes the tab

**Steps:**
1. Server detects WebSocket disconnect
2. Server holds player's session for 5 minutes (full game state preserved: character card, list of previously revealed traits, current round, pending reveal selection if any, pending vote if any)
3. Other players see "[name] перепідключається…" indicator
4. Player reopens the URL OR clicks the same join link within the 5-minute window
5. Server matches them to their session by anonymous identifier (cookie/localStorage token)
6. Player's screen is fully restored:
   a. Their own character card is visible in full
   b. All traits they had already revealed in previous rounds are shown as "revealed to others"
   c. If the current round's reveal phase is still in progress and they had not yet confirmed, they can still select and confirm their traits
   d. If the current round's vote is still in progress and they had not yet voted, they can still cast their vote
7. "[name] перепідключався…" indicator clears for other players

**Expected Outcome:**
Player picks up exactly where they left off; their game participation is uninterrupted as long as the round has not fully concluded.

**Edge Cases:**
- **Player reconnects and the round ended while they were disconnected:** they are still active (not eliminated); their traits for the completed round were auto-submitted if the timer expired, or the round concluded without their input; they participate normally in the next round
- **Player tries to rejoin after the 5-minute window:** marked as auto-eliminated; their card is fully revealed; they can spectate only
- **Player rejoins on a different device:** allowed if session token matches (stored in localStorage/cookie); blocked otherwise
- **Multiple tabs of the same player:** newest tab takes over, old tab shows "Сесія перенесена"

---

### Scenario B: Host disconnects mid-game

**Preconditions:**
- Host loses connection during an active game

**Steps:**
1. Server detects host disconnect
2. UI shows "Ведучий не на зв'язку…" to all players
3. After 60 seconds, host status auto-transfers to longest-connected non-eliminated player
4. Original host can still rejoin as a regular player

**Expected Outcome:**
Game continues even if the host abandons; host privileges are recoverable only as a regular player.

**Edge Cases:**
- **Host returns within 60s:** they regain host status automatically
- **All players disconnect:** room enters "abandoned" state and is cleaned up after 30 minutes

---

### Scenario C: Network blip during voting

**Preconditions:**
- Voting is in progress
- A player loses connection briefly (5-30 seconds)

**Steps:**
1. Server marks player as transient-disconnected
2. Other players see indicator
3. Voting timer pauses for that player up to 30 seconds OR until they reconnect
4. If player returns, voting continues for them

**Expected Outcome:**
Brief disconnects do not break the voting flow.

**Edge Cases:**
- **Disconnect lasts > 30s during vote:** player's vote is skipped (abstention)

---

## Use Case: Host Controls

### Scenario A: Host kicks a disruptive player from lobby

**Preconditions:**
- Game has not started (lobby state only)
- Host wants to remove a player

**Steps:**
1. Host hovers/taps a player's name in the lobby
2. "Видалити" button appears (host-only)
3. Host clicks it
4. Server removes that player from the room
5. Removed player sees "Вас видалено з кімнати" and is sent back to home page

**Expected Outcome:**
Disruptive player is removed; lobby continues.

**Edge Cases:**
- **Host tries to kick another player mid-game:** action disabled (kicks only allowed in lobby for MVP)

---

### Scenario B: Host force-advances to the next round

**Preconditions:**
- Debate phase is active and host wants to move on early

**Steps:**
1. Host clicks "Голосувати зараз"
2. Voting UI opens immediately for everyone
3. Debate timer is cancelled

**Expected Outcome:**
Game moves to voting phase regardless of timer.

---

### Scenario C: Host transfers (auto)

See Use Case: Connection & Reconnect, Scenario B.

---

## Coverage Summary

| Use Case | # Scenarios |
|---|---|
| Room Creation & Joining | 3 (A, B, C) |
| Game Setup | 2 (A, B) |
| Character Reveal | 3 (A, B, C) |
| Round Voting & Elimination | 4 (A, B, C, D) |
| Game Conclusion | 2 (A, B) |
| Connection & Reconnect | 3 (A, B, C) |
| Host Controls | 3 (A, B, C — C is cross-referenced) |
| **Total** | **20 scenarios across 7 use cases** |

All MVP epics (1-9) have at least one scenario covering the happy path and primary edge cases.
