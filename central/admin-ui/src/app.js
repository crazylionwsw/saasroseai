const API_BASE = 'https://rose-saas-central-api.touchwant.workers.dev'

function getToken() {
  return localStorage.getItem('admin_token')
}

async function api(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  }
  const resp = await fetch(API_BASE + path, { headers, ...options })
  if (resp.status === 401 && !path.includes('/auth/login')) {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('session_expires_at')
    alert('登录已过期，请重新登录')
    window.location.reload()
  }
  if (!resp.ok) {
    const text = await resp.text()
    let msg = resp.statusText
    try { const j = JSON.parse(text); msg = j.error || msg } catch {}
    throw new Error(msg)
  }
  return resp.json()
}

function getSessionExpiry() {
  return localStorage.getItem('session_expires_at')
}

function isSessionValid() {
  const exp = getSessionExpiry()
  if (!exp) return false
  return Date.now() < new Date(exp).getTime()
}

function navigate(page, params) {
  document.querySelectorAll('.menu-item').forEach(el => {
    const targetPage = page === 'merchant-detail' ? 'merchants' : page
    el.classList.toggle('active', el.dataset.page === targetPage)
  })
  switch (page) {
    case 'dashboard': renderDashboard(); break
    case 'merchants': renderMerchants(); break
    case 'templates': renderTemplates(); break
    case 'settings': renderSettings(); break
    case 'scrape-jobs': renderScrapeJobs(); break
    case 'merchant-detail': renderMerchantDetail(params.id); break
  }
}

// Modal
function showModal(html) {
  const overlay = document.getElementById('modal-overlay')
  document.getElementById('modal-content').innerHTML = html
  overlay.classList.remove('hidden')
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden')
}

