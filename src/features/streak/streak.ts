import type { Interaction } from '../persona/types.js'
import type { AssistantMessage } from '../../services/chat/types.js'

const millisecondsPerDay = 86_400_000

export const dayInZone = (timestamp: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

const toOrdinal = (day: string) => Date.parse(day) / millisecondsPerDay

export const sparkMilestones = [3, 7, 14, 30, 100] as const
const recoveryDays = 3

export const calculateStreak = (days: Iterable<string>, today: string) => {
  const currentDay = toOrdinal(today)
  const ordinals = [...new Set(days)]
    .map(toOrdinal)
    .filter((day) => day <= currentDay)
    .sort((a, b) => a - b)
  let previous = -Infinity
  let longest = 0
  let run = 0
  // 只重放实际互动日，恢复天数不包含空白日。
  let usedRecovery = false
  let recoveringFrom = 0
  for (const day of ordinals) {
    if (day === previous + 1) {
      run += 1
      if (recoveringFrom && run === recoveryDays) {
        run += recoveringFrom
        recoveringFrom = 0
        usedRecovery = true
      }
    } else {
      recoveringFrom = day === previous + 2 && !usedRecovery && run >= sparkMilestones[0] ? run : 0
      run = 1
      usedRecovery = false
    }
    longest = Math.max(longest, run)
    previous = day
  }
  const active = previous >= currentDay - 1
  const recovery =
    active && recoveringFrom
      ? { days: recoveringFrom, progress: run }
      : previous === currentDay - 2 && run >= sparkMilestones[0] && !usedRecovery
        ? { days: run, progress: 0 }
        : undefined
  return {
    current: active ? run : 0,
    longest,
    lit: previous === currentDay,
    ...(recovery && { recovery }),
  }
}

export const qualifyingInteraction = (
  reply: AssistantMessage,
  sessionId: string,
  personaId: string,
  completedAt: number
): Interaction | undefined => {
  if (
    reply.status === 'done' &&
    reply.stopReason === 'end_turn' &&
    reply.blocks.some((block) => block.type === 'text' && !block.isTemplate && block.text.trim())
  ) {
    return { replyId: reply.id, sessionId, personaId, completedAt }
  }
  return undefined
}
