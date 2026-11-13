// Procedural sound heard *inside* the suit. There is no air on the Moon, so nothing
// here is "outside" sound: breathing, bootfalls conducted through the suit and
// the suit's own joints. Chader Buri herself is text only.
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

class SuitAudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private breath: { source: AudioBufferSourceNode; gain: GainNode; timer: number } | null = null
  private unlocked = false
  enabled = false

  private context() {
    if (!this.enabled || typeof window === 'undefined') return null
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
      if (!Ctor) return null
      try { this.ctx = new Ctor() } catch { return null }
      this.master = this.ctx.createGain()
      this.master.gain.value = .55
      this.master.connect(this.ctx.destination)
      const length = this.ctx.sampleRate * 2, buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate), data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.noise = buffer
      this.listenForUnlock()
    }
    if (this.ctx.state === 'suspended' && this.unlocked) void this.ctx.resume().catch(() => {})
    return this.ctx.state === 'closed' ? null : this.ctx
  }

  /** Browsers start audio only after a gesture; walking keys and clicks count. */
  private listenForUnlock() {
    const unlock = () => {
      this.unlocked = true
      void this.ctx?.resume().catch(() => {})
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
    }
    if (navigator.userActivation?.hasBeenActive) unlock()
    else { window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true) }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend().catch(() => {})
      else if (this.enabled && this.unlocked) void this.ctx.resume().catch(() => {})
    })
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on) { this.setBreathing(false); void this.ctx?.suspend().catch(() => {}) }
    else this.context()
  }

  private burst(at: number, duration: number, filter: BiquadFilterType, frequency: number, level: number, q = .8) {
    const ctx = this.ctx!, source = ctx.createBufferSource(), shape = ctx.createBiquadFilter(), gain = ctx.createGain()
    source.buffer = this.noise; shape.type = filter; shape.frequency.value = frequency; shape.Q.value = q
    gain.gain.setValueAtTime(level, at); gain.gain.exponentialRampToValueAtTime(.0001, at + duration)
    source.connect(shape).connect(gain).connect(this.master!)
    source.start(at, Math.random() * 1.5, duration + .05)
  }

  private thump(at: number, from: number, to: number, duration: number, level: number) {
    const ctx = this.ctx!, osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = 'sine'; osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(to, at + duration)
    gain.gain.setValueAtTime(level, at); gain.gain.exponentialRampToValueAtTime(.0001, at + duration * 1.3)
    osc.connect(gain).connect(this.master!)
    osc.start(at); osc.stop(at + duration * 1.4)
  }

  /** A boot meeting regolith: a dull body-conducted thud and a soft crunch. */
  step() {
    const ctx = this.context(); if (!ctx || ctx.state !== 'running') return
    const at = ctx.currentTime + .01, vary = .85 + Math.random() * .3
    this.thump(at, 95 * vary, 42, .13, .22)
    this.burst(at, .09, 'lowpass', 520 * vary, .07)
  }

  /** Landing scales with impact speed (m/s). */
  land(impactMps: number) {
    const ctx = this.context(); if (!ctx || ctx.state !== 'running') return
    const at = ctx.currentTime + .01, force = Math.min(1.6, Math.max(.6, Math.abs(impactMps) / 1.6))
    this.thump(at, 80, 34, .2, .26 * force)
    this.burst(at, .16, 'lowpass', 420, .1 * force)
    this.burst(at + .03, .22, 'bandpass', 1400, .025, 1.2)
  }

  /** Suit fabric and joints flexing as you push off. */
  jump() {
    const ctx = this.context(); if (!ctx || ctx.state !== 'running') return
    const at = ctx.currentTime + .01
    this.burst(at, .28, 'bandpass', 1700, .04, 1.4)
    this.thump(at, 70, 50, .1, .08)
  }

  /** Slow, calm breathing inside the helmet: about 15 breaths a minute. */
  setBreathing(on: boolean) {
    if (!on) {
      if (this.breath) { clearInterval(this.breath.timer); try { this.breath.source.stop() } catch { /* already stopped */ } this.breath = null }
      return
    }
    const ctx = this.context(); if (!ctx || this.breath) return
    const source = ctx.createBufferSource(), shape = ctx.createBiquadFilter(), gain = ctx.createGain()
    source.buffer = this.noise; source.loop = true
    shape.type = 'bandpass'; shape.frequency.value = 620; shape.Q.value = .55
    gain.gain.value = 0
    source.connect(shape).connect(gain).connect(this.master!)
    source.start()
    const cycle = () => {
      if (!this.ctx || this.ctx.state !== 'running') return
      const t = this.ctx.currentTime + .05, g = gain.gain
      g.cancelScheduledValues(t); g.setValueAtTime(.0001, t)
      g.linearRampToValueAtTime(.022, t + .7); g.linearRampToValueAtTime(.006, t + 1.5)
      shape.frequency.setValueAtTime(700, t); shape.frequency.linearRampToValueAtTime(480, t + 3.2)
      g.linearRampToValueAtTime(.017, t + 2.1); g.linearRampToValueAtTime(.0001, t + 3.3)
    }
    cycle()
    this.breath = { source, gain, timer: window.setInterval(cycle, 4000) }
  }
}

export const suitAudio = new SuitAudioEngine()
