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

import { archiveRoot, CODE_PLACES, excludedPaths, globToRegExp, PLACES, placeOf } from '../../src/topics/places.mjs';
import { licenceClass } from '../../src/topics/licence-classes.mjs';

describe('placeOf', () => {
    // Real paths from the step-1 comparison.
    const cases = {
        'LICENSE-MIT': PLACES.licenceFile,
        'COPYRIGHT-RUST.txt': PLACES.licenceFile,
        'LICENSE.spdx': PLACES.licenceFile,
        PATENTS: PLACES.licenceFile,
        'README.md': PLACES.readme,
        'Cargo.toml': PLACES.readme,
        'package.json': PLACES.readme,
        'vendor/dbus/COPYING': PLACES.nestedLicenceFile,
        'src/extensions/private/mod.rs': PLACES.source,
        'dist/chunks/mermaid.esm/chunk-J3XML5FO.mjs': PLACES.source,
        'docs/ATTRIBUTION.md': PLACES.tests,
        'vendor/dbus/doc/introspect.dtd': PLACES.tests,
        'tests/data/x.rs': PLACES.tests,
        'scripts/foss/licence-texts.test.mjs': PLACES.tests,
        '.github/pull_request_template.md': PLACES.docs,
        'vendor/dbus/CONTRIBUTING.md': PLACES.docs,
        'CHANGELOG.md': PLACES.docs,
    };
    for (const [path, place] of Object.entries(cases)) {
        it(`${path} -> ${place}`, () => assert.equal(placeOf(path), place));
    }

    it('counts only licence files and source as code', () => {
        assert.deepEqual([...CODE_PLACES].sort(), [PLACES.licenceFile, PLACES.nestedLicenceFile, PLACES.source].sort());
    });
});

describe('archiveRoot', () => {
    it('finds the one top folder of an archive', () => {
        assert.equal(archiveRoot(['package/LICENSE', 'package/dist/a.js']), 'package/');
        assert.equal(archiveRoot(['serde-1.0.229/LICENSE-MIT', 'serde-1.0.229/src/lib.rs']), 'serde-1.0.229/');
    });

    it('finds none when files sit at the top or in several folders', () => {
        assert.equal(archiveRoot(['LICENSE', 'src/a.rs']), '');
        assert.equal(archiveRoot(['a/x', 'b/y']), '');
        assert.equal(archiveRoot([]), '');
    });
});

describe('globToRegExp and excludedPaths', () => {
    it('lets ** span folders and * stay in one', () => {
        assert.ok(globToRegExp('scripts/**').test('scripts/foss/a.mjs'));
        assert.ok(globToRegExp('**/*.test.*').test('src/lib/a.test.ts'));
        assert.ok(globToRegExp('**/*.test.*').test('a.test.ts'));
        assert.ok(!globToRegExp('src/*.ts').test('src/lib/a.ts'));
        assert.ok(globToRegExp('README.md').test('README.md'));
        assert.ok(!globToRegExp('README.md').test('READMEXmd'));
        assert.ok(globToRegExp('file?.txt').test('file1.txt'));
    });

    it('applies ORT repository excludes', () => {
        const isExcluded = excludedPaths({ paths: [{ pattern: 'docs/**' }, { pattern: 'THIRD-PARTY-NOTICES.md' }] });
        assert.ok(isExcluded('docs/a/b.md'));
        assert.ok(isExcluded('THIRD-PARTY-NOTICES.md'));
        assert.ok(!isExcluded('src/App.tsx'));
        assert.ok(!excludedPaths(undefined)('anything'));
    });
});

describe('licenceClass', () => {
    const cases = {
        NOASSERTION: 'unknown',
        'LicenseRef-scancode-unknown-license-reference': 'unknown',
        'LicenseRef-scancode-alliance-open-media-patent-1.0': 'patent',
        'CC-BY-NC-ND-4.0': 'restricted',
        'LicenseRef-scancode-proprietary-license': 'restricted',
        'GPL-2.0-or-later WITH Autoconf-exception-generic': 'strong-copyleft',
        'AGPL-3.0-only': 'strong-copyleft',
        'LGPL-2.1-or-later': 'weak-copyleft',
        'MPL-2.0': 'weak-copyleft',
        'CC-BY-SA-4.0': 'weak-copyleft',
        'EPL-1.0': 'weak-copyleft',
        MIT: 'permissive',
        'OFL-1.1': 'permissive',
        'CC0-1.0': 'permissive',
        'Apache-2.0 WITH LLVM-exception': 'permissive',
    };
    for (const [id, cls] of Object.entries(cases)) {
        it(`${id} -> ${cls}`, () => assert.equal(licenceClass(id), cls));
    }
});
