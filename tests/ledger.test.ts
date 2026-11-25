import { expect, test } from 'claude-code/testing'

import { todayOf, weeklyOf } from '../hooks/register'

const fake = () => {
  const m = new Map<string, unknown>()
  return { store: { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) } }
}
const H = 3600e3
const week = new Date(Date.now() + 3 * 24 * H).toISOString()
const win = (h: number) => new Date(Date.now() + h * H).toISOString()
const read = (pct: number, w: string) => [
  { kind: 'seven_day', percentUsed: pct, resetsAt: week },
  { kind: 'five_hour', percentUsed: 10, resetsAt: w },
]

test('weekly ledger: today and this window grow from their first reading', async () => {
  const $ = fake()
  expect((await weeklyOf($, read(40, win(4))))?.today).toBe(0)
  const r = await weeklyOf($, read(43, win(4)))
  expect(r?.today).toBe(3)
  expect(r?.window).toBe(3)
  expect(Math.round(r?.pace ?? 0)).toBe(19)
})

test('weekly ledger: a new 5-hour window restarts its share, today keeps counting', async () => {
  const $ = fake()
  await weeklyOf($, read(40, win(1)))
  await weeklyOf($, read(42, win(1)))
  const r = await weeklyOf($, read(45, win(5)))
  expect(r?.window).toBe(0)
  expect(r?.today).toBe(5)
})

test('weekly ledger: no weekly window, no figures', async () => {
  expect(await weeklyOf(fake(), [])).toBe(null)
})

test('today: reads the token meter cache, and is null without it', async () => {
  const meter = {
    updated: Date.now() / 1000, cap: 200000, total: 400, biggest: 210000,
    projects: [['a', 300], ['b', 100]], models: [['claude-opus-5-5', 300], ['claude-haiku-5-5', 100]],
    sessions: [{ project: 'a', title: 't', ctx: 210000, live: true }, { project: 'b', title: 'u', ctx: 5, live: false }],
  }
  const $ = { env: { get: async () => '/h' }, fs: { read: async () => JSON.stringify(meter) } }
  const t = await todayOf($)
  expect(t?.opusShare).toBe(75)
  expect(t?.live.length).toBe(1)
  const missing = { env: { get: async () => '/h' }, fs: { read: async () => { throw new Error('ENOENT') } } }
  expect(await todayOf(missing)).toBe(null)
})
