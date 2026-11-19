import type { MessageUsage } from '../../services/api/types.js'
import type { ChatUsage, UsageRecord } from './types.js'

export const usageTotals = (usage: MessageUsage) => {
  const cache = usage.cache_read_input_tokens
  const uncached = usage.input_tokens + usage.cache_creation_input_tokens
  return { input: uncached + cache, uncached, cache, output: usage.output_tokens }
}

export const formatMoney = (value: number) =>
  value > 0 && value < 0.01 ? '< ¥0.01' : `¥${value.toFixed(2)}`

/** DeepSeek 中国价格表，2026-11-19。工作日按常规高峰时段估算。 */
const rates = {
  'deepseek-flash': [0.04, 2, 8],
  'deepseek-v4-pro': [0.3, 9, 27],
} as const

const modelCost = (record: ChatUsage) => {
  const time = new Date(record.time + 8 * 60 * 60_000)
  const day = time.getUTCDay()
  const hour = time.getUTCHours()
  const peak = day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
  const [hit, miss, output] = rates[record.model]
  const totals = usageTotals(record.usage)
  return (
    ((totals.cache * hit + totals.uncached * miss + totals.output * output) / 1_000_000) *
    (peak ? 1 : 0.5)
  )
}

export const spending = (records: readonly UsageRecord[], days: number, now = Date.now()) => {
  const start = now - days * 24 * 60 * 60_000
  let chat = 0
  let tts = 0
  for (const item of records) {
    if (item.time >= start && item.time <= now) {
      if (item.kind === 'tts') {
        tts += (item.characters * 1.5) / 10_000
      } else {
        chat += modelCost(item)
      }
    }
  }
  return { chat, tts, total: chat + tts }
}
