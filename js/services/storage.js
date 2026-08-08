/**
 * @fileoverview LocalStorageベースのデータ永続化サービス
 * 
 * アプリケーションの全データ（スタイリスト、アシスタント、メニュー、予約、
 * スキル、設定）をLocalStorageで管理する。
 * 初回起動時にはdefaults.jsonからデフォルトデータを投入する。
 * 
 * @module services/storage
 */

import { Staff } from '../models/staff.js?v=14';
import { MenuItem } from '../models/menu.js';
import { Reservation } from '../models/reservation.js';

// ──────────────────────────────────────────────
// ストレージキー定数
// ──────────────────────────────────────────────

/** @constant {string} スタイリストリストのストレージキー */
const KEY_STYLISTS = 'sb_stylists';

/** @constant {string} アシスタントリストのストレージキー */
const KEY_ASSISTANTS = 'sb_assistants';

/** @constant {string} メニューリストのストレージキー */
const KEY_MENUS = 'sb_menus';

/** @constant {string} 予約リストのストレージキープレフィックス */
const KEY_RESERVATIONS_PREFIX = 'sb_reservations_';

/** @constant {string} SOSリストのストレージキープレフィックス */
const KEY_SOS_PREFIX = 'sb_sos_';

/** @constant {string} スキルリストのストレージキー */
const KEY_SKILLS = 'sb_skills';

/** @constant {string} アプリ設定のストレージキー */
const KEY_SETTINGS = 'sb_settings';

/** @constant {string} 初期化済みフラグのストレージキー */
const KEY_INITIALIZED = 'sb_initialized';

// ──────────────────────────────────────────────
// 汎用データ操作
// ──────────────────────────────────────────────

/**
 * LocalStorageにデータを保存する
 * @param {string} key - ストレージキー
 * @param {*} data - 保存するデータ（JSON.stringifyで変換可能なもの）
 * @throws {Error} 保存に失敗した場合
 */
export function saveData(key, data) {
  try {
    const serialized = JSON.stringify(data);
    localStorage.setItem(key, serialized);
    // サーバーにも非同期で保存（ローカルネット共有用）
    _syncToServer(key, data);
  } catch (error) {
    console.error(`データの保存に失敗しました (key: ${key}):`, error);
    if (error.name === 'QuotaExceededError') {
      throw new Error('LocalStorageの容量が不足しています。不要なデータを削除してください。');
    }
    throw new Error(`データの保存に失敗しました: ${error.message}`);
  }
}

/**
 * LocalStorageからデータを読み込む
 * @param {string} key - ストレージキー
 * @returns {*} パースされたデータ、存在しない場合はnull
 */
export function loadData(key) {
  try {
    const serialized = localStorage.getItem(key);
    if (serialized === null) {
      return null;
    }
    return JSON.parse(serialized);
  } catch (error) {
    console.error(`データの読み込みに失敗しました (key: ${key}):`, error);
    return null;
  }
}

/**
 * LocalStorageからデータを削除する
 * @param {string} key - ストレージキー
 */
export function removeData(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`データの削除に失敗しました (key: ${key}):`, error);
  }
}

// ──────────────────────────────────────────────
// スタイリスト管理
// ──────────────────────────────────────────────

/**
 * スタイリストを保存する（新規追加または更新）
 * @param {Staff} stylist - スタイリストオブジェクト
 */
export function saveStylist(stylist) {
  const stylists = loadStylists();
  const index = stylists.findIndex(s => s.id === stylist.id);
  const data = stylist instanceof Staff ? stylist.toJSON() : stylist;

  if (index >= 0) {
    stylists[index] = data;
  } else {
    stylists.push(data);
  }

  saveData(KEY_STYLISTS, stylists);
}

/**
 * 全スタイリストを読み込む
 * @returns {Staff[]} スタイリストの配列
 */
export function loadStylists() {
  const data = loadData(KEY_STYLISTS);
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(item => {
    try {
      return Staff.fromJSON(item);
    } catch (error) {
      console.warn('スタイリストデータの復元に失敗:', error.message, item);
      return null;
    }
  }).filter(s => s !== null);
}

