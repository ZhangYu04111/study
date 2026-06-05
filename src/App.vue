<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">N</div>
        <div>
          <h1>NEV Insight</h1>
          <p>新能源智能推荐中台</p>
        </div>
      </div>
      <button v-for="item in navs" :key="item.key" class="nav-item" :class="{ active: active === item.key }" @click="active = item.key">
        <span>{{ item.icon }}</span>
        <b>{{ item.label }}</b>
      </button>
    </aside>

    <main class="main">
      <header class="hero">
        <div>
          <p class="eyebrow">Multi-Agent · RAG · DeepSearch · Skills · SQLite</p>
          <h2>{{ currentTitle }}</h2>
          <p>{{ currentSubtitle }}</p>
        </div>
        <el-button type="primary" size="large" @click="runDemo">一键生成推荐</el-button>
      </header>

      <section v-if="active === 'dashboard'" class="section">
        <div class="kpi-grid">
          <div class="kpi"><span>车型库</span><strong>{{ summary?.vehicle_count || 0 }}</strong><p>覆盖主流新能源车型</p></div>
          <div class="kpi"><span>推荐次数</span><strong>{{ summary?.recommendation_count || 0 }}</strong><p>推荐日志自动沉淀</p></div>
          <div class="kpi"><span>平均预算</span><strong>{{ money(summary?.avg_budget || 0) }}</strong><p>线索预算中枢</p></div>
          <div class="kpi"><span>知识片段</span><strong>{{ summary?.rag_stats?.chunks || 0 }}</strong><p>RAG 可追溯证据</p></div>
        </div>

        <div class="grid three">
          <div class="card"><h3>能源类型分布</h3><VChart class="chart" :option="energyOption" autoresize /></div>
          <div class="card"><h3>预算分布</h3><VChart class="chart" :option="budgetOption" autoresize /></div>
          <div class="card"><h3>客户关注点</h3><VChart class="chart" :option="concernOption" autoresize /></div>
        </div>
        <div class="grid two">
          <div class="card"><h3>热门车型销量 Top</h3><VChart class="chart tall" :option="hotModelOption" autoresize /></div>
          <div class="card"><h3>价格 - 续航散点</h3><VChart class="chart tall" :option="scatterOption" autoresize /></div>
        </div>
      </section>

      <section v-if="active === 'recommend'" class="section">
        <div class="grid recommend-layout">
          <div class="card">
            <div class="card-title"><h3>客户购车需求</h3><el-button type="primary" :loading="loading" @click="submitRecommend">生成推荐</el-button></div>
            <label class="field wide">
              <span>自然语言需求</span>
              <el-input v-model="query" type="textarea" :rows="5" />
            </label>
            <div class="form-grid">
              <label class="field"><span>预算上限（元）</span><el-input-number v-model="profile.budget_max" :min="50000" :step="10000" placeholder="预算上限" /></label>
              <label class="field"><span>偏好车型</span><el-select v-model="profile.preferred_type" placeholder="偏好车型">
                  <el-option label="不限" value="" />
                  <el-option label="SUV" value="SUV" />
                  <el-option label="轿车" value="轿车" />
                  <el-option label="MPV" value="MPV" />
                  <el-option label="旅行车" value="旅行车" />
                  <el-option label="跑车" value="跑车" />
                  <el-option label="轿跑" value="轿跑" />
                  <el-option label="豪车" value="豪车" />
                </el-select></label>
            </div>
            <div class="switch-row">
              <div>
                <b>DeepSearch 联网增强</b>
                <p>开启后，智能推荐会调用 Web Search + RAG 补充公开资料，适合复杂选车和竞品问题。</p>
              </div>
              <el-switch v-model="useDeepSearch" active-text="开启" inactive-text="关闭" />
            </div>
          </div>

          <div class="card">
            <h3>推荐分项雷达</h3>
            <VChart class="chart" :option="radarOption" autoresize />
          </div>
        </div>

        <div class="recommend-cards">
          <div v-for="item in recommendations" :key="item.id" class="vehicle-card">
            <div class="score" :class="{ web: item.source_type === 'web' }">{{ item.source_type === 'web' ? 'WEB' : item.score }}</div>
            <h3>{{ item.brand }} {{ item.model }}</h3>
            <p v-if="item.source_type === 'web'">联网候选 · 参数待核验</p>
            <p v-else>{{ item.energy_type }} · {{ item.vehicle_type }} · {{ item.cltc_range }}km</p>
            <div class="tags" v-if="item.source_type === 'web'">
              <span>Web Search</span><span>待入库</span><span>需核验</span>
            </div>
            <div class="tags" v-else><span>{{ item.price_min / 10000 }}-{{ item.price_max / 10000 }}万</span><span>{{ item.adas_level }}</span><span>{{ item.seats }}座</span></div>
            <ul><li v-for="reason in item.reasons" :key="reason">{{ reason }}</li></ul>
            <a v-if="item.source_type === 'web' && item.source_url" class="source-link" :href="normalizeUrl(item.source_url)" target="_blank">查看搜索来源</a>
          </div>
        </div>

        <div class="grid two">
          <div class="card"><h3>Agent 推荐报告</h3><div class="answer" v-html="answerHtml"></div></div>
          <div class="card"><h3>多 Agent 调用链路</h3><div class="timeline"><div v-for="(step, index) in agentTrace" :key="index"><b>{{ step.agent }}</b><p>{{ step.observation }}</p></div></div></div>
        </div>
      </section>

      <section v-if="active === 'service'" class="section">
        <div class="chat-layout">
          <div class="card chat-card">
            <div class="chat-head">
              <div>
                <h3>NEV 智能客服</h3>
                <p>{{ serviceLoading ? '客服正在查询资料并输入中...' : '在线 · Agent + RAG + Web Search' }}</p>
              </div>
              <el-switch v-model="serviceUseWebSearch" active-text="联网" inactive-text="本地" />
            </div>
            <div class="chat-window">
              <div v-for="(msg, index) in chatMessages" :key="index" class="chat-message" :class="msg.role">
                <div class="bubble" v-html="toHtml(msg.content)"></div>
              </div>
              <div v-if="serviceLoading" class="chat-message assistant">
                <div class="bubble typing"><span></span><span></span><span></span> 正在思考输入中</div>
              </div>
            </div>
            <div class="chat-input">
              <el-input
                v-model="serviceQuestion"
                type="textarea"
                :rows="3"
                resize="none"
                placeholder="请输入客户问题，例如：没有家充应该买纯电、插混还是增程？"
                @keydown.ctrl.enter="askCustomerService"
              />
              <el-button type="primary" :loading="serviceLoading" @click="askCustomerService">发送</el-button>
            </div>
          </div>
          <div class="card">
            <h3>客服 Agent 调用链路</h3>
            <div class="timeline"><div v-for="(step, index) in serviceTrace" :key="index"><b>{{ step.agent }}</b><p>{{ step.observation }}</p></div></div>
          </div>
        </div>
        <div class="card">
          <h3>客服引用证据</h3>
          <el-table :data="sources" height="420">
            <el-table-column prop="rank" label="#" width="55" />
            <el-table-column prop="domain" label="来源类型" width="110" />
            <el-table-column prop="source" label="来源" width="180" />
            <el-table-column prop="score" label="分数" width="90" />
            <el-table-column prop="content" label="证据片段 / 搜索标题" />
          </el-table>
        </div>
      </section>

      <section v-if="active === 'compare'" class="section">
        <div class="card">
          <div class="card-title">
            <h3>竞品对比</h3>
            <div>
              <el-button @click="exportCompareCsv">导出 CSV</el-button>
              <el-button type="primary" @click="submitCompare">生成对比</el-button>
            </div>
          </div>
          <el-select v-model="compareModels" multiple filterable placeholder="选择 2-3 款车型">
            <el-option v-for="v in vehicles" :key="v.id" :label="`${v.brand} ${v.model}`" :value="v.model" />
          </el-select>
        </div>
        <div class="grid two">
          <div class="card"><h3>竞品综合评分</h3><VChart class="chart" :option="compareScoreOption" autoresize /></div>
          <div class="card"><h3>价格 - 续航对比</h3><VChart class="chart" :option="compareScatterOption" autoresize /></div>
        </div>
        <div class="card">
          <h3>分项能力对比</h3>
          <VChart class="chart tall" :option="compareDimensionOption" autoresize />
        </div>
        <div class="card">
          <el-table :data="compareRows" height="460">
            <el-table-column prop="brand" label="品牌" width="90" />
            <el-table-column prop="model" label="车型" width="130" />
            <el-table-column prop="score" label="推荐分" width="90" />
            <el-table-column prop="energy_type" label="能源" width="90" />
            <el-table-column prop="price_min" label="起售价" width="100" />
            <el-table-column prop="cltc_range" label="CLTC" width="90" />
            <el-table-column prop="highlights" label="亮点" />
            <el-table-column prop="weaknesses" label="短板" />
          </el-table>
        </div>
      </section>

      <section v-if="active === 'leads'" class="section">
        <div class="card">
          <div class="card-title"><h3>销售线索</h3><el-button type="primary" @click="saveLead">保存当前推荐为线索</el-button></div>
          <el-table :data="leads" height="520">
            <el-table-column prop="created_at" label="创建时间" width="170" />
            <el-table-column prop="name" label="客户" width="110" />
            <el-table-column prop="budget" label="预算" width="110" />
            <el-table-column prop="city" label="城市" width="110" />
            <el-table-column prop="concerns" label="关注点" />
            <el-table-column prop="intent_level" label="意向" width="100" />
            <el-table-column prop="recommended_models" label="推荐车型" />
            <el-table-column prop="next_action" label="下一步" />
          </el-table>
        </div>
      </section>

      <section v-if="active === 'settings'" class="section">
        <div class="grid two">
          <div class="card">
            <h3>系统配置</h3>
            <div class="setting-row"><span>Base URL</span><b>{{ config?.base_url }}</b></div>
            <div class="setting-row"><span>Chat Model</span><b>{{ config?.chat_model }}</b></div>
            <div class="setting-row"><span>API Key</span><b>{{ config?.api_key_configured ? '已配置' : '未配置' }}</b></div>
            <div class="setting-row"><span>水印</span><b>{{ config?.watermark }}</b></div>
          </div>
          <div class="card danger">
            <h3>数据维护</h3>
            <p>可重建知识库索引或清空线索、推荐日志、会话等运行态数据。</p>
            <el-button @click="rebuildKnowledge">重建 RAG 索引</el-button>
            <el-button type="danger" @click="clearData">清空运行数据</el-button>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { clearRuntimeData, compare, createLead, customerServiceChat, getLeads, getSummary, getVehicles, publicConfig, rebuildRag, recommend } from './api/client'

