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
// The steps of the scan workflow (.github/workflows/scan.yml):
//
//   config   --out F [--manager M]       ORT config.yml
//   managers --out F (--dry-run F | --list "A,B")
//                                        package managers, one per line
//   plan     --analyzer-dir D --managers F --max-shards N --out F
//            [--timings F]               the scan plan; GitHub output
//                                        "shards" = [1, 2, ...]
//   shard    --plan F --index I --analyzer-dir D --out-dir D
//                                        D/<manager>.json + D/runs.tsv
//   check    --scanner-dir D --managers F
//                                        fails on any ScanCode error,
//                                        e.g. a file that timed out
//   timings  --scanner-dir D --managers F --plan F --out F
//            [--timings F] [--today YYYY-MM-DD]
//            [--store-status F]          the updated timings file; with
//                                        the store status, also how many
//                                        results this run scanned
//   store-find --out F [--fresh]         the newest trusted store of
//                                        earlier results (store.mjs) of
//                                        GITHUB_REPOSITORY; GitHub output
//                                        "run_id" (empty: none); --fresh:
//                                        none is looked for (a scan of
//                                        everything was asked for)
//   store-use  --find F --store-dir D --ort-version V --out F
//                                        checks the store downloaded to
//                                        D; F: the status (used or why
//                                        not); removes D when not used;
//                                        warns when everything is
//                                        scanned again; GitHub output
//                                        "run_id" (empty: not used)
//   store-meta --ort-version V --out F [--ort-image I]
//            [--product-repository R] [--product-ref REF]
//                                        store.json for the store this
//                                        run leaves behind
//   topics   --scanner-dir D --managers F --out-dir D
//            [--ledger L] [--today YYYY-MM-DD]
//            [--block-at none|high|medium|low]
//            [--product-repository R] [--product-ref REF]
//            [--legattice-commit SHA]
//                                        D/topics.json + D/topics.md:
//                                        what a person must decide,
//                                        after the decisions in the
//                                        ledger folder L; D/drafts/:
//                                        a ledger file to fill in per
//                                        undecided topic, named
//                                        1-high.open.<id>.json.
//                                        With a ledger, also
//                                        D/notice-additions.json:
//                                        what its decisions add to the
//                                        product's notices (R and REF
//                                        name what was scanned, SHA
//                                        the Legattice that ran).
//                                        Fails when undecided topics
//                                        reach the block level (after
//                                        writing).
//
// Analyzer and scanner results are D/<manager>/analyzer-result.json
// and D/<manager>/scan-result.json, as `ort ... -o D/<manager>`
// writes them. Node 24 built-ins only.
//**************************************************************

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ortConfigYaml, SCANCODE_OPTIONS } from './ort-config.mjs';
import { filterAnalyzerResult, parseDryRunManagers, parseManagerList, scanErrors, scanTimings, workUnits } from './ort-result.mjs';
import { mergeTimings, planScan, renderPlanSummary, shardRuns } from './plan.mjs';
import { probeSizes } from './sizes.mjs';
import {
    annotation, checkStore, findStore, githubApi, isRepository, REASONS, reasonText, renderStoreSummary, STORE_FILE,
    STORE_FORMAT, storeDescription,
} from './store.mjs';
import {
    applyLedger, blockingTopics, checkLedger, draftEntry, draftFileName, emptyLedger, isDate, LedgerError, UNDECIDED,
} from '../ledger/ledger.mjs';
import { noticeAdditions } from '../ledger/additions.mjs';
import { renderTopics } from '../ledger/report.mjs';
import { SEVERITIES } from '../topics/licence-classes.mjs';
import { FORMAT, openTopics } from '../topics/topics.mjs';

/** Topic rows per section in the job summary; topics.md has them all. */
const SUMMARY_TOPIC_ROWS = 25;


/** An error the user caused (bad option, missing file): printed without a stack. */
export class UsageError extends Error {}

/** Undecided topics at the block level: the run fails, printed without a stack. */
export class BlockedError extends Error {}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const writeText = (file, text) => {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, text);
};

const writeJson = (file, value) => writeText(file, JSON.stringify(value, null, 2) + '\n');


//**************************************************************
// requireOptions
//**************************************************************
/** Throws a UsageError naming the first missing option. */
function requireOptions(values, names) {
    for (const name of names) {
        if (values[name] === undefined) throw new UsageError(`--${name} is required`);
    }
}
// requireOptions END ******************************************