/**
 * 全スタイリストリストを保存する
 * @param {import('../models/staff.js').Staff[]} stylists
 */
export function saveStylists(stylists) {
  saveData(KEY_STYLISTS, stylists.map(s => s.toJSON()));
}

/**
 * スタイリストを削除する
 * @param {string} id - スタイリストID
 */
export function deleteStylist(id) {
  const stylists = loadStylists();
  const filtered = stylists.filter(s => s.id !== id);
  saveData(KEY_STYLISTS, filtered.map(s => s.toJSON()));
}

// ──────────────────────────────────────────────
// アシスタント管理
// ──────────────────────────────────────────────

/**
 * アシスタントを保存する（新規追加または更新）
 * @param {Staff} assistant - アシスタントオブジェクト
 */
export function saveAssistant(assistant) {
  const assistants = loadAssistants();
  const index = assistants.findIndex(a => a.id === assistant.id);
  const data = assistant instanceof Staff ? assistant.toJSON() : assistant;

  if (index >= 0) {
    assistants[index] = data;
  } else {
    assistants.push(data);
  }

  saveData(KEY_ASSISTANTS, assistants);
}

/**
 * 全アシスタントを読み込む
 * @returns {Staff[]} アシスタントの配列
 */
export function loadAssistants() {
  const data = loadData(KEY_ASSISTANTS);
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(item => {
    try {
      return Staff.fromJSON(item);
    } catch (error) {
      console.warn('アシスタントデータの復元に失敗:', error.message, item);
      return null;
    }
  }).filter(a => a !== null);
}

/**
 * 全アシスタントリストを保存する
 * @param {import('../models/staff.js').Staff[]} assistants
 */
export function saveAssistants(assistants) {
  saveData(KEY_ASSISTANTS, assistants.map(a => a.toJSON()));
}

/**
 * アシスタントを削除する
 * @param {string} id - アシスタントID
 */
export function deleteAssistant(id) {
  const assistants = loadAssistants();
  const filtered = assistants.filter(a => a.id !== id);
  saveData(KEY_ASSISTANTS, filtered.map(a => a.toJSON()));
}

// ──────────────────────────────────────────────
// メニュー管理
// ──────────────────────────────────────────────

/**
 * メニューを保存する（新規追加または更新）
 * @param {MenuItem} menu - メニューアイテムオブジェクト
 */
export function saveMenu(menu) {
  const menus = loadMenus();
  const index = menus.findIndex(m => m.id === menu.id);
  const data = menu instanceof MenuItem ? menu.toJSON() : menu;

  if (index >= 0) {
    menus[index] = data;
  } else {
    menus.push(data);
  }

  saveData(KEY_MENUS, menus);
}

/**
 * 全メニューを読み込む
 * @returns {MenuItem[]} メニューアイテムの配列
 */
