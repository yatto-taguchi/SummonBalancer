import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the default data
const defaultsPath = path.join(__dirname, 'data', 'defaults.json');
const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

import { SummonEngine } from './js/services/summonEngine/index.js';

const engine = new SummonEngine();
const result = engine.calculate(
  defaults.reservations,
  defaults.staff,
  defaults.staff.filter(s => s.type === 'assistant'),
  defaults.menus,
  [], // lunchOverrides
  []  // restOverrides
);

console.log("Manncells Output:", JSON.stringify(result.manncells, null, 2));
