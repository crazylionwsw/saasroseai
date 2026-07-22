interface Env {
  MERCHANT_DB: D1Database
  KNOWLEDGE: VectorizeIndex
  AI: Ai
  MERCHANT_ID: string
  DRIVE_TOKEN_ENCRYPTED?: string
  DRIVE_FOLDER_ID?: string
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedAt: string
}

interface SyncStats {
  processed: number
  added: number
  errors: string[]
}

export async function handleSyncKnowledge(request: Request, env: Env): Promise<Response> {
  try {
    const { results } = await env.MERCHANT_DB.prepare(
      `SELECT merchant_id, drive_token_encrypted, drive_folder_id
       FROM merchant_configs
       WHERE drive_token_encrypted IS NOT NULL AND drive_token_encrypted != ''`
    ).all<{ merchant_id: string; drive_token_encrypted: string; drive_folder_id: string }>()

    const results_list: { merchant_id: string; drive_token_encrypted: string; drive_folder_id: string }[] = results || []

    const summaries: { merchantId: string; result: SyncStats }[] = []

    for (const row of results_list) {
      const subEnv = {
        ...env,
        MERCHANT_ID: row.merchant_id,
        DRIVE_TOKEN_ENCRYPTED: row.drive_token_encrypted,
        DRIVE_FOLDER_ID: row.drive_folder_id,
      } as Env

      const result = await syncMerchantKnowledge(row.merchant_id, subEnv)
      summaries.push({ merchantId: row.merchant_id, result })
    }

    return new Response(JSON.stringify({
      success: true,
      totalMerchants: results_list.length,
      summaries,
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: (err as Error).message,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

function decryptToken(encrypted: string): string {
  return atob(encrypted)
}

export async function syncMerchantKnowledge(
  merchantId: string,
  env: Env
): Promise<SyncStats> {
  const stats: SyncStats = { processed: 0, added: 0, errors: [] }

  try {
    if (!env.DRIVE_TOKEN_ENCRYPTED || !env.DRIVE_FOLDER_ID) {
      return stats
    }

    const accessToken = decryptToken(env.DRIVE_TOKEN_ENCRYPTED)

    const driveFiles = await listDriveFiles(accessToken, env.DRIVE_FOLDER_ID)

    const { results: existingDocs } = await env.MERCHANT_DB.prepare(
      `SELECT drive_file_id, drive_file_name, drive_mime_type, drive_modified_at, status
       FROM knowledge_docs
       WHERE merchant_id = ?`
    ).bind(merchantId).all<{
      drive_file_id: string; drive_file_name: string; drive_mime_type: string; drive_modified_at: string; status: string
    }>()

    const existingMap = new Map<string, typeof existingDocs[0]>()
    if (existingDocs) {
      for (const doc of existingDocs) {
        existingMap.set(doc.drive_file_id, doc)
      }
    }

    const driveFileIds = new Set(driveFiles.map(f => f.id))

    for (const file of driveFiles) {
      stats.processed++

      try {
        const existing = existingMap.get(file.id)

        if (existing && existing.status === 'deleted') {
          continue
        }

        if (existing && existing.drive_modified_at >= file.modifiedAt) {
          continue
        }

        const content = await downloadDriveFile(accessToken, file.id, file.mimeType)
        const text = await extractTextFromFile(content, file.mimeType)

        if (!text) {
          stats.errors.push(`${file.name}: unsupported file type ${file.mimeType}`)
          continue
        }

        await deleteVectorsForFile(file.id, merchantId, env)

        const chunks = splitIntoChunks(text)

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]

          const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [chunk] })
          const vector = (embedding as { data: number[][] }).data[0]

          const vectorId = `${merchantId}:${file.id}:${i}`

          await env.KNOWLEDGE.insert([
            {
              id: vectorId,
              values: vector,
              metadata: {
                merchantId,
                text: chunk,
                fileName: file.name,
                fileId: file.id,
                chunkIndex: i,
              },
            },
          ])
        }

        if (existing) {
          await env.MERCHANT_DB.prepare(
            `UPDATE knowledge_docs
             SET drive_file_name = ?, drive_mime_type = ?, drive_modified_at = ?, chunk_count = ?, status = 'active'
             WHERE drive_file_id = ? AND merchant_id = ?`
          ).bind(file.name, file.mimeType, file.modifiedAt, chunks.length, file.id, merchantId).run()
        } else {
          await env.MERCHANT_DB.prepare(
            `INSERT INTO knowledge_docs (drive_file_id, merchant_id, drive_file_name, drive_mime_type, drive_modified_at, chunk_count, status)
             VALUES (?, ?, ?, ?, ?, ?, 'active')`
          ).bind(file.id, merchantId, file.name, file.mimeType, file.modifiedAt, chunks.length).run()
        }

        for (let i = 0; i < chunks.length; i++) {
          await env.MERCHANT_DB.prepare(
            `INSERT OR REPLACE INTO knowledge_chunks (chunk_id, file_id, merchant_id, chunk_index, chunk_text, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`
          ).bind(`${file.id}:${i}`, file.id, merchantId, i, chunks[i]).run()
        }

        stats.added++
      } catch (err) {
        stats.errors.push(`${file.name}: ${(err as Error).message}`)
      }
    }

    for (const [fileId, doc] of existingMap) {
      if (!driveFileIds.has(fileId) && doc.status === 'active') {
        await deleteVectorsForFile(fileId, merchantId, env)

        await env.MERCHANT_DB.prepare(
          `UPDATE knowledge_docs SET status = 'deleted'
           WHERE drive_file_id = ? AND merchant_id = ?`
        ).bind(fileId, merchantId).run()
      }
    }

    await env.MERCHANT_DB.prepare(
      `INSERT INTO sync_log (merchant_id, sync_type, status, files_processed, files_added, errors, synced_at)
       VALUES (?, 'drive', 'completed', ?, ?, ?, datetime('now'))`
    ).bind(merchantId, stats.processed, stats.added, stats.errors.join('; ')).run()
  } catch (err) {
    stats.errors.push(`sync failed: ${(err as Error).message}`)
  }

  return stats
}

export async function extractTextFromFile(
  content: ArrayBuffer,
  mimeType: string
): Promise<string> {
  switch (mimeType) {
    case 'text/plain':
    case 'text/csv': {
      return new TextDecoder().decode(content)
    }
    case 'application/pdf': {
      try {
        return new TextDecoder().decode(content)
      } catch {
        return ''
      }
    }
    case 'application/vnd.google-apps.document': {
      return 'google-doc'
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      return 'docx'
    }
    default:
      return ''
  }
}

export function splitIntoChunks(
  text: string,
  chunkSize: number = 1500,
  overlap: number = 500
): string[] {
  const sentences = text.split(/(?<=[。！？.!?\n])/).filter(s => s.trim().length > 0)

  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (current.length + sentence.length <= chunkSize) {
      current += sentence
    } else {
      if (current) chunks.push(current.trim())

      const overlapText = current.slice(-overlap)
      current = overlapText + sentence

      if (current.length > chunkSize) {
        chunks.push(current.trim())
        current = ''
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

export async function deleteVectorsForFile(
  fileId: string,
  merchantId: string,
  env: Env
): Promise<void> {
  const prefix = `${merchantId}:${fileId}:`

  const { results: chunks } = await env.MERCHANT_DB.prepare(
    `SELECT chunk_id FROM knowledge_chunks WHERE file_id = ? AND merchant_id = ?`
  ).bind(fileId, merchantId).all<{ chunk_id: string }>()

  if (chunks && chunks.length > 0) {
    const ids = chunks.map(c => c.chunk_id)
    const fullIds = ids.map(id => `${merchantId}:${fileId}:${id.split(':').pop()}`)

    await env.KNOWLEDGE.deleteByIds(fullIds)
  }

  await env.MERCHANT_DB.prepare(
    `DELETE FROM knowledge_chunks WHERE file_id = ? AND merchant_id = ?`
  ).bind(fileId, merchantId).run()
}

async function listDriveFiles(
  accessToken: string,
  folderId: string
): Promise<DriveFile[]> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', `'${folderId}' in parents and trashed = false`)
  url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime)')

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as {
    files: { id: string; name: string; mimeType: string; modifiedTime: string }[]
  }

  return (data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedAt: f.modifiedTime,
  }))
}

async function downloadDriveFile(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<ArrayBuffer> {
  const exportMime: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
  }

  let url: string

  if (exportMime[mimeType]) {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${exportMime[mimeType]}`
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  return response.arrayBuffer()
}

async function refreshDriveToken(refreshToken: string): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: '',
      client_secret: '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as { access_token: string }
  return data.access_token
}
