import { EngineState } from './EngineState.js?v=4';
import { executeRequirementPhase } from './pipeline/01_requirementPhase.js?v=3';
import { executePrimaryAssign } from './pipeline/02_primaryAssign.js?v=4';
import { executeBackwardSweep } from './pipeline/02_5_horizontalSwap.js?v=6';
import { executeHelpAndSpecialSummon } from './pipeline/03_helpAndSpecialSummon.js?v=3';
import { executeManncellCompression } from './pipeline/04_manncellCompression.js?v=3';
import { executeFallbackReassign } from './pipeline/05_fallbackReassign.js?v=3';
import { executeGapAssignment } from './pipeline/05_5_gapAssignment.js?v=1';
import { executeBonusAssignment } from './pipeline/05_7_bonusAssignment.js?v=1';
import { executeFreeTimeAllocation } from './pipeline/06_freeTimeAllocation.js?v=4';

/** localStorage永続化キーのプレフィックス */
const PREV_STATE_KEY_PREFIX = 'summonEngine_prevState_';

export class SummonEngine {
  constructor() {
    // UIには触れさせず、エンジン内部で前回の計算結果（状態）を保持する
    // ページリロード後もフリーズ機構を維持するため、localStorageから復元を試みる
    this.previousState = null;
    this._cachedDateStr = null; // キャッシュ対象の日付
    this._restorePreviousState();
  }

  /**
   * localStorageからpreviousStateを復元する（起動時に1回だけ呼ばれる）
   * @private
   */
  _restorePreviousState() {
    try {
      // 今日の日付キーでキャッシュを検索
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const key = PREV_STATE_KEY_PREFIX + todayStr;
      const cached = localStorage.getItem(key);
      if (cached) {
        this.previousState = JSON.parse(cached);
        this._cachedDateStr = todayStr;
        console.info('[SummonEngine] previousState を localStorage から復元しました');
      }
      // 古い日付のキャッシュを削除（今日以外）
      this._cleanupOldCache(todayStr);
    } catch (e) {
      console.warn('[SummonEngine] previousState の復元に失敗:', e);
      this.previousState = null;
    }
  }

