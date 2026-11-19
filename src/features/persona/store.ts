import { create } from 'zustand'
import { loadPersonas } from './repository.js'

export const usePersonas = create<Awaited<ReturnType<typeof loadPersonas>>>(() => ({
  personas: [],
  links: [],
  interactions: [],
}))

let revision = 0
export const refreshPersonas = async () => {
  const current = ++revision
  const state = await loadPersonas()
  if (current === revision) {
    usePersonas.setState(state)
  }
}
