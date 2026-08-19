/**
 * @fileoverview スタッフデータモデル
 * 
 * 美容室のスタッフ（スタイリスト・アシスタント）のデータ構造を定義する。
 * ランク、スキル、出勤状態、休憩管理などを含む。
 * 
 * @module models/staff
 */

/**
 * スタイリストのランク定義
 * @readonly
 * @enum {{ id: string, label: string, priority: number }}
 */
export const RANKS = {
  /** オーナー - 最高ランク */
  OWNER: { id: 'owner', label: 'オーナー', priority: 1 },
  /** トップスタイリスト */
  TOP_STYLIST: { id: 'top_stylist', label: 'トップスタイリスト', priority: 2 },
  /** スタイリスト */
  STYLIST: { id: 'stylist', label: 'スタイリスト', priority: 3 },
  /** ジュニアスタイリスト */
  JUNIOR: { id: 'junior', label: 'ジュニアスタイリスト', priority: 4 }
};

/**
 * ランクID → 優先度数値マッピング（候補者選出ソート用）
 * 数値が大きい方が下位ランク（先に拾われる）
 * @readonly
 * @type {Record<string, number>}
 */
export const RANK_PRIORITY = Object.fromEntries(
  Object.values(RANKS).map(r => [r.id, r.priority])
);

/**
 * ランクIDから優先度数値を取得する（デフォルト: 3 = スタイリスト相当）
 * @param {string|null} rankId - ランクID
 * @returns {number} 優先度数値（1=owner, 2=top_stylist, 3=stylist, 4=junior）
 */
export function getRankPriority(rankId) {
  return RANK_PRIORITY[rankId] ?? 3;
}

/**
 * アシスタントのスキル定義
 * @readonly
 * @enum {{ id: string, label: string }}
 */
export const SKILLS = {
  /** シャンプー技能 */
  SHAMPOO: { id: 'shampoo', label: 'シャンプー' },
  /** カラー技能 */
  COLOR: { id: 'color', label: 'カラー' },
  /** トリートメント技能 */
  TREATMENT: { id: 'treatment', label: 'トリートメント' },
  /** スパ技能 */
  SPA: { id: 'spa', label: 'スパ' }
};

/**
 * ランクIDからランク定義オブジェクトを取得する
 * @param {string} rankId - ランクID（例: 'owner', 'stylist'）
 * @returns {Object|null} ランク定義オブジェクト、見つからない場合はnull
 */
export function getRankById(rankId) {
  if (!rankId || typeof rankId !== 'string') {
    return null;
  }
  const entry = Object.values(RANKS).find(r => r.id === rankId);
  return entry || null;
}

/**
 * スキルIDからスキル定義オブジェクトを取得する
 * @param {string} skillId - スキルID（例: 'shampoo', 'color'）
 * @returns {Object|null} スキル定義オブジェクト、見つからない場合はnull
 */
export function getSkillById(skillId) {
  if (!skillId || typeof skillId !== 'string') {
    return null;
  }
  const entry = Object.values(SKILLS).find(s => s.id === skillId);
  return entry || null;
}

/**
 * 休憩状態のデフォルト値を生成する
 * @returns {{ lunch: { taken: boolean, startTime: number|null }, rest: { taken: boolean, startTime: number|null } }}
 */
export function createDefaultBreaks() {
  return {
    lunch: { taken: false, startTime: null },
    rest: { taken: false, startTime: null }
  };
}

/**
 * スタッフデータモデルクラス
 * 
 * スタイリストおよびアシスタントの両方を表現する統合モデル。
 * typeフィールドで 'stylist' と 'assistant' を区別する。
 */
export class Staff {
  /**
   * スタッフインスタンスを作成する
   * @param {Object} params - スタッフパラメータ
   * @param {string} params.id - UUID形式の一意識別子
   * @param {string} params.name - フルネーム
   * @param {'stylist'|'assistant'} params.type - スタッフ種別
   * @param {string|Object|null} [params.rank] - ランクID文字列（stylistのみ、例: 'owner', 'stylist'）
   * @param {boolean} [params.isWorking=false] - 出勤中かどうか
   * @param {boolean} [params.canDoubleBook=false] - 掛け持ち可否（stylistのみ）
   * @param {Array<{id: string, proficiency: number}>} [params.skills=[]] - スキルと習熟度の配列（assistantのみ）
   * @param {string} [params.joinDate] - 入社日（assistantのみ、ISO 8601形式）
   * @param {Object} [params.breaks] - 休憩状態
   * @param {string[]} [params.holidays] - 休日の日付(YYYY-MM-DD)のリスト
   * @param {string[]} [params.workdays] - 出勤日(月曜など例外的に出勤する日)のリスト
   * @throws {Error} 必須パラメータが不足している場合
   */
  constructor({ id, name, type, rank = null, isWorking = false, canDoubleBook = false, skills = [], joinDate = null, breaks = null, holidays = [], workdays = [], nickname = null, prioritySummon = false, workStartTime = '09:00', workEndTime = '19:00' }) {
    // 必須パラメータのバリデーション
    if (!id) {
      throw new Error('スタッフIDは必須です');
    }
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('スタッフ名は必須です');
    }
    if (!type || (type !== 'stylist' && type !== 'assistant')) {
      throw new Error('スタッフ種別は "stylist" または "assistant" のいずれかを指定してください');
    }

