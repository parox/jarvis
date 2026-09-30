/** Language and failure handling shared by the browser voice recognizer. */
export function speechLanguage(configured: string | undefined, browserLanguage: string): string {
  for (const candidate of [configured?.trim(), browserLanguage, 'pt-BR']) {
    if (!candidate) continue
    try { return new Intl.Locale(candidate).toString() } catch { /* try the next choice */ }
  }
  return 'pt-BR'
}

export function speechServiceError(code: string): string | null {
  switch (code) {
    case 'network':
      return 'Chrome could not reach its speech recognition service. Check the network or VPN; microphone capture is working separately.'
    case 'language-not-supported':
      return 'Chrome does not support the selected speech language. Set VITE_SPEECH_LANGUAGE to pt-BR or another supported language and restart.'
    default: return null
  }
}
