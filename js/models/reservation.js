/**
 * @fileoverview 予約データモデル
 * 
 * 美容室の予約情報を管理するデータ構造を定義する。
 * 各予約はメニュー、担当スタイリスト、時間帯、
 * 割り当てられたアシスタント情報を持つ。
 * 
 * @module models/reservation
 */

/**
 * 予約データモデルクラス
 * 
 * 美容室の個別予約を表現する。
 * タイムライン上に配置され、スタイリストとアシスタントが紐づく。
 */
export class Reservation {
  /**
   * 予約インスタンスを作成する
   * @param {Object} params - 予約パラメータ
   * @param {string} params.id - UUID形式の一意識別子
   * @param {string} params.menuItemId - メニューアイテムのID
   * @param {string} params.stylistId - 担当スタイリストのID
   * @param {number} params.startTime - 開始時間（分単位、9:00=0, 9:30=30, ...）
   * @param {number} params.endTime - 終了時間（分単位）
   * @param {Object.<number, string>} [params.assignedAssistants={}] - スロットインデックスからアシスタントIDへのマップ
   * @param {string} [params.menuVariant=''] - メニューバリエーション名（例: "カットのみ（メンズ）"）
   * @throws {Error} 必須パラメータが不足している場合
   */
  constructor({ id, menuItemId, stylistId, startTime, endTime, assignedAssistants = {}, menuVariant = '', fixedAssistants = {}, ganbare = {}, nonOverlapSummonEnabled, slotTimeOverrides = {}, items = null, manualVariantSelection = false, autoSwitchedVariant = false, memo = '' }) {
    // 必須パラメータのバリデーション
    if (!id) {
      throw new Error('予約IDは必須です');
    }
    if (!menuItemId || typeof menuItemId !== 'string') {
      throw new Error('メニューアイテムIDは必須です');
    }
    if (!stylistId || typeof stylistId !== 'string') {
      throw new Error('スタイリストIDは必須です');
    }
    if (typeof startTime !== 'number' || startTime < 0) {
      throw new Error('開始時間は0以上の数値で指定してください');
    }
    if (typeof endTime !== 'number' || endTime <= startTime) {
      throw new Error('終了時間は開始時間より大きい数値で指定してください');
    }

    /** @type {string} 予約ID（UUID） */
    this.id = id;

    /** @type {string} メニューアイテムID */
    this.menuItemId = menuItemId;

    /** @type {string} 担当スタイリストID */
    this.stylistId = stylistId;

    /** @type {number} 開始時間（分単位、9:00起点） */
    this.startTime = startTime;

    /** @type {number} 終了時間（分単位、9:00起点） */
    this.endTime = endTime;

    /** @type {Object.<number, string>} アシスタント割り当てマップ { slotIndex: assistantId } */
    this.assignedAssistants = { ...assignedAssistants };

    /** @type {string} メニューバリエーション名 */
    this.menuVariant = menuVariant || '';

    /** @type {Object.<number, string>} 固定されたアシスタントマップ { slotIndex: assistantId } */
    this.fixedAssistants = { ...fixedAssistants };

    /** @type {Object.<number, Array<string>>} 頑張れ配置マップ { slotIndex: [staffId1, staffId2, ...] } */
    this.ganbare = {};
    for (const [k, v] of Object.entries(ganbare)) {
      this.ganbare[k] = Array.isArray(v) ? [...v] : [v];
    }

    // nonOverlapSummonEnabled は廃止済み（fixedAssistants による __none__ 一括設定に一本化）
    // 後方互換: 既存データに含まれていても無視する

    /**
     * @type {Object.<number, {startMinute: number, endMinute: number}>}
     * スロットごとの時間オーバーライド。メニュー定義の時間を個別上書きする。
     * キーはslotIndex (0始まり)、値は {startMinute, endMinute}（予約開始からの相対分）。
     */
    this.slotTimeOverrides = { ...slotTimeOverrides };

    /**
     * @type {Array<{menuItemId: string, duration: number}>|null}
     * 合体予約に含まれるメニューのリスト
     */
    this.items = Array.isArray(items) ? items.map(item => ({ ...item })) : null;

    /** @type {boolean} ユーザーによる手動バリエーション選択フラグ */
    this.manualVariantSelection = Boolean(manualVariantSelection);

    /** @type {boolean} 掛け持ちによる自動切替フラグ */
    this.autoSwitchedVariant = Boolean(autoSwitchedVariant);

    /** @type {string} 予約に関するメモ・申し送り事項 */
    this.memo = memo || '';
  }

