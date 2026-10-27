# Marshal tagging

A phone at a checkpoint, tapping runners as they arrive.

Manual tagging exists for the case the readers cannot cover: a station with no RFID
reader, a reader that died mid-race, a runner whose tag will not read, or a checkpoint
that only ever needed a person with a phone. Taps become **ordinary reads** through the
same upload endpoint the station laptops use, so results, splits, progress and the live
board need no special case and cannot tell the difference.

- **Page:** `/m/<event-slug>` — `centralapp/src/routes/m/[slug]/+page.svelte`
- **Rules:** `centralapp/src/lib/marshal.ts` (pure, unit-tested)
- **Data:** `GET /api/events/<slug>/board` — `centralapp/src/routes/api/events/[slug]/board/+server.ts`
- **Taps out:** `POST /api/events/<slug>/reads` — the existing station endpoint

---

## 1. For the organizer

Open the event in admin → **Connect** tab. Under the station pairing code there is a
**Marshal tagging link**:

```
http://<server>:<port>/m/<event-slug>?k=<event api key>
```

**Copy link** puts it on the clipboard to send by Messenger, SMS or WhatsApp. **Open**
launches it in a new tab to try it yourself.

> **Anyone holding this link can write reads into your event.** Give it only to your
> marshals. There is no per-marshal revocation: the link carries the event's own API key,
> the same one the station laptops hold, so rotating the key cuts off the laptops too.

The marshal's phone must be able to reach the server — same venue Wi-Fi/LAN as the
station laptops, or a public URL if you run one.

---

## 2. For the marshal

### Getting in

Tap the link. The key is taken from the address bar, stored on the phone, and the address
bar is cleaned so the key is not left sitting in browser history or on screen. From then
on, plain `/m/<event-slug>` works — the phone remembers.

If the link was mangled in transit, the page asks for the key and it can be pasted in.

### Picking a station

A one-time grid of every station in the event. The choice is remembered, so a reload or a
dropped connection goes straight back to work. **Change** in the header moves stations.

### Tagging

Tabs across the top: **category**, then **batch** inside it. Below, one card per runner,
always sorted by bib so a card never moves under a thumb mid-tap.

**Tap a card to tag that runner.** The card immediately turns grey and shows the time they
were tagged, with an **Undo** button.

The search box spans the **whole event**, not just the open tab: at a checkpoint you look
up the bib in front of you, not the tab it belongs to.

### What the card colours mean

| Card | Meaning |
|---|---|
| **White — "Tap to tag"** | No sign of this runner yet. |
| **Orange — "▶ Coming here"** | Read at the station *immediately before* this one. They are on their way to you. |
| **Red outline — "Missed here"** | Read at a station *after* this one but never here. They are already past; this station never caught them. |
| **Grey — time + Undo** | Tagged here. The time shown is when they were tagged. |

Nothing is ever blocked. A runner can be tapped whatever their state — a missed checkpoint
is exactly the case manual tagging exists for.

### Gun starts

When an organizer fires a gun in admin, every marshal phone finds out within about five
seconds and says so three ways at once:

1. A **green banner** across the top:
   `● SOLO BATCH 1 IS GO — GUN 5:17:17 PM · 00:00:07`
   The gun's wall-clock time so it can be checked against the organizer, and HH:MM:SS
   counting up beside it.
2. That batch's **tab turns solid green** and reads `● GO`.
3. A **2.5-second alarm** — five alternating pulses, not one blip, which is lost in the
   noise at a checkpoint.

The alarm fires for **every batch in the event**, whatever tab is on screen, so a marshal
parked on the wrong category still looks up. **Sound on / Sound off** in the header mutes
it; the setting is remembered per event, and switching it on replays the alarm so the
marshal hears exactly what to listen for.

### When a wave is through

Once every runner in a batch has been read at **this** station, the banner does not vanish —
it flips to a black done notice:

```
✓ SOLO BATCH 2 DONE — ALL 25 THROUGH CP2, LAST 5:21:16 PM
```

and the batch's tab shows `✓`. The notice **stays until the marshal dismisses it with ✕**,
so nothing leaves the screen unseen. Dismissing is the acknowledgement, not a cleanup.

> "Done" means done **at your station**, not finished the race. CP2 can show a batch done
> while the Finish is still waiting on them, so the same batch goes done at different times
> on different phones. That is the right reading for someone standing at a checkpoint.

