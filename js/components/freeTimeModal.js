/**
 * freeTimeModal.js — 空き時間活動選択モーダル
 *
 * 空き時間ブロックをクリックした際に表示されるモーダル。
 * 7つの選択肢から活動内容を選び、記録する。
 */

/**
 * 空き時間活動の選択肢
 * @type {Array<{id: string, label: string, hasInput: boolean, note?: string}>}
 */
const FREE_TIME_OPTIONS = [
  { id: 'normal_cleaning', label: '通常の掃除', hasInput: false },
  { id: 'special_cleaning', label: '特別掃除', hasInput: true, placeholder: '掃除内容を入力' },
  { id: 'errand', label: 'お使いや発注など', hasInput: false },
  { id: 'extra_practice', label: '練習', hasInput: false, note: 'この時間で行う場合は許可を取る事' },
  { id: 'extra_teaching', label: '後輩の指導', hasInput: false, note: '許可を取る事' },
  { id: 'nothing', label: '何もできなかった', hasInput: false },
  { id: 'other', label: 'その他', hasInput: true, placeholder: '内容を入力' }
];

/**
 * 選択肢IDから表示ラベルを取得する
 * @param {string} typeId - 選択肢ID
 * @param {string} [detail] - 詳細テキスト
 * @returns {string} 表示用ラベル
 */
export function getFreeTimeLabel(typeId, detail) {
  const option = FREE_TIME_OPTIONS.find(o => o.id === typeId);
  if (!option) return typeId;
  if (detail && option.hasInput) {
    return `${option.label}（${detail}）`;
  }
  return option.label;
}

export class FreeTimeModal {
  /**
   * @param {HTMLElement} container - モーダルを追加する親要素
   */
  constructor(container) {
    this._container = container;
    this._overlay = null;
    this._currentData = null;
  }

