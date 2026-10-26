# Contributing to Legattice

Thank you for your interest in Legattice. Contributions are welcome — bug reports, ideas, fixes,
documentation and translations.

## Before you start

**Open an issue first** and describe what you want to change and why. This avoids work on something
that conflicts with plans already under way. Small fixes such as typos can go straight to a pull
request.

## Licence agreement

Legattice is offered under the AGPL-3.0-or-later and, alternatively, under a commercial licence (see
[README.md § LICENSING](README.md#licensing)). To keep offering both, every contribution needs the
[Legattice Individual Contributor Licence Agreement (CLA)](CLA.md). In short: **you keep the
copyright in your contribution** and grant the maintainer a licence to distribute it under both
licences; in return, every version of Legattice that contains it stays available under an
open-source licence.

**To agree**, post this sentence as a comment on your first pull request:

> I have read the Legattice CLA, version 1.0, and I agree to it for this and all my future
> contributions to Legattice.

A pull request is merged only once its author has agreed. If you contribute as part of your job,
make sure your employer allows it, or ask at `blessia AT blessini.com` about a corporate agreement.
Automated dependency updates (Dependabot) do not need the agreement.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Write tests together with the code they cover. Behaviour changes need automated tests; a list of
   manual steps is not enough.
3. Run the tests before opening the pull request.
4. Follow the style of the code around your change.
5. Do not add new dependencies without discussing them in the issue first.

## Commit messages

Use a short imperative title with a type prefix, then a short body:

```
FIX: Reopen a topic when its evidence file changes

- what changed and why
- how it was tested
```

Types in use: `FEAT`, `FIX`, `DOCS`, `TEST`, `REFACTOR`, `CHORE`, `SEC`.

## Third-party code

If your contribution adds or copies code written by someone else, name its source, licence and
copyright notice in the pull request. A new dependency must have a licence that fits both of
Legattice's licences: permissive licences (MIT, BSD, Apache-2.0 and similar) are fine; third-party
GPL or AGPL code is not, because it would remove the commercial option.
