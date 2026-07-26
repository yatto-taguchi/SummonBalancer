/**
 * fatigueManager.js — 疲労管理システム
 *
 * 全スタッフの稼働率・疲労度データを計算し、
 * 最適な休憩スケジュールを提案する。
 */

/**
 * 疲労データ
 * @typedef {Object} FatigueData
 * @property {string} staffId - スタッフID
 * @property {number} totalMinutes - 営業時間（通常600分 = 10時間）
 * @property {number} busyMinutes - 稼働時間
 * @property {number} freeMinutes - 空き時間
 * @property {number} utilizationRate - 稼働率 (0-1)
 * @property {{lunch: boolean, rest: boolean}} breaksTaken - 休憩取得状況
 * @property {number|null} suggestedLunchTime - 推奨昼食時間（分、営業開始からのオフセット）
 * @property {number|null} suggestedRestTime - 推奨休憩時間（分、営業開始からのオフセット）
 */

export class FatigueManager {
  constructor() {
    /** @type {number} 営業開始時（時） */
    this.businessStartHour = 9;
    /** @type {number} 営業終了時（時） */
    this.businessEndHour = 19;
    /** @type {number} 営業時間（分） */
    this.totalBusinessMinutes = (this.businessEndHour - this.businessStartHour) * 60; // 600分
    /** @type {number} 休憩時間（分） */
    this.breakDuration = 30;
  }

  /**
   * 全スタッフの疲労度データを計算する
   * @param {import('../models/staff.js').Staff[]} staff - 全出勤スタッフ
   * @param {import('../models/reservation.js').Reservation[]} reservations - 当日の全予約
   * @param {import('../services/summonEngine.js').SummonResult} summonResult - 召喚結果
   * @returns {FatigueData[]}
   */
  calculate(staff, reservations, summonResult) {
    const results = [];

    staff.forEach(member => {
      if (!member.isWorking) return;

      const busyMinutes = this._calculateBusyMinutes(member.id, reservations, summonResult);
      const freeMinutes = Math.max(0, this.totalBusinessMinutes - busyMinutes);
      const utilizationRate = this.totalBusinessMinutes > 0
        ? busyMinutes / this.totalBusinessMinutes
        : 0;

      // 休憩取得状況
      const breaksTaken = {
        lunch: !!(member.breaks && member.breaks.lunch?.taken),
        rest: !!(member.breaks && member.breaks.rest?.taken)
      };

      // 推奨休憩時間を計算
      const busySlots = this._getBusySlots(member.id, reservations, summonResult);
      const suggestedLunch = this._findBreakWindow(busySlots, 150, 300); // 11:30〜14:00 (9:00基準で150分〜300分)
      const suggestedRest = this._findBreakWindow(busySlots, 360, 480);  // 15:00〜17:00 (9:00基準で360分〜480分)

      results.push({
        staffId: member.id,
        totalMinutes: this.totalBusinessMinutes,
        busyMinutes,
        freeMinutes,
        utilizationRate: Math.round(utilizationRate * 100) / 100,
        breaksTaken,
        suggestedLunchTime: breaksTaken.lunch ? null : suggestedLunch,
        suggestedRestTime: breaksTaken.rest ? null : suggestedRest
      });
    });

    return results;
  }

  /**
   * 休憩スケジュールを提案する
   * @param {import('../models/staff.js').Staff[]} staff
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {import('../services/summonEngine.js').SummonResult} summonResult
   * @returns {Array<{staffId: string, lunchTime: number|null, restTime: number|null}>}
   */
  suggestBreaks(staff, reservations, summonResult) {
    const suggestions = [];

    staff.forEach(member => {
      if (!member.isWorking) return;

      const busySlots = this._getBusySlots(member.id, reservations, summonResult);
      const hasLunch = member.breaks && member.breaks.lunch?.taken;
      const hasRest = member.breaks && member.breaks.rest?.taken;

      suggestions.push({
        staffId: member.id,
        lunchTime: hasLunch ? null : this._findBreakWindow(busySlots, 150, 300),
        restTime: hasRest ? null : this._findBreakWindow(busySlots, 360, 480)
      });
    });

    return suggestions;
  }

  /**
   * スタッフの空き時間を計算する（分単位）
   * @param {string} staffId
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {import('../services/summonEngine.js').SummonResult} summonResult
   * @returns {number} 空き時間（分）
   */
  calculateFreeTime(staffId, reservations, summonResult) {
    const busyMinutes = this._calculateBusyMinutes(staffId, reservations, summonResult);
    return Math.max(0, this.totalBusinessMinutes - busyMinutes);
  }

  /**
   * スタッフの稼働時間を計算する（分単位）
   * @param {string} staffId
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {import('../services/summonEngine.js').SummonResult} summonResult
   * @returns {number}
   * @private
   */
  _calculateBusyMinutes(staffId, reservations, summonResult) {
    const slots = this._getBusySlots(staffId, reservations, summonResult);

    // 重複を排除して合計稼働時間を計算
    const merged = this._mergeTimeSlots(slots);
    return merged.reduce((sum, slot) => sum + (slot.end - slot.start), 0);
  }

