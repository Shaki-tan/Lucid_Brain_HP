// 同意ダイアログの文言を、配信中のアセットから読む（SPEC §8.3 / §8.4）。
//
// 文言の出どころは public/products/<slug>/assets/consent-items.json だけである。
// ブラウザのダイアログもこの同じファイルを読んで表示する。
//
// 1つのセットは言語ごとに entries（行の並び）を持つ。1行は見出し（term）と本文（detail）で、
// 同意が要る行だけ consent（チェックボックスの文言とリンク）を持つ。
// 購入の条件とチェック項目を別々に書かないのは、同じことを2回書いて食い違うのを避けるためである。
// 表示したとおりの文言を、行ごとに Stripe の metadata に残す。
//
// クライアントから文言を受け取らない。受け取ると Stripe に残るのは「購入者が申告した文言」に
// なってしまい、チャージバックの証拠にならない。ASSETS バインディング越しに読むことで、
// そのデプロイで実際に配信されている文言を、サーバの側で確定させる。

const ITEMS_PATH = (productId) => `/products/${productId}/assets/consent-items.json`

// Stripe の metadata は1値500文字まで（SPEC §8.4）。超える文言は切って印を付ける。
const METADATA_VALUE_LIMIT = 500

// 1行1キーで入れる。連結して1キーに詰めると、長い文言で上限に当たる。
// キー数の上限は50なので、他の項目と合わせても収まる範囲に留める。
const MAX_ENTRIES = 20

export class ConsentItemsError extends Error {}

/**
 * 同意セットの、ある言語の行の並び（entries）を読む。
 * 読めない・形が違う・チェックする行が1つも無い場合は ConsentItemsError を投げる。
 * 呼び出し側は決済を止める。文言を記録できない決済を通さないためである。
 */
export async function readConsentItems(env, baseUrl, productId, consentSet, lang) {
  const url = new URL(ITEMS_PATH(productId), baseUrl)

  let data
  try {
    const res = await env.ASSETS.fetch(new Request(url, { method: 'GET' }))
    if (!res.ok) throw new ConsentItemsError(`status ${res.status}`)
    data = await res.json()
  } catch (cause) {
    throw new ConsentItemsError(`同意項目を読めない: ${url.pathname} (${cause?.message ?? cause})`)
  }

  const set = data?.sets?.[consentSet]
  if (!set) {
    throw new ConsentItemsError(`同意セットが無い: ${consentSet} in ${url.pathname}`)
  }

  // 正文は日本語とする（SPEC §2.2）。未知の言語が来たら日本語で記録する。
  const entries = (set[lang] ?? set.ja)?.entries
  if (!Array.isArray(entries) || !entries.some((entry) => entry?.consent)) {
    throw new ConsentItemsError(`同意する行が無い: ${consentSet}/${lang} in ${url.pathname}`)
  }

  return entries
}

/** 1行を metadata の1値にする。表示した見出し・本文と、チェックした文言をそのまま残す */
export function toEntryText(entry) {
  const text = `${entry?.term ?? ''}: ${entry?.detail ?? ''}`
  return entry?.consent ? `${text} ／ ✓ ${entry.consent.label ?? ''}` : text
}

/** 読み込んだ行を Stripe の metadata の形にする。 */
export function toConsentMetadata(entries, lang) {
  const metadata = {
    consent_lang: lang,
    consent_entry_count: String(entries.length),
  }
  entries.slice(0, MAX_ENTRIES).forEach((entry, index) => {
    const text = toEntryText(entry)
    // Stripe のダッシュボードはキーを文字列順に並べる。番号を2桁にそろえて、行の順と一致させる（_10 が _1 の次に来ないように）
    metadata[`consent_entry_${String(index + 1).padStart(2, '0')}`] =
      text.length > METADATA_VALUE_LIMIT ? `${text.slice(0, METADATA_VALUE_LIMIT - 1)}…` : text
  })
  return metadata
}

/** 表示言語。クライアントの申告を使うが、知らない値は日本語に寄せる。 */
export function normalizeLang(value) {
  return value === 'en' ? 'en' : 'ja'
}
