export {}

declare global {
  interface Window {
    ody: {
      pathForFile(file: File): string
      invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>
      repo<T = unknown>(root: string, method: string, ...args: unknown[]): Promise<T>
      on(listener: (channel: string, payload: unknown) => void): () => void
    }
  }
}
