/**
 * test_stats_tracker.js
 * 
 * statsTracker.js の集計・合算・CSV出力ロジックの単体検証スクリプト
 */

import {
  aggregateStats,
  exportStatsToCSV
} from './js/services/statsTracker.js';

console.log('=== StatsTracker テスト開始 ===');

// モック日次スナップショット 1 (Day 1)
const mockSnapshotDay1 = {
  date: '2026-08-21',
  updatedAt: new Date().toISOString(),
  isLocked: false,
  summary: {
    totalReservations: 10,
    totalAssignedMinutes: 240,
    totalShortages: 0,
    totalSOS: 1,
    totalGambare: 2,
    totalFixed: 1,
    totalBonusSupport: 2,
    totalSummons: 1,
    totalSpecialSummons: 1,
    totalSPSpecialSummons: 0
  },
  menus: [
    { id: 'cut_color', name: 'カットカラー', count: 6, ratio: 60 },
    { id: 'cut', name: 'カット', count: 4, ratio: 40 }
  ],
  skills: {
    shampoo: 10,
    color: 6,
    cut: 10,
    treatment: 2,
    spa: 1,
    perm: 0,
    straight: 0,
    iron: 0,
    other: 0
  },
  staffStats: {
    'stylist_1': {
      id: 'stylist_1',
      name: '田中（スタイリスト）',
      type: 'stylist',
      rank: 'top',
      isWorking: true,
      reservationCount: 6,
      helpReceivedCount: 5,
      helpReceivedMinutes: 150,
      helpProvidedCount: 0,
      helpProvidedMinutes: 0,
      bonusSupportCount: 0,
      bonusSupportMinutes: 0,
      lunchCount: 1,
      lunchMinutes: 30,
      restCount: 1,
      restMinutes: 30,
      practiceCount: 0,
      practiceMinutes: 0,
      cleaningCount: 0,
      cleaningMinutes: 0,
      freeTimeMinutes: 60,
      gapHelpMinutes: 0,
      gambareCount: 0,
      sosCount: 1,
      fixedCount: 0,
      summonedCount: 0,
      specialSummonedCount: 0,
      spSummonedCount: 0
    },
    'assistant_1': {
      id: 'assistant_1',
      name: '佐藤（アシスタント）',
      type: 'assistant',
      rank: 'junior',
      isWorking: true,
      reservationCount: 0,
      helpReceivedCount: 0,
      helpReceivedMinutes: 0,
      helpProvidedCount: 5,
      helpProvidedMinutes: 150,
      bonusSupportCount: 2,
      bonusSupportMinutes: 30,
      lunchCount: 1,
      lunchMinutes: 30,
      restCount: 0,
      restMinutes: 0,
      practiceCount: 1,
      practiceMinutes: 30,
      cleaningCount: 1,
      cleaningMinutes: 30,
      freeTimeMinutes: 30,
      gapHelpMinutes: 15,
      gambareCount: 2,
      sosCount: 0,
      fixedCount: 1,
      summonedCount: 1,
      specialSummonedCount: 1,
      spSummonedCount: 0
    }
  },
  helpMatrix: {
    'stylist_1': {
      'assistant_1': { count: 5, minutes: 150 }
    }
  }
};

