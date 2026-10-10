import { expect, test } from 'claude-code/testing'
import { bar, currentPhase, overall, pct, score } from './register'

const progress = {
  updated: '2026-10-10',
  now: [],
  next: [],
  log: [],
  phases: [
    { id: 'a', name: 'A: done', items: [{ name: 'x', w: 2, status: 'done' as const }] },
    {
      id: 'b',
      name: 'B: half',
      items: [
        { name: 'y', w: 2, status: 'active' as const, progress: 0.5 },
        { name: 'z', w: 2, status: 'todo' as const },
      ],
    },
  ],
}


test('weights done items fully and active items by their progress', () => {
    expect(score(progress.phases[1].items)).toBe(0.25)
    expect(overall(progress)).toBe(0.5)
    expect(pct(overall(progress))).toBe('50%')
  })
test('marks the first unfinished phase as the current one', () => {
    expect(currentPhase(progress)?.id).toBe('b')
  })
test('draws a bar of the requested width', () => {
    expect(bar(0.5, 10)).toBe('█████░░░░░')
    expect(bar(2, 4)).toBe('████')
  })

