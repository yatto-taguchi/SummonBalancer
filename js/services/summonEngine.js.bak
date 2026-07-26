/**
 * summonEngine.js — 召喚（自動配置）エンジン
 *
 * 美容室でスタイリストがお客様を掛け持ちする際、
 * アシスタントを最適に自動配置（召喚）するためのコアロジック。
 *
 * 予約が変更されるたびに全アシスタントの最適配置を再計算する。
 */

import { RANKS, SKILLS } from '../models/staff.js?v=14';

/**
 * 召喚結果を表すオブジェクト
 * @typedef {Object} SummonResult
 * @property {Object.<string, Object.<number, string>>} assignments - 予約ID → { スロットIndex → アシスタントID }
 * @property {Array<{stylistId: string, reservationId: string, slotIndex: number, badge: boolean}>} stylistSummons - スタイリスト召喚リスト
 * @property {Array<{reservationId: string, slotIndex: number, message: string}>} alerts - アラートリスト
 * @property {Array<{staffId: string, startTime: Date, endTime: Date, activity: string}>} freeTimeActivities - 空き時間活動
 * @property {Object.<string, {busyMinutes: number, assignmentCount: number, fairnessScore: number}>} fairnessScores - 公平性スコア
 */

/**
 * 内部で扱う必要スロット情報
 * @typedef {Object} RequiredSlot
 * @property {string} reservationId - 予約ID
 * @property {number} slotIndex - スロットインデックス
 * @property {Date} startTime - 実際の開始時刻
 * @property {Date} endTime - 実際の終了時刻
 * @property {string} requiredSkill - 必要スキルID
 * @property {number} requiredProficiency - 必要習熟度
 * @property {string} stylistId - 該当予約のスタイリストID
 * @property {boolean} isOverlapping - 掛け持ち箇所かどうか
 */

export class SummonEngine {
  constructor() {
    /** @type {Object.<string, number>} アシスタントごとの配置回数 */
    this._assignmentCounts = {};
  }

  /**
   * 時刻値をタイムスタンプ（比較可能な数値）に変換する
   * 分数値の場合はそのまま返す、Date/文字列の場合はnew Date().getTime()を返す
   * @param {number|string|Date} time
   * @returns {number}
   * @private
   */
  _toTimestamp(time) {
    if (typeof time === 'number') return time;
    return new Date(time).getTime();
  }

  // ──────────────────────────────────────────────
  // Step 2: ヘルパー関数群（振る舞い変更なし）
  // ──────────────────────────────────────────────

  /**
   * 指定した予約の終了時刻から、同スタイリストの次の予約開始時刻までの空き時間（ミリ秒 or 分）を返す。
   * 次の予約がない場合は Infinity を返す。
   * @param {Object} reservation - 対象予約
   * @param {Object[]} allReservations - 当日の全予約
   * @returns {number} 空き時間（reservationがDateモードならms、minutesモードなら分）
   * @private
   */
  _getGapAfterReservation(reservation, allReservations) {
    const resEnd = this._toTimestamp(reservation.endTime);
    const sameStylist = allReservations.filter(r =>
      r.id !== reservation.id && r.stylistId === reservation.stylistId
    );
    let minGap = Infinity;
    sameStylist.forEach(r => {
      const rStart = this._toTimestamp(r.startTime);
      if (rStart >= resEnd) {
        const gap = rStart - resEnd;
        if (gap < minGap) minGap = gap;
      }
    });
    return minGap;
  }

  /**
   * 指定した予約の開始時刻より前にある、同スタイリストの直前の予約終了時刻までの空き時間を返す。
   * 前の予約がない場合は Infinity を返す。
   * @param {Object} reservation - 対象予約
   * @param {Object[]} allReservations - 当日の全予約
   * @returns {number} 空き時間（reservationがDateモードならms、minutesモードなら分）
   * @private
   */
  _getGapBeforeReservation(reservation, allReservations) {
    const resStart = this._toTimestamp(reservation.startTime);
    const sameStylist = allReservations.filter(r =>
      r.id !== reservation.id && r.stylistId === reservation.stylistId
    );
    let minGap = Infinity;
    sameStylist.forEach(r => {
      const rEnd = this._toTimestamp(r.endTime);
      if (rEnd <= resStart) {
        const gap = resStart - rEnd;
        if (gap < minGap) minGap = gap;
      }
    });
    return minGap;
  }

  /**
   * 当日の全予約から、各スタイリストの「予定稼働率」を事前計算して返す。
   * 稼働率 = スタイリストの予約が占める時間 / 営業時間（600分）
   * @param {Object[]} stylists - 出勤中のスタイリスト
   * @param {Object[]} reservations - 当日の全予約
   * @returns {Object.<string, number>} stylistId → 稼働率(0〜1)のマップ
   * @private
   */
  _getStylistUtilizationRates(stylists, reservations) {
    const rates = {};
    const isMinutesMode = reservations.length > 0 && typeof reservations[0].startTime === 'number';
    const BUSINESS_MINUTES = 600; // 9:00〜19:00

    stylists.forEach(stylist => {
      const stylistReservations = reservations.filter(r => r.stylistId === stylist.id);
      // 重複を排除して合計稼働時間を計算
      const slots = stylistReservations.map(r => {
        const start = this._toTimestamp(r.startTime);
        const end = this._toTimestamp(r.endTime);
        return { start, end };
      }).sort((a, b) => a.start - b.start);

      let totalBusy = 0;
      let mergedEnd = -Infinity;
      slots.forEach(s => {
        if (s.start > mergedEnd) {
          totalBusy += s.end - s.start;
          mergedEnd = s.end;
        } else if (s.end > mergedEnd) {
          totalBusy += s.end - mergedEnd;
          mergedEnd = s.end;
        }
      });

      // minutesモードなら分、DateモードならmsなのでBUSINESS_MINUTESに合わせて変換
      const busyMinutes = isMinutesMode ? totalBusy : totalBusy / 60000;
      rates[stylist.id] = Math.min(1, busyMinutes / BUSINESS_MINUTES);
    });

    return rates;
  }

  /**
   * 指定した時間帯に「何も仕事のない」アシスタントの数を返す。
   * 「仕事のない」= 該当時間帯に配置（assignments）されていない かつ 予約なし。
   * @param {Date|number} startTime - スロット開始時刻
   * @param {Date|number} endTime - スロット終了時刻
   * @param {Object[]} assistants - 出勤中のアシスタント
   * @param {Object} assignments - 現在の全配置情報
   * @returns {number} 空きアシスタント数
   * @private
   */
  _countIdleAssistants(startTime, endTime, assistants, assignments) {
    let count = 0;
    assistants.forEach(a => {
      const isBusy = this._hasTimeConflict(a.id, startTime, endTime, assignments);
      if (!isBusy) count++;
    });
    return count;
  }

  /**
   * 全予約に対してアシスタントを最適配置する
   * @param {import('../models/reservation.js').Reservation[]} reservations - 当日の全予約
   * @param {import('../models/staff.js').Staff[]} stylists - 出勤中のスタイリスト
   * @param {import('../models/staff.js').Staff[]} assistants - 出勤中のアシスタント
   * @param {import('../models/menu.js').MenuItem[]} menus - メニュー定義
   * @returns {SummonResult} 配置結果
   */
  calculate(reservations, stylists, assistants, menus, lunchOverrides = {}, restOverrides = {}) {
    // 配置カウントをリセット
    this._assignmentCounts = {};
    assistants.forEach(a => { this._assignmentCounts[a.id] = 0; });
    stylists.forEach(s => { this._assignmentCounts[s.id] = 0; });

    // メニューをIDで索引化
    const menuMap = new Map();
    menus.forEach(m => menuMap.set(m.id, m));

    // 予約ID -> スタイリストIDのマップを保持（兼任判定用）
    this._reservationStylistMap = new Map(reservations.map(r => [r.id, r.stylistId]));
    this._allReservations = reservations;

    // [Step 3追加] 当日全予約からスタイリストの予定稼働率を事前計算
    const stylistRates = this._getStylistUtilizationRates(stylists, reservations);

    // Step 1 & 2: 必要スロットを抽出し、掛け持ち箇所を特定して優先順位付け
    const overlapRegionsMap = this._getOverlapRegions(reservations);
    const requiredSlots = this._getRequiredSlots(
      reservations, menuMap, overlapRegionsMap, stylists, assistants, stylistRates
    );
    this._allRequiredSlots = requiredSlots;

    // Step 3-5: アシスタントを配置
    // 掛け持ち不可のスタイリストの予約には自動配置しない（固定モードのみ可）
    const stylistMap = new Map(stylists.map(s => [s.id, s]));
    const filteredSlots = requiredSlots.filter(slot => {
      // 非掛け持ちスロットで召喚不要と判定された場合は除外
      if (slot.skipSummon) return false;
      if (slot.fixedAssistantId) return true; // 固定モードは常に許可
      const stylist = stylistMap.get(slot.stylistId);
      return !stylist || stylist.canDoubleBook !== false;
    });
    // Greedy配置はアシスタントのみで実行（スタイリストは最適化パスでのみ候補になる）
    let { assignments, concurrentAssignments, unfilledSlots, autoSlots } = this._assignAssistants(filteredSlots, assistants);

    // --- グローバル最適化パス（兼任解消リバランス） ---
    // スタイリストは全スキルを実行可能なので、スキル未設定の場合は全スキルをMAXで注入
    const allSkillIds = menus.flatMap(m => (m.assistantSlots || []).map(s => s.requiredSkill)).filter(Boolean);
    const uniqueSkillIds = [...new Set(allSkillIds)];
    stylists.forEach(s => {
      if (!s.skills || s.skills.length === 0) {
        s.skills = uniqueSkillIds.map(id => ({ id, proficiency: 5 }));
      }
    });

    // スタイリストの自予約時間帯を _assignedSlotTimes に登録（競合チェック用）
    // これにより _hasTimeConflict で「自分の予約と重複する時間帯」が検出される
    reservations.forEach(res => {
      const stId = res.stylistId;
      if (!this._assignedSlotTimes[stId]) {
        this._assignedSlotTimes[stId] = [];
      }
      this._assignedSlotTimes[stId].push({
        start: this._toTimestamp(res.startTime),
        end: this._toTimestamp(res.endTime)
      });
    });

    // 最適化パス: アシスタントのみで実行（スタイリスト配置は従来のフォールバック経由のみ）
    this._optimizeAssignments(assignments, autoSlots, assistants);

    // Step 5.5: マンセル制フォールバック（掛け持ちブロックの不足解消）
    const overlappingPairs = new Set();
    requiredSlots.forEach(slot => {
      if (slot.isOverlapping) {
        overlappingPairs.add(slot.reservationId);
      }
    });

    const manncells = this._applyManncellFallback(
      assignments, unfilledSlots, autoSlots, requiredSlots, assistants, reservations, overlappingPairs
    );

    // Step 6: スタイリスト召喚フォールバック
    const stylistSummons = this._handleStylistFallback(
      unfilledSlots, stylists, reservations, menuMap, assignments
    );

    // 手動固定（fixedAssistantId）でスタイリストが指定されている場合も特殊召喚として集計
    const stylistIdSet = new Set(stylists.map(s => s.id));
    requiredSlots.forEach(slot => {
      if (slot.fixedAssistantId && stylistIdSet.has(slot.fixedAssistantId)) {
        const exists = stylistSummons.some(
          s => s.reservationId === slot.reservationId && s.slotIndex === slot.slotIndex
        );
        if (!exists) {
          stylistSummons.push({
            stylistId: slot.fixedAssistantId,
            reservationId: slot.reservationId,
            slotIndex: slot.slotIndex,
            startTime: slot.startTime,
            endTime: slot.endTime,
            badge: true,
            isSpecialSummon: true,
            specialSummonReason: 'manual'
          });
        }
      }
    });

    // ゴースト不足対策：実際に assignments にアサインされているスロットは unfilledSlots から確実に除外する
    unfilledSlots = unfilledSlots.filter(slot => {
      return !(assignments[slot.reservationId] && assignments[slot.reservationId][slot.slotIndex]);
    });

    // Step 7: アラート生成（それでも配置できなかったスロット）
    // ※ 掛け持ち箇所（isOverlapping=true）のみアラート対象。
    //   掛け持ちしていない予約のアシスタント不足は「あれば配置・なければスキップ」とし、
    //   アラートを出さない（人員不足の深刻な状況として扱わない）。
    const alerts = [];
    unfilledSlots.forEach(slot => {
      // スタイリスト召喚で解決したかチェック
      const isSummoned = stylistSummons.some(
        s => s.reservationId === slot.reservationId && s.slotIndex === slot.slotIndex
      );
      if (!isSummoned) {
        // 掛け持ち箇所のみアラートを生成する
        if (slot.isOverlapping) {
          alerts.push({
            reservationId: slot.reservationId,
            slotIndex: slot.slotIndex,
            message: '人数不足'
          });
        }
        // 非掛け持ち予約の不足は静かにスキップ（アラートなし）
      }
    });

    // Step 8: 空き時間活動と稼働率の計算
    const { activities: freeTimeActivities, utilizationRates } = this._assignFreeTimeActivities(
      assistants, stylists, reservations, menuMap, assignments, stylistSummons, lunchOverrides, restOverrides
    );

    // 公平性スコア計算
    const fairnessScores = this._calculateFairness(assignments, assistants, requiredSlots);

    // ポスト処理: 掛け持ちスタイリストの予約内で、同一アシスタントの時間重複スロットを検出し兼任フラグを付与する
    const allConcurrentAssignments = this._detectAllConcurrentSlots(assignments, requiredSlots, menuMap, overlappingPairs, reservations);

    return {
      assignments,
      concurrentAssignments: allConcurrentAssignments,
      stylistSummons,
      alerts,
      freeTimeActivities,
      fairnessScores,
      utilizationRates,
      manncells
    };
  }

