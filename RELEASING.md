# Releasing SER

`master` is SER's integration and staging branch. Pull requests merge there and
`SER pipeline / Staging verified` protects it, but no activity on `master`
publishes, tags, or constructs release artifacts.

`candidate` is a protected, long-lived pointer to the exact `master` commit
selected for production. It is not a development branch: it has no independent
commits, cannot be force-pushed or deleted, and advances only linearly to commits
already reachable from `master`.

## Prepare the candidate

1. Choose the semantic version and update all four package manifests in one pull
   request:

    - `modules/svelte-effect-runtime/package.json`
    - `modules/svelte-effect-runtime-grammars/package.json`
    - `modules/svelte-effect-runtime-language-server/package.json`
    - `modules/svelte-effect-runtime-vsix/package.json`

2. Merge the pull request to `master` and wait for
   `SER pipeline / Staging verified` on the selected full commit SHA.
3. Verify the selected commit is reachable from the current remote `master`, then
   fast-forward `candidate` to that exact SHA:

    ```bash
    git fetch origin master candidate --tags
    git merge-base --is-ancestor <full-sha> origin/master
    git push origin <full-sha>:refs/heads/candidate
    ```

Advancing `candidate` does not run a release. It freezes the selection so it can
be reviewed independently from the decision to publish.

## Verify and publish

Open the `SER pipeline` workflow in GitHub Actions, choose **Run workflow**, and
select the `candidate` branch.

1. Run `dry-run`. It repeats staging verification, builds and packs each package
   once, records hashes, installs the exact tarballs in a clean consumer, runs the
   exact packed runtime in Chromium, and exercises promotion with zero provider
   inspection or external writes. It does not enter the release environment or
   receive publishing credentials.
2. Review `Candidate verified`, the candidate manifest, smoke evidence, and the
   timing summary.
3. Run `release` for the same `candidate` commit. Verification and artifact
   construction finish before the protected `release-approval` environment
   requests approval. After approval, separate least-privilege jobs publish the
   verified bytes to npm with short-lived OIDC, OpenVSX with only the
   secret-bearing `release` environment, and GitHub Releases with only repository
   contents authority.

The pipeline creates the tag only after the candidate passes verification. A
draft GitHub release remains visible during partial publication and becomes final
only when all three supported channels match the manifest.

## Resume a partial release

Do not rerun `release` after a tag, package version, draft release, or release
asset exists. Leave `candidate` on the same commit and dispatch `resume` with the
failed publishing run's exact values:

```bash
gh workflow run ci.yml \
  --ref candidate \
  -f mode=resume \
  -f resume_version=<version> \
  -f resume_commit=<full-sha> \
  -f resume_run_id=<failed-run-id>
```

Resume downloads the immutable candidate bundle from that run, proves its plan,
commit, version, artifact names, and checksums against the current candidate, and
reruns smoke tests without rebuilding. Existing npm packages, OpenVSX versions,
tags, releases, and assets are skipped only when their identity matches exactly;
any mismatch is terminal.

If rollback is necessary, prepare a new forward version on `master` and promote a
new candidate. Never rewrite `candidate`, move an existing tag, or replace an
immutable registry version.
