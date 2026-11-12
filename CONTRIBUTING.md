# Contributing to the Token Factory Cookbook

Thank you for sharing examples, improving documentation, and fixing recipes.

## Choose a home for your recipe

| Directory | Content |
| --- | --- |
| `api/` | API and SDK examples |
| `models/` | Model-specific guides |
| `agents/` | Agents, organized by framework when applicable |
| `tool-calling/` | Tool and function calling |
| `rag/` | Retrieval and document workflows |
| `apps/` | Complete application demos |
| `integrations/` | External tools and platform integrations |
| `coding/` | Coding agent setup and workflows |
| `evaluations/` | Reproducible evaluations |
| `post-training/`, `distillation/` | Model adaptation |
| `workshops/` | Guided learning sessions |

Keep each runnable recipe self-contained in a descriptive, lowercase directory. Keep existing published paths working. If you change a path, update its callers and leave a forwarding README where readers may still arrive.

## Make the example reproducible

Use the [recipe README template](.github/RECIPE_TEMPLATE.md). Document the outcome, prerequisites, exact setup and run commands, expected output, and limitations. Specify the model and endpoint actually used; distinguish recorded results from a new validation run.

Keep dependencies in the recipe directory. Commit the appropriate lockfile for an application. Describe which commands work without credentials and which call paid services or change external systems. Explain how to clean up resources created by the example.

Never commit credentials, local databases, kubeconfigs, dependency folders, or generated build output. Environment templates contain blank values or obvious placeholders. Clear notebook execution output and execution counts before submitting.

If copying another project, retain its license and attribution, record its source revision, and describe cookbook-specific changes.

## Connect the documentation

Add the recipe to its category index. Add it to the root featured list only when it helps readers discover a distinct workflow. Use relative links for files in this repository and descriptive text for images.

Use **Nebius Token Factory** on first mention, then **Token Factory**. Use sentence case, concise descriptions, and the [repository brand assets](.github/brand/README.md). Preserve historical product names inside quotations, upstream titles, and dated event material.

## Validate the change

From the repository root:

```bash
python3 .github/scripts/check_internal_links.py
python3 -m unittest test_recipe_secret_hygiene test_batch_notebook
python3 -m unittest discover -s api -p 'test_*.py'
git diff --check
```

Run the recipe's own tests, type checks, and build when applicable. For an application dependency change, run its package audit too. Do not run live inference or infrastructure tests unless you have the required credentials and intend the resulting cost and changes.

In your pull request, state what changed, what a reader can now do, which checks passed, and which live integrations remain unverified. Include a screenshot when changing a visible interface.

## Report problems

Use [issues](https://github.com/nebius/token-factory-cookbook/issues) for recipe bugs and ideas. For sensitive findings, follow [SECURITY.md](SECURITY.md) instead of posting exploit details in a public issue.
