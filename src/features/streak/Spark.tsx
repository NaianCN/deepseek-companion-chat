import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/base/Button.js'
import { IconChevronRightOutline14 } from '../../components/base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { usePersonas } from '../persona/store.js'
import type { Persona } from '../persona/types.js'
import { calculateStreak, dayInZone, sparkMilestones } from './streak.js'
import styles from './spark.module.css'

const calendarDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day))

const satellites = [
  { x: 19.5, y: 4.6, size: 2.8 },
  { x: 20.6, y: 15.6, size: 2.4 },
  { x: 3.7, y: 5.8, size: 2.2 },
  { x: 17.8, y: 21, size: 2.2 },
  { x: 3.9, y: 19.3, size: 2.2 },
]

export const Spark = ({
  persona,
  showCalendar = false,
  compact = false,
}: {
  persona: Persona
  showCalendar?: boolean
  compact?: boolean
}) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const interactions = usePersonas((state) => state.interactions)
  const [, setNow] = useState(Date.now)
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const today = dayInZone(Date.now(), persona.timeZone)
  const dates = useMemo(
    () =>
      new Set(
        interactions
          .filter((event) => event.personaId === persona.id)
          .map((event) => dayInZone(event.completedAt, persona.timeZone))
      ),
    [interactions, persona.id, persona.timeZone]
  )
  const { lit, current, longest, recovery } = calculateStreak(dates, today)
  const level = sparkMilestones.filter((days) => current >= days).length
  const next = sparkMilestones[level]
  const recoveryLabel = recovery
    ? t('sparkRecovery', { days: recovery.days, count: recovery.progress })
    : undefined
  const badgeLabel = recovery
    ? t('sparkRecoveryShort', { count: recovery.progress })
    : t('sparkCurrent', { days: current })
  const mark = (
    <svg
      key={`${persona.id}:${level}`}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className={styles.mark}
      data-level={level}
      data-pending={!lit || Boolean(recovery)}
      aria-hidden="true"
    >
      <path
        d="M10.5 2.5c1.1 5.5 3.5 7.9 8.5 9.1-5 1.2-7.4 3.5-8.5 9.4-1.2-5.9-3.5-8.2-8.5-9.4 5-1.2 7.3-3.6 8.5-9.1Z"
        fill="currentColor"
      />
      {satellites.slice(0, level).map(({ x, y, size }, index) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${size})`}>
          <path
            d="M 0 -1 Q 0.18 -0.18 1 0 Q 0.18 0.18 0 1 Q -0.18 0.18 -1 0 Q -0.18 -0.18 0 -1 Z"
            fill="currentColor"
            style={{ animationDelay: `${index * 65}ms` }}
          />
        </g>
      ))}
    </svg>
  )
  if (compact) {
    return (
      <span className={styles.compactSpark} title={recoveryLabel}>
        <span className={styles.summary}>
          {mark}
          <span>{badgeLabel}</span>
        </span>
      </span>
    )
  }
  const [year, month] = today.split('-').map(Number) as [number, number]
  const first = calendarDate(year, month - 1 + offset, 1)
  const days = calendarDate(year, month + offset, 0).getUTCDate()
  const displayMonth = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
  }).format(first)
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const weekdays = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' })
  const dateLabels = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'long' })

  const status = (
    <span className={styles.summary}>
      {mark}
      <span>{t(lit ? 'sparkLit' : 'sparkUnlit')}</span>
      <span>{badgeLabel}</span>
      {level > 0 && <span className={styles.level}>{t('sparkLevel', { count: level })}</span>}
    </span>
  )
  return (
    <div className={styles.spark}>
      {showCalendar ? (
        <details className={styles.details}>
          <summary>
            {status}
            <span className={styles.calendarLabel}>
              {t('sparkCalendar')}
              <span className={styles.calendarChevron} aria-hidden="true">
                <IconChevronRightOutline14 />
              </span>
            </span>
          </summary>
          <div className={styles.progress}>
            <span>{t('sparkLongest', { days: longest })}</span>
            {recoveryLabel ? (
              <span>{recoveryLabel}</span>
            ) : (
              next && <span>{t('sparkNextLevel', { days: next })}</span>
            )}
          </div>
          <div className={styles.month}>
            <Button size="s" variant="outlined" onClick={() => setOffset(offset - 1)}>
              {t('sparkPrevious')}
            </Button>
            <span aria-live="polite">{displayMonth}</span>
            <Button
              size="s"
              variant="outlined"
              disabled={offset >= 0}
              onClick={() => setOffset(offset + 1)}
            >
              {t('sparkNext')}
            </Button>
          </div>
          <div className={styles.grid}>
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{weekdays.format(calendarDate(2024, 0, i + 1))}</span>
            ))}
            {Array.from({ length: mondayOffset }, (_, i) => (
              <span key={`empty-${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = calendarDate(year, month - 1 + offset, i + 1)
              const iso = date.toISOString().slice(0, 10)
              const active = dates.has(iso)
              return (
                <time
                  key={iso}
                  dateTime={iso}
                  aria-current={iso === today ? 'date' : undefined}
                  className={active ? styles.activeDate : undefined}
                >
                  <span aria-hidden="true">{i + 1}</span>
                  <span className={styles.visuallyHidden}>
                    {`${dateLabels.format(date)} · ${t(active ? 'sparkDateLit' : 'sparkDateUnlit')}`}
                  </span>
                </time>
              )
            })}
          </div>
          <small>{persona.timeZone}</small>
        </details>
      ) : (
        status
      )}
    </div>
  )
}
