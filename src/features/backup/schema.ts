import type { SessionContext, SummaryVersion, UsageRecord } from '../context/types.js'
import { isTranslationKey } from '../../i18n/index.js'
import { readMessageEvent } from '../../services/api/parseEvent.js'
import { normalizeSession } from '../../services/chat/branches.js'
import type { AssistantMessage, Message, ReplyBlock, Session } from '../../services/chat/types.js'
import {
  personaFields,
  type Interaction,
  type Persona,
  type PersonaLink,
} from '../persona/types.js'
import type { CompanionData } from './repository.js'

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const id = (v: unknown): v is string => str(v) && v.length > 0
const timestamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= 8.64e15
const list = <T>(values: unknown, valid: (v: unknown) => v is T): values is T[] =>
  Array.isArray(values) && values.every(valid)
const optional = (v: unknown, valid: (v: unknown) => boolean) => v === undefined || valid(v)
const bool = (v: unknown) => typeof v === 'boolean'

type BlobReference = { id: string; mimeType: string }
export type BackupMetadata = Omit<CompanionData, 'files' | 'personas'> & {
  format: 'deepseek-companion'
  version: 1 | 2
  personas: (Omit<Persona, 'avatar'> & { avatarType?: string })[]
  files: BlobReference[]
}

const zone = (v: unknown) => {
  if (!id(v)) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: v })
    return true
  } catch {
    return false
  }
}

const persona = (v: unknown): v is BackupMetadata['personas'][number] =>
  record(v) &&
  id(v.id) &&
  id(v.name) &&
  personaFields.every((field) => str(v[field])) &&
  (v.memories === undefined || list(v.memories, str)) &&
  timestamp(v.createdAt) &&
  timestamp(v.updatedAt) &&
  zone(v.timeZone) &&
  optional(v.avatarType, str)

const link = (v: unknown): v is PersonaLink => record(v) && id(v.personaId) && id(v.sessionId)

const interaction = (v: unknown): v is Interaction =>
  record(v) && id(v.replyId) && timestamp(v.completedAt) && link(v)

const file = (v: unknown): v is BlobReference => record(v) && id(v.id) && str(v.mimeType)

const attachment = (v: unknown) =>
  record(v) &&
  str(v.name) &&
  timestamp(v.size) &&
  v.size >= 0 &&
  bool(v.isImage) &&
  (v.serverId === null || str(v.serverId)) &&
  file(v)

const assistantError = (v: unknown): v is AssistantMessage['error'] =>
  record(v) &&
  str(v.kind) &&
  str(v.message) &&
  optional(v.status, timestamp) &&
  optional(v.retryable, bool) &&
  optional(
    v.localMessage,
    (message) =>
      record(message) &&
      isTranslationKey(message.key) &&
      optional(
        message.params,
        (params) =>
          record(params) &&
          Object.values(params).every((value) => str(value) || typeof value === 'number')
      )
  )

const message = (v: unknown): v is Message => {
  if (
    !record(v) ||
    !id(v.id) ||
    !timestamp(v.createdAt) ||
    !optional(v.parentId, (parent) => parent === null || id(parent)) ||
    !optional(v.selectedChildId, id)
  ) {
    return false
  }

  if (v.role === 'user') {
    return str(v.content) && Array.isArray(v.files) && v.files.every(attachment)
  }
  return (
    v.role === 'assistant' &&
    (v.model === null || str(v.model)) &&
    ['pending', 'streaming', 'done', 'stopped', 'error'].includes(v.status as string) &&
    optional(v.stopReason, (reason) =>
      ['end_turn', 'max_tokens', 'tool_use', 'refusal'].includes(reason as string)
    ) &&
    optional(
      v.stopDetails,
      (details) =>
        record(details) &&
        details.type === 'refusal' &&
        details.category === null &&
        details.explanation === null
    ) &&
    bool(v.prefix) &&
    optional(v.thinking, bool) &&
    optional(v.search, bool) &&
    optional(v.latestReminder, str) &&
    optional(v.error, assistantError) &&
    Array.isArray(v.blocks)
  )
}

const readReplyBlock = (v: unknown): ReplyBlock => {
  const event = readMessageEvent({ type: 'content_block_start', index: 0, content_block: v })
  if (!event || event.type !== 'content_block_start' || event.content_block.type === 'tool_use') {
    throw new Error('Invalid reply block in companion backup')
  }
  const block = event.content_block
  if (block.type === 'text') {
    return {
      type: 'text',
      text: block.text,
      ...(block.citations ? { citations: block.citations } : {}),
      ...(record(v) && typeof v.isTemplate === 'boolean' ? { isTemplate: v.isTemplate } : {}),
    }
  }
  if (block.type === 'thinking') {
    return {
      type: 'thinking',
      thinking: block.thinking,
      ...(block.signature !== undefined ? { signature: block.signature } : {}),
      ...(record(v) && timestamp(v.startedAt) ? { startedAt: v.startedAt } : {}),
      ...(record(v) && timestamp(v.endedAt) ? { endedAt: v.endedAt } : {}),
      ...(record(v) && typeof v.elapsedSeconds === 'number' && Number.isFinite(v.elapsedSeconds)
        ? { elapsedSeconds: v.elapsedSeconds }
        : {}),
    }
  }
  return block
}

