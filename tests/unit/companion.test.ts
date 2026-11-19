import './setup.js'

import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDB } from 'idb'
import * as db from '../../src/services/chat/db.js'
import {
  bindPersona,
  deletePersona,
  loadPersonas,
  personaForSession,
  promoteSessionMemory,
  savePersona,
  savePersonaMemories,
} from '../../src/features/persona/repository.js'
import { buildPersonaPrompt } from '../../src/features/persona/prompt.js'
import {
  calculateStreak,
  dayInZone,
  qualifyingInteraction,
} from '../../src/features/streak/streak.js'
import { readCompanionData, replaceCompanionData } from '../../src/features/backup/repository.js'
import { exportArchive } from '../../src/services/chat/history/exportArchive.js'
import { importArchive } from '../../src/services/chat/history/importArchive.js'
import type { AssistantMessage, Session } from '../../src/services/chat/types.js'

import {
  readSessionContext,
  recordUsage,
  saveSessionContext,
} from '../../src/features/context/repository.js'
import { buildRequest, draftQuestion } from '../../src/features/context/assemble.js'
import {
  budgetStatus,
  estimateRequest,
  estimateText,
  loadTokenizer,
  tokenizerAvailable,
} from '../../src/features/context/estimate.js'
import { usageTotals } from '../../src/features/context/pricing.js'
import { emptyContext } from '../../src/features/context/types.js'

const day = Date.parse('2026-11-19T00:00:00Z')
const draft = {
  name: '海星',
  description: '',
  personality: '好奇',
  background: '来自海港',
  relationship: '朋友',
  speakingStyle: '简短',
  systemPrompt: '称呼我为船长',
}
const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
const initialReply: AssistantMessage = {
  id: 'a',
  role: 'assistant',
  createdAt: day + 500,
  parentId: 'u',
  status: 'done',
  model: null,
  prefix: true,
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text: '你好' }],
}
const session = (id: string): Session => ({
  id,
  title: id,
  createdAt: day,
  updatedAt: day + 500,
  rootMessageId: 'u',
  messages: [
    {
      id: 'u',
      role: 'user',
      content: '在吗',
      createdAt: day,
      parentId: null,
      selectedChildId: 'a',
      files: [
        {
          id: 'shared',
          name: 'pic.png',
          size: png.size,
          isImage: true,
          mimeType: 'image/png',
          serverId: null,
        },
      ],
    },
    initialReply,
    { ...initialReply, id: 'branch', blocks: [{ type: 'text', text: '另一个分支' }] },
  ],
})
const archiveFile = (blob: Blob) => new File([blob], 'deepseek_data-test.zip')

