import { enqueueBackup } from '../../services/chat/backup.js'
import { readArchive, readEntry } from '../../services/chat/history/zipReader.js'
import { writeArchive } from '../../services/chat/history/zipWriter.js'
import { replaceHistory } from '../../services/chat/store.js'
import { formatDate } from '../../utils/format.js'
import { isAvatar, maxAvatarBytes } from '../persona/repository.js'
import { readCompanionData, replaceCompanionData, type CompanionData } from './repository.js'
import { readMetadata, type BackupMetadata } from './schema.js'

const manifestPath = 'companion.json'
const maxMetadataBytes = 128 * 1024 * 1024

export const writeCompanionBackup = async (data: CompanionData) => {
  const entries: { name: string; blob: Blob }[] = []
  const manifest: BackupMetadata = {
    format: 'deepseek-companion',
    version: 2,
    sessions: data.sessions,
    links: data.links,
    interactions: data.interactions,
    contexts: data.contexts,
    usage: data.usage,
    personas: data.personas.map(({ avatar, ...persona }, index) => {
      if (avatar) {
        entries.push({ name: `avatars/${index}`, blob: avatar })
      }
      return { ...persona, avatarType: avatar?.type }
    }),
    files: data.files.map(({ id, blob }, index) => {
      entries.push({ name: `files/${index}`, blob })
      return { id, mimeType: blob.type }
    }),
  }
  const metadata = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
  if (metadata.size > maxMetadataBytes) {
    throw new Error('Companion backup metadata is too large')
  }
  return writeArchive([{ name: manifestPath, blob: metadata }, ...entries])
}

export const readCompanionBackup = async (file: File): Promise<CompanionData> => {
  const entries = readArchive(file)
  try {
    const { value: first } = await entries.next()
    if (!first || first.path !== manifestPath || first.size > maxMetadataBytes) {
      throw new Error('Invalid companion backup manifest')
    }
    const manifest = readMetadata(JSON.parse(await (await readEntry(first)).text()))
    const readBlob = async (path: string, mimeType: string, maxBytes = Infinity) => {
      const { value } = await entries.next()
      if (!value || value.path !== path || value.size > maxBytes) {
        throw new Error('Invalid companion backup attachment')
      }
      return new Blob([await readEntry(value)], { type: mimeType })
    }
    const personas: CompanionData['personas'] = []
    for (const [index, { avatarType, ...persona }] of manifest.personas.entries()) {
      const avatar = avatarType
        ? await readBlob(`avatars/${index}`, avatarType, maxAvatarBytes)
        : undefined
      if (avatar && !isAvatar(avatar)) {
        throw new Error('Invalid avatar in companion backup')
      }
      personas.push({ ...persona, ...(avatar ? { avatar } : {}) })
    }
    const files: CompanionData['files'] = []
    for (const [index, { id, mimeType }] of manifest.files.entries()) {
      files.push({ id, blob: await readBlob(`files/${index}`, mimeType) })
    }
    if (!(await entries.next()).done) {
      throw new Error('Unexpected entries in companion backup')
    }
    return {
      sessions: manifest.sessions,
      links: manifest.links,
      interactions: manifest.interactions,
      contexts: manifest.contexts,
      usage: manifest.usage,
      personas,
      files,
    }
  } finally {
    await entries.return(undefined)
  }
}

export const exportCompanionBackup = () =>
  enqueueBackup(async () => ({
    name: `deepseek-companion-${formatDate(new Date())}.zip`,
    blob: await writeCompanionBackup(await readCompanionData()),
  }))

export const restoreCompanionBackup = (data: CompanionData) =>
  enqueueBackup(() => replaceHistory(() => replaceCompanionData(data)))
