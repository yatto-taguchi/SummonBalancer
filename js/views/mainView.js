/**
 * mainView.js — メイン予約表画面
 *
 * タイムライングリッド、メニューバー、アシスタントリストを統合し、
 * 召喚エンジンと疲労管理の結果を画面に反映するメインビュー。
 */

import * as Storage from '../services/storage.js?v=18';
import { summonEngine as SummonEngineInstance } from '../services/summonEngine/engineShadowRunner.js?v=35';
import { FatigueManager } from '../services/fatigueManager.js';
import { Timeline } from '../components/timeline.js?v=32';
import { MenuBar } from '../components/menuBar.js?v=5';
import { ReservationBlock } from '../components/reservation.js?v=29';
import { StaffList } from '../components/staffList.js?v=6';
import { FatigueBar } from '../components/fatigueBar.js?v=6';
import { AlertBadge } from '../components/alertBadge.js';
import { FreeTimeModal } from '../components/freeTimeModal.js?v=2';
import accordionManager from '../components/accordionManager.js';

export class MainView {
  /**
   * @param {HTMLElement} container - #main-content
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {SummonEngine} */
    this.summonEngine = SummonEngineInstance;

    /** @type {FatigueManager} */
    this.fatigueManager = new FatigueManager();

    /** @type {Date} 表示中の日付 */
    this.currentDate = new Date();

    /** @type {boolean} 手動調整モード */
    this.isManualMode = false;

    // コンポーネントからアクセスできるようにグローバル参照を保存
    window.__mainViewInstance = this;

    /** @type {Timeline|null} */
    this.timeline = null;

    /** @type {MenuBar|null} */
    this.menuBar = null;

    /** @type {StaffList|null} */
    this.staffList = null;

    /** @type {FatigueBar|null} */
    this.fatigueBar = null;

    /** @type {ReservationBlock[]} */
    this.reservationBlocks = [];

    /** @type {import('../services/summonEngine.js').SummonResult|null} */
    this.lastSummonResult = null;

    /** @type {FreeTimeModal|null} */
    this.freeTimeModal = null;

