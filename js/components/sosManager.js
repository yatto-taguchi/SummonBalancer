/**
 * @fileoverview SOSモードのUIやロジックを管理する独立コンポーネント
 * 計算エンジン（SSOT）への干渉を防ぐため、完全に独立した機能として実装。
 */

import * as Storage from '../services/storage.js?v=12';

class SOSManager {
  constructor() {
    this.isSOSMode = false;
    this.currentDate = new Date().toISOString().split('T')[0];
    this.mainView = null;
  }

  /**
   * mainViewインスタンスを登録（描画リフレッシュ等のため）
   */
  init(mainView) {
    this.mainView = mainView;
  }

  /**
   * 日付をセット
   */
  setDate(date) {
    if (typeof date === 'string') {
      this.currentDate = date;
    } else if (date instanceof Date) {
      // ローカル時間の YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      this.currentDate = `${year}-${month}-${day}`;
    }
  }

  /**
   * SOSモードのオン/オフを切り替え
   */
  toggleMode() {
    this.isSOSMode = !this.isSOSMode;
    return this.isSOSMode;
  }

  /**
   * 予約ブロックがクリックされた際のハンドラ
   * @param {Object} reservation - クリックされた予約データ
   * @param {Event} event - マウスイベント
   * @returns {boolean} SOSモードで処理した場合はtrue
   */
  handleReservationClick(reservation, event) {
    if (!this.isSOSMode) return false;

    // バーチャル予約（空き時間など）にはSOSを出せないようにする
    if (reservation.isVirtualActivity || reservation.isVirtualSummon) {
      alert('空き時間等のブロックにはSOSを設定できません。お客様の予約ブロックを選択してください。');
      return true;
    }

    this._showSOSDialog(reservation);
    return true; // イベント消費
  }

