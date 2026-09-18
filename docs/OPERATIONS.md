# Local operation and implementation notes

Use non-sensitive, authorized test documents. This is a single-user evaluation build, not a deployed legal service. See the root README for the provider disclosure and review boundaries.

## Start

Double-click **Start Accord Institute.command** in this folder. Keep its Terminal window open. The workspace opens at **http://127.0.0.1:4180**. Use **Stop Accord Institute.command** or Control-C in the launcher window to stop it.

On a fresh copy, install Node.js 24 or newer and run **Setup Accord Institute.command** first. Setup installs application dependencies and builds the app. No local model or model weights are installed.

1. Create a vault with your own passphrase of at least 14 characters. Save it in your password manager; there is no passphrase recovery service.
2. Open **Connection & instructions**. Enter an OpenAI API key there, then **Save API key** and **Test connection**. The key is encrypted with the vault and never returned to the browser. The connection check verifies key/model access without sending an agreement; generation also requires available API credit.
3. Import a readable PDF, Word `.docx`, or UTF-8 `.txt` agreement. Importing stays local.
4. Compare extracted text with the original, including definitions, tables, schedules and exhibits. Confirm that check.
5. Select **Generate analysis**. This sends the extracted source text and instructions to OpenAI. A full run makes eight sequential requests: a draft and critique for each of funding, deadlock, removal and transfer. API usage is charged to your API project. Use project spending controls while testing.
6. Click a finding or citation to inspect the original passage. **Save changes** or **Mark reviewed** saves your separate notes and corrections. **Run history** preserves previous results and their instruction snapshots.
7. Use **Encrypted backup** regularly.

The vault locks after 30 idle minutes. Locking or stopping the app interrupts an active run. **Stop analysis** retains completed scenarios. Cancellation stops local work but cannot retract a request already received by OpenAI. A new analysis creates a separate run. Only one run can be active at a time, and the connection cannot be changed during a run.

## Markdown guidance and source checks

Edit [`instructions/`](../instructions/) in a text editor. The next run saves a new snapshot automatically. **Reload files** refreshes the instruction viewer.

| File | Purpose |
| --- | --- |
| `00-system.md` | Scope, authority, document-as-evidence boundary, uncertainty |
| `10-evidence.md` | Source passage IDs, extracted/derived/review-required classifications, prerequisites |
| `20-output.md` | Required structured result |
| `30-critique.md` | Second-pass review of the draft |
| `scenarios/funding.md` | Calls, obligations, notices, cure, remedies |
| `scenarios/deadlock.md` | Approvals, qualifying deadlock, escalation, interim operations, exits |
| `scenarios/removal.md` | Grounds, cure, effectiveness, replacement, surviving rights |
| `scenarios/transfer.md` | Transfer types, restrictions, exceptions, consent, exit mechanics |

Each run saves the complete instructions, their SHA-256 fingerprint, original file hash, application version, pinned model identifier and context budget. Editing instructions never rewrites earlier runs.

The model selects source passage IDs; the application inserts the exact original text. Unknown passages, ungrounded numbered-section labels, duplicate IDs, broken/circular prerequisites and malformed results are rejected. These checks establish structural consistency and exact quotation matching, not whether a quote supports a conclusion or whether the legal interpretation is correct. The critique uses the same model. Human review remains necessary. Amendments and related documents are not automatically collected or reconciled.

## Local storage

- Original files, extracted text, findings, corrections and history are encrypted in `.private-data/` using AES-256-GCM. A random salt and scrypt derive the encryption key from your passphrase. The key remains in the server process while the vault is unlocked.
- The OpenAI key is separately encrypted in `provider-settings.enc` inside the same vault. It is excluded from exported backups and source ZIPs. Re-enter it after restoring a backup. **Remove key** removes the app's saved credential; revoke it in OpenAI if needed.
- The server binds to `127.0.0.1:4180`. Host, origin and session checks protect local API routes. Responses are marked `no-store`. No analytics, external fonts or browser storage of documents are included. Prompts, keys and raw provider errors are not logged by this application.
- Unlocked content exists in application/browser memory. Malware, browser extensions, other processes under your account, screenshots, OS swap and backups are outside this vault's protection. The app does not promise secure erasure or an independent security certification.
- Downloaded originals and readable reports are ordinary **unencrypted** files. Encrypted backups still need the original vault passphrase.
- Keep this version local. It is not configured for public hosting, shared accounts, LAN access or a firm-wide deployment.

## Limits

- Pinned model: `gpt-5.4-2026-03-05`, medium reasoning, 16,000 output tokens per request. Model/account availability must be verified with your own API key.
- Maximum extracted source for analysis: 120,000 characters. A conservative 262,144-token request budget also includes instructions, schema, critique draft and output reserve. Requests may be rejected below the source limit; nothing is silently shortened.
- Imports: 15 MB, up to 150 PDF pages, 400,000 extracted characters and 4,000 source blocks. Importing does not guarantee an agreement fits analysis.
- PDFs need a readable text layer; no OCR. Word/TXT use paragraph locators rather than original page numbers. Extraction may omit or rearrange content, so inspect the source.
- Each request has a ten-minute timeout. Failed scenarios show an error and preserve other completed scenarios. No automatic retries or extra model requests run in the background.
- No redlining, amendment consolidation, external legal research, deadline automation or collaboration is included.

## Backup and restore

Download **Encrypted backup** while unlocked. Keep it outside this project folder and protect the passphrase separately.

Restore into a **new path**, never over an existing vault:

```sh
npm run restore -- "/path/to/agreement-vault.encrypted-backup.json" "/path/to/new-vault-folder"
```

Stop the app. Add `AGREEMENT_DATA_DIR=/path/to/new-vault-folder` to `.env.local`, restart, and unlock with the original passphrase. Re-enter your API key. Verify recovered documents/history before changing the old folder. The restore tool rejects path traversal and overwrites; unlocking verifies cryptographic integrity.

## Development and verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover vault encryption, parsing, source validation, run/review preservation, cancellation, credential storage, strict request format, disabled response storage and provider errors. Provider tests use mocked HTTP and fictional text; they do not contact OpenAI or establish legal accuracy. [`scripts/qa-api.ts`](../scripts/qa-api.ts) is a separate QA-vault integration harness, never for a client vault.

The source ZIP excludes `node_modules/`, `.next/`, `.runtime/`, `.private-data/`, `.env.local`, credentials and client data. Dependencies are reinstalled with Setup on a fresh copy.
