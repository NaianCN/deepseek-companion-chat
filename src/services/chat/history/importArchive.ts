import { createId } from '../../../utils/id.js'
import * as db from '../db.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

const isSystemEntry = (path: string) =>
  path.split('/').some((part) => part === '__MACOSX') ||
  path.split('/').some((part) => part === '.DS_Store' || part.startsWith('._'))

/** 从 manifest 定位唯一导出根目录。选择文件夹和解压后重新打包的 ZIP 使用同一套规则。 */
const locateArchive = (paths: string[]) => {
  const manifests = paths.filter(
    (path) => !isSystemEntry(path) && /^(?:[^/]+\/)?manifest\.json$/.test(path)
  )
  if (manifests.length !== 1) {
    return fail('backupUnrecognized')
  }
  return manifests[0].slice(0, -MANIFEST_PATH.length)
}

const priority = (path: string) => {
  if (path === MANIFEST_PATH) {
    return 0
  }
  if (path === INDEX_PATH) {
    return 1
  }
  if (parseSessionPath(path) !== null) {
    return 2
  }
  return 3
}

const folderEntries = async function* (
  files: readonly File[],
  root: string
): AsyncGenerator<ArchiveEntry> {
  const entries = files.map((file) => ({ file, path: file.webkitRelativePath.normalize('NFC') }))
  const seen = new Set<string>()
  for (const { path } of entries) {
    if (
      path
        .split('/')
        .some((part) => !part || part === '.' || part === '..' || part.includes('\\')) ||
      seen.has(path)
    ) {
      fail('backupIncomplete')
    }
    seen.add(path)
  }
  entries.sort((a, b) => priority(a.path.slice(root.length)) - priority(b.path.slice(root.length)))
  for (const { file, path } of entries) {
    yield {
      path,
      size: file.size,
      stream: (async function* () {
        const reader = file.stream().getReader()
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) {
              break
            }
            yield chunk.value
          }
        } finally {
          reader.releaseLock()
        }
      })(),
    }
  }
}

export type HistorySource = File | readonly File[]

/** 按逻辑顺序读取，先校验 manifest、索引和会话，再按引用保存附件原件。 */
export const importArchive = async (source: HistorySource): Promise<void> => {
  let root = ''
  let entries: AsyncGenerator<ArchiveEntry>
  if (source instanceof File) {
    if (!(await isZipFile(source))) {
      fail('backupUnrecognized')
    }
    entries = readArchive(source, (paths) => {
      root = locateArchive(paths)
      return (path) => (path.startsWith(root) ? priority(path.slice(root.length)) : 3)
    })
  } else {
    root = locateArchive(source.map((file) => file.webkitRelativePath.normalize('NFC')))
    entries = folderEntries(source, root)
  }

  const imported = new Set<string>()
  const images = new Map<string, string>()
  const stored = new Map<string, string>()
  let manifest = false
  let index: SessionIndexEntry[] | undefined

  try {
    for await (const entry of entries) {
      if (isSystemEntry(entry.path)) {
        await skipEntry(entry)
        continue
      }
      if (!entry.path.startsWith(root)) {
        fail('backupIncomplete')
      }
      const path = entry.path.slice(root.length)
      const sessionId = parseSessionPath(path)
      if (path === MANIFEST_PATH) {
        checkManifest(await readJson(entry))
        manifest = true
      } else if (path === INDEX_PATH) {
        index = readSessionIndex(await readJson(entry))
      } else if (sessionId !== null) {
        const ids = new Map<string, string>()
        const local = toLocalSession(readSessionFile(await readJson(entry)), (file) => {
          const path = file.is_image ? file.export_path?.normalize('NFC') : undefined
          const key = JSON.stringify(path === undefined ? ['id', file.id] : ['path', path])
          const id = ids.get(key) ?? createId()
          ids.set(key, id)
          return id
        })
        if (local.session.id !== sessionId || imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        imported.add(sessionId)
        for (const [imagePath, id] of local.images) {
          images.set(imagePath, id)
        }
        await db.addStagingSession(local.session)
      } else if (
        path === USER_PATH ||
        imported.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
      ) {
        const id = images.get(path)
        if (id === undefined) {
          await skipEntry(entry)
          continue
        }
        const data = await readEntry(entry)
        const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
        await db.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
        stored.set(id, type)
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest) {
    fail('backupUnrecognized')
  }
  const listed = new Set(index?.map((entry) => entry.id))
  if (
    !index ||
    listed.size !== index.length ||
    listed.size !== imported.size ||
    [...imported].some((id) => !listed.has(id))
  ) {
    fail('backupIncomplete')
  }
  await db.updateStagingFileTypes(stored)
}