### Going offline

Taps are saved on the phone and sent when the signal returns. A banner shows
`Offline — taps are saved on this phone · N waiting`. Closing the browser, locking the
phone or reloading does not lose them — the queue is on disk, not in memory.

Each phone generates its own device id on first use, so two marshals at the same station
never collide.

### Undo

**Undo** re-sends the same tag, time and device id marked as voided, which flips the
original read rather than writing a second one. It survives a reload: the taps this phone
made are kept for the whole event.

Undo is **per phone**. A mis-tap made on phone A can only be undone on phone A or by an
organizer in admin — it will not appear on phone B.

---

## 3. How it works

### Data flow

```
         admin fires gun                      marshal taps a card
                │                                      │
                ▼                                      ▼
          batches.gun_ms                      queue on the phone
                │                                      │ POST (every 4s, and at once)
                │                                      ▼
                │                          /api/events/<slug>/reads
                │                                      │
                │                                      ▼
                └──────────────►  reads table  ◄───────┘
                                       │
                                       │ GET /api/events/<slug>/board (every 5s)
                                       ▼
                          marshal phone: banners, colours, counts
```

The page keeps **no server state of its own**. It polls `/board` and posts to the existing
reads endpoint. Everything on screen is derived.

### `/board` — one trip, everything needed

Returns `serverMs`, `stations`, `categories`, `batches`, `participants`, `tagged` and
`courses`. `bigint` columns are cast to `float8` so they arrive as numbers.

`tagged` is one row per bib per station (`min(read_at_ms)`, voided rows excluded) — it
drives "already tagged here" and the incoming/missed badges in a single query.

`courses` is each category's own route from `category_courses`. **Without it a category
that skips a station would have every one of its runners flagged red "Missed here" at that
station**, and its batches could never read as done.

Auth is `Authorization: Bearer <event api key>` via `authEvent()`, the same guard the
station endpoints use. A 401 clears the stored key and asks for a new link.

### The rules — `src/lib/marshal.ts`

Pure functions, no DOM, no fetch, all unit-tested. The page holds no rules of its own.

| Function | What it decides |
|---|---|
| `seenBy(tagged)` | `bib → (station id → earliest read)` from the flat rows. |
| `runnerState(bib, seen, stationId, course)` | `tagged` \| `incoming` \| `missed` \| `waiting`. |
| `batchState(batch, members, seen, stationId)` | `not-started` \| `live` \| `done`. |
| `taggedCount(members, seen, stationId)` | The `n/m tagged` counter. |
| `gunsOf(batches)` | A poll's gun times, to compare against the next. |
| `newlyStarted(prev, batches)` | Which batches just fired. `prev === null` (first poll) announces nothing. |
| `applyLocal(seen, taps, stationId, stationName)` | Lays this phone's taps over the board. |
| `lastThrough(members, seen, stationId)` | When the last runner of a batch came through, or `null` while any are out. |

**A gun is announced only on a transition.** `newlyStarted` compares each poll against the
previous one and fires only for a batch whose gun went from unset to set. The first poll of
a session announces nothing, so a marshal joining mid-race is not hit by one alarm per wave
already running. A batch seen for the first time already started counts as not new, for the
same reason. A corrected gun *time* does not re-announce — the wave already went.

**Local taps win, until the server knows better.** `applyLocal` shows a tap instantly
instead of waiting for the next poll, but a board read **newer** than the local tap wins.
Without that rule an Undo masks the runner for good: a marshal who undid a mis-tap would
never see the genuine read that came later, and the wave could never complete.

**`done` requires everybody.** `lastThrough` returns `null` while even one runner is
unaccounted for, so a banner cannot claim a wave is through early.

### Timing

- Times are stamped with the **server's** clock: `/board` returns `serverMs`, the page
  keeps the offset, and every tap is stamped `Date.now() + offset`. A phone with a wrong
  clock cannot poison the results.
- A tap keeps the time it was made, even if it syncs an hour later from a dead spot.
- All times on screen are **Philippine time** (`Asia/Manila`), fixed rather than taken from
  the phone, so a handset left on another timezone cannot mislead.

### On the phone (`localStorage`)

