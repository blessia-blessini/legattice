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
// What Legattice reads from ORT's output, and the one change it
// makes to an analyzer result. Written against ORT 97.2.0:
//   dry run:         "Found in total N definition file(s) from the
//                     following K package manager(s):" + one line
//   analyzer result: analyzer.result.projects / .packages
//   scan result:     scanner.start_time / .provenances / .scan_results
// A format change fails loudly here instead of planning nonsense.
//**************************************************************

/** ORT package manager ids are plain words ("Cargo", "NPM", "SpdxDocumentFile"). */
export const MANAGER_NAME_RE = /^[A-Za-z0-9]+$/;

const DRY_RUN_FOUND_RE = /^Found in total \d+ definition file\(s\) from the following (\d+) package manager\(s\):$/;
const DRY_RUN_NONE = 'No definition files found.';
const ANSI_RE = /\x1b\[[0-9;]*m/g;


//**************************************************************
// checkManagerName
//**************************************************************
/** Returns the name, or throws: names end up in file names and shell loops. */
export function checkManagerName(name) {
    if (typeof name !== 'string' || !MANAGER_NAME_RE.test(name)) {
        throw new Error(`bad package manager name: ${JSON.stringify(name)}`);
    }
    return name;
}
// checkManagerName END ****************************************


//**************************************************************
// parseManagerList
//**************************************************************
/** "Cargo, NPM" -> ["Cargo", "NPM"]: checked, without duplicates, sorted. */
export function parseManagerList(text) {
    const names = String(text).split(',').map((s) => s.trim()).filter(Boolean).map(checkManagerName);
    return [...new Set(names)].sort();
}
// parseManagerList END ****************************************


//**************************************************************
// parseDryRunManagers
//**************************************************************
/**
 * The package managers `ort analyze --dry-run` found in a product.
 * Empty when ORT found no definition file at all. Throws when the
 * output holds neither answer, or the count does not match the list.
 */
export function parseDryRunManagers(output) {
    const lines = String(output).replace(ANSI_RE, '').split(/\r?\n/).map((l) => l.trim());
    const at = lines.findIndex((l) => DRY_RUN_FOUND_RE.test(l));
    if (at >= 0) {
        const count = Number(lines[at].match(DRY_RUN_FOUND_RE)[1]);
        const names = parseManagerList(lines[at + 1] ?? '');
        if (names.length !== count) {
            throw new Error(`ORT dry run: it reports ${count} package manager(s), but ${names.length} were read`);
        }
        return names;
    }
    if (lines.includes(DRY_RUN_NONE)) return [];
    throw new Error('ORT dry run: no package manager list in its output (has the ORT output format changed?)');
}
// parseDryRunManagers END *************************************


//**************************************************************
// analyzerContent
//**************************************************************
/** analyzer.result of an ORT result file, or throws naming the manager. */
function analyzerContent(manager, ortResult) {
    const content = ortResult?.analyzer?.result;
    if (!content || !Array.isArray(content.packages) || !Array.isArray(content.projects)) {
        throw new Error(`${manager}: not an ORT analyzer result`);
    }
    return content;
}
// analyzerContent END *****************************************


/** "url@revision" of an ORT VCS info. */
export const vcsKey = (vcs) => `${vcs?.url ?? ''}@${vcs?.revision ?? ''}`;


//**************************************************************
// workUnits
//**************************************************************
/**
 * Split everything one scan would do into units that can run apart.
 *
 * `analyzed`: [{ manager, result }], one ORT analyzer result per package
 * manager (each manager is analyzed on its own; ORT mixes up projects of
 * the same name and version from two managers).
 *
 * - One unit per package: ORT scans the packages of a result one by one,
 *   and skips a package whose source_code_origins is an empty list, so a
 *   shard can be given any subset (filterAnalyzerResult).
 * - One unit per group of managers whose projects come from the same
 *   repositories: ORT scans all projects of a result together, it cannot
 *   leave one out. Managers of one product usually share the repository
 *   (Cargo, NPM and Unmanaged in Lattice); grouping scans it once.
 *
 * Packages ORT would skip anyway (no source origins, metadata only) are
 * left out. Packages that are only in excluded scopes are not known here;
 * they cost a shard nothing, as ORT skips them.
 */
export function workUnits(analyzed) {
    const units = [];
    const projectGroups = new Map();
    for (const { manager, result } of analyzed) {
        checkManagerName(manager);
        const content = analyzerContent(manager, result);
        for (const pkg of content.packages) {
            if (pkg.source_code_origins?.length === 0 || pkg.is_metadata_only === true) continue;
            units.push({
                key: `package:${manager}:${pkg.id}`,
                kind: 'package',
                manager,
                id: pkg.id,
                url: pkg.source_artifact?.url || null,
            });
        }
        const repos = new Map();
        for (const project of content.projects) {
            const vcs = project.vcs_processed ?? {};
            repos.set(vcsKey(vcs), { url: vcs.url ?? '', revision: vcs.revision ?? '' });
        }
        if (repos.size === 0) continue;
        const groupKey = [...repos.keys()].sort().join(' ');
        const group = projectGroups.get(groupKey)
            ?? { key: `project:${groupKey}`, kind: 'project', managers: [], repos: [...repos.values()] };
        group.managers.push(manager);
        projectGroups.set(groupKey, group);
    }
    return [...units, ...projectGroups.values()];
}
// workUnits END ***********************************************


//**************************************************************
// filterAnalyzerResult
//**************************************************************
/**
 * A copy of an analyzer result in which ORT will scan only the packages
 * in `keepIds`: every other package gets an empty source_code_origins
 * list, which ORT's scanner skips ("Not scanning the following
 * package(s) with empty source code origins"). Projects are untouched;
 * they are switched on or off with `ort scan --package-types`.
 *
 * A package curation that sets source code origins is applied after
 * this and wins: that package is then scanned by every shard. Slower,
 * not wrong -- all shards store the same result.
 */
export function filterAnalyzerResult(ortResult, keepIds) {
    const copy = structuredClone(ortResult);
    for (const pkg of analyzerContent('shard', copy).packages) {
        if (!keepIds.has(pkg.id)) pkg.source_code_origins = [];
    }
    return copy;
}
// filterAnalyzerResult END ************************************


//**************************************************************
// provenanceKey
//**************************************************************
/** One key per scanned source: the archive URL, or repository URL + revision. */
export function provenanceKey(provenance) {
    if (provenance?.source_artifact?.url) return `artifact:${provenance.source_artifact.url}`;
    const vcs = provenance?.vcs_info;
    if (vcs?.url) return `vcs:${vcs.url}@${provenance.resolved_revision ?? vcs.revision ?? ''}`;
    return null;
}
// provenanceKey END *******************************************


/** Whole seconds between two ORT timestamps, or null. */
function secondsBetween(start, end) {
    const s = Date.parse(start);
    const e = Date.parse(end);
    return Number.isFinite(s) && Number.isFinite(e) ? Math.max(0, (e - s) / 1000) : null;
}


//**************************************************************
// scanTimings
//**************************************************************
/**
 * How long each package and project took to scan, read from one ORT
 * scan result (after the merge job's scan, which holds every result).
 *
 * A result read from storage keeps the times of the run that made it,
 * so this measures the real scan, wherever it ran. A result that started
 * after this ORT run began was scanned now, not by a shard: `fresh`
 * counts those, so a shard that failed or ran out of time shows up.
 *
 * - packages: { id: { seconds } } -- seconds 0 for a package ORT did not
 *   scan at all (excluded scope, no source origins, metadata only).
 * - projects: { repository url: { seconds, revision } }
 */
export function scanTimings(ortResult) {
    const scanner = ortResult?.scanner;
    if (!scanner || !Array.isArray(scanner.scan_results) || !Array.isArray(scanner.provenances)) {
        throw new Error('not an ORT scan result');
    }
    const content = analyzerContent('scan', ortResult);
    const runStart = Date.parse(scanner.start_time);

    const bySource = new Map();
    for (const result of scanner.scan_results) {
        const key = provenanceKey(result.provenance);
        const seconds = secondsBetween(result.summary?.start_time, result.summary?.end_time);
        if (key === null || seconds === null) continue;
        const fresh = Date.parse(result.summary.start_time) >= runStart;
        const known = bySource.get(key) ?? { seconds: 0, fresh: false };
        bySource.set(key, { seconds: known.seconds + seconds, fresh: known.fresh || fresh });
    }

    const projects = new Map(content.projects.map((p) => [p.id, p]));
    const resolved = new Map(scanner.provenances.map((p) => [p.id, provenanceKey(p.package_provenance)]));
    const timings = { packages: {}, projects: {}, fresh: { count: 0, seconds: 0 } };
    for (const [id, key] of resolved) {
        const scanned = key === null ? undefined : bySource.get(key);
        if (!scanned) continue;
        const seconds = Math.round(scanned.seconds);
        const project = projects.get(id);
        if (project) {
            const vcs = project.vcs_processed ?? {};
            if (vcs.url) timings.projects[vcs.url] = { seconds, revision: vcs.revision ?? '' };
        } else {
            timings.packages[id] = { seconds };
        }
    }
    for (const pkg of content.packages) {
        if (!resolved.has(pkg.id)) timings.packages[pkg.id] = { seconds: 0 };
    }
    for (const scanned of bySource.values()) {
        if (!scanned.fresh) continue;
        timings.fresh.count += 1;
        timings.fresh.seconds += Math.round(scanned.seconds);
    }
    return timings;
}
// scanTimings END *********************************************
