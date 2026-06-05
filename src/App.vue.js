import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { clearRuntimeData, compare, createLead, customerServiceChat, getLeads, getSummary, getVehicles, publicConfig, rebuildRag, recommend } from './api/client';
const navs = [
    { key: 'dashboard', label: '销售总览', icon: '01' },
    { key: 'recommend', label: '智能推荐', icon: '02' },
    { key: 'service', label: '智能客服', icon: '03' },
    { key: 'compare', label: '竞品对比', icon: '04' },
    { key: 'leads', label: '销售线索', icon: '05' },
    { key: 'settings', label: '系统设置', icon: '06' }
];
const subtitles = {
    dashboard: '聚合车型库、线索、推荐日志、预算分布、关注点和知识库状态。',
    recommend: '基于用户画像、车型库、Skills 和多 Agent 协作生成可解释推荐，可开启 DeepSearch 联网增强。',
    service: '面向销售顾问和客户咨询的 Agent 智能客服，支持 Web Search、RAG 和合规检查。',
    compare: '围绕价格、续航、空间、智驾、补能和场景做竞品对比。',
    leads: '沉淀客户画像、推荐车型和后续跟进动作。',
    settings: '查看模型配置、RAG 状态和运行数据维护。'
};
const active = ref('dashboard');
const currentTitle = computed(() => navs.find(x => x.key === active.value)?.label || '');
const currentSubtitle = computed(() => subtitles[active.value] || '');
const summary = ref(null);
const vehicles = ref([]);
const leads = ref([]);
const config = ref(null);
const loading = ref(false);
const serviceLoading = ref(false);
const query = ref('预算 25 万以内，三口之家，上海通勤每天 50 公里，有家充，关注续航、空间和智驾，推荐哪几款新能源 SUV？');
const useDeepSearch = ref(true);
const serviceQuestion = ref('客户问：没有家充的家庭用户应该选择纯电、插混还是增程？请给出专业、合规、可执行的回答。');
const serviceUseWebSearch = ref(true);
const chatMessages = ref([
    { role: 'assistant', content: '您好，我是 NEV Insight 智能客服。可以帮您解答车型选择、充电续航、智能驾驶、价格权益和竞品对比问题。' }
]);
const profile = ref({ budget_max: 250000, city: '', family_size: null, commute_km: null, has_home_charger: null, preferred_type: '', preferred_energy: '', concerns: [] });
const recommendations = ref([]);
const answerHtml = ref('<span class="muted">点击生成推荐后，系统会展示推荐报告。</span>');
const serviceAnswerHtml = ref('<span class="muted">客服回答会显示在这里。</span>');
const agentTrace = ref([]);
const serviceTrace = ref([]);
const skillTrace = ref([]);
const sources = ref([]);
const compareModels = ref(['Model Y', 'G6', '宋L EV']);
const compareRows = ref([]);
function money(value) {
    if (!value)
        return '--';
    return `${Math.round(value / 10000)}万`;
}
function toHtml(text) {
    return (text || '').replaceAll('\n', '<br/>');
}
function normalizeUrl(url) {
    if (!url)
        return '#';
    if (url.startsWith('//'))
        return `https:${url}`;
    return url;
}
const energyOption = computed(() => pieOption(summary.value?.energy_distribution || {}));
const budgetOption = computed(() => barOption(summary.value?.budget_distribution || {}, '#2878c7'));
const concernOption = computed(() => barOption(summary.value?.concern_distribution || {}, '#1f7a4d'));
const hotModelOption = computed(() => ({
    tooltip: {},
    grid: { left: 90, right: 24, top: 24, bottom: 24 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: (summary.value?.hot_models || []).map((x) => `${x.brand} ${x.model}`).reverse() },
    series: [{ type: 'bar', data: (summary.value?.hot_models || []).map((x) => x.monthly_sales).reverse(), itemStyle: { color: '#246bfe' } }]
}));
const scatterOption = computed(() => ({
    tooltip: { formatter: (p) => `${p.data[2]}<br/>价格：${p.data[0]}万<br/>续航：${p.data[1]}km` },
    grid: { left: 48, right: 20, top: 24, bottom: 36 },
    xAxis: { name: '价格万', type: 'value' },
    yAxis: { name: 'CLTC km', type: 'value' },
    series: [{ type: 'scatter', symbolSize: 14, data: vehicles.value.map(v => [Math.round(((v.price_min + v.price_max) / 2) / 10000), v.cltc_range, `${v.brand} ${v.model}`]), itemStyle: { color: '#0f766e' } }]
}));
const radarOption = computed(() => {
    const top = recommendations.value[0] || {};
    return {
        tooltip: {},
        radar: { indicator: [
                { name: '预算', max: 100 }, { name: '续航', max: 100 }, { name: '空间', max: 100 },
                { name: '补能', max: 100 }, { name: '智驾', max: 100 }, { name: '安全', max: 100 }
            ] },
        series: [{ type: 'radar', data: [{ value: [top.budget_score || 0, top.range_score || 0, top.space_score || 0, top.charging_score || 0, top.smart_score || 0, top.safety_score || 0], name: top.model || '待推荐' }], areaStyle: { opacity: 0.18 } }]
    };
});
const compareScoreOption = computed(() => ({
    tooltip: {},
    grid: { left: 56, right: 20, top: 24, bottom: 42 },
    xAxis: { type: 'category', data: compareRows.value.map(x => `${x.brand} ${x.model}`) },
    yAxis: { type: 'value', max: 100 },
    series: [{ type: 'bar', data: compareRows.value.map(x => x.score || 0), itemStyle: { color: '#246bfe' } }]
}));
const compareScatterOption = computed(() => ({
    tooltip: { formatter: (p) => `${p.data[2]}<br/>起售价：${p.data[0]}万<br/>CLTC：${p.data[1]}km` },
    grid: { left: 56, right: 20, top: 24, bottom: 42 },
    xAxis: { name: '起售价万', type: 'value' },
    yAxis: { name: 'CLTC km', type: 'value' },
    series: [{ type: 'scatter', symbolSize: 18, data: compareRows.value.map(x => [Math.round((x.price_min || 0) / 10000), x.cltc_range || 0, `${x.brand} ${x.model}`]), itemStyle: { color: '#0f766e' } }]
}));
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
}));
function pieOption(data) {
    return { tooltip: { trigger: 'item' }, legend: { bottom: 0 }, series: [{ type: 'pie', radius: ['45%', '70%'], data: Object.entries(data).map(([name, value]) => ({ name, value })) }] };
}
function barOption(data, color) {
    return { tooltip: {}, grid: { left: 52, right: 20, top: 24, bottom: 36 }, xAxis: { type: 'category', data: Object.keys(data) }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: Object.values(data), itemStyle: { color } }] };
}
async function refresh() {
    summary.value = await getSummary();
    vehicles.value = (await getVehicles()).vehicles;
    leads.value = (await getLeads()).leads;
    config.value = await publicConfig();
}
async function submitRecommend() {
    loading.value = true;
    try {
        const res = await recommend({ query: query.value, profile: profile.value, top_k: 5, use_deep_search: useDeepSearch.value });
        recommendations.value = res.recommendations;
        answerHtml.value = toHtml(res.answer);
        agentTrace.value = res.agent_trace;
        skillTrace.value = res.skill_trace;
        sources.value = res.sources;
        await refresh();
    }
    finally {
        loading.value = false;
    }
}
async function askCustomerService() {
    if (!serviceQuestion.value.trim())
        return;
    const userText = serviceQuestion.value.trim();
    const history = chatMessages.value.slice(-8).map(item => ({ role: item.role, content: item.content }));
    chatMessages.value.push({ role: 'user', content: userText });
    serviceQuestion.value = '';
    serviceLoading.value = true;
    try {
        const res = await customerServiceChat(userText, serviceUseWebSearch.value, history);
        serviceAnswerHtml.value = toHtml(res.answer);
        chatMessages.value.push({ role: 'assistant', content: res.answer });
        serviceTrace.value = res.agent_trace;
        skillTrace.value = res.skill_trace;
        sources.value = res.sources;
    }
    finally {
        serviceLoading.value = false;
    }
}
async function submitCompare() {
    const res = await compare({ models: compareModels.value, profile: profile.value });
    compareRows.value = res.result.vehicles;
}
function exportCompareCsv() {
    if (!compareRows.value.length) {
        ElMessage.warning('请先生成竞品对比');
        return;
    }
    const headers = ['品牌', '车型', '推荐分', '能源', '起售价', '最高价', 'CLTC', '座位数', '预算分', '续航分', '空间分', '补能分', '智驾分', '安全分', '亮点', '短板'];
    const rows = compareRows.value.map(x => [
        x.brand, x.model, x.score, x.energy_type, x.price_min, x.price_max, x.cltc_range, x.seats,
        x.budget_score, x.range_score, x.space_score, x.charging_score, x.smart_score, x.safety_score,
        x.highlights, x.weaknesses
    ]);
    const csv = [headers, ...rows].map(row => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `竞品对比_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
async function saveLead() {
    await createLead({ name: '演示客户', profile: profile.value, recommended_models: recommendations.value.slice(0, 3).map(x => `${x.brand} ${x.model}`), next_action: '邀约试驾并确认充电条件' });
    await refresh();
    ElMessage.success('线索已保存');
}
async function rebuildKnowledge() {
    await rebuildRag();
    await refresh();
    ElMessage.success('RAG 索引已重建');
}
async function clearData() {
    await ElMessageBox.confirm('确认清空线索、推荐日志和会话等运行态数据吗？', '清空运行数据', { type: 'warning' });
    await clearRuntimeData();
    recommendations.value = [];
    await refresh();
    ElMessage.success('运行数据已清空');
}
async function runDemo() {
    active.value = 'recommend';
    await submitRecommend();
}
onMounted(async () => {
    await refresh();
    await submitCompare();
});
const __VLS_ctx = {
    ...{},
    ...{},
};
let ___VLS_components;
let ___VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "app-shell" },
});
/** @type {__VLS_StyleScopedClasses['app-shell']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
    ...{ class: "sidebar" },
});
/** @type {__VLS_StyleScopedClasses['sidebar']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "brand" },
});
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "logo" },
});
/** @type {__VLS_StyleScopedClasses['logo']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
__VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
for (const [item] of __VLS_getVForSourceType((__VLS_ctx.navs))) {
    __VLS_asFunctionalElement(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.active = item.key;
                // @ts-ignore
                [navs, active,];
            } },
        key: (item.key),
        ...{ class: "nav-item" },
        ...{ class: ({ active: __VLS_ctx.active === item.key }) },
    });
    /** @type {__VLS_StyleScopedClasses['nav-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (item.icon);
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (item.label);
    // @ts-ignore
    [active,];
}
__VLS_asFunctionalElement(__VLS_intrinsics.main, __VLS_intrinsics.main)({
    ...{ class: "main" },
});
/** @type {__VLS_StyleScopedClasses['main']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.header, __VLS_intrinsics.header)({
    ...{ class: "hero" },
});
/** @type {__VLS_StyleScopedClasses['hero']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({
    ...{ class: "eyebrow" },
});
/** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
__VLS_asFunctionalElement(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
(__VLS_ctx.currentTitle);
__VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
(__VLS_ctx.currentSubtitle);
let __VLS_0;
/** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
elButton;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onClick': {} },
    type: "primary",
    size: "large",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onClick': {} },
    type: "primary",
    size: "large",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_5;
const __VLS_6 = ({ click: {} },
    { onClick: (__VLS_ctx.runDemo) });
const { default: __VLS_7 } = __VLS_3.slots;
// @ts-ignore
[currentTitle, currentSubtitle, runDemo,];
var __VLS_3;
var __VLS_4;
if (__VLS_ctx.active === 'dashboard') {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "section" },
    });
    /** @type {__VLS_StyleScopedClasses['section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "kpi-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['kpi-grid']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "kpi" },
    });
    /** @type {__VLS_StyleScopedClasses['kpi']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.summary?.vehicle_count || 0);
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "kpi" },
    });
    /** @type {__VLS_StyleScopedClasses['kpi']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.summary?.recommendation_count || 0);
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "kpi" },
    });
    /** @type {__VLS_StyleScopedClasses['kpi']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.money(__VLS_ctx.summary?.avg_budget || 0));
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "kpi" },
    });
    /** @type {__VLS_StyleScopedClasses['kpi']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.summary?.rag_stats?.chunks || 0);
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "grid three" },
    });
    /** @type {__VLS_StyleScopedClasses['grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['three']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_8;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
        ...{ class: "chart" },
        option: (__VLS_ctx.energyOption),
        autoresize: true,
    }));
    const __VLS_10 = __VLS_9({
        ...{ class: "chart" },
        option: (__VLS_ctx.energyOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_9));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_13;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
        ...{ class: "chart" },
        option: (__VLS_ctx.budgetOption),
        autoresize: true,
    }));
    const __VLS_15 = __VLS_14({
        ...{ class: "chart" },
        option: (__VLS_ctx.budgetOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_14));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_18;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_19 = __VLS_asFunctionalComponent(__VLS_18, new __VLS_18({
        ...{ class: "chart" },
        option: (__VLS_ctx.concernOption),
        autoresize: true,
    }));
    const __VLS_20 = __VLS_19({
        ...{ class: "chart" },
        option: (__VLS_ctx.concernOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_19));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "grid two" },
    });
    /** @type {__VLS_StyleScopedClasses['grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['two']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_23;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_24 = __VLS_asFunctionalComponent(__VLS_23, new __VLS_23({
        ...{ class: "chart tall" },
        option: (__VLS_ctx.hotModelOption),
        autoresize: true,
    }));
    const __VLS_25 = __VLS_24({
        ...{ class: "chart tall" },
        option: (__VLS_ctx.hotModelOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_24));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    /** @type {__VLS_StyleScopedClasses['tall']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_28;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
        ...{ class: "chart tall" },
        option: (__VLS_ctx.scatterOption),
        autoresize: true,
    }));
    const __VLS_30 = __VLS_29({
        ...{ class: "chart tall" },
        option: (__VLS_ctx.scatterOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_29));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    /** @type {__VLS_StyleScopedClasses['tall']} */ ;
}
if (__VLS_ctx.active === 'recommend') {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "section" },
    });
    /** @type {__VLS_StyleScopedClasses['section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "grid recommend-layout" },
    });
    /** @type {__VLS_StyleScopedClasses['grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['recommend-layout']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card-title" },
    });
    /** @type {__VLS_StyleScopedClasses['card-title']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_33;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.loading),
    }));
    const __VLS_35 = __VLS_34({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.loading),
    }, ...__VLS_functionalComponentArgsRest(__VLS_34));
    let __VLS_38;
    const __VLS_39 = ({ click: {} },
        { onClick: (__VLS_ctx.submitRecommend) });
    const { default: __VLS_40 } = __VLS_36.slots;
    // @ts-ignore
    [active, active, summary, summary, summary, summary, money, energyOption, budgetOption, concernOption, hotModelOption, scatterOption, loading, submitRecommend,];
    var __VLS_36;
    var __VLS_37;
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "field wide" },
    });
    /** @type {__VLS_StyleScopedClasses['field']} */ ;
    /** @type {__VLS_StyleScopedClasses['wide']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_41;
    /** @ts-ignore @type {typeof ___VLS_components.elInput | typeof ___VLS_components.ElInput} */
    elInput;
    // @ts-ignore
    const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({
        modelValue: (__VLS_ctx.query),
        type: "textarea",
        rows: (5),
    }));
    const __VLS_43 = __VLS_42({
        modelValue: (__VLS_ctx.query),
        type: "textarea",
        rows: (5),
    }, ...__VLS_functionalComponentArgsRest(__VLS_42));
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "form-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['form-grid']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "field" },
    });
    /** @type {__VLS_StyleScopedClasses['field']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_46;
    /** @ts-ignore @type {typeof ___VLS_components.elInputNumber | typeof ___VLS_components.ElInputNumber} */
    elInputNumber;
    // @ts-ignore
    const __VLS_47 = __VLS_asFunctionalComponent(__VLS_46, new __VLS_46({
        modelValue: (__VLS_ctx.profile.budget_max),
        min: (50000),
        step: (10000),
        placeholder: "预算上限",
    }));
    const __VLS_48 = __VLS_47({
        modelValue: (__VLS_ctx.profile.budget_max),
        min: (50000),
        step: (10000),
        placeholder: "预算上限",
    }, ...__VLS_functionalComponentArgsRest(__VLS_47));
    __VLS_asFunctionalElement(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "field" },
    });
    /** @type {__VLS_StyleScopedClasses['field']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    let __VLS_51;
    /** @ts-ignore @type {typeof ___VLS_components.elSelect | typeof ___VLS_components.ElSelect} */
    elSelect;
    // @ts-ignore
    const __VLS_52 = __VLS_asFunctionalComponent(__VLS_51, new __VLS_51({
        modelValue: (__VLS_ctx.profile.preferred_type),
        placeholder: "偏好车型",
    }));
    const __VLS_53 = __VLS_52({
        modelValue: (__VLS_ctx.profile.preferred_type),
        placeholder: "偏好车型",
    }, ...__VLS_functionalComponentArgsRest(__VLS_52));
    const { default: __VLS_56 } = __VLS_54.slots;
    let __VLS_57;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_58 = __VLS_asFunctionalComponent(__VLS_57, new __VLS_57({
        label: "不限",
        value: "",
    }));
    const __VLS_59 = __VLS_58({
        label: "不限",
        value: "",
    }, ...__VLS_functionalComponentArgsRest(__VLS_58));
    let __VLS_62;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_63 = __VLS_asFunctionalComponent(__VLS_62, new __VLS_62({
        label: "SUV",
        value: "SUV",
    }));
    const __VLS_64 = __VLS_63({
        label: "SUV",
        value: "SUV",
    }, ...__VLS_functionalComponentArgsRest(__VLS_63));
    let __VLS_67;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_68 = __VLS_asFunctionalComponent(__VLS_67, new __VLS_67({
        label: "轿车",
        value: "轿车",
    }));
    const __VLS_69 = __VLS_68({
        label: "轿车",
        value: "轿车",
    }, ...__VLS_functionalComponentArgsRest(__VLS_68));
    let __VLS_72;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
        label: "MPV",
        value: "MPV",
    }));
    const __VLS_74 = __VLS_73({
        label: "MPV",
        value: "MPV",
    }, ...__VLS_functionalComponentArgsRest(__VLS_73));
    let __VLS_77;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({
        label: "旅行车",
        value: "旅行车",
    }));
    const __VLS_79 = __VLS_78({
        label: "旅行车",
        value: "旅行车",
    }, ...__VLS_functionalComponentArgsRest(__VLS_78));
    let __VLS_82;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_83 = __VLS_asFunctionalComponent(__VLS_82, new __VLS_82({
        label: "跑车",
        value: "跑车",
    }));
    const __VLS_84 = __VLS_83({
        label: "跑车",
        value: "跑车",
    }, ...__VLS_functionalComponentArgsRest(__VLS_83));
    let __VLS_87;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_88 = __VLS_asFunctionalComponent(__VLS_87, new __VLS_87({
        label: "轿跑",
        value: "轿跑",
    }));
    const __VLS_89 = __VLS_88({
        label: "轿跑",
        value: "轿跑",
    }, ...__VLS_functionalComponentArgsRest(__VLS_88));
    let __VLS_92;
    /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
    elOption;
    // @ts-ignore
    const __VLS_93 = __VLS_asFunctionalComponent(__VLS_92, new __VLS_92({
        label: "豪车",
        value: "豪车",
    }));
    const __VLS_94 = __VLS_93({
        label: "豪车",
        value: "豪车",
    }, ...__VLS_functionalComponentArgsRest(__VLS_93));
    // @ts-ignore
    [query, profile, profile,];
    var __VLS_54;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "switch-row" },
    });
    /** @type {__VLS_StyleScopedClasses['switch-row']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_97;
    /** @ts-ignore @type {typeof ___VLS_components.elSwitch | typeof ___VLS_components.ElSwitch} */
    elSwitch;
    // @ts-ignore
    const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({
        modelValue: (__VLS_ctx.useDeepSearch),
        activeText: "开启",
        inactiveText: "关闭",
    }));
    const __VLS_99 = __VLS_98({
        modelValue: (__VLS_ctx.useDeepSearch),
        activeText: "开启",
        inactiveText: "关闭",
    }, ...__VLS_functionalComponentArgsRest(__VLS_98));
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_102;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_103 = __VLS_asFunctionalComponent(__VLS_102, new __VLS_102({
        ...{ class: "chart" },
        option: (__VLS_ctx.radarOption),
        autoresize: true,
    }));
    const __VLS_104 = __VLS_103({
        ...{ class: "chart" },
        option: (__VLS_ctx.radarOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_103));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "recommend-cards" },
    });
    /** @type {__VLS_StyleScopedClasses['recommend-cards']} */ ;
    for (const [item] of __VLS_getVForSourceType((__VLS_ctx.recommendations))) {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (item.id),
            ...{ class: "vehicle-card" },
        });
        /** @type {__VLS_StyleScopedClasses['vehicle-card']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "score" },
            ...{ class: ({ web: item.source_type === 'web' }) },
        });
        /** @type {__VLS_StyleScopedClasses['score']} */ ;
        /** @type {__VLS_StyleScopedClasses['web']} */ ;
        (item.source_type === 'web' ? 'WEB' : item.score);
        __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (item.brand);
        (item.model);
        if (item.source_type === 'web') {
            __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            (item.energy_type);
            (item.vehicle_type);
            (item.cltc_range);
        }
        if (item.source_type === 'web') {
            __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "tags" },
            });
            /** @type {__VLS_StyleScopedClasses['tags']} */ ;
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "tags" },
            });
            /** @type {__VLS_StyleScopedClasses['tags']} */ ;
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (item.price_min / 10000);
            (item.price_max / 10000);
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (item.adas_level);
            __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (item.seats);
        }
        __VLS_asFunctionalElement(__VLS_intrinsics.ul, __VLS_intrinsics.ul)({});
        for (const [reason] of __VLS_getVForSourceType((item.reasons))) {
            __VLS_asFunctionalElement(__VLS_intrinsics.li, __VLS_intrinsics.li)({
                key: (reason),
            });
            (reason);
            // @ts-ignore
            [useDeepSearch, radarOption, recommendations,];
        }
        if (item.source_type === 'web' && item.source_url) {
            __VLS_asFunctionalElement(__VLS_intrinsics.a, __VLS_intrinsics.a)({
                ...{ class: "source-link" },
                href: (__VLS_ctx.normalizeUrl(item.source_url)),
                target: "_blank",
            });
            /** @type {__VLS_StyleScopedClasses['source-link']} */ ;
        }
        // @ts-ignore
        [normalizeUrl,];
    }
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "grid two" },
    });
    /** @type {__VLS_StyleScopedClasses['grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['two']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "answer" },
    });
    __VLS_asFunctionalDirective(___VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.answerHtml) }, null, null);
    /** @type {__VLS_StyleScopedClasses['answer']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "timeline" },
    });
    /** @type {__VLS_StyleScopedClasses['timeline']} */ ;
    for (const [step, index] of __VLS_getVForSourceType((__VLS_ctx.agentTrace))) {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (index),
        });
        __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (step.agent);
        __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (step.observation);
        // @ts-ignore
        [answerHtml, agentTrace,];
    }
}
if (__VLS_ctx.active === 'service') {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "section" },
    });
    /** @type {__VLS_StyleScopedClasses['section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "chat-layout" },
    });
    /** @type {__VLS_StyleScopedClasses['chat-layout']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card chat-card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    /** @type {__VLS_StyleScopedClasses['chat-card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "chat-head" },
    });
    /** @type {__VLS_StyleScopedClasses['chat-head']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.serviceLoading ? '客服正在查询资料并输入中...' : '在线 · Agent + RAG + Web Search');
    let __VLS_107;
    /** @ts-ignore @type {typeof ___VLS_components.elSwitch | typeof ___VLS_components.ElSwitch} */
    elSwitch;
    // @ts-ignore
    const __VLS_108 = __VLS_asFunctionalComponent(__VLS_107, new __VLS_107({
        modelValue: (__VLS_ctx.serviceUseWebSearch),
        activeText: "联网",
        inactiveText: "本地",
    }));
    const __VLS_109 = __VLS_108({
        modelValue: (__VLS_ctx.serviceUseWebSearch),
        activeText: "联网",
        inactiveText: "本地",
    }, ...__VLS_functionalComponentArgsRest(__VLS_108));
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "chat-window" },
    });
    /** @type {__VLS_StyleScopedClasses['chat-window']} */ ;
    for (const [msg, index] of __VLS_getVForSourceType((__VLS_ctx.chatMessages))) {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (index),
            ...{ class: "chat-message" },
            ...{ class: (msg.role) },
        });
        /** @type {__VLS_StyleScopedClasses['chat-message']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bubble" },
        });
        __VLS_asFunctionalDirective(___VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.toHtml(msg.content)) }, null, null);
        /** @type {__VLS_StyleScopedClasses['bubble']} */ ;
        // @ts-ignore
        [active, serviceLoading, serviceUseWebSearch, chatMessages, toHtml,];
    }
    if (__VLS_ctx.serviceLoading) {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "chat-message assistant" },
        });
        /** @type {__VLS_StyleScopedClasses['chat-message']} */ ;
        /** @type {__VLS_StyleScopedClasses['assistant']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bubble typing" },
        });
        /** @type {__VLS_StyleScopedClasses['bubble']} */ ;
        /** @type {__VLS_StyleScopedClasses['typing']} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    }
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "chat-input" },
    });
    /** @type {__VLS_StyleScopedClasses['chat-input']} */ ;
    let __VLS_112;
    /** @ts-ignore @type {typeof ___VLS_components.elInput | typeof ___VLS_components.ElInput} */
    elInput;
    // @ts-ignore
    const __VLS_113 = __VLS_asFunctionalComponent(__VLS_112, new __VLS_112({
        ...{ 'onKeydown': {} },
        modelValue: (__VLS_ctx.serviceQuestion),
        type: "textarea",
        rows: (3),
        resize: "none",
        placeholder: "请输入客户问题，例如：没有家充应该买纯电、插混还是增程？",
    }));
    const __VLS_114 = __VLS_113({
        ...{ 'onKeydown': {} },
        modelValue: (__VLS_ctx.serviceQuestion),
        type: "textarea",
        rows: (3),
        resize: "none",
        placeholder: "请输入客户问题，例如：没有家充应该买纯电、插混还是增程？",
    }, ...__VLS_functionalComponentArgsRest(__VLS_113));
    let __VLS_117;
    const __VLS_118 = ({ keydown: {} },
        { onKeydown: (__VLS_ctx.askCustomerService) });
    var __VLS_115;
    var __VLS_116;
    let __VLS_119;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_120 = __VLS_asFunctionalComponent(__VLS_119, new __VLS_119({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.serviceLoading),
    }));
    const __VLS_121 = __VLS_120({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.serviceLoading),
    }, ...__VLS_functionalComponentArgsRest(__VLS_120));
    let __VLS_124;
    const __VLS_125 = ({ click: {} },
        { onClick: (__VLS_ctx.askCustomerService) });
    const { default: __VLS_126 } = __VLS_122.slots;
    // @ts-ignore
    [serviceLoading, serviceLoading, serviceQuestion, askCustomerService, askCustomerService,];
    var __VLS_122;
    var __VLS_123;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "timeline" },
    });
    /** @type {__VLS_StyleScopedClasses['timeline']} */ ;
    for (const [step, index] of __VLS_getVForSourceType((__VLS_ctx.serviceTrace))) {
        __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (index),
        });
        __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (step.agent);
        __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (step.observation);
        // @ts-ignore
        [serviceTrace,];
    }
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_127;
    /** @ts-ignore @type {typeof ___VLS_components.elTable | typeof ___VLS_components.ElTable} */
    elTable;
    // @ts-ignore
    const __VLS_128 = __VLS_asFunctionalComponent(__VLS_127, new __VLS_127({
        data: (__VLS_ctx.sources),
        height: "420",
    }));
    const __VLS_129 = __VLS_128({
        data: (__VLS_ctx.sources),
        height: "420",
    }, ...__VLS_functionalComponentArgsRest(__VLS_128));
    const { default: __VLS_132 } = __VLS_130.slots;
    let __VLS_133;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({
        prop: "rank",
        label: "#",
        width: "55",
    }));
    const __VLS_135 = __VLS_134({
        prop: "rank",
        label: "#",
        width: "55",
    }, ...__VLS_functionalComponentArgsRest(__VLS_134));
    let __VLS_138;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_139 = __VLS_asFunctionalComponent(__VLS_138, new __VLS_138({
        prop: "domain",
        label: "来源类型",
        width: "110",
    }));
    const __VLS_140 = __VLS_139({
        prop: "domain",
        label: "来源类型",
        width: "110",
    }, ...__VLS_functionalComponentArgsRest(__VLS_139));
    let __VLS_143;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_144 = __VLS_asFunctionalComponent(__VLS_143, new __VLS_143({
        prop: "source",
        label: "来源",
        width: "180",
    }));
    const __VLS_145 = __VLS_144({
        prop: "source",
        label: "来源",
        width: "180",
    }, ...__VLS_functionalComponentArgsRest(__VLS_144));
    let __VLS_148;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_149 = __VLS_asFunctionalComponent(__VLS_148, new __VLS_148({
        prop: "score",
        label: "分数",
        width: "90",
    }));
    const __VLS_150 = __VLS_149({
        prop: "score",
        label: "分数",
        width: "90",
    }, ...__VLS_functionalComponentArgsRest(__VLS_149));
    let __VLS_153;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_154 = __VLS_asFunctionalComponent(__VLS_153, new __VLS_153({
        prop: "content",
        label: "证据片段 / 搜索标题",
    }));
    const __VLS_155 = __VLS_154({
        prop: "content",
        label: "证据片段 / 搜索标题",
    }, ...__VLS_functionalComponentArgsRest(__VLS_154));
    // @ts-ignore
    [sources,];
    var __VLS_130;
}
if (__VLS_ctx.active === 'compare') {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "section" },
    });
    /** @type {__VLS_StyleScopedClasses['section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card-title" },
    });
    /** @type {__VLS_StyleScopedClasses['card-title']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    let __VLS_158;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_159 = __VLS_asFunctionalComponent(__VLS_158, new __VLS_158({
        ...{ 'onClick': {} },
    }));
    const __VLS_160 = __VLS_159({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_159));
    let __VLS_163;
    const __VLS_164 = ({ click: {} },
        { onClick: (__VLS_ctx.exportCompareCsv) });
    const { default: __VLS_165 } = __VLS_161.slots;
    // @ts-ignore
    [active, exportCompareCsv,];
    var __VLS_161;
    var __VLS_162;
    let __VLS_166;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_167 = __VLS_asFunctionalComponent(__VLS_166, new __VLS_166({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_168 = __VLS_167({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_167));
    let __VLS_171;
    const __VLS_172 = ({ click: {} },
        { onClick: (__VLS_ctx.submitCompare) });
    const { default: __VLS_173 } = __VLS_169.slots;
    // @ts-ignore
    [submitCompare,];
    var __VLS_169;
    var __VLS_170;
    let __VLS_174;
    /** @ts-ignore @type {typeof ___VLS_components.elSelect | typeof ___VLS_components.ElSelect} */
    elSelect;
    // @ts-ignore
    const __VLS_175 = __VLS_asFunctionalComponent(__VLS_174, new __VLS_174({
        modelValue: (__VLS_ctx.compareModels),
        multiple: true,
        filterable: true,
        placeholder: "选择 2-3 款车型",
    }));
    const __VLS_176 = __VLS_175({
        modelValue: (__VLS_ctx.compareModels),
        multiple: true,
        filterable: true,
        placeholder: "选择 2-3 款车型",
    }, ...__VLS_functionalComponentArgsRest(__VLS_175));
    const { default: __VLS_179 } = __VLS_177.slots;
    for (const [v] of __VLS_getVForSourceType((__VLS_ctx.vehicles))) {
        let __VLS_180;
        /** @ts-ignore @type {typeof ___VLS_components.elOption | typeof ___VLS_components.ElOption} */
        elOption;
        // @ts-ignore
        const __VLS_181 = __VLS_asFunctionalComponent(__VLS_180, new __VLS_180({
            key: (v.id),
            label: (`${v.brand} ${v.model}`),
            value: (v.model),
        }));
        const __VLS_182 = __VLS_181({
            key: (v.id),
            label: (`${v.brand} ${v.model}`),
            value: (v.model),
        }, ...__VLS_functionalComponentArgsRest(__VLS_181));
        // @ts-ignore
        [compareModels, vehicles,];
    }
    // @ts-ignore
    [];
    var __VLS_177;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "grid two" },
    });
    /** @type {__VLS_StyleScopedClasses['grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['two']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_185;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_186 = __VLS_asFunctionalComponent(__VLS_185, new __VLS_185({
        ...{ class: "chart" },
        option: (__VLS_ctx.compareScoreOption),
        autoresize: true,
    }));
    const __VLS_187 = __VLS_186({
        ...{ class: "chart" },
        option: (__VLS_ctx.compareScoreOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_186));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_190;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_191 = __VLS_asFunctionalComponent(__VLS_190, new __VLS_190({
        ...{ class: "chart" },
        option: (__VLS_ctx.compareScatterOption),
        autoresize: true,
    }));
    const __VLS_192 = __VLS_191({
        ...{ class: "chart" },
        option: (__VLS_ctx.compareScatterOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_191));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_195;
    /** @ts-ignore @type {typeof ___VLS_components.VChart} */
    VChart;
    // @ts-ignore
    const __VLS_196 = __VLS_asFunctionalComponent(__VLS_195, new __VLS_195({
        ...{ class: "chart tall" },
        option: (__VLS_ctx.compareDimensionOption),
        autoresize: true,
    }));
    const __VLS_197 = __VLS_196({
        ...{ class: "chart tall" },
        option: (__VLS_ctx.compareDimensionOption),
        autoresize: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_196));
    /** @type {__VLS_StyleScopedClasses['chart']} */ ;
    /** @type {__VLS_StyleScopedClasses['tall']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    let __VLS_200;
    /** @ts-ignore @type {typeof ___VLS_components.elTable | typeof ___VLS_components.ElTable} */
    elTable;
    // @ts-ignore
    const __VLS_201 = __VLS_asFunctionalComponent(__VLS_200, new __VLS_200({
        data: (__VLS_ctx.compareRows),
        height: "460",
    }));
    const __VLS_202 = __VLS_201({
        data: (__VLS_ctx.compareRows),
        height: "460",
    }, ...__VLS_functionalComponentArgsRest(__VLS_201));
    const { default: __VLS_205 } = __VLS_203.slots;
    let __VLS_206;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_207 = __VLS_asFunctionalComponent(__VLS_206, new __VLS_206({
        prop: "brand",
        label: "品牌",
        width: "90",
    }));
    const __VLS_208 = __VLS_207({
        prop: "brand",
        label: "品牌",
        width: "90",
    }, ...__VLS_functionalComponentArgsRest(__VLS_207));
    let __VLS_211;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_212 = __VLS_asFunctionalComponent(__VLS_211, new __VLS_211({
        prop: "model",
        label: "车型",
        width: "130",
    }));
    const __VLS_213 = __VLS_212({
        prop: "model",
        label: "车型",
        width: "130",
    }, ...__VLS_functionalComponentArgsRest(__VLS_212));
    let __VLS_216;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_217 = __VLS_asFunctionalComponent(__VLS_216, new __VLS_216({
        prop: "score",
        label: "推荐分",
        width: "90",
    }));
    const __VLS_218 = __VLS_217({
        prop: "score",
        label: "推荐分",
        width: "90",
    }, ...__VLS_functionalComponentArgsRest(__VLS_217));
    let __VLS_221;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_222 = __VLS_asFunctionalComponent(__VLS_221, new __VLS_221({
        prop: "energy_type",
        label: "能源",
        width: "90",
    }));
    const __VLS_223 = __VLS_222({
        prop: "energy_type",
        label: "能源",
        width: "90",
    }, ...__VLS_functionalComponentArgsRest(__VLS_222));
    let __VLS_226;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_227 = __VLS_asFunctionalComponent(__VLS_226, new __VLS_226({
        prop: "price_min",
        label: "起售价",
        width: "100",
    }));
    const __VLS_228 = __VLS_227({
        prop: "price_min",
        label: "起售价",
        width: "100",
    }, ...__VLS_functionalComponentArgsRest(__VLS_227));
    let __VLS_231;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_232 = __VLS_asFunctionalComponent(__VLS_231, new __VLS_231({
        prop: "cltc_range",
        label: "CLTC",
        width: "90",
    }));
    const __VLS_233 = __VLS_232({
        prop: "cltc_range",
        label: "CLTC",
        width: "90",
    }, ...__VLS_functionalComponentArgsRest(__VLS_232));
    let __VLS_236;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_237 = __VLS_asFunctionalComponent(__VLS_236, new __VLS_236({
        prop: "highlights",
        label: "亮点",
    }));
    const __VLS_238 = __VLS_237({
        prop: "highlights",
        label: "亮点",
    }, ...__VLS_functionalComponentArgsRest(__VLS_237));
    let __VLS_241;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_242 = __VLS_asFunctionalComponent(__VLS_241, new __VLS_241({
        prop: "weaknesses",
        label: "短板",
    }));
    const __VLS_243 = __VLS_242({
        prop: "weaknesses",
        label: "短板",
    }, ...__VLS_functionalComponentArgsRest(__VLS_242));
    // @ts-ignore
    [compareScoreOption, compareScatterOption, compareDimensionOption, compareRows,];
    var __VLS_203;
}
if (__VLS_ctx.active === 'leads') {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "section" },
    });
    /** @type {__VLS_StyleScopedClasses['section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card-title" },
    });
    /** @type {__VLS_StyleScopedClasses['card-title']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    let __VLS_246;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_247 = __VLS_asFunctionalComponent(__VLS_246, new __VLS_246({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_248 = __VLS_247({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_247));
    let __VLS_251;
    const __VLS_252 = ({ click: {} },
        { onClick: (__VLS_ctx.saveLead) });
    const { default: __VLS_253 } = __VLS_249.slots;
    // @ts-ignore
    [active, saveLead,];
    var __VLS_249;
    var __VLS_250;
    let __VLS_254;
    /** @ts-ignore @type {typeof ___VLS_components.elTable | typeof ___VLS_components.ElTable} */
    elTable;
    // @ts-ignore
    const __VLS_255 = __VLS_asFunctionalComponent(__VLS_254, new __VLS_254({
        data: (__VLS_ctx.leads),
        height: "520",
    }));
    const __VLS_256 = __VLS_255({
        data: (__VLS_ctx.leads),
        height: "520",
    }, ...__VLS_functionalComponentArgsRest(__VLS_255));
    const { default: __VLS_259 } = __VLS_257.slots;
    let __VLS_260;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_261 = __VLS_asFunctionalComponent(__VLS_260, new __VLS_260({
        prop: "created_at",
        label: "创建时间",
        width: "170",
    }));
    const __VLS_262 = __VLS_261({
        prop: "created_at",
        label: "创建时间",
        width: "170",
    }, ...__VLS_functionalComponentArgsRest(__VLS_261));
    let __VLS_265;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_266 = __VLS_asFunctionalComponent(__VLS_265, new __VLS_265({
        prop: "name",
        label: "客户",
        width: "110",
    }));
    const __VLS_267 = __VLS_266({
        prop: "name",
        label: "客户",
        width: "110",
    }, ...__VLS_functionalComponentArgsRest(__VLS_266));
    let __VLS_270;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_271 = __VLS_asFunctionalComponent(__VLS_270, new __VLS_270({
        prop: "budget",
        label: "预算",
        width: "110",
    }));
    const __VLS_272 = __VLS_271({
        prop: "budget",
        label: "预算",
        width: "110",
    }, ...__VLS_functionalComponentArgsRest(__VLS_271));
    let __VLS_275;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_276 = __VLS_asFunctionalComponent(__VLS_275, new __VLS_275({
        prop: "city",
        label: "城市",
        width: "110",
    }));
    const __VLS_277 = __VLS_276({
        prop: "city",
        label: "城市",
        width: "110",
    }, ...__VLS_functionalComponentArgsRest(__VLS_276));
    let __VLS_280;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_281 = __VLS_asFunctionalComponent(__VLS_280, new __VLS_280({
        prop: "concerns",
        label: "关注点",
    }));
    const __VLS_282 = __VLS_281({
        prop: "concerns",
        label: "关注点",
    }, ...__VLS_functionalComponentArgsRest(__VLS_281));
    let __VLS_285;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_286 = __VLS_asFunctionalComponent(__VLS_285, new __VLS_285({
        prop: "intent_level",
        label: "意向",
        width: "100",
    }));
    const __VLS_287 = __VLS_286({
        prop: "intent_level",
        label: "意向",
        width: "100",
    }, ...__VLS_functionalComponentArgsRest(__VLS_286));
    let __VLS_290;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_291 = __VLS_asFunctionalComponent(__VLS_290, new __VLS_290({
        prop: "recommended_models",
        label: "推荐车型",
    }));
    const __VLS_292 = __VLS_291({
        prop: "recommended_models",
        label: "推荐车型",
    }, ...__VLS_functionalComponentArgsRest(__VLS_291));
    let __VLS_295;
    /** @ts-ignore @type {typeof ___VLS_components.elTableColumn | typeof ___VLS_components.ElTableColumn} */
    elTableColumn;
    // @ts-ignore
    const __VLS_296 = __VLS_asFunctionalComponent(__VLS_295, new __VLS_295({
        prop: "next_action",
        label: "下一步",
    }));
    const __VLS_297 = __VLS_296({
        prop: "next_action",
        label: "下一步",
    }, ...__VLS_functionalComponentArgsRest(__VLS_296));
    // @ts-ignore
    [leads,];
    var __VLS_257;
}
if (__VLS_ctx.active === 'settings') {
    __VLS_asFunctionalElement(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "section" },
    });
    /** @type {__VLS_StyleScopedClasses['section']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "grid two" },
    });
    /** @type {__VLS_StyleScopedClasses['grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['two']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-row" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-row']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.config?.base_url);
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-row" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-row']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.config?.chat_model);
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-row" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-row']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.config?.api_key_configured ? '已配置' : '未配置');
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-row" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-row']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.config?.watermark);
    __VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "card danger" },
    });
    /** @type {__VLS_StyleScopedClasses['card']} */ ;
    /** @type {__VLS_StyleScopedClasses['danger']} */ ;
    __VLS_asFunctionalElement(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_300;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_301 = __VLS_asFunctionalComponent(__VLS_300, new __VLS_300({
        ...{ 'onClick': {} },
    }));
    const __VLS_302 = __VLS_301({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_301));
    let __VLS_305;
    const __VLS_306 = ({ click: {} },
        { onClick: (__VLS_ctx.rebuildKnowledge) });
    const { default: __VLS_307 } = __VLS_303.slots;
    // @ts-ignore
    [active, config, config, config, config, rebuildKnowledge,];
    var __VLS_303;
    var __VLS_304;
    let __VLS_308;
    /** @ts-ignore @type {typeof ___VLS_components.elButton | typeof ___VLS_components.ElButton} */
    elButton;
    // @ts-ignore
    const __VLS_309 = __VLS_asFunctionalComponent(__VLS_308, new __VLS_308({
        ...{ 'onClick': {} },
        type: "danger",
    }));
    const __VLS_310 = __VLS_309({
        ...{ 'onClick': {} },
        type: "danger",
    }, ...__VLS_functionalComponentArgsRest(__VLS_309));
    let __VLS_313;
    const __VLS_314 = ({ click: {} },
        { onClick: (__VLS_ctx.clearData) });
    const { default: __VLS_315 } = __VLS_311.slots;
    // @ts-ignore
    [clearData,];
    var __VLS_311;
    var __VLS_312;
}
__VLS_asFunctionalElement(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "watermark" },
});
/** @type {__VLS_StyleScopedClasses['watermark']} */ ;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
//# sourceMappingURL=App.vue.js.map