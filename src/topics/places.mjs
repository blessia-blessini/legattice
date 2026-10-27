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
// Where in a package a finding is. ScanCode reads every file of
// a package; most of what it finds beyond the declared licence
// is in READMEs (naming other projects' licences), tests,
// examples and docs (legattice step-1 comparison, 2026-10-27).
// The place separates findings about the code from mentions.
//**************************************************************

export const PLACES = Object.freeze({
    licenceFile: 'licence file',
    nestedLicenceFile: 'licence file in a folder',
    source: 'source',
    readme: 'readme or metadata',
    docs: 'docs text',
    tests: 'tests, examples, docs',
});

/** Places whose findings are about the code itself: they make topics. */
export const CODE_PLACES = new Set([PLACES.licenceFile, PLACES.nestedLicenceFile, PLACES.source]);

const LICENCE_NAME_RE = /^(licen[cs]e|copying|notice|copyright|unlicense|patents)([._-]|$)/i;
const README_RE = /^(cargo\.toml(\.orig)?|package\.json|readme([._-]|$))/i;
const TESTISH_DIR_RE = /^(tests?|__tests__|spec|specs|examples?|samples?|bench|benches|benchmarks?|fixtures?|testdata|test[-_]data|docs?)$/i;
const TEST_FILE_RE = /\.(test|spec)\.[a-z0-9]+$/i;
const DOCS_FILE_RE = /(\.(md|markdown|txt|rst|adoc|html?)$)|^(changelog|changes|history|contributing|authors)([._-]|$)/i;


//**************************************************************
// placeOf
//**************************************************************
/** The place of a path inside a package or repository (root-relative, "/"-separated). */
export function placeOf(path) {
    const parts = String(path).split('/');
    const name = parts[parts.length - 1];
    const folders = parts.slice(0, -1);
    const top = folders.length === 0;
    if (top && LICENCE_NAME_RE.test(name)) return PLACES.licenceFile;
    if (top && README_RE.test(name)) return PLACES.readme;
    if (folders.some((f) => TESTISH_DIR_RE.test(f)) || TEST_FILE_RE.test(name)) return PLACES.tests;
    if (LICENCE_NAME_RE.test(name)) return PLACES.nestedLicenceFile;
    if (DOCS_FILE_RE.test(name)) return PLACES.docs;
    return PLACES.source;
}
// placeOf END *************************************************


//**************************************************************
// archiveRoot
//**************************************************************
/**
 * The one top folder every file of a package archive sits in
 * ("package/" for npm, "serde-1.0.229/" for a crate), or "" when
 * there is none. Found from the files, not assumed per ecosystem.
 */
export function archiveRoot(paths) {
    let root = null;
    for (const p of paths) {
        const slash = p.indexOf('/');
        if (slash <= 0) return '';
        const first = p.slice(0, slash + 1);
        if (root === null) root = first;
        else if (root !== first) return '';
    }
    return root ?? '';
}
// archiveRoot END *********************************************


//**************************************************************
// globToRegExp
//**************************************************************
/**
 * An ORT path-exclude glob as a regular expression: "**" spans folders
 * ("**\/" also matches no folder at all), "*" and "?" stay inside one.
 * Other glob syntax (braces, classes) is matched literally.
 */
export function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            if (glob[i + 2] === '/') {
                re += '(?:.*/)?';
                i += 2;
            } else {
                re += '.*';
                i += 1;
            }
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}
// globToRegExp END ********************************************


/** A test for "is this path excluded" from ORT's repository configuration excludes. */
export function excludedPaths(excludes) {
    const patterns = (excludes?.paths ?? []).map((p) => globToRegExp(p.pattern));
    return (path) => patterns.some((re) => re.test(path));
}
