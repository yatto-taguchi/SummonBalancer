import { hasSkill } from '../utils/skillUtils.js?v=3';
import { isStaffFree, toTimestamp, isStaffBlocked, isStaffWorkingAtTime } from '../utils/timeUtils.js?v=3';

/**
 * 対象スタッフの特定スキルのレベルを取得する
 */
function getSkillLevel(staff, skillId) {
  if (staff.type === 'stylist') return 99; // スタイリストは上限扱い
  if (!staff.skills) return 0;
  const skill = staff.skills.find(s => s.id === skillId);
  return skill ? (skill.proficiency || 0) : 0;
}

export function executePrimaryAssign(state) {
  let nextState = state.clone();
  
  if (!nextState.timeSlots) return nextState;
  
  if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
  if (!nextState.lockedUnassignedTasks) nextState.lockedUnassignedTasks = {};

  const assistants = (nextState.master?.staff || []).filter(s => s.type === 'assistant');
  const stylists = (nextState.master?.staff || []).filter(s => s.type === 'stylist');

  // 各スタイリストの当日の稼働率を事前計算 (総予約スロット数 / 120)
  const stylistUtilization = {};
  stylists.forEach(stylist => {
    let totalTicks = 0;
    (nextState.master?.reservations || []).forEach(res => {
      if (res.stylistId === stylist.id) {
        const start = typeof res.startTime === 'number' ? res.startTime : 0;
        const end = typeof res.endTime === 'number' ? res.endTime : 0;
        totalTicks += Math.max(0, (end - start) / 5);
      }
    });
    // 営業時間 10時間 = 600分 = 120 ticks
    stylistUtilization[stylist.id] = totalTicks / 120;
  });

  // 各時間枠（timeSlot）ごとに独立してアサインを計算
  Object.keys(nextState.timeSlots).forEach(time => {
    // フリーズ境界以前のTickはアサイン計算をスキップ（確定済みデータを維持）
    const [fH, fM] = time.split(':').map(Number);
    const tickMinsFrom9 = (fH - 9) * 60 + fM;
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }

    const timeSlot = nextState.timeSlots[time];
    if (!timeSlot || !timeSlot.requirements || timeSlot.requirements.length === 0) return;

    // 0. requirements を 固定(fixed)、第0優先度(継続中の交代禁止)、必須(strict)、任意(optional) に分割
    // Step -1: 固定要件を最優先で抽出（全Tier横断）— ユーザーの手動指示は絶対
    const fixedReqs = timeSlot.requirements.filter(r => 
      r.fixedAssistantId && !r.skipAssignment
    );

    const lockedReqs = timeSlot.requirements.filter(r => {
      const key = `${r.reservationId}_${r.slotIndex}`;
      return r.isHandoffProhibited && !!nextState.ongoingTasks[key] && !r.fixedAssistantId;
    });

    const strictReqs = timeSlot.requirements.filter(r => 
      (r.isStrictlyRequired || r.tier === 1) && !lockedReqs.includes(r) && !fixedReqs.includes(r)
    );
    const optionalReqs = timeSlot.requirements.filter(r => 
      !r.isStrictlyRequired && r.tier === 2 && !lockedReqs.includes(r) && !fixedReqs.includes(r)
    );

    // 必須タスクのソート（ID順）
    strictReqs.sort((a, b) => a.id.localeCompare(b.id));

    // 2. その時間枠で稼働可能なアシスタントのプールを初期化
    // 仕様書セクション2「勤務時間外の絶対排除」: 勤務時間外のアシスタントはプールから除外
    timeSlot.freePoolStaffIds = assistants
      .filter(a => isStaffWorkingAtTime(a, time))
      .map(a => a.id);

    // 共通のアサイン処理関数 (isStrict = true ならばエラー時は unassignedReqs へ)
    const tryAssign = (req, isStrict) => {
      // === 固定モード対応 ===

      // (A) skipAssignment: __none__固定（召喚不要）— 要件は存在するがアサイン不要
      if (req.skipAssignment) {
        timeSlot.assignments.push({
          requirementId: req.id,
          assistantId: '__none__',
          badges: []
        });
        return true;
      }

      // (B) fixedAssistantId: ユーザー手動固定 — designatedStaffId より優先
      //     【SSOT準拠】固定モードは「ユーザーの絶対的な手動指示」であるため、
      //     フォールバック（代替アサイン）は絶対に行わない。
      //     固定スタッフが使用不可の場合は未アサイン（赤枠エラー）として残す。
      if (req.fixedAssistantId) {
        const fixedId = req.fixedAssistantId;
        // ガード: そのスタッフがこのTickで使用可能か確認
        const isInFreePool = timeSlot.freePoolStaffIds.includes(fixedId);
        // スタイリストの場合はfreePoolに含まれないため、overlappingCountsで判定する
        const isStylist = (nextState.master?.staff || []).some(s => s.id === fixedId && s.type === 'stylist');
        const stylistOverlap = isStylist ? (timeSlot.stylistOverlapCounts[fixedId] || 0) : 0;
        const isStylistFree = isStylist && stylistOverlap === 0;

        if (isInFreePool || isStylistFree) {
          timeSlot.assignments.push({
            requirementId: req.id,
            assistantId: fixedId,
            badges: []
          });
          // freePool から除外（アシスタントの場合のみ）
          if (isInFreePool) {
            timeSlot.freePoolStaffIds = timeSlot.freePoolStaffIds.filter(id => id !== fixedId);
          }
          // tracker 更新
          const taskKey = `${req.reservationId}_${req.slotIndex}`;
          nextState.ongoingTasks[taskKey] = fixedId;
          const currentTracker = nextState.tracker[fixedId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
          nextState.tracker = {
            ...nextState.tracker,
            [fixedId]: {
              ...currentTracker,
              totalAssignedSlots: currentTracker.totalAssignedSlots + 1
            }
          };
          return true;
        }
        // 【フォールバック禁止】固定スタッフが使用不可 → 代替アサインせず赤枠エラーとして残す
        console.warn(`[Phase 2] 固定スタッフ ${fixedId} はこのTickで使用不可。フォールバック禁止のため未アサイン（赤枠）として残します。`);
        if (isStrict) {
          timeSlot.unassignedReqs.push({
            requirementId: req.id,
            reason: 'fixed_staff_unavailable'
          });
        }
        return false; // フォールバックせず終了
      }

      // === 既存ロジック ===
      if (req.designatedStaffId) {
        timeSlot.assignments.push({
          requirementId: req.id,
          assistantId: req.designatedStaffId,
          badges: []
        });
        const currentTracker = nextState.tracker[req.designatedStaffId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        nextState.tracker = {
          ...nextState.tracker,
          [req.designatedStaffId]: {
            ...currentTracker,
            totalAssignedSlots: currentTracker.totalAssignedSlots + 1
          }
        };
        return true;
      }

      let candidates = timeSlot.freePoolStaffIds
        .map(id => assistants.find(a => a.id === id))
        .filter(a => a && hasSkill(a, req.requiredSkill, req.minSkillLevel)
          && !isStaffBlocked(a.id, time, nextState.tracker)
          && isStaffWorkingAtTime(a, time)  // 勤務時間外の絶対排除（念押しチェック）
        );

      const taskKey = `${req.reservationId}_${req.slotIndex}`;
      const ongoingAssistantId = nextState.ongoingTasks[taskKey] || null;
      const isLockedUnassigned = !!nextState.lockedUnassignedTasks[taskKey];

      if (req.isHandoffProhibited) {
        if (ongoingAssistantId) {
          const isFree = candidates.some(a => a.id === ongoingAssistantId);
          if (isFree) {
            const ongoingAssistant = assistants.find(a => a.id === ongoingAssistantId);
            candidates = [ongoingAssistant];
          } else {
            candidates = [];
          }
        } else if (isLockedUnassigned) {
          candidates = [];
        }
      }

      if (candidates.length === 0) {
        if (isStrict) {
          // Tier 1（必須タスク）のみPhase 3に回す。Tier 2は「本人対応」として静かに破棄
          timeSlot.unassignedReqs.push({
            requirementId: req.id,
            reason: "no_free_staff"
          });
        }
        if (req.isHandoffProhibited) {
          nextState.lockedUnassignedTasks[taskKey] = true;
        }
        return false;
      }

      candidates.sort((a, b) => {
        // 1. 直前Tickからの継続性（最優先・細切れ防止）
        if (ongoingAssistantId) {
          if (a.id === ongoingAssistantId) return -1;
          if (b.id === ongoingAssistantId) return 1;
        }
        // 2. 累計アサイン数の少ない順（空いている人を優先的に使う＝お客様ファースト）
        const aCount = nextState.tracker[a.id]?.totalAssignedSlots || 0;
        const bCount = nextState.tracker[b.id]?.totalAssignedSlots || 0;
        if (aCount !== bCount) return aCount - bCount;

        // 3. スキルレベル低い順（タイブレーカー: 高スキル温存は副次的な目的に留める）
        const aLevel = getSkillLevel(a, req.requiredSkill);
        const bLevel = getSkillLevel(b, req.requiredSkill);
        if (aLevel !== bLevel) return aLevel - bLevel;

        // 4. UI表示リストの下から（配列インデックス降順）
        const staffIndexMap = nextState.master?.staffIndexMap || {};
        const idxA = staffIndexMap[a.id] ?? 0;
        const idxB = staffIndexMap[b.id] ?? 0;
        return idxB - idxA;
      });

      const selected = candidates[0];

      timeSlot.assignments.push({
        requirementId: req.id,
        assistantId: selected.id,
        badges: []
      });

      nextState.ongoingTasks[taskKey] = selected.id;

      timeSlot.freePoolStaffIds = timeSlot.freePoolStaffIds.filter(id => id !== selected.id);

      const currentTracker = nextState.tracker[selected.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
      nextState.tracker = {
        ...nextState.tracker,
        [selected.id]: {
          ...currentTracker,
          totalAssignedSlots: currentTracker.totalAssignedSlots + 1
        }
      };
      return true;
    };

    // Step -1: 固定要件の最優先処理（ユーザーの絶対的な手動指示）
    // freePool 初期化直後に処理し、固定スタッフが他の要件に先取りされることを防止
    // 【確定的ソート】同一スタッフが複数Tickで重複固定された場合の処理順序を安定化
    fixedReqs.sort((a, b) => {
      // 1. Tier 優先（Tier 1 > Tier 2: 掛け持ちが多い予約を先に処理）
      if (a.tier !== b.tier) return a.tier - b.tier;
      // 2. 予約ID順（同一Tier内は辞書順で安定化）
      if (a.reservationId !== b.reservationId) return a.reservationId.localeCompare(b.reservationId);
      // 3. スロットID順
      return a.slotIndex - b.slotIndex;
    });
    fixedReqs.forEach(req => tryAssign(req, req.isStrictlyRequired || req.tier === 1));

    // Step 0: 継続中の交代禁止タスク（第0優先度）の消化
    // 奪われ防止のため、最も早くアサイン処理を行う
    lockedReqs.forEach(req => tryAssign(req, req.isStrictlyRequired || req.tier === 1));

    // Step 1: 必須タスクの消化
    strictReqs.forEach(req => tryAssign(req, true));

    // Step 2: 余力判定と任意タスク（tier: 2）への配置
    if (optionalReqs.length > 0) {
      // ソート: ①オーナーの予約 > ②スタイリストの稼働率が高い順
      optionalReqs.sort((a, b) => {

        const stylistA = stylists.find(s => s.id === a.stylistId);
        const stylistB = stylists.find(s => s.id === b.stylistId);
        const isOwnerA = stylistA?.rank === 'owner' ? 1 : 0;
        const isOwnerB = stylistB?.rank === 'owner' ? 1 : 0;
        if (isOwnerA !== isOwnerB) return isOwnerB - isOwnerA;
        
        const utilA = stylistUtilization[a.stylistId] || 0;
        const utilB = stylistUtilization[b.stylistId] || 0;
        return utilB - utilA;
      });

      optionalReqs.forEach(req => {
        const freeCount = timeSlot.freePoolStaffIds.length;
        if (freeCount === 0) return; // 空きがいなければ終了

        const stylist = stylists.find(s => s.id === req.stylistId);
        const isOwner = stylist?.rank === 'owner';
        const isJunior = stylist?.rank === 'junior';
        const utilization = stylistUtilization[req.stylistId] || 0;

        let shouldAssign = false;
        
        // 既に lockedReqs で処理されているものはここには来ないが、
        // 念のため未アサインのロック(lockedUnassigned)なども考慮
        if (isJunior) {
          // 【ルール】ジュニアスタイリストの単独予約は強制的に本人対応（アシスタントをつけない）
          shouldAssign = false;
        } else if (utilization >= 0.5 || isOwner) {
          // 条件B: 稼働率50%以上またはオーナーなら1人でも余っていればアサイン
          shouldAssign = freeCount >= 1;
        } else {
          // 条件A: 稼働率50%未満なら2人以上余っている場合に限りアサイン
          shouldAssign = freeCount >= 2;
        }

        if (shouldAssign) {
          tryAssign(req, false);
        } else if (req.isHandoffProhibited) {
          // 余力不足でアサイン見送りと判断された交代禁止タスクは、未アサイン状態をロックする
          const taskKey = `${req.reservationId}_${req.slotIndex}`;
          nextState.lockedUnassignedTasks[taskKey] = true;
        }
      });
    }
  });

  return nextState;
}
