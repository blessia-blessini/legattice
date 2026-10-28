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
// Open topics: every finding of a scan that a person must
// decide. Three rules:
//
//   no-declared-licence -- a package declares no licence; the
//                          evidence is what its files say
//   declared-licence    -- a package's declared licence can only
//                          be met with a copyleft, restricted or
//                          patent licence (no permissive choice)
//   undeclared-licence  -- a licence found in a package's code or
//                          licence files that its declared licence
//                          does not cover
//
// Findings in READMEs, docs, tests and examples are counted as
// mentions, not topics; unidentified references ("see LICENSE")
// are counted, not topics. The product's own repository is
// checked like a package, after its path excludes.
//
// Each topic has a key that stays the same across versions (rule,
// package without version, licence) and an evidence hash that
// changes with what was found. The ledger (src/ledger/) closes a
// key for one evidence hash; new evidence reopens it.
//**************************************************************

import { createHash } from 'node:crypto';

import { provenanceKey } from '../scan/ort-result.mjs';
import { CLASSES, licenceClass, SEVERITIES } from './licence-classes.mjs';
import { archiveRoot, CODE_PLACES, excludedPaths, placeOf } from './places.mjs';
import { baseId, leaves, parseExpression, uncovered } from './spdx.mjs';

/** Format of topics.json; 2: each topic has its ledger status, plus "gone" and "statusCounts". */
export const FORMAT = 2;
/** Evidence lines kept per topic; the count says how many there were. */
export const MAX_EVIDENCE = 20;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** The id of a topic key: "LT-" and 10 hex digits. */
export const topicId = (key) => `LT-${sha256(key).slice(0, 10)}`;
const isNoLicence = (expr) => !expr || /^(NOASSERTION|NONE)$/i.test(expr.trim());

/** "NPM::katex:0.18.10" -> { type: "NPM", name: "katex", version: "0.18.10" } ("NPM:@scope:name:1" keeps the scope). */
export function splitId(id) {
    const [type = '', namespace = '', name = '', version = ''] = String(id).split(':');
    return { type, name: namespace ? `${namespace}/${name}` : name, version };
}


//**************************************************************
// scannedItems
//**************************************************************
/**
 * The packages and projects of one ORT scan result, each with its
 * declared licence, its licence findings, its copyright statements and
 * the SHA-1 of each scanned file:
 * [{ kind, id, declared, findings: [{ licence, path, startLine, endLine, place }],
 *    copyrights: [{ statement, path, startLine, endLine }], sha1: { path: sha1 } }]
 * Paths are relative to the package (archive top folder removed) or to
 * the repository; project findings under a path exclude are dropped.
 */
export function scannedItems(ortResult) {
    const scanner = ortResult?.scanner;
    const content = ortResult?.analyzer?.result;
    if (!scanner || !content) throw new Error('not an ORT scan result');
    const results = new Map(scanner.scan_results.map((r) => [provenanceKey(r.provenance), r]));
    const fileLists = new Map((scanner.files ?? []).map((f) => [provenanceKey(f.provenance), f.files]));
    const files = new Map([...fileLists].map(([key, list]) => [key, list.map((x) => x.path)]));
    const declared = new Map([...content.packages, ...content.projects]
        .map((p) => [p.id, p.declared_licenses_processed?.spdx_expression ?? null]));
    const projects = new Map(content.projects.map((p) => [p.id, p]));
    const isExcluded = excludedPaths(ortResult.repository?.config?.excludes);

    const items = [];
    for (const { id, package_provenance: provenance } of scanner.provenances) {
        const key = provenanceKey(provenance);
        const result = key === null ? undefined : results.get(key);
        if (!result) continue;
        const project = projects.get(id);
        const root = provenance.source_artifact?.url ? archiveRoot(files.get(key) ?? []) : '';
        const relative = (p) => (p.startsWith(root) ? p.slice(root.length) : p);
        const findings = [];
        for (const f of result.summary?.licenses ?? []) {
            const path = relative(f.location.path);
            if (project && isExcluded(path)) continue;
            findings.push({ licence: f.license, path, startLine: f.location.start_line, endLine: f.location.end_line, place: placeOf(path) });
        }
        const copyrights = [];
        for (const c of result.summary?.copyrights ?? []) {
            const path = relative(c.location.path);
            if (project && isExcluded(path)) continue;
            copyrights.push({ statement: c.statement, path, startLine: c.location.start_line, endLine: c.location.end_line });
        }
        const sha1 = {};
        for (const f of fileLists.get(key) ?? []) {
            if (f.sha1) sha1[relative(f.path)] = f.sha1;
        }
        items.push({
            kind: project ? 'project' : 'package',
            id,
            repository: project?.vcs_processed?.url ?? null,
            declared: declared.get(id) ?? null,
            findings,
            copyrights,
            sha1,
        });
    }
    return items;
}
// scannedItems END ********************************************


