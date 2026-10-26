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

import { probeSize, probeSizes, sizeFromResponse } from '../../src/scan/sizes.mjs';

/** A fake fetch answering from a table url -> { status, headers } or an Error. */
function fakeFetch(table, seen = []) {
    return async (url, init) => {
        seen.push({ url, init });
        const answer = table[url];
        if (answer instanceof Error) throw answer;
        let cancelled = false;
        return {
            status: answer.status,
            headers: new Headers(answer.headers ?? {}),
            body: { cancel: async () => { cancelled = true; } },
            get cancelled() { return cancelled; },
        };
    };
}

describe('sizeFromResponse', () => {
    it('reads the total from a partial answer, or the length of a full one', () => {
        assert.equal(sizeFromResponse(206, new Headers({ 'content-range': 'bytes 0-0/17796365' })), 17796365);
        assert.equal(sizeFromResponse(200, new Headers({ 'content-length': '83652' })), 83652);
    });

    it('knows nothing from errors, unknown totals or missing headers', () => {
        assert.equal(sizeFromResponse(206, new Headers({ 'content-range': 'bytes 0-0/*' })), null);
        assert.equal(sizeFromResponse(200, new Headers()), null);
        assert.equal(sizeFromResponse(404, new Headers({ 'content-length': '9' })), null);
        assert.equal(sizeFromResponse(206, new Headers({ 'content-range': 'bytes 0-0/0' })), null);
    });
});

describe('probeSize', () => {
    it('asks for the first byte only and drops the body', async () => {
        const seen = [];
        const fetchImpl = fakeFetch({ 'https://r/a.tgz': { status: 206, headers: { 'content-range': 'bytes 0-0/42' } } }, seen);
        assert.equal(await probeSize('https://r/a.tgz', { fetchImpl }), 42);
        assert.equal(seen[0].init.headers.Range, 'bytes=0-0');
    });

    it('says who is asking', async () => {
        const seen = [];
        const fetchImpl = fakeFetch({ 'https://r/a.tgz': { status: 200, headers: { 'content-length': '5' } } }, seen);
        await probeSize('https://r/a.tgz', { fetchImpl });
        assert.match(seen[0].init.headers['User-Agent'], /^legattice /);
    });

    it('answers null instead of throwing, and never fetches what is not http(s)', async () => {
        const seen = [];
        const fetchImpl = fakeFetch({ 'https://r/down.tgz': new TypeError('fetch failed') }, seen);
        assert.equal(await probeSize('https://r/down.tgz', { fetchImpl, tries: 1 }), null);
        assert.equal(await probeSize('file:///etc/passwd', { fetchImpl }), null);
        assert.equal(await probeSize('', { fetchImpl }), null);
        assert.deepEqual(seen.map((s) => s.url), ['https://r/down.tgz']);
    });

    it('tries again after a network error, but not after an answer', async () => {
        let calls = 0;
        const flaky = async () => {
            calls += 1;
            if (calls === 1) throw new TypeError('fetch failed');
            return { status: 206, headers: new Headers({ 'content-range': 'bytes 0-0/9' }), body: null };
        };
        assert.equal(await probeSize('https://r/a.tgz', { fetchImpl: flaky, tries: 2 }), 9);
        assert.equal(calls, 2);
        const seen = [];
        const missing = fakeFetch({ 'https://r/gone.tgz': { status: 404 } }, seen);
        assert.equal(await probeSize('https://r/gone.tgz', { fetchImpl: missing, tries: 2 }), null);
        assert.equal(seen.length, 1);
    });
});

describe('probeSizes', () => {
    it('asks once per distinct URL, a few at a time', async () => {
        let running = 0;
        let most = 0;
        const fetchImpl = async () => {
            running += 1;
            most = Math.max(most, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running -= 1;
            return { status: 206, headers: new Headers({ 'content-range': 'bytes 0-0/7' }), body: null };
        };
        const urls = Array.from({ length: 20 }, (_, i) => `https://r/${i % 10}.tgz`);
        const sizes = await probeSizes(urls, { fetchImpl, concurrency: 3 });
        assert.equal(sizes.size, 10);
        assert.ok([...sizes.values()].every((v) => v === 7));
        assert.equal(most, 3);
    });

    it('returns an empty map for no URLs', async () => {
        assert.equal((await probeSizes([])).size, 0);
    });
});
