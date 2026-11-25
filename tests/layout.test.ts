import { expect, test } from 'claude-code/testing'

import { SECTIONS, arrange, resetLabel } from '../hooks/register'

const base = { order: [...SECTIONS] as string[], hidden: [] as string[] }

test('layout: hide, show and move up', () => {
  const hidden = arrange(base, 'hide:today')
  expect(hidden.hidden).toEqual(['today'])
  expect(arrange(hidden, 'show:today').hidden).toEqual([])
  expect(arrange(base, 'up:context').order.slice(0, 2)).toEqual(['context', 'usage'])
  expect(arrange(base, 'up:usage').order).toEqual(base.order)
})

test('layout: an older stored order gains new sections and drops unknown ones', () => {
  const r = arrange({ order: ['connectors', 'gone', 'usage'], hidden: [] }, '')
  expect(r.order.slice(0, 2)).toEqual(['connectors', 'usage'])
  expect(r.order.length).toBe(SECTIONS.length)
  expect(arrange({ order: ['usage'], hidden: ['context'] }, 'reset')).toEqual(base)
})

test('reset label: time alone today, weekday and date otherwise', () => {
  const now = new Date(2026, 10, 25, 12, 0)
  expect(resetLabel(new Date(2026, 10, 25, 17, 10).toISOString(), now)).toBe('Resets at 5:10 PM')
  expect(resetLabel(new Date(2026, 10, 29, 3, 0).toISOString(), now)).toBe('Resets Sun, Nov 29 at 3:00 AM')
  expect(resetLabel(null, now)).toBe(null)
})
