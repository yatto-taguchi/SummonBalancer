import { SummonEngine as LegacySummonEngine } from '../summonEngine.js';
import { SummonEngine as NewPipelineEngine } from './index.js?v=4';
import { EngineAdapter } from './engineAdapter.js?v=4';

export const summonEngine = {
  // 内部にインスタンスを保持
  _legacyEngine: new LegacySummonEngine(),
  _newEngine: new NewPipelineEngine(),

  calculate: function(reservations, stylists, assistants, menus, lunchOverrides = {}, restOverrides = {}) {
    // 1. 本番用（UI用）：新エンジンを同期実行し、Adapterでフォーマットを合わせる
    let adaptedNewResult;
    try {
      const newRawResult = this._newEngine.calculate(reservations, stylists, assistants, menus, lunchOverrides, restOverrides);
      adaptedNewResult = EngineAdapter.adapt(newRawResult);
    } catch (error) {
      console.error('[Shadow Run] 新エンジンの実行で例外が発生しました:', error);
      alert("[DEBUG] 新エンジンがクラッシュし、フォールバックしました！\\nエラー: " + error.message);
      // フェイルセーフ: 新エンジンが落ちた場合は旧エンジンにフォールバック
      return this._legacyEngine.calculate(reservations, stylists, assistants, menus, lunchOverrides, restOverrides);
    }

    // 2. 裏側：検証のため旧エンジンを非同期で実行し、比較する
    try {
      setTimeout(() => {
        try {
          const legacyResult = this._legacyEngine.calculate(reservations, stylists, assistants, menus, lunchOverrides, restOverrides);
          this._compareAndLogDifferences(reservations, adaptedNewResult, legacyResult);
        } catch (innerError) {
          console.error('[Shadow Run] 旧エンジンの非同期実行中で例外が発生しました:', innerError);
        }
      }, 0);
    } catch (error) {
      console.error('[Shadow Run] 旧エンジンの起動で例外が発生しました:', error);
    }

    // 3. UIには新エンジンの結果を渡す
    return adaptedNewResult;
  },

  _compareAndLogDifferences: function(inputData, adapted, legacy) {
    // 簡易的なJSON文字列比較
    // ※完全な一致判定にはディープイコールが必要ですが、今回は概要の把握を目的とします。
    // 旧エンジンが返してくる不要な空配列などを除外してから比較する工夫が必要になる場合があります。
    const stringify = (obj) => JSON.stringify(obj, (key, value) => {
      // 比較ノイズになる部分（例: 順序が不定なもの）はここでソートするか省く
      return value;
    });

    const adaptedJson = stringify(adapted);
    const legacyJson = stringify(legacy);

    if (legacyJson !== adaptedJson) {
      console.groupCollapsed('%c[Shadow Run] 状態の不一致を検知しました（新エンジン稼働中）', 'color: #ff9800; font-weight: bold');
      console.log('入力データ (reservations):', inputData);
      console.log('新エンジン(正):', adapted);
      console.log('旧エンジン(誤):', legacy);
      console.groupEnd();
    } else {
      console.log('%c[Shadow Run] 新・旧エンジンの結果が一致しました', 'color: #4CAF50');
    }
  }
};
