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

import { itemTopics, MAX_EVIDENCE, openTopics, scannedItems, splitId, topicId } from '../../src/topics/topics.mjs';
import { artifactProvenance, pkg, project, REPO, repositoryProvenance, REVISION } from '../scan/fixtures.mjs';

/** A package or project as scannedItems makes it. */
const item = (id, declared, findings = [], kind = 'package') => ({
    kind, id, repository: kind === 'project' ? REPO : null, declared,
    findings: findings.map(([licence, path, place = 'source']) => ({ licence, path, startLine: 1, endLine: 2, place })),
});

/** An ORT scan result with licence findings per package (paths inside the archive). */
function scanResultWith({ packages = [], projects = [], excludes = { paths: [] } }) {
    const provenances = [];
    const scanResults = [];
    const files = [];
    for (const { id, declared, findings, root = 'package/' } of packages) {
        const provenance = artifactProvenance(`https://registry.example.org/${id}.tgz`);
        provenances.push({ id, package_provenance: provenance });
        scanResults.push({ provenance, summary: { licenses: findings.map(([license, path]) => ({ license, location: { path: root + path, start_line: 1, end_line: 2 } })) } });
        files.push({ provenance, files: findings.map(([, path]) => ({ path: root + path })) });
    }
    for (const { id, findings } of projects) {
        const provenance = repositoryProvenance(REPO, REVISION);
        provenances.push({ id, package_provenance: provenance });
        if (!scanResults.some((r) => r.provenance.vcs_info)) {
            scanResults.push({ provenance, summary: { licenses: findings.map(([license, path]) => ({ license, location: { path, start_line: 1, end_line: 2 } })) } });
        }
    }
    return {
        repository: { config: { excludes } },
        analyzer: { result: {
            projects: projects.map(({ id, declared }) => ({ ...project(id), declared_licenses_processed: { spdx_expression: declared } })),
            packages: packages.map(({ id, declared }) => pkg(id, { declared_licenses_processed: declared ? { spdx_expression: declared } : {} })),
        } },
        scanner: { provenances, scan_results: scanResults, files },
    };
}

describe('splitId', () => {
    it('splits ORT ids, keeping an npm scope', () => {
        assert.deepEqual(splitId('NPM::katex:0.18.10'), { type: 'NPM', name: 'katex', version: '0.18.10' });
        assert.deepEqual(splitId('NPM:@mermaid-js:parser:1.2.1'), { type: 'NPM', name: '@mermaid-js/parser', version: '1.2.1' });
    });
});

