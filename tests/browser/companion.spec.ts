import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeArchive } from '../../src/services/chat/history/zipWriter.js'

const messagesUrl = 'https://api.deepseek.com/anthropic/v1/messages'
const fileUrl = 'https://api.deepseek.com/anthropic/v1/files'
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': '*',
}
type Outcome = 'end_turn' | 'max_tokens' | 'refusal' | 'error' | 'wait'

const installMock = async (page: Page) => {
  const requests: { system: string; messages: unknown[]; max_tokens: number }[] = []
  const outcomes: Outcome[] = []
  let releasePending: (() => void) | undefined
  await page.addInitScript(() => localStorage.setItem('chat-demo:api-key', 'test-key'))
  await page.route('https://api.deepseek.com/user/balance', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    await route.fulfill({
      headers: cors,
      json: { balance_infos: [{ currency: 'CNY', total_balance: '12.34' }] },
    })
  })
  await page.route(fileUrl, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    await route.fulfill({ headers: cors, json: { id: 'fixture-file', filename: 'hello.txt' } })
  })
  await page.route(messagesUrl, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    requests.push(route.request().postDataJSON())
    const n = requests.length
    const outcome = outcomes.shift() ?? 'end_turn'
    if (outcome === 'wait') {
      await new Promise<void>((done) => {
        releasePending = done
      })
    }
    if (outcome === 'error') {
      await route.fulfill({
        status: 500,
        headers: cors,
        json: { error: { message: '模拟请求失败' } },
      })
      return
    }
    const usage = {
      input_tokens: 200,
      output_tokens: 40,
      cache_creation_input_tokens: 12,
      cache_read_input_tokens: 60,
    }
    const events = [
      {
        type: 'message_start',
        message: { id: `request-${n}`, usage: { ...usage, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: `模拟答复 ${n}` },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: outcome === 'wait' ? 'end_turn' : outcome, title: `会话 ${n}` },
        usage,
      },
      { type: 'message_stop' },
    ]
    await route
      .fulfill({
        headers: { ...cors, 'content-type': 'text/event-stream' },
        body: events
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(''),
      })
      .catch((error: unknown) => {
        if (outcome !== 'wait') throw error
      })
  })
  return { requests, outcomes, release: () => releasePending?.() }
}

const eventCount = (page: Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('chat-demo')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction('interactions').objectStore('interactions').count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })

const manager = (page: Page) => page.getByRole('dialog', { name: '陪伴角色' })
const composer = (page: Page) => page.getByPlaceholder('请输入消息')
const send = async (page: Page, text: string) => {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

const addPersona = async (page: Page, name: string, prompt: string) => {
  await manager(page).getByRole('button', { name: '新建角色', exact: true }).click()
  const form = page.getByRole('dialog', { name: '新建角色' })
  await form.getByLabel('名称').fill(name)
  await form.getByLabel('自定义 System Prompt').fill(prompt)
  await form.getByRole('button', { name: '确定' }).click()
  await expect(manager(page).getByText(name, { exact: true })).toBeVisible()
}

const openManager = async (page: Page) => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '管理角色', exact: true }).click()
}

const chatAs = async (page: Page, name: string, create = false) => {
  await manager(page)
    .getByRole('article')
    .filter({ hasText: name })
    .getByRole('button', { name: create ? '新建角色会话' : '打开主会话' })
    .click()
  await expect(manager(page)).toBeHidden()
  await expect(page.getByLabel('会话角色').locator('option:checked')).toHaveText(name)
}

