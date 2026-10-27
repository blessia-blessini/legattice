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
// The scan plan: how long each work unit will take, and which
// shard (parallel job) scans it.
//
// The plan only decides how fast a scan finishes, never what it
// finds: the merge job runs a full ORT scan over the stored
// results, and scans itself whatever no shard delivered. A wrong
// estimate costs time, not correctness.
//
// Estimates, best first:
//   stored  -- scanned in an earlier run, its result is in the
//              cache: a lookup
//   size    -- source archive size x seconds per MB, measured per
//              package type from earlier runs (DEFAULT_MODEL until
//              there are MIN_SAMPLES measurements)
//   measured-- a project: the last scan of the same repository
//   unknown -- nothing known (a Git repository has no size before
//              it is cloned): UNKNOWN_SECONDS
//**************************************************************

/**
 * Seconds = overhead + MB of the source archive x seconds per MB.
 * Fitted to the first measured run: ScanCode 32.5.0, 4 processes, 331
 * npm archives of 39.6 MB in all, 3375 s (correlation 0.87;
 * Lattice v0.3.50, legattice run 40376495445).
 */
export const DEFAULT_MODEL = Object.freeze({ overheadSeconds: 5, secondsPerMB: 43 });
/** Measurements per package type before they replace DEFAULT_MODEL. */
export const MIN_SAMPLES = 20;
/** A unit nothing is known about. Pessimistic: Git clones are the slow ones. */
export const UNKNOWN_SECONDS = 300;
/** A unit whose result is already stored. */
export const STORED_SECONDS = 2;
/** Less work than this does not get a shard of its own: a job costs ~2-3 minutes to start ORT. */
export const MIN_SHARD_SECONDS = 300;
/** Timings not seen for this long are dropped (old versions of packages). */
export const TIMINGS_MAX_AGE_DAYS = 180;
/** Version of the plan and timings file formats. */
export const FORMAT = 1;

const BYTES_PER_MB = 1e6;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "NPM::katex:0.18.10" -> "NPM" */
export const idType = (id) => String(id).split(':')[0];

/** Timings key of a project: its repository URL. */
export const projectTimingsKey = (url) => `project:${url}`;


//**************************************************************
// calibrate
//**************************************************************
/**
 * Seconds per MB for each package type with enough measurements in
 * `timings` (a timings file). Types without enough are left out, so the
 * caller falls back to DEFAULT_MODEL.
 */
export function calibrate(timings) {
    const sums = new Map();
    for (const [key, entry] of Object.entries(timings?.units ?? {})) {
        if (key.startsWith('project:') || !(entry.seconds > 0) || !(entry.bytes > 0)) continue;
        const type = idType(key);
        const sum = sums.get(type) ?? { count: 0, seconds: 0, mb: 0 };
        sum.count += 1;
        sum.seconds += Math.max(0, entry.seconds - DEFAULT_MODEL.overheadSeconds);
        sum.mb += entry.bytes / BYTES_PER_MB;
        sums.set(type, sum);
    }
    const models = new Map();
    for (const [type, sum] of sums) {
        if (sum.count < MIN_SAMPLES) continue;
        models.set(type, {
            overheadSeconds: DEFAULT_MODEL.overheadSeconds,
            secondsPerMB: sum.seconds / sum.mb,
        });
    }
    return models;
}
// calibrate END ***********************************************


//**************************************************************
// estimateUnit
//**************************************************************
/**
 * { seconds, basis, bytes } for one work unit (see workUnits).
 * `sizes`: Map of archive URL -> bytes (null: unknown).
 */
