export {}

declare global {
  interface Window {
    ody: {
      invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>
      on(listener: (channel: string, payload: unknown) => void): () => void
    }
  }
}