export function loadMenus() {
  let data = loadData(KEY_MENUS);
  if (!Array.isArray(data)) {
    data = [];
  }

  // デフォルト追加メニューの自動補完
  const defaultMenus = [
    {
      id: "front_cut",
      name: "フロントカット",
      shortName: "FC",
      duration: 10,
      colorCode: "#6366f1",
      assistantSlots: [],
      stylistSlots: [
        { startMinute: 0, endMinute: 10, type: "cut" }
      ]
    },
    {
      id: "head_spa",
      name: "ヘッドスパ",
      shortName: "HS",
      duration: 30,
      colorCode: "#10b981",
      assistantSlots: [
        { startMinute: 0, endMinute: 30, requiredSkill: "spa", requiredProficiency: 3 }
      ]
    },
    {
      id: "other",
      name: "その他",
      shortName: "OTH",
      duration: 30,
      colorCode: "#6b7280",
      assistantSlots: [
        { startMinute: 0, endMinute: 30, requiredSkill: "shampoo", requiredProficiency: 3 }
      ]
    },
    {
      id: "highlight",
      name: "ハイライト",
      shortName: "HL",
      duration: 150,
      colorCode: "#ec4899",
      assistantSlots: [
        { startMinute: 0, endMinute: 60, requiredSkill: "color", requiredProficiency: 3 },
        { startMinute: 80, endMinute: 100, requiredSkill: "shampoo", requiredProficiency: 3 },
        { startMinute: 100, endMinute: 120, requiredSkill: "color", requiredProficiency: 3 },
        { startMinute: 130, endMinute: 150, requiredSkill: "shampoo", requiredProficiency: 3 }
      ]
    }
  ];

  let isUpdated = false;
  const existingIds = new Set(data.map(m => m.id));
  for (const defMenu of defaultMenus) {
    if (!existingIds.has(defMenu.id)) {
      data.push(defMenu);
      isUpdated = true;
    }
  }
  if (isUpdated) {
    saveData(KEY_MENUS, data);
  }

  const loaded = data.map(item => {
    try {
      if (item && item.id) {
        if (item.id === 'treatment') item.shortName = 'Tr';
        if (item.id === 'straight_cut') item.shortName = 'STC';
        if (item.id === 'straight_only') item.shortName = 'ST';
        if (item.id === 'head_spa') item.shortName = 'Spa';
      }
      if (item && item.name) {
        if (item.name.includes('カラー') || item.name.includes('ハイライト')) {
          item.colorCode = '#ec4899';
        } else if (item.name.includes('パーマ')) {
          item.colorCode = '#f59e0b';
        } else if (item.name.includes('スパ') || item.name.includes('ヘッドスパ')) {
          item.colorCode = '#10b981';
        } else if (item.name.includes('その他')) {
          item.colorCode = '#6b7280';
        }
      }
      return MenuItem.fromJSON(item);
    } catch (error) {
      console.warn('メニューデータの復元に失敗:', error.message, item);
      return null;
    }
  }).filter(m => m !== null);

  const getMenuColorGroupOrder = (menu) => {
    const name = menu.name || '';
    if (name.includes('カットのみ') || name.includes('フロントカット')) return 1;
    if (name.includes('カラー') || name.includes('ハイライト')) return 2;
    if (name.includes('トリートメント') || name.includes('スパ') || name.includes('ヘッドスパ')) return 3;
    if (name.includes('パーマ')) return 4;
    if (name.includes('縮毛') || name.includes('ストレート')) return 5;
    if (name.includes('その他')) return 6;
    return 99;
  };

  return loaded.sort((a, b) => getMenuColorGroupOrder(a) - getMenuColorGroupOrder(b));
}

/**
 * メニューを削除する
 * @param {string} id - メニューID
 */
export function deleteMenu(id) {
  const menus = loadMenus();
  const filtered = menus.filter(m => m.id !== id);
  saveData(KEY_MENUS, filtered.map(m => m.toJSON()));
}

// ──────────────────────────────────────────────
// 予約管理（日別）
// ──────────────────────────────────────────────

/**
 * 日付文字列から予約ストレージキーを生成する
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @returns {string} ストレージキー
 */
function getReservationKey(date) {
  return `${KEY_RESERVATIONS_PREFIX}${date}`;
}

/**
 * 予約を保存する（新規追加または更新）
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @param {Reservation} reservation - 予約オブジェクト
 */
export function saveReservation(date, reservation) {
  if (!date || typeof date !== 'string') {
    throw new Error('日付は "YYYY-MM-DD" 形式で指定してください');
  }

  const reservations = loadReservations(date);
  const index = reservations.findIndex(r => r.id === reservation.id);
  const data = reservation instanceof Reservation ? reservation.toJSON() : reservation;

  if (index >= 0) {
    reservations[index] = data;
  } else {
    reservations.push(data);
  }

  saveData(getReservationKey(date), reservations);
}

/**
 * 指定日の全予約を読み込む
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @returns {Reservation[]} 予約の配列
 */
