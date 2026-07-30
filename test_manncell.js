import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultsPath = path.join(__dirname, 'data', 'defaults.json');
const defaultsData = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

import { executePrimaryAssign } from './js/services/summonEngine/pipeline/02_primaryAssign.js';
import { executeManncellCompression } from './js/services/summonEngine/pipeline/04_manncellCompression.js';
import { executeRequirementPhase } from './js/services/summonEngine/pipeline/01_requirementPhase.js';
import { EngineState } from './js/services/summonEngine/EngineState.js';

let state = new EngineState();
state.master = {
  staff: defaultsData.staff,
  staffMap: {},
  menus: defaultsData.menus,
  reservations: defaultsData.reservations
};

defaultsData.staff.forEach(s => {
  state.master.staffMap[s.id] = s;
});

// Run phases
state = executeRequirementPhase(state);
state = executePrimaryAssign(state);
// Mock Phase 3
state.unassignedReqs = [];
state = executeManncellCompression(state);

console.log(JSON.stringify(state.manncellTicks, null, 2));
