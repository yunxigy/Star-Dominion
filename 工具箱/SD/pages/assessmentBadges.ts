export type AssessmentBadge = { label: string; tone: 'fun' | 'personality' | 'orientation' | 'general' };

export function getAssessmentBadges(
  group: string | undefined,
  questionCount?: number,
  estimatedMinutes?: number,
  quickQuestionCount?: number,
  quickEstimatedMinutes?: number,
  assessmentKind: 'questionnaire' | 'challenge' = 'questionnaire',
): AssessmentBadge[] {
  const tone = group === 'fun' || group === 'personality' || group === 'orientation' ? group : 'general';
  const label = group === 'fun' ? '趣味测评' : group === 'personality' ? '人格测评' : group === 'orientation' ? '关系探索' : '综合测评';
  const badges: AssessmentBadge[] = [{ label, tone }];
  if (assessmentKind === 'challenge') badges.push({ label: '互动挑战', tone: 'general' });
  if (quickQuestionCount && questionCount) {
    badges.push({ label: `简易 ${quickQuestionCount} 题${quickEstimatedMinutes ? ` · 约 ${quickEstimatedMinutes} 分钟` : ''}`, tone: 'general' });
    badges.push({ label: `完整 ${questionCount} 题${estimatedMinutes ? ` · 约 ${estimatedMinutes} 分钟` : ''}`, tone: 'general' });
  } else if (questionCount) {
    badges.push({ label: `${questionCount} 题`, tone: 'general' });
  }
  if (!quickQuestionCount && estimatedMinutes) badges.push({ label: `约 ${estimatedMinutes} 分钟`, tone: 'general' });
  return badges;
}
