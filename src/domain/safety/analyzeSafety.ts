import type { RelationshipState, SafetyAssessment } from '../types.js';

const selfHarmPatterns = [
  /自杀/u,
  /结束自己的生命/u,
  /不想活了/u,
  /结束这一切/u,
  /伤害自己/u,
];

const dependencyPatterns = [
  /只有你.{0,8}(懂|理解|需要|陪)/u,
  /谁都不需要/u,
  /不需要其他人/u,
  /离不开你/u,
];

export interface AgeDeclaration {
  ageGroup: RelationshipState['ageGroup'];
  declaredAge?: number;
}

export function extractAgeDeclaration(text: string): AgeDeclaration | undefined {
  const numeric = text.match(/(?:我(?:今年)?|年龄(?:是)?|今年)\s*(\d{1,2})\s*岁/u);
  if (numeric?.[1]) {
    const declaredAge = Number(numeric[1]);
    if (declaredAge > 0 && declaredAge <= 120) {
      return { ageGroup: declaredAge < 18 ? 'minor' : 'adult', declaredAge };
    }
  }
  if (/(?:我)?(?:已经|已)?(?:满)?18岁(?:以上)?|我是成年人|我(?:已经|已)?成年了/u.test(text)) {
    return { ageGroup: 'adult' };
  }
  if (/我是未成年人|我还没成年/u.test(text)) {
    return { ageGroup: 'minor' };
  }
  return undefined;
}

export function analyzeSafety(
  text: string,
  knownAgeGroup: RelationshipState['ageGroup'] = 'unknown',
): SafetyAssessment {
  if (selfHarmPatterns.some((pattern) => pattern.test(text))) {
    return { level: 'crisis', categories: ['self_harm'] };
  }

  if (knownAgeGroup === 'minor') {
    return { level: 'blocked', categories: ['minor_romance'] };
  }

  const ageGroup = extractAgeDeclaration(text)?.ageGroup ?? knownAgeGroup;
  if (ageGroup === 'minor') {
    return { level: 'blocked', categories: ['minor_romance'] };
  }

  if (dependencyPatterns.some((pattern) => pattern.test(text))) {
    return { level: 'caution', categories: ['dependency'] };
  }

  return { level: 'safe', categories: [] };
}