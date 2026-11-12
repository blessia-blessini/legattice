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
// The store steps of the scan workflow, as scan.yml runs them:
// the broker's store-find and store-use, the merge job's
// store-meta -- and the next run taking up that store.
//**************************************************************

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { main, UsageError } from '../../src/scan/cli.mjs';
import { SCANCODE_OPTIONS } from '../../src/scan/ort-config.mjs';
import { REASONS, STORE_ARTIFACT } from '../../src/scan/store.mjs';

const NOW = '2026-11-12T09:30:00.000Z';
const REPOSITORY = 'owner/product';

let dir;
const at = (...parts) => path.join(dir, ...parts);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const text = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

/** Fresh GitHub output and summary files, the log, and the dependencies for main. */
function harness(name, { api = null } = {}) {
    const logged = [];
    const env = {
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_OUTPUT: at(`${name}-output.txt`),
        GITHUB_STEP_SUMMARY: at(`${name}-summary.md`),
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '500',
    };
    return {
        logged,
        env,
        output: () => text(env.GITHUB_OUTPUT),
        summary: () => text(env.GITHUB_STEP_SUMMARY),
        deps: { env, log: (l) => logged.push(l), now: () => NOW, github: api },
    };
}

/** A GitHub API with one store, made by push run 300. */
const oneStore = async (route) => (route.includes('/actions/artifacts')
    ? { artifacts: [{ id: 9, name: STORE_ARTIFACT, expired: false, created_at: '2026-11-08T23:10:00Z',
        workflow_run: { id: 300, repository_id: 1, head_repository_id: 1, head_branch: 'v0.3.57' } }] }
    : { event: 'push', head_branch: 'v0.3.57', html_url: `https://github.com/${REPOSITORY}/actions/runs/300` });

/** A store as download-artifact leaves it: cache/, timings/ and store.json. */
function downloadedStore(name, description) {
    fs.mkdirSync(at(name, 'cache', 'scan-results'), { recursive: true });
    fs.mkdirSync(at(name, 'timings'), { recursive: true });
    fs.writeFileSync(at(name, 'timings', 'timings.json'), JSON.stringify({ format: 1, units: {} }));
    if (description !== undefined) fs.writeFileSync(at(name, 'store.json'), JSON.stringify(description));
}

