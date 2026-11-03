export const AFFECTIONATE_NICKNAMES = [
  '小宝贝',
  '小心肝',
  '小傻瓜',
  '小懒猪',
  '小可爱',
  '小公主',
  '小仙女',
  '小祖宗',
  '小笨蛋',
  '傻丫头',
  '小朋友',
  '亲爱的',
  '甜心',
  '乖乖',
  '小乖',
  '老婆',
  '媳妇',
  '笨蛋',
  '傻瓜',
  '小猪',
  '猪猪',
  '丫头',
  '心肝',
  '宝贝',
  '宝宝',
  '小宝',
  '贝贝',
  '亲亲',
  '达令',
  '哈尼',
] as const;

const ordered = [...AFFECTIONATE_NICKNAMES].sort((left, right) => right.length - left.length);
const nicknamePattern = new RegExp(ordered.join('|'), 'gu');

export function findAffectionateNicknames(text: string): string[] {
  return [...new Set(text.match(nicknamePattern) ?? [])];
}

export interface NicknameInstruction {
  add: string[];
  remove: string[];
}

export function parseNicknameInstruction(text: string): NicknameInstruction {
  const add = new Set<string>();
  const remove = new Set<string>();

  for (const clause of text.split(/[。！？!?；;，,\n]/u)) {
    if (/(?:别|不要|不准|不许)叫我/u.test(clause)) {
      findAffectionateNicknames(clause).forEach((nickname) => remove.add(nickname));
    } else if (/叫我/u.test(clause)) {
      findAffectionateNicknames(clause).forEach((nickname) => add.add(nickname));
    }
  }

  return { add: [...add], remove: [...remove] };
}
