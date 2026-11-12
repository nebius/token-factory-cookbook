Build “Explode Anything”: a polished interactive 3D website where visitors can disassemble, inspect, and reassemble a detailed mirrorless camera and its lens.

Implement the complete working project in the current workspace. Make reasonable decisions and continue through implementation, browser inspection, and fixes. Deliver runnable code, not a proposal.

CREATIVE DIRECTION

The experience should feel like an interactive industrial-design exhibit.

The camera is the hero. On first load, show a beautifully lit, assembled camera in a front three-quarter view, large enough to appreciate its details. Visitors should immediately understand that they can pull it apart.

Use an original, unbranded camera design inspired by a premium full-frame mirrorless camera with a detachable 50 mm prime lens.

Visual treatment:
- Graphite-black camera body with textured grip.
- Brushed metal chassis and machined lens rings.
- Subtle silver screws and contacts.
- Multicoated glass with restrained blue, green, and violet reflections.
- Dark charcoal studio background with soft lighting and grounded shadows.
- Warm white typography and one restrained amber accent.
- Clean editorial interface with generous spacing.
- Carefully composed close-ups and smooth animation.

The result should be visually compelling enough for a 20-second product video, while remaining genuinely interactive.

TECHNICAL SETUP

Use:
- Vite.
- TypeScript.
- Three.js.
- HTML/CSS for the interface.
- Three.js OrbitControls and appropriate official addons.

Use a modular project structure. Pin dependencies and include a lockfile.

Build the camera geometry procedurally in code. Do not download a prebuilt camera model, use a rendered image as the object, or substitute a video for the interactive scene.

Procedural textures, generated environment lighting, and canvas-generated markings are allowed. No external image-generation or 3D-generation services are required.

The application must run locally using:
npm install
npm run dev

Include:
npm run build

No backend, account, API key, or runtime model call should be needed to explore the finished demo.

CAMERA MODEL

Create a coherent, recognizable mirrorless camera with believable proportions.

Use a consistent coordinate system:
- Camera front points toward +Z.
- Up is +Y.
- Lens optical axis runs along Z.

Model these separately selectable assemblies and components:

Exterior:
1. Front body shell with lens-mount opening.
2. Rear shell with screen recess.
3. Top plate.
4. Bottom plate.
5. Textured grip.
6. Rear LCD and its frame.
7. Electronic viewfinder housing and eyecup.
8. Shutter button.
9. Mode dial.
10. Control dial.
11. Hot shoe.
12. Battery and removable battery door.
13. Representative mounting screws.

Internal body:
14. Metal chassis with visible openings and mounting points.
15. Main PCB with recognizable chips, connectors, and traces.
16. Sensor PCB.
17. Rectangular image sensor with a reflective surface.
18. Simplified focal-plane shutter frame and blade assembly.
19. Lens mount with bayonet features and electrical contacts.

Lens:
20. Rear mounting ring.
21. Outer barrel.
22. Focus ring with fine grip ridges.
23. Aperture assembly with overlapping blades.
24. Front retaining ring.
25. At least five distinct optical elements arranged into groups.
26. Internal spacer rings.

Aim for approximately 30–60 meaningful selectable parts or subassemblies. Repeated screws and decorative details may be instanced.

Prioritize believable geometry, silhouette, fit, and materials over arbitrary mesh counts. Do not advertise inflated part counts.

The assembled state must make spatial sense:
- Lens elements share an optical axis.
- The lens attaches to the front mount.
- The shutter sits immediately in front of the sensor.
- Sensor, electronics, chassis, and rear display fit within the body.
- Screws align with their representative mounting positions.
- There is no DSLR mirror or optical pentaprism in this mirrorless design.

This is an educational interpretation of camera construction. Do not imply it is a manufacturer-accurate teardown or validated optical design.

MODEL DETAIL

Avoid building the entire camera from plain, sharp-edged boxes and cylinders.

Use:
- Rounded or beveled body edges.
- Recesses, seams, and mounting holes where visible.
- Ribbed lens rings.
- Thin layered circuit boards.
- Lens surfaces with curvature rather than flat transparent discs.
- Screw heads with visible slots or cross recesses.
- Small printed markings generated in code.
- Different roughness and metalness values for adjacent materials.

Glass should read as glass while keeping interior components visible. Use a practical approximation if full transmission is too expensive.

EXPLODED VIEW

Create a primary “Assembly” slider from 0 to 100:
- 0 = completely assembled.
- 100 = fully exploded.

Use the same persistent objects throughout. Do not swap between unrelated assembled and exploded models.

Store each component’s:
- Stable ID.
- Parent assembly.
- Assembled transform.
- Exploded transform or motion path.
- Display name.
- Description.
- Educational category.

Interpolate transforms from these definitions. Moving the slider backward must precisely restore the assembly without accumulated drift.

Choreograph the explosion in stages:
1. Lens separates from its mount.
2. Front and rear shells open outward.
3. Top plate and bottom plate separate vertically.
4. Rear screen and electronics spread behind the body.
5. Shutter and sensor separate along the optical axis.
6. Lens barrel opens, revealing optical elements and aperture blades.
7. Small hardware separates into readable groups.

Use purposeful offsets and restrained rotations. Avoid a random cloud of floating parts.

Keep lens elements aligned along the optical axis. Separate the surrounding barrel sections enough to expose them.

At full explosion, the camera’s construction should remain understandable.

Provide:
- Assembly slider with percentage.
- Explode button.
- Assemble button.
- Play/Pause.
- Reset.

Dragging the slider while animation is playing must stop playback and give the visitor immediate control.

PART INSPECTION

Visitors can:
- Hover over a part to see a subtle highlight and its name.
- Click a part to select it.
- Read a concise explanation of what it does.
- Focus the camera on the selected component.
- Clear selection using Escape or a visible control.

