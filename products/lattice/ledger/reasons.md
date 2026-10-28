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
| REASON-001 | Prefer MIT over Apache-2.0 | `accept-as` `MIT` | The package offers a choice that includes MIT and Apache-2.0 (`Apache-2.0 OR MIT`); Lattice takes MIT. What the scan found is described after the semicolon — mostly text of another licence bundled in the package (a vendored library, a copy of a licence list, metadata) that is not part of what Lattice builds. | 2026-10-28 |
| REASON-002 | False positive | `accept-as` the declared licence | What the scan reported is not a licence: ordinary words read as licence text (for example "intended for private use" in a doc comment). The package's declared licence stands; the rationale names the lines and why they are not a licence. | 2026-10-28 |

## Not for

- REASON-001 does not fit a package whose expression makes another licence mandatory, for example
  `(Apache-2.0 OR MIT) AND NCSA`: choosing MIT there would drop NCSA.
- REASON-001 settles the package's own code. Bundled third-party code that *is* built into Lattice
  and asks for its own notice (an attribution clause) is better decided as `comply`, keeping that
  notice.
