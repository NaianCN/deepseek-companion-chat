import { abortTransaction, getDB, storedSummary } from '../../services/chat/db.js'
import type { Session } from '../../services/chat/types.js'
import { createId } from '../../utils/id.js'
import type { Persona, PersonaDraft, StoredPersona } from './types.js'

export const avatarTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const maxAvatarBytes = 2 * 1024 * 1024

export const isAvatar = (avatar: Blob) =>
  avatar instanceof Blob &&
  avatarTypes.includes(avatar.type) &&
  avatar.size > 0 &&
  avatar.size <= maxAvatarBytes

// Store bytes inline because some WebKit installations cannot persist Blob or File objects.
export const toStoredPersona = async <T extends PersonaDraft>({ avatar, ...fields }: T) => ({
  ...fields,
  avatar: avatar ? { bytes: await avatar.arrayBuffer(), type: avatar.type } : undefined,
})

export const fromStoredPersona = ({ avatar, ...fields }: StoredPersona): Persona => {
  if (avatar instanceof Blob) {
    return { ...fields, avatar }
  }
  return avatar?.bytes instanceof ArrayBuffer
    ? { ...fields, avatar: new Blob([avatar.bytes], { type: avatar.type }) }
    : fields
}

export const loadPersonas = async () => {
  const tx = (await getDB()).transaction(['personas', 'personaLinks', 'interactions'])
  const [personas, links, interactions] = await Promise.all([
    tx.objectStore('personas').getAll(),
    tx.objectStore('personaLinks').getAll(),
    tx.objectStore('interactions').getAll(),
    tx.done,
  ])
  return { personas: personas.map(fromStoredPersona), links, interactions }
}

export const savePersona = async (draft: PersonaDraft, id?: string): Promise<Persona> => {
  const name = draft.name.trim()
  if (!name || (draft.avatar && !isAvatar(draft.avatar))) {
    throw new Error('Invalid persona')
  }
  const storedDraft = await toStoredPersona(draft)
  const tx = (await getDB()).transaction('personas', 'readwrite')
  const now = Date.now()
  const previous = id ? await tx.store.get(id) : undefined
  if (id && !previous) {
    throw new Error('Persona no longer exists')
  }
  const persona = {
    ...storedDraft,
    name,
    ...(previous?.memories && { memories: previous.memories }),
    id: previous?.id ?? createId(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    timeZone: previous?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  }
  await Promise.all([tx.store.put(persona), tx.done])
  return fromStoredPersona(persona)
}

export const savePersonaMemories = async (
  id: string,
  base: readonly string[],
  entries: readonly string[]
) => {
  const tx = (await getDB()).transaction('personas', 'readwrite')
  const persona = await tx.store.get(id)
  const saved = persona?.memories ?? []
  if (
    !persona ||
    saved.length !== base.length ||
    saved.some((value, index) => value !== base[index])
  ) {
    throw new Error('Persona memories changed during editing')
  }
  const memories = [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))]
  await Promise.all([tx.store.put({ ...persona, memories, updatedAt: Date.now() }), tx.done])
}

export const promoteSessionMemory = async (sessionId: string, personaId: string, text: string) => {
  const memory = text.trim()
  if (!memory) {
    return
  }
  const tx = (await getDB()).transaction(['personas', 'personaLinks'], 'readwrite')
  const store = tx.objectStore('personas')
  const [persona, link] = await Promise.all([
    store.get(personaId),
    tx.objectStore('personaLinks').get(sessionId),
  ])
  if (!persona || link?.personaId !== personaId) {
    throw new Error('Chat persona changed')
  }
  const memories = persona.memories ?? []
  await Promise.all([
    !memories.includes(memory) &&
      store.put({ ...persona, memories: [...memories, memory], updatedAt: Date.now() }),
    tx.done,
  ])
}

export const deletePersona = async (id: string) => {
  const tx = (await getDB()).transaction(['personas', 'personaLinks', 'interactions'], 'readwrite')
  await Promise.all([
    tx.objectStore('personas').delete(id),
    ...(['personaLinks', 'interactions'] as const).map(async (name) => {
      const store = tx.objectStore(name)
      const keys = await store.index('personaId').getAllKeys(id)
      await Promise.all(keys.map((key) => store.delete(key)))
    }),
    tx.done,
  ])
}

export const personaForSession = async (sessionId: string) => {
  const tx = (await getDB()).transaction(['personas', 'personaLinks'])
  const link = await tx.objectStore('personaLinks').get(sessionId)
  const persona = link && (await tx.objectStore('personas').get(link.personaId))
  return persona && fromStoredPersona(persona)
}

export const bindPersona = async (
  sessionId: string,
  personaId: string | null,
  newSession?: Session
) => {
  const tx = (await getDB()).transaction(
    ['personas', 'personaLinks', 'sessions', 'sessionSummaries'],
    'readwrite'
  )
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const links = tx.objectStore('personaLinks')
        const existing = await sessions.get(sessionId)
        if (
          (!existing && !newSession) ||
          (personaId && !(await tx.objectStore('personas').get(personaId)))
        ) {
          throw new Error('Session or persona no longer exists')
        }
        if (newSession) {
          await sessions.add(newSession)
          await tx.objectStore('sessionSummaries').add(storedSummary(newSession))
        }
        if (personaId) {
          await links.put({ sessionId, personaId })
        } else {
          await links.delete(sessionId)
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}
