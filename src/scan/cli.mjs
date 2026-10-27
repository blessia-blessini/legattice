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
//   timings  --scanner-dir D --managers F --plan F --out F
//            [--timings F] [--today YYYY-MM-DD]
//                                        the updated timings file
//   topics   --scanner-dir D --managers F --out-dir D
//            [--ledger L] [--today YYYY-MM-DD]
//            [--block-at none|high|medium|low]
//                                        D/topics.json + D/topics.md:
//                                        what a person must decide,
//                                        after the decisions in the
//                                        ledger folder L; D/drafts/:
//                                        a ledger file to fill in per
//                                        undecided topic, named
//                                        1-high.open.<id>.json.
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

import { ortConfigYaml } from './ort-config.mjs';
import { filterAnalyzerResult, parseDryRunManagers, parseManagerList, scanTimings, workUnits } from './ort-result.mjs';
import { mergeTimings, planScan, renderPlanSummary, shardRuns } from './plan.mjs';
import { probeSizes } from './sizes.mjs';
import {
    applyLedger, blockingTopics, checkLedger, draftEntry, draftFileName, emptyLedger, isDate, LedgerError, UNDECIDED,
} from '../ledger/ledger.mjs';
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
    const summary = renderPlanSummary(plan);
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
// commandTimings
//**************************************************************
function commandTimings(values, { env, log, today }) {
    requireOptions(values, ['scanner-dir', 'managers', 'plan', 'out']);
    const measured = readManagers(values.managers).map((manager) =>
        scanTimings(readJson(path.join(values['scanner-dir'], manager, 'scan-result.json'))));
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
    const { counts, topics } = openTopics(results);
    const report = { format: FORMAT, counts, ...applyLedger(topics, ledger, day) };

    const outDir = values['out-dir'];
    writeJson(path.join(outDir, 'topics.json'), report);
    writeText(path.join(outDir, 'topics.md'), renderTopics(report) + '\n');
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
};


//**************************************************************
// main
//**************************************************************
/**
 * Runs one command. `deps` replaces the outside world in tests: env,
 * log, the size probe and today's date.
 */
export async function main(argv, {
    env = process.env,
    log = console.log,
    probe = probeSizes,
    today = new Date().toISOString().slice(0, 10),
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
        case 'timings': return commandTimings(values, { env, log, today });
        case 'topics': return commandTopics(values, { env, log, today });
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