test('头像拒绝损坏图片，刷新保留正常头像，旧坏图回退到角色首字', async ({ page, browserName }) => {
  await installMock(page)
  await page.goto('/')
  await openManager(page)
  await addPersona(page, '海星', '头像测试')

  await manager(page).getByRole('button', { name: '编辑角色' }).click()
  const editor = page.getByRole('dialog', { name: '编辑角色' })
  const input = editor.getByLabel('头像', { exact: true })
  await input.setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwzVgLAAIgAUteGS/wAAAAAElFTkSuQmCC',
      'base64'
    ),
  })
  const preview = editor.locator('img')
  await expect(preview).toHaveJSProperty('naturalWidth', 1)
  await input.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('incomplete PNG'),
  })
  await expect(editor.getByRole('alert')).toContainText('无法读取头像')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(preview).toHaveJSProperty('naturalWidth', 1)
  await editor.getByRole('button', { name: '确定' }).click()
  await expect(editor).toBeHidden()
  await chatAs(page, '海星')

  const picker = page.getByRole('combobox', { name: '选择角色' })
  const roleCard = picker.locator('..')
  await expect(roleCard.locator('img')).toHaveJSProperty('naturalWidth', 1)
  await page.reload()
  await picker.selectOption({ label: '海星' })
  await expect(roleCard.locator('img')).toHaveJSProperty('naturalWidth', 1)

  await page.evaluate(
    (legacy) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('chat-demo')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('personas', 'readwrite')
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onabort = () => {
            database.close()
            reject(transaction.error)
          }
          const cursor = transaction.objectStore('personas').openCursor()
          cursor.onsuccess = () => {
            const entry = cursor.result
            if (entry) {
              const bytes = new TextEncoder().encode('corrupted avatar').buffer
              const avatar = legacy
                ? new Blob([bytes], { type: 'image/png' })
                : { bytes, type: 'image/png' }
              entry.update({ ...entry.value, avatar })
            }
          }
        }
      }),
    browserName === 'chromium'
  )
  await page.reload()
  await picker.selectOption({ label: '海星' })
  await openManager(page)
  const article = manager(page).getByRole('article')
  await expect(article.getByText('海', { exact: true })).toBeVisible()
  await expect(article.locator('img')).toHaveCount(0)
  await chatAs(page, '海星')
  await expect(roleCard.getByText('海', { exact: true })).toBeVisible()
  await expect(roleCard.locator('img')).toHaveCount(0)
})

test('普通对话与角色请求、改绑、重生成、续写、失败及附件', async ({ page }) => {
  const mock = await installMock(page)
  await page.goto('/')
  await send(page, '普通消息')
  await expect(page.getByText('模拟答复 1')).toBeVisible()
  expect(mock.requests[0]?.system).toBe('该助手为DeepSeek，由深度求索公司创造。')

  await openManager(page)
  await addPersona(page, '海星', '称呼我为船长')
  await addPersona(page, '珊瑚', '称呼我为伙伴')
  await manager(page).getByRole('button', { name: '关闭' }).click()
  await page
    .getByRole('dialog', { name: '设置', exact: true })
    .getByRole('button', { name: '关闭' })
    .click()
  await page.getByRole('button', { name: '开启新对话' }).click()
  const roleInComposer = composer(page)
    .locator('xpath=../..')
    .getByRole('combobox', { name: '会话角色' })
  await roleInComposer.selectOption({ label: '海星' })
  await send(page, '第一条角色消息')
  await expect(page.getByText('模拟答复 2')).toBeVisible()
  await expect(page.getByText('今日已点亮')).toBeVisible()
  expect(mock.requests[1]?.system).toContain('称呼我为船长')
  expect(mock.requests[1]?.system).not.toContain('伙伴')
  await page.getByRole('button', { name: '重新生成' }).click()
  await expect(page.getByText('模拟答复 3')).toBeVisible()
  await expect.poll(() => eventCount(page)).toBe(1)
  await page.getByRole('button', { name: '上一个版本' }).click()
  await expect(page.getByText('模拟答复 2')).toBeVisible()

  await openManager(page)
  await manager(page)
    .getByRole('article')
    .filter({ hasText: '海星' })
    .getByRole('button', { name: '编辑角色' })
    .click()
  const edit = page.getByRole('dialog', { name: '编辑角色' })
  await edit.getByLabel('自定义 System Prompt').fill('请用海港口吻')
  await edit.getByRole('button', { name: '确定' }).click()
  await chatAs(page, '海星', true)
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('测试文件') })
  await expect(page.getByText('hello.txt')).toBeVisible()
  mock.outcomes.push('max_tokens')
  await send(page, '附带文档')
  await expect(page.getByText('模拟答复 4')).toBeVisible()
  expect(mock.requests[3]?.system).toContain('请用海港口吻')
  expect(JSON.stringify(mock.requests[3]?.messages)).toContain('fixture-file')
  await page.getByRole('button', { name: '继续生成' }).click()
  await expect(page.getByText('模拟答复 5')).toBeVisible()
  expect(mock.requests[4]?.system).toContain('请用海港口吻')
  await expect.poll(() => eventCount(page)).toBe(1)

  const selector = page.getByLabel('会话角色')
  await selector.selectOption({ label: '珊瑚' })
  await expect(page.getByText('今日待点亮')).toBeVisible()
  mock.outcomes.push('error')
  await send(page, '失败消息')
  await expect(page.getByText('服务器繁忙，请稍后再试')).toBeVisible()
  expect(mock.requests[5]?.system).toContain('称呼我为伙伴')
  expect(mock.requests[5]?.system).not.toContain('海港口吻')
  await expect(page.getByText('今日待点亮')).toBeVisible()
  expect(await eventCount(page)).toBe(1)

  mock.outcomes.push('wait')
  await send(page, '取消消息')
  await expect.poll(() => mock.requests.length).toBe(7)
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden()
  mock.release()
  await expect.poll(() => eventCount(page)).toBe(1)

  await page.reload()
  await openManager(page)
  await expect(manager(page).getByRole('article')).toHaveCount(2)
  await chatAs(page, '海星')
  await expect(page.getByText('模拟答复 2')).toBeVisible()
})

