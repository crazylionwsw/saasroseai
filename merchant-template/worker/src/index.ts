import { AutoRouter, cors } from 'itty-router'
import { Env } from './types'
import { verifyMerchant } from './auth-middleware'
import { handleGenerateSite, handleGetTemplateList, handleGeneratePreview } from './storefront'
import { handleCreateOrder, handleGetOrder, handleListOrders, handleUpdateOrderStatus, handleGetMenu } from './order'
import { handleCreatePayment, handlePaymentCallback, handleQueryPayment } from './payment'
import { handlePhoneConfigure, handlePhoneStatus } from './phone-config'
import { handleDashboardStats, handleSalesReport, handleTopItems, handleOrderStatusBreakdown } from './dashboard'
import { handleGetProfile, handleUpdateProfile, handleUpdateMenu, handleAnalyticsEvents } from './merchant-admin'
import { handleListStores, handleCreateStore, handleUpdateStore, handleDeleteStore, handleStoreAnalytics } from './stores'
import { handleListDeliveries, handleExportDelivery, handleListInventory, handleUpdateInventory, handleDeleteInventory, handleListSuppliers, handleCreateSupplier } from './delivery'
import { jsonResponse, errorResponse } from './utils'

const { preflight, corsify } = cors()
const router = AutoRouter({ before: [preflight], finally: [corsify] })

router.get('/api/health', () => jsonResponse({ status: 'ok' }))

router.post('/api/storefront/generate', (request: Request, env: Env) => request.json().then(data => handleGenerateSite(request, env, data)))
router.get('/api/storefront/templates', (_request: Request, env: Env) => handleGetTemplateList(env))
router.post('/api/storefront/preview', handleGeneratePreview)

router.get('/api/menu', handleGetMenu)

router.post('/api/orders', handleCreateOrder)
router.get('/api/orders', handleListOrders)
router.get('/api/orders/:orderId', handleGetOrder)
router.put('/api/orders/:orderId/status', handleUpdateOrderStatus)

router.post('/api/payments/create', handleCreatePayment)
router.post('/api/payments/callback', handlePaymentCallback)
router.get('/api/payments/:orderId', handleQueryPayment)

router.get('/api/phone/status', handlePhoneStatus)
router.post('/api/phone/configure', handlePhoneConfigure)

router.get('/api/merchant/stats', handleDashboardStats)
router.get('/api/merchant/reports/sales', handleSalesReport)
router.get('/api/merchant/reports/top-items', handleTopItems)
router.get('/api/merchant/reports/status-breakdown', handleOrderStatusBreakdown)
router.get('/api/merchant/profile', handleGetProfile)
router.put('/api/merchant/profile', handleUpdateProfile)
router.put('/api/merchant/menu', handleUpdateMenu)
router.post('/api/merchant/events', handleAnalyticsEvents)

router.get('/api/stores', handleListStores)
router.post('/api/stores', handleCreateStore)
router.put('/api/stores/:storeId', handleUpdateStore)
router.delete('/api/stores/:storeId', handleDeleteStore)
router.get('/api/stores/:storeId/analytics', handleStoreAnalytics)

router.get('/api/deliveries', handleListDeliveries)
router.get('/api/deliveries/export', handleExportDelivery)
router.get('/api/inventory', handleListInventory)
router.post('/api/inventory', handleUpdateInventory)
router.delete('/api/inventory', handleDeleteInventory)
router.get('/api/suppliers', handleListSuppliers)
router.post('/api/suppliers', handleCreateSupplier)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      return handleWebSocketUpgrade(request, env)
    }
    const authResult = await verifyMerchant(env)
    if (authResult.status !== 'active') {
      return authResult.status === 'auth_error'
        ? handleUnauthenticatedRequest(request, env)
        : errorResponse('商户已停用', 403, 403)
    }
    return router.fetch(request, env, ctx)
  },
}

async function handleUnauthenticatedRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/health') return jsonResponse({ status: 'ok' })
  if (url.pathname.startsWith('/api/')) return errorResponse('未授权', 401, 401)
  return serveDashboardHtml(request, env)
}

