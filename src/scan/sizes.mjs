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
// Source archive sizes, asked from the registries before scanning.
//   A request for the first byte only ("Range: bytes=0-0"): the
//   answer names the full size ("Content-Range: bytes 0-0/17796365").
//   A HEAD request is not enough -- the npm registry answers it
//   without a size. Archives made on the fly (GitHub tarballs) have
//   no size at all; they stay unknown.
//**************************************************************

export const PROBE_CONCURRENCY = 16;
export const PROBE_TIMEOUT_MS = 10_000;
/** Tries per URL: a dropped connection should not make a unit "unknown". */
export const PROBE_TRIES = 2;
/** Registries ask automated clients to say who they are (crates.io: required). */
export const USER_AGENT = 'legattice (https://github.com/blessia-blessini/legattice)';

const CONTENT_RANGE_TOTAL_RE = /^bytes \d+-\d+\/(\d+)$/;


//**************************************************************
// sizeFromResponse
//**************************************************************
/** Bytes of the whole archive from the response headers, or null. */
export function sizeFromResponse(status, headers) {
    const range = CONTENT_RANGE_TOTAL_RE.exec(headers.get('content-range') ?? '');
    if (status === 206 && range) return Number(range[1]) || null;
    if (status === 200) return Number(headers.get('content-length')) || null;
    return null;
}
// sizeFromResponse END ****************************************


//**************************************************************
// probeSize
//**************************************************************
/**
 * Bytes of the archive at `url`, or null when it cannot be told. Never
 * throws. A network error is tried again (PROBE_TRIES); an answer --
 * even "404" -- is not.
 */
export async function probeSize(url, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS, tries = PROBE_TRIES } = {}) {
    if (!/^https?:\/\//.test(url)) return null;
    for (let attempt = 1; attempt <= tries; attempt++) {
        try {
            const response = await fetchImpl(url, {
                headers: { Range: 'bytes=0-0', 'User-Agent': USER_AGENT },
                redirect: 'follow',
                signal: AbortSignal.timeout(timeoutMs),
            });
            // Only the headers are needed: do not download a whole archive
            // from a server that ignores the Range header.
            await response.body?.cancel();
            return sizeFromResponse(response.status, response.headers);
        } catch {
            // network error or timeout: next attempt
        }
    }
    return null;
}
// probeSize END ***********************************************


//**************************************************************
// probeSizes
//**************************************************************
/** Map url -> bytes or null, `concurrency` requests at a time. */
export async function probeSizes(urls, { concurrency = PROBE_CONCURRENCY, ...options } = {}) {
    const queue = [...new Set(urls)];
    const sizes = new Map();
    let next = 0;
    const worker = async () => {
        while (next < queue.length) {
            const url = queue[next++];
            sizes.set(url, await probeSize(url, options));
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    return sizes;
}
// probeSizes END **********************************************
