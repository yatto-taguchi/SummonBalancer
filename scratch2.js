import { SummonEngine } from './js/services/summonEngine/index.js';

const engine = new SummonEngine();
const mockState = {
  manncellTicks: [
    { stylistId: 's1', timeStr: '10:00', teamSize: 2, team: ['a1', 'a2'] },
    { stylistId: 's1', timeStr: '10:05', teamSize: 2, team: ['a1', 'a2'] },
    { stylistId: 's1', timeStr: '10:15', teamSize: 2, team: ['a1', 'a2'] }
  ]
};

// We want to test the aggregation logic in index.js which is inside engine.calculate
// But engine.calculate requires full state.
// Let's just copy the aggregation logic here to see what it does.

const manncells = [];
const state = mockState;
if (state.manncellTicks) {
  state.manncellTicks.sort((a, b) => a.timeStr.localeCompare(b.timeStr));
  
  const activeBlocks = {};
  
  state.manncellTicks.forEach(tick => {
    const block = activeBlocks[tick.stylistId];
    const [h, m] = tick.timeStr.split(':').map(Number);
    const tickMins = h * 60 + m;
    
    const teamStr = (tick.team || []).slice().sort().join(',');
    
    if (block && block.teamSize === tick.teamSize && block.teamStr === teamStr && block.lastTickMins === tickMins - 5) {
      block.lastTickMins = tickMins;
      const endMins = tickMins + 5;
      const eH = Math.floor(endMins / 60);
      const eM = endMins % 60;
      block.endTime = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;
    } else {
      if (block) {
        manncells.push({...block});
      }
      const endMins = tickMins + 5;
      const eH = Math.floor(endMins / 60);
      const eM = endMins % 60;
      activeBlocks[tick.stylistId] = {
        stylistId: tick.stylistId,
        startTime: tick.timeStr,
        endTime: `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`,
        teamSize: tick.teamSize,
        team: tick.team,
        teamStr: teamStr,
        lastTickMins: tickMins,
        isSuccess: true
      };
    }
  });
  
  Object.values(activeBlocks).forEach(block => {
    manncells.push(block);
  });
}
console.log(manncells);
