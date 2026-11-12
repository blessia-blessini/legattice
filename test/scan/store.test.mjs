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
// The store of earlier scan results: which artifact is trusted,
// whether it fits the scan, and how a full scan is explained.
//**************************************************************

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    annotation, checkStore, findStore, githubApi, MAX_CANDIDATES, REASONS, reasonText, renderStoreSummary,
    STORE_ARTIFACT, STORE_FORMAT, storeDescription, TRUSTED_EVENTS,
} from '../../src/scan/store.mjs';

const REPOSITORY = 'owner/product';
const REPO_ID = 7;
const OPTIONS = '--copyright,--license';

/** An artifact as GitHub lists it; `fork`: made by a run of another repository. */
const artifact = (id, runId, { created = '2026-11-08T10:00:00Z', expired = false, fork = false, name = STORE_ARTIFACT } = {}) => ({
    id,
    name,
    expired,
    created_at: created,
    workflow_run: { id: runId, repository_id: REPO_ID, head_repository_id: fork ? 99 : REPO_ID, head_branch: 'v1' },
});

/** A fake GitHub API: the artifact list, runs by id (default: a push run), the routes asked. */
function fakeApi({ artifacts = [], runs = {}, fail = null } = {}) {
    const calls = [];
    const api = async (route) => {
        calls.push(route);
        if (fail !== null && route.includes(fail)) throw new Error(`GitHub API ${route}: HTTP 403`);
        if (route.includes('/actions/artifacts')) return { total_count: artifacts.length, artifacts };
        const id = Number(route.split('/').pop());
        return runs[id] ?? { event: 'push', head_branch: `tag-${id}`, html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}` };
    };
    return { api, calls };
}

describe('findStore', () => {
    it('asks for the store artifact of the repository by name', async () => {
        const { api, calls } = fakeApi();
        await findStore({ api, repository: REPOSITORY });
        assert.equal(calls[0], `repos/${REPOSITORY}/actions/artifacts?name=${STORE_ARTIFACT}&per_page=100`);
    });

    it('says when there is no store at all', async () => {
        const { api } = fakeApi({ artifacts: [artifact(1, 10, { name: 'plan' })] });
        assert.deepEqual(await findStore({ api, repository: REPOSITORY }), { found: null, reason: REASONS.NONE, detail: {} });
    });

    it('says when every store has expired, naming the newest', async () => {
        const { api } = fakeApi({ artifacts: [
            artifact(1, 10, { expired: true, created: '2026-05-01T08:00:00Z' }),
            artifact(2, 11, { expired: true, created: '2026-06-02T08:00:00Z' }),
        ] });
        assert.deepEqual(await findStore({ api, repository: REPOSITORY }),
            { found: null, reason: REASONS.EXPIRED, detail: { newest: '2026-06-02T08:00:00Z' } });
    });

    it('takes the newest store of a trusted run, passing over a fork and a pull request', async () => {
        const { api } = fakeApi({
            artifacts: [
                artifact(1, 10, { created: '2026-11-01T00:00:00Z' }),
                artifact(2, 11, { created: '2026-11-03T00:00:00Z' }),
                artifact(3, 12, { created: '2026-11-04T00:00:00Z', fork: true }),
                artifact(4, 13, { created: '2026-11-05T00:00:00Z' }),
            ],
            runs: { 13: { event: 'pull_request', head_branch: 'feature' } },
        });
        const { found, reason, detail } = await findStore({ api, repository: REPOSITORY });
        assert.equal(reason, null);
        assert.deepEqual(found, {
            runId: 11, artifactId: 2, createdAt: '2026-11-03T00:00:00Z', event: 'push', ref: 'tag-11',
            url: `https://github.com/${REPOSITORY}/actions/runs/11`,
        });
        assert.deepEqual(detail, { skipped: 2 });
    });

    it('trusts exactly the events someone with write access starts', async () => {
        for (const event of ['push', 'workflow_dispatch', 'schedule', 'pull_request', 'pull_request_target', 'workflow_run']) {
            const { api } = fakeApi({ artifacts: [artifact(1, 10)], runs: { 10: { event } } });
            const { found } = await findStore({ api, repository: REPOSITORY });
            assert.equal(found !== null, TRUSTED_EVENTS.includes(event), event);
        }
    });

    it('does not trust a run whose repository ids are missing', async () => {
        const unknown = artifact(1, 10);
        delete unknown.workflow_run.head_repository_id;
        delete unknown.workflow_run.repository_id;
        const { api } = fakeApi({ artifacts: [unknown] });
        assert.equal((await findStore({ api, repository: REPOSITORY })).reason, REASONS.UNTRUSTED);
    });

    it('gives up after MAX_CANDIDATES untrusted stores, one request each', async () => {
        const artifacts = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) =>
            artifact(i + 1, 100 + i, { created: `2026-11-${String(10 + i).padStart(2, '0')}T00:00:00Z` }));
        const runs = Object.fromEntries(artifacts.map((a) => [a.workflow_run.id, { event: 'pull_request' }]));
        const { api, calls } = fakeApi({ artifacts, runs });
        assert.deepEqual(await findStore({ api, repository: REPOSITORY }),
            { found: null, reason: REASONS.UNTRUSTED, detail: { skipped: MAX_CANDIDATES } });
        assert.equal(calls.length, 1 + MAX_CANDIDATES);
    });

    it('passes API failures on, and refuses a repository that is not owner/name', async () => {
        await assert.rejects(findStore({ api: fakeApi({ fail: 'artifacts' }).api, repository: REPOSITORY }), /HTTP 403/);
        await assert.rejects(findStore({ api: fakeApi().api, repository: 'owner/product/../x' }), /not a repository/);
    });
});

