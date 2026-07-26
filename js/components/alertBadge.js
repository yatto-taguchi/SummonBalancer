/**
 * @fileoverview アラート・バッジ表示コンポーネント
 * 人数不足やスタイリスト召喚時のアラート/バッジを表示する。
 * 静的メソッドで手軽にバッジを追加・削除できる。
 * @module components/alertBadge
 */

/**
 * バッジタイプごとの色定義
 * @type {Object<string, {bg: string, border: string, text: string, glow: string}>}
 */
const BADGE_STYLES = {
  danger: {
    bg: 'var(--accent-danger)',
    border: 'var(--accent-danger)',
    text: '#ffffff',
    glow: 'rgba(239, 68, 68, 0.5)'
  },
  warning: {
    bg: 'var(--accent-warning)',
    border: 'var(--accent-warning)',
    text: '#000000',
    glow: 'rgba(245, 158, 11, 0.5)'
  },
  info: {
    bg: 'var(--accent-primary)',
    border: 'var(--accent-primary)',
    text: '#ffffff',
    glow: 'rgba(99, 102, 241, 0.5)'
  }
};

/** CSSアニメーションがすでに注入されているかのフラグ */
let _animationInjected = false;

/**
 * 点滅アニメーション用のCSSを一度だけ注入する
 * @private
 */
function _injectAnimationCSS() {
  if (_animationInjected) return;
  _animationInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes alertBadgePulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.08); }
    }
    @keyframes alertBadgeFadeIn {
      from { opacity: 0; transform: scale(0.5); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes summonBadgeShine {
      0% { background-position: -100% 0; }
      100% { background-position: 200% 0; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * アラート・バッジ表示コンポーネント
 * 静的メソッドでバッジの作成・削除を行うユーティリティクラス
 */
export class AlertBadge {
  /**
   * コンストラクタ（通常はインスタンス化せず、静的メソッドを使う）
   */
  constructor() {
    // 静的クラスとして使用
  }

  /**
   * アラートバッジを作成してコンテナに追加する
   * @param {HTMLElement} container - バッジを追加する親要素
   * @param {string} message - バッジに表示するメッセージ
   * @param {'danger'|'warning'|'info'} type - バッジの種類
   * @returns {HTMLElement} 作成されたバッジ要素
   */
  static createAlert(container, message, type = 'info') {
    _injectAnimationCSS();

    const style = BADGE_STYLES[type] || BADGE_STYLES.info;

    const badge = document.createElement('div');
    badge.className = `alert-badge alert-badge-${type}`;
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '10px';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = 'bold';
    badge.style.color = style.text;
    badge.style.background = style.bg;
    badge.style.border = `1px solid ${style.border}`;
    badge.style.boxShadow = `0 0 8px ${style.glow}`;
    badge.style.whiteSpace = 'nowrap';
    badge.style.pointerEvents = 'none';
    badge.style.position = 'relative';
    badge.style.zIndex = '30';

    // フェードインアニメーション
    badge.style.animation = 'alertBadgeFadeIn 0.3s ease forwards';

    // dangerタイプは点滅アニメーション
    if (type === 'danger') {
      badge.style.animation = 'alertBadgeFadeIn 0.3s ease forwards, alertBadgePulse 1.5s ease-in-out infinite 0.3s';
    }

    // ドットインジケーター
    const dot = document.createElement('span');
    dot.style.width = '6px';
    dot.style.height = '6px';
    dot.style.borderRadius = '50%';
    dot.style.background = style.text;
    dot.style.flexShrink = '0';
    badge.appendChild(dot);

    // メッセージテキスト
    const text = document.createElement('span');
    text.textContent = message;
    badge.appendChild(text);

    container.appendChild(badge);
    return badge;
  }

  /**
   * スタイリストがアシスタントとして召喚された場合の特別バッジを作成する
   * @param {HTMLElement} container - バッジを追加する親要素
   * @param {string} staffName - 召喚されたスタイリスト名
   * @param {boolean} [isSpecialSummon=false] - 特殊召喚かどうか
   * @param {string|null} [specialSummonReason=null] - 特殊召喚の理由（'lunch' | 'rest' | null）
   * @returns {HTMLElement} 作成されたバッジ要素
   */
  static createSummonBadge(container, staffName, isSpecialSummon = false, specialSummonReason = null) {
    _injectAnimationCSS();

    const badge = document.createElement('div');
    badge.className = `alert-badge alert-badge-summon${isSpecialSummon ? ' alert-badge-special-summon' : ''}`;
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    badge.style.padding = '2px 10px';
    badge.style.borderRadius = '10px';
    badge.style.fontSize = '10px';
    badge.style.fontWeight = 'bold';
    badge.style.color = '#ffffff';
    badge.style.whiteSpace = 'nowrap';
    badge.style.position = 'relative';
    badge.style.zIndex = '30';
    badge.style.overflow = 'hidden';
    badge.style.cursor = 'default';

    if (isSpecialSummon) {
      // 特殊召喚: 金色グラデーション
      badge.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
      badge.style.border = '1px solid #fbbf24';
      badge.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.6)';

      // ツールチップ（理由表示）
      const reasonText = specialSummonReason === 'lunch'
        ? 'お昼交代（11:00以降・スタイリストがお昼済み）'
        : specialSummonReason === 'rest'
          ? '休憩交代（16:00以降・スタイリストが休憩済み）'
          : '特殊召喚';
      badge.title = `特殊召喚: ${staffName}\n理由: ${reasonText}`;
    } else {
      // 通常召喚: 紫グラデーション
      badge.style.background = 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))';
      badge.style.border = '1px solid var(--accent-secondary)';
      badge.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.5)';
    }

    // フェードイン
    badge.style.animation = 'alertBadgeFadeIn 0.3s ease forwards';

    // アイコン
    const icon = document.createElement('span');
    icon.textContent = isSpecialSummon ? '✨' : '⚡';
    icon.style.fontSize = '12px';
    badge.appendChild(icon);

    // ラベルテキスト
    const text = document.createElement('span');
    text.textContent = isSpecialSummon ? `${staffName} 特殊召喚` : `${staffName} 召喚`;
    badge.appendChild(text);

    // シャインオーバーレイ
    const shine = document.createElement('div');
    shine.style.position = 'absolute';
    shine.style.top = '0';
    shine.style.left = '0';
    shine.style.right = '0';
    shine.style.bottom = '0';
    shine.style.background = 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)';
    shine.style.backgroundSize = '200% 100%';
    shine.style.animation = 'summonBadgeShine 2s linear infinite';
    shine.style.pointerEvents = 'none';
    badge.appendChild(shine);

    container.appendChild(badge);
    return badge;
  }

  /**
   * コンテナ内のすべてのバッジを削除する
   * @param {HTMLElement} container - バッジを削除する親要素
   */
  static removeAll(container) {
    const badges = container.querySelectorAll('.alert-badge');
    badges.forEach((badge) => {
      // フェードアウトアニメーション
      badge.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      badge.style.opacity = '0';
      badge.style.transform = 'scale(0.5)';
      setTimeout(() => {
        if (badge.parentNode) {
          badge.parentNode.removeChild(badge);
        }
      }, 200);
    });
  }
}
