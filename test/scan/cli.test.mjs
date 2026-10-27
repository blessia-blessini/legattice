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

//**************************************************************
// The workflow's steps end to end, in a temporary folder:
// managers -> plan -> shard (each) -> timings, on two package
// managers, as scan.yml runs them.
//**************************************************************

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { BlockedError, main, UsageError } from '../../src/scan/cli.mjs';
import {
    analyzerResult, artifactProvenance, pkg, project, REPO, repositoryProvenance, REVISION, scanResult,
} from './fixtures.mjs';

const MB = 1e6;
const CARGO_PACKAGES = ['Crate::serde:1', 'Crate::tokio:1', 'Crate::vendored:1'];
const NPM_PACKAGES = ['NPM::mermaid:11', 'NPM::katex:0.18', 'NPM::excluded:1'];
const SIZES = {
    'Crate::serde:1': 0.1 * MB, 'Crate::tokio:1': 0.8 * MB, 'NPM::mermaid:11': 17.8 * MB, 'NPM::katex:0.18': 1.5 * MB,
    'NPM::excluded:1': 0.2 * MB,
};
const urlOf = (id) => (id === 'Crate::vendored:1' ? null : `https://registry.example.org/${id}.tgz`);

let dir;
const at = (...parts) => path.join(dir, ...parts);
const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const quiet = { log: () => {}, env: {} };
const fakeProbe = async (urls) => new Map(urls.map((u) => [u, SIZES[u.slice(u.lastIndexOf('/') + 1, -4)] ?? null]));

