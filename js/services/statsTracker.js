/**
 * @fileoverview サロン統計・アナリティクストラッカーサービス
 * 
 * 日次・月次・年次の稼働実績（メニュー数・比率、ヘルプ相関、内部業務、隙間/空き時間、
 * 頑張れ配置、SOS、固定モード、不足、特殊召喚、お手伝いサポート等）の記録・集計・CSV出力を担当する。
 * 
 * 【アーキテクチャSSOT規約】
 * - 計算エンジン（summonEngine）への完全非干渉（Read-Only原則）
 * - 日次サマリー（Daily Summary）による軽量・高速永続化
 * - 運用開始日以降の自動蓄積・過去日確定ロック（改ざん防止）
 * 
 * @module services/statsTracker
 */

import { loadData, saveData } from './storage.js?v=20';

/** @constant {string} 日次統計データのストレージプレフィックス */
export const KEY_DAILY_STATS_PREFIX = 'sb_daily_stats_';

/** @constant {string} 統計トラッカー運用開始日のストレージキー */
export const KEY_STATS_START_DATE = 'sb_stats_start_date';

/** @constant {string} 蓄積済み日付インデックスのストレージキー */
export const KEY_STATS_DATES_INDEX = 'sb_stats_dates_index';

/**
 * 統計トラッカーの運用開始日を取得または初期化する
 * @param {string} [currentDateStr] - 今日の日付
 * @returns {string} 運用開始日 (YYYY-MM-DD)
 */
export function getOrCreateStartDate(currentDateStr) {
  let startDate = loadData(KEY_STATS_START_DATE);
  if (!startDate) {
    startDate = currentDateStr || new Date().toISOString().slice(0, 10);
    saveData(KEY_STATS_START_DATE, startDate);
  }
  return startDate;
}

/**
 * 蓄積されている全日付インデックスを取得する
 * @returns {string[]} 日付文字列の昇順配列
 */
export function getRecordedDates() {
  const index = loadData(KEY_STATS_DATES_INDEX);
  return Array.isArray(index) ? index : [];
}

/**
 * 日付インデックスに日付を追加して保存する
 * @param {string} dateStr
 */
function _addDateToIndex(dateStr) {
  const dates = getRecordedDates();
  if (!dates.includes(dateStr)) {
    dates.push(dateStr);
    dates.sort();
    saveData(KEY_STATS_DATES_INDEX, dates);
  }
}

/**
 * 指定日の日次統計サマリーを取得する
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Object|null}
 */
export function loadDailyStats(dateStr) {
  return loadData(`${KEY_DAILY_STATS_PREFIX}${dateStr}`);
}

/**
 * 指定期間の日次統計サマリーを一括取得する
 * @param {string} startDateStr - YYYY-MM-DD
 * @param {string} endDateStr - YYYY-MM-DD
 * @returns {Object[]}
 */
