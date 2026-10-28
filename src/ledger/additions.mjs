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
// Notice additions: what the ledger's decisions add to a
// product's notices (docs/notices.md).
//
// A package's notices come from its declared licence; the product
// writes those itself. A decision can settle a finding as a licence
// the package does not declare -- code from another project inside
// it, under its own licence. That licence, the files and lines it
// was found in, and the copyright lines of those files are an
// addition: the product quotes them in its notices.
//
// Only closed topics count: a reopened one is decided again first.
// Not an addition: a licence the package declares anyway (a choice
// such as MIT out of "Apache-2.0 OR MIT"), a package without a
// declared licence (the product settles its own metadata), the
// product's own repository, and not-shipped or remove.
//**************************************************************

import { CODE_PLACES } from '../topics/places.mjs';
import { baseId, leaves, parseExpression } from '../topics/spdx.mjs';
import { splitId } from '../topics/topics.mjs';

/** Format of notice-additions.json. */
export const ADDITIONS_FORMAT = 1;

/** ORT package type -> the ecosystem name a product's notices use. */
const ECOSYSTEMS = Object.freeze({ Crate: 'cargo', NPM: 'npm' });

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);


//**************************************************************
// addedLicences
//**************************************************************
/**
 * The licences a topic's decision adds to its package's declared
 * licence, as SPDX ids; [] when it adds none (see the head of this
 * file).
 */
export function addedLicences(topic) {
    if (topic.status !== 'closed' || topic.kind !== 'package' || !topic.licence || !topic.decision) return [];
    const { outcome, licence } = topic.decision;
    let settled;
    if (outcome === 'accept-as') settled = leaves(parseExpression(licence));
    else if (outcome === 'comply') settled = [topic.licence];
    else return [];
    const declared = new Set(leaves(parseExpression(topic.declared)).map(baseId));
    const added = settled.filter((l) => !declared.has(baseId(l)));
    return [...new Set(added)].sort(byText);
}
// addedLicences END *******************************************


//**************************************************************
// topicFiles
//**************************************************************
/**
 * The files a topic was found in, as the product can check and quote
 * them: [{ path, sha1, lines: [[start, end], ...] }], sorted. The same
 * findings the topic's evidence lists: code and licence files that
 * carry the topic's licence.
 */
export function topicFiles(topic, item) {
    const wanted = baseId(topic.licence);
    const byPath = new Map();
    for (const f of item.findings) {
        if (!CODE_PLACES.has(f.place)) continue;
        if (!leaves(parseExpression(f.licence)).some((l) => baseId(l) === wanted)) continue;
        if (!byPath.has(f.path)) byPath.set(f.path, new Set());
        byPath.get(f.path).add(`${f.startLine}-${f.endLine}`);
    }
    return [...byPath.keys()].sort(byText).map((path) => ({
        path,
        sha1: item.sha1?.[path] ?? null,
        lines: [...byPath.get(path)]
            .map((r) => r.split('-').map(Number))
            .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    }));
}
// topicFiles END **********************************************


//**************************************************************
// noticeAdditions
//**************************************************************
/**
 * notice-additions.json from the scanned items (openTopics().items)
 * and the topics after the ledger (applyLedger().topics). `source`
 * says what was scanned and by which run; it is copied as given.
 */
export function noticeAdditions(items, topics, source = {}) {
    const itemsById = new Map(items.filter((i) => i.kind === 'package').map((i) => [i.id, i]));
    const additions = [];
    for (const topic of topics) {
        const licences = addedLicences(topic);
        const item = itemsById.get(topic.package);
        if (!licences.length || !item) continue;
        const files = topicFiles(topic, item);
        const paths = new Set(files.map((f) => f.path));
        const copyrights = [...new Set(item.copyrights.filter((c) => paths.has(c.path)).map((c) => c.statement))].sort(byText);
        const { type, name, version } = splitId(item.id);
        const { outcome, licence, rationale, decidedBy, date } = topic.decision;
        additions.push({
            topic: topic.id,
            package: { id: item.id, ecosystem: ECOSYSTEMS[type] ?? type.toLowerCase(), name, version },
            licences,
            decision: { outcome, licence: licence || null, rationale, decidedBy, date },
            files,
            copyrights,
        });
    }
    additions.sort((a, b) => byText(a.package.id, b.package.id) || byText(a.topic, b.topic));
    return { format: ADDITIONS_FORMAT, source, additions };
}
// noticeAdditions END *****************************************
