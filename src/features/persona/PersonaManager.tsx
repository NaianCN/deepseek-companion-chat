import { Spark } from '../streak/Spark.js'
import { useId, useRef, useState } from 'react'
import { Button } from '../../components/base/Button.js'
import { showToast } from '../../components/base/toastState.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { openPersonaSession, useChatStore } from '../../services/chat/store.js'
import { avatarTypes, deletePersona, savePersona, savePersonaMemories } from './repository.js'
import { Avatar, decodeAvatar } from './Avatar.js'
import { PersonaDialog } from './PersonaDialog.js'
import { refreshPersonas, usePersonas } from './store.js'
import { createId } from '../../utils/id.js'
import { personaFields, type Persona, type PersonaDraft } from './types.js'
import styles from './persona.module.css'

const fieldLabels: Record<(typeof personaFields)[number], TranslationKey> = {
  name: 'personaFieldName',
  description: 'personaFieldDescription',
  personality: 'personaFieldPersonality',
  background: 'personaFieldBackground',
  speakingStyle: 'personaFieldSpeakingStyle',
  relationship: 'personaFieldRelationship',
  systemPrompt: 'personaFieldSystemPrompt',
}

const emptyDraft: PersonaDraft = {
  name: '',
  description: '',
  personality: '',
  background: '',
  speakingStyle: '',
  relationship: '',
  systemPrompt: '',
}

const notifyError = () => showToast({ key: 'personaStorageError', type: 'error' })

export const PersonaManager = ({
  onClose,
  onStartChat,
}: {
  onClose: () => void
  onStartChat: () => void
}) => {
  const t = useTranslate()
  const personas = usePersonas((state) => state.personas)
  const dataBusy = useChatStore((state) => state.importingHistory)
  const chatReady = useChatStore((state) => state.ready)
  const [mode, setMode] = useState<
    { type: 'edit'; id?: string } | { type: 'delete' | 'memory'; id: string }
  >()
  const memoryPersona =
    mode?.type === 'memory' ? personas.find(({ id }) => id === mode.id) : undefined
  const [draft, setDraft] = useState(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [avatarStatus, setAvatarStatus] = useState<'idle' | 'checking' | 'invalid'>('idle')
  const avatarSelection = useRef(0)
  const avatarErrorId = useId()

  const resetAvatarSelection = () => {
    avatarSelection.current += 1
    setAvatarStatus('idle')
  }
  const selectAvatar = async (file: File) => {
    const selection = ++avatarSelection.current
    setAvatarStatus('checking')
    try {
      const { blob, url } = await decodeAvatar(file)
      URL.revokeObjectURL(url)
      if (avatarSelection.current === selection) {
        setDraft((current) => ({ ...current, avatar: blob }))
        setAvatarStatus('idle')
      }
    } catch {
      if (avatarSelection.current === selection) {
        setAvatarStatus('invalid')
      }
    }
  }

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } catch {
      notifyError()
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    if (busy) {
      return
    }
    if (mode) {
      resetAvatarSelection()
      setMode(undefined)
    } else {
      onClose()
    }
  }

  const startChat = (id: string, createNew: boolean) =>
    void run(async () => {
      await openPersonaSession(id, createNew)
      onStartChat()
    })

  return (
    <PersonaDialog
      key={mode?.type ?? 'list'}
      title={t(
        mode?.type === 'delete'
          ? 'personaDelete'
          : mode?.type === 'edit'
            ? mode.id
              ? 'personaEdit'
              : 'personaNew'
            : mode?.type === 'memory'
              ? 'personaMemories'
              : 'personaManage'
      )}
      onClose={close}
      tools={
        !mode && (
          <div className={styles.dialogTools}>
            <Button
              size="m"
              disabled={dataBusy || busy}
              onClick={() => {
                setDraft(emptyDraft)
                resetAvatarSelection()
                setMode({ type: 'edit' })
              }}
            >
              {t('personaNew')}
            </Button>
            <Button size="m" variant="outlined" disabled={busy} onClick={close}>
              {t('close')}
            </Button>
          </div>
        )
      }
    >
      {mode?.type === 'memory' ? (
        memoryPersona && (
          <PersonaMemoryForm
            persona={memoryPersona}
            busy={busy || dataBusy}
            close={close}
            save={(base, entries) =>
              void run(async () => {
                await savePersonaMemories(memoryPersona.id, base, entries)
                await refreshPersonas()
                setMode(undefined)
              })
            }
          />
        )
      ) : mode?.type === 'edit' ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            if (avatarStatus === 'checking' || dataBusy || busy) {
              return
            }
            void run(async () => {
              await savePersona(draft, mode.id)
              await refreshPersonas()
              setMode(undefined)
            })
          }}
        >
          <div className={styles.identity}>
            <Avatar blob={draft.avatar} name={draft.name} />
            <label>
              {t('personaAvatar')}
              <input
                type="file"
                accept={avatarTypes.join(',')}
                aria-invalid={avatarStatus === 'invalid'}
                aria-describedby={avatarStatus === 'invalid' ? avatarErrorId : undefined}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) {
                    void selectAvatar(file)
                  }
                }}
              />
            </label>
            {draft.avatar && (
              <Button
                size="s"
                variant="outlined"
                onClick={() => {
                  resetAvatarSelection()
                  setDraft((current) => ({ ...current, avatar: undefined }))
                }}
              >
                {t('personaAvatarRemove')}
              </Button>
            )}
          </div>
          {avatarStatus === 'invalid' && (
            <p id={avatarErrorId} role="alert">
              {t('personaAvatarInvalid')}
            </p>
          )}
          {personaFields.map((field) => (
            <label key={field}>
              {t(fieldLabels[field])}
              {field === 'name' ? (
                <input
                  data-dialog-focus
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              ) : (
                <textarea
                  rows={2}
                  maxLength={8000}
                  value={draft[field]}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              )}
            </label>
          ))}
          <div className={styles.actions}>
            <Button variant="outlined" size="m" disabled={busy} onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              size="m"
              type="submit"
              disabled={dataBusy || busy || avatarStatus === 'checking' || !draft.name.trim()}
            >
              {t('confirm')}
            </Button>
          </div>
        </form>
      ) : mode?.type === 'delete' ? (
        <>
          <p>{t('personaDeleteDescription')}</p>
          <div className={styles.actions}>
            <Button data-dialog-focus variant="outlined" size="m" disabled={busy} onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              size="m"
              disabled={dataBusy || busy}
              onClick={() =>
                void run(async () => {
                  await deletePersona(mode.id)
                  await refreshPersonas()
                  setMode(undefined)
                })
              }
            >
              {t('delete')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.list}>
            {personas.map((persona) => (
              <article className={styles.card} key={persona.id}>
                <div className={styles.identity}>
                  <Avatar blob={persona.avatar} name={persona.name} />
                  <div>
                    <strong>{persona.name}</strong>
                    {persona.description && <p>{persona.description}</p>}
                  </div>
                </div>
                <div className={styles.cardActions}>
                  <Button
                    size="s"
                    disabled={dataBusy || busy || !chatReady}
                    onClick={() => startChat(persona.id, false)}
                  >
                    {t('personaOpen')}
                  </Button>
                  <Button
                    size="s"
                    variant="outlined"
                    disabled={dataBusy || busy || !chatReady}
                    onClick={() => startChat(persona.id, true)}
                  >
                    {t('personaNewChat')}
                  </Button>
                  <Button
                    size="s"
                    variant="outlined"
                    disabled={dataBusy || busy}
                    onClick={() => {
                      setDraft(persona)
                      resetAvatarSelection()
                      setMode({ type: 'edit', id: persona.id })
                    }}
                  >
                    {t('personaEdit')}
                  </Button>
                  <Button
                    size="s"
                    variant="outlined"
                    disabled={dataBusy || busy}
                    onClick={() => setMode({ type: 'memory', id: persona.id })}
                  >
                    {t('personaMemories')}
                  </Button>
                  <Button
                    size="s"
                    variant="dangerOutlined"
                    disabled={dataBusy || busy}
                    onClick={() => setMode({ type: 'delete', id: persona.id })}
                  >
                    {t('personaDelete')}
                  </Button>
                </div>
                <Spark persona={persona} showCalendar />
              </article>
            ))}
          </div>
        </>
      )}
    </PersonaDialog>
  )
}

