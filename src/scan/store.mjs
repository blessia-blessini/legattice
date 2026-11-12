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
// The store of earlier scan results: one artifact, "ort-store",
// that every clean scan leaves behind and the next scan takes up.
//
// An artifact, not the GitHub cache: a cache is bound to the
// branch or tag that saved it, so each release tag started empty
// and scanned everything again. An artifact can be read from any
// run of the repository.
//
// The price is trust: any run may upload an artifact, a fork's
// pull request included. A store is used only from a run of this
// repository started by push, by hand or by schedule -- runs only
// someone with write access can start, as with the cache before.
//
// Whenever no store is used, the reason is said, in a warning and
// in the job summary: the scan then takes much longer.
//**************************************************************

/** Name of the artifact. One name for every ORT version: store.json says which made it. */
export const STORE_ARTIFACT = 'ort-store';

/** The description inside the artifact, next to cache/ and timings/. */
export const STORE_FILE = 'store.json';

/** Version of store.json and of the status files. */
export const STORE_FORMAT = 1;

/** Events of runs whose store is trusted: only someone with write access can start them. */
export const TRUSTED_EVENTS = Object.freeze(['push', 'workflow_dispatch', 'schedule']);

/** Newest stores checked for trust before giving up: each check is one API request. */
export const MAX_CANDIDATES = 10;

/** Days GitHub keeps an artifact of a public repository at most. */
export const STORE_KEPT_DAYS = 90;

/** Why no store was used. */
export const REASONS = Object.freeze({
    NONE: 'none',
    ASKED: 'asked',
    EXPIRED: 'expired',
    UNTRUSTED: 'untrusted',
    LOOKUP_FAILED: 'lookup-failed',
    DOWNLOAD_FAILED: 'download-failed',
    UNREADABLE: 'unreadable',
    ORT_VERSION: 'ort-version',
    SCANNER_OPTIONS: 'scanner-options',
});

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;


//**************************************************************
// isRepository
//**************************************************************
/** True for "owner/name". */
export const isRepository = (value) => typeof value === 'string' && REPOSITORY_RE.test(value);
// isRepository END ********************************************


//**************************************************************
// githubApi
//**************************************************************
/**
 * A function route -> parsed JSON for the GitHub REST API, with the
 * token of the run (GITHUB_TOKEN). Fails on any answer but 2xx; the
 * message names the route and the status, never the token.
 */
export function githubApi({ env, fetchImpl = fetch }) {
    const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
    const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'legattice-scan',
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    };
    return async (route) => {
        const response = await fetchImpl(`${base}/${route}`, { headers });
        if (!response.ok) throw new Error(`GitHub API ${route}: HTTP ${response.status}`);
        return response.json();
    };
}
// githubApi END ***********************************************


//**************************************************************
// isOwnRepositoryRun
//**************************************************************
/**
 * True when the artifact's run belongs to this repository itself, not a
 * fork. Both ids must be present and equal: a missing id is not trusted.
 */
function isOwnRepositoryRun(workflowRun) {
    return Number.isInteger(workflowRun?.id)
        && Number.isInteger(workflowRun.repository_id)
        && workflowRun.head_repository_id === workflowRun.repository_id;
}
// isOwnRepositoryRun END **************************************


//**************************************************************
// findStore
//**************************************************************
/**
 * The newest trusted store of `repository`, asked through `api` (see
 * githubApi): { found, reason, detail }.
 *
 * - found: { runId, artifactId, createdAt, event, ref, url }, reason null;
 *   detail.skipped counts newer stores passed over as untrusted.
 * - otherwise found null and reason NONE (no store at all), EXPIRED (only
 *   expired ones; detail.newest) or UNTRUSTED (the newest MAX_CANDIDATES
 *   live ones all untrusted; detail.skipped).
 *
 * API failures are thrown: the caller reports them as LOOKUP_FAILED.
 */
export async function findStore({ api, repository }) {
    if (!isRepository(repository)) throw new Error(`not a repository: ${repository}`);
    const list = await api(`repos/${repository}/actions/artifacts?name=${STORE_ARTIFACT}&per_page=100`);
    const stores = (Array.isArray(list?.artifacts) ? list.artifacts : [])
        .filter((a) => a?.name === STORE_ARTIFACT)
        .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    if (stores.length === 0) return { found: null, reason: REASONS.NONE, detail: {} };

    const live = stores.filter((a) => a.expired !== true);
    if (live.length === 0) return { found: null, reason: REASONS.EXPIRED, detail: { newest: stores[0].created_at ?? null } };

    let skipped = 0;
    for (const artifact of live.slice(0, MAX_CANDIDATES)) {
        const workflowRun = artifact.workflow_run;
        if (!isOwnRepositoryRun(workflowRun)) {
            skipped += 1;
            continue;
        }
        const run = await api(`repos/${repository}/actions/runs/${workflowRun.id}`);
        if (!TRUSTED_EVENTS.includes(run?.event)) {
            skipped += 1;
            continue;
        }
        return {
            found: {
                runId: workflowRun.id,
                artifactId: artifact.id ?? null,
                createdAt: artifact.created_at ?? null,
                event: run.event,
                ref: run.head_branch ?? workflowRun.head_branch ?? null,
                url: run.html_url ?? null,
            },
            reason: null,
            detail: { skipped },
        };
    }
    return { found: null, reason: REASONS.UNTRUSTED, detail: { skipped } };
}
// findStore END ***********************************************


