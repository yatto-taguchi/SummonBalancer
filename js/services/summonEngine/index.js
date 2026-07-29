import { EngineState } from './EngineState.js?v=3';
import { executeRequirementPhase } from './pipeline/01_requirementPhase.js?v=3';
import { executePrimaryAssign } from './pipeline/02_primaryAssign.js?v=3';
import { executeHelpAndSpecialSummon } from './pipeline/03_helpAndSpecialSummon.js?v=3';
import { executeManncellCompression } from './pipeline/04_manncellCompression.js?v=3';
import { executeFallbackReassign } from './pipeline/05_fallbackReassign.js?v=3';
import { executeFreeTimeAllocation } from './pipeline/06_freeTimeAllocation.js?v=3';

export class SummonEngine {
  constructor() {
    // UIには触れさせず、エンジン内部で前回の計算結果（状態）を保持する
    this.previousState = null;
  }

  /**
   * すべての予約、スタッフ、メニュー情報を元に、アサイン結果を計算して返します。
   * イミュータブルな状態（EngineState）をパイプラインで順に処理します。
   * @param {Object} options - { isToday: boolean, currentTime: number (9:00基準の分数) }
   */
  calculate(reservations, stylists, assistants, menus, lunchOverrides = {}, restOverrides = {}, options = {}) {
    console.log('[SummonEngine Pipeline] Starting calculation...');
    
    // 全スタッフを結合
    const allStaff = [...(stylists || []), ...(assistants || [])];
    
    // 1. 初期状態の生成
    let state = new EngineState(reservations, allStaff, menus);
    
    // === フリーズ境界の計算（5分Tickへの丸め処理） ===
    let freezeBoundary = null;
    if (options.isToday && typeof options.currentTime === 'number') {
      // 例: 12:32 (212分) -> 12:30 (210分) にFloorでスナップ
      freezeBoundary = Math.floor(options.currentTime / 5) * 5;
    }
    state.freezeBoundary = freezeBoundary;

    // === 過去の時間の「フリーズ（完全復元）」処理 ===
    if (freezeBoundary !== null && this.previousState && this.previousState.timeSlots) {
      // 当日の再計算: 過去および現在進行中の時間枠を「確定済み」として保持・ロックする
      Object.keys(this.previousState.timeSlots).forEach(timeStr => {
        const [h, m] = timeStr.split(':').map(Number);
        const tickMins = (h - 9) * 60 + m; // 9:00基準の分数
        if (tickMins <= freezeBoundary) {
          // 過去〜現在進行中のTickは、前回のStateからそのままディープコピーして復元
          state.timeSlots[timeStr] = JSON.parse(JSON.stringify(this.previousState.timeSlots[timeStr]));
        }
      });

      // フリーズ境界時刻におけるスタッフの稼働状態を previousState の tracker から引き継ぐ
      if (this.previousState.tracker) {
        state.tracker = JSON.parse(JSON.stringify(this.previousState.tracker));
      }
      // フリーズ済みアラート・スタイリスト召喚・マンセル記録も引き継ぐ
      if (this.previousState.alerts) {
        state.alerts = JSON.parse(JSON.stringify(this.previousState.alerts));
      }
      if (this.previousState.stylistSummons) {
        state.stylistSummons = JSON.parse(JSON.stringify(this.previousState.stylistSummons));
      }
      if (this.previousState.manncellTicks) {
        state.manncellTicks = JSON.parse(JSON.stringify(this.previousState.manncellTicks));
      }
    }

    // TODO: overrides（昼食・休憩の上書き）などを初期状態にセットする処理を後で追加

    // 2. パイプライン（Chain of Responsibility）の実行
    //    各Phaseは内部で state.freezeBoundary を参照し、フリーズ対象のTickをスキップする
    state = executeRequirementPhase(state);
    state = executePrimaryAssign(state);
    state = executeHelpAndSpecialSummon(state);
    state = executeManncellCompression(state);
    state = executeFallbackReassign(state);
    state = executeFreeTimeAllocation(state);

    console.log('[SummonEngine Pipeline] Calculation finished.');

    // === 計算完了後、次回のフリーズに備えて状態をエンジン内部にキャッシュ ===
    try {
      this.previousState = JSON.parse(JSON.stringify({
        timeSlots: state.timeSlots,
        tracker: state.tracker,
        alerts: state.alerts,
        stylistSummons: state.stylistSummons,
        manncellTicks: state.manncellTicks
      }));
    } catch (e) {
      console.warn('[SummonEngine] Failed to cache previousState:', e);
      this.previousState = null;
    }

    // === UI互換のための変換処理 (アダプター) ===
    // アラートはUIアダプター層で一括生成するため、ここでリセットする
    state.alerts = [];

    const uiAssignments = {};
    const uiStylistSummons = [...(state.stylistSummons || [])];
    const uiUnfilledSlots = [...(state.slots || []).filter(s => s.status === 'unassigned')];
    
    // === 予約単位のマンセル判定（修正C） ===
    // 全timeSlotを走査し、MANNCELL_STANDBY がアサインされている「予約ID」を収集
    const manncellReservationIds = new Set();
    if (state.timeSlots) {
      Object.values(state.timeSlots).forEach(ts => {
        if (ts.assignments) {
          ts.assignments.forEach(assign => {
            if (assign.assistantId === 'MANNCELL_STANDBY') {
              const req = ts.requirements?.find(r => r.id === assign.requirementId);
              if (req) {
                manncellReservationIds.add(req.reservationId);
              }
            }
          });
        }
      });
    }

    // 集計用の中間オブジェクト { resId: { slotIndex: { assignedStaffIds: [], unassignedTicks: 0 } } }
    const aggregation = {};

    if (state.timeSlots) {
      Object.keys(state.timeSlots).forEach(time => {
        const ts = state.timeSlots[time];
        
        if (ts.assignments) {
          ts.assignments.forEach(assign => {
            const req = ts.requirements?.find(r => r.id === assign.requirementId);
            if (req) {
              const resId = req.reservationId;
              const slotIndex = req.slotIndex !== undefined ? req.slotIndex : 0;
              
              if (!aggregation[resId]) aggregation[resId] = {};
              if (!aggregation[resId][slotIndex]) aggregation[resId][slotIndex] = { assignedStaffIds: [], unassignedTicks: 0 };
              
              aggregation[resId][slotIndex].assignedStaffIds.push(assign.assistantId);

              // Phase3 のバッジ（特殊召喚）処理
              if (assign.badges && assign.badges.length > 0) {
                uiStylistSummons.push({
                  stylistId: assign.assistantId,
                  reservationId: resId,
                  slotIndex: slotIndex,
                  startTime: time,
                  endTime: time, // UI表示用
                  badge: true,
                  badges: assign.badges,
                  isSpecialSummon: true
                });
              }
            }
          });
        }

        // Phase 2, 3 で漏れた未アサイン要件（赤枠）を抽出
        if (ts.unassignedReqs) {
          ts.unassignedReqs.forEach(unreq => {
            const req = ts.requirements?.find(r => r.id === unreq.requirementId);
            if (req) {
              const resId = req.reservationId;
              const slotIdx = req.slotIndex !== undefined ? req.slotIndex : 0;
              
              if (!aggregation[resId]) aggregation[resId] = {};
              if (!aggregation[resId][slotIdx]) aggregation[resId][slotIdx] = { assignedStaffIds: [], unassignedTicks: 0 };
              
              aggregation[resId][slotIdx].unassignedTicks++;
            }
          });
        }
      });
    }

    // aggregation を元に uiAssignments と uiUnfilledSlots, state.alerts を構築
    Object.keys(aggregation).forEach(resId => {
      uiAssignments[resId] = {};
      Object.keys(aggregation[resId]).forEach(slotIndex => {
        const data = aggregation[resId][slotIndex];
        
        // 担当ごとの回数を数える
        const staffCounts = {};
        data.assignedStaffIds.forEach(id => {
          staffCounts[id] = (staffCounts[id] || 0) + 1;
        });

        const displayParts = [];
        const hasManncell = data.assignedStaffIds.includes('MANNCELL_STANDBY');
        
        if (hasManncell) {
          const involvedStaffIds = Object.keys(staffCounts).filter(id => id !== 'MANNCELL_STANDBY');
          const involvedNames = involvedStaffIds.map(id => {
            const staffObj = state.master.staffMap ? state.master.staffMap[id] : null;
            return staffObj ? (staffObj.nickname || staffObj.name) : id;
          });
          const teamText = involvedNames.length > 0 ? ` (${involvedNames.join('・')})` : '';
          const totalMins = data.assignedStaffIds.length * 5;
          displayParts.push(`【チーム対応】${teamText}(${totalMins}分)`);
        } else {
          Object.keys(staffCounts).forEach(id => {
            const minutes = staffCounts[id] * 5;
            const staffObj = state.master.staffMap ? state.master.staffMap[id] : null;
            const staffName = staffObj ? (staffObj.nickname || staffObj.name) : id;
            displayParts.push(`${staffName}(${minutes}分)`);
          });
        }

        if (data.unassignedTicks > 0) {
          const missingMinutes = data.unassignedTicks * 5;
          // 不足テキスト（UI側で赤色表示される）
          displayParts.push(`⚠不足(${missingMinutes}分)`);
          
          uiUnfilledSlots.push({
            reservationId: resId,
            slotIndex: parseInt(slotIndex, 10),
            status: 'unassigned',
            reason: 'no_free_staff'
          });
          
          // マンセル（チーム対応）でカバーされている予約はアラートを出さない
          // スロット単位（hasManncell）+ 予約単位（manncellReservationIds）の二段階チェック
          // → 同じ予約内にマンセルが1つでも発動していれば、チーム内で回せるためアラート不要
          if (!hasManncell && !manncellReservationIds.has(resId)) {
            state.alerts.push({
              reservationId: resId,
              slotIndex: parseInt(slotIndex, 10),
              message: `配置可能なアシスタントがいません (${missingMinutes}分不足)`
            });
          }
        }

        uiAssignments[resId][slotIndex] = displayParts.join(' / ');
      });
    });

    // === state.manncellTicks の連続ブロック化 ===
    const manncells = [];
    if (state.manncellTicks) {
      // timeStrでソート
      state.manncellTicks.sort((a, b) => a.timeStr.localeCompare(b.timeStr));
      
      const activeBlocks = {};
      
      state.manncellTicks.forEach(tick => {
        let maxStart = 0;
        let minEnd = 24 * 60;
        
        if (tick.reservationIds && tick.reservationIds.length > 0) {
          tick.reservationIds.forEach(id => {
            const res = (state.master?.reservations || []).find(r => r.id === id);
            if (res) {
              // startTime/endTime は数値（9:00基準の分数）
              const resStartMins = 9 * 60 + (typeof res.startTime === 'number' ? res.startTime : 0);
              const resEndMins = 9 * 60 + (typeof res.endTime === 'number' ? res.endTime : 0);
              maxStart = Math.max(maxStart, resStartMins);
              minEnd = Math.min(minEnd, resEndMins);
            }
          });
        }
        
        if (maxStart >= minEnd || maxStart === 0) {
          // フォールバック（予約が見つからない場合など）
          const [h, m] = tick.timeStr.split(':').map(Number);
          maxStart = h * 60 + m;
          minEnd = maxStart + 5;
        }

        const startStr = `${String(Math.floor(maxStart / 60)).padStart(2, '0')}:${String(maxStart % 60).padStart(2, '0')}`;
        const endStr = `${String(Math.floor(minEnd / 60)).padStart(2, '0')}:${String(minEnd % 60).padStart(2, '0')}`;
        
        const blockKey = `${tick.stylistId}_${startStr}_${endStr}`;
        
        if (!activeBlocks[blockKey]) {
          activeBlocks[blockKey] = {
            stylistId: tick.stylistId,
            startTime: startStr,
            endTime: endStr,
            teamSize: tick.teamSize,
            team: tick.team ? [...tick.team] : [],
            reservationIds: tick.reservationIds ? [...tick.reservationIds] : []
          };
        } else {
          // メンバー情報をマージ
          const currentTeamSet = new Set(activeBlocks[blockKey].team);
          (tick.team || []).forEach(id => currentTeamSet.add(id));
          activeBlocks[blockKey].team = Array.from(currentTeamSet);
          activeBlocks[blockKey].teamSize = Math.max(activeBlocks[blockKey].teamSize, tick.teamSize);
          
          if (tick.reservationIds) {
            tick.reservationIds.forEach(id => {
              if (!activeBlocks[blockKey].reservationIds.includes(id)) {
                activeBlocks[blockKey].reservationIds.push(id);
              }
            });
          }
        }
      });
      
      Object.values(activeBlocks).forEach(block => {
        manncells.push(block);
      });
    }
    state.manncells = manncells;

    state.assignments = uiAssignments;
    state.stylistSummons = uiStylistSummons;
    state.unassignedSlots = uiUnfilledSlots;

    // 3. UI（メインビュー等）が期待するフォーマットに結果を整形して返す
    // ※新しいアーキテクチャから抽出した結果を出力
    return {
      assignments: state.assignments,
      concurrentAssignments: [], // TODO: 実装
      unfilledSlots: state.unassignedSlots,
      autoSlots: [], // TODO: 実装
      manncells: state.manncells,
      stylistSummons: state.stylistSummons,
      freeTimeActivities: state.freeTimeActivities,
      alerts: state.alerts
    };
  }
}
