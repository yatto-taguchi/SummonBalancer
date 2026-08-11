/**
 * @fileoverview メモポップオーバーコンポーネント
 * 予約のメモを編集・表示するためのUI部品
 */

class MemoPopover {
  constructor() {
    this.element = null;
    this.overlay = null;
    this.textarea = null;
    this.currentReservationId = null;
    this.targetElement = null;
    this._init();
  }

  _init() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'memo-popover-overlay';
    Object.assign(this.overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '9998',
      display: 'none',
      backgroundColor: 'transparent'
    });
    this.overlay.addEventListener('click', () => this.hide());
    document.body.appendChild(this.overlay);

    this.element = document.createElement('div');
    this.element.className = 'memo-popover';
    Object.assign(this.element.style, {
      position: 'absolute',
      zIndex: '9999',
      display: 'none',
      backgroundColor: 'var(--surface, #1e1e1e)',
      border: '1px solid var(--border, #333)',
      borderRadius: 'var(--radius-md, 8px)',
      boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
      padding: '12px',
      width: '240px',
      flexDirection: 'column',
      gap: '8px'
    });

    // Arrow indicator
    const arrow = document.createElement('div');
    Object.assign(arrow.style, {
      position: 'absolute',
      width: '0',
      height: '0',
      borderLeft: '8px solid transparent',
      borderRight: '8px solid transparent',
      borderBottom: '8px solid var(--surface, #1e1e1e)',
      top: '-8px',
      left: '12px', // Default
      filter: 'drop-shadow(0 -1px 1px rgba(0,0,0,0.1))'
    });
    this.arrow = arrow;
    this.element.appendChild(arrow);

    const title = document.createElement('div');
    title.textContent = 'メモ';
    title.style.fontWeight = 'bold';
    title.style.fontSize = '12px';
    title.style.color = 'var(--text-secondary, #aaa)';
    
    this.textarea = document.createElement('textarea');
    Object.assign(this.textarea.style, {
      width: '100%',
      height: '80px',
      resize: 'none',
      border: '1px solid var(--border, #333)',
      borderRadius: 'var(--radius-sm, 4px)',
      backgroundColor: 'var(--background, #121212)',
      color: 'var(--text-primary, #fff)',
      padding: '8px',
      boxSizing: 'border-box',
      fontSize: '12px'
    });

    const btnContainer = document.createElement('div');
    Object.assign(btnContainer.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
      marginTop: '4px'
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.style.padding = '4px 8px';
    cancelBtn.style.fontSize = '12px';
    cancelBtn.addEventListener('click', () => this.hide());

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.className = 'btn btn-primary';
    saveBtn.style.padding = '4px 8px';
    saveBtn.style.fontSize = '12px';
    saveBtn.addEventListener('click', () => this.save());

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(saveBtn);

    this.element.appendChild(title);
    this.element.appendChild(this.textarea);
    this.element.appendChild(btnContainer);

    document.body.appendChild(this.element);
  }

  show(reservationId, currentMemo, targetElement) {
    this.currentReservationId = reservationId;
    this.targetElement = targetElement;
    this.textarea.value = currentMemo || '';
    
    this.overlay.style.display = 'block';
    this.element.style.display = 'flex';
    
    this._updatePosition();
    this.textarea.focus();
  }

  _updatePosition() {
    if (!this.targetElement) return;
    
    const rect = this.targetElement.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    let top = rect.bottom + scrollTop + 8; // 8px for arrow
    let left = rect.left + scrollLeft - 12;

    // Check bottom boundary
    if (top + this.element.offsetHeight > window.innerHeight + scrollTop) {
        top = rect.top + scrollTop - this.element.offsetHeight - 8;
        this.arrow.style.top = 'auto';
        this.arrow.style.bottom = '-8px';
        this.arrow.style.borderBottom = 'none';
        this.arrow.style.borderTop = '8px solid var(--surface, #1e1e1e)';
        this.arrow.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.1))';
    } else {
        this.arrow.style.top = '-8px';
        this.arrow.style.bottom = 'auto';
        this.arrow.style.borderTop = 'none';
        this.arrow.style.borderBottom = '8px solid var(--surface, #1e1e1e)';
        this.arrow.style.filter = 'drop-shadow(0 -1px 1px rgba(0,0,0,0.1))';
    }

    // Check right boundary
    if (left + this.element.offsetWidth > window.innerWidth + scrollLeft) {
        left = window.innerWidth + scrollLeft - this.element.offsetWidth - 16;
        const offset = (rect.left + scrollLeft) - left + (rect.width / 2) - 8;
        this.arrow.style.left = `${Math.min(Math.max(offset, 12), this.element.offsetWidth - 20)}px`;
    } else {
        this.arrow.style.left = '12px';
    }

    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  hide() {
    this.overlay.style.display = 'none';
    this.element.style.display = 'none';
    this.currentReservationId = null;
    this.targetElement = null;
  }

  save() {
    if (!this.currentReservationId) return;
    const newMemo = this.textarea.value.trim();
    
    // UIを部分更新するためのイベント発火
    if (window.eventBus) {
        window.eventBus.emit('memoUpdated', {
            reservationId: this.currentReservationId,
            memo: newMemo
        });
    }

    this.hide();
  }
}

export const memoPopover = new MemoPopover();