test('Companion 数据库与归档', async (suite) => {
  await suite.test('v11 升级保留旧会话及文件，角色增改删与绑定一致', async () => {
    const old = await openDB('chat-demo', 11, {
      upgrade(database) {
        for (const name of [
          'sessions',
          'sessionSummaries',
          'files',
          'sessionsStaging',
          'filesStaging',
        ]) {
          database.createObjectStore(name, { keyPath: 'id' })
        }
      },
    })
    const existing = session('existing')
    await old.put('sessions', existing)
    await old.put('sessionSummaries', { ...existing, fileIds: ['shared'] })
    await old.put('files', { id: 'shared', blob: png })
    old.close()

    assert.equal((await db.getDB()).version, 13)
    assert.deepEqual(await db.loadSession(existing.id), existing)
    assert.equal((await db.loadFile('shared'))?.size, png.size)
    assert.deepEqual(await loadPersonas(), { personas: [], links: [], interactions: [] })

    const persona = await savePersona({ ...draft, avatar: png })
    const other = await savePersona({ ...draft, name: '珊瑚', systemPrompt: '另一位角色' })
    await bindPersona(existing.id, persona.id)
    await bindPersona('second', persona.id, session('second'))
    assert.equal((await personaForSession('second'))?.id, persona.id)
    await assert.rejects(bindPersona('invalid', 'missing', session('invalid')))
    assert.equal(await db.loadSession('invalid'), undefined)
    assert.match(buildPersonaPrompt(persona), /称呼我为船长/)
    assert.doesNotMatch(buildPersonaPrompt(other), /船长/)
    await savePersonaMemories(persona.id, [], [' 角色共享 ', '角色共享'])
    await assert.rejects(savePersonaMemories(persona.id, [], ['旧窗口的修改']))
    await promoteSessionMemory(existing.id, persona.id, ' 提升的记忆 ')
    await promoteSessionMemory(existing.id, persona.id, '提升的记忆')
    await assert.rejects(promoteSessionMemory(existing.id, other.id, '不能跨角色复制'))
    assert.deepEqual((await personaForSession('second'))?.memories, ['角色共享', '提升的记忆'])
    assert.equal(
      (await loadPersonas()).personas.find(({ id }) => id === other.id)?.memories,
      undefined
    )
    const edited = await savePersona({ ...draft, systemPrompt: '称呼我为伙伴' }, persona.id)
    assert.deepEqual(edited.memories, ['角色共享', '提升的记忆'])
    assert.equal(edited.timeZone, persona.timeZone)
    assert.match(buildPersonaPrompt(edited), /伙伴/)
    assert.deepEqual(await db.loadSession(existing.id), existing)

    const event = { replyId: 'a', sessionId: existing.id, personaId: persona.id, completedAt: day }
    await db.saveSession(existing, [], [event])
    await db.saveSession(existing, [], [event])
    assert.deepEqual((await loadPersonas()).interactions, [event])
    await deletePersona(persona.id)
    assert.equal(await personaForSession(existing.id), undefined)
    assert.equal((await loadPersonas()).interactions.length, 0)
    assert.deepEqual(await db.loadSession(existing.id), existing)
  })

  await suite.test('归档保留分支、时间与图片，重复项与冲突附件不覆盖本地', async () => {
    const persona = await savePersona(draft)
    const existing = session('existing')
    const imported = session('new-archive')
    const blob = await exportArchive([existing, imported])
    await db.renameSession(existing.id, '本地编辑')
    await bindPersona(existing.id, persona.id)
    await importArchive(archiveFile(blob))
    assert.deepEqual(await db.previewStagingMerge(), { added: 1, skipped: 1 })
    await assert.rejects(db.commitStagingMerge('missing'))
    assert.equal(await db.loadSession(imported.id), undefined)
    assert.equal((await db.loadSession(existing.id))?.title, '本地编辑')
    assert.equal((await db.commitStagingMerge(persona.id)).added.length, 1)

    const result = await db.loadSession(imported.id)
    assert.equal(result?.createdAt, imported.createdAt)
    assert.equal(result?.messages.length, 3)
    const first = result?.messages[0]
    assert.equal(first?.role, 'user')
    assert.equal(first?.createdAt, imported.messages[0]?.createdAt)
    assert.ok(first?.role === 'user' && first.files[0]?.id)
    assert.notEqual(first.files[0].id, 'shared')
    assert.equal((await db.loadFile(first.files[0].id))?.type, 'image/png')
    assert.equal((await personaForSession(imported.id))?.id, persona.id)

    await importArchive(archiveFile(blob))
    assert.deepEqual(await db.previewStagingMerge(), { added: 0, skipped: 2 })
    assert.deepEqual(await db.commitStagingMerge(null), { added: [], skipped: 2 })
    assert.equal((await personaForSession(existing.id))?.id, persona.id)
    assert.equal((await loadPersonas()).interactions.length, 0)
  })

  await suite.test('提交时重映射和旧附件冲突的 ID', async () => {
    const staged = session('collision')
    const bytes = new Blob(['replacement'], { type: 'image/png' })
    await db.addStagingSession(staged)
    await db.saveStagingFiles([{ id: 'shared', blob: bytes }])
    await db.commitStagingMerge(null)
    const message = (await db.loadSession(staged.id))?.messages[0]
    assert.ok(message?.role === 'user' && message.files[0])
    assert.notEqual(message.files[0].id, 'shared')
    assert.equal(await (await db.loadFile(message.files[0].id))?.text(), 'replacement')
    assert.equal((await db.loadFile('shared'))?.size, png.size)
  })

  await suite.test('完整备份恢复头像、会话树、二进制附件与事件，失败整体回滚', async () => {
    const { writeCompanionBackup, readCompanionBackup } =
      await import('../../src/features/backup/companion.js')
    const persona = await savePersona({ ...draft, avatar: png })
    const chat = session('backup')
    await savePersonaMemories(persona.id, [], ['角色总记忆备份'])
    await bindPersona(chat.id, persona.id, chat)
    await db.saveSession(
      chat,
      [],
      [{ replyId: 'a', personaId: persona.id, sessionId: chat.id, completedAt: day }]
    )
    const context = {
      ...emptyContext(chat.id),
      memories: ['仅本会话保留'],
      summaries: [{ id: 'version-1', sourceIds: ['u', 'a'], text: '早期内容摘要', createdAt: day }],
      activeSummaryId: 'version-1',
    }
    await saveSessionContext(context)
    await assert.rejects(saveSessionContext(context))
    assert.equal((await readSessionContext('existing'))?.memories, undefined)
    const record = {
      id: 'req-unique',
      time: day,
      sessionId: chat.id,
      replyId: 'a',
      model: 'deepseek-flash',
      kind: 'chat',
      usage: {
        input_tokens: 200,
        output_tokens: 40,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 12,
      },
    } as const
    await recordUsage(record)
    await recordUsage(record)
    assert.equal((await readCompanionData()).usage.length, 1)
    const data = await readCompanionData()
    const zipped = await writeCompanionBackup(data)
    const restored = await readCompanionBackup(archiveFile(zipped))
    assert.deepEqual(restored.sessions, JSON.parse(JSON.stringify(data.sessions)))
    assert.deepEqual(restored.links, data.links)
    assert.deepEqual(restored.interactions, data.interactions)
    assert.deepEqual(restored.usage, data.usage)
    assert.deepEqual(restored.contexts, data.contexts)
    assert.deepEqual(
      await restored.personas.find((item) => item.id === persona.id)?.avatar?.arrayBuffer(),
      await png.arrayBuffer()
    )
    assert.equal(restored.files.length, data.files.length)
    await assert.rejects(readCompanionBackup(archiveFile(zipped.slice(0, zipped.size - 5))))
    await assert.rejects(
      replaceCompanionData({ ...restored, links: [...restored.links, restored.links[0]] })
    )
    assert.deepEqual(await db.loadSession(chat.id), chat)
    await db.deleteAllHistory()
    assert.equal(await readSessionContext(chat.id), undefined)
    assert.equal((await loadPersonas()).interactions.length, 1)
    assert.equal((await loadPersonas()).links.length, 0)
    await replaceCompanionData(restored)
    assert.deepEqual((await readSessionContext(chat.id))?.memories, context.memories)
    assert.deepEqual(await db.loadSession(chat.id), chat)
    const restoredPersona = await personaForSession(chat.id)
    assert.equal(restoredPersona?.id, persona.id)
    assert.deepEqual(restoredPersona?.memories, ['角色总记忆备份'])
    assert.deepEqual(await restoredPersona?.avatar?.arrayBuffer(), await png.arrayBuffer())
  })
})

