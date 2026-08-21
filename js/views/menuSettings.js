/**
 * menuSettings.js — メニュー設定画面
 *
 * メニュー（施術内容）の管理画面。
 * カード形式で各メニューを表示し、アシスタント確保時間帯をミニタイムラインで可視化する。
 * 動的にアシスタントスロットを追加・削除できるフォームを提供。
 */

import { SKILLS } from '../models/staff.js';
import * as Storage from '../services/storage.js?v=110';
import { importMenusFromDefaults } from '../services/storage.js?v=110';

export class MenuSettingsView {
  /**
   * @param {HTMLElement} container - #main-content
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {string|null} 現在編集中のメニューID */
    this._editingMenuId = null;
  }

  /**
   * メニュー設定画面を描画する
   */
  render() {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'menu-settings';
    wrapper.innerHTML = `
      <style>
        .menu-settings {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .menu-settings-header {
          padding: 20px 24px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .menu-settings-header-left h2 {
          margin: 0;
          font-size: 20px;
          color: var(--text-primary);
          font-weight: 700;
        }
        .menu-settings-header-left p {
          margin: 4px 0 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .menu-settings-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px 24px 24px;
        }

        /* メニューカードグリッド */
        .menu-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 16px;
        }

        /* メニューカード */
        .menu-card {
          background: var(--bg-glass);
          backdrop-filter: blur(12px);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-lg);
          padding: 20px;
          transition: var(--transition-fast);
        }
        .menu-card:hover {
          border-color: rgba(255, 255, 255, 0.15);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        }
        .menu-card.editing {
          border-color: var(--accent-primary);
          box-shadow: 0 0 16px rgba(99, 102, 241, 0.25);
        }
        .menu-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .menu-card-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .menu-color-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.2);
        }
        .menu-card-name {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .menu-card-short {
          font-size: 12px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 2px 8px;
          border-radius: var(--radius-sm);
          margin-left: 8px;
        }
        .menu-card-meta {
          display: flex;
          gap: 16px;
          margin-bottom: 12px;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .menu-card-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* ミニタイムラインバー */
        .mini-timeline {
          position: relative;
          height: 36px;
          background: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          margin-bottom: 12px;
          overflow: hidden;
        }
        .mini-timeline-bar {
          position: relative;
          height: 100%;
        }
        .mini-timeline-slot {
          position: absolute;
          top: 4px;
          bottom: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
          color: white;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 0 4px;
        }
        .mini-timeline-labels {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        /* スロット情報 */
        .slot-info-list {
          list-style: none;
          padding: 0;
          margin: 0 0 12px;
        }
        .slot-info-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          font-size: 12px;
          color: var(--text-secondary);
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }
        .slot-color-indicator {
          width: 10px;
          height: 10px;
          border-radius: 2px;
          flex-shrink: 0;
        }
        .slot-skill-badge {
          padding: 1px 6px;
          border-radius: 8px;
          font-size: 10px;
          background: var(--bg-tertiary);
          color: var(--text-muted);
        }

        /* カードアクション */
        .menu-card-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .card-btn {
          background: var(--bg-secondary);
          border: 1px solid var(--border-glass);
          color: var(--text-secondary);
          padding: 6px 14px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
          transition: var(--transition-fast);
        }
        .card-btn:hover {
          color: var(--text-primary);
          border-color: var(--accent-primary);
        }
        .card-btn.delete:hover {
          color: var(--accent-danger);
          border-color: var(--accent-danger);
        }

        /* 追加ボタン */
        .add-menu-btn {
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          border: none;
          color: white;
          padding: 10px 20px;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: var(--transition-fast);
        }
        .add-menu-btn:hover {
          box-shadow: 0 0 16px rgba(99, 102, 241, 0.4);
          transform: translateY(-1px);
        }

        /* インライン編集フォーム */
        .menu-inline-form {
          background: var(--bg-secondary);
          border: 1px solid var(--accent-primary);
          border-radius: var(--radius-lg);
          padding: 20px;
          animation: formSlideIn 0.2s ease-out;
        }
        @keyframes formSlideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .form-group {
          margin-bottom: 14px;
        }
        .form-label {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
          font-weight: 500;
        }
        .form-input {
          width: 100%;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-family: inherit;
          box-sizing: border-box;
          transition: var(--transition-fast);
        }
        .form-input:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
        }
        .form-input.error {
          border-color: var(--accent-danger);
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
        }
        .form-error {
          font-size: 11px;
          color: var(--accent-danger);
          margin-top: 2px;
          display: none;
        }
        .form-error.visible {
          display: block;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .form-select {
          width: 100%;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-family: inherit;
          box-sizing: border-box;
          cursor: pointer;
        }
        .form-select:focus {
          outline: none;
          border-color: var(--accent-primary);
        }

        /* カラーピッカー */
        .color-picker-wrapper {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .color-picker-input {
          width: 40px;
          height: 40px;
          border: 2px solid var(--border-glass);
          border-radius: var(--radius-sm);
          cursor: pointer;
          padding: 0;
          background: none;
        }
        .color-picker-input::-webkit-color-swatch-wrapper { padding: 2px; }
        .color-picker-input::-webkit-color-swatch { border: none; border-radius: 4px; }
        .color-preview-text {
          font-size: 12px;
          color: var(--text-muted);
          font-family: monospace;
        }

        /* スロットエディタ */
        .slots-editor {
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-md);
          padding: 12px;
          background: var(--bg-tertiary);
        }
        .slots-editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .slots-editor-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .add-slot-btn {
          background: var(--accent-info);
          border: none;
          color: white;
          padding: 4px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          transition: var(--transition-fast);
        }
        .add-slot-btn:hover {
          opacity: 0.85;
        }
        .slot-entry {
          background: var(--bg-secondary);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          margin-bottom: 8px;
          position: relative;
        }
        .slot-entry-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr auto;
          gap: 8px;
          align-items: end;
        }
        .slot-entry-label {
          font-size: 10px;
          color: var(--text-muted);
          margin-bottom: 2px;
        }
        .slot-input {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-family: inherit;
          width: 100%;
          box-sizing: border-box;
        }
        .slot-input:focus {
          outline: none;
          border-color: var(--accent-primary);
        }
        .slot-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-family: inherit;
          width: 100%;
          box-sizing: border-box;
          cursor: pointer;
        }
        .remove-slot-btn {
          background: none;
          border: 1px solid var(--border-glass);
          color: var(--accent-danger);
          width: 28px;
          height: 28px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: var(--transition-fast);
          flex-shrink: 0;
        }
        .remove-slot-btn:hover {
          background: rgba(239, 68, 68, 0.15);
          border-color: var(--accent-danger);
        }

        /* フォームアクション */
        .form-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 16px;
        }
        .form-btn {
          padding: 8px 18px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          transition: var(--transition-fast);
          border: 1px solid var(--border-glass);
        }
        .form-btn.primary {
          background: var(--accent-primary);
          color: white;
          border-color: var(--accent-primary);
        }
        .form-btn.primary:hover {
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
        }
        .form-btn.secondary {
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }
        .form-btn.secondary:hover {
          color: var(--text-primary);
        }

        /* 空状態 */
        .empty-state {
          text-align: center;
          padding: 48px 24px;
          color: var(--text-muted);
        }
        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }
        .empty-state-text {
          font-size: 14px;
        }
      </style>

      <div class="menu-settings-header">
        <div class="menu-settings-header-left">
          <h2>📋 メニュー設定</h2>
          <p>施術メニューとアシスタント確保時間帯を管理します</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="toolbar-btn" id="import-defaults-btn" title="defaults.jsonから新しいメニュー・スキルを追加します（既存データは保持）" style="font-size:11px; color: var(--accent-warning);">
            ↓ デフォルトから追加
          </button>
          <button class="add-menu-btn" id="add-menu-btn">＋ メニュー追加</button>
        </div>
      </div>

      <div class="menu-settings-body">
        <div class="menu-grid" id="menu-grid"></div>
      </div>
    `;

    this.container.appendChild(wrapper);

    // メニュー一覧を描画
    this._renderMenuGrid();

    // 追加ボタンイベント
    const addBtn = this.container.querySelector('#add-menu-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this._editingMenuId = null;
        this._showMenuForm(null);
      });
    }

    // デフォルトから追加ボタン
    const importBtn = this.container.querySelector('#import-defaults-btn');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        importBtn.textContent = '読み込み中...';
        importBtn.disabled = true;
        try {
          const result = await importMenusFromDefaults();
          const msg = result.menus === 0 && result.skills === 0
            ? 'すでにすべてのデフォルトメニューが登録されています'
            : `メニュー ${result.menus}件、スキル ${result.skills}件 を追加しました`;
          alert(msg);
          this._renderMenuGrid();
        } catch (e) {
          alert('インポートに失敗しました: ' + e.message);
        } finally {
          importBtn.textContent = '↓ デフォルトから追加';
          importBtn.disabled = false;
        }
      });
    }
  }

  /**
   * メニューグリッドを描画する
   * @private
   */
  _renderMenuGrid() {
    const gridEl = this.container.querySelector('#menu-grid');
    if (!gridEl) return;

    gridEl.innerHTML = '';

    const menus = Storage.loadMenus();

    if (menus.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">メニューが登録されていません<br>「＋ メニュー追加」ボタンから追加してください</div>
        </div>
      `;
      return;
    }

    menus.forEach(menu => {
      const card = this._createMenuCard(menu);
      gridEl.appendChild(card);
    });
  }

  /**
   * メニューカードを作成する
   * @param {import('../models/menu.js').MenuItem} menu
   * @returns {HTMLElement}
   * @private
   */
  _createMenuCard(menu) {
    const card = document.createElement('div');
    card.className = `menu-card ${this._editingMenuId === menu.id ? 'editing' : ''}`;
    card.dataset.id = menu.id;

    const colorCode = menu.colorCode || '#6366f1';
    const slots = menu.assistantSlots || [];

    // ミニタイムラインバーHTML
    const timelineHtml = this._createMiniTimeline(menu.duration, slots, colorCode);

    // スロット情報リスト
    const slotInfoHtml = slots.map((slot, idx) => {
      const skillInfo = Object.values(SKILLS).find(s => s.id === slot.requiredSkill);
      const skillLabel = skillInfo ? skillInfo.label : slot.requiredSkill || '未設定';
      const slotColor = this._getSlotColor(idx);
      return `
        <li class="slot-info-item">
          <span class="slot-color-indicator" style="background: ${slotColor};"></span>
          <span>${slot.startMinute}分〜${slot.endMinute}分</span>
          <span class="slot-skill-badge">${skillLabel}</span>
          <span style="font-size: 10px; color: var(--text-muted);">Lv${slot.requiredProficiency || 1}以上</span>
        </li>
      `;
    }).join('');

    card.innerHTML = `
      <div class="menu-card-header">
        <div class="menu-card-title">
          <span class="menu-color-dot" style="background: ${colorCode};"></span>
          <span class="menu-card-name">${this._escapeHtml(menu.name)}</span>
          ${menu.shortName ? `<span class="menu-card-short">${this._escapeHtml(menu.shortName)}</span>` : ''}
        </div>
      </div>
      <div class="menu-card-meta">
        <div class="menu-card-meta-item">⏱ ${menu.duration}分</div>
        <div class="menu-card-meta-item">👥 アシスタント ${slots.length}枠</div>
      </div>
      ${timelineHtml}
      ${slots.length > 0 ? `<ul class="slot-info-list">${slotInfoHtml}</ul>` : '<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">アシスタント不要</div>'}
      <div class="menu-card-actions">
        <button class="card-btn edit-btn">編集</button>
        <button class="card-btn delete">削除</button>
      </div>
    `;

    // 編集ボタン
    card.querySelector('.edit-btn').addEventListener('click', () => {
      this._editingMenuId = menu.id;
      this._showMenuForm(menu);
    });

    // 削除ボタン
    card.querySelector('.card-btn.delete').addEventListener('click', () => {
      if (confirm(`「${menu.name}」を削除しますか？`)) {
        Storage.deleteMenu(menu.id);
        this._renderMenuGrid();
        if (window.eventBus) window.eventBus.emit('menuChanged', { action: 'delete', id: menu.id });
      }
    });

    return card;
  }

  /**
   * ミニタイムラインバーのHTMLを生成する
   * @param {number} totalDuration - メニュー全体の時間（分）
   * @param {Array} slots - アシスタントスロット
   * @param {string} baseColor - メニュー色
   * @returns {string}
   * @private
   */
  _createMiniTimeline(totalDuration, slots, baseColor) {
    if (totalDuration <= 0) return '';

    const slotsHtml = slots.map((slot, idx) => {
      const left = (slot.startMinute / totalDuration) * 100;
      const width = ((slot.endMinute - slot.startMinute) / totalDuration) * 100;
      const color = this._getSlotColor(idx);
      const skillInfo = Object.values(SKILLS).find(s => s.id === slot.requiredSkill);
      const label = skillInfo ? skillInfo.label : '';

      return `<div class="mini-timeline-slot" style="left: ${left}%; width: ${width}%; background: ${color};" title="${slot.startMinute}分〜${slot.endMinute}分 ${label}">${label}</div>`;
    }).join('');

    // 時間ラベル（5分間隔で主要ポイント）
    const labelPoints = [];
    labelPoints.push(0);
    if (totalDuration > 30) labelPoints.push(Math.round(totalDuration / 2));
    labelPoints.push(totalDuration);

    const labelsHtml = labelPoints.map(p =>
      `<span>${p}分</span>`
    ).join('');

    return `
      <div class="mini-timeline">
        <div class="mini-timeline-bar">${slotsHtml}</div>
      </div>
      <div class="mini-timeline-labels">${labelsHtml}</div>
    `;
  }

  /**
   * スロットの色を取得する
   * @param {number} index
   * @returns {string}
   * @private
   */
  _getSlotColor(index) {
    const colors = [
      'rgba(99, 102, 241, 0.7)',   // indigo
      'rgba(16, 185, 129, 0.7)',   // emerald
      'rgba(245, 158, 11, 0.7)',   // amber
      'rgba(239, 68, 68, 0.7)',    // red
      'rgba(59, 130, 246, 0.7)',   // blue
      'rgba(139, 92, 246, 0.7)',   // violet
    ];
    return colors[index % colors.length];
  }

  /**
   * メニュー編集フォームを表示する
   * @param {import('../models/menu.js').MenuItem|null} menu
   * @private
   */
  _showMenuForm(menu) {
    const gridEl = this.container.querySelector('#menu-grid');
    if (!gridEl) return;

    // 既存フォームを削除
    const existingForm = gridEl.querySelector('.menu-inline-form');
    if (existingForm) existingForm.remove();

    const isEdit = !!menu;
    const form = document.createElement('div');
    form.className = 'menu-inline-form';
    form.style.gridColumn = '1 / -1';

    const currentSlots = isEdit && menu.assistantSlots ? [...menu.assistantSlots] : [];

    form.innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">メニュー名</label>
          <input type="text" class="form-input" id="menu-name" value="${isEdit ? this._escapeHtml(menu.name) : ''}" placeholder="例: カット＆カラー" maxlength="30" />
          <div class="form-error" id="menu-name-error">メニュー名を入力してください</div>
        </div>
        <div class="form-group">
          <label class="form-label">略称（1-3文字）</label>
          <input type="text" class="form-input" id="menu-short-name" value="${isEdit ? this._escapeHtml(menu.shortName || '') : ''}" placeholder="例: CC" maxlength="3" />
          <div class="form-error" id="menu-short-error">1〜3文字で入力してください</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">必要時間（分）</label>
          <input type="number" class="form-input" id="menu-duration" value="${isEdit ? menu.duration : '60'}" min="10" max="480" step="5" />
          <div class="form-error" id="menu-duration-error">10〜480の範囲で入力してください</div>
        </div>
        <div class="form-group">
          <label class="form-label">表示色</label>
          <div class="color-picker-wrapper">
            <input type="color" class="color-picker-input" id="menu-color" value="${isEdit && menu.colorCode ? menu.colorCode : '#6366f1'}" />
            <span class="color-preview-text" id="menu-color-text">${isEdit && menu.colorCode ? menu.colorCode : '#6366f1'}</span>
          </div>
        </div>
      </div>
      <div class="form-group">
        <div class="slots-editor">
          <div class="slots-editor-header">
            <span class="slots-editor-title">アシスタントスロット</span>
            <button class="add-slot-btn" id="add-slot-btn">＋ スロット追加</button>
          </div>
          <div id="slots-container"></div>
        </div>
      </div>
      <div class="form-actions">
        <button class="form-btn secondary" id="menu-cancel">キャンセル</button>
        <button class="form-btn primary" id="menu-save">${isEdit ? '更新' : '追加'}</button>
      </div>
    `;

    // グリッドの先頭に挿入
    gridEl.insertBefore(form, gridEl.firstChild);

    // カラーピッカーのプレビュー更新
    const colorInput = form.querySelector('#menu-color');
    const colorText = form.querySelector('#menu-color-text');
    if (colorInput && colorText) {
      colorInput.addEventListener('input', () => {
        colorText.textContent = colorInput.value;
      });
    }

    // 既存スロットを表示
    const slotsContainer = form.querySelector('#slots-container');
    currentSlots.forEach((slot, idx) => {
      this._addSlotEntry(slotsContainer, slot);
    });

    // スロット追加ボタン
    form.querySelector('#add-slot-btn').addEventListener('click', () => {
      const duration = parseInt(form.querySelector('#menu-duration').value, 10) || 60;
      this._addSlotEntry(slotsContainer, {
        startMinute: 0,
        endMinute: Math.min(30, duration),
        requiredSkill: Object.values(SKILLS)[0]?.id || '',
        requiredProficiency: 1
      });
    });

    // キャンセル
    form.querySelector('#menu-cancel').addEventListener('click', () => {
      form.remove();
      this._editingMenuId = null;
      this._renderMenuGrid();
    });

    // 保存
    form.querySelector('#menu-save').addEventListener('click', () => {
      this._saveMenu(form, isEdit ? menu.id : null);
    });

    // フォーカス
    form.querySelector('#menu-name').focus();
  }

  /**
   * スロットエントリーを追加する
   * @param {HTMLElement} container
   * @param {Object} slotData
   * @private
   */
  _addSlotEntry(container, slotData) {
    const entry = document.createElement('div');
    entry.className = 'slot-entry';

    const skillOptions = Object.values(SKILLS).map(s =>
      `<option value="${s.id}" ${slotData.requiredSkill === s.id ? 'selected' : ''}>${s.label}</option>`
    ).join('');

    const profOptions = [1,2,3,4,5].map(lv =>
      `<option value="${lv}" ${(slotData.requiredProficiency || 1) === lv ? 'selected' : ''}>Lv${lv}</option>`
    ).join('');

    entry.innerHTML = `
      <div class="slot-entry-row">
        <div>
          <div class="slot-entry-label">開始（分）</div>
          <input type="number" class="slot-input slot-start" value="${slotData.startMinute || 0}" min="0" step="5" />
        </div>
        <div>
          <div class="slot-entry-label">終了（分）</div>
          <input type="number" class="slot-input slot-end" value="${slotData.endMinute || 30}" min="0" step="5" />
        </div>
        <div>
          <div class="slot-entry-label">必要技能</div>
          <select class="slot-select slot-skill">${skillOptions}</select>
        </div>
        <div>
          <div class="slot-entry-label">習熟度</div>
          <select class="slot-select slot-prof">${profOptions}</select>
        </div>
        <div>
          <div class="slot-entry-label">&nbsp;</div>
          <button class="remove-slot-btn" title="削除">✕</button>
        </div>
      </div>
    `;

    // 削除ボタン
    entry.querySelector('.remove-slot-btn').addEventListener('click', () => {
      entry.remove();
    });

    container.appendChild(entry);
  }

  /**
   * メニューを保存する
   * @param {HTMLElement} form
   * @param {string|null} existingId
   * @private
   */
  _saveMenu(form, existingId) {
    let hasError = false;

    // メニュー名バリデーション
    const nameInput = form.querySelector('#menu-name');
    const name = nameInput.value.trim();
    const nameError = form.querySelector('#menu-name-error');
    if (!name) {
      nameInput.classList.add('error');
      nameError.classList.add('visible');
      nameError.textContent = 'メニュー名を入力してください';
      hasError = true;
    } else if (name.length > 30) {
      nameInput.classList.add('error');
      nameError.classList.add('visible');
      nameError.textContent = '30文字以内で入力してください';
      hasError = true;
    } else {
      nameInput.classList.remove('error');
      nameError.classList.remove('visible');
    }

    // 略称バリデーション
    const shortInput = form.querySelector('#menu-short-name');
    const shortName = shortInput.value.trim();
    const shortError = form.querySelector('#menu-short-error');
    if (shortName && (shortName.length < 1 || shortName.length > 3)) {
      shortInput.classList.add('error');
      shortError.classList.add('visible');
      hasError = true;
    } else {
      shortInput.classList.remove('error');
      shortError.classList.remove('visible');
    }

    // 必要時間バリデーション
    const durationInput = form.querySelector('#menu-duration');
    const duration = parseInt(durationInput.value, 10);
    const durationError = form.querySelector('#menu-duration-error');
    if (isNaN(duration) || duration < 10 || duration > 480) {
      durationInput.classList.add('error');
      durationError.classList.add('visible');
      hasError = true;
    } else {
      durationInput.classList.remove('error');
      durationError.classList.remove('visible');
    }

    if (hasError) return;

    // カラーコード
    const colorCode = form.querySelector('#menu-color').value;

    // スロット情報を収集
    const slotEntries = form.querySelectorAll('.slot-entry');
    const assistantSlots = [];
    let slotError = false;

    slotEntries.forEach(entry => {
      const startMinute = parseInt(entry.querySelector('.slot-start').value, 10);
      const endMinute = parseInt(entry.querySelector('.slot-end').value, 10);
      const requiredSkill = entry.querySelector('.slot-skill').value;
      const requiredProficiency = parseInt(entry.querySelector('.slot-prof').value, 10);

      // スロットバリデーション
      if (isNaN(startMinute) || isNaN(endMinute) || startMinute >= endMinute) {
        entry.style.borderColor = 'var(--accent-danger)';
        slotError = true;
        return;
      }
      if (endMinute > duration) {
        entry.style.borderColor = 'var(--accent-danger)';
        slotError = true;
        return;
      }
      entry.style.borderColor = '';

      assistantSlots.push({
        startMinute,
        endMinute,
        requiredSkill,
        requiredProficiency: requiredProficiency || 1
      });
    });

    if (slotError) return;

    const menuData = {
      id: existingId || `menu_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name,
      shortName: shortName || null,
      duration,
      assistantSlots,
      colorCode
    };

    Storage.saveMenu(menuData);
    this._editingMenuId = null;
    this._renderMenuGrid();

    if (window.eventBus) {
      window.eventBus.emit('menuChanged', { action: existingId ? 'update' : 'add', menu: menuData });
    }
  }

  /**
   * HTMLエスケープ
   * @param {string} str
   * @returns {string}
   * @private
   */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /**
   * ビューを破棄する
   */
  destroy() {
    this.container.innerHTML = '';
    this._editingMenuId = null;
  }
}
