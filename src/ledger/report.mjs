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
// The topic list as Markdown, after the ledger: what needs a
// person first (reopened, pending removal, open by severity),
// then what the ledger closed, then decisions no longer needed.
//**************************************************************

import { SEVERITIES } from '../topics/licence-classes.mjs';

/** Markdown table cell: one line, no pipes. */
const cell = (text) => String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|');

/** "accept-as MIT, Jane Roe, 2026-10-27" */
const decisionText = (d) => [`${d.outcome}${d.licence ? ` ${d.licence}` : ''}`, d.decidedBy, d.date].join(', ');

const whereFirst = (t) => `${cell(t.evidence[0] ?? '')}${t.evidenceCount > 1 ? ` (+${t.evidenceCount - 1})` : ''}`;


//**************************************************************
// table
//**************************************************************
/** One section: heading, table, at most `limit` rows. */
function table(lines, heading, columns, rows, limit) {
    if (!rows.length) return;
    lines.push(`### ${heading} (${rows.length})`, '', `| ${columns.join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`);
    for (const row of rows.slice(0, limit)) lines.push(`| ${row.join(' | ')} |`);
    if (rows.length > limit) lines.push(`| … | ${rows.length - limit} more in topics.md |${' |'.repeat(columns.length - 2)}`);
    lines.push('');
}
// table END ***************************************************


//**************************************************************
// renderTopics
//**************************************************************
/**
 * The report of applyLedger plus the scan counts; at most `limit`
 * rows per section (topics.md gets them all).
 */
export function renderTopics({ counts, topics, gone, statusCounts }, { limit = Infinity } = {}) {
    const open = topics.filter((t) => t.status === 'open');
    const bySeverity = (s) => open.filter((t) => t.severity === s);
    const toDecide = topics.length - statusCounts.closed;
    const lines = [
        '## Open topics',
        '',
        `${topics.length} topic(s) in ${counts.packages} package(s) and ${counts.projects} project(s).`
            + ` **To decide: ${toDecide}**`
            + ` (${statusCounts.reopened} reopened, ${statusCounts['pending-removal']} pending removal,`
            + ` ${open.length} open: ${SEVERITIES.map((s) => `${bySeverity(s).length} ${s}`).join(', ')}).`
            + ` Closed by the ledger: ${statusCounts.closed}.`
            + ` Not topics: ${counts.mentions} licence mention(s) in READMEs, docs and tests;`
            + ` ${counts.unidentified} unidentified reference(s) such as "see LICENSE".`,
        '',
        '*Found by tools, not legal advice. Each topic needs a person\'s decision, recorded in the ledger'
            + ' (docs/ledger.md); drafts/ holds a file to fill in for each topic still to decide.*',
        '',
    ];
    table(lines, 'reopened', ['Topic', 'Severity', 'What', 'Why'],
        topics.filter((t) => t.status === 'reopened').map((t) => [t.id, t.severity, cell(t.title), cell(t.reasons.join('; '))]), limit);
    table(lines, 'pending removal', ['Topic', 'Severity', 'What', 'Decided'],
        topics.filter((t) => t.status === 'pending-removal').map((t) => [t.id, t.severity, cell(t.title), cell(decisionText(t.decision))]), limit);
    for (const severity of SEVERITIES) {
        table(lines, severity, ['Topic', 'What', 'Where (first)'],
            bySeverity(severity).map((t) => [t.id, cell(t.title), whereFirst(t)]), limit);
    }
    table(lines, 'closed', ['Topic', 'What', 'Decision'],
        topics.filter((t) => t.status === 'closed').map((t) => [t.id, cell(t.title), cell(decisionText(t.decision))]), limit);
    if (gone.length) {
        lines.push('Decisions whose topic this scan did not find: the component left the product, or the scan did'
            + ' not cover it (fewer package managers). Delete such a file once the topic is certainly gone.', '');
        table(lines, 'decisions not found', ['Topic', 'What', 'Decision'],
            gone.map((g) => [g.id, cell(g.title), cell(decisionText(g.decision))]), limit);
    }
    return lines.join('\n');
}
// renderTopics END ********************************************
