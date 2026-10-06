// Fixed-timestep game loop. Simulation runs at a constant rate (default 60 Hz)
// independent of the display; rendering receives an interpolation factor
// `alpha` between the previous and the current simulation state.

export class Loop {
  constructor({ step = 1 / 60, maxSteps = 5, onStep, onRender }) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.onStep = onStep;
    this.onRender = onRender;
    this.timeScale = 1;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.simTime = 0;
    this.realTime = 0;
    this.stepsLastFrame = 0;
    this.paused = false;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // tab was hidden / debugger pause
    this.realTime += dt;

    let steps = 0;
    if (!this.paused) {
      this.accumulator += dt * this.timeScale;
      while (this.accumulator >= this.step && steps < this.maxSteps) {
        this.onStep(this.step, this.simTime);
        this.simTime += this.step;
        this.accumulator -= this.step;
        steps++;
      }
      // Drop time we can't catch up on instead of spiralling.
      if (steps === this.maxSteps) this.accumulator = 0;
    }
    this.stepsLastFrame = steps;
    const alpha = this.paused ? 1 : this.accumulator / this.step;
    this.onRender(dt, alpha);
  }
}
