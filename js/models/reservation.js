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
  constructor({ id, menuItemId, stylistId, startTime, endTime, assignedAssistants = {}, menuVariant = '', fixedAssistants = {}, nonOverlapSummonEnabled = true, slotTimeOverrides = {}, items = null, manualVariantSelection = false, autoSwitchedVariant = false }) {
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

    /**
     * @type {boolean} 非掛け持ち時間帯のアシスタント自動配置の有効・無効
     * falseにすると、掛け持ちしていない時間帯でのアシスタント自動配置をスキップする。
     */
    this.nonOverlapSummonEnabled = nonOverlapSummonEnabled !== false;

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
      nonOverlapSummonEnabled: this.nonOverlapSummonEnabled,
      slotTimeOverrides: { ...this.slotTimeOverrides },
      items: this.items ? this.items.map(item => ({ ...item })) : null,
      manualVariantSelection: this.manualVariantSelection,
      autoSwitchedVariant: this.autoSwitchedVariant
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
    if (!resData || !allMenus) return null;
    
    const baseMenu = allMenus.find(m => m.id === resData.menuItemId);
    if (!baseMenu) return null;

    if (!resData.items || !Array.isArray(resData.items) || resData.items.length <= 1) {
      return baseMenu; // 結合されていない場合はベースをそのまま返す
    }

    // 対象メニューと置換用スキルのマッピング
    const replacementMap = {
      'treatment': 'treatment',
      'head_spa': 'spa'
    };
    
    // 置き換え対象のベーススキル
    const replaceableSkills = ['shampoo', 'straight_2', 'perm_liquid'];

    // 純粋関数とするため、ディープコピー（JSONシリアライズ/デシリアライズ）
    const effectiveMenu = JSON.parse(JSON.stringify(baseMenu));

    // items に含まれる「ベースメニュー以外」の追加メニューを収集
    const additionalItems = resData.items.filter(item => item.menuItemId !== resData.menuItemId);

    if (additionalItems.length === 0) {
      return effectiveMenu;
    }

    let hasReplaced = false;

    // 複数の追加メニューがある場合の処理
    additionalItems.forEach((addedItem) => {
      const addedMenuId = addedItem.menuItemId;
      const targetSkill = replacementMap[addedMenuId];
      
      if (!targetSkill) {
        // トリートメントやスパ以外のメニューが追加された場合は何もしない
        return;
      }

      if (!hasReplaced) {
        // 1つ目の対象追加メニュー：ベースのシャンプー等を置き換え
        let replacedAny = false;
        effectiveMenu.assistantSlots.forEach(slot => {
          if (replaceableSkills.includes(slot.requiredSkill)) {
            slot.requiredSkill = targetSkill;
            replacedAny = true;
          }
        });
        if (replacedAny) {
          hasReplaced = true;
        } else {
          // もしベースに置き換え対象のスキルがなかった場合は、新規スロットとして追加へフォールバック
          addNewSlot(effectiveMenu, addedMenuId, targetSkill, allMenus);
        }
      } else {
        // 2つ目以降の対象追加メニュー：スロットを新規追加（時間は後ろにずらす）
        addNewSlot(effectiveMenu, addedMenuId, targetSkill, allMenus);
      }
    });

    return effectiveMenu;

    // ヘルパー: スロットの新規追加（時間が被らないように後ろにずらす）
    function addNewSlot(menu, addedMenuId, targetSkill, menusDef) {
      const addedMenuDef = menusDef.find(m => m.id === addedMenuId);
      const addedSlotDuration = addedMenuDef?.assistantSlots?.[0] 
        ? (addedMenuDef.assistantSlots[0].endMinute - addedMenuDef.assistantSlots[0].startMinute) 
        : 30; // フォールバック
      
      let newStart = 0;
      if (menu.assistantSlots && menu.assistantSlots.length > 0) {
        // 既存スロットの最後尾を取得
        const lastSlot = menu.assistantSlots[menu.assistantSlots.length - 1];
        newStart = lastSlot.endMinute;
      }
      
      if (!menu.assistantSlots) menu.assistantSlots = [];
      menu.assistantSlots.push({
        startMinute: newStart,
        endMinute: newStart + addedSlotDuration,
        requiredSkill: targetSkill,
        requiredProficiency: 3
      });
    }
  }
}
