/**
 * @fileoverview アプリケーションエントリポイント
 * 
 * サモンバランサーのメインモジュール。
 * 初期化処理、ナビゲーション管理、日付管理、
 * グローバルイベントバスを提供する。
 * 
 * @module app
 */

import { initializeDefaults, importMenusFromDefaults, initFromServer, startPolling } from './services/storage.js';
import { MainView } from './views/mainView.js?v=104';
import { StaffSettingsView } from './views/staffSettings.js?v=3';
import { MenuSettingsView } from './views/menuSettings.js';

// ──────────────────────────────────────────────
// ユーティリティ: UUID生成
// ──────────────────────────────────────────────

/**
 * UUIDv4形式の一意識別子を生成する
 * @returns {string} UUID文字列
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // フォールバック実装
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ──────────────────────────────────────────────
// グローバルイベントバス
// ──────────────────────────────────────────────

/**
 * シンプルなイベントエミッターパターンの実装
 * アプリケーション全体でのコンポーネント間通信に使用する。
 * 
 * @example
 * eventBus.on('reservationChanged', (data) => { ... });
 * eventBus.emit('reservationChanged', { action: 'add', reservation });
 */
class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} イベント名からリスナーセットへのマップ */
    this._listeners = new Map();
  }

  /**
   * イベントリスナーを登録する
   * @param {string} event - イベント名
   * @param {Function} callback - コールバック関数
   * @returns {Function} 登録解除用の関数
   */
  on(event, callback) {
    if (typeof event !== 'string' || !event) {
      console.error('イベント名は空でない文字列を指定してください');
      return () => {};
    }
    if (typeof callback !== 'function') {
      console.error('コールバックは関数を指定してください');
      return () => {};
    }

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // 登録解除用の関数を返す
    return () => this.off(event, callback);
  }

  /**
   * イベントリスナーを解除する
   * @param {string} event - イベント名
   * @param {Function} callback - 解除するコールバック関数
   */
  off(event, callback) {
    if (!this._listeners.has(event)) {
      return;
    }
    this._listeners.get(event).delete(callback);

    // リスナーが空になったらMapからイベント自体を削除
    if (this._listeners.get(event).size === 0) {
      this._listeners.delete(event);
    }
  }

  /**
   * イベントを発火する
   * @param {string} event - イベント名
   * @param {*} [data] - イベントデータ
   */
  emit(event, data) {
    if (!this._listeners.has(event)) {
      return;
    }
    for (const callback of this._listeners.get(event)) {
      try {
        callback(data);
      } catch (error) {
        console.error(`イベント "${event}" のリスナーでエラーが発生しました:`, error);
      }
    }
  }

  /**
   * 特定イベントの全リスナーを解除する
   * @param {string} event - イベント名
   */
  removeAll(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}

/** @type {EventBus} グローバルイベントバスインスタンス */
export const eventBus = new EventBus();

// グローバルに公開（コンポーネントやビューが window.eventBus でアクセスするため）
window.eventBus = eventBus;

// ──────────────────────────────────────────────
// 日付管理
// ──────────────────────────────────────────────

/**
 * 日付管理オブジェクト
 * 現在選択されている日付の管理と、日付変更時の通知を行う。
 */
const dateManager = {
  /** @type {string} 現在選択中の日付（YYYY-MM-DD形式） */
  _currentDate: '',

  /**
   * 現在の日付を取得する
   * @returns {string} YYYY-MM-DD形式の日付文字列
   */
  getCurrentDate() {
    return this._currentDate;
  },

  /**
   * 日付を設定してイベントを発火する
   * @param {string} dateStr - YYYY-MM-DD形式の日付文字列
   */
  setCurrentDate(dateStr) {
    if (this._currentDate === dateStr) {
      return;
    }
    this._currentDate = dateStr;
    sessionStorage.setItem('selected_date', dateStr);
    eventBus.emit('dateChanged', { date: dateStr });
  },

  /**
   * 今日の日付をYYYY-MM-DD形式で返す
   * @returns {string} 今日の日付
   */
  getToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * 現在の日付を翌日に進める
   */
  goToNextDay() {
    const current = new Date(this._currentDate);
    current.setDate(current.getDate() + 1);
    this.setCurrentDate(current.toISOString().split('T')[0]);
  },

  /**
   * 現在の日付を前日に戻す
   */
  goToPrevDay() {
    const current = new Date(this._currentDate);
    current.setDate(current.getDate() - 1);
    this.setCurrentDate(current.toISOString().split('T')[0]);
  },

  /**
   * 日付を表示用フォーマットに変換する
   * @param {string} dateStr - YYYY-MM-DD形式の日付文字列
   * @returns {string} 表示用文字列（例: "2026年7月17日（金）"）
   */
  formatDisplayDate(dateStr) {
    try {
      const date = new Date(dateStr);
      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekday = weekdays[date.getDay()];
      return `${year}年${month}月${day}日（${weekday}）`;
    } catch (error) {
      return dateStr;
    }
  }
};

