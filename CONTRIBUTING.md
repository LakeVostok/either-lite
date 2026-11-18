# Contributing

## Development

```bash
npm ci          # install dev dependencies
npm run check   # lint + tests + typecheck
npm run build   # compile to dist/
```

## Publishing (maintainers)

- **Publish** — the *Publish to npm* GitHub Actions workflow (manually triggered): select the branch, pick a bump type (`patch` / `minor` / `major` / `beta`), and it checks, builds, publishes to npm, and commits the version bump plus a `vX.Y.Z` tag back to the branch. Betas are published under the `beta` dist-tag, so `npm install either-lite` always resolves to the latest stable.
- **Retire a beta** — run the *Deprecate npm prerelease* workflow with the version (e.g. `0.1.2-beta.0`). The version stays on the registry but installs show a deprecation warning; this is reversible via `npm deprecate either-lite@<version> ""`.
- **Remove a beta entirely** — only possible within 72 hours of its publish, manually:

  ```bash
  npm unpublish either-lite@<version>
  ```

  Unpublish is irreversible and the version number can never be published again — use it only for "published a broken beta minutes ago", not for routine cleanup. It also does not touch git; the release commit and `vX.Y.Z` tag on the branch remain.
