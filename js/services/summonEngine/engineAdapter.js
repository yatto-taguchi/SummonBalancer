export class EngineAdapter {
  /**
   * 新エンジンの出力を旧エンジンのインターフェースに変換する
   * @param {Object} newPipelineResult - 新エンジンの生出力
   * @returns {Object} 旧エンジンと同フォーマットのオブジェクト
   */
  static adapt(newPipelineResult) {
    return {
      assignments: newPipelineResult?.assignments ?? {},
      concurrentAssignments: newPipelineResult?.concurrentAssignments ?? {},
      unfilledSlots: newPipelineResult?.unfilledSlots ?? [],
      autoSlots: newPipelineResult?.autoSlots ?? [],
      manncells: newPipelineResult?.manncells ?? [],
      stylistSummons: newPipelineResult?.stylistSummons ?? [],
      freeTimeActivities: newPipelineResult?.freeTimeActivities ?? [],
      alerts: newPipelineResult?.alerts ?? [],
      fairnessScores: newPipelineResult?.fairnessScores ?? {},
      utilizationRates: newPipelineResult?.utilizationRates ?? {},
      // 🔴 追加: ヘルプブロックをUI層へ転送
      helperBlocks: newPipelineResult?.helperBlocks ?? [],
    };
  }
}
