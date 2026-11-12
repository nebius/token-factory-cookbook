Build a single-page token cost calculator for Nebius Token Factory models as one self-contained `index.html` file. No build step, no frameworks, no bundler, and no network requests at runtime — opening the file with `file://` must be enough.

Requirements:

- Inputs for model ID, input price per 1M tokens, output price per 1M tokens, input tokens per run, output tokens per run, and number of runs.
- Live results that recompute on every input change: input cost per run, output cost per run, total cost per run, and projected cost for all runs, each shown in USD with four decimal places.
- Seed the form with `moonshotai/Kimi-K3` at $3.00 input and $15.00 output per 1M tokens.
- A preset list of at least three Token Factory models that fills the form when a preset is chosen, with the pricing date stated in the page as an "as of" note.
- Validation that rejects negative and non-numeric values with an inline message next to the offending field, never rendering `NaN`.
- Plain CSS only, readable at both 375px and 1280px widths, and accessible: every input has a real `<label>`, and results update through an `aria-live` region.
- Keep the page under 400 lines and add a top-of-file comment block explaining the cost formula.

Also write a `README.md` that states how to open the page, the exact cost formula used, that prices are user-supplied rather than fetched, and where to check current Token Factory pricing.
