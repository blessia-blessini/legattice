// LEGAL NOTE:
// LEGATTICE (tm) - FOSS scans and the ledger of what they leave open
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENSE file in GitHub root folder of the repository.
// END OF NOTE

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    checkManagerName, filterAnalyzerResult, parseDryRunManagers, parseManagerList, provenanceKey, scanTimings, workUnits,
} from '../../src/scan/ort-result.mjs';
import {
    analyzerResult, artifactProvenance, pkg, project, REPO, repositoryProvenance, REVISION, scanResult,
} from './fixtures.mjs';

// The tail of a real `ort analyze --dry-run`, as ORT 97.2.0 echoes it.
const DRY_RUN = [
    'Analyzing project path:',
    '\t/work/product',
    'Found 1 Cargo definition file(s) at:',
    '\tsrc-tauri/Cargo.toml',
    'Found 1 NPM definition file(s) at:',
    '\tpackage.json',
    'Found 1 Unmanaged definition file(s) at:',
    '\t.',
    'Found in total 3 definition file(s) from the following 3 package manager(s):',
    '\tCargo, NPM, Unmanaged',
    'Not performing the actual project analysis as this is a dry run.',
].join('\n');

describe('package manager names', () => {
    it('accepts plain ORT ids and refuses anything a shell could misread', () => {
        assert.equal(checkManagerName('SpdxDocumentFile'), 'SpdxDocumentFile');
        for (const bad of ['', 'Cargo NPM', 'a;b', '../x', 'Yarn-2', null]) {
            assert.throws(() => checkManagerName(bad), /bad package manager name/);
        }
    });

    it('reads a comma-separated list: trimmed, without duplicates, sorted', () => {
        assert.deepEqual(parseManagerList(' NPM, Cargo,,NPM '), ['Cargo', 'NPM']);
        assert.deepEqual(parseManagerList(''), []);
        assert.throws(() => parseManagerList('Cargo, rm -rf'), /bad package manager name/);
    });
});

describe('parseDryRunManagers', () => {
    it('reads the managers ORT found', () => {
        assert.deepEqual(parseDryRunManagers(DRY_RUN), ['Cargo', 'NPM', 'Unmanaged']);
    });

    it('ignores colour codes and Windows line ends', () => {
        const coloured = DRY_RUN.replace('Found in total', '\x1b[1mFound in total').replaceAll('\n', '\r\n');
        assert.deepEqual(parseDryRunManagers(coloured), ['Cargo', 'NPM', 'Unmanaged']);
    });

    it('returns no managers when ORT found no definition file', () => {
        assert.deepEqual(parseDryRunManagers('Analyzing project path:\n\t/work/product\nNo definition files found.\n'), []);
    });

    it('fails when the count and the list disagree', () => {
        assert.throws(() => parseDryRunManagers(DRY_RUN.replace('\tCargo, NPM, Unmanaged', '\tCargo, NPM')),
            /reports 3 package manager\(s\), but 2 were read/);
    });

    it('fails loudly on output it does not know', () => {
        assert.throws(() => parseDryRunManagers('Exception in thread "main"'), /has the ORT output format changed/);
    });
});

