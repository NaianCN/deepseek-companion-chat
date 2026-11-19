export const personaFields = [
  'name',
  'description',
  'personality',
  'background',
  'speakingStyle',
  'relationship',
  'systemPrompt',
] as const

export type PersonaFields = Record<(typeof personaFields)[number], string>
export type PersonaDraft = PersonaFields & { avatar?: Blob }

export type Persona = PersonaDraft & {
  id: string
  memories?: string[]
  timeZone: string
  createdAt: number
  updatedAt: number
}

export type StoredPersona = Omit<Persona, 'avatar'> & {
  avatar?: Blob | { bytes: ArrayBuffer; type: string }
}

export type PersonaLink = { sessionId: string; personaId: string }

export type Interaction = {
  replyId: string
  sessionId: string
  personaId: string
  completedAt: number
}
