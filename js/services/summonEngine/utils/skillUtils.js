export function hasSkill(staff, requiredSkillId, requiredProficiency = 1) {
  if (!requiredSkillId || requiredSkillId === 'none') {
    return true; // スキル指定なしなら誰でもOK
  }
  
  if (!staff) {
    return false;
  }

  // スタイリストはすべての技術を担当できるものとする
  if (staff.type === 'stylist') {
    return true;
  }

  if (!staff.skills) {
    return false; // スキルを持たないスタッフ
  }
  
  // スタッフの持つスキル一覧から対象のスキルを探す
  const skill = staff.skills.find(s => s.id === requiredSkillId);
  if (!skill) {
    return false; // 該当スキルを持っていない
  }
  
  // 要求レベル以上であるか判定
  return skill.proficiency >= requiredProficiency;
}

/**
 * スタッフの持つスキルの総合レベルを算出する（贅沢判定用）
 */
export function getTotalSkillLevel(staff) {
  if (!staff || !staff.skills) return 0;
  return staff.skills.reduce((sum, skill) => sum + (skill.proficiency || 0), 0);
}
