# Claude Configuration for Snake Game Project

## Project Overview
This is a snake battle game with AI-controlled opponents powered by LLM APIs. The game features:
- Dual-player AI battles with different LLM models
- Real-time performance tracking and latency metrics
- Model benchmarking capabilities
- Interactive UI with game logs and statistics

## Project Rules

### UI Layout Preservation ⚠️ CRITICAL
**When optimizing code, NEVER break the UI layout structure:**

1. **HTML Structure Rules:**
   - Never add or remove `</div>` tags without proper context
   - Maintain the exact nesting structure: main-container → left-pane/right-pane → game-toolbar → game-layout → game-center-panel/game-right-panel
   - Both game panels must remain present: canvas (center), game log (right). The fruit legend is a compact `🍎 Legend` button in `.game-toolbar` that opens a fixed popover (no longer a left column).
   - Canvas and game log panels must maintain matching 600px heights

2. **CSS Layout Rules:**
   - Preserve flex layouts and flex properties
   - Do not change widths that affect layout structure
   - Maintain responsive breakpoints (currently 600px)
   - Keep game panel alignment: center (canvas) + right (game log)

3. **Before Making Changes:**
   - Verify the visual layout is correct before starting any optimization
   - Test UI changes in browser immediately after modifications
   - Use HTML structure validation tools if unsure
   - Ensure div tags are perfectly balanced (equal opening/closing counts)

4. **After Making Changes:**
   - Check that the `🍎 Legend` button is visible in the toolbar above the canvas, and its popover opens/closes correctly
   - Verify canvas takes most space in center (600x600)
   - Confirm game log matches canvas height on right (600px)
   - Test responsive layout at different screen sizes

### Security Rules
- Always use DOM manipulation instead of `innerHTML` for user input
- Validate and sanitize all API inputs (URLs, keys, model names)
- Never trust and directly inject user-controlled content into the DOM

### Performance Optimization Rules
- Canvas rendering: Use dirty rectangle approach when updating game state
- Memory management: Track and clean up all timeouts, event listeners, and async operations
- State changes: Only redraw when actual game state changes, use `needsRedraw` flag

### Code Quality Standards
- Maintain proper error handling with meaningful messages
- Keep functions focused and single-purpose
- Use descriptive variable names and add comments for complex logic
- Follow consistent code formatting and patterns

### Testing Requirements
- Test XSS protection by attempting malicious input in model names/logs
- Verify memory usage doesn't grow unbounded during extended gameplay
- Monitor frame rate and ensure smooth animations
- Test cleanup by starting/stopping games multiple times

## Development Workflow
1. Read and understand existing code structure before making changes
2. Test UI layout after any HTML/CSS modifications
3. Run security checks before committing XSS-related changes
4. Perform performance testing after optimizations
5. Ensure all critical bugs are fixed before adding new features

## Critical Files
- `snake-1.html`: Main UI structure (maintain careful balance of div tags)
- `style.css`: Layout and styling (preserve flex layouts and panel dimensions)
- `game.js`: Game logic and performance optimizations
- `benchmark.js`: Model performance testing

## Known Issues and Fixes
- Fixed: HTML structure breaking due to extra `</div>` tags
- Fixed: XSS vulnerabilities in game log rendering
- Fixed: Memory leaks from untracked setTimeout calls
- Fixed: Canvas performance issues from excessive redraws
- Fixed: JavaScript syntax errors from duplicate code blocks

## Contact
For questions or issues, refer to this document and the project README.md