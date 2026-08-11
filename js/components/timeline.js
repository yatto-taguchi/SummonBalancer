/**
 * @fileoverview タイムライングリッドコンポーネント
 * 予約表のメイングリッドを描画・管理する。
 * 横軸: 9:00～19:00（30分間隔 = 20カラム）
 * 縦軸: 出勤中スタイリスト
 * @module components/timeline
 */

import { RANKS } from '../models/staff.js';
import * as Storage from '../services/storage.js?v=12';
import accordionManager, { SUB_SLOT_COUNT, SUB_SLOT_MINUTES } from './accordionManager.js';

/** セル幅(px) */
const CELL_WIDTH = 80;
/** セル高さ(px) */
const CELL_HEIGHT = 72;
/** スタッフ名列の幅(px) */
const STAFF_COL_WIDTH = 135;
/** 営業開始時刻（時） */
const START_HOUR = 9;
/** 営業終了時刻（時） */
const END_HOUR = 19;
/** 1スロットの分数 */
const SLOT_MINUTES = 30;
/** 総スロット数 */
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * (60 / SLOT_MINUTES); // 20

/**
 * ランクIDから表示色を返す
 * @param {string} rankId - ランクID
 * @returns {string} 色コード
 */
function getRankColor(rankId) {
  const colors = {
    owner: '#fbbf24',
    top_stylist: '#a78bfa',
    stylist: '#60a5fa',
    junior: '#34d399'
  };
  return colors[rankId] || '#9ca3af';
}

/**
 * 稼働率に応じた表示色を返す
 * @param {number} rate - 稼働率（%）
 * @returns {string} 色コード
 */
function getUtilizationColor(rate) {
  if (rate >= 110) {
    return 'var(--accent-danger)';
  } else if (rate >= 80) {
    return 'var(--accent-success)';
  } else if (rate > 60) {
    return 'var(--accent-warning)';
  } else {
    return 'var(--accent-info)';
  }
}

/**
 * ランクIDからラベルを返す
 * @param {string} rankId - ランクID
 * @returns {string} ランクラベル
 */
function getRankLabel(rankId) {
  for (const key of Object.keys(RANKS)) {
    if (RANKS[key].id === rankId) return RANKS[key].label;
  }
  return '';
}

/**
 * スタッフ情報セル（ヘッダー列）の中身を描画する
 * @param {HTMLElement} staffInfoEl - スタッフ情報コンテナ
 * @param {import('../models/staff.js').Staff} staff - スタッフオブジェクト
 * @param {number} rate - 稼働率(%)
 * @param {Object} stats - { freeMinutes, gapMinutes }
 * @param {'stylist'|'assistant'} type - スタッフ種別
 * @param {number} index - インデックス
 * @param {number} totalCount - 総数
 * @param {AbortSignal} signal - イベントシグナル
 */
