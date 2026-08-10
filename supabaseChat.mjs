export function normalizeSupabaseMessages(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      role: row?.role === 'assistant' ? 'assistant' : 'user',
      text: typeof row?.message === 'string' ? row.message : '',
      createdAt: row?.created_at || null,
    }))
    .filter((message) => message.text)
    .sort((left, right) => (left.createdAt || '').localeCompare(right.createdAt || ''))
    .map(({ role, text }) => ({ role, text }));
}
