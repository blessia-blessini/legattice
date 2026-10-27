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
// Licence classes: how much a licence asks of a product that
// ships it. Only to sort topics by urgency -- whether a licence
// is acceptable for a product is a person's decision, recorded
// in the ledger, never this table's.
//**************************************************************

/** Classes, most demanding first, with the severity of a topic about them. */
export const CLASSES = Object.freeze({
    restricted: { severity: 'high', label: 'restricted (non-commercial, no-derivatives, proprietary, source-available)' },
    'strong-copyleft': { severity: 'high', label: 'strong copyleft' },
    'weak-copyleft': { severity: 'medium', label: 'weak copyleft or share-alike' },
    patent: { severity: 'medium', label: 'patent licence' },
    permissive: { severity: 'low', label: 'permissive or public domain' },
    unknown: { severity: null, label: 'not identified (a reference such as "see LICENSE")' },
});

export const SEVERITIES = Object.freeze(['high', 'medium', 'low']);

// First match wins. Patterns test the licence without its exception, upper case.
const RULES = [
    ['unknown', /^(NOASSERTION|NONE|LICENSEREF-SCANCODE-(UNKNOWN|FREE-UNKNOWN|GENERIC-)[A-Z0-9.-]*)$/],
    ['patent', /^LICENSEREF-.*PATENT/],
    ['restricted', /^(CC-BY(-SA)?-NC|CC-BY(-NC)?-ND|BUSL-|SSPL-|ELASTIC-|POLYFORM-|LICENSEREF-SCANCODE-(PROPRIETARY|COMMERCIAL))/],
    ['strong-copyleft', /^(AGPL-|GPL-|OSL-|RPL-|EUPL-|CPAL-|SLEEPYCAT|QPL-)/],
    ['weak-copyleft', /^(LGPL-|MPL-|EPL-|CDDL-|CPL-|MS-RL|CECILL|APSL-|IPL-|NPL-|SPL-|ERLPL-|CC-BY-SA-)/],
];


//**************************************************************
// licenceClass
//**************************************************************
/** The class of one licence id (an SPDX id or a LicenseRef, exception ignored). */
export function licenceClass(leaf) {
    const id = String(leaf).split(/\s+WITH\s+/i)[0].trim().toUpperCase();
    for (const [cls, re] of RULES) {
        if (re.test(id)) return cls;
    }
    return 'permissive';
}
// licenceClass END ********************************************