const openData = async (page: Page) => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '数据管理' }).click()
}

test('导出文件夹、重压缩 ZIP、重复跳过及完整备份恢复', async ({ page }, testInfo) => {
  await installMock(page)
  await page.goto('/')
  await openManager(page)
  await addPersona(page, '海星', '归档人设')
  await chatAs(page, '海星')
  await send(page, '本地会话')
  await expect(page.getByText('今日已点亮')).toBeVisible()
  await composer(page).fill('保留草稿')

  const now = '2026-11-19T00:00:00.000Z'
  const json = (value: unknown) => new Blob([JSON.stringify(value)])
  const entries = [
    { name: 'manifest.json', blob: json({ export_format_version: 3 }) },
    {
      name: 'chat_sessions/fixture.json',
      blob: json({
        id: 'fixture',
        title: '迁移的会话',
        inserted_at: now,
        updated_at: now,
        current_message_id: 0,
        messages: [],
      }),
    },
    {
      name: 'chat_session_index.json',
      blob: json([
        { id: 'fixture', title: '迁移的会话', inserted_at: now, updated_at: now, message_count: 0 },
      ]),
    },
  ]
  const folder = testInfo.outputPath('deepseek_data-fixture')
  for (const { name, blob } of entries) {
    const path = join(folder, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await blob.text())
  }
  const blob = await writeArchive([
    { name: '__MACOSX/._deepseek_data-fixture', blob: new Blob(['Finder']) },
    ...entries
      .toReversed()
      .map(({ name, blob }) => ({ name: `deepseek_data-fixture/${name}`, blob })),
  ])
  const fixture = {
    name: 'deepseek_data-fixture.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await blob.arrayBuffer()),
  }
  await openData(page)
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  const importInput = settings.locator('input[accept*="application/x-zip-compressed"]')
  const preview = page.getByRole('dialog', { name: '确认导入历史对话？' })
  await settings.locator('input[webkitdirectory]').setInputFiles(folder)
  await expect(preview.getByText('预计新增 1 个对话，跳过 0 个已有对话。')).toBeVisible()
  await preview.getByLabel('会话角色').selectOption({ label: '海星' })
  await preview.getByRole('button', { name: '确认导入' }).click()
  await expect(settings.getByText('已新增 1 个对话，跳过 0 个已有对话。')).toBeVisible()
  await importInput.setInputFiles(fixture)
  await expect(preview.getByText('预计新增 0 个对话，跳过 1 个已有对话。')).toBeVisible()
  await preview.getByRole('button', { name: '确认导入' }).click()
  await expect(settings.getByText('已新增 0 个对话，跳过 1 个已有对话。')).toBeVisible()
  await settings.getByRole('button', { name: '关闭' }).click()
  await expect(composer(page)).toHaveValue('保留草稿')
  expect(await eventCount(page)).toBe(1)
  await page.getByText('迁移的会话', { exact: true }).click()
  await expect(page.getByLabel('会话角色').locator('option:checked')).toHaveText('海星')

  await openData(page)
  const downloaded = page.waitForEvent('download')
  await settings.getByRole('button', { name: '下载备份' }).click()
  const file = await downloaded
  const path = await file.path()
  const bytes = await readFile(path)
  await settings.getByRole('button', { name: '删除', exact: true }).click()
  const clear = page.getByRole('dialog', { name: '删除后，所有对话都将被清空且无法找回' })
  await clear.getByRole('button', { name: '删除' }).click()
  await expect(clear).toBeHidden()
  await settings.locator('input[accept=".zip,application/zip"]').setInputFiles({
    name: file.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: bytes,
  })
  const restore = page.getByRole('dialog', { name: '恢复备份' })
  await expect(restore.getByText(/1 个角色、2 个对话、1 条火花事件/)).toBeVisible()
  await restore.getByRole('button', { name: '确定' }).click()
  await expect(settings.getByText('完整备份已恢复。')).toBeVisible()
  await settings.getByRole('button', { name: '关闭' }).click()
  const picker = page.getByRole('combobox', { name: '选择角色' })
  await picker.selectOption({ label: '海星' })
  await expect(
    picker.locator('..').locator('..').getByText('迁移的会话', { exact: true })
  ).toBeVisible()
  expect(await eventCount(page)).toBe(1)
})

