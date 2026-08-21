/**
 * @fileoverview 練習実績トラッカーサービス
 * 
 * アシスタントの練習回数（週次・通算）の記録、集計、および水・木レッスン日（9:00〜10:00）の判定を行う。
 * 
 * 週サイクル: 金曜日〜翌週火曜日（5日間）
 * レッスン日判定: 金〜火の個人練習が3回未満の場合、水・木 9:00〜10:00 を「レッスン日」とする。
 * 
 * @module services/practiceTracker
 */

import { loadData, saveData } from './storage.js?v=110';

/** @constant {string} 練習ログのストレージキー */
export const KEY_PRACTICE_LOGS = 'sb_practice_logs';

/**
 * 日付文字列 (YYYY-MM-DD) から Date オブジェクト（ローカル0:00）を生成する
 * @param {string} dateStr
 * @returns {Date}
 */
export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Date オブジェクトを YYYY-MM-DD 文字列に変換する
 * @param {Date} date
 * @returns {string}
 */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 指定された日付が属する「金〜火サイクル」の開始金曜日の日付文字列を返す。
 * 
 * 金(5), 土(6), 日(0), 月(1), 火(2) → そのサイクルの開始金曜日
 * 水(3), 木(4) → 直前のサイクルの開始金曜日
 * 
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} 開始金曜日の YYYY-MM-DD
 */
export function getCycleStartFriday(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay(); // 0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土

  let offsetToFriday = 0;
  if (day === 5) {
    offsetToFriday = 0; // 金
  } else if (day === 6) {
    offsetToFriday = -1; // 土
  } else if (day === 0) {
    offsetToFriday = -2; // 日
  } else if (day === 1) {
    offsetToFriday = -3; // 月
  } else if (day === 2) {
    offsetToFriday = -4; // 火
  } else if (day === 3) {
    offsetToFriday = -5; // 水 (直前の金)
  } else if (day === 4) {
    offsetToFriday = -6; // 木 (直前の金)
  }

  const fri = new Date(d);
  fri.setDate(d.getDate() + offsetToFriday);
  return formatDate(fri);
}

/**
 * 指定された日付の「金〜火サイクル（5日間）」に含まれる全日付（YYYY-MM-DD）のリストを返す。
 * @param {string} dateStr
 * @returns {string[]} [金, 土, 日, 月, 火]
 */
export function getCycleDates(dateStr) {
  const friStr = getCycleStartFriday(dateStr);
  const fri = parseDate(friStr);
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const cur = new Date(fri);
    cur.setDate(fri.getDate() + i);
    dates.push(formatDate(cur));
  }
  return dates;
}

/**
 * 指定された日付が水曜日または木曜日かを判定する。
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isWednesdayOrThursday(dateStr) {
  const day = parseDate(dateStr).getDay();
  return day === 3 || day === 4;
}

/**
 * 全練習ログを取得する
 * @returns {Array<PracticeLog>}
 */
export function loadPracticeLogs() {
  const data = loadData(KEY_PRACTICE_LOGS);
  return Array.isArray(data) ? data : [];
}

/**
 * 練習ログを保存する
 * @param {Array<PracticeLog>} logs
 */
export function savePracticeLogs(logs) {
  saveData(KEY_PRACTICE_LOGS, logs);
}

/**
 * 練習ログを1件追加または更新する
 * @param {Object} log
 * @param {string} log.staffId
 * @param {string} log.date - YYYY-MM-DD
 * @param {number} log.startTime - 9:00基準の開始分
 * @param {number} [log.duration=30] - 所要時間（分）
 * @param {boolean} [log.verified=false] - 現場での実施確認フラグ
 * @param {boolean} [log.isForced=false] - 手動ボタンで発動されたか
 * @returns {Object} 保存されたログ
 */
