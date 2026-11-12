// Which files of a repository are worth reading. No server-only import: tests use it.

/** Folders never worth reading: dependencies, VCS, build output, caches, IDE settings. */
const IGNORED_DIR =
  /(^|\/)(node_modules|bower_components|jspm_packages|\.git|\.svn|\.hg|\.next|\.nuxt|\.svelte-kit|\.output|dist|build|out|target|obj|coverage|htmlcov|\.nyc_output|\.turbo|\.vercel|\.cache|\.parcel-cache|vendor|third_party|__pycache__|\.venv|venv|\.tox|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.idea|\.vscode|\.vs|\.gradle|Pods|DerivedData|__snapshots__|\.yarn|\.pnpm-store)(\/|$)/;

const SOURCE_EXT =
  /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte|astro|css|scss|sass|less|html?|py|pyi|rb|go|rs|java|kt|kts|scala|swift|m|mm|c|h|cc|cpp|cxx|hpp|hh|cs|fs|php|ex|exs|erl|hrl|clj|cljs|lua|dart|zig|nim|ml|mli|hs|r|jl|sol|sql|graphql|gql|proto|prisma|sh|bash|zsh|ps1|tf|hcl|nix|cmake|gradle)$/i;
const DOC_EXT = /\.(md|mdx|rst|txt|adoc)$/i;
const CONFIG_EXT = /\.(json|jsonc|ya?ml|toml|xml|ini|cfg|tour)$/i;
const NAMED_FILES = /(^|\/)(Dockerfile|Makefile|Rakefile|Gemfile|Procfile|Justfile|go\.mod|Cargo\.toml|CMakeLists\.txt|build\.gradle(\.kts)?|pom\.xml|package\.json|pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt|deno\.jsonc?|tsconfig[^/]*\.json|vite\.config\.[mc]?[jt]s|next\.config\.[mc]?[jt]s)$/;

const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|uv\.lock|flake\.lock|mix\.lock|pubspec\.lock|Podfile\.lock)$/;
const GENERATED = /(\.min\.(js|css)|\.bundle\.(js|css)|\.map|\.snap|\.d\.ts\.map|_pb2(_grpc)?\.py|\.pb\.go|\.pb\.(cc|h)|\.generated\.[a-z]+|\.g\.dart|\.freezed\.dart)$/i;
const NOISE_CONFIG = /(^|\/)(\.eslintrc[^/]*|\.prettierrc[^/]*|\.stylelintrc[^/]*|\.editorconfig|\.gitattributes|\.gitignore|\.npmrc|\.nvmrc|renovate\.json|\.markdownlint[^/]*|\.github\/ISSUE_TEMPLATE\/.*|CODEOWNERS|LICENSE[^/]*|COPYING[^/]*|CHANGELOG[^/]*|HISTORY[^/]*)$/i;
/** Translations of the docs: the English README is enough. */
const TRANSLATED_DOC = /(^|\/)(README|readme)[._-](?!md$)[a-zA-Z-]{2,7}\.mdx?$|(^|\/)(i18n|locales?|translations?)\//;

const MAX_FILE_BYTES = 200_000;
/** Images sent to the model (architecture diagrams, screenshots): small rasters only. */
const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE = /\.(png|jpe?g|webp)$/i;

export type SkipReason = "ignored" | "binary" | "too_large" | "generated" | "lockfile";

/** null when the file should be read, otherwise why not. */
export function skipReason(path: string, size: number): SkipReason | null {
  if (IGNORED_DIR.test(path)) return "ignored";
  if (LOCKFILE.test(path)) return "lockfile";
  if (GENERATED.test(path) || NOISE_CONFIG.test(path) || TRANSLATED_DOC.test(path)) return "generated";
  if (!(SOURCE_EXT.test(path) || DOC_EXT.test(path) || CONFIG_EXT.test(path) || NAMED_FILES.test(path))) return "binary";
  if (size > MAX_FILE_BYTES) return "too_large";
  return null;
}

/** Text that is really minified or generated output: very long average lines. */
export function looksMinified(text: string): boolean {
  if (text.length < 2_000) return false;
  const lines = text.split("\n").length;
  return text.length / lines > 300;
}

export const isImage = (path: string, size: number) => IMAGE.test(path) && size <= MAX_IMAGE_BYTES && !IGNORED_DIR.test(path);
