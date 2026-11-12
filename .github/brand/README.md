# Repository brand assets

The cookbook cover follows the Nebius Token Factory communication design system supplied for this repository refresh (August 2026).

- Navy `#001A2B` is the cover surface; Deep Blue `#052B42` is the secondary surface.
- Lime `#DAFF33` and Lavender `#C1C1FF` provide accents.
- The full-color Token Factory lockup is copied unchanged in [token-factory-logo.svg](token-factory-logo.svg).
- The cover uses Gramatika Bold at 72px for its title and Inter at 14, 16, 18, and 24px for supporting text.
- Text is outlined in [cookbook-banner.svg](cookbook-banner.svg) so the cover does not need downloadable fonts. Font files are not bundled here.

To regenerate the cover from a local copy of the design system:

```bash
uv run --no-project --with fonttools .github/scripts/build_brand_banner.py \
  --design-system /path/to/design-system
```

Use sentence case, the supplied logo lockup, and the approved palette. Avoid emoji, italic type, and recreated logos in new communication assets. Markdown pages use GitHub's own typography and theme; the cover stays navy in both light and dark modes.

These identity assets are used for this cookbook's presentation. Their inclusion does not grant rights to use Nebius trademarks for another product or imply endorsement of a community application.
