# Showcase claims

Three complete, self-contained claim bundles that exercise the full range of the
assistant — each is a realistic mix of PDFs (claim form, policy, verification record,
estimate, invoice, incident report, registration) plus damage photos, with a deliberately
planted reasoning signal.

Run any of them (see the [project README](../README.md) for setup):

```bash
python main.py --claim showcase/CLM-2026-0143_suspicious_auto            # interactive
python main.py --claim showcase/CLM-2026-0142_clean_auto --yes           # auto-confirm
```

## The three claims

| Folder | Story | Planted signal | Expected verdict |
| --- | --- | --- | --- |
| `CLM-2026-0142_clean_auto` | Honest rear-end collision | Everything agrees — photos, estimate, invoice, policy, and claimant record are mutually consistent | **approve** (low risk) |
| `CLM-2026-0143_suspicious_auto` | "Minor bumper scrape, $350" | Photos show catastrophic frontal damage, the invoice is **$5,375**, and the required verification record is **absent** | **deny** (high risk) |
| `CLM-2026-0144_property_manual_review` | Storm damage to a home | Damage and estimate are plausible, but the surname is `Jonson` on the form vs `Johnson` on the verification record, and there's **no final paid invoice** | **manual_review** (medium risk) |

Each folder ships an `expected_verdict.json` (the oracle), and `ground_truth.csv` summarises
all three. The assistant **ignores** those oracle files when it reads a folder, so they
never leak into its reasoning.

The assistant reproduces all three verdicts, with the four checks matching the oracle
labels (`document_completeness`, `damage_description_consistency`, `amount_consistency`,
`identity_consistency`).

## Provenance

Everything here is **synthetic**, created for software testing. The damage images are
AI-generated; the PDFs are generated documents. All names, addresses, policy numbers, VINs,
companies, and verification records are fictional. The verification records are mock
insurer-issued records, **not** government credentials.
