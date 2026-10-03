import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, TripStatForm } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '退回']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  // 动作统计有自己的状态机（逐级流转 + 专责签字 + 计数咬合），不走通用直跳逻辑。
  if (key === TRIPSTAT_KEY) {
    return { ok: false, message: '动作统计的状态推进必须由统计专责签字，请走专责确认入口' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: '\uFEFF' + lines.join('\n') }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

/* ------------------------------------------------------------------ */
/* 保护动作统计：待统计 → 统计中 → 已汇总 → 已复核 的专责签字状态机      */
/* ------------------------------------------------------------------ */

const TRIPSTAT_KEY = 'tripstat'
const FAULTRECORD_KEY = 'faultrecord'

const TRIP_ACTIVE_STATUSES = ['待统计', '统计中', '已汇总', '已复核']
// 正向流转只允许相邻状态：跳级一律拒收。
const TRIP_FORWARD: Record<string, string> = {
  待统计: '统计中',
  统计中: '已汇总',
  已汇总: '已复核',
}
const RETURN_ACTION = '退回重报'
// 已复核是唯一可退回的状态；退回后旧记录留在「已退回」备查。
const RETURN_FROM = '已复核'
const RETURNED_STATUS = '已退回'

export type Signature = {
  confirmer: string
  reason?: string
}

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function toCount(value: number): number | null {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function validateTripForm(form: TripStatForm): string {
  if (!form.所属线路.trim()) {
    return '所属线路不能为空'
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.统计月份.trim())) {
    return '统计月份必须是 YYYY-MM 格式，例如 2026-09'
  }
  if (!form.统计人.trim()) {
    return '统计人不能为空'
  }
  const action = toCount(form.动作次数)
  const correct = toCount(form.正确动作次数)
  const miss = toCount(form.误动次数)
  if (action === null || correct === null || miss === null) {
    return '动作次数、正确动作次数、误动次数都得是非负整数'
  }
  // 注意：次数是否咬合（误动 ≤ 动作、正确 + 误动 = 动作）留到专责确认汇总时再卡，
  // 统计填报阶段允许先登记、后核对。
  return ''
}

function nextTripId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function suggestTripCode(rows: EntryRow[]): string {
  return `TRIP-${String(nextTripId(rows)).padStart(4, '0')}`
}

/** 给登记表单预填下一个统计编号。 */
export function suggestTripStatCode(): string {
  return suggestTripCode(listRows(TRIPSTAT_KEY))
}

function findActiveTrip(rows: EntryRow[], line: string, month: string): EntryRow | undefined {
  return rows.find(
    (row) =>
      String(row.所属线路) === line &&
      String(row.统计月份) === month &&
      TRIP_ACTIVE_STATUSES.includes(String(row.status)),
  )
}

function appendSign(row: EntryRow, note: string): string {
  const history = String(row.签字记录 ?? '')
  return history ? `${history}；${note}` : note
}

/** 登记动作统计：同一条线路同一个月存在在办记录时不另开一条。 */
export function createTripStat(form: TripStatForm): ActionResult {
  const message = validateTripForm(form)
  if (message) {
    return { ok: false, message }
  }
  const line = form.所属线路.trim()
  const month = form.统计月份.trim()
  const rows = listRows(TRIPSTAT_KEY)
  const duplicated = findActiveTrip(rows, line, month)
  if (duplicated) {
    return {
      ok: false,
      message: `${line} ${month} 已有在办统计「${duplicated.统计编号}」（${duplicated.status}），同一条线路同一个月不重复登记`,
    }
  }
  const id = nextTripId(rows)
  const row: EntryRow = {
    id,
    status: '待统计',
    pending: true,
    abnormal: false,
    统计编号: `TRIP-${String(id).padStart(4, '0')}`,
    所属线路: line,
    动作次数: form.动作次数,
    正确动作次数: form.正确动作次数,
    误动次数: form.误动次数,
    统计月份: month,
    统计人: form.统计人.trim(),
    确认人: '',
    确认时间: '',
    退回原因: '',
    原统计编号: '',
    签字记录: '',
  }
  saveRows(TRIPSTAT_KEY, [...rows, row])
  return { ok: true, message: `动作统计「${row.统计编号}」已登记，当前状态「待统计」` }
}

/** 修改动作次数：只在统计尚未汇总（待统计 / 统计中）时允许，已复核必须先走退回重报。 */
export function reviseTripStat(id: number, form: TripStatForm): ActionResult {
  const message = validateTripForm(form)
  if (message) {
    return { ok: false, message }
  }
  const rows = listRows(TRIPSTAT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的动作统计` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status !== '待统计' && status !== '统计中') {
    return {
      ok: false,
      message: `「${current.统计编号}」已走到「${status}」，不能直接改动作次数；已复核的记录请由专责退回重报`,
    }
  }
  const line = form.所属线路.trim()
  const month = form.统计月份.trim()
  const duplicated = findActiveTrip(
    rows.filter((row) => Number(row.id) !== id),
    line,
    month,
  )
  if (duplicated) {
    return {
      ok: false,
      message: `${line} ${month} 已有在办统计「${duplicated.统计编号}」，改完就跟它撞了`,
    }
  }
  rows[index] = {
    ...current,
    所属线路: line,
    统计月份: month,
    动作次数: form.动作次数,
    正确动作次数: form.正确动作次数,
    误动次数: form.误动次数,
    统计人: form.统计人.trim(),
  }
  saveRows(TRIPSTAT_KEY, rows)
  return { ok: true, message: `动作统计「${current.统计编号}」的次数已更新` }
}

/**
 * 专责签字推进：每一步只能从相邻的上一状态过来，跳级拒收；
 * 汇总这一步校验「误动 ≤ 动作」且「正确 + 误动 = 动作」；
 * 走到已复核时把该线路该月录波推进故障录波的待归档清单。
 */
export function signTripStat(id: number, action: string, signature: Signature): ActionResult {
  const confirmer = signature.confirmer.trim()
  if (!confirmer) {
    return { ok: false, message: '状态推进必须由统计专责签字确认，请填写专责姓名' }
  }
  const rows = listRows(TRIPSTAT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的动作统计` }
  }
  const current = rows[index]
  const currentStatus = String(current.status)
  const target = TRIP_FORWARD[currentStatus]
  if (!target) {
    return { ok: false, message: `「${current.统计编号}」当前是「${currentStatus}」，没有可往前推进的状态` }
  }
  const expectAction =
    target === '统计中' ? '提交统计' : target === '已汇总' ? '确认汇总' : '送交复核'
  if (action !== expectAction) {
    return {
      ok: false,
      message: `不能从「${currentStatus}」直接执行「${action}」，状态只能逐级往前走，当前应执行「${expectAction}」`,
    }
  }

  // 计数咬合在汇总这一步卡：正确动作次数与误动次数要跟动作次数对得上。
  if (target === '已汇总') {
    const actionCount = Number(current.动作次数)
    const correctCount = Number(current.正确动作次数)
    const missCount = Number(current.误动次数)
    if (![actionCount, correctCount, missCount].every((value) => Number.isInteger(value) && value >= 0)) {
      return { ok: false, message: '次数数据不是非负整数，先把动作次数核对清楚再汇总' }
    }
    if (missCount > actionCount) {
      return {
        ok: false,
        message: `误动次数 ${missCount} 次多于动作次数 ${actionCount} 次，卡在汇总这一步，请退回核对`,
      }
    }
    if (correctCount + missCount !== actionCount) {
      return {
        ok: false,
        message: `计数咬合不上：正确动作 ${correctCount} 次 + 误动 ${missCount} 次 ≠ 动作 ${actionCount} 次，不能汇总`,
      }
    }
  }

  const stamp = nowText()
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== '已复核',
    abnormal: false,
    确认人: confirmer,
    确认时间: stamp,
    签字记录: appendSign(current, `${action}：${confirmer} ${stamp}`),
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows(TRIPSTAT_KEY, nextRows)

  let driven: ActionResult | null = null
  if (target === '已复核') {
    driven = driveFaultArchive(updated)
  }
  const suffix = driven && driven.ok ? `；${driven.message}` : ''
  return { ok: true, message: `「${updated.统计编号}」已由 ${confirmer} 签字${action}，当前状态「${target}」${suffix}` }
}