test('移动端可打开角色和查看跨午夜回复的火花日历', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const mock = await installMock(page)
  await page.clock.setFixedTime(new Date('2026-11-19T15:59:59Z'))
  await page.goto('/')
  await page.getByRole('button', { name: '打开边栏' }).click()
  await openManager(page)
  await addPersona(page, '海星', '移动端角色')
  await manager(page).getByText('火花日历').click()
  await expect(manager(page).getByRole('button', { name: '上月' })).toBeVisible()
  await chatAs(page, '海星')
  const calendar = page.getByRole('main').locator('summary').filter({ hasText: '火花日历' })
  const [mark, chevron] = await Promise.all(
    [calendar.locator('svg[data-level]'), calendar.getByText('火花日历').locator('svg')].map(
      (icon) => icon.boundingBox()
    )
  )
  expect(mark).not.toBeNull()
  expect(chevron).not.toBeNull()
  expect(mark!.y + mark!.height / 2).toBeCloseTo(chevron!.y + chevron!.height / 2, 0)
  expect(chevron!.x).toBeGreaterThan(mark!.x + mark!.width)
  await calendar.press('Enter')
  await expect(calendar.locator('..')).toHaveAttribute('open', '')
  await calendar.press('Space')
  await expect(calendar.locator('..')).not.toHaveAttribute('open')
  await expect(page.getByText('DeepSeek Companion', { exact: true })).toHaveCount(0)
  const toolButtons = ['深度思考', '智能搜索', '语音输入', '上传文件', '发送']
  const bounds = await Promise.all(
    toolButtons.map((name) => page.getByRole('button', { name, exact: true }).boundingBox())
  )
  for (const box of bounds) {
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect((box?.x ?? 320) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
  }
  expect(bounds[0]?.y).toBeCloseTo(bounds[1]?.y ?? 0, 0)
  const voiceBox = bounds[2]!
  for (const box of bounds.slice(3)) {
    expect(box?.y).toBeCloseTo(voiceBox.y, 0)
  }
  const ring = page.getByRole('button', { name: '输入 Token 用量' })
  const toolbar = ring.locator('..')
  await expect(toolbar.getByText('0 T', { exact: true })).toBeVisible()
  await composer(page).fill('这是一条用于检查草稿 Token 位置的消息')
  const draft = toolbar.getByText(/^[1-9]\d* T$/)
  await expect(draft).toBeVisible()
  const draftBox = (await draft.boundingBox())!
  const ringBox = (await ring.boundingBox())!
  expect(ringBox.width).toBeGreaterThanOrEqual(44)
  expect(draftBox.x + draftBox.width).toBeLessThanOrEqual(ringBox.x)
  expect(draftBox.y + draftBox.height / 2).toBeCloseTo(ringBox.y + ringBox.height / 2, 0)
  expect(ringBox.x + ringBox.width).toBeLessThanOrEqual(voiceBox.x)
  expect(ringBox.y + ringBox.height / 2).toBeCloseTo(voiceBox.y + voiceBox.height / 2, 0)
  await ring.click()
  const breakdown = page.getByRole('region', { name: '输入 Token 用量' })
  await expect(breakdown.getByText(/草稿约 [1-9]\d* Token/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(breakdown).toBeHidden()
  await expect(ring).toHaveAttribute('aria-expanded', 'false')

  mock.outcomes.push('wait')
  await send(page, '移动端问候')
  await expect.poll(() => mock.requests.length).toBe(1)
  await page.clock.setFixedTime(new Date('2026-11-19T16:00:01Z'))
  mock.release()
  await expect(page.getByText('模拟答复 1')).toBeVisible()
  await expect(page.getByText('今日已点亮')).toBeVisible()
  const replyOn = async (utcDay: number, index: number) => {
    await page.clock.setFixedTime(new Date(`2026-11-${utcDay}T16:00:01Z`))
    await send(page, `连聊测试 ${index}`)
    await expect(page.getByText(`模拟答复 ${index}`, { exact: true })).toBeVisible()
  }
  await replyOn(20, 2)
  await replyOn(21, 3)
  await expect(page.getByText('火花等级 1', { exact: true })).toBeVisible()
  const spark = page.getByRole('main').locator('svg[data-level]')
  await expect(spark.locator('g > path')).toHaveCount(1)
  await expect(spark.locator(':scope > path')).toHaveCSS('animation-name', /spark-pulse/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(spark.locator(':scope > path')).toHaveCSS('animation-name', 'none')
  await expect(spark.locator('g > path')).toHaveCount(1)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await replyOn(23, 4)
  await expect(page.getByText('重燃 1/3', { exact: true })).toBeVisible()
  await expect(spark.locator(':scope > path')).toHaveCSS('animation-name', 'none')
  await expect(spark.locator('g > path')).toHaveCount(0)
  await replyOn(24, 5)
  await replyOn(25, 6)
  await expect(page.getByText('连续 6 天', { exact: true })).toBeVisible()
  await replyOn(26, 7)
  await expect(page.getByText('火花等级 2', { exact: true })).toBeVisible()
  await expect(spark.locator('g > path')).toHaveCount(2)
  await page.getByRole('button', { name: '打开边栏' }).click()
  await openManager(page)
  await manager(page).getByText('火花日历').click()
  await expect(manager(page).locator('time[datetime="2026-11-20"]')).toContainText(/· 已点亮/)
  await expect(manager(page).locator('time[datetime="2026-11-19"]')).toContainText(/· 未点亮/)
  await expect(manager(page).locator('time[datetime="2026-11-23"]')).toContainText(/· 未点亮/)
})

test('角色列表、角色总记忆与会话记忆分离，并能从未选中行删除', async ({ page }) => {
  const mock = await installMock(page)
  await page.goto('/')
  await send(page, '默认对话')
  await expect(page.getByText('模拟答复 1')).toBeVisible()
  await openManager(page)
  await addPersona(page, '海星', '角色筛选测试')
  await manager(page).getByText('火花日历').click()
  await expect(manager(page).getByRole('button', { name: '上月' })).toBeVisible()

  await manager(page).getByRole('button', { name: '新建角色', exact: true }).click()
  const form = page.getByRole('dialog', { name: '新建角色', exact: true })
  await expect(form.getByLabel('名称')).toBeFocused()
  await form.getByLabel('名称').fill('珊瑚')
  await form.getByRole('button', { name: '确定' }).click()
  await expect(manager(page).getByText('珊瑚', { exact: true })).toBeVisible()

  await manager(page)
    .getByRole('article')
    .filter({ hasText: '海星' })
    .getByRole('button', { name: '角色总记忆' })
    .click()
  const shared = page.getByRole('dialog', { name: '角色总记忆' })
  await shared.getByRole('button', { name: '新增记忆' }).click()
  await shared.getByLabel('记忆 1', { exact: true }).fill('海星的共享记忆')
  await shared.getByRole('button', { name: '确定' }).click()

  await chatAs(page, '海星')
  await send(page, '角色对话')
  await expect(page.getByText('模拟答复 2')).toBeVisible()
  const rolePicker = page.getByRole('combobox', { name: '选择角色' })
  await expect(rolePicker.locator('option:checked')).toHaveText('海星')
  const roleCard = rolePicker.locator('..')
  const card = (await roleCard.boundingBox())!
  const role = (await roleCard.locator('strong').boundingBox())!
  const spark = (await roleCard.getByText('连续 1 天', { exact: true }).boundingBox())!
  expect(role.x + role.width).toBeLessThan(spark.x)
  expect(spark.x + spark.width).toBeLessThan(card.x + card.width)
  expect(role.y + role.height / 2).toBeCloseTo(spark.y + spark.height / 2, 0)

  expect(mock.requests[1]?.system).toContain('海星的共享记忆')
  await expect(page.getByLabel('按角色筛选')).toHaveCount(0)
  const sidebar = roleCard.locator('..')
  const standardRow = sidebar.getByText('会话 1', { exact: true })
  const seaStarRow = sidebar.getByText('会话 2', { exact: true })
  await expect(standardRow).toHaveCount(0)
  await expect(seaStarRow).toBeVisible()

  await page.getByRole('button', { name: '输入 Token 用量' }).click()
  await page.getByRole('button', { name: '管理会话记忆' }).click()
  const editor = page.getByRole('dialog', { name: '上下文与记忆' })
  await editor.getByRole('button', { name: '新增记忆' }).click()
  await editor.getByLabel('记忆 1', { exact: true }).fill('复制到角色的记忆')
  await editor.getByRole('button', { name: '加入角色总记忆' }).click()
  await expect(editor.getByRole('button', { name: '已加入角色总记忆' })).toBeDisabled()
  await editor.getByRole('button', { name: '新增记忆' }).click()
  await editor.getByLabel('记忆 2', { exact: true }).fill('仅海星这个会话使用')
  await editor.getByRole('button', { name: '仅保存记忆' }).click()

  await page.getByRole('button', { name: '开启新对话' }).click()
  await expect(page.getByRole('main').getByText('新对话', { exact: true })).toBeVisible()
  await expect(page.getByLabel('会话角色').locator('option:checked')).toHaveText('海星')
  await send(page, '同角色的新对话')
  await expect(page.getByText('模拟答复 3')).toBeVisible()
  expect(mock.requests[2]?.system).toContain('海星的共享记忆')
  expect(mock.requests[2]?.system).toContain('复制到角色的记忆')
  expect(mock.requests[2]?.system).not.toContain('仅海星这个会话使用')

  await rolePicker.selectOption({ label: '珊瑚' })
  await expect(page.getByLabel('会话角色').locator('option:checked')).toHaveText('珊瑚')
  await expect(seaStarRow).toHaveCount(0)
  await send(page, '另一角色的对话')
  await expect(page.getByText('模拟答复 4')).toBeVisible()
  expect(mock.requests[3]?.system).not.toContain('海星的共享记忆')
  expect(mock.requests[3]?.system).not.toContain('复制到角色的记忆')

  await rolePicker.selectOption({ label: '默认' })
  await expect(standardRow).toBeVisible()
  await expect(seaStarRow).toHaveCount(0)

  await standardRow.hover()
  const trigger = standardRow.locator('..').getByRole('button', { name: '更多' })
  await trigger.press('ArrowDown')
  const menu = page.getByRole('menu', { name: '更多' })
  await expect(menu.getByRole('menuitem', { name: '重命名' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: '删除' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(menu).toBeHidden()
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const remove = menu.getByRole('menuitem', { name: '删除' })
  await expect(remove).toBeVisible()
  const initial = await menu.boundingBox()
  expect(initial?.x).toBeGreaterThan(8)
  await remove.hover()
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect.poll(async () => (await menu.boundingBox())?.x).toBe(initial?.x)
  await expect.poll(async () => (await menu.boundingBox())?.y).toBe(initial?.y)
  await remove.click()
  const confirm = page.getByRole('dialog', { name: '永久删除对话' })
  await expect(confirm.getByText('会话 1', { exact: true })).toBeVisible()
  await confirm.getByRole('button', { name: '删除', exact: true }).click()
  await expect(standardRow).toHaveCount(0)
  await rolePicker.selectOption({ label: '海星' })
  await expect(page.getByText('模拟答复 2')).toBeVisible()
})

test('预算暂停保留草稿，人工记忆和摘要确认后才改变请求，同时记录实际用量', async ({ page }) => {
  const mock = await installMock(page)
  await page.goto('/')
  const original = '待整理的历史 ' + '从前的细节 '.repeat(40)
  await send(page, original)
  await expect(page.getByText('模拟答复 1')).toBeVisible()
  await send(page, '近期完整对话')
  await expect(page.getByText('模拟答复 2')).toBeVisible()
  const ring = page.getByRole('button', { name: '输入 Token 用量' })
  await expect(ring.locator('..').getByText('草稿约 0 Token', { exact: true })).toBeVisible()
  const breakdown = page.getByRole('region', { name: '输入 Token 用量' })
  await expect(page.getByText(/预计输入 \d+ \/ 8000 Token/)).toBeHidden()
  await ring.press('Enter')
  await expect(breakdown.getByText(/预计输入 \d+ \/ 8000 Token/)).toBeVisible()
  await expect(breakdown.getByText('分词器未就绪，当前为粗估。')).toHaveCount(0)
  await expect(breakdown.getByText(/输入 544 · 输出 80 · 缓存命中 120 · 未命中 424/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(breakdown).toBeHidden()

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置' })
  await expect(settings.getByText('可选', { exact: true })).toBeVisible()
  await expect(settings.getByText('额外费用', { exact: true })).toBeVisible()
  const voice = (await settings.getByRole('button', { name: '朗读音色' }).boundingBox())!
  for (const label of ['每次请求的输入预算', '独立输出上限', '达到输入预算时']) {
    const control = (await settings.getByLabel(label).boundingBox())!
    expect(control.width).toBeCloseTo(voice.width, 0)
    expect(control.height).toBeCloseTo(voice.height, 0)
    expect(control.x + control.width).toBeCloseTo(voice.x + voice.width, 0)
  }
  await settings.getByLabel('每次请求的输入预算').fill('256')
  await settings.getByLabel('独立输出上限').fill('512')
  await settings.getByRole('button', { name: '确定', exact: true }).click()
  await settings.getByRole('button', { name: '关闭' }).click()

  const long = '超预算草稿 '.repeat(200)
  await send(page, long)
  const editor = page.getByRole('dialog', { name: '上下文与记忆' })
  await expect(editor).toBeVisible()
  expect(mock.requests).toHaveLength(2)
  await editor.getByRole('button', { name: '取消' }).click()
  await expect(composer(page)).toHaveValue(long)
  await composer(page).fill('')

  await ring.click()
  await breakdown.getByRole('button', { name: '管理会话记忆' }).click()
  await expect(breakdown).toBeHidden()
  await editor.getByLabel('保留最近完整轮次').fill('1')
  await editor.getByText('选取旧消息加入长期记忆').click()
  await editor.getByRole('checkbox').first().check()
  await editor.getByLabel('记忆 1', { exact: true }).fill('我喜欢蓝色')
  await editor.getByRole('button', { name: '用 AI 生成摘要' }).click()
  await expect(editor.getByRole('textbox', { name: '旧对话摘要' })).toHaveValue('模拟答复 3')
  await expect(editor.getByText(/预计输入 .*节省/)).toBeVisible()
  await editor.getByRole('button', { name: '确认应用摘要' }).click()
  await expect(editor).toBeHidden()

  await send(page, '摘要后的问题')
  await expect(page.getByText('模拟答复 4')).toBeVisible()
  const request = mock.requests[3]
  expect(request?.max_tokens).toBe(512)
  expect(request?.system).toContain('我喜欢蓝色')
  expect(request?.system).toContain('模拟答复 3')
  expect(JSON.stringify(request?.messages)).not.toContain('待整理的历史')
  expect(JSON.stringify(request?.messages)).toContain('近期完整对话')
  await expect(page.getByText(/待整理的历史/)).toBeVisible()

  await page.getByRole('button', { name: '余额与花费' }).click()
  const cost = page.getByRole('dialog', { name: '余额与花费' })
  await expect(cost.getByText('¥12.34')).toBeVisible()
  await cost.getByRole('button', { name: '近 30 天' }).click()
  await expect(cost.getByRole('button', { name: '近 30 天' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(cost.getByText('语音朗读（TTS）')).toBeVisible()
})
