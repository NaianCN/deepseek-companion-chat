import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './persona.module.css'

export const PersonaDialog = ({
  title,
  tools,
  children,
  onClose,
}: {
  title: string
  tools?: ReactNode
  children: ReactNode
  onClose: () => void
}) => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    const initialFocus =
      dialog?.querySelector<HTMLElement>('[data-dialog-focus]') ?? dialog?.querySelector('h2')
    initialFocus?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])

  return createPortal(
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.dialogHeader}>
        <h2 id={titleId} tabIndex={-1}>
          {title}
        </h2>
        {tools}
      </div>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>,
    document.body
  )
}