// Time update
function updateTime() {
  const now = new Date()
  document.getElementById('current-time').textContent = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

// === Dashboard ===
async function renderDashboard() {
  const main = document.getElementById('main-content')
  main.innerHTML = '<div class="loading">加载仪表盘</div>'
  try {
    const data = await api('/api/merchants')
    const merchants = data.merchants ?? data ?? []
    const filtered = merchants.filter(m => m.status !== 'deleted')
    const total = filtered.length
    const active = filtered.filter(m => m.status === 'active').length
    const frozen = filtered.filter(m => m.status === 'frozen').length
    const expired = filtered.filter(m => m.status === 'expired').length
    main.innerHTML = `
      <div class="page-header">
        <h2>仪表盘</h2>
      </div>
      <div class="stat-cards">
        <div class="stat-card total" onclick="navigate('merchants')">
          <div class="stat-value">${total}</div>
          <div class="stat-label">商户总数</div>
        </div>
        <div class="stat-card active" onclick="navigate('merchants')">
          <div class="stat-value">${active}</div>
          <div class="stat-label">活跃商户</div>
        </div>
        <div class="stat-card frozen" onclick="navigate('merchants')">
          <div class="stat-value">${frozen}</div>
          <div class="stat-label">冻结商户</div>
        </div>
        <div class="stat-card expired" onclick="navigate('merchants')">
          <div class="stat-value">${expired}</div>
          <div class="stat-label">过期商户</div>
        </div>
      </div>
      <div class="quick-actions">
        <button class="btn btn-primary" onclick="showMerchantForm(null)">➕ 新增商户</button>
        <button class="btn btn-secondary" onclick="navigate('settings')">📋 系统设置</button>
      </div>
    `
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><p>❌ 加载失败: ${e.message}</p></div>`
  }
}

// === Merchants ===
async function renderMerchants() {
  const main = document.getElementById('main-content')
  main.innerHTML = '<div class="loading">加载商户列表</div>'
  try {
    const data = await api('/api/merchants')
    const merchants = (data.merchants ?? data ?? []).filter(m => m.status !== 'deleted')
    const statusMap = { active: '活跃', frozen: '冻结', expired: '过期' }
    main.innerHTML = `
      <div class="page-header">
        <h2>商户管理</h2>
        <button class="btn btn-primary" onclick="showMerchantForm(null)">➕ 新增商户</button>
      </div>
      <div class="toolbar">
        <input type="text" class="form-control" id="merchant-search" placeholder="搜索商户名称或子域名..." oninput="filterMerchants()">
        <select class="form-control" id="merchant-status-filter" onchange="filterMerchants()">
          <option value="">全部状态</option>
          <option value="active">活跃</option>
          <option value="frozen">冻结</option>
          <option value="expired">过期</option>
        </select>
      </div>
      <div class="card">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>子域名</th>
                <th>状态</th>
                <th>套餐</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="merchant-table-body">
              ${merchants.map(m => `
                <tr data-name="${(m.name || '').toLowerCase()}" data-subdomain="${(m.subdomain || '').toLowerCase()}" data-status="${m.status || ''}">
                  <td><a href="#" onclick="event.preventDefault();navigate('merchant-detail',{id:'${m.id}'})" style="color:var(--primary);text-decoration:none;font-weight:500;">${escHtml(m.name) || '-'}</a></td>
                  <td>${m.subdomain || '-'}</td>
                  <td><span class="badge ${m.status || 'active'}">${statusMap[m.status] || m.status || '-'}</span></td>
                  <td>${m.plan || '-'}</td>
                  <td>${m.created_at ? new Date(m.created_at).toLocaleString('zh-CN') : '-'}</td>
                  <td>
                    <button class="btn btn-sm btn-secondary" onclick="showMerchantForm('${m.id}')">编辑</button>
                    <button class="btn btn-sm btn-success" onclick="deployMerchant('${m.id}')">部署</button>
                    <button class="btn btn-sm ${m.status === 'frozen' ? 'btn-success' : 'btn-warning'}" onclick="toggleFreezeMerchant('${m.id}','${m.status}')">${m.status === 'frozen' ? '激活' : '冻结'}</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteMerchant('${m.id}')">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><p>❌ 加载失败: ${e.message}</p></div>`
  }
}

function filterMerchants() {
  const q = document.getElementById('merchant-search')?.value?.toLowerCase() || ''
  const status = document.getElementById('merchant-status-filter')?.value || ''
  document.querySelectorAll('#merchant-table-body tr').forEach(tr => {
    const matchName = tr.dataset.name.includes(q) || tr.dataset.subdomain.includes(q)
    const matchStatus = !status || tr.dataset.status === status
    tr.style.display = matchName && matchStatus ? '' : 'none'
  })
}

async function showMerchantForm(id) {
  let merchant = { name: '', subdomain: '', plan: 'basic', status: 'active', phone: '', email: '', theme_color: '#4F46E5', notes: '', templateId: 'classic' }
  if (id) {
    try {
      const data = await api(`/api/merchants/${id}`)
      merchant = data.merchant ?? data
    } catch (e) {
      alert('获取商户信息失败: ' + e.message)
      return
    }
  }

  let templates = [{ id: 'classic', name: 'Classic', built_in: true }]
  try {
    const tplData = await api('/api/templates')
    templates = tplData.templates ?? templates
  } catch {}

  const templateOptions = templates.map(t =>
    `<option value="${escHtml(t.id)}" ${(merchant.templateId || 'classic') === t.id ? 'selected' : ''}>${escHtml(t.name)}${t.built_in ? '' : ' 🏗️'}</option>`
  ).join('')

  showModal(`
    <div class="modal-header">
      <h3>${id ? '编辑商户' : '新增商户'}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <form id="merchant-form" data-id="${id || ''}">
      <div class="form-group">
        <label>商户名称</label>
        <input type="text" class="form-control" name="name" value="${escHtml(merchant.name)}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>手机号</label>
          <input type="tel" class="form-control" name="phone" value="${escHtml(merchant.phone || '')}" placeholder="选填">
        </div>
        <div class="form-group">
          <label>邮箱</label>
          <input type="email" class="form-control" name="email" value="${escHtml(merchant.email || '')}" placeholder="选填">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>套餐</label>
          <select class="form-control" name="plan">
            <option value="basic" ${merchant.plan === 'basic' ? 'selected' : ''}>基础版</option>
            <option value="pro" ${merchant.plan === 'pro' ? 'selected' : ''}>专业版</option>
            <option value="enterprise" ${merchant.plan === 'enterprise' ? 'selected' : ''}>企业版</option>
          </select>
        </div>
        <div class="form-group">
          <label>状态</label>
          <select class="form-control" name="status">
            <option value="active" ${merchant.status === 'active' ? 'selected' : ''}>活跃</option>
            <option value="frozen" ${merchant.status === 'frozen' ? 'selected' : ''}>冻结</option>
            <option value="expired" ${merchant.status === 'expired' ? 'selected' : ''}>过期</option>
          </select>
        </div>
        <div class="form-group" style="flex:0.5;">
          <label>主题色</label>
          <input type="color" class="form-control" name="theme_color" value="${merchant.theme_color || '#4F46E5'}" style="height:38px;padding:4px;">
        </div>
      </div>
      <div class="form-group">
        <label>网站模板</label>
        <select class="form-control" name="templateId">
          ${templateOptions}
        </select>
      </div>
      <div class="form-group">
        <label>备注</label>
        <textarea class="form-control" name="notes" rows="2" placeholder="选填">${escHtml(merchant.notes || '')}</textarea>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `)
  document.getElementById('merchant-form').addEventListener('submit', saveMerchant)
}

async function saveMerchant(e) {
  e.preventDefault()
  const form = e.target
  const id = form.dataset.id
  const data = Object.fromEntries(new FormData(form))
  try {
    if (id) {
      await api(`/api/merchants/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    } else {
      await api('/api/merchants', { method: 'POST', body: JSON.stringify(data) })
    }
    closeModal()
    renderMerchants()
  } catch (e) {
    alert('保存失败: ' + e.message)
  }
}

async function deployMerchant(id) {
  if (!confirm('确定要部署该商户吗？')) return
  try {
    const version = new Date().toISOString().replace(/[:.]/g, '-')
    await api(`/api/merchants/${id}/deployments`, { method: 'POST', body: JSON.stringify({ version }) })
    alert('部署已触发')
    renderMerchants()
  } catch (e) {
    alert('部署失败: ' + e.message)
  }
}

async function toggleFreezeMerchant(id, currentStatus) {
  const newStatus = currentStatus === 'frozen' ? 'active' : 'frozen'
  if (!confirm(`确定要${newStatus === 'active' ? '激活' : '冻结'}该商户吗？`)) return
  try {
    await api(`/api/merchants/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) })
    renderMerchants()
  } catch (e) {
    alert('操作失败: ' + e.message)
  }
}

async function deleteMerchant(id) {
  if (!confirm('确定要删除该商户吗？此操作不可撤销。')) return
  try {
    await api(`/api/merchants/${id}`, { method: 'DELETE' })
    alert('商户已删除')
    renderMerchants()
  } catch (e) {
    alert('删除失败: ' + e.message)
  }
}

// === Merchant Detail ===
async function renderMerchantDetail(id) {
  const main = document.getElementById('main-content')
  main.innerHTML = '<div class="loading">加载商户详情</div>'
  try {
    const data = await api(`/api/merchants/${id}`)
    const m = data.merchant ?? data
    const deploys = await api(`/api/merchants/${id}/deployments`)
    const deployRecords = deploys.deployments ?? deploys ?? []
    main.innerHTML = `
      <div class="detail-header">
        <button class="back-btn" onclick="navigate('merchants')">←</button>
        <h2>${escHtml(m.name)}</h2>
        <span class="badge ${m.status || 'active'}">${({ active: '活跃', frozen: '冻结', expired: '过期' })[m.status] || m.status || '-'}</span>
      </div>
      <div class="card">
        <div class="card-title">基本信息</div>
        <div class="info-grid">
          <div class="info-item"><label>ID</label><span>${m.id || '-'}</span></div>
          <div class="info-item"><label>名称</label><span>${escHtml(m.name) || '-'}</span></div>
          <div class="info-item"><label>子域名</label><span>${escHtml(m.subdomain) || '-'}</span></div>
          <div class="info-item"><label>套餐</label><span>${m.plan || '-'}</span></div>
          <div class="info-item"><label>模板</label><span><code>${escHtml(m.templateId || m.template_id || 'classic')}</code></span></div>
          <div class="info-item"><label>创建时间</label><span>${m.created_at ? new Date(m.created_at).toLocaleString('zh-CN') : '-'}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Token 管理</div>
        <div class="token-display">
          <span class="token-masked" id="token-display">${m.token ? m.token.substring(0, 8) + '****' : '未生成'}</span>
          <button class="btn btn-sm btn-secondary" onclick="revealToken('${id}')">显示</button>
          <button class="btn btn-sm btn-primary" onclick="regenerateToken('${id}')">重新生成</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">部署历史</div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th>开始时间</th>
                <th>结束时间</th>
                <th>日志</th>
              </tr>
            </thead>
            <tbody>
              ${deployRecords.length ? deployRecords.map(d => `
                <tr>
                  <td>${d.version || '-'}</td>
                  <td><span class="badge ${d.status === 'success' ? 'active' : d.status === 'running' ? 'frozen' : 'expired'}">${d.status || '-'}</span></td>
                  <td>${d.created_at ? new Date(d.created_at).toLocaleString('zh-CN') : '-'}</td>
                   <td>${d.completed_at ? new Date(d.completed_at).toLocaleString('zh-CN') : '-'}</td>
                  <td>${d.log ? `<button class="btn btn-sm btn-outline" onclick="alert('${escHtml(d.log)}')">查看日志</button>` : '-'}</td>
                </tr>
              `).join('') : '<tr><td colspan="5" style="text-align:center;color:#b2bec3;">暂无部署记录</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><p>❌ 加载失败: ${e.message}</p></div>`
  }
}

async function revealToken(id) {
  try {
    const data = await api(`/api/merchants/${id}/token`, { method: 'POST' })
    const token = data.token ?? ''
    document.getElementById('token-display').textContent = token
  } catch (e) {
    alert('获取 token 失败: ' + e.message)
  }
}

async function regenerateToken(id) {
  if (!confirm('确定要重新生成 token 吗？旧的 token 将立即失效。')) return
  try {
    const data = await api(`/api/merchants/${id}/token`, { method: 'POST' })
    const token = data.token ?? ''
    document.getElementById('token-display').textContent = token
  } catch (e) {
    alert('重新生成失败: ' + e.message)
  }
}

// === Templates ===
// Templates are created via website scraping only (no CRUD API)
async function renderTemplates() {
  const main = document.getElementById('main-content')
  main.innerHTML = `
    <div class="page-header">
      <h2>模板管理</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-accent" onclick="scrapeWebsite()">🌐 采集网站</button>
        <button class="btn btn-primary" onclick="navigate('scrape-jobs')">📋 采集任务</button>
      </div>
    </div>
    <div class="card" id="scrape-status" style="display:none;margin-bottom:16px;"></div>
    <div class="card">
      <div class="empty-state" style="padding:40px;">
        <p>模板通过网站采集功能创建，暂无独立的模板 CRUD 管理页面。</p>
        <p style="margin-top:8px;color:#666;font-size:14px;">点击「采集网站」按钮从餐厅官网抓取并生成模板。</p>
      </div>
    </div>
  `
}

// === Template Scraper ===
function scrapeWebsite() {
  showModal(`
    <div class="modal-header">
      <h3>🌐 从网站采集模板</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <p style="color:#666;margin-bottom:16px;font-size:14px;">输入一个餐厅官网地址，系统将自动抓取其页面并转换为可用的模板。</p>
    <form id="scrape-form">
      <div class="form-group">
        <label>网站 URL</label>
        <input type="url" class="form-control" name="url" placeholder="https://example-restaurant.com" required>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-accent">开始采集</button>
      </div>
    </form>
  `)
  document.getElementById('scrape-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const url = new FormData(e.target).get('url')
    closeModal()
    startScrape(url)
  })
}

async function startScrape(url) {
  const statusEl = document.getElementById('scrape-status')
  statusEl.style.display = 'block'
  statusEl.innerHTML = '<div class="loading">正在采集网站，请稍候...</div>'

  try {
    const data = await api('/api/templates/scrape', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })

    if (data.jobId) {
      pollScrapeJob(data.jobId)
    } else if (data.success) {
      const itemCount = data.menuItems ? data.menuItems.length : 0
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:8px;">
          <span style="font-size:24px;">✅</span>
          <div>
            <strong>采集完成!</strong>
            <p style="margin:4px 0 0;color:#666;font-size:13px;">
              餐厅: <strong>${escHtml(data.name)}</strong>
            </p>
            <p style="margin:2px 0 0;color:#666;font-size:13px;">
              电话: ${escHtml(data.phone || '—')} · 邮箱: ${escHtml(data.email || '—')} · 菜品: ${itemCount}
            </p>
            <p style="margin:2px 0 0;color:#666;font-size:13px;">
              模板已生成: <code>${data.templateId}</code>
            </p>
          </div>
          <button class="btn btn-sm btn-primary" onclick="this.closest('#scrape-status').style.display='none';renderTemplates()" style="margin-left:auto;">
            刷新模板列表
          </button>
        </div>
      `
    } else {
      statusEl.innerHTML = `<div class="empty-state"><p>❌ 采集失败: 未知错误</p></div>`
    }
  } catch (e) {
    statusEl.innerHTML = `<div class="empty-state"><p>❌ 提交失败: ${e.message}</p></div>`
  }
}

async function pollScrapeJob(jobId) {
  const statusEl = document.getElementById('scrape-status')
  try {
    const data = await api(`/api/templates/scrape/${jobId}`)
    const job = data.job
    if (!job) {
      statusEl.innerHTML = '<div class="empty-state"><p>❌ 任务不存在</p></div>'
      return
    }

    if (job.status === 'completed') {
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:8px;">
          <span style="font-size:24px;">✅</span>
          <div>
            <strong>采集完成!</strong>
            <p style="margin:4px 0 0;color:#666;font-size:13px;">
              模板已生成: <code>${job.templateId || '—'}</code>
            </p>
            <p style="margin:2px 0 0;color:#666;font-size:13px;">来源: ${escHtml(job.sourceUrl)}</p>
          </div>
          <button class="btn btn-sm btn-primary" onclick="this.closest('#scrape-status').style.display='none';renderTemplates()" style="margin-left:auto;">
            刷新模板列表
          </button>
        </div>
      `
    } else if (job.status === 'failed') {
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:8px;">
          <span style="font-size:24px;">❌</span>
          <div>
            <strong>采集失败</strong>
            <p style="margin:4px 0 0;color:#e74c3c;font-size:13px;">${escHtml(job.error || '未知错误')}</p>
          </div>
          <button class="btn btn-sm btn-secondary" onclick="this.closest('#scrape-status').style.display='none'" style="margin-left:auto;">关闭</button>
        </div>
      `
    } else {
      const statusText = '⏳ 处理中...'
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:8px;">
          <div style="width:20px;height:20px;border:2px solid #ddd;border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <div>
            <strong>${statusText}</strong>
            <p style="margin:4px 0 0;color:#666;font-size:13px;">${escHtml(job.progress || '')}</p>
          </div>
        </div>
      `
      setTimeout(() => pollScrapeJob(jobId), 2000)
    }
  } catch (e) {
    statusEl.innerHTML = `<div class="empty-state"><p>❌ 查询失败: ${e.message}</p></div>`
  }
}

