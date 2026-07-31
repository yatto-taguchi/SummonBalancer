import { EngineState } from './EngineState.js?v=4';
import { executeRequirementPhase } from './pipeline/01_requirementPhase.js?v=3';
import { executePrimaryAssign } from './pipeline/02_primaryAssign.js?v=3';
import { executeHelpAndSpecialSummon } from './pipeline/03_helpAndSpecialSummon.js?v=3';
import { executeManncellCompression } from './pipeline/04_manncellCompression.js?v=3';
import { executeFallbackReassign } from './pipeline/05_fallbackReassign.js?v=3';
import { executeFreeTimeAllocation } from './pipeline/06_freeTimeAllocation.js?v=4';

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
    // 初回計算時 (previousState が無い場合) は、朝イチから全計算して過去実績を作るためフリーズしない
    if (options.isToday && typeof options.currentTime === 'number' && this.previousState) {
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
      
      // === 過去の確定済みフリータイム活動の復元 ===
      if (this.previousState.freeTimeActivities) {
        state.frozenFreeTimeActivities = JSON.parse(JSON.stringify(this.previousState.freeTimeActivities));
      }
    }

    // overrides（昼食・休憩の手動上書き）を初期状態にセット
    state.lunchOverrides = lunchOverrides || {};
    state.restOverrides = restOverrides || {};

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
        manncellTicks: state.manncellTicks,
        freeTimeActivities: state.freeTimeActivities,
        utilizationRates: state.utilizationRates
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

    // 集計用の中間オブジェクト { resId: { slotIndex: { tickDetails: [], manncells: [] } } }
    // tickDetails: 各Tick（5分）ごとの時刻とアサイン先を時系列で記録
    const aggregation = {};

    const manncellLookup = {};
    (state.manncellTicks || []).forEach(m => {
      m.reservationIds.forEach(resId => {
        manncellLookup[`${m.timeStr}_${resId}`] = m;
      });
    });

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
              if (!aggregation[resId][slotIndex]) aggregation[resId][slotIndex] = { tickDetails: [], manncells: [] };
              
              // Tickごとの時刻とアサイン先を記録（時系列セグメント化の基礎データ）
              aggregation[resId][slotIndex].tickDetails.push({ time, staffId: assign.assistantId });

              const mTick = manncellLookup[`${time}_${resId}`];
              if (mTick) {
                aggregation[resId][slotIndex].manncells.push(mTick);
              }

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
              if (!aggregation[resId][slotIdx]) aggregation[resId][slotIdx] = { tickDetails: [], manncells: [] };
              
              // 不足Tickも時刻付きで記録（staffId = null で不足を表す）
              aggregation[resId][slotIdx].tickDetails.push({ time, staffId: null });
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
        
        // === セグメント化: tickDetailsを時刻順にソートし、連続する同一状態をグループ化 ===
        data.tickDetails.sort((a, b) => a.time.localeCompare(b.time));
        
        const segments = [];
        if (data.tickDetails.length > 0) {
          let current = { staffId: data.tickDetails[0].staffId, ticks: 1 };
          for (let i = 1; i < data.tickDetails.length; i++) {
            const tick = data.tickDetails[i];
            if (tick.staffId === current.staffId) {
              current.ticks++;
            } else {
              segments.push(current);
              current = { staffId: tick.staffId, ticks: 1 };
            }
          }
          segments.push(current);
        }

        // === セグメントから表示テキストを時系列順に生成 ===
        const displayParts = [];
        let totalUnassignedTicks = 0;
        const hasManncell = data.manncells.length > 0;
        const isCoveredByManncell = hasManncell || manncellReservationIds.has(resId);

        // マンセル対象の場合、チーム全員の名前を data.manncells から抽出
        // （個別アサインの有無に関わらず、全スロットで統一表示するため）
        let manncellTeamText = '';
        if (hasManncell) {
          const involvedTeamIds = new Set();
          data.manncells.forEach(mTick => {
            mTick.team.forEach(tId => involvedTeamIds.add(tId));
          });
          const involvedNames = Array.from(involvedTeamIds).map(tId => {
            const staffObj = state.master.staffMap ? state.master.staffMap[tId] : null;
            return staffObj ? (staffObj.nickname || staffObj.name) : tId;
          });
          manncellTeamText = involvedNames.length > 0 ? involvedNames.join('・') : 'チーム';
        }

        segments.forEach(seg => {
          const minutes = seg.ticks * 5;

          if (seg.staffId === null) {
            // 不足セグメント
            totalUnassignedTicks += seg.ticks;
            if (!isCoveredByManncell) {
              displayParts.push(`<span style="color: var(--accent-danger)">⚠不足(${minutes}分)</span>`);
            }
          } else if (seg.staffId === 'MANNCELL_STANDBY') {
            // マンセル（チーム対応）セグメント — 最終出力は hasManncell で統一上書きされる
            displayParts.push(`${manncellTeamText}(${minutes}分)`);
          } else {
            // 通常のアサインセグメント
            const staffObj = state.master.staffMap ? state.master.staffMap[seg.staffId] : null;
            const staffName = staffObj ? (staffObj.nickname || staffObj.name) : seg.staffId;
            displayParts.push(`${staffName}(${minutes}分)`);
          }
        });

        // 不足がある場合のアラートとunfilledSlots登録
        if (totalUnassignedTicks > 0) {
          const missingMinutes = totalUnassignedTicks * 5;

          uiUnfilledSlots.push({
            reservationId: resId,
            slotIndex: parseInt(slotIndex, 10),
            status: 'unassigned',
            reason: 'no_free_staff'
          });

          // マンセル（チーム対応）でカバーされている予約はアラートを出さない
          // スロット単位（hasManncell）+ 予約単位（manncellReservationIds）の二段階チェック
          // → 同じ予約内にマンセルが1つでも発動していれば、チーム内で回せるためアラート不要
          if (!isCoveredByManncell) {
            state.alerts.push({
              reservationId: resId,
              slotIndex: parseInt(slotIndex, 10),
              message: `配置可能なアシスタントがいません (${missingMinutes}分不足)`
            });
          }
        }

        // マンセル対象スロットは、個別アサインの有無に関わらずチーム全員の名前で統一表示
        // （現場のチーム内で話し合って役割を決める運用方針）
        if (hasManncell) {
          uiAssignments[resId][slotIndex] = `__manncell__::${manncellTeamText}`;
        } else {
          uiAssignments[resId][slotIndex] = displayParts.join(' → ');
        }
      });
    });

    // === ヘルプブロック（アシスタント行に描画するバーチャルブロック）の生成 ===
    // aggregation の tickDetails から、各スタッフがどの予約にヘルプとして入っているかを
    // 5分Tick単位で抽出し、同一スタッフ・同一予約の連続Tickを1つのブロックにマージする。
    // （マンセル枠と同じ手法で「フラグメンテーション問題」を解決）
    const helperBlocks = [];
    {
      // スタイリスト召喚の予約ID+slotIndexのSetを作成（重複描画防止用）
      const summonKeys = new Set();
      uiStylistSummons.forEach(s => {
        summonKeys.add(`${s.stylistId}_${s.reservationId}_${s.slotIndex}`);
      });

      // 中間データ: { staffId: [ { time, resId, slotIndex, stylistId } ] }
      const helperTicksByStaff = {};

      Object.keys(aggregation).forEach(resId => {
        const reservation = state.reservations.find(r => r.id === resId);
        if (!reservation) return;
        const stylistId = reservation.stylistId;

        Object.keys(aggregation[resId]).forEach(slotIndex => {
          const data = aggregation[resId][slotIndex];
          data.tickDetails.forEach(tick => {
            // null（不足）、MANNCELL_STANDBY、スタイリスト自身はスキップ
            if (!tick.staffId || tick.staffId === 'MANNCELL_STANDBY') return;
            if (tick.staffId === stylistId) return; // 自分自身の予約はスキップ

            // スタイリストはhelperBlocksの対象外（召喚システムで管理）
            const staffObj = state.master.staffMap[tick.staffId];
            if (staffObj && staffObj.type === 'stylist') return;

            // スタイリスト召喚として既に描画されるアサインはスキップ
            if (summonKeys.has(`${tick.staffId}_${resId}_${slotIndex}`)) return;

            if (!helperTicksByStaff[tick.staffId]) helperTicksByStaff[tick.staffId] = [];
            helperTicksByStaff[tick.staffId].push({
              time: tick.time,
              resId,
              slotIndex: parseInt(slotIndex, 10),
              stylistId
            });
          });
        });
      });

      // 各スタッフのTickを時刻順にソートし、同一予約の連続Tickをマージ
      Object.keys(helperTicksByStaff).forEach(staffId => {
        const ticks = helperTicksByStaff[staffId];
        ticks.sort((a, b) => a.time.localeCompare(b.time));

        let currentBlock = null;

        ticks.forEach(tick => {
          const [h, m] = tick.time.split(':').map(Number);
          const tickStartMin = (h - 9) * 60 + m; // 9:00基準の分数
          const tickEndMin = tickStartMin + 5;

          if (
            currentBlock &&
            currentBlock.resId === tick.resId &&
            currentBlock.endMin === tickStartMin
          ) {
            // 同一予約の連続Tick → 延長
            currentBlock.endMin = tickEndMin;
          } else {
            // 新しいブロックを開始（前のブロックがあれば保存）
            if (currentBlock) {
              helperBlocks.push(currentBlock);
            }
            currentBlock = {
              staffId: staffId,
              resId: tick.resId,
              slotIndex: tick.slotIndex,
              stylistId: tick.stylistId,
              startMin: tickStartMin,
              endMin: tickEndMin
            };
          }
        });

        if (currentBlock) {
          helperBlocks.push(currentBlock);
        }
      });
    }

    // === state.manncellTicks の連続ブロック化 ===
    const manncells = [];
    if (state.manncellTicks) {
      // timeStrでソート
      state.manncellTicks.sort((a, b) => a.timeStr.localeCompare(b.timeStr));
      
      // stylistId ごとに ticks をまとめる
      const ticksByStylist = {};
      state.manncellTicks.forEach(tick => {
        if (!ticksByStylist[tick.stylistId]) ticksByStylist[tick.stylistId] = [];
        ticksByStylist[tick.stylistId].push(tick);
      });

      // 各スタイリストの ticks を連続するブロックに結合する
      Object.keys(ticksByStylist).forEach(stylistId => {
        const ticks = ticksByStylist[stylistId];
        let currentBlock = null;

        ticks.forEach(tick => {
          const [h, m] = tick.timeStr.split(':').map(Number);
          const tickStart = h * 60 + m;
          const tickEnd = tickStart + 5; // 1つのTickは5分間

          if (!currentBlock) {
            // 新しいブロックを開始
            currentBlock = {
              stylistId: stylistId,
              startMin: tickStart,
              endMin: tickEnd,
              teamSize: tick.teamSize,
              team: tick.team ? [...tick.team] : [],
              reservationIds: tick.reservationIds ? [...tick.reservationIds] : []
            };
          } else {
            // 直前のブロックと連続しているか判定
            if (currentBlock.endMin === tickStart) {
              // 連続している場合は延長し、情報をマージ
              currentBlock.endMin = tickEnd;
              
              const currentTeamSet = new Set(currentBlock.team);
              (tick.team || []).forEach(id => currentTeamSet.add(id));
              currentBlock.team = Array.from(currentTeamSet);
              
              currentBlock.teamSize = Math.max(currentBlock.teamSize, tick.teamSize);
              
              if (tick.reservationIds) {
                tick.reservationIds.forEach(id => {
                  if (!currentBlock.reservationIds.includes(id)) {
                    currentBlock.reservationIds.push(id);
                  }
                });
              }
            } else {
              // 連続していない場合は現在のブロックを保存し、新しいブロックを開始
              currentBlock.startTime = `${String(Math.floor(currentBlock.startMin / 60)).padStart(2, '0')}:${String(currentBlock.startMin % 60).padStart(2, '0')}`;
              currentBlock.endTime = `${String(Math.floor(currentBlock.endMin / 60)).padStart(2, '0')}:${String(currentBlock.endMin % 60).padStart(2, '0')}`;
              manncells.push(currentBlock);
              
              currentBlock = {
                stylistId: stylistId,
                startMin: tickStart,
                endMin: tickEnd,
                teamSize: tick.teamSize,
                team: tick.team ? [...tick.team] : [],
                reservationIds: tick.reservationIds ? [...tick.reservationIds] : []
              };
            }
          }
        });

        if (currentBlock) {
          currentBlock.startTime = `${String(Math.floor(currentBlock.startMin / 60)).padStart(2, '0')}:${String(currentBlock.startMin % 60).padStart(2, '0')}`;
          currentBlock.endTime = `${String(Math.floor(currentBlock.endMin / 60)).padStart(2, '0')}:${String(currentBlock.endMin % 60).padStart(2, '0')}`;
          manncells.push(currentBlock);
        }
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
      utilizationRates: state.utilizationRates || {},
      alerts: state.alerts,
      helperBlocks: helperBlocks // アシスタント行に描画するヘルプブロック（5分Tickマージ済み）
    };
  }
}
