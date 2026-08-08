# org registration

- both new repos (`claude-daemon-setup`, `daemon-agent-template`) must be added to `nsheaps/.github`'s tracked-repo lists or they get no shared labels/file-sync (patterns-index gap #13):
  - `.github/.github/workflows/sync-labels.yaml` → `matrix.repo` list.
  - `ansible/config/sync-files.yml` (if it has a repo enumeration — verify shape before editing).
- done via a PR into `nsheaps/.github`, not a direct-to-main commit — that repo governs the whole org, so it gets normal review even though `claude-daemon-setup` itself is direct-to-main for this build-out.