//**************************************************************
// readManagers
//**************************************************************
/** The managers file: one checked name per line. */
function readManagers(file) {
    const managers = parseManagerList(fs.readFileSync(file, 'utf8').split(/\r?\n/).join(','));
    if (managers.length === 0) throw new UsageError(`${file}: no package manager`);
    return managers;
}
// readManagers END ********************************************


//**************************************************************
// readTimings
//**************************************************************
/**
 * The timings file of earlier runs, or null on a first run. A broken
 * file only makes the plan worse, never the scan wrong: warn, go on.
 */
function readTimings(file, log) {
    if (file === undefined || !fs.existsSync(file)) return null;
    try {
        return readJson(file);
    } catch (e) {
        log(`::warning::${file} is not readable (${e.message}); planning without earlier timings`);
        return null;
    }
}
// readTimings END *********************************************


/** Append to a file GitHub Actions names in an environment variable, when set. */
function appendGitHub(env, variable, text) {
    if (env[variable]) fs.appendFileSync(env[variable], text);
}


//**************************************************************
// commandConfig
//**************************************************************
function commandConfig(values) {
    requireOptions(values, ['out']);
    writeText(values.out, ortConfigYaml({ manager: values.manager ?? null }));
}
// commandConfig END *******************************************


//**************************************************************
// commandManagers
//**************************************************************
function commandManagers(values, log) {
    requireOptions(values, ['out']);
    if ((values['dry-run'] === undefined) === (values.list === undefined)) {
        throw new UsageError('give either --dry-run or --list');
    }
    const managers = values.list !== undefined
        ? parseManagerList(values.list)
        : parseDryRunManagers(fs.readFileSync(values['dry-run'], 'utf8'));
    if (managers.length === 0) throw new UsageError('no package manager found: nothing to scan');
    writeText(values.out, managers.join('\n') + '\n');
    log(`package managers: ${managers.join(', ')}`);
}
// commandManagers END *****************************************


//**************************************************************
// commandPlan
//**************************************************************
async function commandPlan(values, { env, log, probe }) {
    requireOptions(values, ['analyzer-dir', 'managers', 'max-shards', 'out']);
    const maxShards = Number(values['max-shards']);
    if (!Number.isInteger(maxShards) || maxShards < 1) {
        throw new UsageError(`--max-shards must be a whole number of at least 1, not ${values['max-shards']}`);
    }
    const analyzed = readManagers(values.managers).map((manager) => ({
        manager,
        result: readJson(path.join(values['analyzer-dir'], manager, 'analyzer-result.json')),
    }));
    const units = workUnits(analyzed);
    const timings = readTimings(values.timings, log);
    const urls = units.filter((u) => u.kind === 'package' && u.url && !timings?.units?.[u.id]).map((u) => u.url);
    const sizes = await probe(urls);
    const plan = planScan({ units, timings, sizes, maxShards });
    writeJson(values.out, plan);
    const summary = renderPlanSummary(plan, { earlier: timings !== null });
    log(summary);
    appendGitHub(env, 'GITHUB_STEP_SUMMARY', summary + '\n');
    appendGitHub(env, 'GITHUB_OUTPUT', `shards=${JSON.stringify(plan.shards.map((s) => s.index))}\n`);
}
// commandPlan END *********************************************


//**************************************************************
// commandShard
//**************************************************************
function commandShard(values, log) {
    requireOptions(values, ['plan', 'index', 'analyzer-dir', 'out-dir']);
    const index = Number(values.index);
    if (!Number.isInteger(index) || index < 1) throw new UsageError(`bad --index: ${values.index}`);
    const runs = shardRuns(readJson(values.plan), index);
    const lines = [];
    for (const run of runs) {
        const result = readJson(path.join(values['analyzer-dir'], run.manager, 'analyzer-result.json'));
        writeJson(path.join(values['out-dir'], `${run.manager}.json`), filterAnalyzerResult(result, new Set(run.packageIds)));
        lines.push(`${run.manager}\t${run.packageTypes}`);
        log(`shard ${index}: ${run.manager} -- ${run.packageIds.length} package(s)`
            + `${run.packageTypes.includes('PROJECT') ? ' and the project(s)' : ''}`);
    }
    writeText(path.join(values['out-dir'], 'runs.tsv'), lines.map((l) => l + '\n').join(''));
}
// commandShard END ********************************************


//**************************************************************
// commandCheck
//**************************************************************
/** Fails when ScanCode reported an error: that scan is incomplete. */
function commandCheck(values, log) {
    requireOptions(values, ['scanner-dir', 'managers']);
    const errors = readManagers(values.managers).flatMap((manager) =>
        scanErrors(readJson(path.join(values['scanner-dir'], manager, 'scan-result.json')))
            .map((e) => `${manager} ${e}`));
    if (errors.length > 0) {
        throw new BlockedError(`${errors.length} scan error(s), so the scan is incomplete:\n${errors.join('\n')}`);
    }
    log('scan check: no ScanCode errors');
}
// commandCheck END ********************************************