    /** @type {string} UUID */
    this.id = id;

    /** @type {string} フルネーム */
    this.name = name.trim();

    /** @type {'stylist'|'assistant'} スタッフ種別 */
    this.type = type;

    /** @type {string|null} ランクID文字列（stylistのみ有効、例: 'owner', 'stylist'） */
    this.rank = type === 'stylist' ? Staff._normalizeRank(rank) : null;

    /** @type {boolean} 出勤中フラグ */
    this.isWorking = Boolean(isWorking);

    /** @type {boolean} 掛け持ち可否（stylistのみ有効） */
    this.canDoubleBook = type === 'stylist' ? Boolean(canDoubleBook) : false;

    /** @type {Array<{id: string, proficiency: number}>} スキル配列（assistantのみ有効） */
    this.skills = type === 'assistant' ? Staff._normalizeSkills(skills) : [];

    /** @type {string|null} 入社日（assistantのみ有効、ISO 8601形式） */
    this.joinDate = type === 'assistant' ? joinDate : null;

    /** @type {{ lunch: { taken: boolean, startTime: number|null }, rest: { taken: boolean, startTime: number|null } }} 休憩状態 */
    this.breaks = breaks ? { ...breaks } : createDefaultBreaks();

    /** @type {string[]} 休日の日付(YYYY-MM-DD)のリスト */
    this.holidays = Array.isArray(holidays) ? [...holidays] : [];

    /** @type {string[]} 出勤日(月曜など例外的に出勤する日)のリスト */
    this.workdays = Array.isArray(workdays) ? [...workdays] : [];

    /** @type {string|null} ニックネーム（最大4文字、全スタッフ共通） */
    this.nickname = nickname && String(nickname).trim() !== '' ? String(nickname).trim().substring(0, 4) : null;

    /**
     * @type {boolean} 優先召喚フラグ（stylistのみ有効）
     * ONにするとオーナーと同様に非掛け持ち時間帯でも優先的にアシスタントを配置する。
     */
    this.prioritySummon = type === 'stylist' ? Boolean(prioritySummon) : false;

    /** @type {string} 基本出勤開始時刻（"HH:MM" 形式） */
    this.workStartTime = workStartTime || '09:00';

