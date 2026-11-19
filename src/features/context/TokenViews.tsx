import { useDeferredValue, useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../../components/base/anchored.js'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { EMPTY_DRAFT, useDrafts } from '../../services/chat/drafts.js'
import { createLatestReminder } from '../../services/chat/latestReminder.js'
import type { AssistantMessage, Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { usePersonas } from '../persona/store.js'
import type { Persona } from '../persona/types.js'
import { appliesToHistory, buildRequest, draftQuestion } from './assemble.js'
import { budgetStatus, estimateRequest, estimateText, useTokenizerReady } from './estimate.js'
import { openContextEditor } from './editorState.js'
import { usageTotals } from './pricing.js'
import { useContextData } from './repository.js'
import type { ChatUsage, SessionContext } from './types.js'
import styles from './context.module.css'

export const useContextInputs = (session?: Session, draftPersona?: Persona) => {
  const sessionId = session?.id ?? null
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const text = useDeferredValue(draft.text)
  const settings = useSettings()
  const context = useContextData((state) => session && state.contexts.get(session.id))
  const linkedPersona = usePersonas(({ links, personas }) =>
    personas.find(
      ({ id }) =>
        id === links.find(({ sessionId: linkSessionId }) => linkSessionId === sessionId)?.personaId
    )
  )
  const persona = session ? linkedPersona : draftPersona
  const history = useMemo(() => (session ? getVisibleMessages(session) : []), [session])
  const question = useMemo(
    () =>
      draftQuestion(
        text,
        draft.attachments.map(({ id, file, isImage }) => ({
          id,
          serverId: id,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          isImage,
        }))
      ),
    [text, draft.attachments]
  )
  const estimate = (nextContext?: SessionContext) =>
    estimateRequest(
      buildRequest({
        context: nextContext,
        persona,
        history,
        question,
        thinking: settings.thinking,
        search: settings.search,
        latestReminder: createLatestReminder(settings),
        maxTokens: settings.outputBudget,
      })
    )
  return { context, history, estimate, settings, text }
}

const rowsFor = (
  records: ReturnType<typeof useContextData.getState>['usage'],
  sessionId: string,
  replyId?: string
) =>
  records.filter(
    (item): item is ChatUsage =>
      item.kind !== 'tts' &&
      item.sessionId === sessionId &&
      (replyId === undefined || item.replyId === replyId)
  )

const emptyRows: ChatUsage[] = []

export const ContextRing = ({
  session,
  draftPersona,
}: {
  session?: Session
  draftPersona?: Persona
}) => {
  const t = useTranslate()
  const panelId = useId()
  const ready = useTokenizerReady()
  const [open, setOpen] = useState(false)
  const native =
    typeof HTMLButtonElement !== 'undefined' &&
    'popoverTargetElement' in HTMLButtonElement.prototype
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLButtonElement, HTMLElement>(
    open,
    { side: 'top', align: 'end', offset: 8 }
  )
  useEffect(() => {
    const panel = native ? floatingRef.current : null
    if (!panel) {
      return
    }
    const sync = () => setOpen(panel.matches(':popover-open'))
    panel.addEventListener('toggle', sync)
    return () => panel.removeEventListener('toggle', sync)
  }, [floatingRef, native])
  useDismiss(!native && open, [anchorRef, floatingRef], () => setOpen(false))
  const { context, history, estimate, settings, text } = useContextInputs(session, draftPersona)
  const { input, external } = estimate(context)
  const budget = settings.inputBudget
  const records = useContextData((state) => state.usage)
  const rows = session ? rowsFor(records, session.id) : emptyRows
  const totals = rows.reduce(
    (sum, row) => {
      const values = usageTotals(row.usage)
      return {
        input: sum.input + values.input,
        output: sum.output + values.output,
        cache: sum.cache + values.cache,
        uncached: sum.uncached + values.uncached,
      }
    },
    { input: 0, output: 0, cache: 0, uncached: 0 }
  )
  const label = t('contextEstimate', {
    used: input,
    budget,
    percent: Math.round((input / budget) * 100),
  })
  const draftTokens = estimateText(text)
  const draftLabel = t('contextEstimatedDraft', { tokens: draftTokens })
  const status = budgetStatus(input, budget)
  const summary = context?.summaries.find(
    (entry) => entry.id === context.activeSummaryId && appliesToHistory(entry, history)
  )
  const panel = (
    <section
      id={panelId}
      ref={floatingRef}
      {...(native && { popover: 'auto' })}
      className={styles.ringPanel}
      style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
      aria-label={t('contextInputUsage')}
    >
      <strong>{label}</strong>
      <p>{draftLabel}</p>
      {status !== 'within' && <p className={styles.budgetWarning}>{t('contextNearBudget')}</p>}
      {!ready && <p>{t('contextFallback')}</p>}
      {external && <p>{t('contextExternalEstimate')}</p>}
      <p>{t('contextUsage')}</p>
      <p>
        {rows.length
          ? `${t('contextUsageTotals', totals)} · ${t('contextUsageRequests', { count: rows.length })}`
          : t('contextNoUsage')}
      </p>
      {session && (
        <div className={styles.ringMemory}>
          <p>{t('contextRingMemories', { count: context?.memories.length ?? 0 })}</p>
          {summary && <p className={styles.ringSummary}>{summary.text}</p>}
          <button
            type="button"
            onClick={() => {
              if (native) {
                floatingRef.current?.hidePopover()
              }
              setOpen(false)
              openContextEditor(session.id)
            }}
          >
            {t('contextManageAction')}
          </button>
        </div>
      )}
    </section>
  )
  return (
    <>
      <small className={styles.draftCount} title={ready ? draftLabel : t('contextFallback')}>
        <span className={styles.draftLabel}>{draftLabel}</span>
        <span className={styles.draftShort} aria-hidden="true">
          {t('contextEstimatedDraftShort', { tokens: draftTokens })}
        </span>
      </small>
      <button
        ref={anchorRef}
        type="button"
        className={styles.ringButton}
        data-status={status}
        aria-label={t('contextInputUsage')}
        aria-description={label}
        aria-expanded={open}
        aria-controls={panelId}
        {...(native && { popovertarget: panelId })}
        onClick={native ? undefined : () => setOpen(!open)}
        title={label}
      >
        <span
          aria-hidden="true"
          className={styles.ring}
          style={{ '--used': `${Math.min(100, (input / budget) * 100)}%` } as CSSProperties}
        />
      </button>
      {(native || open) && createPortal(panel, document.body)}
    </>
  )
}

export const ReplyTokens = ({
  sessionId,
  reply,
}: {
  sessionId: string
  reply: AssistantMessage
}) => {
  const t = useTranslate()
  const records = useContextData((state) => state.usage)
  const rows = rowsFor(records, sessionId, reply.id)
  const legacy = reply.status === 'done' ? reply.usage : undefined
  if (!rows.length && !legacy) {
    return null
  }
  return (
    <details className={styles.replyUsage}>
      <summary>{t('contextUsage')}</summary>
      {rows.length ? (
        <ol>
          {rows.map((row) => (
            <li key={row.id}>{t('contextUsageTotals', usageTotals(row.usage))}</li>
          ))}
        </ol>
      ) : (
        legacy && (
          <p>
            {t('contextLegacyUsage')} · {t('contextUsageTotals', usageTotals(legacy))}
          </p>
        )
      )}
    </details>
  )
}
