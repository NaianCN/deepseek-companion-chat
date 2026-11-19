import { CostControl } from '../../features/context/CostControl.js'
import { Spark } from '../../features/streak/Spark.js'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChevronDownOutline14,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  newChat,
  openPersonaSession,
  removeSession,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Avatar } from '../../features/persona/Avatar.js'
import { usePersonas } from '../../features/persona/store.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const { personas, links } = usePersonas()
  const personaId = links.find(({ sessionId }) => sessionId === activeId)?.personaId
  const profile = personas.find(({ id }) => id === personaId)
  const switchingBlocked = useChatStore((state) => !state.ready || state.importingHistory)
  const [switching, setSwitching] = useState(false)
  const switchRole = async (id?: string, createNew = false) => {
    setSwitching(true)
    try {
      if (id) {
        await openPersonaSession(id, createNew)
      } else {
        newChat()
      }
      closeMobileSider()
    } catch {
      showToast({ key: 'personaStorageError', type: 'error' })
    } finally {
      setSwitching(false)
    }
  }
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => {
    const roleBySession = new Map(links.map(({ sessionId, personaId }) => [sessionId, personaId]))
    return groupSessions(
      sessions.filter(({ id }) => roleBySession.get(id) === personaId),
      now,
      t
    )
  }, [personaId, links, sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        disabled={switchingBlocked || switching}
        onClick={() => void switchRole(profile?.id, true)}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      {personas.length > 0 && (
        <div className={styles.roleProfile}>
          <Avatar blob={profile?.avatar} name={profile?.name ?? t('personaUnbound')} />
          <strong className={styles.roleName} aria-hidden="true">
            {profile?.name ?? t('personaUnbound')}
          </strong>
          {profile && <Spark persona={profile} compact />}
          <span className={styles.roleChevron} aria-hidden="true">
            <IconChevronDownOutline14 />
          </span>
          <select
            aria-label={t('personaChoose')}
            value={profile?.id ?? ''}
            disabled={switchingBlocked || switching}
            onChange={(event) => void switchRole(event.currentTarget.value)}
          >
            <option value="">{t('personaUnbound')}</option>
            {personas.map(({ id, name }) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.length === 0 && <p className={styles.emptyFilter}>{t('historyFilterEmpty')}</p>}
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
        <CostControl />
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button
                autoFocus
                variant="outlined"
                disabled={deletePending}
                onClick={() => setDeleting(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          <strong className={styles.deleteTitle}>{deleting.title || t('untitledChat')}</strong>
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