export function estimateUnit(unit, { timings, sizes, models }) {
    const known = timings?.units ?? {};
    if (unit.kind === 'package') {
        if (known[unit.id]) return { seconds: STORED_SECONDS, basis: 'stored', bytes: known[unit.id].bytes ?? null };
        const bytes = unit.url ? sizes.get(unit.url) ?? null : null;
        if (!bytes) return { seconds: UNKNOWN_SECONDS, basis: 'unknown', bytes: null };
        const model = models.get(idType(unit.id)) ?? DEFAULT_MODEL;
        const seconds = Math.round(model.overheadSeconds + model.secondsPerMB * bytes / BYTES_PER_MB);
        return { seconds, basis: 'size', bytes };
    }
    let seconds = 0;
    const bases = new Set();
    for (const repo of unit.repos) {
        const last = known[projectTimingsKey(repo.url)];
        if (last && last.revision === repo.revision) {
            seconds += STORED_SECONDS;
            bases.add('stored');
        } else if (last) {
            seconds += last.seconds;
            bases.add('measured');
        } else {
            seconds += UNKNOWN_SECONDS;
            bases.add('unknown');
        }
    }
    const basis = ['unknown', 'measured', 'stored'].find((b) => bases.has(b)) ?? 'stored';
    return { seconds, basis, bytes: null };
}
// estimateUnit END ********************************************