// dateManagerをグローバルに公開
window.dateManager = dateManager;
export { dateManager };

// ──────────────────────────────────────────────
// ビュー管理
// ──────────────────────────────────────────────

/** @type {string} 現在のアクティブビュー */
let currentView = 'reservation';

/** @type {MainView|StaffSettingsView|MenuSettingsView|null} 現在のビューインスタンス */
let currentViewInstance = null;

/**
 * 現在のビューインスタンスを破棄する
 */
function destroyCurrentView() {
  if (currentViewInstance && typeof currentViewInstance.destroy === 'function') {
    currentViewInstance.destroy();
  }
  currentViewInstance = null;
}

/**
 * 指定されたビューを初期化して描画する
 * @param {string} viewName - ビュー名（'reservation' | 'staff' | 'menu'）
 */
function renderView(viewName) {
  // 前のビューを破棄
  destroyCurrentView();

  switch (viewName) {
    case 'reservation': {
      const container = document.getElementById('view-reservation');
      if (container) {
        const view = new MainView(container);
        const dateStr = dateManager.getCurrentDate();
        view.render(dateStr ? new Date(dateStr + 'T00:00:00') : new Date());
        currentViewInstance = view;
      }
      break;
    }
    case 'staff': {
      const container = document.getElementById('view-staff');
      if (container) {
        const view = new StaffSettingsView(container);
        view.render();
        currentViewInstance = view;
      }
      break;
    }
    case 'menu': {
      const container = document.getElementById('view-menu');
      if (container) {
        const view = new MenuSettingsView(container);
        view.render();
        currentViewInstance = view;
      }
      break;
    }
  }
}

// ──────────────────────────────────────────────
// ナビゲーション管理
// ──────────────────────────────────────────────

/**
 * ビューを切り替える
 * @param {string} viewName - ビュー名（'reservation' | 'staff' | 'menu'）
 */
function switchView(viewName) {
  const validViews = ['reservation', 'staff', 'menu'];
  if (!validViews.includes(viewName)) {
    console.warn(`無効なビュー名: ${viewName}`);
    return;
  }

  // 設定画面へのアクセス制限（パスワード: 4649）
  if (viewName === 'staff' || viewName === 'menu') {
    // 既に現在のビューなら何もしない
    if (currentView === viewName) return;
    
    const pwd = window.prompt("パスワードを入力してください");
    if (pwd !== "4649") {
      alert("パスワードが違います");
      return;
    }
  }

  currentView = viewName;

  // ナビゲーションタブのアクティブ状態を更新
  const navTabs = document.querySelectorAll('.nav-tab');
  navTabs.forEach(tab => {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive.toString());
  });

  // セクションの表示切替
  const sections = document.querySelectorAll('.view-section');
  sections.forEach(section => {
    const isTarget = section.id === `view-${viewName}`;
    section.classList.toggle('active', isTarget);
    section.hidden = !isTarget;
  });

  // メニューバーとサイドバーの表示制御（予約表ビューのみ表示）
  const menuBar = document.getElementById('menu-bar');
  const sidebar = document.getElementById('assistant-sidebar');
  if (menuBar) {
    menuBar.classList.toggle('hidden', viewName !== 'reservation');
  }
  if (sidebar) {
    sidebar.classList.toggle('hidden', viewName !== 'reservation');
  }

  // #main-contentのスクロール・パディング制御（予約表ビューはスクロール無効）
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    if (viewName === 'reservation') {
      mainContent.style.overflowY = 'hidden';
      mainContent.style.padding = '0';
    } else {
      mainContent.style.overflowY = 'auto';
      mainContent.style.padding = '20px';
    }
  }

  // 対応するビュークラスを初期化して描画
  renderView(viewName);

  // ビュー変更イベントを発火
  eventBus.emit('viewChanged', { view: viewName });
}

