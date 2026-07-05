// Rose SaaS 管理后台代理 Worker
// 部署到 roseai.ca 所在 Cloudflare 账户 A
// 路由: saas.roseai.ca/*
// 目标: https://rose-saas-admin.pages.dev

const TARGET = 'https://rose-saas-admin.pages.dev'

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const targetUrl = TARGET + url.pathname + url.search

    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })

    const responseHeaders = new Headers(resp.headers)
    responseHeaders.set('X-Robots-Tag', 'noindex, nofollow')
    responseHeaders.delete('cf-ray')

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: responseHeaders,
    })
  },
}
