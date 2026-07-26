/**
 * @fileoverview アシスタントリストコンポーネント
 * サイドバーにアシスタント一覧をカード形式で表示する。
 * 各アシスタントの名前、出勤状態、スキルバッジ、疲労度バー、
 * 担当件数、休憩状況を統合的に表示する。
 * @module components/staffList
 */

import { FatigueBar } from './fatigueBar.js';

/**
 * スキルIDから日本語ラベルを取得する
 * @param {string} skillId - スキルID
 * @returns {string} 日本語ラベル
 */
function getSkillLabel(skillId) {
  const labels = {
    shampoo: 'シャンプー',
    color: 'カラー',
    treatment: 'トリートメント',
    cut: 'カット',
    perm: 'パーマ',
    head_spa: 'ヘッドスパ'
  };
  return labels[skillId] || skillId;
}

/**
 * 習熟度(1〜5)に応じたカラーを返す
 * @param {number} level - 習熟度レベル (1〜5)
 * @returns {string} 色コード
 */
function getProficiencyColor(level) {
  const colors = {
    1: '#ef4444', // 赤（最低）
    2: '#f59e0b', // 黄
    3: '#10b981', // 緑（普通）
    4: '#6366f1', // 紫
    5: '#8b5cf6'  // 紫（最高）
  };
  return colors[level] || '#9ca3af';
}

/**
 * アシスタントリストコンポーネント
 * サイドバーにアシスタント一覧を表示する
 */
