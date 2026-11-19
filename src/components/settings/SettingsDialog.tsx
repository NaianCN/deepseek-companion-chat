import { BudgetSettings } from '../../features/context/BudgetSettings.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import type { HistorySource } from '../../services/chat/history/importArchive.js'
import type { CompanionData } from '../../features/backup/repository.js'
import { PersonaManager, PersonaSelect } from '../../features/persona/PersonaManager.js'
import type { ImportCount } from '../../services/chat/backup.js'
import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setLocale,
  setLocation,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const [managingPersonas, setManagingPersonas] = useState(false)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const companion = useCompanionBackup()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory || companion.busy
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyBusy && !companion.preview && !managingPersonas) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <SettingCell
                label={t('personaManage')}
                description={t('personaMemoriesSettings')}
                status={null}
                action={
                  <Button
                    size="m"
                    variant="outlined"
                    className={styles.cellButton}
                    onClick={() => setManagingPersonas(true)}
                  >
                    {t('personaManageAction')}
                  </Button>
                }
              />
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
              <BudgetSettings />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <CompanionBackupSettings backup={companion} disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {managingPersonas && (
        <PersonaManager
          onClose={() => setManagingPersonas(false)}
          onStartChat={() => {
            closeSettings()
            closeMobileSider()
          }}
        />
      )}
      {historyImport.preview ? (
        <ImportConfirm historyImport={historyImport} preview={historyImport.preview} />
      ) : null}
      {companion.preview && <CompanionRestoreConfirm backup={companion} data={companion.preview} />}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={
        <>
          {t('settingsLocation')} <span className={styles.settingTag}>{t('contextOptional')}</span>
        </>
      }
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={
        <>
          {t('settingsTtsVoice')} <span className={styles.settingTag}>{t('contextExtraCost')}</span>
        </>
      }
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          className={styles.voiceSelect}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

const ImportConfirm = ({
  historyImport,
  preview,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  preview: ImportCount
}) => {
  const t = useTranslate()
  const [personaId, setPersonaId] = useState('')
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button size="m" onClick={() => historyImport.confirm(personaId)}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>
        {t('historyImportConfirmDescription', preview)}
      </div>
      {preview.added > 0 && <PersonaSelect value={personaId} onChange={setPersonaId} />}
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: ReactNode
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

const useHistoryImport = () => {
  const t = useTranslate()
  const [preview, setPreview] = useState<ImportCount | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const decision = useRef<((value: { personaId: string | null } | null) => void) | null>(null)
  const finish = (value: { personaId: string | null } | null) => {
    decision.current?.(value)
    decision.current = null
    setPreview(null)
  }
  const select = async (source: HistorySource) => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await importHistory(
        source,
        (count) =>
          new Promise((resolve) => {
            decision.current = resolve
            setPreview(count)
          })
      )
      if (result) {
        setStatus({ key: 'historyImportedSummary', params: result })
      }
    } catch (error) {
      setStatus({
        key: 'historyImportFailed',
        ...(error instanceof BackupError
          ? { reason: error.key }
          : { params: { message: t('historyImportReadError') } }),
        error: true,
      })
    } finally {
      setBusy(false)
    }
  }
  return {
    preview,
    busy,
    status,
    select,
    cancel: () => finish(null),
    confirm: (personaId: string) => finish({ personaId: personaId || null }),
  }
}

const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const zipRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      className={styles.groupedRow}
      action={
        <div className={styles.cellActions}>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled}
            onClick={() => folderRef.current?.click()}
          >
            {t('historyChooseFolder')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled}
            onClick={() => zipRef.current?.click()}
          >
            {t('historyChooseZip')}
          </Button>
          <input
            ref={folderRef}
            type="file"
            {...{ webkitdirectory: '' }}
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length) {
                void historyImport.select(files)
              }
            }}
          />
          <input
            ref={zipRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void historyImport.select(file)
              }
            }}
          />
        </div>
      }
    />
  )
}

const downloadBackup = ({ name, blob }: { name: string; blob: Blob }) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const useCompanionBackup = () => {
  const [preview, setPreview] = useState<CompanionData | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setStatus(null)
    try {
      await operation()
    } catch {
      setStatus({ key: 'companionBackupFailed', error: true })
    } finally {
      setBusy(false)
    }
  }
  return {
    preview,
    busy,
    status,
    export: () =>
      run(async () => {
        const { exportCompanionBackup } = await import('../../features/backup/companion.js')
        downloadBackup(await exportCompanionBackup())
      }),
    select: (file: File) =>
      run(async () => {
        const { readCompanionBackup } = await import('../../features/backup/companion.js')
        setPreview(await readCompanionBackup(file))
      }),
    cancel: () => setPreview(null),
    restore: () =>
      run(async () => {
        if (!preview) {
          return
        }
        setPreview(null)
        const { restoreCompanionBackup } = await import('../../features/backup/companion.js')
        await restoreCompanionBackup(preview)
        setStatus({ key: 'companionBackupRestored' })
      }),
  }
}

const CompanionBackupSettings = ({
  backup,
  disabled,
}: {
  backup: ReturnType<typeof useCompanionBackup>
  disabled: boolean
}) => {
  const t = useTranslate()
  const input = useRef<HTMLInputElement>(null)
  return (
    <SettingCell
      label={t('companionBackup')}
      description={t('companionBackupDescription')}
      status={backup.status}
      className={styles.groupedRow}
      action={
        <div className={styles.cellActions}>
          <Button
            size="m"
            className={styles.cellButton}
            variant="outlined"
            disabled={disabled}
            onClick={() => void backup.export()}
          >
            {t('companionBackupDownload')}
          </Button>
          <Button
            size="m"
            className={styles.cellButton}
            variant="outlined"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            {t('companionBackupRestore')}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void backup.select(file)
              }
            }}
          />
        </div>
      }
    />
  )
}

const CompanionRestoreConfirm = ({
  backup,
  data,
}: {
  backup: ReturnType<typeof useCompanionBackup>
  data: CompanionData
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('companionBackupRestore')}
      className={styles.importConfirm}
      onClose={backup.cancel}
      footer={
        <>
          <Button size="m" variant="outlined" autoFocus onClick={backup.cancel}>
            {t('cancel')}
          </Button>
          <Button size="m" variant="danger" onClick={() => void backup.restore()}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      {t('companionBackupRestoreDescription', {
        sessions: data.sessions.length,
        personas: data.personas.length,
        files: data.files.length,
        interactions: data.interactions.length,
        contexts: data.contexts.length,
        usage: data.usage.length,
      })}
    </Modal>
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      downloadBackup(await exportHistory())
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
