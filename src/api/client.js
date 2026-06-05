import axios from 'axios';
const http = axios.create({ baseURL: '/api', timeout: 120000 });
export async function getSummary() {
    const { data } = await http.get('/dashboard/summary');
    return data;
}
export async function getVehicles() {
    const { data } = await http.get('/vehicles');
    return data;
}
export async function recommend(payload) {
    const { data } = await http.post('/recommend', payload);
    return data;
}
export async function compare(payload) {
    const { data } = await http.post('/compare', payload);
    return data;
}
export async function ragChat(query) {
    const { data } = await http.post('/rag/chat', { query, top_k: 6 });
    return data;
}
export async function customerServiceChat(query, useWebSearch = true, history = []) {
    const { data } = await http.post('/customer-service/chat', { query, top_k: 6, use_web_search: useWebSearch, history });
    return data;
}
export async function deepSearch(query) {
    const { data } = await http.post('/deep-search', { query, top_k: 6 });
    return data;
}
export async function createLead(payload) {
    const { data } = await http.post('/leads', payload);
    return data;
}
export async function getLeads() {
    const { data } = await http.get('/leads');
    return data;
}
export async function publicConfig() {
    const { data } = await http.get('/config/public');
    return data;
}
export async function rebuildRag() {
    const { data } = await http.post('/rag/rebuild');
    return data;
}
export async function clearRuntimeData() {
    const { data } = await http.post('/admin/clear-runtime-data');
    return data;
}
//# sourceMappingURL=client.js.map