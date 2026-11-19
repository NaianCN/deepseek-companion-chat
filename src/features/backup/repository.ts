import type { SessionContext, UsageRecord } from '../context/types.js'
import { abortTransaction, getDB, storedSummary, type StoredFile } from '../../services/chat/db.js'
import { toSessionSummary, type Session } from '../../services/chat/types.js'
import { fromStoredPersona, toStoredPersona } from '../persona/repository.js'
import type { Interaction, Persona, PersonaLink } from '../persona/types.js'

export type CompanionData = {
  sessions: Session[]
  personas: Persona[]
  links: PersonaLink[]
  interactions: Interaction[]
  files: StoredFile[]
  contexts: SessionContext[]
  usage: UsageRecord[]
}

const stores = [
  'sessions',
  'sessionSummaries',
  'personas',
  'personaLinks',
  'interactions',
  'files',
  'sessionContexts',
  'usageRecords',
] as const

export const readCompanionData = async (): Promise<CompanionData> => {
  const tx = (await getDB()).transaction(stores)
  const [sessions, personas, links, interactions, files, contexts, usage] = await Promise.all([
    tx.objectStore('sessions').getAll(),
    tx.objectStore('personas').getAll(),
    tx.objectStore('personaLinks').getAll(),
    tx.objectStore('interactions').getAll(),
    tx.objectStore('files').getAll(),
    tx.objectStore('sessionContexts').getAll(),
    tx.objectStore('usageRecords').getAll(),
    tx.done,
  ])
  return {
    sessions,
    personas: personas.map(fromStoredPersona),
    links,
    interactions,
    files,
    contexts,
    usage,
  }
}

export const replaceCompanionData = async (data: CompanionData) => {
  const summaries = data.sessions.map(storedSummary)
  const personas = await Promise.all(data.personas.map(toStoredPersona))
  const tx = (await getDB()).transaction(stores, 'readwrite')
  await Promise.all([
    (async () => {
      try {
        await Promise.all(stores.map((name) => tx.objectStore(name).clear()))
        for (const session of data.sessions) {
          await tx.objectStore('sessions').add(session)
        }
        for (const summary of summaries) {
          await tx.objectStore('sessionSummaries').add(summary)
        }
        for (const persona of personas) {
          await tx.objectStore('personas').add(persona)
        }
        for (const link of data.links) {
          await tx.objectStore('personaLinks').add(link)
        }
        for (const event of data.interactions) {
          await tx.objectStore('interactions').add(event)
        }
        for (const item of data.contexts) {
          await tx.objectStore('sessionContexts').add(item)
        }
        for (const item of data.usage) {
          await tx.objectStore('usageRecords').add(item)
        }
        for (const file of data.files) {
          await tx.objectStore('files').add(file)
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  return summaries.map(toSessionSummary)
}
