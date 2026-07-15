# QuarterLink visual direction

The authoritative July 2026 direction is [`quarterlink-light-product-direction.png`](quarterlink-light-product-direction.png). It was generated with the built-in GPT image-generation workflow after the first dark lounge exploration was rejected during review.

The earlier `quarterlink-desktop-direction.png` and `quarterlink-mobile-states.png` boards remain only as design-history artifacts. They are not the current visual specification.

These are direction boards, not production screenshots. The application implements the system with semantic HTML and CSS rather than embedding the generated artwork.

## Current direction prompt

Create a complete, shippable light product interface for QuarterLink across landing, solo source selection, friend-room creation, invite join, two-seat lobby, loading, browser sound activation, gameplay, controller testing, diagnostics, reconnect recovery, end-session confirmation, toast, and responsive mobile states. Use warm off-white pages, crisp white cards, charcoal/slate type, one restrained cobalt action color, soft sage success, muted coral errors, hairline borders, subtle shadows, generous spacing, and mature product typography. Avoid dark themes, neon, glow, cyberpunk, CRT styling, pixel fonts, arcade-cabinet illustration, glassmorphism, fake devices, fabricated measurements, or copyrighted game art.

## Product truths carried into the implementation

- Solo play is local and creates no network room.
- Friend mode runs the game on the host and streams gameplay to Player 2.
- ROM and BIOS files remain on the host device.
- Metal Slug 2 is not bundled; Frog Feast is the credited free test game.
- Direct versus relay and round-trip time appear only after WebRTC measurement.
- The UI does not claim that temporary room coordination data is never stored.
