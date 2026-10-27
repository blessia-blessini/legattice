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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { baseId, isExpression, leaves, parseExpression, uncovered } from '../../src/topics/spdx.mjs';

describe('parseExpression', () => {
    it('reads single licences, exceptions, AND before OR, and parentheses', () => {
        assert.deepEqual(parseExpression('MIT'), { type: 'leaf', id: 'MIT' });
        assert.deepEqual(parseExpression('Apache-2.0 WITH LLVM-exception'), { type: 'leaf', id: 'Apache-2.0 WITH LLVM-exception' });
        assert.deepEqual(parseExpression('MIT OR Apache-2.0 AND BSD-3-Clause'), {
            type: 'or',
            args: [{ type: 'leaf', id: 'MIT' }, { type: 'and', args: [{ type: 'leaf', id: 'Apache-2.0' }, { type: 'leaf', id: 'BSD-3-Clause' }] }],
        });
        assert.deepEqual(leaves(parseExpression('(MIT OR Apache-2.0) AND NCSA')), ['MIT', 'Apache-2.0', 'NCSA']);
        assert.deepEqual(leaves(parseExpression('mit or isc')), ['mit', 'isc']);
    });

    it('keeps a text that does not parse as one licence, and an empty one as nothing', () => {
        for (const bad of ['MIT OR', '(MIT', 'MIT) OR ISC', 'AND MIT', 'GPL-2.0 WITH']) {
            assert.deepEqual(parseExpression(bad), { type: 'leaf', id: bad }, bad);
        }
        assert.equal(parseExpression(''), null);
        assert.equal(parseExpression(null), null);
        assert.deepEqual(leaves(null), []);
    });
});

describe('isExpression', () => {
    it('accepts what parses and rejects what parseExpression only keeps whole', () => {
        for (const good of ['MIT', 'Apache-2.0 WITH LLVM-exception', '(MIT OR Apache-2.0) AND NCSA', 'LicenseRef-x']) {
            assert.equal(isExpression(good), true, good);
        }
        for (const bad of ['MIT OR', '(MIT', 'GPL-2.0 WITH', 'MIT licence', '', '   ', null, undefined]) {
            assert.equal(isExpression(bad), false, String(bad));
        }
    });
});

describe('baseId', () => {
    it('drops the exception and the case', () => {
        assert.equal(baseId('Apache-2.0 WITH LLVM-exception'), 'APACHE-2.0');
        assert.equal(baseId('mit'), 'MIT');
    });
});

describe('uncovered', () => {
    const permissive = new Set(['MIT', 'APACHE-2.0', 'ISC']);
    const ok = (l) => permissive.has(baseId(l));

    it('is satisfied by one covered choice of an OR', () => {
        assert.deepEqual(uncovered(parseExpression('MPL-2.0 OR Apache-2.0'), ok), []);
        assert.deepEqual(uncovered(parseExpression('MIT OR GPL-1.0-or-later'), ok), []);
    });

    it('needs every part of an AND', () => {
        assert.deepEqual(uncovered(parseExpression('BSD-2-Clause AND LicenseRef-x-patent'), ok), ['BSD-2-Clause', 'LicenseRef-x-patent']);
        assert.deepEqual(uncovered(parseExpression('(MIT OR Apache-2.0) AND NCSA'), ok), ['NCSA']);
    });

    it('reports every choice of an OR that has none covered', () => {
        assert.deepEqual(uncovered(parseExpression('AFL-2.1 OR GPL-2.0-or-later'), ok), ['AFL-2.1', 'GPL-2.0-or-later']);
        assert.deepEqual(uncovered(null, ok), []);
    });
});
