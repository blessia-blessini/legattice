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
// Small ORT result files for the tests, shaped like ORT 97.2.0
// writes them (field names taken from a real run).
//**************************************************************

export const REPO = 'https://example.org/product.git';
export const REVISION = '0123456789abcdef0123456789abcdef01234567';

/** A package; `url: null` for one without a source archive. */
export function pkg(id, { url = `https://registry.example.org/${id}.tgz`, ...rest } = {}) {
    return {
        id,
        source_artifact: url ? { url, hash: { value: '', algorithm: '' } } : { url: '', hash: { value: '', algorithm: '' } },
        vcs_processed: { type: 'Git', url: `https://example.org/${id}.git`, revision: 'v1', path: '' },
        ...rest,
    };
}

/** A project in REPO at REVISION, unless told otherwise. */
export function project(id, { url = REPO, revision = REVISION } = {}) {
    return { id, definition_file_path: 'package.json', vcs_processed: { type: 'Git', url, revision, path: '' } };
}

/** An ORT result holding an analyzer result. */
export function analyzerResult({ projects = [], packages = [] } = {}) {
    return {
        repository: { vcs_processed: { type: 'Git', url: REPO, revision: REVISION, path: '' }, config: {} },
        analyzer: { result: { projects, packages, dependency_graphs: {} } },
    };
}

/** An artifact provenance as ORT writes it in scan results. */
export const artifactProvenance = (url) => ({ source_artifact: { url, hash: { value: '', algorithm: '' } } });

/** A repository provenance as ORT writes it in scan results. */
export const repositoryProvenance = (url, revision) => ({
    vcs_info: { type: 'Git', url, revision, path: '' },
    resolved_revision: revision,
});

/**
 * An ORT result with a scan result. `scans`: [{ id, provenance, start, end }]
 * with times in seconds after `runStart` (negative: stored by an earlier run);
 * `provenance: null` for a package whose provenance could not be resolved.
 */
export function scanResult({ projects = [], packages = [], scans = [], runStart = '2026-10-26T10:00:00Z' }) {
    const at = (s) => new Date(Date.parse(runStart) + s * 1000).toISOString();
    return {
        ...analyzerResult({ projects, packages }),
        scanner: {
            start_time: runStart,
            provenances: scans.map((s) => ({ id: s.id, ...(s.provenance ? { package_provenance: s.provenance } : {}) })),
            scan_results: scans.filter((s) => s.provenance).map((s) => ({
                provenance: s.provenance,
                scanner: { name: 'ScanCode', version: '32.5.0', configuration: '' },
                summary: { start_time: at(s.start), end_time: at(s.end) },
            })),
        },
    };
}
