/**
 * staffSettings.js — スタッフ設定画面
 *
 * スタイリストとアシスタントの管理画面。
 * 左半分にスタイリスト一覧と編集フォーム、右半分にアシスタント一覧と編集フォームを表示する。
 * グラスモーフィズムを活用したカード形式のUI。
 */

import { RANKS, SKILLS, Staff } from '../models/staff.js?v=13';
import * as Storage from '../services/storage.js?v=13';
import { StaffCalendar } from '../components/staffCalendar.js';

export class StaffSettingsView {
  /**
   * @param {HTMLElement} container - #main-content
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {string|null} 現在編集中のスタイリストID */
    this._editingStylistId = null;

    /** @type {string|null} 現在編集中のアシスタントID */
    this._editingAssistantId = null;
  }

  /**
   * 設定画面を描画する
   */
  render() {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'staff-settings';
    wrapper.innerHTML = `
      <style>
        .staff-settings {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .staff-settings-header {
          padding: 20px 24px 12px;
          flex-shrink: 0;
        }
        .staff-settings-header h2 {
          margin: 0;
          font-size: 20px;
          color: var(--text-primary);
          font-weight: 700;
        }
        .staff-settings-header p {
          margin: 4px 0 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .staff-settings-body {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          padding: 12px 24px 24px;
          flex: 1;
          overflow: hidden;
        }

        /* セクションパネル */
        .staff-section {
          background: var(--bg-glass);
          backdrop-filter: blur(12px);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .staff-section-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-glass);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .staff-section-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .staff-section-list {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }

        /* スタッフカード */
        .staff-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          margin-bottom: 8px;
          transition: var(--transition-fast);
          cursor: pointer;
        }
        .staff-card:hover {
          border-color: var(--accent-primary);
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.15);
        }
        .staff-card.editing {
          border-color: var(--accent-primary);
          box-shadow: 0 0 16px rgba(99, 102, 241, 0.25);
        }
        .staff-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 6px;
        }
        .staff-card-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .staff-card-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .status-dot.working { background: var(--accent-success); }
        .status-dot.off { background: var(--accent-danger); }
        .status-label {
          font-size: 11px;
          color: var(--text-muted);
        }
        .staff-card-info {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }
        .staff-card-actions {
          display: flex;
          gap: 6px;
          margin-top: 8px;
        }

        /* ランクバッジ */
        .rank-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .rank-badge.owner {
          background: rgba(245, 158, 11, 0.2);
          color: var(--accent-warning);
        }
        .rank-badge.top_stylist {
          background: rgba(139, 92, 246, 0.2);
          color: var(--accent-secondary);
        }
        .rank-badge.stylist {
          background: rgba(59, 130, 246, 0.2);
          color: var(--accent-info);
        }
        .rank-badge.junior {
          background: rgba(16, 185, 129, 0.2);
          color: var(--accent-success);
        }

        /* スキルバッジ */
        .skills-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 6px;
        }
        .skill-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 500;
        }
        .skill-badge.lv1 { background: rgba(239, 68, 68, 0.2); color: var(--accent-danger); }
        .skill-badge.lv2 { background: rgba(245, 158, 11, 0.2); color: var(--accent-warning); }
        .skill-badge.lv3 { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        .skill-badge.lv4 { background: rgba(132, 204, 22, 0.2); color: #84cc16; }
        .skill-badge.lv5 { background: rgba(16, 185, 129, 0.2); color: var(--accent-success); }

        /* 追加ボタン */
        .add-staff-btn {
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          border: none;
          color: white;
          padding: 8px 16px;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: var(--transition-fast);
        }
        .add-staff-btn:hover {
          box-shadow: 0 0 16px rgba(99, 102, 241, 0.4);
          transform: translateY(-1px);
        }

        /* 編集・削除ボタン */
        .card-btn {
          background: var(--bg-secondary);
          border: 1px solid var(--border-glass);
          color: var(--text-secondary);
          padding: 4px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 11px;
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

        /* インライン編集フォーム */
        .inline-form {
          background: var(--bg-secondary);
          border: 1px solid var(--accent-primary);
          border-radius: var(--radius-md);
          padding: 16px;
          margin-bottom: 8px;
          animation: formSlideIn 0.2s ease-out;
        }
        @keyframes formSlideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .form-group {
          margin-bottom: 12px;
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

        /* トグルスイッチ */
        .toggle-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toggle-switch {
          position: relative;
          width: 40px;
          height: 22px;
          background: var(--bg-tertiary);
          border-radius: 11px;
          cursor: pointer;
          transition: var(--transition-fast);
          border: 1px solid var(--border-glass);
        }
        .toggle-switch.active {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
        }
        .toggle-switch::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          background: white;
          border-radius: 50%;
          transition: var(--transition-fast);
        }
        .toggle-switch.active::after {
          left: 20px;
        }
        .toggle-label {
          font-size: 12px;
          color: var(--text-secondary);
        }

        /* チェックボックスグループ */
        .checkbox-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .checkbox-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .checkbox-item input[type="checkbox"] {
          accent-color: var(--accent-primary);
          width: 16px;
          height: 16px;
        }
        .checkbox-item label {
          font-size: 12px;
          color: var(--text-secondary);
          cursor: pointer;
        }

        /* スキル習熟度スライダー */
        .proficiency-group {
          margin-top: 8px;
        }
        .proficiency-item {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .proficiency-label {
          font-size: 12px;
          color: var(--text-secondary);
          min-width: 80px;
        }
        .proficiency-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-glass);
          color: var(--text-primary);
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
        }
        .proficiency-value {
          font-size: 12px;
          color: var(--text-muted);
          min-width: 24px;
        }

        /* フォームアクション */
        .form-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 16px;
        }
        .form-btn {
          padding: 8px 16px;
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
      </style>

      <div class="staff-settings-header">
        <h2>👥 スタッフ設定</h2>
        <p>スタイリストとアシスタントの情報を管理します</p>
      </div>

      <div class="staff-settings-body">
        <!-- スタイリスト側 -->
        <div class="staff-section" id="stylist-section">
          <div class="staff-section-header">
            <span class="staff-section-title">💇 スタイリスト</span>
            <button class="add-staff-btn" id="add-stylist-btn">＋ 追加</button>
          </div>
          <div class="staff-section-list" id="stylist-list"></div>
        </div>

        <!-- アシスタント側 -->
        <div class="staff-section" id="assistant-section">
          <div class="staff-section-header">
            <span class="staff-section-title">🤝 アシスタント</span>
            <button class="add-staff-btn" id="add-assistant-btn">＋ 追加</button>
          </div>
          <div class="staff-section-list" id="assistant-list"></div>
        </div>
      </div>
    `;

    this.container.appendChild(wrapper);

    // データを読み込んでリスト表示
    this._renderStylistList();
    this._renderAssistantList();

    // イベントバインド
    this._bindAddButtons();
  }

  /**
   * 追加ボタンのイベントをバインドする
   * @private
   */
  _bindAddButtons() {
    const addStylistBtn = this.container.querySelector('#add-stylist-btn');
    if (addStylistBtn) {
      addStylistBtn.addEventListener('click', () => {
        this._editingStylistId = null;
        this._showStylistForm(null);
      });
    }

    const addAssistantBtn = this.container.querySelector('#add-assistant-btn');
    if (addAssistantBtn) {
      addAssistantBtn.addEventListener('click', () => {
        this._editingAssistantId = null;
        this._showAssistantForm(null);
      });
    }
  }

  /**
   * スタイリスト一覧を描画する
   * @private
   */
  _renderStylistList() {
    const listEl = this.container.querySelector('#stylist-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    const stylists = Storage.loadStylists();
    if (stylists.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">スタイリストが登録されていません</div>';
      return;
    }

    stylists.forEach(stylist => {
      const card = this._createStylistCard(stylist);
      listEl.appendChild(card);
    });
  }

  /**
   * スタイリストカードを作成する
   * @param {import('../models/staff.js').Staff} stylist
   * @returns {HTMLElement}
   * @private
   */
  _createStylistCard(stylist) {
    const card = document.createElement('div');
    card.className = `staff-card ${this._editingStylistId === stylist.id ? 'editing' : ''}`;
    card.dataset.id = stylist.id;

    // ランク情報
    const rankInfo = Object.values(RANKS).find(r => r.id === stylist.rank);
    const rankLabel = rankInfo ? rankInfo.label : '不明';
    const rankClass = stylist.rank || 'stylist';

    card.innerHTML = `
      <div class="staff-card-top">
        <span class="staff-card-name">${this._escapeHtml(stylist.name)}${stylist.nickname ? ` (${this._escapeHtml(stylist.nickname)})` : ''}</span>
        <div class="staff-card-status">
          <span class="status-dot ${stylist.isWorking ? 'working' : 'off'}"></span>
          <span class="status-label">${stylist.isWorking ? '出勤' : '休み'}</span>
        </div>
      </div>
      <div class="staff-card-info">
        <span class="rank-badge ${rankClass}">${rankLabel}</span>
        <span style="margin-left: 6px; font-size: 11px; color: var(--text-secondary);">🕒 ${stylist.workStartTime || '09:00'}〜${stylist.workEndTime || '19:00'}</span>
        ${stylist.canDoubleBook ? '<span style="margin-left: 6px; font-size: 11px; color: var(--accent-info);">🔀 掛け持ち可</span>' : ''}
        ${stylist.prioritySummon ? '<span style="margin-left: 6px; font-size: 11px; color: #f59e0b;">⭐ 優先召喚</span>' : ''}
      </div>
      <div class="staff-card-actions">
        <button class="card-btn holiday-btn">休み</button>
        <button class="card-btn edit-btn">編集</button>
        <button class="card-btn delete">削除</button>
      </div>
    `;

    // 編集ボタン
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._editingStylistId = stylist.id;
      this._showStylistForm(stylist);
    });

    // 削除ボタン
    card.querySelector('.card-btn.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`「${stylist.name}」を削除しますか？`)) {
        Storage.deleteStylist(stylist.id);
        this._renderStylistList();
        if (window.eventBus) window.eventBus.emit('staffChanged', { action: 'delete', id: stylist.id });
      }
    });

    return card;
  }

  /**
   * スタイリスト編集フォームを表示する
   * @param {import('../models/staff.js').Staff|null} stylist - 編集対象（nullなら新規追加）
   * @private
   */
  _showStylistForm(stylist) {
    const listEl = this.container.querySelector('#stylist-list');
    if (!listEl) return;

    // 既存フォームを削除
    const existingForm = listEl.querySelector('.inline-form');
    if (existingForm) existingForm.remove();

    const isEdit = !!stylist;
    const form = document.createElement('div');
    form.className = 'inline-form';

    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">名前（フルネーム）</label>
        <input type="text" class="form-input" id="stylist-name" value="${isEdit ? this._escapeHtml(stylist.name) : ''}" placeholder="例: 山田太郎" maxlength="20" />
        <div class="form-error" id="stylist-name-error">名前を入力してください</div>
      </div>
      <div class="form-group">
        <label class="form-label">ニックネーム（最大4文字・予約表の表示用）</label>
        <input type="text" class="form-input" id="stylist-nickname" value="${isEdit && stylist.nickname ? this._escapeHtml(stylist.nickname) : ''}" placeholder="例: やまだ (省略時はフルネームを表示)" maxlength="4" />
        <div class="form-error" id="stylist-nickname-error">ニックネームは4文字以内で入力してください</div>
      </div>
      <div class="form-group">
        <label class="form-label">ランク</label>
        <select class="form-select" id="stylist-rank">
          ${Object.values(RANKS).map(r =>
            `<option value="${r.id}" ${isEdit && stylist.rank === r.id ? 'selected' : ''}>${r.label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">掛け持ち可否</label>
        <div class="toggle-wrapper">
          <div class="toggle-switch ${isEdit && stylist.canDoubleBook ? 'active' : ''}" id="stylist-double-book" tabindex="0" role="checkbox" aria-checked="${isEdit && stylist.canDoubleBook ? 'true' : 'false'}"></div>
          <span class="toggle-label" id="stylist-double-book-label">${isEdit && stylist.canDoubleBook ? '可能' : '不可'}</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">
          優先召喚
          <span style="font-size:10px; color:var(--text-muted); font-weight:400; margin-left:6px;">掛け持ちなしでもアシスタントを優先配置</span>
        </label>
        <div class="toggle-wrapper">
          <div class="toggle-switch ${isEdit && stylist.prioritySummon ? 'active' : ''}" id="stylist-priority-summon" tabindex="0" role="checkbox" aria-checked="${isEdit && stylist.prioritySummon ? 'true' : 'false'}"></div>
          <span class="toggle-label" id="stylist-priority-summon-label">${isEdit && stylist.prioritySummon ? 'ON' : 'OFF'}</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">基本勤務時間</label>
        <div style="display: flex; align-items: center; gap: 8px;">
          <select class="form-select" id="stylist-work-start">
            ${this._generateTimeOptions(isEdit && stylist.workStartTime ? stylist.workStartTime : '09:00')}
          </select>
          <span style="font-size: 13px; color: var(--text-secondary);">〜</span>
          <select class="form-select" id="stylist-work-end">
            ${this._generateTimeOptions(isEdit && stylist.workEndTime ? stylist.workEndTime : '19:00')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">出勤状態</label>
        <div class="toggle-wrapper">
          <div class="toggle-switch ${!isEdit || stylist.isWorking ? 'active' : ''}" id="stylist-working" tabindex="0" role="checkbox" aria-checked="${!isEdit || stylist.isWorking ? 'true' : 'false'}"></div>
          <span class="toggle-label" id="stylist-working-label">${!isEdit || stylist.isWorking ? '出勤' : '休み'}</span>
        </div>
      </div>
      <div class="form-actions">
        <button class="form-btn secondary" id="stylist-cancel">キャンセル</button>
        <button class="form-btn primary" id="stylist-save">${isEdit ? '更新' : '追加'}</button>
      </div>
    `;

    // リストの先頭に挿入
    listEl.insertBefore(form, listEl.firstChild);

    // トグルスイッチイベント
    this._setupToggle(form.querySelector('#stylist-double-book'), form.querySelector('#stylist-double-book-label'), '可能', '不可');
    this._setupToggle(form.querySelector('#stylist-priority-summon'), form.querySelector('#stylist-priority-summon-label'), 'ON', 'OFF');
    this._setupToggle(form.querySelector('#stylist-working'), form.querySelector('#stylist-working-label'), '出勤', '休み');

    // キャンセル
    form.querySelector('#stylist-cancel').addEventListener('click', () => {
      form.remove();
      this._editingStylistId = null;
      this._renderStylistList();
    });

    // 保存
    form.querySelector('#stylist-save').addEventListener('click', () => {
      this._saveStylist(form, isEdit ? stylist.id : null, isEdit ? stylist.holidays : [], isEdit ? stylist.workdays : []);
    });

    // Enter キーで保存
    form.querySelector('#stylist-name').focus();
    form.querySelector('#stylist-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveStylist(form, isEdit ? stylist.id : null, isEdit ? stylist.holidays : [], isEdit ? stylist.workdays : []);
    });
  }

  /**
   * 時刻選択用option文字列を生成する
   * @param {string} selectedTime
   * @returns {string}
   * @private
   */
  _generateTimeOptions(selectedTime = '09:00') {
    const options = [];
    for (let h = 8; h <= 21; h++) {
      for (let m of [0, 30]) {
        if (h === 21 && m === 30) break;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const isSel = timeStr === selectedTime ? 'selected' : '';
        options.push(`<option value="${timeStr}" ${isSel}>${timeStr}</option>`);
      }
    }
    return options.join('');
  }

  /**
   * スタイリストを保存する
   * @param {HTMLElement} form
   * @param {string|null} existingId
   * @param {string[]} holidays
   * @param {string[]} workdays
   * @private
   */
  _saveStylist(form, existingId, holidays = [], workdays = []) {
    const nameInput = form.querySelector('#stylist-name');
    const name = nameInput.value.trim();
    const nicknameInput = form.querySelector('#stylist-nickname');
    const nickname = nicknameInput ? nicknameInput.value.trim() : '';

    // バリデーション
    const nameError = form.querySelector('#stylist-name-error');
    if (!name) {
      nameInput.classList.add('error');
      nameError.classList.add('visible');
      nameError.textContent = '名前を入力してください';
      return;
    }
    if (name.length > 20) {
      nameInput.classList.add('error');
      nameError.classList.add('visible');
      nameError.textContent = '名前は20文字以内で入力してください';
      return;
    }
    nameInput.classList.remove('error');
    nameError.classList.remove('visible');

    const nicknameError = form.querySelector('#stylist-nickname-error');
    if (nickname.length > 4) {
      if (nicknameInput) nicknameInput.classList.add('error');
      if (nicknameError) {
        nicknameError.classList.add('visible');
        nicknameError.textContent = 'ニックネームは4文字以内で入力してください';
      }
      return;
    }
    if (nicknameInput) nicknameInput.classList.remove('error');
    if (nicknameError) nicknameError.classList.remove('visible');

    const rank = form.querySelector('#stylist-rank').value;
    const canDoubleBook = form.querySelector('#stylist-double-book').classList.contains('active');
    const prioritySummon = form.querySelector('#stylist-priority-summon')
      ? form.querySelector('#stylist-priority-summon').classList.contains('active')
      : false;
    const isWorking = form.querySelector('#stylist-working').classList.contains('active');
    const workStartTime = form.querySelector('#stylist-work-start') ? form.querySelector('#stylist-work-start').value : '09:00';
    const workEndTime = form.querySelector('#stylist-work-end') ? form.querySelector('#stylist-work-end').value : '19:00';

    const stylistData = {
      id: existingId || `stylist_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name,
      nickname: nickname || null,
      type: 'stylist',
      rank,
      isWorking,
      canDoubleBook,
      prioritySummon,
      workStartTime,
      workEndTime,
      skills: [],
      joinDate: null,
      breaks: { lunch: { taken: false, startTime: null }, rest: { taken: false, startTime: null } },
      holidays,
      workdays
    };

    Storage.saveStylist(stylistData);
    this._editingStylistId = null;
    this._renderStylistList();

    if (window.eventBus) {
      window.eventBus.emit('staffChanged', { action: existingId ? 'update' : 'add', staff: stylistData });
    }
  }

  /**
   * アシスタント一覧を描画する
   * @private
   */
  _renderAssistantList() {
    const listEl = this.container.querySelector('#assistant-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    const assistants = Storage.loadAssistants();
    if (assistants.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">アシスタントが登録されていません</div>';
      return;
    }

    assistants.forEach(assistant => {
      const card = this._createAssistantCard(assistant);
      listEl.appendChild(card);
    });
  }

  /**
   * アシスタントカードを作成する
   * @param {import('../models/staff.js').Staff} assistant
   * @returns {HTMLElement}
   * @private
   */
  _createAssistantCard(assistant) {
    const card = document.createElement('div');
    card.className = `staff-card ${this._editingAssistantId === assistant.id ? 'editing' : ''}`;
    card.dataset.id = assistant.id;

    // スキルバッジ生成
    const skillsHtml = (assistant.skills || []).map(skill => {
      const skillId = typeof skill === 'object' ? skill.id : skill;
      const prof = typeof skill === 'object' ? (skill.proficiency || 1) : 1;
      const skillInfo = Object.values(SKILLS).find(s => s.id === skillId);
      const label = skillInfo ? skillInfo.label : skillId;
      return `<span class="skill-badge lv${prof}">${label} Lv${prof}</span>`;
    }).join('');

    // 入社日フォーマット
    const joinDateStr = assistant.joinDate
      ? new Date(assistant.joinDate).toLocaleDateString('ja-JP')
      : '未設定';

    card.innerHTML = `
      <div class="staff-card-top">
        <span class="staff-card-name">${this._escapeHtml(assistant.name)}${assistant.nickname ? ` (${this._escapeHtml(assistant.nickname)})` : ''}</span>
        <div class="staff-card-status">
          <span class="status-dot ${assistant.isWorking ? 'working' : 'off'}"></span>
          <span class="status-label">${assistant.isWorking ? '出勤' : '休み'}</span>
        </div>
      </div>
      <div class="staff-card-info">
        入社日: ${joinDateStr}
        <span style="margin-left: 8px; font-size: 11px; color: var(--text-secondary);">🕒 ${assistant.workStartTime || '09:00'}〜${assistant.workEndTime || '19:00'}</span>
      </div>
      <div class="skills-row">${skillsHtml || '<span style="font-size: 11px; color: var(--text-muted);">スキル未設定</span>'}</div>
      <div class="staff-card-actions">
        <button class="card-btn holiday-btn">休み</button>
        <button class="card-btn edit-btn">編集</button>
        <button class="card-btn delete">削除</button>
      </div>
    `;

    // 編集ボタン
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._editingAssistantId = assistant.id;
      this._showAssistantForm(assistant);
    });

    // 削除ボタン
    card.querySelector('.card-btn.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`「${assistant.name}」を削除しますか？`)) {
        Storage.deleteAssistant(assistant.id);
        this._renderAssistantList();
        if (window.eventBus) window.eventBus.emit('staffChanged', { action: 'delete', id: assistant.id });
      }
    });

    // 休み設定ボタン
    card.querySelector('.holiday-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._showHolidayForm(assistant, 'assistant');
    });

    return card;
  }

  /**
   * アシスタント編集フォームを表示する
   * @param {import('../models/staff.js').Staff|null} assistant - 編集対象（nullなら新規追加）
   * @private
   */
  _showAssistantForm(assistant) {
    const listEl = this.container.querySelector('#assistant-list');
    if (!listEl) return;

    // 既存フォームを削除
    const existingForm = listEl.querySelector('.inline-form');
    if (existingForm) existingForm.remove();

    const isEdit = !!assistant;
    const form = document.createElement('div');
    form.className = 'inline-form';

    // 既存のスキルデータを整理
    const existingSkills = {};
    if (isEdit && assistant.skills) {
      assistant.skills.forEach(skill => {
        if (typeof skill === 'object') {
          existingSkills[skill.id] = skill.proficiency || 1;
        } else {
          existingSkills[skill] = 1;
        }
      });
    }

    // スキルチェックボックスと習熟度選択（Storage.loadSkills()で動的に取得）
    const allSkills = Storage.loadSkills();
    const skillsFormHtml = allSkills.map(skill => {
      const checked = existingSkills[skill.id] !== undefined;
      const prof = existingSkills[skill.id] || 1;
      return `
        <div class="checkbox-item">
          <input type="checkbox" id="skill-${skill.id}" value="${skill.id}" ${checked ? 'checked' : ''} />
          <label for="skill-${skill.id}">${skill.label}</label>
        </div>
        <div class="proficiency-item" id="prof-${skill.id}" style="margin-left: 24px; ${checked ? '' : 'display: none;'}">
          <span class="proficiency-label">習熟度:</span>
          <select class="proficiency-select" id="prof-select-${skill.id}">
            ${[1,2,3,4,5].map(lv => `<option value="${lv}" ${prof === lv ? 'selected' : ''}>Lv${lv}</option>`).join('')}
          </select>
        </div>
      `;
    }).join('');

    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">名前（フルネーム）</label>
        <input type="text" class="form-input" id="assistant-name" value="${isEdit ? this._escapeHtml(assistant.name) : ''}" placeholder="例: 鈴木花子" maxlength="20" />
        <div class="form-error" id="assistant-name-error">名前を入力してください</div>
      </div>
      <div class="form-group">
        <label class="form-label">ニックネーム（最大4文字・予約表の表示用）</label>
        <input type="text" class="form-input" id="assistant-nickname" value="${isEdit && assistant.nickname ? this._escapeHtml(assistant.nickname) : ''}" placeholder="例: はな (省略時はフルネームを表示)" maxlength="4" />
        <div class="form-error" id="assistant-nickname-error">ニックネームは4文字以内で入力してください</div>
      </div>
      <div class="form-group">
        <label class="form-label">入社日</label>
        <input type="date" class="form-input" id="assistant-join-date" value="${isEdit && assistant.joinDate ? new Date(assistant.joinDate).toISOString().split('T')[0] : ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">可能技術と習熟度</label>
        <div class="checkbox-group">
          ${skillsFormHtml}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">基本勤務時間</label>
        <div style="display: flex; align-items: center; gap: 8px;">
          <select class="form-select" id="assistant-work-start">
            ${this._generateTimeOptions(isEdit && assistant.workStartTime ? assistant.workStartTime : '09:00')}
          </select>
          <span style="font-size: 13px; color: var(--text-secondary);">〜</span>
          <select class="form-select" id="assistant-work-end">
            ${this._generateTimeOptions(isEdit && assistant.workEndTime ? assistant.workEndTime : '19:00')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">出勤状態</label>
        <div class="toggle-wrapper">
          <div class="toggle-switch ${!isEdit || assistant.isWorking ? 'active' : ''}" id="assistant-working" tabindex="0" role="checkbox" aria-checked="${!isEdit || assistant.isWorking ? 'true' : 'false'}"></div>
          <span class="toggle-label" id="assistant-working-label">${!isEdit || assistant.isWorking ? '出勤' : '休み'}</span>
        </div>
      </div>
      <div class="form-actions">
        <button class="form-btn secondary" id="assistant-cancel">キャンセル</button>
        <button class="form-btn primary" id="assistant-save">${isEdit ? '更新' : '追加'}</button>
      </div>
    `;

    // リストの先頭に挿入
    listEl.insertBefore(form, listEl.firstChild);

    // トグルスイッチ
    this._setupToggle(form.querySelector('#assistant-working'), form.querySelector('#assistant-working-label'), '出勤', '休み');

    // スキルチェックボックスの変更で習熟度表示を切り替え
    Storage.loadSkills().forEach(skill => {
      const checkbox = form.querySelector(`#skill-${skill.id}`);
      const profDiv = form.querySelector(`#prof-${skill.id}`);
      if (checkbox && profDiv) {
        checkbox.addEventListener('change', () => {
          profDiv.style.display = checkbox.checked ? '' : 'none';
        });
      }
    });

    // キャンセル
    form.querySelector('#assistant-cancel').addEventListener('click', () => {
      form.remove();
      this._editingAssistantId = null;
      this._renderAssistantList();
    });

    // 保存
    form.querySelector('#assistant-save').addEventListener('click', () => {
      this._saveAssistant(form, isEdit ? assistant.id : null, isEdit ? assistant.holidays : [], isEdit ? assistant.workdays : []);
    });

    // フォーカス
    form.querySelector('#assistant-name').focus();
    form.querySelector('#assistant-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveAssistant(form, isEdit ? assistant.id : null, isEdit ? assistant.holidays : [], isEdit ? assistant.workdays : []);
    });
  }

  /**
   * アシスタントを保存する
   * @param {HTMLElement} form
   * @param {string|null} existingId
   * @param {string[]} holidays
   * @param {string[]} workdays
   * @private
   */
  _saveAssistant(form, existingId, holidays = [], workdays = []) {
    const nameInput = form.querySelector('#assistant-name');
    const name = nameInput.value.trim();
    const nicknameInput = form.querySelector('#assistant-nickname');
    const nickname = nicknameInput ? nicknameInput.value.trim() : '';

    // バリデーション
    const nameError = form.querySelector('#assistant-name-error');
    if (!name) {
      nameInput.classList.add('error');
      nameError.classList.add('visible');
      nameError.textContent = '名前を入力してください';
      return;
    }
    if (name.length > 20) {
      nameInput.classList.add('error');
      nameError.classList.add('visible');
      nameError.textContent = '名前は20文字以内で入力してください';
      return;
    }
    nameInput.classList.remove('error');
    nameError.classList.remove('visible');

    const nicknameError = form.querySelector('#assistant-nickname-error');
    if (nickname.length > 4) {
      if (nicknameInput) nicknameInput.classList.add('error');
      if (nicknameError) {
        nicknameError.classList.add('visible');
        nicknameError.textContent = 'ニックネームは4文字以内で入力してください';
      }
      return;
    }
    if (nicknameInput) nicknameInput.classList.remove('error');
    if (nicknameError) nicknameError.classList.remove('visible');

    // スキル情報を収集（Storageから動的に取得）
    const skills = [];
    Storage.loadSkills().forEach(skill => {
      const checkbox = form.querySelector(`#skill-${skill.id}`);
      if (checkbox && checkbox.checked) {
        const profSelect = form.querySelector(`#prof-select-${skill.id}`);
        const proficiency = profSelect ? parseInt(profSelect.value, 10) : 1;
        skills.push({ id: skill.id, proficiency });
      }
    });

    const joinDate = form.querySelector('#assistant-join-date').value || null;
    const isWorking = form.querySelector('#assistant-working').classList.contains('active');
    const workStartTime = form.querySelector('#assistant-work-start') ? form.querySelector('#assistant-work-start').value : '09:00';
    const workEndTime = form.querySelector('#assistant-work-end') ? form.querySelector('#assistant-work-end').value : '19:00';

    const assistantData = {
      id: existingId || `assistant_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name,
      nickname: nickname || null,
      type: 'assistant',
      rank: null,
      isWorking,
      canDoubleBook: false,
      workStartTime,
      workEndTime,
      skills,
      joinDate,
      breaks: { lunch: { taken: false, startTime: null }, rest: { taken: false, startTime: null } },
      holidays,
      workdays
    };

    Storage.saveAssistant(assistantData);
    this._editingAssistantId = null;
    this._renderAssistantList();

    if (window.eventBus) {
      window.eventBus.emit('staffChanged', { action: existingId ? 'update' : 'add', staff: assistantData });
    }
  }

  /**
   * トグルスイッチを設定する
   * @param {HTMLElement} toggle
   * @param {HTMLElement} label
   * @param {string} activeText
   * @param {string} inactiveText
   * @private
   */
  _setupToggle(toggle, label, activeText, inactiveText) {
    if (!toggle) return;

    const update = () => {
      const isActive = toggle.classList.contains('active');
      label.textContent = isActive ? activeText : inactiveText;
      toggle.setAttribute('aria-checked', isActive ? 'true' : 'false');
    };

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      update();
    });

    toggle.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle.classList.toggle('active');
        update();
      }
    });
  }

  /**
   * 休日設定専用のカレンダーフォームを表示する
   * @param {import('../models/staff.js').Staff} staff
   * @param {'stylist'|'assistant'} type
   * @private
   */
  _showHolidayForm(staff, type) {
    const listEl = this.container.querySelector(type === 'stylist' ? '#stylist-list' : '#assistant-list');
    if (!listEl) return;

    // 既存フォームを削除
    const existingForm = listEl.querySelector('.inline-form');
    if (existingForm) existingForm.remove();

    const form = document.createElement('div');
    form.className = 'inline-form';
    form.innerHTML = `
      <div class="form-group" style="grid-column: 1 / -1;">
        <label class="form-label">${this._escapeHtml(staff.name)} の出勤・休日設定（クリックで切り替え）</label>
        <div id="holiday-calendar-container"></div>
      </div>
      <div class="form-actions">
        <button class="form-btn primary" id="holiday-close">閉じる</button>
      </div>
    `;

    // リストの先頭に挿入
    listEl.insertBefore(form, listEl.firstChild);

    // カレンダー描画
    const calendarContainer = form.querySelector('#holiday-calendar-container');
    const calendar = new StaffCalendar(calendarContainer, staff);
    calendar.render();

    // 閉じる
    form.querySelector('#holiday-close').addEventListener('click', () => {
      form.remove();
      // カレンダー操作はstaffオブジェクトを直接変更するので、それをそのまま保存する
      if (type === 'stylist') {
        Storage.saveStylist(staff);
        this._renderStylistList();
      } else {
        Storage.saveAssistant(staff);
        this._renderAssistantList();
      }
      if (window.eventBus) window.eventBus.emit('staffChanged', { action: 'update', staff });
    });
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
    this._editingStylistId = null;
    this._editingAssistantId = null;
  }
}