export function loadReservations(date) {
  if (!date || typeof date !== 'string') {
    return [];
  }

  const data = loadData(getReservationKey(date));
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(item => {
    try {
      return Reservation.fromJSON(item);
    } catch (error) {
      console.warn('予約データの復元に失敗:', error.message, item);
      return null;
    }
  }).filter(r => r !== null);
}

/**
 * 予約を削除する
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @param {string} id - 予約ID
 */
export function deleteReservation(date, id) {
  const reservations = loadReservations(date);
  const filtered = reservations.filter(r => r.id !== id);
  saveData(getReservationKey(date), filtered.map(r => r.toJSON()));
}

// ──────────────────────────────────────────────
// SOS管理（日別）
// ──────────────────────────────────────────────

/**
 * 日付文字列からSOSストレージキーを生成する
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @returns {string} ストレージキー
 */
function getSOSKey(date) {
  return `${KEY_SOS_PREFIX}${date}`;
}

/**
 * SOS要請を保存する
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @param {Object} sos - SOSオブジェクト { id, reservationId, stylistName, startTime, endTime }
 */
export function saveSOSRequest(date, sos) {
  if (!date || typeof date !== 'string') {
    throw new Error('日付は "YYYY-MM-DD" 形式で指定してください');
  }

  const sosList = loadSOSRequests(date);
  const index = sosList.findIndex(s => s.id === sos.id);

  if (index >= 0) {
    sosList[index] = sos;
  } else {
    sosList.push(sos);
  }

  saveData(getSOSKey(date), sosList);
}

/**
 * 指定日の全SOSを読み込む
 * @param {string} date - 日付文字列（YYYY-MM-DD形式）
 * @returns {Object[]} SOSの配列
 */
export function loadSOSRequests(date) {
  if (!date || typeof date !== 'string') {
    return [];
  }

  const data = loadData(getSOSKey(date));
  if (!Array.isArray(data)) {
    return [];
  }
  return data;
}

// ──────────────────────────────────────────────
// スキル管理
// ──────────────────────────────────────────────

/**
 * スキルリストを保存する
 * @param {Array<{ id: string, label: string }>} skills - スキルの配列
 */
export function saveSkills(skills) {
  if (!Array.isArray(skills)) {
    throw new Error('スキルリストは配列で指定してください');
  }
  saveData(KEY_SKILLS, skills);
}

/**
 * スキルリストを読み込む
 * @returns {Array<{ id: string, label: string }>} スキルの配列
 */
export function loadSkills() {
  let data = loadData(KEY_SKILLS);
  if (!Array.isArray(data)) {
    data = [];
  }
  if (!data.some(s => s.id === 'spa')) {
    data.push({ id: 'spa', label: 'スパ' });
    saveData(KEY_SKILLS, data);
  }
  return data;
}

// ──────────────────────────────────────────────
// 設定管理
// ──────────────────────────────────────────────

/**
 * アプリ設定を保存する
 * @param {Object} settings - 設定オブジェクト
 */
export function saveSettings(settings) {
  saveData(KEY_SETTINGS, settings);
}

/**
 * アプリ設定を読み込む
 * @returns {Object} 設定オブジェクト
 */
export function loadSettings() {
  return loadData(KEY_SETTINGS) || {};
}

// ──────────────────────────────────────────────
// 初期化
// ──────────────────────────────────────────────

/**
 * デフォルトデータを投入する（初回起動時のみ）
 * 
 * defaults.jsonからスキルとメニューのデフォルトデータを読み込み、
 * LocalStorageに保存する。すでに初期化済みの場合は何もしない。
 * 
 * @returns {Promise<boolean>} 初期化が実行された場合true
 */
