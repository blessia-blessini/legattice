# Ledger — Lattice

The decisions on Lattice's open topics, one file per topic, its name ending in the topic id. Each one
is a person's decision; how to write one and what each field means:
[docs/ledger.md](../../../docs/ledger.md).

Start from the draft of a topic in the scan's results artifact (`topics/drafts/`, e.g.
`1-high.open.LT-0e42d9a186.json`) and copy it here as it is. A file counts as a decision only once
`decidedBy` and `date` are filled in; until then it is a draft and closes nothing.

When signing, rename the label in the middle to `decided`: `1-high.open.LT-0e42d9a186.json` becomes
`1-high.decided.LT-0e42d9a186.json`. Only the id at the end counts, so the scan reads either name;
the label shows at a glance which files are signed.

Reason codes used in the rationales, and what each one means: [reasons.md](reasons.md).
