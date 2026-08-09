# QuarterLink arcade-saloon state map

This folder maps the complete visible state surface of the July 2026 QuarterLink implementation and provides GPT-generated redesign concept boards. These are future-facing visual explorations, not production screenshots or implementation specifications.

## Art direction

- A welcoming neighborhood arcade saloon: warm timber, painted and clear-coated MDF cabinet panels, routed edges, brass fasteners, worn laminate, printed game marquees, screen-printed instruction cards, and framed fictional game artwork.
- Daylit amber and tobacco warmth with cream, oxblood, forest green, faded navy, mustard, and charcoal.
- No neon, RGB glow, cyberpunk, glassmorphism, casino styling, pixel-font gimmicks, or copyrighted game characters/artwork.
- UI remains readable and product-like. Physical arcade details frame the interface rather than obscuring it.

## Reachable visual states

The source of truth is `public/quarterlink-shell-v3.html`, `public/quarterlink-v3.js`, and `src/index.ts`.

| ID | Surface | Reachable visual state | Board |
|---|---|---|---|
| L1 | Landing | Default landing; friend, solo, and join entry points | `01-landing.png` |
| S1 | Solo setup | No source selected; start disabled | `02-solo-setup.png` |
| S2 | Solo setup | Free demo loading | `02-solo-setup.png` |
| S3 | Solo setup | Demo ready | `02-solo-setup.png` |
| S4 | Solo setup | ROM/BIOS pair ready | `02-solo-setup.png` |
| S5 | Solo setup | Missing ROM, BIOS, or both | `02-solo-setup.png` |
| S6 | Solo setup | Demo fetch failure | `02-solo-setup.png` |
| S7 | Solo setup | Starting/disabled submit | `02-solo-setup.png` |
| S8 | Solo setup | Emulator frontend/runtime/compatibility/30s timeout failure, selection retained, error toast | `02-solo-setup.png` |
| H1 | Host setup | Empty name and source; submit disabled | `03-host-setup.png` |
| H2 | Host setup | Name only; source needed | `03-host-setup.png` |
| H3 | Host setup | Source only; name needed | `03-host-setup.png` |
| H4 | Host setup | Valid name and source; ready to create | `03-host-setup.png` |
| H5 | Host setup | Creating room | `03-host-setup.png` |
| H6 | Host setup | Create/API error | `03-host-setup.png` |
| J1 | Join | Invite URL route, name entry | `04-join.png` |
| J2 | Join | Manual complete-link entry | `04-join.png` |
| J3 | Join | Missing name | `04-join.png` |
| J4 | Join | Missing/incomplete link or missing fragment | `04-join.png` |
| J5 | Join | Joining/disabled submit | `04-join.png` |
| J6 | Join | Invite invalid/already used | `04-join.png` |
| J7 | Join | Invite expired | `04-join.png` |
| J8 | Join | Both seats claimed | `04-join.png` |
| J9 | Join | Generic join/network error | `04-join.png` |
| R1 | Host lobby | Room starting, one seat, no source/controller | `05-host-lobby.png` |
| R2 | Host lobby | Room online, invite available/copied toast | `05-host-lobby.png` |
| R3 | Host lobby | Guest seated, encrypted connection establishing | `05-host-lobby.png` |
| R4 | Host lobby | Host controls missing | `05-host-lobby.png` |
| R5 | Host lobby | Guest controls missing | `05-host-lobby.png` |
| R6 | Host lobby | Guest connected but not ready | `05-host-lobby.png` |
| R7 | Host lobby | Both ready, start unlocked | `05-host-lobby.png` |
| R8 | Host lobby | Signaling reconnecting | `05-host-lobby.png` |
| R9 | Host lobby | Signaling offline after retry limit, reload toast | `05-host-lobby.png` |
| R10 | Host lobby | Guest removed; fresh invite and empty seat restored | `05-host-lobby.png` |
| G1 | Guest lobby | Joined but connecting to host | `06-guest-lobby.png` |
| G2 | Guest lobby | Connected, controls untested | `06-guest-lobby.png` |
| G3 | Guest lobby | Controls tested, ready action enabled | `06-guest-lobby.png` |
| G4 | Guest lobby | Guest ready; waiting for host to start | `06-guest-lobby.png` |
| G5 | Guest lobby | Guest toggles back to unready | `06-guest-lobby.png` |
| C1 | Controls | Keyboard and controller awaiting input | `07-controls.png` |
| C2 | Controls | Keyboard key detected | `07-controls.png` |
| C3 | Controls | Standard controller detected | `07-controls.png` |
| C4 | Controls | Nonstandard controller detected | `07-controls.png` |
| C5 | Controls | Controller disconnected | `07-controls.png` |
| P1 | Loading | Friend host: selecting/establishing connection | `08-loading.png` |
| P2 | Loading | Friend host: emulator/compatibility starting | `08-loading.png` |
| P3 | Loading | Guest: friend is starting the named game | `08-loading.png` |
| P4 | Loading | Guest sound autoplay blocked; enable-sound gate | `08-loading.png` |
| P5 | Loading | Sound remains blocked; browser-controls toast | `08-loading.png` |
| P6 | Loading | Solo: no-network stage, compatibility, ready | `08-loading.png` |
| P7 | Loading | Start failed; both players return to room, retry preserved | `08-loading.png` |
| A1 | Game | Solo game shell; no quality/diagnostics | `09-gameplay.png` |
| A2 | Game | Friend game shell while measuring connection | `09-gameplay.png` |
| A3 | Game | Friend game with measured Excellent/Good/Fair quality | `09-gameplay.png` |
| A4 | Game | Guest video waiting placeholder before tracks arrive | `09-gameplay.png` |
| M1 | Game menu | Closed | `10-menus-diagnostics.png` |
| M2 | Game menu | Menu sheet open | `10-menus-diagnostics.png` |
| M3 | Diagnostics | Detecting, blank RTT/jitter, zero inputs | `10-menus-diagnostics.png` |
| M4 | Diagnostics | Direct peer-to-peer measured | `10-menus-diagnostics.png` |
| M5 | Diagnostics | TURN relay measured | `10-menus-diagnostics.png` |
| X1 | Recovery | Connection lost; reconnecting attempt 1–3 | `11-recovery.png` |
| X2 | Recovery | Restore failed; retry and end actions | `11-recovery.png` |
| X3 | Recovery | Room expired toast before home redirect | `11-recovery.png` |
| X4 | Recovery | Guest removed and returned home | `11-recovery.png` |
| X5 | Recovery | Stale `/room/` route; room unavailable toast | `11-recovery.png` |
| D1 | Confirmation | End friend session confirmation | `12-confirmations-mobile.png` |
| D2 | Confirmation | End solo run confirmation | `12-confirmations-mobile.png` |
| D3 | Confirmation | Remove Player 2 and reinvite confirmation | `12-confirmations-mobile.png` |
| T1 | Toast | Invite copied | `12-confirmations-mobile.png` |
| T2 | Toast | Ready/unready | `12-confirmations-mobile.png` |
| T3 | Toast | Room closed/offline/start failure/sound blocked/action error | `12-confirmations-mobile.png` |
| V1 | Responsive | Mobile landing/setup/join/lobby | `12-confirmations-mobile.png` |
| V2 | Responsive | Mobile sheets, dialogs, errors, and toasts | `12-confirmations-mobile.png` |
| Q1 | Game library | Hosted catalog with search, co-op, versus, and favorites filters | `13-hosted-library.png` |
| Q2 | Game library | Hosted game detail; always-ready availability and room action | `13-hosted-library.png` |
| Q3 | Persistent room | Host's always-on shelf, selected game, and invite action | `13-hosted-library.png` |
| Q4 | Game library | Empty search with reset | `13-hosted-library.png` |
| Q5 | Game library | Hosted game temporarily unavailable with another-game recovery | `13-hosted-library.png` |
| Q6 | Source choice | Hosted library recommended; local files optional | `13-hosted-library.png` |