//**************************************************************
// commandTimings
//**************************************************************
function commandTimings(values, { env, log, today }) {
    requireOptions(values, ['scanner-dir', 'managers', 'plan', 'out']);
    // Only for the summary line: a missing status (a scan without the broker's
    // store check) leaves that line out, never fails the timings.
    const status = values['store-status'] !== undefined && fs.existsSync(values['store-status'])
        ? readJson(values['store-status'])
        : null;
    const since = status?.startedAt ?? null;
    const measured = readManagers(values.managers).map((manager) =>
        scanTimings(readJson(path.join(values['scanner-dir'], manager, 'scan-result.json')), { since }));
    const timings = mergeTimings({
        previous: readTimings(values.timings, log),
        measured,
        plan: readJson(values.plan),
        today: values.today ?? today,
    });
    writeJson(values.out, timings);
    const fresh = measured.reduce((sum, m) => ({
        count: sum.count + m.fresh.count, seconds: sum.seconds + m.fresh.seconds,
    }), { count: 0, seconds: 0 });
    const summary = [
        '## Scan times',
        '',
        ...(status === null ? [] : [storeOutcomeLine(status, measured), '']),
        `${Object.keys(timings.units).length} timings kept for the next plan.`,
        fresh.count === 0
            ? 'Every result came from the shards or earlier runs.'
            : `**${fresh.count} result(s) were scanned by this merge job** (${(fresh.seconds / 60).toFixed(1)} min):`
                + ' a shard did not deliver them (failed or out of time).',
        '',
    ].join('\n');
    log(summary);
    appendGitHub(env, 'GITHUB_STEP_SUMMARY', summary + '\n');
}
// commandTimings END ******************************************


//**************************************************************
// storeOutcomeLine
//**************************************************************
/**
 * One summary line for the merge job: how many results this run scanned
 * and how many came from earlier runs, and where those came from.
 */
function storeOutcomeLine(status, measured) {
    const sources = measured.reduce((sum, m) => sum + m.sources, 0);
    const scanned = measured.reduce((sum, m) => sum + (m.since?.count ?? 0), 0);
    const seconds = measured.reduce((sum, m) => sum + (m.since?.seconds ?? 0), 0);
    const counts = `${scanned} of ${sources} result(s) were scanned in this run (${(seconds / 60).toFixed(1)} min),`
        + ` ${sources - scanned} came from earlier runs.`;
    return status.used
        ? `${counts} Earlier results: run ${status.run.runId}.`
        : `${counts} **No earlier results were used:** ${reasonText(status)}`;
}
// storeOutcomeLine END ****************************************


//**************************************************************
// commandStoreFind
//**************************************************************
/**
 * Looks for the newest trusted store of earlier results. A failed lookup
 * is not an error of the scan -- it only makes it slower -- so it is
 * recorded as the reason, never thrown. With --fresh nothing is looked
 * up: the run asked for everything to be scanned again (reason ASKED).
 */
async function commandStoreFind(values, { env, log, github }) {
    requireOptions(values, ['out']);
    const repository = env.GITHUB_REPOSITORY;
    if (!isRepository(repository)) throw new UsageError(`GITHUB_REPOSITORY must be owner/name, not ${repository ?? '(unset)'}`);
    let result;
    if (values.fresh) {
        result = { found: null, reason: REASONS.ASKED, detail: {} };
    } else {
        try {
            result = await findStore({ api: github ?? githubApi({ env }), repository });
        } catch (e) {
            result = { found: null, reason: REASONS.LOOKUP_FAILED, detail: { message: e.message } };
        }
    }
    writeJson(values.out, { format: STORE_FORMAT, repository, ...result });
    log(result.found
        ? `earlier scan results: run ${result.found.runId} (${result.found.event}, ${result.found.ref ?? 'no ref'})`
        : `no earlier scan results: ${result.reason}`);
    appendGitHub(env, 'GITHUB_OUTPUT', `run_id=${result.found?.runId ?? ''}\n`);
}
// commandStoreFind END ****************************************


//**************************************************************
// commandStoreUse
//**************************************************************
/**
 * Decides whether the store found by store-find, downloaded to
 * --store-dir, is used: it must have arrived and fit this scan (ORT
 * version, ScanCode options). Writes the status, the job summary and,
 * when everything is scanned again, a warning with the reason. A store
 * not used is removed, so nothing after reads it by mistake.
 */