function renderStaffInfoContent(staffInfoEl, staff, rate, stats, type, index, totalCount, signal) {
  staffInfoEl.style.minWidth = `${STAFF_COL_WIDTH}px`;
  staffInfoEl.style.width = `${STAFF_COL_WIDTH}px`;
  staffInfoEl.style.padding = '6px 10px';
  staffInfoEl.style.display = 'flex';
  staffInfoEl.style.flexDirection = 'column';
  staffInfoEl.style.justifyContent = 'center';
  staffInfoEl.style.gap = '3px';
  staffInfoEl.style.boxSizing = 'border-box';
  staffInfoEl.innerHTML = '';

  // 1行目: 出勤マーク + スタッフ名 + 上下ボタン (または休みバッジ)
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%;';

  const nameBox = document.createElement('div');
  nameBox.style.cssText = 'display: flex; align-items: center; gap: 5px; min-width: 0; flex: 1;';

  const workingStatus = document.createElement('span');
  workingStatus.className = 'working-status';
  workingStatus.textContent = '●';
  workingStatus.style.cssText = `font-size: 10px; flex-shrink: 0; color: ${staff.isWorking ? 'var(--accent-success)' : 'var(--text-secondary)'};`;
  workingStatus.title = staff.isWorking ? '出勤中' : '休み';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'staff-name';
  nameSpan.textContent = staff.name;
  nameSpan.style.cssText = 'font-size: 13px; font-weight: 700; color: var(--text-primary); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
  nameSpan.addEventListener('mouseenter', () => {
    nameSpan.style.textDecoration = 'underline';
    nameSpan.style.color = 'var(--accent-primary)';
  }, { signal });
  nameSpan.addEventListener('mouseleave', () => {
    nameSpan.style.textDecoration = 'none';
    nameSpan.style.color = '';
  }, { signal });
  nameSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.eventBus) {
      window.eventBus.emit('openStaffHolidayModal', { staffId: staff.id, staffType: staff.type });
    }
  }, { signal });

  nameBox.appendChild(workingStatus);
  nameBox.appendChild(nameSpan);
  topRow.appendChild(nameBox);

  if (!staff.isWorking) {
    const offLabel = document.createElement('span');
    offLabel.textContent = '休み';
    offLabel.style.cssText = 'font-size: 10px; color: #ef4444; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: rgba(239, 68, 68, 0.15); flex-shrink: 0;';
    topRow.appendChild(offLabel);
  } else {
    const orderContainer = document.createElement('div');
    orderContainer.style.cssText = 'display: flex; flex-direction: column; line-height: 1; align-items: center; flex-shrink: 0; margin-left: 2px;';

    const upBtn = document.createElement('span');
    upBtn.textContent = '▲';
    upBtn.style.cssText = `cursor: pointer; font-size: 8px; user-select: none; ${index === 0 ? 'visibility: hidden;' : 'opacity: 0.4;'}`;
    if (index > 0) {
      upBtn.addEventListener('mouseenter', () => upBtn.style.opacity = '1');
      upBtn.addEventListener('mouseleave', () => upBtn.style.opacity = '0.4');
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.eventBus) {
          window.eventBus.emit('moveStaffOrder', { staffId: staff.id, direction: 'up', type });
        }
      });
    }

    const downBtn = document.createElement('span');
    downBtn.textContent = '▼';
    downBtn.style.cssText = `cursor: pointer; font-size: 8px; user-select: none; ${index === totalCount - 1 ? 'visibility: hidden;' : 'opacity: 0.4;'}`;
    if (index < totalCount - 1) {
      downBtn.addEventListener('mouseenter', () => downBtn.style.opacity = '1');
      downBtn.addEventListener('mouseleave', () => downBtn.style.opacity = '0.4');
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.eventBus) {
          window.eventBus.emit('moveStaffOrder', { staffId: staff.id, direction: 'down', type });
        }
      });
    }

    orderContainer.appendChild(upBtn);
    orderContainer.appendChild(downBtn);
    topRow.appendChild(orderContainer);
  }

  staffInfoEl.appendChild(topRow);

  // 出勤中の場合のみ 2行目 & 3行目を追加
  if (staff.isWorking) {
    const utilColor = getUtilizationColor(rate);

    // 2行目: 稼働率(%) + プログレスバー
    const midRow = document.createElement('div');
    midRow.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-top: 1px; width: 100%;';

    const rateSpan = document.createElement('span');
    rateSpan.className = 'staff-util';
    rateSpan.textContent = `${rate}%`;
    rateSpan.style.cssText = `font-weight: 700; font-size: 11px; color: ${utilColor}; min-width: 32px; flex-shrink: 0;`;
    midRow.appendChild(rateSpan);

    const gaugeTrack = document.createElement('div');
    gaugeTrack.className = 'staff-util-gauge-track';
    gaugeTrack.title = `稼働率: ${rate}%`;
    gaugeTrack.style.cssText = 'flex: 1; height: 5px; background: rgba(255, 255, 255, 0.2); border-radius: 3px; overflow: hidden; min-width: 45px; display: block;';
    const gaugeFill = document.createElement('div');
    gaugeFill.className = 'staff-util-gauge-fill';
    const fillWidth = Math.min(100, Math.max(0, rate));
    gaugeFill.style.cssText = `width: ${fillWidth}%; height: 100%; background: ${utilColor}; border-radius: 3px; transition: width 0.3s;`;
    gaugeTrack.appendChild(gaugeFill);
    midRow.appendChild(gaugeTrack);

    staffInfoEl.appendChild(midRow);

    // 3行目: 空き時間合計〇〇分 ＆ 隙間時間〇〇分
    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display: flex; flex-direction: column; gap: 1px; font-size: 9.5px; margin-top: 1px; width: 100%;';

    const freeMinutesVal = stats.freeMinutes || 0;
    const gapMinutesVal = stats.gapMinutes || 0;

    const freeSpan = document.createElement('span');
    freeSpan.textContent = `空き時間合計 ${freeMinutesVal}分`;
    freeSpan.style.cssText = 'color: #cbd5e1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    bottomRow.appendChild(freeSpan);

    const gapSpan = document.createElement('span');
    gapSpan.textContent = `隙間時間 ${gapMinutesVal}分`;
    gapSpan.style.cssText = 'color: #94a3b8; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    bottomRow.appendChild(gapSpan);

    staffInfoEl.appendChild(bottomRow);

    // 4行目: 強制お昼・休憩ボタン
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display: flex; gap: 4px; margin-top: 4px; width: 100%;';

    const createActionButton = (label, type, color) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        flex: 1;
        padding: 2px 0;
        font-size: 9px;
        font-weight: 600;
        color: #fff;
        background-color: ${color};
        border: none;
        border-radius: 3px;
        cursor: pointer;
        outline: none;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        opacity: 0.85;
        transition: opacity 0.2s;
      `;
      btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '0.85');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.eventBus) {
          window.eventBus.emit('forceFreeTime', { staffId: staff.id, type: type });
        }
      });
      return btn;
    };

    const lunchBtn = createActionButton('🍙 お昼', 'lunch', '#f59e0b');
    const breakBtn = createActionButton('☕ 休憩', 'break', '#3b82f6');

    actionRow.appendChild(lunchBtn);
    actionRow.appendChild(breakBtn);
    
    staffInfoEl.appendChild(actionRow);
  }
}

/**
 * タイムライングリッドコンポーネント
 * 予約表のメイングリッドの描画・管理を担当する
 */
export class Timeline {
  /**
   * @param {HTMLElement} container - タイムラインを描画するコンテナ要素 (#timeline-container)
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this._container = container;
    /** @type {HTMLElement|null} 現在時刻線の要素 */
    this._currentTimeLine = null;
    /** @type {number|null} 現在時刻更新用タイマーID */
    this._timeLineInterval = null;
    /** @type {AbortController|null} イベントリスナー一括解除用 */
    this._abortController = null;
    /** @type {Map<string, Set<number>>} スタイリストIDごとの予約占有スロット */
    this._occupiedSlots = new Map();
  }

  /**
   * グリッドを描画する
   * @param {import('../models/staff.js').Staff[]} stylists - スタイリスト一覧
   * @param {import('../models/reservation.js').Reservation[]} reservations - 予約一覧
   * @param {Date} date - 表示日付
   */
  render(stylists, reservations, date, activeAssistants = null, utilizationRates = {}, staffStats = {}, offStylists = [], offAssistants = [], manncells = []) {
    // 既存のリスナーをクリーンアップ
    this._cleanup();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // 占有スロットの計算
    this._calcOccupiedSlots(reservations);

    // メインコンテナ生成
    const grid = document.createElement('div');
    grid.className = 'timeline-grid';

    // --- ヘッダー行 ---
    const header = document.createElement('div');
    header.className = 'timeline-header';

    const spacer = document.createElement('div');
    spacer.className = 'timeline-header-spacer';
    spacer.style.minWidth = `${STAFF_COL_WIDTH}px`;
    spacer.style.width = `${STAFF_COL_WIDTH}px`;
    header.appendChild(spacer);

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const minutes = i * SLOT_MINUTES;
      const hour = START_HOUR + Math.floor(minutes / 60);
      const min = minutes % 60;
      const cell = document.createElement('div');
      cell.className = 'timeline-header-cell';
      cell.dataset.time = String(minutes);
      cell.dataset.slotIndex = String(i);

      // メインラベル
      const mainLabel = document.createElement('span');
      mainLabel.className = 'accordion-main-label';
      mainLabel.textContent = `${hour}:${String(min).padStart(2, '0')}`;
      cell.appendChild(mainLabel);

      // 展開状態の適用
      if (accordionManager.isExpanded(i)) {
        cell.classList.add('expanded');
        cell.style.flex = '6';
        this._createSubLabels(cell, i);
      } else {
        cell.style.flex = '1';
      }

      // クリックでアコーディオン展開/折りたたみ
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        accordionManager.toggle(i);
      }, { signal });

      header.appendChild(cell);
    }
    grid.appendChild(header);

    // --- 空き状況サブヘッダー行の追加 ---
    const subHeader = document.createElement('div');
    subHeader.className = 'timeline-header-sub';
    subHeader.style.display = 'flex';
    subHeader.style.flexDirection = 'row';
    subHeader.style.borderBottom = '1px solid var(--border-glass)';
    subHeader.style.background = 'rgba(17, 24, 39, 0.95)';
    subHeader.style.position = 'sticky';
    subHeader.style.top = '0';
    subHeader.style.zIndex = '19';

    const subSpacer = document.createElement('div');
    subSpacer.className = 'timeline-header-spacer';
    subSpacer.style.minWidth = `${STAFF_COL_WIDTH}px`;
    subSpacer.style.width = `${STAFF_COL_WIDTH}px`;
    subSpacer.style.fontSize = '9px';
    subSpacer.style.color = 'var(--text-muted)';
    subSpacer.style.display = 'flex';
    subSpacer.style.flexDirection = 'column';
    subSpacer.style.justifyContent = 'center';
    subSpacer.style.alignItems = 'center';
    subSpacer.style.fontWeight = '600';
    subSpacer.style.borderRight = '1px solid var(--border-glass)';
    subSpacer.style.lineHeight = '1.2';
    subSpacer.style.boxSizing = 'border-box';
    subSpacer.style.padding = '2px 0';
    subSpacer.innerHTML = 'スタイリスト<br>/ アシスタント';
    subHeader.appendChild(subSpacer);

    // 日付文字列の作成
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    // アシスタント一覧をストレージから取得
    const assistants = Storage.loadAssistants ? Storage.loadAssistants().filter(a => a.isWorkingOn(dateStr)) : [];

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const minutes = i * SLOT_MINUTES;
      
      // 空きスタイリスト数計算
      let freeStylists = 0;
      stylists.forEach(s => {
        const occupied = this._occupiedSlots.get(s.id);
        if (!occupied || !occupied.has(minutes)) {
          freeStylists++;
        }
      });

      // 空きアシスタント数計算
      const busyAssistants = new Set();
      reservations.forEach(res => {
        const resStart = this._timeToMinutes(res.startTime);
        const resEnd = this._timeToMinutes(res.endTime);
        if (resStart === null || resEnd === null) return;
        
        if (minutes >= resStart && minutes < resEnd) {
          const slotIdx = Math.floor((minutes - resStart) / SLOT_MINUTES);
          const assistantVal = res.assignedAssistants[slotIdx];
          if (assistantVal) {
            const assistantId = assistantVal.id || assistantVal;
            if (assistantId) {
              busyAssistants.add(assistantId);
            }
          }
        }
      });
      const freeAssistants = assistants.filter(a => !busyAssistants.has(a.id)).length;

      const cell = document.createElement('div');
      cell.className = 'timeline-header-sub-cell';
      cell.dataset.slotIndex = String(i);
      cell.style.flex = '1';
      cell.style.minWidth = '32px';
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      cell.style.fontSize = '0.75rem';
      cell.style.fontWeight = '600';
      cell.style.padding = '6px 0';
      cell.style.borderRight = '1px solid rgba(255, 255, 255, 0.05)';
      cell.style.userSelect = 'none';

      // 展開状態の適用
      if (accordionManager.isExpanded(i)) {
        cell.classList.add('expanded');
        cell.style.flex = '6';
      } else {
        cell.style.flex = '1';
      }
      
      // テキストカラーの決定
      if (freeStylists === 0 && freeAssistants === 0) {
        cell.style.color = 'var(--accent-danger)'; // 赤
      } else if (freeStylists === 0 || freeAssistants === 0) {
        cell.style.color = 'var(--accent-warning)'; // 黄
      } else {
        cell.style.color = 'var(--text-secondary)'; // 通常
      }

      cell.textContent = `${freeStylists}/${freeAssistants}`;
      subHeader.appendChild(cell);
    }
    grid.appendChild(subHeader);

    // --- ボディ ---
    const body = document.createElement('div');
    body.className = 'timeline-body';

    // 1. スタイリスト行の描画
    stylists.forEach((stylist) => {
      const row = document.createElement('div');
      row.className = 'timeline-row';
      row.dataset.stylistId = stylist.id;
      row.dataset.staffType = 'stylist';

      // スタッフ情報セル
      const staffInfo = document.createElement('div');
      staffInfo.className = 'timeline-staff-info';
      const rate = utilizationRates[stylist.id] !== undefined ? utilizationRates[stylist.id] : 0;
      const stats = staffStats[stylist.id] || { freeMinutes: 0, gapMinutes: 0 };
      renderStaffInfoContent(staffInfo, stylist, rate, stats, 'stylist', stylists.indexOf(stylist), stylists.length, signal);
      row.appendChild(staffInfo);

      // セル群
      const cellsContainer = document.createElement('div');
      cellsContainer.className = 'timeline-cells';
      cellsContainer.style.position = 'relative';

      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const minutes = i * SLOT_MINUTES;
        const cell = document.createElement('div');
        cell.className = 'timeline-cell';
        cell.dataset.time = String(minutes);
        cell.dataset.slotIndex = String(i);
        cell.dataset.stylistId = stylist.id;
        cell.style.height = `${CELL_HEIGHT}px`;

        // 展開状態の適用
        if (accordionManager.isExpanded(i)) {
          cell.classList.add('expanded');
          cell.style.flex = '6';
          this._createGridlines(cell);
        } else {
          cell.style.flex = '1';
        }

        const slotTimeMinute = (START_HOUR * 60) + minutes;
        const isOffDuty = typeof stylist.isWorkingAtTime === 'function'
          ? !stylist.isWorkingAtTime(slotTimeMinute)
          : false;

        if (isOffDuty) {
          cell.classList.add('off-duty');
          cell.title = `時間外 (${stylist.workStartTime || '09:00'}〜${stylist.workEndTime || '19:00'})`;
        }

        // ドロップターゲット設定
        cell.addEventListener('dragover', (e) => {
          if (isOffDuty) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'none';
            return;
          }
          e.preventDefault();
          const isMoving = e.dataTransfer.types.includes('text/reservation-id');
          if (isMoving) {
            e.dataTransfer.dropEffect = 'move';
            // 既存のプレビューをクリア
            document.querySelectorAll('.timeline-cell.drag-over, .timeline-cell.drag-preview')
              .forEach(el => el.classList.remove('drag-over', 'drag-preview'));
            // ドロップ先セルをハイライト
            cell.classList.add('drag-over');
            // 後続2セル（1時間分）を薄くハイライト（固定プレビュー）
            const container = cell.parentElement;
            if (container) {
              const startMin = parseInt(cell.dataset.time, 10);
              container.querySelectorAll('.timeline-cell').forEach(c => {
                const t = parseInt(c.dataset.time, 10);
                if (t > startMin && t < startMin + 90) {
                  c.classList.add('drag-preview');
                }
              });
            }
          } else {
            e.dataTransfer.dropEffect = 'copy';
            cell.classList.add('drag-over');
          }
        }, { signal });

        cell.addEventListener('dragleave', (e) => {
          if (isOffDuty) return;
          if (!cell.contains(e.relatedTarget)) {
            cell.classList.remove('drag-over');
          }
        }, { signal });

        cell.addEventListener('drop', (e) => {
          if (isOffDuty) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          // 全プレビューハイライトをクリア
          document.querySelectorAll('.timeline-cell.drag-over, .timeline-cell.drag-preview')
            .forEach(el => el.classList.remove('drag-over', 'drag-preview'));

          const startMinutes = parseInt(cell.dataset.time, 10);
          const startHour = START_HOUR + Math.floor(startMinutes / 60);
          const startMin = startMinutes % 60;
          const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;

          // 既存予約の移動
          const reservationId = e.dataTransfer.getData('text/reservation-id');
          if (reservationId && window.eventBus) {
            window.eventBus.emit('reservationMoved', {
              reservationId,
              stylistId: cell.dataset.stylistId,
              startTime: startTimeStr,
              startMinutes
            });
            return;
          }

          // 新規予約のドロップ
          const menuId = e.dataTransfer.getData('text/menu-id');
          if (menuId && window.eventBus) {
            // ドロップ位置に既存の予約ブロックがあるか確認
            // pointer-events: none のため直接ブロックにドロップできないので、ここで検出する
            const cellsContainer = cell.closest('.timeline-cells');
            let droppedOnReservation = null;
            if (cellsContainer) {
              // 仮想ブロック（空き時間、練習、大掃除、お昼、召喚）を除外して本物の予約ブロックのみを対象にする
              const blocks = cellsContainer.querySelectorAll('.reservation-block:not(.summon-virtual-block):not(.activity-virtual-block)');
              blocks.forEach(block => {
                if (droppedOnReservation) return;
                const rect = block.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                  droppedOnReservation = block;
                }
              });
            }

            if (droppedOnReservation && droppedOnReservation.dataset.reservationId) {
              // 既存予約ブロック上にドロップ → 組み込み/掛け持ちモーダル
              window.eventBus.emit('menuDroppedOnReservation', {
                menuId,
                reservationId: droppedOnReservation.dataset.reservationId,
                stylistId: cell.dataset.stylistId,
                startTime: startTimeStr,
                startMinutes
              });
            } else {
              // 空きセルにドロップ → 通常の新規予約
              window.eventBus.emit('reservationDropped', {
                stylistId: cell.dataset.stylistId,
                startTime: startTimeStr,
                startMinutes,
                menuId
              });
            }
          }
        }, { signal });

        cellsContainer.appendChild(cell);
      }

      // レーン（重なり）の計算（mainViewと同じロジック）
      const stylistResList = reservations.filter(r => r.stylistId === stylist.id);
      stylistResList.sort((a, b) => (typeof a.startTime === 'number' ? a.startTime : 0) - (typeof b.startTime === 'number' ? b.startTime : 0));
      const laneMap = new Map();
      const lanes = [];
      stylistResList.forEach(res => {
        const start = typeof res.startTime === 'number' ? res.startTime : 0;
        const end = typeof res.endTime === 'number' ? res.endTime : start + 60;
        let assignedLane = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i] <= start) { assignedLane = i; break; }
        }
        if (assignedLane === -1) {
          assignedLane = lanes.length;
          lanes.push(0);
        }
        lanes[assignedLane] = end;
        laneMap.set(res.id, assignedLane);
      });

      // マンセル枠の描画
      const stylistManncells = manncells.filter(m => m.stylistId === stylist.id);
      stylistManncells.forEach(manncell => {
        const [sH, sM] = manncell.startTime.split(':').map(Number);
        const [eH, eM] = manncell.endTime.split(':').map(Number);
        const START_HOUR = 9; // 9:00開始
        const startTotalMin = sH * 60 + sM;
        const endTotalMin = eH * 60 + eM;
        const startMin = startTotalMin - (START_HOUR * 60);
        const endMin = endTotalMin - (START_HOUR * 60);
        
        const durationMin = endMin - startMin;
        // 重み付きパーセンテージで位置を計算（アコーディオン展開対応）
        const leftPct = isNaN(startMin) ? 50 : accordionManager.getWeightedPosition(startMin);
        // 【重要】widthは始点と終点の差分から算出し累積誤差を防ぐ
        const endPct = isNaN(endMin) ? 75 : accordionManager.getWeightedPosition(endMin);
        const widthPct = endPct - leftPct;
        
        const manncellBlock = document.createElement('div');
        manncellBlock.className = 'manncell-block';
        manncellBlock.dataset.startMin = String(startMin);
        manncellBlock.dataset.endMin = String(endMin);
        if (manncell.isSuccess) {
          manncellBlock.classList.add('manncell-success');
        }
        manncellBlock.style.position = 'absolute';
        manncellBlock.style.left = `${leftPct}%`;
        manncellBlock.style.width = `${widthPct}%`;

        // 関連予約の最小・最大レーンを計算して高さを決定
        let minLane = 999;
        let maxLane = 0;
        if (manncell.reservationIds && manncell.reservationIds.length > 0) {
          manncell.reservationIds.forEach(id => {
            const lane = laneMap.get(id);
            if (lane !== undefined) {
              if (lane < minLane) minLane = lane;
              if (lane > maxLane) maxLane = lane;
            }
          });
        }
        if (minLane === 999) { minLane = 0; maxLane = 0; } // フォールバック

        const CELL_HEIGHT_FOR_LANE = 60; // mainView.jsのCELL_HEIGHTと同じ値
        manncellBlock.style.top = `${minLane * CELL_HEIGHT_FOR_LANE}px`;
        manncellBlock.style.height = `${(maxLane - minLane + 1) * CELL_HEIGHT_FOR_LANE}px`;
        
        // mainView.jsでの再計算用にレーン情報を記録
        manncellBlock.dataset.minLane = String(minLane);
        manncellBlock.dataset.maxLane = String(maxLane);
        
        manncellBlock.style.pointerEvents = 'none';
        // z-indexを設定しない（スタッキングコンテキストを作らず、バッジがstickyヘッダーの上に出られるようにする）
        // 予約ブロック(z-index:3)はDOM順で後に追加されるため自然に上に描画される
        
        const badge = document.createElement('div');
        badge.className = 'manncell-badge';
        
        const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
        const numStr = manncell.teamSize <= 10 && manncell.teamSize > 0 ? circledNumbers[manncell.teamSize - 1] : `(${manncell.teamSize})`;
        badge.textContent = numStr;
        
        // より目立つようにスタイルを少し調整
        badge.style.fontSize = '14px';
        badge.style.fontWeight = 'bold';
        
        manncellBlock.appendChild(badge);

        // マンセル時間ヘッダー（アコーディオン展開時のみ表示）
        const timeHeader = document.createElement('div');
        timeHeader.className = 'manncell-time-header';
        // startMin/endMinは営業開始(9:00)からの分数 → 実時刻に変換
        const sHour = START_HOUR + Math.floor(startMin / 60);
        const sMinute = startMin % 60;
        const eHour = START_HOUR + Math.floor(endMin / 60);
        const eMinute = endMin % 60;
        const fmtTime = (h, m) => `${h}:${String(m).padStart(2, '0')}`;
        timeHeader.textContent = `${fmtTime(sHour, sMinute)}～${fmtTime(eHour, eMinute)}`;
        // 展開中なら表示
        if (accordionManager.expandedSlot !== null) {
          timeHeader.classList.add('manncell-time-visible');
        }
        manncellBlock.appendChild(timeHeader);
        
        cellsContainer.appendChild(manncellBlock);
      });

      row.appendChild(cellsContainer);
      body.appendChild(row);
    });

    // 休みスタイリストの行を描画
    if (offStylists && offStylists.length > 0) {
      offStylists.forEach((stylist) => {
        const row = document.createElement('div');
        row.className = 'timeline-row off-duty-row';
        row.dataset.stylistId = stylist.id;
        row.dataset.staffType = 'stylist';
        row.style.opacity = '0.4';
        row.style.background = 'rgba(0, 0, 0, 0.15)';

        const staffInfo = document.createElement('div');
        staffInfo.className = 'timeline-staff-info';
        renderStaffInfoContent(staffInfo, stylist, 0, { freeMinutes: 0, gapMinutes: 0 }, 'stylist', 0, 1, signal);
        row.appendChild(staffInfo);

        // 空のセル行（予約は入れない）
        const cellsContainer = document.createElement('div');
        cellsContainer.className = 'timeline-cells';
        cellsContainer.style.position = 'relative';

        for (let i = 0; i < TOTAL_SLOTS; i++) {
          const cell = document.createElement('div');
          cell.className = 'timeline-cell off-duty-cell';
          cell.style.height = `${CELL_HEIGHT}px`;
          cell.style.background = 'rgba(0, 0, 0, 0.1)';
          cell.style.cursor = 'default';
          cellsContainer.appendChild(cell);
        }

        row.appendChild(cellsContainer);
        body.appendChild(row);
      });
    }

    // 2. アシスタント区切りとアシスタント行の描画
    const targetAssistants = activeAssistants || (Storage.loadAssistants ? Storage.loadAssistants().filter(a => a.isWorkingOn(dateStr)) : []);
    
    if (targetAssistants && targetAssistants.length > 0) {
      // 区切り行
      const dividerRow = document.createElement('div');
      dividerRow.className = 'timeline-row divider-row';
      dividerRow.style.background = 'rgba(24, 28, 41, 0.95)';
      dividerRow.style.borderTop = '1px solid var(--border-glass)';
      dividerRow.style.borderBottom = '1px solid var(--border-glass)';
      dividerRow.style.height = '24px';
      
      const dividerHeader = document.createElement('div');
      dividerHeader.className = 'timeline-staff-info';
      dividerHeader.style.minWidth = `${STAFF_COL_WIDTH}px`;
      dividerHeader.style.width = `${STAFF_COL_WIDTH}px`;
      dividerHeader.style.padding = '4px 12px';
      dividerHeader.style.fontSize = '10px';
      dividerHeader.style.fontWeight = 'bold';
      dividerHeader.style.color = 'var(--text-muted)';
      dividerHeader.style.background = 'rgba(24, 28, 41, 0.95)';
      dividerHeader.style.borderRight = '1px solid var(--border-glass)';
      dividerHeader.textContent = 'アシスタント';
      
      const dividerCells = document.createElement('div');
      dividerCells.style.flex = '1';
      dividerCells.style.background = 'rgba(24, 28, 41, 0.8)';
      
      dividerRow.appendChild(dividerHeader);
      dividerRow.appendChild(dividerCells);
      body.appendChild(dividerRow);

      // アシスタント行
      targetAssistants.forEach((assistant) => {
        const row = document.createElement('div');
        row.className = 'timeline-row';
        row.dataset.stylistId = assistant.id; // カウンターパートとの一致用に stylistId とする
        row.dataset.staffType = 'assistant';

        // スタッフ情報セル
        const staffInfo = document.createElement('div');
        staffInfo.className = 'timeline-staff-info';
        const rate = utilizationRates[assistant.id] !== undefined ? utilizationRates[assistant.id] : 0;
        const stats = staffStats[assistant.id] || { freeMinutes: 0, gapMinutes: 0 };
        renderStaffInfoContent(staffInfo, assistant, rate, stats, 'assistant', targetAssistants.indexOf(assistant), targetAssistants.length, signal);
        row.appendChild(staffInfo);

        // セル群 (ドラッグ＆ドロップ無効化)
        const cellsContainer = document.createElement('div');
        cellsContainer.className = 'timeline-cells';
        cellsContainer.style.position = 'relative';

        for (let i = 0; i < TOTAL_SLOTS; i++) {
          const minutes = i * SLOT_MINUTES;
          const cell = document.createElement('div');
          cell.className = 'timeline-cell';
          cell.dataset.time = String(minutes);
          cell.dataset.stylistId = assistant.id;
          cell.style.height = `${CELL_HEIGHT}px`;

          const slotTimeMinute = (START_HOUR * 60) + minutes;
          const isOffDuty = typeof assistant.isWorkingAtTime === 'function'
            ? !assistant.isWorkingAtTime(slotTimeMinute)
            : false;

          if (isOffDuty) {
            cell.classList.add('off-duty');
            cell.title = `時間外 (${assistant.workStartTime || '09:00'}〜${assistant.workEndTime || '19:00'})`;
          }

          cellsContainer.appendChild(cell);
        }

        row.appendChild(cellsContainer);
        body.appendChild(row);
      });
    }

    // 休みアシスタントの行を描画
    if (offAssistants && offAssistants.length > 0) {
      offAssistants.forEach((assistant) => {
        const row = document.createElement('div');
        row.className = 'timeline-row off-duty-row';
        row.dataset.stylistId = assistant.id;
        row.dataset.staffType = 'assistant';
        row.style.opacity = '0.4';
        row.style.background = 'rgba(0, 0, 0, 0.15)';

        const staffInfo = document.createElement('div');
        staffInfo.className = 'timeline-staff-info';
        renderStaffInfoContent(staffInfo, assistant, 0, { freeMinutes: 0, gapMinutes: 0 }, 'assistant', 0, 1, signal);
        row.appendChild(staffInfo);

        // 空のセル行
        const cellsContainer = document.createElement('div');
        cellsContainer.className = 'timeline-cells';
        cellsContainer.style.position = 'relative';

        for (let i = 0; i < TOTAL_SLOTS; i++) {
          const cell = document.createElement('div');
          cell.className = 'timeline-cell off-duty-cell';
          cell.style.height = `${CELL_HEIGHT}px`;
          cell.style.background = 'rgba(0, 0, 0, 0.1)';
          cell.style.cursor = 'default';
          cellsContainer.appendChild(cell);
        }

        row.appendChild(cellsContainer);
        body.appendChild(row);
      });
    }

    if (stylists.length === 0 && targetAssistants.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'timeline-empty-placeholder';
      placeholder.style.padding = '48px 24px';
      placeholder.style.textAlign = 'center';
      placeholder.style.color = 'var(--text-muted)';
      placeholder.style.fontSize = '14px';
      placeholder.style.background = 'var(--bg-secondary)';
      placeholder.style.border = '1px dashed var(--border-glass)';
      placeholder.style.borderRadius = 'var(--radius-md)';
      placeholder.style.margin = '20px';
      placeholder.innerHTML = `📅 本日は出勤するスタッフがいません。<br><span style="font-size: 12px; opacity: 0.7;">（「スタッフ設定」で出勤シフトを登録するか、◀ ▶ ボタンで別の日付を選択してください）</span>`;
      body.appendChild(placeholder);
    }

    grid.appendChild(body);

    // コンテナに追加
    this._container.innerHTML = '';
    this._container.appendChild(grid);

    // サブヘッダーの top をヘッダーの実際の高さに合わせる
    requestAnimationFrame(() => {
      const headerEl = grid.querySelector('.timeline-header');
      const subHeaderEl = grid.querySelector('.timeline-header-sub');
      if (headerEl && subHeaderEl) {
        const headerHeight = headerEl.getBoundingClientRect().height;
        subHeaderEl.style.top = `${headerHeight}px`;
      }
    });

    // 掛け持ちハイライト
    this.highlightOverlaps(reservations);

    // 現在時刻線
    this.addCurrentTimeLine();
  }

  /**
   * 予約の占有スロットを計算する
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @private
   */
  _calcOccupiedSlots(reservations) {
    this._occupiedSlots.clear();
    reservations.forEach((res) => {
      if (!this._occupiedSlots.has(res.stylistId)) {
        this._occupiedSlots.set(res.stylistId, new Set());
      }
      const set = this._occupiedSlots.get(res.stylistId);
      // startTime / endTime を分に変換
      const startMin = this._timeToMinutes(res.startTime);
      const endMin = this._timeToMinutes(res.endTime);
      if (startMin === null || endMin === null) return;
      for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
        set.add(m);
      }
    });
  }

  /**
   * 時刻を営業開始からの分数に変換
   * @param {string|number} timeStr - "HH:MM" 形式の文字列、または営業開始からの分数値
   * @returns {number|null}
   * @private
   */
  _timeToMinutes(timeStr) {
    if (typeof timeStr === 'number') return timeStr;
    if (!timeStr) return null;
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return (h - START_HOUR) * 60 + m;
  }

  /**
   * 現在時刻を示す赤い縦線を描画し、1分ごとに更新する
   */
  addCurrentTimeLine() {
    // 既存タイマーをクリア
    if (this._timeLineInterval) {
      clearInterval(this._timeLineInterval);
      this._timeLineInterval = null;
    }

    const grid = this._container.querySelector('.timeline-grid');
    if (!grid) return;

    // 現在時刻線の要素を作成
    if (!this._currentTimeLine) {
      this._currentTimeLine = document.createElement('div');
      this._currentTimeLine.className = 'current-time-line';
    }
    grid.appendChild(this._currentTimeLine);

    const updateLine = () => {
      const now = new Date();
      const currentMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
      if (currentMinutes < 0 || currentMinutes > (END_HOUR - START_HOUR) * 60) {
        this._currentTimeLine.style.display = 'none';
        return;
      }
      this._currentTimeLine.style.display = 'block';
      // 重み付きパーセンテージで位置を計算（アコーディオン展開対応）
      const posPct = accordionManager.getWeightedPosition(currentMinutes);
      this._currentTimeLine.style.left = `calc(${STAFF_COL_WIDTH}px + ${posPct} * (100% - ${STAFF_COL_WIDTH}px) / 100)`;
    };

    updateLine();
    this._timeLineInterval = setInterval(updateLine, 60000); // 1分ごとに更新
  }

  /**
   * 掛け持ち箇所（同一スタイリストの予約が時間的に重なる場所）をハイライトする
   * @param {import('../models/reservation.js').Reservation[]} reservations - 予約一覧
   */
  highlightOverlaps(reservations) {
    // スタイリストごとに予約をグループ化
    /** @type {Map<string, Array>} */
    const byStyleist = new Map();
    reservations.forEach((res) => {
      if (!byStyleist.has(res.stylistId)) {
        byStyleist.set(res.stylistId, []);
      }
      byStyleist.get(res.stylistId).push(res);
    });

    // 各スタイリストについて重なりを検出
    byStyleist.forEach((resList, stylistId) => {
      if (resList.length < 2) return;

      // 各スロットの予約数をカウント
      /** @type {Map<number, number>} */
      const slotCount = new Map();
      resList.forEach((res) => {
        const startMin = this._timeToMinutes(res.startTime);
        const endMin = this._timeToMinutes(res.endTime);
        if (startMin === null || endMin === null) return;
        for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
          slotCount.set(m, (slotCount.get(m) || 0) + 1);
        }
      });

      // 2つ以上の予約が重なるスロットをハイライト（ユーザー指定により無効化）
      slotCount.forEach((count, minutes) => {
        if (count >= 2) {
          // 掛け持ち背景ハイライト不要
        }
      });
    });
  }

  /**
   * X座標（グリッド内ピクセル）から営業開始からの分数を計算する
   * @param {number} x - X座標（px）
   * @returns {number} 営業開始からの分数
   */
  getTimeFromPosition(x) {
    const adjustedX = x - STAFF_COL_WIDTH;
    if (adjustedX < 0) return 0;
    const minutes = (adjustedX / CELL_WIDTH) * SLOT_MINUTES;
    return Math.max(0, Math.min(minutes, (END_HOUR - START_HOUR) * 60));
  }

  /**
   * 営業開始からの分数をX座標（px）に変換する
   * @param {number} minutes - 営業開始からの分数
   * @returns {number} X座標（px）
   */
  getPositionFromTime(minutes) {
    return STAFF_COL_WIDTH + (minutes / SLOT_MINUTES) * CELL_WIDTH;
  }

  /**
   * イベントリスナーとタイマーをクリーンアップする
   * @private
   */
  _cleanup() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._timeLineInterval) {
      clearInterval(this._timeLineInterval);
      this._timeLineInterval = null;
    }
  }

  /**
   * 最新のアサイン結果と予約リストに基づいて空き人数（スタイリスト/アシスタント）の表示を更新する
   * @param {import('../models/staff.js').Staff[]} stylists
   * @param {import('../models/reservation.js').Reservation[]} reservations
   * @param {Date} date
   */
  renderFreeCounts(stylists, reservations, date) {
    const subHeader = this._container.querySelector('.timeline-header-sub');
    if (!subHeader) return;

    const dateStr = this._formatDate(date);
    const assistants = Storage.loadAssistants ? Storage.loadAssistants().filter(a => a.isWorkingOn(dateStr)) : [];

    const cells = subHeader.querySelectorAll('.timeline-header-sub-cell');
    cells.forEach((cell, i) => {
      const minutes = i * SLOT_MINUTES;

      // 空きスタイリスト数計算
      let freeStylists = 0;
      stylists.forEach(s => {
        const occupied = this._occupiedSlots.get(s.id);
        if (!occupied || !occupied.has(minutes)) {
          freeStylists++;
        }
      });

      // 空きアシスタント数計算
      const busyAssistants = new Set();
      reservations.forEach(res => {
        const resStart = this._timeToMinutes(res.startTime);
        const resEnd = this._timeToMinutes(res.endTime);
        if (resStart === null || resEnd === null) return;

        if (minutes >= resStart && minutes < resEnd) {
          const slotIdx = Math.floor((minutes - resStart) / SLOT_MINUTES);
          const assistantVal = res.assignedAssistants && res.assignedAssistants[slotIdx];
          if (assistantVal) {
            const assistantId = assistantVal.id || assistantVal;
            if (assistantId) {
              busyAssistants.add(assistantId);
            }
          }
        }
      });
      const freeAssistants = assistants.filter(a => !busyAssistants.has(a.id)).length;

      // セルテキストと色の更新
      cell.textContent = `${freeStylists}/${freeAssistants}`;
      if (freeStylists === 0 && freeAssistants === 0) {
        cell.style.color = 'var(--accent-danger)';
      } else if (freeStylists === 0 || freeAssistants === 0) {
        cell.style.color = 'var(--accent-warning)';
      } else {
        cell.style.color = 'var(--text-secondary)';
      }
    });
  }

  /**
   * 日付オブジェクトを YYYY-MM-DD 形式の文字列に変換する
   * @param {Date} date
   * @returns {string} YYYY-MM-DD
   * @private
   */
  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ─── アコーディオン展開ヘルパーメソッド ───

  /**
   * 展開されたヘッダーセル内に5分刻みのサブラベルを生成する
   * @param {HTMLElement} headerCell - ヘッダーセル要素
   * @param {number} slotIndex - スロットインデックス (0-19)
   * @private
   */
  _createSubLabels(headerCell, slotIndex) {
    // 既存のサブラベルがあれば削除
    const existing = headerCell.querySelector('.accordion-sub-labels');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'accordion-sub-labels';

    const baseMinutes = slotIndex * SLOT_MINUTES;
    for (let j = 0; j < SUB_SLOT_COUNT; j++) {
      const subMin = baseMinutes + j * SUB_SLOT_MINUTES;
      const hour = START_HOUR + Math.floor(subMin / 60);
      const min = subMin % 60;

      const label = document.createElement('div');
      label.className = 'accordion-sub-label';
      label.textContent = `${hour}:${String(min).padStart(2, '0')}`;
      container.appendChild(label);
    }

    headerCell.appendChild(container);
  }

  /**
   * 展開されたボディセル内に5分刻みのガイドライン（点線）を生成する
   * @param {HTMLElement} bodyCell - ボディセル要素
   * @private
   */
  _createGridlines(bodyCell) {
    // 既存のガイドラインがあれば削除
    const existing = bodyCell.querySelector('.accordion-gridlines');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'accordion-gridlines';

    for (let j = 0; j < SUB_SLOT_COUNT; j++) {
      const line = document.createElement('div');
      line.className = 'accordion-gridline';
      container.appendChild(line);
    }

    bodyCell.appendChild(container);
  }

  /**
   * アコーディオン展開状態を既存DOMに反映する（accordion-changedイベント時に呼ばれる）
   * CSS transitionにより滑らかにアニメーションする。
   */
  applyAccordionState() {
    const grid = this._container.querySelector('.timeline-grid');
    if (!grid) return;

    const expandedSlot = accordionManager.expandedSlot;

    // --- ヘッダーセルの更新 ---
    const headerCells = grid.querySelectorAll('.timeline-header-cell');
    headerCells.forEach(cell => {
      const idx = parseInt(cell.dataset.slotIndex, 10);
      if (accordionManager.isExpanded(idx)) {
        cell.classList.add('expanded');
        cell.style.flex = '6';
        if (!cell.querySelector('.accordion-sub-labels')) {
          this._createSubLabels(cell, idx);
        }
      } else {
        cell.classList.remove('expanded');
        cell.style.flex = '1';
        const subLabels = cell.querySelector('.accordion-sub-labels');
        if (subLabels) subLabels.remove();
      }
    });

    // --- サブヘッダーセルの更新 ---
    const subHeaderCells = grid.querySelectorAll('.timeline-header-sub-cell');
    subHeaderCells.forEach(cell => {
      const idx = parseInt(cell.dataset.slotIndex, 10);
      if (accordionManager.isExpanded(idx)) {
        cell.classList.add('expanded');
        cell.style.flex = '6';
      } else {
        cell.classList.remove('expanded');
        cell.style.flex = '1';
      }
    });

    // --- ボディセルの更新 ---
    const bodyCells = grid.querySelectorAll('.timeline-cell');
    bodyCells.forEach(cell => {
      const idx = parseInt(cell.dataset.slotIndex, 10);
      if (accordionManager.isExpanded(idx)) {
        cell.classList.add('expanded');
        cell.style.flex = '6';
        if (!cell.querySelector('.accordion-gridlines')) {
          this._createGridlines(cell);
        }
      } else {
        cell.classList.remove('expanded');
        cell.style.flex = '1';
        const gridlines = cell.querySelector('.accordion-gridlines');
        if (gridlines) gridlines.remove();
      }
    });

    // --- マンセル枠の位置再計算 ---
    const manncellBlocks = grid.querySelectorAll('.manncell-block');
    manncellBlocks.forEach(block => {
      const startMin = parseFloat(block.dataset.startMin);
      const endMin = parseFloat(block.dataset.endMin);
      if (isNaN(startMin) || isNaN(endMin)) return;
      const leftPct = accordionManager.getWeightedPosition(startMin);
      const endPct = accordionManager.getWeightedPosition(endMin);
      block.style.left = `${leftPct}%`;
      block.style.width = `${endPct - leftPct}%`;
    });

    // --- スロット時間ラベル・マンセル時間ヘッダーの表示切替 ---
    const isExpanded = expandedSlot !== null;
    // スロット時間ラベル: 展開中は全ブロック表示、折りたたみ時は非表示
    grid.querySelectorAll('.slot-time-label').forEach(label => {
      label.classList.toggle('slot-time-visible', isExpanded);
    });
    // マンセル時間ヘッダー: 同上
    grid.querySelectorAll('.manncell-time-header').forEach(header => {
      header.classList.toggle('manncell-time-visible', isExpanded);
    });

    // --- 現在時刻線の位置再計算 ---
    if (this._currentTimeLine) {
      const now = new Date();
      const currentMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
      if (currentMinutes >= 0 && currentMinutes <= (END_HOUR - START_HOUR) * 60) {
        const posPct = accordionManager.getWeightedPosition(currentMinutes);
        this._currentTimeLine.style.left = `calc(${STAFF_COL_WIDTH}px + ${posPct} * (100% - ${STAFF_COL_WIDTH}px) / 100)`;
      }
    }

    // --- グリッド幅の動的拡張 + 展開セルへのオートスクロール ---
    if (expandedSlot !== null) {
      // 展開時: グリッド幅を拡張してスクロール可能にする
      // 通常20スロット(各flex:1)→ 展開時19+6=25ウェイト → 25/20 = 125%
      const totalWeight = accordionManager.getTotalWeight();
      const normalWeight = 20; // TOTAL_SLOTS
      const expandRatio = totalWeight / normalWeight;
      grid.style.minWidth = `${expandRatio * 100}%`;

      const scrollContainer = this._container; // #timeline-area
      // stickyでないボディセルを基準にする
      const targetCell = grid.querySelector(`.timeline-cell[data-slot-index="${expandedSlot}"]`);
      if (targetCell && scrollContainer) {
        // CSSトランジション＋幅拡張が完了した後にスクロール
        setTimeout(() => {
          const containerRect = scrollContainer.getBoundingClientRect();
          const cellRect = targetCell.getBoundingClientRect();
          // セルの中央をコンテナ中央に配置するスクロール量
          const cellCenter = cellRect.left + cellRect.width / 2;
          const containerCenter = containerRect.left + containerRect.width / 2;
          const scrollLeft = scrollContainer.scrollLeft + (cellCenter - containerCenter);
          scrollContainer.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
        }, 380); // CSSトランジション完了直後のタイミング
      }
    } else {
      // 折りたたみ時: グリッド幅を元に戻す
      grid.style.minWidth = '100%';
    }
  }

  /**
   * コンポーネントを破棄し、すべてのリソースを解放する
   */
  destroy() {
    this._cleanup();
    this._currentTimeLine = null;
    this._occupiedSlots.clear();
    this._container.innerHTML = '';
  }
}
