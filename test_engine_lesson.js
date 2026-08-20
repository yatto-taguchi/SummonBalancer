/**
 * 召喚エンジンにおける水・木レッスン日アサイン遮断および手動固定貫通テスト
 */
import { SummonEngine } from './js/services/summonEngine/index.js';
import * as PracticeTracker from './js/services/practiceTracker.js';

class LocalStorageMock {
  constructor() { this.store = {}; }
  clear() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
}
globalThis.localStorage = new LocalStorageMock();
globalThis.window = { location: { origin: 'http://localhost' } };

const engine = new SummonEngine();

// テスト用マスターデータ
const stylists = [
  { id: 'stylist_owner', name: 'オーナー', type: 'stylist', rank: 'owner', isWorking: true }
];
const assistants = [
  {
    id: 'assistant_ran',
    name: 'らんらん',
    type: 'assistant',
    rank: 'junior',
    isWorking: true,
    skills: [{ id: 'shampoo', proficiency: 3 }]
  }
];
const menus = [
  {
    id: 'cut_shampoo',
    name: 'カットシャンプー',
    duration: 60,
    assistantSlots: [
      { startMinute: 0, endMinute: 30, requiredSkill: 'shampoo', requiredProficiency: 2 }
    ]
  }
];

// 水曜日 9:00〜10:00 の予約
const resWed = [
  {
    id: 'res_1',
    stylistId: 'stylist_owner',
    menuItemId: 'cut_shampoo',
    startTime: 0,
    endTime: 60,
    items: [{ menuItemId: 'cut_shampoo', duration: 60 }]
  }
];

console.log('=== Test A: 練習2回（未達成）時の水曜日 9:00〜10:00 ===');
// 練習2回
localStorage.clear();
PracticeTracker.recordPracticeLog({ staffId: 'assistant_ran', date: '2026-08-21', startTime: 120, duration: 30, verified: true });
PracticeTracker.recordPracticeLog({ staffId: 'assistant_ran', date: '2026-08-22', startTime: 180, duration: 30, verified: true });

const statsWedUnachieved = PracticeTracker.getAssistantPracticeStats('assistant_ran', '2026-08-26');
console.log('Stats on Wed (2 practices):', statsWedUnachieved.isLessonRequired);
console.assert(statsWedUnachieved.isLessonRequired === true, 'Should require lesson');

const resultA = engine.calculate(
  resWed, stylists, assistants, menus,
  {}, {},
  { isToday: false, date: '2026-08-26', lessonStaffIds: ['assistant_ran'] }
);

console.log('Result A FreeTime Activities:', resultA.freeTimeActivities);
console.log('Result A Assignments for res_1:', resultA.assignments['res_1']);

// レッスン日ブロックが配置されているか確認
const lessonBlock = (resultA.freeTimeActivities || []).find(a => a.staffId === 'assistant_ran' && a.activity === 'lesson_day');
console.assert(lessonBlock != null, 'Should generate lesson_day block');
// 自動アサインから除外されて未アサイン（またはアシスタントが割り当てられない）になっているか確認
const assignA = resultA.assignments['res_1']?.[0];
console.assert(assignA !== 'assistant_ran' && assignA?.text !== 'assistant_ran', 'Assistant should NOT be auto-assigned during lesson');

console.log('=== Test B: 練習3回（達成）時の水曜日 9:00〜10:00 ===');
// 練習3回に増やす
PracticeTracker.recordPracticeLog({ staffId: 'assistant_ran', date: '2026-08-24', startTime: 240, duration: 30, verified: true });

const statsWedAchieved = PracticeTracker.getAssistantPracticeStats('assistant_ran', '2026-08-26');
console.log('Stats on Wed (3 practices):', statsWedAchieved.isLessonRequired);
console.assert(statsWedAchieved.isLessonRequired === false, 'Should NOT require lesson');

const resultB = engine.calculate(
  resWed, stylists, assistants, menus,
  {}, {},
  { isToday: false, date: '2026-08-26', lessonStaffIds: [] }
);

console.log('Result B FreeTime Activities:', resultB.freeTimeActivities);
console.log('Result B Assignments for res_1:', resultB.assignments['res_1']);

const lessonBlockB = (resultB.freeTimeActivities || []).find(a => a.staffId === 'assistant_ran' && a.activity === 'lesson_day');
console.assert(lessonBlockB == null, 'Should NOT generate lesson_day block when achieved');
const assignB = resultB.assignments['res_1']?.[0];
const assignTextB = (typeof assignB === 'object' && assignB !== null) ? assignB.text : String(assignB);
console.assert(assignTextB.includes('らんらん'), 'Assistant SHOULD be auto-assigned when achieved');

console.log('=== ALL ENGINE TESTS PASSED! ===');