  /**
   * 予約の所要時間を返す（分）
   * @returns {number} 所要時間（分）
   */
  getDuration() {
    return this.endTime - this.startTime;
  }

  /**
   * 30分セルに換算した開始位置を返す
   * @returns {number} 開始セルインデックス（0始まり）
   */
  getStartCell() {
    return Math.floor(this.startTime / 30);
  }

  /**
   * 30分セルに換算したブロック数を返す
   * @returns {number} 占有するセル数
   */
  getCellSpan() {
    return Math.ceil(this.getDuration() / 30);
  }

  /**
   * 分単位の時間を "HH:MM" 形式の文字列に変換する（9:00起点）
   * @param {number} minutes - 分単位の時間
   * @returns {string} "HH:MM" 形式の文字列
   */
  static minutesToTimeString(minutes) {
    if (typeof minutes !== 'number' || minutes < 0) {
      return '--:--';
    }
    const baseHour = 9; // 9:00起点
    const totalMinutes = baseHour * 60 + minutes;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  /**
   * "HH:MM" 形式の文字列を分単位の時間に変換する（9:00起点）
   * @param {string} timeString - "HH:MM" 形式の文字列
   * @returns {number} 分単位の時間（9:00=0）
   * @throws {Error} 無効な時間文字列の場合
   */
  static timeStringToMinutes(timeString) {
    if (!timeString || typeof timeString !== 'string') {
      throw new Error('無効な時間文字列です');
    }
    const parts = timeString.split(':');
    if (parts.length !== 2) {
      throw new Error('時間文字列は "HH:MM" 形式で指定してください');
    }
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) {
      throw new Error('無効な時間値です');
    }
    const baseHour = 9;
    return (hours - baseHour) * 60 + mins;
  }

  /**
   * 開始時間の表示文字列を返す
   * @returns {string} "HH:MM" 形式
   */
  getStartTimeString() {
    return Reservation.minutesToTimeString(this.startTime);
  }

  /**
   * 終了時間の表示文字列を返す
   * @returns {string} "HH:MM" 形式
   */
  getEndTimeString() {
    return Reservation.minutesToTimeString(this.endTime);
  }

  /**
   * 特定のスロットにアシスタントを割り当てる
   * @param {number} slotIndex - スロットインデックス
   * @param {string} assistantId - アシスタントID
   */
  assignAssistant(slotIndex, assistantId) {
    if (typeof slotIndex !== 'number' || slotIndex < 0) {
      throw new Error('スロットインデックスは0以上の数値で指定してください');
    }
    if (!assistantId || typeof assistantId !== 'string') {
      throw new Error('アシスタントIDは必須です');
    }
    this.assignedAssistants[slotIndex] = assistantId;
  }

  /**
   * 特定のスロットからアシスタントの割り当てを解除する
   * @param {number} slotIndex - スロットインデックス
   */
  unassignAssistant(slotIndex) {
    delete this.assignedAssistants[slotIndex];
  }

  /**
   * 全スロットにアシスタントが割り当てられているかチェックする
   * @param {number} totalSlots - メニューの全スロット数
   * @returns {boolean} 全て割り当て済みならtrue
   */
  isFullyAssigned(totalSlots) {
    if (totalSlots <= 0) {
      return true;
    }
    const assignedCount = Object.keys(this.assignedAssistants).length;
    return assignedCount >= totalSlots;
  }

  /**
   * 指定した時間帯と重なるかどうかチェックする
   * @param {number} otherStart - チェック対象の開始時間（分）
   * @param {number} otherEnd - チェック対象の終了時間（分）
   * @returns {boolean} 重なりがある場合true
   */
  overlaps(otherStart, otherEnd) {
    return this.startTime < otherEnd && this.endTime > otherStart;
  }

