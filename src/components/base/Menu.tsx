import clsx from 'clsx'
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** 点击触发，向下展开；点外部或 Esc 关闭 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (props: {
    open: boolean
    id: string
    toggle: (event: MouseEvent<HTMLButtonElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  }) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const triggerId = useId()
  const enterOnOpen = useRef(false)
  const close = () => setOpen(false)
  // 菜单沿触发按钮右侧对齐。
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'end', offset: 4 }
  )
  useDismiss(open, [anchorRef, floatingRef], close)
  const focusFirst = () =>
    floatingRef.current?.querySelector('button')?.focus({ preventScroll: true })
  const positioned = position !== null
  useLayoutEffect(() => {
    if (open && positioned && enterOnOpen.current) {
      floatingRef.current?.querySelector('button')?.focus({ preventScroll: true })
      enterOnOpen.current = false
    }
  }, [open, positioned, floatingRef])

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({
          open,
          id: triggerId,
          toggle: (event) => {
            enterOnOpen.current = !open && event.detail === 0
            if (!open && event.detail !== 0) {
              event.currentTarget.focus({ preventScroll: true })
            }
            setOpen(!open)
          },
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (open) {
                focusFirst()
              } else {
                enterOnOpen.current = true
                setOpen(true)
              }
            }
          },
        })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? { visibility: 'hidden' }}
              role="menu"
              aria-labelledby={triggerId}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'Tab') {
                  event.stopPropagation()
                  close()
                  anchorRef.current?.querySelector('button')?.focus({ preventScroll: true })
                }
                if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault()
                  const items = [...event.currentTarget.querySelectorAll('button')]
                  const current = items.indexOf(document.activeElement as HTMLButtonElement)
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                          items.length
                  items[next]?.focus({ preventScroll: true })
                }
              }}
            >
              {options.map((option) => (
                <button
                  type="button"
                  key={option.key}
                  role="menuitem"
                  tabIndex={-1}
                  className={clsx(styles.option, option.danger && styles.danger)}
                  onClick={() => {
                    setOpen(false)
                    option.onSelect()
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
