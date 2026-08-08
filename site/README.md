# site

[Starlight](https://starlight.astro.build/) docs site for `claude-daemon-setup`, published to GitHub Pages at `https://nsheaps.github.io/claude-daemon-setup/`.

This is a standalone package (`@nsheaps/claude-daemon-docs`), not yet wired into the root `mise.toml`/yarn workspace — see `docs/specs/draft/docs-site.md`. TODO: decide whether to fold this into a yarn workspaces setup at the repo root (would let `mise run check` at the top level cover the site too) or keep it deliberately separate so docs builds/deploys never depend on the daemon's toolchain.

```sh
yarn install
yarn dev       # local preview at http://localhost:4321/claude-daemon-setup/
yarn build     # production build -> dist/
yarn check     # astro check (type-checks .astro/.mdx content)
```

Content:

- `src/content/docs/**` — hand-written site pages.
- `src/content/docs/cli-reference.mdx` — **stub**, must eventually be generated from `--help` output (see the TODO in that file).
- `docs/specs/live/**` (repo root, not under `site/`) — promoted specs feed the same Starlight sidebar once that promotion path exists. Not wired up yet.

CI: `.github/workflows/docs.yaml` at the repo root builds and deploys this site via `actions/deploy-pages`.