//**************************************************************
// compareUnits
//**************************************************************
/** Longest first; equal ones by key, so the same input gives the same plan. */
function compareUnits(a, b) {
    if (b.seconds !== a.seconds) return b.seconds - a.seconds;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
// compareUnits END ********************************************


//**************************************************************
// packShards
//**************************************************************
/**
 * Spread units ({ key, seconds }) over at most `maxShards` shards of
 * nearly equal total time: longest unit first, each into the shard with
 * the least work so far ("longest processing time first"). The result
 * is within 4/3 of the best possible split, and never faster than the
 * longest single unit.
 *
 * Fewer shards than allowed when there is little work (MIN_SHARD_SECONDS
 * each) or few units; none when there are no units. Stored units (basis
 * "stored") do not count as work: 908 lookups are no reason to start 7
 * jobs (legattice run 40491614153).
 */
export function packShards(units, maxShards) {
    if (!Number.isInteger(maxShards) || maxShards < 1) {
        throw new Error(`bad shard count: ${maxShards}`);
    }
    if (units.length === 0) return [];
    const work = units.reduce((sum, u) => sum + (u.basis === 'stored' ? 0 : u.seconds), 0);
    const count = Math.min(maxShards, units.length, Math.max(1, Math.ceil(work / MIN_SHARD_SECONDS)));
    const shards = Array.from({ length: count }, (_, i) => ({ index: i + 1, seconds: 0, units: [] }));
    for (const unit of [...units].sort(compareUnits)) {
        let least = shards[0];
        for (const shard of shards) {
            if (shard.seconds < least.seconds) least = shard;
        }
        least.units.push(unit.key);
        least.seconds += unit.seconds;
    }
    return shards;
}
// packShards END **********************************************


//**************************************************************
// planScan
//**************************************************************
/**
 * The plan file: every unit with its estimate and shard, and the shards.
 * `sizes`: Map archive URL -> bytes; `timings`: the timings file or null.
 */
export function planScan({ units, timings = null, sizes = new Map(), maxShards }) {
    const models = calibrate(timings);
    const costed = units.map((unit) => ({ ...unit, ...estimateUnit(unit, { timings, sizes, models }) }));
    const shards = packShards(costed, maxShards);
    const shardOf = new Map();
    for (const shard of shards) {
        for (const key of shard.units) shardOf.set(key, shard.index);
    }
    return {
        format: FORMAT,
        totalSeconds: costed.reduce((sum, u) => sum + u.seconds, 0),
        longestUnitSeconds: costed.reduce((max, u) => Math.max(max, u.seconds), 0),
        models: Object.fromEntries(models),
        shards: shards.map(({ index, seconds, units: keys }) => ({ index, seconds, unitCount: keys.length })),
        units: costed.map((unit) => ({ ...unit, shard: shardOf.get(unit.key) })),
    };
}
// planScan END ************************************************


//**************************************************************
// shardRuns
//**************************************************************
/**
 * What shard `index` runs: one ORT scan per package manager it has work
 * for -- [{ manager, packageIds, packageTypes }], packageTypes being the
 * value of `ort scan --package-types` (PROJECT, PACKAGE or both).
 */
export function shardRuns(plan, index) {
    if (!plan || plan.format !== FORMAT || !Array.isArray(plan.units)) {
        throw new Error('not a scan plan of this version');
    }
    if (!plan.shards.some((s) => s.index === index)) {
        throw new Error(`the plan has no shard ${index}`);
    }
    const runs = new Map();
    const runOf = (manager) => {
        if (!runs.has(manager)) runs.set(manager, { manager, packageIds: [], project: false });
        return runs.get(manager);
    };
    for (const unit of plan.units) {
        if (unit.shard !== index) continue;
        if (unit.kind === 'package') runOf(unit.manager).packageIds.push(unit.id);
        else for (const manager of unit.managers) runOf(manager).project = true;
    }
    return [...runs.values()]
        .sort((a, b) => (a.manager < b.manager ? -1 : 1))
        .map(({ manager, packageIds, project }) => ({
            manager,
            packageIds,
            packageTypes: [project && 'PROJECT', packageIds.length > 0 && 'PACKAGE'].filter(Boolean).join(','),
        }));
}
// shardRuns END ***********************************************


//**************************************************************
// mergeTimings
//**************************************************************
/**
 * The new timings file: `previous` updated with what this run measured
 * (`measured`: scanTimings of each manager), stamped `today`, archive
 * sizes taken from the plan. Entries not seen for TIMINGS_MAX_AGE_DAYS
 * are dropped.
 */
export function mergeTimings({ previous = null, measured, plan, today }) {
    const todayMs = Date.parse(today);
    if (!Number.isFinite(todayMs)) throw new Error(`bad date: ${today}`);
    const bytesById = new Map();
    for (const unit of plan?.units ?? []) {
        if (unit.kind === 'package' && unit.bytes) bytesById.set(unit.id, unit.bytes);
    }
    const units = {};
    for (const [key, entry] of Object.entries(previous?.units ?? {})) {
        const seenMs = Date.parse(entry.seen);
        if (Number.isFinite(seenMs) && todayMs - seenMs <= TIMINGS_MAX_AGE_DAYS * DAY_MS) units[key] = entry;
    }
    for (const run of measured) {
        for (const [id, { seconds }] of Object.entries(run.packages)) {
            units[id] = { seconds, bytes: bytesById.get(id) ?? units[id]?.bytes ?? null, seen: today };
        }
        for (const [url, { seconds, revision }] of Object.entries(run.projects)) {
            units[projectTimingsKey(url)] = { seconds, revision, seen: today };
        }
    }
    return { format: FORMAT, units };
}
// mergeTimings END ********************************************


/** "754 s" -> "12.6 min" */
const minutes = (seconds) => `${(seconds / 60).toFixed(1)} min`;


//**************************************************************
// renderPlanSummary
//**************************************************************
/** The plan as Markdown, for the job summary. */
export function renderPlanSummary(plan) {
    const bases = {};
    for (const unit of plan.units) bases[unit.basis] = (bases[unit.basis] ?? 0) + 1;
    const longest = [...plan.units].sort(compareUnits).slice(0, 5);
    const lines = [
        '## Scan plan',
        '',
        `${plan.units.length} work units, about ${minutes(plan.totalSeconds)} of scanning in all,`
            + ` spread over ${plan.shards.length} shard(s).`
            + ` No shard can finish sooner than the longest unit (${minutes(plan.longestUnitSeconds)}).`,
        '',
        `Estimates: ${Object.entries(bases).sort().map(([b, n]) => `${n} ${b}`).join(', ') || 'none'}.`,
        '',
        '| Shard | Units | Estimate |',
        '|---:|---:|---:|',
        ...plan.shards.map((s) => `| ${s.index} | ${s.unitCount} | ${minutes(s.seconds)} |`),
        '',
        '| Longest units | Estimate | Basis | Shard |',
        '|---|---:|---|---:|',
        ...longest.map((u) => `| ${u.kind === 'package' ? u.id : `project (${u.managers.join(', ')})`}`
            + ` | ${minutes(u.seconds)} | ${u.basis} | ${u.shard} |`),
        '',
    ];
    return lines.join('\n');
}
// renderPlanSummary END ***************************************
