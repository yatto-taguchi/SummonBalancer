/**
 * @fileoverview サロン統計・アナリティクスダッシュボードモーダル
 * 
 * 日次・月次・年次のあらゆるサロン実績をグラフィカルに可視化し、
 * スタッフ個人別フィルタリングやCSVダウンロードを提供する独立コンポーネント。
 * 
 * @module components/statsModal
 */

import * as StatsTracker from '../services/statsTracker.js?v=1';
import * as Storage from '../services/storage.js?v=110';

export class StatsModal {
  constructor() {
    /** @type {HTMLElement|null} */
    this._modalEl = null;
    /** @type {string} 選択中の期間 ('today' | 'week' | 'month' | 'year' | 'custom') */
    this._selectedPeriod = 'today';
    /** @type {string} 開始日 (YYYY-MM-DD) */
    this._startDate = '';
    /** @type {string} 終了日 (YYYY-MM-DD) */
    this._endDate = '';
    /** @type {string} 選択中スタッフID ('all' または staffId) */
    this._selectedStaffId = 'all';
    /** @type {string} アクティブタブ ('summary' | 'menu' | 'help' | 'internal') */
    this._activeTab = 'summary';
  }

  /**
   * モーダルを表示する
   * @param {string} [defaultDateStr] - 基準日 (YYYY-MM-DD)
   */
  show(defaultDateStr) {
    const todayStr = defaultDateStr || new Date().toISOString().slice(0, 10);
    this._startDate = todayStr;
    this._endDate = todayStr;
    this._selectedPeriod = 'today';
    this._selectedStaffId = 'all';
    this._activeTab = 'summary';

    this._createModalDOM();
    this._updateDataAndRender();
  }

