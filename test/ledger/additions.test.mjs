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

import { ADDITIONS_FORMAT, addedLicences, noticeAdditions, topicFiles } from '../../src/ledger/additions.mjs';

/** A closed package topic decided as `decision` (rule undeclared-licence unless given). */
const topic = (licence, declared, decision, extra = {}) => ({
    id: 'LT-0000000001', kind: 'package', rule: 'undeclared-licence', package: 'Crate::demo:1.0.0',
    licence, declared, status: 'closed',
    decision: { outcome: 'accept-as', licence, rationale: 'R', decidedBy: 'A. Reviewer', date: '2026-10-28', ...decision },
    ...extra,
});

/** A scanned package: findings [licence, path, place, start, end], copyrights [statement, path]. */
const scanned = (id, findings, copyrights = [], sha1 = {}) => ({
    kind: 'package', id,
    findings: findings.map(([licence, path, place = 'source', startLine = 1, endLine = 9]) => ({ licence, path, place, startLine, endLine })),
    copyrights: copyrights.map(([statement, path]) => ({ statement, path, startLine: 1, endLine: 1 })),
    sha1,
});

describe('addedLicences', () => {
    it('adds the licence a decision settles a finding as, when the package does not declare it', () => {
        assert.deepEqual(addedLicences(topic('BSD-2-Clause', 'MIT', {})), ['BSD-2-Clause']);
        assert.deepEqual(
            addedLicences(topic('LicenseRef-x-patent', 'BSD-2-Clause', { licence: 'BSD-2-Clause AND LicenseRef-x-patent' })),
            ['LicenseRef-x-patent']);
    });

    it('adds nothing for a choice out of the declared licence', () => {
        assert.deepEqual(addedLicences(topic('GPL-2.0-or-later', 'Apache-2.0 OR MIT', { licence: 'MIT' })), []);
    });

    it('adds the found licence for comply, unless the package declares it', () => {
        assert.deepEqual(addedLicences(topic('W3C', 'Apache-2.0', { outcome: 'comply', licence: '' })), ['W3C']);
        assert.deepEqual(addedLicences(topic('MPL-2.0', 'MPL-2.0', { outcome: 'comply', licence: '' }, { rule: 'declared-licence' })), []);
    });

    it('adds nothing for an open or reopened topic, a project, not-shipped, or a package without a declared licence', () => {
        assert.deepEqual(addedLicences(topic('ISC', 'MIT', {}, { status: 'reopened' })), []);
        assert.deepEqual(addedLicences(topic('ISC', 'MIT', {}, { status: 'open', decision: null })), []);
        assert.deepEqual(addedLicences(topic('ISC', 'MIT', {}, { kind: 'project' })), []);
        assert.deepEqual(addedLicences(topic('ISC', 'MIT', { outcome: 'not-shipped', licence: '' })), []);
        assert.deepEqual(addedLicences(topic(null, null, { licence: 'MIT' }, { rule: 'no-declared-licence' })), []);
    });
});

describe('topicFiles', () => {
    it('lists the code and licence files carrying the topic licence, lines grouped per file, with their SHA-1', () => {
        const item = scanned('Crate::demo:1.0.0', [
            ['BSD-2-Clause', 'src/b.asm', 'source', 6, 25],
            ['BSD-2-Clause AND LicenseRef-x-patent', 'src/a.asm', 'source', 3, 8],
            ['BSD-2-Clause', 'src/a.asm', 'source', 17, 36],
            ['BSD-2-Clause', 'README.md', 'readme or metadata'],
            ['MIT', 'LICENSE', 'licence file'],
        ], [], { 'src/a.asm': 'aaaa' });
        assert.deepEqual(topicFiles(topic('BSD-2-Clause', 'MIT', {}), item), [
            { path: 'src/a.asm', sha1: 'aaaa', lines: [[3, 8], [17, 36]] },
            { path: 'src/b.asm', sha1: null, lines: [[6, 25]] },
        ]);
    });
});

describe('noticeAdditions', () => {
    const items = [
        scanned('Crate::demo:1.0.0', [['ISC', 'src/x86inc.asm']], [['Copyright (c) x264 project', 'src/x86inc.asm'], ['Copyright Demo', 'src/lib.rs']]),
        scanned('NPM:@scope:pkg:2.0.0', [['Apache-2.0', 'dist/a.js']]),
    ];
    const topics = [
        topic('Apache-2.0', 'MIT', {}, { id: 'LT-0000000002', package: 'NPM:@scope:pkg:2.0.0' }),
        topic('ISC', 'MIT', {}, { id: 'LT-0000000001' }),
        topic('GPL-2.0-only', 'Apache-2.0 OR MIT', { licence: 'MIT' }, { id: 'LT-0000000003' }),
    ];

    it('makes one addition per decision that adds a licence, sorted, with the copyright lines of its files', () => {
        const source = { product: { repository: 'owner/product', ref: 'v1' }, date: '2026-10-28', legattice: null, run: null };
        const out = noticeAdditions(items, topics, source);
        assert.equal(out.format, ADDITIONS_FORMAT);
        assert.deepEqual(out.source, source);
        assert.deepEqual(out.additions.map((a) => a.topic), ['LT-0000000001', 'LT-0000000002']);
        const [demo, scoped] = out.additions;
        assert.deepEqual(demo.package, { id: 'Crate::demo:1.0.0', ecosystem: 'cargo', name: 'demo', version: '1.0.0' });
        assert.deepEqual(demo.licences, ['ISC']);
        assert.deepEqual(demo.copyrights, ['Copyright (c) x264 project']);
        assert.deepEqual(demo.decision, { outcome: 'accept-as', licence: 'ISC', rationale: 'R', decidedBy: 'A. Reviewer', date: '2026-10-28' });
        assert.deepEqual(scoped.package, { id: 'NPM:@scope:pkg:2.0.0', ecosystem: 'npm', name: '@scope/pkg', version: '2.0.0' });
    });

    it('skips a topic whose package the scan did not list', () => {
        assert.deepEqual(noticeAdditions([], topics).additions, []);
    });
});