  /**
   * 古い日付のキャッシュを削除する
   * @param {string} keepDateStr - 残す日付文字列
   * @private
   */
  _cleanupOldCache(keepDateStr) {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREV_STATE_KEY_PREFIX) && k !== PREV_STATE_KEY_PREFIX + keepDateStr) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* 無視 */ }
  }

  /**
   * previousStateをlocalStorageに保存する
   * @param {string} dateStr - 日付文字列（YYYY-MM-DD）
   * @private
   */
  _persistPreviousState(dateStr) {
    try {
      const key = PREV_STATE_KEY_PREFIX + dateStr;
      localStorage.setItem(key, JSON.stringify(this.previousState));
      this._cachedDateStr = dateStr;
    } catch (e) {
      // localStorage容量超過時はログのみ
      console.warn('[SummonEngine] previousState の永続化に失敗（容量超過の可能性）:', e);
    }
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
    let state = new EngineState(reservations, allStaff, menus, null, options);
    
    // === フリーズ境界の計算（5分Tickへの丸め処理） ===
    let freezeBoundary = null;
    // 初回計算時 (previousState が無い場合) は、朝イチから全計算して過去実績を作るためフリーズしない
    if (options.isToday && typeof options.currentTime === 'number' && this.previousState) {
      // 例: 12:32 (212分) -> 12:30 (210分) にFloorでスナップ
      freezeBoundary = Math.floor(options.currentTime / 5) * 5;
    }
    // === 日付変更時の防御: 当日以外を表示した場合、メモリ上のキャッシュをクリア ===
    // 過去・未来の日付を表示した後に当日に戻った時、古いキャッシュが混入しないよう初期化する
    if (!options.isToday) {
      this.previousState = null;
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
        
        // 【修正】blockedTimes は動的な状態ではなく静的な設定値のため、
        // 過去のキャッシュで上書きせず、最新の options.blockedTimes を常に適用する。
        if (options.blockedTimes && Array.isArray(options.blockedTimes)) {
          Object.keys(state.tracker).forEach(staffId => {
            state.tracker[staffId].blockedTimes = [];
          });
          options.blockedTimes.forEach(block => {
            if (state.tracker[block.staffId]) {
              state.tracker[block.staffId].blockedTimes.push({
                startTime: block.startTime,
                endTime: block.endTime
              });
            }
          });
        }
      }
      // フリーズ済みアラート・スタイリスト召喚・マンセル記録も引き継ぐ
      // 【重要】未来のデータは予約状況が変わっている可能性があるため、
      //         freezeBoundary 以前（過去〜現在進行中）のみに厳格にフィルタリングし、
      //         未来分はパイプラインでゼロベース再計算させる。
      //         これにより予約削除・移動後のゴースト残留を完全に防止する。

      // --- manncellTicks: timeStr フィールドで過去分のみ復元 ---
      if (this.previousState.manncellTicks) {
        state.manncellTicks = JSON.parse(JSON.stringify(
          this.previousState.manncellTicks.filter(tick => {
            const [h, m] = tick.timeStr.split(':').map(Number);
            const tickMins = (h - 9) * 60 + m;
            return tickMins <= freezeBoundary;
          })
        ));
      }

      // --- alerts: timeStr フィールドで過去分のみ復元 ---
      //     （UIアダプター層 L206 でリセットされるが、多層防御として過去分のみに制限）
      if (this.previousState.alerts) {
        const filteredAlerts = this.previousState.alerts.filter(alert => {
          // alerts に timeStr がある場合はフィルタリング、ない場合は全通過
          if (alert.timeStr) {
            const [h, m] = alert.timeStr.split(':').map(Number);
            const tickMins = (h - 9) * 60 + m;
            return tickMins <= freezeBoundary;
          }
          return true; // timeStr がない形式のアラートはそのまま引き継ぐ
        });
        state.alerts = JSON.parse(JSON.stringify(filteredAlerts));
      }

      // --- stylistSummons: startTime フィールドで過去分のみ復元 ---
      if (this.previousState.stylistSummons) {
        state.stylistSummons = JSON.parse(JSON.stringify(
          this.previousState.stylistSummons.filter(summon => {
            const [h, m] = summon.startTime.split(':').map(Number);
            const startMins = (h - 9) * 60 + m;
            return startMins <= freezeBoundary;
          })
        ));
      }

      // --- ongoingTasks / lockedUnassignedTasks ---
      //     キーが reservationId_slotIndex 形式で時間情報を持たないが、
      //     パイプラインの各Phase が未来Tickで正しく再計算するため全復元でOK。
      //     フリーズ境界付近のアサイン継続性を維持する目的で引き継ぐ。
      if (this.previousState.ongoingTasks) {
        state.ongoingTasks = JSON.parse(JSON.stringify(this.previousState.ongoingTasks));
      }
      if (this.previousState.lockedUnassignedTasks) {
        state.lockedUnassignedTasks = JSON.parse(JSON.stringify(this.previousState.lockedUnassignedTasks));
      }
      
      // === 過去の確定済みフリータイム活動の復元 ===
      if (this.previousState.freeTimeActivities) {
        state.frozenFreeTimeActivities = JSON.parse(JSON.stringify(this.previousState.freeTimeActivities));
      }
    }

    // overrides（昼食・休憩の手動上書き）を初期状態にセット
    state.lunchOverrides = lunchOverrides || {};
    state.restOverrides = restOverrides || {};
    state.forcedFreeTimes = options.forcedFreeTimes || {};

    // 2. パイプライン（Chain of Responsibility）の実行
    //    各Phaseは内部で state.freezeBoundary を参照し、フリーズ対象のTickをスキップする
    state = executeRequirementPhase(state);      // Phase 1:   要件定義
    state = executePrimaryAssign(state);          // Phase 2:   基本配置
    state = executeHelpAndSpecialSummon(state);   // Phase 3:   ヘルプ・特殊召喚
    state = executeManncellCompression(state);    // Phase 4:   マンセル圧縮
    state = executeFallbackReassign(state);       // Phase 5:   フォールバック再配置
    state = executeGapAssignment(state);          // Phase 5.5: 隙間配置
    state = executeBackwardSweep(state);          // Phase 5.6: 最終最適化（ハンドオフ解消 + 不足解消）
    state = executeBonusAssignment(state);        // Phase 5.7: お手伝いサポート
    state = executeFreeTimeAllocation(state);     // Phase 6:   空き時間配置

    console.log('[SummonEngine Pipeline] Calculation finished.');

    // === 計算完了後、次回のフリーズに備えて状態をエンジン内部にキャッシュ ===
    try {
      this.previousState = JSON.parse(JSON.stringify({
        timeSlots: state.timeSlots,
        tracker: state.tracker,
        alerts: state.alerts,
        stylistSummons: state.stylistSummons,
        manncellTicks: state.manncellTicks,
        ongoingTasks: state.ongoingTasks,
        lockedUnassignedTasks: state.lockedUnassignedTasks,
        freeTimeActivities: state.freeTimeActivities,
        utilizationRates: state.utilizationRates
      }));
    } catch (e) {
      console.warn('[SummonEngine] Failed to cache previousState:', e);
      this.previousState = null;
    }

    // === localStorageにも永続化（ページリロード後もフリーズを維持するため） ===
    if (options.isToday) {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      this._persistPreviousState(todayStr);
    }

    // === UI互換のための変換処理 (アダプター) ===
    // アラートはUIアダプター層で一括生成するため、ここでリセットする
    state.alerts = [];

    const uiAssignments = {};
    const uiStylistSummons = [...(state.stylistSummons || [])];
    const uiUnfilledSlots = [...(state.slots || []).filter(s => s.status === 'unassigned')];
    
    // === 予約内のスロット単位のマンセル判定 ===
    // 全timeSlotを走査し、MANNCELL_STANDBY がアサインされているスロットの固有キーを収集
    const manncellSlotKeys = new Set();
    if (state.timeSlots) {
      Object.values(state.timeSlots).forEach(ts => {
        if (ts.assignments) {
          ts.assignments.forEach(assign => {
            if (assign.assistantId === 'MANNCELL_STANDBY') {
              const req = ts.requirements?.find(r => r.id === assign.requirementId);
              if (req) {
                const slotIdx = req.slotIndex !== undefined ? req.slotIndex : 0;
                manncellSlotKeys.add(`${req.reservationId}_${slotIdx}`);
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
              aggregation[resId][slotIndex].tickDetails.push({ 
                time, 
                staffId: assign.assistantId,
                badges: assign.badges || []
              });

              const mTick = manncellLookup[`${time}_${resId}`];
              if (mTick) {
                aggregation[resId][slotIndex].manncells.push(mTick);
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

              // 【修正B】gap_help でカバー済みの不足は tickDetail に追加しない（二重カウント防止）
              // Phase 5.5 で gap_help アサイン後も unassignedReqs を残す設計のため、
              // 同一Tick に null(不足) と gap_help(アサイン) が共存する。
              // gap_help 側の tickDetail で不足カウント・表示を一元管理するため、null は追加しない。
              const hasGapHelpCover = ts.assignments?.some(a =>
                a.requirementId === unreq.requirementId &&
                (a.badges || []).some(b => b === 'gap_help' || b === 'sp_special_summon_gap')
              );
              if (hasGapHelpCover) return;
              
              if (!aggregation[resId]) aggregation[resId] = {};
              if (!aggregation[resId][slotIdx]) aggregation[resId][slotIdx] = { tickDetails: [], manncells: [] };
              
              // 不足Tickも時刻付きで記録（staffId = null で不足を表す）
              aggregation[resId][slotIdx].tickDetails.push({ time, staffId: null, badges: [] });
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
          let current = { 
            staffId: data.tickDetails[0].staffId, 
            ticks: 1,
            startTime: data.tickDetails[0].time,
            badges: data.tickDetails[0].badges || []
          };
          for (let i = 1; i < data.tickDetails.length; i++) {
            const tick = data.tickDetails[i];
            // IDとバッジの両方が一致した場合のみ結合する
            const sameBadges = JSON.stringify(tick.badges || []) === JSON.stringify(current.badges);
            if (tick.staffId === current.staffId && sameBadges) {
              current.ticks++;
            } else {
              segments.push(current);
              current = { 
                staffId: tick.staffId, 
                ticks: 1,
                startTime: tick.time,
                badges: tick.badges || []
              };
            }
          }
          segments.push(current);
        }

        // === セグメントから表示テキストを時系列順に生成 ===
        const displayParts = [];    // 通常アサイン名
        const gapHelpParts = [];    // スキマヘルプ名（分離表示用）
        let totalUnassignedTicks = 0;
        const hasManncell = data.manncells.length > 0;
        const isCoveredByManncell = hasManncell || manncellSlotKeys.has(`${resId}_${slotIndex}`);

        // マンセル対象の場合、チーム全員の名前を data.manncells から抽出
        // （個別アサインの有無に関わらず、全スロットで統一表示するため）
        let manncellTeamText = '';
        if (hasManncell) {
          const involvedTeamIds = new Set();
          // 固定スタッフIDの収集（📌マーク表示用）
          const fixedStaffIdSet = new Set();
          data.manncells.forEach(mTick => {
            mTick.team.forEach(tId => involvedTeamIds.add(tId));
            // fixedStaffIds がマンセルTickに記録されていれば収集
            if (mTick.fixedStaffIds) {
              mTick.fixedStaffIds.forEach(fId => fixedStaffIdSet.add(fId));
            }
          });
          const involvedNames = Array.from(involvedTeamIds).map(tId => {
            const staffObj = state.master.staffMap ? state.master.staffMap[tId] : null;
            const name = staffObj ? (staffObj.nickname || staffObj.name) : tId;
            // 固定スタッフには📌マークを付与（現場が軸を把握できるように）
            return fixedStaffIdSet.has(tId) ? `📌${name}` : name;
          });
          manncellTeamText = involvedNames.length > 0 ? involvedNames.join('、') : 'チーム';
        }

        // 予約自体のスタイリストを取得しておく（自己アサイン判定用）
        const targetRes = state.reservations ? state.reservations.find(r => r.id === resId) : null;
        const resStylistId = targetRes ? targetRes.stylistId : null;

        let hasNoneFixed = false; // アシスタント配置OFFフラグ

        segments.forEach(seg => {
          const minutes = seg.ticks * 5;

          if (seg.staffId === null) {
            // 不足セグメント
            totalUnassignedTicks += seg.ticks;
            if (!isCoveredByManncell) {
              displayParts.push(`<span style="color: var(--accent-danger)">⚠不足(${minutes}分)</span>`);
            }
          } else if (seg.staffId === '__none__') {
            // アシスタント配置OFF（fixedAssistants[slot] = '__none__'）— 正常処理済みとして扱う
            // displayParts には追加しない（UIのスロット表示は reservation.js 側で「🚫 OFF」+「🏆 えらい！」を表示する）
            hasNoneFixed = true;
          } else if (seg.staffId === 'MANNCELL_STANDBY') {
            // マンセル（チーム対応）セグメント — 最終出力は hasManncell で統一上書きされる
            displayParts.push(`${manncellTeamText}(${minutes}分)`);
          } else {
            // 新しい厳格なバッジ判定（SSOT準拠）
            const badges = seg.badges || [];
            
            // 1. 特殊召喚（金）の判定: sp_special_summon_gap, sp_summon_lunch, sp_summon_break
            const isSpSpecial = badges.includes('sp_special_summon_gap') || badges.includes('sp_summon_lunch') || badges.includes('sp_summon_break');
            
            // 2. 通常召喚（赤）の判定: sp_summon のみ
            const isSpSummon = badges.includes('sp_summon');
            
            // 3. 召喚系のバッジを持っているか
            const isAnySummon = isSpSpecial || isSpSummon;

            // スタッフ情報の取得
            const staffObj = state.master.staffMap ? state.master.staffMap[seg.staffId] : null;

            // 4. 通常の隙間ヘルプ判定
            // ※「スタイリストであっても、特殊なバッジがなければ通常のアシスタント稼働とみなす」ため、
            // 召喚バッジがなければ一律で gap_help 扱いとする。
            const isGapHelp = badges.includes('gap_help');
            const isBonusHelp = badges.includes('bonus_help');

            // 【厳守事項2】隙間ヘルプであっても、元のタスクは本来「不足」であるため、
            // カウントを加算し、アラート生成の条件を満たすようにする。
            if (isGapHelp || badges.includes('gap_help') || badges.includes('sp_special_summon_gap')) {
              totalUnassignedTicks += seg.ticks;
            }

            // 自己対応（本人の予約へのアサイン）の判定
            const isSelf = (seg.staffId === resStylistId) && !isSpSpecial; // SP特殊召喚なら自分でも描画

            if (!isSelf) {
              // 通常のアサインセグメント（自身以外、またはSP特殊召喚）
              const staffName = staffObj ? (staffObj.nickname || staffObj.name) : seg.staffId;

              if (isGapHelp) {
                // 【修正C】スキマヘルプ → 不足テキスト + 専用配列に分離して追加
                // 仕様書: 「赤枠（不足エラー）を共存させて表示する」
                displayParts.push(`<span style="color: var(--accent-danger)">⚠不足(${minutes}分)</span>`);
                gapHelpParts.push(`☆${staffName}(${minutes}分)`);
              } else if (isBonusHelp) {
                displayParts.push(`✋${staffName}(${minutes}分)`);
              } else {
                // 通常アサイン → displayParts に追加
                displayParts.push(`${staffName}(${minutes}分)`);
              }
              
              // アサインされたのがスタイリストであり、かつ「召喚バッジ」を持っている場合のみ uiStylistSummons に登録する
              // （バッジなしの場合は単なるアシスタント枠として helperBlocks へ流れる）
              if (staffObj && staffObj.type === 'stylist' && isAnySummon) {
                const [h, m] = seg.startTime.split(':').map(Number);
                const startTotalMins = h * 60 + m;
                const endTotalMins = startTotalMins + minutes;
                const endH = Math.floor(endTotalMins / 60);
                const endM = endTotalMins % 60;
                const endTimeStr = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
                
                uiStylistSummons.push({
                  stylistId: seg.staffId,
                  reservationId: resId,
                  slotIndex: parseInt(slotIndex, 10),
                  startTime: seg.startTime,
                  endTime: endTimeStr,
                  badge: true,
                  badges: badges,
                  isSpecialSummon: isSpSpecial,
                  specialSummonReason: badges.includes('sp_special_summon_gap') ? 'gap' : (badges.includes('sp_summon_lunch') ? 'lunch' : (badges.includes('sp_summon_break') ? 'rest' : null))
                });
              }
            }
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

        // 【固定アサイン優先表示】このスロットに固定アサインがあるか判定（マンセル/非マンセル共通）
        // 固定スタッフの実IDを出力することで、reservation.js の📌判定ルート（actuallyFixed判定）に到達させる
        const thisSlotReqs = (state.timeSlots ? Object.values(state.timeSlots) : [])
          .flatMap(ts => (ts.requirements || []).filter(r => r.reservationId === resId && String(r.slotIndex) === String(slotIndex)));
        const fixedReqInSlot = thisSlotReqs.find(r => r.fixedAssistantId && r.fixedAssistantId !== '__none__');
        const hasFixedSegment = fixedReqInSlot && segments.some(seg => 
          seg.staffId === fixedReqInSlot.fixedAssistantId
        );

        // === uiAssignments の出力: 全面オブジェクト化 { text, gapHelps } ===
        const gapHelpsText = gapHelpParts.join(' → ');

        if (hasNoneFixed) {
          // アシスタント配置OFF → '__none__' を明示的に出力
          uiAssignments[resId][slotIndex] = { text: '__none__', gapHelps: gapHelpsText };
        } else if (hasFixedSegment && fixedReqInSlot) {
          // 固定スタッフが実際にアサインされている → スタッフ実IDを直接出力
          uiAssignments[resId][slotIndex] = { text: fixedReqInSlot.fixedAssistantId, gapHelps: gapHelpsText, isFixedId: true };
        } else if (hasManncell) {
          // 固定なし + マンセル → チーム全員の名前で統一表示
          uiAssignments[resId][slotIndex] = { text: `__manncell__::${manncellTeamText}`, gapHelps: gapHelpsText };
        } else {
          // 固定なし + 非マンセル → 通常の表示テキスト
          uiAssignments[resId][slotIndex] = { text: displayParts.join(' → '), gapHelps: gapHelpsText };
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

            // 召喚システム（uiStylistSummons）で描画されるアサインは helperBlocks から除外する
            // 逆に、スタイリストであってもバッジなし等の場合は helperBlocks として描画する
            const staffObj = state.master.staffMap[tick.staffId];
            if (staffObj && staffObj.type === 'stylist') {
              const badges = tick.badges || [];
              const isAnySummon = badges.includes('sp_special_summon_gap') || badges.includes('sp_summon_lunch') || badges.includes('sp_summon_break') || badges.includes('sp_summon');
              if (isAnySummon) return;
            }

            // スタイリスト召喚として既に描画されるアサインはスキップ
            if (summonKeys.has(`${tick.staffId}_${resId}_${slotIndex}`)) return;

            if (!helperTicksByStaff[tick.staffId]) helperTicksByStaff[tick.staffId] = [];
            helperTicksByStaff[tick.staffId].push({
              time: tick.time,
              resId,
              slotIndex: parseInt(slotIndex, 10),
              stylistId,
              badges: tick.badges || []
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
              endMin: tickEndMin,
              isGapHelp: (tick.badges || []).includes('gap_help'),
              isBonusHelp: (tick.badges || []).includes('bonus_help'),
              badges: tick.badges || []
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
              fixedStaffIds: tick.fixedStaffIds ? [...tick.fixedStaffIds] : [],
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
              
              // fixedStaffIds のマージ
              const currentFixedSet = new Set(currentBlock.fixedStaffIds || []);
              (tick.fixedStaffIds || []).forEach(id => currentFixedSet.add(id));
              currentBlock.fixedStaffIds = Array.from(currentFixedSet);
              
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
                fixedStaffIds: tick.fixedStaffIds ? [...tick.fixedStaffIds] : [],
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
    // === 【多層防御フェイルセーフ】実在予約バリデーション ===
    // マンセルブロックの reservationIds が現在の予約リストに1件も存在しない場合は除外。
    // フリーズ復元フィルタリングで本来防止されるが、二重安全策として実施。
    const currentReservationIds = new Set((reservations || []).map(r => r.id));
    state.manncells = manncells.filter(block => {
      if (!block.reservationIds || block.reservationIds.length === 0) {
        return true; // reservationIds が無いブロックはそのまま通過
      }
      // reservationIds のうち1件でも現在の予約に存在すれば有効
      return block.reservationIds.some(id => currentReservationIds.has(id));
    });

    // === 【修正B】UIアダプター層：不在ブロックとの重複フィルタリング（最終防御壁） ===
    // エンジン層で防御済みのはずだが、UIに渡す最終データとして不在ブロック時間と
    // 重複する召喚・ヘルプブロックを除外する二重安全策。
    // すべての比較は「9:00基準の分数」で統一する。
    const filteredStylistSummons = uiStylistSummons.filter(summon => {
      const staffTracker = state.tracker ? state.tracker[summon.stylistId] : null;
      if (!staffTracker || !staffTracker.blockedTimes || staffTracker.blockedTimes.length === 0) {
        return true; // ブロック設定なし → 通過
      }
      // 召喚の時間範囲を9:00基準の分数に変換
      let summonStartMin, summonEndMin;
      if (typeof summon.startTime === 'string' && summon.startTime.includes(':')) {
        const [sh, sm] = summon.startTime.split(':').map(Number);
        summonStartMin = (sh - 9) * 60 + sm;
      } else if (typeof summon.startTime === 'number') {
        summonStartMin = summon.startTime;
      } else {
        return true; // 変換できない場合は安全側で通過
      }
      if (typeof summon.endTime === 'string' && summon.endTime.includes(':')) {
        const [eh, em] = summon.endTime.split(':').map(Number);
        summonEndMin = (eh - 9) * 60 + em;
      } else if (typeof summon.endTime === 'number') {
        summonEndMin = summon.endTime;
      } else {
        return true;
      }
      // 不在ブロックとの重複チェック（半開区間で比較）
      for (const block of staffTracker.blockedTimes) {
        if (summonStartMin < block.endTime && summonEndMin > block.startTime) {
          console.warn(`[UIAdapter] 不在ブロック防御: スタッフ ${summon.stylistId} の召喚(${summon.startTime}-${summon.endTime})がブロック時間(${block.startTime}-${block.endTime})と重複するため除外`);
          return false; // ブロック時間と重複 → 除外
        }
      }
      return true; // ブロックと重複なし → 通過
    });

    // helperBlocksも同様にフィルタリング
    const filteredHelperBlocks = helperBlocks.filter(hb => {
      const staffTracker = state.tracker ? state.tracker[hb.staffId] : null;
      if (!staffTracker || !staffTracker.blockedTimes || staffTracker.blockedTimes.length === 0) {
        return true;
      }
      for (const block of staffTracker.blockedTimes) {
        if (hb.startMin < block.endTime && hb.endMin > block.startTime) {
          return false;
        }
      }
      return true;
    });

    // === 勤務時間外フィルタリング（blockedTimesフィルタと併用する第二段防御） ===
    // 仕様書セクション2「勤務時間外の絶対排除」: 勤務時間外のスタッフへの召喚を完全消去
    const staffMap = state.master?.staffMap || {};
    const finalStylistSummons = filteredStylistSummons.filter(summon => {
      const staffObj = staffMap[summon.stylistId];
      if (!staffObj) return true; // スタッフ情報なしの場合は安全側で通過
      if (typeof staffObj.isWorkingAtTime !== 'function') return true; // メソッド未定義は通過

      // 召喚の開始時間が勤務時間内かチェック（0:00基準の通算分数で判定）
      let startAbsMinute;
      if (typeof summon.startTime === 'string' && summon.startTime.includes(':')) {
        const [h, m] = summon.startTime.split(':').map(Number);
        startAbsMinute = h * 60 + m;
      } else if (typeof summon.startTime === 'number') {
        startAbsMinute = summon.startTime + 9 * 60;
      } else {
        return true;
      }
      if (!staffObj.isWorkingAtTime(startAbsMinute)) {
        console.warn(`[UIAdapter] 勤務時間外防御: スタッフ ${summon.stylistId} の召喚(${summon.startTime})が勤務時間外のため除外`);
        return false;
      }
      return true;
    });

    const finalHelperBlocks = filteredHelperBlocks.filter(hb => {
      const staffObj = staffMap[hb.staffId];
      if (!staffObj || typeof staffObj.isWorkingAtTime !== 'function') return true;
      let absMinute;
      if (typeof hb.startMin === 'number') {
        absMinute = hb.startMin + 9 * 60;
      } else {
        return true;
      }
      return staffObj.isWorkingAtTime(absMinute);
    });

    state.assignments = uiAssignments;
    state.stylistSummons = finalStylistSummons;
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
      helperBlocks: finalHelperBlocks // アシスタント行に描画するヘルプブロック（5分Tickマージ済み・不在/勤務時間外フィルタ適用済み）
    };
  }
}
