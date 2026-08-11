/**
 * blockManager.js — ブロック（不在）設定のUIを管理する独立コンポーネント
 * 
 * 指定されたスタッフ・時間帯に不在ブロックを設定するモーダルUIと、
 * そのデータの保存・バリデーションを担当します。
 */

import * as Storage from '../services/storage.js?v=20';

export const blockManager = {
  mainView: null,
  modal: null,

  init(mainView) {
    this.mainView = mainView;
    if (this.modal) return; // 二重初期化（多重生成）の防止
    this._createModal();
    this._bindEvents();
  },

  _createModal() {
    this.modal = document.createElement('div');
    this.modal.id = 'block-modal';
    // オーバーレイのインラインスタイル（表示/非表示は display で制御するため最初は none）
    this.modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.5); display: none; justify-content: center; align-items: center;
      z-index: 9999;
    `;
    this.modal.innerHTML = `
      <div style="background: var(--surface-card, #1e293b); padding: 24px; border-radius: 12px; width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); color: var(--text-primary, #f8fafc);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 1.25rem;">🚫 ブロック（不在）設定</h2>
          <button id="block-modal-close" style="background: transparent; border: none; font-size: 1.5rem; color: var(--text-secondary, #94a3b8); cursor: pointer; padding: 0; line-height: 1;">&times;</button>
        </div>
        <div>
          <p style="margin-bottom:15px; font-size:0.9em; color:var(--text-secondary, #94a3b8);">
            指定したスタッフ・時間帯を不在としてマークし、アサインから除外します。
          </p>
          <div style="margin-bottom: 15px;">
            <label for="block-staff-select" style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 0.9em;">スタッフ</label>
            <select id="block-staff-select" class="form-control" style="width: 100%;"></select>
          </div>
          <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div style="flex:1;">
              <label for="block-start-time" style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 0.9em;">開始時間</label>
              <select id="block-start-time" class="form-control" style="width: 100%;"></select>
            </div>
            <div style="flex:1;">
              <label for="block-end-time" style="display: block; margin-bottom: 5px; font-weight: bold; font-size: 0.9em;">終了時間</label>
              <select id="block-end-time" class="form-control" style="width: 100%;"></select>
            </div>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button class="btn btn-secondary" id="block-modal-cancel">キャンセル</button>
          <button class="btn btn-danger" id="block-modal-save">ブロック設定</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);

    // 時間の選択肢を生成 (09:00 〜 19:00, 5分刻み)
    const startSelect = this.modal.querySelector('#block-start-time');
    const endSelect = this.modal.querySelector('#block-end-time');
    for (let h = 9; h <= 19; h++) {
      for (let m = 0; m < 60; m += 5) {
        if (h === 19 && m > 0) continue; // 19:00以降は追加しない
        const mStr = String(m).padStart(2, '0');
        const timeStr = `${String(h).padStart(2, '0')}:${mStr}`;
        const val = (h - 9) * 60 + m; // 9時基準の分数
        startSelect.appendChild(new Option(timeStr, val));
        endSelect.appendChild(new Option(timeStr, val));
      }
    }
  },

  _bindEvents() {
    const closeBtn = this.modal.querySelector('#block-modal-close');
    const cancelBtn = this.modal.querySelector('#block-modal-cancel');
    const saveBtn = this.modal.querySelector('#block-modal-save');

    const closeHandler = () => this.hide();
    closeBtn.addEventListener('click', closeHandler);
    cancelBtn.addEventListener('click', closeHandler);

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.hide();
    });

    saveBtn.addEventListener('click', () => this.save());
  },

  show() {
    this._populateStaff();
    this.modal.style.display = 'flex';
    // 初期値設定
    const startSelect = this.modal.querySelector('#block-start-time');
    const endSelect = this.modal.querySelector('#block-end-time');
    startSelect.value = "420"; // 16:00
    endSelect.value = "540"; // 18:00
  },

  hide() {
    this.modal.style.display = 'none';
  },

  _populateStaff() {
    const select = this.modal.querySelector('#block-staff-select');
    select.innerHTML = '';
    const dateStr = this.mainView._formatDate(this.mainView.currentDate);

    // スタイリスト
    const stylists = Storage.loadStylists().filter(s => s.isWorkingOn(dateStr));
    if (stylists.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'スタイリスト';
      stylists.forEach(s => {
        optgroup.appendChild(new Option(s.nickname || s.name, s.id));
      });
      select.appendChild(optgroup);
    }

    // アシスタント
    const assistants = Storage.loadAssistants().filter(a => a.isWorkingOn(dateStr));
    if (assistants.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'アシスタント';
      assistants.forEach(a => {
        optgroup.appendChild(new Option(a.nickname || a.name, a.id));
      });
      select.appendChild(optgroup);
    }
  },

  save() {
    const staffId = this.modal.querySelector('#block-staff-select').value;
    const startVal = parseInt(this.modal.querySelector('#block-start-time').value, 10);
    const endVal = parseInt(this.modal.querySelector('#block-end-time').value, 10);

    if (!staffId) {
      alert("スタッフを選択してください。");
      return;
    }
    if (startVal >= endVal) {
      alert("終了時間は開始時間より後にしてください。");
      return;
    }

    const dateStr = this.mainView._formatDate(this.mainView.currentDate);

    // バリデーション: 既に予約が入っているかチェック
    const reservations = Storage.loadReservations(dateStr);
    const hasConflict = reservations.some(res => {
      // 自分がスタイリストとして担当している予約
      if (res.stylistId === staffId) {
        const rStart = typeof res.startTime === 'number' ? res.startTime : 0;
        const rEnd = typeof res.endTime === 'number' ? res.endTime : 0;
        // 重なり判定 (9時基準の分数)
        if (startVal < rEnd && rStart < endVal) {
          return true;
        }
      }
      return false;
    });

    if (hasConflict) {
      alert("指定した時間帯にはすでに予約が入っているため、ブロックできません。\\n予約を移動してから再度設定してください。");
      return;
    }

    const blocks = Storage.loadBlockedTimes(dateStr);
    blocks.push({
      staffId: staffId,
      startTime: startVal,
      endTime: endVal
    });
    Storage.saveBlockedTimes(dateStr, blocks);

    this.hide();

    // 再計算をトリガー
    if (window.eventBus) {
      // エンジンを回すためのダミーイベント（staffChanged等でも可）
      window.eventBus.emit('staffChanged');
    }
  }
};
