/** Run one simulation/render frame without scheduling it.
 * Keeping scheduling separate makes startup and resumed frames testable.
 */
export interface FrameLoopDependencies {
  isReady: () => boolean;
  isPlaying: () => boolean;
  streamChunks: () => void;
  update: (deltaSeconds: number, now: number) => void;
  updateIdleCamera: () => void;
  daylight: (deltaSeconds: number) => void;
  updateWeather: (deltaSeconds: number) => void;
  updateRain: (deltaSeconds: number) => void;
  updateRainSound: (deltaSeconds: number) => void;
  updateRelics: (deltaSeconds: number, elapsedSeconds: number) => void;
  updateInfo: (fps: number) => void;
  render: () => void;
}

export type FrameStep = (now: number) => void;

/** Preserve the existing frame ordering, FPS sampling and HUD refresh interval. */
export function createFrameLoop(deps: FrameLoopDependencies, startTime: number): FrameStep {
  let last = startTime;
  let frames = 0;
  let fpsTimer = 0;
  let fps = 0;
  let infoTimer = 0;

  return (now: number): void => {
    const dt = (now - last) / 1000;
    last = now;
    if (deps.isReady()) {
      deps.streamChunks();
      if (deps.isPlaying()) deps.update(dt, now);
      else deps.updateIdleCamera();
      deps.daylight(dt);
      deps.updateWeather(dt);
      deps.updateRain(dt);
      deps.updateRainSound(dt);
      deps.updateRelics(dt, now / 1000);
      if (deps.isPlaying()) {
        frames++;
        fpsTimer += dt;
        infoTimer += dt;
        if (fpsTimer >= 1) {
          fps = frames;
          frames = 0;
          fpsTimer = 0;
        }
        if (infoTimer > 0.2) {
          infoTimer = 0;
          deps.updateInfo(fps);
        }
      }
    }
    // Always render, even while loading or paused.
    deps.render();
  };
}

/** Schedule exactly one next frame after each completed simulation frame. */
export function startFrameLoop(
  step: FrameStep,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): void {
  const frame: FrameRequestCallback = (now) => {
    step(now);
    schedule(frame);
  };
  schedule(frame);
}
