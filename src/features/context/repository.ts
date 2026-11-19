import { create } from 'zustand'
import { abortTransaction, getDB } from '../../services/chat/db.js'
import type { SessionContext, SpeechUsage, UsageRecord } from './types.js'

export const useContextData = create<{
  contexts: Map<string, SessionContext>
  usage: UsageRecord[]
}>(() => ({
  contexts: new Map(),
  usage: [],
}))

let revision = 0
export const refreshContextData = async () => {
  const n = ++revision
  const tx = (await getDB()).transaction(['sessionContexts', 'usageRecords'])
  const [contexts, usage] = await Promise.all([
    tx.objectStore('sessionContexts').getAll(),
    tx.objectStore('usageRecords').getAll(),
    tx.done,
  ])
  if (n === revision) {
    useContextData.setState({
      contexts: new Map(contexts.map((item) => [item.sessionId, item])),
      usage,
    })
  }
}

export const readSessionContext = async (sessionId: string) =>
  (await getDB()).get('sessionContexts', sessionId)

export const saveSessionContext = async (context: SessionContext) => {
  const tx = (await getDB()).transaction(['sessions', 'sessionContexts'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const store = tx.objectStore('sessionContexts')
        const saved = await store.get(context.sessionId)
        if (
          !(await tx.objectStore('sessions').getKey(context.sessionId)) ||
          (saved?.revision ?? 0) !== context.revision
        ) {
          throw new Error('Context changed or conversation was removed')
        }
        await store.put({ ...context, revision: context.revision + 1 })
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  await refreshContextData()
}

export const recordUsage = async (usage: UsageRecord) => {
  const tx = (await getDB()).transaction('usageRecords', 'readwrite')
  const prior = await tx.store.get(usage.id)
  if (!prior) {
    await tx.store.add(usage)
  }
  await tx.done
  await refreshContextData()
}

export const speakCharacters = (text: string) =>
  Array.from(text).reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0)

export const recordSpeech = (id: string, time: number, text: string) =>
  recordUsage({
    id: `tts:${id}`,
    time,
    kind: 'tts',
    characters: speakCharacters(text),
  } satisfies SpeechUsage)