  /**
   * スタッフの稼働時間帯を取得する（営業開始からの分オフセット）
   * @param {string} staffId
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {import('../services/summonEngine.js').SummonResult} summonResult
   * @returns {Array<{start: number, end: number}>} 営業開始からの分オフセット
   * @private
   */
  _getBusySlots(staffId, reservations, summonResult) {
    const slots = [];

    // 分数値モードかどうかの判定
    const isMinutesMode = reservations.length > 0 && typeof reservations[0].startTime === 'number';

    /**
     * 時刻値を営業開始からの分オフセットに変換する
     * @param {number|string|Date} time
     * @param {number} bsTime - 営業開始タイムスタンプ（Dateモード時のみ使用）
     * @returns {number}
     */
    const toMinuteOffset = (time, bsTime) => {
      if (typeof time === 'number') return time;
      return (new Date(time).getTime() - bsTime) / 60000;
    };

    // 営業開始時刻の基準を取得（Dateモード時のみ必要）
    let bsTime = 0;
    if (!isMinutesMode) {
      let businessStartTime;
      if (reservations.length > 0) {
        const refDate = new Date(reservations[0].startTime);
        businessStartTime = new Date(refDate);
        businessStartTime.setHours(this.businessStartHour, 0, 0, 0);
      } else {
        businessStartTime = new Date();
        businessStartTime.setHours(this.businessStartHour, 0, 0, 0);
      }
      bsTime = businessStartTime.getTime();
    }

    // スタイリストとしての予約
    reservations.forEach(res => {
      if (res.stylistId === staffId) {
        const startOffset = toMinuteOffset(res.startTime, bsTime);
        const endOffset = toMinuteOffset(res.endTime, bsTime);
        slots.push({
          start: Math.max(0, startOffset),
          end: Math.min(this.totalBusinessMinutes, endOffset)
        });
      }
    });

    // アシスタントとしての配置（召喚結果から）
    if (summonResult && summonResult.assignments) {
      Object.entries(summonResult.assignments).forEach(([reservationId, slotMap]) => {
        Object.entries(slotMap).forEach(([slotIndex, assignedId]) => {
          if (assignedId === staffId) {
            const reservation = reservations.find(r => r.id === reservationId);
            if (!reservation) return;

            const startOffset = toMinuteOffset(reservation.startTime, bsTime);
            const endOffset = toMinuteOffset(reservation.endTime, bsTime);
            slots.push({
              start: Math.max(0, startOffset),
              end: Math.min(this.totalBusinessMinutes, endOffset)
            });
          }
        });
      });
    }

    // スタイリスト召喚も考慮
    if (summonResult && summonResult.stylistSummons) {
      summonResult.stylistSummons.forEach(summon => {
        if (summon.stylistId === staffId) {
          const reservation = reservations.find(r => r.id === summon.reservationId);
          if (!reservation) return;

          const startOffset = toMinuteOffset(reservation.startTime, bsTime);
          const endOffset = toMinuteOffset(reservation.endTime, bsTime);
          slots.push({
            start: Math.max(0, startOffset),
            end: Math.min(this.totalBusinessMinutes, endOffset)
          });
        }
      });
    }

    // 空き時間活動も稼働として計算（ただし free_time は除外）
    if (summonResult && summonResult.freeTimeActivities) {
      summonResult.freeTimeActivities.forEach(activity => {
        // free_time は稼働として計算しない（空き時間のまま）
        if (activity.staffId === staffId && activity.activity !== 'free_time') {
          const startOffset = toMinuteOffset(activity.startTime, bsTime);
          const endOffset = toMinuteOffset(activity.endTime, bsTime);
          slots.push({
            start: Math.max(0, startOffset),
            end: Math.min(this.totalBusinessMinutes, endOffset)
          });
        }
      });
    }

    return slots;
  }

  /**
   * 時間帯を結合して重複を排除する
   * @param {Array<{start: number, end: number}>} slots
   * @returns {Array<{start: number, end: number}>}
   * @private
   */
  _mergeTimeSlots(slots) {
    if (slots.length === 0) return [];

    const sorted = [...slots].sort((a, b) => a.start - b.start);
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      if (sorted[i].start <= last.end) {
        last.end = Math.max(last.end, sorted[i].end);
      } else {
        merged.push({ ...sorted[i] });
      }
    }

    return merged;
  }

  /**
   * 指定時間帯内で休憩可能な窓を探す
   * @param {Array<{start: number, end: number}>} busySlots - 稼働スロット
   * @param {number} windowStart - 検索範囲の開始（営業開始からの分）
   * @param {number} windowEnd - 検索範囲の終了（営業開始からの分）
   * @returns {number|null} 推奨休憩開始時刻（営業開始からの分）、見つからない場合null
   * @private
   */
  _findBreakWindow(busySlots, windowStart, windowEnd) {
    const merged = this._mergeTimeSlots(busySlots);
    const breakDuration = this.breakDuration;

    // 検索範囲内の空き時間を探す
    let cursor = windowStart;

    for (const slot of merged) {
      // スロットが検索範囲外なら次へ
      if (slot.end <= windowStart) continue;
      if (slot.start >= windowEnd) break;

      // cursorからスロット開始までの空きを確認
      const gapEnd = Math.min(slot.start, windowEnd);
      if (gapEnd - cursor >= breakDuration) {
        return cursor; // 休憩を入れられる時間帯を発見
      }

      // cursorをスロット終了まで進める
      cursor = Math.max(cursor, slot.end);
    }

    // 最後のスロットの後にも空きがあるか確認
    if (windowEnd - cursor >= breakDuration) {
      return cursor;
    }

    return null; // 適切な休憩時間が見つからなかった
  }
}