    // イベントバスのリスナーを保持
    this._eventHandlers = {};
    this._bindEvents();
  }

  /**
   * イベントバスのイベントをバインドする
   * @private
   */
  _bindEvents() {
    const bus = window.eventBus;
    if (!bus) return;

    this._eventHandlers.reservationChanged = (data) => {
      if (data && data.action === 'changeMenuItem') {
        const dateStr = this._formatDate(this.currentDate);
        const reservations = Storage.loadReservations(dateStr);
        const res = reservations.find(r => r.id === data.reservationId);
        if (res) {
          const allMenus = Storage.loadMenus();
          const newMenu = allMenus.find(m => m.id === data.newMenuId);
          if (newMenu) {
            res.menuItemId = data.newMenuId;
            res.endTime = res.startTime + newMenu.duration;
            res.assignedAssistants = {};
            res.menuVariant = null;
            res.manualVariantSelection = true; // 手動選択フラグをON（自動切替の対象外にする）
            Storage.saveReservation(dateStr, res);
          }
        }
      }

      // 習熟度変更: メニューのスロット習熟度を予約ごとにオーバーライドして保存
      if (data && data.change === 'proficiency') {
        const dateStr = this._formatDate(this.currentDate);
        const reservations = Storage.loadReservations(dateStr);
        const res = reservations.find(r => r.id === data.reservationId);
        if (res) {
          if (!res.slotTimeOverrides) res.slotTimeOverrides = {};
          // 習熟度はslotTimeOverridesに含めず、別途proficiencyOverridesで管理
          if (!res.proficiencyOverrides) res.proficiencyOverrides = {};
          res.proficiencyOverrides[data.slotIndex] = data.proficiency;
          Storage.saveReservation(dateStr, res);
          this._runSummon();
          return;
        }
      }

      // スロット時間オーバーライド変更
      if (data && data.change === 'slotTimeOverride') {
        const dateStr = this._formatDate(this.currentDate);
        const reservations = Storage.loadReservations(dateStr);
        const res = reservations.find(r => r.id === data.reservationId);
        if (res) {
          if (!res.slotTimeOverrides) res.slotTimeOverrides = {};
          if (data.startMinute === null || data.endMinute === null) {
            // リセット（オーバーライド削除）
            delete res.slotTimeOverrides[data.slotIndex];
          } else {
            res.slotTimeOverrides[data.slotIndex] = {
              startMinute: data.startMinute,
              endMinute: data.endMinute
            };
          }
          Storage.saveReservation(dateStr, res);
          this._runSummon();
          return;
        }
      }

      this.refresh();
    };

    this._eventHandlers.staffChanged = () => this.refresh();
    this._eventHandlers.menuChanged = () => this.refresh();
    this._eventHandlers.reservationDropped = (data) => this.handleReservationDrop(data);
    this._eventHandlers.reservationMoved = (data) => this.handleReservationMove(data);
    this._eventHandlers.reservationDeleted = (data) => this.handleReservationDelete(data);
    this._eventHandlers.reservationUpdated = (data) => this._handleReservationUpdated(data);
    this._eventHandlers.reservationResized = (data) => this._handleReservationResized(data);

    // 既にバインドされていれば一度解除する（重複登録防止）
    if (this._eventHandlers.assistantSlotClicked) {
      bus.off('assistantSlotClicked', this._eventHandlers.assistantSlotClicked);
    }
    if (this._eventHandlers.assistantSlotUnfix) {
      bus.off('assistantSlotUnfix', this._eventHandlers.assistantSlotUnfix);
    }
    if (this._eventHandlers.convertActivityToLunch) {
      bus.off('convertActivityToLunch', this._eventHandlers.convertActivityToLunch);
    }
    if (this._eventHandlers.moveStaffOrder) {
      bus.off('moveStaffOrder', this._eventHandlers.moveStaffOrder);
    }
    
    // イベントハンドラを保持
    this._eventHandlers.assistantSlotClicked = (data) => {
      this._showAssistantSelector(data);
    };
    this._eventHandlers.assistantSlotUnfix = (data) => {
      this._applyManualAssignment(data.reservationId, data.slotIndex, null);
    };
    this._eventHandlers.convertActivityToLunch = (data) => {
      const dateStr = this._formatDate(this.currentDate);
      Storage.saveLunchOverride(dateStr, data.staffId, data.startTimeOffset);
      this._runSummon();
    };
    this._eventHandlers.convertActivityToRest = (data) => {
      const dateStr = this._formatDate(this.currentDate);
      Storage.saveRestOverride(dateStr, data.staffId, data.startTimeOffset);
      this._runSummon(); // 再計算
    };
    this._eventHandlers.moveStaffOrder = (data) => {
      const isStylist = data.type === 'stylist';
      const list = isStylist ? Storage.loadStylists() : Storage.loadAssistants();
      const idx = list.findIndex(s => s.id === data.staffId);
      if (idx === -1) return;

      if (data.direction === 'up' && idx > 0) {
        const temp = list[idx];
        list[idx] = list[idx - 1];
        list[idx - 1] = temp;
      } else if (data.direction === 'down' && idx < list.length - 1) {
        const temp = list[idx];
        list[idx] = list[idx + 1];
        list[idx + 1] = temp;
      } else {
        return;
      }

      if (isStylist) {
        Storage.saveStylists(list);
      } else {
        Storage.saveAssistants(list);
      }
      this.refresh();
    };

    // 空き時間モーダルイベント
    this._eventHandlers.openFreeTimeModal = (data) => {
      this._openFreeTimeModal(data);
    };
    this._eventHandlers.freeTimeActivitySelected = (data) => {
      this._handleFreeTimeSelection(data);
    };

    bus.on('reservationChanged', this._eventHandlers.reservationChanged);
    bus.on('staffChanged', this._eventHandlers.staffChanged);
    bus.on('menuChanged', this._eventHandlers.menuChanged);
    bus.on('reservationDropped', this._eventHandlers.reservationDropped);
    bus.on('reservationMoved', this._eventHandlers.reservationMoved);
    bus.on('reservationDeleted', this._eventHandlers.reservationDeleted);
    bus.on('assistantSlotClicked', this._eventHandlers.assistantSlotClicked);
    bus.on('assistantSlotUnfix', this._eventHandlers.assistantSlotUnfix);
    bus.on('convertActivityToLunch', this._eventHandlers.convertActivityToLunch);
    bus.on('convertActivityToRest', this._eventHandlers.convertActivityToRest);
    bus.on('moveStaffOrder', this._eventHandlers.moveStaffOrder);

    this._eventHandlers.openStaffHolidayModal = (data) => {
      this._showStaffHolidayModal(data.staffId, data.staffType);
    };

    bus.on('openFreeTimeModal', this._eventHandlers.openFreeTimeModal);
    bus.on('freeTimeActivitySelected', this._eventHandlers.freeTimeActivitySelected);
    bus.on('reservationUpdated', this._eventHandlers.reservationUpdated);
    bus.on('reservationResized', this._eventHandlers.reservationResized);
    bus.on('openStaffHolidayModal', this._eventHandlers.openStaffHolidayModal);

    this._eventHandlers.menuDroppedOnReservation = (data) => {
      this._showMenuCombineModal(data);
    };
    bus.on('menuDroppedOnReservation', this._eventHandlers.menuDroppedOnReservation);

    // ドラッグ中にDOMが再構築されてdragendが発火しないバグへの対策
    document.addEventListener('dragend', () => {
      document.body.classList.remove('is-dragging-item');
    });
  }

  /**
   * メイン画面全体を描画する
   * @param {Date} [date] - 表示する日付
   */
  render(date) {
    if (date) this.currentDate = date;

    this.container.innerHTML = '';

    // ルートラッパーを作成
    const wrapper = document.createElement('div');
    wrapper.className = 'main-view';
    wrapper.innerHTML = `
      <style>
        .main-view {
          display: flex;
          flex-direction: column;
          height: 100%;
          gap: 0;
          overflow: hidden;
        }

        /* ツールバー（メニューバー内に移動済み） */
        .toolbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .toolbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .date-picker-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .date-nav-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: var(--transition-fast);
        }
        .date-nav-btn:hover {
          background: var(--accent-primary);
        }
        .date-input {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          font-size: 14px;
          font-family: inherit;
        }
        .date-input::-webkit-calendar-picker-indicator {
          filter: invert(1);
        }
        .toolbar-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 8px 16px;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 13px;
          font-family: inherit;
          transition: var(--transition-fast);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .toolbar-btn:hover {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
        }
        .toolbar-btn.active {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
        }
        .toolbar-btn.summon-btn {
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          border-color: var(--accent-secondary);
          font-weight: 600;
        }
        .toolbar-btn.summon-btn:hover {
          box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
          transform: translateY(-1px);
        }

        /* メインコンテンツエリア */
        .main-content-area {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        .timeline-area {
          flex: 4;
          overflow: auto;
          position: relative;
        }
        .sidebar-area {
          flex: 1;
          min-width: 240px;
          max-width: 300px;
          display: flex;
          flex-direction: column;
          border-left: 1px solid var(--border-glass);
          overflow-y: auto;
        }
        .sidebar-section {
          padding: 16px;
          border-bottom: 1px solid var(--border-glass);
        }
        .sidebar-section-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 12px;
        }

        /* メニューバーエリア */
        .menu-bar-area {
          flex-shrink: 0;
          border-top: 1px solid var(--border-glass);
          background: var(--bg-glass);
          backdrop-filter: blur(12px);
        }

        /* アラートエリア */
        .alerts-area {
          padding: 8px 16px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .alert-item {
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .alert-item.warning {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-warning);
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .alert-item.danger {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-danger);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .alert-item.info {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-info);
          border: 1px solid rgba(59, 130, 246, 0.3);
        }
        .alert-item.success {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-success);
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        /* 疲労度ゲージ */
        .fatigue-item {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .fatigue-name {
          font-size: 12px;
          color: var(--text-secondary);
          min-width: 60px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fatigue-gauge {
          flex: 1;
          height: 6px;
          background: var(--bg-tertiary);
          border-radius: 3px;
          overflow: hidden;
        }
        .fatigue-gauge-fill {
          height: 100%;
          border-radius: 3px;
          transition: width var(--transition-normal);
        }
        .fatigue-rate {
          font-size: 11px;
          color: var(--text-muted);
          min-width: 36px;
          text-align: right;
        }

        /* 召喚バッジ */
        .summon-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          color: white;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .summon-badge::before {
          content: '⚡';
        }

        /* 空き時間活動 */
        .activity-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .activity-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          font-size: 12px;
          color: var(--text-secondary);
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .activity-badge {
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          font-size: 10px;
          font-weight: 600;
        }
        .activity-badge.practice {
          background: rgba(99, 102, 241, 0.2);
          color: var(--accent-primary);
        }
        .activity-badge.cleaning {
          background: rgba(16, 185, 129, 0.2);
          color: var(--accent-success);
        }
        .activity-badge.teaching {
          background: rgba(245, 158, 11, 0.2);
          color: var(--accent-warning);
        }

        /* 手動モード表示 */
        .manual-mode-overlay {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(245, 158, 11, 0.9);
          color: #000;
          padding: 4px 16px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          z-index: 100;
          pointer-events: none;
        }

        /* 空き人ボタン */
        .free-staff-btn {
          background: var(--accent-success);
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          cursor: pointer;
          font-family: inherit;
          transition: var(--transition-fast);
        }
        .free-staff-btn:hover {
          opacity: 0.85;
          transform: translateY(-1px);
        }
      </style>

      <!-- ツールバーはメニューバー(#menu-bar-toolbar)に移動済み -->

      <!-- メインコンテンツエリア -->
      <div class="main-content-area" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
        <div class="timeline-area" id="timeline-area" style="flex: 1; min-height: 0; overflow: auto; position: relative;"></div>
        
        <!-- ボトムアコーディオンエリア -->
        <div class="bottom-accordion-area" style="border-top: 1px solid var(--border-glass); background: var(--bg-secondary); flex-shrink: 0; display: flex; flex-direction: column; z-index: 10;">
          <div class="accordion-header" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; cursor: pointer; user-select: none; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid transparent; transition: background var(--transition-fast);">
            <div style="display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 0.9rem; color: var(--text-primary);">
              <span>👤 アシスタント一覧</span>
              <span id="assistant-count-badge" style="background: rgba(99, 102, 241, 0.2); color: var(--accent-primary); border: 1px solid rgba(99, 102, 241, 0.4); font-size: 0.75rem; padding: 1px 6px; border-radius: 10px;">0人</span>
            </div>
            <div style="display: flex; align-items: center; gap: 24px;">
              <span class="accordion-arrow" style="transition: transform var(--transition-normal); font-size: 0.8rem; color: var(--text-secondary);">▼</span>
            </div>
          </div>
          
          <div class="accordion-content" style="display: none; padding: 12px 20px; border-top: 1px solid var(--border-glass); overflow-y: hidden;">
            <div class="accordion-content-inner" style="display: flex; gap: 20px; align-items: stretch; height: 100%;">
              <!-- アシスタント横スクロールリスト -->
              <div class="accordion-staff-list" style="flex: 3; min-width: 0;">
                <div id="staff-list-container"></div>
              </div>
              <!-- 空き時間活動リスト -->
              <div class="accordion-info-list" style="flex: 1; min-width: 220px; max-width: 320px; border-left: 1px solid var(--border-glass); padding-left: 20px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto;">
                <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">🧹 空き時間活動</div>
                <div id="activities-container"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(wrapper);

    // アコーディオンの開閉制御
    const accordionHeader = wrapper.querySelector('.accordion-header');
    const accordionContent = wrapper.querySelector('.accordion-content');
    const accordionArrow = wrapper.querySelector('.accordion-arrow');
    if (accordionHeader && accordionContent && accordionArrow) {
      accordionHeader.addEventListener('click', () => {
        const isCollapsed = accordionContent.style.display === 'none';
        accordionContent.style.display = isCollapsed ? 'block' : 'none';
        accordionHeader.classList.toggle('active', isCollapsed);
        accordionArrow.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
        
        // 開いたときに子要素の配置（横スクロールなど）を再計算
        if (isCollapsed && this.staffList) {
          const dateStr = this._formatDate(this.currentDate);
          const allAssistants = Storage.loadAssistants();
          this.staffList.render(allAssistants, dateStr);
          this._updateStaffListStatus();
        }
      });
    }

    // 日付入力を設定
    this._setupDateInput();

    // メニューバー内ツールバーを描画
    this._renderMenuBarToolbar();

    // コンポーネントの初期化と描画
    this._initComponents();

    // 自動配置を実行
    this._runSummon();
  }

  /**
   * 日付入力を設定する
   * @private
   */
  _setupDateInput() {
    const dateInput = this.container.querySelector('.date-input');
    if (dateInput) {
      const dateStr = this._formatDate(this.currentDate);
      dateInput.value = dateStr;
      dateInput.addEventListener('change', (e) => {
        if (window.dateManager) {
          window.dateManager.setCurrentDate(e.target.value);
        } else {
          this.currentDate = new Date(e.target.value + 'T00:00:00');
          this.refresh();
        }
      });
    }
  }

  /**
   * メニューバー内にツールバーボタンを描画する
   * @private
   */
  _renderMenuBarToolbar() {
    const toolbar = document.getElementById('menu-bar-toolbar');
    if (!toolbar) return;

    // 既存の内容をクリア
    toolbar.innerHTML = '';

    // アラートエリア
    const alertsArea = document.createElement('div');
    alertsArea.id = 'alerts-area';
    alertsArea.style.cssText = 'display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;';
    toolbar.appendChild(alertsArea);

    // 区切り線
    const separator = document.createElement('div');
    separator.style.cssText = 'width: 1px; height: 24px; background: var(--border-glass); flex-shrink: 0;';
    toolbar.appendChild(separator);

    // 固定モードボタン
    const manualBtn = document.createElement('button');
    manualBtn.className = 'menu-bar-toolbar-btn';
    manualBtn.dataset.action = 'manual-mode';
    manualBtn.innerHTML = '📌 固定モード';
    if (this.isManualMode) manualBtn.classList.add('active');
    toolbar.appendChild(manualBtn);

    // 更新ボタン
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'menu-bar-toolbar-btn';
    refreshBtn.dataset.action = 'refresh';
    refreshBtn.innerHTML = '🔄 更新';
    toolbar.appendChild(refreshBtn);

    // 当日リセットボタン
    const resetBtn = document.createElement('button');
    resetBtn.className = 'menu-bar-toolbar-btn danger';
    resetBtn.dataset.action = 'reset-day';
    resetBtn.innerHTML = '🗑 リセット';
    toolbar.appendChild(resetBtn);

    // イベント設定
    this._setupToolbarEvents(toolbar);
  }

  /**
   * ツールバーイベントを設定する
   * @param {HTMLElement} wrapper
   * @private
   */
  _setupToolbarEvents(wrapper) {
    wrapper.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      switch (action) {
        case 'prev-day': {
          if (window.dateManager) {
            window.dateManager.goToPrevDay();
          } else {
            const d = new Date(this.currentDate);
            d.setDate(d.getDate() - 1);
            this.currentDate = d;
            this.container.querySelector('.date-input').value = this._formatDate(d);
            this.refresh();
          }
          break;
        }
        case 'next-day': {
          if (window.dateManager) {
            window.dateManager.goToNextDay();
          } else {
            const d = new Date(this.currentDate);
            d.setDate(d.getDate() + 1);
            this.currentDate = d;
            this.container.querySelector('.date-input').value = this._formatDate(d);
            this.refresh();
          }
          break;
        }
        case 'auto-summon':
          this._runSummon();
          break;
        case 'manual-mode':
          this.toggleManualMode();
          btn.classList.toggle('active', this.isManualMode);
          break;
        case 'refresh':
          window.location.reload();
          break;
        case 'reset-day':
          this._showResetDayConfirmation();
          break;
      }
    });
  }

  /**
   * コンポーネントを初期化する
   * @private
   */
  _initComponents() {
    const dateStr = this._formatDate(this.currentDate);
    const allStylists = Storage.loadStylists();
    const stylists = allStylists.filter(s => s.isWorkingOn(dateStr));
    const offStylists = allStylists.filter(s => !s.isWorkingOn(dateStr));
    const reservations = Storage.loadReservations(dateStr);
    const menus = Storage.loadMenus();
    const allAssistants = Storage.loadAssistants();
    const assistants = allAssistants.filter(a => a.isWorkingOn(dateStr));
    const offAssistants = allAssistants.filter(a => !a.isWorkingOn(dateStr));

    // タイムライン
    const timelineArea = this.container.querySelector('#timeline-area');
    if (timelineArea) {
      this.timeline = new Timeline(timelineArea);
      this.timeline.render(stylists, reservations, this.currentDate, null, {}, {}, offStylists, offAssistants, []);

      // アコーディオン展開イベントリスナー
      document.removeEventListener('accordion-changed', this._onAccordionChanged);
      this._onAccordionChanged = () => {
        if (this.timeline) {
          this.timeline.applyAccordionState();
        }
        this._updateReservationBlockPositions();
      };
      document.addEventListener('accordion-changed', this._onAccordionChanged);
    }

    // メニューバー（index.htmlの上部#menu-barに描画）
    const menuBarContent = document.querySelector('#menu-bar .menu-bar-content');
    if (menuBarContent) {
      this.menuBar = new MenuBar(menuBarContent);
      this.menuBar.render(menus);
    }

    // スタッフリスト
    const staffListContainer = this.container.querySelector('#staff-list-container');
    if (staffListContainer) {
      this.staffList = new StaffList(staffListContainer);
      this.staffList.render(allAssistants, dateStr);

      // 人数バッジの更新
      const badge = this.container.querySelector('#assistant-count-badge');
      if (badge) {
        badge.textContent = `${assistants.length}人`;
      }
    }

    // 疲労バー
    const fatigueContainer = document.querySelector('#fatigue-container');
    if (fatigueContainer) {
      this.fatigueBar = new FatigueBar(fatigueContainer);
    }

    // 予約ブロック
    this._renderReservationBlocks(reservations, menus);
  }

  /**
   * 予約ブロックを描画する
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {import('../models/menu.js').MenuItem[]} menus
   * @private
   */
  _renderReservationBlocks(reservations, menus) {
    const menuMap = new Map();
    menus.forEach(m => menuMap.set(m.id, m));

    const timelineArea = this.container.querySelector('#timeline-area');
    if (!timelineArea) return;

    // 既存ブロックを破棄
    this.reservationBlocks.forEach(rb => rb.destroy());
    this.reservationBlocks = [];

    // スタイリストごとにレーン（段）を計算して重なりを下にずらす
    const CELL_HEIGHT = 60;
    const byStylists = new Map();
    reservations.forEach(res => {
      if (!byStylists.has(res.stylistId)) byStylists.set(res.stylistId, []);
      byStylists.get(res.stylistId).push(res);
    });

    // 各スタイリスト内でレーンを割り当て
    const laneMap = new Map(); // reservationId -> lane number
    byStylists.forEach((resList) => {
      // 開始時間でソート
      resList.sort((a, b) => {
        const aStart = typeof a.startTime === 'number' ? a.startTime : 0;
        const bStart = typeof b.startTime === 'number' ? b.startTime : 0;
        return aStart - bStart;
      });

      const lanes = []; // 各レーンの終了時間
      resList.forEach(res => {
        const start = typeof res.startTime === 'number' ? res.startTime : 0;
        const end = typeof res.endTime === 'number' ? res.endTime : start + 60;

        // 空いているレーンを探す
        let assignedLane = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i] <= start) {
            assignedLane = i;
            break;
          }
        }
        if (assignedLane === -1) {
          assignedLane = lanes.length;
          lanes.push(0);
        }
        lanes[assignedLane] = end;
        laneMap.set(res.id, assignedLane);
      });
    });

    // タイムライン行の高さを調整（予約がある場合は最下部にドロップ用の隙間を15px確保する）
    byStylists.forEach((resList, stylistId) => {
      let maxLane = 0;
      resList.forEach(res => {
        const lane = laneMap.get(res.id) || 0;
        if (lane > maxLane) maxLane = lane;
      });
      const rowEl = timelineArea.querySelector(`.timeline-row[data-stylist-id="${stylistId}"]`);
      if (rowEl) {
        // 予約が1件以上ある場合は、(最大レーン + 1)段分 + 15px の高さを確保する
        const neededHeight = resList.length > 0
          ? (maxLane + 1) * CELL_HEIGHT + 15
          : CELL_HEIGHT;
        rowEl.style.minHeight = `${neededHeight}px`;
        // セルの高さも調整
        const cells = rowEl.querySelectorAll('.timeline-cell');
        cells.forEach(cell => { cell.style.height = `${neededHeight}px`; });
      }
    });

    // ブロックを描画
    reservations.forEach(res => {
      const menu = menuMap.get(res.menuItemId);
      if (!menu) return;

      // タイムラインのセルコンテナを検索
      const cellsContainer = timelineArea.querySelector(
        `.timeline-row[data-stylist-id="${res.stylistId}"] .timeline-cells`
      );
      const container = cellsContainer || timelineArea;

      const block = new ReservationBlock(res, menu, container);
      block.render();

      // レーンに応じてtopを設定
      const lane = laneMap.get(res.id) || 0;
      if (block._element) {
        block._element.style.top = `${lane * CELL_HEIGHT + 2}px`;
        block._element.style.height = `${CELL_HEIGHT - 4}px`;
      }

      this.reservationBlocks.push(block);
    });
  }

  /**
   * アコーディオン展開状態変更時に予約ブロックの位置をin-placeで再計算する。
   * DOMを再生成せず、left/widthのみ更新することでCSS transitionによる滑らかなアニメーションを実現する。
   * @private
   */
  _updateReservationBlockPositions() {
    const timelineArea = this.container.querySelector('#timeline-area');
    if (!timelineArea) return;

    const blocks = timelineArea.querySelectorAll('.reservation-block');
    blocks.forEach(block => {
      const startMin = parseFloat(block.dataset.startMin);
      const endMin = parseFloat(block.dataset.endMin);
      if (isNaN(startMin) || isNaN(endMin)) return;

      // 重み付きパーセンテージで位置を再計算
      const leftPct = accordionManager.getWeightedPosition(startMin);
      // 【重要】widthは始点と終点の差分から算出し累積誤差を防ぐ
      const endPct = accordionManager.getWeightedPosition(endMin);
      block.style.left = `${leftPct}%`;
      block.style.width = `${endPct - leftPct}%`;
    });
  }

  /**
   * 召喚エンジンを実行して結果を画面に反映する
   * @private
   */
  _runSummon() {
    const dateStr = this._formatDate(this.currentDate);
    const allStylists = Storage.loadStylists();
    const stylists = allStylists.filter(s => s.isWorkingOn(dateStr));
    const offStylists = allStylists.filter(s => !s.isWorkingOn(dateStr));
    const allAssistants = Storage.loadAssistants();
    const assistants = allAssistants.filter(a => a.isWorkingOn(dateStr));
    const offAssistants = allAssistants.filter(a => !a.isWorkingOn(dateStr));
    const reservations = Storage.loadReservations(dateStr);
    const menus = Storage.loadMenus();

    // ── カットカラー自動切替（掛け持ち発生時に先カラー→先カットへ自動変換） ──
    const byStylistForSwitch = new Map();
    reservations.forEach(r => {
      if (!byStylistForSwitch.has(r.stylistId)) byStylistForSwitch.set(r.stylistId, []);
      byStylistForSwitch.get(r.stylistId).push(r);
    });

    let hasSwitchUpdate = false;
    byStylistForSwitch.forEach((stylistResList) => {
      const overlappingResIds = new Set();
      for (let i = 0; i < stylistResList.length; i++) {
        for (let j = i + 1; j < stylistResList.length; j++) {
          const a = stylistResList[i];
          const b = stylistResList[j];
          const aStart = typeof a.startTime === 'number' ? a.startTime : 0;
          const aEnd = typeof a.endTime === 'number' ? a.endTime : aStart + 60;
          const bStart = typeof b.startTime === 'number' ? b.startTime : 0;
          const bEnd = typeof b.endTime === 'number' ? b.endTime : bStart + 60;

          if (aStart < bEnd && bStart < aEnd) {
            overlappingResIds.add(a.id);
            overlappingResIds.add(b.id);
          }
        }
      }

      stylistResList.forEach(res => {
        const isOverlapping = overlappingResIds.has(res.id);

        if (isOverlapping) {
          // 掛け持ち発生時: 手動固定されていなければ「先カラー」を自動で「先カット」に切替
          if (res.menuItemId === 'cut_color_color_first' && !res.manualVariantSelection) {
            res.menuItemId = 'cut_color_cut_first';
            res.autoSwitchedVariant = true;
            hasSwitchUpdate = true;
          }
        } else {
          // 単独予約時: 自動切り替えされていた「先カット」を手動固定でなければ基本の「先カラー」に戻す
          if (res.menuItemId === 'cut_color_cut_first' && res.autoSwitchedVariant && !res.manualVariantSelection) {
            res.menuItemId = 'cut_color_color_first';
            res.autoSwitchedVariant = false;
            hasSwitchUpdate = true;
          }
        }
      });
    });

    if (hasSwitchUpdate) {
      reservations.forEach(r => Storage.saveReservation(dateStr, r));
    }

    // 存在しない（スタッフ設定から削除された）アシスタント/スタイリストの固定を自動クリーンアップ
    const registeredIds = new Set([...allAssistants.map(a => a.id), ...allStylists.map(s => s.id)]);
    
    // 全アシスタントの情報を診断ログとして送信
    fetch(`/log?msg=${encodeURIComponent(`ALL_ASSISTANTS: ${JSON.stringify(allAssistants.map(a => ({id: a.id, name: a.name})))}`)}`).catch(() => {});
    
    // 全予約の情報を診断ログとして送信
    fetch(`/log?msg=${encodeURIComponent(`ALL_RESERVATIONS: ${JSON.stringify(reservations.map(r => ({id: r.id, fixed: r.fixedAssistants, assigned: r.assignedAssistants})))}`)}`).catch(() => {});

    let hasCleanup = false;

    reservations.forEach(res => {
      if (res.fixedAssistants) {
        for (const [slotIdx, astId] of Object.entries(res.fixedAssistants)) {
          const hasIt = astId === '__none__' || registeredIds.has(astId);
          // 診断ログをサーバーに送信
          fetch(`/log?msg=${encodeURIComponent(`FIXED_CHECK: res=${res.id} slot=${slotIdx} astId=${astId} registered=${hasIt}`)}`).catch(() => {});
          if (!hasIt) {
            delete res.fixedAssistants[slotIdx];
            hasCleanup = true;
          }
        }
      }
    });

    if (hasCleanup) {
      reservations.forEach(res => {
        Storage.saveReservation(dateStr, res);
      });
    }

    // 召喚エンジン実行（手動お昼ご飯位置・休憩オーバーライドを反映）
    const lunchOverrides = Storage.loadLunchOverrides ? Storage.loadLunchOverrides(dateStr) : {};
    const restOverrides = Storage.loadRestOverrides ? Storage.loadRestOverrides(dateStr) : {};
    
    // タイムライン・フリーズ: 当日の場合は現在時刻を渡し、過去のアサインをロックする
    const now = new Date();
    const todayStr = this._formatDate(new Date());
    const isToday = (dateStr === todayStr);
    const currentTime = isToday ? (now.getHours() - 9) * 60 + now.getMinutes() : null;
    
    const result = this.summonEngine.calculate(
      reservations, stylists, assistants, menus,
      lunchOverrides, restOverrides,
      { isToday, currentTime }
    );
    this.lastSummonResult = result;

    // --- DEBUG: アラートがあったらトーストまたはコンソールに出力 ---
    if (result.alerts && result.alerts.length > 0) {
      console.warn("[DEBUG] 人数不足アラート発生: ", result.alerts);
      const alertMessages = result.alerts.map(a => `予約ID:${a.reservationId} (スロット${a.slotIndex}) - ${a.message}`).join("\\n");
      console.error("【不足アラート】\\n" + alertMessages);
    }
    if (result.manncells && result.manncells.length > 0) {
      console.log("[DEBUG] 成立したマンセル: ", result.manncells);
    }

    // --- DEBUG: アラートがあったらトーストまたはコンソールに出力 ---
    if (result.alerts && result.alerts.length > 0) {
      console.warn("[DEBUG] 人数不足アラート発生: ", result.alerts);
      const alertMessages = result.alerts.map(a => `予約ID:${a.reservationId} (スロット${a.slotIndex}) - ${a.message}`).join("\\n");
      console.error("【不足アラート】\\n" + alertMessages);
    }
    if (result.manncells && result.manncells.length > 0) {
      console.log("[DEBUG] 成立したマンセル: ", result.manncells);
    }

    // --- DEBUG: アラートがあったらトーストまたはコンソールに出力 ---
    if (result.alerts && result.alerts.length > 0) {
      console.warn("[DEBUG] 人数不足アラート発生: ", result.alerts);
      const alertMessages = result.alerts.map(a => `予約ID:${a.reservationId} (スロット${a.slotIndex}) - ${a.message}`).join("\n");
      console.error("【不足アラート】\n" + alertMessages);
    }
    if (result.manncells && result.manncells.length > 0) {
      console.log("[DEBUG] 成立したマンセル: ", result.manncells);
    }

    // 全スタッフ（スタイリスト＋アシスタント）の名前マップを作成
    const staffMap = new Map();
    Storage.loadStylists().forEach(s => staffMap.set(s.id, s));
    Storage.loadAssistants().forEach(a => staffMap.set(a.id, a));

    // ローカルの reservations 配列にアシスタント配置情報を反映させる (空き人数カウントに必要)
    reservations.forEach(res => {
      const resAssign = result.assignments[res.id];
      const resConcurrent = result.concurrentAssignments ? result.concurrentAssignments[res.id] : null;
      res.assignedAssistants = {};
      if (resAssign) {
        for (const [slotIdx, astId] of Object.entries(resAssign)) {
          // マンセル（チーム制）マーカーの検出: "__manncell__::チーム名" 形式
          if (typeof astId === 'string' && astId.startsWith('__manncell__::')) {
            const manncellTeam = astId.substring('__manncell__::'.length);
            res.assignedAssistants[slotIdx] = { 
              id: '__manncell__', 
              name: '__manncell__', 
              manncellTeam: manncellTeam 
            };
            continue;
          }

          const staff = staffMap.get(astId);
          const cInfo = resConcurrent ? resConcurrent[slotIdx] : null;
          const isConcurrent = typeof cInfo === 'boolean' ? cInfo : !!(cInfo && cInfo.isConcurrent);
          const partnerIds = (typeof cInfo === 'object' && cInfo) ? (cInfo.partnerIds || []) : [];
          const partners = partnerIds.map(pid => {
            const ps = staffMap.get(pid);
            return ps ? { id: ps.id, name: ps.name, nickname: ps.nickname } : { id: pid, name: pid };
          });

          res.assignedAssistants[slotIdx] = staff 
            ? { name: staff.name, id: staff.id, nickname: staff.nickname, isConcurrent, partners } 
            : { name: astId, id: astId, isConcurrent, partners };
        }
      }
    });

    // --- スタッフ統計（空き時間・隙間時間）の計算 ---
    const staffStats = {};
    const allStaffForStats = [...stylists, ...assistants];
    allStaffForStats.forEach(staff => {
      const staffId = staff.id;
      // 空き時間 = free_time + practice + cleaning (すべての空き・練習・大掃除の合計)
      let freeMinutes = 0;
      // 隙間時間 = 予約と予約の合間に挟まれた隙間時間
      let gapMinutes = 0;

      // 1. 空き時間合計の集計
      const staffActivities = (result.freeTimeActivities || []).filter(a => a.staffId === staffId);
      staffActivities.forEach(act => {
        const actType = act.activity || act.activityType;
        if (actType === 'rest' || actType === 'lunch') return;

        let durationMin;
        if (typeof act.startTime === 'number' && typeof act.endTime === 'number') {
          durationMin = act.endTime - act.startTime;
        } else {
          const startMs = new Date(act.startTime).getTime();
          const endMs = new Date(act.endTime).getTime();
          durationMin = (endMs - startMs) / 60000;
        }

        if (durationMin > 0) {
          freeMinutes += durationMin; // 練習・大掃除・空き時間のすべてを加算
        }
      });

      // 2. 隙間時間の集計（予約と予約、アサインの間に挟まれた隙間時間）
      const busyIntervals = [];

      // スタイリストとしての予約
      reservations.filter(r => r.stylistId === staffId).forEach(r => {
        const start = typeof r.startTime === 'number' ? r.startTime : (new Date(r.startTime).getHours() - 9) * 60 + new Date(r.startTime).getMinutes();
        const end = typeof r.endTime === 'number' ? r.endTime : (new Date(r.endTime).getHours() - 9) * 60 + new Date(r.endTime).getMinutes();
        busyIntervals.push({ start, end });
      });

      // アシスタント/ヘルプとしての配置（helperBlocks: 5分Tickマージ済み）
      if (result.helperBlocks) {
        result.helperBlocks.forEach(hb => {
          if (hb.staffId === staffId) {
            busyIntervals.push({ start: hb.startMin, end: hb.endMin });
          }
        });
      }

      // 重複・継続する予約・アサイン区間をマージ
      busyIntervals.sort((a, b) => a.start - b.start);
      const mergedBusy = [];
      busyIntervals.forEach(curr => {
        if (mergedBusy.length === 0) {
          mergedBusy.push(curr);
        } else {
          const prev = mergedBusy[mergedBusy.length - 1];
          if (curr.start <= prev.end) {
            prev.end = Math.max(prev.end, curr.end);
          } else {
            mergedBusy.push(curr);
          }
        }
      });

      // 予約と予約の合間に生じている隙間時間を集計
      if (mergedBusy.length >= 2) {
        for (let i = 0; i < mergedBusy.length - 1; i++) {
          const gap = mergedBusy[i + 1].start - mergedBusy[i].end;
          if (gap > 0) {
            gapMinutes += gap;
          }
        }
      }

      staffStats[staffId] = {
        freeMinutes: Math.round(freeMinutes),
        gapMinutes: Math.round(gapMinutes)
      };
    });

    // タイムラインと通常予約ブロックの再描画（アシスタント行と稼働率を反映）
    if (this.timeline) {
      this.timeline.render(stylists, reservations, this.currentDate, assistants, result.utilizationRates, staffStats, offStylists, offAssistants, result.manncells);
    }
    this._renderReservationBlocks(reservations, menus);

    // 予約ブロックにアシスタント配置を反映
    this.reservationBlocks.forEach(block => {
      const targetRes = reservations.find(r => r.id === block.reservation?.id);
      if (targetRes) {
        block._reservation = targetRes; // 最新データの同期
      }
      const resAssign = result.assignments[block.reservation?.id];
      const resConcurrent = result.concurrentAssignments ? result.concurrentAssignments[block.reservation?.id] : null;
      const blockAlerts = result.alerts.filter(a => a.reservationId === block.reservation?.id);
      
      const mappedAssign = {};
      if (resAssign) {
        for (const [slotIdx, astId] of Object.entries(resAssign)) {
          // マンセル（チーム制）マーカーの検出: "__manncell__::チーム名" 形式
          if (typeof astId === 'string' && astId.startsWith('__manncell__::')) {
            const manncellTeam = astId.substring('__manncell__::'.length);
            mappedAssign[slotIdx] = { 
              id: '__manncell__', 
              name: '__manncell__', 
              manncellTeam: manncellTeam  // チーム担当者名テキスト（例: "凪・らんらん"）
            };
            continue;
          }

          const staff = staffMap.get(astId);
          const cInfo = resConcurrent ? resConcurrent[slotIdx] : null;
          const isConcurrent = typeof cInfo === 'boolean' ? cInfo : !!(cInfo && cInfo.isConcurrent);
          const partnerIds = (typeof cInfo === 'object' && cInfo) ? (cInfo.partnerIds || []) : [];
          const partners = partnerIds.map(pid => {
            const ps = staffMap.get(pid);
            return ps ? { id: ps.id, name: ps.name, nickname: ps.nickname } : { id: pid, name: pid };
          });

          let displayName = staff ? staff.name : astId;
          let displayNickname = staff ? staff.nickname : null;
          
          if (staff && staff.type === 'stylist') {
            displayName = `${displayName}(ヘルプ)`;
            displayNickname = displayNickname ? `${displayNickname}(ヘルプ)` : null;
          }

          mappedAssign[slotIdx] = staff 
            ? { name: displayName, id: staff.id, nickname: displayNickname, isConcurrent, partners } 
            : { name: astId, id: astId, isConcurrent, partners };
        }
      }
      const isInManncell = result.manncells && block.reservation && result.manncells.some(m => m.reservationIds.includes(block.reservation.id));
      block.updateAssistants(mappedAssign, blockAlerts, isInManncell);
    });

    // 既存のバーチャルブロックをクリーンアップ
    this.container.querySelectorAll('.reservation-block.summon-virtual-block, .reservation-block.activity-virtual-block').forEach(el => el.remove());

    // 1. スタイリスト召喚用バーチャルブロックの描画
    const virtualMenus = [
      {
        id: "summon-menu",
        name: "召喚",
        colorCode: "#ef4444", // RED
        duration: 30
      }
    ];

    result.stylistSummons.forEach((summon, idx) => {
      // 召喚先の予約のスタイリスト名を取得
      const targetRes = reservations.find(r => r.id === summon.reservationId);
      const targetStylist = targetRes ? staffMap.get(targetRes.stylistId) : null;
      const targetName = targetStylist ? (targetStylist.nickname || targetStylist.name) : '';

      // 特殊召喚の場合はメニュー名を「特殊召喚」に変更
      const summonMenuName = summon.isSpecialSummon ? '特殊召喚' : '召喚';
      const summonColor = summon.isSpecialSummon ? '#f59e0b' : '#ef4444'; // 特殊=金色、通常=赤

      const virtualRes = {
        id: `summon-virtual-${summon.stylistId}-${idx}`,
        menuItemId: "summon-menu",
        stylistId: summon.stylistId,
        startTime: summon.startTime,
        endTime: summon.endTime,
        assignedAssistants: {},
        fixedAssistants: {},
        isVirtualSummon: true,
        isSpecialSummon: summon.isSpecialSummon || false,
        specialSummonReason: summon.specialSummonReason || null,
        summonTargetName: targetName
      };

      const timelineArea = this.container.querySelector('#timeline-area');
      if (!timelineArea) return;
      const cellsContainer = timelineArea.querySelector(
        `.timeline-row[data-stylist-id="${summon.stylistId}"] .timeline-cells`
      );
      if (!cellsContainer) return; // 描画先の行が存在しない場合は安全にスキップ（timelineAreaへのフォールバックを廃止）
      const container = cellsContainer;

      // 特殊召喚用メニューを個別作成
      const summonMenu = {
        id: "summon-menu",
        name: summonMenuName,
        colorCode: summonColor,
        duration: 30
      };

      const block = new ReservationBlock(virtualRes, summonMenu, container);
      block.render();
      
      if (block._element) {
        block._element.classList.add('summon-virtual-block');
        if (summon.isSpecialSummon) {
          block._element.classList.add('special-summon-block');
        }
      }

      this.reservationBlocks.push(block);
    });

    // 2. 空き時間活動用バーチャルブロックの描画
    const freeTimeSelections = Storage.loadFreeTimeSelections(dateStr);

    // 召喚・ヘルプブロックとの時間重複チェック用ヘルパー
    const busyTimeRanges = {};

    // 1. 自動スタイリスト召喚
    result.stylistSummons.forEach(summon => {
      if (!busyTimeRanges[summon.stylistId]) busyTimeRanges[summon.stylistId] = [];
      busyTimeRanges[summon.stylistId].push({
        start: typeof summon.startTime === 'number' ? summon.startTime : new Date(summon.startTime).getTime(),
        end: typeof summon.endTime === 'number' ? summon.endTime : new Date(summon.endTime).getTime()
      });
    });

    // 2. ヘルプ配置の時間帯（helperBlocks: 5分Tickマージ済み）
    if (result.helperBlocks) {
      result.helperBlocks.forEach(hb => {
        if (!busyTimeRanges[hb.staffId]) busyTimeRanges[hb.staffId] = [];
        busyTimeRanges[hb.staffId].push({ start: hb.startMin, end: hb.endMin });
      });
    }

    result.freeTimeActivities.forEach((act, idx) => {
      // 召喚・ヘルプブロックとの重複チェック: 重なっていたらスキップ
      const actStart = typeof act.startTime === 'number' ? act.startTime : new Date(act.startTime).getTime();
      const actEnd = typeof act.endTime === 'number' ? act.endTime : new Date(act.endTime).getTime();
      const staffBusy = busyTimeRanges[act.staffId] || [];
      const overlapsWithBusy = staffBusy.some(s => s.start < actEnd && s.end > actStart);
      if (overlapsWithBusy) return; // 召喚・ヘルプと重複する空き時間・活動はスキップ

      // free_timeブロックの場合、保存済みの選択をマージ
      const startMinutes = typeof act.startTime === 'number' ? act.startTime : null;
      const selectionKey = `${act.staffId}-${startMinutes}`;
      const savedSelection = act.activity === 'free_time' ? (freeTimeSelections[selectionKey] || null) : null;

      const virtualRes = {
        id: `activity-virtual-${act.staffId}-${idx}`,
        menuItemId: null,
        stylistId: act.staffId,
        startTime: act.startTime,
        endTime: act.endTime,
        assignedAssistants: {},
        fixedAssistants: {},
        isVirtualActivity: true,
        activityType: act.activity,
        isLunchConvertible: !!act.isLunchConvertible,
        isConvertibleToRest: !!act.isConvertibleToRest,
        freeTimeSelection: savedSelection
      };

      const timelineArea = this.container.querySelector('#timeline-area');
      if (!timelineArea) return;
      const cellsContainer = timelineArea.querySelector(
        `.timeline-row[data-stylist-id="${act.staffId}"] .timeline-cells`
      );
      const container = cellsContainer || timelineArea;

      const block = new ReservationBlock(virtualRes, null, container);
      block.render();

      if (block._element) {
        block._element.classList.add('activity-virtual-block');
      }

      this.reservationBlocks.push(block);
    });

    // 3. アシスタントヘルプ用バーチャルブロックの描画（helperBlocks: 5分Tickマージ済み）
    if (result.helperBlocks && result.helperBlocks.length > 0) {
      result.helperBlocks.forEach(hb => {
        const res = reservations.find(r => r.id === hb.resId);
        if (!res) return;
        const menu = menus.find(m => m.id === res.menuItemId);
        const colorCode = menu ? (menu.colorCode || '#6366f1') : '#6366f1';

        const stylist = staffMap.get(hb.stylistId);
        const stylistName = stylist ? (stylist.nickname || stylist.name) : '';

        const helperStaff = staffMap.get(hb.staffId);
        const isStylist = helperStaff && helperStaff.type === 'stylist';

        // startMin/endMin は9:00基準の分数なので、そのまま使える
        const virtualRes = {
          id: `helper-virtual-${hb.staffId}-${hb.resId}-${hb.slotIndex}-${hb.startMin}`,
          menuItemId: res.menuItemId,
          stylistId: hb.staffId,
          startTime: hb.startMin,
          endTime: hb.endMin,
          assignedAssistants: {},
          fixedAssistants: {},
          isVirtualActivity: true,
          activityType: 'helper',
          colorCode: isStylist ? '#f59e0b' : colorCode,
          activityLabel: isStylist ? `特殊召喚 (${stylistName}へ)` : stylistName
        };

        const timelineArea = this.container.querySelector('#timeline-area');
        if (!timelineArea) return;
        const cellsContainer = timelineArea.querySelector(
          `.timeline-row[data-stylist-id="${hb.staffId}"] .timeline-cells`
        );
        const container = cellsContainer || timelineArea;

        const block = new ReservationBlock(virtualRes, null, container);
        block.render();

        if (block._element) {
          block._element.classList.add('activity-virtual-block');
        }

        this.reservationBlocks.push(block);
      });
    }

    // スタイリスト召喚バッジ表示
    this._renderSummonBadges(result.stylistSummons, stylists);

    // アラート表示
    this._renderAlerts(result.alerts, reservations, staffMap);

    // 疲労度計算・表示
    const allStaff = [...stylists, ...assistants];
    const fatigueData = this.fatigueManager.calculate(allStaff, reservations, result);
    this._renderFatigueData(fatigueData);

    // 空き時間活動表示
    this._renderActivities(result.freeTimeActivities, allStaff);

    // タイムラインの空き人数集計行を最新情報で更新
    if (this.timeline && this.timeline.renderFreeCounts) {
      this.timeline.renderFreeCounts(stylists, reservations, this.currentDate);
    }

    if (this.staffList) {
      this.staffList.render(allAssistants, dateStr);
    }
    // アシスタントのステータス更新
    this._updateStaffStatus(result, allAssistants);

    // ピンポイントで兼任元（トム・まな等）から兼任先へ細い矢印を描画
    setTimeout(() => {
      this._renderTargetedConnectors(reservations, result);
    }, 100);

    // イベント発火
    if (window.eventBus) {
      window.eventBus.emit('summonRequested', result);
    }
  }

  /**
   * 兼任が発生している同一スタイリストの予約間（岡田さん等）でのみ、ご指定の2本の一方向矢印を描画する
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {SummonResult} result
   * @private
   */
  _renderTargetedConnectors(reservations, result) {
    const timelineArea = this.container.querySelector('#timeline-area');
    if (!timelineArea) return;

    // 既存のSVGコネクタを削除
    const oldSvg = timelineArea.querySelector('.targeted-connectors-svg');
    if (oldSvg) oldSvg.remove();

    if (!result || !result.concurrentAssignments) return;

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'targeted-connectors-svg');
    svgEl.style.position = 'absolute';
    svgEl.style.top = '0';
    svgEl.style.left = '0';
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.style.pointerEvents = 'none';
    svgEl.style.zIndex = '9';

    svgEl.innerHTML = `
      <defs>
        <marker id="targeted-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b"/>
        </marker>
        <linearGradient id="targeted-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(245, 158, 11, 0.9)"/>
          <stop offset="100%" stop-color="rgba(217, 119, 6, 0.9)"/>
        </linearGradient>
      </defs>
    `;

    const timelineRect = timelineArea.getBoundingClientRect();

    Object.entries(result.concurrentAssignments).forEach(([srcResId, slotMap]) => {
      Object.entries(slotMap).forEach(([srcSlotIdxStr, info]) => {
        if (!info || !info.isConcurrent || !info.targets || info.targets.length === 0) return;
        const srcSlotIdx = parseInt(srcSlotIdxStr, 10);

        const srcBlock = this.reservationBlocks.find(b => b.reservation?.id === srcResId);
        if (!srcBlock || !srcBlock._element) return;

        const srcSlotEl = srcBlock._element.querySelectorAll('.assistant-slot')[srcSlotIdx];
        if (!srcSlotEl) return;

        // 名前要素の中心を起点にする（なければスロット中心にフォールバック）
        const srcNameEl = srcSlotEl.querySelector('.slot-assistant');
        const srcAnchor = srcNameEl || srcSlotEl;
        const srcRect = srcAnchor.getBoundingClientRect();
        const srcX = srcRect.left - timelineRect.left + timelineArea.scrollLeft + srcRect.width / 2;
        const srcY = srcRect.top - timelineRect.top + timelineArea.scrollTop + srcRect.height / 2;

        info.targets.forEach(tgt => {
          const tgtBlock = this.reservationBlocks.find(b => b.reservation?.id === tgt.reservationId);
          if (!tgtBlock || !tgtBlock._element) return;

          // 同一スタイリストでの兼任時のみ許可
          if (srcBlock.reservation?.stylistId !== tgtBlock.reservation?.stylistId) return;

          const tgtSlotEl = tgtBlock._element.querySelectorAll('.assistant-slot')[tgt.slotIndex];
          if (!tgtSlotEl) return;

          // 名前要素の中心を終点にする
          const tgtNameEl = tgtSlotEl.querySelector('.slot-assistant');
          const tgtAnchor = tgtNameEl || tgtSlotEl;
          const tgtRect = tgtAnchor.getBoundingClientRect();
          const tgtX = tgtRect.left - timelineRect.left + timelineArea.scrollLeft + tgtRect.width / 2;
          const tgtY = tgtRect.top - timelineRect.top + timelineArea.scrollTop + tgtRect.height / 2;

          // 直線で描画
          const pathD = `M ${srcX} ${srcY} L ${tgtX} ${tgtY}`;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD);
          path.setAttribute('stroke', 'url(#targeted-grad)');
          path.setAttribute('stroke-width', '2');
          path.setAttribute('stroke-dasharray', '4,3');
          path.setAttribute('fill', 'none');
          path.setAttribute('marker-end', 'url(#targeted-arrow)');
          path.style.opacity = '0.9';

          svgEl.appendChild(path);
        });
      });
    });

    timelineArea.appendChild(svgEl);
  }

  /**
   * 召喚バッジを表示する
   * @param {Array} summons
   * @param {import('../models/staff.js').Staff[]} stylists
   * @private
   */
  _renderSummonBadges(summons, stylists) {
    const alertsArea = document.getElementById('alerts-area');
    if (!alertsArea) return;

    // 既存の召喚バッジを削除
    alertsArea.querySelectorAll('.summon-badge').forEach(el => el.remove());
    // 特殊召喚履歴もクリア
    alertsArea.querySelectorAll('.special-summon-history').forEach(el => el.remove());

    // 特殊召喚がある場合は履歴を表示
    const specialSummons = summons.filter(s => s.isSpecialSummon);
    if (specialSummons.length > 0) {
      const historySection = document.createElement('div');
      historySection.className = 'special-summon-history';
      historySection.style.cssText = [
        'margin-top: 8px',
        'padding: 8px 12px',
        'background: rgba(245,158,11,0.08)',
        'border: 1px solid rgba(245,158,11,0.3)',
        'border-radius: 8px',
        'font-size: 11px',
      ].join(';');

      const title = document.createElement('div');
      title.style.cssText = 'font-weight:700; color:#f59e0b; margin-bottom:6px;';
      title.textContent = '✨ 特殊召喚履歴';
      historySection.appendChild(title);

      specialSummons.forEach(summon => {
        const stylist = stylists.find(s => s.id === summon.stylistId);
        const stylistName = stylist ? (stylist.nickname || stylist.name) : summon.stylistId;

        // 開始時刻のHH:MM形式変換
        let timeStr = '';
        if (typeof summon.startTime === 'string' && summon.startTime.includes(':')) {
          timeStr = summon.startTime;
        } else if (typeof summon.startTime === 'number') {
          const h = 9 + Math.floor(summon.startTime / 60);
          const m = summon.startTime % 60;
          timeStr = `${h}:${String(m).padStart(2,'0')}`;
        } else if (summon.startTime) {
          const d = new Date(summon.startTime);
          if (!isNaN(d)) {
            timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
          } else {
            timeStr = String(summon.startTime); // 最後のフォールバック
          }
        }

        const reasonLabel = summon.specialSummonReason === 'lunch'
          ? 'お昼交代'
          : summon.specialSummonReason === 'rest'
            ? '休憩交代'
            : '特殊';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:8px; align-items:center; padding:2px 0; color: var(--text-secondary);';
        row.innerHTML = `
          <span style="color:#f59e0b; font-size:10px;">[特殊召喚]</span>
          <span>${stylistName}</span>
          <span style="opacity:0.6;">@${timeStr}</span>
          <span style="font-size:10px; background:rgba(245,158,11,0.2); padding:1px 6px; border-radius:4px;">${reasonLabel}</span>
        `;
        historySection.appendChild(row);
      });

      alertsArea.appendChild(historySection);
    }
  }

  /**
   * アラートを表示する
   * @param {Array} alerts
   * @param {Array} reservations
   * @param {Map} staffMap
   * @private
   */
  _renderAlerts(alerts, reservations = [], staffMap = new Map()) {
    const alertsArea = document.getElementById('alerts-area');
    if (!alertsArea) return;

    // 既存のアラートアイテムを削除
    alertsArea.querySelectorAll('.alert-item').forEach(el => el.remove());

    if (alerts.length === 0) {
      // 全配置完了
      const item = document.createElement('div');
      item.className = 'alert-item success';
      item.innerHTML = '✅ 全スロット配置完了';
      alertsArea.appendChild(item);
    } else {
      alerts.forEach(alert => {
        const res = reservations.find(r => r.id === alert.reservationId);
        let label = alert.reservationId;
        if (res) {
          const stylist = staffMap.get(res.stylistId);
          const stylistName = stylist ? (stylist.nickname || stylist.name) : '';
          // 時刻をHH:MM形式に変換
          let timeStr = '';
          if (typeof res.startTime === 'number') {
            const h = 9 + Math.floor(res.startTime / 60);
            const m = res.startTime % 60;
            timeStr = `${h}:${String(m).padStart(2, '0')}`;
          } else if (res.startTime) {
            const d = new Date(res.startTime);
            timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          label = `${stylistName} ${timeStr}`;
        }
        const item = document.createElement('div');
        item.className = 'alert-item danger';
        item.innerHTML = `⚠️ ${alert.message}（${label}）`;
        alertsArea.appendChild(item);
      });
    }
  }

  /**
   * 疲労度データを表示する
   * @param {import('../services/fatigueManager.js').FatigueData[]} fatigueData
   * @private
   */
  _renderFatigueData(fatigueData) {
    const container = document.querySelector('#fatigue-container');
    if (!container) return;

    container.innerHTML = '';

    // 全スタッフ名のマップ
    const allStaff = [
      ...Storage.loadStylists(),
      ...Storage.loadAssistants()
    ];
    const staffMap = new Map();
    allStaff.forEach(s => staffMap.set(s.id, s));

    fatigueData.forEach(data => {
      const staff = staffMap.get(data.staffId);
      const name = staff ? staff.name : data.staffId;
      const rate = Math.round(data.utilizationRate * 100);

      // 色の決定
      let color;
      if (rate >= 110) color = 'var(--accent-danger)';
      else if (rate >= 80) color = 'var(--accent-success)';
      else if (rate > 60) color = 'var(--accent-warning)';
      else color = 'var(--accent-info)';

      const item = document.createElement('div');
      item.className = 'fatigue-item';
      item.innerHTML = `
        <span class="fatigue-name" title="${name}">${name}</span>
        <div class="fatigue-gauge">
          <div class="fatigue-gauge-fill" style="width: ${rate}%; background: ${color};"></div>
        </div>
        <span class="fatigue-rate">${rate}%</span>
      `;
      container.appendChild(item);
    });

    // FatigueBarコンポーネントにもデータを渡す（全スタッフの平均値として集計して渡す）
    if (this.fatigueBar) {
      if (fatigueData && fatigueData.length > 0) {
        const totalMinutes = fatigueData.reduce((sum, d) => sum + (d.totalMinutes || 600), 0);
        const busyMinutes = fatigueData.reduce((sum, d) => sum + (d.busyMinutes || 0), 0);
        // 平均空き時間（分）を計算して3桁（最大999分）にキャップ
        const avgFreeMinutes = Math.min(999, Math.round(fatigueData.reduce((sum, d) => sum + (d.freeMinutes || 0), 0) / fatigueData.length));
        this.fatigueBar.render({
          totalMinutes,
          busyMinutes,
          freeMinutes: avgFreeMinutes
        });
      } else {
        this.fatigueBar.render({
          totalMinutes: 600,
          busyMinutes: 0,
          freeMinutes: 600
        });
      }
    }
  }

  /**
   * 空き時間活動を表示する
   * @param {Array} activities
   * @param {import('../models/staff.js').Staff[]} allStaff
   * @private
   */
  _renderActivities(activities, allStaff) {
    const container = this.container.querySelector('#activities-container');
    if (!container) return;

    container.innerHTML = '';

    const staffMap = new Map();
    allStaff.forEach(s => staffMap.set(s.id, s));

    const activityLabels = {
      practice: '練習',
      cleaning: '掃除',
      teaching: '指導練習',
      free_time: '空き時間'
    };

    if (activities.length === 0) {
      container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted);">活動なし</div>';
      return;
    }

    const list = document.createElement('ul');
    list.className = 'activity-list';

    // 上位10件のみ表示
    activities.slice(0, 10).forEach(act => {
      const staff = staffMap.get(act.staffId);
      const name = staff ? staff.name : act.staffId;
      const label = activityLabels[act.activity] || act.activity;
      const start = this._formatTime(act.startTime);
      const end = this._formatTime(act.endTime);

      const li = document.createElement('li');
      li.className = 'activity-item';
      li.innerHTML = `
        <span class="activity-badge ${act.activity}">${label}</span>
        <span>${name}</span>
        <span style="color: var(--text-muted); font-size: 11px;">${start}-${end}</span>
      `;
      list.appendChild(li);
    });

    container.appendChild(list);

    if (activities.length > 10) {
      const more = document.createElement('div');
      more.style.cssText = 'font-size: 11px; color: var(--text-muted); padding-top: 4px;';
      more.textContent = `他 ${activities.length - 10} 件`;
      container.appendChild(more);
    }
  }

  /**
   * アシスタントのステータスを更新する
   * @param {import('../services/summonEngine.js').SummonResult} result
   * @param {import('../models/staff.js').Staff[]} assistants
   * @private
   */
  _updateStaffStatus(result, assistants) {
    if (!this.staffList) return;

    assistants.forEach(assistant => {
      const fairness = result.fairnessScores[assistant.id];
      const assignmentCount = fairness?.assignmentCount || 0;
      const busyMinutes = fairness?.busyMinutes || 0;
      const freeMinutes = Math.max(0, 600 - busyMinutes);
      this.staffList.updateStatus(assistant.id, {
        assignmentCount,
        lunchTaken: assistant.breaks?.lunch?.taken || false,
        restTaken: assistant.breaks?.rest?.taken || false,
        busyMinutes,
        freeMinutes
      });
    });
  }

  /**
   * ドロップ時の処理 — メニューをタイムラインにドロップして予約を作成する
   * @param {Object} data - { stylistId, startTime, menuId }
   */
  handleReservationDrop(data) {
    const { stylistId, startTime, menuId } = data;
    if (!stylistId || !startTime || !menuId) return;

    const menus = Storage.loadMenus();
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return;

    // 予約を作成（startTimeは分数値として扱う）
    // data.startMinutes が分数値として渡される場合はそれを使用
    const startMinutes = data.startMinutes !== undefined ? data.startMinutes : 0;
    const endMinutes = startMinutes + menu.duration;

    const reservation = {
      id: `res_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      menuItemId: menuId,
      stylistId: stylistId,
      startTime: startMinutes,
      endTime: endMinutes,
      assignedAssistants: {},
      menuVariant: null
    };

    const dateStr = this._formatDate(this.currentDate);
    Storage.saveReservation(dateStr, reservation);

    // 画面をリフレッシュして召喚エンジンを再実行
    this.refresh();

    if (window.eventBus) {
      window.eventBus.emit('reservationChanged', { reservation, action: 'add' });
    }
  }

  /**
   * 予約のドラッグ移動を処理する
   * @param {Object} data - 移動データ
   */
  handleReservationMove(data) {
    const { reservationId, stylistId, startMinutes } = data;
    if (!reservationId) return;

    const dateStr = this._formatDate(this.currentDate);
    const reservations = Storage.loadReservations(dateStr);
    const reservation = reservations.find(r => r.id === reservationId);
    if (!reservation) return;

    // メニューの所要時間を取得
    const menus = Storage.loadMenus();
    const menu = menus.find(m => m.id === reservation.menuItemId);
    if (!menu) return;

    const oldStart = typeof reservation.startTime === 'number' ? reservation.startTime : 0;
    const oldEnd = typeof reservation.endTime === 'number' ? reservation.endTime : oldStart + menu.duration;
    const duration = oldEnd - oldStart;

    // 新しい位置に更新
    reservation.startTime = startMinutes;
    reservation.endTime = startMinutes + duration;
    if (stylistId) reservation.stylistId = stylistId;

    // 時間が変更された場合、固定アシスタントをリセットする
    if (oldStart !== startMinutes && reservation.fixedAssistants) {
      reservation.fixedAssistants = {};
    }

    Storage.saveReservation(dateStr, reservation);

    // 移動後: 表示更新 + 召喚再計算
    this.refresh();
    this._runSummon();

    if (window.eventBus) {
      window.eventBus.emit('reservationChanged', { reservation, action: 'move' });
    }
  }

  /**
   * 予約の削除を処理する
   * @param {Object} data - 削除データ
   */
  handleReservationDelete(data) {
    const { reservationId } = data;
    if (!reservationId) return;

    const dateStr = this._formatDate(this.currentDate);
    Storage.deleteReservation(dateStr, reservationId);
    this.refresh();

    if (window.eventBus) {
      window.eventBus.emit('reservationChanged', { reservationId, action: 'delete' });
    }
  }

  /**
   * 予約の属性変更（nonOverlapSummonEnabled等）をStorageに保存して再計算する
   * @param {{ reservationId: string, changes: Object }} data
   */
  _handleReservationUpdated(data) {
    const { reservationId, changes } = data;
    if (!reservationId || !changes) return;

    const dateStr = this._formatDate(this.currentDate);
    const reservations = Storage.loadReservations(dateStr);
    const target = reservations.find(r => r.id === reservationId);
    if (!target) return;

    // 変更内容をReservationインスタンスにマージしてStorage保存
    Object.assign(target, changes);
    Storage.saveReservation(dateStr, target);

    // 再計算（召喚ロジックを再実行）
    this._runSummon();
  }

  /**
   * 予約のリサイズ（右端ドラッグによる終了時刻変更）を処理する
   * @param {{ reservationId: string, newDuration: number }} data
   */
  _handleReservationResized(data) {
    const { reservationId, newDuration } = data;
    if (!reservationId || !newDuration) return;

    const dateStr = this._formatDate(this.currentDate);
    const reservations = Storage.loadReservations(dateStr);
    const res = reservations.find(r => r.id === reservationId);
    if (!res) return;

    const oldDuration = (typeof res.endTime === 'number' && typeof res.startTime === 'number')
      ? res.endTime - res.startTime : 60;
    if (oldDuration === newDuration || oldDuration === 0) return;

    const ratio = newDuration / oldDuration;

    // 終了時刻を更新
    res.endTime = res.startTime + newDuration;

    // 合体予約(res.items)がある場合、各アイテムのdurationもスケーリング
    if (Array.isArray(res.items) && res.items.length > 0) {
      let accumulated = 0;
      res.items.forEach((item, idx) => {
        if (idx === res.items.length - 1) {
          item.duration = Math.max(15, newDuration - accumulated);
        } else {
          const scaled = Math.max(15, Math.round((item.duration * ratio) / 15) * 15);
          item.duration = scaled;
          accumulated += scaled;
        }
      });
    }

    // アシスタントスロット時間を比率でスケーリング → slotTimeOverridesに保存
    const menus = Storage.loadMenus();
    const menu = menus.find(m => m.id === res.menuItemId);
    if (menu && menu.assistantSlots && menu.assistantSlots.length > 0) {
      if (!res.slotTimeOverrides) res.slotTimeOverrides = {};
      menu.assistantSlots.forEach((slot, idx) => {
        // 現在の有効時間（オーバーライドがあればそれ、なければメニュー定義）
        const current = res.slotTimeOverrides[idx] || {
          startMinute: slot.startMinute,
          endMinute: slot.endMinute
        };
        // 比率スケーリング（5分単位に丸める）
        const newStart = Math.round((current.startMinute * ratio) / 5) * 5;
        const newEnd   = Math.round((current.endMinute   * ratio) / 5) * 5;
        res.slotTimeOverrides[idx] = {
          startMinute: newStart,
          endMinute: Math.min(newEnd, newDuration) // 新しい総時間を超えない
        };
      });
    }

    // 固定アシスタントはそのまま維持（ユーザー指定）

    Storage.saveReservation(dateStr, res);
    this.refresh();
    this._runSummon();
  }

  /**
   * 予約クリック時の詳細表示
   * @param {string} reservationId
   */
  handleReservationClick(reservationId) {
    const dateStr = this._formatDate(this.currentDate);
    const reservations = Storage.loadReservations(dateStr);
    const reservation = reservations.find(r => r.id === reservationId);
    if (!reservation) return;

    const menus = Storage.loadMenus();
    const menu = menus.find(m => m.id === reservation.menuItemId);

    // 配置情報
    const assignInfo = this.lastSummonResult?.assignments[reservationId] || {};

    const allStaff = [
      ...Storage.loadStylists(),
      ...Storage.loadAssistants()
    ];
    const staffMap = new Map();
    allStaff.forEach(s => staffMap.set(s.id, s));

    // 詳細パネルを表示
    const existing = this.container.querySelector('.reservation-detail-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = 'reservation-detail-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-secondary);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg);
      padding: 24px;
      min-width: 320px;
      z-index: 1000;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      backdrop-filter: blur(20px);
    `;

    const stylist = staffMap.get(reservation.stylistId);
    const startStr = this._formatTime(reservation.startTime);
    const endStr = this._formatTime(reservation.endTime);

    let assignHtml = '';
    Object.entries(assignInfo).forEach(([slotIdx, assistantId]) => {
      const assistant = staffMap.get(assistantId);
      assignHtml += `<div style="font-size: 13px; color: var(--text-secondary); padding: 4px 0;">
        スロット${parseInt(slotIdx) + 1}: ${assistant ? assistant.name : assistantId}
      </div>`;
    });

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; color: var(--text-primary); font-size: 16px;">${menu ? menu.name : '不明'}</h3>
        <button class="detail-close-btn" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px;">✕</button>
      </div>
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">
        スタイリスト: ${stylist ? (stylist.nickname ? `${stylist.nickname} (${stylist.name})` : stylist.name) : '不明'}
      </div>
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
        時間: ${startStr} 〜 ${endStr}
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">アシスタント配置:</div>
      ${assignHtml || '<div style="font-size: 13px; color: var(--text-muted);">なし</div>'}
      <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
        <button class="toolbar-btn" data-detail-action="delete" style="color: var(--accent-danger);">削除</button>
        <button class="toolbar-btn detail-close-btn">閉じる</button>
      </div>
    `;

    // オーバーレイ
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999;
    `;
    overlay.addEventListener('click', () => {
      overlay.remove();
      panel.remove();
    });

    panel.querySelectorAll('.detail-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.remove();
        panel.remove();
      });
    });

    const deleteBtn = panel.querySelector('[data-detail-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const dateStr2 = this._formatDate(this.currentDate);
        Storage.deleteReservation(dateStr2, reservationId);
        overlay.remove();
        panel.remove();
        this.refresh();
        if (window.eventBus) {
          window.eventBus.emit('reservationChanged', { reservationId, action: 'delete' });
        }
      });
    }

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  }

  /**
   * 手動モードでのアシスタント選択ポップアップを表示する
   * @param {Object} data - クリックイベントデータ
   */
  _showAssistantSelector(data) {
    if (!this.isManualMode) return;

    // 既存のポップオーバーを削除
    const existing = document.querySelector('.assistant-selector-popup');
    if (existing) existing.remove();

    const dateStr = this._formatDate(this.currentDate);
    const assistants = Storage.loadAssistants().filter(a => a.isWorkingOn(dateStr));
    const stylists = Storage.loadStylists().filter(s => s.isWorkingOn(dateStr));

    // 現在の予約の主担当スタイリストIDを取得
    const reservations = Storage.loadReservations(dateStr);
    const currentRes = reservations.find(r => r.id === data.reservationId);
    const currentStylistId = currentRes ? currentRes.stylistId : null;

    // 時間変換ヘルパー (ミリ秒に統一)
    const getMillis = (time) => {
      if (typeof time === 'number') {
        if (time < 1000000) {
          const todayBase = new Date(this.currentDate);
          todayBase.setHours(9, 0, 0, 0);
          return todayBase.getTime() + time * 60000;
        }
        return time;
      }
      if (typeof time === 'string') {
        if (time.includes(':')) {
          const [h, m] = time.split(':').map(Number);
          const d = new Date(this.currentDate);
          d.setHours(h, m, 0, 0);
          return d.getTime();
        }
        return new Date(time).getTime();
      }
      return 0;
    };

    // 対象スロットの時間帯を計算
    const menus = Storage.loadMenus();
    const targetMenu = currentRes ? menus.find(m => m.id === currentRes.menuItemId) : null;
    let slotStartMs = currentRes ? getMillis(currentRes.startTime) : 0;
    let slotEndMs = currentRes ? getMillis(currentRes.endTime) : 0;

    if (currentRes && targetMenu && targetMenu.assistantSlots && targetMenu.assistantSlots[data.slotIndex]) {
      const slotDef = targetMenu.assistantSlots[data.slotIndex];
      const rStart = getMillis(currentRes.startTime);
      slotStartMs = rStart + slotDef.startMinute * 60000;
      slotEndMs = rStart + slotDef.endMinute * 60000;
    }

    const popup = document.createElement('div');
    popup.className = 'assistant-selector-popup';
    popup.style.cssText = `
      position: fixed;
      top: ${data.clientY + 10}px;
      left: ${data.clientX}px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-md);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      padding: 8px 0;
      z-index: 1000;
      max-height: 320px;
      overflow-y: auto;
      min-width: 190px;
    `;

    // 「自動（固定解除）」オプション
    const autoOption = document.createElement('div');
    autoOption.textContent = '🔄 自動（固定解除）';
    autoOption.style.cssText = `
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      color: var(--text-primary);
      border-bottom: 1px solid var(--border-glass);
    `;
    autoOption.addEventListener('mouseover', () => autoOption.style.background = 'var(--bg-hover)');
    autoOption.addEventListener('mouseout', () => autoOption.style.background = 'transparent');
    autoOption.addEventListener('click', () => {
      this._applyManualAssignment(data.reservationId, data.slotIndex, null);
      popup.remove();
    });
    popup.appendChild(autoOption);

    // 「召喚の必要がない」オプション
    const noneOption = document.createElement('div');
    noneOption.textContent = '🚫 召喚の必要がない';
    noneOption.style.cssText = `
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      color: #f87171;
      border-bottom: 1px solid var(--border-glass);
    `;
    noneOption.addEventListener('mouseover', () => noneOption.style.background = 'var(--bg-hover)');
    noneOption.addEventListener('mouseout', () => noneOption.style.background = 'transparent');
    noneOption.addEventListener('click', () => {
      this._applyManualAssignment(data.reservationId, data.slotIndex, '__none__');
      popup.remove();
    });
    popup.appendChild(noneOption);

    // --- アシスタント一覧 ---
    if (assistants.length > 0) {
      const astHeader = document.createElement('div');
      astHeader.textContent = '【 アシスタント 】';
      astHeader.style.cssText = 'padding: 4px 12px 2px 12px; font-size: 10px; color: var(--text-muted); font-weight: bold; background: rgba(255,255,255,0.03);';
      popup.appendChild(astHeader);

      assistants.forEach(a => {
        const opt = document.createElement('div');
        const isCurrent = data.currentAssistantId === a.id;
        opt.textContent = (isCurrent ? '✓ ' : '') + (a.nickname ? `${a.nickname} (${a.name})` : a.name);
        opt.style.cssText = `
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
          color: ${isCurrent ? 'var(--accent-success)' : 'var(--text-primary)'};
        `;
        opt.addEventListener('mouseover', () => opt.style.background = 'var(--bg-hover)');
        opt.addEventListener('mouseout', () => opt.style.background = 'transparent');
        opt.addEventListener('click', () => {
          this._applyManualAssignment(data.reservationId, data.slotIndex, a.id);
          popup.remove();
        });
        popup.appendChild(opt);
      });
    }

    // --- スタイリスト（特殊召喚・ヘルプ配置）一覧 ---
    if (stylists.length > 0) {
      const stHeader = document.createElement('div');
      stHeader.textContent = '【 スタイリスト (特殊召喚) 】';
      stHeader.style.cssText = 'padding: 6px 12px 2px 12px; font-size: 10px; color: #f59e0b; font-weight: bold; border-top: 1px solid var(--border-glass); background: rgba(245,158,11,0.05);';
      popup.appendChild(stHeader);

      stylists.forEach(s => {
        // 同じ時間帯に自分の主担当予約が入っているかチェック
        const hasConflictReservation = reservations.some(r => {
          if (r.stylistId !== s.id) return false;
          const rStart = getMillis(r.startTime);
          const rEnd = getMillis(r.endTime);
          return rStart < slotEndMs && rEnd > slotStartMs;
        });

        const isMainStylist = s.id === currentStylistId;
        const isCurrent = data.currentAssistantId === s.id;
        const displayName = s.nickname ? `${s.nickname} (${s.name})` : s.name;

        const opt = document.createElement('div');

        if (hasConflictReservation) {
          // 同時間帯に予約が入っているため選択不可（グレーアウト）
          opt.textContent = `⛔ ${displayName} (予約あり)`;
          opt.style.cssText = `
            padding: 6px 12px; font-size: 12px; cursor: not-allowed;
            color: var(--text-muted, #6b7280); opacity: 0.5;
          `;
          opt.title = '同時間帯に予約が入っているため特殊召喚できません';
        } else {
          opt.textContent = (isCurrent ? '✓ ' : '🌟 ') + displayName + (isMainStylist ? ' (主担当)' : '');
          opt.style.cssText = `
            padding: 6px 12px; font-size: 12px; cursor: pointer;
            color: ${isCurrent ? 'var(--accent-success)' : '#fbbf24'};
          `;
          opt.addEventListener('mouseover', () => opt.style.background = 'var(--bg-hover)');
          opt.addEventListener('mouseout', () => opt.style.background = 'transparent');
          opt.addEventListener('click', () => {
            this._applyManualAssignment(data.reservationId, data.slotIndex, s.id);
            popup.remove();
          });
        }

        popup.appendChild(opt);
      });
    }

    // 画面外クリックで閉じる
    const closeListener = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closeListener);
      }
    };
    // わずかに遅らせて登録（即時発火防止）
    setTimeout(() => document.addEventListener('click', closeListener), 10);

    document.body.appendChild(popup);
  }

  _applyManualAssignment(reservationId, slotIndex, assistantId) {
    const dateStr = this._formatDate(this.currentDate);
    const reservations = Storage.loadReservations(dateStr);
    const res = reservations.find(r => r.id === reservationId);
    if (!res) return;

    if (!res.fixedAssistants) res.fixedAssistants = {};
    
    if (assistantId === null) {
      // 固定解除
      delete res.fixedAssistants[slotIndex];
      Storage.saveReservation(dateStr, res);
      
      const block = this.reservationBlocks.find(b => b.reservation?.id === res.id);
      if (block) block._reservation = res;
      
      this._runSummon(); // 再計算
      return;
    }

    if (assistantId === '__none__') {
      // 召喚の必要がない → スロットを空にして固定
      res.fixedAssistants[slotIndex] = '__none__';
      Storage.saveReservation(dateStr, res);
      
      const block = this.reservationBlocks.find(b => b.reservation?.id === res.id);
      if (block) block._reservation = res;
      
      this._runSummon(); // 再計算
      return;
    }

    // --- 重複チェックロジック ---
    const menus = Storage.loadMenus();
    const menuMap = new Map();
    menus.forEach(m => menuMap.set(m.id, m));

    // 時間の重複チェック Helper (ミリ秒統一)
    const getMillis = (time) => {
      if (typeof time === 'number') {
        if (time < 1000000) {
          const todayBase = new Date(this.currentDate);
          todayBase.setHours(9, 0, 0, 0);
          return todayBase.getTime() + time * 60000;
        }
        return time;
      }
      if (typeof time === 'string') {
        if (time.includes(':')) {
          const [h, m] = time.split(':').map(Number);
          const d = new Date(this.currentDate);
          d.setHours(h, m, 0, 0);
          return d.getTime();
        }
        return new Date(time).getTime();
      }
      return 0;
    };
    
    // 対象スロットの時間計算
    const targetMenu = menuMap.get(res.menuItemId);
    let targetStart = 0;
    let targetEnd = 0;
    if (targetMenu && targetMenu.assistantSlots && targetMenu.assistantSlots[slotIndex]) {
      const slotDef = targetMenu.assistantSlots[slotIndex];
      const rStart = getMillis(res.startTime);
      targetStart = rStart + slotDef.startMinute * 60000;
      targetEnd = rStart + slotDef.endMinute * 60000;
    }

    // スタイリストが選択された場合、同じ時間帯に自身の主担当予約が入っていないかチェック
    const isStylistSelected = Storage.loadStylists().some(s => s.id === assistantId);
    if (isStylistSelected) {
      const hasConflict = reservations.some(r => {
        if (r.stylistId !== assistantId) return false;
        const rStartBase = getMillis(r.startTime);
        const rEndBase = getMillis(r.endTime);
        return rStartBase < targetEnd && rEndBase > targetStart;
      });
      if (hasConflict) {
        alert('選択されたスタイリストは同時間帯に自身の予約が入っているため特殊召喚できません。');
        return;
      }
    }

    // 重複する他の固定スロットを探す
    let overlapsFound = [];
    for (const otherRes of reservations) {
      if (otherRes.id === reservationId) continue; // 同じ予約はスキップ
      if (!otherRes.fixedAssistants) continue;

      for (const [otherSlotIdx, otherAstId] of Object.entries(otherRes.fixedAssistants)) {
        if (otherAstId === assistantId) {
          // このアシスタントは別の予約でも固定されている
          const otherMenu = menuMap.get(otherRes.menuItemId);
          if (otherMenu && otherMenu.assistantSlots && otherMenu.assistantSlots[otherSlotIdx]) {
            const oSlotDef = otherMenu.assistantSlots[otherSlotIdx];
            const oStartBase = toTimestamp(otherRes.startTime);
            const oStart = typeof otherRes.startTime === 'number' ? oStartBase + oSlotDef.startMinute : oStartBase + oSlotDef.startMinute * 60000;
            const oEnd = typeof otherRes.startTime === 'number' ? oStartBase + oSlotDef.endMinute : oStartBase + oSlotDef.endMinute * 60000;

            // 時間の重複チェック (A開始 < B終了 && A終了 > B開始)
            if (targetStart < oEnd && targetEnd > oStart) {
              overlapsFound.push({ res: otherRes, slotIdx: otherSlotIdx });
            }
          }
        }
      }
    }
    if (overlapsFound.length > 0) {
      const confirmSwap = window.confirm('選択したスタッフは同時間帯の別の予約にすでに固定されています。\n入れ替えて、こちらを優先させますか？');
      if (!confirmSwap) {
        return; // キャンセルした場合は何もしない
      }

      // 重複していた古い固定をすべて解除して保存（強制上書き）
      const uniqueResIds = new Set();
      for (const overlap of overlapsFound) {
        delete overlap.res.fixedAssistants[overlap.slotIdx];
        Storage.saveReservation(dateStr, overlap.res);
        uniqueResIds.add(overlap.res.id);
      }
      
      // ブロックの情報を更新
      for (const uid of uniqueResIds) {
        const blockOther = this.reservationBlocks.find(b => b.reservation?.id === uid);
        if (blockOther) {
          const updatedRes = reservations.find(r => r.id === uid);
          blockOther._reservation = updatedRes;
        }
      }
    }

    // 新しい固定割り当てを適用
    res.fixedAssistants[slotIndex] = assistantId;
    Storage.saveReservation(dateStr, res);
    
    const block = this.reservationBlocks.find(b => b.reservation?.id === res.id);
    if (block) block._reservation = res;
    
    this._runSummon(); // 再計算
  }

  /**
   * 手動調整モード切替
   * @private
   */
  toggleManualMode() {
    this.isManualMode = !this.isManualMode;

    const timelineArea = this.container.querySelector('#timeline-area');
    if (!timelineArea) return;

    // 既存オーバーレイを削除
    const existing = timelineArea.querySelector('.manual-mode-overlay');
    if (existing) existing.remove();

    if (this.isManualMode) {
      // 手動モードインジケーター表示
      const overlay = document.createElement('div');
      overlay.className = 'manual-mode-overlay';
      overlay.textContent = '📌 固定モード — アシスタントを個別に固定できます';
      timelineArea.style.position = 'relative';
      timelineArea.appendChild(overlay);

      // 「空いた人」ボタンをサイドバーに追加
      const staffSection = this.container.querySelector('#staff-list-container');
      if (staffSection) {
        const btn = document.createElement('button');
        btn.className = 'free-staff-btn';
        btn.id = 'free-staff-btn';
        btn.textContent = '👤 空いた人を表示';
        btn.addEventListener('click', () => this._showFreeStaff());
        staffSection.parentElement.insertBefore(btn, staffSection);
      }
    } else {
      // 「空いた人」ボタン削除
      const freeBtn = this.container.querySelector('#free-staff-btn');
      if (freeBtn) freeBtn.remove();
    }
  }

  /**
   * 空いている人を表示する
   * @private
   */
  _showFreeStaff() {
    const dateStr = this._formatDate(this.currentDate);
    const assistants = Storage.loadAssistants().filter(a => a.isWorkingOn(dateStr));
    const reservations = Storage.loadReservations(dateStr);

    if (!this.lastSummonResult) return;

    // 現在の時刻に空いているアシスタントを取得
    const now = new Date();
    const freeAssistants = assistants.filter(a => {
      const freeTime = this.fatigueManager.calculateFreeTime(a.id, reservations, this.lastSummonResult);
      return freeTime > 0;
    });

    // 簡易モーダル表示
    const existing = document.querySelector('.free-staff-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'free-staff-modal';
    modal.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: var(--bg-secondary); border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg); padding: 20px; min-width: 280px;
      z-index: 1000; box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    `;
    modal.innerHTML = `
      <h3 style="margin: 0 0 12px; color: var(--text-primary); font-size: 15px;">👤 空いているアシスタント</h3>
      ${freeAssistants.length === 0
        ? '<div style="color: var(--text-muted); font-size: 13px;">空いている人はいません</div>'
        : freeAssistants.map(a => `
          <div style="padding: 6px 0; font-size: 13px; color: var(--text-secondary); border-bottom: 1px solid var(--border-glass);">
            ${a.name}（空き: ${this.fatigueManager.calculateFreeTime(a.id, reservations, this.lastSummonResult)}分）
          </div>
        `).join('')
      }
      <button style="margin-top: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 6px 16px; border-radius: var(--radius-sm); cursor: pointer; font-family: inherit;" onclick="this.closest('.free-staff-modal').remove()">閉じる</button>
    `;
    document.body.appendChild(modal);
  }

  /**
   * 画面全体をリフレッシュする
   */
  refresh() {
    this._runSummon();
  }

  /**
   * ビューを破棄する
   */
  destroy() {
    // コンポーネントの破棄
    if (this.timeline) { this.timeline.destroy(); this.timeline = null; }
    if (this.menuBar) { this.menuBar.destroy(); this.menuBar = null; }
    if (this.staffList) { this.staffList.destroy(); this.staffList = null; }
    if (this.fatigueBar) { this.fatigueBar.destroy(); this.fatigueBar = null; }
    this.reservationBlocks.forEach(rb => rb.destroy());
    this.reservationBlocks = [];

    // イベントリスナー解除
    const bus = window.eventBus;
    if (bus && this._eventHandlers) {
      Object.entries(this._eventHandlers).forEach(([event, handler]) => {
        // eventBusにoff機能がある場合
        if (bus.off) bus.off(event, handler);
      });
    }

    // モーダル等のクリーンアップ
    document.querySelectorAll('.reservation-detail-panel, .free-staff-modal').forEach(el => el.remove());

    this.container.innerHTML = '';
  }

  /**
   * 日付をYYYY-MM-DD形式にフォーマットする
   * @param {Date} date
   * @returns {string}
   * @private
   */
  _formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 時刻をHH:MM形式にフォーマットする
   * @param {Date|string|number} time - Date、ISO文字列、または営業開始(9:00)からの分数値
   * @returns {string}
   * @private
   */
  _formatTime(time) {
    if (typeof time === 'number') {
      // 分数値（9:00基準）
      const hours = Math.floor(time / 60) + 9;
      const mins = time % 60;
      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
    const d = new Date(time);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * 空き時間モーダルを開く
   * @param {Object} data - openFreeTimeModalイベントデータ
   * @private
   */
  _openFreeTimeModal(data) {
    // スタッフ名を取得
    const stylists = Storage.loadStylists();
    const assistants = Storage.loadAssistants();
    const allStaff = [...stylists, ...assistants];
    const staff = allStaff.find(s => s.id === data.staffId);
    const staffName = staff ? (staff.nickname || staff.name) : data.staffId;

    if (!this.freeTimeModal) {
      this.freeTimeModal = new FreeTimeModal(document.body);
    }

    this.freeTimeModal.open({
      staffId: data.staffId,
      staffName,
      startMinutes: data.startMinutes,
      endMinutes: data.endMinutes,
      blockId: data.blockId,
      currentSelection: data.currentSelection,
      isConvertibleToRest: !!data.isConvertibleToRest
    });
  }

  /**
   * 空き時間の活動選択結果を保存し、ブロック表示を更新する
   * @param {Object} data - freeTimeActivitySelectedイベントデータ
   * @private
   */
  _handleFreeTimeSelection(data) {
    const dateStr = this._formatDate(this.currentDate);
    const selections = Storage.loadFreeTimeSelections(dateStr);
    const key = `${data.staffId}-${data.startMinutes}`;

    if (data.selection === null) {
      // クリア
      delete selections[key];
    } else {
      selections[key] = data.selection;
    }

    Storage.saveFreeTimeSelections(dateStr, selections);

    // ブロック表示を更新（全体再描画）
    this._runSummon();
  }

  /**
   * メニュー組み込み/掛け持ち選択モーダルを表示する
   * @param {Object} data - { menuId, reservationId, stylistId, startTime, startMinutes }
   * @private
   */
  _showMenuCombineModal(data) {
    const existing = document.querySelector('.menu-combine-modal-overlay');
    if (existing) existing.remove();

    const dateStr = this._formatDate(this.currentDate);
    const reservations = Storage.loadReservations(dateStr);
    const targetRes = reservations.find(r => r.id === data.reservationId);
    if (!targetRes) return;

    const menus = Storage.loadMenus();
    const newMenu = menus.find(m => m.id === data.menuId);
    const existingMenu = menus.find(m => m.id === targetRes.menuItemId);
    if (!newMenu) return;

    const overlay = document.createElement('div');
    overlay.className = 'menu-combine-modal-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(4px);
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--bg-secondary, #1a1d2e); border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
      border-radius: 12px; padding: 28px; min-width: 360px; max-width: 460px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    `;

    // タイトル
    const title = document.createElement('div');
    title.style.cssText = 'font-size: 16px; font-weight: 700; margin-bottom: 16px; color: var(--text-primary, #fff); text-align: center;';
    title.textContent = 'このメニューに組み込みますか？';
    modal.appendChild(title);

    // メニュー情報表示
    const infoBox = document.createElement('div');
    infoBox.style.cssText = `
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px; padding: 12px; margin-bottom: 20px; font-size: 13px;
      color: var(--text-secondary, #9ca3af); line-height: 1.6;
    `;
    let existingName = '不明';
    if (Array.isArray(targetRes.items) && targetRes.items.length > 0) {
      existingName = targetRes.items.map(item => {
        const m = menus.find(x => x.id === item.menuItemId);
        return m ? m.name : '不明';
      }).join(' + ');
    } else {
      existingName = existingMenu ? existingMenu.name : '不明';
    }
    infoBox.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <span style="font-size: 11px; background: rgba(99,102,241,0.2); color: #818cf8; padding: 2px 8px; border-radius: 4px;">既存</span>
        <strong style="color: var(--text-primary, #fff);">${existingName}</strong>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11px; background: rgba(16,185,129,0.2); color: #34d399; padding: 2px 8px; border-radius: 4px;">追加</span>
        <strong style="color: var(--text-primary, #fff);">${newMenu.name}</strong>
        <span style="font-size: 11px; color: var(--text-muted);">(${newMenu.duration}分)</span>
      </div>
    `;
    modal.appendChild(infoBox);

    // ボタン群
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

    // 「はい」→ 前後選択
    const yesLabel = document.createElement('div');
    yesLabel.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 2px;';
    yesLabel.textContent = '▼ 組み込む（連続して繋げる）';
    btnContainer.appendChild(yesLabel);

    const connectRow = document.createElement('div');
    connectRow.style.cssText = 'display: flex; gap: 10px;';

    const beforeBtn = document.createElement('button');
    beforeBtn.textContent = '⬅ 前に繋げる';
    beforeBtn.style.cssText = `
      flex: 1; background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 12px 16px; border-radius: 8px; font-size: 14px; cursor: pointer;
      font-family: inherit; font-weight: 600; transition: all 0.2s;
    `;
    beforeBtn.addEventListener('mouseenter', () => { beforeBtn.style.background = 'rgba(99, 102, 241, 0.3)'; });
    beforeBtn.addEventListener('mouseleave', () => { beforeBtn.style.background = 'rgba(99, 102, 241, 0.15)'; });
    beforeBtn.addEventListener('click', () => {
      this._combineMenu(data, targetRes, newMenu, 'before');
      overlay.remove();
    });

    const afterBtn = document.createElement('button');
    afterBtn.textContent = '後ろに繋げる ➡';
    afterBtn.style.cssText = `
      flex: 1; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 12px 16px; border-radius: 8px; font-size: 14px; cursor: pointer;
      font-family: inherit; font-weight: 600; transition: all 0.2s;
    `;
    afterBtn.addEventListener('mouseenter', () => { afterBtn.style.background = 'rgba(16, 185, 129, 0.3)'; });
    afterBtn.addEventListener('mouseleave', () => { afterBtn.style.background = 'rgba(16, 185, 129, 0.15)'; });
    afterBtn.addEventListener('click', () => {
      this._combineMenu(data, targetRes, newMenu, 'after');
      overlay.remove();
    });

    connectRow.appendChild(beforeBtn);
    connectRow.appendChild(afterBtn);
    btnContainer.appendChild(connectRow);

    // 区切り線
    const divider = document.createElement('div');
    divider.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.08); margin: 6px 0;';
    btnContainer.appendChild(divider);

    // 「いいえ（掛け持ち）」
    const noBtn = document.createElement('button');
    noBtn.textContent = '掛け持ちとして配置する';
    noBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.05); color: var(--text-secondary, #9ca3af); border: 1px solid rgba(255,255,255,0.1);
      padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer;
      font-family: inherit; font-weight: 500; transition: all 0.2s;
    `;
    noBtn.addEventListener('mouseenter', () => { noBtn.style.background = 'rgba(255, 255, 255, 0.1)'; });
    noBtn.addEventListener('mouseleave', () => { noBtn.style.background = 'rgba(255, 255, 255, 0.05)'; });
    noBtn.addEventListener('click', () => {
      // 掛け持ち: 従来通りreservationDroppedイベントを発火
      if (window.eventBus) {
        window.eventBus.emit('reservationDropped', {
          stylistId: data.stylistId,
          startTime: data.startTime,
          startMinutes: data.startMinutes,
          menuId: data.menuId
        });
      }
      overlay.remove();
    });
    btnContainer.appendChild(noBtn);

    // キャンセル
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = `
      background: transparent; color: var(--text-muted, #6b7280); border: none;
      padding: 8px 16px; font-size: 12px; cursor: pointer;
      font-family: inherit; transition: color 0.2s;
    `;
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.color = 'var(--text-primary)'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.color = 'var(--text-muted)'; });
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnContainer.appendChild(cancelBtn);

    modal.appendChild(btnContainer);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /**
   * メニューを前後に繋げて新規予約を作成する
   * @param {Object} data - ドロップイベントデータ
   * @param {Object} targetRes - 対象の既存予約
   * @param {Object} newMenu - 追加するメニュー
   * @param {'before'|'after'} position - 前 or 後
   * @private
   */
  _combineMenu(data, targetRes, newMenu, position) {
    const dateStr = this._formatDate(this.currentDate);
    const menus = Storage.loadMenus();

    // 既存予約のitemsを準備
    let items = targetRes.items ? [...targetRes.items] : [];
    if (items.length === 0) {
      const origDuration = (typeof targetRes.endTime === 'number' && typeof targetRes.startTime === 'number')
        ? (targetRes.endTime - targetRes.startTime)
        : 60;
      items.push({ menuItemId: targetRes.menuItemId, duration: origDuration });
    }

    const newItem = { menuItemId: newMenu.id, duration: newMenu.duration };

    if (position === 'before') {
      items.unshift(newItem);
      const newStart = targetRes.startTime - newMenu.duration;
      targetRes.startTime = Math.max(0, newStart);
    } else {
      items.push(newItem);
      targetRes.endTime = targetRes.endTime + newMenu.duration;
    }

    targetRes.items = items;

    Storage.saveReservation(dateStr, targetRes);
    this._runSummon();

    if (window.eventBus) {
      window.eventBus.emit('reservationChanged', { reservation: targetRes, action: 'update' });
    }
  }

  /**
   * 当日の予約データリセット確認モーダルを表示する
   * @private
   */
  _showResetDayConfirmation() {
    const existing = document.querySelector('.reset-day-modal-overlay');
    if (existing) existing.remove();

    const dateStr = this._formatDate(this.currentDate);
    const d = this.currentDate;
    const displayDate = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

    const overlay = document.createElement('div');
    overlay.className = 'reset-day-modal-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(4px);
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--bg-secondary, #1a1d2e); border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 12px; padding: 28px; min-width: 360px; max-width: 440px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 30px rgba(239, 68, 68, 0.1);
    `;

    // 警告アイコン
    const iconRow = document.createElement('div');
    iconRow.style.cssText = 'text-align: center; font-size: 40px; margin-bottom: 12px;';
    iconRow.textContent = '⚠️';
    modal.appendChild(iconRow);

    // タイトル
    const title = document.createElement('div');
    title.style.cssText = 'font-size: 16px; font-weight: 700; margin-bottom: 8px; color: #f87171; text-align: center;';
    title.textContent = '当日データのリセット';
    modal.appendChild(title);

    // 説明文
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size: 13px; color: var(--text-secondary, #9ca3af); text-align: center; margin-bottom: 20px; line-height: 1.6;';
    desc.innerHTML = `<strong style="color: var(--text-primary, #fff);">${displayDate}</strong> の予約データを<br>すべて削除します。<br><span style="font-size: 11px; color: #f87171;">※ この操作は取り消せません</span>`;
    modal.appendChild(desc);

    // ボタン行
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 12px; justify-content: center;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = `
      background: var(--bg-tertiary, #1f2937); color: var(--text-primary, #fff); border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
      padding: 10px 28px; border-radius: 8px; font-size: 14px; cursor: pointer;
      font-family: inherit; font-weight: 600; transition: opacity 0.2s;
    `;
    cancelBtn.addEventListener('click', () => overlay.remove());

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'はい、リセットする';
    confirmBtn.style.cssText = `
      background: #ef4444; color: white; border: none;
      padding: 10px 28px; border-radius: 8px; font-size: 14px; cursor: pointer;
      font-family: inherit; font-weight: 600; transition: opacity 0.2s;
    `;
    confirmBtn.addEventListener('mouseenter', () => confirmBtn.style.opacity = '0.85');
    confirmBtn.addEventListener('mouseleave', () => confirmBtn.style.opacity = '1');
    confirmBtn.addEventListener('click', () => {
      // 当日の予約データを全削除
      const reservationKey = `sb_reservations_${dateStr}`;
      Storage.saveData(reservationKey, []);
      // 空き時間選択もクリア
      if (Storage.saveFreeTimeSelections) {
        Storage.saveFreeTimeSelections(dateStr, {});
      }
      overlay.remove();
      this.refresh();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    modal.appendChild(btnRow);

    // オーバーレイクリックでは閉じない（誤操作防止）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /**
   * スタッフの休日カレンダーモーダルを表示する
   * @param {string} staffId - スタッフID
   * @param {string} staffType - 'stylist' | 'assistant'
   * @private
   */
  _showStaffHolidayModal(staffId, staffType) {
    // 既存モーダルを削除
    const existing = document.querySelector('.staff-holiday-modal-overlay');
    if (existing) existing.remove();

    // スタッフデータを取得
    let staff;
    if (staffType === 'stylist') {
      const list = Storage.loadStylists();
      staff = list.find(s => s.id === staffId);
    } else {
      const list = Storage.loadAssistants();
      staff = list.find(s => s.id === staffId);
    }
    if (!staff) return;

    // モーダルオーバーレイ
    const overlay = document.createElement('div');
    overlay.className = 'staff-holiday-modal-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(4px);
    `;

    const modal = document.createElement('div');
    modal.className = 'staff-holiday-modal';
    modal.style.cssText = `
      background: var(--bg-secondary, #1a1d2e); border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
      border-radius: 12px; padding: 24px; min-width: 340px; max-width: 420px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    `;

    // タイトル
    const title = document.createElement('div');
    title.style.cssText = 'font-size: 16px; font-weight: 700; margin-bottom: 16px; color: var(--text-primary, #fff);';
    title.textContent = `${staff.nickname || staff.name} の出勤・休日設定`;
    modal.appendChild(title);

    // カレンダーコンテナ
    const calendarContainer = document.createElement('div');
    modal.appendChild(calendarContainer);

    // 動的インポートでStaffCalendarを使用
    import('../components/staffCalendar.js').then(({ StaffCalendar }) => {
      const calendar = new StaffCalendar(calendarContainer, staff);
      calendar.render();
    });

    // 閉じるボタン
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'margin-top: 16px; display: flex; justify-content: flex-end;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '閉じる';
    closeBtn.style.cssText = `
      background: var(--accent-primary, #6366f1); color: white; border: none;
      padding: 8px 24px; border-radius: 8px; font-size: 14px; cursor: pointer;
      font-family: inherit; font-weight: 600; transition: opacity 0.2s;
    `;
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '0.85');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '1');
    closeBtn.addEventListener('click', () => {
      // カレンダーの変更を保存
      if (staffType === 'stylist') {
        Storage.saveStylist(staff);
      } else {
        Storage.saveAssistant(staff);
      }
      overlay.remove();
      this.refresh();
    });
    btnContainer.appendChild(closeBtn);
    modal.appendChild(btnContainer);

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (staffType === 'stylist') {
          Storage.saveStylist(staff);
        } else {
          Storage.saveAssistant(staff);
        }
        overlay.remove();
        this.refresh();
      }
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }
}