test('火花以固定时区的自然日统计，覆盖 DST、去重和断签', () => {
  const zone = 'America/New_York'
  const times = ['2026-03-08T04:59:00Z', '2026-03-08T05:01:00Z', '2026-03-09T04:01:00Z']
  const days = times.map((value) => dayInZone(Date.parse(value), zone))
  assert.deepEqual(days, ['2026-03-07', '2026-03-08', '2026-03-09'])
  assert.deepEqual(calculateStreak([...days, days[2]], '2026-03-09'), {
    current: 3,
    longest: 3,
    lit: true,
  })
  assert.deepEqual(calculateStreak(days, '2026-03-10'), { current: 3, longest: 3, lit: false })
  assert.deepEqual(calculateStreak(days, '2026-03-11'), {
    current: 0,
    longest: 3,
    lit: false,
    recovery: { days: 3, progress: 0 },
  })
  assert.ok(qualifyingInteraction(initialReply, 'chat', 'persona', day))
  for (const reply of [
    { ...initialReply, status: 'stopped' },
    { ...initialReply, status: 'error' },
    { ...initialReply, stopReason: 'refusal' },
    { ...initialReply, stopReason: 'max_tokens' },
    { ...initialReply, blocks: [{ type: 'text', text: ' ' }] },
    { ...initialReply, blocks: [{ type: 'text', text: 'template', isTemplate: true }] },
  ] as AssistantMessage[]) {
    assert.equal(qualifyingInteraction(reply, 'chat', 'persona', day), undefined)
  }
})

