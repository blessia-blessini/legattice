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
    calibrate, DEFAULT_MODEL, estimateUnit, FORMAT, MIN_SAMPLES, MIN_SHARD_SECONDS, mergeTimings, packShards, planScan,
    projectTimingsKey, renderPlanSummary, shardRuns, STORED_SECONDS, TIMINGS_MAX_AGE_DAYS, UNKNOWN_SECONDS,
} from '../../src/scan/plan.mjs';
import { REPO, REVISION } from './fixtures.mjs';

const MB = 1e6;
const pkgUnit = (manager, id, url = `https://r/${id}.tgz`) => ({ key: `package:${manager}:${id}`, kind: 'package', manager, id, url });
const projectUnit = (managers, repos = [{ url: REPO, revision: REVISION }]) =>
    ({ key: `project:${repos.map((r) => `${r.url}@${r.revision}`).join(' ')}`, kind: 'project', managers, repos });
const none = { timings: null, sizes: new Map(), models: new Map() };

describe('estimateUnit', () => {
    it('estimates a package from its archive size with the default model', () => {
        const unit = pkgUnit('NPM', 'NPM::mermaid:11');
        const e = estimateUnit(unit, { ...none, sizes: new Map([[unit.url, 17.8 * MB]]) });
        assert.deepEqual(e, { seconds: Math.round(DEFAULT_MODEL.overheadSeconds + DEFAULT_MODEL.secondsPerMB * 17.8), basis: 'size', bytes: 17.8 * MB });
    });

    it('uses the measured model of the package type when there is one', () => {
        const unit = pkgUnit('Cargo', 'Crate::tokio:1');
        const models = new Map([['Crate', { overheadSeconds: 5, secondsPerMB: 10 }]]);
        assert.equal(estimateUnit(unit, { ...none, models, sizes: new Map([[unit.url, 2 * MB]]) }).seconds, 25);
    });

    it('counts a package scanned before as a lookup', () => {
        const unit = pkgUnit('NPM', 'NPM::a:1');
        const timings = { units: { 'NPM::a:1': { seconds: 99, bytes: 5, seen: '2026-10-26' } } };
        assert.deepEqual(estimateUnit(unit, { ...none, timings }), { seconds: STORED_SECONDS, basis: 'stored', bytes: 5 });
    });

    it('is pessimistic about a package of unknown size', () => {
        assert.deepEqual(estimateUnit(pkgUnit('GoMod', 'Go::x:1', null), none), { seconds: UNKNOWN_SECONDS, basis: 'unknown', bytes: null });
        const unit = pkgUnit('NPM', 'NPM::gone:1');
        assert.equal(estimateUnit(unit, { ...none, sizes: new Map([[unit.url, null]]) }).basis, 'unknown');
    });

    it('estimates a project from the last scan of its repository', () => {
        const key = projectTimingsKey(REPO);
        const same = { units: { [key]: { seconds: 187, revision: REVISION } } };
        const older = { units: { [key]: { seconds: 187, revision: 'older' } } };
        assert.deepEqual(estimateUnit(projectUnit(['NPM']), { ...none, timings: same }), { seconds: STORED_SECONDS, basis: 'stored', bytes: null });
        assert.deepEqual(estimateUnit(projectUnit(['NPM']), { ...none, timings: older }), { seconds: 187, basis: 'measured', bytes: null });
        assert.deepEqual(estimateUnit(projectUnit(['NPM']), none), { seconds: UNKNOWN_SECONDS, basis: 'unknown', bytes: null });
    });

    it('adds up a project group over its repositories, with the weakest basis', () => {
        const repos = [{ url: REPO, revision: REVISION }, { url: 'https://example.org/sub.git', revision: 'r' }];
        const timings = { units: { [projectTimingsKey(REPO)]: { seconds: 1, revision: REVISION } } };
        assert.deepEqual(estimateUnit(projectUnit(['Unmanaged'], repos), { ...none, timings }),
            { seconds: STORED_SECONDS + UNKNOWN_SECONDS, basis: 'unknown', bytes: null });
    });
});

describe('calibrate', () => {
    const entries = (type, n, seconds, bytes) =>
        Object.fromEntries(Array.from({ length: n }, (_, i) => [`${type}::p${i}:1`, { seconds, bytes }]));

    it('fits seconds per MB per package type once there are enough measurements', () => {
        const models = calibrate({ units: { ...entries('Crate', MIN_SAMPLES, 25, 2 * MB), ...entries('NPM', MIN_SAMPLES - 1, 99, MB) } });
        assert.deepEqual([...models.keys()], ['Crate']);
        assert.equal(models.get('Crate').secondsPerMB, 10);
    });

    it('ignores projects, unscanned packages and entries without a size', () => {
        const units = {
            ...entries('NPM', MIN_SAMPLES, 0, MB),
            ...entries('Go', MIN_SAMPLES, 50, null),
            [projectTimingsKey(REPO)]: { seconds: 187, bytes: MB },
        };
        assert.equal(calibrate({ units }).size, 0);
        assert.equal(calibrate(null).size, 0);
    });
});

