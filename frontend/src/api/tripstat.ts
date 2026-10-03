import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 保护动作统计的状态链路与业务规则集中在这里，页面只负责收集输入与渲染，不做业务判断。
const MODULE_KEY = 'tripstat'
const FAULT_KEY = 'faultrecord'

// 状态必须逐级往前走：待统计 → 统计中 → 已汇总 → 已复核；任何跳级都拒收。
const FORWARD_FLOW = ['待统计', '统计中', '已汇总', '已复核'] as const
const RETURNED_STATUS = '已退回'

// 正向动作按顺序对应 FORWARD_FLOW 的每一步。
const FORWARD_ACTIONS: Record<string, string> = {
  提交统计: '统计中',
  确认汇总: '已汇总',
  送交复核: '已复核',
}

const ACTION_FOR_TARGET: Record<string, string> = {
  统计中: '提交统计',
  已汇总: '确认汇总',
  已复核: '送交复核',
}

export type TripStatInput = {
  所属线路: string
  动作次数: number
  正确动作次数: number
  误动次数: number
  统计月份: string
  统计人: string
}

function toInt(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN
  }
  const text = String(value ?? '').trim()
  if (text === '') {
    return Number.NaN
  }
  return Number(text)
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

// 登记、改数阶段只要求非负整数：咬合问题（正确/误动多于动作）留到汇总这一步拦下。
function validateBasicCounts(动作次数: number, 正确动作次数: number, 误动次数: number): string {
  for (const [label, value] of [
    ['动作次数', 动作次数],
    ['正确动作次数', 正确动作次数],
    ['误动次数', 误动次数],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      return `${label}必须是不小于 0 的整数`
    }
  }
  return ''
}

// 三次数互相咬合：正确动作次数、误动次数都不能比动作次数还多；汇总时强制校验。
function validateCountsBite(动作次数: number, 正确动作次数: number, 误动次数: number): string {
  const basic = validateBasicCounts(动作次数, 正确动作次数, 误动次数)
  if (basic) {
    return basic
  }
  if (正确动作次数 > 动作次数) {
    return `正确动作次数（${正确动作次数}）不能多于动作次数（${动作次数}），三次数咬合不上`
  }
  if (误动次数 > 动作次数) {
    return `误动次数（${误动次数}）不能多于动作次数（${动作次数}），先卡在汇总这一步核对`
  }
  return ''
}

function validateMonth(month: unknown): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month ?? '').trim())
    ? ''
    : '统计月份必须是 YYYY-MM 格式（如 2026-09）'
}