// モック日次スナップショット 2 (Day 2)
const mockSnapshotDay2 = {
  date: '2026-08-22',
  updatedAt: new Date().toISOString(),
  isLocked: false,
  summary: {
    totalReservations: 8,
    totalAssignedMinutes: 180,
    totalShortages: 1,
    totalSOS: 0,
    totalGambare: 1,
    totalFixed: 0,
    totalBonusSupport: 1,
    totalSummons: 0,
    totalSpecialSummons: 0,
    totalSPSpecialSummons: 1
  },
  menus: [
    { id: 'cut_color', name: 'カットカラー', count: 4, ratio: 50 },
    { id: 'cut', name: 'カット', count: 4, ratio: 50 }
  ],
  skills: {
    shampoo: 8,
    color: 4,
    cut: 8,
    treatment: 1,
    spa: 0,
    perm: 0,
    straight: 0,
    iron: 0,
    other: 0
  },
  staffStats: {
    'stylist_1': {
      id: 'stylist_1',
      name: '田中（スタイリスト）',
      type: 'stylist',
      rank: 'top',
      isWorking: true,
      reservationCount: 5,
      helpReceivedCount: 4,
      helpReceivedMinutes: 120,
      helpProvidedCount: 0,
      helpProvidedMinutes: 0,
      bonusSupportCount: 0,
      bonusSupportMinutes: 0,
      lunchCount: 1,
      lunchMinutes: 30,
      restCount: 0,
      restMinutes: 0,
      practiceCount: 0,
      practiceMinutes: 0,
      cleaningCount: 0,
      cleaningMinutes: 0,
      freeTimeMinutes: 90,
      gapHelpMinutes: 0,
      gambareCount: 0,
      sosCount: 0,
      fixedCount: 0,
      summonedCount: 0,
      specialSummonedCount: 0,
      spSummonedCount: 0
    },
    'assistant_1': {
      id: 'assistant_1',
      name: '佐藤（アシスタント）',
      type: 'assistant',
      rank: 'junior',
      isWorking: true,
      reservationCount: 0,
      helpReceivedCount: 0,
      helpReceivedMinutes: 0,
      helpProvidedCount: 4,
      helpProvidedMinutes: 120,
      bonusSupportCount: 1,
      bonusSupportMinutes: 15,
      lunchCount: 1,
      lunchMinutes: 30,
      restCount: 1,
      restMinutes: 30,
      practiceCount: 1,
      practiceMinutes: 30,
      cleaningCount: 0,
      cleaningMinutes: 0,
      freeTimeMinutes: 60,
      gapHelpMinutes: 0,
      gambareCount: 1,
      sosCount: 0,
      fixedCount: 0,
      summonedCount: 0,
      specialSummonedCount: 0,
      spSummonedCount: 1
    }
  },
  helpMatrix: {
    'stylist_1': {
      'assistant_1': { count: 4, minutes: 120 }
    }
  }
};

// 1. 全体集計テスト
console.log('--- 1. 全体集計テスト ---');
const totalAggregated = aggregateStats([mockSnapshotDay1, mockSnapshotDay2], 'all');

console.assert(totalAggregated.totalDays === 2, `totalDays should be 2, got ${totalAggregated.totalDays}`);
console.assert(totalAggregated.summary.totalReservations === 18, `totalReservations should be 18, got ${totalAggregated.summary.totalReservations}`);
console.assert(totalAggregated.summary.totalAssignedMinutes === 420, `totalAssignedMinutes should be 420, got ${totalAggregated.summary.totalAssignedMinutes}`);
console.assert(totalAggregated.summary.totalShortages === 1, `totalShortages should be 1, got ${totalAggregated.summary.totalShortages}`);
console.assert(totalAggregated.summary.totalBonusSupport === 3, `totalBonusSupport should be 3, got ${totalAggregated.summary.totalBonusSupport}`);
console.assert(totalAggregated.skills.shampoo === 18, `shampoo count should be 18, got ${totalAggregated.skills.shampoo}`);

console.log('✅ 全体集計テスト合格: 総予約数18件, 総ヘルプ420分, 不足1件, お手伝いサポート3回');

// 2. 個別スタッフ（アシスタント1）絞り込みテスト
console.log('--- 2. 個別スタッフ絞り込みテスト ---');
const astAggregated = aggregateStats([mockSnapshotDay1, mockSnapshotDay2], 'assistant_1');

console.assert(astAggregated.isFiltered === true, 'isFiltered should be true');
console.assert(astAggregated.staffStats['assistant_1'].helpProvidedCount === 9, `helpProvidedCount should be 9, got ${astAggregated.staffStats['assistant_1'].helpProvidedCount}`);
console.assert(astAggregated.staffStats['assistant_1'].practiceCount === 2, `practiceCount should be 2, got ${astAggregated.staffStats['assistant_1'].practiceCount}`);
console.assert(astAggregated.staffStats['assistant_1'].bonusSupportCount === 3, `bonusSupportCount should be 3, got ${astAggregated.staffStats['assistant_1'].bonusSupportCount}`);
console.assert(astAggregated.staffStats['assistant_1'].gambareCount === 3, `gambareCount should be 3, got ${astAggregated.staffStats['assistant_1'].gambareCount}`);

console.log('✅ スタッフ個別集計テスト合格: 提供ヘルプ9回, 練習2回, お手伝い3回, 頑張れ3回');

console.log('=== 全テストケース正常終了 ✨ ===');
