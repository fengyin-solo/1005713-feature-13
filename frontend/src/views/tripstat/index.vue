<template>
  <section class="page" data-module="tripstat">
    <header class="page-head">
      <div>
        <h2>保护动作统计管理</h2>
        <p class="page-desc">
          统计从待统计起，经统计中、已汇总逐级走到已复核，跳级拒收；误动次数多于动作次数卡在汇总；已复核改数由统计专责退回重报，原件留查、另开一条；复核通过驱动故障录波待归档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记动作统计</button>
        <button class="btn" type="button" @click="exportRows">导出保护动作统计清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="signer-bar">
      <label class="filter-item">
        <span>统计专责签名（状态推进须签字）</span>
        <input v-model="signer" placeholder="填写统计专责姓名" />
      </label>
      <span class="signer-hint">所有「提交统计 / 确认汇总 / 送交复核 / 退回重报」都以该签名落在同一条记录的确认人上</span>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'row-returned': String(row.status) === '已退回' }"
          @click="openDetail(row)"
        >
          <td v-for="column in columns" :key="column">{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</td>
          <td>
            <span :class="['status-badge', `status-${statusClass(String(row.status))}`]">{{ row.status }}</span>
            <span v-if="String(row['重报自'] ?? '')" class="resub-tag">重报自 {{ row['重报自'] }}</span>
          </td>
          <td class="row-actions" @click.stop>
            <button
              v-for="action in availableTripActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无保护动作统计数据，可先登记动作统计</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条保护动作统计记录（含已退回留查件）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记弹窗 -->
    <div v-if="creating" class="overlay" @click.self="creating = false">
      <div class="modal">
        <h3>登记动作统计</h3>
        <p class="modal-tip">同一线路同一月份只允许一条有效报送；当月已复核后要改数，请在明细里退回重报。</p>
        <div class="form-grid">
          <label class="filter-item"><span>所属线路 *</span><input v-model="form.所属线路" placeholder="如 110kV 东郊I线" /></label>
          <label class="filter-item"><span>统计月份 *</span><input v-model="form.统计月份" placeholder="YYYY-MM，如 2026-09" /></label>
          <label class="filter-item"><span>动作次数 *</span><input v-model.number="form.动作次数" type="number" min="0" step="1" /></label>
          <label class="filter-item"><span>正确动作次数 *</span><input v-model.number="form.正确动作次数" type="number" min="0" step="1" /></label>
          <label class="filter-item"><span>误动次数 *</span><input v-model.number="form.误动次数" type="number" min="0" step="1" /></label>
          <label class="filter-item"><span>统计人 *</span><input v-model="form.统计人" /></label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">登记</button>
        </div>
      </div>
    </div>

    <!-- 明细抽屉：与列表读的是同一条记录，统计月份天然同一份 -->
    <aside v-if="detail" class="drawer" @click.self="detail = null">
      <div class="drawer-panel">
        <header class="drawer-head">
          <h3>动作统计明细 · {{ detail['统计编号'] }}</h3>
          <button class="btn ghost" type="button" @click="detail = null">关闭</button>
        </header>

        <dl class="detail-list">
          <div v-for="column in columns" :key="column" class="detail-row">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] === '' || detail[column] == null ? '—' : detail[column] }}</dd>
          </div>
          <div class="detail-row">
            <dt>当前状态</dt>
            <dd><span :class="['status-badge', `status-${statusClass(String(detail.status))}`]">{{ detail.status }}</span></dd>
          </div>
          <div v-if="String(detail['重报自'] ?? '')" class="detail-row">
            <dt>重报来源</dt>
            <dd>本件由 {{ detail['重报自'] }} 退回后另开重报，原件仍保留可查</dd>
          </div>
          <div class="detail-row">
            <dt>签字轨迹</dt>
            <dd class="trail">{{ detail['签字轨迹'] || '尚无推进签字' }}</dd>
          </div>
        </dl>

        <!-- 待统计/统计中可改次数；已汇总后锁死，要改只能退回重报 -->
        <section v-if="canEditCounts(detail)" class="drawer-section">
          <h4>修改动作次数</h4>
          <div class="form-grid">
            <label class="filter-item"><span>动作次数</span><input v-model.number="editCounts.动作次数" type="number" min="0" step="1" /></label>
            <label class="filter-item"><span>正确动作次数</span><input v-model.number="editCounts.正确动作次数" type="number" min="0" step="1" /></label>
            <label class="filter-item"><span>误动次数</span><input v-model.number="editCounts.误动次数" type="number" min="0" step="1" /></label>
          </div>
          <button class="btn" type="button" @click="saveCounts">保存次数</button>
        </section>

        <section class="drawer-section">
          <h4>状态推进（统计专责签字）</h4>
          <div class="drawer-actions">
            <button
              v-for="action in availableTripActions(detail)"
              :key="action"
              class="btn primary"
              type="button"
              @click="runAction(action, detail)"
            >
              {{ action }}
            </button>
            <span v-if="!availableTripActions(detail).length" class="signer-hint">该状态没有可推进的动作</span>
          </div>
        </section>
      </div>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  advanceTripStat,
  availableTripActions,
  createTripStat,
  updateTripCounts,
} from '@/api/tripstat'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('tripstat')
// 列表与明细抽屉共用这一份列定义、读同一条 row，统计月份不会出现两处不一致。
const columns = [
  '统计编号',
  '所属线路',
  '动作次数',
  '正确动作次数',
  '误动次数',
  '统计月份',
  '统计人',
  '确认人',
]
const statuses = ['待统计', '统计中', '已汇总', '已复核', '已退回']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['统计编号', '所属线路', '统计月份']

