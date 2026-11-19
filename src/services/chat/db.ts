import type { SessionContext, UsageRecord } from '../../features/context/types.js'
import { createId } from '../../utils/id.js'
import type { Interaction, PersonaLink, StoredPersona } from '../../features/persona/types.js'
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 13

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中增量合并并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
  personas: { key: string; value: StoredPersona }
  personaLinks: { key: string; value: PersonaLink; indexes: { personaId: string } }
  sessionContexts: { key: string; value: SessionContext }
  usageRecords: { key: string; value: UsageRecord }
  interactions: { key: string; value: Interaction; indexes: { personaId: string } }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

export const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

export const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
export const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    blocking(_currentVersion, _newVersion, event) {
      ;(event.target as IDBDatabase).close()
      dbPromise = null
    },
    terminated() {
      dbPromise = null
    },
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      if (!db.objectStoreNames.contains('sessionContexts')) {
        db.createObjectStore('sessionContexts', { keyPath: 'sessionId' })
        db.createObjectStore('usageRecords', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('personas')) {
        db.createObjectStore('personas', { keyPath: 'id' })
        db.createObjectStore('personaLinks', { keyPath: 'sessionId' }).createIndex(
          'personaId',
          'personaId'
        )
        db.createObjectStore('interactions', { keyPath: 'replyId' }).createIndex(
          'personaId',
          'personaId'
        )
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await (await getDB()).getAll('sessionSummaries')).map(toSessionSummary)

export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await getDB()).get('sessions', id)

export const saveSession = async (
  session: Session,
  files: StoredFile[] = [],
  interactions: Interaction[] = []
): Promise<void> => {
  const summary = storedSummary(session)
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'personas', 'interactions'],
    'readwrite'
  )
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(session)
        await tx.objectStore('sessionSummaries').put(summary)
        const events = tx.objectStore('interactions')
        const personas = tx.objectStore('personas')
        for (const interaction of interactions) {
          if (
            (await personas.getKey(interaction.personaId)) &&
            !(await events.getKey(interaction.replyId))
          ) {
            await events.add(interaction)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.title = title
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'personaLinks', 'sessionContexts'],
    'readwrite'
  )
  await Promise.all([
    (async () => {
      try {
        await tx.objectStore('personaLinks').delete(sessionId)
        await tx.objectStore('sessionContexts').delete(sessionId)
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

export const deleteAllHistory = async (): Promise<SessionSummary[]> => {
  const stores = [
    'sessions',
    'sessionSummaries',
    'files',
    'personaLinks',
    'sessionContexts',
  ] as const
  const tx = (await getDB()).transaction(stores, 'readwrite')
  await Promise.all([...stores.map((name) => tx.objectStore(name).clear()), tx.done])
  return []
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}

export const previewStagingMerge = async (knownIds: string[] = []) => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'sessions'])
  const [staged, existing] = await Promise.all([
    tx.objectStore('sessionsStaging').getAllKeys(),
    tx.objectStore('sessions').getAllKeys(),
    tx.done,
  ])
  const present = new Set([...existing, ...knownIds])
  const added = staged.filter((id) => !present.has(id)).length
  return { added, skipped: staged.length - added }
}

export const commitStagingMerge = async (personaId: string | null, knownIds: string[] = []) => {
  const known = new Set(knownIds)
  const tx = (await getDB()).transaction(
    [
      'sessions',
      'sessionSummaries',
      'files',
      'sessionsStaging',
      'filesStaging',
      'personas',
      'personaLinks',
    ],
    'readwrite'
  )
  const [result] = await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const staging = tx.objectStore('sessionsStaging')
        const summaries = tx.objectStore('sessionSummaries')
        const files = tx.objectStore('files')
        const stagedFiles = tx.objectStore('filesStaging')
        const links = tx.objectStore('personaLinks')
        if (personaId && !(await tx.objectStore('personas').get(personaId))) {
          throw new Error('Persona no longer exists')
        }
        const added: SessionSummary[] = []
        const assigned = new Map<string, string>()
        let skipped = 0
        for (let cursor = await staging.openCursor(); cursor; cursor = await cursor.continue()) {
          const session = cursor.value
          if (known.has(session.id) || (await sessions.getKey(session.id))) {
            skipped += 1
            continue
          }
          for (const message of session.messages) {
            if (message.role !== 'user') {
              continue
            }
            for (const file of message.files) {
              const sourceId = file.id
              let id = assigned.get(sourceId)
              if (id === undefined) {
                id = sourceId
                while ((await files.getKey(id)) || (await summaries.index('fileIds').count(id))) {
                  id = createId()
                }
                assigned.set(sourceId, id)
                const original = await stagedFiles.get(sourceId)
                if (original) {
                  await files.add({ id, blob: original.blob })
                }
              }
              file.id = id
            }
          }
          const summary = storedSummary(session)
          await sessions.add(session)
          await summaries.add(summary)
          if (personaId) {
            await links.add({ sessionId: session.id, personaId })
          }
          added.push(toSessionSummary(summary))
        }
        await staging.clear()
        await stagedFiles.clear()
        return { added, skipped }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  return result
}
