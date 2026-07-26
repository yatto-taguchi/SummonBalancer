/**
 * @fileoverview 疲労度パラメータバーコンポーネント
 * スタッフの疲労度・仕事量を横バーで可視化する。
 * 稼働率に応じて緑→黄→赤のグラデーションで表示し、
 * 空き時間をの分単位表示、パーセンテージ表示を行う。
 * @module components/fatigueBar
 */

/**
 * 稼働率(0〜100)に応じた色を返す
 * 0〜50%: 緑, 50〜75%: 黄, 75〜100%: 赤
 * @param {number} percent - 稼働率（0〜100）
 * @returns {string} 色コード
 */
function getBarColor(percent) {
  if (percent >= 110) {
    return 'var(--accent-danger)';
  } else if (percent >= 80) {
    return 'var(--accent-success)';
  } else if (percent > 60) {
    return 'var(--accent-warning)';
  } else {
    return 'var(--accent-info)';
  }
}

/**
 * @typedef {Object} FatigueData
 * @property {number} totalMinutes - 営業時間（分）
 * @property {number} busyMinutes - 稼働時間（分）
 * @property {number} freeMinutes - 空き時間（分）
 * @property {{lunch: boolean, rest: boolean}} breaksTaken - 休憩取得状況
 */

/**
 * 疲労度パラメータバーコンポーネント
 * スタッフの疲労度・仕事量を色付き横バーで可視化する
 */
export class FatigueBar {
  /**
   * @param {HTMLElement} container - バーを描画するコンテナ要素
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this._container = container;
    /** @type {HTMLElement|null} バーのフィル要素 */
    this._fillEl = null;
    /** @type {HTMLElement|null} パーセンテージ表示要素 */
    this._percentEl = null;
    /** @type {HTMLElement|null} 空き時間表示要素 */
    this._freeTimeEl = null;
    /** @type {HTMLElement|null} ラッパー要素 */
    this._wrapper = null;
  }

  /**
   * 疲労度バーを描画する
   * @param {FatigueData} data - 疲労データ
   */
  render(data) {
    this._container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'fatigue-bar-wrapper';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';
    wrapper.style.width = '100%';

    // バートラック（背景）
    const track = document.createElement('div');
    track.className = 'fatigue-bar-track';
    track.style.flex = '1';
    track.style.height = '8px';
    track.style.background = 'var(--bg-tertiary)';
    track.style.borderRadius = '4px';
    track.style.overflow = 'hidden';
    track.style.position = 'relative';

    // バーフィル（前景）
    const fill = document.createElement('div');
    fill.className = 'fatigue-bar-fill';
    fill.style.height = '100%';
    fill.style.borderRadius = '4px';
    fill.style.transition = 'width 0.6s ease, background 0.6s ease';
    fill.style.width = '0%'; // 初期値、アニメーション開始用

    track.appendChild(fill);
    wrapper.appendChild(track);

    // パーセンテージ表示
    const percentEl = document.createElement('span');
    percentEl.className = 'fatigue-percent';
    percentEl.style.fontSize = '10px';
    percentEl.style.fontWeight = 'bold';
    percentEl.style.minWidth = '32px';
    percentEl.style.textAlign = 'right';
    wrapper.appendChild(percentEl);

    // 空き時間表示
    const freeTimeEl = document.createElement('span');
    freeTimeEl.className = 'fatigue-free-time';
    freeTimeEl.style.fontSize = '9px';
    freeTimeEl.style.color = 'var(--text-secondary)';
    freeTimeEl.style.whiteSpace = 'nowrap';
    wrapper.appendChild(freeTimeEl);

    this._container.appendChild(wrapper);

    this._wrapper = wrapper;
    this._fillEl = fill;
    this._percentEl = percentEl;
    this._freeTimeEl = freeTimeEl;

    // 初期値設定（アニメーション付き）
    this._applyData(data);
  }

  /**
   * データをDOM要素に反映する
   * @param {FatigueData} data - 疲労データ
   * @private
   */
  _applyData(data) {
    const total = data.totalMinutes || 1; // ゼロ除算防止
    const percent = Math.min(100, Math.round((data.busyMinutes / total) * 100));
    const color = getBarColor(percent);

    // バーのアニメーション（次フレームで適用）
    requestAnimationFrame(() => {
      if (this._fillEl) {
        this._fillEl.style.width = `${percent}%`;
        this._fillEl.style.background = color;
      }
    });

    // パーセンテージ
    if (this._percentEl) {
      this._percentEl.textContent = `${percent}%`;
      this._percentEl.style.color = color;
    }

    // 空き時間
    if (this._freeTimeEl) {
      this._freeTimeEl.textContent = `空き${data.freeMinutes}分`;
    }
  }

  /**
   * 値をアニメーション付きで更新する
   * @param {FatigueData} data - 新しい疲労データ
   */
  update(data) {
    if (!this._fillEl) {
      // まだ描画されていない場合はrenderを呼ぶ
      this.render(data);
      return;
    }
    this._applyData(data);
  }

  /**
   * コンポーネントを破棄し、すべてのリソースを解放する
   */
  destroy() {
    this._fillEl = null;
    this._percentEl = null;
    this._freeTimeEl = null;
    this._wrapper = null;
    this._container.innerHTML = '';
  }
}
