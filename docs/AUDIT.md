# Scoped source and publication audit

Reviewed September 18, 2026, starting from commit `b4b7acb`. Review and fixes were AI-assisted. This is not an independent security certification, legal opinion, or compliance assessment.

## Scope

Reviewed the vault and session boundary, local API routes, document-import limits, provider requests and error handling, source/citation validation, runner cancellation and history preservation, backup/restore, launch scripts, and browser data-handling patterns. Reviewed the single pre-audit Git commit's tracked file list and contents for selected secret formats, private keys, local-machine paths, email-like strings, and sensitive runtime file paths.

No matching real credential, private key, local path, email-like string, or sensitive runtime path was found in that checked history. The deliberately synthetic `sk-synthetic-test-key-not-real` in the test harness is not a credential. The repository contains fictional agreement fixtures; runtime vaults and environment files are excluded by ignore rules. Pattern-based checks are not exhaustive secret detection and cannot establish that every possible disclosure is absent.

## Findings and changes

| Finding | Impact | Change and verification |
| --- | --- | --- |
| Review authorization was checked before awaiting the request body, but not again before writing. | A request authenticated earlier could still save a review after its session was locked and replaced while the body was being read. This did not grant access to a caller who never had a valid session. | Reauthorize immediately after parsing the review body. A controlled streamed-request test verifies HTTP 401, unchanged revision, and no review write after session rotation. |
| Token length was measured in characters before a byte-oriented constant-time comparison. | Certain multibyte malformed tokens caused a length exception rather than the intended unauthorized result. No authentication bypass was identified. | Require the generated token's 64-character lowercase hexadecimal format before comparison. Regression coverage verifies malformed tokens fail with an unauthorized application error. |
| Automated verification was local-only. | Reviewers had no repository-level repeatable check. | Added GitHub Actions for dependency installation, tests, type checks, production compilation, and a dependency audit. No real API key or agreement is needed. |
| README prioritized operating detail over reviewable design. | The legal/technical boundaries were harder to evaluate quickly. | Reorganized the README around evidence, contractual dependencies, human review, architecture, and confidentiality. Preserved operating instructions in [OPERATIONS.md](OPERATIONS.md). Checked API data-policy wording against official OpenAI documentation; no provider settings were changed. |

Both new regression tests were run against the original session behavior and failed as expected: the malformed token raised a byte-length error, and the revoked review returned HTTP 200. After the fixes, both pass.

## Verified behavior

- 23 automated tests pass using synthetic sources, temporary test vaults, and mocked provider responses.
- TypeScript checks and the Next.js production build pass.
- Dependency audit reports zero known vulnerabilities at review time; that is not a guarantee against unknown vulnerabilities.
- Existing tests cover authenticated encryption/tampering, wrong passphrases, revision conflicts, lock cancellation, PDF/DOCX parsing, exact source matching, unknown citations, dependency cycles, selected section-reference errors, run snapshots/history, cancellation, backup traversal/overwrite rejection, provider output limits, disabled response storage, and sanitized provider errors.
- Provider tests verify the configured request format, not actual account/model availability or model-generated legal accuracy.

No real agreement, live API key, paid generation, provider connection, or client vault was used in these checks. The separate HTTP QA harness must only be run against a dedicated synthetic QA vault.

## Residual risks and limits

- Exact quotations and valid source IDs establish text provenance, not whether the text supports a conclusion. Finding classifications and summaries are model-generated; legal interpretation, factual applicability, completeness, and cross-document reconciliation require human review.
- Prompt/data separation and instructions are safeguards, not proof that malicious document text cannot influence a model. The critique uses the same model, not an independent adjudicator.
- Local encryption protects files at rest. It does not protect unlocked memory/browser content, a compromised machine, extensions, screenshots, readable exports, or OS backups/swap. The local HTTP session is appropriate only to the stated loopback-only deployment boundary.
- Provider retention and confidentiality depend on the actual API project's terms and controls. The code's `store: false` setting does not confer Zero Data Retention, privilege protection, or firm authorization.
- No independent penetration test, multi-process consistency audit, crash-durability assessment, parser fuzzing, load/resource benchmark, or firm-wide deployment review was performed. The synchronous file-backed vault and in-process job state are single-user design constraints.
- Launchers and tracked source are not a deployed service. A production rollout needs a separate threat model, operational backup/recovery plan, provider/legal approval, and validated legal-quality evaluation.

The model snapshot and analysis scope were intentionally preserved. There is no evidence here to justify migrating the model or claiming broader legal coverage.

A subsequent [follow-up audit](FOLLOW-UP-AUDIT.md) verifies these fixes with additional session-boundary and save-conflict tests. The results above describe the initial review.