// === Scrape Jobs ===
async function renderScrapeJobs() {
  const main = document.getElementById('main-content')
  main.innerHTML = '<div class="loading">加载采集任务列表</div>'
  try {
    const data = await api('/api/templates/scrape-jobs')
    const jobs = data.jobs ?? []
    main.innerHTML = `
      <div class="page-header">
        <h2>🌐 网站采集任务</h2>
        <button class="btn btn-accent" onclick="scrapeWebsite()">➕ 新建采集</button>
      </div>
      <div class="card" id="scrape-status" style="display:none;margin-bottom:16px;"></div>
      <div class="card">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>任务 ID</th>
                <th>目标 URL</th>
                <th>状态</th>
                <th>进度</th>
                <th>模板</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              ${jobs.length ? jobs.map(j => `
                <tr>
                  <td><code style="font-size:12px;">${j.id}</code></td>
                  <td><a href="${escHtml(j.sourceUrl)}" target="_blank" style="color:var(--primary);">${escHtml(j.sourceUrl)}</a></td>
                  <td><span class="badge ${j.status === 'completed' ? 'active' : j.status === 'failed' ? 'expired' : 'frozen'}">${j.status}</span></td>
                  <td>${escHtml(j.progress || '-')}${j.error ? `<br><small style="color:var(--red);">${escHtml(j.error)}</small>` : ''}</td>
                  <td>${j.templateId ? `<code>${j.templateId}</code>` : '-'}</td>
                  <td style="font-size:12px;color:var(--text-light);">${new Date(j.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              `).join('') : '<tr><td colspan="6" style="text-align:center;color:#b2bec3;">暂无采集任务</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><p>❌ 加载失败: ${e.message}</p></div>`
  }
}

function getDefaultDays() {
  return parseInt(localStorage.getItem('session_days') || '7')
}

// === Settings (local-only, no API) ===
function renderSettings() {
  const currentDays = getDefaultDays()
  const main = document.getElementById('main-content')
  main.innerHTML = `
    <div class="page-header">
      <h2>系统设置</h2>
    </div>
    <div class="card">
      <div class="card-title">会话设置</div>
      <div class="form-group">
        <label>会话有效期（天）</label>
        <select class="form-control" id="session-days-select">
          <option value="1" ${currentDays === 1 ? 'selected' : ''}>1 天</option>
          <option value="3" ${currentDays === 3 ? 'selected' : ''}>3 天</option>
          <option value="7" ${currentDays === 7 ? 'selected' : ''}>7 天（默认）</option>
          <option value="14" ${currentDays === 14 ? 'selected' : ''}>14 天</option>
          <option value="30" ${currentDays === 30 ? 'selected' : ''}>30 天</option>
        </select>
      </div>
      <button class="btn btn-primary" onclick="saveSessionDays()">保存</button>
    </div>
    <div class="card">
      <div class="card-title">会话状态</div>
      <div class="info-grid">
        <div class="info-item"><label>API 地址</label><span id="api-url">${API_BASE}</span></div>
        <div class="info-item"><label>登录状态</label><span id="token-status">${getToken() && isSessionValid() ? '✅ 已登录' : '❌ 未登录'}</span></div>
        <div class="info-item"><label>过期时间</label><span id="token-expiry">${getSessionExpiry() ? new Date(getSessionExpiry()).toLocaleString('zh-CN') : '-'}</span></div>
        <div class="info-item"><label>会话有效期</label><span>${currentDays} 天</span></div>
      </div>
      <div style="margin-top:16px;">
        <button class="btn btn-secondary" onclick="resetToken()">重新登录</button>
      </div>
    </div>
  `
}

function saveSessionDays() {
  const days = parseInt(document.getElementById('session-days-select').value)
  localStorage.setItem('session_days', String(days))
  alert(`会话有效期已设置为 ${days} 天，下次登录时生效。`)
  renderSettings()
}

async function resetToken() {
  showTokenModal('重新登录', async (adminToken, days) => {
    try {
      await login(adminToken, days)
      document.getElementById('token-status').textContent = '✅ 已登录'
      const exp = getSessionExpiry()
      const d = exp ? Math.round((new Date(exp) - Date.now()) / 86400000) : '?'
      alert(`重新登录成功！会话有效期 ${d} 天`)
      navigate('dashboard')
    } catch {
      alert('Admin Token 无效')
    }
  })
}

// === Helpers ===
function escHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

async function login(adminToken, days) {
  const resp = await fetch(API_BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ token: adminToken, days }),
  })
  if (!resp.ok) throw new Error('Admin Token 无效')
  const data = await resp.json()
  localStorage.setItem('admin_token', data.token)
  localStorage.setItem('session_expires_at', data.expiresAt)
  return data
}