/**
 * ナビゲーションタブにイベントリスナーを設定する
 */
function setupNavigation() {
  const navTabs = document.querySelectorAll('.nav-tab');
  navTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = tab.dataset.view;
      if (viewName) {
        switchView(viewName);
      }
    });

    // キーボードアクセシビリティ
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const viewName = tab.dataset.view;
        if (viewName) {
          switchView(viewName);
        }
      }
    });
  });
}

/**
 * 日付ナビゲーション（前日/翌日/日付選択）を設定する
 */
function setupDateNavigation() {
  const prevBtn = document.getElementById('date-prev');
  const nextBtn = document.getElementById('date-next');
  const dateInput = document.getElementById('date-picker');
  const dateDisplay = document.getElementById('date-display');
  const displayWrapper = document.querySelector('.date-display-wrapper');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      dateManager.goToPrevDay();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      dateManager.goToNextDay();
    });
  }

  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      const newDate = e.target.value;
      if (newDate) {
        dateManager.setCurrentDate(newDate);
      }
    });
  }

  if (displayWrapper && dateInput) {
    displayWrapper.addEventListener('click', () => {
      try {
        dateInput.showPicker();
      } catch (e) {
        dateInput.click();
      }
    });
  }

  // 日付変更イベントをリッスンしてUIを更新
  eventBus.on('dateChanged', ({ date }) => {
    if (dateInput) {
      dateInput.value = date;
    }
    if (dateDisplay) {
      dateDisplay.textContent = dateManager.formatDisplayDate(date);
    }

    // 予約表ビューが表示中であれば日付を渡して再描画
    if (currentView === 'reservation' && currentViewInstance && typeof currentViewInstance.render === 'function') {
      currentViewInstance.render(new Date(date + 'T00:00:00'));
    }
  });
}

// ──────────────────────────────────────────────
// アプリケーション初期化
// ──────────────────────────────────────────────

/**
 * アプリケーション全体を初期化する
 * DOMContentLoadedイベントで呼び出される。
 */
async function initApp() {
  try {
    console.info('サモンバランサーを初期化しています...');

    // 1. ストレージの初期化（デフォルトデータ投入）
    await initializeDefaults();

    // 1b. defaults.jsonに新しく追加されたスキル・メニューを自動マージ
    //     （既存データは上書きしない。新規IDのみ追加）
    try {
      await importMenusFromDefaults();
    } catch (e) {
      console.warn('デフォルトデータのマージをスキップ:', e.message);
    }

    // 1c. サーバーからデータを読み込み（ローカルネット共有）
    await initFromServer();
    startPolling();

    // 2. ナビゲーション設定と日付の監視を先に開始
    setupNavigation();
    setupDateNavigation();

    // 3. 保存された日付があれば復元、なければ今日の日付で初期化
    const savedDate = sessionStorage.getItem('selected_date');
    const today = savedDate || dateManager.getToday();
    dateManager.setCurrentDate(today);

    // 4. デフォルトビューを表示
    switchView('reservation');

    // 5. 他のPCの変更を受信したときに現在のビューを更新
    window.addEventListener('serverDataUpdated', () => {
      if (currentView === 'reservation' && currentViewInstance) {
        if (typeof currentViewInstance.refresh === 'function') {
          currentViewInstance.refresh();
        }
      }
    });

    console.info('サモンバランサーの初期化が完了しました ✨');
  } catch (error) {
    console.error('アプリケーションの初期化に失敗しました:', error);

    // エラー表示
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="error-screen">
          <div class="error-icon">⚠️</div>
          <h2>初期化エラー</h2>
          <p>アプリケーションの起動に失敗しました。</p>
          <p class="error-detail">${error.message}</p>
          <button class="btn btn-primary" onclick="location.reload()">再読み込み</button>
        </div>
      `;
    }
  }
}

// DOM読み込み完了時にアプリを初期化
document.addEventListener('DOMContentLoaded', initApp);
