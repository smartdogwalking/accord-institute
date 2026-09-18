# Accord Institute

[![Source and vault checks](https://github.com/smartdogwalking/accord-institute/actions/workflows/checks.yml/badge.svg)](https://github.com/smartdogwalking/accord-institute/actions/workflows/checks.yml)

A source-linked agreement-review workspace for real-estate joint ventures. Accord maps contractual mechanisms—funding default, major-decision deadlock, operator removal, and transfer/exit—into structured findings a legally trained reviewer can inspect, question, and correct.

**Single-user evaluation build, not a legal opinion or firm-ready deployment.** The application runs locally and encrypts saved work at rest. Generating analysis sends extracted agreement text and the instruction pack to the OpenAI API. Local storage does not mean local-only analysis.

Built by Maxwell D'Andrea with AI-assisted development. “Accord Institute” is the project name, not a claim of institutional accreditation or independent legal validation.

## What the project demonstrates

The design problem is not simply summarizing an agreement. A remedy may depend on notice, a cure period, an election, or an exception elsewhere in the document. Those prerequisites need to remain visible, alongside the text that supports them.

- **Four focused review scenarios:** funding, deadlock, removal, and transfer/exit, using the agreement's own terminology.
- **Source-linked findings:** the model selects passage IDs; the application supplies the exact imported text rather than accepting model-written quotations.
- **Explicit uncertainty:** extracted, derived, and review-required classifications; open questions when a mechanism is uncertain or not located.
- **Human review without rewriting history:** reviewer notes and corrections remain separate from the generated analysis; each run preserves its instruction snapshot, source hash, model identifier, and review history.
- **Local encrypted persistence:** original files, extracted text, findings, and reviews are stored in a passphrase-derived AES-256-GCM vault. The API key is encrypted separately and excluded from exported backups.

## Review the engineering

| Concern | Implementation | Boundary |
| --- | --- | --- |
| Evidence and contractual dependencies | [analysis.ts](lib/analysis.ts), [Markdown instructions](instructions/) | Rejects unknown passage IDs, unmatched quotations, invalid dependencies, cycles, and certain unsupported section labels. Does not prove legal correctness. |
| Draft and critique | [runner.ts](lib/runner.ts) | Up to eight sequential requests per full run; partial results and prior runs are preserved. Critique uses the same model, not an independent reviewer. |
| Document intake | [ingest.ts](lib/ingest.ts) | PDF text-layer extraction and DOCX/TXT paragraph extraction, with size limits and warnings. No OCR or guaranteed extraction completeness. |
| Storage and local access | [vault.ts](lib/vault.ts), [security.ts](lib/security.ts) | Encrypted files, revision checks, idle lock, session checks, and host/origin restrictions. Not a security certification. |
| Provider boundary | [provider.ts](lib/provider.ts) | Fixed HTTPS endpoint, server-side key use, disabled response storage, bounded output, and sanitized provider errors. |
| Verification | [tests](tests), [audit notes](docs/AUDIT.md) | 23 automated tests with synthetic material and mocked provider responses; no live-model legal-quality benchmark. |

The stack is TypeScript, Next.js, React, Zod, PDF.js, and Mammoth. Markdown files define the analysis charter, evidence policy, output structure, critique, and scenario-specific guidance.

## Evaluation workflow

```text
Import locally → check extracted text against the original → confirm source
    → generate draft + critique through OpenAI → validate structure and citations
    → inspect source passages → save separate reviewer corrections
```

Start with [the fictional sample agreement](examples/Synthetic-review-agreement.txt), not a client document. An exact source match means the passage exists in the imported text; it does not establish that it supports the generated conclusion. Amendments, related agreements, applicable law, and factual circumstances are not automatically reconciled.

## Run locally

Node.js 24 or newer is required:

```sh
git clone https://github.com/smartdogwalking/accord-institute.git
cd accord-institute
npm ci --ignore-scripts
npm test
npm run build
npm start
```

Open **http://127.0.0.1:4180**. Create a vault with a 14–256-character passphrase and store that passphrase securely; there is no recovery service. Importing and inspecting documents needs no API key. For analysis, save your own OpenAI API key in **Connection & instructions** and test model access. API usage incurs charges.

Mac users can instead run **Setup Accord Institute.command**, then **Start Accord Institute.command**. Keep the launcher Terminal open. **Stop Accord Institute.command** stops that launcher. Detailed operation, limits, instruction editing, and backup/restore steps are in [the operations guide](docs/OPERATIONS.md).

## Confidentiality and provider disclosure

The connector sends extracted text, Markdown guidance, and the draft during critique to the Responses API with `store: false`. It does not upload the original document file or send saved reviewer notes, and it does not use web search or document tools.

OpenAI does not train on API data by default unless you opt in. Disabling response storage is **not** Zero Data Retention: abuse-monitoring logs may retain content for up to 30 days, subject to policy exceptions; prompt caching has separate retention. Retention arrangements require review at the actual API organization/project level. See [official OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Evaluate with non-sensitive material. Before client use, obtain applicable client/firm authorization and review provider terms, project settings, confidentiality obligations, retention, and security requirements. This application cannot establish privilege protection or confer another vendor's contractual controls.

## Verification and limits

```sh
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
```

The scoped review found and fixed two session-handling issues, with regression tests that fail against the original behavior. The current 23-test suite, TypeScript checks, production build, and dependency audit passed locally. CI repeats those checks. See [audit scope, fixes, and residual risks](docs/AUDIT.md).

- Pinned model configuration: `gpt-5.4-2026-03-05`, medium reasoning, 16,000 output tokens per request. Pinning configuration does not make outputs deterministic or guarantee account access.
- Imports: 15 MB; PDFs up to 150 pages; up to 400,000 extracted characters and 4,000 blocks. Analysis: 120,000 source characters plus a conservative complete-request context budget. Oversized requests fail rather than silently truncating source.
- No redlining, amendment consolidation, external legal research, deadline automation, collaboration, or firm-wide hosting.
- The vault protects files at rest, not an unlocked browser/process, malware, extensions, screenshots, OS memory/swap, or readable downloads. Downloaded originals and Markdown reports are **unencrypted**.
- Locking stops active local work. Cancellation cannot retract requests already received by the provider. Encrypted backups require the original passphrase; the API key must be re-entered after restore.

The public repository contains source and synthetic fixtures, not client agreements, runtime vaults, or credentials. This was a scoped source review, not an independent penetration test, compliance assessment, or validation of legal analysis. Code is shared for review; no open-source license is granted.