function commandStoreUse(values, { env, log, now }) {
    requireOptions(values, ['find', 'store-dir', 'ort-version', 'out']);
    const find = readJson(values.find);
    const storeDir = values['store-dir'];
    const run = find.found ?? null;
    let reason = find.reason ?? (run ? null : REASONS.NONE);
    let detail = find.detail ?? {};
    if (run) {
        if (!fs.existsSync(storeDir)) {
            reason = REASONS.DOWNLOAD_FAILED;
            detail = {};
        } else {
            let description = null;
            try {
                description = readJson(path.join(storeDir, STORE_FILE));
            } catch {
                description = null;
            }
            const problem = checkStore(description, { ortVersion: values['ort-version'], scancodeOptions: SCANCODE_OPTIONS });
            if (problem) ({ reason, detail } = problem);
        }
    }
    const used = run !== null && reason === null;
    if (!used) fs.rmSync(storeDir, { recursive: true, force: true });
    const status = { format: STORE_FORMAT, startedAt: now(), repository: find.repository ?? null, used, run, reason, detail };
    writeJson(values.out, status);
    const summary = renderStoreSummary(status);
    log(summary);
    if (!used) log(annotation('warning', 'Full scan', `Everything is scanned again: ${reasonText(status)}`));
    appendGitHub(env, 'GITHUB_STEP_SUMMARY', summary + '\n');
    appendGitHub(env, 'GITHUB_OUTPUT', `run_id=${used ? run.runId : ''}\n`);
}
// commandStoreUse END *****************************************


//**************************************************************
// commandStoreMeta
//**************************************************************
/** store.json for the store this run leaves behind. */
function commandStoreMeta(values, { env, now }) {
    requireOptions(values, ['ort-version', 'out']);
    const server = env.GITHUB_SERVER_URL;
    const repo = env.GITHUB_REPOSITORY;
    writeJson(values.out, storeDescription({
        ortVersion: values['ort-version'],
        scancodeOptions: SCANCODE_OPTIONS,
        ortImage: values['ort-image'] ?? null,
        repository: values['product-repository'] ?? null,
        ref: values['product-ref'] ?? null,
        run: server && repo && env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null,
        at: now(),
    }));
}
// commandStoreMeta END ****************************************


//**************************************************************
// commandTopics
//**************************************************************
function commandTopics(values, { env, log, today }) {
    requireOptions(values, ['scanner-dir', 'managers', 'out-dir']);
    const blockAt = values['block-at'] ?? 'none';
    if (blockAt !== 'none' && !SEVERITIES.includes(blockAt)) {
        throw new UsageError(`--block-at must be none, ${SEVERITIES.join(', ')}, not ${blockAt}`);
    }
    const day = values.today ?? today;
    if (!isDate(day)) throw new UsageError(`--today must be a day, YYYY-MM-DD, not ${day}`);
    // Checked before the scan results are read: a broken ledger is the
    // cheaper mistake to report, and must never pass silently.
    const ledger = values.ledger === undefined ? emptyLedger() : readLedger(values.ledger, log);
    const results = readManagers(values.managers).map((manager) =>
        readJson(path.join(values['scanner-dir'], manager, 'scan-result.json')));
    const { counts, topics, items } = openTopics(results);
    const report = { format: FORMAT, counts, ...applyLedger(topics, ledger, day) };

    const outDir = values['out-dir'];
    writeJson(path.join(outDir, 'topics.json'), report);
    writeText(path.join(outDir, 'topics.md'), renderTopics(report) + '\n');
    if (values.ledger !== undefined) {
        const additions = noticeAdditions(items, report.topics, additionsSource(values, env, day));
        writeJson(path.join(outDir, 'notice-additions.json'), additions);
        const packages = new Set(additions.additions.map((a) => a.package.id)).size;
        log(`notice additions: ${additions.additions.length} decision(s) add licences to ${packages} package(s)`);
    }
    const drafts = path.join(outDir, 'drafts');
    fs.rmSync(drafts, { recursive: true, force: true });
    for (const topic of report.topics.filter((t) => UNDECIDED.includes(t.status))) {
        writeJson(path.join(drafts, draftFileName(topic)), draftEntry(topic));
    }
    const summary = renderTopics(report, { limit: SUMMARY_TOPIC_ROWS });
    log(summary);
    appendGitHub(env, 'GITHUB_STEP_SUMMARY', summary + '\n');

    const blocking = blockingTopics(report.topics, blockAt);
    if (blocking.length) {
        throw new BlockedError(`${blocking.length} undecided topic(s) at severity ${blockAt} or above,`
            + ` e.g. ${blocking.slice(0, 5).map((t) => t.id).join(', ')}`);
    }
}
// commandTopics END *******************************************