const navs = [
  { key: 'dashboard', label: '销售总览', icon: '01' },
  { key: 'recommend', label: '智能推荐', icon: '02' },
  { key: 'service', label: '智能客服', icon: '03' },
  { key: 'compare', label: '竞品对比', icon: '04' },
  { key: 'leads', label: '销售线索', icon: '05' },
  { key: 'settings', label: '系统设置', icon: '06' }
]

const subtitles: any = {
  dashboard: '聚合车型库、线索、推荐日志、预算分布、关注点和知识库状态。',
  recommend: '基于用户画像、车型库、Skills 和多 Agent 协作生成可解释推荐，可开启 DeepSearch 联网增强。',
  service: '面向销售顾问和客户咨询的 Agent 智能客服，支持 Web Search、RAG 和合规检查。',
  compare: '围绕价格、续航、空间、智驾、补能和场景做竞品对比。',
  leads: '沉淀客户画像、推荐车型和后续跟进动作。',
  settings: '查看模型配置、RAG 状态和运行数据维护。'
}

const active = ref('dashboard')
const currentTitle = computed(() => navs.find(x => x.key === active.value)?.label || '')
const currentSubtitle = computed(() => subtitles[active.value] || '')
const summary = ref<any>(null)
const vehicles = ref<any[]>([])
const leads = ref<any[]>([])
const config = ref<any>(null)
const loading = ref(false)
const serviceLoading = ref(false)
const query = ref('预算 25 万以内，三口之家，上海通勤每天 50 公里，有家充，关注续航、空间和智驾，推荐哪几款新能源 SUV？')
const useDeepSearch = ref(true)
const serviceQuestion = ref('客户问：没有家充的家庭用户应该选择纯电、插混还是增程？请给出专业、合规、可执行的回答。')
const serviceUseWebSearch = ref(true)
const chatMessages = ref<any[]>([
  { role: 'assistant', content: '您好，我是 NEV Insight 智能客服。可以帮您解答车型选择、充电续航、智能驾驶、价格权益和竞品对比问题。' }
])
const profile = ref<any>({ budget_max: 250000, city: '', family_size: null, commute_km: null, has_home_charger: null, preferred_type: '', preferred_energy: '', concerns: [] })
const recommendations = ref<any[]>([])
const answerHtml = ref('<span class="muted">点击生成推荐后，系统会展示推荐报告。</span>')
const serviceAnswerHtml = ref('<span class="muted">客服回答会显示在这里。</span>')
const agentTrace = ref<any[]>([])
const serviceTrace = ref<any[]>([])
const skillTrace = ref<any[]>([])
const sources = ref<any[]>([])
const compareModels = ref<any[]>(['Model Y', 'G6', '宋L EV'])
const compareRows = ref<any[]>([])

