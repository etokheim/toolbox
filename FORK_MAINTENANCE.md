# Fork maintenance

This fork keeps upstream development and Roma distribution changes on separate branch lines.

## Branch and remote roles

- `upstream` is `https://github.com/OysteinAmundsen/toolbox.git`.
- `origin` is `https://github.com/etokheim/toolbox.git`.
- `origin/main` is a clean mirror of `upstream/main`. Do not merge Roma-only commits into it.
- `origin/roma` is the long-lived downstream integration and release branch.
- Reusable feature work starts from clean `main`, is proposed to upstream, and is then integrated
  into `roma` while it is pending. Accepted changes reach `roma` through the next upstream sync;
  declined changes may remain as clearly identified downstream commits when Roma still requires
  them.

## Upstream sync

```bash
git fetch upstream origin --tags
git switch main
git merge --ff-only upstream/main
git push origin main
git switch roma
git merge main
git push origin roma
```

Resolve downstream conflicts only on `roma`. Never rewrite `main`, `roma`, or a published tag.

## Downstream packages

`roma` publishes:

| Source directory  | Published package              | Version source                        |
| ----------------- | ------------------------------ | ------------------------------------- |
| `libs/grid`       | `@etokheim/toolbox-grid`       | upstream grid version plus `-roma.N`  |
| `libs/grid-react` | `@etokheim/toolbox-grid-react` | upstream React version plus `-roma.N` |

Increment `N` for another Roma build of the same upstream version. Reset it to `0` when the
upstream base version changes. The downstream identities and versions live in each
`package.roma.json`; the upstream `package.json` files stay unchanged so the workspace dependency
graph remains an upstream mirror. Published versions and annotated release tags are immutable.

The React package deliberately keeps imports and its peer dependency named `@toolbox-web/grid`.
The dist preparation step pins that peer to the exact paired `@etokheim/toolbox-grid` Roma
prerelease; a stable upstream range such as `^3.0.0` does not admit `3.8.2-roma.0`.
Consumers preserve the upstream import surface with npm aliases:

```json
{
  "dependencies": {
    "@toolbox-web/grid": "npm:@etokheim/toolbox-grid@roma",
    "@toolbox-web/grid-react": "npm:@etokheim/toolbox-grid-react@roma"
  }
}
```

Alias both packages. This leaves one package installed at the peer name
`@toolbox-web/grid`, so the React adapter resolves the same grid copy as the application.

## Release

1. Merge the distribution change to `roma`.
2. Confirm both package versions are new `-roma.N` prereleases.
3. Create one annotated tag at the current `origin/roma` tip:

   ```bash
   git fetch origin roma
   git tag -a roma-release-YYYY.MM.N -m "Roma distribution YYYY.MM.N" origin/roma
   git push origin roma-release-YYYY.MM.N
   ```

`.github/workflows/downstream-release.yml` rejects lightweight tags, tags not pointing at the
current `origin/roma` tip, non-Roma versions, and unexpected package names. It installs once, then
lint/tests/builds both packages from that tagged commit, runs Bun and npm alias consumer smoke
checks, and
publishes grid before React using `npm publish --access public --tag roma --provenance`. A rerun
skips a version already present on npm, allowing recovery if only the first package was published.
Feature branches have no publishing trigger.

The annotated-tag check reads the remote tag and its peeled `^{}` ref. Do not replace it with a
local `git cat-file` check: `actions/checkout` materializes the event tag as a commit ref, which
makes a valid remotely annotated tag appear lightweight.

### One-time npm setup

The package owner must first ensure both public package names exist under the `@etokheim` scope.
If npm does not allow trusted-publisher configuration before the first release, bootstrap each
package once manually from its built `dist/libs/<package>` directory with an owner-authenticated
`npm publish --access public --tag roma --provenance`; do not add that credential to GitHub.

For each package, configure npm **Settings → Trusted Publisher → GitHub Actions** with:

- organisation/user: `etokheim`
- repository: `toolbox`
- workflow filename: `downstream-release.yml`
- environment: leave blank

The workflow uses GitHub-hosted runners and `id-token: write`; no `NPM_TOKEN` is stored. After the
first trusted publish succeeds, set npm publishing access to require 2FA and disallow tokens.

In GitHub, add a tag ruleset targeting `roma-release-*` that restricts tag updates and deletions to
repository administrators. The release workflow also requires an annotated tag at the current
`roma` tip, but the ruleset is what prevents a published tag from being moved or deleted later.
