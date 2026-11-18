# dsh-mailbox

**Offline mailbox archive workbench** — turn exported `.eml` / `.mbox` files into a deadline-aware to-do list. No network, no OAuth, never touches your files.

**[简体中文](README.md)** · [Install](#install) · [Usage](#usage) · [What it does not do](#what-it-does-not-do)

---

## Why

`dsh-email` handles **live mailboxes**: IMAP/SMTP, OAuth, sending and receiving.

But often all you have is **exported files**:

- An `.mbox` archive from a mailbox you are leaving
- A batch of `.eml` files from a client, and you need to know which ones are waiting on a reply and when they are due
- Token expired or the corporate network blocks IMAP, and you just want to look offline

`dsh-mailbox` covers exactly that layer: **read-only files, zero configuration, nothing uploaded, no account required**.

## Install

```bash
dsh plugin --profile desktop add dsh-mailbox
```

Use `web` instead of `desktop` for the web edition, then restart DSH.

Or use the CLI directly:

```bash
npx dsh-mailbox scan ./mail-export
```

## Usage

Five actions, none of which modify your files:

| Action | What it does |
|---|---|
| `scan` | Inventory: files, messages, duplicates, date range, attachments |
| `triage` | Four buckets: **action** / red / good / opportunity |
| `threads` | Group by References / In-Reply-To, longest conversations first |
| `attachments` | Attachment audit: type, size, occurrences |
| `search` | Search subject / body / sender |

```bash
dsh-mailbox scan        ./mail-export
dsh-mailbox triage      ./mail-export            # full Markdown report
dsh-mailbox triage      ./mail-export --brief    # one-screen summary
dsh-mailbox triage      ./mail-export --json     # machine readable
dsh-mailbox threads     ./mail-export --top 10
dsh-mailbox attachments ./mail-export
dsh-mailbox search      ./mail-export --q "invoice"
```

Inside DSH, just ask:

> Use dsh_mailbox to triage `~/Downloads/mail-export` and only list what I need to act on this week.

Every finding carries a **file path + index**, so any claim can be traced back to the original message.

## What it does not do

These are design boundaries, not missing features:

- **No mailbox connection**: no IMAP / SMTP / POP3 / OAuth. Use `dsh-email` for live mailboxes.
- **No writes**: never moves, deletes, renames or rewrites the source files.
- **No network**: zero network calls (the self-check rejects `node:http/https/net/tls` imports).
- **No execution of mail content**: HTML scripts are stripped, remote images are not fetched.
- **Unsupported formats** are reported honestly, not faked: TNEF (`winmail.dat`), S/MIME decryption, encrypted mail, MS proprietary rich text.
- **No semantic inference**: the four buckets are keyword rules, not a model. Every result lists the matched keywords for human review; uncertain items go to "notify" instead of polluting "action".
- **Only the words this message actually writes**: quoted history (`>` lines, `-----Original Message-----`, `On … wrote:`, Outlook `From:` header blocks) is ignored when applying rules — otherwise an old deadline or old error quoted inside a reply would push an already-settled thread back into "action" or "red". The subject line always counts.
- **No guaranteed deadlines**: only explicit date formats are parsed (`2026-11-25`, `2026/11/25`, `2026.11.25`, `2026年11月25日`, `11月20日`, `Nov 24, 2026`, `within 5 days`, `7天内`); "ASAP" or "next week" are not turned into dates, though "请于下周三前回复" still lands in "action" as an explicit ask.
- **Years never come from the clock**: a date without a year is resolved against the message's own send date (a "Jan 5" written in December rolls to the next year), so triaging a 2024 archive does not produce 2026 deadlines.
- **No huge-archive indexing**: files over 200 MB are skipped and reported; no persistent index is built.

## Charset support

UTF-8 · GBK/GB2312/GB18030 · Big5 · ISO-8859-1 · Windows-1252 · Shift_JIS · EUC-JP · EUC-KR

Undecodable charsets are surfaced as encoding warnings rather than silently producing mangled text.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Bad arguments |
| 2 | Directory missing or unreadable |
| 3 | No `.eml` / `.mbox` found |

## References and license

- Message format: [RFC 5322](https://datatracker.ietf.org/doc/html/rfc5322); MIME and encoded words: [RFC 2045–2047](https://datatracker.ietf.org/doc/html/rfc2045).
- Bucket semantics follow the local `mailbox-triage` skill so humans and agents share one vocabulary.
- **Zero runtime dependencies.** The MIME parser is hand-written; no third-party parser code was copied.
- License: MIT.