  /**
   * 兼任検出: 掛け持ちスタイリストの予約内で、同一アシスタントが異なる予約の時間重複スロットに
   * アサインされている場合のみ兼任フラグ＋矢印を記録する。
   * 追加: 前の予約内で対象スロットより前に終わるスロットの担当者にも潜在兼任フラグ＋矢印を付与する。
   * @param {Object} assignments
   * @param {RequiredSlot[]} requiredSlots
   * @param {Map} menuMap
   * @param {Set<string>} overlappingPairs - 掛け持ちしている予約IDのセット
   * @param {Array} reservations - 全予約配列（予約開始時間の取得用）
   */
  _detectAllConcurrentSlots(assignments, requiredSlots, menuMap, overlappingPairs, reservations) {
    const concurrentAssignments = {};

    // 予約IDから予約開始時間を引くマップ
    const resStartMap = new Map();
    reservations.forEach(r => {
      resStartMap.set(r.id, this._toTimestamp(r.startTime));
    });

    // 全スロット情報を収集（掛け持ちスタイリストの予約のみ）
    const slotList = [];
    requiredSlots.forEach(slot => {
      // ★ Phase1: 掛け持ちセットに含まれない予約は除外
      if (!overlappingPairs.has(slot.reservationId)) return;

      const resAssign = assignments[slot.reservationId];
      if (!resAssign) return;
      const astId = typeof resAssign[slot.slotIndex] === 'object'
        ? resAssign[slot.slotIndex].id
        : resAssign[slot.slotIndex];
      if (!astId || astId === '__none__') return;
      slotList.push({
        reservationId: slot.reservationId,
        slotIndex: slot.slotIndex,
        stylistId: slot.stylistId,
        assistantId: astId,
        requiredSkill: slot.requiredSkill,
        start: this._toTimestamp(slot.startTime),
        end: this._toTimestamp(slot.endTime)
      });
    });

    // 同一アシスタント＋同一スタイリスト＋異なる予約＋時間重複 のペアのみ検出
    for (let i = 0; i < slotList.length; i++) {
      for (let j = i + 1; j < slotList.length; j++) {
        const a = slotList[i];
        const b = slotList[j];
        if (a.assistantId !== b.assistantId) continue;   // 同一人物でなければスキップ
        if (a.stylistId !== b.stylistId) continue;       // 同一スタイリストでなければスキップ
        if (a.reservationId === b.reservationId) continue; // 同一予約内はスキップ
        if (!(a.start < b.end && b.start < a.end)) continue; // 時間が被っていなければスキップ

        // ★ Phase2: 予約単位の開始時間で前後を判定（スロット単位ではない）
        const resAStart = resStartMap.get(a.reservationId) || a.start;
        const resBStart = resStartMap.get(b.reservationId) || b.start;
        const earlier = resAStart <= resBStart ? a : b; // 前の予約のスロット
        const later = resAStart <= resBStart ? b : a;   // 後の予約のスロット

        // 兼任確定！両方のスロットにフラグを立てる
        if (!concurrentAssignments[earlier.reservationId]) concurrentAssignments[earlier.reservationId] = {};
        if (!concurrentAssignments[later.reservationId]) concurrentAssignments[later.reservationId] = {};

        const earlierInfo = concurrentAssignments[earlier.reservationId][earlier.slotIndex] || { isConcurrent: true, targets: [] };
        const laterInfo = concurrentAssignments[later.reservationId][later.slotIndex] || { isConcurrent: true, targets: [] };
        earlierInfo.isConcurrent = true;
        laterInfo.isConcurrent = true;

        // 矢印: 前の予約のスロット → 後の予約の被っているスロット（一方向のみ）
        earlierInfo.targets.push({ reservationId: later.reservationId, slotIndex: later.slotIndex });

        // 兼任ペア情報を記録
        concurrentAssignments[earlier.reservationId][earlier.slotIndex] = earlierInfo;
        concurrentAssignments[later.reservationId][later.slotIndex] = laterInfo;
      }
    }

    return concurrentAssignments;
  }

  /**
   * スタイリストごとの掛け持ち（オーバーラップ）発生時間帯を計算する
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @returns {Map<string, Array<{start: number, end: number, maxOverlap: number}>>}
   */
  _getOverlapRegions(reservations) {
    const byStylist = new Map();
    reservations.forEach(res => {
      if (!byStylist.has(res.stylistId)) {
        byStylist.set(res.stylistId, []);
      }
      byStylist.get(res.stylistId).push(res);
    });

    const regionsMap = new Map();
    byStylist.forEach((stylistReservations, stylistId) => {
      const events = [];
      stylistReservations.forEach(r => {
        events.push({ time: this._toTimestamp(r.startTime), type: 1 });
        events.push({ time: this._toTimestamp(r.endTime), type: -1 });
      });
      // 同じ時間の場合は終了（-1）を先に処理して一瞬の重なりを除外
      events.sort((a, b) => a.time !== b.time ? a.time - b.time : a.type - b.type);

      const regions = [];
      let overlap = 0;
      let regionStart = null;
      let maxOverlapInRegion = 0;

      events.forEach(e => {
        overlap += e.type;
        if (overlap >= 2 && regionStart === null) {
          regionStart = e.time;
          maxOverlapInRegion = overlap;
        }
        if (regionStart !== null && overlap > maxOverlapInRegion) {
          maxOverlapInRegion = overlap;
        }
        if (overlap < 2 && regionStart !== null) {
          if (e.time > regionStart) { // 長さが0の重なりは無視
            regions.push({ start: regionStart, end: e.time, maxOverlap: maxOverlapInRegion });
          }
          regionStart = null;
          maxOverlapInRegion = 0;
        }
      });
      regionsMap.set(stylistId, regions);
    });

    return regionsMap;
  }

  /**
   * カラー・パーマ・アイロン・1液・2液等の重要施術スキルまたはメニューであるかを判定する
   * @param {string} skillId - スキルID
   * @param {string} menuName - メニュー名
   * @returns {boolean}
   * @private
   */
  _isCriticalSkillOrMenu(skillId, menuName = '') {
    if (!skillId && !menuName) return false;
    const target = `${skillId || ''} ${menuName || ''}`.toLowerCase();
    return /color|perm|iron|fluid|カラー|パーマ|アイロン|1液|１液|2液|２液/.test(target);
  }