export async function initializeDefaults() {
  // すでに初期化済みの場合はスキップ
  const initialized = loadData(KEY_INITIALIZED);
  if (initialized) {
    console.info('ストレージは初期化済みです');
    return false;
  }

  try {
    // defaults.jsonを読み込む
    const response = await fetch('./data/defaults.json');
    if (!response.ok) {
      throw new Error(`defaults.jsonの読み込みに失敗しました: ${response.status} ${response.statusText}`);
    }

    const defaults = await response.json();

    // スキルデータの投入
    if (Array.isArray(defaults.skills) && defaults.skills.length > 0) {
      saveSkills(defaults.skills);
      console.info(`${defaults.skills.length}件のスキルをデフォルト投入しました`);
    }

    // メニューデータの投入
    if (Array.isArray(defaults.menus) && defaults.menus.length > 0) {
      const menuItems = defaults.menus.map(m => {
        try {
          return new MenuItem(m).toJSON();
        } catch (error) {
          console.warn('デフォルトメニューの変換に失敗:', error.message, m);
          return null;
        }
      }).filter(m => m !== null);

      saveData(KEY_MENUS, menuItems);
      console.info(`${menuItems.length}件のメニューをデフォルト投入しました`);
    }

    // 空のスタイリスト・アシスタントリストを初期化
    if (!loadData(KEY_STYLISTS)) {
      saveData(KEY_STYLISTS, []);
    }
    if (!loadData(KEY_ASSISTANTS)) {
      saveData(KEY_ASSISTANTS, []);
    }

    // 初期化済みフラグを設定
    saveData(KEY_INITIALIZED, true);
    console.info('ストレージの初期化が完了しました');

    return true;
  } catch (error) {
    console.error('デフォルトデータの初期化に失敗しました:', error);

    // フォールバック: 最低限の空データを投入
    if (!loadData(KEY_SKILLS)) {
      saveSkills([
        { id: 'shampoo', label: 'シャンプー' },
        { id: 'color', label: 'カラー' },
        { id: 'treatment', label: 'トリートメント' }
      ]);
    }
    if (!loadData(KEY_MENUS)) {
      saveData(KEY_MENUS, []);
    }
    if (!loadData(KEY_STYLISTS)) {
      saveData(KEY_STYLISTS, []);
    }
    if (!loadData(KEY_ASSISTANTS)) {
      saveData(KEY_ASSISTANTS, []);
    }

    saveData(KEY_INITIALIZED, true);
    return true;
  }
}

/**
 * defaults.jsonからスキルとメニューを強制的に再インポートする。
 * すでに初期化済みの場合でも既存データを上書きする。
 * （新メニュー追加時などに使用）
 * @returns {Promise<{skills: number, menus: number}>} インポートした件数
 */
export async function importMenusFromDefaults() {
  const response = await fetch('./data/defaults.json');
  if (!response.ok) {
    throw new Error(`defaults.jsonの読み込みに失敗: ${response.status}`);
  }
  const defaults = await response.json();

  // スキル: 既存にない場合のみ追加（既存のカスタムスキルは保持）
  const existingSkills = loadData('sb_skills') || [];
  const existingSkillIds = new Set(existingSkills.map(s => s.id));
  let addedSkills = 0;
  if (Array.isArray(defaults.skills)) {
    defaults.skills.forEach(s => {
      if (!existingSkillIds.has(s.id)) {
        existingSkills.push(s);
        addedSkills++;
      }
    });
    saveSkills(existingSkills);
  }

  // メニュー: 既存にないIDのみ追加、既存メニューは保持しつつ未定義フィールドを補完
  const existingMenus = loadData(KEY_MENUS) || [];
  const existingMenuIds = new Set(existingMenus.map(m => m.id));
  let addedMenus = 0;
  let updatedMenus = false;
  if (Array.isArray(defaults.menus)) {
    defaults.menus.forEach(m => {
      if (!existingMenuIds.has(m.id)) {
        try {
          existingMenus.push(new MenuItem(m).toJSON());
          addedMenus++;
          updatedMenus = true;
        } catch (e) {
          console.warn('メニューの変換に失敗:', e.message, m);
        }
      } else {
        // 既存メニューへのマイグレーション（stylistSlotsの補完）
        const existing = existingMenus.find(x => x.id === m.id);
        if (existing && (!existing.stylistSlots || existing.stylistSlots.length === 0) && m.stylistSlots && m.stylistSlots.length > 0) {
          existing.stylistSlots = m.stylistSlots;
          updatedMenus = true;
        }
      }
    });
    if (updatedMenus) {
      saveData(KEY_MENUS, existingMenus);
    }
  }

  console.info(`スキル ${addedSkills}件、メニュー ${addedMenus}件を追加しました`);
  return { skills: addedSkills, menus: addedMenus };
}