  /**
   * モーダルを開く
   * @param {Object} data - 空き時間ブロックのデータ
   * @param {string} data.staffId - スタッフID
   * @param {string} data.staffName - スタッフ名
   * @param {number} data.startMinutes - 開始時刻（分）
   * @param {number} data.endMinutes - 終了時刻（分）
   * @param {string} data.blockId - ブロックID
   * @param {{type: string, detail?: string}} [data.currentSelection] - 現在の選択
   */
  open(data) {
    this.close();
    this._currentData = data;

    const startTime = this._minutesToTime(data.startMinutes);
    const endTime = this._minutesToTime(data.endMinutes);

    // オーバーレイ
    const overlay = document.createElement('div');
    overlay.className = 'free-time-modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // モーダル本体
    const modal = document.createElement('div');
    modal.className = 'free-time-modal';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'free-time-modal-header';
    header.innerHTML = `
      <h3 class="free-time-modal-title">空き時間の活動記録</h3>
      <div class="free-time-modal-subtitle">${data.staffName}　${startTime}〜${endTime}</div>
    `;
    modal.appendChild(header);

    // 選択肢リスト
    const optionsList = document.createElement('div');
    optionsList.className = 'free-time-modal-options';

    let selectedId = data.currentSelection?.type || null;
    let inputValues = {};
    if (data.currentSelection?.detail) {
      inputValues[selectedId] = data.currentSelection.detail;
    }

    // 「早めに休憩に入る」オプション（昼食後〜休憩前の空き時間のみ）
    if (data.isConvertibleToRest) {
      const restItem = document.createElement('div');
      restItem.className = 'free-time-modal-option rest-convert-option';
      restItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        margin-bottom: 8px;
        background: linear-gradient(135deg, #0d9488aa, #0d948844);
        border: 1px solid #0d948888;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: #5eead4;
        font-weight: 600;
      `;
      restItem.innerHTML = `
        <span style="font-size: 16px;">☕</span>
        <span>早めに休憩に入る</span>
        <span style="font-size: 10px; opacity: 0.7; margin-left: auto;">この時間に休憩を移動</span>
      `;
      restItem.addEventListener('mouseenter', () => {
        restItem.style.background = 'linear-gradient(135deg, #0d9488cc, #0d948866)';
        restItem.style.boxShadow = '0 0 16px #0d948844';
      });
      restItem.addEventListener('mouseleave', () => {
        restItem.style.background = 'linear-gradient(135deg, #0d9488aa, #0d948844)';
        restItem.style.boxShadow = 'none';
      });
      restItem.addEventListener('click', () => {
        if (window.eventBus) {
          window.eventBus.emit('convertActivityToRest', {
            staffId: data.staffId,
            startTimeOffset: data.startMinutes
          });
        }
        this.close();
      });
      optionsList.appendChild(restItem);

      // 区切り線
      const divider = document.createElement('div');
      divider.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.1); margin: 8px 0;';
      optionsList.appendChild(divider);
    }

    FREE_TIME_OPTIONS.forEach(option => {
      const item = document.createElement('label');
      item.className = 'free-time-modal-option';
      if (option.id === selectedId) {
        item.classList.add('selected');
      }

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'free-time-activity';
      radio.value = option.id;
      radio.checked = option.id === selectedId;
      radio.className = 'free-time-modal-radio';

      const labelText = document.createElement('div');
      labelText.className = 'free-time-modal-label';

      const labelMain = document.createElement('span');
      labelMain.className = 'free-time-modal-label-main';
      labelMain.textContent = option.label;
      labelText.appendChild(labelMain);

      if (option.note) {
        const noteEl = document.createElement('span');
        noteEl.className = 'free-time-modal-note';
        noteEl.textContent = `※${option.note}`;
        labelText.appendChild(noteEl);
      }

      item.appendChild(radio);
      item.appendChild(labelText);

      if (option.hasInput) {
        const inputWrap = document.createElement('div');
        inputWrap.className = 'free-time-modal-input-wrap';
        inputWrap.style.display = option.id === selectedId ? 'block' : 'none';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'free-time-modal-input';
        input.placeholder = option.placeholder || '';
        input.value = inputValues[option.id] || '';
        input.dataset.optionId = option.id;

        inputWrap.appendChild(input);
        item.appendChild(inputWrap);
      }

      radio.addEventListener('change', () => {
        // 全選択肢のスタイルリセット
        optionsList.querySelectorAll('.free-time-modal-option').forEach(el => {
          el.classList.remove('selected');
          const wrap = el.querySelector('.free-time-modal-input-wrap');
          if (wrap) wrap.style.display = 'none';
        });
        // 選択状態を更新
        item.classList.add('selected');
        selectedId = option.id;
        if (option.hasInput) {
          const wrap = item.querySelector('.free-time-modal-input-wrap');
          if (wrap) {
            wrap.style.display = 'block';
            const input = wrap.querySelector('.free-time-modal-input');
            if (input) input.focus();
          }
        }
      });

      optionsList.appendChild(item);
    });

    modal.appendChild(optionsList);

    // フッター（ボタン）
    const footer = document.createElement('div');
    footer.className = 'free-time-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'free-time-modal-btn cancel';
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.addEventListener('click', () => this.close());

    const clearBtn = document.createElement('button');
    clearBtn.className = 'free-time-modal-btn clear';
    clearBtn.textContent = 'クリア';
    clearBtn.addEventListener('click', () => {
      if (window.eventBus) {
        window.eventBus.emit('freeTimeActivitySelected', {
          staffId: data.staffId,
          startMinutes: data.startMinutes,
          blockId: data.blockId,
          selection: null
        });
      }
      this.close();
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'free-time-modal-btn confirm';
    confirmBtn.textContent = '決定';
    confirmBtn.addEventListener('click', () => {
      if (!selectedId) return;

      const selectedOption = FREE_TIME_OPTIONS.find(o => o.id === selectedId);
      let detail = null;
      if (selectedOption?.hasInput) {
        const input = modal.querySelector(`.free-time-modal-input[data-option-id="${selectedId}"]`);
        detail = input?.value?.trim() || null;
      }

      if (window.eventBus) {
        window.eventBus.emit('freeTimeActivitySelected', {
          staffId: data.staffId,
          startMinutes: data.startMinutes,
          blockId: data.blockId,
          selection: { type: selectedId, detail }
        });
      }
      this.close();
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(clearBtn);
    footer.appendChild(confirmBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    this._overlay = overlay;
    this._container.appendChild(overlay);

    // フェードインアニメーション
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });
  }

  /**
   * モーダルを閉じる
   */
  close() {
    if (this._overlay) {
      this._overlay.classList.remove('visible');
      setTimeout(() => {
        this._overlay?.remove();
        this._overlay = null;
      }, 200);
    }
    this._currentData = null;
  }

  /**
   * 分数値を HH:MM 形式に変換
   * @param {number} minutes
   * @returns {string}
   * @private
   */
  _minutesToTime(minutes) {
    const h = 9 + Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