//**************************************************************
// additionsSource
//**************************************************************
/**
 * What notice-additions.json was made from: the product repository and
 * ref, the Legattice commit that ran (options), the day, and on GitHub
 * Actions the run. Unknown parts are null. The commit is an option, not
 * GITHUB_SHA: called from a product's workflow, GITHUB_SHA is the
 * product's commit.
 */
function additionsSource(values, env, day) {
    const server = env.GITHUB_SERVER_URL;
    const repo = env.GITHUB_REPOSITORY;
    return {
        product: { repository: values['product-repository'] ?? null, ref: values['product-ref'] ?? null },
        date: day,
        legattice: values['legattice-commit'] ?? null,
        run: server && repo && env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    };
}
// additionsSource END *****************************************


//**************************************************************
// readLedger
//**************************************************************
/**
 * The decisions and unsigned drafts in a ledger folder (every *.json
 * file), checked. A folder that does not exist is an empty ledger:
 * Git keeps no empty folders, and a wrong path can only leave more
 * topics open, never close one.
 */
function readLedger(dir, log) {
    if (!fs.existsSync(dir)) {
        log(`ledger ${dir} does not exist: no decisions yet`);
        return emptyLedger();
    }
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((fileName) => {
        try {
            return { fileName, entry: readJson(path.join(dir, fileName)) };
        } catch (e) {
            return { fileName, error: e.message };
        }
    });
    try {
        const ledger = checkLedger(files);
        log(`ledger ${dir}: ${ledger.decisions.size} decision(s), ${ledger.drafts.size} unsigned draft(s)`);
        return ledger;
    } catch (e) {
        if (e instanceof LedgerError) throw new UsageError(`${dir}: ${e.message}`);
        throw e;
    }
}
// readLedger END **********************************************


const OPTIONS = {
    out: { type: 'string' },
    manager: { type: 'string' },
    'dry-run': { type: 'string' },
    list: { type: 'string' },
    'analyzer-dir': { type: 'string' },
    'scanner-dir': { type: 'string' },
    managers: { type: 'string' },
    timings: { type: 'string' },
    'max-shards': { type: 'string' },
    plan: { type: 'string' },
    index: { type: 'string' },
    'out-dir': { type: 'string' },
    today: { type: 'string' },
    ledger: { type: 'string' },
    'block-at': { type: 'string' },
    'product-repository': { type: 'string' },
    'product-ref': { type: 'string' },
    'legattice-commit': { type: 'string' },
    'store-status': { type: 'string' },
    find: { type: 'string' },
    'store-dir': { type: 'string' },
    'ort-version': { type: 'string' },
    'ort-image': { type: 'string' },
    fresh: { type: 'boolean' },
};


//**************************************************************
// main
//**************************************************************
/**
 * Runs one command. `deps` replaces the outside world in tests: env,
 * log, the size probe, today's date, the clock and the GitHub API
 * (`github`: route -> JSON; null: the real one, see githubApi).
 */
export async function main(argv, {
    env = process.env,
    log = console.log,
    probe = probeSizes,
    today = new Date().toISOString().slice(0, 10),
    now = () => new Date().toISOString(),
    github = null,
} = {}) {
    let parsed;
    try {
        parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
        throw new UsageError(e.message);
    }
    const [command, ...extra] = parsed.positionals;
    if (extra.length > 0) throw new UsageError(`unexpected argument: ${extra[0]}`);
    const { values } = parsed;
    switch (command) {
        case 'config': return commandConfig(values);
        case 'managers': return commandManagers(values, log);
        case 'plan': return commandPlan(values, { env, log, probe });
        case 'shard': return commandShard(values, log);
        case 'check': return commandCheck(values, log);
        case 'timings': return commandTimings(values, { env, log, today });
        case 'topics': return commandTopics(values, { env, log, today });
        case 'store-find': return commandStoreFind(values, { env, log, github });
        case 'store-use': return commandStoreUse(values, { env, log, now });
        case 'store-meta': return commandStoreMeta(values, { env, now });
        default: throw new UsageError(`unknown command: ${command ?? '(none)'} -- see the head of ${path.basename(fileURLToPath(import.meta.url))}`);
    }
}
// main END ****************************************************


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((e) => {
        console.error(`::error::${e instanceof UsageError || e instanceof BlockedError ? e.message : e.stack}`);
        process.exitCode = 1;
    });
}
