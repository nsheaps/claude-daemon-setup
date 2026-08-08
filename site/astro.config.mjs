// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// GitHub Pages project-page config: this repo is published at
// https://nsheaps.github.io/claude-daemon-setup/, so `base` must match the
// repo name and every internal link must be base-relative (Starlight/Astro
// handle this automatically for content collection pages and the sidebar).
export default defineConfig({
  site: "https://nsheaps.github.io",
  base: "/claude-daemon-setup",
  integrations: [
    starlight({
      title: "claude-daemon-setup",
      description:
        "Turn a Mac into a temporary Claude Code Remote Control host via a Homebrew service.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/nsheaps/claude-daemon-setup",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/nsheaps/claude-daemon-setup/edit/main/site/",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "index" },
            { label: "Getting started", slug: "getting-started" },
            { label: "Install", slug: "install" },
            { label: "Compatibility", slug: "compatibility" },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "CLI reference", slug: "cli-reference" }],
        },
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Contributing",
          items: [{ label: "Contributing", slug: "contributing" }],
        },
        // TODO(docs-site): once specs are promoted out of docs/specs/draft/
        // into docs/specs/live/, add a "Design" sidebar group here that
        // surfaces those docs (see docs/specs/draft/docs-site.md — draft/
        // in-progress/research specs are intentionally NOT published).
      ],
    }),
  ],
});
