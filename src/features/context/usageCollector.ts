import type { ChatModel, MessageStreamEvent, MessageUsage } from '../../services/api/types.js'
import { createId } from '../../utils/id.js'
import { recordUsage } from './repository.js'
import type { ChatUsage } from './types.js'

export const trackRequest = (
  sessionId: string,
  model: ChatModel,
  kind: ChatUsage['kind'],
  replyId?: string
) => {
  let requestId = `local:${createId()}`
  let usage: MessageUsage | undefined
  const time = Date.now()
  return {
    consume(event: MessageStreamEvent) {
      if (
        event.type === 'message_start' &&
        typeof event.message.id === 'string' &&
        event.message.id
      ) {
        requestId = event.message.id
      } else if (event.type === 'message_delta' && event.usage) {
        usage = event.usage
      }
    },
    async finish() {
      if (usage) {
        await recordUsage({ id: requestId, sessionId, replyId, time, kind, model, usage })
      }
    },
  }
}