Provide an organized parts list:
- Body.
- Optics.
- Electronics.
- Hardware.

Selecting an entry selects the corresponding 3D object.

Descriptions should be accurate and short. Use representative dimensions only if clearly labelled as illustrative. Do not invent manufacturer specifications.

Use HTML labels anchored to selected 3D positions. Avoid displaying all labels simultaneously.

Distinguish an orbit drag from a click so rotating the view does not accidentally select parts.

INTERACTIVE MECHANISMS

Implement these after the core camera and exploded view work:

1. Aperture control
- Slider from f/1.8 to f/16.
- Blades visibly rotate or slide to change the opening.
- Preserve a plausible overlapping iris appearance.
- Explain that this is a simplified visualization.

2. Shutter demonstration
- A “Release shutter” button animates the shutter assembly.
- Briefly expose the sensor.
- Make the action visible in exploded or inspection mode.
- Provide a close-up preset.

3. Light-path visualization
- Toggle a small number of animated rays travelling along the lens axis toward the sensor.
- Make rays converge approximately toward the sensor plane.
- Keep them subtle and label the visualization as schematic.
- Avoid claiming a physically accurate ray-traced lens simulation.

VIEWING MODES

Provide:
- Materials: realistic material presentation.
- Technical: pale surfaces with readable dark edges.
- X-ray: outer shells become translucent while internals remain readable.

Restore original material settings correctly when switching modes.

Camera presets:
- Hero.
- Front.
- Rear.
- Exploded overview.
- Lens detail.
- Sensor and shutter detail.

Use smooth transitions. Keep manual orbit controls responsive afterward.

Fit the current object bounds when needed so the expanded assembly stays within the viewport. Do not continually override the visitor’s chosen camera angle.

PAGE LAYOUT

Desktop:
- Large central 3D viewport.
- Small title and one-sentence introduction.
- Compact inspection panel on the right.
- Assembly controls along the bottom.
- View and display controls placed unobtrusively.
- Collapsible parts list.

Suggested visible text:
“EXPLODE ANYTHING”
“Inside a mirrorless camera”
“Pull it apart. Discover what makes the image.”

Show a small note:
“Conceptual assembly. Geometry and optical behavior are simplified.”

The viewer should dominate the page. Avoid large marketing sections, pricing cards, dashboards, excessive badges, or oversized navigation.

For narrow screens:
- Keep the canvas prominent.
- Move inspection details into a collapsible bottom panel.
- Keep the assembly slider usable with touch.
- Prevent controls from covering the whole object.

DEMO MODE

Add a “Play showcase” button that runs a repeatable 20-second sequence:
- 0–3 seconds: assembled hero view with subtle camera movement.
- 3–10 seconds: staged explosion.
- 10–14 seconds: lens close-up with aperture movement.
- 14–17 seconds: sensor and shutter reveal.
- 17–20 seconds: reassemble and return to the original hero pose.

Allow immediate cancellation by user input.

The showcase must use the real scene and real interactions.

Include a clean presentation mode that hides secondary panels while retaining a small exit control. Do not add model names, provider branding, performance claims, or fabricated cost figures to the scene.

PERFORMANCE AND RELIABILITY

- Use instancing for repeated small hardware where appropriate.
- Reuse geometry and materials.
- Cap rendering pixel ratio on high-density screens.
- Avoid heavy postprocessing unless it materially improves the result.
- Handle resize and device orientation changes.
- Aim for smooth interaction on a typical laptop.
- Measure performance if browser tools permit; do not invent FPS claims.
- Show a helpful fallback if WebGL initialization fails.
- Respect prefers-reduced-motion and do not autoplay the showcase.
- Ensure controls have accessible labels and visible keyboard focus.
- Dispose of resources and event listeners correctly.

IMPLEMENTATION APPROACH

Work in this order:
1. Scaffold the project and establish the coordinate system.
2. Build a convincing assembled camera silhouette.
3. Add the meaningful internal components and lens details.
4. Implement reversible staged explosion.
5. Add selection, descriptions, camera presets, and display modes.
6. Add aperture, shutter, and light-path interactions.
7. Polish lighting, materials, layout, and showcase mode.
8. Inspect and repair the result.

Do not spend the entire run planning. Get a working scene running early.

Use a data-driven component registry so another object could later replace the camera without rewriting the entire viewer.

VERIFICATION

Run the production build and fix failures.

If browser tools are available, inspect:
- Assembled state.
- Half-exploded state.
- Fully exploded state.
- Lens close-up.
- Narrow-screen layout.

Exercise:
- Slider endpoints and reversal.
- Explode, Assemble, and Reset.
- Selection from both canvas and parts list.
- View mode switching.
- Aperture and shutter controls.
- Showcase start and cancellation.

Check:
- No missing assets or runtime errors.
- Parts remain aligned when reassembled.
- The scene remains framed at full explosion.
- Labels and controls do not obscure essential geometry.
- Buttons perform the actions their labels promise.

Capture screenshots if tools permit. Correct visible problems before finishing. If a check cannot be performed, state that clearly.

DELIVERABLES

Leave:
- Complete source code.
- Dependency lockfile.
- README with setup and run commands.
- Short architecture explanation.
- Component inventory.
- Known simplifications.
- Verification results.

Finish with a concise account of what works, what was checked, and any remaining limitations.

Build the experience now.

---
Tooling note for this run: for browser inspection, you can install Playwright as a devDependency (`npx playwright install chromium`) and write a small script that loads the dev or preview server in headless Chromium (use the `--use-gl=angle` / swiftshader flags if WebGL fails headless), exercises the controls, logs console errors, and saves screenshots to ./screenshots/. Look at the screenshots with your Read tool and fix what you see.