async function serveDashboardHtml(request: Request, env: Env): Promise<Response> {
  try {
    const merchant = await env.MERCHANT_DB.prepare('SELECT name, language FROM merchant_info WHERE id = ?').bind(env.MERCHANT_ID).first() as { name: string; language: string } | null
    return new Response(dashboardHtml(merchant?.name || 'Dashboard', merchant?.language || 'zh'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    return new Response(dashboardHtml('Dashboard', 'zh'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

async function handleWebSocketUpgrade(request: Request, env: Env): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade')
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426, headers: { 'Upgrade': 'websocket' } })
  }
  const id = env.CHAT_ROOM_DO.idFromName(env.MERCHANT_ID)
  const stub = env.CHAT_ROOM_DO.get(id)
  return stub.fetch(request)
}

function dashboardHtml(merchantName: string, lang: string): string {
  const t: Record<string, Record<string, string>> = {
    zh: {
      title: '商户后台', navOverview: '总览', navOrders: '订单', navMenu: '菜单',
      navAnalytics: '数据分析', navStores: '门店', navInventory: '库存',
      navDeliveries: '配送', navSuppliers: '供应商', navSettings: '设置',
      totalOrders: '总订单', todayOrders: '今日订单', monthlyOrders: '本月订单',
      totalRevenue: '总收入', todayRevenue: '今日收入', monthlyRevenue: '本月收入',
      pendingOrders: '待处理', recentOrders: '最近订单', topItems: '热销菜品',
      salesTrend: '销售趋势', orderId: '订单号', customer: '顾客', items: '菜品',
      total: '金额', status: '状态', time: '时间', exportCSV: '导出 CSV',
      noOrders: '暂无订单', orders: '订单', revenue: '收入', avgOrder: '均价',
    },
    en: {
      title: 'Merchant Dashboard', navOverview: 'Overview', navOrders: 'Orders',
      navMenu: 'Menu', navAnalytics: 'Analytics', navStores: 'Stores',
      navInventory: 'Inventory', navDeliveries: 'Deliveries', navSuppliers: 'Suppliers',
      navSettings: 'Settings', totalOrders: 'Total Orders', todayOrders: 'Today',
      monthlyOrders: 'This Month', totalRevenue: 'Total Revenue', todayRevenue: 'Today',
      monthlyRevenue: 'This Month', pendingOrders: 'Pending', recentOrders: 'Recent Orders',
      topItems: 'Top Items', salesTrend: 'Sales Trend', orderId: 'Order #',
      customer: 'Customer', items: 'Items', total: 'Total', status: 'Status',
      time: 'Time', exportCSV: 'Export CSV', noOrders: 'No orders yet',
      orders: 'Orders', revenue: 'Revenue', avgOrder: 'Avg Order',
    },
    fr: {
      title: 'Tableau de Bord', navOverview: 'Aperçu', navOrders: 'Commandes',
      navMenu: 'Menu', navAnalytics: 'Analytique', navStores: 'Magasins',
      navInventory: 'Inventaire', navDeliveries: 'Livraisons', navSuppliers: 'Fournisseurs',
      navSettings: 'Paramètres', totalOrders: 'Total Commandes', todayOrders: 'Aujourd\'hui',
      monthlyOrders: 'Ce Mois', totalRevenue: 'Revenu Total', todayRevenue: 'Aujourd\'hui',
      monthlyRevenue: 'Ce Mois', pendingOrders: 'En Attente', recentOrders: 'Commandes Récentes',
      topItems: 'Meilleures Ventes', salesTrend: 'Tendance', orderId: 'Commande #',
      customer: 'Client', items: 'Articles', total: 'Total', status: 'Statut',
      time: 'Heure', exportCSV: 'Exporter CSV', noOrders: 'Aucune commande',
      orders: 'Commandes', revenue: 'Revenu', avgOrder: 'Moyenne',
    },
  }
  const dict = t[lang] || t.en
  const L = (key: string) => dict[key] || key

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${L('title')} - ${merchantName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#333}
.sidebar{position:fixed;left:0;top:0;bottom:0;width:220px;background:#1a1a2e;color:#fff;padding:20px 0;overflow-y:auto}
.sidebar h2{padding:0 20px 20px;font-size:1.1rem;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:10px}
.sidebar a{display:block;padding:10px 20px;color:rgba(255,255,255,0.7);text-decoration:none;font-size:0.9rem;transition:.2s}
.sidebar a:hover,.sidebar a.active{background:rgba(255,255,255,0.1);color:#fff}
.main{margin-left:220px;padding:24px}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.topbar h1{font-size:1.4rem;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;padding:20px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.stat-card .num{font-size:1.6rem;font-weight:700;color:#1a1a2e}
.stat-card .label{font-size:0.82rem;color:#888;margin-top:4px}
.section{margin-bottom:24px}
.section h2{font-size:1.1rem;margin-bottom:12px;color:#444}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
th,td{padding:10px 14px;text-align:left;font-size:0.85rem;border-bottom:1px solid #eee}
th{background:#fafafa;font-weight:600;color:#555;font-size:0.8rem;text-transform:uppercase}
.status{padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:500}
.status.pending{background:#fff3cd;color:#856404}
.status.confirmed{background:#cce5ff;color:#004085}
.status.preparing{background:#d4edda;color:#155724}
.status.completed{background:#e2e3e5;color:#383d41}
.status.cancelled{background:#f8d7da;color:#721c24}
.btn{padding:6px 16px;border:none;border-radius:6px;cursor:pointer;font-size:0.82rem;transition:.2s}
.btn-primary{background:#1a1a2e;color:#fff}.btn-primary:hover{background:#2d2d5e}
.btn-sm{padding:4px 12px;font-size:0.78rem}
.btn-success{background:#28a745;color:#fff}.btn-warning{background:#ffc107}.btn-danger{background:#dc3545;color:#fff}
canvas{max-width:100%}.chart-container{background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:16px}
select{padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem}
.hidden{display:none}
@media(max-width:768px){.sidebar{width:100%;position:relative;height:auto}.main{margin-left:0}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body>
<div class="sidebar">
  <h2>${L('title')}</h2>
  <a href="#" class="active" data-page="overview">${L('navOverview')}</a>
  <a href="#" data-page="orders">${L('navOrders')}</a>
  <a href="#" data-page="menu">${L('navMenu')}</a>
  <a href="#" data-page="analytics">${L('navAnalytics')}</a>
  <a href="#" data-page="stores">${L('navStores')}</a>
  <a href="#" data-page="inventory">${L('navInventory')}</a>
  <a href="#" data-page="deliveries">${L('navDeliveries')}</a>
  <a href="#" data-page="suppliers">${L('navSuppliers')}</a>
</div>
<div class="main" id="app">
  <div class="topbar"><h1 id="pageTitle">${L('navOverview')}</h1><div id="topActions"></div></div>
  <div id="content"></div>
</div>
<script>
const L = ${JSON.stringify(dict)};
function t(k){return L[k]||k}
const API = window.location.origin;

async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{'Content-Type':'application/json',...opts.headers}});return r.json()}

function showPage(page){document.querySelectorAll('.sidebar a').forEach(a=>a.classList.remove('active'));document.querySelector(\`[data-page="\${page}"]\`)?.classList.add('active');document.getElementById('pageTitle').textContent=t('nav'+page.charAt(0).toUpperCase()+page.slice(1));window['render'+page.charAt(0).toUpperCase()+page.slice(1)]()}

// Overview
async function renderOverview(){
  const s=await api('/api/merchant/stats')
  document.getElementById('content').innerHTML=\`
    <div class="stats">
      \${['totalOrders','todayOrders','monthlyOrders','pendingOrders'].map(k=>\`<div class="stat-card"><div class="num">\${s[k]??0}</div><div class="label">\${t(k)}</div></div>\`).join('')}
      \${['totalRevenue','todayRevenue','monthlyRevenue'].map(k=>\`<div class="stat-card"><div class="num">$\${(s[k]??0).toFixed(2)}</div><div class="label">\${t(k)}</div></div>\`).join('')}
    </div>
    <div class="section"><h2>\${t('recentOrders')}</h2><div id="recentOrders"></div></div>
  \`
  const o=await api('/api/orders?limit=5')
  document.getElementById('recentOrders').innerHTML=o.orders?.length?tableHtml(o.orders):\`<p style="color:#999">\${t('noOrders')}</p>\`
}

// Orders
async function renderOrders(){
  const o=await api('/api/orders?limit=50')
  document.getElementById('content').innerHTML=\`
    <div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="exportCSV()">\${t('exportCSV')}</button></div>
    \${(o.orders?.length?tableHtml(o.orders):\`<p style="color:#999">\${t('noOrders')}</p>\`)}
  \`
}

function tableHtml(orders){
  return \`<table><thead><tr><th>\${t('orderId')}</th><th>\${t('customer')}</th><th>\${t('items')}</th><th>\${t('total')}</th><th>\${t('status')}</th><th>\${t('time')}</th></tr></thead><tbody>\${orders.map(o=>\`<tr><td>\${o.id}</td><td>\${o.customer_name||'-'}</td><td>\${typeof o.items==='string'?o.items.slice(0,40):JSON.stringify(o.items||[]).slice(0,40)}</td><td>$\${(o.total||0).toFixed(2)}</td><td><span class="status \${o.status||'pending'}">\${o.status||'pending'}</span></td><td>\${(o.created_at||'').slice(0,16)}</td></tr>\`).join('')}</tbody></table>\`
}

async function exportCSV(){window.open(API+'/api/deliveries/export?format=csv&days=7')}

async function renderMenu(){
  const m=await api('/api/menu')
  const cats=JSON.stringify(m.categories||[],null,2)
  document.getElementById('content').innerHTML=\`
    <div class="section"><h2>\${t('navMenu')}</h2>
    <textarea id="menuEditor" style="width:100%;min-height:400px;font-family:monospace;font-size:0.85rem;padding:12px;border:1px solid #ddd;border-radius:8px">\${cats}</textarea>
    <div style="margin-top:10px"><button class="btn btn-primary" onclick="saveMenu()">${L('navSettings')}</button></div></div>
  \`
}
window.saveMenu=async function(){const cats=JSON.parse(document.getElementById('menuEditor').value);await api('/api/merchant/menu',{method:'PUT',body:JSON.stringify({categories:cats})});alert('Saved!')}

async function renderAnalytics(){
  const[sales,top]=await Promise.all([api('/api/merchant/reports/sales?days=7'),api('/api/merchant/reports/top-items?limit=10')])
  document.getElementById('content').innerHTML=\`
    <div style="margin-bottom:16px">
      <select onchange="refreshAnalytics(this.value)">
        <option value="7">7 ${L('orders')}</option><option value="30">30 ${L('orders')}</option><option value="90">90 ${L('orders')}</option>
      </select>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="num">\${sales.data?.reduce((a,b)=>a+(b.order_count||0),0)||0}</div><div class="label">\${t('orders')}</div></div>
      <div class="stat-card"><div class="num">$\${(sales.data?.reduce((a,b)=>a+parseFloat(b.revenue||0),0)||0).toFixed(2)}</div><div class="label">\${t('revenue')}</div></div>
      <div class="stat-card"><div class="num">$\${(sales.data?.reduce((a,b)=>a+parseFloat(b.avg_order||0),0)/(sales.data?.length||1)).toFixed(2)}</div><div class="label">\${t('avgOrder')}</div></div>
    </div>
    <div class="chart-container"><canvas id="salesChart"></canvas></div>
    <div class="section"><h2>\${t('topItems')}</h2>
    \${top.items?.length?\`<table><tr><th>Item</th><th>Qty</th><th>Revenue</th></tr>\${top.items.map(i=>\`<tr><td>\${i.item_name}</td><td>\${i.qty}</td><td>$\${parseFloat(i.revenue||0).toFixed(2)}</td></tr>\`).join('')}</table>\`:''}
  \`
  renderSalesChart(sales.data||[])
}
window.refreshAnalytics=async function(d){const[sa,to]=await Promise.all([api('/api/merchant/reports/sales?days='+d),api('/api/merchant/reports/top-items?limit=10&days='+d)]);renderAnalytics()}
function renderSalesChart(data){
  setTimeout(()=>{const c=document.getElementById('salesChart');if(!c)return;const ctx=c.getContext('2d');c.width=c.parentElement.offsetWidth;c.height=200
  const max=Math.max(...data.map(d=>parseFloat(d.revenue||0)),1);const w=c.width/(data.length||1);ctx.clearRect(0,0,c.width,c.height)
  ctx.strokeStyle='#1a1a2e';ctx.lineWidth=2;ctx.beginPath();data.forEach((d,i)=>{const x=i*w+w/2,y=c.height-(parseFloat(d.revenue||0)/max)*(c.height-30)-15;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke()
  ctx.fillStyle='#1a1a2e';data.forEach((d,i)=>{const x=i*w+w/2-20,y=c.height-12;ctx.font='10px sans-serif';ctx.fillText(d.period?.slice(5)||'',x,y)})},100)
}

async function renderStores(){
  const s=await api('/api/stores')
  document.getElementById('content').innerHTML=\`
    <div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="showStoreForm()">+ Add Store</button></div>
    \${(s.stores?.length?\`<table><tr><th>Name</th><th>Phone</th><th>Address</th><th>Manager</th><th>Status</th><th></th></tr>\${s.stores.map(st=>\`<tr><td>\${st.name}</td><td>\${st.phone||'-'}</td><td>\${st.address||'-'}</td><td>\${st.manager_name||'-'}</td><td>\${st.is_active?'Active':'Inactive'}</td><td><button class="btn btn-sm btn-danger" onclick="deleteStore('\${st.id}')">Delete</button></td></tr>\`).join('')}</table>:\`<p>No stores yet</p>\`)}
  \`
}
window.showStoreForm=function(){const n=prompt('Store name:');if(!n)return;api('/api/stores',{method:'POST',body:JSON.stringify({name:n})}).then(()=>renderStores())}
window.deleteStore=function(id){if(!confirm('Delete?'))return;api('/api/stores/'+id,{method:'DELETE'}).then(()=>renderStores())}

async function renderInventory(){
  const[i,s]=await Promise.all([api('/api/inventory'),api('/api/suppliers')])
  document.getElementById('content').innerHTML=\`
    <div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="showInvForm()">+ Add Item</button></div>
    \${i.items?.length?\`<table><tr><th>Name</th><th>Category</th><th>Stock</th><th>Min</th><th>Cost</th><th></th></tr>\${i.items.map(it=>\`<tr><td>\${it.name}</td><td>\${it.category||'-'}</td><td>\${it.stock}</td><td>\${it.min_stock}</td><td>$\${(it.cost_price||0).toFixed(2)}</td><td><button class="btn btn-sm btn-danger" onclick="deleteInv('\${it.id}')">Delete</button></td></tr>\`).join('')}</table>:\`<p>No inventory items</p>\`}
    <div class="section" style="margin-top:24px"><h2>Suppliers</h2>
    \${s.suppliers?.length?\`<table><tr><th>Name</th><th>Contact</th><th>Phone</th></tr>\${s.suppliers.map(sp=>\`<tr><td>\${sp.name}</td><td>\${sp.contact_name||'-'}</td><td>\${sp.contact_phone||'-'}</td></tr>\`).join('')}</table>:\`<p>No suppliers</p>\`}
    <div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="showSupplierForm()">+ Add Supplier</button></div></div>
  \`
}
window.showInvForm=function(){const n=prompt('Item name:');if(!n)return;api('/api/inventory',{method:'POST',body:JSON.stringify({name:n})}).then(()=>renderInventory())}
window.deleteInv=function(id){if(!confirm('Delete?'))return;api('/api/inventory?id='+id,{method:'DELETE'}).then(()=>renderInventory())}
window.showSupplierForm=function(){const n=prompt('Supplier name:');if(!n)return;api('/api/suppliers',{method:'POST',body:JSON.stringify({name:n})}).then(()=>renderInventory())}

async function renderDeliveries(){
  const d=await api('/api/deliveries')
  document.getElementById('content').innerHTML=\`
    <div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="window.open(API+'/api/deliveries/export?format=csv&days=7')">Export CSV</button></div>
    \${d.orders?.length?\`<table><tr><th>Order ID</th><th>Platform</th><th>Customer</th><th>Total</th><th>Status</th></tr>\${d.orders.map(o=>\`<tr><td>\${o.id}</td><td>\${o.platform}</td><td>\${o.customer_name||'-'}</td><td>$\${(o.total||0).toFixed(2)}</td><td>\${o.delivery_status}</td></tr>\`).join('')}</table>:\`<p>No delivery orders</p>\`}
  \`
}

async function renderSuppliers(){renderInventory()}

document.querySelectorAll('.sidebar a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();showPage(a.dataset.page)}))
showPage('overview')
</script></body></html>`
}
