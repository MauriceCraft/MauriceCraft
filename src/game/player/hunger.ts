/** Food saturation is used before hunger; every four exhaustion points consume one. */
export interface HungerState {
  mode: string;
  difficulty: string;
  exhaust: number;
  sat: number;
  hunger: number;
}
export function exertPlayer(state: HungerState, amount: number): void {
  if (state.mode !== 'survival' || state.difficulty === 'peaceful') return;
  state.exhaust += amount;
  while (state.exhaust >= 4) {
    state.exhaust -= 4;
    if (state.sat > 0) state.sat = Math.max(0, state.sat - 1);
    else state.hunger = Math.max(0, state.hunger - 1);
  }
}
