import type { CompanionModel, ConversationIntent, ModelContext } from './CompanionModel.js';

export function classifyIntent(text: string): ConversationIntent {
  if (/(怎么办|怎么做|给我建议|你觉得我该)/u.test(text)) return 'advise';
  if (/(开心|通过了|成功了|拿到offer|好消息)/iu.test(text)) return 'celebrate';
  if (/(烦死|气死|无语|吐槽|一堆活|受不了)/u.test(text)) return 'vent';
  if (/(难过|委屈|想哭|好累|有点累)/u.test(text)) return 'comfort';
  return 'casual';
}

function conciseSubject(text: string): string {
  if (text.includes('临下班')) return '临下班还突然塞一堆活，真的很败心情';
  if (text.includes('上班')) return '今天这班看来把你磨得够呛';
  if (text.includes('面试')) return '面试这件事确实会让人一直惦记';
  return '我在听';
}

export class DeterministicCompanionModel implements CompanionModel {
  async generate(context: ModelContext): Promise<string[]> {
    switch (context.intent) {
      case 'vent':
        return [conciseSubject(context.userText), '最烦的是哪一段？'];
      case 'comfort':
        return ['听着是真的有点撑不住了', '你想先安静待会儿，还是跟我说说？'];
      case 'celebrate':
        return ['诶，这个必须替你开心一下', '快跟我讲讲细节？'];
      case 'advise':
        return ['可以，我们先把最卡你的那一步拆开', '你现在最想先解决哪件事？'];
      case 'casual': {
        const remembered = context.memories[0];
        if (remembered) {
          return [`你这句话让我想到你之前提过的${remembered.topic}`, '是同一件事吗？'];
        }
        return ['嗯，我在', '然后呢？'];
      }
    }
  }
}