function showTokenModal(title, onSubmit) {
  showModal(`
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <form id="token-login-form">
      <div class="form-group">
        <label>Admin Token</label>
        <input type="password" class="form-control" id="token-input" placeholder="输入管理员 Token" required autocomplete="off">
      </div>
      <p style="font-size:13px;color:#666;">会话有效期可在系统设置中配置，当前为 ${getDefaultDays()} 天</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">登录</button>
      </div>
    </form>
  `)
  document.getElementById('token-login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const token = document.getElementById('token-input').value
    closeModal()
    await onSubmit(token, getDefaultDays())
  })
  setTimeout(() => document.getElementById('token-input').focus(), 100)
}

function showLoginModal(resolve) {
  showTokenModal('管理员登录', async (adminToken, days) => {
    try {
      const data = await login(adminToken, days)
      const d = Math.round((new Date(data.expiresAt) - Date.now()) / 86400000)
      alert(`登录成功！会话有效期 ${d} 天，到期后需重新登录。`)
      resolve()
    } catch {
      alert('Admin Token 无效，请重新输入')
      showLoginModal(resolve)
    }
  })
}

async function requireToken() {
  if (getToken() && isSessionValid()) return
  localStorage.removeItem('admin_token')
  localStorage.removeItem('session_expires_at')
  return new Promise(resolve => showLoginModal(resolve))
}

// === Init ===
async function init() {
  await requireToken()
  updateTime()
  setInterval(updateTime, 1000)

  document.getElementById('sidebar-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item')
    if (!item) return
    e.preventDefault()
    const page = item.dataset.page
    if (page) navigate(page)
    document.getElementById('sidebar').classList.remove('open')
  })

  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open')
  })

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal()
  })

  navigate('dashboard')
}

document.addEventListener('DOMContentLoaded', init)