//**************************************************************
// storeDescription
//**************************************************************
/**
 * The content of store.json: what a later scan must agree with to reuse
 * the results (ORT version, ScanCode options), and where they came from.
 */
export function storeDescription({ ortVersion, scancodeOptions, ortImage = null, repository = null, ref = null, run = null, at }) {
    return {
        format: STORE_FORMAT,
        ortVersion,
        scancodeOptions,
        ortImage,
        made: { repository, ref, run, at },
    };
}
// storeDescription END ****************************************


//**************************************************************
// checkStore
//**************************************************************
/**
 * Null when a store described by `description` (store.json, or null when
 * missing or unreadable) fits this scan (`current`: { ortVersion,
 * scancodeOptions }); otherwise { reason, detail } saying why not.
 */
export function checkStore(description, current) {
    if (!description || description.format !== STORE_FORMAT) return { reason: REASONS.UNREADABLE, detail: {} };
    if (description.ortVersion !== current.ortVersion) {
        return { reason: REASONS.ORT_VERSION, detail: { was: description.ortVersion, now: current.ortVersion } };
    }
    if (description.scancodeOptions !== current.scancodeOptions) {
        return { reason: REASONS.SCANNER_OPTIONS, detail: { was: description.scancodeOptions, now: current.scancodeOptions } };
    }
    return null;
}
// checkStore END **********************************************


/** "2026-11-08T23:10:00Z" -> "2026-11-08"; anything else as it is. */
const day = (timestamp) => (typeof timestamp === 'string' ? timestamp.slice(0, 10) : 'an unknown day');

/** A run as a Markdown link when its address is known. */
const runLink = (run) => (run?.url ? `[run ${run.runId}](${run.url})` : `run ${run?.runId ?? '?'}`);


//**************************************************************
// reasonText
//**************************************************************
/** Why no store was used, as one sentence (Markdown). */
export function reasonText({ reason, detail = {}, run = null, repository = '' }) {
    switch (reason) {
        case REASONS.NONE:
            return `no earlier scan results were found in ${repository || 'this repository'}: this is its first scan, or none was kept.`;
        case REASONS.ASKED:
            return 'a scan of everything was asked for by this run (input `fresh`; in Lattice: ForceDeepScan),'
                + ' so the earlier scan results are not used.';
        case REASONS.EXPIRED:
            return `the earlier scan results have expired (the newest is from ${day(detail.newest)});`
                + ` GitHub keeps them for ${STORE_KEPT_DAYS} days at most.`;
        case REASONS.UNTRUSTED:
            return `the newest earlier scan results all come from runs that are not trusted (${detail.skipped ?? 0} skipped):`
                + ` only runs of this repository started by ${TRUSTED_EVENTS.join(', ')} are used, never a fork or a pull request.`;
        case REASONS.LOOKUP_FAILED:
            return `the earlier scan results could not be looked up (${detail.message ?? 'no answer'}).`
                + ' A workflow that calls this scan must grant it `actions: read`.';
        case REASONS.DOWNLOAD_FAILED:
            return `the earlier scan results of ${runLink(run)} could not be downloaded.`;
        case REASONS.UNREADABLE:
            return `the earlier scan results of ${runLink(run)} carry no ${STORE_FILE} this version can read.`;
        case REASONS.ORT_VERSION:
            return `the earlier scan results were made with ORT ${detail.was}; this scan uses ORT ${detail.now}, whose findings may differ.`;
        case REASONS.SCANNER_OPTIONS:
            return `the earlier scan results were made with other ScanCode options (\`${detail.was}\`); this scan uses \`${detail.now}\`.`;
        default:
            return `no earlier scan results were used (${reason}).`;
    }
}
// reasonText END **********************************************


//**************************************************************
// renderStoreSummary
//**************************************************************
/**
 * The job summary section for a store status ({ used, run, reason,
 * detail, repository }): where the earlier results came from, or a
 * warning that everything is scanned again, and why.
 */
export function renderStoreSummary(status) {
    const lines = ['## Earlier scan results', ''];
    if (status.used) {
        const run = status.run;
        const skipped = status.detail?.skipped ?? 0;
        lines.push(`Taken from ${runLink(run)} (${run.ref ? `\`${run.ref}\`, ` : ''}${day(run.createdAt)}):`
            + ' everything it scanned is a lookup now; only what is new is scanned.');
        if (skipped > 0) lines.push('', `${skipped} newer store(s) were passed over: not from a trusted run.`);
    } else {
        lines.push('> [!WARNING]', `> **Everything is scanned again:** ${reasonText(status)}`);
    }
    lines.push('');
    return lines.join('\n');
}
// renderStoreSummary END **************************************


//**************************************************************
// annotation
//**************************************************************
/** A GitHub Actions workflow command, its message escaped (%, CR, LF). */
export function annotation(level, title, message) {
    const escaped = String(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    return `::${level} title=${title}::${escaped}`;
}
// annotation END **********************************************