const PersonaMemoryForm = ({
  persona,
  busy,
  close,
  save,
}: {
  persona: Persona
  busy: boolean
  close: () => void
  save: (base: readonly string[], entries: readonly string[]) => void
}) => {
  const t = useTranslate()
  const [base] = useState(() => persona.memories ?? [])
  const [entries, setEntries] = useState(() => base.map((text) => ({ id: createId(), text })))
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        save(
          base,
          entries.map(({ text }) => text)
        )
      }}
    >
      <p>{t('personaMemoriesDescription', { name: persona.name })}</p>
      {entries.map((entry, index) => (
        <div className={styles.memoryEntry} key={entry.id}>
          <label htmlFor={entry.id}>
            {t('contextMemoryItem', { count: index + 1 })}
            <textarea
              id={entry.id}
              rows={2}
              value={entry.text}
              disabled={busy}
              onChange={(event) => {
                const text = event.currentTarget.value
                setEntries((items) =>
                  items.map((item) => (item.id === entry.id ? { ...item, text } : item))
                )
              }}
            />
          </label>
          <Button
            size="s"
            variant="outlined"
            disabled={busy}
            aria-label={t('personaDeleteMemory', { count: index + 1 })}
            onClick={() => setEntries((items) => items.filter(({ id }) => id !== entry.id))}
          >
            {t('delete')}
          </Button>
        </div>
      ))}
      <div className={styles.actions}>
        <Button
          size="s"
          variant="outlined"
          disabled={busy}
          onClick={() => setEntries((items) => [...items, { id: createId(), text: '' }])}
        >
          {t('contextAddMemory')}
        </Button>
        <Button size="s" variant="outlined" disabled={busy} onClick={close}>
          {t('cancel')}
        </Button>
        <Button size="s" type="submit" disabled={busy}>
          {t('confirm')}
        </Button>
      </div>
    </form>
  )
}

export const PersonaSelect = ({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) => {
  const t = useTranslate()
  const personas = usePersonas((state) => state.personas)
  return (
    <label className={styles.binding}>
      {t('personaBinding')}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('personaUnbound')}</option>
        {personas.map(({ id, name }) => (
          <option value={id} key={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}
