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
// The ledger: one file per decided topic, written by a person,
// products/<product>/ledger/[<label>.]<topic id>.json. The only
// place a human writes; everything else is computed
// (docs/ledger.md).
//
// A decision holds for the evidence it was made on. Each topic
// of a scan gets a status:
//
//   open             -- no decision
//   reopened         -- decided, but the evidence changed or the
//                       decision expired: decide again
//   pending-removal  -- decided "remove", still found
//   closed           -- decided, same evidence, not expired
//
// A file counts as a decision only when it is signed (decidedBy
// and date). An unsigned file is a draft being worked on: it
// closes nothing, its topic is marked "drafting". Half-signed is
// an error. A decision or draft whose topic the scan no longer
// finds is "gone".
// This module only checks and compares; it never decides.
//**************************************************************

import { MAX_EVIDENCE, topicId } from '../topics/topics.mjs';
import { SEVERITIES } from '../topics/licence-classes.mjs';
import { isExpression } from '../topics/spdx.mjs';

export const LEDGER_FORMAT = 1;

/** What a person can decide about a topic. */
export const OUTCOMES = Object.freeze({
    'accept-as': 'settled as the licence named in "licence" (e.g. a package that declares none)',
    comply: 'the licence applies; the product meets its conditions (rationale says how)',
    'not-shipped': 'the files with the finding are not part of the product',
    remove: 'the component must leave the product',
});

/** Statuses that still need a person; `closed` does not. */
export const UNDECIDED = Object.freeze(['reopened', 'pending-removal', 'open']);

/**
 * A ledger file name: the topic id, optionally after a label such as
 * the draft's "1-high.open." -- so files sort by severity and copy
 * into the ledger without renaming. Only the id counts.
 */
const FILE_NAME_RE = /^(?:[A-Za-z0-9._-]+\.)?(LT-[0-9a-f]{10})\.json$/;

const ENTRY_FIELDS = ['format', 'id', 'key', 'title', 'evidence', 'decision'];
const EVIDENCE_FIELDS = ['package', 'declared', 'hash', 'count', 'lines'];
const DECISION_FIELDS = ['outcome', 'licence', 'rationale', 'decidedBy', 'date', 'expires'];

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A person has signed the decision: decidedBy or date written. Both
 * blank = a draft still being worked on; one alone is checked as a
 * decision and refused for the missing half.
 */
export const isSigned = (decision) => isText(decision?.decidedBy) || isText(decision?.date);

/** A ledger with nothing in it (no folder, or no --ledger). */
export const emptyLedger = () => ({ decisions: new Map(), drafts: new Map() });


//**************************************************************
// isDate
//**************************************************************
/** A real calendar day written YYYY-MM-DD ("2026-02-30" is not). */
export function isDate(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const d = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}
// isDate END **************************************************


/** Problems with the fields of `object`: unknown ones (typos) are named. */
function unknownFields(object, allowed, where) {
    return Object.keys(object).filter((k) => !allowed.includes(k)).map((k) => `${where}unknown field "${k}"`);
}


//**************************************************************
// checkEntry
//**************************************************************
/**
 * The problems of one ledger file, [] when it is sound. `fileName`
 * must end in "<id>.json" (see FILE_NAME_RE); the id must belong to
 * the key, so a decision copied to the wrong file cannot close
 * another topic. An unsigned decision is a draft: only its shape is
 * checked (fields, evidence), its content once it is signed.
 */
