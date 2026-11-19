import { create } from 'zustand'

export const useContextEditor = create<{ sessionId: string | null }>(() => ({ sessionId: null }))
export const openContextEditor = (sessionId: string) => useContextEditor.setState({ sessionId })
export const closeContextEditor = () => useContextEditor.setState({ sessionId: null })
