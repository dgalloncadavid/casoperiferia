import type { Mensaje } from "../llm/adapter"

export interface VistaLlamada {
  nombre: string
  args: Record<string, unknown>
  ok: boolean
  resumen: string
}

export interface Pendiente {
  caso: string
  accion: "simular_envio"
}

export interface EntradaChat {
  rol: "user" | "assistant"
  texto: string
  ts: string
  toolCalls?: VistaLlamada[]
  needsConfirmation?: boolean
  aviso?: string
}

export interface Sesion {
  id: string
  creada: string
  /** Solo texto de usuario y asistente entre turnos (las herramientas se reejecutan si hace falta). */
  mensajes: Mensaje[]
  historial: EntradaChat[]
  pendiente?: Pendiente
  tokens: number
  /** true cuando la sesión superó su tope de tokens. */
  sinModelo?: boolean
}

export interface RespuestaChat {
  sessionId: string
  reply: string
  toolCalls: VistaLlamada[]
  needsConfirmation: boolean
  pendiente?: Pendiente
  modo: "modelo" | "sin_modelo"
  aviso?: string
  proveedor?: string
  modelo?: string
  fechaReferencia: string
}
