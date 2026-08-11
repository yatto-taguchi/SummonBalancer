/**
 * @fileoverview 予約ブロックコンポーネント
 * タイムライン上に予約を描画・操作する。
 * メニューのcolorCodeに基づく半透明グラデーション背景、
 * アシスタントスロットのストライプ表示、詳細ポップアップなどを提供する。
 * @module components/reservation
 */

import { AlertBadge } from './alertBadge.js';
import * as Storage from '../services/storage.js';
import { getFreeTimeLabel } from './freeTimeModal.js';
import accordionManager from './accordionManager.js';
import { sosManager } from './sosManager.js';
import { Reservation } from '../models/reservation.js';

/** セル幅(px) */
const CELL_WIDTH = 80;
/** セル高さ(px) */
const CELL_HEIGHT = 60;
/** スロット分数 */
const SLOT_MINUTES = 30;
/** スタッフ列幅(px) */
const STAFF_COL_WIDTH = 160;
/** 営業開始時刻（時） */
const START_HOUR = 9;

/**
 * 時刻を営業開始からの分数に変換する
 * @param {string|number} timeStr - "HH:MM" 形式、または営業開始からの分数値
 * @returns {number} 営業開始からの分数
 */
function timeToMinutes(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (h - START_HOUR) * 60 + m;
}

/**
 * 分数を時刻文字列に変換する
 * @param {number} minutes - 営業開始からの分数
 * @returns {string} "HH:MM" 形式
 */