export class StaffList {
  /**
   * @param {HTMLElement} container - リストを描画するコンテナ要素 (#assistant-sidebar)
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this._container = container;
    /** @type {Map<string, FatigueBar>} アシスタントIDごとのFatigueBarインスタンス */
    this._fatigueBars = new Map();
    /** @type {Map<string, HTMLElement>} アシスタントIDごとのカード要素 */
    this._cards = new Map();
    /** @type {AbortController|null} イベントリスナー管理 */
    this._abortController = null;
  }

  /**
   * アシスタントリストを描画する
   * @param {import('../models/staff.js').Staff[]} assistants - アシスタント一覧
   */
  render(assistants, dateStr = null) {
    this._cleanup();
    this._abortController = new AbortController();

    this._container.innerHTML = '';

    // リストコンテナ（横並び横スクロールに変更）
    const listEl = document.createElement('div');
    listEl.className = 'staff-list-content';
    listEl.style.overflowX = 'auto';
    listEl.style.overflowY = 'hidden';
    listEl.style.padding = '4px 8px';
    listEl.style.display = 'flex';
    listEl.style.flexDirection = 'row';
    listEl.style.gap = '12px';

    // 出勤中を先に、休みを後に
    const sorted = [...assistants].sort((a, b) => {
      const aWorking = dateStr ? a.isWorkingOn(dateStr) : a.isWorking;
      const bWorking = dateStr ? b.isWorkingOn(dateStr) : b.isWorking;
      if (aWorking === bWorking) return 0;
      return aWorking ? -1 : 1;
    });

    sorted.forEach((assistant, index) => {
      const isWorkingToday = dateStr ? assistant.isWorkingOn(dateStr) : assistant.isWorking;
      const card = this._createCard(assistant, index, isWorkingToday);
      listEl.appendChild(card);
      this._cards.set(assistant.id, card);
    });

    this._container.appendChild(listEl);
  }

  /**
   * 個別のアシスタントカード要素を作成する
   * @param {import('../models/staff.js').Staff} assistant - アシスタントデータ
   * @param {number} index - 表示順序（アニメーション遅延に使用）
   * @returns {HTMLElement} カード要素
   * @private
   */
  _createCard(assistant, index, isWorkingToday = true) {
    const card = document.createElement('div');
    card.className = 'assistant-card';
    card.dataset.assistantId = assistant.id;
    card.style.background = 'var(--bg-glass)';
    card.style.border = '1px solid var(--border-glass)';
    card.style.borderRadius = 'var(--radius-md)';
    card.style.padding = '12px';
    card.style.width = '210px';
    card.style.flexShrink = '0';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'space-between';
    card.style.transition = 'border-color var(--transition-fast), box-shadow var(--transition-fast)';

    // 休みの場合はグレーアウト
    if (!isWorkingToday) {
      card.style.opacity = '0.5';
    }

    // フェードインアニメーション（遅延付き）
    card.style.opacity = '0';
    card.style.transform = 'translateX(-10px)';
    requestAnimationFrame(() => {
      setTimeout(() => {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease, border-color var(--transition-fast), box-shadow var(--transition-fast)';
        card.style.opacity = isWorkingToday ? '1' : '0.5';
        card.style.transform = 'translateX(0)';
      }, index * 50);
    });

    // ホバーエフェクト
    const signal = this._abortController.signal;
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--accent-primary)';
      card.style.boxShadow = '0 0 8px rgba(99, 102, 241, 0.2)';
    }, { signal });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--border-glass)';
      card.style.boxShadow = 'none';
    }, { signal });

    // --- 名前・出勤状態行 ---
    const infoRow = document.createElement('div');
    infoRow.className = 'assistant-info';
    infoRow.style.display = 'flex';
    infoRow.style.alignItems = 'center';
    infoRow.style.gap = '6px';
    infoRow.style.marginBottom = '6px';

    const nameEl = document.createElement('span');
    nameEl.className = 'assistant-name';
    nameEl.textContent = assistant.nickname || assistant.name;
    nameEl.style.fontWeight = 'bold';
    nameEl.style.fontSize = '12px';
    nameEl.style.color = 'var(--text-primary)';
    nameEl.style.flex = '1';
    nameEl.style.cursor = 'pointer';
    nameEl.style.transition = 'color 0.2s';
    nameEl.addEventListener('mouseenter', () => {
      nameEl.style.textDecoration = 'underline';
      nameEl.style.color = 'var(--accent-primary)';
    }, { signal });
    nameEl.addEventListener('mouseleave', () => {
      nameEl.style.textDecoration = 'none';
      nameEl.style.color = 'var(--text-primary)';
    }, { signal });
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.eventBus) {
        window.eventBus.emit('openStaffHolidayModal', { staffId: assistant.id, staffType: assistant.type });
      }
    }, { signal });
    infoRow.appendChild(nameEl);

    // 休みラベル
    if (!isWorkingToday) {
      const offLabel = document.createElement('span');
      offLabel.textContent = '休み';
      offLabel.style.fontSize = '10px';
      offLabel.style.color = '#ef4444';
      offLabel.style.fontWeight = '600';
      offLabel.style.padding = '1px 6px';
      offLabel.style.borderRadius = '8px';
      offLabel.style.background = 'rgba(239, 68, 68, 0.15)';
      infoRow.appendChild(offLabel);
    }

    const workingEl = document.createElement('span');
    workingEl.className = `working-indicator ${isWorkingToday ? 'on' : 'off'}`;
    workingEl.textContent = '●';
    workingEl.style.fontSize = '10px';
    workingEl.style.color = isWorkingToday ? 'var(--accent-success)' : 'var(--text-secondary)';
    workingEl.title = isWorkingToday ? '出勤中' : '休み';
    infoRow.appendChild(workingEl);

    card.appendChild(infoRow);

    // --- スキルバッジ ---
    const skillsRow = document.createElement('div');
    skillsRow.className = 'assistant-skills';
    skillsRow.style.display = 'flex';
    skillsRow.style.flexWrap = 'wrap';
    skillsRow.style.gap = '3px';
    skillsRow.style.marginBottom = '6px';

    if (assistant.skills && Array.isArray(assistant.skills)) {
      assistant.skills.forEach((skill) => {
        const badge = document.createElement('span');
        badge.className = 'skill-badge';
        const skillId = typeof skill === 'string' ? skill : skill.id;
        const proficiency = typeof skill === 'object' && skill.proficiency ? skill.proficiency : 3;
        badge.textContent = `${getSkillLabel(skillId)} Lv.${proficiency}`;
        badge.style.fontSize = '9px';
        badge.style.padding = '1px 5px';
        badge.style.borderRadius = '8px';
        badge.style.background = `${getProficiencyColor(proficiency)}22`;
        badge.style.color = getProficiencyColor(proficiency);
        badge.style.border = `1px solid ${getProficiencyColor(proficiency)}44`;
        skillsRow.appendChild(badge);
      });
    }
    card.appendChild(skillsRow);

    // --- 疲労度バー ---
    const fatigueContainer = document.createElement('div');
    fatigueContainer.className = 'assistant-fatigue';
    fatigueContainer.style.marginBottom = '6px';

    const fatigueBar = new FatigueBar(fatigueContainer);
    // デフォルト値で描画（後から updateStatus で更新）
    fatigueBar.render({
      totalMinutes: 600, // 10時間（9:00-19:00）
      busyMinutes: 0,
      freeMinutes: 600,
      breaksTaken: { lunch: false, rest: false }
    });
    this._fatigueBars.set(assistant.id, fatigueBar);
    card.appendChild(fatigueContainer);

    // --- ステータス行 ---
    const statusRow = document.createElement('div');
    statusRow.className = 'assistant-status';
    statusRow.style.display = 'flex';
    statusRow.style.alignItems = 'center';
    statusRow.style.gap = '8px';
    statusRow.style.fontSize = '10px';

    const assignCountEl = document.createElement('span');
    assignCountEl.className = 'assignment-count';
    assignCountEl.textContent = '担当: 0件';
    assignCountEl.style.color = 'var(--text-secondary)';
    statusRow.appendChild(assignCountEl);

    // 昼食状況
    const lunchEl = document.createElement('span');
    lunchEl.className = 'break-status break-lunch';
    lunchEl.textContent = '🍽 未';
    lunchEl.style.color = 'var(--text-secondary)';
    statusRow.appendChild(lunchEl);

    // 休憩状況
    const restEl = document.createElement('span');
    restEl.className = 'break-status break-rest';
    restEl.textContent = '☕ 未';
    restEl.style.color = 'var(--text-secondary)';
    statusRow.appendChild(restEl);

    card.appendChild(statusRow);

    return card;
  }

  /**
   * 特定のアシスタントのステータスを更新する
   * @param {string} assistantId - アシスタントID
   * @param {Object} status - ステータス情報
   * @param {number} [status.assignmentCount] - 担当件数
   * @param {boolean} [status.lunchTaken] - 昼食済みかどうか
   * @param {boolean} [status.restTaken] - 休憩済みかどうか
   * @param {number} [status.busyMinutes] - 稼働時間(分)
   * @param {number} [status.freeMinutes] - 空き時間(分)
   */
  updateStatus(assistantId, status) {
    const card = this._cards.get(assistantId);
    if (!card) return;

    // 担当件数の更新
    if (status.assignmentCount !== undefined) {
      const countEl = card.querySelector('.assignment-count');
      if (countEl) {
        countEl.textContent = `担当: ${status.assignmentCount}件`;
        // 多い場合は色変更
        countEl.style.color = status.assignmentCount >= 3
          ? 'var(--accent-warning)'
          : 'var(--text-secondary)';
      }
    }

    // 昼食状態
    if (status.lunchTaken !== undefined) {
      const lunchEl = card.querySelector('.break-lunch');
      if (lunchEl) {
        lunchEl.textContent = status.lunchTaken ? '🍽 済' : '🍽 未';
        lunchEl.style.color = status.lunchTaken ? 'var(--accent-success)' : 'var(--text-secondary)';
      }
    }

    // 休憩状態
    if (status.restTaken !== undefined) {
      const restEl = card.querySelector('.break-rest');
      if (restEl) {
        restEl.textContent = status.restTaken ? '☕ 済' : '☕ 未';
        restEl.style.color = status.restTaken ? 'var(--accent-success)' : 'var(--text-secondary)';
      }
    }

    // 疲労度バーの更新
    const fatigueBar = this._fatigueBars.get(assistantId);
    if (fatigueBar && (status.busyMinutes !== undefined || status.freeMinutes !== undefined)) {
      fatigueBar.update({
        totalMinutes: 600,
        busyMinutes: status.busyMinutes || 0,
        freeMinutes: status.freeMinutes !== undefined ? status.freeMinutes : 600,
        breaksTaken: {
          lunch: status.lunchTaken || false,
          rest: status.restTaken || false
        }
      });
    }
  }

  /**
   * リソースをクリーンアップする
   * @private
   */
  _cleanup() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    // FatigueBarインスタンスを破棄
    this._fatigueBars.forEach((bar) => bar.destroy());
    this._fatigueBars.clear();
    this._cards.clear();
  }

  /**
   * コンポーネントを破棄し、すべてのリソースを解放する
   */
  destroy() {
    this._cleanup();
    this._container.innerHTML = '';
  }
}