describe('packShards', () => {
    const units = (...seconds) => seconds.map((s, i) => ({ key: `u${String(i).padStart(2, '0')}`, seconds: s }));

    it('balances by putting the longest unit first into the least loaded shard', () => {
        const shards = packShards(units(700, 600, 500, 400, 300, 200, 100), 3);
        assert.deepEqual(shards.map((s) => s.seconds), [1000, 900, 900]);
        assert.deepEqual(shards.map((s) => s.units), [['u00', 'u05', 'u06'], ['u01', 'u04'], ['u02', 'u03']]);
    });

    it('never makes more shards than units, or than the work is worth', () => {
        assert.equal(packShards(units(10_000, 10_000), 16).length, 2);
        assert.equal(packShards(units(...Array(100).fill(STORED_SECONDS)), 16).length, 1);
        const stored = Array.from({ length: 908 }, (_, i) => ({ key: `s${i}`, seconds: STORED_SECONDS, basis: 'stored' }));
        assert.equal(packShards(stored, 16).length, 1, 'lookups are not work');
        assert.equal(packShards([...stored, { key: 'new', seconds: 2 * MIN_SHARD_SECONDS, basis: 'size' }], 16).length, 2);
        assert.equal(packShards(units(...Array(10).fill(MIN_SHARD_SECONDS)), 16).length, 10);
        assert.deepEqual(packShards([], 16), []);
    });

    it('gives the same plan for the same input in any order', () => {
        const a = packShards(units(5, 5, 5, 5, 400, 400), 2);
        const b = packShards(units(5, 5, 5, 5, 400, 400).reverse(), 2);
        assert.deepEqual(a, b);
    });

    it('refuses a shard count below one', () => {
        for (const bad of [0, -1, 1.5, NaN]) assert.throws(() => packShards(units(1), bad), /bad shard count/);
    });
});

describe('planScan and shardRuns', () => {
    const units = [
        pkgUnit('NPM', 'NPM::big:1'),
        pkgUnit('NPM', 'NPM::small:1'),
        pkgUnit('Cargo', 'Crate::serde:1'),
        projectUnit(['Cargo', 'NPM']),
    ];
    const sizes = new Map([['https://r/NPM::big:1.tgz', 20 * MB], ['https://r/NPM::small:1.tgz', MB], ['https://r/Crate::serde:1.tgz', MB]]);
    const plan = planScan({ units, sizes, maxShards: 16 });

    it('assigns every unit to exactly one shard', () => {
        assert.equal(plan.format, FORMAT);
        assert.ok(plan.units.every((u) => plan.shards.some((s) => s.index === u.shard)));
        assert.equal(plan.shards.reduce((n, s) => n + s.unitCount, 0), units.length);
        assert.equal(plan.longestUnitSeconds, 865);
        assert.equal(plan.totalSeconds, plan.shards.reduce((n, s) => n + s.seconds, 0));
    });

    it('tells each shard which ORT scans to run', () => {
        const all = plan.shards.flatMap((s) => shardRuns(plan, s.index).map((r) => ({ shard: s.index, ...r })));
        const npmIds = all.filter((r) => r.manager === 'NPM').flatMap((r) => r.packageIds).sort();
        assert.deepEqual(npmIds, ['NPM::big:1', 'NPM::small:1']);
        const projectShard = plan.units.find((u) => u.kind === 'project').shard;
        const projectRuns = all.filter((r) => r.packageTypes.includes('PROJECT'));
        assert.deepEqual(projectRuns.map((r) => [r.shard, r.manager]), [[projectShard, 'Cargo'], [projectShard, 'NPM']]);
        for (const run of all) {
            assert.equal(run.packageTypes.includes('PACKAGE'), run.packageIds.length > 0);
        }
    });

    it('refuses a shard the plan does not have, or a file that is no plan', () => {
        assert.throws(() => shardRuns(plan, 99), /no shard 99/);
        assert.throws(() => shardRuns({ format: 0, units: [] }, 1), /not a scan plan/);
    });

    it('renders a summary naming shards and the longest units', () => {
        const md = renderPlanSummary(plan);
        assert.match(md, /^## Scan plan/);
        assert.match(md, /4 work units/);
        assert.match(md, /\| NPM::big:1 \| 14\.4 min \| size \|/);
        assert.match(md, /project \(Cargo, NPM\)/);
    });
});

describe('mergeTimings', () => {
    const plan = { units: [{ kind: 'package', id: 'NPM::a:1', bytes: 1234 }] };
    const measured = [{ packages: { 'NPM::a:1': { seconds: 4 }, 'NPM::x:1': { seconds: 0 } }, projects: { [REPO]: { seconds: 187, revision: REVISION } } }];

    it('records seconds, archive size and the day seen', () => {
        const t = mergeTimings({ measured, plan, today: '2026-10-26' });
        assert.deepEqual(t, {
            format: FORMAT,
            units: {
                'NPM::a:1': { seconds: 4, bytes: 1234, seen: '2026-10-26' },
                'NPM::x:1': { seconds: 0, bytes: null, seen: '2026-10-26' },
                [projectTimingsKey(REPO)]: { seconds: 187, revision: REVISION, seen: '2026-10-26' },
            },
        });
    });

    it('keeps recent entries of earlier runs and drops old ones', () => {
        const previous = { units: {
            'NPM::recent:1': { seconds: 9, bytes: 1, seen: '2026-10-01' },
            'NPM::old:1': { seconds: 9, bytes: 1, seen: '2026-01-01' },
            'NPM::undated:1': { seconds: 9, bytes: 1 },
            'NPM::a:1': { seconds: 99, bytes: 777, seen: '2026-10-01' },
        } };
        const t = mergeTimings({ previous, measured, plan: { units: [] }, today: '2026-10-26' });
        assert.ok('NPM::recent:1' in t.units);
        assert.ok(!('NPM::old:1' in t.units), `older than ${TIMINGS_MAX_AGE_DAYS} days`);
        assert.ok(!('NPM::undated:1' in t.units));
        assert.deepEqual(t.units['NPM::a:1'], { seconds: 4, bytes: 777, seen: '2026-10-26' });
    });

    it('refuses a bad date', () => {
        assert.throws(() => mergeTimings({ measured: [], plan, today: 'today' }), /bad date/);
    });
});