function money(value: number) {
  if (!value) return '--'
  return `${Math.round(value / 10000)}万`
}

function toHtml(text: string) {
  return (text || '').replaceAll('\n', '<br/>')
}

function normalizeUrl(url: string) {
  if (!url) return '#'
  if (url.startsWith('//')) return `https:${url}`
  return url
}

const energyOption = computed(() => pieOption(summary.value?.energy_distribution || {}))
const budgetOption = computed(() => barOption(summary.value?.budget_distribution || {}, '#2878c7'))
const concernOption = computed(() => barOption(summary.value?.concern_distribution || {}, '#1f7a4d'))
const hotModelOption = computed(() => ({
  tooltip: {},
  grid: { left: 90, right: 24, top: 24, bottom: 24 },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: (summary.value?.hot_models || []).map((x: any) => `${x.brand} ${x.model}`).reverse() },
  series: [{ type: 'bar', data: (summary.value?.hot_models || []).map((x: any) => x.monthly_sales).reverse(), itemStyle: { color: '#246bfe' } }]
}))
const scatterOption = computed(() => ({
  tooltip: { formatter: (p: any) => `${p.data[2]}<br/>价格：${p.data[0]}万<br/>续航：${p.data[1]}km` },
  grid: { left: 48, right: 20, top: 24, bottom: 36 },
  xAxis: { name: '价格万', type: 'value' },
  yAxis: { name: 'CLTC km', type: 'value' },
  series: [{ type: 'scatter', symbolSize: 14, data: vehicles.value.map(v => [Math.round(((v.price_min + v.price_max) / 2) / 10000), v.cltc_range, `${v.brand} ${v.model}`]), itemStyle: { color: '#0f766e' } }]
}))
const radarOption = computed(() => {
  const top = recommendations.value[0] || {}
  return {
    tooltip: {},
    radar: { indicator: [
      { name: '预算', max: 100 }, { name: '续航', max: 100 }, { name: '空间', max: 100 },
      { name: '补能', max: 100 }, { name: '智驾', max: 100 }, { name: '安全', max: 100 }
    ] },
    series: [{ type: 'radar', data: [{ value: [top.budget_score || 0, top.range_score || 0, top.space_score || 0, top.charging_score || 0, top.smart_score || 0, top.safety_score || 0], name: top.model || '待推荐' }], areaStyle: { opacity: 0.18 } }]
  }
})
const compareScoreOption = computed(() => ({
  tooltip: {},
  grid: { left: 56, right: 20, top: 24, bottom: 42 },
  xAxis: { type: 'category', data: compareRows.value.map(x => `${x.brand} ${x.model}`) },
  yAxis: { type: 'value', max: 100 },
  series: [{ type: 'bar', data: compareRows.value.map(x => x.score || 0), itemStyle: { color: '#246bfe' } }]
}))
const compareScatterOption = computed(() => ({
  tooltip: { formatter: (p: any) => `${p.data[2]}<br/>起售价：${p.data[0]}万<br/>CLTC：${p.data[1]}km` },
  grid: { left: 56, right: 20, top: 24, bottom: 42 },
  xAxis: { name: '起售价万', type: 'value' },
  yAxis: { name: 'CLTC km', type: 'value' },
  series: [{ type: 'scatter', symbolSize: 18, data: compareRows.value.map(x => [Math.round((x.price_min || 0) / 10000), x.cltc_range || 0, `${x.brand} ${x.model}`]), itemStyle: { color: '#0f766e' } }]
}))
const compareDimensionOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { left: 48, right: 20, top: 32, bottom: 64 },
  xAxis: { type: 'category', data: ['预算', '续航', '空间', '补能', '智驾', '安全'] },
  yAxis: { type: 'value', max: 100 },
  series: compareRows.value.map((x, index) => ({
    name: `${x.brand} ${x.model}`,
    type: 'bar',
    data: [x.budget_score, x.range_score, x.space_score, x.charging_score, x.smart_score, x.safety_score],
    itemStyle: { color: ['#246bfe', '#0f766e', '#d97706', '#7c3aed'][index % 4] }
  }))
}))