  /**
   * プレーンオブジェクトに変換する（シリアライズ用）
   * @returns {Object} プレーンオブジェクト
   */
  toJSON() {
    return {
      id: this.id,
      menuItemId: this.menuItemId,
      stylistId: this.stylistId,
      startTime: this.startTime,
      endTime: this.endTime,
      assignedAssistants: { ...this.assignedAssistants },
      menuVariant: this.menuVariant,
      fixedAssistants: { ...this.fixedAssistants },
      ganbare: Object.fromEntries(
        Object.entries(this.ganbare).map(([k, v]) => [k, [...v]])
      ),
      slotTimeOverrides: { ...this.slotTimeOverrides },
      items: this.items ? this.items.map(item => ({ ...item })) : null,
      manualVariantSelection: this.manualVariantSelection,
      autoSwitchedVariant: this.autoSwitchedVariant,
      memo: this.memo
    };
  }

  /**
   * プレーンオブジェクトからReservationインスタンスを復元する
   * @param {Object} data - プレーンオブジェクト
   * @returns {Reservation} Reservationインスタンス
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('無効な予約データです');
    }
    return new Reservation(data);
  }

  /**
   * 結合状態を考慮した実効的なメニュー（Effective Menu）を返す
   * @param {Array<Object>} allMenus - マスターの全メニュー配列
   * @returns {Object|null} 実効的なメニューオブジェクト
   */
  getEffectiveMenu(allMenus) {
    return Reservation.getEffectiveMenu(this, allMenus);
  }