function nextCode(rows: EntryRow[], field: string, prefix: string): string {
  let max = 0
  for (const row of rows) {
    const matched = String(row[field] ?? '').match(/(\d+)$/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// 同一条线路同一个月只允许一条有效（非已退回）报送；反复报送不会多出一条。
function findActiveDuplicate(
  rows: EntryRow[],
  line: string,
  month: string,
  excludeId?: number,
): EntryRow | undefined {
  return rows.find(
    (row) =>
      Number(row.id) !== excludeId &&
      String(row.status) !== RETURNED_STATUS &&
      String(row['所属线路'] ?? '').trim() === line &&
      String(row['统计月份'] ?? '').trim() === month,
  )
}

export function createTripStat(input: TripStatInput): ActionResult {
  const line = input.所属线路.trim()
  const month = input.统计月份.trim()
  const reporter = input.统计人.trim()
  if (!line) {
    return fail('所属线路不能为空')
  }
  if (!reporter) {
    return fail('统计人不能为空')
  }
  const monthError = validateMonth(month)
  if (monthError) {
    return fail(monthError)
  }
  const countError = validateBasicCounts(input.动作次数, input.正确动作次数, input.误动次数)
  if (countError) {
    return fail(countError)
  }

  const rows = listRows(MODULE_KEY)
  const duplicate = findActiveDuplicate(rows, line, month)
  if (duplicate) {
    return fail(
      `${line} ${month} 已有一条有效报送（${String(duplicate['统计编号'])}，状态「${duplicate.status}」），同线路同月不重复登记；如需改数请在原条目退回重报`,
    )
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待统计',
    pending: true,
    abnormal: false,
    统计编号: nextCode(rows, '统计编号', 'TRIP'),
    所属线路: line,
    动作次数: input.动作次数,
    正确动作次数: input.正确动作次数,
    误动次数: input.误动次数,
    统计月份: month,
    统计人: reporter,
    确认人: '',
    统计状态: '待统计',
    签字轨迹: '',
    重报自: '',
  }
  saveRows(MODULE_KEY, [...rows, row])
  return { ok: true, message: `动作统计 ${String(row.统计编号)} 已登记，当前状态「待统计」` }
}

// 待统计、统计中阶段可以改动作次数；到已汇总以后次数锁死，要改只能退回重报。
export function updateTripCounts(
  id: number,
  counts: { 动作次数: number; 正确动作次数: number; 误动次数: number },
): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的动作统计`)
  }
  const current = rows[index]
  if (!['待统计', '统计中'].includes(String(current.status))) {
    return fail(`状态已是「${current.status}」，动作次数已锁定，要改数须由统计专责退回重报`)
  }
  const countError = validateBasicCounts(counts.动作次数, counts.正确动作次数, counts.误动次数)
  if (countError) {
    return fail(countError)
  }
  const next = [...rows]
  next[index] = {
    ...current,
    动作次数: counts.动作次数,
    正确动作次数: counts.正确动作次数,
    误动次数: counts.误动次数,
  }
  saveRows(MODULE_KEY, next)
  return { ok: true, message: '动作次数已更新' }
}

function appendTrail(current: EntryRow, label: string, signer: string): string {
  const stamp = `${label}：${signer} ${new Date().toLocaleString('zh-CN', { hour12: false })}`
  const prev = String(current['签字轨迹'] ?? '').trim()
  return prev ? `${prev}；${stamp}` : stamp
}

// 已复核驱动：给故障录波送一条「待归档」项（已定性、待归档），同一统计只驱动一次。
function pushFaultArchiveItem(source: EntryRow): void {
  const rows = listRows(FAULT_KEY)
  const sourceCode = String(source['统计编号'] ?? '')
  const already = rows.some((row) => String(row['关联统计'] ?? '') === sourceCode)
  if (already) {
    return
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const month = String(source['统计月份'] ?? '')
  const item: EntryRow = {
    id,
    status: '已定性',
    pending: true,
    abnormal: false,
    录波编号: nextCode(rows, '录波编号', 'FAUL'),
    故障线路: String(source['所属线路'] ?? ''),
    故障类型: '保护动作统计已复核待归档',
    故障电流: '',
    故障时间: month,
    分析人: String(source['确认人'] ?? ''),
    分析结论: `由动作统计 ${sourceCode}（${month}）复核通过后转入待归档`,
    录波状态: '已定性',
    关联统计: sourceCode,
  }
  saveRows(FAULT_KEY, [...rows, item])
}

// 退回重报：原件保留并置「已退回」可查；另开一条从待统计重新报送，同线路同月不重复计数。
function returnForResubmit(rows: EntryRow[], index: number, signer: string): ActionResult {
  const original = rows[index]
  const returned: EntryRow = {
    ...original,
    status: RETURNED_STATUS,
    pending: false,
    abnormal: false,
    统计状态: RETURNED_STATUS,
    确认人: signer,
    签字轨迹: appendTrail(original, '退回重报', signer),
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const resubmitted: EntryRow = {
    ...original,
    id,
    status: '待统计',
    pending: true,
    abnormal: false,
    统计编号: nextCode(rows, '统计编号', 'TRIP'),
    确认人: '',
    统计状态: '待统计',
    签字轨迹: '',
    重报自: String(original['统计编号'] ?? ''),
  }
  // 原件在原位置标记退回，重报条目追加在末尾，列表里两条都能查到。
  const next = [...rows]
  next[index] = returned
  next.push(resubmitted)
  saveRows(MODULE_KEY, next)
  return {
    ok: true,
    message: `已由统计专责 ${signer} 退回，原件 ${String(original['统计编号'])} 置「已退回」留查，重报条目 ${String(resubmitted['统计编号'])} 从「待统计」重新报送`,
  }
}

// 状态推进入口：正向逐级、跳级拒收，每一步都要统计专责签字；已复核改数走退回重报。
export function advanceTripStat(id: number, action: string, signerInput?: string): ActionResult {
  const signer = String(signerInput ?? '').trim()
  if (!signer) {
    return fail('状态推进须由统计专责签字确认，请填写专责签名')
  }

  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的动作统计`)
  }
  const current = rows[index]
  const currentStatus = String(current.status)

  if (action === '退回重报') {
    if (currentStatus !== '已复核') {
      return fail(`只有「已复核」的动作统计才能退回重报，当前状态「${currentStatus}」`)
    }
    return returnForResubmit(rows, index, signer)
  }

  const target = FORWARD_ACTIONS[action]
  if (!target) {
    return fail(`动作统计没有登记「${action}」这个动作`)
  }
  const fromIndex = FORWARD_FLOW.indexOf(currentStatus as (typeof FORWARD_FLOW)[number])
  if (fromIndex < 0) {
    return fail(`「${currentStatus}」是终态留查记录，不能再往前推进`)
  }
  const expected = FORWARD_FLOW[fromIndex + 1]
  if (target !== expected) {
    // 跳级或走错步：例如待统计直接确认汇总、已汇总再提交统计。
    return fail(
      expected
        ? `状态须逐级推进：当前「${currentStatus}」只能先「${ACTION_FOR_TARGET[expected]}」到「${expected}」，不能直接「${action}」`
        : `动作统计已到「${FORWARD_FLOW[FORWARD_FLOW.length - 1]}」，没有下一步`,
    )
  }

  // 三次数咬合：误动次数（连同正确动作次数）多于动作次数，卡在汇总这一步。
  if (target === '已汇总') {
    const countError = validateCountsBite(
      toInt(current['动作次数']),
      toInt(current['正确动作次数']),
      toInt(current['误动次数']),
    )
    if (countError) {
      return fail(`汇总被拦下：${countError}`)
    }
  }

  const isLast = target === FORWARD_FLOW[FORWARD_FLOW.length - 1]
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: !isLast,
    abnormal: false,
    统计状态: target,
    确认人: signer,
    签字轨迹: appendTrail(current, action, signer),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)

  if (target === '已复核') {
    pushFaultArchiveItem(updated)
    return {
      ok: true,
      message: `动作统计已由统计专责 ${signer} 复核，状态「已复核」，并已转入故障录波待归档清单`,
    }
  }
  return { ok: true, message: `动作统计已由统计专责 ${signer} ${action}，当前状态「${target}」` }
}

// 某条统计当前允许执行的动作：页面据此只显示合法按钮，真正的拒收仍由服务判定。
export function availableTripActions(row: EntryRow): string[] {
  const status = String(row.status)
  const index = FORWARD_FLOW.indexOf(status as (typeof FORWARD_FLOW)[number])
  if (index >= 0 && index < FORWARD_FLOW.length - 1) {
    return [ACTION_FOR_TARGET[FORWARD_FLOW[index + 1]]]
  }
  if (status === '已复核') {
    return ['退回重报']
  }
  return []
}
