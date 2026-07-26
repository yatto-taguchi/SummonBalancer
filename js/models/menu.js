/**
 * @fileoverview メニューデータモデル
 * 
 * 美容室の施術メニューとアシスタントスロット（施術工程）のデータ構造を定義する。
 * 各メニューは複数のアシスタントスロットを持ち、各スロットで必要なスキルと
 * 時間帯を指定する。
 * 
 * @module models/menu
 */

/**
 * アシスタントスロット（施術工程）モデルクラス
 * 
 * 施術中のある時間帯に必要なアシスタント作業を定義する。
 * 例: 施術開始から0分〜20分のシャンプー工程
 */
export class AssistantSlot {
  /**
   * アシスタントスロットインスタンスを作成する
   * @param {Object} params - スロットパラメータ
   * @param {number} params.startMinute - 施術開始から何分後に開始
   * @param {number} params.endMinute - 施術開始から何分後に終了
   * @param {string} params.requiredSkill - 必要スキルID
   * @param {number} [params.requiredProficiency=3] - 必要習熟度（1〜5）
   * @throws {Error} 無効なパラメータの場合
   */
  constructor({ startMinute, endMinute, requiredSkill, requiredProficiency = 3 }) {
    // バリデーション
    if (typeof startMinute !== 'number' || startMinute < 0) {
      throw new Error('開始分は0以上の数値で指定してください');
    }
    if (typeof endMinute !== 'number' || endMinute <= startMinute) {
      throw new Error('終了分は開始分より大きい数値で指定してください');
    }
    if (!requiredSkill || typeof requiredSkill !== 'string') {
      throw new Error('必要スキルIDは必須です');
    }
    if (typeof requiredProficiency !== 'number' || requiredProficiency < 1 || requiredProficiency > 5) {
      throw new Error('必要習熟度は1〜5の数値で指定してください');
    }

    /** @type {number} 施術開始からの開始分 */
    this.startMinute = startMinute;

    /** @type {number} 施術開始からの終了分 */
    this.endMinute = endMinute;

    /** @type {string} 必要スキルID */
    this.requiredSkill = requiredSkill;

    /** @type {number} 必要習熟度（1〜5、デフォルト3） */
    this.requiredProficiency = Math.round(requiredProficiency);
  }

  /**
   * このスロットの所要時間を返す（分）
   * @returns {number} 所要時間（分）
   */
  getDuration() {
    return this.endMinute - this.startMinute;
  }

  /**
   * プレーンオブジェクトに変換する（シリアライズ用）
   * @returns {Object} プレーンオブジェクト
   */
  toJSON() {
    return {
      startMinute: this.startMinute,
      endMinute: this.endMinute,
      requiredSkill: this.requiredSkill,
      requiredProficiency: this.requiredProficiency
    };
  }

  /**
   * プレーンオブジェクトからAssistantSlotインスタンスを復元する
   * @param {Object} data - プレーンオブジェクト
   * @returns {AssistantSlot} AssistantSlotインスタンス
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('無効なアシスタントスロットデータです');
    }
    return new AssistantSlot(data);
  }
}

/**
 * メニューアイテムモデルクラス
 * 
 * 美容室の施術メニューを表現する。
 * カット、カラー、トリートメントなどの各メニューは、
 * 必要時間と複数のアシスタントスロットを持つ。
 */
export class MenuItem {
  /**
   * メニューアイテムインスタンスを作成する
   * @param {Object} params - メニューパラメータ
   * @param {string} params.id - メニューの一意識別子
   * @param {string} params.name - メニュー名（例: "カットカラー（先カット）"）
   * @param {string} params.shortName - 略称（ボタン表示用、例: "C", "CH"）
   * @param {number} params.duration - 必要時間（分）
   * @param {Array<Object|AssistantSlot>} [params.assistantSlots=[]] - アシスタントスロットの配列
   * @param {string} [params.colorCode='#6366f1'] - 表示色（HEX形式）
   * @throws {Error} 必須パラメータが不足している場合
   */
  constructor({ id, name, shortName, duration, assistantSlots = [], colorCode = '#6366f1' }) {
    // 必須パラメータのバリデーション
    if (!id || typeof id !== 'string') {
      throw new Error('メニューIDは必須です');
    }
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('メニュー名は必須です');
    }
    if (!shortName || typeof shortName !== 'string') {
      throw new Error('略称は必須です');
    }
    if (typeof duration !== 'number' || duration <= 0) {
      throw new Error('必要時間は正の数値で指定してください');
    }

    /** @type {string} メニューID */
    this.id = id;

    /** @type {string} メニュー名 */
    this.name = name.trim();

    /** @type {string} 略称（ボタン表示用） */
    this.shortName = shortName.trim();

    /** @type {number} 必要時間（分） */
    this.duration = duration;

    /** @type {AssistantSlot[]} アシスタントスロットの配列 */
    this.assistantSlots = (assistantSlots || []).map(slot => {
      if (slot instanceof AssistantSlot) {
        return slot;
      }
      try {
        return AssistantSlot.fromJSON(slot);
      } catch (error) {
        console.error(`アシスタントスロットの変換に失敗しました: ${error.message}`, slot);
        return null;
      }
    }).filter(slot => slot !== null);

    /** @type {string} 表示色（HEX形式） */
    this.colorCode = colorCode;
  }

  /**
   * 30分セルに換算したブロック数を返す
   * @returns {number} 30分セル数
   */
  getCellSpan() {
    return Math.ceil(this.duration / 30);
  }

  /**
   * アシスタントスロット数を返す
   * @returns {number} スロット数
   */
  getSlotCount() {
    return this.assistantSlots.length;
  }

  /**
   * 指定時間に必要なアシスタントスロットを取得する
   * @param {number} minuteFromStart - 施術開始からの経過分
   * @returns {AssistantSlot[]} 該当するアシスタントスロットの配列
   */
  getActiveSlots(minuteFromStart) {
    if (typeof minuteFromStart !== 'number' || minuteFromStart < 0) {
      return [];
    }
    return this.assistantSlots.filter(
      slot => minuteFromStart >= slot.startMinute && minuteFromStart < slot.endMinute
    );
  }

  /**
   * プレーンオブジェクトに変換する（シリアライズ用）
   * @returns {Object} プレーンオブジェクト
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      shortName: this.shortName,
      duration: this.duration,
      assistantSlots: this.assistantSlots.map(slot => slot.toJSON()),
      colorCode: this.colorCode
    };
  }

  /**
   * プレーンオブジェクトからMenuItemインスタンスを復元する
   * @param {Object} data - プレーンオブジェクト
   * @returns {MenuItem} MenuItemインスタンス
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('無効なメニューデータです');
    }
    return new MenuItem(data);
  }
}
