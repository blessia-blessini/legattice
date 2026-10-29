# How a scan runs

The workflow **Scan (ORT)** (`.github/workflows/scan.yml`) finds out what a product is made of and
which licences each part carries. It uses the OSS Review Toolkit (ORT), a separate program, and
ScanCode inside it, which reads every file of every package for licence and copyright texts.

ScanCode is slow: Lattice's npm packages alone took 74 minutes in one job. So the scan is cut into
pieces that run side by side, up to 18 jobs at once.

## The three kinds of job

```
 broker (1 job)                         what is there, and who scans what
   │  1. ask ORT which package managers the product uses
   │  2. let ORT list every package, once per package manager
   │  3. guess how long each piece takes
   │  4. share the pieces out: N lists of about equal length
   │
   ├──► shard 1 ─┐
   ├──► shard 2 ─┤                      N jobs at once, each scans its list
   ├──►  ...    ─┤
   └──► shard N ─┘
                 │
 merge (1 job)  ◄┘                      put it together
      5. one ORT scan per package manager, from the stored results
      6. scan whatever a shard did not deliver
      7. write down how long everything took (for the next guess)
      8. list the open topics: what a person must decide (docs/topics.md),
         after the decisions already made (docs/ledger.md)
      9. write the reports: SBOM, notices, web page
```

**Nothing is assumed about the product.** The broker does not know beforehand whether it scans
Rust, JavaScript or C++: ORT looks for the files that define packages (`Cargo.toml`,
`package.json`, `conanfile.txt`, …) and names the package managers it found. Files that no package
manager owns — for example C or C++ sources copied into the repository — belong to a project ORT
calls *Unmanaged*, and are scanned with the product's own files.

## The pieces

A piece ("work unit") is one of:

- **a package** — one npm package, one Rust crate, one Conan package, … ORT can be told to scan any
  selection of packages, so packages can go to any shard;
- **the product's own repository** — everything that is not a package: the product's own code,
  and copied-in C/C++ that nobody declared. ORT scans it as one block; it cannot be split today.

C/C++ that comes through Conan or Bazel, or that is declared in an SPDX document file, is a package
and is spread like any other.

## How long will a piece take?

The broker guesses, best guess first:

| What it knows                                                                    | Guess                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scanned in an earlier run, result still stored                                   | a lookup: 2 seconds                                                                                                                                        |
| the size of the package's source archive                                         | seconds per MB, measured on earlier runs of the same package type (until there are 20 measurements: 5 s + 43 s per MB, measured on Lattice's npm packages) |
| the product's repository, scanned before at another version                      | as long as last time                                                                                                                                       |
| nothing (for example a Git repository, whose size is unknown until it is cloned) | 5 minutes                                                                                                                                                  |

The sizes are asked from the registries before scanning (a request for the first byte only; the
answer names the whole size).

Then the longest piece goes to the emptiest shard, again and again ("longest first"). The result
is close to the best possible split. No shard can finish sooner than the single longest piece —
for Lattice that is `mermaid`, about 13 minutes.

The broker opens fewer shards than allowed when there is little to do: a shard costs 2–3 minutes
just to start ORT, so it gets at least 5 minutes of work. Looking up a stored result is not work:
a run where everything is stored gets one shard.

**A wrong guess costs time, never results.** The merge job scans the whole product again, reading
every result the shards stored, and scans by itself anything that is missing — a shard that failed,
or ran out of time. Its job summary says how many pieces that were.

## What is kept between runs

| Kept                                                            | Where                                              | For                                         |
| --------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| scan results, file lists, licence-file archive, package origins | GitHub cache `ort-scan-<ORT version>-…`            | a piece scanned once is never scanned again |
| how long each piece took, and its size                          | GitHub cache `ort-timings-<ORT version>-…` (small) | better guesses next time                    |

A new ORT version starts with empty caches: its results might differ. Timings not seen for 180 days
are dropped.

## Called from a product's build

A product can run the scan inside its own build, so a release waits for it (Lattice's release build
does). The workflow is a reusable one:

```yaml
foss-scan:
  uses: blessia-blessini/legattice/.github/workflows/scan.yml@main
  with:
    repository: blessia-blessini/lattice
    ref: ${{ github.sha }}
    block_at: medium
```

The inputs are the ones of the manual run. `results_artifact` (output) names the artifact with the
results, among them `topics/topics.md` and `topics/notice-additions.json`; it belongs to the calling
run. With `block_at`, the job fails while undecided topics reach that severity; decide them in the
ledger and use **Re-run failed jobs** on the calling run.

Differences from a run started here:

- **Legattice's code and ledger come from `main` as it is when each job starts** — a re-run reads the
  decisions made in between. (Run here, it is the commit the run was started on.)
- **The caches are the caller's**: GitHub keeps caches per repository, so the first call from a product
  starts with empty ones and scans everything (up to ~30 min with 16 shards for Lattice).

## Code

| File                      | What it does                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/scan/ort-result.mjs` | reads ORT's files: the package managers of the dry run, the pieces of an analyzer result, the times in a scan result; hides the packages a shard must not scan |
| `src/scan/plan.mjs`       | the guesses, the sharing out, the timings file                                                                                                                 |
| `src/scan/sizes.mjs`      | asks the registries for archive sizes                                                                                                                          |
| `src/scan/ort-config.mjs` | ORT's configuration, the same for every job                                                                                                                    |
| `src/scan/cli.mjs`        | the commands the workflow calls                                                                                                                                |

Node 24, nothing installed besides it. Tests: `npm test` (or `node --test`).

## Limits

- The product's own repository is one piece. A repository with a lot of copied-in C/C++ makes one
  long shard; splitting it by folder is planned for later.
- Each package manager is analyzed one after the other in the broker. ORT mixes up two projects of
  the same name and version from two package managers (Lattice has a Cargo and an npm project both
  called `lattice`), so they are not analyzed together.
- GitHub runs at most 20 jobs at once for a public repository on the free plan. `shards` goes up
  to 18, which leaves room for the broker or merge job of a second run.
- The scan reads the product's repository from its public URL; private products need credentials
  first.
