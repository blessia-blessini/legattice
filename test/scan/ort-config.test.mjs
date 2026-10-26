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

import { ortConfigYaml, STORAGE_DIRS, STORAGE_ROOT } from '../../src/scan/ort-config.mjs';

describe('ortConfigYaml', () => {
    it('enables one package manager when asked, ORT\'s default set otherwise', () => {
        assert.match(ortConfigYaml({ manager: 'Cargo' }), /^ {4}enabledPackageManagers: \[Cargo\]$/m);
        assert.doesNotMatch(ortConfigYaml(), /enabledPackageManagers/);
    });

    it('puts all four storages below the storage root', () => {
        const yaml = ortConfigYaml();
        for (const dir of Object.values(STORAGE_DIRS)) {
            assert.match(yaml, new RegExp(`^ +directory: ${STORAGE_ROOT}/${dir}$`, 'm'));
        }
        assert.equal(yaml.match(/compression: false/g).length, 4);
        assert.match(yaml, /^ {4}storageReaders: \[local\]$/m);
        assert.match(yaml, /^ {4}storageWriters: \[local\]$/m);
    });

    it('scans the published archive first, on all cores', () => {
        const yaml = ortConfigYaml({ processes: 4 });
        assert.match(yaml, /^ {4}sourceCodeOrigins: \[ARTIFACT, VCS\]$/m);
        assert.match(yaml, /^ {10}commandLineNonConfig: '--processes,4'$/m);
    });

    it('indents with spaces only, in steps of two', () => {
        for (const line of ortConfigYaml({ manager: 'NPM' }).trimEnd().split('\n')) {
            assert.match(line, /^( {2})*\S/, line);
        }
    });

    it('refuses names and counts that would break the file', () => {
        assert.throws(() => ortConfigYaml({ manager: 'NPM]\n  x' }), /bad package manager name/);
        assert.throws(() => ortConfigYaml({ processes: 0 }), /bad ScanCode process count/);
    });
});
