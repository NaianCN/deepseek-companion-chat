import { useEffect, useState } from 'react'
import { isAvatar } from './repository.js'
import styles from './persona.module.css'

export const decodeAvatar = async (source: Blob) => {
  if (!isAvatar(source)) {
    throw new Error('Invalid avatar metadata')
  }

  // Copy the bytes so persisted and displayed avatars do not depend on the file picker or IndexedDB's backing file.
  const blob = new Blob([await source.arrayBuffer()], { type: source.type })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { blob, url }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export const Avatar = ({ blob, name }: { blob?: Blob; name: string }) => {
  const [preview, setPreview] = useState<{ source: Blob; url: string }>()
  useEffect(() => {
    setPreview(undefined)
    if (!blob) {
      return
    }
    let disposed = false
    let url: string | undefined
    void decodeAvatar(blob).then(
      (image) => {
        if (disposed) {
          URL.revokeObjectURL(image.url)
          return
        }
        url = image.url
        setPreview({ source: blob, url })
      },
      () => {
        // Keep the initial visible when a stored avatar can no longer be read or decoded.
      }
    )
    return () => {
      disposed = true
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [blob])

  if (preview && preview.source === blob) {
    const { url } = preview
    return (
      <img
        className={styles.avatar}
        src={url}
        alt=""
        onError={() => setPreview((current) => (current?.url === url ? undefined : current))}
      />
    )
  }
  return (
    <span className={styles.avatar} aria-hidden="true">
      {Array.from(name)[0] || '·'}
    </span>
  )
}
