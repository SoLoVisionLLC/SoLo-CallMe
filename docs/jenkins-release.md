# Jenkins release and container publication

`Jenkinsfile.release` replaces the disabled `release.yml` with a dedicated trusted SCM job. It does not replace `Jenkinsfile.ci`. Source was inspected at `9e11fb0dc6738eee97e592be7c5166a607dc71fc`. No Actions runs are required or enabled.

The default is `PUBLISH=false`. Validation resolves an existing exact tag/commit, runs deterministic tests and the release-readiness gate, then builds an OCI archive without a registry push. It does not create/edit a GitHub release. The archive is disposable workspace output and is deleted by cleanup; no new public release artifact or persistent retention promise is introduced.

The root checkout is the reviewed pipeline tooling. A second checkout in `source/` is the exact tagged Docker build context. Both the Git SCM result and the dereferenced tag must equal `SOURCE_COMMIT`. Do not configure the job to load its pipeline or publishing helpers from unreviewed tags or pull requests. Publishing helpers run from the trusted root, while the tag's package scripts are never executed on the host. GitHub credentials are scoped to API helpers and removed from Docker subprocess environments. Registry authentication is a temporary private Docker config outside the source build context, deleted even after failure.

Before creating Buildx, the trusted publisher persists an ownership receipt for the builder derived from this Jenkins `BUILD_TAG`. Its normal cleanup and Jenkins `post { always }` use the same helper, so a killed publisher can be cleaned up by a separate process. Cleanup refuses a foreign build receipt and removes only the exact named builder; it never prunes Docker or enumerates other builders for deletion. A daemon failure is reported with the exact builder name. Jenkins still deletes the private workspace registry config in `finally`; if the agent or daemon remains unavailable, the reported task-specific builder needs operational cleanup after recovery.

## Event and publication contract

An authenticated event adapter must route tag pushes matching `v*` as `SOURCE_EVENT=push`; route only release `action=published` as `SOURCE_EVENT=release_published`. Map the existing tag to `RELEASE_TAG` and its exact dereferenced commit to `SOURCE_COMMIT`. No branch push, draft release edit, PR event or GitHub Actions event should trigger this job. Manual validation is available with `SOURCE_EVENT=validation`. Configure the job and event adapter only after review; none was configured by this source change.

Production execution requires separate authorization and `PUBLISH=true`. A push creates or updates the GitHub release, preserving the original title, install body, generated-release-notes flag, and existing draft/prerelease state when updating. Published-release events skip that mutation and proceed to the container build. A failed GitHub release operation stops container publication, matching `needs: release`. The workflow had no cancellation/concurrency group, so this definition does not cancel older builds. An event adapter must suppress self-generated duplicate release events if using a credential whose release writes trigger webhooks; Actions' GITHUB_TOKEN formerly suppressed that second workflow invocation.

The image remains `ghcr.io/solovisionllc/solo-callme`. Stable semver `v1.2.3` produces `1.2.3`, `1.2`, and `latest`. Prerelease `v1.2.3-rc.1` produces that prerelease and `latest`, without a `1.2` tag. The explicit raw latest from the source workflow still applies to prereleases and non-semver `v*` tags. Version build metadata is omitted from Docker tags. The same eight OCI labels are generated from live GitHub repository metadata and the exact source commit when publishing.

Implementation references: [metadata-action v5](https://github.com/docker/metadata-action/blob/v5/src/meta.ts), [action-gh-release v1](https://github.com/softprops/action-gh-release/blob/v1/src/github.ts). They were inspected through the GitHub connector; no Actions were executed.

## Activation requirements

- Verify `linux-native` has Node 22, npm, Git, Docker Engine and Buildx with the docker-container driver. Agent availability does not prove tool availability. The Dockerfile's existing `oven/bun:1` base remains unchanged.
- Verify read-only SCM credentials for the two full-history checkouts. Pin the tooling job to a reviewed trusted ref and restrict production Build/configure permission to approved operators/adapter.
- Set operator-owned job environment `CALLME_GITHUB_CREDENTIAL_ID` to an approved existing Jenkins Secret text credential with repository metadata access and release-write permission. This ID mapping is unverified.
- Set operator-owned `CALLME_GHCR_CREDENTIAL_ID` to an approved existing Jenkins username/password credential authorized to push the intended GHCR package. This ID mapping is unverified. Creating or changing credentials/access needs separate approval.
- Docker BuildKit's `type=gha` cache cannot operate without Actions runtime cache credentials. This replacement uses disposable local BuildKit cache export, with no remote cache publication or durable cross-build reuse. That is an explicit cache-backend difference, not a skipped build/test gate.
- Run Jenkins Declarative/CPS validation, then an exact-tag `PUBLISH=false` build. Confirm tag metadata, release body, cache/disk capacity and Docker cleanup. Local helper tests are not controller execution evidence.
- A later authorized publication must verify the actual GitHub release and GHCR image digest/tags. No publication or production deployment was executed while preparing this candidate.

`npm run release:readiness:jenkins` invokes a dependency-free validator under `scripts/ci`. It checks required Docker source/lockfiles, root/server version alignment, event/SHA validity, disabled-by-default publication and gate ordering. It emits `READY` or `SOURCE_CONFIG`; it performs no network request or publishing action. This is a container-only lane: OS signing and multi-platform native package policies do not apply.

Run `node --test scripts/ci/release-plan.test.mjs scripts/ci/release-cleanup.test.mjs` for local contract checks. Cleanup tests forcibly terminate a helper process and use a mocked Docker command; no Docker resources are created or removed by these tests. Full source Docker validation and Jenkins operational activation remain separate.
