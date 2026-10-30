# Open topics

A scan finds thousands of licence texts and references. Most of them settle themselves: the
package says "MIT", its files say MIT. An **open topic** is a finding a person has to look at and
decide. The merge job of **Scan (ORT)** lists them after every scan — in its job summary and in
`topics/topics.md` and `topics/topics.json` inside the results artifact, with the decisions of the
[ledger](ledger.md) applied.

*Found by tools, not legal advice.*

## When a finding becomes a topic

| Rule | When | Example from Lattice |
|---|---|---|
| **no declared licence** | a package declares no licence at all; the topic shows what its files say | khroma 2.1.0 — its files say MIT |
| **declared licence** | a package's declared licence offers no permissive choice | cssparser — MPL-2.0 only. `MPL-2.0 OR Apache-2.0` is not a topic: Apache-2.0 can be chosen |
| **undeclared licence** | a licence found in a package's code or licence files that its declared licence does not cover | KaTeX (MIT) — its fonts say SIL Open Font License 1.1 |

**The product's own repository makes no topics** (decided 2026-10-30). Its maintainer decides about
its own code, and ScanCode misreads the usual AGPL header ("version 3 … or any later version") as
AGPL-3.0-only — a topic that reopened with every release, since the evidence hash holds the version.
Licences found in its code that it does not declare are only counted ("not checked" in the report),
after the excludes in `products/<product>/ort.yml`. **Accepted limit:** third-party code copied into
the product's own tree (a file under another licence pasted into `src/`) is no longer raised here.

## What is not a topic — only counted

- **Own code:** licences in the product's own repository that it does not declare (above).
- **Mentions:** licences named in READMEs, docs, tests and examples. A README that says "the logo
  is CC-BY-NC-ND", or a test file holding a GPL text as a sample, says nothing about the code.
  (In Lattice's scan: 271.)
- **Unidentified references:** "see LICENSE" and similar, which ScanCode cannot name. (266.)

Where a finding is: a licence file at the top of the package, a licence file in a folder, source,
readme or metadata, docs text, or tests/examples/docs (by folder name such as `tests/`,
`examples/`, `docs/`, or a name such as `*.test.js`). Only the first three make topics.

## How urgent

| Severity | Licences |
|---|---|
| high | strong copyleft (GPL, AGPL…), restricted (non-commercial, no-derivatives, proprietary, source-available) |
| medium | weak copyleft and share-alike (LGPL, MPL, EPL, CC-BY-SA…), patent licences, no declared licence |
| low | permissive or public domain (MIT, BSD, Apache, ISC, OFL, CC0…) — usually only "add it to the notices" |

The severity only sorts the list. Whether a licence is acceptable for a product is a person's
decision.

## Same topic, new evidence

Every topic has:

- an **id** (`LT-…`) and a **key** — rule, package *without* its version, licence. Both stay the same
  when the package is updated, so a decision can be found again;
- an **evidence hash** — the package version and every finding (file, lines, licence). It changes
  when anything found changes.

The [ledger](ledger.md) records a decision for a key *and* an evidence hash. A new version or a
new finding changes the hash, and the topic opens again by itself.

## Known limits

- **Files that never ship still count.** A package archive holds more than a product uses — for
  Lattice, the GPL sources in libdbus-sys's `vendor/` folder (never compiled) and the standalone
  bundles of mermaid (never imported) both make topics. A person closes them once, with the reason;
  telling shipped files apart automatically is planned.
- **Crates that are built for no target still count** (ORT reads Cargo without a target; phase-0
  report). Planned: filter by the product's targets.
- **Copyright holders are not checked yet.** Whether holders named only in source files must
  appear in the notices is an open question.

Code: `src/topics/` — `topics.mjs` (the rules), `places.mjs` (where a finding is),
`licence-classes.mjs` (how urgent), `spdx.mjs` (licence expressions).