function pieOption(data: any) {
  return { tooltip: { trigger: 'item' }, legend: { bottom: 0 }, series: [{ type: 'pie', radius: ['45%', '70%'], data: Object.entries(data).map(([name, value]) => ({ name, value })) }] }
}

function barOption(data: any, color: string) {
  return { tooltip: {}, grid: { left: 52, right: 20, top: 24, bottom: 36 }, xAxis: { type: 'category', data: Object.keys(data) }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: Object.values(data), itemStyle: { color } }] }
}

async function refresh() {
  summary.value = await getSummary()
  vehicles.value = (await getVehicles()).vehicles
  leads.value = (await getLeads()).leads
  config.value = await publicConfig()
}

async function submitRecommend() {
  loading.value = true
  try {
    const res = await recommend({ query: query.value, profile: profile.value, top_k: 5, use_deep_search: useDeepSearch.value })
    recommendations.value = res.recommendations
    answerHtml.value = toHtml(res.answer)
    agentTrace.value = res.agent_trace
    skillTrace.value = res.skill_trace
    sources.value = res.sources
    await refresh()
  } finally {
    loading.value = false
  }
}

async function askCustomerService() {
  if (!serviceQuestion.value.trim()) return
  const userText = serviceQuestion.value.trim()
  const history = chatMessages.value.slice(-8).map(item => ({ role: item.role, content: item.content }))
  chatMessages.value.push({ role: 'user', content: userText })
  serviceQuestion.value = ''
  serviceLoading.value = true
  try {
    const res = await customerServiceChat(userText, serviceUseWebSearch.value, history)
    serviceAnswerHtml.value = toHtml(res.answer)
    chatMessages.value.push({ role: 'assistant', content: res.answer })
    serviceTrace.value = res.agent_trace
    skillTrace.value = res.skill_trace
    sources.value = res.sources
  } finally {
    serviceLoading.value = false
  }
}

