import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Loaded, Phase, Progress } from '../types'

const PANE = 'project-progress'
const empty: Loaded = { data: null, path: null, error: null }
const loaded = atom({ plugin: 'project-progress', key: 'loaded' } as const, empty)
const isCollapsed = atom({ plugin: 'project-progress', key: 'isCollapsed' } as const, false)

const statusWord = { done: 'خلص', active: 'شغال', todo: 'لسه' } as const

/** Done weight plus the finished share of active items, over the total weight. */
export function score(items: readonly Item[]): number {
  let total = 0
  let done = 0
  for (const item of items) {
    total += item.w
    if (item.status === 'done') done += item.w
    else if (item.status === 'active') done += item.w * (item.progress ?? 0.5)
  }
  return total === 0 ? 0 : done / total
}

export function bar(value: number, width: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const pct = (value: number): string => `${Math.round(value * 100)}%`

/** "You are here": the first phase with work running now, else the first one with work left. */
export function currentPhase(progress: Progress): Phase | null {
  return (
    progress.phases.find(phase => phase.items.some(item => item.status === 'active')) ??
    progress.phases.find(phase => phase.items.some(item => item.status !== 'done')) ??
    null
  )
}

export function overall(progress: Progress): number {
  return score(progress.phases.flatMap(phase => phase.items))
}



/** `.claude/progress-path.txt` (an absolute path) wins, then `.claude/progress.json`, then `docs/status/progress.json`. */
export async function locate($: EngineInterface, root: string): Promise<string | null> {
  try {
    const pointer = (await $.fs.read(`${root}/.claude/progress-path.txt`)).trim()
    if (pointer) return pointer
  } catch {
    /* no pointer */
  }
  for (const candidate of [`${root}/.claude/progress.json`, `${root}/docs/status/progress.json`]) {
    try {
      await $.fs.read(candidate)
      return candidate
    } catch {
      /* try the next one */
    }
  }
  return null
}

let lastText = ''

async function refresh($: EngineInterface): Promise<void> {
  const path = await locate($, await $.session.root())
  if (path === null) {
    if (lastText !== '') {
      lastText = ''
      await update($, loaded, () => empty)
      $.ui.status(undefined)
    }
    return
  }
  let next: Loaded
  let text = ''
  try {
    text = await $.fs.read(path)
    if (text === lastText) return
    next = { data: JSON.parse(text) as Progress, path, error: null }
  } catch (error) {
    next = { data: null, path, error: error instanceof Error ? error.message : String(error) }
  }
  lastText = text
  await update($, loaded, () => next)
  if (next.data) {
    const phase = currentPhase(next.data)
    $.ui.status(
      `${pct(overall(next.data))} المشروع` + (phase ? ` · ${phase.name.split(':')[0]} ${pct(score(phase.items))}` : ''),
    )
  } else {
    $.ui.status('progress.json فيه مشكلة')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: 'افتح لوحة تقدّم المشروع (فين إنت واقف)' })
    await refresh($)
    $.clock.every(15000, () => refresh($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'progress' }, async $ => {
    await refresh($)
    await update($, isCollapsed, () => false)
    await $.ui.open({ id: PANE, title: 'تقدّم المشروع' })
    const { data, path } = await read($, loaded)
    if (!data) {
      return {
        text:
          'مفيش ملف تقدّم للمشروع ده. اعمل `.claude/progress.json` أو `docs/status/progress.json` ' +
          '(أو `.claude/progress-path.txt` فيه مسار الملف)، أو اطلب من الوكيل progress-updater يعمله.',
      }
    }
    return { text: `لوحة التقدّم مفتوحة (${path}).` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { data } = await read($, loaded)
    if (e.props.hasSurvey || !data || (await read($, isCollapsed))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const value = overall(data)
    const phase = currentPhase(data)
    const now = data.now.map(task => `${task.title} (${task.who})`).join(' · ')
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="success">{bar(value, 24)}</Text>
          <Text bold> {pct(value)} </Text>
          <Text>من المشروع</Text>
          {phase && <Text dimColor> · إنت هنا: {phase.name} ({pct(score(phase.items))})</Text>}
          <Text> </Text>
          <Button key="details" label="التفاصيل" onPress={() => $.ui.open({ id: PANE, title: 'تقدّم المشروع' })} />
          <Button key="hide" label="إخفاء" onPress={() => update($, isCollapsed, () => true)} />
        </Box>
        {now && (
          <Text dimColor wrap="truncate-end">
            شغال دلوقتي: {now}
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { data, path, error } = await read($, loaded)
    if (!data) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{error ? `تعذّر قراءة ${path}: ${error}` : 'مفيش ملف تقدّم للمشروع ده. اكتب /progress للتفاصيل.'}</Text>
        </Box>
      )
    }
    const width = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 60) - 30))
    const here = currentPhase(data)
    return (
      <Box flexDirection="column">
        <Text bold>
          {bar(overall(data), width)} {pct(overall(data))} من المشروع كله
        </Text>
        <Text dimColor>آخر تحديث: {data.updated}</Text>
        <Text> </Text>
        <Text bold>المراحل</Text>
        {data.phases.map(phase => (
          <Text key={phase.id} color={phase === here ? 'warning' : undefined} bold={phase === here}>
            {bar(score(phase.items), 12)} {pct(score(phase.items)).padStart(4)} {phase.name}
            {phase === here ? '  ← إنت هنا' : ''}
          </Text>
        ))}
        {here && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{here.name}</Text>
            {here.items.map(item => (
              <Text key={item.name} dimColor={item.status === 'todo'} color={item.status === 'active' ? 'warning' : undefined}>
                {item.status === 'done' ? '✓' : item.status === 'active' ? '▶' : '·'} {item.name} ({statusWord[item.status]}
                {item.status === 'active' && item.progress !== undefined ? ` ${pct(item.progress)}` : ''})
              </Text>
            ))}
          </Box>
        )}
        <Text> </Text>
        <Text bold>شغال دلوقتي</Text>
        {data.now.length === 0 && <Text dimColor>مفيش</Text>}
        {data.now.map(task => (
          <Text key={task.title}>
            ▶ {task.title} · {task.who} · من {task.since}
          </Text>
        ))}
        <Text> </Text>
        <Text bold>الجاي</Text>
        {data.next.slice(0, 6).map((task, index) => (
          <Text key={task}>
            {index + 1}. {task}
          </Text>
        ))}
        <Text> </Text>
        <Text bold>آخر حاجات خلصت</Text>
        {data.log.slice(0, 6).map(entry => (
          <Text key={entry.at + entry.text}>
            ✓ {entry.text} <Text dimColor>({entry.at})</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