function minutesToTime(minutes) {
  const h = START_HOUR + Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * スキルIDから日本語ラベルを取得する
 * Storage.loadSkills()から動的に解決する（新スキル追加に対応）
 * @param {string} skillId - スキルID
 * @returns {string} 日本語ラベル
 */
function getSkillLabel(skillId) {
  const skills = Storage.loadSkills();
  const found = skills.find(s => s.id === skillId);
  if (found) return found.label;
  // フォールバック（Storageにない場合）
  const fallback = {
    shampoo: 'シャンプー',
    color: 'カラー',
    treatment: 'トリートメント',
    cut: 'カット',
    perm: 'パーマ',
    perm_liquid: '1.2液',
    straight_1: '1液',
    iron: 'アイロン',
    straight_2: '2液',
    head_spa: 'ヘッドスパ'
  };
  return fallback[skillId] || skillId;
}

/**
 * 複合メニュー名から自動的に斜めグラデーション(135deg)のCSS文字列を生成する
 * @param {string} menuName - メニュー名（例: "カットカラー（先カット）"）
 * @returns {string|null} linear-gradient文字列、あるいは複合でない場合null
 */
function getCompositeMenuGradient(menuName) {
  if (!menuName) return null;

  const colorMap = {
    cut: '#6366f1',       // インディゴ
    color: '#ec4899',     // 赤/ピンク
    treatment: '#10b981', // エメラルドグリーン
    perm: '#f59e0b',      // 黄色/アンバー
    straight: '#06b6d4'   // シアン
  };

  let components = [];

  // 「先カット」「先カラー」などの判定
  if (menuName.includes('先カット')) {
    components = [colorMap.cut, colorMap.color];
  } else if (menuName.includes('先カラー')) {
    components = [colorMap.color, colorMap.cut];
  } else if ((menuName.includes('縮毛矯正') || menuName.includes('ストレート')) && menuName.includes('カット')) {
    const mainKey = menuName.includes('縮毛矯正') ? '縮毛矯正' : 'ストレート';
    if (menuName.indexOf('カット') < menuName.indexOf(mainKey)) {
      components = [colorMap.cut, colorMap.straight];
    } else {
      components = [colorMap.straight, colorMap.cut];
    }
  } else if (menuName.includes('カット') && menuName.includes('カラー')) {
    if (menuName.indexOf('カラー') < menuName.indexOf('カット')) {
      components = [colorMap.color, colorMap.cut];
    } else {
      components = [colorMap.cut, colorMap.color];
    }
  } else if (menuName.includes('パーマ') && menuName.includes('カット')) {
    if (menuName.indexOf('カット') < menuName.indexOf('パーマ')) {
      components = [colorMap.cut, colorMap.perm];
    } else {
      components = [colorMap.perm, colorMap.cut];
    }
  } else if (menuName.includes('トリートメント') && menuName.includes('カット')) {
    if (menuName.indexOf('カット') < menuName.indexOf('トリートメント')) {
      components = [colorMap.cut, colorMap.treatment];
    } else {
      components = [colorMap.treatment, colorMap.cut];
    }
  } else if (menuName.includes('ダブルカラー')) {
    components = ['#ec4899', '#db2777'];
  }

  if (components.length < 2) return null;

  const gradientStops = [];
  const count = components.length;
  components.forEach((color, idx) => {
    const curPct = (idx / count) * 100;
    const nextPct = ((idx + 1) / count) * 100;
    if (idx === 0) {
      gradientStops.push(`${color}66 0%`);
      gradientStops.push(`${color}66 ${Math.max(0, nextPct - 4)}%`);
    } else if (idx === count - 1) {
      gradientStops.push(`${color}66 ${Math.min(100, curPct + 4)}%`);
      gradientStops.push(`${color}66 100%`);
    } else {
      gradientStops.push(`${color}66 ${Math.min(100, curPct + 4)}%`);
      gradientStops.push(`${color}66 ${Math.max(0, nextPct - 4)}%`);
    }
  });

  return `linear-gradient(135deg, ${gradientStops.join(', ')})`;
}

/**
 * 予約ブロックコンポーネント
 * タイムライン上に予約を描画し、操作するUI部品
 */
export class ReservationBlock {
  /**
   * @param {import('../models/reservation.js').Reservation} reservation - 予約データ
   * @param {import('../models/menu.js').MenuItem} menuItem - メニューアイテム
   * @param {HTMLElement} container - 描画先コンテナ（timeline-cellsの中）
   */
  constructor(reservation, menuItem, container) {
    /** @type {import('../models/reservation.js').Reservation} */
    this._reservation = reservation;
    /** @type {import('../models/menu.js').MenuItem} */
    this._menuItem = menuItem;
    /** @type {HTMLElement} */
    this._container = container;
    /** @type {HTMLElement|null} ブロック要素 */
    this._element = null;
    /** @type {HTMLElement|null} 詳細ポップアップ要素 */
    this._popup = null;
    /** @type {AbortController|null} イベントリスナー管理 */
    this._abortController = null;
  }

  /**
   * 予約データを取得する
   * @returns {import('../models/reservation.js').Reservation}
   */
  get reservation() {
    return this._reservation;
  }

  /**
   * 予約ブロックを描画し、コンテナに追加する
   */
  render() {
    this._cleanup();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    const res = this._reservation;
    const allMenus = Storage.loadMenus();
    const effectiveMenu = Reservation.getEffectiveMenu(res, allMenus);
    const menu = effectiveMenu || this._menuItem;
    const isActivity = !!res.isVirtualActivity;
    const isSummon = !!res.isVirtualSummon;
    const isVirtual = isSummon || isActivity;

    const activityStyles = {
      lunch: { label: 'お昼ご飯', color: '#10b981' },
      rest: { label: '休憩', color: '#10b981' }, // 休憩もお昼と同じ緑色に統一
      practice: { label: '練習', color: '#a855f7' },
      cleaning: { label: '大掃除', color: '#f59e0b' },
      teaching: { label: '指導', color: '#ec4899' },
      helper: { label: 'ヘルプ', color: '#6366f1' },
      free_time: { label: '空き時間', color: '#64748b' },
      ganbare: { label: '頑張れ', color: '#f97316' }
    };

    let colorCode = '#6366f1';
    let blockLabel = '';
    let backgroundStyle = '';
    let borderStyle = '';

    const isCombined = !isVirtual && Array.isArray(res.items) && res.items.length >= 2;

    if (isCombined) {
      const allMenus = Storage.loadMenus();
      const items = res.items;
      const totalDur = items.reduce((sum, item) => sum + (item.duration || 30), 0);

      const combinedNames = [];
      const gradientStops = [];
      let currentPct = 0;

      items.forEach((item, idx) => {
        const itemMenu = allMenus.find(m => m.id === item.menuItemId);
        const name = itemMenu ? itemMenu.name : 'メニュー';
        const color = itemMenu ? (itemMenu.colorCode || '#6366f1') : '#6366f1';
        combinedNames.push(name);

        const durPct = totalDur > 0 ? ((item.duration || 30) / totalDur) * 100 : (100 / items.length);
        const nextPct = currentPct + durPct;

        if (idx === 0) {
          gradientStops.push(`${color}66 0%`);
          gradientStops.push(`${color}66 ${Math.max(0, nextPct - 4)}%`);
        } else {
          gradientStops.push(`${color}66 ${Math.min(100, currentPct + 4)}%`);
          gradientStops.push(`${color}66 ${Math.max(0, nextPct - 4)}%`);
        }

        currentPct = nextPct;
      });

      // 最後のストップを100%まで確実にする
      if (gradientStops.length > 0) {
        const lastColor = gradientStops[gradientStops.length - 1].split(' ')[0];
        gradientStops.push(`${lastColor} 100%`);
      }

      blockLabel = combinedNames.join(' + ');
      backgroundStyle = `linear-gradient(135deg, ${gradientStops.join(', ')})`;
      borderStyle = `1px solid rgba(255, 255, 255, 0.4)`;
      colorCode = allMenus.find(m => m.id === items[0].menuItemId)?.colorCode || '#6366f1';
    } else {
      if (isActivity) {
        if (res.activityType === 'helper') {
          colorCode = res.colorCode || '#6366f1';
          blockLabel = res.activityLabel || 'ヘルプ';
        } else {
          const style = activityStyles[res.activityType] || { label: '活動', color: '#6366f1' };
          colorCode = res.isLunchConvertible ? '#10b981' : style.color; // お昼可なら緑色に統一
          // 空き時間ブロックで選択済みの場合、色を変更（完了表示）
          if (res.activityType === 'free_time' && res.freeTimeSelection) {
            colorCode = '#14b8a6'; // ティール: 選択済み
          }
          blockLabel = res.activityLabel || style.label;
        }
        backgroundStyle = `linear-gradient(135deg, ${colorCode}44, ${colorCode}22)`;
        borderStyle = `1px solid ${colorCode}88`;
      } else if (isSummon) {
        // 召喚ブロック: 指定された色と名称（特殊召喚/召喚）を尊重する
        colorCode = menu ? (menu.colorCode || '#ef4444') : '#ef4444';
        blockLabel = menu ? menu.name : '召喚';
        backgroundStyle = `linear-gradient(135deg, ${colorCode}44, ${colorCode}22)`;
        borderStyle = `1px solid ${colorCode}88`;
      } else {
        colorCode = menu ? (menu.colorCode || '#6366f1') : '#6366f1';
        blockLabel = menu ? menu.name : '';
        const compositeGradient = menu ? getCompositeMenuGradient(menu.name) : null;
        if (compositeGradient) {
          backgroundStyle = compositeGradient;
          borderStyle = `1px solid rgba(255, 255, 255, 0.35)`;
        } else {
          backgroundStyle = `linear-gradient(135deg, ${colorCode}44, ${colorCode}22)`;
          borderStyle = `1px solid ${colorCode}88`;
        }
      }
    }

    // 位置・サイズ計算（重み付きパーセンテージでアコーディオン展開に対応）
    const startMin = timeToMinutes(res.startTime);
    const endMin = timeToMinutes(res.endTime);
    const durationMin = endMin - startMin;
    const totalDurationMin = 600; // 9:00〜19:00 (10時間 = 600分)
    // 重み付きパーセンテージで位置を計算
    const leftPct = accordionManager.getWeightedPosition(startMin);
    // 【重要】widthは始点と終点の差分から算出し累積誤差を防ぐ
    const endPct = accordionManager.getWeightedPosition(endMin);
    const widthPct = endPct - leftPct;

    // メイン要素の作成
    const block = document.createElement('div');
    block.className = 'reservation-block';
    block.dataset.reservationId = res.id;
    block.dataset.startMin = String(startMin);
    block.dataset.endMin = String(endMin);
    block.style.position = 'absolute';
    block.style.left = `${leftPct}%`;
    block.style.width = `${widthPct}%`;
    block.style.top = '2px';
    block.style.height = `${CELL_HEIGHT - 4}px`;
    // minHeightによる自動伸張はレイアウト崩れの原因になるため廃止
    block.style.background = backgroundStyle;
    block.style.border = borderStyle;
    if (isVirtual) {
      block.style.cursor = 'default';
    } else {
      block.style.cursor = 'grab';
    }
    block.style.borderRadius = 'var(--radius-sm)';
    if (res.isVirtualSummon || res.activityType === 'helper') {
      block.style.zIndex = '15';
    } else if (isActivity) {
      block.style.zIndex = '5';
    } else {
      block.style.zIndex = '10';
    }
    // transition は CSS (.timeline-cells .reservation-block) で管理

    // ドラッグ移動の設定
    block.draggable = !isVirtual;
    if (!res.isVirtualSummon) {
      let isDragging = false;

      block.addEventListener('dragstart', (e) => {
        isDragging = true;
        // ドラッグ開始時にアコーディオンを安全に閉じる（ワープ防止）
        accordionManager.collapse();
        block.classList.add('is-being-dragged');
        document.body.classList.add('is-dragging-item');
        e.dataTransfer.setData('text/reservation-id', res.id);
        e.dataTransfer.setData('text/menu-id', res.menuItemId);
        const dur = typeof res.endTime === 'number' && typeof res.startTime === 'number'
          ? res.endTime - res.startTime
          : 60;
        e.dataTransfer.setData('text/duration', String(dur));
        e.dataTransfer.effectAllowed = 'move';
        // setTimeout を使って次フレームで透明化（ブラウザがドラッグ画像を先にキャプチャするため）
        setTimeout(() => {
          block.style.opacity = '0.3';
        }, 0);
      }, { signal });

      block.addEventListener('dragend', () => {
        isDragging = false;
        block.classList.remove('is-being-dragged');
        document.body.classList.remove('is-dragging-item');
        block.style.opacity = '1';
        block.style.transform = '';
        document.querySelectorAll('.timeline-cell.drag-over, .timeline-cell.drag-preview')
          .forEach(el => el.classList.remove('drag-over', 'drag-preview'));
      }, { signal });

      // 他のブロックの上にドロップされた場合の処理
      block.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('text/reservation-id')) {
          e.dataTransfer.dropEffect = 'move';
        } else {
          e.dataTransfer.dropEffect = 'copy';
        }
      }, { signal });

      block.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 一時的にブロックを非表示にして、その下にある timeline-cell を取得
        const originalDisplay = block.style.display;
        block.style.display = 'none';
        const underEl = document.elementFromPoint(e.clientX, e.clientY);
        block.style.display = originalDisplay;

        const cell = underEl ? underEl.closest('.timeline-cell') : null;
        if (cell && window.eventBus) {
          const startMinutes = parseInt(cell.dataset.time, 10);
          const startHour = START_HOUR + Math.floor(startMinutes / 60);
          const startMin = startMinutes % 60;
          const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;

          const reservationId = e.dataTransfer.getData('text/reservation-id');
          if (reservationId) {
            window.eventBus.emit('reservationMoved', {
              reservationId,
              stylistId: cell.dataset.stylistId,
              startTime: startTimeStr,
              startMinutes
            });
            return;
          }

          const menuId = e.dataTransfer.getData('text/menu-id');
          if (menuId) {
            // 予約ブロック上にメニューがドロップされた → 組み込み/掛け持ち選択モーダルを表示
            window.eventBus.emit('menuDroppedOnReservation', {
              menuId,
              reservationId: res.id,
              stylistId: cell.dataset.stylistId,
              startTime: startTimeStr,
              startMinutes
            });
          }
        }
      }, { signal });
    }

    // フェードインアニメーション（初回表示のみ、ドラッグ中は実行しない）
    block.style.opacity = '0';
    block.style.transform = 'scale(0.95)';
    requestAnimationFrame(() => {
      block.style.transition = 'opacity 0.3s ease, transform 0.3s ease, box-shadow var(--transition-fast)';
      block.style.opacity = '1';
      block.style.transform = 'scale(1)';
    });

    // --- ヘッダー ---
    const header = document.createElement('div');
    header.className = 'reservation-header';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.fontSize = '10px';

    if (isVirtual) {
      header.style.flexDirection = 'column';
      header.style.justifyContent = 'center';
      header.style.gap = '2px';
      header.style.padding = '4px 2px';
      header.style.width = '100%';
      header.style.height = '100%';
      header.style.boxSizing = 'border-box';
    } else {
      header.style.flexDirection = 'row';
      header.style.justifyContent = 'space-between';
      header.style.padding = '2px 4px';
    }

    const leftSideContainer = document.createElement('div');
    leftSideContainer.style.display = 'flex';
    leftSideContainer.style.alignItems = 'center';
    leftSideContainer.style.overflow = 'hidden';
    
    if (!isVirtual) {
      const memoIcon = document.createElement('span');
      memoIcon.textContent = '📝';
      memoIcon.className = 'memo-icon';
      
      if (res.memo) {
        memoIcon.dataset.memo = res.memo;
        memoIcon.classList.add('has-memo');
      } else {
        memoIcon.dataset.memo = '';
        memoIcon.classList.remove('has-memo');
      }

      memoIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.eventBus) {
          window.eventBus.emit('openMemoPopover', {
            reservationId: res.id,
            memo: memoIcon.dataset.memo || '',
            targetElement: memoIcon
          });
        }
      }, { signal });

      leftSideContainer.appendChild(memoIcon);
    }

    const menuNameEl = document.createElement('span');
    menuNameEl.className = 'reservation-menu-name';
    menuNameEl.style.fontWeight = 'bold';
    menuNameEl.style.color = colorCode;
    menuNameEl.style.overflow = 'hidden';
    menuNameEl.style.textOverflow = 'ellipsis';
    
    if (res.isVirtualSummon) {
      // 召喚ブロック: 指定された名称（特殊召喚/召喚）+改行+「（担当スタイリスト名）」
      const targetName = res.summonTargetName || '';
      const summonLabel = blockLabel || '救援';
      menuNameEl.innerHTML = `${summonLabel}<br><span style="font-size: 8px; font-weight: normal;">（→${targetName}）</span>`;
      menuNameEl.style.whiteSpace = 'normal';
      menuNameEl.style.lineHeight = '1.2';
      menuNameEl.style.textAlign = 'center';
    } else if (res.activityType === 'free_time') {
      // 空き時間ブロック: 2行表示
      const selection = res.freeTimeSelection; // MainViewからマージされた選択データ
      if (selection) {
        const selectedLabel = getFreeTimeLabel(selection.type, selection.detail);
        menuNameEl.innerHTML = `<span style="font-size: 10px;">${selectedLabel}</span>`;
      } else {
        menuNameEl.innerHTML = `空き時間<br><span style="font-size: 8px; font-weight: normal; opacity: 0.7;">クリックして選択</span>`;
      }
      menuNameEl.style.whiteSpace = 'normal';
      menuNameEl.style.lineHeight = '1.2';
      menuNameEl.style.textAlign = 'center';
    } else if (res.isLunchConvertible) {
      menuNameEl.innerHTML = `${blockLabel}<br><span style="font-size: 8px; font-weight: normal; opacity: 0.85;">（お昼可）</span>`;
      menuNameEl.style.whiteSpace = 'normal';
      menuNameEl.style.lineHeight = '1.1';
    } else if (res.isConvertibleToRest) {
      menuNameEl.innerHTML = `${blockLabel}<br><span style="font-size: 8px; font-weight: normal; opacity: 0.85;">（休憩可）</span>`;
      menuNameEl.style.whiteSpace = 'normal';
      menuNameEl.style.lineHeight = '1.1';
    } else {
      menuNameEl.textContent = blockLabel;
      menuNameEl.style.whiteSpace = 'nowrap';
    }
    
    if (isVirtual) {
      menuNameEl.style.fontSize = '11px';
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'reservation-time';
    const startDisplay = typeof res.startTime === 'number' ? minutesToTime(res.startTime) : res.startTime;
    const endDisplay = typeof res.endTime === 'number' ? minutesToTime(res.endTime) : res.endTime;
    timeEl.textContent = `${startDisplay}-${endDisplay}`;
    timeEl.style.fontSize = '9px';
    timeEl.style.flexShrink = '0';
    if (isVirtual) {
      timeEl.style.fontSize = '8px';
      timeEl.style.color = 'var(--text-muted)';
    }

    leftSideContainer.appendChild(menuNameEl);
    header.appendChild(leftSideContainer);



    if (isVirtual && !isSummon) {
      header.appendChild(timeEl);
    }
    block.appendChild(header);

    // --- アシスタントスロット ---
    if (!isVirtual && menu && menu.assistantSlots && menu.assistantSlots.length > 0) {
      const slotsContainer = document.createElement('div');
      slotsContainer.className = 'reservation-slots';
      slotsContainer.style.display = 'flex';
      slotsContainer.style.gap = '2px';
      slotsContainer.style.padding = '0 2px 2px 2px';
      slotsContainer.style.height = `${Math.max(CELL_HEIGHT - 24, 16)}px`;
      slotsContainer.style.boxSizing = 'border-box';

      menu.assistantSlots.forEach((slot, index) => {
        const slotEl = this._createSlotElement(slot, durationMin, index, colorCode, startMin);
        slotsContainer.appendChild(slotEl);
      });

      block.appendChild(slotsContainer);



    }

    // --- イベント設定 ---
    if (!isVirtual) {
      // ホバー
      block.addEventListener('mouseenter', () => {
        block.style.boxShadow = `0 0 16px ${colorCode}44`;
        block.style.zIndex = '20';
      }, { signal });

      block.addEventListener('mouseleave', () => {
        block.style.boxShadow = 'none';
        block.style.zIndex = '10';
      }, { signal });

      // クリックで詳細ポップアップ
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sosManager.handleReservationClick(res, e)) return;
        this.showDetailPopup();
      }, { signal });

      // 右クリックで削除メニュー
      block.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showContextMenu(e.clientX, e.clientY);
      }, { signal });
    } else {
      if (res.activityType === 'free_time') {
        // 空き時間ブロック: クリックでモーダル開く
        block.style.cursor = 'pointer';
        block.addEventListener('mouseenter', () => {
          block.style.boxShadow = `0 0 16px ${colorCode}66`;
          block.style.zIndex = '20';
        }, { signal });
        block.addEventListener('mouseleave', () => {
          block.style.boxShadow = 'none';
          block.style.zIndex = '10';
        }, { signal });

        block.addEventListener('click', (e) => {
          e.stopPropagation();
          const startMinutes = timeToMinutes(res.startTime);
          const endMinutes = timeToMinutes(res.endTime);
          if (window.eventBus) {
            window.eventBus.emit('openFreeTimeModal', {
              staffId: res.stylistId,
              startMinutes,
              endMinutes,
              blockId: res.id,
              currentSelection: res.freeTimeSelection || null,
              isConvertibleToRest: !!res.isConvertibleToRest
            });
          }
        }, { signal });
      } else if (res.isLunchConvertible) {
        block.style.cursor = 'pointer';
        block.addEventListener('mouseenter', () => {
          block.style.boxShadow = `0 0 16px ${colorCode}66`;
          block.style.zIndex = '20';
        }, { signal });
        block.addEventListener('mouseleave', () => {
          block.style.boxShadow = 'none';
          block.style.zIndex = '10';
        }, { signal });

        block.addEventListener('click', (e) => {
          e.stopPropagation();
          const startMinutes = timeToMinutes(res.startTime);
          const confirmLunch = window.confirm(
            `この時間帯（${minutesToTime(startMinutes)}〜${minutesToTime(startMinutes + 30)}）をお昼ご飯に変更しますか？\n（変更すると、お昼ご飯がここに確定され、その後の予定が自動再計算されます）`
          );
          if (confirmLunch && window.eventBus) {
            window.eventBus.emit('convertActivityToLunch', {
              staffId: res.stylistId,
              startTimeOffset: startMinutes
            });
          }
        }, { signal });
      } else if (res.isConvertibleToRest) {
        block.style.cursor = 'pointer';
        block.addEventListener('mouseenter', () => {
          block.style.boxShadow = `0 0 16px ${colorCode}66`;
          block.style.zIndex = '20';
        }, { signal });
        block.addEventListener('mouseleave', () => {
          block.style.boxShadow = 'none';
          block.style.zIndex = '10';
        }, { signal });

        block.addEventListener('click', (e) => {
          e.stopPropagation();
          const startMinutes = timeToMinutes(res.startTime);
          const confirmRest = window.confirm(
            `この時間帯（${minutesToTime(startMinutes)}〜${minutesToTime(startMinutes + 30)}）を休憩に変更しますか？\n（変更すると、休憩がここに確定され、その後の予定が自動再計算されます）`
          );
          if (confirmRest && window.eventBus) {
            window.eventBus.emit('convertActivityToRest', {
              staffId: res.stylistId,
              startTimeOffset: startMinutes
            });
          }
        }, { signal });
      } else {
        block.addEventListener('click', (e) => {
          e.stopPropagation();
        }, { signal });
      }
    }

    // --- リサイズハンドル（右端・非仮想ブロックのみ）---
    if (!isVirtual && !res.isVirtualSummon) {
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'reservation-resize-handle';
      resizeHandle.draggable = false; // HTML5ドラッグと干渉しないよう無効化

      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // ブロックのdragstartを防ぐ

        // ★ アコーディオン展開中はそのまま維持し、5分刻みリサイズを可能にする
        // （ドラッグ移動時の collapse() は別途残すが、リサイズではアコーディオンを閉じない）

        const startX = e.clientX;

        // アコーディオン展開状態に応じてスナップ単位を決定
        const isAccordionExpanded = accordionManager.hasExpanded;
        const snapMinutes = isAccordionExpanded ? 5 : 30;

        // タイムラインセル群の幅から px/分 を計算（アコーディオン非展開時用）
        const cellsEl = block.closest('.timeline-cells');
        const cellsWidth = cellsEl ? cellsEl.getBoundingClientRect().width : 1600;
        const totalDurationMin = 600; // 9:00〜19:00
        const pxPerMin = cellsWidth / totalDurationMin;

        const originalDuration = (typeof res.endTime === 'number' && typeof res.startTime === 'number')
          ? res.endTime - res.startTime : 60;

        // リサイズ中カーソルをドキュメント全体に適用
        document.body.classList.add('is-resizing');

        // ライブプレビュー: ブロック幅をリアルタイム更新
        const onMouseMove = (moveEvt) => {
          let deltaMin;

          if (isAccordionExpanded && cellsEl) {
            // アコーディオン展開中: マウスX座標からパーセンテージ → 分数に逆変換
            const cellsRect = cellsEl.getBoundingClientRect();
            const mousePct = ((moveEvt.clientX - cellsRect.left) / cellsRect.width) * 100;
            const mouseMin = accordionManager.getMinutesFromPosition(mousePct);
            // 予約開始時刻からの差分を新しい所要時間として扱う
            deltaMin = mouseMin - startMin;
          } else {
            // 全体表示: 従来通り deltaX / pxPerMin で算出
            const deltaX = moveEvt.clientX - startX;
            deltaMin = deltaX / pxPerMin;
          }

          // スナップ単位に応じて丸める
          let snapped;
          if (isAccordionExpanded) {
            // アコーディオン展開時: deltaMin は「予約開始からの総分数」なので直接スナップ
            snapped = Math.round(deltaMin / snapMinutes) * snapMinutes;
            // 新しい所要時間を算出（開始時刻からの差分）
            var newDur = Math.max(snapMinutes, snapped);
          } else {
            // 全体表示: deltaMin は「元の終了位置からの移動量」
            snapped = Math.round(deltaMin / snapMinutes) * snapMinutes;
            var newDur = Math.max(snapMinutes, originalDuration + snapped);
          }

          // プレビュー幅: アコーディオンの重み付きパーセンテージを使用
          const newEndMin = startMin + newDur;
          const newLeftPct = accordionManager.getWeightedPosition(startMin);
          const newEndPct = accordionManager.getWeightedPosition(newEndMin);
          block.style.width = `${newEndPct - newLeftPct}%`;

          // プレビュータイムラベル（右下に表示）
          const h = Math.floor(newEndMin / 60) + 9;
          const m = newEndMin % 60;
          resizeHandle.dataset.previewTime =
            `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        };

        // ドロップ確定
        const onMouseUp = (upEvt) => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.body.classList.remove('is-resizing');
          delete resizeHandle.dataset.previewTime;

          let deltaMin;

          if (isAccordionExpanded && cellsEl) {
            // アコーディオン展開中: マウスX座標からパーセンテージ → 分数に逆変換
            const cellsRect = cellsEl.getBoundingClientRect();
            const mousePct = ((upEvt.clientX - cellsRect.left) / cellsRect.width) * 100;
            const mouseMin = accordionManager.getMinutesFromPosition(mousePct);
            deltaMin = mouseMin - startMin;
          } else {
            const deltaX = upEvt.clientX - startX;
            deltaMin = deltaX / pxPerMin;
          }

          let newDuration;
          if (isAccordionExpanded) {
            const snapped = Math.round(deltaMin / snapMinutes) * snapMinutes;
            newDuration = Math.max(snapMinutes, snapped);
          } else {
            const snapped = Math.round(deltaMin / snapMinutes) * snapMinutes;
            newDuration = Math.max(snapMinutes, originalDuration + snapped);
          }

          if (newDuration === originalDuration) return; // 変化なし

          if (window.eventBus) {
            window.eventBus.emit('reservationResized', {
              reservationId: res.id,
              newDuration
            });
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }, { signal });

      block.appendChild(resizeHandle);
    }

    this._element = block;
    this._container.appendChild(block);

    // SOSマークの適用
    sosManager.applySOSMarkToReservation(res, block);
  }

  /**
   * アシスタントスロット（ストライプゾーン）の要素を作成する
   * @param {import('../models/menu.js').AssistantSlot} slot - スロットデータ
   * @param {number} totalDuration - 予約の総時間(分)
   * @param {number} index - スロットインデックス
   * @param {string} colorCode - メニュー色
   * @returns {HTMLElement}
   * @private
   */
  _createSlotElement(slot, totalDuration, index, colorCode, resStartMin = 0) {
    const slotEl = document.createElement('div');
    slotEl.className = 'assistant-slot';
    slotEl.style.flex = '1';
    slotEl.style.height = '100%';
    slotEl.style.boxSizing = 'border-box';
    slotEl.style.background = `repeating-linear-gradient(
      45deg,
      ${colorCode}11,
      ${colorCode}11 4px,
      ${colorCode}22 4px,
      ${colorCode}22 8px
    )`;
    slotEl.style.border = `1px solid ${colorCode}44`;
    slotEl.style.borderRadius = '3px';
    slotEl.style.display = 'flex';
    slotEl.style.flexDirection = 'column';
    slotEl.style.justifyContent = 'center';
    slotEl.style.alignItems = 'center';
    slotEl.style.padding = '1px';
    slotEl.style.overflow = 'visible';
    slotEl.style.cursor = 'pointer';
    slotEl.style.position = 'relative';

    // --- スロット実時刻ラベル（アコーディオン展開時のみ表示） ---
    const override = this._reservation.slotTimeOverrides?.[index];
    const actualStart = resStartMin + (override?.startMinute ?? slot.startMinute);
    const actualEnd   = resStartMin + (override?.endMinute   ?? slot.endMinute);
    const timeLabelEl = document.createElement('span');
    timeLabelEl.className = 'slot-time-label';
    timeLabelEl.textContent = `${minutesToTime(actualStart)}～${minutesToTime(actualEnd)}`;
    slotEl.appendChild(timeLabelEl);

    // スロット全体のクリック: 固定モード時にアシスタント選択を開く
    slotEl.addEventListener('click', (e) => {
      // 固定モードか確認（MainViewのisManualModeを参照）
      const mainView = window.__mainViewInstance;
      if (mainView && (mainView.isManualMode || mainView.isGanbareMode)) {
        e.stopPropagation();
        e.preventDefault();

        if (window.eventBus) {
          const currentAssigns = this._reservation.assignedAssistants;
          window.eventBus.emit('assistantSlotClicked', {
            reservationId: this._reservation.id,
            slotIndex: index,
            currentAssistantId: currentAssigns && currentAssigns[index] ? currentAssigns[index].id : null,
            clientX: e.clientX,
            clientY: e.clientY
          });
        }
      }
      // 通常モード時はバブリングでブロック全体のクリック（showDetailPopup）に委譲
    });

    // 必要スキル
    const skillEl = document.createElement('span');
    skillEl.className = 'slot-skill';
    skillEl.textContent = getSkillLabel(slot.requiredSkill);
    skillEl.style.fontSize = '9px';
    skillEl.style.display = 'inline-block';
    skillEl.style.transform = 'scale(0.75)';
    skillEl.style.transformOrigin = 'center';
    skillEl.style.color = 'var(--text-secondary)';
    skillEl.style.whiteSpace = 'nowrap';
    slotEl.appendChild(skillEl);

    // 配置済みアシスタント名
    const assignedAssistants = this._reservation.assignedAssistants;
    if (assignedAssistants && assignedAssistants[index]) {
      const ast = assignedAssistants[index];
      
      const assistantEl = document.createElement('span');
      assistantEl.className = 'slot-assistant';
      
      let isConcurrent = false;
      
      // 特殊ID "__manncell__" の場合はチーム制の2段表示
      if (ast === '__manncell__' || ast.id === '__manncell__') {
        const teamName = ast.manncellTeam || 'チーム';
        assistantEl.className = 'slot-assistant manncell-assigned-text';
        assistantEl.innerHTML = `<span class="manncell-label">【チーム制】</span><span class="manncell-team-name">${teamName}</span>`;
      } else {
        const nameStr = ast.nickname || ast.name || ast;
        isConcurrent = !!ast.isConcurrent;
        assistantEl.textContent = nameStr;
      }
      
      assistantEl.style.fontSize = '9px';
      assistantEl.style.display = 'inline-block';
      assistantEl.style.transform = 'scale(0.85)';
      assistantEl.style.transformOrigin = 'center';
      assistantEl.style.color = 'var(--accent-success)';
      assistantEl.style.fontWeight = 'bold';
      assistantEl.style.whiteSpace = 'nowrap';
      slotEl.appendChild(assistantEl);

      // 兼任バッジをスロットの右上に配置
      if (isConcurrent) {
        this._addConcurrentBadge(slotEl);
      }
    }

    return slotEl;
  }

  /**
   * クリック時の詳細ポップアップを表示する
   * メニューバリエーション切替、習熟度設定、手動アシスタント選択を提供
   */
  showDetailPopup() {
    // 既存ポップアップを閉じる
    this._closePopup();

    const res = this._reservation;
    const menu = this._menuItem;
    const colorCode = menu.colorCode || '#6366f1';

    const popup = document.createElement('div');
    popup.className = 'reservation-detail-popup';
    popup.style.position = 'fixed';
    popup.style.zIndex = '1000';
    popup.style.background = 'var(--bg-secondary)';
    popup.style.border = '1px solid var(--border-glass)';
    popup.style.borderRadius = 'var(--radius-lg)';
    popup.style.padding = '16px';
    popup.style.minWidth = '260px';
    popup.style.boxShadow = `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px ${colorCode}44`;
    popup.style.backdropFilter = 'blur(12px)';

    // フェードインアニメーション
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(-8px)';

    // ポップアップの配置位置を算出
    if (this._element) {
      const rect = this._element.getBoundingClientRect();
      popup.style.top = `${rect.bottom + 8}px`;
      popup.style.left = `${rect.left}px`;
    } else {
      popup.style.top = '50%';
      popup.style.left = '50%';
      popup.style.transform = 'translate(-50%, -50%)';
    }

    // --- タイトル ---
    const title = document.createElement('h3');
    title.textContent = `${menu.name} 詳細`;
    title.style.color = colorCode;
    title.style.margin = '0 0 12px 0';
    title.style.fontSize = '14px';
    popup.appendChild(title);

    // --- メニューバリエーション切替 ---
    const variantSection = document.createElement('div');
    variantSection.style.marginBottom = '12px';

    const variantLabel = document.createElement('label');
    variantLabel.textContent = 'バリエーション:';
    variantLabel.style.color = 'var(--text-secondary)';
    variantLabel.style.fontSize = '11px';
    variantLabel.style.display = 'block';
    variantLabel.style.marginBottom = '4px';
    variantSection.appendChild(variantLabel);

    const variantSelect = document.createElement('select');
    variantSelect.className = 'variant-select';
    variantSelect.style.width = '100%';
    variantSelect.style.padding = '4px 8px';
    variantSelect.style.background = 'var(--bg-tertiary)';
    variantSelect.style.color = 'var(--text-primary)';
    variantSelect.style.border = '1px solid var(--border-glass)';
    variantSelect.style.borderRadius = 'var(--radius-sm)';
    variantSelect.style.fontSize = '12px';

    // すべてのメニューを取得し、同じベース名を持つものを探す
    const allMenus = Storage.loadMenus();
    const getBaseName = (name) => {
      if (!name) return '';
      const match = name.match(/^(.+?)（.+）$/);
      return match ? match[1].trim() : name.trim();
    };
    const currentBase = getBaseName(menu.name);

    // ベース名が同じメニューをバリエーションとしてリストアップ（自身を含む）
    const variants = allMenus.filter(m => getBaseName(m.name) === currentBase);

    if (variants.length > 1) {
      // 複数のバリエーションがある場合はそれらを表示
      variants.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        if (v.id === menu.id) {
          opt.selected = true;
        }
        variantSelect.appendChild(opt);
      });
    } else {
      // 単一の場合はデフォルトのみ
      const defaultOpt = document.createElement('option');
      defaultOpt.value = menu.id;
      defaultOpt.textContent = `${menu.name}`;
      variantSelect.appendChild(defaultOpt);
    }

    variantSelect.addEventListener('change', () => {
      if (window.eventBus) {
        window.eventBus.emit('reservationChanged', {
          reservationId: res.id,
          action: 'changeMenuItem',
          newMenuId: variantSelect.value
        });
      }
    });
    variantSection.appendChild(variantSelect);
    popup.appendChild(variantSection);

    // --- アシスタントスロット習熟度設定 ---
    if (menu.assistantSlots && menu.assistantSlots.length > 0) {
      const slotsSection = document.createElement('div');
      slotsSection.style.marginBottom = '12px';

      const slotsLabel = document.createElement('div');
      slotsLabel.textContent = 'アシスタントスロット:';
      slotsLabel.style.color = 'var(--text-secondary)';
      slotsLabel.style.fontSize = '11px';
      slotsLabel.style.marginBottom = '6px';
      slotsSection.appendChild(slotsLabel);

      menu.assistantSlots.forEach((slot, idx) => {
        // このスロットのオーバーライド済み時間（あれば）を取得
        const override = res.slotTimeOverrides && res.slotTimeOverrides[idx];
        const currentStart = override ? override.startMinute : slot.startMinute;
        const currentEnd   = override ? override.endMinute   : slot.endMinute;

        const slotRow = document.createElement('div');
        slotRow.style.cssText = 'margin-bottom: 8px; padding: 6px 8px; background: var(--bg-tertiary); border-radius: var(--radius-sm); border: 1px solid var(--border-glass);';

        // 1行目: スキルラベル + 習熟度セレクト
        const rowTop = document.createElement('div');
        rowTop.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px;';

        const slotInfo = document.createElement('span');
        slotInfo.textContent = `${getSkillLabel(slot.requiredSkill)}`;
        slotInfo.style.cssText = 'color: var(--text-primary); font-size: 11px; flex: 1;';
        rowTop.appendChild(slotInfo);

        // 習熟度セレクト
        const profSelect = document.createElement('select');
        profSelect.style.cssText = 'padding: 2px 4px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); font-size: 11px;';
        for (let lv = 1; lv <= 5; lv++) {
          const opt = document.createElement('option');
          opt.value = String(lv);
          opt.textContent = `Lv.${lv}`;
          profSelect.appendChild(opt);
        }
        profSelect.value = String(slot.requiredProficiency || 3);
        profSelect.addEventListener('change', () => {
          if (window.eventBus) {
            window.eventBus.emit('reservationChanged', {
              reservationId: res.id,
              change: 'proficiency',
              slotIndex: idx,
              proficiency: parseInt(profSelect.value, 10)
            });
          }
        });
        rowTop.appendChild(profSelect);
        slotRow.appendChild(rowTop);

        // 2行目: 時間入力（開始〜終了）
        const rowTime = document.createElement('div');
        rowTime.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 11px;';

        const timeLabel = document.createElement('span');
        timeLabel.textContent = '時間:';
        timeLabel.style.cssText = 'color: var(--text-muted); font-size: 10px; min-width: 28px;';
        rowTime.appendChild(timeLabel);

        const makeTimeInput = (val) => {
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.min = '0';
          inp.max = '300';
          inp.step = '5';
          inp.value = String(val);
          inp.style.cssText = [
            'width: 50px',
            'padding: 2px 4px',
            'background: var(--bg-secondary)',
            'color: var(--text-primary)',
            'border: 1px solid var(--border-glass)',
            'border-radius: var(--radius-sm)',
            'font-size: 11px',
            'text-align: center'
          ].join(';');
          return inp;
        };

        const startInp = makeTimeInput(currentStart);
        const sep = document.createElement('span');
        sep.textContent = '〜';
        sep.style.cssText = 'color: var(--text-muted); font-size: 10px;';
        const endInp = makeTimeInput(currentEnd);

        const unitLabel = document.createElement('span');
        unitLabel.textContent = '分';
        unitLabel.style.cssText = 'color: var(--text-muted); font-size: 10px;';

        // リセットボタン（メニューデフォルトに戻す）
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '↺';
        resetBtn.title = 'メニューのデフォルト時間に戻す';
        resetBtn.style.cssText = [
          'padding: 1px 5px',
          'background: transparent',
          'color: var(--text-muted)',
          'border: 1px solid var(--border-glass)',
          'border-radius: var(--radius-sm)',
          'font-size: 10px',
          'cursor: pointer',
          'margin-left: auto'
        ].join(';');

        const applyTimeOverride = () => {
          const s = parseInt(startInp.value, 10);
          const e = parseInt(endInp.value, 10);
          if (isNaN(s) || isNaN(e) || e <= s) return;
          if (window.eventBus) {
            window.eventBus.emit('reservationChanged', {
              reservationId: res.id,
              change: 'slotTimeOverride',
              slotIndex: idx,
              startMinute: s,
              endMinute: e
            });
          }
        };

        startInp.addEventListener('change', applyTimeOverride);
        endInp.addEventListener('change', applyTimeOverride);

        resetBtn.addEventListener('click', () => {
          startInp.value = String(slot.startMinute);
          endInp.value   = String(slot.endMinute);
          if (window.eventBus) {
            window.eventBus.emit('reservationChanged', {
              reservationId: res.id,
              change: 'slotTimeOverride',
              slotIndex: idx,
              startMinute: null, // nullでオーバーライド削除
              endMinute: null
            });
          }
        });

        // オーバーライドされている場合は強調表示
        if (override) {
          startInp.style.borderColor = 'var(--accent-warning)';
          endInp.style.borderColor   = 'var(--accent-warning)';
        }

        rowTime.appendChild(startInp);
        rowTime.appendChild(sep);
        rowTime.appendChild(endInp);
        rowTime.appendChild(unitLabel);
        rowTime.appendChild(resetBtn);
        slotRow.appendChild(rowTime);

        slotsSection.appendChild(slotRow);
      });


      popup.appendChild(slotsSection);
    }

    // --- 閉じるボタン ---
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '閉じる';
    closeBtn.style.width = '100%';
    closeBtn.style.padding = '6px';
    closeBtn.style.background = 'var(--bg-tertiary)';
    closeBtn.style.color = 'var(--text-primary)';
    closeBtn.style.border = '1px solid var(--border-glass)';
    closeBtn.style.borderRadius = 'var(--radius-sm)';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '12px';
    closeBtn.style.transition = 'background var(--transition-fast)';

    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'var(--accent-primary)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'var(--bg-tertiary)';
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closePopup();
    });

    popup.appendChild(closeBtn);

    // 外側クリックで閉じる
    const backdrop = document.createElement('div');
    backdrop.style.position = 'fixed';
    backdrop.style.inset = '0';
    backdrop.style.zIndex = '999';
    backdrop.addEventListener('click', () => this._closePopup());

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    // フェードインアニメーション
    requestAnimationFrame(() => {
      popup.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      popup.style.opacity = '1';
      popup.style.transform = 'translateY(0)';
    });

    this._popup = popup;
    this._popupBackdrop = backdrop;
  }

  /**
   * 右クリック時のコンテキストメニュー（削除用）を表示する
   * @param {number} x - マウスX座標
   * @param {number} y - マウスY座標
   * @private
   */
  _showContextMenu(x, y) {
    // 既存メニューを削除
    const existingMenu = document.querySelector('.reservation-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'reservation-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = '2000';
    menu.style.background = 'var(--bg-secondary)';
    menu.style.border = '1px solid var(--border-glass)';
    menu.style.borderRadius = 'var(--radius-sm)';
    menu.style.padding = '4px 0';
    menu.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
    menu.style.minWidth = '160px';

    // フェードイン
    menu.style.opacity = '0';
    menu.style.transform = 'scale(0.95)';

    // バックドロップ（先に宣言しておく。後でDOMに追加する）
    const backdrop = document.createElement('div');
    backdrop.style.position = 'fixed';
    backdrop.style.inset = '0';
    backdrop.style.zIndex = '1999';
    backdrop.addEventListener('click', () => {
      menu.remove();
      backdrop.remove();
    });

    // 削除ボタン
    const deleteBtn = document.createElement('div');
    deleteBtn.textContent = '🗑 削除';
    deleteBtn.style.padding = '8px 16px';
    deleteBtn.style.fontSize = '12px';
    deleteBtn.style.color = 'var(--accent-danger)';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.transition = 'background var(--transition-fast)';

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.background = 'var(--bg-tertiary)';
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.background = 'transparent';
    });
    deleteBtn.addEventListener('click', () => {
      if (window.eventBus) {
        window.eventBus.emit('reservationDeleted', {
          reservationId: this._reservation.id
        });
      }
      menu.remove();
      backdrop.remove();
    });

    menu.appendChild(deleteBtn);

    // アシスタント配置OFF/ONトグル（fixedAssistants 一括/個別 __none__ 方式）
    const res = this._reservation;
    if (!res.isVirtualSummon) {
      // 区切り線
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px; background:var(--border-glass); margin:4px 0;';
      menu.appendChild(divider);

      const menus = Storage.loadMenus();
      const effectiveMenu = typeof res.getEffectiveMenu === 'function'
        ? res.getEffectiveMenu(menus)
        : menus.find(m => m.id === res.menuItemId);
      const slots = effectiveMenu?.assistantSlots || [];
      const isAllOff = slots.length > 0 && slots.every((_, i) => res.fixedAssistants && res.fixedAssistants[i] === '__none__');

      const isCombined = res.items && Array.isArray(res.items) && res.items.length > 1;

      // 結合予約（複数メニュー）の場合、各メニューごとのトグルを生成
      if (isCombined) {
        let currentSlotIdx = 0;
        res.items.forEach(item => {
          const itemMenu = menus.find(m => m.id === item.menuItemId);
          if (!itemMenu || !itemMenu.assistantSlots || itemMenu.assistantSlots.length === 0) return;

          const numSlots = itemMenu.assistantSlots.length;
          const indices = Array.from({ length: numSlots }, (_, i) => currentSlotIdx + i);
          currentSlotIdx += numSlots;

          const isMenuOff = indices.every(idx => res.fixedAssistants && res.fixedAssistants[idx] === '__none__');

          const toggleBtn = document.createElement('div');
          toggleBtn.textContent = isMenuOff
            ? `🔔 [${itemMenu.name}] の配置をON`
            : `🔕 [${itemMenu.name}] の配置をOFF`;
          toggleBtn.title = `${itemMenu.name} のアシスタント配置を切り替えます`;
          toggleBtn.style.padding = '8px 16px';
          toggleBtn.style.fontSize = '12px';
          toggleBtn.style.color = isMenuOff ? 'var(--accent-success)' : 'var(--accent-warning)';
          toggleBtn.style.cursor = 'pointer';
          toggleBtn.style.transition = 'background var(--transition-fast)';
          toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = 'var(--bg-tertiary)'; });
          toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = 'transparent'; });
          toggleBtn.addEventListener('click', () => {
            if (window.eventBus) {
              window.eventBus.emit('reservationUpdated', {
                reservationId: res.id,
                changes: { targetSlotIndices: indices, turnOff: !isMenuOff }
              });
            }
            menu.remove();
            backdrop.remove();
          });
          menu.appendChild(toggleBtn);
        });

        // 結合予約用の区切り線
        const innerDivider = document.createElement('div');
        innerDivider.style.cssText = 'height:1px; background:var(--border-glass); margin:4px 0;';
        menu.appendChild(innerDivider);
      } else if (slots.length > 1) {
        // 【ハイブリッド型拡張】単一メニューだが、複数スロットを持つ場合（例：ダブルカラー）
        // スロット単位での個別トグルを生成する
        const skillsData = Storage.loadData('sb_skills') || [];
        
        slots.forEach((slot, idx) => {
          const isSlotOff = res.fixedAssistants && res.fixedAssistants[idx] === '__none__';
          // スキルの表示名を解決
          const skillName = skillsData.find(s => s.id === slot.requiredSkill)?.label || slot.requiredSkill || 'アシスタント';
          
          const toggleBtn = document.createElement('div');
          toggleBtn.textContent = isSlotOff
            ? `🔔 [${skillName}] の配置をON`
            : `🔕 [${skillName}] の配置をOFF`;
          toggleBtn.title = `${skillName} のアシスタント配置を切り替えます`;
          toggleBtn.style.padding = '8px 16px';
          toggleBtn.style.fontSize = '12px';
          toggleBtn.style.color = isSlotOff ? 'var(--accent-success)' : 'var(--accent-warning)';
          toggleBtn.style.cursor = 'pointer';
          toggleBtn.style.transition = 'background var(--transition-fast)';
          toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = 'var(--bg-tertiary)'; });
          toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = 'transparent'; });
          toggleBtn.addEventListener('click', () => {
            if (window.eventBus) {
              window.eventBus.emit('reservationUpdated', {
                reservationId: res.id,
                changes: { targetSlotIndices: [idx], turnOff: !isSlotOff }
              });
            }
            menu.remove();
            backdrop.remove();
          });
          menu.appendChild(toggleBtn);
        });

        // スロット用の区切り線
        const innerDivider = document.createElement('div');
        innerDivider.style.cssText = 'height:1px; background:var(--border-glass); margin:4px 0;';
        menu.appendChild(innerDivider);
      }

      // 全体の一括ON/OFFボタン
      const allToggleBtn = document.createElement('div');
      
      allToggleBtn.textContent = isAllOff
        ? (isCombined ? '🔔 すべての配置をON（自動）に戻す' : '🔔 アシスタント配置 ON')
        : (isCombined ? '🔕 すべての配置を一括OFFにする' : '🔕 アシスタント配置 OFF');
      
      allToggleBtn.title = isAllOff
        ? 'アシスタントの自動配置を有効にする'
        : 'この予約のアシスタント配置をOFFにする';
      allToggleBtn.style.padding = '8px 16px';
      allToggleBtn.style.fontSize = '12px';
      allToggleBtn.style.color = isAllOff ? 'var(--accent-success)' : 'var(--accent-warning)';
      allToggleBtn.style.cursor = 'pointer';
      allToggleBtn.style.transition = 'background var(--transition-fast)';
      allToggleBtn.addEventListener('mouseenter', () => { allToggleBtn.style.background = 'var(--bg-tertiary)'; });
      allToggleBtn.addEventListener('mouseleave', () => { allToggleBtn.style.background = 'transparent'; });
      allToggleBtn.addEventListener('click', () => {
        if (window.eventBus) {
          window.eventBus.emit('reservationUpdated', {
            reservationId: res.id,
            changes: { allSlotsOff: !isAllOff }
          });
        }
        menu.remove();
        backdrop.remove();
      });
      menu.appendChild(allToggleBtn);
    }

    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    requestAnimationFrame(() => {
      menu.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
      menu.style.opacity = '1';
      menu.style.transform = 'scale(1)';
    });
  }

  /**
   * 詳細ポップアップを閉じる
   * @private
   */
  _closePopup() {
    if (this._popup) {
      this._popup.style.opacity = '0';
      this._popup.style.transform = 'translateY(-8px)';
      setTimeout(() => {
        if (this._popup && this._popup.parentNode) {
          this._popup.parentNode.removeChild(this._popup);
        }
        this._popup = null;
      }, 200);
    }
    if (this._popupBackdrop) {
      this._popupBackdrop.remove();
      this._popupBackdrop = null;
    }
  }

  updateAssistants(assignments, blockAlerts, isInManncell = false, gapHelpsMap = {}) {
    this._reservation.assignedAssistants = assignments;
    if (this._element) {
      const slotsContainer = this._element.querySelector('.reservation-slots');
      if (slotsContainer) {
        const slotEls = slotsContainer.querySelectorAll('.assistant-slot');
        slotEls.forEach((slotEl, idx) => {
          let assistantEl = slotEl.querySelector('.slot-assistant');
          const isFixed = this._reservation.fixedAssistants && this._reservation.fixedAssistants[idx];
          const slotAlert = blockAlerts ? blockAlerts.find(a => a.slotIndex === idx) : null;

          // 既存のスキマヘルプ要素をクリーンアップ
          const oldGapHelp = slotEl.querySelector('.slot-gap-help-text');
          if (oldGapHelp) oldGapHelp.remove();

          // 旧バージョンのスロット内えらいバッジをクリーンアップ（ブロックレベルに移行済み）
          const oldSlotErai = slotEl.querySelector('.slot-erai-badge');
          if (oldSlotErai) oldSlotErai.remove();

          if (!assistantEl) {
            assistantEl = document.createElement('span');
            assistantEl.className = 'slot-assistant';
            assistantEl.style.fontSize = '9px';
            assistantEl.style.display = 'inline-block';
            assistantEl.style.transform = 'scale(0.85)';
            assistantEl.style.transformOrigin = 'center';
            assistantEl.style.fontWeight = 'bold';
            assistantEl.style.whiteSpace = 'nowrap';
            assistantEl.style.cursor = 'pointer';
            assistantEl.style.pointerEvents = 'auto';
            assistantEl.style.padding = '2px 4px';
            assistantEl.style.borderRadius = '2px';
            assistantEl.style.backgroundColor = 'rgba(0,0,0,0.3)';
            assistantEl.title = 'クリックしてアシスタントを手動配置';
            
            assistantEl.addEventListener('click', (e) => {
              const mainView = window.__mainViewInstance;
              if (mainView && (mainView.isManualMode || mainView.isGanbareMode)) {
                e.stopPropagation();
                e.preventDefault();
                
                if (window.eventBus) {
                  const currentAssigns = this._reservation.assignedAssistants;
                  window.eventBus.emit('assistantSlotClicked', {
                    reservationId: this._reservation.id,
                    slotIndex: idx,
                    currentAssistantId: currentAssigns && currentAssigns[idx] ? currentAssigns[idx].id : null,
                    clientX: e.clientX,
                    clientY: e.clientY
                  });
                }
              }
            });
            slotEl.appendChild(assistantEl);
          }

          if (assignments && assignments[idx]) {
            const assignedId = assignments[idx].id || assignments[idx];
            const isConcurrent = !!assignments[idx].isConcurrent;
            
            if (assignedId === '__none__') {
              // 「アシスタント配置OFF」スロット
              assistantEl.style.color = '#94a3b8';
              assistantEl.textContent = '🚫 OFF';
              const oldBadge = slotEl.querySelector('.slot-concurrent-badge');
              if (oldBadge) oldBadge.remove();
              // えらいバッジはブロックレベルで管理（updateAssistants末尾）
            } else if (assignedId === '__manncell__') {
              // マンセル（チーム連携）の場合は【チーム制】+ 担当者名の2段表示
              const teamName = assignments[idx].manncellTeam || 'チーム';
              assistantEl.className = 'slot-assistant manncell-assigned-text';
              assistantEl.style.color = '';  // CSSクラスに任せる
              assistantEl.innerHTML = `<span class="manncell-label">【チーム制】</span><span class="manncell-team-name">${teamName}</span>`;
              const oldBadge = slotEl.querySelector('.slot-concurrent-badge');
              if (oldBadge) oldBadge.remove();

            } else {

              const fixedId = this._reservation.fixedAssistants ? this._reservation.fixedAssistants[idx] : null;
              const actuallyFixed = isFixed && (assignedId === fixedId);
              const nameStr = assignments[idx].nickname || assignments[idx].name || assignments[idx];

              // 【修正D】gap_help による不足共存表示: 
              // displayParts に ⚠不足 が含まれている場合（HTMLスパン内のインラインスタイルで赤色表示）、
              // 親要素の色をdanger色に設定し、赤枠の視認性を高める。
              const hasShortageText = typeof nameStr === 'string' && nameStr.includes('⚠不足');
              if (hasShortageText) {
                assistantEl.style.color = 'var(--accent-danger)';
              } else {
                assistantEl.style.color = actuallyFixed ? '#fcd34d' : 'var(--accent-success)';
              }
              assistantEl.innerHTML = (actuallyFixed ? '📌 ' : '') + nameStr;

              // 兼任バッジの表示制御
              const oldBadge = slotEl.querySelector('.slot-concurrent-badge');
              if (oldBadge) oldBadge.remove();
              if (isConcurrent) {
                this._addConcurrentBadge(slotEl);
              }
            }
          } else if (slotAlert) {
            assistantEl.style.color = 'var(--accent-danger)';
            assistantEl.textContent = '⚠️不足';
            const oldBadge2 = slotEl.querySelector('.slot-concurrent-badge');
            if (oldBadge2) oldBadge2.remove();
          } else {
            assistantEl.style.color = 'var(--text-tertiary)';
            assistantEl.textContent = isInManncell ? 'X' : '';
            const oldBadge3 = slotEl.querySelector('.slot-concurrent-badge');
            if (oldBadge3) oldBadge3.remove();
          }

          // === スキマヘルプの段を追加（通常アサイン名の下に表示） ===
          const gapHelpText = gapHelpsMap[idx] || gapHelpsMap[String(idx)] || '';
          if (gapHelpText) {
            const gapHelpEl = document.createElement('span');
            gapHelpEl.className = 'slot-gap-help-text';
            gapHelpEl.textContent = gapHelpText;
            slotEl.appendChild(gapHelpEl);
          }
        });
      }

      // === ブロックレベルの「えらい！」バッジ管理 ===
      // いずれかのスロットが __none__ であればブロック右上に表示
      const hasAnyOff = assignments && Object.keys(assignments).length > 0 &&
        Object.values(assignments).some(a => (a.id || a) === '__none__');
      let eraiBadge = this._element.querySelector('.reservation-erai-badge');
      if (hasAnyOff) {
        if (!eraiBadge) {
          eraiBadge = document.createElement('span');
          eraiBadge.className = 'reservation-erai-badge';
          eraiBadge.textContent = '🏆 えらい！';
          eraiBadge.style.cssText = `
            position: absolute;
            top: -6px;
            right: -6px;
            z-index: 25;
            font-size: 8px;
            font-weight: bold;
            padding: 1px 5px;
            border-radius: 8px;
            background: linear-gradient(135deg, #f59e0b, #fbbf24, #f59e0b);
            color: #1a1a2e;
            text-shadow: 0 0 2px rgba(255,255,255,0.4);
            box-shadow: 0 1px 4px rgba(245,158,11,0.4);
            animation: eraiBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            pointer-events: none;
          `;
          this._element.appendChild(eraiBadge);
        }
      } else {
        if (eraiBadge) eraiBadge.remove();
      }

    }
  }

  /**
   * 頑張れ配置の表示を更新する（スロット枠内に描画）
   */
  updateGanbare() {
    if (!this._element) return;
    
    const slotsContainer = this._element.querySelector('.reservation-slots');
    if (!slotsContainer) return;

    const slotEls = slotsContainer.querySelectorAll('.assistant-slot');
    slotEls.forEach((slotEl, idx) => {
      // 既存の表示をクリア
      const oldGanbare = slotEl.querySelector('.slot-ganbare-text');
      if (oldGanbare) oldGanbare.remove();

      const ganbareIds = this._reservation.ganbare ? this._reservation.ganbare[idx] : null;
      if (ganbareIds && ganbareIds.length > 0) {
        const allStaff = [...Storage.loadAssistants(), ...Storage.loadStylists()];
        const staffMap = new Map(allStaff.map(s => [s.id, s]));
        const names = ganbareIds.map(id => {
          const s = staffMap.get(id);
          return s ? (s.nickname || s.name) : id;
        });

        const ganbareEl = document.createElement('span');
        ganbareEl.className = 'slot-ganbare-text';
        ganbareEl.innerHTML = `🔥 ${names.join('・')}`;
        ganbareEl.style.fontSize = '8px';
        ganbareEl.style.display = 'block'; 
        ganbareEl.style.color = '#f97316';
        ganbareEl.style.fontWeight = 'bold';
        ganbareEl.style.whiteSpace = 'nowrap';
        ganbareEl.style.marginTop = '2px';
        ganbareEl.style.transform = 'scale(0.85)';
        ganbareEl.style.transformOrigin = 'left top';
        
        slotEl.appendChild(ganbareEl);
      }
    });

    // 文字の段数に応じて高さをピクセル単位で明示的に調整する
    this._adjustHeightForContent();
  }

  /**
   * スロット内の段数（通常/スキマ/頑張れ）に応じてブロック高さをピクセル単位で明示的に設定する
   * @private
   */
  _adjustHeightForContent() {
    if (!this._element) return;
    const slotsContainer = this._element.querySelector('.reservation-slots');
    if (!slotsContainer) return;

    let maxLines = 1; // 最低1段（通常アサインの枠）
    const slotEls = slotsContainer.querySelectorAll('.assistant-slot');
    slotEls.forEach(slotEl => {
      let lines = 1;
      if (slotEl.querySelector('.slot-gap-help-text')) lines++;
      if (slotEl.querySelector('.slot-ganbare-text')) lines++;
      if (lines > maxLines) maxLines = lines;
    });

    // 1段追加されるごとに +12px する
    const extraHeight = (maxLines - 1) * 12;
    
    // ベース高さを固定値として取得 (CELL_HEIGHT=60 を前提)
    const BASE_BLOCK_HEIGHT = 56; 
    const BASE_SLOTS_HEIGHT = 36; 

    this._element.style.height = `${BASE_BLOCK_HEIGHT + extraHeight}px`;
    slotsContainer.style.height = `${BASE_SLOTS_HEIGHT + extraHeight}px`;
  }

  /**
   * スロットの右上に兼任バッジを配置する
   * @param {HTMLElement} slotEl - アシスタントスロット要素
   * @private
   */
  _addConcurrentBadge(slotEl) {
    const badge = document.createElement('span');
    badge.className = 'slot-concurrent-badge';
    badge.textContent = '兼任';
    badge.style.cssText = `
      position: absolute;
      top: -4px;
      right: -4px;
      z-index: 10;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #fff;
      background: linear-gradient(135deg, #f59e0b, #ef6c00);
      padding: 1px 5px;
      border-radius: 3px;
      box-shadow: 0 1px 6px rgba(245, 158, 11, 0.5), 0 0 0 1px rgba(255,255,255,0.15) inset;
      pointer-events: none;
      line-height: 1;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      animation: concurrentBadgePop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    `;
    badge.title = '同一スタイリスト内の兼任アサイン（順次対応）';
    slotEl.appendChild(badge);
  }

  /**
   * 予約ブロックにハイライト効果を適用する
   * @param {'overlap'|'alert'|'summon'} type - ハイライトタイプ
   */
  highlight(type) {
    if (!this._element) return;

    // 既存のハイライトを解除
    this._element.classList.remove('highlight-overlap', 'highlight-alert', 'highlight-summon');

    switch (type) {
      case 'overlap':
        this._element.classList.add('highlight-overlap');
        this._element.style.boxShadow = '0 0 12px var(--accent-warning)';
        break;
      case 'alert':
        this._element.classList.add('highlight-alert');
        this._element.style.boxShadow = '0 0 12px var(--accent-danger)';
        // アラートバッジを追加
        AlertBadge.createAlert(this._element, '人数不足', 'danger');
        break;
      case 'summon':
        this._element.classList.add('highlight-summon');
        this._element.style.boxShadow = '0 0 12px var(--accent-secondary)';
        break;
      default:
        this._element.style.boxShadow = 'none';
    }
  }

  /**
   * イベントリスナーをクリーンアップする
   * @private
   */
  _cleanup() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._closePopup();
  }

  /**
   * コンポーネントを破棄し、すべてのリソースを解放する
   */
  destroy() {
    this._cleanup();
    if (this._element && this._element.parentNode) {
      this._element.parentNode.removeChild(this._element);
    }
    this._element = null;
  }
}
