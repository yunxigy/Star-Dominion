export type AssessmentBadge = { label: string; tone: 'fun' | 'personality' | 'orientation' | 'general' };

export function getAssessmentBadges(group: string | undefined, questionCount?: number, estimatedMinutes?: number): AssessmentBadge[] {
  const tone = group === 'fun' || group === 'personality' || group === 'orientation' ? group : 'general';
  const label = group === 'fun' ? '趣味测评' : group === 'personality' ? '人格测评' : group === 'orientation' ? '关系探索' : '综合测评';
  const badges: AssessmentBadge[] = [{ label, tone }];
  if (questionCount) badges.push({ label: `${questionCount} 题`, tone: 'general' });
  if (estimatedMinutes) badges.push({ label: `约 ${estimatedMinutes} 分钟`, tone: 'general' });
  return badges;
}
