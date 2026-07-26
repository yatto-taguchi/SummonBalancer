/**
 * @fileoverview メニューバーコンポーネント
 * メニューボタンを表示し、ドラッグ開始を処理する。
 * 各メニューのshortNameをドラッグ可能なボタンとして表示し、
 * タイムラインへのドラッグ＆ドロップ操作の起点となる。
 * @module components/menuBar
 */

/** ボタンサイズ(px) */
const BUTTON_SIZE = 50;

/**
 * メニューバーコンポーネント
 * メニューボタンを表示し、ドラッグ開始を処理する
 */
export class MenuBar {
  /**
   * @param {HTMLElement} container - メニューバーを描画するコンテナ要素 (#menu-bar)
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this._container = container;
    /** @type {AbortController|null} イベントリスナー一括解除用 */
    this._abortController = null;
  }

  /**
   * メニューボタンを描画する
   * @param {import('../models/menu.js').MenuItem[]} menus - メニュー一覧
   */
  render(menus) {
    // クリーンアップ
    this._cleanup();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    this._container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'menu-bar-wrapper';

    menus.forEach((menu) => {
      // CM（カットのみ（メンズ））および CH（カットカラー（先カット））は上部メニューバーに表示せず、
      // 予約追加後の自動切替（掛け持ち時）またはバリエーション選択で切り替える
      if (menu.id === 'cut_only_mens' || menu.id === 'cut_color_cut_first' || menu.hideFromMenuBar) return;
      const btn = this._createMenuButton(menu, signal);
      wrapper.appendChild(btn);
    });

    this._container.appendChild(wrapper);
  }

  /**
   * 個別のメニューボタン要素を生成する
   * @param {import('../models/menu.js').MenuItem} menu - メニューアイテム
   * @param {AbortSignal} signal - AbortSignal
   * @returns {HTMLElement} ボタン要素
   * @private
   */
  _createMenuButton(menu, signal) {
    const btn = document.createElement('div');
    btn.className = 'menu-button';
    btn.draggable = true;
    btn.dataset.menuId = menu.id;
    btn.title = menu.name;

    // スタイル設定
    const colorCode = menu.colorCode || '#6366f1';
    btn.style.width = `${BUTTON_SIZE}px`;
    btn.style.height = `${BUTTON_SIZE}px`;
    btn.style.background = `linear-gradient(135deg, ${colorCode}33, ${colorCode}66)`;
    btn.style.border = `1px solid ${colorCode}88`;
    btn.style.borderRadius = 'var(--radius-md)';
    btn.style.cursor = 'grab';
    btn.style.display = 'flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.transition = 'var(--transition-fast)';
    btn.style.position = 'relative';
    btn.style.userSelect = 'none';

    // ショートネーム（大きめ文字）
    const shortNameEl = document.createElement('span');
    shortNameEl.className = 'menu-button-short';
    shortNameEl.textContent = menu.shortName || menu.name.charAt(0);
    shortNameEl.style.fontSize = '18px';
    shortNameEl.style.fontWeight = 'bold';
    shortNameEl.style.color = colorCode;
    shortNameEl.style.lineHeight = '1';

    // メニュー名（小文字）
    const nameEl = document.createElement('span');
    nameEl.className = 'menu-button-name';
    nameEl.textContent = menu.name;
    nameEl.style.fontSize = '8px';
    nameEl.style.color = 'var(--text-secondary)';
    nameEl.style.marginTop = '2px';
    nameEl.style.lineHeight = '1';
    nameEl.style.whiteSpace = 'nowrap';
    nameEl.style.overflow = 'hidden';
    nameEl.style.textOverflow = 'ellipsis';
    nameEl.style.maxWidth = `${BUTTON_SIZE - 8}px`;

    btn.appendChild(shortNameEl);
    btn.appendChild(nameEl);

    // ツールチップ（ホバー時に詳細表示）
    const tooltip = document.createElement('div');
    tooltip.className = 'menu-tooltip';
    tooltip.textContent = `${menu.name}（${menu.duration}分）`;
    tooltip.style.position = 'absolute';
    tooltip.style.bottom = `${BUTTON_SIZE + 8}px`;
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translateX(-50%)';
    tooltip.style.background = 'var(--bg-tertiary)';
    tooltip.style.color = 'var(--text-primary)';
    tooltip.style.padding = '4px 8px';
    tooltip.style.borderRadius = 'var(--radius-sm)';
    tooltip.style.fontSize = '11px';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.opacity = '0';
    tooltip.style.transition = 'opacity var(--transition-fast)';
    tooltip.style.zIndex = '100';
    btn.appendChild(tooltip);

    // ホバーイベント
    btn.addEventListener('mouseenter', () => {
      tooltip.style.opacity = '1';
      btn.style.transform = 'scale(1.1)';
      btn.style.boxShadow = `0 0 12px ${colorCode}44`;
    }, { signal });

    btn.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = 'none';
    }, { signal });

    // ドラッグイベント
    btn.addEventListener('dragstart', (e) => {
      document.body.classList.add('is-dragging-item');
      e.dataTransfer.setData('text/menu-id', menu.id);
      e.dataTransfer.effectAllowed = 'copy';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'grabbing';

      // ドラッグ中に視覚的フィードバック
      if (window.eventBus) {
        window.eventBus.emit('menuDragStart', { menuId: menu.id });
      }
    }, { signal });

    btn.addEventListener('dragend', () => {
      document.body.classList.remove('is-dragging-item');
      btn.style.opacity = '1';
      btn.style.cursor = 'grab';

      if (window.eventBus) {
        window.eventBus.emit('menuDragEnd', { menuId: menu.id });
      }
    }, { signal });

    return btn;
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
  }

  /**
   * コンポーネントを破棄し、すべてのリソースを解放する
   */
  destroy() {
    this._cleanup();
    this._container.innerHTML = '';
  }
}