  /**
   * モーダルDOMを構築する
   * @private
   */
  _createModalDOM() {
    this.close();

    const overlay = document.createElement('div');
    overlay.className = 'sb-stats-modal-overlay';
    overlay.id = 'sb-stats-modal';

    overlay.innerHTML = `
      <div class="sb-stats-modal-container">
        <!-- ヘッダー -->
        <div class="sb-stats-header">
          <div class="sb-stats-title-group">
            <span class="sb-stats-icon">📊</span>
            <div>
              <h2 class="sb-stats-title">サロンデータ統計・分析ダッシュボード</h2>
              <p class="sb-stats-subtitle">メニュー比率、ヘルプ実績、内部業務、特殊召喚の網羅的レポート</p>
            </div>
          </div>
          <div class="sb-stats-header-actions">
            <button class="sb-stats-btn sb-stats-csv-btn" id="sb-stats-btn-csv">
              📥 CSVダウンロード
            </button>
            <button class="sb-stats-close-btn" id="sb-stats-btn-close" title="閉じる">✕</button>
          </div>
        </div>

        <!-- コントロールバー（期間選択 & スタッフ絞り込み） -->
        <div class="sb-stats-controls">
          <div class="sb-stats-control-group">
            <label class="sb-stats-label">期間:</label>
            <div class="sb-stats-period-buttons">
              <button class="sb-stats-period-btn active" data-period="today">今日</button>
              <button class="sb-stats-period-btn" data-period="week">今週</button>
              <button class="sb-stats-period-btn" data-period="month">今月</button>
              <button class="sb-stats-period-btn" data-period="year">今年</button>
              <button class="sb-stats-period-btn" data-period="custom">期間指定</button>
            </div>
            <div class="sb-stats-custom-date" id="sb-stats-custom-date-picker" style="display: none;">
              <input type="date" id="sb-stats-date-start" class="sb-stats-date-input">
              <span style="color: var(--text-muted);">〜</span>
              <input type="date" id="sb-stats-date-end" class="sb-stats-date-input">
              <button class="sb-stats-btn-small" id="sb-stats-btn-apply-date">適用</button>
            </div>
          </div>

          <div class="sb-stats-control-group">
            <label class="sb-stats-label" for="sb-stats-staff-select">スタッフ絞り込み:</label>
            <select id="sb-stats-staff-select" class="sb-stats-select">
              <option value="all">🌟 サロン全体（全員）</option>
            </select>
          </div>
        </div>

        <!-- タブナビゲーション -->
        <div class="sb-stats-tabs">
          <button class="sb-stats-tab active" data-tab="summary">📌 全体サマリー</button>
          <button class="sb-stats-tab" data-tab="menu">📋 メニュー & 技術分析</button>
          <button class="sb-stats-tab" data-tab="help">🤝 ヘルプ相関 & 召喚実績</button>
          <button class="sb-stats-tab" data-tab="internal">🍙 内部業務 & 特別モード</button>
        </div>

        <!-- コンテンツ表示エリア -->
        <div class="sb-stats-body" id="sb-stats-body-content">
          <div class="sb-stats-loading">データを集計中...</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._modalEl = overlay;

    // スタッフセレクトボックスの選択肢構築
    this._populateStaffSelect();

    // イベントバインド
    this._bindEvents();
  }

  /**
   * スタッフセレクトの選択肢を設定
   * @private
   */
  _populateStaffSelect() {
    const select = this._modalEl.querySelector('#sb-stats-staff-select');
    if (!select) return;

    const stylists = Storage.loadStylists();
    const assistants = Storage.loadAssistants();

    if (stylists.length > 0) {
      const optGroupSt = document.createElement('optgroup');
      optGroupSt.label = '✂ スタイリスト';
      stylists.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.rank || 'スタイリスト'})`;
        optGroupSt.appendChild(opt);
      });
      select.appendChild(optGroupSt);
    }

    if (assistants.length > 0) {
      const optGroupAst = document.createElement('optgroup');
      optGroupAst.label = '🤝 アシスタント';
      assistants.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${a.name} (${a.rank || 'アシスタント'})`;
        optGroupAst.appendChild(opt);
      });
      select.appendChild(optGroupAst);
    }
  }

  /**
   * イベントハンドラの設定
   * @private
   */
  _bindEvents() {
    if (!this._modalEl) return;

    // 閉じるボタン
    this._modalEl.querySelector('#sb-stats-btn-close').addEventListener('click', () => this.close());
    this._modalEl.addEventListener('click', (e) => {
      if (e.target === this._modalEl) this.close();
    });

    // 期間ボタン
    this._modalEl.querySelectorAll('.sb-stats-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._modalEl.querySelectorAll('.sb-stats-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const period = btn.dataset.period;
        this._selectedPeriod = period;
        const customDateBox = this._modalEl.querySelector('#sb-stats-custom-date-picker');

        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);

        if (period === 'today') {
          customDateBox.style.display = 'none';
          this._startDate = todayStr;
          this._endDate = todayStr;
          this._updateDataAndRender();
        } else if (period === 'week') {
          customDateBox.style.display = 'none';
          // 当週（月〜日）
          const day = now.getDay();
          const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
          const mon = new Date(now.setDate(diffToMon));
          const sun = new Date(mon);
          sun.setDate(mon.getDate() + 6);
          this._startDate = mon.toISOString().slice(0, 10);
          this._endDate = sun.toISOString().slice(0, 10);
          this._updateDataAndRender();
        } else if (period === 'month') {
          customDateBox.style.display = 'none';
          const y = now.getFullYear();
          const m = now.getMonth();
          const firstDay = new Date(y, m, 1);
          const lastDay = new Date(y, m + 1, 0);
          this._startDate = firstDay.toISOString().slice(0, 10);
          this._endDate = lastDay.toISOString().slice(0, 10);
          this._updateDataAndRender();
        } else if (period === 'year') {
          customDateBox.style.display = 'none';
          const y = now.getFullYear();
          this._startDate = `${y}-01-01`;
          this._endDate = `${y}-12-31`;
          this._updateDataAndRender();
        } else if (period === 'custom') {
          customDateBox.style.display = 'flex';
          const startInput = this._modalEl.querySelector('#sb-stats-date-start');
          const endInput = this._modalEl.querySelector('#sb-stats-date-end');
          startInput.value = this._startDate;
          endInput.value = this._endDate;
        }
      });
    });

    // 期間指定適用ボタン
    this._modalEl.querySelector('#sb-stats-btn-apply-date').addEventListener('click', () => {
      const start = this._modalEl.querySelector('#sb-stats-date-start').value;
      const end = this._modalEl.querySelector('#sb-stats-date-end').value;
      if (start && end) {
        this._startDate = start;
        this._endDate = end;
        this._updateDataAndRender();
      }
    });

    // スタッフセレクト変更
    this._modalEl.querySelector('#sb-stats-staff-select').addEventListener('change', (e) => {
      this._selectedStaffId = e.target.value;
      this._updateDataAndRender();
    });

    // タブ切り替え
    this._modalEl.querySelectorAll('.sb-stats-tab').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        this._modalEl.querySelectorAll('.sb-stats-tab').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
        this._activeTab = tabBtn.dataset.tab;
        this._renderTabContent();
      });
    });

    // CSVエクスポートボタン
    this._modalEl.querySelector('#sb-stats-btn-csv').addEventListener('click', () => {
      this._handleExportCSV();
    });
  }

  /**
   * データを読み込み、集計してレンダリングする
   * @private
   */
  _updateDataAndRender() {
    // 1. 今日の最新状態をリアルタイムにスナップショット更新
    const todayStr = new Date().toISOString().slice(0, 10);
    if (window.__mainViewInstance && window.__mainViewInstance.lastSummonResult) {
      const mv = window.__mainViewInstance;
      const stylists = Storage.loadStylists();
      const assistants = Storage.loadAssistants();
      const dateForRes = mv.currentDate ? mv._formatDate(mv.currentDate) : todayStr;
      const reservations = Storage.loadReservations(dateForRes);
      const menus = Storage.loadMenus();
      StatsTracker.recordDailySnapshot(
        dateForRes, mv.lastSummonResult, reservations, stylists, assistants, menus
      );
    }

    const snapshots = StatsTracker.loadStatsRange(this._startDate, this._endDate);
    this._aggregatedData = StatsTracker.aggregateStats(snapshots, this._selectedStaffId);
    this._renderTabContent();
  }

  /**
   * 現在のアクティブタブを描画する
   * @private
   */
  _renderTabContent() {
    const content = this._modalEl.querySelector('#sb-stats-body-content');
    if (!content || !this._aggregatedData) return;

    const data = this._aggregatedData;

    if (data.totalDays === 0) {
      content.innerHTML = `
        <div class="sb-stats-empty">
          <span style="font-size: 48px;">📅</span>
          <h3>対象期間の統計データがありません</h3>
          <p>指定期間: ${this._startDate} 〜 ${this._endDate}</p>
          <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">
            ※ 本機能の運用開始日以降のデータが自動蓄積されます。
          </p>
        </div>
      `;
      return;
    }

    switch (this._activeTab) {
      case 'summary':
        content.innerHTML = this._buildSummaryHTML(data);
        break;
      case 'menu':
        content.innerHTML = this._buildMenuHTML(data);
        break;
      case 'help':
        content.innerHTML = this._buildHelpHMTL(data);
        break;
      case 'internal':
        content.innerHTML = this._buildInternalHTML(data);
        break;
    }
  }

  /**
   * ① 全体サマリータブのHTML構築
   * @private
   */
  _buildSummaryHTML(data) {
    const s = data.summary;
    const hours = Math.round((s.totalAssignedMinutes / 60) * 10) / 10;

    return `
      <div class="sb-stats-summary-grid">
        <div class="sb-stats-card highlight-primary">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">総予約数</span>
            <span class="sb-stats-card-icon">📅</span>
          </div>
          <div class="sb-stats-card-value">${s.totalReservations} <span class="sb-stats-card-unit">件</span></div>
          <div class="sb-stats-card-sub">集計期間: ${data.totalDays} 日間</div>
        </div>

        <div class="sb-stats-card highlight-success">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">総ヘルプ時間</span>
            <span class="sb-stats-card-icon">⏱️</span>
          </div>
          <div class="sb-stats-card-value">${hours} <span class="sb-stats-card-unit">時間</span></div>
          <div class="sb-stats-card-sub">${s.totalAssignedMinutes} 分間のアサイン稼働</div>
        </div>

        <div class="sb-stats-card ${s.totalShortages > 0 ? 'highlight-danger' : ''}">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">未アサイン不足</span>
            <span class="sb-stats-card-icon">⚠️</span>
          </div>
          <div class="sb-stats-card-value">${s.totalShortages} <span class="sb-stats-card-unit">件</span></div>
          <div class="sb-stats-card-sub">${s.totalShortages === 0 ? '✨ 不足ゼロ達成中' : '赤枠アラート発生件数'}</div>
        </div>

        <div class="sb-stats-card">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">SOS 発動数</span>
            <span class="sb-stats-card-icon">🆘</span>
          </div>
          <div class="sb-stats-card-value">${s.totalSOS} <span class="sb-stats-card-unit">回</span></div>
          <div class="sb-stats-card-sub">緊急ヘルプ要請</div>
        </div>

        <div class="sb-stats-card">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">お手伝いサポート (✋)</span>
            <span class="sb-stats-card-icon">✋</span>
          </div>
          <div class="sb-stats-card-value">${s.totalBonusSupport} <span class="sb-stats-card-unit">回</span></div>
          <div class="sb-stats-card-sub">空き時間の自主ヘルプ</div>
        </div>

        <div class="sb-stats-card">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">🔥 頑張れ配置</span>
            <span class="sb-stats-card-icon">🔥</span>
          </div>
          <div class="sb-stats-card-value">${s.totalGambare} <span class="sb-stats-card-unit">回</span></div>
          <div class="sb-stats-card-sub">隙間応援アサイン</div>
        </div>

        <div class="sb-stats-card">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">📌 固定モード指名</span>
            <span class="sb-stats-card-icon">📌</span>
          </div>
          <div class="sb-stats-card-value">${s.totalFixed} <span class="sb-stats-card-unit">回</span></div>
          <div class="sb-stats-card-sub">専属指名配置</div>
        </div>

        <div class="sb-stats-card highlight-warning">
          <div class="sb-stats-card-header">
            <span class="sb-stats-card-title">特殊召喚（レスキュー）</span>
            <span class="sb-stats-card-icon">⚡</span>
          </div>
          <div class="sb-stats-card-value">${s.totalSummons + s.totalSpecialSummons + s.totalSPSpecialSummons} <span class="sb-stats-card-unit">回</span></div>
          <div class="sb-stats-card-sub">
            通常: ${s.totalSummons} / お昼交代: ${s.totalSpecialSummons} / SP: ${s.totalSPSpecialSummons}
          </div>
        </div>
      </div>

      <!-- スタッフ別ハイライトテーブル -->
      <div class="sb-stats-section-box">
        <h3 class="sb-stats-section-title">👤 スタッフ別 稼働サマリー一覧</h3>
        <div class="sb-stats-table-wrapper">
          <table class="sb-stats-table">
            <thead>
              <tr>
                <th>スタッフ</th>
                <th>役職</th>
                <th>出勤日数</th>
                <th>予約数</th>
                <th>提供ヘルプ</th>
                <th>被ヘルプ</th>
                <th>✋お手伝い</th>
                <th>🍙お昼</th>
                <th>🎯練習</th>
                <th>🧹大掃除</th>
                <th>空き時間</th>
              </tr>
            </thead>
            <tbody>
              ${Object.values(data.staffStats || {}).map(st => `
                <tr>
                  <td><strong>${st.name}</strong></td>
                  <td><span class="sb-stats-badge ${st.type === 'stylist' ? 'badge-stylist' : 'badge-assistant'}">${st.rank || st.type}</span></td>
                  <td>${st.workingDays}日</td>
                  <td>${st.reservationCount}件</td>
                  <td>${st.helpProvidedCount}回 (${st.helpProvidedMinutes}分)</td>
                  <td>${st.helpReceivedCount}回 (${st.helpReceivedMinutes}分)</td>
                  <td>${st.bonusSupportCount}回</td>
                  <td>${st.lunchCount}回</td>
                  <td>${st.practiceCount}回</td>
                  <td>${st.cleaningCount}回</td>
                  <td>${st.freeTimeMinutes}分</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * ② メニュー & 技術分析タブのHTML構築
   * @private
   */
  _buildMenuHTML(data) {
    const menus = data.menuList || [];
    const skills = data.skills || {};

    return `
      <div class="sb-stats-two-col">
        <!-- メニュー比率 & 件数 -->
        <div class="sb-stats-section-box">
          <h3 class="sb-stats-section-title">📋 メニュー別 構成比率 & 件数</h3>
          <div class="sb-stats-menu-list">
            ${menus.map(m => `
              <div class="sb-stats-menu-row">
                <div class="sb-stats-menu-info">
                  <span class="sb-stats-menu-name">${m.name}</span>
                  <span class="sb-stats-menu-count"><strong>${m.count}</strong> 件 (${m.ratio}%)</span>
                </div>
                <div class="sb-stats-progress-bar">
                  <div class="sb-stats-progress-fill" style="width: ${Math.min(100, m.ratio)}%;"></div>
                </div>
              </div>
            `).join('')}
            ${menus.length === 0 ? '<p style="color: var(--text-muted);">メニューデータがありません</p>' : ''}
          </div>
        </div>

        <!-- 技術別スロット実績 -->
        <div class="sb-stats-section-box">
          <h3 class="sb-stats-section-title">✂️ 技術スロット別 集計</h3>
          <div class="sb-stats-skill-grid">
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">🧴</span>
              <span class="sb-stats-skill-name">シャンプー</span>
              <span class="sb-stats-skill-val">${skills.shampoo || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">🎨</span>
              <span class="sb-stats-skill-name">カラー</span>
              <span class="sb-stats-skill-val">${skills.color || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">✂️</span>
              <span class="sb-stats-skill-name">カット</span>
              <span class="sb-stats-skill-val">${skills.cut || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">✨</span>
              <span class="sb-stats-skill-name">トリートメント</span>
              <span class="sb-stats-skill-val">${skills.treatment || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">💆</span>
              <span class="sb-stats-skill-name">ヘッドスパ</span>
              <span class="sb-stats-skill-val">${skills.spa || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">🌀</span>
              <span class="sb-stats-skill-name">パーマ</span>
              <span class="sb-stats-skill-val">${skills.perm || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">🪄</span>
              <span class="sb-stats-skill-name">縮毛矯正</span>
              <span class="sb-stats-skill-val">${skills.straight || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
            <div class="sb-stats-skill-card">
              <span class="sb-stats-skill-icon">🔥</span>
              <span class="sb-stats-skill-name">アイロン</span>
              <span class="sb-stats-skill-val">${skills.iron || 0} <span class="sb-stats-card-unit">回</span></span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * ③ ヘルプ相関 & 召喚実績タブのHTML構築
   * @private
   */
  _buildHelpHMTL(data) {
    const staffList = Object.values(data.staffStats || {});
    const stylists = staffList.filter(s => s.type === 'stylist' || s.rank !== 'junior');
    const assistants = staffList.filter(s => s.type === 'assistant' || s.rank === 'junior');
    const matrix = data.helpMatrix || {};

    return `
      <div class="sb-stats-section-box">
        <h3 class="sb-stats-section-title">🤝 スタイリスト ⇄ アシスタント ヘルプ相関マトリクス</h3>
        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          どのスタイリストにどのアシスタントがどれだけ入ったか（回数・分）を可視化しています。
        </p>
        <div class="sb-stats-table-wrapper">
          <table class="sb-stats-table sb-stats-matrix-table">
            <thead>
              <tr>
                <th style="min-width: 140px;">スタイリスト ＼ アシスタント</th>
                ${assistants.map(a => `<th>${a.name}</th>`).join('')}
                <th style="background: rgba(99, 102, 241, 0.1);">合計受領</th>
              </tr>
            </thead>
            <tbody>
              ${stylists.map(st => {
                let totalRowMinutes = 0;
                let totalRowCount = 0;
                return `
                  <tr>
                    <td><strong>${st.name}</strong></td>
                    ${assistants.map(ast => {
                      const cell = (matrix[st.id] && matrix[st.id][ast.id]) ? matrix[st.id][ast.id] : null;
                      if (cell) {
                        totalRowMinutes += cell.minutes;
                        totalRowCount += cell.count;
                        return `<td class="sb-stats-cell-active">${cell.count}回<br><span style="font-size: 10px; opacity: 0.8;">(${cell.minutes}分)</span></td>`;
                      }
                      return `<td class="sb-stats-cell-zero">-</td>`;
                    }).join('')}
                    <td style="font-weight: bold; color: var(--accent-primary);">${totalRowCount}回 (${totalRowMinutes}分)</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 召喚・レスキュー実績 -->
      <div class="sb-stats-section-box" style="margin-top: 20px;">
        <h3 class="sb-stats-section-title">⚡ 召喚 & レスキュー実績内訳</h3>
        <div class="sb-stats-table-wrapper">
          <table class="sb-stats-table">
            <thead>
              <tr>
                <th>スタッフ</th>
                <th>🚨 通常召喚（空きスタイリスト）</th>
                <th>🍱 特殊召喚（お昼・休憩交代）</th>
                <th>👑 SP特殊召喚（究極レスキュー）</th>
                <th>合計画</th>
              </tr>
            </thead>
            <tbody>
              ${staffList.filter(s => (s.summonedCount + s.specialSummonedCount + s.spSummonedCount) > 0).map(s => `
                <tr>
                  <td><strong>${s.name}</strong></td>
                  <td>${s.summonedCount}回</td>
                  <td>${s.specialSummonedCount}回</td>
                  <td>${s.spSummonedCount}回</td>
                  <td><strong>${s.summonedCount + s.specialSummonedCount + s.spSummonedCount}回</strong></td>
                </tr>
              `).join('')}
              ${staffList.filter(s => (s.summonedCount + s.specialSummonedCount + s.spSummonedCount) > 0).length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">召喚履歴はありません</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * ④ 内部業務 & 特別モードタブのHTML構築
   * @private
   */
  _buildInternalHTML(data) {
    const staffList = Object.values(data.staffStats || {});

    return `
      <div class="sb-stats-section-box">
        <h3 class="sb-stats-section-title">🍙 休憩・練習・大掃除の消化状況</h3>
        <div class="sb-stats-table-wrapper">
          <table class="sb-stats-table">
            <thead>
              <tr>
                <th>スタッフ</th>
                <th>🍙 お昼ご飯</th>
                <th>☕ 休憩</th>
                <th>🎯 練習回数 (30分)</th>
                <th>🧹 大掃除</th>
                <th>⏱️ 隙間ヘルプ時間</th>
                <th>💤 完全空き時間</th>
              </tr>
            </thead>
            <tbody>
              ${staffList.map(st => `
                <tr>
                  <td><strong>${st.name}</strong></td>
                  <td>${st.lunchCount}回 (${st.lunchMinutes}分)</td>
                  <td>${st.restCount}回 (${st.restMinutes}分)</td>
                  <td><span class="sb-stats-badge ${st.practiceCount > 0 ? 'badge-success' : ''}">${st.practiceCount}回 (${st.practiceMinutes}分)</span></td>
                  <td>${st.cleaningCount}回 (${st.cleaningMinutes}分)</td>
                  <td>${st.gapHelpMinutes}分</td>
                  <td>${st.freeTimeMinutes}分</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="sb-stats-section-box" style="margin-top: 20px;">
        <h3 class="sb-stats-section-title">✨ 特別モード・アクション発生履歴</h3>
        <div class="sb-stats-table-wrapper">
          <table class="sb-stats-table">
            <thead>
              <tr>
                <th>スタッフ</th>
                <th>🔥 頑張れ配置 任命</th>
                <th>🆘 SOS 発動</th>
                <th>📌 固定モード 指名</th>
                <th>✋ お手伝いサポート</th>
              </tr>
            </thead>
            <tbody>
              ${staffList.map(st => `
                <tr>
                  <td><strong>${st.name}</strong></td>
                  <td>${st.gambareCount}回</td>
                  <td>${st.sosCount}回</td>
                  <td>${st.fixedCount}回</td>
                  <td>${st.bonusSupportCount}回 (${st.bonusSupportMinutes}分)</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * CSVダウンロード処理
   * @private
   */
  _handleExportCSV() {
    if (!this._aggregatedData) return;

    let staffName = 'サロン全体';
    if (this._selectedStaffId !== 'all') {
      const select = this._modalEl.querySelector('#sb-stats-staff-select');
      if (select && select.selectedOptions.length > 0) {
        staffName = select.selectedOptions[0].textContent;
      }
    }

    const periodLabel = this._selectedPeriod === 'today' ? '本日'
      : this._selectedPeriod === 'week' ? '今週'
      : this._selectedPeriod === 'month' ? '今月'
      : this._selectedPeriod === 'year' ? '今年'
      : `${this._startDate}_${this._endDate}`;

    StatsTracker.exportStatsToCSV(this._aggregatedData, periodLabel, staffName);
  }

  /**
   * モーダルを閉じる
   */
  close() {
    if (this._modalEl) {
      this._modalEl.remove();
      this._modalEl = null;
    }
  }
}

export const statsModal = new StatsModal();