## Notes on state completeness

- Server-only JSON responses (`401`, `403`, `404`, invalid relay response, and support-code `500`) are not standalone app screens. They appear through the generic setup/join errors, the stale-room fallback toast, or the WebRTC/STUN fallback already represented above.
- `waiting`, `connecting`, `ready`, `playing`, and `ended` are backend room phases. The user-visible manifestations are represented by the lobby, loading, gameplay, and redirect/confirmation boards.
- Exact toast copy variants share one visual component state and are grouped on the final board.
- Desktop is the primary gameplay canvas. Mobile variants cover the shell and all overlay/component forms because the implementation warns that gameplay is best on desktop Chrome or Edge.
- The hosted-library extension is a future product concept, not a description of the current runtime. A game belongs there only when QuarterLink has distribution rights or an appropriate license; local-file support does not grant hosting rights.

## Dynamic prototype

[`prototype/index.html`](prototype/index.html) is an image-backed, ProtoPie-style interaction prototype. It defines each visual state as a source-board crop and each interaction as a normalized bounding box, so hotspots stay aligned at every viewport size. Use **Show hotspots** to inspect regions and the sidebar readout to see their coordinates and targets.

Serve this directory and open the prototype:

```bash
python3 -m http.server 4173 --directory docs/design/saloon-state-concepts
```

Then visit `http://localhost:4173/prototype/`.

- [`prototype/state-flow.svg`](prototype/state-flow.svg) — state-flow whiteboard
- [`prototype/videos/solo-happy-path.mp4`](prototype/videos/solo-happy-path.mp4) — 10-second solo path
- [`prototype/videos/friend-happy-path.mp4`](prototype/videos/friend-happy-path.mp4) — 18-second hosted-library friend path

The friend walkthrough now uses the hosted-library path: source selector → catalog → game details → persistent room → invite/start → gameplay. The walkthrough controls replay the state sequences inside the live prototype. The videos are deterministic image-crop exports of those sequences; they are not recordings of production behavior.
