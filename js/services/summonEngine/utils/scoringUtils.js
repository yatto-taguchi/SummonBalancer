import { getTotalSkillLevel } from './skillUtils.js';
import { getRankById } from '../../../models/staff.js';
import { toTimestamp } from './timeUtils.js';

/**
 * アシスタント選定のための統一スコアリング関数
 * フェーズ2、フェーズ4、フェーズ5で共通して使用し、決定論的かつ公平なアサインを実現します。
 */

/**
 * スタッフ（アシスタントまたはスタイリスト）のスコアを算出します。
 * @param {import('../../models/staff.js').Staff} staff - 評価対象のスタッフ
 * @param {import('../EngineState.js').EngineState} state - 現在のエンジン状態（workloads等を含む）
 * @param {string|null} previousAssigneeId - 直前のスロットを担当したスタッフのID（連続性評価用）
 * @param {Object|null} currentTicket - 現在評価中のチケット（未来予知ペナルティ用）
 * @returns {number} 算出されたスコア（大きいほど優先度が高い）
 */
export function scoreAssistant(staff, state, previousAssigneeId = null, currentTicket = null) {
  let score = 0;

  // 1分稼働 = -1点 を絶対的な基準とする

  // --- 評価軸A（機会損失ペナルティ / 未来予知）---
  if (currentTicket && staff.type === 'assistant') {
    const rareSkills = ['color', 'perm_liquid', 'straight_1', 'straight_2'];
    if (!rareSkills.includes(currentTicket.requiredSkill)) {
      const currentTime = toTimestamp(currentTicket.startTime);
      const lookaheadLimit = currentTime + 60 * 60000;
      const futureNeeds = state.slots.filter(s => 
        s.status === 'unassigned' && 
        toTimestamp(s.startTime) >= currentTime && 
        toTimestamp(s.startTime) <= lookaheadLimit &&
        rareSkills.includes(s.requiredSkill)
      );

      if (futureNeeds.length > 0) {
        const canFulfillFuture = futureNeeds.some(futureTicket => {
          if (!staff.skills) return false;
          const skill = staff.skills.find(sk => sk.id === futureTicket.requiredSkill);
          return skill && skill.proficiency >= (futureTicket.requiredProficiency || 1);
        });
        if (canFulfillFuture) {
          score -= 5000; // -5000ペナルティ
        }
      }
    }
  }

  // --- 評価軸B（お客様への連続性）---
  if (previousAssigneeId && staff.id === previousAssigneeId) {
    score += 200; // +200ボーナス（最優先の継続）
  }

  // --- 評価軸C（スタイリスト専属性・チーム化）---
  let dedicatedCount = 0;
  if (currentTicket && currentTicket.stylistId) {
    const myStylistId = currentTicket.stylistId;
    for (const resId in state.assignments) {
      // 予約IDから予約を引く
      const res = state.reservations.find(r => r.id === resId);
      if (res && res.stylistId === myStylistId) {
        const slots = state.assignments[resId];
        for (const idx in slots) {
          if (slots[idx] === staff.id) dedicatedCount++;
        }
      }
    }
    // 過去にそのスタイリストのアサインに入った回数 × 40 （最大120）
    score += Math.min(dedicatedCount * 40, 120);
  }

  // --- 評価軸D（疲労管理 / 稼働時間）---
  const workloadMinutes = state.workloads[staff.id] || 0;
  score -= workloadMinutes; // -(workloads分)

  // --- 評価軸E（スキル温存）---
  // チーム化（専属性）が成立している場合は、そのチーム内の枠（シャンプー等）を全力で取りに行くためペナルティを無効化
  const totalSkillLevel = dedicatedCount > 0 ? 0 : getTotalSkillLevel(staff);
  score -= (totalSkillLevel * 20); // -(totalSkillLevel * 20)

  // --- 評価軸F（役職ペナルティ）---
  if (staff.type === 'stylist') {
    const rankObj = getRankById(staff.rank);
    const priority = rankObj ? rankObj.priority : 3;
    switch (priority) {
      case 4: score -= 3000; break;
      case 3: score -= 5000; break;
      case 2: score -= 8000; break;
      case 1: score -= 10000; break;
      default: score -= 5000; break;
    }
  }

  return score;
}

/**
 * 複数のスタッフをスコア順（高い順）にソートするための比較関数です。
 * @param {import('../../models/staff.js').Staff} a - スタッフA
 * @param {import('../../models/staff.js').Staff} b - スタッフB
 * @param {import('../EngineState.js').EngineState} state - 現在のエンジン状態
 * @param {string|null} previousAssigneeId - 直前のスロットを担当したスタッフのID
 * @param {Object|null} currentTicket - 現在評価中のチケット
 * @returns {number} ソート用の比較値
 */
export function compareAssistants(a, b, state, previousAssigneeId = null, currentTicket = null) {
  const scoreA = scoreAssistant(a, state, previousAssigneeId, currentTicket);
  const scoreB = scoreAssistant(b, state, previousAssigneeId, currentTicket);

  // スコアが高い方を優先（降順）
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  // 同点の場合はIDで文字列昇順ソートし、完全に決定論的（リロードでブレない）にする
  return a.id.localeCompare(b.id);
}
