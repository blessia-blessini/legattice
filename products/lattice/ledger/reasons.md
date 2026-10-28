# Reasons — Lattice

Reason codes used in the `rationale` of Lattice's decisions. A rationale starts with the code and its
short form, then says in its own words what this topic's evidence shows:

```text
REASON-001: Prefer MIT over Apache-2.0; LICENSE.spdx line 2 'DataLicense: CC0-1.0' licenses the SPDX file itself, not the code
```

A code keeps its meaning once used: to change what a reason says, add a new code. Every use of a code
can be found with `git grep "REASON-001" products/lattice/ledger`.

| Code | Short form | Outcome | Means | Since |
|---|---|---|---|---|
| REASON-001 | Prefer MIT over Apache-2.0 | `accept-as` `MIT` | The package, or code inside it, is offered under a choice that includes MIT and Apache-2.0 (`Apache-2.0 OR MIT`); Lattice takes MIT. What the scan found is described after the semicolon — often text of another licence bundled in the package (a vendored library, a copy of a licence list, metadata) that is not part of what Lattice builds. | 2026-10-28 |
| REASON-002 | False positive | `accept-as` the declared licence | What the scan reported is not a licence: ordinary words read as licence text (for example "intended for private use" in a doc comment), a link, a configuration list. The package's declared licence stands; the rationale names the lines and why they are not a licence. | 2026-10-28 |
| REASON-003 | Bundled code under its own licence | `accept-as` that code's licence | Code from another project sits inside the package under its own permissive licence (a header or a section of the licence file). The finding is settled as that licence, so its notice belongs in Lattice's notices. The rationale says where the code comes from and whether Lattice's notices already carry it ("not yet in notices": they do not). | 2026-10-28 |
| REASON-004 | Permissive option of a dual licence | `accept-as` the chosen option | The code is offered under two licences at the recipient's choice, one of them copyleft or uncommon; Lattice takes the permissive one, as its policy prefers. (MIT vs Apache-2.0 is REASON-001.) | 2026-10-28 |
| REASON-005 | Public-domain dedication | `accept-as` | The finding is a public-domain or CC0 dedication: nothing to comply with. Settled as the package's declared licence, or CC0-1.0 where the code is CC0 only. | 2026-10-28 |
| REASON-006 | Licence file names the licence | `accept-as` the file's licence | The package metadata declares no licence; its licence file is the full text of one. | 2026-10-28 |
| REASON-007 | MPL-2.0 used unmodified | `comply` | MPL-2.0 is file-level copyleft (section 3): Lattice uses the files unmodified, ships the MPL text in its notices and names where the source is. Lattice's `foss/policy.json` records this obligation. | 2026-10-28 |
| REASON-008 | Points to another component's licence | `accept-as` the declared licence | The text found names the licence of something else — the C libraries a binding links to, sample code in the documentation — not of the package's own code. Where that other component reaches Lattice, it is handled there. | 2026-10-28 |
| REASON-009 | Not part of what Lattice ships | `not-shipped` | The files with the finding never reach Lattice's build: a dependency only for fuzzing builds, source maps that the bundler does not emit. | 2026-10-28 |
| REASON-010 | AV1 patent licence | `accept-as` code licence AND the patent licence | AV1 code under BSD-2-Clause plus the Alliance for Open Media Patent License 1.0: a royalty-free patent grant whose section 1.2.1(b) asks that the licence text go with any binary, in the documentation or legal notices. | 2026-10-28 |

## Not for

- REASON-001 does not fit a package whose expression makes another licence mandatory, for example
  `(Apache-2.0 OR MIT) AND NCSA`: choosing MIT there would drop NCSA.
- REASON-001 settles the package's own code. Bundled third-party code that *is* built into Lattice
  and asks for its own notice (an attribution clause) is REASON-003.
- REASON-003 and REASON-010 settle the ledger. They do not put the notice into Lattice's
  `THIRD-PARTY-NOTICES.md`; until the notices are built from the ledger, a decision that says
  "not yet in notices" marks a gap to close in Lattice.
