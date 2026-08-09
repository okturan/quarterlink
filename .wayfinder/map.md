---
label: wayfinder:map
title: QuarterLink — multi-system browser arcade
---

# QuarterLink — multi-system browser arcade

## Destination

QuarterLink plays local multi-system games in-browser (solo + friends), not a
Metal Slug-only demo. First cut: detect and run SNES / NES / Genesis / FBNeo
arcade (with optional Neo Geo BIOS), keep Frog Feast, strip mslug hardcoding.

## Notes

- Domain: zero-install browser arcade; ROMs stay on device; WebRTC friend stream.
- **Agent defaults (user said "everything" / "continue without me" / "full steam"):**
  - Systems in v1: SNES, NES, Genesis/MD, FBNeo arcade (+ Neo Geo when `neogeo.zip` present).
  - Solo is the first path that must feel perfect; friends mode keeps host-local emulate + stream.
  - Visual: preserve light product shell; only rewrite game-source copy/UX (no marketing overhaul).
  - No commercial ROM/BIOS downloads or redistribution. Homebrew Frog Feast stays the free fixture.
- Skills: `workers-best-practices` / `wrangler` for Worker; existing EmulatorJS pin 4.2.3.
- Tracker: local markdown under `.wayfinder/`.
- Execution override: build against these defaults; user can reject later.

## Decisions so far

- [Agent defaults for first multi-system cut](tickets/001-agent-defaults.md) —
  SNES/NES/Genesis/FBNeo; solo-first; preserve light UI; no commercial ROM fetching.

## Not yet specified

- Rollback / GGPO vs keep authoritative host stream for friends.
- Full console catalog beyond the four systems (PS1, N64, etc.).
- TURN credentials and NAT relay productization.
- Broader visual redesign (landing overhaul) if user returns to design-taste.

## Out of scope

- Downloading or hosting commercial ROMs / BIOS dumps.
- Shipping GGPO rollback in this cut.
- Claiming the product is Fightcade-equivalent.