/**
 * 日付別のお昼ご飯手動配置を読み込む
 * @param {string} dateStr - 日付文字列
 * @returns {Object} staffId -> startTimeOffset のマップ
 */
export function loadLunchOverrides(dateStr) {
  const data = localStorage.getItem(`lunch_overrides_${dateStr}`);
  return data ? JSON.parse(data) : {};
}

/**
 * 日付別のお昼ご飯手動配置を保存する
 * @param {string} dateStr - 日付文字列
 * @param {string} staffId - スタッフID
 * @param {number} startTimeOffset - 開始時刻（分）
 */
export function saveLunchOverride(dateStr, staffId, startTimeOffset) {
  const overrides = loadLunchOverrides(dateStr);
  overrides[staffId] = startTimeOffset;
  localStorage.setItem(`lunch_overrides_${dateStr}`, JSON.stringify(overrides));
}

/**
 * 日付別のお昼ご飯手動配置をクリアする
 * @param {string} dateStr - 日付文字列
 */
export function clearLunchOverrides(dateStr) {
  localStorage.removeItem(`lunch_overrides_${dateStr}`);
}

// ──────────────────────────────────────────────
// 空き時間選択管理
// ──────────────────────────────────────────────

/** @constant {string} 空き時間選択のストレージキープレフィックス */
const KEY_FREE_TIME_SELECTIONS_PREFIX = 'sb_free_time_selections_';

/**
 * 日付別の空き時間選択を読み込む
 * @param {string} dateStr - 日付文字列 (YYYY-MM-DD)
 * @returns {Object.<string, {type: string, detail?: string}>} staffId-startMinutes → 選択内容
 */
export function loadFreeTimeSelections(dateStr) {
  const raw = localStorage.getItem(`${KEY_FREE_TIME_SELECTIONS_PREFIX}${dateStr}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 日付別の空き時間選択を保存する
 * @param {string} dateStr - 日付文字列 (YYYY-MM-DD)
 * @param {Object.<string, {type: string, detail?: string}>} selections - 選択データ
 */
export function saveFreeTimeSelections(dateStr, selections) {
  localStorage.setItem(`${KEY_FREE_TIME_SELECTIONS_PREFIX}${dateStr}`, JSON.stringify(selections));
}

// ──────────────────────────────────────────────
// 休憩オーバーライド管理
// ──────────────────────────────────────────────

/**
 * 日付別の休憩オーバーライドを読み込む
 * @param {string} dateStr - 日付文字列 (YYYY-MM-DD)
 * @returns {Object.<string, number>} staffId → 休憩開始分オフセット
 */
export function loadRestOverrides(dateStr) {
  const data = localStorage.getItem(`rest_overrides_${dateStr}`);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * 日付別の休憩オーバーライドを保存する
 * @param {string} dateStr - 日付文字列 (YYYY-MM-DD)
 * @param {string} staffId - スタッフID
 * @param {number} startTimeOffset - 休憩開始の分オフセット (9:00基準)
 */
export function saveRestOverride(dateStr, staffId, startTimeOffset) {
  const overrides = loadRestOverrides(dateStr);
  overrides[staffId] = startTimeOffset;
  localStorage.setItem(`rest_overrides_${dateStr}`, JSON.stringify(overrides));
}

/**
 * 日付別の休憩オーバーライドをクリアする
 * @param {string} dateStr - 日付文字列 (YYYY-MM-DD)
 */
export function clearRestOverrides(dateStr) {
  localStorage.removeItem(`rest_overrides_${dateStr}`);
}

// ──────────────────────────────────────────────
// サーバー同期機能（ローカルネット共有用）
// ──────────────────────────────────────────────

const _SERVER_BASE = window.location.origin;
let _lastServerVersion = null;
let _pollingTimer = null;

/**
 * キーと値をサーバーの store.json に非同期で保存する（fire-and-forget）
 * @param {string} key
 * @param {*} value
 */
function _syncToServer(key, value) {
  fetch(`${_SERVER_BASE}/api/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value })
  }).catch(err => {
    console.warn('[Storage] サーバー同期失敗:', err.message);
  });
}

