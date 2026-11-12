# Accessibility

[← Back to the README](../README.md)

Built to WCAG 2.2 AA:

- **Keyboard.** Tab through the map's boxes from top to bottom (Enter selects, `O` opens a module, `[` `]` step through its links). With the map focused, `+` `−` `0` and the arrows zoom and pan. ←/→ step through a tour, space plays or pauses, `/` searches files, `F` finds on the map, `T` reads the tour as text, `?` lists every shortcut, and Esc closes whatever is open. Tabs, menus, radio groups and the file picker follow the usual arrow-key patterns.
- **Shortcuts.** They never fire while you type. Single-key shortcuts can be switched off in the shortcuts dialog, for speech input.
- **Focus.** It's always visible, including on diagram boxes, which scroll into view. Dialogs keep focus inside and return it on close, and so do menus and Stop.
- **Diagrams as text.** Every diagram has a text version (**List**): modules and their links, files and imports, functions and calls, each a button.
- **Screen readers.** Landmarks, a heading on every page and a skip link to the current step. Tours, answers, stages and copies are announced.
- **Colour.** Contrast was checked in both themes, colour is never the only signal, and forced-colours mode is supported.
- **Motion and size.** Animations stop under reduced motion, targets are at least 24 px, and the layout reflows down to 320 px.
- **Phone.** The tours, Ask box and docs open in a drawer, and the map scrolls with the page (two fingers to zoom it).
- **Checked.** `pnpm a11y` runs axe-core's WCAG 2.2 A and AA rules on the main pages in both themes; it reports no issues.

Day and night themes follow your system or the toggle.
