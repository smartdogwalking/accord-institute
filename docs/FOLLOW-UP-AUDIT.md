# Follow-up session and runtime audit

## Scope and baseline

Reviewed published commit `27c676badd8249e20de10c293a1e11eb5538ceee`, including both runtime fixes, their tests, the GitHub workflow, and the changed model-pinning comment. This follow-up was AI-assisted and is not an independent penetration test or security certification.

The strict generated-token validation rejects malformed input before constant-time comparison. The review handler reauthorizes after awaiting its body and before changing reviews, audit records or persisted revisions. Under the current single-process implementation there is no further asynchronous pause between this check and the save.

Related source paths reviewed: credential saves and deletes, document imports, analysis startup, connection checks, source confirmation, cancellation, reads/exports, file-backed revision enforcement, vault locking, provider cancellation/error sanitization, and browser state clearing. Existing limits and confidential-use qualifications remain applicable.

## Additional verification

Added seven tests using synthetic agreements, fake nonworking keys, temporary vaults and direct request-handler calls:

1. A credential save whose session rotates during body receipt returns 401 and leaves its encrypted credential file byte-for-byte unchanged.
2. A document import whose session rotates during body receipt returns 401 and saves no matter.
3. Locking without reopening rejects a delayed review; reopening confirms the encrypted matter file is unchanged.
4. An ordinary review save succeeds, keeps generated findings unchanged, and rejects a stale revision without changing persisted notes.
5. A slower competing review returns 409 after a faster review saves, preserving the faster review's notes and revision.
6. A credential save rechecks active analysis jobs after body receipt and returns 409 without creating a credential file.
7. Malformed cookies return 401 from a protected HTTP handler; a replaced token is rejected and the new token succeeds.

Both original regression tests were also executed against an isolated copy of pre-fix commit `b4b7acb`. Both failed for the expected reasons: the multibyte token raised a byte-length exception and the revoked review returned 200. This demonstrates that the tests detect the reported defects rather than merely accepting both implementations.

## Results

- 30 automated tests pass on the fixed implementation.
- TypeScript checks and a production build pass.
- Dependency audit reports zero known vulnerabilities at the time of this review.
- The previously published GitHub check for `27c676b` was confirmed successful. New tests use the existing workflow; the new commit's CI result must be checked separately.
- No additional runtime defect was reproduced in the cases tested. No new model, prompt, schema, provider-setting or analysis-engine change was made during this follow-up.

## Installation gap

The Mac installation and local source checkout initially remained on the pre-audit implementation. A GitHub commit does not update a running local app. The two verified runtime fixes and corrected comment were applied to the Mac installation, along with the tests and documentation. That installation passed all 30 tests, TypeScript checks and a production build, then was restarted. Saved-data and environment-file hashes were unchanged before and after the update. Production HTTP checks confirmed locked-route rejection, cache-control headers and rejection of an untrusted Host header. No passphrase was needed and no client data was opened. Local vault files, environment settings and runtime data remain excluded from publication.

## Limits

This is a scoped source and regression review, not a guarantee that every vulnerability is absent. No client agreement, real API key, paid model call, live provider connection or legal-quality evaluation was used. No parser fuzzing, load test, multi-process audit, crash-recovery assessment or independent penetration test was performed. All residual risks described in [AUDIT.md](AUDIT.md) continue to apply.