describe('itemTopics', () => {
    it('raises nothing when every finding is covered by the declared licence', () => {
        const { topics } = itemTopics(item('Crate::serde:1.0', 'MIT OR Apache-2.0', [['MIT', 'LICENSE-MIT', 'licence file'], ['Apache-2.0 WITH LLVM-exception', 'src/a.rs']]));
        assert.deepEqual(topics, []);
    });

    it('raises a package without a declared licence, with what its files say (khroma)', () => {
        const { topics } = itemTopics(item('NPM::khroma:2.1.0', null, [['MIT', 'license', 'licence file'], ['MIT', 'README.md', 'readme or metadata']]));
        assert.equal(topics.length, 1);
        assert.equal(topics[0].rule, 'no-declared-licence');
        assert.equal(topics[0].severity, 'medium');
        assert.match(topics[0].title, /khroma 2\.1\.0 declares no licence; its files say: MIT/);
        assert.deepEqual(topics[0].evidence, ['license:1-2 MIT']);
    });

    it('raises a declared licence without a permissive choice, but not one with', () => {
        const mpl = itemTopics(item('Crate::cssparser:0.37.0', 'MPL-2.0')).topics;
        assert.deepEqual(mpl.map((t) => [t.rule, t.severity, t.licence]), [['declared-licence', 'medium', 'MPL-2.0']]);
        assert.deepEqual(itemTopics(item('NPM::dompurify:3.4.17', 'MPL-2.0 OR Apache-2.0')).topics, []);
    });

    it('raises a licence found in code or licence files that the declared one does not cover', () => {
        const { topics } = itemTopics(item('Crate::libdbus-sys:0.2.7', 'Apache-2.0 OR MIT', [
            ['AFL-2.1 OR GPL-2.0-or-later', 'vendor/dbus/COPYING', 'licence file in a folder'],
            ['GPL-2.0-or-later', 'vendor/dbus/bus/a.c'],
        ]));
        const byLicence = Object.fromEntries(topics.map((t) => [t.licence, t]));
        assert.deepEqual(Object.keys(byLicence).sort(), ['AFL-2.1', 'GPL-2.0-or-later']);
        assert.equal(byLicence['GPL-2.0-or-later'].severity, 'high');
        assert.equal(byLicence['GPL-2.0-or-later'].evidenceCount, 2);
        assert.equal(byLicence['AFL-2.1'].severity, 'low');
    });

    it('counts mentions in READMEs and tests, and unidentified references, instead of raising them', () => {
        const { topics, counts } = itemTopics(item('Crate::tauri:2.12.5', 'Apache-2.0 OR MIT', [
            ['CC-BY-NC-ND-4.0', 'README.md', 'readme or metadata'],
            ['GPL-2.0-only', 'tests/fixture.txt', 'tests, examples, docs'],
            ['NOASSERTION', 'src/lib.rs'],
        ]));
        assert.deepEqual(topics, []);
        assert.deepEqual(counts, { mentions: 2, unidentified: 1, ownCode: 0 });
    });

    it('keeps the key across versions and changes the evidence hash with the findings', () => {
        const a = itemTopics(item('NPM::mermaid:11.17.2', 'MIT', [['MPL-2.0', 'dist/mermaid.js']])).topics[0];
        const b = itemTopics(item('NPM::mermaid:11.18.0', 'MIT', [['MPL-2.0', 'dist/mermaid.js']])).topics[0];
        const c = itemTopics(item('NPM::mermaid:11.17.2', 'MIT', [['MPL-2.0', 'dist/mermaid.js'], ['MPL-2.0', 'dist/other.js']])).topics[0];
        assert.equal(a.key, 'undeclared-licence|NPM:mermaid|MPL-2.0');
        assert.equal(a.key, b.key);
        assert.equal(a.id, b.id);
        assert.notEqual(a.evidenceHash, b.evidenceHash);
        assert.notEqual(a.evidenceHash, c.evidenceHash);
        assert.match(a.id, /^LT-[0-9a-f]{10}$/);
        assert.equal(a.id, topicId(a.key));
    });

    it('keeps at most MAX_EVIDENCE lines, and says how many there were', () => {
        const many = Array.from({ length: MAX_EVIDENCE + 5 }, (_, i) => ['GPL-2.0-only', `src/f${String(i).padStart(2, '0')}.c`]);
        const [t] = itemTopics(item('Crate::x:1', 'MIT', many)).topics;
        assert.equal(t.evidence.length, MAX_EVIDENCE);
        assert.equal(t.evidenceCount, MAX_EVIDENCE + 5);
    });

    it('makes no topic for the product\'s own repository, only counts what it does not declare', () => {
        const { topics, counts } = itemTopics(item('NPM::lattice:0.3.50', 'AGPL-3.0-or-later', [
            ['AGPL-3.0-or-later', 'src/App.tsx'], ['AGPL-3.0-only', 'src/App.tsx'], ['AGPL-3.0-only', 'LICENSE', 'licence file'],
            ['GPL-2.0-only', 'src/vendored/x.c'], ['MIT', 'README.md', 'readme or metadata'],
        ], 'project'));
        assert.deepEqual(topics, []);
        // AGPL-3.0-only twice and GPL-2.0-only in code; the README is a mention, -or-later is declared.
        assert.equal(counts.ownCode, 3);
        assert.equal(counts.mentions, 1);
    });

    it('still makes the same finding a topic in a package', () => {
        const { topics, counts } = itemTopics(item('NPM::other:1.0', 'AGPL-3.0-or-later', [['AGPL-3.0-only', 'src/a.js']]));
        // (An AGPL package also makes a declared-licence topic: no permissive choice.)
        assert.deepEqual(topics.filter((t) => t.rule === 'undeclared-licence').map((t) => t.licence), ['AGPL-3.0-only']);
        assert.equal(counts.ownCode, 0);
    });
});

