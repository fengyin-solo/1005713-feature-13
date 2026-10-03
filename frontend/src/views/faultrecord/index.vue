<template>
  <section class="page" data-module="faultrecord">
    <header class="page-head">
      <div>
        <h2>故障录波管理</h2>
        <p class="page-desc">维护录波记录，围绕录波编号、故障线路、故障类型、故障电流做登记、筛选与状态流转；动作统计走到已复核后，对应录波自动进入下方待归档清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记录波记录</button>
        <button class="btn" type="button" @click="exportRows">导出故障录波清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="sub-panel">
      <header class="sub-panel-head">
        <h3>待归档清单（已复核动作统计驱动）</h3>
        <span class="sub-panel-count">{{ pendingArchiveRows.length }} 条</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>录波编号</th>
            <th>故障线路</th>
            <th>故障类型</th>
            <th>故障时间</th>
            <th>关联统计编号</th>
            <th>分析结论</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingArchiveRows" :key="String(row.id)">
            <td>{{ row.录波编号 ?? '—' }}</td>
            <td>{{ row.故障线路 ?? '—' }}</td>
            <td>{{ row.故障类型 ?? '—' }}</td>
            <td>{{ row.故障时间 ?? '—' }}</td>
            <td>{{ row.关联统计编号 ?? '—' }}</td>
            <td>{{ row.分析结论 ?? '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runAction('归档录波', row)">归档录波</button>
            </td>
          </tr>
          <tr v-if="!pendingArchiveRows.length">
            <td colspan="7" class="empty-state">暂无待归档录波，动作统计经专责复核后会自动进入这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="['status-tag', String(row.关联统计编号 ?? '') && row.status === '已定性' ? 'ok' : '']">
              {{ row.status }}
            </span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无故障录波数据，可先登记录波记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条故障录波记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listPendingArchiveFaults,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('faultrecord')
const columns = ['录波编号', '故障线路', '故障类型', '故障电流', '故障时间', '分析人', '分析结论', '录波状态']
const actions = ['提交分析', '确认定性', '归档录波']
const statuses = ['待分析', '分析中', '已定性', '已归档']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const pendingArchiveRows = ref<EntryRow[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待分析录波', value: rows.value.filter((row) => String(row.status) === '待分析').length },
  { label: '分析中录波', value: rows.value.filter((row) => String(row.status) === '分析中').length },
  {
    label: '待归档录波',
    value: pendingArchiveRows.value.length,
  },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '录波记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    pendingArchiveRows.value = listPendingArchiveFaults()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '故障录波列表读取失败'
  }
}

onMounted(reload)
</script>