  /**
   * 全予約から必要なアシスタントスロットを抽出し、新しい優先順位基準でソートする
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {Map<string, import('../models/menu.js').MenuItem>} menuMap
   * @param {Set<string>} overlappingReservationIds
   * @param {import('../models/staff.js').Staff[]} stylists
   * @param {import('../models/staff.js').Staff[]} assistants
   * @param {Object.<string, number>} stylistRates
   * @returns {RequiredSlot[]}
   */
  _getRequiredSlots(reservations, menuMap, overlapRegionsMap, stylists = [], assistants = [], stylistRates = {}) {
    const slots = [];
    const isMinutesMode = reservations.length > 0 && typeof reservations[0].startTime === 'number';
    const toUnit = (minutes) => isMinutesMode ? minutes : minutes * 60000;
    const stylistMap = new Map(stylists.map(s => [s.id, s]));

    const stylistTimeSlots = new Map();

    reservations.forEach(res => {
      const menu = menuMap.get(res.menuItemId);
      if (!menu || !menu.assistantSlots) return;

      const resStart = this._toTimestamp(res.startTime);
      const stylist = stylistMap.get(res.stylistId);
      if (!stylist) return;

      const gapAfter = this._getGapAfterReservation(res, reservations);
      const gapBefore = this._getGapBeforeReservation(res, reservations);
      const MIN_30 = toUnit(30);

      // NonOverlapEval は非掛け持ち時に召喚するかどうかの判定
      // 各スロットが実際に重なり時間帯に入るかどうかは後で判定するが、
      // 予約全体として「掛け持ち可能スタイリストの単独予約（または重なり前後の時間）」である可能性があるため
      // 常に計算しておく。後で isOverlapping が false のスロットのみこれを利用する。
      let nonOverlapEval = null;
      if (stylist.canDoubleBook) {
        if (res.nonOverlapSummonEnabled === false) {
          nonOverlapEval = { skipSummon: true, priority: 0 };
        } else {
          nonOverlapEval = this._evaluateNonOverlappingSlot(
            res, reservations, stylist, assistants, stylistRates, isMinutesMode, toUnit
          );
        }
      }

      menu.assistantSlots.forEach((slot, index) => {
        const timeOverride = res.slotTimeOverrides && res.slotTimeOverrides[index];
        const effectiveStart = timeOverride ? timeOverride.startMinute : slot.startMinute;
        const effectiveEnd   = timeOverride ? timeOverride.endMinute   : slot.endMinute;

        const slotStartTime = typeof res.startTime === 'number'
          ? resStart + effectiveStart
          : new Date(resStart + effectiveStart * 60000);
        const slotEndTime = typeof res.startTime === 'number'
          ? resStart + effectiveEnd
          : new Date(resStart + effectiveEnd * 60000);

        const slotStartTs = this._toTimestamp(slotStartTime);
        const slotEndTs = this._toTimestamp(slotEndTime);
        
        let isOverlapping = false;
        let manncellRegion = null;
        const stylistRegions = overlapRegionsMap.get(res.stylistId) || [];
        for (const region of stylistRegions) {
          if (slotStartTs < region.end && region.start < slotEndTs) {
            isOverlapping = true;
            manncellRegion = region;
            break;
          }
        }

        const isCritical = this._isCriticalSkillOrMenu(slot.requiredSkill, menu.name);
        const profOverride = res.proficiencyOverrides && res.proficiencyOverrides[index];
        let effectiveProf = profOverride != null ? profOverride : (slot.requiredProficiency || 1);
        if (isCritical) {
          effectiveProf = 5;
        }

        const isOwner = stylist.rank === 'owner';
        const isPriority = stylist.prioritySummon === true;
        const isOwnerOrPriority = isOwner || isPriority;
        const stylistRate = stylistRates[stylist.id] || 0;

        // スタイリスト同時間帯のヘルプ人数の分類（1人目ヘルプ vs 2人目補助ヘルプ）
        if (!stylistTimeSlots.has(stylist.id)) {
          stylistTimeSlots.set(stylist.id, []);
        }
        const existingSlots = stylistTimeSlots.get(stylist.id);
        const overlapCount = existingSlots.filter(s => {
          const sStart = this._toTimestamp(s.startTime);
          const sEnd = this._toTimestamp(s.endTime);
          const curStart = this._toTimestamp(slotStartTime);
          const curEnd = this._toTimestamp(slotEndTime);
          return curStart < sEnd && sStart < curEnd;
        }).length;

        const isLuxuryHelp = isOverlapping && overlapCount >= 1;

        // 優先度スコア (priorityScore) の計算:
        // 掛け持ち（isOverlapping）スロットを最優先で配置し、
        // 掛け持ちなしのスロットは後回しにする（一人で回せるため）
        //
        // 1. オーナー / 優先トグルON の 1人目ヘルプ（掛け持ち）: 1,000点
        // 2. 一般スタイリスト の 1人目ヘルプ（掛け持ち）: 800点
        // 3. オーナー / 優先トグルON の 2人目補助ヘルプ（掛け持ち）: 600点
        // 4. 一般スタイリスト の 2人目補助ヘルプ（掛け持ち）: 400点
        // 5. 掛け持ちなし（オーナー/優先）: 300点
        // 6. 掛け持ちなし（一般）: 200点 ← 一人で全部回せるので最低優先
        let priorityScore = 0;

        if (isOverlapping) {
          // 掛け持ちスロット: アシスタント配置が必須
          if (!isLuxuryHelp) {
            // 1人目ヘルプ
            if (isOwnerOrPriority) {
              priorityScore = 1000;
            } else {
              priorityScore = 800;
              if (gapAfter >= MIN_30) {
                priorityScore -= 150;
              } else {
                priorityScore += Math.round(stylistRate * 80);
              }
            }
          } else {
            // 2人目補助ヘルプ
            if (isOwnerOrPriority) {
              priorityScore = 600;
            } else {
              priorityScore = 400;
              if (gapAfter >= MIN_30) {
                priorityScore -= 150;
              } else {
                priorityScore += Math.round(stylistRate * 80);
              }
            }
          }
        } else {
          // 掛け持ちなし: 一人で回せるので優先度低め
          if (isOwnerOrPriority) {
            priorityScore = 300;
          } else {
            priorityScore = 200;
            if (gapAfter >= MIN_30) {
              priorityScore -= 50;
            } else {
              priorityScore += Math.round(stylistRate * 30);
            }
          }
        }

        if (isCritical) {
          priorityScore += 100; // 重要技術（Lv5）加算
        }

        const slotObj = {
          reservationId: res.id,
          slotIndex: index,
          startTime: slotStartTime,
          endTime: slotEndTime,
          requiredSkill: slot.requiredSkill,
          requiredProficiency: effectiveProf,
          stylistId: res.stylistId,
          isOverlapping,
          isLuxuryHelp,
          isCritical,
          priorityScore,
          manncellRegion, // 追加: MANCELL対象枠の場合、どの重なり時間帯に属するか
          fixedAssistantId: (res.fixedAssistants && res.fixedAssistants[index]) ? res.fixedAssistants[index] : null,
          skipSummon: (!isOverlapping && nonOverlapEval) ? nonOverlapEval.skipSummon : false,
          nonOverlapPriority: nonOverlapEval ? nonOverlapEval.priority : 0
        };

        existingSlots.push(slotObj);
        slots.push(slotObj);
      });
    });

    // 優先度スコア (priorityScore) 降順 → 開始時刻順
    slots.sort((a, b) => {
      if (a.priorityScore !== b.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return this._toTimestamp(a.startTime) - this._toTimestamp(b.startTime);
    });

    return slots;
  }

  /**
   * 掛け持ちしていない予約スロットに対して、アシスタント召喚の要否と優先度を評価する。
   *
   * @param {Object} reservation - 対象予約
   * @param {Object[]} allReservations - 当日の全予約
   * @param {import('../models/staff.js').Staff} stylist - 対象スタイリスト
   * @param {Object[]} assistants - 出勤中のアシスタント
   * @param {Object.<string, number>} stylistRates - スタイリスト稼働率マップ
   * @param {boolean} isMinutesMode - 分数値モードかどうか
   * @param {Function} toUnit - 分をモードに応じた単位に変換する関数
   * @returns {{ skipSummon: boolean, priority: number }}
   * @private
   */
  _evaluateNonOverlappingSlot(reservation, allReservations, stylist, assistants, stylistRates, isMinutesMode, toUnit) {
    const gapAfter  = this._getGapAfterReservation(reservation, allReservations);
    const gapBefore = this._getGapBeforeReservation(reservation, allReservations);

    const MIN_30  = toUnit(30);
    const MIN_60  = toUnit(60);

    const isOwner = stylist.rank === 'owner';
    const isPriority = stylist.prioritySummon === true;

    const isSolitary = gapBefore >= MIN_30 && gapAfter >= MIN_30;
    const stylistRate = stylistRates[stylist.id] || 0;
    const forceByIdle = stylistRate >= 0.3 && assistants.length >= 2;

    if (isSolitary && !forceByIdle && !isOwner && !isPriority) {
      return { skipSummon: true, priority: 0 };
    }

    let priority = 0;
    if (isOwner || isPriority) {
      priority = 100;
    } else {
      priority = Math.round(stylistRate * 50);
      if (gapAfter >= MIN_60) {
        priority -= 2;
      } else if (gapAfter >= MIN_30) {
        priority -= 1;
      }
    }

    return { skipSummon: false, priority };
  }

  /**
   * 同一スタイリストの予約に既にアサインされているか判定する
   * @param {string} assistantId
   * @param {RequiredSlot} slot
   * @param {Object} allAssignments
   * @returns {boolean}
   * @private
   */
  _isAssignedToSameStylist(assistantId, slot, allAssignments) {
    if (!this._reservationStylistMap) return false;
    for (const resId in allAssignments) {
      if (resId === slot.reservationId) continue;
      const resAssignments = allAssignments[resId];
      for (const slotIdx in resAssignments) {
        const assignedId = typeof resAssignments[slotIdx] === 'object' 
          ? resAssignments[slotIdx].id 
          : resAssignments[slotIdx];
        if (assignedId === assistantId) {
          const stylistId = this._reservationStylistMap.get(resId);
          if (stylistId === slot.stylistId) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 他スタイリストの予約と時間重複があるか判定する
   * @param {string} assistantId
   * @param {RequiredSlot} slot
   * @param {Object} allAssignments
   * @returns {boolean}
   * @private
   */
  _hasConflictWithOtherStylist(assistantId, slot, allAssignments) {
    if (!this._reservationStylistMap || !this._allReservations || !this._allRequiredSlots) return false;
    const start = this._toTimestamp(slot.startTime);
    const end = this._toTimestamp(slot.endTime);

    for (const res of this._allReservations) {
      if (res.stylistId === slot.stylistId) continue;

      const resAssign = allAssignments[res.id];
      if (!resAssign) continue;

      for (const slotIdx in resAssign) {
        const assignedId = typeof resAssign[slotIdx] === 'object' 
          ? resAssign[slotIdx].id 
          : resAssign[slotIdx];
        
        if (assignedId === assistantId) {
          // this._allRequiredSlotsから正確な時間を取得する
          const otherSlot = this._allRequiredSlots.find(s => s.reservationId === res.id && s.slotIndex == slotIdx);
          
          let oStart = this._toTimestamp(res.startTime);
          let oEnd = this._toTimestamp(res.endTime);
          
          if (otherSlot) {
            oStart = this._toTimestamp(otherSlot.startTime);
            oEnd = this._toTimestamp(otherSlot.endTime);
          }
          
          if (start < oEnd && oStart < end) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 候補者をスコアリングする
   * @param {RequiredSlot} slot - 対象スロット
   * @param {import('../models/staff.js').Staff[]} candidates - 候補アシスタント
   * @param {Object} allAssignments - 現在の全配置
   * @param {boolean} [allowConcurrent=false] - 時間重複の兼任配置を許可するか
   * @returns {Array<{assistant: import('../models/staff.js').Staff, score: number, isConcurrent: boolean}>}
   */
  _scoreCandidates(slot, candidates, allAssignments, allowConcurrent = false) {
    const scored = [];

    const assignedInThisReservation = new Set(
      Object.values(allAssignments[slot.reservationId] || {}).map(v => typeof v === 'object' ? v.id : v)
    );

    const allCounts = candidates.map(c => this._assignmentCounts[c.id] || 0);
    const avgCount = allCounts.length > 0
      ? allCounts.reduce((s, v) => s + v, 0) / allCounts.length
      : 0;

    candidates.forEach(assistant => {
      let score = 0;

      // 勤務時間帯のチェック
      if (typeof assistant.isWorkingAtTime === 'function') {
        const slotStart = slot.startTime;
        const slotEndCheck = slot.endTime instanceof Date 
          ? new Date(slot.endTime.getTime() - 1000)
          : (typeof slot.endTime === 'number' ? slot.endTime - 1 : slot.endTime);
        
        if (!assistant.isWorkingAtTime(slotStart) || !assistant.isWorkingAtTime(slotEndCheck)) {
          return;
        }
      }

      // スキルチェック
      const skill = (assistant.skills || []).find(s => {
        if (typeof s === 'object') return s.id === slot.requiredSkill;
        return s === slot.requiredSkill;
      });
      if (!skill) return;

      const proficiency = typeof skill === 'object' ? (skill.proficiency || 1) : 1;
      if (proficiency < slot.requiredProficiency) return;

      // 他スタイリストとの時間重複は不可
      if (this._hasConflictWithOtherStylist(assistant.id, slot, allAssignments)) {
        return;
      }

      // 時間帯重複チェック
      const hasConflict = this._hasTimeConflict(assistant.id, slot.startTime, slot.endTime, allAssignments);

      let isConcurrent = false;

      if (hasConflict) {
        if (!allowConcurrent) return; // フリー優先時は時間重複を許可しない
        isConcurrent = true;
        score -= 40;
      }

      // 同一スタイリストの予約への継続・ヘルプ優先ボーナス
      const isAssignedToSameStylist = this._isAssignedToSameStylist(assistant.id, slot, allAssignments);
      if (isAssignedToSameStylist) {
        score += 60; // 同スタイリストのペアカバーを最優先して空欄を埋める！
      }

      const profDiff = proficiency - slot.requiredProficiency;
      score += Math.min(profDiff, 2) * 10;

      const assignedCount = this._assignmentCounts[assistant.id] || 0;
      score -= assignedCount * 15;

      if (assistant.breaks) {
        const hasLunch = assistant.breaks.lunch?.taken === true;
        const hasRest = assistant.breaks.rest?.taken === true;
        if (hasLunch || hasRest) score += 15;
        else score -= 15;
      }

      if (assignedInThisReservation.has(assistant.id)) {
        const countDiff = assignedCount - avgCount;
        if (countDiff <= 2) score += 25;
      }

      scored.push({ assistant, score, isConcurrent });
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }



  /**
   * アシスタントの時間帯重複をチェックする
   * @param {string} assistantId
   * @param {Date} startTime
   * @param {Date} endTime
   * @param {Object} allAssignments - 全配置情報
   * @returns {boolean}
   */
  _hasTimeConflict(assistantId, startTime, endTime, allAssignments) {
    const start = this._toTimestamp(startTime);
    const end = this._toTimestamp(endTime);

    // _assignedSlotTimesに保存された時間帯をチェック（主要な競合検出）
    if (this._assignedSlotTimes) {
      const assignedTimes = this._assignedSlotTimes[assistantId] || [];
      for (const at of assignedTimes) {
        if (start < at.end && at.start < end) {
          return true;
        }
      }
    }
    return false;
  }


  /**
   * 最適配置を実行する
   * @param {RequiredSlot[]} requiredSlots
   * @param {import('../models/staff.js').Staff[]} candidates
   * @returns {{assignments: Object, unfilledSlots: RequiredSlot[]}}
   */
  /**
   * アシスタントを各スロットに配置する（未配置スロットを根絶するマルチフェーズ処理）
   * @param {RequiredSlot[]} requiredSlots - ソート済みの必要スロット
   * @param {import('../models/staff.js').Staff[]} candidates - 候補アシスタント/スタイリスト
   * @returns {{assignments: Object.<string, Object.<number, string>>, concurrentAssignments: Object.<string, Object.<number, boolean>>, unfilledSlots: RequiredSlot[]}}
   * @private
   */
  _assignAssistants(requiredSlots, candidates) {
    /** @type {Object.<string, Object.<number, string>>} */
    const assignments = {};
    /** @type {Object.<string, Object.<number, boolean>>} */
    const concurrentAssignments = {};
    const unfilledSlots = [];

    /** @type {Object.<string, Array<{start: number, end: number}>>} */
    this._assignedSlotTimes = {};
    candidates.forEach(a => { this._assignedSlotTimes[a.id] = []; });

    // 1. 固定アシスタントのパス
    requiredSlots.forEach(slot => {
      if (slot.fixedAssistantId) {
        if (slot.fixedAssistantId === '__none__') {
          if (!assignments[slot.reservationId]) {
            assignments[slot.reservationId] = {};
          }
          assignments[slot.reservationId][slot.slotIndex] = '__none__';
          return;
        }

        if (!assignments[slot.reservationId]) {
          assignments[slot.reservationId] = {};
        }
        assignments[slot.reservationId][slot.slotIndex] = slot.fixedAssistantId;

        const assistant = candidates.find(a => a.id === slot.fixedAssistantId);
        if (assistant) {
          this._assignmentCounts[assistant.id] = (this._assignmentCounts[assistant.id] || 0) + 1;
        }
        if (!this._assignedSlotTimes[slot.fixedAssistantId]) {
          this._assignedSlotTimes[slot.fixedAssistantId] = [];
        }
        this._assignedSlotTimes[slot.fixedAssistantId].push({
          start: this._toTimestamp(slot.startTime),
          end: this._toTimestamp(slot.endTime)
        });
      }
    });

    // 2. 自動計算スロットのアサイン
    const autoSlots = requiredSlots.filter(s => !s.fixedAssistantId);

    autoSlots.forEach(slot => {
      // フェーズ1: 時間競合のない最適なフリーアシスタント
      let scored = this._scoreCandidates(slot, candidates, assignments, false);

      // フェーズ2: フリーな人が見つからない場合、兼任（同スタイリスト重複）を許可して検索
      if (scored.length === 0) {
        scored = this._scoreCandidates(slot, candidates, assignments, true);
      }

      if (scored.length > 0) {
        const best = scored[0];
        if (!assignments[slot.reservationId]) {
          assignments[slot.reservationId] = {};
        }
        assignments[slot.reservationId][slot.slotIndex] = best.assistant.id;

        this._assignmentCounts[best.assistant.id] =
          (this._assignmentCounts[best.assistant.id] || 0) + 1;

        if (!this._assignedSlotTimes[best.assistant.id]) {
          this._assignedSlotTimes[best.assistant.id] = [];
        }
        this._assignedSlotTimes[best.assistant.id].push({
          start: this._toTimestamp(slot.startTime),
          end: this._toTimestamp(slot.endTime)
        });
      } else {
        // それでも配置できなかった場合のみ未配置として集計
        unfilledSlots.push(slot);
      }
    });

    return { assignments, concurrentAssignments, unfilledSlots, autoSlots };
  }

  /**
   * グローバル最適化パス: Greedy配置後の兼任をスワップで解消する
   *
   * アルゴリズム:
   * 1. 同一アシスタントが時間重複する全スロットペアを検出（兼任ペア）
   * 2. 兼任ペアの一方のスロットについて、別のアシスタントに差し替え可能か検索
   * 3. 差し替え先が新たな兼任を生まないことを検証して実行
   * 4. 改善がなくなるか最大5回で打ち切り
   *
   * @param {Object} assignments - 現在の配置（in-place で更新される）
   * @param {RequiredSlot[]} autoSlots - 自動配置対象のスロット
   * @param {import('../models/staff.js').Staff[]} candidates - 全候補者
   * @private
   */
  _optimizeAssignments(assignments, autoSlots, candidates) {
    const MAX_ITERATIONS = 5;

    // === フェーズ1: 兼任ペアの解消 ===
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const concurrentPairs = this._findConcurrentPairs(assignments, autoSlots);
      if (concurrentPairs.length === 0) break;

      let improved = false;

      for (const pair of concurrentPairs) {
        const swapTargets = [pair.slotA, pair.slotB];

        for (const targetSlot of swapTargets) {
          if (targetSlot.fixedAssistantId) continue;

          const currentAssistantId = assignments[targetSlot.reservationId]?.[targetSlot.slotIndex];
          if (!currentAssistantId) continue;

          const replacement = this._findSwapCandidate(
            targetSlot, currentAssistantId, assignments, candidates
          );

          if (replacement) {
            this._executeSwap(assignments, targetSlot, currentAssistantId, replacement.id);
            improved = true;
            break;
          }
        }

        if (improved) break;
      }

      if (!improved) break;
    }

    // === フェーズ2: 未配置スロットの直接配置（空いているアシスタントがいれば埋める） ===
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const unfilledAutoSlots = autoSlots.filter(slot => {
        const resAssign = assignments[slot.reservationId];
        return !resAssign || !resAssign[slot.slotIndex];
      });
      if (unfilledAutoSlots.length === 0) break;

      // 優先度の高い未配置スロットから処理
      unfilledAutoSlots.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

      let improved = false;

      for (const unfilledSlot of unfilledAutoSlots) {
        // 空いているアシスタントを探す（スタイリストは候補に含まない）
        const directCandidate = this._findSwapCandidate(
          unfilledSlot, '__nobody__', assignments, candidates
        );
        if (directCandidate) {
          if (!assignments[unfilledSlot.reservationId]) {
            assignments[unfilledSlot.reservationId] = {};
          }
          assignments[unfilledSlot.reservationId][unfilledSlot.slotIndex] = directCandidate.id;
          if (!this._assignedSlotTimes[directCandidate.id]) {
            this._assignedSlotTimes[directCandidate.id] = [];
          }
          this._assignedSlotTimes[directCandidate.id].push({
            start: this._toTimestamp(unfilledSlot.startTime),
            end: this._toTimestamp(unfilledSlot.endTime)
          });
          this._assignmentCounts[directCandidate.id] = (this._assignmentCounts[directCandidate.id] || 0) + 1;
          improved = true;
          break;
        }
      }

      if (!improved) break;
    }
  }

  /**
   * マンセル制フォールバック（掛け持ちブロックの不足解消）
   * @private
   */
  _applyManncellFallback(assignments, unfilledSlots, autoSlots, requiredSlots, assistants, reservations, overlappingPairs) {
    const manncells = [];

    // 1. スタイリストごとに予約をまとめ、重なり（ブロック）を検出
    const byStylist = new Map();
    reservations.forEach(res => {
      if (!byStylist.has(res.stylistId)) byStylist.set(res.stylistId, []);
      byStylist.get(res.stylistId).push(res);
    });

    const blocks = [];
    byStylist.forEach((resList, stylistId) => {
      resList.sort((a, b) => this._toTimestamp(a.startTime) - this._toTimestamp(b.startTime));
      let currentBlock = null;

      for (const res of resList) {
        if (!currentBlock) {
          currentBlock = { stylistId, startTime: this._toTimestamp(res.startTime), endTime: this._toTimestamp(res.endTime), reservations: [res] };
        } else {
          const resStart = this._toTimestamp(res.startTime);
          const resEnd = this._toTimestamp(res.endTime);
          if (resStart < currentBlock.endTime) {
            // Overlaps
            currentBlock.endTime = Math.max(currentBlock.endTime, resEnd);
            currentBlock.reservations.push(res);
          } else {
            blocks.push(currentBlock);
            currentBlock = { stylistId, startTime: resStart, endTime: resEnd, reservations: [res] };
          }
        }
      }
      if (currentBlock) blocks.push(currentBlock);
    });

    // 掛け持ち予約があるブロック（reservations.length >= 2）に絞る
    const overlappingBlocks = blocks.filter(b => b.reservations.length > 1);

    for (const block of overlappingBlocks) {
      // ブロック内の全スロットを取得
      const blockSlots = requiredSlots.filter(s => 
        block.reservations.some(r => r.id === s.reservationId)
      );

      // 未配置スロットがあるか？
      const blockUnfilledSlots = blockSlots.filter(s => {
        const resAssign = assignments[s.reservationId];
        return !resAssign || !resAssign[s.slotIndex];
      });

      if (blockUnfilledSlots.length === 0) continue; // 不足なし → マンセル不要

      // ブロック内の全スロットを一旦グローバルunfilledSlotsから除外（再計算のため）
      for (const s of blockSlots) {
        const idx = unfilledSlots.findIndex(u => u.reservationId === s.reservationId && u.slotIndex === s.slotIndex);
        if (idx !== -1) unfilledSlots.splice(idx, 1);
      }

      // マンセル発動！
      // 1. ブロック内の全アサインを一旦リセット（白紙に戻す）
      for (const s of blockSlots) {
        if (s.fixedAssistantId) continue; // 固定はそのまま
        const resAssign = assignments[s.reservationId];
        if (resAssign && resAssign[s.slotIndex]) {
          const astId = resAssign[s.slotIndex];
          if (typeof astId === 'string' && astId !== '__none__') {
            // 既存の時間割からこのスロット分を削除
            const sStart = this._toTimestamp(s.startTime);
            const sEnd = this._toTimestamp(s.endTime);
            if (this._assignedSlotTimes[astId]) {
              this._assignedSlotTimes[astId] = this._assignedSlotTimes[astId].filter(
                t => !(t.start === sStart && t.end === sEnd)
              );
            }
            this._assignmentCounts[astId] = Math.max(0, (this._assignmentCounts[astId] || 0) - 1);
            delete resAssign[s.slotIndex];
          }
        }
      }

      let team = new Set();
      // 固定アサインのメンバーを初期チームに追加
      for (const s of blockSlots) {
        if (s.fixedAssistantId) {
          team.add(s.fixedAssistantId);
        }
      }

      // マンセルチームの上限人数（最大同時重なり数）を計算
      const events = [];
      block.reservations.forEach(r => {
        events.push({ time: r.startTime, type: 1 });
        events.push({ time: r.endTime, type: -1 });
      });
      events.sort((a, b) => a.time !== b.time ? a.time - b.time : a.type - b.type);
      let maxAssistants = 0, currentOverlap = 0;
      events.forEach(e => { currentOverlap += e.type; if(currentOverlap > maxAssistants) maxAssistants = currentOverlap; });

      let allFilled = true;

      // 未配置となった全スロット（固定以外）を優先度順に並べ替えて処理
      const targetSlots = blockSlots.filter(s => !s.fixedAssistantId).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

      for (const slot of targetSlots) {
        let assigned = false;

        // 1. まず現在のチーム内のメンバーで兼任可能な人がいないか？
        for (const astId of team) {
           const candidate = assistants.find(a => a.id === astId);
           if (!candidate) continue;
           const hasSkill = this._hasSkill(candidate, slot.requiredSkill, slot.requiredProficiency);
           if (!hasSkill) continue;
           
           // 他のスタイリストと競合していないか？（ブロック内の同スタイリストとの兼任は許容）
           if (this._hasConflictWithOtherStylist(astId, slot, assignments)) continue;

           // アサイン
           this._assignAssistantToSlot(assignments, slot, astId);
           assigned = true;
           break;
        }

        if (assigned) continue;

        // チームの上限（マンセルの制約）に達していない場合のみ、外部からの新規追加や引き抜きを試みる
        if (team.size < maxAssistants) {
          // 2. チーム外の空いている人を追加
          const candidate = this._findSwapCandidate(slot, '__nobody__', assignments, assistants);
          if (candidate) {
            this._assignAssistantToSlot(assignments, slot, candidate.id);
            team.add(candidate.id);
            assigned = true;
            continue;
          }

          // 3. 掛け持ちなしのスロットから引き抜く（スティール）
          const donorCandidate = this._stealAssistantForManncell(slot, assignments, requiredSlots, assistants, overlappingPairs);
          if (donorCandidate) {
            this._assignAssistantToSlot(assignments, slot, donorCandidate);
            team.add(donorCandidate);
            assigned = true;
            continue;
          }
        }

        // 4. 外部に空きがない等でここまでにアサインできなかった場合、
        // チーム内に適正スキルを持つメンバーがいれば、他スタイリストの予約から強制剥奪してでもアサインする
        if (!assigned && team.size > 0) {
          for (const astId of team) {
            const candidate = assistants.find(a => a.id === astId);
            if (!candidate) continue;
            
            // 【重要】スキルレベルが要求（Lv5等）を満たしていない場合は絶対にアサインしない
            if (!this._hasSkill(candidate, slot.requiredSkill, slot.requiredProficiency)) continue;

            // もし他スタイリストの予約と重複している場合、その他スタイリストの予約からこのアシスタントを剥奪する（マンセル専属にするため）
            if (this._hasConflictWithOtherStylist(astId, slot, assignments)) {
              this._forceStripAssistantFromOtherStylists(astId, slot, assignments, unfilledSlots);
              // ロックされていて剥奪に失敗した等でまだコンフリクトが残っている場合はアサイン不可
              if (this._hasConflictWithOtherStylist(astId, slot, assignments)) continue;
            }
            this._assignAssistantToSlot(assignments, slot, astId);
            assigned = true;
            break;
          }
        }

        if (!assigned) {
          allFilled = false;
          // アサインに失敗した場合は再びグローバルのunfilledSlotsに戻す
          unfilledSlots.push(slot);
        }
      }

      // アシスタントが1人もアサインできなかった場合はMANCELL不成立（破綻）として扱う
      if (team.size === 0) {
        // すでに不足スロットは targetSlots ループ内で unfilledSlots に入っているため
        // ここではブロックを描画対象(manncells)に追加せずにスキップする
        continue;
      }

      // マンセル情報を記録
      manncells.push({
        stylistId: block.stylistId,
        startTime: this._minutesToTime(block.startTime),
        endTime: this._minutesToTime(block.endTime),
        teamSize: team.size + 1, // アシスタント数 + スタイリスト1人
        isSuccess: allFilled,
        reservationIds: block.reservations.map(r => r.id)
      });
    }

    return manncells;
  }

  _hasSkill(candidate, requiredSkill, requiredProficiency) {
    const skill = (candidate.skills || []).find(s => {
      if (typeof s === 'object') return s.id === requiredSkill;
      return s === requiredSkill;
    });
    if (!skill) return false;
    const prof = typeof skill === 'object' ? (skill.proficiency || 1) : 1;
    return prof >= requiredProficiency;
  }

  _assignAssistantToSlot(assignments, slot, astId) {
    if (!assignments[slot.reservationId]) {
      assignments[slot.reservationId] = {};
    }
    assignments[slot.reservationId][slot.slotIndex] = astId;
    if (!this._assignedSlotTimes[astId]) {
      this._assignedSlotTimes[astId] = [];
    }
    this._assignedSlotTimes[astId].push({
      start: this._toTimestamp(slot.startTime),
      end: this._toTimestamp(slot.endTime)
    });
    this._assignmentCounts[astId] = (this._assignmentCounts[astId] || 0) + 1;
  }

  _stealAssistantForManncell(targetSlot, assignments, allSlots, assistants, overlappingPairs) {
     // 掛け持ちなし（overlappingPairsに含まれない）予約のスロットを探す
     const donorSlots = allSlots.filter(s => {
       if (overlappingPairs.has(s.reservationId)) return false; // 掛け持ち予約からは奪わない
       if (s.fixedAssistantId) return false;
       const resAssign = assignments[s.reservationId];
       return resAssign && resAssign[s.slotIndex];
     }).sort((a, b) => (a.priorityScore || 0) - (b.priorityScore || 0)); // 優先度の低いものから奪う

     for (const donor of donorSlots) {
       const astId = assignments[donor.reservationId][donor.slotIndex];
       if (typeof astId === 'object' || astId === '__none__') continue;
       const candidate = assistants.find(a => a.id === astId);
       if (!candidate) continue;

       if (!this._hasSkill(candidate, targetSlot.requiredSkill, targetSlot.requiredProficiency)) continue;
       if (candidate.id === targetSlot.stylistId) continue;
       if (this._hasConflictWithOtherStylist(candidate.id, targetSlot, assignments)) continue;

       // 引き抜き実行のシミュレーション
       const donorStart = this._toTimestamp(donor.startTime);
       const donorEnd = this._toTimestamp(donor.endTime);
       
       const origTimes = [...this._assignedSlotTimes[candidate.id]];
       this._assignedSlotTimes[candidate.id] = origTimes.filter(
         t => !(t.start === donorStart && t.end === donorEnd)
       );

       const stillConflict = this._hasTimeConflict(
         candidate.id, targetSlot.startTime, targetSlot.endTime, assignments
       );

       if (stillConflict) {
         this._assignedSlotTimes[candidate.id] = origTimes;
         continue;
       }

       // 引き抜き成功
       // 1. donorから外す
       delete assignments[donor.reservationId][donor.slotIndex];
       this._assignmentCounts[candidate.id] = Math.max(0, (this._assignmentCounts[candidate.id] || 0) - 1);
       // 新しい時間割は呼び出し元の _assignAssistantToSlot で追加されるため、ここではdonor時間を抜いた状態のままにする
       return candidate.id;
     }

     return null;
  }

  _minutesToTime(minutes) {
    const h = 9 + Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  /**
   * 現在の配置から兼任ペア（同一アシスタントが時間重複しているスロットの組）を検出

   * @param {Object} assignments
   * @param {RequiredSlot[]} slots
   * @returns {Array<{assistantId: string, slotA: RequiredSlot, slotB: RequiredSlot}>}
   * @private
   */
  _findConcurrentPairs(assignments, slots) {
    const pairs = [];
    // 配置済みスロットの情報を収集
    const assignedSlots = [];
    for (const slot of slots) {
      const resAssign = assignments[slot.reservationId];
      if (!resAssign) continue;
      const astId = resAssign[slot.slotIndex];
      if (!astId || astId === '__none__') continue;
      assignedSlots.push({
        slot,
        assistantId: typeof astId === 'object' ? astId.id : astId,
        start: this._toTimestamp(slot.startTime),
        end: this._toTimestamp(slot.endTime)
      });
    }

    // 全ペアを比較して同一アシスタント＋時間重複を検出
    for (let i = 0; i < assignedSlots.length; i++) {
      for (let j = i + 1; j < assignedSlots.length; j++) {
        const a = assignedSlots[i];
        const b = assignedSlots[j];
        if (a.assistantId !== b.assistantId) continue;
        if (a.slot.reservationId === b.slot.reservationId) continue;
        if (!(a.start < b.end && b.start < a.end)) continue; // 時間重複なし
        pairs.push({ assistantId: a.assistantId, slotA: a.slot, slotB: b.slot });
      }
    }

    return pairs;
  }

  /**
   * 指定スロットに対して、兼任を生まない差し替え候補を探す
   * @param {RequiredSlot} targetSlot - 差し替え対象のスロット
   * @param {string} currentAssistantId - 現在配置されているアシスタントID
   * @param {Object} assignments - 全配置
   * @param {import('../models/staff.js').Staff[]} candidates - 全候補者
   * @returns {import('../models/staff.js').Staff|null} 差し替え候補（なければnull）
   * @private
   */
  _findSwapCandidate(targetSlot, currentAssistantId, assignments, candidates) {
    const targetStart = this._toTimestamp(targetSlot.startTime);
    const targetEnd = this._toTimestamp(targetSlot.endTime);

    for (const candidate of candidates) {
      if (candidate.id === currentAssistantId) continue;

      // スタイリスト自身の予約にはそのスタイリストを配置しない
      if (candidate.id === targetSlot.stylistId) continue;

      // 勤務時間チェック
      if (typeof candidate.isWorkingAtTime === 'function') {
        const slotEndCheck = typeof targetSlot.endTime === 'number'
          ? targetSlot.endTime - 1 : targetSlot.endTime;
        if (!candidate.isWorkingAtTime(targetSlot.startTime) ||
            !candidate.isWorkingAtTime(slotEndCheck)) {
          continue;
        }
      }

      // スキルチェック
      const skill = (candidate.skills || []).find(s => {
        if (typeof s === 'object') return s.id === targetSlot.requiredSkill;
        return s === targetSlot.requiredSkill;
      });
      if (!skill) continue;

      const proficiency = typeof skill === 'object' ? (skill.proficiency || 1) : 1;
      if (proficiency < targetSlot.requiredProficiency) continue;

      // 他スタイリストとの時間重複チェック
      if (this._hasConflictWithOtherStylist(candidate.id, targetSlot, assignments)) {
        continue;
      }

      // 時間競合チェック（この候補が別のスロットと重複しないか）
      const hasConflict = this._hasTimeConflict(
        candidate.id, targetSlot.startTime, targetSlot.endTime, assignments
      );
      if (hasConflict) continue; // 兼任になるなら不可

      // この候補は安全 → 採用
      return candidate;
    }

    return null;
  }

  /**
   * マンセルチーム専属にするため、他スタイリストの予約から強制的に引き剥がす
   * @private
   */
  _forceStripAssistantFromOtherStylists(astId, targetSlot, assignments, unfilledSlots) {
    if (!this._allReservations || !this._allRequiredSlots) return;
    const tStart = this._toTimestamp(targetSlot.startTime);
    const tEnd = this._toTimestamp(targetSlot.endTime);

    for (const res of this._allReservations) {
      if (res.stylistId === targetSlot.stylistId) continue;
      const resAssign = assignments[res.id];
      if (!resAssign) continue;

      for (const slotIdx in resAssign) {
        const assignedId = typeof resAssign[slotIdx] === 'object' ? resAssign[slotIdx].id : resAssign[slotIdx];
        if (assignedId === astId) {
          const oSlot = this._allRequiredSlots.find(s => s.reservationId === res.id && s.slotIndex == slotIdx);
          if (!oSlot) continue;

          // MANCELL内でアサインされた枠（isOverlapping === true）はロックし、引き剥がさない
          if (oSlot.isOverlapping) continue;

          let oStart = this._toTimestamp(oSlot.startTime);
          let oEnd = this._toTimestamp(oSlot.endTime);

          if (tStart < oEnd && oStart < tEnd) {
            // 時間帯が被っている外部の予約から引き剥がす
            delete resAssign[slotIdx];
            
            // 時間割情報から削除
            if (this._assignedSlotTimes[astId]) {
              this._assignedSlotTimes[astId] = this._assignedSlotTimes[astId].filter(
                t => !(t.start === oStart && t.end === oEnd)
              );
            }
            this._assignmentCounts[astId] = Math.max(0, (this._assignmentCounts[astId] || 0) - 1);
            
            // 不足スロットとして再登録（外部スタイリストが不足になる）
            unfilledSlots.push(oSlot);
          }
        }
      }
    }
  }

  /**
   * スワップを実行し、内部状態（assignments, _assignedSlotTimes, _assignmentCounts）を更新
   * @param {Object} assignments
   * @param {RequiredSlot} slot
   * @param {string} oldAssistantId
   * @param {string} newAssistantId
   * @private
   */
  _executeSwap(assignments, slot, oldAssistantId, newAssistantId) {
    const start = this._toTimestamp(slot.startTime);
    const end = this._toTimestamp(slot.endTime);

    // 配置を更新
    assignments[slot.reservationId][slot.slotIndex] = newAssistantId;

    // 旧アシスタントの時間帯を除去
    if (this._assignedSlotTimes[oldAssistantId]) {
      this._assignedSlotTimes[oldAssistantId] = this._assignedSlotTimes[oldAssistantId]
        .filter(t => !(t.start === start && t.end === end));
    }
    // 旧アシスタントのカウント減少
    this._assignmentCounts[oldAssistantId] = Math.max(
      0, (this._assignmentCounts[oldAssistantId] || 0) - 1
    );

    // 新アシスタントの時間帯を追加
    if (!this._assignedSlotTimes[newAssistantId]) {
      this._assignedSlotTimes[newAssistantId] = [];
    }
    this._assignedSlotTimes[newAssistantId].push({ start, end });
    // 新アシスタントのカウント増加
    this._assignmentCounts[newAssistantId] = (this._assignmentCounts[newAssistantId] || 0) + 1;
  }

  /**
   * アシスタント不足時のスタイリスト召喚フォールバック（特殊召喚を含む）
   *
   * 通常召喚: アシスタントが不足した際に空きスタイリストを召喚する
   * 特殊召喚①: 11:00以降、スタイリストがお昼済み＆アシスタントがお昼未消化の場合に発動
   * 特殊召喚②: 16:00以降、スタイリストがお昼+休憩済み＆アシスタントがお昼or休憩未消化の場合に発動
   *
   * @param {RequiredSlot[]} unfilledSlots
   * @param {import('../models/staff.js').Staff[]} stylists
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {Map<string, import('../models/menu.js').MenuItem>} menuMap
   * @param {Object} assignments
   * @returns {Array<{stylistId: string, reservationId: string, slotIndex: number, badge: boolean, isSpecialSummon: boolean, specialSummonReason: string|null}>}
   */
  _handleStylistFallback(unfilledSlots, stylists, reservations, menuMap, assignments) {
    const summons = [];
    const resolved = [];

    // ランク優先順でスタイリストをソート（ジュニア < スタイリスト < トップ < オーナー → 優先度が高い＝数値が小さい方が後ろ）
    // 空きスタイリストから低ランク順に割り当て（オーナーは最後の手段）
    const rankPriority = {
      [RANKS.JUNIOR.id]: 1,
      [RANKS.STYLIST.id]: 2,
      [RANKS.TOP_STYLIST.id]: 3,
      [RANKS.OWNER.id]: 4
    };

    /**
     * スタイリストが指定スロットの時間帯に空いているか判定するヘルパー
     * @param {Object} stylist
     * @param {RequiredSlot} slot
     * @returns {boolean}
     */
    const isStylistAvailable = (stylist, slot) => {
      if (stylist.id === slot.stylistId) return false;
      if (!stylist.isWorking) return false;

      const hasBusyReservation = reservations.some(res => {
        if (res.stylistId !== stylist.id) return false;
        const resStart = this._toTimestamp(res.startTime);
        const resEnd = this._toTimestamp(res.endTime);
        const slotStart = this._toTimestamp(slot.startTime);
        const slotEnd = this._toTimestamp(slot.endTime);
        return slotStart < resEnd && resStart < slotEnd;
      });
      if (hasBusyReservation) return false;

      if (this._hasTimeConflict(stylist.id, slot.startTime, slot.endTime, assignments)) return false;

      return true;
    };

    /**
     * スロットの開始時刻を「営業開始(9:00)からの分」で取得するヘルパー
     * @param {RequiredSlot} slot
     * @returns {number} 分（例: 11:00 → 120）
     */
    const getSlotMinuteOfDay = (slot) => {
      const isMinutesMode = typeof slot.startTime === 'number';
      if (isMinutesMode) {
        // minutesモードの場合: startTime は営業開始からの分オフセット
        return slot.startTime;
      } else {
        // Dateモードの場合: 実際の時刻から時・分を取得
        const d = new Date(slot.startTime);
        return (d.getHours() - 9) * 60 + d.getMinutes();
      }
    };

    unfilledSlots.forEach(slot => {
      // マンセル（掛け持ち）予約の場合はスタイリストをアシスタントとして召喚しない
      if (slot.isOverlapping) return;

      const slotMinute = getSlotMinuteOfDay(slot);
      const availableStylists = stylists.filter(s => isStylistAvailable(s, slot));

      // ─────────────────────────────────────────────
      // 特殊召喚①: お昼交代（11:00 = 120分 以降）
      // スタイリストがお昼済み & アシスタントがまだお昼未消化
      // ─────────────────────────────────────────────
      if (slotMinute >= 120) {
        // お昼済みの空きスタイリストを探す
        const stylistWithLunch = availableStylists.find(s =>
          s.breaks && s.breaks.lunch && s.breaks.lunch.taken === true
        );

        // このスロットを担当するアシスタントとしてお昼未消化のスタッフが対象になるかを確認
        // （未割り当てスロット → アシスタントが不足しているので、その中でお昼未消化の人がいるかチェック）
        // ここでは「スロットを担当するはずだったアシスタント」のコンテキストは持てないため、
        // スロット自体の未割当 = アシスタントが足りない = 特殊召喚の対象とする
        if (stylistWithLunch) {
          const chosen = stylistWithLunch;
          if (!assignments[slot.reservationId]) assignments[slot.reservationId] = {};
          assignments[slot.reservationId][slot.slotIndex] = chosen.id;

          if (!this._assignedSlotTimes[chosen.id]) this._assignedSlotTimes[chosen.id] = [];
          this._assignedSlotTimes[chosen.id].push({
            start: this._toTimestamp(slot.startTime),
            end: this._toTimestamp(slot.endTime)
          });
          this._assignmentCounts[chosen.id] = (this._assignmentCounts[chosen.id] || 0) + 1;

          summons.push({
            stylistId: chosen.id,
            reservationId: slot.reservationId,
            slotIndex: slot.slotIndex,
            startTime: slot.startTime,
            endTime: slot.endTime,
            badge: true,
            isSpecialSummon: true,
            specialSummonReason: 'lunch' // お昼交代
          });
          resolved.push(slot);
          return; // 次のスロットへ
        }
      }

      // ─────────────────────────────────────────────
      // 特殊召喚②: 休憩交代（16:00 = 420分 以降）
      // スタイリストがお昼+休憩済み & アシスタントがお昼or休憩未消化
      // ─────────────────────────────────────────────
      if (slotMinute >= 420) {
        const stylistWithBothBreaks = availableStylists.find(s =>
          s.breaks &&
          s.breaks.lunch && s.breaks.lunch.taken === true &&
          s.breaks.rest  && s.breaks.rest.taken  === true
        );

        if (stylistWithBothBreaks) {
          const chosen = stylistWithBothBreaks;
          if (!assignments[slot.reservationId]) assignments[slot.reservationId] = {};
          assignments[slot.reservationId][slot.slotIndex] = chosen.id;

          if (!this._assignedSlotTimes[chosen.id]) this._assignedSlotTimes[chosen.id] = [];
          this._assignedSlotTimes[chosen.id].push({
            start: this._toTimestamp(slot.startTime),
            end: this._toTimestamp(slot.endTime)
          });
          this._assignmentCounts[chosen.id] = (this._assignmentCounts[chosen.id] || 0) + 1;

          summons.push({
            stylistId: chosen.id,
            reservationId: slot.reservationId,
            slotIndex: slot.slotIndex,
            startTime: slot.startTime,
            endTime: slot.endTime,
            badge: true,
            isSpecialSummon: true,
            specialSummonReason: 'rest' // 休憩交代
          });
          resolved.push(slot);
          return;
        }
      }

      // ─────────────────────────────────────────────
      // 通常のスタイリスト召喚フォールバック（人員不足時）
      // ─────────────────────────────────────────────
      // 休憩済みスタイリスト優先 → ランク順（低ランクから）
      availableStylists.sort((a, b) => {
        const aBreak = (a.breaks && (a.breaks.lunch?.taken || a.breaks.rest?.taken)) ? 1 : 0;
        const bBreak = (b.breaks && (b.breaks.lunch?.taken || b.breaks.rest?.taken)) ? 1 : 0;
        if (aBreak !== bBreak) return bBreak - aBreak; // 休憩済みが先

        const aRank = rankPriority[a.rank] || 5;
        const bRank = rankPriority[b.rank] || 5;
        return aRank - bRank; // 低ランク（ジュニア）が先
      });

      if (availableStylists.length > 0) {
        const chosen = availableStylists[0];

        if (!assignments[slot.reservationId]) assignments[slot.reservationId] = {};
        assignments[slot.reservationId][slot.slotIndex] = chosen.id;

        if (!this._assignedSlotTimes[chosen.id]) this._assignedSlotTimes[chosen.id] = [];
        this._assignedSlotTimes[chosen.id].push({
          start: this._toTimestamp(slot.startTime),
          end: this._toTimestamp(slot.endTime)
        });
        this._assignmentCounts[chosen.id] = (this._assignmentCounts[chosen.id] || 0) + 1;

        summons.push({
          stylistId: chosen.id,
          reservationId: slot.reservationId,
          slotIndex: slot.slotIndex,
          startTime: slot.startTime,
          endTime: slot.endTime,
          badge: true,
          isSpecialSummon: false,
          specialSummonReason: null
        });
        resolved.push(slot);
      }
    });

    // 解決したスロットをunfilledSlotsから除去
    resolved.forEach(r => {
      const idx = unfilledSlots.indexOf(r);
      if (idx !== -1) unfilledSlots.splice(idx, 1);
    });

    return summons;
  }

  /**
   * 空き時間活動を割り当てる
   * @param {import('../models/staff.js').Staff[]} assistants
   * @param {import('../models/staff.js').Staff[]} stylists
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {Map<string, import('../models/menu.js').MenuItem>} menuMap
   * @param {Object} assignments
   * @param {Array} stylistSummons
   * @returns {Array<{staffId: string, startTime: Date, endTime: Date, activity: string}>}
   */
  _assignFreeTimeActivities(assistants, stylists, reservations, menuMap, assignments, stylistSummons, lunchOverrides = {}, restOverrides = {}) {
    const activities = [];
    const utilizationRates = {};

    // 分数値で統一するかどうか判定
    const isMinutesMode = reservations.length > 0 && typeof reservations[0].startTime === 'number';

    let baseTimeMs = 0;
    if (!isMinutesMode) {
      const today = new Date();
      const businessStart = new Date(today);
      businessStart.setHours(9, 0, 0, 0);
      if (reservations.length > 0) {
        const firstRes = new Date(reservations[0].startTime);
        businessStart.setFullYear(firstRes.getFullYear(), firstRes.getMonth(), firstRes.getDate());
      }
      baseTimeMs = businessStart.getTime();
    }

    const offsetToTimeValue = (m) => {
      if (isMinutesMode) return m;
      return new Date(baseTimeMs + m * 60 * 1000);
    };

    // 10分単位のスロット占有度を計算するヘルパー
    const getOccupancy = (staffId) => {
      const occupied = new Array(60).fill(false);

      // 1. スタイリストとしての予約
      reservations.forEach(res => {
        if (res.stylistId === staffId) {
          const startOffset = this._toTimestamp(res.startTime);
          const endOffset = this._toTimestamp(res.endTime);
          let startMin = startOffset;
          let endMin = endOffset;
          if (!isMinutesMode) {
            startMin = (startOffset - baseTimeMs) / 60000;
            endMin = (endOffset - baseTimeMs) / 60000;
          }
          const startSlot = Math.max(0, Math.floor(startMin / 10));
          const endSlot = Math.min(60, Math.ceil(endMin / 10));
          for (let s = startSlot; s < endSlot; s++) {
            occupied[s] = true;
          }
        }
      });

      // 2. アシスタントとしての配置
      if (this._assignedSlotTimes && this._assignedSlotTimes[staffId]) {
        this._assignedSlotTimes[staffId].forEach(slotTime => {
          let startMin = slotTime.start;
          let endMin = slotTime.end;
          if (!isMinutesMode) {
            startMin = (slotTime.start - baseTimeMs) / 60000;
            endMin = (slotTime.end - baseTimeMs) / 60000;
          }
          const startSlot = Math.max(0, Math.floor(startMin / 10));
          const endSlot = Math.min(60, Math.ceil(endMin / 10));
          for (let s = startSlot; s < endSlot; s++) {
            occupied[s] = true;
          }
        });
      }

      // 3. スタイリスト召喚
      if (stylistSummons) {
        stylistSummons.forEach(summon => {
          if (summon.stylistId === staffId) {
            const startOffset = this._toTimestamp(summon.startTime);
            const endOffset = this._toTimestamp(summon.endTime);
            let startMin = startOffset;
            let endMin = endOffset;
            if (!isMinutesMode) {
              startMin = (startOffset - baseTimeMs) / 60000;
              endMin = (endOffset - baseTimeMs) / 60000;
            }
            const startSlot = Math.max(0, Math.floor(startMin / 10));
            const endSlot = Math.min(60, Math.ceil(endMin / 10));
            for (let s = startSlot; s < endSlot; s++) {
              occupied[s] = true;
            }
          }
        });
      }

      return occupied;
    };

    const workingStylists = stylists.filter(s => s.isWorking);
    const workingAssistants = assistants.filter(a => a.isWorking);
    const allStaff = [...workingStylists, ...workingAssistants];

    const staffOccupancies = {};
    const baseBusySlotsCounts = {};
    const allocatedLunch = {};
    const allocatedRest = {};

    allStaff.forEach(staff => {
      const occ = getOccupancy(staff.id);

      // 基本勤務時間外のスロットを閉鎖（占有済み）にする
      for (let s = 0; s < 60; s++) {
        const slotMinute = 540 + (s * 10); // 9:00(540分) 基準
        if (typeof staff.isWorkingAtTime === 'function' && !staff.isWorkingAtTime(slotMinute)) {
          occ[s] = true;
        }
      }

      staffOccupancies[staff.id] = occ;
      baseBusySlotsCounts[staff.id] = occ.reduce((sum, val) => sum + (val ? 1 : 0), 0);
      allocatedLunch[staff.id] = null;
      allocatedRest[staff.id] = null;
    });

    // --- 1. お昼ご飯アサイン（手動オーバーライドの適用） ---
    allStaff.forEach(staff => {
      const manualStartMin = lunchOverrides[staff.id];
      if (manualStartMin !== undefined && manualStartMin !== null) {
        const bestStartSlot = Math.floor(manualStartMin / 10);
        allocatedLunch[staff.id] = { startSlot: bestStartSlot, endSlot: bestStartSlot + 3 };
        for (let offset = 0; offset < 3; offset++) {
          staffOccupancies[staff.id][bestStartSlot + offset] = true;
        }
        activities.push({
          staffId: staff.id,
          startTime: offsetToTimeValue(bestStartSlot * 10),
          endTime: offsetToTimeValue((bestStartSlot + 3) * 10),
          activity: 'lunch',
          isManualLunch: true
        });
      }
    });

    // --- 2. お昼ご飯アサイン（自動ずらし配置） ---
    allStaff.forEach(staff => {
      if (allocatedLunch[staff.id]) return; // 手動配置済みはスキップ

      let bestStartSlot = -1;
      let minOverlap = Infinity;

      for (let s = 9; s <= 57; s++) {
        let isFree = true;
        for (let offset = 0; offset < 3; offset++) {
          if (staffOccupancies[staff.id][s + offset]) {
            isFree = false;
            break;
          }
        }

        if (isFree) {
          let overlapCount = 0;
          allStaff.forEach(other => {
            if (allocatedLunch[other.id]) {
              const lunchStart = allocatedLunch[other.id].startSlot;
              const lunchEnd = allocatedLunch[other.id].endSlot;
              if (lunchStart < s + 3 && lunchEnd > s) {
                overlapCount++;
              }
            }
          });

          if (overlapCount < minOverlap) {
            minOverlap = overlapCount;
            bestStartSlot = s;
          }
        }
      }

      if (bestStartSlot !== -1) {
        allocatedLunch[staff.id] = { startSlot: bestStartSlot, endSlot: bestStartSlot + 3 };
        for (let offset = 0; offset < 3; offset++) {
          staffOccupancies[staff.id][bestStartSlot + offset] = true;
        }
        activities.push({
          staffId: staff.id,
          startTime: offsetToTimeValue(bestStartSlot * 10),
          endTime: offsetToTimeValue((bestStartSlot + 3) * 10),
          activity: 'lunch'
        });
      }
    });

    // --- 2. 休憩アサイン（手動オーバーライド or 昼食終了2時間後以降の空き） ---
    allStaff.forEach(staff => {
      if (!allocatedLunch[staff.id]) return;

      const manualRestMin = restOverrides[staff.id];
      if (manualRestMin !== undefined && manualRestMin !== null) {
        // 手動オーバーライド: 指定された位置に休憩を配置
        const bestStartSlot = Math.floor(manualRestMin / 10);
        allocatedRest[staff.id] = { startSlot: bestStartSlot, endSlot: bestStartSlot + 3 };
        for (let offset = 0; offset < 3; offset++) {
          staffOccupancies[staff.id][bestStartSlot + offset] = true;
        }
        activities.push({
          staffId: staff.id,
          startTime: offsetToTimeValue(bestStartSlot * 10),
          endTime: offsetToTimeValue((bestStartSlot + 3) * 10),
          activity: 'rest',
          isManualRest: true
        });
        return;
      }

      const lunchEndSlot = allocatedLunch[staff.id].endSlot;
      const minRestStartSlot = lunchEndSlot + 12; // 2時間後

      let bestStartSlot = -1;
      let minOverlap = Infinity;

      for (let s = minRestStartSlot; s <= 57; s++) {
        let isFree = true;
        for (let offset = 0; offset < 3; offset++) {
          if (staffOccupancies[staff.id][s + offset]) {
            isFree = false;
            break;
          }
        }

        if (isFree) {
          let overlapCount = 0;
          allStaff.forEach(other => {
            if (allocatedRest[other.id]) {
              const restStart = allocatedRest[other.id].startSlot;
              const restEnd = allocatedRest[other.id].endSlot;
              if (restStart < s + 3 && restEnd > s) {
                overlapCount++;
              }
            }
          });

          if (overlapCount < minOverlap) {
            minOverlap = overlapCount;
            bestStartSlot = s;
          }
        }
      }

      if (bestStartSlot !== -1) {
        allocatedRest[staff.id] = { startSlot: bestStartSlot, endSlot: bestStartSlot + 3 };
        for (let offset = 0; offset < 3; offset++) {
          staffOccupancies[staff.id][bestStartSlot + offset] = true;
        }
        activities.push({
          staffId: staff.id,
          startTime: offsetToTimeValue(bestStartSlot * 10),
          endTime: offsetToTimeValue((bestStartSlot + 3) * 10),
          activity: 'rest'
        });
      }
    });

    // --- 3. その他の活動アサイン ---
    const staffActivities = {};

    allStaff.forEach(staff => {
      staffActivities[staff.id] = [];
    });

    // 各スタッフの空きブロックを検出し、1つ目=練習、2つ目=大掃除、3つ目以降=空き時間 とする
    // ただしオーナー（経営者）の場合は練習・大掃除は表示せず、全て空き時間とする
    allStaff.forEach(staff => {
      const isOwner = staff.rank === 'owner' || (staff.rank && staff.rank.id === 'owner');
      let hasPractice = false;
      let hasCleaning = false;

      for (let s = 0; s <= 57; ) {
        let isFree = true;
        for (let offset = 0; offset < 3; offset++) {
          if (staffOccupancies[staff.id][s + offset]) {
            isFree = false;
            break;
          }
        }

        if (isFree) {
          if (isOwner) {
            // オーナー（経営者）の場合は練習・大掃除は表示せず全て空き時間とする
            staffActivities[staff.id].push({
              activity: 'free_time',
              startSlot: s
            });
          } else if (!hasPractice) {
            // 1つ目の空き: 練習（稼働率に含む）
            hasPractice = true;
            for (let offset = 0; offset < 3; offset++) {
              staffOccupancies[staff.id][s + offset] = true;
            }
            staffActivities[staff.id].push({
              activity: 'practice',
              startSlot: s
            });
          } else if (!hasCleaning) {
            // 2つ目の空き: 大掃除（稼働率に含む）
            hasCleaning = true;
            for (let offset = 0; offset < 3; offset++) {
              staffOccupancies[staff.id][s + offset] = true;
            }
            staffActivities[staff.id].push({
              activity: 'cleaning',
              startSlot: s
            });
          } else {
            // 3つ目以降: 空き時間（稼働率に含めない → staffOccupancies を true にしない）
            staffActivities[staff.id].push({
              activity: 'free_time',
              startSlot: s
            });
          }
          s += 3;
        } else {
          s += 1;
        }
      }
    });

    // 結果の activities 配列に変換して追加
    allStaff.forEach(staff => {
      const restInfo = allocatedRest[staff.id];
      const lunchInfo = allocatedLunch[staff.id];
      
      staffActivities[staff.id].forEach(act => {
        // 休憩変換可能判定: 練習/大掃除/空き時間で、昼食後〜休憩前にある場合
        let isConvertibleToRest = false;
        if ((act.activity === 'practice' || act.activity === 'cleaning' || act.activity === 'free_time') && lunchInfo) {
          // 昼食が配置されていて、このブロックが昼食の後にある場合のみ変換可能
          if (act.startSlot >= lunchInfo.endSlot) {
            if (restInfo) {
              // 休憩が配置されている場合: 休憩より前のブロックは変換可能
              if (act.startSlot < restInfo.startSlot) {
                isConvertibleToRest = true;
              }
            } else {
              // 休憩が配置されていない場合: 昼食後の全てのブロックが変換可能
              isConvertibleToRest = true;
            }
          }
        }

        activities.push({
          staffId: staff.id,
          startTime: offsetToTimeValue(act.startSlot * 10),
          endTime: offsetToTimeValue((act.startSlot + 3) * 10),
          activity: act.activity,
          startSlot: act.startSlot,
          isConvertibleToRest
        });
      });
    });

    // --- 4. 「お昼可」バッジの判定 ---
    allStaff.forEach(staff => {
      const lunch = allocatedLunch[staff.id];
      const isLunchLateOrMissing = !lunch || lunch.startSlot > 24;

      activities.forEach(act => {
        if (act.staffId === staff.id && (act.activity === 'practice' || act.activity === 'cleaning')) {
          if (isLunchLateOrMissing) {
            // 昼食が遅い/未配置: 13:00前の練習/大掃除はお昼変換可能
            if (act.startSlot < 24) {
              act.isLunchConvertible = true;
            }
          } else if (lunch && act.startSlot < lunch.startSlot) {
            // 昼食が配置済みでも、練習/大掃除が昼食より前にある場合はお昼変換可能
            act.isLunchConvertible = true;
          }
        }
      });
    });

    // --- 4. カスタム稼働率の計算 ---
    allStaff.forEach(staff => {
      const hasLunch = allocatedLunch[staff.id] !== null;
      const hasRest = allocatedRest[staff.id] !== null;

      if (!hasLunch && !hasRest) {
        utilizationRates[staff.id] = 120;
      } else if (!hasLunch || !hasRest) {
        utilizationRates[staff.id] = 110;
      } else {
        const busySlots = baseBusySlotsCounts[staff.id] + 3 + 3;
        const baseRate = (busySlots / 60) * 100;
        utilizationRates[staff.id] = Math.min(100, Math.round(baseRate));
      }
    });

    return { activities, utilizationRates };
  }

  /**
   * 公平性スコアを計算する
   * @param {Object} assignments - 全配置
   * @param {import('../models/staff.js').Staff[]} assistants
   * @param {RequiredSlot[]} requiredSlots
   * @returns {Object.<string, {busyMinutes: number, assignmentCount: number, fairnessScore: number}>}
   */
  _calculateFairness(assignments, assistants, requiredSlots) {
    const scores = {};

    assistants.forEach(assistant => {
      const assignedSlots = requiredSlots.filter(slot => {
        const resAssign = assignments[slot.reservationId];
        if (!resAssign) return false;
        return resAssign[slot.slotIndex] === assistant.id;
      });

      const busyMinutes = assignedSlots.reduce((sum, slot) => {
        const start = this._toTimestamp(slot.startTime);
        const end = this._toTimestamp(slot.endTime);
        // 分数値モードの場合はそのまま差分、Dateモードの場合は60000で割る
        const diff = end - start;
        return sum + (typeof slot.startTime === 'number' ? diff : diff / 60000);
      }, 0);

      const assignmentCount = assignedSlots.length;

      // 公平性スコア: 全アシスタントの平均稼働時間との差分を基に計算
      // （後で正規化するので一旦busyMinutesを保存）
      scores[assistant.id] = {
        busyMinutes,
        assignmentCount,
        fairnessScore: 0
      };
    });

    // 全アシスタントの平均稼働時間を計算
    const allMinutes = Object.values(scores).map(s => s.busyMinutes);
    const avgMinutes = allMinutes.length > 0
      ? allMinutes.reduce((a, b) => a + b, 0) / allMinutes.length
      : 0;

    // 公平性スコア: 平均との乖離度（0が最良、大きいほど不公平）
    Object.keys(scores).forEach(id => {
      const diff = Math.abs(scores[id].busyMinutes - avgMinutes);
      // 0〜100のスコアに変換（100が最も公平）
      scores[id].fairnessScore = Math.max(0, 100 - diff);
    });

    return scores;
  }
}