describe('scannedItems and openTopics', () => {
    const result = scanResultWith({
        packages: [
            { id: 'NPM::katex:0.18.10', declared: 'MIT', findings: [['MIT', 'LICENSE'], ['OFL-1.1', 'dist/fonts/KaTeX_Main-Regular.ttf']] },
            { id: 'NPM::khroma:2.1.0', declared: null, findings: [['MIT', 'license']] },
        ],
        projects: [{ id: 'NPM::app:1.0', declared: 'AGPL-3.0-or-later', findings: [['MIT', 'THIRD-PARTY-NOTICES.md'], ['GPL-2.0-only', 'src/vendored/x.c']] }],
        excludes: { paths: [{ pattern: 'THIRD-PARTY-NOTICES.md', reason: 'OTHER' }] },
    });

    it('takes the archive top folder off package paths and applies the product excludes', () => {
        const items = scannedItems(result);
        const katex = items.find((i) => i.id === 'NPM::katex:0.18.10');
        assert.deepEqual(katex.findings.map((f) => [f.path, f.place]), [['LICENSE', 'licence file'], ['dist/fonts/KaTeX_Main-Regular.ttf', 'source']]);
        const app = items.find((i) => i.kind === 'project');
        assert.deepEqual(app.findings.map((f) => f.path), ['src/vendored/x.c']);
    });

    it('lists a project scanned through two package managers once, sorted by severity', () => {
        const cargoView = structuredClone(result);
        cargoView.analyzer.result.projects[0].id = 'Cargo::app:1.0';
        cargoView.scanner.provenances.find((p) => p.package_provenance.vcs_info).id = 'Cargo::app:1.0';
        const { topics, counts } = openTopics([result, cargoView]);
        // The project's vendored GPL file is counted (ownCode), not a topic.
        assert.deepEqual(topics.map((t) => [t.severity, t.name, t.licence]), [
            ['medium', 'khroma', null],
            ['low', 'katex', 'OFL-1.1'],
        ]);
        assert.equal(counts.projects, 1);
        assert.equal(counts.packages, 2);
        assert.equal(counts.ownCode, 1);
    });

    it('keeps copyright statements and file SHA-1s, with the archive top folder off their paths', () => {
        const withCopyrights = structuredClone(result);
        const katexScan = withCopyrights.scanner.scan_results[0];
        katexScan.summary.copyrights = [{ statement: 'Copyright (c) 2013-2020 Khan Academy', location: { path: 'package/LICENSE', start_line: 3, end_line: 3 } }];
        withCopyrights.scanner.files[0].files = [{ path: 'package/LICENSE', sha1: 'abc' }, { path: 'package/dist/x.js' }];
        const katex = scannedItems(withCopyrights).find((i) => i.id === 'NPM::katex:0.18.10');
        assert.deepEqual(katex.copyrights, [{ statement: 'Copyright (c) 2013-2020 Khan Academy', path: 'LICENSE', startLine: 3, endLine: 3 }]);
        assert.deepEqual(katex.sha1, { LICENSE: 'abc' });
        assert.deepEqual(scannedItems(result).find((i) => i.id === 'NPM::khroma:2.1.0').copyrights, []);
    });

    it('refuses a file without a scan result', () => {
        assert.throws(() => scannedItems({ analyzer: { result: {} } }), /not an ORT scan result/);
    });
});
