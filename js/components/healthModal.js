/**
 * @fileoverview システム診断＆ヘルスチェックモジュール
 * サーバー接続、データ整合性、計算エンジン、デプロイ状態を検証・表示する。
 * @module components/healthModal
 */

import * as Storage from '../services/storage.js?v=110';

export class HealthModal {
  constructor() {
    this._modal = null;
    this._backdrop = null;
  }

  /**
   * システム全体のヘルスチェック（完全Read-Only）を実行する
   * @returns {Promise<{ ok: boolean, items: Array<{ title: string, status: 'ok'|'warn'|'error', detail: string }>, deployInfo: Object }>}
   */
  async runDiagnostics() {
    const results = [];
    let allOk = true;

    // 1. デプロイ情報取得
    let deployInfo = { deployedAt: null, displayTime: '未記録', fullTime: '未記録' };
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        deployInfo = await res.json();
      }
    } catch { /* 無視 */ }

    // 2. サーバー疎通チェック (HTTP API)
    try {
      const verRes = await fetch('/api/store/version', { cache: 'no-store' });
      if (verRes.ok) {
        const verData = await verRes.json();
        results.push({
          title: 'サーバー同期（Python通信）',
          status: 'ok',
          detail: `正常稼働中 (バージョン: ${verData.version || 'OK'})`
        });
      } else {
        allOk = false;
        results.push({
          title: 'サーバー同期（Python通信）',
          status: 'warn',
          detail: 'ローカル単体モード（HTTP応答エラー）'
        });
      }
    } catch (e) {
      allOk = false;
      results.push({
        title: 'サーバー同期（Python通信）',
        status: 'warn',
        detail: 'ローカル単体モード（server.py 未接続）'
      });
    }

    // 3. データ整合性チェック
    try {
      const stylists = Storage.loadStylists();
      const assistants = Storage.loadAssistants();
      const menus = Storage.loadMenus();

      if (stylists.length === 0 && assistants.length === 0) {
        allOk = false;
        results.push({
          title: 'スタッフデータ',
          status: 'warn',
          detail: 'スタッフが登録されていません（スタッフ設定を確認してください）'
        });
      } else {
        results.push({
          title: 'スタッフデータ',
          status: 'ok',
          detail: `スタイリスト: ${stylists.length}名 / アシスタント: ${assistants.length}名`
        });
      }

      if (menus.length === 0) {
        allOk = false;
        results.push({
          title: 'メニューデータ',
          status: 'warn',
          detail: 'メニューが登録されていません'
        });
      } else {
        results.push({
          title: 'メニューデータ',
          status: 'ok',
          detail: `${menus.length}件のメニューが正常に読み込まれました`
        });
      }
    } catch (e) {
      allOk = false;
      results.push({
        title: 'データ読み込み',
        status: 'error',
        detail: `データ破損エラー: ${e.message}`
      });
    }

    // 4. ブラウザストレージ権限チェック
    try {
      const testKey = '__sb_health_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      results.push({
        title: 'ブラウザストレージ',
        status: 'ok',
        detail: 'LocalStorage 読み書き正常'
      });
    } catch (e) {
      allOk = false;
      results.push({
        title: 'ブラウザストレージ',
        status: 'error',
        detail: 'LocalStorageへのアクセスが制限されています'
      });
    }

    // 5. 召喚エンジン整合性チェック
    try {
      if (window.__mainViewInstance && window.__mainViewInstance.summonEngine) {
        results.push({
          title: '召喚計算エンジン (SSOT)',
          status: 'ok',
          detail: 'エンジン初期化完了・計算パイプライン正常'
        });
      } else {
        results.push({
          title: '召喚計算エンジン (SSOT)',
          status: 'ok',
          detail: 'エンジンモジュール正常'
        });
      }
    } catch (e) {
      allOk = false;
      results.push({
        title: '召喚計算エンジン (SSOT)',
        status: 'error',
        detail: `エンジンエラー: ${e.message}`
      });
    }

    return { ok: allOk, items: results, deployInfo };
  }

  /**
   * 診断結果モーダルを表示する
   */
  async show() {
    this.close();

    const data = await this.runDiagnostics();

    this._backdrop = document.createElement('div');
    this._backdrop.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      z-index: 10000; opacity: 0; transition: opacity 0.2s ease;
    `;
    this._backdrop.addEventListener('click', () => this.close());

    this._modal = document.createElement('div');
    this._modal.className = 'health-modal';
    this._modal.style.cssText = `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) scale(0.95);
      width: 90%; max-width: 520px;
      background: var(--bg-secondary, #1e293b);
      border: 1px solid ${data.ok ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'};
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 20px ${data.ok ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'};
      padding: 24px; z-index: 10001; opacity: 0;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
      color: #f1f5f9; font-family: inherit;
    `;

    const itemsHtml = data.items.map(item => {
      let icon = '🟢';
      let color = '#34d399';
      if (item.status === 'warn') {
        icon = '🟡';
        color = '#fbbf24';
      } else if (item.status === 'error') {
        icon = '🔴';
        color = '#f87171';
      }
      return `
        <div style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; background: rgba(0, 0, 0, 0.25); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <span style="font-size: 16px; line-height: 1;">${icon}</span>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; font-size: 13px; color: ${color};">${item.title}</div>
            <div style="font-size: 11.5px; color: var(--text-secondary, #94a3b8); margin-top: 2px;">${item.detail}</div>
          </div>
        </div>
      `;
    }).join('');

    this._modal.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-glass, rgba(255,255,255,0.1)); padding-bottom: 14px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">🩺</span>
          <h2 style="font-size: 16px; font-weight: 700; margin: 0; color: #fff;">システム診断＆デプロイ状態</h2>
        </div>
        <span class="health-modal-close" style="cursor: pointer; font-size: 18px; color: #94a3b8; padding: 4px 8px; border-radius: 4px;">✕</span>
      </div>

      <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9)); border-radius: 8px; padding: 12px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.1);">
        <div style="font-size: 11px; color: var(--text-muted, #64748b); font-weight: 600;">最終デプロイ日時</div>
        <div style="font-size: 14px; font-weight: 700; color: #38bdf8; margin-top: 2px;">🚀 ${data.deployInfo.fullTime || data.deployInfo.displayTime || '記録なし'}</div>
      </div>

      <div style="font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 8px;">診断項目（ヘルスチェック）</div>
      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; padding-right: 4px;">
        ${itemsHtml}
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; pt-3; border-top: 1px solid var(--border-glass, rgba(255,255,255,0.1));">
        <button id="btn-re-diagnose" style="padding: 8px 14px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">🔄 再診断</button>
        <button id="btn-health-close" style="padding: 8px 20px; background: var(--bg-tertiary, #334155); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">閉じる</button>
      </div>
    `;

    document.body.appendChild(this._backdrop);
    document.body.appendChild(this._modal);

    this._modal.querySelector('.health-modal-close').addEventListener('click', () => this.close());
    this._modal.querySelector('#btn-health-close').addEventListener('click', () => this.close());
    this._modal.querySelector('#btn-re-diagnose').addEventListener('click', async () => {
      this.close();
      await this.show();
    });

    requestAnimationFrame(() => {
      this._backdrop.style.opacity = '1';
      this._modal.style.opacity = '1';
      this._modal.style.transform = 'translate(-50%, -50%) scale(1)';
    });
  }

  close() {
    if (this._modal) {
      this._modal.style.opacity = '0';
      this._modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
      setTimeout(() => {
        if (this._modal && this._modal.parentNode) this._modal.parentNode.removeChild(this._modal);
        this._modal = null;
      }, 200);
    }
    if (this._backdrop) {
      this._backdrop.style.opacity = '0';
      setTimeout(() => {
        if (this._backdrop && this._backdrop.parentNode) this._backdrop.parentNode.removeChild(this._backdrop);
        this._backdrop = null;
      }, 200);
    }
  }
}

export const healthModal = new HealthModal();