/**
 * localStorage の全データをサーバーに一括移行する（サーバーが空の時に初回実行）
 */
async function _migrateLocalStorageToServer() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      key.startsWith('sb_') ||
      key.startsWith('reservation') ||
      key.startsWith('lunch') ||
      key.startsWith('rest')
    ) {
      try {
        entries.push({ key, value: JSON.parse(localStorage.getItem(key)) });
      } catch { /* ignore */ }
    }
  }
  for (const { key, value } of entries) {
    await fetch(`${_SERVER_BASE}/api/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    }).catch(() => {});
  }
  if (entries.length > 0) {
    console.info(`[Storage] ${entries.length}件のデータをサーバーに移行しました`);
  }
}

/**
 * サーバーの store.json から全データを読み込み localStorage を初期化する。
 * アプリ起動時に一度だけ呼ぶ。
 * @returns {Promise<void>}
 */
export async function initFromServer() {
  try {
    const res = await fetch(`${_SERVER_BASE}/api/store`, { cache: 'no-store' });
    if (!res.ok) return;
    const serverData = await res.json();

    if (Object.keys(serverData).length > 0) {
      // サーバーにデータがあれば localStorage に展開（サーバーデータが正）
      Object.entries(serverData).forEach(([key, value]) => {
        localStorage.setItem(key, JSON.stringify(value));
      });
      console.info('[Storage] サーバーからデータを読み込みました');
    } else {
      // サーバーが空なら localStorage → サーバーへ移行
      await _migrateLocalStorageToServer();
    }

    // 現在バージョンを記録
    const verRes = await fetch(`${_SERVER_BASE}/api/store/version`, { cache: 'no-store' });
    if (verRes.ok) {
      _lastServerVersion = await verRes.text();
    }
  } catch (err) {
    console.warn('[Storage] サーバー初期化をスキップ（ローカルモードで継続）:', err.message);
  }
}

/**
 * サーバーポーリングを開始する（5秒ごとに変更チェック）。
 * 変更を検出したら localStorage を更新し serverDataUpdated イベントを発火する。
 */
export function startPolling() {
  if (_pollingTimer) clearInterval(_pollingTimer);

  _pollingTimer = setInterval(async () => {
    try {
      const verRes = await fetch(`${_SERVER_BASE}/api/store/version`, { cache: 'no-store' });
      if (!verRes.ok) return;
      const version = await verRes.text();

      if (!_lastServerVersion) {
        _lastServerVersion = version;
        return;
      }

      if (version !== _lastServerVersion) {
        _lastServerVersion = version;

        const dataRes = await fetch(`${_SERVER_BASE}/api/store`, { cache: 'no-store' });
        if (!dataRes.ok) return;
        const serverData = await dataRes.json();

        Object.entries(serverData).forEach(([key, value]) => {
          localStorage.setItem(key, JSON.stringify(value));
        });

        window.dispatchEvent(new CustomEvent('serverDataUpdated'));
        console.info('[Storage] 他のPCの変更を受信して画面を更新しました');
      }
    } catch { /* サーバー接続失敗は無視 */ }
  }, 5000);
}

/**
 * ポーリングを停止する
 */
export function stopPolling() {
  if (_pollingTimer) {
    clearInterval(_pollingTimer);
    _pollingTimer = null;
  }
}
