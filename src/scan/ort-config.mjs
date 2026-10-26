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
// The ORT configuration file (config.yml) every job runs with.
//   One generator, so the broker, the shards and the merge job
//   cannot drift apart: they must agree on where results are
//   stored, or the merge job finds nothing the shards scanned.
//**************************************************************

import { checkManagerName } from './ort-result.mjs';

/** Where the container sees the cached ORT storages (the job's cache/ folder). */
export const STORAGE_ROOT = '/work/cache';

/** The four ORT storages kept between runs, as folders below STORAGE_ROOT. */
export const STORAGE_DIRS = Object.freeze({
    scanResults: 'scan-results',
    fileLists: 'file-lists',
    provenance: 'provenance',
    archive: 'archive',
});


//**************************************************************
// localFileStorage
//**************************************************************
/** YAML lines of an uncompressed local file storage, indented by `indent` spaces. */
function localFileStorage(directory, indent) {
    const pad = ' '.repeat(indent);
    return [
        `${pad}localFileStorage:`,
        `${pad}  directory: ${directory}`,
        `${pad}  compression: false`,
    ];
}
// localFileStorage END ****************************************


//**************************************************************
// ortConfigYaml
//**************************************************************
/**
 * The ORT configuration as YAML text.
 *
 * - `manager`: analyze with this one package manager only; omitted, ORT's
 *   default set is enabled (used for the dry run that finds the managers,
 *   and for scanning, where the managers no longer matter).
 * - sourceCodeOrigins [ARTIFACT, VCS]: scan the published package archive
 *   (what ships) and fall back to the repository only without one.
 * - ScanCode --processes 4: a hosted runner has 4 cores. "NonConfig"
 *   options do not change the findings, so stored results stay valid.
 * - All four storages live under STORAGE_ROOT: scan results, file lists,
 *   resolved provenances and the licence-file archive. Kept between runs
 *   and handed from the shards to the merge job; without the file lists
 *   and the archive the merge job would download every package again.
 */
export function ortConfigYaml({ manager = null, storageRoot = STORAGE_ROOT, processes = 4 } = {}) {
    if (!Number.isInteger(processes) || processes < 1) {
        throw new Error(`bad ScanCode process count: ${processes}`);
    }
    const dir = (name) => `${storageRoot}/${name}`;
    const lines = ['ort:', '  analyzer:'];
    if (manager !== null) {
        lines.push(`    enabledPackageManagers: [${checkManagerName(manager)}]`);
    }
    lines.push(
        '    skipExcluded: true',
        '  downloader:',
        '    sourceCodeOrigins: [ARTIFACT, VCS]',
        '  scanner:',
        '    skipExcluded: true',
        '    archive:',
        '      enabled: true',
        '      fileStorage:',
        ...localFileStorage(dir(STORAGE_DIRS.archive), 8),
        '    fileListStorage:',
        '      fileStorage:',
        ...localFileStorage(dir(STORAGE_DIRS.fileLists), 8),
        '    provenanceStorage:',
        '      fileStorage:',
        ...localFileStorage(dir(STORAGE_DIRS.provenance), 8),
        '    config:',
        '      ScanCode:',
        '        options:',
        `          commandLineNonConfig: '--processes,${processes}'`,
        '    storages:',
        '      local:',
        '        backend:',
        ...localFileStorage(dir(STORAGE_DIRS.scanResults), 10),
        '    storageReaders: [local]',
        '    storageWriters: [local]',
    );
    return lines.join('\n') + '\n';
}
// ortConfigYaml END *******************************************
