import { create } from 'zustand'

export type ToastVariant = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'> & { id?: string }) => string
  dismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 4000

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ id, title, description, variant = 'info' }) => {
    const toastId = id ?? crypto.randomUUID()
    set((prev) => ({ toasts: [...prev.toasts, { id: toastId, title, description, variant }] }))
    window.setTimeout(() => {
      const exists = get().toasts.find((t) => t.id === toastId)
      if (exists) get().dismiss(toastId)
    }, AUTO_DISMISS_MS)
    return toastId
  },
  dismiss: (toastId) => set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== toastId) })),
}))

export const toast = {
  info(title: string, description?: string) {
    return useToastStore.getState().push({ title, description, variant: 'info' })
  },
  success(title: string, description?: string) {
    return useToastStore.getState().push({ title, description, variant: 'success' })
  },
  error(title: string, description?: string) {
    return useToastStore.getState().push({ title, description, variant: 'error' })
  },
  dismiss(id: string) {
    useToastStore.getState().dismiss(id)
  },
}
