<template>
  <section class="page" data-module="tripstat">
    <header class="page-head">
      <div>
        <h2>保护动作统计管理</h2>
        <p class="page-desc">动作统计按 待统计 → 统计中 → 已汇总 → 已复核 逐级推进，专责签字才生效；误动多于动作或次数咬合不上的卡在汇总；已复核由专责退回后当月另开一条重报，原记录保留可查。</p>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="field === '统计月份' ? '按月份检索，如 2026-09' : `按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>确认人</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="['status-tag', statusClass(row.status)]">{{ row.status }}</span>
          </td>
          <td>{{ row.确认人 || '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDrawer(row)">查看明细</button>
            <button
              v-for="action in availableActions(row.status)"
              :key="action"
              class="link"
              type="button"
              @click="openSign(action, row)"
            >
              {{ action }}
            </button>
            <button
              v-if="canRevise(row.status)"
              class="link"
              type="button"
              @click="openRevise(row)"
            >
              修改次数
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无保护动作统计数据，可先登记动作统计</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条保护动作统计记录（含已退回备查记录）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 修改次数 -->
    <div v-if="formVisible" class="modal-mask" @click.self="closeForm">
      <div class="modal-card">
        <h3 class="modal-title">{{ formMode === 'create' ? '登记动作统计' : `修改动作次数（${formState.统计编号}）` }}</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>统计编号</span>
            <input v-model="formState.统计编号" disabled />
          </label>
          <label class="form-item">
            <span>所属线路 *</span>
            <input v-model="formState.所属线路" placeholder="如 110kV 梅江线" />
          </label>
          <label class="form-item">
            <span>统计月份 *</span>
            <input v-model="formState.统计月份" placeholder="YYYY-MM，如 2026-09" />
          </label>
          <label class="form-item">
            <span>动作次数 *</span>
            <input v-model.number="formState.动作次数" type="number" min="0" step="1" />
          </label>
          <label class="form-item">
            <span>正确动作次数 *</span>
            <input v-model.number="formState.正确动作次数" type="number" min="0" step="1" />
          </label>
          <label class="form-item">
            <span>误动次数 *</span>
            <input v-model.number="formState.误动次数" type="number" min="0" step="1" />
          </label>
          <label class="form-item">
            <span>统计人 *</span>
            <input v-model="formState.统计人" placeholder="填报人姓名" />
          </label>
        </div>
        <p class="form-hint">同一条线路同一个月只允许有一条在办统计；次数咬合（误动 ≤ 动作、正确 + 误动 = 动作）在专责确认汇总时统一核对，填报阶段可先登记后核对。</p>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="button" @click="submitForm">
            {{ formMode === 'create' ? '登记' : '保存修改' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 专责签字 -->
    <div v-if="signVisible" class="modal-mask" @click.self="closeSign">
      <div class="modal-card narrow">
        <h3 class="modal-title">{{ signAction }} · 统计专责签字</h3>
        <p class="form-hint">
          记录「{{ signRow?.统计编号 }}」当前状态「{{ signRow?.status }}」，
          <template v-if="signAction === '退回重报'">退回后原记录保留为「已退回」，当月另开一条待统计记录重报。</template>
          <template v-else>确认后状态推进一级，确认人与确认时间落在同一条记录里。</template>
        </p>
        <label class="form-item">
          <span>统计专责姓名 *</span>
          <input v-model="signConfirmer" placeholder="签字的统计专责" />
        </label>
        <label v-if="signAction === '退回重报'" class="form-item">
          <span>退回原因 *</span>
          <textarea v-model="signReason" rows="3" placeholder="说明要改动作次数的原因"></textarea>
        </label>
        <p v-if="signError" class="error-text">{{ signError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeSign">取消</button>
          <button class="btn primary" type="button" @click="submitSign">签字确认</button>
        </div>
      </div>
    </div>

    <!-- 明细抽屉：字段直接取列表那一行，统计月份与列表读到的是同一份 -->
    <div v-if="drawerRow" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer-card">
        <header class="drawer-head">
          <h3>动作统计明细 · {{ drawerRow.统计编号 }}</h3>
          <button class="link" type="button" @click="closeDrawer">关闭</button>
        </header>
        <dl class="detail-list">
          <div v-for="field in detailFields" :key="field" class="detail-row">
            <dt>{{ field }}</dt>
            <dd>{{ drawerRow[field] === '' || drawerRow[field] == null ? '—' : drawerRow[field] }}</dd>
          </div>
          <div class="detail-row">
            <dt>当前状态</dt>
            <dd><span :class="['status-tag', statusClass(drawerRow.status)]">{{ drawerRow.status }}</span></dd>
          </div>
          <div class="detail-row">
            <dt>确认人</dt>
            <dd>{{ drawerRow.确认人 || '—' }}</dd>
          </div>
          <div class="detail-row">
            <dt>最近确认时间</dt>
            <dd>{{ drawerRow.确认时间 || '—' }}</dd>
          </div>
          <div v-if="drawerRow.原统计编号" class="detail-row">
            <dt>重报自</dt>
            <dd>{{ drawerRow.原统计编号 }}（退回后当月另开）</dd>
          </div>
          <div v-if="drawerRow.退回原因" class="detail-row">
            <dt>退回原因</dt>
            <dd>{{ drawerRow.退回原因 }}</dd>
          </div>
          <div class="detail-row column">
            <dt>签字记录</dt>
            <dd>{{ drawerRow.签字记录 || '—' }}</dd>
          </div>
        </dl>
        <div class="drawer-actions">
          <button
            v-for="action in availableActions(drawerRow.status)"
            :key="action"
            class="btn"
            type="button"
            @click="openSign(action, drawerRow)"
          >
            {{ action }}
          </button>
          <button v-if="canRevise(drawerRow.status)" class="btn" type="button" @click="openRevise(drawerRow)">
            修改次数
          </button>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createTripStat,
  downloadEntries,
  listEntries,
  moduleMeta,
  returnTripStat,
  reviseTripStat,
  signTripStat,
  suggestTripStatCode,
} from '@/api/local-service'
import type { EntryRow, TripStatForm } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('tripstat')
const session = useSessionStore()
// 列里不再重复「统计状态」字段，状态与确认人单独成列。
const columns = ['统计编号', '所属线路', '动作次数', '正确动作次数', '误动次数', '统计月份', '统计人']
const detailFields = ['统计编号', '所属线路', '动作次数', '正确动作次数', '误动次数', '统计月份', '统计人']
const statuses = ['待统计', '统计中', '已汇总', '已复核', '已退回']
// 每个状态只露出下一级动作，跳级操作在页面上无从点起，服务端也会再拒收一次。
const forwardActions: Record<string, string[]> = {
  待统计: ['提交统计'],
  统计中: ['确认汇总'],
  已汇总: ['送交复核'],
  已复核: ['退回重报'],
  已退回: [],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ 统计编号: '', 所属线路: '', 统计月份: '' })
const filterFields = ['统计编号', '所属线路', '统计月份']

const currentMonth = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})()

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待统计线路', value: rows.value.filter((row) => String(row.status) === '待统计').length },
  { label: '已汇总线路', value: rows.value.filter((row) => ['已汇总', '已复核'].includes(String(row.status))).length },
  {
    label: '本月误动次数',
    value: rows.value
      .filter((row) => String(row.统计月份) === currentMonth && !['已退回'].includes(String(row.status)))
      .reduce((sum, row) => sum + Number(row.误动次数 || 0), 0),
  },
])