const session = (v: unknown): v is Session =>
  record(v) &&
  id(v.id) &&
  str(v.title) &&
  timestamp(v.createdAt) &&
  timestamp(v.updatedAt) &&
  optional(v.rootMessageId, (root) => root === null || id(root)) &&
  list(v.messages, message)

const assertValidTree = (value: Session) => {
  const { messages, rootMessageId } = normalizeSession(value)
  const seen = new Map<string, Message>()
  for (const message of messages) {
    const parent = message.parentId ? seen.get(message.parentId) : undefined
    if (
      seen.has(message.id) ||
      (message.parentId === null
        ? message.role !== 'user'
        : !parent || parent.role === message.role)
    ) {
      throw new Error('Invalid message tree in companion backup')
    }
    seen.set(message.id, message)
  }
  if (
    messages.length
      ? !rootMessageId || seen.get(rootMessageId)?.parentId !== null
      : rootMessageId !== null
  ) {
    throw new Error('Invalid conversation root in companion backup')
  }
  for (const message of messages) {
    if (message.selectedChildId && seen.get(message.selectedChildId)?.parentId !== message.id) {
      throw new Error('Invalid selected branch in companion backup')
    }
    if (message.role === 'assistant') {
      message.blocks = message.blocks.map(readReplyBlock)
      if (message.usage !== undefined) {
        const parsed = readMessageEvent({
          type: 'message_start',
          message: { usage: message.usage },
        })
        if (parsed?.type !== 'message_start' || !parsed.message.usage) {
          throw new Error('Invalid message usage in companion backup')
        }
      }
    }
  }
}

const unique = (values: string[]) => {
  const keys = new Set(values)
  if (keys.size !== values.length) {
    throw new Error('Duplicate record in companion backup')
  }
  return keys
}

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const summaryVersion = (v: unknown): v is SummaryVersion =>
  record(v) &&
  id(v.id) &&
  id(v.text) &&
  timestamp(v.createdAt) &&
  list(v.sourceIds, id) &&
  v.sourceIds.length > 0 &&
  v.sourceIds.length % 2 === 0

const context = (v: unknown): v is SessionContext =>
  record(v) &&
  id(v.sessionId) &&
  count(v.revision) &&
  list(v.memories, id) &&
  list(v.summaries, summaryVersion) &&
  optional(v.activeSummaryId, id)

const usageRecord = (v: unknown): v is UsageRecord => {
  if (!record(v) || !id(v.id) || !timestamp(v.time)) {
    return false
  }
  if (v.kind === 'tts') {
    return count(v.characters)
  }
  return (
    (v.kind === 'chat' || v.kind === 'summary' || v.kind === 'memory') &&
    id(v.sessionId) &&
    optional(v.replyId, id) &&
    (v.model === 'deepseek-flash' || v.model === 'deepseek-v4-pro') &&
    record(v.usage) &&
    [
      'input_tokens',
      'output_tokens',
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
    ].every((key) => count((v.usage as Record<string, unknown>)[key]))
  )
}

export const readMetadata = (v: unknown): BackupMetadata => {
  if (
    !record(v) ||
    v.format !== 'deepseek-companion' ||
    (v.version !== 1 && v.version !== 2) ||
    !list(v.sessions, session) ||
    !list(v.personas, persona) ||
    !list(v.links, link) ||
    !list(v.interactions, interaction) ||
    !list(v.files, file)
  ) {
    throw new Error('Invalid or unsupported companion backup')
  }
  const contexts: unknown = v.version === 1 ? [] : v.contexts
  const usage: unknown = v.version === 1 ? [] : v.usage
  if (!list(contexts, context) || !list(usage, usageRecord)) {
    throw new Error('Invalid context or usage in companion backup')
  }
  unique(contexts.map((item) => item.sessionId))
  unique(usage.map((item) => item.id))
  const sessions = unique(v.sessions.map((item) => item.id))
  const bySession = new Map(v.sessions.map((item) => [item.id, item]))
  for (const item of contexts) {
    const chat = bySession.get(item.sessionId)
    const ids = unique(item.summaries.map((version) => version.id))
    if (!chat || (item.activeSummaryId && !ids.has(item.activeSummaryId))) {
      throw new Error('Missing summary or conversation in companion backup')
    }
    const messageIds = new Set(chat.messages.map(({ id }) => id))
    if (item.summaries.some((version) => version.sourceIds.some((id) => !messageIds.has(id)))) {
      throw new Error('Missing summary source in companion backup')
    }
  }
  const personas = unique(v.personas.map((item) => item.id))
  unique(v.links.map((item) => item.sessionId))
  unique(v.interactions.map((item) => item.replyId))
  unique(v.files.map((item) => item.id))
  if (
    v.links.some((item) => !sessions.has(item.sessionId) || !personas.has(item.personaId)) ||
    v.interactions.some((item) => !personas.has(item.personaId))
  ) {
    throw new Error('Missing referenced record in companion backup')
  }
  v.sessions.forEach(assertValidTree)
  return {
    format: v.format,
    version: v.version,
    sessions: v.sessions,
    personas: v.personas,
    links: v.links,
    interactions: v.interactions,
    contexts,
    usage,
    files: v.files,
  }
}
