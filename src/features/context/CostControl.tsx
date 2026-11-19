import { useEffect, useState } from 'react'
import { Button } from '../../components/base/Button.js'
import { useTranslate } from '../../i18n/index.js'
import { API_ORIGIN, request } from '../../services/api/client.js'
import { useSettings } from '../../services/settings.js'
import { PersonaDialog } from '../persona/PersonaDialog.js'
import { formatMoney, spending } from './pricing.js'
import { useContextData } from './repository.js'
import styles from './context.module.css'

const ranges = [1, 7, 30] as const
type Range = (typeof ranges)[number]
type Balance = { currency: 'CNY' | 'USD'; total_balance: string }

const validBalance = (value: unknown): value is Balance =>
  typeof value === 'object' &&
  value !== null &&
  'currency' in value &&
  (value.currency === 'CNY' || value.currency === 'USD') &&
  'total_balance' in value &&
  typeof value.total_balance === 'string' &&
  /^-?\d+(?:\.\d+)?$/.test(value.total_balance)

const loadBalance = async (apiKey: string, signal: AbortSignal) => {
  const response = await request(`${API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  const value: { balance_infos?: unknown } = await response.json()
  return Array.isArray(value?.balance_infos) ? value.balance_infos.filter(validBalance) : []
}

const rangeKey = 'chat-demo:spending-range'
const initialRange = (): Range => {
  try {
    const value = Number(localStorage.getItem(rangeKey))
    return value === 1 || value === 30 ? value : 7
  } catch {
    return 7
  }
}

export const CostControl = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const records = useContextData((state) => state.usage)
  const [days, setDays] = useState<Range>(initialRange)
  const [alternate, setAlternate] = useState(false)
  const [balance, setBalance] = useState<Balance[]>([])
  const [opened, setOpened] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setAlternate((current) => !current)
      }
    }, 7000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setBalance([])
    if (!apiKey) {
      return
    }
    const controller = new AbortController()
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void loadBalance(apiKey, controller.signal)
          .then((items) => {
            if (!controller.signal.aborted) {
              setBalance(items)
            }
          })
          .catch(() => {})
      }
    }
    refresh()
    const timer = setInterval(refresh, 120_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [apiKey, opened])

  const changeRange = (range: Range) => {
    setDays(range)
    setAlternate(true)
    try {
      localStorage.setItem(rangeKey, String(range))
    } catch {
      // 统计范围仍保留在当前窗口。
    }
  }

  const { chat, tts, total } = spending(records, days)
  const balanceText = balance
    .map(({ currency, total_balance }) => `${currency === 'CNY' ? '¥' : '$'}${total_balance}`)
    .join(' / ')
  return (
    <>
      <button
        type="button"
        className={styles.costButton}
        aria-label={t('contextCostHeading')}
        onClick={() => setOpened(true)}
      >
        <small>{alternate ? t('contextSpend', { days }) : t('contextBalance')}</small>
        <strong>{alternate ? formatMoney(total) : balanceText || '—'}</strong>
      </button>
      {opened && (
        <PersonaDialog title={t('contextCostHeading')} onClose={() => setOpened(false)}>
          <div className={styles.bill}>
            <div className={styles.billHeadline}>
              <span>{t('contextBalance')}</span>
              <strong>{balanceText || t('contextBalanceUnavailable')}</strong>
            </div>
            <div className={styles.billRanges} role="group" aria-label={t('contextBillRange')}>
              {ranges.map((range) => (
                <button
                  type="button"
                  key={range}
                  aria-pressed={days === range}
                  onClick={() => changeRange(range)}
                >
                  {t('contextDays', { days: range })}
                </button>
              ))}
            </div>
            <dl>
              <dt>{t('contextSpendLocal')}</dt>
              <dd>{formatMoney(total)}</dd>
              <dt>{t('contextModelCost')}</dt>
              <dd>{formatMoney(chat)}</dd>
              <dt>{t('contextTTSCost')}</dt>
              <dd>{formatMoney(tts)}</dd>
            </dl>
            <small>{t('contextCostScope')}</small>
            <div className={styles.editorActions}>
              <Button size="m" variant="outlined" onClick={() => setOpened(false)}>
                {t('close')}
              </Button>
            </div>
          </div>
        </PersonaDialog>
      )}
    </>
  )
}