export function checkEntry(entry, fileName) {
    if (!isPlainObject(entry)) return ['not a JSON object'];
    const problems = unknownFields(entry, ENTRY_FIELDS, '');
    if (entry.format !== LEDGER_FORMAT) problems.push(`"format" must be ${LEDGER_FORMAT}`);
    if (!isText(entry.key)) {
        problems.push('"key" is missing');
    } else if (entry.id !== topicId(entry.key)) {
        problems.push(`"id" must be ${topicId(entry.key)} for this key`);
    }
    if (FILE_NAME_RE.exec(fileName)?.[1] !== entry.id) {
        problems.push(`the file name must end in ${entry.id}.json (optionally after a label such as "1-high.open.")`);
    }

    const evidence = entry.evidence;
    if (!isPlainObject(evidence)) {
        problems.push('"evidence" is missing');
    } else {
        problems.push(...unknownFields(evidence, EVIDENCE_FIELDS, 'evidence: '));
        if (!isText(evidence.hash)) problems.push('evidence: "hash" is missing');
        if (!isText(evidence.package)) problems.push('evidence: "package" is missing');
        if (!Array.isArray(evidence.lines) || !evidence.lines.every((l) => typeof l === 'string')) {
            problems.push('evidence: "lines" must be a list of texts');
        }
    }

    const decision = entry.decision;
    if (!isPlainObject(decision)) return [...problems, '"decision" is missing'];
    problems.push(...unknownFields(decision, DECISION_FIELDS, 'decision: '));
    if (!isSigned(decision)) return problems;
    if (!Object.hasOwn(OUTCOMES, decision.outcome)) {
        problems.push(`decision: "outcome" must be one of ${Object.keys(OUTCOMES).join(', ')}`);
    }
    if (decision.outcome === 'accept-as') {
        if (!isExpression(decision.licence)) problems.push('decision: "accept-as" needs "licence", an SPDX expression');
    } else if (decision.licence !== undefined && decision.licence !== null && decision.licence !== '') {
        problems.push('decision: "licence" belongs to "accept-as" only');
    }
    if (!isText(decision.rationale)) problems.push('decision: "rationale" is missing');
    if (!isText(decision.decidedBy)) problems.push('decision: "decidedBy" is missing (the person who decided)');
    if (!isDate(decision.date)) problems.push('decision: "date" must be a day, YYYY-MM-DD');
    if (decision.expires !== undefined && decision.expires !== null) {
        if (!isDate(decision.expires)) {
            problems.push('decision: "expires" must be a day, YYYY-MM-DD, or null');
        } else if (isDate(decision.date) && decision.expires <= decision.date) {
            problems.push('decision: "expires" must come after "date"');
        }
    }
    return problems;
}
// checkEntry END **********************************************


//**************************************************************
// checkLedger
//**************************************************************
/**
 * Checks every file of a ledger: [{ fileName, entry }] as read.
 * Returns { decisions, drafts }, signed and unsigned entries by key;
 * throws one error listing every problem of every file, so one run
 * shows all that needs fixing. Per topic at most one decision and
 * one draft (an old decision next to the draft that reconsiders it).
 */
export function checkLedger(files) {
    const problems = [];
    const ledger = emptyLedger();
    const fileOf = { decisions: new Map(), drafts: new Map() };
    for (const { fileName, entry, error } of files) {
        const found = error ? [`not readable JSON (${error})`] : checkEntry(entry, fileName);
        if (found.length) {
            problems.push(...found.map((p) => `${fileName}: ${p}`));
            continue;
        }
        const kind = isSigned(entry.decision) ? 'decisions' : 'drafts';
        // Labels make two names for one topic possible: which one
        // counts is a person's call.
        if (fileOf[kind].has(entry.key)) {
            const what = kind === 'decisions' ? 'a signed decision' : 'an unsigned draft';
            problems.push(`${fileName}: ${fileOf[kind].get(entry.key)} is ${what} for the same topic too; keep one of the two`);
            continue;
        }
        fileOf[kind].set(entry.key, fileName);
        ledger[kind].set(entry.key, entry);
    }
    if (problems.length) throw new LedgerError(problems);
    return ledger;
}
// checkLedger END *********************************************


/** A ledger with problems: the message lists them, one per line. */
export class LedgerError extends Error {
    constructor(problems) {
        super(`the ledger has ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`);
        this.problems = problems;
    }
}


//**************************************************************
// evidenceOf
//**************************************************************
/** The evidence of a topic, as a ledger file keeps it. */
export function evidenceOf(topic) {
    return {
        package: topic.package,
        declared: topic.declared,
        hash: topic.evidenceHash,
        count: topic.evidenceCount,
        lines: topic.evidence,
    };
}
// evidenceOf END **********************************************


//**************************************************************
// changes
//**************************************************************
/** In words, what changed between the evidence of a decision and a topic now. */
function changes(before, topic) {
    const out = [];
    if (before.package !== topic.package) out.push(`${before.package} -> ${topic.package}`);
    if ((before.declared ?? null) !== (topic.declared ?? null)) {
        out.push(`declared ${before.declared ?? 'none'} -> ${topic.declared ?? 'none'}`);
    }
    const old = new Set(before.lines);
    const now = new Set(topic.evidence);
    const added = topic.evidence.filter((l) => !old.has(l)).length;
    const removed = before.lines.filter((l) => !now.has(l)).length;
    if (added) out.push(`${added} new finding(s)`);
    if (removed) out.push(`${removed} finding(s) gone`);
    if ((before.count ?? before.lines.length) !== topic.evidenceCount) {
        out.push(`${before.count ?? before.lines.length} -> ${topic.evidenceCount} finding(s)`);
    } else if (!added && !removed && topic.evidenceCount > MAX_EVIDENCE) {
        out.push(`a finding beyond the first ${MAX_EVIDENCE} changed`);
    }
    return out.length ? out : ['the findings changed'];
}
// changes END *************************************************


