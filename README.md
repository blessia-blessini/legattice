# legattice

Running FOSS scans — and keeping track of what they leave open.

Give Legattice a product (a set of Git repositories at given refs) and it produces the
third-party licence and copyright notices for that product, a bill of materials (SBOM), and a list
of **open topics**: every finding a machine cannot settle — no licence, an unclear licence, a
copyleft obligation, a conflict with the product's own licence. A person closes each topic with a
written decision, approved like any other change in Git. A closed topic reopens on its own when the
evidence it was decided on changes, or when its decision expires.

The scanning itself is done by existing open-source tools — the
[OSS Review Toolkit (ORT)](https://github.com/oss-review-toolkit/ort) and
[ScanCode](https://github.com/aboutcode-org/scancode-toolkit), run as separate programs. Legattice
adds the part around them: the product definition, the ledger of decisions, and the follow-up.

> **Status:** early — nothing to install yet. What runs today is the scan: the workflow
> **Scan (ORT)** finds a product's package managers by itself and spreads the ScanCode work over
> many jobs at once ([how it works](docs/scan.md)).
>
> Legattice reports what the tools find and what people decided. It does not give legal advice;
> licence decisions stay with a qualified person.


## LICENSING

Legattice is dual-licensed. Its copyright holder, Blessia Blessini, offers it under your choice of:

1. **The GNU Affero General Public License, version 3 or (at your option) any later version**
   (AGPL-3.0-or-later, see [LICENSE](LICENSE)) — free of charge, for any purpose: personal,
   open-source **and commercial** use, in an organisation of any size. In return, the AGPL's
   conditions apply. In short: if you distribute Legattice or a modified version of it, you pass on
   the same freedoms and make the corresponding source code available; if you modify Legattice and
   let others use your version over a network, you offer them its source code. The
   [LICENSE](LICENSE) text is binding; this summary is not.

2. **A commercial licence** — for anyone who wants to use, modify, embed or distribute Legattice
   without the AGPL's conditions, for example inside a proprietary product.
   Contact `blessia AT blessini.com`.

The tools Legattice runs (ORT, ScanCode and their dependencies) are separate programs under their
own licences; Legattice does not include them.

### YOUR REPORTS

The AGPL covers Legattice itself, not the reports it produces for your product.

**Additional permission under section 7 of the AGPL — generated reports.** When Legattice produces
a report for a product (for example a third-party notices document, a bill of materials or a list
of open topics), it may copy parts of its own templates or other code into that report. As a special
exception, the copyright holder gives you permission to use, copy, modify and distribute those
copied parts, as part of the generated report, under terms of your choice; the AGPL's conditions do
not apply to the report because of them. This exception does not apply to Legattice itself or to
any modified version of Legattice. If you modify Legattice, you may extend this exception to your
version, but you are not obliged to do so; if you do not wish to, delete this exception statement
from your version.

The licence texts and copyright notices a report reproduces belong to the components they describe
and remain under those components' licences.

### CONTRIBUTING

Because Legattice is offered under two licences, contributions can only be accepted under terms
that allow them to be offered under both: the [Contributor Licence Agreement](CLA.md). You keep the
copyright in your contribution. Please open an issue before preparing a pull request; the steps are
in [CONTRIBUTING.md](CONTRIBUTING.md).