function availableActions(status: string | number): string[] {
  return forwardActions[String(status)] ?? []
}

function canRevise(status: string | number): boolean {
  const current = String(status)
  return current === '待统计' || current === '统计中'
}

function statusClass(status: string | number): string {
  const current = String(status)
  if (current === '已复核') return 'ok'
  if (current === '已退回') return 'warn'
  return ''
}

function resetFilters() {
  filters.value = { 统计编号: '', 所属线路: '', 统计月份: '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

/* ----------------------------- 登记 / 修改 ----------------------------- */

const formVisible = ref(false)
const formMode = ref<'create' | 'revise'>('create')
const formError = ref('')
const editingId = ref<number | null>(null)
const formState = reactive<TripStatForm & { 统计编号: string }>({
  统计编号: '',
  所属线路: '',
  统计月份: currentMonth,
  动作次数: 0,
  正确动作次数: 0,
  误动次数: 0,
  统计人: '',
})

function blankForm() {
  formState.统计编号 = suggestTripStatCode()
  formState.所属线路 = ''
  formState.统计月份 = currentMonth
  formState.动作次数 = 0
  formState.正确动作次数 = 0
  formState.误动次数 = 0
  formState.统计人 = session.operator
}

function openCreate() {
  formMode.value = 'create'
  editingId.value = null
  formError.value = ''
  blankForm()
  formVisible.value = true
}

function openRevise(row: EntryRow) {
  formMode.value = 'revise'
  editingId.value = Number(row.id)
  formError.value = ''
  formState.统计编号 = String(row.统计编号)
  formState.所属线路 = String(row.所属线路)
  formState.统计月份 = String(row.统计月份)
  formState.动作次数 = Number(row.动作次数)
  formState.正确动作次数 = Number(row.正确动作次数)
  formState.误动次数 = Number(row.误动次数)
  formState.统计人 = String(row.统计人)
  formVisible.value = true
  closeDrawer()
}

function closeForm() {
  formVisible.value = false
}

function submitForm() {
  formError.value = ''
  const payload: TripStatForm = {
    所属线路: formState.所属线路,
    统计月份: formState.统计月份,
    动作次数: Number(formState.动作次数),
    正确动作次数: Number(formState.正确动作次数),
    误动次数: Number(formState.误动次数),
    统计人: formState.统计人,
  }
  const result =
    formMode.value === 'create'
      ? createTripStat(payload)
      : reviseTripStat(editingId.value as number, payload)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  errorMessage.value = result.message
  closeForm()
  reload()
}

/* ------------------------------ 专责签字 ------------------------------ */

const signVisible = ref(false)
const signError = ref('')
const signAction = ref('')
const signRowId = ref<number | null>(null)
const signConfirmer = ref('')
const signReason = ref('')

const signRow = computed(() => rows.value.find((row) => Number(row.id) === signRowId.value) ?? null)

function openSign(action: string, row: EntryRow) {
  signAction.value = action
  signRowId.value = Number(row.id)
  signConfirmer.value = session.operator
  signReason.value = ''
  signError.value = ''
  signVisible.value = true
}

function closeSign() {
  signVisible.value = false
  signRowId.value = null
}

function submitSign() {
  if (signRowId.value === null) {
    return
  }
  const result =
    signAction.value === '退回重报'
      ? returnTripStat(signRowId.value, { confirmer: signConfirmer.value, reason: signReason.value })
      : signTripStat(signRowId.value, signAction.value, { confirmer: signConfirmer.value })
  if (!result.ok) {
    signError.value = result.message
    return
  }
  errorMessage.value = result.message
  closeSign()
  reload()
}

/* ------------------------------- 明细抽屉 ------------------------------ */

const drawerId = ref<number | null>(null)
// 抽屉每次都从最新列表里按 id 取行，保证统计月份与列表读到的是同一份数据。
const drawerRow = computed(() => rows.value.find((row) => Number(row.id) === drawerId.value) ?? null)

function openDrawer(row: EntryRow) {
  drawerId.value = Number(row.id)
}

function closeDrawer() {
  drawerId.value = null
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