async function submitCompare() {
  const res = await compare({ models: compareModels.value, profile: profile.value })
  compareRows.value = res.result.vehicles
}

function exportCompareCsv() {
  if (!compareRows.value.length) {
    ElMessage.warning('请先生成竞品对比')
    return
  }
  const headers = ['品牌', '车型', '推荐分', '能源', '起售价', '最高价', 'CLTC', '座位数', '预算分', '续航分', '空间分', '补能分', '智驾分', '安全分', '亮点', '短板']
  const rows = compareRows.value.map(x => [
    x.brand, x.model, x.score, x.energy_type, x.price_min, x.price_max, x.cltc_range, x.seats,
    x.budget_score, x.range_score, x.space_score, x.charging_score, x.smart_score, x.safety_score,
    x.highlights, x.weaknesses
  ])
  const csv = [headers, ...rows].map(row => row.map((cell: any) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `竞品对比_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function saveLead() {
  await createLead({ name: '演示客户', profile: profile.value, recommended_models: recommendations.value.slice(0, 3).map(x => `${x.brand} ${x.model}`), next_action: '邀约试驾并确认充电条件' })
  await refresh()
  ElMessage.success('线索已保存')
}

async function rebuildKnowledge() {
  await rebuildRag()
  await refresh()
  ElMessage.success('RAG 索引已重建')
}

async function clearData() {
  await ElMessageBox.confirm('确认清空线索、推荐日志和会话等运行态数据吗？', '清空运行数据', { type: 'warning' })
  await clearRuntimeData()
  recommendations.value = []
  await refresh()
  ElMessage.success('运行数据已清空')
}

async function runDemo() {
  active.value = 'recommend'
  await submitRecommend()
}

onMounted(async () => {
  await refresh()
  await submitCompare()
})
</script>