  /**
   * 時間指定ダイアログを表示する
   */
  _showSOSDialog(reservation) {
    // 既存のモーダルがあれば削除
    const existing = document.getElementById('sos-modal');
    if (existing) existing.remove();

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'sos-modal';
    modalOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center;
      z-index: 9999;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: var(--surface-card, #1e293b);
      padding: 24px; border-radius: 12px; width: 320px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      color: var(--text-primary, #f8fafc);
    `;

    const defStart = reservation.startTime || '09:00';
    const defEnd = reservation.endTime || defStart;

    modalContent.innerHTML = `
      <h3 style="margin-top:0; color: #ef4444; display: flex; align-items: center; gap: 8px;">
        <span>🚨</span> SOSの要請
      </h3>
      <p style="font-size: 13px; color: var(--text-secondary, #94a3b8); margin-bottom: 16px;">
        この予約に対して、アシスタント全員にヘルプを要請する時間を指定してください。<br>
        <span style="color: #ef4444;">※タイムライン上部の赤いテキスト帯をクリックすると解除できます。</span>
      </p>
      
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 12px; margin-bottom: 4px;">開始時間</label>
        <input type="time" id="sos-start-time" value="${defStart}" class="form-input" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1); box-sizing: border-box;">
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 12px; margin-bottom: 4px;">終了時間</label>
        <input type="time" id="sos-end-time" value="${defEnd}" class="form-input" style="width: 100%; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1); box-sizing: border-box;">
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="sos-cancel" style="padding: 8px 16px; border-radius: 6px; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: white; cursor: pointer;">キャンセル</button>
        <button id="sos-submit" style="padding: 8px 16px; border-radius: 6px; background: #ef4444; border: none; color: white; cursor: pointer; font-weight: bold;">SOSを発信</button>
      </div>
    `;

    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // イベントリスナー
    modalContent.querySelector('#sos-cancel').addEventListener('click', () => {
      modalOverlay.remove();
    });

    modalContent.querySelector('#sos-submit').addEventListener('click', () => {
      const startTime = document.getElementById('sos-start-time').value;
      const endTime = document.getElementById('sos-end-time').value;

      if (!startTime || !endTime || startTime >= endTime) {
        alert('正しい時間を指定してください。');
        return;
      }

      // スタイリスト名を取得
      const stylists = Storage.loadStylists();
      const stylist = stylists.find(s => s.id === reservation.stylistId);
      const stylistName = stylist ? stylist.name : '不明';

      const sosData = {
        id: 'sos_' + Date.now(),
        reservationId: reservation.id,
        stylistName: stylistName,
        startTime: startTime,
        endTime: endTime
      };

      try {
        Storage.saveSOSRequest(this.currentDate, sosData);
        modalOverlay.remove();
        
        // SOSモードを自動的に解除
        this.isSOSMode = false;
        
        if (this.mainView) {
          // mainView側でモードボタンの表示を戻し、全体を再描画する
          const btn = document.querySelector('[data-action="sos-mode"]');
          if (btn) btn.classList.remove('active');
          this.mainView.refresh();
        }
      } catch (err) {
        alert('SOSの保存に失敗しました。');
      }
    });
  }

  /**
   * 該当する予約ブロックにSOSマークを描画する（reservation.jsから呼ばれる想定）
   * @param {Object} reservation
   * @param {HTMLElement} blockElement
   */
  applySOSMarkToReservation(reservation, blockElement) {
    const sosRequests = Storage.loadSOSRequests(this.currentDate);
    const hasSOS = sosRequests.some(s => s.reservationId === reservation.id);
    
    if (hasSOS) {
      // 既にマークがあれば何もしない
      if (blockElement.querySelector('.sos-badge')) return;

      const badge = document.createElement('div');
      badge.className = 'sos-badge';
      badge.textContent = '🆘';
      badge.style.cssText = `
        position: absolute;
        top: -8px;
        right: -8px;
        font-size: 16px;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        animation: sos-pulse 1.5s infinite;
        z-index: 10;
      `;
      blockElement.appendChild(badge);

      // keyframes for pulse if not exists
      if (!document.getElementById('sos-styles')) {
        const style = document.createElement('style');
        style.id = 'sos-styles';
        style.textContent = `
          @keyframes sos-pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
        `;
        document.head.appendChild(style);
      }
    }
  }

  /**
   * タイムライン上の全行（スタイリスト＋アシスタント）にSOS帯を描画する
   * mainView.jsの描画フローの最後に呼ばれる
   * @param {HTMLElement} timelineArea タイムライン全体（#timeline-area）
   */
  drawSOSBands(timelineArea) {
    if (!timelineArea) return;

    // 既存の帯をクリア
    const existingBands = timelineArea.querySelectorAll('.sos-band');
    existingBands.forEach(el => el.remove());

    const sosRequests = Storage.loadSOSRequests(this.currentDate);
    if (!sosRequests || sosRequests.length === 0) return;

    const CELL_WIDTH = 80;
    const START_HOUR = 9;
    const SOS_BAND_HEIGHT = 24;    // 点線エリアの高さ
    const SOS_TEXT_HEIGHT = 20;    // テキストバッジの飛び出し高さ

    sosRequests.forEach(sos => {
      const startParts = sos.startTime.split(':');
      const endParts = sos.endTime.split(':');
      
      const startH = parseInt(startParts[0], 10);
      const startM = parseInt(startParts[1], 10);
      const endH = parseInt(endParts[0], 10);
      const endM = parseInt(endParts[1], 10);

      const startIndex = (startH - START_HOUR) * 2 + (startM >= 30 ? 1 : 0);
      const endIndex = (endH - START_HOUR) * 2 + (endM >= 30 ? 1 : 0);
      const durationSlots = Math.max(1, endIndex - startIndex);

      const leftPx = startIndex * CELL_WIDTH;
      const widthPx = durationSlots * CELL_WIDTH;

      // 外枠コンテナ: テキスト飛び出し分 + 帯本体を含む
      const wrapper = document.createElement('div');
      wrapper.className = 'sos-band';
      wrapper.style.cssText = `
        position: absolute;
        left: ${leftPx}px;
        width: ${widthPx}px;
        top: 0;
        height: ${SOS_TEXT_HEIGHT + SOS_BAND_HEIGHT}px;
        pointer-events: none;
        z-index: 100;
        overflow: visible;
        box-sizing: border-box;
      `;

      // 上部テキストバッジ（帯の上側に飛び出す形で左端揃え）
      const text = document.createElement('div');
      text.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        background: rgba(239, 68, 68, 0.7);
        color: white;
        font-weight: bold;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px 4px 0 0;
        white-space: nowrap;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        line-height: ${SOS_TEXT_HEIGHT - 4}px;
        height: ${SOS_TEXT_HEIGHT}px;
        box-sizing: border-box;
        pointer-events: auto;
        cursor: pointer;
      `;
      text.textContent = `🚨 ${sos.stylistName} SOS ${sos.startTime}〜${sos.endTime} ✕`;
      
      // テンプレート用のテキストバッジ（クリックイベントは複製後に追加する）
      // 点線エリア（時間範囲の視覚マーク）
      const band = document.createElement('div');
      band.style.cssText = `
        position: absolute;
        left: 0;
        width: 100%;
        top: ${SOS_TEXT_HEIGHT}px;
        height: ${SOS_BAND_HEIGHT}px;
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.6);
        box-sizing: border-box;
      `;

      wrapper.appendChild(text);
      wrapper.appendChild(band);

      // 全行ブロードキャスト（スタイリスト＋アシスタント全行に描画）
      const allRows = timelineArea.querySelectorAll('.timeline-row .timeline-cells');
      
      allRows.forEach(cellsContainer => {
        const clonedWrapper = wrapper.cloneNode(true);
        // clonedWrapperの最初の子要素がテキストバッジ
        const clonedText = clonedWrapper.firstChild;
        
        // クローンされたテキストバッジに対してクリックイベントを登録
        clonedText.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.confirm('このSOSを解除しますか？')) {
            Storage.deleteSOSRequest(this.currentDate, sos.id);
            if (this.mainView) {
              this.mainView.refresh();
            }
          }
        });

        cellsContainer.appendChild(clonedWrapper);
      });
    });
  }
}

export const sosManager = new SOSManager();
