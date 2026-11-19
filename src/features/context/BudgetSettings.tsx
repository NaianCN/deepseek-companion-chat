import { useState } from 'react'
import { IconChevronDownOutline14 } from '../../components/base/icons.js'
import { Button } from '../../components/base/Button.js'
import { showToast } from '../../components/base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { setContextBudgets, useSettings } from '../../services/settings.js'
import styles from './context.module.css'

export const BudgetSettings = () => {
  const t = useTranslate()
  const settings = useSettings()
  const [input, setInput] = useState(String(settings.inputBudget))
  const [output, setOutput] = useState(String(settings.outputBudget))
  const [action, setAction] = useState(settings.budgetAction)
  return (
    <form
      className={styles.budgetSettings}
      onSubmit={(event) => {
        event.preventDefault()
        setContextBudgets(Number(input), Number(output), action)
        showToast({ key: 'contextSettingsSaved' })
      }}
    >
      <h3>{t('contextModelBudget')}</h3>
      <label>
        {t('contextInputBudget')}
        <input
          type="number"
          required
          min={256}
          max={512000}
          step={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <label>
        {t('contextOutputBudget')}
        <input
          type="number"
          required
          min={256}
          max={128000}
          step={1}
          value={output}
          onChange={(event) => setOutput(event.target.value)}
        />
      </label>
      <label>
        {t('contextBudgetAction')}
        <span className={styles.budgetSelect}>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value === 'warn' ? 'warn' : 'pause')}
          >
            <option value="pause">{t('contextBudgetPause')}</option>
            <option value="warn">{t('contextBudgetWarn')}</option>
          </select>
          <IconChevronDownOutline14 />
        </span>
      </label>
      <Button size="s" type="submit">
        {t('confirm')}
      </Button>
    </form>
  )
}
