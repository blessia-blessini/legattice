# The ledger

The scan lists **open topics**: findings a person has to decide ([topics.md](topics.md)). The
ledger is where those decisions are written down — one file per decided topic, in
`products/<product>/ledger/`, committed to Git like any other change. It is the only place a person
writes; everything else is computed from the scan and the ledger.

*Legattice records decisions; it does not make them. A decision is a person's, and not legal advice
from this tool.*

## A decision

`products/lattice/ledger/2-medium.open.LT-c95612b6e3.json`:

```json
{
  "format": 1,
  "id": "LT-c95612b6e3",
  "key": "no-declared-licence|NPM:khroma|",
  "title": "khroma 2.1.0 declares no licence; its files say: MIT",
  "evidence": {
    "package": "NPM::khroma:2.1.0",
    "declared": null,
    "hash": "986854e11ebc96ed",
    "count": 2,
    "lines": ["license:1-1 MIT", "license:5-21 MIT"]
  },
  "decision": {
    "outcome": "accept-as",
    "licence": "MIT",
    "rationale": "The package declares no licence; its license file is the full MIT text.",
    "decidedBy": "<the person who decided>",
    "date": "2026-10-27",
    "expires": null
  }
}
```

The top part — `id`, `key`, `title`, `evidence` — is written by the scan and is not edited. The
`decision` is the person's:

| Field | What |
|---|---|
| `outcome` | one of the four below |
| `licence` | only for `accept-as`: the licence the finding is settled as, an SPDX expression (`MIT`, `MIT OR Apache-2.0`) |
| `rationale` | why, in words — what someone reading this in two years needs |
| `decidedBy` | the person who decided |
| `date` | the day, `YYYY-MM-DD` |
| `expires` | optional: a day after `date` when the decision must be looked at again; `null` for never |

### Outcomes

| Outcome | Means | Where it can fit |
|---|---|---|
| `accept-as` | the finding is settled as the licence in `licence` | a package that declares no licence while its files carry one |
| `comply` | the licence applies, and the product meets its conditions (the rationale says how) | an MPL-2.0 package used unchanged, its source available |
| `not-shipped` | the files with the finding are not part of the product | sources in a `vendor/` folder that is never compiled |
| `remove` | the component must leave the product | a licence the product cannot accept |

The last column only shows where an outcome *can* fit; whether it fits a topic is the person's
decision. The khroma file above is an example of the format, not a decision.

## How a topic is closed

1. Run the scan (**Actions → Scan (ORT)**). The merge job's summary lists the topics; the results
   artifact holds `topics/drafts/`: one file to fill in for every topic still to decide (names below).
2. Copy the draft of a topic to `products/<product>/ledger/` — as it is, no renaming — fill in
   `decision`, commit. A decision can go through a pull request so a second person sees it before it
   counts.
3. The next scan shows the topic as **closed**.

### File names

A draft is named `<severity>.<status>.<topic id>.json`:

| Draft | Means |
|---|---|
| `1-high.open.LT-0e42d9a186.json` | high, never decided |
| `2-medium.reopened.LT-c40e4954e2.json` | medium, decided before; the evidence changed or the decision expired |
| `3-low.pending-removal.LT-….json` | low, decided `remove`, still in the product |

The number in front makes the names sort high, medium, low in any file list. In the ledger only the
id at the end counts: `LT-c95612b6e3.json` and `2-medium.open.LT-c95612b6e3.json` are the same
decision. The label is what the topic was when the draft was made — the report has its status now.

When a topic reopens, its new draft has a different label (`reopened`) from the decision already in
the ledger (`open`). Replace the old file with the new one: two files for one topic are refused,
naming both.

A file that is not filled in completely is refused, and the scan fails naming the file and every
problem in it — a half-written decision never closes a topic silently.

## Statuses

| Status | When | Needs a person |
|---|---|---|
| open | no decision | yes |
| reopened | decided, but the evidence changed, or the decision expired | yes |
| pending removal | decided `remove`, and the component is still there | yes |
| closed | decided, same evidence, not expired | no |

A decision holds for the evidence it was made on. The evidence hash covers the package version,
its declared licence and every finding (file, lines, licence). When any of that changes, the topic
**reopens** and the report says what changed:
`evidence changed: NPM::mermaid:11.17.1 -> NPM::mermaid:11.17.2, 1 new finding(s)`. A new version of
a package therefore reopens its topics, even when nothing else changed: a new version can change
its licence, and only a person can say it did not.

The draft of a reopened topic carries the earlier decision as a starting point, but without
`decidedBy` and `date`: it counts again only when a person has looked and signs it again.

A decision whose topic the scan no longer finds is listed under **decisions not found** — the
component left the product, or the scan did not cover it (for example, a run limited to one package
manager). Delete the file once the topic is certainly gone; Git keeps its history.

## Checks that make a file count

- `id` belongs to `key`, and the file name ends in `<id>.json` — a decision copied into the wrong
  file cannot close another topic. One file per topic.
- `outcome` is one of the four; `licence` is a well-formed expression for `accept-as`, and empty
  otherwise.
- `rationale` and `decidedBy` are written; `date` and `expires` are real days, `expires` after `date`.
- No unknown fields — a misspelt `"decison"` is reported, not ignored.

Other files in the ledger folder (a `README.md`) are ignored.

## Blocking

The workflow input `block_at` (`none`, `high`, `medium`, `low`) fails the run when topics still to
decide reach that severity. The reports and drafts are written first, so a failed run still shows
what is left. A product release can require `block_at: high` to pass.

## Why JSON

Node, which runs Legattice's own steps, reads JSON without anything installed; YAML would need a
library. The cost: JSON has no comments, so everything worth saying goes into `rationale`.

## Code

`src/ledger/ledger.mjs` (checks, statuses, drafts, blocking), `src/ledger/report.mjs` (the Markdown
report); the `topics` command in `src/scan/cli.mjs` reads the folder and writes the files.

## Not yet

- **Notices from the ledger.** An `accept-as` decision does not yet change the notices or the SBOM;
  that is the next step.
- **Who may decide.** Git records who committed a decision; requiring a named reviewer's approval
  (CODEOWNERS plus branch protection) is left to the repository's settings.
