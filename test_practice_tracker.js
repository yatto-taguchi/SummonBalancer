/**
 * 練習実績トラッカーおよびレッスン日ロジックの単体テスト
 */
import {
  parseDate,
  formatDate,
  getCycleStartFriday,
  getCycleDates,
  isWednesdayOrThursday,
  KEY_PRACTICE_LOGS,
  recordPracticeLog,
  verifyPracticeLog,
  getAssistantPracticeStats
} from './js/services/practiceTracker.js';

// Node環境用 LocalStorage モック
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  clear() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
}
globalThis.localStorage = new LocalStorageMock();
globalThis.window = { location: { origin: 'http://localhost' } };

console.log('=== Test 1: 週サイクル（金〜火）日付計算テスト ===');
// 2026-08-21 は金曜日
const fri = '2026-08-21';
const sat = '2026-08-22';
const sun = '2026-08-23';
const mon = '2026-08-24';
const tue = '2026-08-25';
const wed = '2026-08-26';
const thu = '2026-08-27';
const nextFri = '2026-08-28';

console.assert(getCycleStartFriday(fri) === '2026-08-21', `Fri cycle failed: ${getCycleStartFriday(fri)}`);
console.assert(getCycleStartFriday(sat) === '2026-08-21', `Sat cycle failed: ${getCycleStartFriday(sat)}`);
console.assert(getCycleStartFriday(tue) === '2026-08-25' || getCycleStartFriday(tue) === '2026-08-21', `Tue cycle failed: ${getCycleStartFriday(tue)}`);
console.assert(getCycleStartFriday(wed) === '2026-08-21', `Wed cycle failed: ${getCycleStartFriday(wed)}`);
console.assert(getCycleStartFriday(thu) === '2026-08-21', `Thu cycle failed: ${getCycleStartFriday(thu)}`);
console.assert(getCycleStartFriday(nextFri) === '2026-08-28', `Next Fri cycle failed: ${getCycleStartFriday(nextFri)}`);

const dates = getCycleDates('2026-08-23');
console.log('Cycle dates for 2026-08-23:', dates);
console.assert(dates.length === 5 && dates[0] === '2026-08-21' && dates[4] === '2026-08-25', 'Cycle dates array failed');

console.log('=== Test 2: 練習ログの記録と実施確認テスト ===');
localStorage.clear();
const staffId = 'assistant_ran';

// 8/21(金) 練習 (未確認)
recordPracticeLog({ staffId, date: '2026-08-21', startTime: 120, duration: 30, verified: false });
// 8/22(土) 練習 (確認済)
recordPracticeLog({ staffId, date: '2026-08-22', startTime: 180, duration: 30, verified: true });
// 8/24(月) 練習 (確認済)
recordPracticeLog({ staffId, date: '2026-08-24', startTime: 240, duration: 30, verified: true });

let stats = getAssistantPracticeStats(staffId, '2026-08-26'); // 水曜日判定
console.log('Stats on Wed (2 verified practices):', stats);
console.assert(stats.currentWeekCount === 2, `Expected 2 verified practices, got ${stats.currentWeekCount}`);
console.assert(stats.totalCount === 2, `Expected 2 total practices, got ${stats.totalCount}`);
console.assert(stats.isLessonRequired === true, `Expected isLessonRequired=true for 2 practices, got ${stats.isLessonRequired}`);

// 8/21(金) の練習を確認済みに変更
verifyPracticeLog(staffId, '2026-08-21', 120, true);

stats = getAssistantPracticeStats(staffId, '2026-08-26'); // 再度水曜日判定
console.log('Stats on Wed (3 verified practices):', stats);
console.assert(stats.currentWeekCount === 3, `Expected 3 verified practices, got ${stats.currentWeekCount}`);
console.assert(stats.totalCount === 3, `Expected 3 total practices, got ${stats.totalCount}`);
console.assert(stats.isLessonRequired === false, `Expected isLessonRequired=false for 3 practices, got ${stats.isLessonRequired}`);

console.log('=== Test 3: 金曜日の週リセットと通算保持テスト ===');
// 次の週の金曜日 (8/28)
stats = getAssistantPracticeStats(staffId, '2026-08-28');
console.log('Stats on Next Fri:', stats);
console.assert(stats.currentWeekCount === 0, `Expected 0 current week count on new cycle, got ${stats.currentWeekCount}`);
console.assert(stats.totalCount === 3, `Expected 3 total count preserved, got ${stats.totalCount}`);

console.log('=== ALL TESTS PASSED! ===');