//**************************************************************
// makeTopic
//**************************************************************
function makeTopic({ rule, item, licence, cls, severity = CLASSES[cls].severity, title, evidence }) {
    const { type, name, version } = splitId(item.id);
    const subject = item.kind === 'project' ? `project:${item.repository ?? item.id}` : `${type}:${name}`;
    const key = [rule, subject, licence ? baseId(licence) : ''].join('|');
    const lines = evidence
        .map((f) => `${f.path}:${f.startLine}-${f.endLine} ${f.licence}`)
        .sort();
    return {
        id: topicId(key),
        key,
        rule,
        severity,
        class: cls,
        kind: item.kind,
        package: item.id,
        name,
        version,
        declared: item.declared,
        licence: licence ?? null,
        title,
        evidenceHash: sha256(JSON.stringify([item.id, item.declared, lines])).slice(0, 16),
        evidenceCount: lines.length,
        evidence: lines.slice(0, MAX_EVIDENCE),
    };
}
// makeTopic END ***********************************************


/** The class of a set of licences: the most demanding one. */
function worstClass(ids) {
    const order = Object.keys(CLASSES);
    return ids.map(licenceClass).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? 'unknown';
}


//**************************************************************
// itemTopics
//**************************************************************
/** Topics and counts of one package or project (see the rules above). */
export function itemTopics(item) {
    const topics = [];
    const counts = { mentions: 0, unidentified: 0 };
    const { name, version } = splitId(item.id);
    const label = `${name} ${version}`.trim();
    const codeFindings = item.findings.filter((f) => CODE_PLACES.has(f.place));

    if (item.kind === 'package' && isNoLicence(item.declared)) {
        const found = [...new Set(codeFindings.flatMap((f) => leaves(parseExpression(f.licence))))]
            .filter((l) => licenceClass(l) !== 'unknown');
        const cls = found.length ? worstClass(found) : 'unknown';
        // Never below medium: without a declared licence there is no
        // permission at all until a person settles it.
        const severity = CLASSES[cls].severity === 'high' ? 'high' : 'medium';
        topics.push(makeTopic({
            rule: 'no-declared-licence',
            item,
            licence: null,
            cls,
            severity,
            title: `${label} declares no licence; its files say: ${found.join(', ') || 'nothing identifiable'}`,
            evidence: codeFindings,
        }));
        return { topics, counts };
    }

    const declaredTree = parseExpression(item.declared);
    if (item.kind === 'package') {
        const demanding = uncovered(declaredTree, (l) => licenceClass(l) === 'permissive');
        if (demanding.length) {
            topics.push(makeTopic({
                rule: 'declared-licence',
                item,
                licence: demanding.join(' / '),
                cls: worstClass(demanding),
                title: `${label} is licensed ${item.declared}: no permissive choice (${demanding.join(', ')})`,
                evidence: [],
            }));
        }
    }

    const declaredBases = new Set(leaves(declaredTree).map(baseId));
    const isCovered = (l) => declaredBases.has(baseId(l)) || licenceClass(l) === 'unknown';
    const byLicence = new Map();
    for (const f of item.findings) {
        const tree = parseExpression(f.licence);
        const missing = uncovered(tree, isCovered);
        if (!missing.length) {
            if (leaves(tree).some((l) => licenceClass(l) === 'unknown')) counts.unidentified += 1;
            continue;
        }
        if (!CODE_PLACES.has(f.place)) {
            counts.mentions += 1;
            continue;
        }
        for (const leaf of missing) {
            const base = baseId(leaf);
            if (!byLicence.has(base)) byLicence.set(base, { leaf, findings: [] });
            byLicence.get(base).findings.push(f);
        }
    }
    for (const { leaf, findings } of byLicence.values()) {
        const places = [...new Set(findings.map((f) => f.place))].join(', ');
        topics.push(makeTopic({
            rule: 'undeclared-licence',
            item,
            licence: leaf,
            cls: licenceClass(leaf),
            title: `${label} (${item.declared ?? 'no licence'}) contains ${leaf} in ${findings.length} place(s): ${places}`,
            evidence: findings,
        }));
    }
    return { topics, counts };
}
// itemTopics END **********************************************


//**************************************************************
// openTopics
//**************************************************************
/**
 * All topics of a product from its scan results (one per package
 * manager). A topic found through two managers (the product's own
 * repository) is listed once. Sorted by severity, then title.
 * `items`: the packages and projects they came from (scannedItems),
 * each once, for what the decisions add to the notices.
 */
export function openTopics(ortResults) {
    const topics = new Map();
    const counts = { packages: 0, projects: 0, mentions: 0, unidentified: 0 };
    const seenItems = new Set();
    const items = [];
    for (const result of ortResults) {
        for (const item of scannedItems(result)) {
            const itemKey = item.kind === 'project' ? `project:${item.repository ?? item.id}` : item.id;
            if (seenItems.has(itemKey)) continue;
            seenItems.add(itemKey);
            items.push(item);
            counts[item.kind === 'project' ? 'projects' : 'packages'] += 1;
            const found = itemTopics(item);
            counts.mentions += found.counts.mentions;
            counts.unidentified += found.counts.unidentified;
            for (const topic of found.topics) {
                if (!topics.has(topic.key)) topics.set(topic.key, topic);
            }
        }
    }
    const rank = (t) => SEVERITIES.indexOf(t.severity);
    const sorted = [...topics.values()].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'en'));
    return { format: FORMAT, counts, topics: sorted, items };
}
// openTopics END **********************************************
