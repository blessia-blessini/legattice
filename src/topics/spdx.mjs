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
// SPDX licence expressions, as far as the topic rules need them:
//   "MIT", "Apache-2.0 WITH LLVM-exception",
//   "(MIT OR Apache-2.0) AND BSD-3-Clause"
// AND binds tighter than OR. A string that does not parse is
// kept whole as one licence: a strange expression must still
// show up in a topic, never vanish.
//**************************************************************

const TOKEN_RE = /\s*(\(|\)|[^\s()]+)/y;


//**************************************************************
// tokenize
//**************************************************************
function tokenize(text) {
    const tokens = [];
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) tokens.push(m[1]);
    return tokens;
}
// tokenize END ************************************************


//**************************************************************
// parseExpression
//**************************************************************
/**
 * { type: 'leaf', id } | { type: 'and' | 'or', args: [...] }, or null
 * for an empty text. A leaf's id keeps its exception: "GPL-2.0 WITH
 * Classpath-exception-2.0".
 */
export function parseExpression(text) {
    const source = String(text ?? '').trim();
    if (!source) return null;
    const tokens = tokenize(source);
    let at = 0;
    const isOp = (t, op) => typeof t === 'string' && t.toUpperCase() === op;

    const parsePrimary = () => {
        const token = tokens[at];
        if (token === '(') {
            at += 1;
            const inner = parseOr();
            if (tokens[at] !== ')') throw new Error('missing )');
            at += 1;
            return inner;
        }
        if (token === undefined || token === ')' || isOp(token, 'AND') || isOp(token, 'OR') || isOp(token, 'WITH')) {
            throw new Error(`unexpected ${token ?? 'end'}`);
        }
        at += 1;
        if (isOp(tokens[at], 'WITH')) {
            const exception = tokens[at + 1];
            if (exception === undefined || exception === '(' || exception === ')') throw new Error('WITH without exception');
            at += 2;
            return { type: 'leaf', id: `${token} WITH ${exception}` };
        }
        return { type: 'leaf', id: token };
    };
    const parseList = (op, next) => () => {
        const args = [next()];
        while (isOp(tokens[at], op)) {
            at += 1;
            args.push(next());
        }
        return args.length === 1 ? args[0] : { type: op.toLowerCase(), args };
    };
    const parseAnd = parseList('AND', parsePrimary);
    const parseOr = parseList('OR', parseAnd);

    try {
        const tree = parseOr();
        if (at !== tokens.length) throw new Error('trailing text');
        return tree;
    } catch {
        return { type: 'leaf', id: source };
    }
}
// parseExpression END *****************************************


/** Every licence of an expression tree, in order. */
export function leaves(tree) {
    if (!tree) return [];
    return tree.type === 'leaf' ? [tree.id] : tree.args.flatMap(leaves);
}

/** "Apache-2.0 WITH LLVM-exception" -> "APACHE-2.0": compares licences, ignoring exceptions and case. */
export const baseId = (leaf) => leaf.split(/\s+WITH\s+/i)[0].trim().toUpperCase();


//**************************************************************
// uncovered
//**************************************************************
/**
 * The licences that keep an expression from being satisfied by the
 * licences `isCovered` accepts; [] when it is satisfied. For OR, one
 * satisfied choice is enough; otherwise every choice is reported.
 */
export function uncovered(tree, isCovered) {
    if (!tree) return [];
    if (tree.type === 'leaf') return isCovered(tree.id) ? [] : [tree.id];
    const parts = tree.args.map((arg) => uncovered(arg, isCovered));
    if (tree.type === 'or' && parts.some((p) => p.length === 0)) return [];
    return [...new Set(parts.flat())];
}
// uncovered END ***********************************************
