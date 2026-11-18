# Remote branch and open PR review

Snapshot: **2026-10-03T10:39:55.544001+00:00** (UTC). Repository: [FriskyDevelopments/NEBU-](https://github.com/FriskyDevelopments/NEBU-).

Default branch: **`main`**, tip `cbf1c7769618`. Inventory: **90 remote branches, 2 open PRs, 87 stale branches, 47 non-default branches fully contained in the default branch, and 7 branch tips with failing checks**.

## Scope and definitions

This is a read-only inventory of existing branches and PRs. All actions below are **RECOMMENDATION only**; none were executed. Only this report and its new documentation PR are created. No existing branch or PR is changed, deleted, closed, rebased, or merged. `docs/AUDIT-CHECKLIST.md` is outside this change.

- Coverage: every branch returned by the paginated GitHub branches API for `origin`, plus every open PR at capture time. This report's branch/PR is created after the snapshot and is intentionally excluded. No fork heads were present among the open PRs.
- Last commit means the tip commit's **committer timestamp**, normalized to UTC. Commit author is not necessarily PR author or branch owner. Dates do not measure comments, reviews, or other activity.
- Ahead/behind are exact commit counts from `git rev-list --left-right --count <default-tip>...<branch-tip>` using fetched, non-shallow history, relative to the default branch.
- **Merged: yes** means the current tip is an ancestor of the default tip (ahead = 0), including identical tips; it does not assert a PR was merged. **Merged: no** means unique commits remain; equivalent squash/cherry-pick content is **unverified**.
- **PR history** identifies a merged PR into `main` with the same head branch name. `tip` means its recorded head SHA matches the current tip; `older` means it differs. A merged PR is not proof that later commits were incorporated.
- **Stale: yes** means the tip committer timestamp is more than 30 days before the snapshot. Staleness does not establish abandonment; ownership and continued intent are **unverified**.
- **Stuck: yes** means a latest check run or commit status at the current tip has `failure`, `error`, `timed_out`, or `startup_failure`. This is a failing-check signal, not proof of a currently blocked open PR. Failures on merged branches remain historical evidence.
- **Stuck: no** means returned latest check records have no failing result. Missing records are **unverified**, not passing. Cancelled/action-required checks are not counted as failures. Passing checks do not prove deployment health or complete test coverage. Latest legacy status per context is used; check runs use `filter=latest`.

Author key: **FD** = Frisky Developments; **Jules** = google-labs-jules[bot]; **CR** = coderabbitai[bot]; **Copilot** = copilot-swe-agent[bot]. Other names are shown directly.

## Remote branches

| Branch | Last commit (UTC) | Commit author | Ahead | Behind | Merged | Stale | Stuck / check evidence | PR history / open PR | Recommendation only |
| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| `add-nebulosa-service-tests-9681302194373320499` | 2026-04-06 22:56:58 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `code-health/camera-monitor-todo-1199547189627005530` | 2026-04-06 22:55:43 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `code-health/zoom-moderation-actions-2917022987616399350` | 2026-04-06 22:58:27 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `code-health-refactor-animation-handler-2926502538828962097` | 2026-04-06 22:54:32 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#58](https://github.com/FriskyDevelopments/NEBU-/pull/58) (tip) | **RECOMMENDATION: delete** |
| `coderabbitai/autofix/f1cf563` | 2026-04-06 02:04:22 | CR | 0 | 79 | yes | yes | no; passing/neutral | — | **RECOMMENDATION: delete** |
| `coderabbitai/autofix/4c6e7e8` | 2026-03-30 02:01:32 | CR | 1 | 94 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `coderabbitai/autofix/78f4636` | 2026-04-04 23:34:27 | CR | 14 | 174 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `coderabbitai/autofix/00826e1` | 2026-04-06 17:00:41 | CR | 14 | 85 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `coderabbitai/docstrings/abc4bea` | 2026-03-30 02:08:28 | CR | 12 | 174 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `coderabbitai/docstrings/aee1256` | 2026-04-06 02:03:33 | CR | 1 | 84 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `coderabbitai/docstrings/4c6e7e8` | 2026-03-30 01:49:42 | CR | 1 | 94 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `coderabbitai/docstrings/680b9cb` | 2026-04-05 22:54:14 | CR | 1 | 84 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `codex/adapt-repo-to-nebu-architecture` | 2026-04-06 23:51:59 | FD | 0 | 35 | yes | yes | no; passing/neutral | [#80](https://github.com/FriskyDevelopments/NEBU-/pull/80) (tip) | **RECOMMENDATION: delete** |
| `codex/audit-repo-for-production-readiness-and-fix-issues` | 2026-04-07 04:19:52 | FD | 0 | 78 | yes | yes | no; passing/neutral | [#81](https://github.com/FriskyDevelopments/NEBU-/pull/81) (tip) | **RECOMMENDATION: delete** |
| `codex/conduct-comprehensive-system-review-and-upgrade` | 2026-03-30 02:05:52 | FD | 2 | 94 | no | yes | unverified (no records) | [#29](https://github.com/FriskyDevelopments/NEBU-/pull/29) (older) | **RECOMMENDATION: rebase** |
| `codex/conduct-ui-consistency-audit` | 2026-04-12 13:19:38 | FD | 1 | 28 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `codex/create-follow-up-patch-for-nebulosa-zoom` | 2026-03-29 16:15:50 | FD | 0 | 101 | yes | yes | no; passing/neutral | [#26](https://github.com/FriskyDevelopments/NEBU-/pull/26) (tip) | **RECOMMENDATION: delete** |
| `codex/debug-nebulosa-control-zoom-integration` | 2026-03-29 13:43:49 | FD | 0 | 103 | yes | yes | no; passing/neutral | [#25](https://github.com/FriskyDevelopments/NEBU-/pull/25) (tip) | **RECOMMENDATION: delete** |
| `codex/design-nbu-system-glyph-with-variants` | 2026-04-06 23:40:14 | FD | 0 | 51 | yes | yes | no; passing/neutral | [#79](https://github.com/FriskyDevelopments/NEBU-/pull/79) (tip) | **RECOMMENDATION: delete** |
| `codex/fix-duplicate-injection-in-zoom-integration` | 2026-03-30 08:13:02 | FD | 0 | 92 | yes | yes | no; passing/neutral | [#35](https://github.com/FriskyDevelopments/NEBU-/pull/35) (tip) | **RECOMMENDATION: delete** |
| `codex/fix-nebulosa-control-for-zoom-web-client` | 2026-03-29 18:44:38 | FD | 0 | 97 | yes | yes | no; passing/neutral | [#28](https://github.com/FriskyDevelopments/NEBU-/pull/28) (tip) | **RECOMMENDATION: delete** |
| `codex/implement-inline-installable-keyboard-with-commission` | 2026-04-07 04:22:48 | FD | 0 | 59 | yes | yes | no; passing/neutral | [#82](https://github.com/FriskyDevelopments/NEBU-/pull/82) (tip) | **RECOMMENDATION: delete** |
| `codex/implement-neb-u-glyph-system` | 2026-04-06 23:25:33 | FD | 0 | 51 | yes | yes | no; passing/neutral | [#78](https://github.com/FriskyDevelopments/NEBU-/pull/78) (tip) | **RECOMMENDATION: delete** |
| `codex/implement-production-grade-architecture-for-nebulosa` | 2026-03-30 04:59:15 | CR | 1 | 92 | no | yes | unverified (no records) | [#33](https://github.com/FriskyDevelopments/NEBU-/pull/33) (older) | **RECOMMENDATION: rebase** |
| `codex/kilo-security-remediation` | 2026-08-09 19:07:23 | FD | 1 | 17 | no | yes | yes: [Vercel: failure](https://vercel.com/knowledge/why-is-my-account-deployment-blocked) | [#89](https://github.com/FriskyDevelopments/NEBU-/pull/89) (tip) | **RECOMMENDATION: rebase** |
| `codex/redesign-app-for-nebu-aesthetic` | 2026-04-12 13:19:46 | FD | 0 | 27 | yes | yes | no; passing/neutral | [#85](https://github.com/FriskyDevelopments/NEBU-/pull/85) (tip) | **RECOMMENDATION: delete** |
| `codex/review-and-fix-branch-against-base-branch` | 2026-03-30 04:59:22 | FD | 0 | 119 | yes | yes | no; passing/neutral | [#34](https://github.com/FriskyDevelopments/NEBU-/pull/34) (tip) | **RECOMMENDATION: delete** |
| `codex/update-nebulosa-repository-and-extension` | 2026-03-29 16:17:15 | FD | 0 | 101 | yes | yes | no; passing/neutral | [#27](https://github.com/FriskyDevelopments/NEBU-/pull/27) (tip) | **RECOMMENDATION: delete** |
| `copilot/add-sticker-spell-engine` | 2026-03-26 02:16:57 | FD | 6 | 171 | no | yes | unverified (no records) | — | **RECOMMENDATION: rebase** |
| `copilot/add-token-wallet-system` | 2026-03-13 00:09:14 | Copilot | 2 | 171 | no | yes | yes: [deploy: failure](https://github.com/FriskyDevelopments/NEBU-/actions/runs/23029916918/job/68105256794) | — | **RECOMMENDATION: rebase** |
| `copilot/analyze-separate-nebulosa-content` | 2026-03-21 01:16:19 | Copilot | 0 | 135 | yes | yes | no; passing/neutral | [#20](https://github.com/FriskyDevelopments/NEBU-/pull/20) (tip) | **RECOMMENDATION: delete** |
| `copilot/build-core-platform-repository` | 2026-03-16 09:01:47 | Copilot | 0 | 165 | yes | yes | yes: [deploy: failure](https://github.com/FriskyDevelopments/NEBU-/actions/runs/23135742834/job/67529136224) | [#17](https://github.com/FriskyDevelopments/NEBU-/pull/17) (tip) | **RECOMMENDATION: delete** |
| `copilot/build-magic-cut-system` | 2026-03-21 12:16:11 | FD | 9 | 171 | no | yes | unverified (no records) | — | **RECOMMENDATION: rebase** |
| `copilot/build-subscription-system` | 2026-03-19 10:28:03 | Copilot | 4 | 154 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `copilot/create-labstickerbot-repo` | 2026-03-27 08:19:20 | FD | 9 | 171 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `copilot/create-sticker-draft-disposal-system` | 2026-03-13 00:38:59 | Copilot | 0 | 169 | yes | yes | yes: [deploy: failure](https://github.com/FriskyDevelopments/NEBU-/actions/runs/23030740645/job/67862972691) | [#13](https://github.com/FriskyDevelopments/NEBU-/pull/13) (tip) | **RECOMMENDATION: delete** |
| `copilot/find-ascii-art-animation-demo` | 2026-03-21 11:50:38 | Copilot | 0 | 134 | yes | yes | no; passing/neutral | [#21](https://github.com/FriskyDevelopments/NEBU-/pull/21) (tip) | **RECOMMENDATION: delete** |
| `copilot/find-my-projects` | 2026-03-21 11:54:56 | Copilot | 0 | 133 | yes | yes | no; passing/neutral | [#22](https://github.com/FriskyDevelopments/NEBU-/pull/22) (tip) | **RECOMMENDATION: delete** |
| `copilot/fix-2c66732d-3266-48af-9406-431eb42260e7` | 2025-07-22 16:11:06 | Copilot | 1 | 243 | no | yes | unverified (no records) | [#1](https://github.com/FriskyDevelopments/NEBU-/pull/1) (older) | **RECOMMENDATION: rebase** |
| `copilot/fix-807505ae-643d-49d6-93eb-4e3b2115cec1` | 2025-07-26 01:38:40 | Copilot | 1 | 172 | no | yes | unverified (no records) | [#4](https://github.com/FriskyDevelopments/NEBU-/pull/4) (older) | **RECOMMENDATION: rebase** |
| `copilot/fix-f1c9c451-488b-4188-a85e-08929517f29a` | 2026-04-04 23:35:39 | CR | 14 | 174 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `copilot/implement-emoji-packs-and-fonts` | 2026-03-13 00:24:06 | Copilot | 0 | 169 | yes | yes | yes: [deploy: failure](https://github.com/FriskyDevelopments/NEBU-/actions/runs/23030335225/job/67862947432) | [#12](https://github.com/FriskyDevelopments/NEBU-/pull/12) (tip) | **RECOMMENDATION: delete** |
| `copilot/implement-telegram-bot-backend` | 2026-03-13 00:24:46 | Copilot | 0 | 168 | yes | yes | no; passing/neutral | [#8](https://github.com/FriskyDevelopments/NEBU-/pull/8) (tip) | **RECOMMENDATION: delete** |
| `copilot/refactor-codebase-for-stix-magic` | 2026-03-13 22:03:08 | Copilot | 0 | 168 | yes | yes | yes: [deploy: failure](https://github.com/FriskyDevelopments/NEBU-/actions/runs/23072289873/job/67204381459) | [#15](https://github.com/FriskyDevelopments/NEBU-/pull/15) (tip) | **RECOMMENDATION: delete** |
| `copilot/refactor-state-driven-portal` | 2026-03-23 15:02:06 | Copilot | 0 | 123 | yes | yes | no; passing/neutral | [#23](https://github.com/FriskyDevelopments/NEBU-/pull/23) (tip) | **RECOMMENDATION: delete** |
| `copilot/refactor-tampermonkey-script` | 2026-03-26 02:30:38 | Copilot | 0 | 105 | yes | yes | no; passing/neutral | [#16](https://github.com/FriskyDevelopments/NEBU-/pull/16) (tip) | **RECOMMENDATION: delete** |
| `copilot/remove-submodules-and-block-future` | 2026-03-18 08:43:11 | Copilot | 0 | 161 | yes | yes | no; passing/neutral | [#19](https://github.com/FriskyDevelopments/NEBU-/pull/19) (tip) | **RECOMMENDATION: delete** |
| `copilot/save-ui-demo-design-repo` | 2026-04-04 22:52:39 | Copilot | 0 | 86 | yes | yes | no; copilot: cancelled | [#36](https://github.com/FriskyDevelopments/NEBU-/pull/36) (tip) | **RECOMMENDATION: delete** |
| `copilot/spec-1-create-github-architecture-agent` | 2026-03-13 01:11:56 | Copilot | 0 | 169 | yes | yes | yes: [deploy: failure](https://github.com/FriskyDevelopments/NEBU-/actions/runs/23031610777/job/66893815269) | [#14](https://github.com/FriskyDevelopments/NEBU-/pull/14) (tip) | **RECOMMENDATION: delete** |
| `copilot/update-animation-playground-name` | 2026-03-19 09:11:22 | Copilot | 0 | 156 | yes | yes | no; passing/neutral | [#18](https://github.com/FriskyDevelopments/NEBU-/pull/18) (tip) | **RECOMMENDATION: delete** |
| `copilot/update-ease-of-use` | 2026-03-26 18:58:44 | Copilot | 8 | 171 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `cursor/nebulosa-dashboard-motion-c5cd` | 2026-04-12 13:23:34 | Cursor Agent | 1 | 28 | no | yes | no; passing/neutral | [#86](https://github.com/FriskyDevelopments/NEBU-/pull/86) (tip) | **RECOMMENDATION: rebase** |
| `develop` | 2025-07-24 15:11:34 | PupFr | 0 | 182 | yes | yes | unverified (no records) | — | **RECOMMENDATION: keep** |
| `feat/analytics-instrumentation-7163525830249999033` | 2026-04-06 22:41:33 | Jules | 16 | 85 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `feat/nebulosa-fixes` | 2026-06-08 07:45:32 | FD | 8 | 19 | no | yes | unverified (no records) | — | **RECOMMENDATION: rebase** |
| `feat/nebulosa-waiting-room-events-3664804010470533445` | 2026-04-06 23:53:48 | Jules | 2 | 64 | no | yes | unverified (no records) | — | **RECOMMENDATION: rebase** |
| `feat/sticker-background-removal-13973480857308655273` | 2026-04-06 22:55:34 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `feature/implement-chat-send-action-zoom-adapter-11887318934933159135` | 2026-04-06 23:59:56 | Jules | 2 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `feature/nebulosa-telegram-integration-10418576341297569185` | 2026-04-07 04:33:52 | Jules | 0 | 33 | yes | yes | no; passing/neutral | [#83](https://github.com/FriskyDevelopments/NEBU-/pull/83) (tip) | **RECOMMENDATION: delete** |
| `fix/railway-deploy-secrets-4018398694928545887` | 2026-04-06 22:51:23 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#51](https://github.com/FriskyDevelopments/NEBU-/pull/51) (tip) | **RECOMMENDATION: delete** |
| `fix/waiting-room-mutation-observer-7202393710954792337` | 2026-04-06 22:53:18 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#55](https://github.com/FriskyDevelopments/NEBU-/pull/55) (tip) | **RECOMMENDATION: delete** |
| `fix/zoom-extension-stability-8095643704922139239` | 2026-04-05 16:32:49 | Jules | 0 | 84 | yes | yes | no; passing/neutral | [#39](https://github.com/FriskyDevelopments/NEBU-/pull/39) (tip) | **RECOMMENDATION: delete** |
| `fix/zoom-waiting-room-admit-all-6905145901393618800` | 2026-04-06 23:01:25 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `fix-mem-storage-tests-4268323277212306346` | 2026-04-07 00:11:20 | Jules | 2 | 64 | no | yes | unverified (no records) | — | **RECOMMENDATION: rebase** |
| `fix-moderation-dom-action-382643827767599375` | 2026-04-06 23:02:10 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#73](https://github.com/FriskyDevelopments/NEBU-/pull/73) (tip) | **RECOMMENDATION: delete** |
| `fix-production-readiness-and-auth-8772572118766335353` | 2026-04-06 15:39:01 | Jules | 0 | 75 | yes | yes | no; passing/neutral | [#44](https://github.com/FriskyDevelopments/NEBU-/pull/44) (tip) | **RECOMMENDATION: delete** |
| `fix-zoom-oauth-callback-13264084999397191064` | 2026-04-06 22:46:21 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#49](https://github.com/FriskyDevelopments/NEBU-/pull/49) (tip) | **RECOMMENDATION: delete** |
| `hoplite/aspendos-86a92806` | 2026-10-03 09:51:06 | usehoplite[bot] | 3 | 0 | no | no | no; passing/neutral | open [#93](https://github.com/FriskyDevelopments/NEBU-/pull/93) | **RECOMMENDATION: keep** |
| `hoplite/eresos-dc17bf33` | 2026-10-03 10:36:24 | usehoplite[bot] | 1 | 0 | no | no | no; passing/neutral | open [#94](https://github.com/FriskyDevelopments/NEBU-/pull/94) | **RECOMMENDATION: keep** |
| `implement-chat-send-action-zoom-adapter-16976358815027700947` | 2026-04-07 10:36:01 | FD | 3 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `internal-ui-playground-3020517004369740405` | 2026-04-06 15:29:31 | FD | 3 | 83 | no | yes | unverified (no records) | [#40](https://github.com/FriskyDevelopments/NEBU-/pull/40) (older) | **RECOMMENDATION: rebase** |
| `jules/fix-ci-workflows-11550343869648181646` | 2026-04-05 16:25:57 | Jules | 0 | 84 | yes | yes | no; passing/neutral | [#38](https://github.com/FriskyDevelopments/NEBU-/pull/38) (tip) | **RECOMMENDATION: delete** |
| `jules-10610682808415173593-9004ed14` | 2026-04-06 23:05:30 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#74](https://github.com/FriskyDevelopments/NEBU-/pull/74) (tip) | **RECOMMENDATION: delete** |
| `jules-11970697174626968559-7e520e69` | 2026-04-06 23:12:15 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#76](https://github.com/FriskyDevelopments/NEBU-/pull/76) (tip) | **RECOMMENDATION: delete** |
| `jules-14181230271310246816-03baa85b` | 2026-04-06 22:56:25 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `jules-2389022140870300649-2c744d40` | 2026-04-06 23:25:18 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#77](https://github.com/FriskyDevelopments/NEBU-/pull/77) (tip) | **RECOMMENDATION: delete** |
| `jules-7658110184754341528-36e3bc8a` | 2026-04-06 22:52:20 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#54](https://github.com/FriskyDevelopments/NEBU-/pull/54) (tip) | **RECOMMENDATION: delete** |
| `jules-add-nebulosa-state-tests-10323104685898573801` | 2026-04-06 23:47:13 | Jules | 2 | 64 | no | yes | unverified (no records) | — | **RECOMMENDATION: rebase** |
| `jules-code-health-admit-all-15658648577777645279` | 2026-04-06 22:53:40 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#57](https://github.com/FriskyDevelopments/NEBU-/pull/57) (tip) | **RECOMMENDATION: delete** |
| `jules-security-fix-shortio-key-16970756190361585759` | 2026-04-06 22:51:47 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#52](https://github.com/FriskyDevelopments/NEBU-/pull/52) (tip) | **RECOMMENDATION: delete** |
| `main` | 2026-09-26 10:43:48 | FD | 0 | 0 | yes | no | no; passing/neutral | — | **RECOMMENDATION: keep** |
| `mock-service-layer-16950066734479895543` | 2026-04-07 13:25:03 | FD | 3 | 83 | no | yes | unverified (no records) | [#41](https://github.com/FriskyDevelopments/NEBU-/pull/41) (older) | **RECOMMENDATION: rebase** |
| `refactor/draft-handler-callbacks-9194659304635715412` | 2026-04-06 22:51:09 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `refactor/draft-handler-switch-15020938577900746035` | 2026-04-06 22:57:10 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#65](https://github.com/FriskyDevelopments/NEBU-/pull/65) (tip) | **RECOMMENDATION: delete** |
| `refactor/generate-pdf-function-76472400709713137` | 2026-04-06 23:00:30 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `refactor-bot-routing-10577665328012174659` | 2026-04-06 22:53:37 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |
| `refactor-generate-pdf-2-2666938399413474361` | 2026-04-06 23:07:51 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#75](https://github.com/FriskyDevelopments/NEBU-/pull/75) (tip) | **RECOMMENDATION: delete** |
| `security-fix/hardcoded-tokens-17370850713470195240` | 2026-04-07 05:05:09 | CR | 0 | 60 | yes | yes | no; passing/neutral | [#67](https://github.com/FriskyDevelopments/NEBU-/pull/67) (tip) | **RECOMMENDATION: delete** |
| `security-fix-hardcoded-zoom-secrets-11404146417004903807` | 2026-04-06 22:46:08 | Jules | 0 | 63 | yes | yes | no; passing/neutral | [#48](https://github.com/FriskyDevelopments/NEBU-/pull/48) (tip) | **RECOMMENDATION: delete** |
| `zoom-admit-all-implementation-6285833873218553713` | 2026-04-06 22:51:49 | Jules | 1 | 64 | no | yes | no; passing/neutral | — | **RECOMMENDATION: rebase** |

## Open pull requests

Both open PRs target `main` from this repository. Head-tip commit metadata is repeated separately from the PR author.

| PR | Head → base | PR author | Last head commit (UTC) | Commit author | Ahead / behind vs default | Merged / stale / stuck | Checks and mergeability | Recommendation only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [#94: docs: add read-only 12-point repository audit](https://github.com/FriskyDevelopments/NEBU-/pull/94) | `hoplite/eresos-dc17bf33` → `main` | app/usehoplite | 2026-10-03 10:36:24 | usehoplite[bot] | 1 / 0 | no / no / no | 7 passing checks; MERGEABLE; CLEAN | **RECOMMENDATION: keep** |
| [#93: Fix dashboard readability and keyboard/request-flow papercuts](https://github.com/FriskyDevelopments/NEBU-/pull/93) | `hoplite/aspendos-86a92806` → `main` | app/usehoplite | 2026-10-03 09:51:06 | usehoplite[bot] | 3 / 0 | no / no / no | 7 passing checks; MERGEABLE; CLEAN | **RECOMMENDATION: keep** |

Each open PR reports passing Blank workflow/build, Docker image/build, Node.js/build (18.x, 20.x, 22.x), Python CI/Run Python tests, and CodeRabbit. These are snapshot results, not merge authorization.

## Recommendation policy and limitations

- **Keep** the default branch, the existing integration branch, and the two active, passing PR branches. `develop` is retained conservatively despite staleness; whether it is still used is **unverified**.
- **Delete** is suggested only for non-default, non-integration branches fully contained in `main` with no open PR. Confirm release, automation, and external references before any separately authorized deletion; those dependencies are **unverified**.
- **Rebase** is suggested for stale branches with unique commits and no open PR, only if the owner wants to resume them. First reconcile merged-PR history and failing checks; do not blindly replay squash-merged work. Patch-equivalence and safe replay are **unverified**.
- **Close** is not recommended for either open PR: both are recent, current, and passing. Stale tips alone are insufficient evidence to close someone's work.
- Seven tips have failing checks linked above: six historical GitHub Actions `deploy` failures and one Vercel status linking to an account-blocking explanation. Root causes and current service health are **unverified**. No deployment was triggered, retried, inspected in another service, or repaired.

## Evidence and reproducibility

Read-only GitHub queries and local history comparisons used:

```sh
git fetch origin
git rev-parse --is-shallow-repository
gh repo view --json nameWithOwner,defaultBranchRef,url
gh api --paginate 'repos/FriskyDevelopments/NEBU-/branches?per_page=100'
gh pr list --state open --limit 1000 --json number,title,url,author,headRefName,headRefOid,baseRefName,isCrossRepository,mergeable,mergeStateStatus,statusCheckRollup
gh pr list --state merged --limit 1000 --json number,url,headRefName,headRefOid,baseRefName,mergedAt
git show -s --format="%aI %an %cI" <branch-tip>
git rev-list --left-right --count <default-tip>...<branch-tip>
gh api --paginate 'repos/FriskyDevelopments/NEBU-/commits/<branch-tip>/check-runs?filter=latest&per_page=100'
gh api --paginate 'repos/FriskyDevelopments/NEBU-/commits/<branch-tip>/status'
```

The merged-PR query returned 64 records (below its 1,000-record limit); the open-PR query returned 2. Remote branch API pagination returned 90 branches. Counts and author/date metadata were checked against fetched commit objects. State can change after this snapshot; recheck before acting on any recommendation.
