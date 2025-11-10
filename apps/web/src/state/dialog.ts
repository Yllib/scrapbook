import { create } from 'zustand'

export type ConfirmDialogVariant = 'default' | 'danger'

export interface ConfirmDialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmDialogVariant
}

interface ConfirmDialogState {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  variant: ConfirmDialogVariant
  isOpen: boolean
  resolver: ((result: boolean) => void) | null
  requestConfirm: (options: ConfirmDialogOptions) => Promise<boolean>
  confirm: () => void
  cancel: () => void
}

const defaultDialogState = {
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'default' as ConfirmDialogVariant,
  isOpen: false,
  resolver: null,
}

export const useDialogStore = create<ConfirmDialogState>((set, get) => ({
  ...defaultDialogState,
  requestConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      const { resolver } = get()
      if (resolver) {
        resolver(false)
      }
      set((state) => ({
        ...state,
        ...defaultDialogState,
        ...options,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        variant: options.variant ?? 'default',
        isOpen: true,
        resolver: resolve,
      }))
    }),
  confirm: () => {
    const { resolver } = get()
    resolver?.(true)
    set((state) => ({
      ...state,
      ...defaultDialogState,
    }))
  },
  cancel: () => {
    const { resolver } = get()
    resolver?.(false)
    set((state) => ({
      ...state,
      ...defaultDialogState,
    }))
  },
}))

export const requestConfirmation = (options: ConfirmDialogOptions) => useDialogStore.getState().requestConfirm(options)
