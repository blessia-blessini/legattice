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
    applyLedger, blockingTopics, checkEntry, checkLedger, draftEntry, evidenceOf, isDate, LedgerError, OUTCOMES,
} from '../../src/ledger/ledger.mjs';
import { itemTopics, MAX_EVIDENCE } from '../../src/topics/topics.mjs';

/** The topics of one package, as the scan makes them. */
const topicsOf = (id, declared, findings = []) => itemTopics({
    kind: 'package', id, repository: null, declared,
    findings: findings.map(([licence, path]) => ({ licence, path, startLine: 1, endLine: 2, place: 'source' })),
}).topics;

const KHROMA = topicsOf('NPM::khroma:2.1.0', null, [['MIT', 'license']])[0];
const CSSPARSER = topicsOf('Crate::cssparser:0.37.0', 'MPL-2.0')[0];
const DBUS = topicsOf('Crate::libdbus-sys:0.2.7', 'Apache-2.0 OR MIT', [['GPL-2.0-only', 'vendor/dbus/a.c']])[0];

/** A ledger entry deciding `topic`, as a person would write it from the draft. */
function decided(topic, decision = {}) {
    return {
        ...draftEntry(topic),
        decision: {
            outcome: 'comply', licence: '', rationale: 'Reason in words.', decidedBy: 'A. Reviewer',
            date: '2026-10-27', expires: null, ...decision,
        },
    };
}

const ledgerOf = (...entries) => checkLedger(entries.map((entry) => ({ fileName: `${entry.id}.json`, entry })));

describe('isDate', () => {
    it('takes real days in YYYY-MM-DD only', () => {
        assert.equal(isDate('2026-10-27'), true);
        assert.equal(isDate('2028-02-29'), true);
        for (const bad of ['2026-02-30', '2026-13-01', '27.10.2026', '2026-10-27T00:00', '', null]) {
            assert.equal(isDate(bad), false, String(bad));
        }
    });
});

describe('checkEntry', () => {
    it('accepts a decision filled in from a draft, for each outcome', () => {
        assert.deepEqual(checkEntry(decided(KHROMA, { outcome: 'accept-as', licence: 'MIT' }), `${KHROMA.id}.json`), []);
        for (const outcome of Object.keys(OUTCOMES).filter((o) => o !== 'accept-as')) {
            assert.deepEqual(checkEntry(decided(CSSPARSER, { outcome }), `${CSSPARSER.id}.json`), [], outcome);
        }
    });

    it('refuses an unsigned draft: no outcome, rationale, person or day', () => {
        const problems = checkEntry(draftEntry(KHROMA), `${KHROMA.id}.json`);
        assert.ok(problems.some((p) => /"outcome" must be one of/.test(p)), problems.join('\n'));
        assert.ok(problems.some((p) => /"rationale" is missing/.test(p)));
        assert.ok(problems.some((p) => /"decidedBy" is missing/.test(p)));
        assert.ok(problems.some((p) => /"date" must be a day/.test(p)));
    });

    it('ties the file name and the id to the key, so a copied decision closes nothing else', () => {
        const entry = decided(KHROMA);
        assert.ok(checkEntry(entry, `${CSSPARSER.id}.json`).some((p) => /must be named/.test(p)));
        const moved = { ...entry, key: CSSPARSER.key };
        assert.ok(checkEntry(moved, `${KHROMA.id}.json`).some((p) => /"id" must be LT-/.test(p)));
    });

    it('needs a well-formed licence for accept-as, and none for the other outcomes', () => {
        for (const licence of ['', 'MIT licence', 'MIT OR']) {
            assert.ok(checkEntry(decided(KHROMA, { outcome: 'accept-as', licence }), `${KHROMA.id}.json`)
                .some((p) => /needs "licence"/.test(p)), licence);
        }
        assert.ok(checkEntry(decided(CSSPARSER, { outcome: 'comply', licence: 'MPL-2.0' }), `${CSSPARSER.id}.json`)
            .some((p) => /belongs to "accept-as" only/.test(p)));
    });

    it('names unknown fields (typos) and checks the expiry day', () => {
        const typo = { ...decided(KHROMA), decison: {} };
        assert.ok(checkEntry(typo, `${KHROMA.id}.json`).includes('unknown field "decison"'));
        const early = decided(KHROMA, { expires: '2026-10-01' });
        assert.ok(checkEntry(early, `${KHROMA.id}.json`).some((p) => /"expires" must come after "date"/.test(p)));
        assert.deepEqual(checkEntry(['not', 'an', 'object'], 'x.json'), ['not a JSON object']);
    });
});