/**
 * 专责退回重报：只有已复核的记录能退。旧记录留成「已退回」可查，
 * 当月另开一条待统计记录接着重报，两条用「原统计编号」串起来。
 */
export function returnTripStat(id: number, signature: Signature): ActionResult {
  const confirmer = signature.confirmer.trim()
  if (!confirmer) {
    return { ok: false, message: '退回重报必须由统计专责签字，请填写专责姓名' }
  }
  const reason = (signature.reason ?? '').trim()
  if (!reason) {
    return { ok: false, message: '退回重报得写明退回原因，方便重报人核对' }
  }
  const rows = listRows(TRIPSTAT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的动作统计` }
  }
  const current = rows[index]
  if (String(current.status) !== RETURN_FROM) {
    return {
      ok: false,
      message: `只有「${RETURN_FROM}」的记录才能退回重报，「${current.统计编号}」当前是「${current.status}」`,
    }
  }

  const stamp = nowText()
  const oldRow: EntryRow = {
    ...current,
    status: RETURNED_STATUS,
    pending: true,
    abnormal: true,
    确认人: confirmer,
    确认时间: stamp,
    退回原因: reason,
    签字记录: appendSign(current, `${RETURN_ACTION}：${confirmer} ${stamp}（${reason}）`),
  }

  const nextId = nextTripId(rows)
  const newRow: EntryRow = {
    id: nextId,
    status: '待统计',
    pending: true,
    abnormal: false,
    统计编号: `TRIP-${String(nextId).padStart(4, '0')}`,
    所属线路: current.所属线路,
    动作次数: current.动作次数,
    正确动作次数: current.正确动作次数,
    误动次数: current.误动次数,
    统计月份: current.统计月份,
    统计人: current.统计人,
    确认人: '',
    确认时间: '',
    退回原因: '',
    原统计编号: current.统计编号,
    签字记录: '',
  }

  const nextRows = [...rows]
  nextRows[index] = oldRow
  nextRows.push(newRow)
  saveRows(TRIPSTAT_KEY, nextRows)
  return {
    ok: true,
    message: `「${oldRow.统计编号}」已由 ${confirmer} 退回重报（原记录保留可查），重报记录「${newRow.统计编号}」已开在「待统计」`,
  }
}

/**
 * 已复核驱动故障录波：同线路的已定性录波进待归档清单。
 * 同一条统计重复确认不会重复造录波，靠关联统计编号去重。
 */
function driveFaultArchive(trip: EntryRow): ActionResult {
  const line = String(trip.所属线路)
  const month = String(trip.统计月份)
  const code = String(trip.统计编号)
  const faults = listRows(FAULTRECORD_KEY)
  const already = faults.some((row) => String(row.关联统计编号) === code)
  if (already) {
    return { ok: true, message: '故障录波待归档清单里已有这条统计对应的录波' }
  }
  const candidate = faults.find(
    // 故障时间落在统计的同一个月，避免把别的月份的录波带进待归档。
    (row) =>
      String(row.故障线路) === line &&
      String(row.status) === '已定性' &&
      String(row.故障时间 ?? '').startsWith(month),
  )
  if (!candidate) {
    // 不阻断复核本身，只提示待归档清单这次没生成。
    return { ok: true, message: `没找到 ${line} ${month} 的已定性录波，待归档清单暂未生成，请通知录波分析岗核对` }
  }
  const nextFault: EntryRow = {
    ...candidate,
    pending: true,
    录波状态: '待归档',
    分析结论: candidate.分析结论 ? candidate.分析结论 : `${month} 动作统计已复核，等待归档`,
    关联统计编号: code,
  }
  const nextFaults = faults.map((row) => (Number(row.id) === Number(candidate.id) ? nextFault : row))
  saveRows(FAULTRECORD_KEY, nextFaults)
  return { ok: true, message: `录波「${candidate.录波编号}」已进入故障录波待归档清单` }
}

/** 故障录波待归档清单：已定性且由已复核动作统计驱动过来的录波。 */
export function listPendingArchiveFaults(): EntryRow[] {
  return listRows(FAULTRECORD_KEY).filter(
    (row) => String(row.status) === '已定性' && String(row.关联统计编号 ?? '') !== '',
  )
}
