# QuarterLink visual direction

These boards were generated with the built-in GPT image-generation workflow before the July 2026 interface rebuild:

- `quarterlink-desktop-direction.png` — landing, friend setup, join, readiness, loading/sound, gameplay, diagnostics, and reconnect direction.
- `quarterlink-mobile-states.png` — responsive landing/setup/join/lobby plus controller, error, toast, diagnostics, and recovery states.

They are design references, not production screenshots. The implemented interface uses semantic HTML and CSS rather than embedding the board imagery.

## Direction prompt

Reimagine QuarterLink as a sophisticated late-night social arcade lounge: graphite and ink surfaces, warm phosphor amber primary actions, electric mint readiness, restrained berry recovery/error states, creamy editorial typography, tactile hardware-inspired details, and CRT texture only inside game imagery. Avoid generic cyberpunk neon, pixel-font overload, glassmorphism, fake devices, fabricated location or latency, and copyrighted game artwork. Cover the complete desktop and responsive flow, including setup, join, readiness, sound activation, gameplay, diagnostics, controller testing, errors, toasts, and reconnect recovery.

## Product truths carried into the implementation

- Solo play is local and creates no network room.
- Friend mode runs the game on the host and streams gameplay to Player 2.
- ROM and BIOS files remain on the host device.
- Metal Slug 2 is not bundled; Frog Feast is the credited free test game.
- Direct versus relay and round-trip time appear only after WebRTC measurement.
