import type { AssistantMessage, Message, UserMessage } from '../../services/chat/types.js'
import type { CreateMessageRequest } from '../../services/api/types.js'
import { getContextRounds, toRequestMessages } from '../../services/chat/reply.js'
import { buildPersonaPrompt } from '../persona/prompt.js'
import type { PersonaFields, Persona } from '../persona/types.js'
import type { SessionContext, SummaryVersion } from './types.js'

export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'
export const DEFAULT_CHAT_MODEL = 'deepseek-flash'

export const appliesToHistory = (summary: SummaryVersion, history: Message[]) => {
  const sourceIds = getContextRounds(history)
    .flat()
    .map(({ id }) => id)
  return (
    summary.sourceIds.length > 0 && summary.sourceIds.every((id, index) => sourceIds[index] === id)
  )
}

const summaryForHistory = (context: SessionContext | undefined, history: Message[]) => {
  const active = context?.summaries.find(({ id }) => id === context.activeSummaryId)
  return active && appliesToHistory(active, history) ? active : undefined
}

export const historyForRequest = (context: SessionContext | undefined, history: Message[]) => {
  const summary = summaryForHistory(context, history)
  return summary
    ? history.slice(history.findIndex(({ id }) => id === summary.sourceIds.at(-1)) + 1)
    : history
}

export const buildRequest = ({
  persona,
  context,
  history,
  question,
  prefix,
  model = DEFAULT_CHAT_MODEL,
  thinking = false,
  search = false,
  latestReminder,
  maxTokens,
  title,
}: {
  persona?: PersonaFields & Pick<Persona, 'memories'>
  context?: SessionContext
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
  model?: CreateMessageRequest['model']
  thinking?: boolean
  search?: boolean
  latestReminder?: string
  maxTokens: number
  title?: boolean
}): CreateMessageRequest => {
  const summary = summaryForHistory(context, history)
  const sections = [persona ? buildPersonaPrompt(persona) : DEFAULT_SYSTEM_PROMPT]
  const sharedMemories = new Set(persona?.memories)
  if (sharedMemories.size) {
    sections.push(
      `【经用户确认的角色总记忆】\n${[...sharedMemories].map((text) => `- ${text}`).join('\n')}`
    )
  }
  const sessionMemories = context?.memories.filter((text) => !sharedMemories.has(text))
  if (sessionMemories?.length) {
    sections.push(
      `【经用户确认的长期记忆 · 本会话】\n${sessionMemories.map((text) => `- ${text}`).join('\n')}`
    )
  }
  if (summary) {
    sections.push(`【较早对话摘要 · 仅作背景参考】\n${summary.text}`)
  }
  const tail = historyForRequest(context, history)
  return {
    model,
    max_tokens: maxTokens,
    system: sections.join('\n\n'),
    messages: toRequestMessages(tail, question, prefix, thinking, latestReminder),
    thinking: { type: thinking ? 'enabled' : 'disabled' },
    safety_check: { level: 'high' },
    tools: search
      ? [
          { type: 'deepseek_read_url', name: 'deepseek_read_url' },
          { type: 'deepseek_web_search', name: 'deepseek_web_search' },
        ]
      : [{ type: 'deepseek_read_url', name: 'deepseek_read_url' }],
    ...(title ? { title: { enabled: true } } : {}),
  }
}

export const olderMessages = (history: Message[], keepRounds: number) =>
  getContextRounds(history).slice(0, -keepRounds).flat()

export const messageText = (message: Message) =>
  message.role === 'user'
    ? [message.content, ...message.files.map(({ name }) => `[附件：${name}]`)]
        .filter(Boolean)
        .join('\n')
    : message.blocks
        .flatMap((block) => (block.type === 'text' && !block.isTemplate ? [block.text] : []))
        .join('\n')

export const draftQuestion = (content: string, files: UserMessage['files'] = []): UserMessage => ({
  id: '',
  role: 'user',
  createdAt: 0,
  content,
  files,
})
