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

import { applyLedger, checkLedger, draftEntry, emptyLedger } from '../../src/ledger/ledger.mjs';
import { renderTopics } from '../../src/ledger/report.mjs';
import { itemTopics } from '../../src/topics/topics.mjs';

const topicOf = (id, declared, findings = []) => itemTopics({
    kind: 'package', id, repository: null, declared,
    findings: findings.map(([licence, path]) => ({ licence, path, startLine: 1, endLine: 2, place: 'source' })),
}).topics[0];

const sign = (topic, outcome, extra = {}) => ({
    ...draftEntry(topic),
    decision: { outcome, licence: '', rationale: 'Why.', decidedBy: 'A. Reviewer', date: '2026-10-20', expires: null, ...extra },
});

const COUNTS = { packages: 5, projects: 1, mentions: 7, unidentified: 3 };
const KHROMA = topicOf('NPM::khroma:2.1.0', null, [['MIT', 'license']]);
const CSSPARSER = topicOf('Crate::cssparser:0.37.0', 'MPL-2.0');
const MERMAID = topicOf('NPM::mermaid:11.17.2', 'MIT', [['GPL-2.0-only', 'dist/a.js'], ['GPL-2.0-only', 'dist/b.js']]);
const GTK = topicOf('Crate::gtk:0.18.2', 'MIT', [['LGPL-2.0-or-later', 'COPYRIGHT']]);
const OLD = topicOf('NPM::left:1.0.0', 'MPL-2.0');

function report(limit) {
    const entries = checkLedger([
        sign(CSSPARSER, 'comply'),
        sign(GTK, 'remove'),
        sign(topicOf('NPM::mermaid:11.17.1', 'MIT', [['GPL-2.0-only', 'dist/a.js']]), 'not-shipped'),
        sign(OLD, 'accept-as', { licence: 'MIT' }),
        draftEntry(KHROMA), // unsigned: being worked on
    ].map((entry) => ({ fileName: `${entry.id}.json`, entry })));
    return renderTopics({ counts: COUNTS, ...applyLedger([MERMAID, KHROMA, GTK, CSSPARSER], entries, '2026-10-27') }, { limit });
}

describe('renderTopics', () => {
    it('counts what is to decide and what the ledger closed', () => {
        const md = report();
        assert.match(md, /^## Open topics/);
        assert.match(md, /4 topic\(s\) in 5 package\(s\) and 1 project\(s\)\. \*\*To decide: 3\*\* \(1 reopened, 1 pending removal, 1 open: 0 high, 1 medium, 0 low\)\. Unsigned drafts in the ledger for 1 of them\. Closed by the ledger: 1\./);
        assert.match(md, new RegExp(`\\| ${KHROMA.id} \\(draft\\) \\| khroma 2\\.1\\.0 declares no licence`));
        assert.match(md, /not legal advice/);
        // Counts from before ownCode existed read as 0, never "undefined".
        assert.match(md, /; 0 finding\(s\) of other licences in the product's own code, not checked \(docs\/topics\.md\)\./);
    });

    it('reports the own-code findings it does not check', () => {
        const md = renderTopics({ counts: { ...COUNTS, ownCode: 29 }, ...applyLedger([KHROMA], emptyLedger(), '2026-10-27') });
        assert.match(md, /; 29 finding\(s\) of other licences in the product's own code, not checked/);
    });

    it('lists reopened topics first, with the reason, then removals, open ones, closed ones, and gone decisions', () => {
        const md = report();
        const order = ['### reopened (1)', '### pending removal (1)', '### medium (1)', '### closed (1)', '### decisions not found (1)']
            .map((h) => md.indexOf(h));
        assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), md);
        assert.match(md, new RegExp(`\\| ${MERMAID.id} \\| high \\| .*\\| evidence changed: NPM::mermaid:11\\.17\\.1 -> NPM::mermaid:11\\.17\\.2`));
        assert.match(md, new RegExp(`\\| ${CSSPARSER.id} \\| .* \\| comply, A\\. Reviewer, 2026-10-20 \\|`));
        assert.match(md, new RegExp(`\\| ${OLD.id} \\| .* \\| accept-as MIT, A\\. Reviewer, 2026-10-20 \\|`));
    });

    it('cuts each section at the limit, pointing to the file', () => {
        const many = Array.from({ length: 3 }, (_, i) => topicOf(`NPM::p${i}:1`, 'MPL-2.0'));
        const md = renderTopics({ counts: COUNTS, ...applyLedger(many, emptyLedger(), '2026-10-27') }, { limit: 1 });
        assert.match(md, /### medium \(3\)/);
        assert.match(md, /\| … \| 2 more in topics\.md \| \|/);
    });
});