// 状态推进的签字人：每一步都要填，落在记录的「确认人」上。
const signer = ref('')

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const active = rows.value.filter((row) => String(row.status) !== '已退回')
  const months = active.map((row) => String(row['统计月份'] ?? '')).filter(Boolean).sort()
  const latestMonth = months[months.length - 1] ?? ''
  return [
    { label: '待统计线路', value: active.filter((row) => String(row.status) === '待统计').length },
    { label: '已汇总线路', value: active.filter((row) => ['已汇总', '已复核'].includes(String(row.status))).length },
    {
      label: latestMonth ? `本月误动次数（${latestMonth}）` : '本月误动次数',
      value: active
        .filter((row) => String(row['统计月份'] ?? '') === latestMonth)
        .reduce((sum, row) => sum + Number(row['误动次数'] ?? 0), 0),
    },
  ]
})

function statusClass(status: string): string {
  return { 待统计: 'todo', 统计中: 'doing', 已汇总: 'summed', 已复核: 'done', 已退回: 'back' }[status] ?? 'todo'
}

function canEditCounts(row: EntryRow): boolean {
  return ['待统计', '统计中'].includes(String(row.status))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ---- 登记 ----
const creating = ref(false)
const createError = ref('')
const emptyForm = () => ({
  所属线路: '',
  统计月份: '',
  动作次数: 0,
  正确动作次数: 0,
  误动次数: 0,
  统计人: '',
})
const form = ref(emptyForm())

function openCreate() {
  form.value = emptyForm()
  createError.value = ''
  creating.value = true
}

function submitCreate() {
  createError.value = ''
  const result = createTripStat({ ...form.value })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  errorMessage.value = result.message
  reload()
}

// ---- 明细抽屉 ----
const detail = ref<EntryRow | null>(null)
const editCounts = ref({ 动作次数: 0, 正确动作次数: 0, 误动次数: 0 })

function openDetail(row: EntryRow) {
  detail.value = row
  editCounts.value = {
    动作次数: Number(row['动作次数'] ?? 0),
    正确动作次数: Number(row['正确动作次数'] ?? 0),
    误动次数: Number(row['误动次数'] ?? 0),
  }
  errorMessage.value = ''
}

function saveCounts() {
  if (!detail.value) {
    return
  }
  const result = updateTripCounts(Number(detail.value.id), { ...editCounts.value })
  errorMessage.value = result.message
  if (!result.ok) {
    return
  }
  reload()
  const refreshed = rows.value.find((row) => Number(row.id) === Number(detail.value?.id))
  if (refreshed) {
    openDetail(refreshed)
  }
}

// ---- 状态推进 ----
function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = advanceTripStat(Number(row.id), action, signer.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
  if (detail.value && Number(detail.value.id) === Number(row.id)) {
    // 退回重报会另开一条，原件变「已退回」：抽屉回到原件，展示留查状态。
    const refreshed = rows.value.find((item) => Number(item.id) === Number(row.id))
    detail.value = refreshed ?? null
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保护动作统计列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.signer-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.signer-bar .filter-item { min-width: 240px; }
.signer-hint { color: var(--muted); font-size: 12px; }
.data-table tbody tr { cursor: pointer; }
.row-returned { color: var(--muted); background: #fafbfc; }
.resub-tag { margin-left: 6px; font-size: 11px; color: #92400e; background: #fef3c7; border-radius: 999px; padding: 1px 8px; }
.status-badge { border-radius: 999px; padding: 2px 10px; font-size: 12px; white-space: nowrap; }
.status-todo { background: #eef2f7; color: #475569; }
.status-doing { background: #e0ecff; color: #1d4ed8; }
.status-summed { background: #fef3c7; color: #92400e; }
.status-done { background: #dcfce7; color: #166534; }
.status-back { background: #fee2e2; color: #991b1b; }
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}
.modal {
  width: 640px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal h3 { margin: 0 0 6px; }
.modal-tip { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin-bottom: 12px;
}
.form-grid .filter-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.drawer {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  z-index: 40;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  width: 520px;
  max-width: 92vw;
  height: 100%;
  background: #fff;
  padding: 18px 20px;
  overflow-y: auto;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.15);
}
.drawer-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.drawer-head h3 { margin: 0; font-size: 16px; }
.detail-list { margin: 0 0 8px; }
.detail-row { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
.detail-row dt { width: 96px; flex-shrink: 0; color: var(--muted); }
.detail-row dd { margin: 0; flex: 1; }
.trail { white-space: pre-wrap; color: #334155; }
.drawer-section { margin-top: 16px; }
.drawer-section h4 { margin: 0 0 8px; font-size: 14px; }
.drawer-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
