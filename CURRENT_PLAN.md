# Plan: Safely Handle Multiple Tabs Open (#52)

## Summary

The app currently has no awareness of multiple browser tabs. Since IndexedDB is shared across tabs, concurrent writes from two tabs could corrupt patch history or interleave edits unpredictably. We'll implement a single-active-tab lock using `BroadcastChannel`: the most recently loaded tab claims "active" status, while all other tabs receive a full-screen blocking overlay with a "Use here" button that reloads the page and re-claims active status. Keyboard shortcuts are also blocked while inactive by threading an `isActive()` check into the existing keydown handler.

## Relevant Context

- `src/index.ts`: `GTFSEditor` constructor + `init()` — where `TabLockController` will be instantiated and initialized (early in `init()`, before other modules start accepting edits)
- `src/modules/keyboard-shortcuts.ts:217` — single `document.addEventListener('keydown', ...)` in `bindEventListeners()`; add `if (!this.tabLock?.isActive()) return;` at the top
- `src/modules/notification-system.ts` — toast-style, not a blocking modal; **not suitable** for the inactive overlay (no backdrop, always has a dismiss button)
- `BroadcastChannel` API — built-in, no deps, ~97% support, messages do NOT go to the sender tab
- The overlay blocks all mouse interaction via `pointer-events`; keyboard shortcuts need a separate guard
- Simultaneous tab open edge case: two tabs broadcasting `claim` at the same time both hear each other and both deactivate. Fix: include `claimedAt: Date.now()` in the claim; the **later** claimant wins (higher timestamp). If equal, higher `tabId` wins. Each tab only deactivates if the incoming claim is "newer" than its own.

## Phase 1: TabLockController + Blocking Overlay

**Goal:** Implement cross-tab coordination and the blocking UI. This is a self-contained new module wired into `index.ts`.

- [x] Create `src/modules/tab-lock.ts` with `TabLockController` class:
  - Fields: `private tabId: string` (from `crypto.randomUUID()`), `private claimedAt: number` (from `Date.now()`), `private active = true`, `private channel: BroadcastChannel`, `private overlay: HTMLElement | null = null`
  - `init()` method:
    1. Open `new BroadcastChannel('gtfs-zone-tab-lock')`
    2. Set `this.channel.onmessage = (e) => this.handleMessage(e.data)`
    3. Broadcast `{ type: 'claim', tabId: this.tabId, claimedAt: this.claimedAt }`
    4. Register `window.addEventListener('beforeunload', () => this.channel.close())`
  - `private handleMessage(msg: { type: string; tabId: string; claimedAt: number })`:
    - If `msg.type !== 'claim'` return
    - If incoming is newer: `msg.claimedAt > this.claimedAt || (msg.claimedAt === this.claimedAt && msg.tabId > this.tabId)`
    - Then: `this.active = false`, call `this.showOverlay()`
  - `private showOverlay()`:
    - If `this.overlay` already exists, return (idempotent)
    - Create a `div` appended to `document.body`:
      ```
      class="fixed inset-0 z-[200] bg-base-300/80 backdrop-blur-sm flex items-center justify-center"
      ```
    - Inner card HTML (Tailwind + DaisyUI):
      ```html
      <div class="card bg-base-100 shadow-2xl p-8 text-center max-w-sm">
        <h2 class="text-xl font-bold mb-2">Tab not active</h2>
        <p class="text-base-content/70 mb-6 text-sm">
          This editor is open in another tab. Only one tab can edit at a time.
        </p>
        <button id="tab-lock-use-here" class="btn btn-primary w-full">Use here</button>
      </div>
      ```
    - Wire: `overlay.querySelector('#tab-lock-use-here')?.addEventListener('click', () => window.location.reload())`
    - `console.log('[TabLock] Tab deactivated — another tab claimed active status')`
  - `isActive(): boolean { return this.active; }`

- [x] In `src/index.ts`:
  - Import `TabLockController` from `./modules/tab-lock.js`
  - Add `public tabLock: TabLockController` as a class field
  - In constructor: `this.tabLock = new TabLockController()`
  - In `init()`, as the **first** async step before any other module init: `this.tabLock.init()`
  - Add `tabLock: this.tabLock` to the object passed to `KeyboardShortcuts` constructor (or pass separately — see Phase 2)

**Gotchas:**
- `z-[200]` is needed — the notification container is `z-50`, the map controls are likely `z-10`; `200` safely wins
- `BroadcastChannel` fires async, so it's impossible to block init before the channel fires. The overlay will appear after the rest of the app has initialized. This is fine — it deactivates on the next event loop tick after a competing tab opens.
- The `beforeunload` handler closes the channel cleanly but does **not** broadcast a "release" — inactive tabs stay inactive until the user explicitly clicks "Use here". This is intentional: simpler, and avoids auto-unblocking a tab the user isn't looking at.

## Phase 2: Block Keyboard Shortcuts When Inactive

**Goal:** Prevent keyboard shortcuts from firing in an inactive tab (the overlay blocks mouse events but not keyboard).

- [x] Extend the duck-typed `gtfsEditor` interface in `src/modules/keyboard-shortcuts.ts` to include:
  ```typescript
  tabLock?: { isActive(): boolean };
  ```
- [x] At the top of the `keydown` handler in `bindEventListeners()` (`keyboard-shortcuts.ts:218`), add:
  ```typescript
  if (this.gtfsEditor.tabLock && !this.gtfsEditor.tabLock.isActive()) return;
  ```
  This goes before the `const key = ...` line, so inactive tabs silently swallow all shortcuts.

**Gotchas:**
- The `gtfsEditor` param is duck-typed (not an actual `GTFSEditor` import), so adding an optional field is a safe, non-breaking change.
- No need to block CodeMirror or table cell edits separately — the overlay's `pointer-events` coverage prevents the user from ever focusing those elements in the first place.

---

## Original Issue

Likely we can only have one open session, so we'd have an in memory lock and you'd say "use here" if you want to switch or something.
