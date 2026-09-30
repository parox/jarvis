/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null

let opening: Promise<MediaStream> | null = null

/** Translate capture failures without calling every error a missing device. */
export function microphoneError(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
  switch (name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Microphone access blocked. Allow it for this site and for Chrome in macOS System Settings → Privacy & Security → Microphone.'
    case 'NotFoundError':
      return 'No audio input detected. Select a working microphone in macOS System Settings → Sound → Input.'
    case 'NotReadableError': case 'AbortError':
      return 'Microphone could not start. Check the selected input device, close other recording apps, then reload.'
    case 'NotSupportedError':
      return 'Audio capture is unavailable here. Open http://127.0.0.1:5173 directly in Chrome or Edge.'
    case 'OverconstrainedError':
      return 'The selected microphone does not support the requested audio settings. Select another input device.'
    default:
      return `Microphone capture failed${name ? ` (${name})` : ''}. Check browser and system microphone permissions.`
  }
}

export async function getMic(): Promise<MediaStream> {
  if (stream?.getAudioTracks().some((track) => track.readyState === 'live')) return stream
  stream = null
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Audio capture unsupported', 'NotSupportedError')
  // Share concurrent requests; discard stopped streams so a retry can recover.
  if (!opening) opening = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).then((next) => { stream = next; return next }).finally(() => { opening = null })
  return opening
}

export async function startAnalyser(): Promise<void> {
  if (analyser) return
  const s = await getMic()
  ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}