describe('githubApi', () => {
    it('asks the API of the run with its token and returns the JSON', async () => {
        const asked = [];
        const fetchImpl = async (url, init) => {
            asked.push({ url, init });
            return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
        };
        const api = githubApi({ env: { GITHUB_API_URL: 'https://ghe.example.org/api/v3/', GITHUB_TOKEN: 'secret-token' }, fetchImpl });
        assert.deepEqual(await api('repos/o/p/actions/artifacts'), { ok: 1 });
        assert.equal(asked[0].url, 'https://ghe.example.org/api/v3/repos/o/p/actions/artifacts');
        assert.equal(asked[0].init.headers.Authorization, 'Bearer secret-token');
        assert.equal(asked[0].init.headers.Accept, 'application/vnd.github+json');
    });

    it('fails on an error answer without ever naming the token', async () => {
        const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
        const api = githubApi({ env: { GITHUB_TOKEN: 'secret-token' }, fetchImpl });
        await assert.rejects(api('repos/o/p/actions/runs/1'),
            (e) => /repos\/o\/p\/actions\/runs\/1: HTTP 403/.test(e.message) && !e.message.includes('secret-token'));
    });

    it('works without a token, against api.github.com', async () => {
        let asked;
        const api = githubApi({ env: {}, fetchImpl: async (url, init) => { asked = { url, init }; return { ok: true, json: async () => ({}) }; } });
        await api('x');
        assert.equal(asked.url, 'https://api.github.com/x');
        assert.equal('Authorization' in asked.init.headers, false);
    });
});

describe('checkStore', () => {
    const current = { ortVersion: '97.2.0', scancodeOptions: OPTIONS };
    const made = (over = {}) => ({ ...storeDescription({ ...current, at: '2026-11-08T10:00:00Z' }), ...over });

    it('accepts a store made with the same ORT version and ScanCode options', () => {
        assert.equal(checkStore(made({ ortImage: 'another-digest' }), current), null);
    });

    it('names a store without a description of this format as unreadable', () => {
        assert.deepEqual(checkStore(null, current), { reason: REASONS.UNREADABLE, detail: {} });
        assert.deepEqual(checkStore(made({ format: STORE_FORMAT + 1 }), current), { reason: REASONS.UNREADABLE, detail: {} });
    });

    it('rejects another ORT version, then other ScanCode options, saying what changed', () => {
        assert.deepEqual(checkStore(made({ ortVersion: '96.0.0', scancodeOptions: 'x' }), current),
            { reason: REASONS.ORT_VERSION, detail: { was: '96.0.0', now: '97.2.0' } });
        assert.deepEqual(checkStore(made({ scancodeOptions: '--license' }), current),
            { reason: REASONS.SCANNER_OPTIONS, detail: { was: '--license', now: OPTIONS } });
    });
});

describe('explaining a full scan', () => {
    const run = { runId: 42, url: 'https://github.com/o/p/actions/runs/42', ref: 'v0.3.57', createdAt: '2026-11-08T23:10:00Z' };

    it('gives every reason its own sentence with the facts', () => {
        const cases = [
            [{ reason: REASONS.NONE, repository: REPOSITORY }, /no earlier scan results were found in owner\/product/],
            [{ reason: REASONS.ASKED }, /asked for by this run \(input `fresh`; in Lattice: ForceDeepScan\)/],
            [{ reason: REASONS.EXPIRED, detail: { newest: '2026-06-02T08:00:00Z' } }, /expired \(the newest is from 2026-06-02\).*90 days/],
            [{ reason: REASONS.UNTRUSTED, detail: { skipped: 3 } }, /not trusted \(3 skipped\).*never a fork or a pull request/],
            [{ reason: REASONS.LOOKUP_FAILED, detail: { message: 'HTTP 403' } }, /could not be looked up \(HTTP 403\).*`actions: read`/],
            [{ reason: REASONS.DOWNLOAD_FAILED, run }, /\[run 42\]\(https:\/\/github\.com\/o\/p\/actions\/runs\/42\) could not be downloaded/],
            [{ reason: REASONS.UNREADABLE, run }, /carry no store\.json this version can read/],
            [{ reason: REASONS.ORT_VERSION, detail: { was: '96.0.0', now: '97.2.0' } }, /ORT 96\.0\.0; this scan uses ORT 97\.2\.0/],
            [{ reason: REASONS.SCANNER_OPTIONS, detail: { was: '--a', now: '--b' } }, /options \(`--a`\); this scan uses `--b`/],
            [{ reason: 'something-new' }, /\(something-new\)/],
        ];
        for (const [status, expected] of cases) assert.match(reasonText(status), expected, status.reason);
    });

    it('warns in the summary when nothing is reused', () => {
        const summary = renderStoreSummary({ used: false, reason: REASONS.NONE, detail: {}, repository: REPOSITORY, run: null });
        assert.match(summary, /^## Earlier scan results\n\n> \[!WARNING\]\n> \*\*Everything is scanned again:\*\* no earlier/);
    });

    it('names the run, its ref and day when the store is used, and any store passed over', () => {
        const summary = renderStoreSummary({ used: true, run, reason: null, detail: { skipped: 1 } });
        assert.match(summary, /Taken from \[run 42\]\(https:\/\/github\.com\/o\/p\/actions\/runs\/42\) \(`v0\.3\.57`, 2026-11-08\)/);
        assert.match(summary, /1 newer store\(s\) were passed over/);
        assert.doesNotMatch(renderStoreSummary({ used: true, run, reason: null, detail: { skipped: 0 } }), /passed over|WARNING/);
    });

    it('escapes a workflow command so a reason cannot end it early', () => {
        assert.equal(annotation('warning', 'Full scan', '50% done\nnext'), '::warning title=Full scan::50%25 done%0Anext');
    });
});