export function loadStatsRange(startDateStr, endDateStr) {
  const allDates = getRecordedDates();
  const targetDates = allDates.filter(d => d >= startDateStr && d <= endDateStr);
  
  const result = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  
  const cur = new Date(start);
  while (cur <= end) {
    const dStr = cur.toISOString().slice(0, 10);
    const stats = loadDailyStats(dStr);
    if (stats) {
      result.push(stats);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/**
 * 日次スナップショットを生成して保存する
 * 
 * 当日（営業中）は再計算ごとに上書き更新され、
 * 翌日以降（過去日）は「確定ロック」として上書きを防止する。
 * 
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Object} summonResult - summonEngineの計算結果
 * @param {Array} reservations - 予約配列
 * @param {Array} stylists - スタイリスト配列
 * @param {Array} assistants - アシスタント配列
 * @param {Array} menus - メニュー配列
 * @param {Object} [options={}] - SOSデータなどの追加情報
 * @returns {Object|null} 生成・保存された日次サマリー
 */
export function recordDailySnapshot(dateStr, summonResult, reservations, stylists, assistants, menus, options = {}) {
  if (!summonResult || !reservations) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const startDate = getOrCreateStartDate(todayStr);

  // 運用開始日以前の過去日の場合は上書きしない（改ざん防止）
  if (dateStr < startDate) {
    return null;
  }
  
  // 過去日の既存データがあり、今日でない場合はロック（確定データ保護）
  if (dateStr < todayStr) {
    const existing = loadDailyStats(dateStr);
    if (existing && existing.isLocked) {
      return existing;
    }
  }

  // 1. メニューマップ・スタッフマップの準備
  const menuMap = new Map();
  (menus || []).forEach(m => menuMap.set(m.id, m));

  const allStaffs = [...(stylists || []), ...(assistants || [])];
  const staffStats = {};
  allStaffs.forEach(s => {
    staffStats[s.id] = {
      id: s.id,
      name: s.name,
      type: s.type || (s.rank === 'junior' ? 'assistant' : 'stylist'),
      rank: s.rank || 'stylist',
      isWorking: s.isWorkingOn ? s.isWorkingOn(dateStr) : true,
      reservationCount: 0,
      helpReceivedCount: 0,
      helpReceivedMinutes: 0,
      helpProvidedCount: 0,
      helpProvidedMinutes: 0,
      bonusSupportCount: 0,
      bonusSupportMinutes: 0,
      lunchCount: 0,
      lunchMinutes: 0,
      restCount: 0,
      restMinutes: 0,
      practiceCount: 0,
      practiceMinutes: 0,
      cleaningCount: 0,
      cleaningMinutes: 0,
      freeTimeMinutes: 0,
      gapHelpMinutes: 0,
      gambareCount: 0,
      sosCount: 0,
      fixedCount: 0,
      summonedCount: 0,
      specialSummonedCount: 0,
      spSummonedCount: 0
    };
  });

  // 2. メニュー・技術・予約の集計
  const menuCounts = {};
  const skillCounts = {
    shampoo: 0,
    color: 0,
    cut: 0,
    treatment: 0,
    spa: 0,
    perm: 0,
    straight: 0,
    iron: 0,
    other: 0
  };

  let totalGambare = 0;
  let totalFixed = 0;

  (reservations || []).forEach(res => {
    const menu = menuMap.get(res.menuItemId);
    const menuName = menu ? menu.name : '不明メニュー';
    const menuId = res.menuItemId || 'unknown';

    if (!menuCounts[menuId]) {
      menuCounts[menuId] = { id: menuId, name: menuName, count: 0 };
    }
    menuCounts[menuId].count += 1;

    // スタイリストの担当予約数加算
    if (res.stylistId && staffStats[res.stylistId]) {
      staffStats[res.stylistId].reservationCount += 1;
    }

    // 技術（スロット）カウント
    if (menu && Array.isArray(menu.slots)) {
      menu.slots.forEach(slot => {
        const skill = (slot.requiredSkill || '').toLowerCase();
        if (skill.includes('shampoo') || skill.includes('シャンプー')) skillCounts.shampoo += 1;
        else if (skill.includes('color') || skill.includes('カラー')) skillCounts.color += 1;
        else if (skill.includes('cut') || skill.includes('カット')) skillCounts.cut += 1;
        else if (skill.includes('treatment') || skill.includes('トリートメント')) skillCounts.treatment += 1;
        else if (skill.includes('spa') || skill.includes('スパ')) skillCounts.spa += 1;
        else if (skill.includes('perm') || skill.includes('パーマ')) skillCounts.perm += 1;
        else if (skill.includes('straight') || skill.includes('矯正')) skillCounts.straight += 1;
        else if (skill.includes('iron') || skill.includes('アイロン')) skillCounts.iron += 1;
        else skillCounts.other += 1;
      });
    }

    // 頑張れ配置
    if (Array.isArray(res.gambareStaffIds)) {
      res.gambareStaffIds.forEach(stId => {
        if (staffStats[stId]) {
          staffStats[stId].gambareCount += 1;
          totalGambare += 1;
        }
      });
    }

    // 固定指名
    if (res.fixedAssistants) {
      Object.values(res.fixedAssistants).forEach(astId => {
        if (astId && astId !== '__none__' && staffStats[astId]) {
          staffStats[astId].fixedCount += 1;
          totalFixed += 1;
        }
      });
    }
  });

  // 3. ヘルプ実績・相関マトリクス・召喚実績の集計
  // 3. ヘルプ実績・相関マトリクス・召喚実績の集計
  const helpMatrix = {}; // stylistId -> assistantId -> { count, minutes }
  let totalAssignedMinutes = 0;
  let totalBonusSupport = 0;
  let totalSummons = 0;
  let totalSpecialSummons = 0;
  let totalSPSpecialSummons = 0;

  const helperBlocks = summonResult.helperBlocks || [];
  helperBlocks.forEach(hb => {
    const astId = hb.staffId || hb.assistantId;
    let minutes = 30;
    if (typeof hb.startMin === 'number' && typeof hb.endMin === 'number') {
      minutes = hb.endMin - hb.startMin;
    } else if (typeof hb.startTime === 'number' && typeof hb.endTime === 'number') {
      minutes = hb.endTime - hb.startTime;
    }

    if (!astId || !staffStats[astId]) return;

    // スタイリスト側のヘルプ受領
    let stId = hb.stylistId || hb.targetStylistId;
    if (!stId && (hb.resId || hb.reservationId)) {
      const targetResId = hb.resId || hb.reservationId;
      const res = reservations.find(r => r.id === targetResId);
      if (res) stId = res.stylistId;
    }

    // お手伝いサポート（✋ / bonus_support / otetsudai）
    const isBonus = hb.isBonusHelp || hb.isBonusSupport || hb.badge === 'otetsudai' || (hb.badges && hb.badges.includes('otetsudai'));
    if (isBonus) {
      staffStats[astId].bonusSupportCount += 1;
      staffStats[astId].bonusSupportMinutes += minutes;
      totalBonusSupport += 1;
    } else {
      // 通常ヘルプ
      staffStats[astId].helpProvidedCount += 1;
      staffStats[astId].helpProvidedMinutes += minutes;
      totalAssignedMinutes += minutes;

      if (stId && staffStats[stId]) {
        staffStats[stId].helpReceivedCount += 1;
        staffStats[stId].helpReceivedMinutes += minutes;

        if (!helpMatrix[stId]) helpMatrix[stId] = {};
        if (!helpMatrix[stId][astId]) helpMatrix[stId][astId] = { count: 0, minutes: 0 };
        helpMatrix[stId][astId].count += 1;
        helpMatrix[stId][astId].minutes += minutes;
      }
    }

    // 召喚バッジ別のカウント
    const badge = hb.badge || (hb.badges && hb.badges[0]);
    if (badge === 'sp_summon' || (hb.isSpecialSummon === false && hb.isSummon)) {
      staffStats[astId].summonedCount += 1;
      totalSummons += 1;
    } else if (badge === 'special_summon_lunch' || badge === 'special_summon_break') {
      staffStats[astId].specialSummonedCount += 1;
      totalSpecialSummons += 1;
    } else if (badge === 'sp_special_summon_gap' || hb.isSpecialSummon) {
      staffStats[astId].spSummonedCount += 1;
      totalSPSpecialSummons += 1;
    }
  });

  // 4. 内部業務（フリータイム・休憩・練習・大掃除）の集計
  const freeTimeActivities = summonResult.freeTimeActivities || [];
  freeTimeActivities.forEach(act => {
    const stId = act.staffId;
    if (!stId || !staffStats[stId]) return;

    let minutes = 30;
    if (typeof act.startTime === 'number' && typeof act.endTime === 'number') {
      minutes = act.endTime - act.startTime;
    } else if (act.startTime && act.endTime) {
      const s = new Date(act.startTime).getTime();
      const e = new Date(act.endTime).getTime();
      minutes = Math.round((e - s) / 60000);
    }

    // activity または activityType または type を判定
    const actType = act.activity || act.activityType || act.type;

    if (actType === 'lunch') {
      staffStats[stId].lunchCount += 1;
      staffStats[stId].lunchMinutes += minutes;
    } else if (actType === 'rest') {
      staffStats[stId].restCount += 1;
      staffStats[stId].restMinutes += minutes;
    } else if (actType === 'practice') {
      staffStats[stId].practiceCount += 1;
      staffStats[stId].practiceMinutes += minutes;
    } else if (actType === 'cleaning') {
      staffStats[stId].cleaningCount += 1;
      staffStats[stId].cleaningMinutes += minutes;
    } else if (actType === 'free_time') {
      staffStats[stId].freeTimeMinutes += minutes;
    } else if (actType === 'gap_help') {
      staffStats[stId].gapHelpMinutes += minutes;
    }
  });

  // 5. SOS集計
  let totalSOS = 0;
  if (options.sosLogs && Array.isArray(options.sosLogs)) {
    options.sosLogs.forEach(sos => {
      if (sos.stylistId && staffStats[sos.stylistId]) {
        staffStats[sos.stylistId].sosCount += 1;
        totalSOS += 1;
      }
    });
  }

  // 6. 不足（未アサイン）件数
  const totalShortages = Array.isArray(summonResult.alerts) ? summonResult.alerts.length : 0;

  // 7. メニュー構成比率（%）の算出
  const totalResCount = reservations.length;
  const menuStatsList = Object.values(menuCounts).map(m => ({
    ...m,
    ratio: totalResCount > 0 ? Math.round((m.count / totalResCount) * 1000) / 10 : 0
  })).sort((a, b) => b.count - a.count);

  // 8. 日次サマリーオブジェクトの構築
  const snapshot = {
    date: dateStr,
    updatedAt: new Date().toISOString(),
    isLocked: (dateStr < todayStr), // 過去日ならロック
    summary: {
      totalReservations: totalResCount,
      totalAssignedMinutes,
      totalShortages,
      totalSOS,
      totalGambare,
      totalFixed,
      totalBonusSupport,
      totalSummons,
      totalSpecialSummons,
      totalSPSpecialSummons
    },
    menus: menuStatsList,
    skills: skillCounts,
    staffStats,
    helpMatrix
  };

  // 保存とインデックス追加
  saveData(`${KEY_DAILY_STATS_PREFIX}${dateStr}`, snapshot);
  _addDateToIndex(dateStr);

  return snapshot;
}

/**
 * 複数日の日次サマリーを集計・合算する純粋関数
 * 
 * @param {Object[]} snapshots - 日次サマリーの配列
 * @param {string} [filterStaffId='all'] - スタッフIDで絞り込む場合 ('all' で全体)
 * @returns {Object} 集計結果オブジェクト
 */
export function aggregateStats(snapshots, filterStaffId = 'all') {
  const result = {
    totalDays: snapshots.length,
    startDate: snapshots.length > 0 ? snapshots[0].date : '',
    endDate: snapshots.length > 0 ? snapshots[snapshots.length - 1].date : '',
    summary: {
      totalReservations: 0,
      totalAssignedMinutes: 0,
      totalShortages: 0,
      totalSOS: 0,
      totalGambare: 0,
      totalFixed: 0,
      totalBonusSupport: 0,
      totalSummons: 0,
      totalSpecialSummons: 0,
      totalSPSpecialSummons: 0
    },
    menus: {},
    skills: {
      shampoo: 0,
      color: 0,
      cut: 0,
      treatment: 0,
      spa: 0,
      perm: 0,
      straight: 0,
      iron: 0,
      other: 0
    },
    staffStats: {},
    helpMatrix: {},
    isFiltered: (filterStaffId !== 'all'),
    filterStaffId
  };

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return result;
  }

  // 日付順にソート
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  result.startDate = sorted[0].date;
  result.endDate = sorted[sorted.length - 1].date;

  sorted.forEach(snap => {
    if (!snap) return;

    // スタッフ別集計の合算
    if (snap.staffStats) {
      Object.entries(snap.staffStats).forEach(([sId, sData]) => {
        if (!result.staffStats[sId]) {
          result.staffStats[sId] = {
            id: sId,
            name: sData.name,
            type: sData.type,
            rank: sData.rank,
            workingDays: 0,
            reservationCount: 0,
            helpReceivedCount: 0,
            helpReceivedMinutes: 0,
            helpProvidedCount: 0,
            helpProvidedMinutes: 0,
            bonusSupportCount: 0,
            bonusSupportMinutes: 0,
            lunchCount: 0,
            lunchMinutes: 0,
            restCount: 0,
            restMinutes: 0,
            practiceCount: 0,
            practiceMinutes: 0,
            cleaningCount: 0,
            cleaningMinutes: 0,
            freeTimeMinutes: 0,
            gapHelpMinutes: 0,
            gambareCount: 0,
            sosCount: 0,
            fixedCount: 0,
            summonedCount: 0,
            specialSummonedCount: 0,
            spSummonedCount: 0
          };
        }

        const target = result.staffStats[sId];
        if (sData.isWorking) target.workingDays += 1;
        target.reservationCount += (sData.reservationCount || 0);
        target.helpReceivedCount += (sData.helpReceivedCount || 0);
        target.helpReceivedMinutes += (sData.helpReceivedMinutes || 0);
        target.helpProvidedCount += (sData.helpProvidedCount || 0);
        target.helpProvidedMinutes += (sData.helpProvidedMinutes || 0);
        target.bonusSupportCount += (sData.bonusSupportCount || 0);
        target.bonusSupportMinutes += (sData.bonusSupportMinutes || 0);
        target.lunchCount += (sData.lunchCount || 0);
        target.lunchMinutes += (sData.lunchMinutes || 0);
        target.restCount += (sData.restCount || 0);
        target.restMinutes += (sData.restMinutes || 0);
        target.practiceCount += (sData.practiceCount || 0);
        target.practiceMinutes += (sData.practiceMinutes || 0);
        target.cleaningCount += (sData.cleaningCount || 0);
        target.cleaningMinutes += (sData.cleaningMinutes || 0);
        target.freeTimeMinutes += (sData.freeTimeMinutes || 0);
        target.gapHelpMinutes += (sData.gapHelpMinutes || 0);
        target.gambareCount += (sData.gambareCount || 0);
        target.sosCount += (sData.sosCount || 0);
        target.fixedCount += (sData.fixedCount || 0);
        target.summonedCount += (sData.summonedCount || 0);
        target.specialSummonedCount += (sData.specialSummonedCount || 0);
        target.spSummonedCount += (sData.spSummonedCount || 0);
      });
    }

    // フィルタリング対象に応じたサマリー加算
    if (filterStaffId === 'all') {
      // 全体集計
      if (snap.summary) {
        result.summary.totalReservations += (snap.summary.totalReservations || 0);
        result.summary.totalAssignedMinutes += (snap.summary.totalAssignedMinutes || 0);
        result.summary.totalShortages += (snap.summary.totalShortages || 0);
        result.summary.totalSOS += (snap.summary.totalSOS || 0);
        result.summary.totalGambare += (snap.summary.totalGambare || 0);
        result.summary.totalFixed += (snap.summary.totalFixed || 0);
        result.summary.totalBonusSupport += (snap.summary.totalBonusSupport || 0);
        result.summary.totalSummons += (snap.summary.totalSummons || 0);
        result.summary.totalSpecialSummons += (snap.summary.totalSpecialSummons || 0);
        result.summary.totalSPSpecialSummons += (snap.summary.totalSPSpecialSummons || 0);
      }

      // メニュー集計
      if (Array.isArray(snap.menus)) {
        snap.menus.forEach(m => {
          if (!result.menus[m.id]) {
            result.menus[m.id] = { id: m.id, name: m.name, count: 0 };
          }
          result.menus[m.id].count += m.count;
        });
      }

      // スキル集計
      if (snap.skills) {
        Object.entries(snap.skills).forEach(([k, v]) => {
          if (result.skills[k] !== undefined) result.skills[k] += v;
        });
      }

      // ヘルプ相関
      if (snap.helpMatrix) {
        Object.entries(snap.helpMatrix).forEach(([stId, astMap]) => {
          if (!result.helpMatrix[stId]) result.helpMatrix[stId] = {};
          Object.entries(astMap).forEach(([astId, val]) => {
            if (!result.helpMatrix[stId][astId]) result.helpMatrix[stId][astId] = { count: 0, minutes: 0 };
            result.helpMatrix[stId][astId].count += val.count;
            result.helpMatrix[stId][astId].minutes += val.minutes;
          });
        });
      }
    } else {
      // 特定スタッフ絞り込み
      const s = snap.staffStats ? snap.staffStats[filterStaffId] : null;
      if (s) {
        result.summary.totalReservations += (s.reservationCount || 0);
        result.summary.totalAssignedMinutes += (s.helpProvidedMinutes || s.helpReceivedMinutes || 0);
        result.summary.totalSOS += (s.sosCount || 0);
        result.summary.totalGambare += (s.gambareCount || 0);
        result.summary.totalFixed += (s.fixedCount || 0);
        result.summary.totalBonusSupport += (s.bonusSupportCount || 0);
        result.summary.totalSummons += (s.summonedCount || 0);
        result.summary.totalSpecialSummons += (s.specialSummonedCount || 0);
        result.summary.totalSPSpecialSummons += (s.spSummonedCount || 0);
      }

      // ヘルプ相関（対象スタッフ関連のみ）
      if (snap.helpMatrix) {
        Object.entries(snap.helpMatrix).forEach(([stId, astMap]) => {
          if (stId === filterStaffId) {
            // スタイリストとして受けたヘルプ
            if (!result.helpMatrix[stId]) result.helpMatrix[stId] = {};
            Object.entries(astMap).forEach(([astId, val]) => {
              if (!result.helpMatrix[stId][astId]) result.helpMatrix[stId][astId] = { count: 0, minutes: 0 };
              result.helpMatrix[stId][astId].count += val.count;
              result.helpMatrix[stId][astId].minutes += val.minutes;
            });
          } else if (astMap[filterStaffId]) {
            // アシスタントとして入ったヘルプ
            if (!result.helpMatrix[stId]) result.helpMatrix[stId] = {};
            if (!result.helpMatrix[stId][filterStaffId]) result.helpMatrix[stId][filterStaffId] = { count: 0, minutes: 0 };
            result.helpMatrix[stId][filterStaffId].count += astMap[filterStaffId].count;
            result.helpMatrix[stId][filterStaffId].minutes += astMap[filterStaffId].minutes;
          }
        });
      }
    }
  });

  // メニュー比率再計算
  const totalCount = Object.values(result.menus).reduce((sum, m) => sum + m.count, 0);
  result.menuList = Object.values(result.menus).map(m => ({
    ...m,
    ratio: totalCount > 0 ? Math.round((m.count / totalCount) * 1000) / 10 : 0
  })).sort((a, b) => b.count - a.count);

  return result;
}

/**
 * 集計結果をCSVフォーマットに変換しダウンロードする
 * 
 * @param {Object} aggregated - aggregateStats の集計結果
 * @param {string} periodLabel - '2026-08' や '2026年度' などのラベル
 * @param {string} [staffName='サロン全体']
 */
export function exportStatsToCSV(aggregated, periodLabel = '', staffName = 'サロン全体') {
  if (!aggregated) return;

  const lines = [];

  // UTF-8 BOM
  const BOM = '\uFEFF';

  lines.push(`Summon Balancer 稼働統計レポート`);
  lines.push(`対象期間,${aggregated.startDate} 〜 ${aggregated.endDate} (${periodLabel})`);
  lines.push(`集計対象,${staffName}`);
  lines.push(`集計日数,${aggregated.totalDays}日`);
  lines.push('');

  // 1. 主要指標サマリー
  lines.push('【主要実績サマリー】');
  lines.push('指標,数値,単位');
  lines.push(`総予約数,${aggregated.summary.totalReservations},件`);
  lines.push(`総ヘルプ時間,${aggregated.summary.totalAssignedMinutes},分 (${Math.round(aggregated.summary.totalAssignedMinutes / 60 * 10) / 10}時間)`);
  lines.push(`不足（赤枠エラー）数,${aggregated.summary.totalShortages},件`);
  lines.push(`SOS発動数,${aggregated.summary.totalSOS},回`);
  lines.push(`頑張れ配置数,${aggregated.summary.totalGambare},回`);
  lines.push(`固定指名数,${aggregated.summary.totalFixed},回`);
  lines.push(`お手伝いサポート（✋）数,${aggregated.summary.totalBonusSupport},回`);
  lines.push(`スタイリスト通常召喚数,${aggregated.summary.totalSummons},回`);
  lines.push(`特殊召喚（お昼・休憩）数,${aggregated.summary.totalSpecialSummons},回`);
  lines.push(`SP特殊召喚数,${aggregated.summary.totalSPSpecialSummons},回`);
  lines.push('');

  // 2. スタッフ別詳細
  lines.push('【スタッフ別 稼働・実績詳細】');
  lines.push('スタッフ名,役職,出勤日数,担当予約数,被ヘルプ回数,被ヘルプ時間(分),提供ヘルプ回数,提供ヘルプ時間(分),お手伝いサポート回数,お昼回数,休憩回数,練習回数,大掃除回数,空き時間(分),頑張れ配置,SOS,固定指名,特殊召喚');
  Object.values(aggregated.staffStats || {}).forEach(s => {
    lines.push([
      `"${s.name}"`,
      `"${s.rank || s.type}"`,
      s.workingDays,
      s.reservationCount,
      s.helpReceivedCount,
      s.helpReceivedMinutes,
      s.helpProvidedCount,
      s.helpProvidedMinutes,
      s.bonusSupportCount,
      s.lunchCount,
      s.restCount,
      s.practiceCount,
      s.cleaningCount,
      s.freeTimeMinutes,
      s.gambareCount,
      s.sosCount,
      s.fixedCount,
      (s.summonedCount + s.specialSummonedCount + s.spSummonedCount)
    ].join(','));
  });
  lines.push('');

  // 3. メニュー別実績
  if (aggregated.menuList && aggregated.menuList.length > 0) {
    lines.push('【メニュー別実績 & 比率】');
    lines.push('メニュー名,件数,構成比率(%)');
    aggregated.menuList.forEach(m => {
      lines.push(`"${m.name}",${m.count},${m.ratio}%`);
    });
    lines.push('');
  }

  // 4. 技術別スロット実績
  lines.push('【技術別スロット実績】');
  lines.push('技術名,スロット数');
  lines.push(`シャンプー,${aggregated.skills.shampoo}`);
  lines.push(`カラー,${aggregated.skills.color}`);
  lines.push(`カット,${aggregated.skills.cut}`);
  lines.push(`トリートメント,${aggregated.skills.treatment}`);
  lines.push(`ヘッドスパ,${aggregated.skills.spa}`);
  lines.push(`パーマ,${aggregated.skills.perm}`);
  lines.push(`縮毛矯正,${aggregated.skills.straight}`);
  lines.push(`アイロン,${aggregated.skills.iron}`);
  lines.push('');

  // 5. ヘルプ相関マトリクス
  lines.push('【スタイリスト ⇄ アシスタント ヘルプ相関（回数 / 分）】');
  const staffList = Object.values(aggregated.staffStats || {});
  const stylists = staffList.filter(s => s.type === 'stylist' || s.rank !== 'junior');
  const assistants = staffList.filter(s => s.type === 'assistant' || s.rank === 'junior');

  if (stylists.length > 0 && assistants.length > 0) {
    const header = ['スタイリスト＼アシスタント', ...assistants.map(a => `"${a.name}"`)];
    lines.push(header.join(','));

    stylists.forEach(st => {
      const row = [`"${st.name}"`];
      assistants.forEach(ast => {
        const cell = (aggregated.helpMatrix[st.id] && aggregated.helpMatrix[st.id][ast.id])
          ? `${aggregated.helpMatrix[st.id][ast.id].count}回 (${aggregated.helpMatrix[st.id][ast.id].minutes}分)`
          : '0回';
        row.push(`"${cell}"`);
      });
      lines.push(row.join(','));
    });
  }

  const csvContent = BOM + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fileName = `サロン統計_${periodLabel}_${staffName.replace(/[\s\/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
