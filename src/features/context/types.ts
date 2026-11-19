import type { ChatModel, MessageUsage } from '../../services/api/types.js'

export type SummaryVersion = {
  id: string
  sourceIds: string[]
  text: string
  createdAt: number
}

export type SessionContext = {
  sessionId: string
  memories: string[]
  summaries: SummaryVersion[]
  activeSummaryId?: string
  revision: number
}

export type ChatUsage = {
  id: string
  time: number
  sessionId: string
  replyId?: string
  kind: 'chat' | 'summary' | 'memory'
  model: ChatModel
  usage: MessageUsage
}

export type SpeechUsage = {
  id: string
  time: number
  kind: 'tts'
  characters: number
}

export type UsageRecord = ChatUsage | SpeechUsage

export const emptyContext = (sessionId: string): SessionContext => ({
  sessionId,
  memories: [],
  summaries: [],
  revision: 0,
})