test('一段火花只重燃一次，漏聊日不计入恢复后的天数', () => {
  const first = ['2026-11-01', '2026-11-02', '2026-11-03']
  const resumed = [...first, '2026-11-05', '2026-11-06', '2026-11-07']
  assert.deepEqual(calculateStreak(first, '2026-11-06'), { current: 0, longest: 3, lit: false })
  assert.deepEqual(calculateStreak(resumed, '2026-11-06').recovery, { days: 3, progress: 2 })
  assert.deepEqual(calculateStreak(resumed, '2026-11-07'), { current: 6, longest: 6, lit: true })
  assert.deepEqual(calculateStreak(resumed, '2026-11-09'), { current: 0, longest: 6, lit: false })
  assert.deepEqual(calculateStreak([...resumed, '2026-11-09'], '2026-11-09'), {
    current: 1,
    longest: 6,
    lit: true,
  })
  assert.equal(
    calculateStreak([...first, '2026-11-05', '2026-11-07'], '2026-11-07').recovery,
    undefined
  )
  const next = [...resumed, '2026-11-09', '2026-11-10', '2026-11-11']
  assert.deepEqual(calculateStreak(next, '2026-11-13').recovery, { days: 3, progress: 0 })
})

test('DeepSeek 官方分词、80% 预算、请求估算及摘要分支隔离', async () => {
  await loadTokenizer()
  assert.equal(tokenizerAvailable(), true)
  assert.equal(estimateText('你好，世界！ Hello, world!'), 8)
  assert.equal(budgetStatus(6399, 8000), 'within')
  assert.equal(budgetStatus(6400, 8000), 'near')
  assert.equal(budgetStatus(8000, 8000), 'limit')
  assert.deepEqual(
    usageTotals({
      input_tokens: 200,
      output_tokens: 40,
      cache_read_input_tokens: 60,
      cache_creation_input_tokens: 12,
    }),
    { input: 272, uncached: 212, cache: 60, output: 40 }
  )
  const [root, answer, branch] = session('thread').messages
  const question = draftQuestion('下一轮')
  const context = {
    ...emptyContext('thread'),
    memories: ['手选记忆'],
    summaries: [{ id: 'v1', text: '仅第一支摘要', sourceIds: ['u', 'a'], createdAt: day }],
    activeSummaryId: 'v1',
  }
  const original = buildRequest({ history: [root, answer], question, maxTokens: 512 })
  const compressed = buildRequest({ context, history: [root, answer], question, maxTokens: 512 })
  const otherBranch = buildRequest({ context, history: [root, branch], question, maxTokens: 512 })
  assert.equal(compressed.max_tokens, 512)
  assert.ok(compressed.system.includes('手选记忆') && compressed.system.includes('仅第一支摘要'))
  assert.equal(compressed.messages.length, 1)
  assert.equal(otherBranch.messages.length, 3)
  assert.ok(!otherBranch.system.includes('仅第一支摘要'))
  assert.equal(root.content, '在吗')
  assert.ok(estimateRequest(compressed).input > estimateText(question.content))
  assert.equal(original.messages.length, 3)
})
