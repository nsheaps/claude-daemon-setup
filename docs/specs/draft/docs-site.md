# docs site

- greenfield — no Pages/mkdocs/docusaurus precedent anywhere in `nsheaps/*` (patterns-index gap #12).
- framework choice: [Starlight](https://starlight.astro.build/) (Astro-based docs theme) — picked over mkdocs/docusaurus because it's zero-Python-dependency (this repo is otherwise pure bun/node), has first-class GitHub Pages + Actions deploy docs, and native sidebar-from-filesystem which pairs well with the [[overview|doc-graph]] approach already used for specs/research.
- sections: design (links into `docs/specs/live/*` once specs mature past draft), getting started, install, compatibility, CLI reference (generated from `--help` output, not hand-maintained — avoid drift), user guides, contributing.
- publish workflow: separate `.github/workflows/docs.yaml`, triggers on push to `main` touching `docs/**` or the site source, deploys via `actions/deploy-pages`.
- content source: `docs/specs/live/` and `docs/site/` (site-only pages like getting-started) both feed the same Starlight instance — research/draft/in-progress specs are NOT published (internal only) until promoted to `live/`.