| Key | Holds |
|---|---|
| `nv.m.key.<slug>` | The event API key. |
| `nv.m.station.<slug>` | The chosen station id. |
| `nv.m.q.<slug>` | Taps not yet accepted by the server. |
| `nv.m.mine.<slug>` | Taps this phone made, so Undo survives a reload. |
| `nv.m.sound.<slug>` | Alarm on/off. |
| `nv.m.device` | This phone's device id (shared across events). |

### Intervals

| Every | Does |
|---|---|
| 5s | Poll `/board`. |
| 4s | Flush the queue (also immediately on each tap and on coming back online). |
| 1s | Tick the clock and the banner's elapsed time. |

Polls carry a sequence number and a stale answer that a newer poll has overtaken is
discarded — on a congested venue LAN, out-of-order responses would otherwise re-announce a
gun or swallow one.

---

## 4. Known limits

Each of these is a deliberate trade, commented in the code where it lives.

1. **No per-marshal revocation.** The link carries the event's API key. Rotating it cuts
   off the station laptops too. Fix: separate marshal keys.
2. **Undo is per phone.** `nv.m.mine.<slug>` is local. A mis-tap on phone A cannot be
   undone from phone B; an organizer must do it in admin.
3. **A tap writes a read with no confirmation.** One stray touch is a real timing record.
   Undo is the only guard, and at a Start or Finish that record matters.
4. **`mine` grows for the whole event** and is re-serialised on every tap. Microseconds at
   a few hundred taps; past a few thousand on one phone, write entries individually.
5. **An Undo still masks a read made *before* the local tap** — another device catching the
   same runner first. Fix: give `/board` a device id per read.
6. **An empty batch is never "done"** — there is nobody to have come through, so its banner
   stays live.
7. **Done banners are not capped.** A marshal who never dismisses could stack a column of
   them at a busy Finish. Fix: auto-drop after N minutes.
8. **Audio needs a gesture first.** A phone blocks sound until the page has been touched. In
   practice the marshal taps the key screen or the station picker before any gun fires, and
   the banner carries the message regardless.
9. **`Asia/Manila` is hardcoded.** An event outside the Philippines would show wrong clocks
   until this becomes a per-event setting.
10. **`/board` sends every read for every bib at every station, every 5s, per phone.**
    Nothing at 100 runners; at 1,000 runners × 4 stations × 10 marshals it is ~40k rows
    every 5 seconds off one laptop.
11. **`replaceState(...)` is deprecated** in this SvelteKit version. It works; the modern
    form is `goto(url, { replace: true, shallow: true })`.

---

## 5. Testing

`centralapp/src/lib/marshal.test.ts` and `time.test.ts` cover the rules — runner states,
batch states, gun transitions, local-tap merging, `lastThrough`, and the `HH:MM:SS` and
Philippine-time formatters.

```bash
cd centralapp
npx vitest run src/lib/marshal.test.ts src/lib/time.test.ts
npx vitest run                 # whole suite
npx svelte-check --threshold error
```

### Driving it end to end

With the dev server up and an event seeded:

1. Open the marshal link on a second device or window; pick a station.
2. In admin → **Categories**, fire a batch's gun. Within ~5s: alarm, green banner, green tab.
3. Tap a few runners; confirm the rows land in `reads` with the right bib, tag and station.
4. Tap **Undo**; confirm the *same* row flips to `voided = true` — not a second row.
5. Reload; confirm Undo is still offered on taps made before the reload.
6. Push the rest of the batch through that station; confirm the banner flips to `✓ DONE`
   and stays until dismissed.
7. With a short course set on a category (`category_courses`), confirm its runners read
   "Tap to tag" at a skipped station and "Missed here" at one on their route.

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| Key screen although the link had `?k=` | The page reads the key after hydration. Give it a second. If it persists, the key is wrong — ask for a fresh link. |
| "That link is no longer valid" | The event key was rotated. The stored key is cleared; a new link is needed. |
| No alarm, but the banner appears | Sound is off, or the phone has not been touched yet so audio is still blocked. |
| Every runner of one category shows "Missed here" | That category's course is wrong in **Route & Map**, or the marshal is at a station not on it. |
| A batch never goes `✓` | Someone in it has not been read here — check for a bib still white or orange. An empty batch never goes done. |
| Counter says `n/m` with m unexpected | A search is active: the counter follows what is on screen. |
| Tagged but not in results | Check the read is not `voided`, and that its station name matched a real station. |
