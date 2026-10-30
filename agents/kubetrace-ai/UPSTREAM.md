# Source and license

This directory contains a copy of [Studio1-OSS/kubetrace-ai](https://github.com/Studio1-OSS/kubetrace-ai) at commit [`6a111412eeaadd831f499aa6c72c55e3a99e7fef`](https://github.com/Studio1-OSS/kubetrace-ai/tree/6a111412eeaadd831f499aa6c72c55e3a99e7fef), maintained by the Studio1 team.

The application is distributed under Apache-2.0. Its original [LICENSE](LICENSE) is retained here. The copied sample reports retain their original model and run provenance; they are not new cookbook runs.

Cookbook adaptations:

- Replaced the upstream README with a hands-on recipe that runs from `agents/kubetrace-ai` in this repository.
- Changed guide links to the included source and documentation, while retaining upstream attribution and Beam/Token Factory references.
- Added `apps/web/pnpm-workspace.yaml` to allow esbuild's platform setup when installing with pnpm 11+.
- Explicitly retained the blank `.env.example` template despite parent cookbook ignore rules.
- Added authentication regression tests and authorize API requests using the router path, independent of the Host header.
- Updated Python and frontend dependencies to address published security advisories.
- Omitted the generated `apps/web/tsconfig.tsbuildinfo` cache and ignored future TypeScript build caches.

No Git metadata, credentials, kubeconfigs, local run database, installed dependencies or generated build output is included. Application source, Dockerfiles, deployment manifests, docs and sanitized example reports originate from the revision above, with the cookbook-specific changes listed here.

For upstream development and contributions, see [Studio1-OSS/kubetrace-ai](https://github.com/Studio1-OSS/kubetrace-ai). Update this provenance note when refreshing the application copy.