    /** @type {string} 基本退勤時刻（"HH:MM" 形式） */
    this.workEndTime = workEndTime || '19:00';
  }

  /**
   * 指定した日付に出勤しているかどうかを判定する
   * @param {string} dateStr - 'YYYY-MM-DD'形式の日付
   * @returns {boolean}
   */
  isWorkingOn(dateStr) {
    if (!this.isWorking) return false; // 基本フラグがfalseの場合はそもそも休み

    // 個別出勤日なら出勤
    if (this.workdays && this.workdays.includes(dateStr)) return true;
    
    // 個別休日なら休み
    if (this.holidays && this.holidays.includes(dateStr)) return false;

    // デフォルト: 月曜日(1)は休み
    const dateObj = new Date(dateStr);
    if (dateObj.getDay() === 1) return false;

    return true;
  }

  /**
   * スタイリストかどうかを判定する
   * @returns {boolean}
   */
  isStylist() {
    return this.type === 'stylist';
  }

  /**
   * アシスタントかどうかを判定する
   * @returns {boolean}
   */
  isAssistant() {
    return this.type === 'assistant';
  }

  /**
   * 指定スキルの習熟度を取得する
   * @param {string} skillId - スキルID
   * @returns {number} 習熟度（0〜5、スキル未設定の場合は0）
   */
  getProficiency(skillId) {
    if (!this.isAssistant()) {
      return 0;
    }
    const skill = this.skills.find(s => s.id === skillId);
    return skill ? skill.proficiency : 0;
  }

  /**
   * 指定スキルの習熟度を設定する
   * @param {string} skillId - スキルID
   * @param {number} level - 習熟度（1〜5）
   * @throws {Error} 無効な習熟度の場合
   */
  setProficiency(skillId, level) {
    if (!this.isAssistant()) {
      console.warn('スタイリストにスキル習熟度は設定できません');
      return;
    }
    if (typeof level !== 'number' || level < 1 || level > 5) {
      throw new Error('習熟度は1〜5の整数で指定してください');
    }
    const existing = this.skills.find(s => s.id === skillId);
    if (existing) {
      existing.proficiency = Math.round(level);
    } else {
      this.skills.push({ id: skillId, proficiency: Math.round(level) });
    }
  }

  /**
   * 休憩状態をリセットする（日次リセット用）
   */
  resetBreaks() {
    this.breaks = createDefaultBreaks();
  }

  /**
   * 時刻（HH:MM形式またはDate/分）が勤務時間内かどうかを判定する
   * @param {string|number|Date} time - "HH:MM" 形式文字列、0:00からの経過分数、または Date オブジェクト
   * @returns {boolean}
   */
  isWorkingAtTime(time) {
    if (!this.isWorking) return false;

    const startParts = (this.workStartTime || '09:00').split(':');
    const startMin = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);

    const endParts = (this.workEndTime || '19:00').split(':');
    const endMin = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

    let targetMinute = 0;
    if (typeof time === 'number') {
      // 0〜540未満の相対分数(9:00基準: 0=9:00)の場合、0:00からの通算分数(+startMin)に変換
      if (time < startMin) {
        targetMinute = time + startMin;
      } else {
        targetMinute = time;
      }
    } else if (typeof time === 'string' && time.includes(':')) {
      const parts = time.split(':');
      targetMinute = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    } else if (time instanceof Date) {
      targetMinute = time.getHours() * 60 + time.getMinutes();
    } else {
      return false;
    }

    return targetMinute >= startMin && targetMinute < endMin;
  }

  /**
   * プレーンオブジェクトに変換する（シリアライズ用）
   * @returns {Object} プレーンオブジェクト
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      nickname: this.nickname,
      type: this.type,
      rank: this.rank,
      isWorking: this.isWorking,
      canDoubleBook: this.canDoubleBook,
      prioritySummon: this.prioritySummon,
      workStartTime: this.workStartTime,
      workEndTime: this.workEndTime,
      skills: this.skills.map(s => ({ ...s })),
      joinDate: this.joinDate,
      breaks: JSON.parse(JSON.stringify(this.breaks)),
      holidays: [...this.holidays],
      workdays: [...this.workdays]
    };
  }

  /**
   * プレーンオブジェクトからStaffインスタンスを復元する
   * @param {Object} data - プレーンオブジェクト
   * @returns {Staff} Staffインスタンス
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('無効なスタッフデータです');
    }
    return new Staff(data);
  }

  /**
   * ランク情報オブジェクトを取得する
   * @returns {Object|null} RANKSのいずれか、またはnull
   */
  getRankInfo() {
    if (!this.rank) return null;
    return getRankById(this.rank);
  }

  /**
   * rank パラメータを文字列IDに正規化する
   * @param {string|Object|null} rank - ランク（文字列ID or RANKSオブジェクト or null）
   * @returns {string} ランクID文字列
   * @private
   */
  static _normalizeRank(rank) {
    if (!rank) return RANKS.STYLIST.id;
    if (typeof rank === 'string') return rank;
    if (typeof rank === 'object' && rank.id) return rank.id;
    return RANKS.STYLIST.id;
  }

  /**
   * skills パラメータを配列形式に正規化する
   * @param {Array|Object} skills - スキル（配列 or オブジェクトマップ）
   * @returns {Array<{id: string, proficiency: number}>}
   * @private
   */
  static _normalizeSkills(skills) {
    if (Array.isArray(skills)) {
      return skills.map(s => {
        if (typeof s === 'object' && s.id) return { id: s.id, proficiency: s.proficiency || 1 };
        if (typeof s === 'string') return { id: s, proficiency: 1 };
        return s;
      });
    }
    if (skills && typeof skills === 'object') {
      // Object<string, number> 形式からの変換
      return Object.entries(skills).map(([id, proficiency]) => ({
        id,
        proficiency: typeof proficiency === 'number' ? proficiency : 1
      }));
    }
    return [];
  }
}
