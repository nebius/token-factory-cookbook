# Third pass: polish fix list

The project works: `npm run build` passes and `npm run test:browser` passes 45/45. PROMPT.md is the original brief. Do not regress anything that works. This pass fixes visible weaknesses found in a review of screenshots/. Keep changes focused.

1. **Lens detail is not a close-up.** The "Lens detail" preset (screenshots/05-lens-detail.png) shows the whole camera from slightly closer; the lens fills only about a third of the frame. Make it a real close-up: the lens front fills roughly 60-70% of the viewport height, viewed from a low front three-quarter angle so the focus-ring ridges, front retaining ring and the curved glass are clearly visible. When the assembly is partially or fully exploded, the lens preset should frame the separated optical elements and aperture blades instead. The showcase's 10-14 s lens segment should use this framing with the aperture moving.

2. **Glass does not read as multicoated glass.** The front element reads as a flat, tinted blue-grey disc. Make the optical elements read as glass: near-clear, high-gloss (low roughness), strong environment reflections, and restrained blue / green / violet coating reflections (e.g. MeshPhysicalMaterial with iridescence + iridescenceThicknessRange, clearcoat, a low-opacity or transmission approximation). The aperture blades and interior should stay visible through the front element. Keep it subtle and premium, not rainbow.

3. **Front screws are oversized.** The screw heads on the front of the body (screenshots/01-assembled.png) are far too big for the scale and look like stickers. Scale them to realistic size (roughly 1.5-2 mm diameter relative to a ~130 mm wide body) and place them where screws plausibly go (around the lens mount ring, bottom plate, near seams), recessed slightly, with visible cross recesses. They must still separate into readable groups when exploded.

4. **Overall polish of the hero shot.** With the above done, look at the Hero screenshot as if it were the first frame of a product video, and improve one or two things that most hold it back (e.g. the grip texture, edge highlights, lighting contrast, the ground shadow). Do not restructure the scene.

Verification: after each item, run `npm run test:browser`, open the relevant screenshots with the Read tool and judge them visually. Add screenshots for the new lens close-up (assembled and exploded) if the script does not already capture them. Run `npm run build` at the end. Update the README's verification and known-limitations sections to match what is now true.

Finish with a short, factual account of what changed and what is still limited.
