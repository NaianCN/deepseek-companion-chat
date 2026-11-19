import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/base/Button.js'
import { showToast } from '../../components/base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { createId } from '../../utils/id.js'
import { promoteSessionMemory } from '../persona/repository.js'
import { refreshPersonas, usePersonas } from '../persona/store.js'
import { PersonaDialog } from '../persona/PersonaDialog.js'
import { appliesToHistory, messageText, olderMessages } from './assemble.js'
import { assistContext } from './assist.js'
import { closeContextEditor, useContextEditor } from './editorState.js'
import { useTokenizerReady } from './estimate.js'
import { saveSessionContext } from './repository.js'
import { emptyContext, type SessionContext, type SummaryVersion } from './types.js'
import { useContextInputs } from './TokenViews.js'
import styles from './context.module.css'

type Candidate = { id: string; text: string; keep: boolean }

export const ContextEditorHost = ({ session }: { session?: Session }) => {
  const selected = useContextEditor((state) => state.sessionId)
  const activeId = useChatStore((state) => state.activeId)
  useEffect(() => {
    if (selected && selected !== activeId) {
      closeContextEditor()
    }
  }, [activeId, selected])
  return selected && session?.id === selected ? (
    <ContextEditor key={selected} session={session} />
  ) : null
}

const ContextEditor = ({ session }: { session: Session }) => {
  const t = useTranslate()
  useTokenizerReady()
  const { context, history, estimate } = useContextInputs(session)
  // 保留打开时的版本。多窗同时编辑时由仓储拒绝旧版本覆盖。
  const [base] = useState<SessionContext>(() => context ?? emptyContext(session.id))
  const [recent, setRecent] = useState(6)
  const [version, setVersion] = useState('')
  const [summary, setSummary] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>(() =>
    base.memories.map((text) => ({ id: createId(), text, keep: true }))
  )
  const source = olderMessages(history, recent)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController>()
  const locked = useChatStore(
    (state) => state.importingHistory || Boolean(state.streaming[session.id])
  )
  const persona = usePersonas(({ links, personas }) => {
    const link = links.find(({ sessionId }) => sessionId === session.id)
    return personas.find(({ id }) => id === link?.personaId)
  })
  const promote = async (text: string) => {
    if (!persona) {
      return
    }
    setBusy(true)
    setSaving(true)
    setError(false)
    try {
      await promoteSessionMemory(session.id, persona.id, text)
      await refreshPersonas()
      showToast({ key: 'contextMemoryPromoted' })
    } catch {
      setError(true)
    } finally {
      setSaving(false)
      setBusy(false)
    }
  }
  useEffect(() => () => controller.current?.abort(), [])

  const memories = [
    ...new Set(
      [...candidates.filter(({ keep }) => keep).map(({ text }) => text.trim())].filter(Boolean)
    ),
  ]
  const previous = base.summaries.find(({ id }) => id === version)
  const sourceIds = previous?.sourceIds ?? source.map(({ id }) => id)
  const next: SummaryVersion | undefined =
    summary.trim() && sourceIds.length
      ? { id: previous?.id ?? 'preview', sourceIds, text: summary.trim(), createdAt: Date.now() }
      : undefined
  const wrongBranch = next !== undefined && !appliesToHistory(next, history)
  const before = estimate(base).input
  const after = estimate({
    ...base,
    memories,
    activeSummaryId: next?.id ?? base.activeSummaryId,
    summaries: next ? [...base.summaries.filter(({ id }) => id !== next.id), next] : base.summaries,
  }).input

  const updateCandidate = (id: string, change: Partial<Candidate>) =>
    setCandidates((items) => items.map((item) => (item.id === id ? { ...item, ...change } : item)))

  const run = async (task: 'summary' | 'memory') => {
    const abort = new AbortController()
    controller.current = abort
    setError(false)
    setBusy(true)
    try {
      const result = await assistContext(session.id, task, source, abort.signal)
      if (task === 'summary') {
        setVersion('')
        setSummary(result)
      } else {
        const suggestions = result
          .split('\n')
          .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])?\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 48)
        setCandidates((previous) => [
          ...previous,
          ...suggestions.map((text) => ({
            id: createId(),
            text,
            keep: false,
          })),
        ])
      }
    } catch {
      if (!abort.signal.aborted) {
        setError(true)
      }
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false)
      }
    }
  }

  const commit = async (action: 'memories' | 'summary' | 'full') => {
    setSaving(true)
    setBusy(true)
    setError(false)
    try {
      const pending = { ...base }
      if (action === 'full') {
        delete pending.activeSummaryId
      } else {
        pending.memories = memories
      }
      if (action === 'summary' && next && !wrongBranch) {
        const reuse = previous && previous.text === next.text
        const item = reuse ? previous : { ...next, id: createId() }
        pending.activeSummaryId = item.id
        if (!reuse) {
          pending.summaries = [...base.summaries, item]
        }
      }
      await saveSessionContext(pending)
      closeContextEditor()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
      setSaving(false)
    }
  }

  const cancel = () => {
    if (!saving) {
      closeContextEditor()
    }
  }

  return (
    <PersonaDialog title={t('contextHeading')} onClose={cancel}>
      <div className={styles.editor} aria-busy={busy}>
        <div className={styles.editorTools}>
          <label>
            {t('contextKeepRounds')}
            <input
              type="number"
              min={1}
              max={100}
              value={recent}
              disabled={busy}
              onChange={(event) => {
                setRecent(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
                setVersion('')
                setSummary('')
              }}
            />
          </label>
          <span>
            {source.length
              ? t('contextSummaryRange', { count: source.length })
              : t('contextNoOlder')}
          </span>
        </div>
        {source.length > 0 && (
          <details className={styles.messagePicker}>
            <summary>{t('contextSelectOlder')}</summary>
            <div className={styles.pickerList}>
              {source.map((message) => {
                const text = messageText(message)
                const candidateId = `message:${message.id}`
                const entry = candidates.find(({ id }) => id === candidateId)
                return (
                  <label key={message.id}>
                    <input
                      type="checkbox"
                      checked={entry?.keep ?? false}
                      disabled={!text || busy}
                      onChange={(event) => {
                        const keep = event.target.checked
                        if (entry) {
                          updateCandidate(candidateId, { keep })
                        } else if (keep) {
                          setCandidates((previous) => [
                            ...previous,
                            { id: candidateId, text, keep },
                          ])
                        }
                      }}
                    />
                    <span>
                      <strong>
                        {t(message.role === 'user' ? 'contextUser' : 'contextAssistant')}
                      </strong>{' '}
                      {text}
                    </span>
                  </label>
                )
              })}
            </div>
          </details>
        )}
        <section className={styles.editorSection}>
          <div className={styles.editorTools}>
            <h3>{t('contextMemoryHeading')}</h3>
            <Button
              variant="outlined"
              size="s"
              disabled={busy}
              onClick={() =>
                setCandidates([...candidates, { id: createId(), text: '', keep: true }])
              }
            >
              {t('contextAddMemory')}
            </Button>
            <Button
              variant="outlined"
              size="s"
              disabled={locked || busy || !source.length}
              onClick={() => void run('memory')}
            >
              {t('contextExtract')}
            </Button>
          </div>
          {candidates.map((item, index) => (
            <div className={styles.memoryRow} key={item.id}>
              <input
                type="checkbox"
                checked={item.keep}
                disabled={busy}
                aria-label={t('contextMemorySelect', { count: index + 1 })}
                onChange={(event) => updateCandidate(item.id, { keep: event.target.checked })}
              />
              <textarea
                rows={2}
                value={item.text}
                disabled={busy}
                aria-label={t('contextMemoryItem', { count: index + 1 })}
                onChange={(event) => updateCandidate(item.id, { text: event.target.value })}
              />
              <div className={styles.memoryActions}>
                {persona && (
                  <Button
                    size="s"
                    variant="outlined"
                    disabled={
                      locked ||
                      busy ||
                      !item.keep ||
                      !item.text.trim() ||
                      persona.memories?.includes(item.text.trim())
                    }
                    onClick={() => void promote(item.text)}
                  >
                    {t(
                      persona.memories?.includes(item.text.trim())
                        ? 'contextMemoryPromoted'
                        : 'contextPromoteMemory'
                    )}
                  </Button>
                )}
                <Button
                  size="s"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => setCandidates(candidates.filter(({ id }) => id !== item.id))}
                >
                  {t('delete')}
                </Button>
              </div>
            </div>
          ))}
        </section>
        <section className={styles.editorSection}>
          <div className={styles.editorTools}>
            <h3>{t('contextSummary')}</h3>
            <Button
              size="s"
              variant="outlined"
              disabled={locked || busy || !source.length}
              onClick={() => void run('summary')}
            >
              {t('contextGenerate')}
            </Button>
          </div>
          {base.summaries.length > 0 && (
            <label>
              {t('contextChooseVersion')}
              <select
                value={version}
                disabled={busy}
                onChange={(event) => {
                  const id = event.target.value
                  setVersion(id)
                  setSummary(base.summaries.find((item) => item.id === id)?.text ?? '')
                }}
              >
                <option value="">{t('contextVersionNew')}</option>
                {base.summaries.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {index + 1} · {t('contextSummaryRange', { count: item.sourceIds.length })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <textarea
            rows={4}
            aria-label={t('contextSummary')}
            value={summary}
            disabled={busy}
            onChange={(event) => setSummary(event.target.value)}
          />
          {wrongBranch ? (
            <small role="status">{t('contextWrongBranch')}</small>
          ) : (
            next && (
              <small role="status">
                {t('contextPreview', { before, after, saved: before - after })}
              </small>
            )
          )}
          <small>{t('contextFeeNotice')}</small>
        </section>
        {busy && <p role="status">{t('contextBusy')}</p>}
        {error && <p role="alert">{t('contextEditorFailed')}</p>}
        <div className={styles.editorActions}>
          <Button size="s" variant="outlined" disabled={saving} onClick={cancel}>
            {t('cancel')}
          </Button>
          {base.activeSummaryId && (
            <Button
              size="s"
              variant="outlined"
              disabled={locked || busy}
              onClick={() => void commit('full')}
            >
              {t('contextRestoreFull')}
            </Button>
          )}
          <Button
            size="s"
            variant="outlined"
            disabled={locked || busy}
            onClick={() => void commit('memories')}
          >
            {t('contextSaveMemories')}
          </Button>
          <Button
            size="s"
            disabled={locked || busy || !next || wrongBranch}
            onClick={() => void commit('summary')}
          >
            {t('contextApply')}
          </Button>
        </div>
      </div>
    </PersonaDialog>
  )
}
