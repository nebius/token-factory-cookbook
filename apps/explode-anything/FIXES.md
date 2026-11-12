# Second pass: fix list

This project was started in a previous session (the full brief is in PROMPT.md, which still applies in full). The code in src/ builds and its internal state checks pass (33 parts, reversible explosion, selection, modes, aperture, shutter all wired), but a review of the real screenshots in screenshots/ found that the visible result is far from the brief. Fix these, in this order, then re-verify with real screenshots.

1. **Framing.** The Hero preset is so close the viewport shows only part of a lens ring and the body; the whole camera is never visible. Hero must show the complete assembled camera, front three-quarter, filling roughly 55-65% of the viewport width. Exploded overview must fit the whole exploded bounds (compute from the Box3 of all parts at assembly=100). Every preset must be checked by screenshot.
2. **Recognizable camera.** From a proper distance, check the silhouette reads as a mirrorless camera: body roughly 2:1.4 width:height, a pronounced grip on the right (viewed from the front), a centered-left lens mount, an EVF hump on top centered over the mount, and a 50mm lens about as long as its diameter. Fix proportions and positions in the registry; do not stack disconnected slabs.
3. **Header layout.** The title block overlaps and clips ("Pull it apart." is cut off at the top, the intro wraps into the title). The "Play showcase" button is pushed off the right edge at 1440px. Make it a single clean row: small title + one-sentence intro on the left, controls on the right, nothing clipped at 1280 and 1440 widths.
4. **Assembly bar is missing.** The bottom bar with the Assembly slider + percentage, Explode, Assemble, Play/Pause and Reset does not appear on screen. It must be visible along the bottom at desktop and mobile.
5. **Mobile (390x844).** The canvas covers only part of the width. The canvas must be full width; inspection goes into a collapsible bottom panel; the slider stays usable.
6. **WebGL fallback.** On WebGL failure the message is written into #loading, which buildUI has already hidden, so the user sees nothing. Show a visible fallback message.
7. **Lighting and materials.** Use the official RoomEnvironment (PMREMGenerator) for neutral reflections; keep the graphite body, brushed metal, and glass with subtle coloured reflections per the brief.
8. **README.md** with setup/run commands, architecture, component inventory, known simplifications and verification results (only what you actually checked).

Verification: scripts/browser-check.mjs already launches a Chromium that renders WebGL. Re-run it after each major fix, open every screenshot with the Read tool and judge it visually; a state check passing is not evidence the page looks right. Run `npm run build` at the end.

Finish with a short, factual account of what works, what was checked, and what is still limited.
