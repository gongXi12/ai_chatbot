import { extractAgeDeclaration } from '../domain/safety/analyzeSafety.js';
import { parseNicknameInstruction } from '../domain/nicknames.js';
import type { RelationshipState } from '../domain/types.js';
import {
  createInitialRelationshipState,
  type RelationshipRepository,
} from '../repositories/RelationshipRepository.js';

const AUTO_AFFECTION_NICKNAMES = ['宝贝', '宝宝', '亲爱的', '乖乖', '小可爱'];
const AUTO_AFFECTION_SCORE = 0.5;

interface RelationshipServiceOptions {
  autoAffection?: boolean;
}

export class RelationshipService {
  constructor(
    private readonly repository: RelationshipRepository,
    private readonly options: RelationshipServiceOptions = {},
  ) {}

  async get(userId: string): Promise<RelationshipState> {
    const state = (await this.repository.get(userId)) ?? createInitialRelationshipState(userId);
    if (!this.options.autoAffection || state.ageGroup === 'minor') return state;
    return {
      ...state,
      ageGroup: 'adult',
      familiarity: Math.max(state.familiarity, AUTO_AFFECTION_SCORE),
      trust: Math.max(state.trust, AUTO_AFFECTION_SCORE),
      affection: Math.max(state.affection, AUTO_AFFECTION_SCORE),
      intimacyConsent: true,
      preferredNicknames: state.preferredNicknames?.length
        ? state.preferredNicknames
        : AUTO_AFFECTION_NICKNAMES,
    };
  }

  async observeMessage(
    userId: string,
    messageId: string,
    text: string,
    now: Date,
  ): Promise<RelationshipState> {
    const dependencyDelta = /(只有你|离不开你|谁都不需要)/u.test(text) ? 0.08 : 0;
    const nicknameInstruction = parseNicknameInstruction(text);
    const current = await this.get(userId);
    const age = extractAgeDeclaration(text);
    const stickyMinor = current.ageGroup === 'minor';
    const adultForConsent = !stickyMinor
      && (current.ageGroup === 'adult' || age?.ageGroup === 'adult');

    const existing = current.preferredNicknames ?? [];
    let preferredNicknames = existing;
    let nicknamesChanged = false;
    let intimacyConsent: boolean | undefined;

    if (nicknameInstruction.add.length > 0 && adultForConsent) {
      preferredNicknames = [...new Set([...existing, ...nicknameInstruction.add])];
      nicknamesChanged = preferredNicknames.length !== existing.length;
      intimacyConsent = true;
    }
    if (nicknameInstruction.remove.length > 0) {
      preferredNicknames = preferredNicknames.filter(
        (nickname) => !nicknameInstruction.remove.includes(nickname),
      );
      nicknamesChanged = true;
      intimacyConsent = preferredNicknames.length > 0;
    }

    return this.repository.observe(userId, {
      messageId,
      dependencyDelta,
      ...(intimacyConsent !== undefined ? { intimacyConsent } : {}),
      ...(nicknamesChanged
        ? { preferredNicknames: preferredNicknames.length > 0 ? preferredNicknames : null }
        : {}),
      ...(!stickyMinor && age
        ? { ageGroup: age.ageGroup, declaredAge: age.declaredAge ?? null }
        : {}),
      observedAt: now,
    });
  }

  async delete(userId: string): Promise<void> {
    await this.repository.delete(userId);
  }
}
