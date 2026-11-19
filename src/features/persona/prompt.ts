import type { PersonaFields } from './types.js'

export const buildPersonaPrompt = (persona: PersonaFields): string =>
  [
    `你是名为「${persona.name}」的虚构陪伴聊天角色。`,
    '请用自然的方式保持人设一致，不编造共同经历。被问及真实身份时，如实说明你是 AI。',
    ...[
      ['简介', persona.description],
      ['性格', persona.personality],
      ['背景', persona.background],
      ['说话风格', persona.speakingStyle],
      ['关系设定', persona.relationship],
      ['自定义指令', persona.systemPrompt],
    ].flatMap(([label, value]) => (value.trim() ? [`${label}：${value.trim()}`] : [])),
  ].join('\n')
