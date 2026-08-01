/**
 * @fileoverview アコーディオン展開状態管理モジュール
 * タイムラインの30分スロットを5分刻みに展開する機能のUI状態を管理する。
 * 純粋なUI層のモジュールであり、EngineStateには一切触れない。
 * @module components/accordionManager
 */

/** 営業開始時刻（時） */
const START_HOUR = 9;
/** 営業終了時刻（時） */
const END_HOUR = 19;
/** 1スロットの分数 */
const SLOT_MINUTES = 30;
/** 総スロット数 (9:00〜19:00 = 20) */
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * (60 / SLOT_MINUTES); // 20
/** 展開時のサブスロット数 (30分 / 5分 = 6) */
const SUB_SLOT_COUNT = 6;
/** サブスロットの分数 (5分) */
const SUB_SLOT_MINUTES = SLOT_MINUTES / SUB_SLOT_COUNT; // 5
/** 総営業分数 */
const TOTAL_DURATION_MIN = (END_HOUR - START_HOUR) * 60; // 600

/**
 * アコーディオン展開状態を管理するシングルトンクラス。
 * 展開状態に応じた重み付きパーセンテージ位置計算を提供する。
 */
class AccordionManager {
  constructor() {
    /** @type {number|null} 現在展開中のスロットインデックス (0-19)、nullなら全て折りたたみ */
    this._expandedSlot = null;
  }

  // ─── 状態操作 ───

  /**
   * 指定スロットの展開/折りたたみをトグルする（排他制御: 最大1スロット）
   * @param {number} slotIndex - スロットインデックス (0-19)
   */
  toggle(slotIndex) {
    if (slotIndex < 0 || slotIndex >= TOTAL_SLOTS) return;
    if (this._expandedSlot === slotIndex) {
      // 同じスロット → 折りたたむ
      this._expandedSlot = null;
    } else {
      // 別のスロット → 排他的に展開（古いのは自動で閉じる）
      this._expandedSlot = slotIndex;
    }
    this._dispatchChange();
  }

  /**
   * 全スロットを折りたたむ（ドラッグ開始時の安全フォールバック用）
   */
  collapse() {
    if (this._expandedSlot !== null) {
      this._expandedSlot = null;
      this._dispatchChange();
    }
  }

  /**
   * 指定スロットが展開中かどうか
   * @param {number} slotIndex
   * @returns {boolean}
   */
  isExpanded(slotIndex) {
    return this._expandedSlot === slotIndex;
  }

  /**
   * 現在展開中のスロットインデックスを返す
   * @returns {number|null}
   */
  get expandedSlot() {
    return this._expandedSlot;
  }

  /**
   * 展開中のスロットがあるかどうか
   * @returns {boolean}
   */
  get hasExpanded() {
    return this._expandedSlot !== null;
  }

  // ─── 重み計算 ───

  /**
   * 指定スロットのflex比率（重み）を返す
   * @param {number} slotIndex
   * @returns {number} 通常=1, 展開=SUB_SLOT_COUNT(6)
   */
  getSlotWeight(slotIndex) {
    return this._expandedSlot === slotIndex ? SUB_SLOT_COUNT : 1;
  }

  /**
   * 全スロットの合計ウェイトを返す
   * @returns {number} 展開なし=20, 展開あり=25
   */
  getTotalWeight() {
    if (this._expandedSlot === null) return TOTAL_SLOTS;
    return TOTAL_SLOTS - 1 + SUB_SLOT_COUNT; // 19 + 6 = 25
  }

  // ─── 位置計算（核心ロジック） ───

  /**
   * 営業開始からの経過分数を、重み付きパーセンテージ位置に変換する。
   * 展開中のスロットがなければ (minutes / 600) * 100 と同じ結果を返す。
   *
   * 【重要】width計算時は必ず getWeightedPosition(end) - getWeightedPosition(start) で
   * 算出し、累積誤差を防ぐこと。
   *
   * @param {number} minutes - 営業開始(9:00)からの経過分数 (0〜600)
   * @returns {number} パーセンテージ位置 (0〜100)
   */
  getWeightedPosition(minutes) {
    // 境界チェック
    if (minutes <= 0) return 0;
    if (minutes >= TOTAL_DURATION_MIN) return 100;

    // 展開なしの場合はシンプルな計算（パフォーマンス最適化）
    if (this._expandedSlot === null) {
      return (minutes / TOTAL_DURATION_MIN) * 100;
    }

    const totalWeight = this.getTotalWeight();

    // minutesをスロットインデックスとスロット内オフセットに分解
    const slotIndex = Math.min(Math.floor(minutes / SLOT_MINUTES), TOTAL_SLOTS - 1);
    const slotOffset = (minutes - slotIndex * SLOT_MINUTES) / SLOT_MINUTES;

    // 累積ウェイトを計算
    let cumWeight = 0;
    for (let i = 0; i < slotIndex; i++) {
      cumWeight += this.getSlotWeight(i);
    }
    cumWeight += this.getSlotWeight(slotIndex) * slotOffset;

    return (cumWeight / totalWeight) * 100;
  }

  /**
   * パーセンテージ位置を営業開始からの分数に逆変換する
   * getWeightedPosition の逆関数
   * @param {number} pct - パーセンテージ位置 (0〜100)
   * @returns {number} 営業開始からの分数 (0〜600)
   */
  getMinutesFromPosition(pct) {
    if (pct <= 0) return 0;
    if (pct >= 100) return TOTAL_DURATION_MIN;

    if (this._expandedSlot === null) {
      return (pct / 100) * TOTAL_DURATION_MIN;
    }

    const totalWeight = this.getTotalWeight();
    const targetWeight = (pct / 100) * totalWeight;
    let cumWeight = 0;

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slotWeight = this.getSlotWeight(i);
      if (cumWeight + slotWeight >= targetWeight) {
        const offset = (targetWeight - cumWeight) / slotWeight;
        return (i + offset) * SLOT_MINUTES;
      }
      cumWeight += slotWeight;
    }
    return TOTAL_DURATION_MIN;
  }

  // ─── イベント ───

  /**
   * accordion-changed カスタムイベントを発行する
   * @private
   */
  _dispatchChange() {
    document.dispatchEvent(new CustomEvent('accordion-changed', {
      detail: { expandedSlot: this._expandedSlot }
    }));
  }
}

// シングルトンとしてエクスポート
const accordionManager = new AccordionManager();
export default accordionManager;
export { TOTAL_SLOTS, SLOT_MINUTES, SUB_SLOT_COUNT, SUB_SLOT_MINUTES, START_HOUR, END_HOUR, TOTAL_DURATION_MIN };
