# Vendored `@sandbox-broker` client

These are the **verbatim** `pnpm pack` artifacts of
[`felixuhmann/sandbox-broker`](https://github.com/felixuhmann/sandbox-broker)
`v0.1.0-rc.1` — the same bytes the GitHub Release will carry. Checksums are in
[`SHA256SUMS`](SHA256SUMS):

```bash
cd vendor/sandbox-broker && sha256sum -c SHA256SUMS
```

## Why they are vendored

The broker release is not published yet, so the public tarball URL that the
packed manifest already references still 404s. Vendoring keeps the pin
**relative and reproducible** (no absolute developer path, no private registry
auth, installable offline) while the release is being cut.

## Swapping to the public release

This is a two-line change; nothing in `apps/api/src` refers to a file path.

1. `apps/api/package.json`:

   ```jsonc
   "@sandbox-broker/client": "https://github.com/felixuhmann/sandbox-broker/releases/download/v0.1.0-rc.1/sandbox-broker-client-0.1.0-rc.1.tgz"
   ```

2. Root `package.json` — delete the `pnpm.overrides` entry entirely:

   ```jsonc
   "overrides": {
     "@sandbox-broker/contracts": "file:vendor/sandbox-broker/sandbox-broker-contracts-0.1.0-rc.1.tgz"
   }
   ```

   The override exists only because a `file:` tarball still resolves its own
   dependencies from the registry/URL in its packed manifest, and the packed
   client points `@sandbox-broker/contracts` at the not-yet-published release
   asset. Once that asset exists the packed manifest resolves on its own and the
   override becomes dead weight.

3. `pnpm install` (regenerates `pnpm-lock.yaml`), then delete this directory.

Verify the downloaded tarball against `SHA256SUMS` before committing the new
lockfile — the hashes here are what was reviewed.
