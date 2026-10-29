/** All durations and timestamps are in milliseconds. */
export const FLOWS = Object.freeze([
  { id: 'examiner', name: '考官循環計時', repeat: true, phases: [
    { id: 'reading', label: '換站・讀題', durationMs: 60000 },
    { id: 'exam', label: '作答時間', durationMs: 480000 },
    { id: 'feedback', label: '回饋時間', durationMs: 120000 }
  ] },
  { id: 'exam-transition', name: '作答 8 分鐘＋轉場 2 分鐘', phases: [
    { id: 'exam', label: '作答時間', durationMs: 480000 },
    { id: 'transition', label: '轉場時間', durationMs: 120000 }
  ] },
  { id: 'reading-exam', name: '讀題 2 分鐘＋作答 8 分鐘', phases: [
    { id: 'reading', label: '讀題時間', durationMs: 120000 },
    { id: 'exam', label: '作答時間', durationMs: 480000 }
  ] },
  { id: 'continuous', name: '考試 10 分鐘・第 8 分鐘提醒', phases: [
    { id: 'exam', label: '作答時間', durationMs: 600000 }
  ] }
].map(flow => Object.freeze({ ...flow, phases: Object.freeze(flow.phases.map(Object.freeze)) })));

const STATES = ['idle', 'running', 'paused', 'finished'];
const clock = now => {
  if (!Number.isFinite(now)) throw new TypeError('Timestamp must be finite');
  return now;
};

export class ExamTimer {
  constructor(flowId = 'exam-transition') {
    this.flow = this._findFlow(flowId);
    this.reset();
  }

  _findFlow(id) {
    const flow = FLOWS.find(item => item.id === id);
    if (!flow) throw new RangeError('Unknown timer flow');
    return flow;
  }

  start(now = Date.now()) {
    clock(now);
    if (this.status === 'idle' || this.status === 'paused') {
      this._startedAt = now;
      this.status = 'running';
    }
    return this.snapshot(now);
  }

  pause(now = Date.now()) {
    const state = this.snapshot(now);
    if (this.status === 'running') {
      this._elapsedMs = state.absoluteElapsedMs;
      this._startedAt = null;
      this.status = 'paused';
    }
    return this.snapshot(now);
  }

  reset() {
    this._elapsedMs = 0;
    this._startedAt = null;
    this.status = 'idle';
    return this;
  }

  setFlow(id) {
    if (this.status === 'running' || this.status === 'paused') {
      throw new Error('Reset the timer before changing its flow');
    }
    this.flow = this._findFlow(id);
    return this.reset();
  }

  snapshot(now = Date.now()) {
    clock(now);
    const totalMs = this.flow.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
    const rawElapsedMs = Math.max(0, this._elapsedMs +
      (this.status === 'running' ? Math.max(0, now - this._startedAt) : 0));
    const absoluteElapsedMs = this.flow.repeat ? rawElapsedMs : Math.min(totalMs, rawElapsedMs);
    const cycleIndex = this.flow.repeat ? Math.floor(absoluteElapsedMs / totalMs) : 0;
    const elapsedMs = this.flow.repeat ? absoluteElapsedMs % totalMs : absoluteElapsedMs;
    if (!this.flow.repeat && elapsedMs >= totalMs && this.status !== 'idle') {
      this.status = 'finished';
      this._elapsedMs = totalMs;
      this._startedAt = null;
    }
    let phaseIndex = 0;
    let phaseStart = 0;
    while (phaseIndex < this.flow.phases.length - 1 &&
      elapsedMs >= phaseStart + this.flow.phases[phaseIndex].durationMs) {
      phaseStart += this.flow.phases[phaseIndex].durationMs;
      phaseIndex += 1;
    }
    const phase = this.flow.phases[phaseIndex];
    return {
      status: this.status,
      absoluteElapsedMs,
      cycleIndex,
      stationNumber: cycleIndex + 1,
      elapsedMs,
      totalRemainingMs: Math.max(0, totalMs - elapsedMs),
      examElapsedMs: this.flow.id === 'examiner' ? Math.max(0, elapsedMs - 60000) : elapsedMs,
      examRemainingMs: this.flow.id === 'examiner' ? Math.min(600000, Math.max(0, totalMs - elapsedMs)) : Math.max(0, totalMs - elapsedMs),
      phaseRemainingMs: Math.max(0, phase.durationMs - (elapsedMs - phaseStart)),
      phaseIndex,
      phaseId: phase.id,
      phaseLabel: phase.label,
      totalMs,
      phaseDurationMs: phase.durationMs,
      progress: elapsedMs / totalMs
    };
  }

  serialize(now = Date.now()) {
    const state = this.snapshot(now);
    return { version: 1, flowId: this.flow.id, status: state.status,
      elapsedMs: state.absoluteElapsedMs, savedAt: now };
  }

  /** Restore validated local data; background time counts only for a running timer. */
  restore(data, now = Date.now()) {
    clock(now);
    if (!data || data.version !== 1 || !STATES.includes(data.status) ||
      !Number.isFinite(data.elapsedMs) || data.elapsedMs < 0 ||
      !Number.isFinite(data.savedAt) || !FLOWS.some(flow => flow.id === data.flowId)) {
      return false;
    }
    this.flow = this._findFlow(data.flowId);
    const totalMs = this.flow.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
    const restoredElapsed = data.elapsedMs + (data.status === 'running' ? Math.max(0, now - data.savedAt) : 0);
    this._elapsedMs = data.status === 'idle' ? 0 : this.flow.repeat ? restoredElapsed : Math.min(totalMs, restoredElapsed);
    this.status = data.status;
    if (data.status === 'finished') this._elapsedMs = totalMs;
    this._startedAt = data.status === 'running' ? now : null;
    this.snapshot(now);
    return true;
  }
}
