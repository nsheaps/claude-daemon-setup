# CI workflows

- exact conventions in `docs/research/patterns-ci-release.md`; this doc only records the deltas/decisions for *this* repo.
- files: `.github/workflows/check.yaml`, `.github/workflows/test.yaml`, `.github/workflows/release.yaml`.
- `check.yaml`: `jdx/mise-action@v2` then `mise run check` (`lint` + `fmt-check` + `test`), triggers `push: [main]` + `pull_request`.
- format job is diff-check-only — fails if unformatted, never auto-commits (this repo touches service/security-adjacent code; unreviewed auto-formatted pushes are not acceptable here even though `github-actions`' pattern allows it elsewhere).
- concurrency: ref-based (never cancel `main`, always cancel superseded PR runs).
- `permissions: contents: read` at top level, widened per-job only where needed (release job needs `contents: write` for tag/release creation, formula-PR job needs the app-auth token).
- third-party actions SHA-pinned with `# vN` trailer comments.
- `release.yaml` additionally: `bun build --compile` matrix over target triples → attach binaries to GH release → render + open `homebrew-devsetup` PR, per [[release-packaging]].
- a docs-publish job (GitHub Pages) is a separate workflow, see [[docs-site]] — kept independent so docs can ship without a full binary release.
