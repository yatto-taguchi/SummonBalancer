export class EngineAdapter {
  /**
   * 新エンジンの出力を旧エンジンのインターフェースに変換する
   * @param {Object} newPipelineResult - 新エンジンの生出力
   * @returns {Object} 旧エンジンと同フォーマットのオブジェクト
   */
  static adapt(newPipelineResult) {
    // 新エンジンの出力が旧フォーマットに近い形になっているため、
    // 基本的なプロパティをマッピングして返します。
    // UI側での undefined アクセスを防ぐため、オプショナルチェイニングと Nullish Coalescing を徹底します。
    return {
      assignments: newPipelineResult?.assignments ?? {},
      concurrentAssignments: newPipelineResult?.concurrentAssignments ?? [],
      unfilledSlots: newPipelineResult?.unfilledSlots ?? [],
      autoSlots: newPipelineResult?.autoSlots ?? [],
      manncells: newPipelineResult?.manncells ?? [],
      stylistSummons: newPipelineResult?.stylistSummons ?? [],
      freeTimeActivities: newPipelineResult?.activities ?? [],
      alerts: newPipelineResult?.alerts ?? [],
      fairnessScores: newPipelineResult?.fairnessScores ?? {},
      utilizationRates: (() => {
        const rates = {};
        if (newPipelineResult?.workloads) {
          // 例: 1日10時間（600分）を100%とした稼働率計算
          for (const [staffId, minutes] of Object.entries(newPipelineResult.workloads)) {
            const baseRate = (minutes / 600) * 100;
            rates[staffId] = Math.min(100, Math.round(baseRate));
          }
        }
        return rates;
      })()
    };
  }
}
