# Security policy

## Report a vulnerability

Report security issues privately through this repository's [GitHub security advisories](https://github.com/nebius/token-factory-cookbook/security/advisories/new). Include the affected recipe, revision, impact, and a minimal reproduction. Do not include real API keys, customer data, or kubeconfigs.

If private vulnerability reporting is unavailable, email [security@nebius.com](mailto:security@nebius.com), as listed in the [Nebius trust center](https://nebius.com/trust-center). Do not publish sensitive exploit details in a public issue while arranging disclosure.

## Run examples safely

Recipes are independent examples with different dependencies and deployment assumptions. Read the recipe's security notes before connecting credentials or running infrastructure operations. Keep local demos bound to localhost unless the recipe explicitly documents authenticated deployment.

Keep credentials in environment variables or local ignored files. Review dependency advisories and validate the recipe before adapting it to a shared environment.
