# Notice additions

A product writes its own third-party notices from its lock files: per package, the declared
licence, its copyright lines and licence text. What the scan finds *inside* a package is not in its
declared licence — code from another project carrying its own licence in a header, a font under its
own licence. Once a person decides such a finding in the ledger ([ledger.md](ledger.md)), the
product's notices must carry it too.

`notice-additions.json` says what. The scan writes it next to the topics (results artifact,
`topics/notice-additions.json`) whenever it runs with a ledger. The product reads it when it writes
its notices; Legattice does not write the product's notices itself.

## What counts as an addition

A **closed** topic of a **package** whose decision settles the finding as a licence the package does
not declare:

| Decision | Adds |
|---|---|
| `accept-as` with a licence the package does not declare | the licences of the expression that the declared licence does not contain |
| `comply` | the licence found, unless the package declares it |
| a choice out of the declared licence (`accept-as MIT` for `Apache-2.0 OR MIT`) | nothing: the product's own notices already cover it |
| `not-shipped`, `remove` | nothing |

Never an addition: open or reopened topics (decide them first), a package that declares no licence
(the product settles its own metadata), the product's own repository.

## The file

```json
{
  "format": 1,
  "source": {
    "product": { "repository": "blessia-blessini/lattice", "ref": "v0.3.50" },
    "date": "2026-10-28",
    "legattice": "<commit of Legattice that ran>",
    "run": "https://github.com/blessia-blessini/legattice/actions/runs/..."
  },
  "additions": [
    {
      "topic": "LT-071c796ae5",
      "package": { "id": "Crate::rav1e:0.8.1", "ecosystem": "cargo", "name": "rav1e", "version": "0.8.1" },
      "licences": ["ISC"],
      "decision": { "outcome": "accept-as", "licence": "ISC", "rationale": "REASON-003: ...", "decidedBy": "...", "date": "2026-10-28" },
      "files": [
        { "path": "src/ext/x86/x86inc.asm", "sha1": "…", "lines": [[11, 21]] }
      ],
      "copyrights": ["Copyright (c) 2005-2022 x264 project"]
    }
  ]
}
```

| Field | What |
|---|---|
| `package.ecosystem` | `cargo` or `npm` (other ORT package types: the type in lower case) |
| `licences` | SPDX ids the decision adds, sorted |
| `files` | every code or licence file the topic was found in: path inside the package, the SHA-1 of the file as scanned (`null` if ORT did not record one), and the line ranges of the finding |
| `copyrights` | the copyright statements the scan found in those files, sorted, each once |

Sorted by package id, then topic id. One package can have several additions — one per topic.

## What the product does with it

Lattice's notices tool (`scripts/foss/`) checks each file against its own copy of the package by
SHA-1, quotes the lines verbatim, adds the copyright lines, and links a standard text for each added
licence where it has one. A file whose SHA-1 differs is refused: the decision was made on other
content. An addition for a package version the product no longer ships is reported, so the scan is
run again for the new version.