//**************************************************************
// applyLedger
//**************************************************************
/**
 * Gives each topic its status against the ledger ({ decisions,
 * drafts } from checkLedger) on day `today` (YYYY-MM-DD):
 *   { topics: [{ ...topic, status, reasons, decision, drafting }], gone, statusCounts }
 * `reasons` says why a topic reopened; `decision` is the ledger's.
 * `drafting`: null, or "current" / "outdated" when an unsigned draft
 * for the topic is in the ledger (outdated: made on other evidence).
 * `gone`: the decisions and drafts whose topic this scan did not find.
 */
export function applyLedger(topics, { decisions, drafts }, today) {
    const seen = new Set();
    const result = topics.map((topic) => {
        seen.add(topic.key);
        const draft = drafts.get(topic.key);
        const drafting = draft ? (draft.evidence.hash === topic.evidenceHash ? 'current' : 'outdated') : null;
        const entry = decisions.get(topic.key);
        if (!entry) return { ...topic, status: 'open', reasons: [], decision: null, drafting };
        const reasons = [];
        if (entry.evidence.hash !== topic.evidenceHash) {
            reasons.push(`evidence changed: ${changes(entry.evidence, topic).join(', ')}`);
        }
        if (entry.decision.expires && entry.decision.expires <= today) {
            reasons.push(`decision expired on ${entry.decision.expires}`);
        }
        let status = 'closed';
        if (reasons.length) status = 'reopened';
        else if (entry.decision.outcome === 'remove') status = 'pending-removal';
        return { ...topic, status, reasons, decision: entry.decision, drafting };
    });
    const gone = [...decisions.values(), ...drafts.values()].filter((e) => !seen.has(e.key))
        .map((e) => ({ id: e.id, key: e.key, title: e.title ?? e.key, decision: e.decision, signed: isSigned(e.decision) }));
    const statusCounts = Object.fromEntries([...UNDECIDED, 'closed'].map((s) => [s, result.filter((t) => t.status === s).length]));
    statusCounts.drafting = result.filter((t) => t.drafting && UNDECIDED.includes(t.status)).length;
    return { topics: result, gone, statusCounts };
}
// applyLedger END *********************************************


//**************************************************************
// draftEntry
//**************************************************************
/**
 * A ledger file to fill in for an undecided topic. A reopened topic
 * keeps its earlier decision as a starting point, but without
 * decidedBy and date: it counts only when a person signs it again.
 */
export function draftEntry(topic) {
    const blank = { outcome: '', licence: '', rationale: '', decidedBy: '', date: '', expires: null };
    const decision = topic.decision ? { ...blank, ...topic.decision, decidedBy: '', date: '' } : blank;
    return {
        format: LEDGER_FORMAT,
        id: topic.id,
        key: topic.key,
        title: topic.title,
        evidence: evidenceOf(topic),
        decision,
    };
}
// draftEntry END **********************************************


//**************************************************************
// draftFileName
//**************************************************************
/**
 * "1-high.open.LT-0e42d9a186.json": severity (numbered, so names sort
 * high, medium, low), status, id. Valid in the ledger as it is.
 */
export function draftFileName(topic) {
    return `${SEVERITIES.indexOf(topic.severity) + 1}-${topic.severity}.${topic.status}.${topic.id}.json`;
}
// draftFileName END *******************************************


//**************************************************************
// blockingTopics
//**************************************************************
/**
 * The undecided topics at or above severity `blockAt` (high, medium,
 * low); [] for "none". A product release can require this to be [].
 */
export function blockingTopics(topics, blockAt) {
    if (blockAt === 'none') return [];
    const limit = SEVERITIES.indexOf(blockAt);
    if (limit < 0) throw new RangeError(`block level must be none or one of ${SEVERITIES.join(', ')}, not ${blockAt}`);
    return topics.filter((t) => UNDECIDED.includes(t.status) && SEVERITIES.indexOf(t.severity) <= limit);
}
// blockingTopics END ******************************************