describe('workUnits', () => {
    it('makes one unit per package and one per group of managers sharing their repositories', () => {
        const units = workUnits([
            { manager: 'Cargo', result: analyzerResult({ projects: [project('Cargo::app:1.0')], packages: [pkg('Crate::serde:1.0')] }) },
            { manager: 'NPM', result: analyzerResult({ projects: [project('NPM::app:1.0')], packages: [pkg('NPM::katex:0.18')] }) },
        ]);
        assert.deepEqual(units.filter((u) => u.kind === 'package').map((u) => u.key),
            ['package:Cargo:Crate::serde:1.0', 'package:NPM:NPM::katex:0.18']);
        const projects = units.filter((u) => u.kind === 'project');
        assert.equal(projects.length, 1);
        assert.deepEqual(projects[0].managers, ['Cargo', 'NPM']);
        assert.deepEqual(projects[0].repos, [{ url: REPO, revision: REVISION }]);
    });

    it('keeps managers with projects in other repositories apart', () => {
        const units = workUnits([
            { manager: 'Cargo', result: analyzerResult({ projects: [project('Cargo::a:1')] }) },
            { manager: 'GoMod', result: analyzerResult({ projects: [project('GoMod::b:1', { url: 'https://example.org/other.git' })] }) },
        ]);
        assert.deepEqual(units.map((u) => u.managers), [['Cargo'], ['GoMod']]);
    });

    it('records the archive URL, or null for a package with only a repository', () => {
        const [withArchive, without] = workUnits([{
            manager: 'Conan',
            result: analyzerResult({ packages: [pkg('Conan::zlib:1.3'), pkg('Conan::vendored:1', { url: null })] }),
        }]);
        assert.equal(withArchive.url, 'https://registry.example.org/Conan::zlib:1.3.tgz');
        assert.equal(without.url, null);
    });

    it('leaves out packages ORT would not scan anyway', () => {
        const units = workUnits([{
            manager: 'NPM',
            result: analyzerResult({ packages: [
                pkg('NPM::kept:1', { source_code_origins: ['ARTIFACT'] }),
                pkg('NPM::no-origins:1', { source_code_origins: [] }),
                pkg('NPM::metadata:1', { is_metadata_only: true }),
            ] }),
        }]);
        assert.deepEqual(units.map((u) => u.id), ['NPM::kept:1']);
    });

    it('refuses a file that is not an analyzer result', () => {
        assert.throws(() => workUnits([{ manager: 'NPM', result: { scanner: {} } }]), /NPM: not an ORT analyzer result/);
    });
});

describe('filterAnalyzerResult', () => {
    it('empties the source origins of every package not kept, and leaves the input alone', () => {
        const input = analyzerResult({
            projects: [project('NPM::app:1')],
            packages: [pkg('NPM::a:1'), pkg('NPM::b:1', { source_code_origins: ['VCS'] }), pkg('NPM::c:1')],
        });
        const before = structuredClone(input);
        const out = filterAnalyzerResult(input, new Set(['NPM::b:1']));
        assert.deepEqual(input, before);
        assert.deepEqual(out.analyzer.result.packages.map((p) => p.source_code_origins), [[], ['VCS'], []]);
        assert.deepEqual(out.analyzer.result.projects, input.analyzer.result.projects);
    });
});

describe('provenanceKey', () => {
    it('keys archives by URL and repositories by URL and resolved revision', () => {
        assert.equal(provenanceKey(artifactProvenance('https://x/a.tgz')), 'artifact:https://x/a.tgz');
        assert.equal(provenanceKey(repositoryProvenance('https://x/r.git', 'abc')), 'vcs:https://x/r.git@abc');
        assert.equal(provenanceKey({ source_artifact: { url: '' } }), null);
        assert.equal(provenanceKey(undefined), null);
    });
});

describe('scanTimings', () => {
    const projects = [project('NPM::app:1')];
    const packages = [pkg('NPM::a:1'), pkg('NPM::b:1'), pkg('NPM::excluded:1'), pkg('NPM::broken:1')];
    const result = scanResult({
        projects,
        packages,
        scans: [
            { id: 'NPM::app:1', provenance: repositoryProvenance(REPO, REVISION), start: -900, end: -713 },
            { id: 'NPM::a:1', provenance: artifactProvenance('https://registry.example.org/NPM::a:1.tgz'), start: -500, end: -496 },
            { id: 'NPM::b:1', provenance: artifactProvenance('https://registry.example.org/NPM::b:1.tgz'), start: 30, end: 90 },
            { id: 'NPM::broken:1', provenance: null },
        ],
    });

    it('measures each package and project, wherever it was scanned', () => {
        const t = scanTimings(result);
        assert.deepEqual(t.packages['NPM::a:1'], { seconds: 4 });
        assert.deepEqual(t.packages['NPM::b:1'], { seconds: 60 });
        assert.deepEqual(t.projects[REPO], { seconds: 187, revision: REVISION });
    });

    it('marks packages ORT did not scan with 0 seconds, and skips unresolved ones', () => {
        const t = scanTimings(result);
        assert.deepEqual(t.packages['NPM::excluded:1'], { seconds: 0 });
        assert.equal('NPM::broken:1' in t.packages, false);
    });

    it('counts what this run scanned itself, not what came from storage', () => {
        assert.deepEqual(scanTimings(result).fresh, { count: 1, seconds: 60 });
    });

    it('refuses a file without a scan result', () => {
        assert.throws(() => scanTimings(analyzerResult()), /not an ORT scan result/);
    });
});