  /**
   * 結合状態を考慮した実効的なメニュー（Effective Menu）を返す（プレーンオブジェクト対応）
   * @param {Object} resData - Reservationインスタンスまたはプレーンオブジェクト
   * @param {Array<Object>} allMenus - マスターの全メニュー配列
   * @returns {Object|null} 実効的なメニューオブジェクト（イミュータブル）
   */
  static getEffectiveMenu(resData, allMenus) {
    const baseMenu = allMenus.find(m => m.id === resData.menuItemId);
    if (!baseMenu) return null;

    if (!resData.items || !Array.isArray(resData.items) || resData.items.length <= 1) {
      return baseMenu; // 結合されていない場合はベースをそのまま返す
    }

    const items = resData.items;
    const combinedName = items.map(item => {
      const m = allMenus.find(x => x.id === item.menuItemId);
      return m ? m.name : '不明';
    }).join(' + ');

    // =========================================================
    // Step 1: 既存の標準マスターメニューへの直接マッピング（正規化）
    // =========================================================
    if (items.length === 2) {
      const id0 = items[0].menuItemId;
      const id1 = items[1].menuItemId;
      const isCut0 = (id0 === 'cut_only' || id0 === 'cut_only_mens');
      const isCut1 = (id1 === 'cut_only' || id1 === 'cut_only_mens');

      // 1. カラー ＋ カット (先カラー)
      if (id0 === 'color_only' && isCut1) {
        const target = allMenus.find(m => m.id === 'cut_color_color_first');
        if (target) {
          const eff = JSON.parse(JSON.stringify(target));
          eff.name = combinedName;
          return eff;
        }
      }

      // 2. カット ＋ カラー (先カット)
      if (isCut0 && id1 === 'color_only') {
        const target = allMenus.find(m => m.id === 'cut_color_cut_first');
        if (target) {
          const eff = JSON.parse(JSON.stringify(target));
          eff.name = combinedName;
          return eff;
        }
      }

      // 3. パーマ ＋ カット (パーマカット PC)
      if ((id0 === 'perm_only' && isCut1) || (isCut0 && id1 === 'perm_only')) {
        const target = allMenus.find(m => m.id === 'perm_cut');
        if (target) {
          const eff = JSON.parse(JSON.stringify(target));
          eff.name = combinedName;
          return eff;
        }
      }

      // 4. 縮毛矯正 ＋ カット (縮毛矯正カット STC)
      if ((id0 === 'straight_only' && isCut1) || (isCut0 && id1 === 'straight_only')) {
        const target = allMenus.find(m => m.id === 'straight_cut');
        if (target) {
          const eff = JSON.parse(JSON.stringify(target));
          eff.name = combinedName;
          return eff;
        }
      }
    }

    // =========================================================
    // Step 2: 動的重複排除＆インテリジェント・スロットマージ
    // =========================================================
    const effectiveMenu = JSON.parse(JSON.stringify(baseMenu));
    effectiveMenu.name = combinedName;
    effectiveMenu.assistantSlots = [];
    effectiveMenu.stylistSlots = [];
    effectiveMenu.duration = 0;

    let currentOffset = 0;
    let prevLastSkill = null; // 直前スロットのスキル種別

    items.forEach((item, itemIdx) => {
      const menuDef = allMenus.find(m => m.id === item.menuItemId);
      if (!menuDef) return;

      const itemSlots = (menuDef.assistantSlots || []).map(s => ({ ...s }));
      const itemStylistSlots = (menuDef.stylistSlots || []).map(s => ({ ...s }));
      let itemDuration = item.duration || menuDef.duration || 30;

      // 直前がシャンプー系で終わっており、かつ今回がトリートメントまたはヘッドスパの場合
      // 直前のシャンプーをトリートメント/スパに置換・昇格（統合）
      if (prevLastSkill === 'shampoo' && (item.menuItemId === 'treatment' || item.menuItemId === 'head_spa')) {
        const targetSkill = item.menuItemId === 'treatment' ? 'treatment' : 'spa';
        if (effectiveMenu.assistantSlots.length > 0) {
          const lastSlot = effectiveMenu.assistantSlots[effectiveMenu.assistantSlots.length - 1];
          if (lastSlot.requiredSkill === 'shampoo') {
            lastSlot.requiredSkill = targetSkill;
            prevLastSkill = targetSkill;
            return; // 別枠としては追加せず、既存シャンプーを昇格させて終了
          }
        }
      }

      // 直前がシャンプー系で終わっており、今回のメニューの先頭がシャンプー（カット前シャンプー等）の場合
      // 先頭の重複シャンプーをスキップし、スロット時間を前倒し
      let skipFirstShampooOffset = 0;
      if (prevLastSkill === 'shampoo' && itemSlots.length > 0 && itemSlots[0].startMinute === 0 && itemSlots[0].requiredSkill === 'shampoo') {
        const skippedSlot = itemSlots.shift(); // 先頭シャンプーを除去
        skipFirstShampooOffset = skippedSlot.endMinute - skippedSlot.startMinute;
        // 先頭シャンプーがなくなった分、後続スロット・スタイリスト枠の開始時間を前倒し
        itemSlots.forEach(s => {
          s.startMinute = Math.max(0, s.startMinute - skipFirstShampooOffset);
          s.endMinute = Math.max(0, s.endMinute - skipFirstShampooOffset);
        });
        itemStylistSlots.forEach(s => {
          s.startMinute = Math.max(0, s.startMinute - skipFirstShampooOffset);
          s.endMinute = Math.max(0, s.endMinute - skipFirstShampooOffset);
        });
        itemDuration = Math.max(30, itemDuration - skipFirstShampooOffset);
      }

      // スロットを offset を加えて追加（5分刻みに丸める）
      itemSlots.forEach(slot => {
        const start = Math.round((slot.startMinute + currentOffset) / 5) * 5;
        const end = Math.round((slot.endMinute + currentOffset) / 5) * 5;
        effectiveMenu.assistantSlots.push({
          ...slot,
          startMinute: start,
          endMinute: end
        });
        prevLastSkill = slot.requiredSkill;
      });

      itemStylistSlots.forEach(slot => {
        const start = Math.round((slot.startMinute + currentOffset) / 5) * 5;
        const end = Math.round((slot.endMinute + currentOffset) / 5) * 5;
        effectiveMenu.stylistSlots.push({
          ...slot,
          startMinute: start,
          endMinute: end
        });
      });

      // 次のアイテムへのオフセット加算
      const roundedDuration = Math.round(itemDuration / 5) * 5;
      currentOffset += roundedDuration;
      effectiveMenu.duration += roundedDuration;
    });

    // 5分Tick正規化
    effectiveMenu.duration = Math.max(30, Math.round(effectiveMenu.duration / 5) * 5);

    return effectiveMenu;
  }
}