export function recordPracticeLog(log) {
  const logs = loadPracticeLogs();
  const id = log.id || `practice_${log.staffId}_${log.date}_${log.startTime}`;
  const existingIdx = logs.findIndex(l => l.id === id);

  const newLog = {
    id,
    staffId: log.staffId,
    date: log.date,
    startTime: log.startTime,
    duration: log.duration || 30,
    verified: log.verified ?? false,
    isForced: !!log.isForced,
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    logs[existingIdx] = { ...logs[existingIdx], ...newLog };
  } else {
    logs.push(newLog);
  }

  savePracticeLogs(logs);
  return newLog;
}

/**
 * 練習ログの実施確認（verified）を更新する
 * @param {string} staffId
 * @param {string} date - YYYY-MM-DD
 * @param {number} startTime
 * @param {boolean} verified - true: 実施した, false: 実施しなかった
 */
export function verifyPracticeLog(staffId, date, startTime, verified) {
  const logs = loadPracticeLogs();
  const id = `practice_${staffId}_${date}_${startTime}`;
  const target = logs.find(l => l.id === id || (l.staffId === staffId && l.date === date && l.startTime === startTime));

  if (target) {
    target.verified = verified;
    target.updatedAt = new Date().toISOString();
  } else {
    logs.push({
      id,
      staffId,
      date,
      startTime,
      duration: 30,
      verified,
      isForced: false,
      updatedAt: new Date().toISOString()
    });
  }

  savePracticeLogs(logs);
}

/**
 * 練習ログを削除する
 * @param {string} staffId
 * @param {string} date
 * @param {number} startTime
 */
export function removePracticeLog(staffId, date, startTime) {
  const logs = loadPracticeLogs();
  const filtered = logs.filter(
    l => !(l.staffId === staffId && l.date === date && l.startTime === startTime)
  );
  savePracticeLogs(filtered);
}

/**
 * 指定アシスタントの練習実績集計（当週回数・通算回数・水木レッスン必要判定）を取得する
 * 
 * @param {string} staffId - スタッフID
 * @param {string} targetDateStr - 判定対象日 (YYYY-MM-DD)
 * @returns {{
 *   currentWeekCount: number,
 *   totalCount: number,
 *   isLessonRequired: boolean,
 *   cycleStartFriday: string,
 *   cycleDates: string[],
 *   verifiedLogs: Object[],
 *   pendingLogs: Object[]
 * }}
 */
export function getAssistantPracticeStats(staffId, targetDateStr) {
  const logs = loadPracticeLogs().filter(l => l.staffId === staffId);
  const cycleDates = getCycleDates(targetDateStr);
  const cycleDateSet = new Set(cycleDates);
  const cycleStartFriday = getCycleStartFriday(targetDateStr);

  // 通算確認済み回数（全期間で verified === true のログ）
  // 1ログ（30分） = 1回
  const verifiedLogs = logs.filter(l => l.verified === true);
  const totalCount = verifiedLogs.reduce((sum, l) => sum + Math.max(1, Math.round((l.duration || 30) / 30)), 0);

  // 当該金〜火サイクルの確認済み回数
  const currentCycleVerifiedLogs = verifiedLogs.filter(l => cycleDateSet.has(l.date));
  const currentWeekCount = currentCycleVerifiedLogs.reduce((sum, l) => sum + Math.max(1, Math.round((l.duration || 30) / 30)), 0);

  // 未確認ログ（過去日または対象日ですでに経過した未確認ログ）
  const pendingLogs = logs.filter(l => l.verified !== true);

  // 水曜日・木曜日のレッスン日判定:
  // 対象日が水または木で、直近金〜火の練習回数が 3回未満 の場合、レッスン日が必要
  const isWedOrThu = isWednesdayOrThursday(targetDateStr);
  const isLessonRequired = isWedOrThu && (currentWeekCount < 3);

  return {
    staffId,
    currentWeekCount,
    totalCount,
    isLessonRequired,
    cycleStartFriday,
    cycleDates,
    verifiedLogs,
    pendingLogs
  };
}