describe('checkLedger', () => {
    it('lists every problem of every file in one error', () => {
        const files = [
            { fileName: 'LT-0000000000.json', error: 'Unexpected token' },
            { fileName: `${KHROMA.id}.json`, entry: draftEntry(KHROMA) },
            { fileName: `${CSSPARSER.id}.json`, entry: decided(CSSPARSER) },
        ];
        assert.throws(() => checkLedger(files), (e) => e instanceof LedgerError
            && /LT-0000000000\.json: not readable JSON/.test(e.message)
            && e.problems.filter((p) => p.startsWith(`${KHROMA.id}.json:`)).length >= 4
            && !e.message.includes(`${CSSPARSER.id}.json`));
    });
});

describe('applyLedger', () => {
    const TODAY = '2026-10-27';

    it('leaves a topic without a decision open, and closes one with the same evidence', () => {
        const { topics, statusCounts } = applyLedger([KHROMA, CSSPARSER], ledgerOf(decided(CSSPARSER)), TODAY);
        assert.deepEqual(topics.map((t) => [t.name, t.status]), [['khroma', 'open'], ['cssparser', 'closed']]);
        assert.equal(topics[1].decision.decidedBy, 'A. Reviewer');
        assert.deepEqual(statusCounts, { reopened: 0, 'pending-removal': 0, open: 1, closed: 1 });
    });

    it('reopens a topic when its package is updated, saying what changed', () => {
        const newer = topicsOf('Crate::libdbus-sys:0.2.8', 'Apache-2.0 OR MIT', [['GPL-2.0-only', 'vendor/dbus/a.c'], ['GPL-2.0-only', 'vendor/dbus/b.c']])[0];
        assert.equal(newer.key, DBUS.key);
        const [t] = applyLedger([newer], ledgerOf(decided(DBUS, { outcome: 'not-shipped' })), TODAY).topics;
        assert.equal(t.status, 'reopened');
        assert.match(t.reasons[0], /Crate::libdbus-sys:0\.2\.7 -> Crate::libdbus-sys:0\.2\.8/);
        assert.match(t.reasons[0], /1 new finding\(s\)/);
    });

    it('notices a change beyond the evidence lines a ledger file keeps', () => {
        const many = (extra) => topicsOf('Crate::x:1', 'MIT', [
            ...Array.from({ length: MAX_EVIDENCE + 1 }, (_, i) => ['GPL-2.0-only', `src/f${String(i).padStart(2, '0')}.c`]),
            ['GPL-2.0-only', extra],
        ])[0];
        const before = many('src/zz-old.c');
        const after = many('src/zz-new.c');
        assert.deepEqual(evidenceOf(before).lines, evidenceOf(after).lines);
        const [t] = applyLedger([after], ledgerOf(decided(before)), TODAY).topics;
        assert.equal(t.status, 'reopened');
        assert.match(t.reasons[0], /beyond the first 20/);
    });

    it('reopens a decision on the day it expires', () => {
        const entry = decided(CSSPARSER, { date: '2026-01-15', expires: TODAY });
        const [t] = applyLedger([CSSPARSER], ledgerOf(entry), TODAY).topics;
        assert.deepEqual([t.status, t.reasons], ['reopened', [`decision expired on ${TODAY}`]]);
        assert.equal(applyLedger([CSSPARSER], ledgerOf(entry), '2026-10-26').topics[0].status, 'closed');
    });

    it('keeps a "remove" decision pending while the component is still found, and reports it gone after', () => {
        const entries = ledgerOf(decided(DBUS, { outcome: 'remove' }));
        assert.equal(applyLedger([DBUS], entries, TODAY).topics[0].status, 'pending-removal');
        const { topics, gone } = applyLedger([], entries, TODAY);
        assert.deepEqual(topics, []);
        assert.deepEqual(gone.map((g) => [g.id, g.decision.outcome]), [[DBUS.id, 'remove']]);
    });
});

describe('draftEntry', () => {
    it('drafts a new topic blank, and a reopened one from its decision, unsigned', () => {
        const fresh = draftEntry({ ...KHROMA, decision: null });
        assert.deepEqual(fresh.decision, { outcome: '', licence: '', rationale: '', decidedBy: '', date: '', expires: null });
        assert.equal(fresh.evidence.hash, KHROMA.evidenceHash);
        const again = draftEntry({ ...KHROMA, decision: decided(KHROMA, { outcome: 'accept-as', licence: 'MIT' }).decision });
        assert.deepEqual([again.decision.outcome, again.decision.licence, again.decision.decidedBy, again.decision.date],
            ['accept-as', 'MIT', '', '']);
    });
});

describe('blockingTopics', () => {
    const topics = applyLedger([KHROMA, CSSPARSER, DBUS], ledgerOf(decided(DBUS)), '2026-10-27').topics;

    it('blocks on undecided topics at or above the level, never on closed ones', () => {
        assert.deepEqual(blockingTopics(topics, 'none'), []);
        assert.deepEqual(blockingTopics(topics, 'high'), []); // DBUS (high) is closed
        assert.deepEqual(blockingTopics(topics, 'medium').map((t) => t.name).sort(), ['cssparser', 'khroma']);
        assert.throws(() => blockingTopics(topics, 'urgent'), RangeError);
    });
});
