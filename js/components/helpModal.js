/**
 * helpModal.js — ヘルプモーダル（機能・マーク説明）コンポーネント
 * 
 * メインの描画ループやロジックから完全に独立したコンポーネント。
 * アプリ内の各種マークや機能（マンセル、お手伝い等）の解説を表示する。
 */

export class HelpModal {
  constructor() {
    this.modalEl = null;
    this._createModal();
    this._bindEvents();
  }

  /**
   * スタイルの注入（シングルトンガード付き）
   * @private
   */
  _injectStyles() {
    if (document.getElementById('help-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'help-modal-styles';
    style.innerHTML = `
      #global-help-modal {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(4px);
      }

      #global-help-modal.hidden {
        display: none !important;
      }

      #global-help-modal .modal-content {
        max-width: 800px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
        background: var(--bg-primary, #1e1e24);
        color: var(--text-primary, #e2e8f0);
        border: 1px solid var(--border-glass, rgba(255, 255, 255, 0.1));
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        position: relative;
      }

      #global-help-modal .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--border-glass, rgba(255, 255, 255, 0.1));
        padding-bottom: 12px;
      }

      #global-help-modal .modal-title {
        font-size: 1.5rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      #global-help-modal .close-btn {
        background: none;
        border: none;
        color: var(--text-muted, #94a3b8);
        font-size: 1.5rem;
        cursor: pointer;
        transition: color 0.2s;
      }

      #global-help-modal .close-btn:hover {
        color: var(--accent-danger, #ef4444);
      }

      #global-help-modal h3 {
        font-size: 1.1rem;
        color: var(--accent-primary, #818cf8);
        margin-top: 24px;
        margin-bottom: 12px;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      #global-help-modal .help-list {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      #global-help-modal .help-item {
        display: flex;
        gap: 16px;
        align-items: flex-start;
        background: rgba(255, 255, 255, 0.02);
        padding: 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      #global-help-modal .help-badge-container {
        flex-shrink: 0;
        min-width: 140px;
      }

      #global-help-modal .help-desc {
        flex: 1;
        font-size: 0.9rem;
        line-height: 1.5;
        color: var(--text-secondary, #cbd5e1);
      }

      #global-help-modal .help-desc strong {
        color: var(--text-primary, #fff);
      }

      /* サンプル表示用のバッジモックCSS */
      #global-help-modal .mock-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      
      #global-help-modal .mock-badge.normal {
        background: rgba(16, 185, 129, 0.1);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }
      
      #global-help-modal .mock-badge.bonus {
        background: rgba(20, 184, 166, 0.15);
        color: #14b8a6;
        border: 1px solid rgba(20, 184, 166, 0.4);
      }

      #global-help-modal .mock-badge.gap {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
        border: 1px dashed rgba(245, 158, 11, 0.5);
      }
      
      #global-help-modal .mock-badge.ganbare {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.3);
      }

      #global-help-modal .mock-badge.mancell {
        background: rgba(234, 179, 8, 0.1);
        color: #eab308;
        border: 1px dashed rgba(234, 179, 8, 0.5);
        width: 100%;
        justify-content: center;
      }
      
      #global-help-modal .mock-badge.special {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.3));
        color: #f59e0b;
        border: 1px solid rgba(245, 158, 11, 0.5);
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.2);
      }

      #global-help-modal .mock-badge.alert {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 2px solid #ef4444;
        animation: pulse 2s infinite;
      }

      #global-help-modal .mock-badge.sos {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
        border: 1px solid #ef4444;
        animation: pulse 1s infinite;
      }

      #global-help-modal .mock-badge.block {
        background: repeating-linear-gradient(45deg, rgba(75, 85, 99, 0.1), rgba(75, 85, 99, 0.1) 10px, rgba(55, 65, 81, 0.2) 10px, rgba(55, 65, 81, 0.2) 20px);
        color: #9ca3af;
        border: 1px solid #4b5563;
      }
      
      #global-help-modal .mock-badge.activity {
        border-radius: 12px;
        padding: 2px 8px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * DOMの生成と初期化
   * @private
   */
  _createModal() {
    // 既に存在する場合は削除
    const existing = document.getElementById('global-help-modal');
    if (existing) {
      existing.remove();
    }

    this._injectStyles();

    this.modalEl = document.createElement('div');
    this.modalEl.id = 'global-help-modal';
    this.modalEl.className = 'modal-overlay hidden';
    
    // 構造
    this.modalEl.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">
            <span>❓</span>
            <span>機能・マーク解説ヘルプ</span>
          </div>
          <button class="close-btn" aria-label="閉じる">&times;</button>
        </div>

        <div class="modal-body">
          <!-- セクション1: 各種ヘルプ・特殊アサイン -->
          <h3>1. 各種ヘルプ・アサインの違い</h3>
          <div class="help-list">
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge bonus">✋ お手伝い(15分)</span>
              </div>
              <div class="help-desc">
                <strong>お手伝いサポート（ボーナス配置）</strong><br>
                通常は1人で回す予約に対し、手が空いているスタッフが自発的にお手伝いに入る状態です。<br>
                ※疲労度にはカウントされません。<br>
                ※シャンプー・スパ・トリートメントには入りません。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge gap">☆ スタッフ名(10分)</span>
              </div>
              <div class="help-desc">
                <strong>隙間配置（隙間ヘルプ）</strong><br>
                アシスタントの隙間時間を活用した流動的なヘルプです。忙しい時間帯に少しでも負担を減らすために自動で配置されます。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge ganbare">🔥 スタッフ名</span>
              </div>
              <div class="help-desc">
                <strong>頑張れ配置</strong><br>
                固定モード内で手動で応援を要請した状態です。「手が空いたらここに応援に来てほしい」というサインで、複数人の重複配置も可能です。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge normal">スタッフ名(15分)</span>
              </div>
              <div class="help-desc">
                <strong>通常アサイン</strong><br>
                システムが計算した通常のアサインです。確実に行くべき固定の担当となります。
              </div>
            </div>
          </div>

          <!-- セクション2: チーム対応と特殊召喚 -->
          <h3>2. チーム対応（マンセル）と特殊召喚</h3>
          <div class="help-list">
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge mancell">【チーム制】(なぎ, りん)</span>
              </div>
              <div class="help-desc">
                <strong>チーム制（マンセル）</strong><br>
                アシスタントが不足する過酷な時間帯に、忙しいスタイリストを支えるために複数のアシスタントがチームを組んで対応している状態です。最低限の人数で回すためのシステムです。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge special">✨ 特殊召喚</span>
              </div>
              <div class="help-desc">
                <strong>特殊召喚（お昼・休憩確保）</strong><br>
                アシスタントのお昼や休憩を確保するため、手が空いているスタイリストが自ら交代してアシスタント業務に入っている状態です。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge special">救援 (→〇〇)</span>
              </div>
              <div class="help-desc">
                <strong>SP特殊召喚（玉突きスワップ）</strong><br>
                どうしても人が足りず、アシスタントも派遣できない極限状態に発動します。スタイリストが自分の予約を一旦離れ、他のスタイリストのヘルプ（救援）に向かっている状態です。
              </div>
            </div>
          </div>

          <!-- セクション3: アラート・その他 -->
          <h3>3. アラート・その他の活動マーク</h3>
          <div class="help-list">
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge alert">🚨 ⚠不足</span>
              </div>
              <div class="help-desc">
                <strong>不足アラート</strong><br>
                アサインできるスタッフがおらず、物理的に人数が足りていない（お客様をお待たせする）危険な状態です。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge sos">🆘 SOS</span>
              </div>
              <div class="help-desc">
                <strong>SOSモード</strong><br>
                現場がパンクしそうな時に押す緊急ボタンにより、対象の予約が赤く点滅して応援を要請している状態です。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge block">🧱 ブロック</span>
              </div>
              <div class="help-desc">
                <strong>ブロックモード</strong><br>
                予定を入れたくない時間帯を手動でブロックし、アサインを禁止している状態です。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span style="font-size: 1.2rem;">📝</span>
              </div>
              <div class="help-desc">
                <strong>メモアイコン</strong><br>
                対象の予約にテキストメモが残されている状態です。クリックで内容を確認・編集できます。
              </div>
            </div>
            <div class="help-item">
              <div class="help-badge-container">
                <span class="mock-badge activity" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">🍚 お昼</span>
                <span class="mock-badge activity" style="background: rgba(59, 130, 246, 0.2); color: #3b82f6;">☕ 休憩</span><br>
                <span class="mock-badge activity" style="background: rgba(99, 102, 241, 0.2); color: #6366f1;">🎓 練習</span>
                <span class="mock-badge activity" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">🧹 掃除</span>
              </div>
              <div class="help-desc">
                <strong>アクティビティバッジ</strong><br>
                アシスタントの空き時間に自動で割り当てられる各活動のマークです。<br>
                （※稼働率への影響：お昼/休憩は稼働に含む、練習/掃除は含まない）
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
  }

  /**
   * イベントのバインド
   * @private
   */
  _bindEvents() {
    const closeBtn = this.modalEl.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // 背景クリックで閉じる
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    // ESCキーで閉じる
    this._handleKeyDown = (e) => {
      if (e.key === 'Escape' && !this.modalEl.classList.contains('hidden')) {
        this.close();
      }
    };
    document.addEventListener('keydown', this._handleKeyDown);
  }

  /**
   * モーダルを開く
   */
  open() {
    if (this.modalEl) {
      this.modalEl.classList.remove('hidden');
    }
  }

  /**
   * モーダルを閉じる
   */
  close() {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
  }

  /**
   * インスタンス破棄
   */
  destroy() {
    document.removeEventListener('keydown', this._handleKeyDown);
    if (this.modalEl) {
      this.modalEl.remove();
    }
  }
}