before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legattice-cli-'));
    const packages = (ids) => ids.map((id) => pkg(id, { url: urlOf(id) }));
    write(at('analyzer', 'Cargo', 'analyzer-result.json'),
        analyzerResult({ projects: [project('Cargo::app:1')], packages: packages(CARGO_PACKAGES) }));
    write(at('analyzer', 'NPM', 'analyzer-result.json'),
        analyzerResult({ projects: [project('NPM::app:1')], packages: packages(NPM_PACKAGES) }));
    write(at('dry-run.txt'), 'Found in total 2 definition file(s) from the following 2 package manager(s):\n\tCargo, NPM\n');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('scan workflow steps', () => {
    it('config: writes the ORT configuration', async () => {
        await main(['config', '--manager', 'NPM', '--out', at('config-NPM.yml')], quiet);
        assert.match(fs.readFileSync(at('config-NPM.yml'), 'utf8'), /enabledPackageManagers: \[NPM\]/);
    });

    it('managers: from the dry run, or from a list given by hand', async () => {
        await main(['managers', '--dry-run', at('dry-run.txt'), '--out', at('managers.txt')], quiet);
        assert.equal(fs.readFileSync(at('managers.txt'), 'utf8'), 'Cargo\nNPM\n');
        await main(['managers', '--list', 'NPM,Cargo', '--out', at('managers-list.txt')], quiet);
        assert.equal(fs.readFileSync(at('managers-list.txt'), 'utf8'), 'Cargo\nNPM\n');
    });

    it('managers: refuses to go on with nothing to scan', async () => {
        write(at('empty-dry-run.txt'), 'No definition files found.\n');
        await assert.rejects(main(['managers', '--dry-run', at('empty-dry-run.txt'), '--out', at('m.txt')], quiet),
            (e) => e instanceof UsageError && /nothing to scan/.test(e.message));
        await assert.rejects(main(['managers', '--out', at('m.txt')], quiet), /either --dry-run or --list/);
    });

    it('plan: writes the plan, the job summary and the shard list', async () => {
        const env = { GITHUB_OUTPUT: at('github-output.txt'), GITHUB_STEP_SUMMARY: at('summary.md') };
        await main(['plan', '--analyzer-dir', at('analyzer'), '--managers', at('managers.txt'), '--max-shards', '16',
            '--timings', at('no-timings-yet.json'), '--out', at('plan.json')], { ...quiet, env, probe: fakeProbe });
        const plan = read(at('plan.json'));
        assert.equal(plan.units.length, CARGO_PACKAGES.length + NPM_PACKAGES.length + 1);
        const shards = plan.shards.map((s) => s.index);
        assert.equal(fs.readFileSync(at('github-output.txt'), 'utf8'), `shards=${JSON.stringify(shards)}\n`);
        assert.match(fs.readFileSync(at('summary.md'), 'utf8'), /## Scan plan/);
        assert.equal(plan.units.find((u) => u.id === 'NPM::mermaid:11').bytes, 17.8 * MB);
        assert.equal(plan.units.find((u) => u.id === 'Crate::vendored:1').basis, 'unknown');
    });

    it('shard: every package is scanned by exactly one shard, the projects by one', async () => {
        const plan = read(at('plan.json'));
        const scannedBy = new Map();
        const projectRuns = [];
        for (const { index } of plan.shards) {
            const out = at('shard', String(index));
            await main(['shard', '--plan', at('plan.json'), '--index', String(index), '--analyzer-dir', at('analyzer'),
                '--out-dir', out], quiet);
            for (const line of fs.readFileSync(path.join(out, 'runs.tsv'), 'utf8').trim().split('\n')) {
                const [manager, types] = line.split('\t');
                assert.match(types, /^(PROJECT,PACKAGE|PROJECT|PACKAGE)$/);
                if (types.includes('PROJECT')) projectRuns.push([index, manager]);
                for (const p of read(path.join(out, `${manager}.json`)).analyzer.result.packages) {
                    if (p.source_code_origins?.length === 0) continue;
                    assert.ok(!scannedBy.has(p.id), `${p.id} in two shards`);
                    scannedBy.set(p.id, index);
                }
            }
        }
        assert.deepEqual([...scannedBy.keys()].sort(), [...CARGO_PACKAGES, ...NPM_PACKAGES].sort());
        assert.equal(new Set(projectRuns.map(([index]) => index)).size, 1);
        assert.deepEqual(projectRuns.map(([, m]) => m).sort(), ['Cargo', 'NPM']);
    });

    it('timings: records what was scanned and reports what the merge job had to scan itself', async () => {
        const scans = (ids, freshId) => ids.filter((id) => id !== 'NPM::excluded:1').map((id) => ({
            id,
            provenance: urlOf(id) ? artifactProvenance(urlOf(id)) : repositoryProvenance(`https://example.org/${id}.git`, 'v1'),
            start: id === freshId ? 10 : -600,
            end: id === freshId ? 70 : -590,
        }));
        const projectScan = (id) => ({ id, provenance: repositoryProvenance(REPO, REVISION), start: -900, end: -713 });
        write(at('scanner', 'Cargo', 'scan-result.json'), scanResult({
            projects: [project('Cargo::app:1')], packages: CARGO_PACKAGES.map((id) => pkg(id)),
            scans: [projectScan('Cargo::app:1'), ...scans(CARGO_PACKAGES, 'Crate::tokio:1')],
        }));
        write(at('scanner', 'NPM', 'scan-result.json'), scanResult({
            projects: [project('NPM::app:1')], packages: NPM_PACKAGES.map((id) => pkg(id)),
            scans: [projectScan('NPM::app:1'), ...scans(NPM_PACKAGES)],
        }));
        const env = { GITHUB_STEP_SUMMARY: at('timings-summary.md') };
        await main(['timings', '--scanner-dir', at('scanner'), '--managers', at('managers.txt'), '--plan', at('plan.json'),
            '--timings', at('no-timings-yet.json'), '--out', at('timings', 'timings.json'), '--today', '2026-10-26'],
        { ...quiet, env });
        const timings = read(at('timings', 'timings.json'));
        assert.deepEqual(timings.units['NPM::mermaid:11'], { seconds: 10, bytes: 17.8 * MB, seen: '2026-10-26' });
        assert.deepEqual(timings.units['NPM::excluded:1'], { seconds: 0, bytes: 0.2 * MB, seen: '2026-10-26' });
        assert.deepEqual(timings.units[`project:${REPO}`], { seconds: 187, revision: REVISION, seen: '2026-10-26' });
        assert.match(fs.readFileSync(at('timings-summary.md'), 'utf8'), /\*\*1 result\(s\) were scanned by this merge job\*\*/);
    });

    it('plan: the next run counts stored units as lookups', async () => {
        await main(['plan', '--analyzer-dir', at('analyzer'), '--managers', at('managers.txt'), '--max-shards', '16',
            '--timings', at('timings', 'timings.json'), '--out', at('plan-2.json')], { ...quiet, probe: fakeProbe });
        const plan = read(at('plan-2.json'));
        assert.ok(plan.units.every((u) => u.basis === 'stored'), JSON.stringify(plan.units.map((u) => [u.key, u.basis])));
        assert.equal(plan.shards.length, 1);
    });

    it('topics: lists what a person must decide, in a file and the job summary', async () => {
        const env = { GITHUB_STEP_SUMMARY: at('topics-summary.md') };
        await main(['topics', '--scanner-dir', at('scanner'), '--managers', at('managers.txt'), '--out-dir', at('topics')],
            { ...quiet, env });
        const { topics } = read(at('topics', 'topics.json'));
        // The fixture packages declare no licence: one topic each, for those ORT scanned.
        const scanned = [...CARGO_PACKAGES, ...NPM_PACKAGES].filter((id) => id !== 'NPM::excluded:1');
        assert.deepEqual(topics.map((t) => t.package).sort(), scanned.sort());
        assert.ok(topics.every((t) => t.rule === 'no-declared-licence'));
        assert.ok(topics.every((t) => t.status === 'open'));
        assert.match(fs.readFileSync(at('topics', 'topics.md'), 'utf8'), /^## Open topics/);
        assert.match(fs.readFileSync(at('topics-summary.md'), 'utf8'), /5 topic\(s\) .* \*\*To decide: 5\*\*/);
        // One draft per undecided topic, named by severity, status and id.
        assert.deepEqual(fs.readdirSync(at('topics', 'drafts')).sort(), topics.map((t) => `2-medium.open.${t.id}.json`).sort());
    });

    it('topics: a decision filled in from its draft closes the topic; the rest can block', async () => {
        const { topics } = read(at('topics', 'topics.json'));
        const chosen = topics.find((t) => t.package === 'NPM::katex:0.18');
        const draftName = `2-medium.open.${chosen.id}.json`;
        const entry = read(at('topics', 'drafts', draftName));
        entry.decision = { ...entry.decision, outcome: 'accept-as', licence: 'MIT', rationale: 'Its files say MIT.',
            decidedBy: 'A. Reviewer', date: '2026-10-27' };
        write(at('ledger', draftName), entry); // copied as it is, label and all
        write(at('ledger', 'README.md'), 'not a decision');
        const argv = ['topics', '--scanner-dir', at('scanner'), '--managers', at('managers.txt'), '--out-dir', at('topics-2'),
            '--ledger', at('ledger'), '--today', '2026-10-28'];

        await assert.rejects(main([...argv, '--block-at', 'medium'], quiet), BlockedError);
        // Written before failing: the run still shows what is left.
        const after = read(at('topics-2', 'topics.json'));
        assert.equal(after.statusCounts.closed, 1);
        assert.equal(after.topics.find((t) => t.id === chosen.id).status, 'closed');
        assert.ok(!fs.readdirSync(at('topics-2', 'drafts')).some((n) => n.includes(chosen.id)));
        assert.equal(fs.readdirSync(at('topics-2', 'drafts')).length, 4);

        await main([...argv, '--block-at', 'high'], quiet); // the fixture's topics are medium
    });

    it('topics: all drafts copied into the ledger at once are work in progress, not errors', async () => {
        fs.mkdirSync(at('wip-ledger'));
        for (const name of fs.readdirSync(at('topics', 'drafts'))) {
            fs.copyFileSync(at('topics', 'drafts', name), at('wip-ledger', name));
        }
        const logged = [];
        await main(['topics', '--scanner-dir', at('scanner'), '--managers', at('managers.txt'), '--out-dir', at('topics-5'),
            '--ledger', at('wip-ledger')], { ...quiet, log: (l) => logged.push(l) });
        assert.ok(logged.includes(`ledger ${at('wip-ledger')}: 0 decision(s), 5 unsigned draft(s)`), logged.join('\n'));
        const { statusCounts } = read(at('topics-5', 'topics.json'));
        assert.deepEqual([statusCounts.open, statusCounts.drafting, statusCounts.closed], [5, 5, 0]);
    });

    it('topics: refuses a ledger with a bad file, naming the file and the problem', async () => {
        write(at('bad-ledger', 'LT-0000000000.json'), '{ "format": 1,');
        await assert.rejects(
            main(['topics', '--scanner-dir', at('scanner'), '--managers', at('managers.txt'), '--out-dir', at('topics-3'),
                '--ledger', at('bad-ledger')], quiet),
            (e) => e instanceof UsageError && /LT-0000000000\.json: not readable JSON/.test(e.message));
        assert.equal(fs.existsSync(at('topics-3')), false);
    });

    it('topics: a missing ledger folder is an empty ledger', async () => {
        const logged = [];
        await main(['topics', '--scanner-dir', at('scanner'), '--managers', at('managers.txt'), '--out-dir', at('topics-4'),
            '--ledger', at('no-ledger-here')], { ...quiet, log: (l) => logged.push(l) });
        assert.ok(logged.some((l) => /does not exist: no decisions yet/.test(l)));
        assert.equal(read(at('topics-4', 'topics.json')).statusCounts.open, 5);
    });

    it('rejects unknown commands, options and bad numbers as usage errors', async () => {
        for (const argv of [[], ['frobnicate'], ['config', '--bogus', 'x'], ['config'],
            ['plan', '--analyzer-dir', 'a', '--managers', 'm', '--max-shards', 'many', '--out', 'o'],
            ['shard', '--plan', 'p', '--index', '0', '--analyzer-dir', 'a', '--out-dir', 'o'],
            ['config', '--out', 'x', 'extra'],
            ['topics', '--scanner-dir', 's', '--managers', 'm', '--out-dir', 'o', '--block-at', 'urgent'],
            ['topics', '--scanner-dir', 's', '--managers', 'm', '--out-dir', 'o', '--today', '28.10.2026']]) {
            await assert.rejects(main(argv, quiet), UsageError, argv.join(' '));
        }
    });
});