before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legattice-store-'));
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('store steps', () => {
    it('store-meta: describes the store this run leaves behind', async () => {
        const h = harness('meta');
        await main(['store-meta', '--ort-version', '97.2.0', '--ort-image', 'ghcr.io/ort@sha256:abc',
            '--product-repository', REPOSITORY, '--product-ref', 'v0.3.57', '--out', at('made', 'store.json')], h.deps);
        assert.deepEqual(read(at('made', 'store.json')), {
            format: 1, ortVersion: '97.2.0', scancodeOptions: SCANCODE_OPTIONS, ortImage: 'ghcr.io/ort@sha256:abc',
            made: { repository: REPOSITORY, ref: 'v0.3.57', run: 'https://github.com/owner/product/actions/runs/500', at: NOW },
        });
    });

    it('store-find: names the run whose store to download', async () => {
        const h = harness('find', { api: oneStore });
        await main(['store-find', '--out', at('find.json')], h.deps);
        assert.equal(h.output(), 'run_id=300\n');
        const find = read(at('find.json'));
        assert.equal(find.repository, REPOSITORY);
        assert.equal(find.found.runId, 300);
    });

    it('store-use: takes up a store that fits, and says where it came from', async () => {
        downloadedStore('store-in', read(at('made', 'store.json')));
        const h = harness('use');
        await main(['store-use', '--find', at('find.json'), '--store-dir', at('store-in'), '--ort-version', '97.2.0',
            '--out', at('status.json')], h.deps);
        assert.equal(h.output(), 'run_id=300\n');
        assert.match(h.summary(), /Taken from \[run 300\].*\(`v0\.3\.57`, 2026-11-08\)/);
        assert.ok(!h.logged.some((l) => l.startsWith('::warning')));
        assert.ok(fs.existsSync(at('store-in', 'timings', 'timings.json')), 'kept for the plan');
        const status = read(at('status.json'));
        assert.deepEqual([status.used, status.reason, status.startedAt], [true, null, NOW]);
    });

    it('store-use: rejects a store of another ORT version, removes it and warns why', async () => {
        downloadedStore('store-old', { ...read(at('made', 'store.json')), ortVersion: '96.0.0' });
        const h = harness('old');
        await main(['store-use', '--find', at('find.json'), '--store-dir', at('store-old'), '--ort-version', '97.2.0',
            '--out', at('status-old.json')], h.deps);
        assert.equal(h.output(), 'run_id=\n');
        assert.equal(fs.existsSync(at('store-old')), false);
        assert.ok(h.logged.includes('::warning title=Full scan::Everything is scanned again: the earlier scan results were made'
            + ' with ORT 96.0.0; this scan uses ORT 97.2.0, whose findings may differ.'), h.logged.join('\n'));
        assert.match(h.summary(), /> \*\*Everything is scanned again:\*\* the earlier scan results were made with ORT 96\.0\.0/);
        assert.equal(read(at('status-old.json')).reason, REASONS.ORT_VERSION);
    });

    it('store-use: a store that did not arrive, or has no description, is a full scan with its reason', async () => {
        const missing = harness('missing');
        await main(['store-use', '--find', at('find.json'), '--store-dir', at('never-downloaded'), '--ort-version', '97.2.0',
            '--out', at('status-missing.json')], missing.deps);
        assert.equal(read(at('status-missing.json')).reason, REASONS.DOWNLOAD_FAILED);
        assert.match(missing.summary(), /could not be downloaded/);

        downloadedStore('store-bare');
        const bare = harness('bare');
        await main(['store-use', '--find', at('find.json'), '--store-dir', at('store-bare'), '--ort-version', '97.2.0',
            '--out', at('status-bare.json')], bare.deps);
        assert.equal(read(at('status-bare.json')).reason, REASONS.UNREADABLE);
        assert.equal(fs.existsSync(at('store-bare')), false);
    });

    it('store-find: a failed lookup is a reason, not an error; store-use warns with it', async () => {
        const failing = async () => { throw new Error('GitHub API repos/owner/product/actions/artifacts: HTTP 403'); };
        const h = harness('fail', { api: failing });
        await main(['store-find', '--out', at('find-fail.json')], h.deps);
        assert.equal(h.output(), 'run_id=\n');
        assert.equal(read(at('find-fail.json')).reason, REASONS.LOOKUP_FAILED);

        const use = harness('fail-use');
        await main(['store-use', '--find', at('find-fail.json'), '--store-dir', at('no-store'), '--ort-version', '97.2.0',
            '--out', at('status-fail.json')], use.deps);
        assert.ok(use.logged.some((l) => /^::warning title=Full scan::.*HTTP 403.*`actions: read`/.test(l)), use.logged.join('\n'));
    });

    it('store-find: no store at all is said plainly', async () => {
        const h = harness('none', { api: async () => ({ artifacts: [] }) });
        await main(['store-find', '--out', at('find-none.json')], h.deps);
        const use = harness('none-use');
        await main(['store-use', '--find', at('find-none.json'), '--store-dir', at('none-dir'), '--ort-version', '97.2.0',
            '--out', at('status-none.json')], use.deps);
        assert.match(use.summary(), /no earlier scan results were found in owner\/product: this is its first scan/);
    });

    it('store-find: needs GITHUB_REPOSITORY as owner/name', async () => {
        const h = harness('norepo', { api: oneStore });
        delete h.env.GITHUB_REPOSITORY;
        await assert.rejects(main(['store-find', '--out', at('x.json')], h.deps), UsageError);
    });
});
