// 同意ダイアログの文言を、配信中のアセットから読む（SPEC §8.3 / §8.4）。
//
// 文言の出どころは public/products/<slug>/assets/consent-items.json だけである。
// ブラウザのダイアログもこの同じファイルを読んで表示する。
//
// 1つのセットは言語ごとに2つの部分を持つ。
//   summary — チェックボックスの上に本文として出す購入の条件（最終確認画面の表示事項）
//   items   — チェック項目
// どちらも、表示したとおりの文言を Stripe の metadata に残す。
//
// クライアントから文言を受け取らない。受け取ると Stripe に残るのは「購入者が申告した文言」に
// なってしまい、チャージバックの証拠にならない。ASSETS バインディング越しに読むことで、
// そのデプロイで実際に配信されている文言を、サーバの側で確定させる。

const ITEMS_PATH = (productId) => `/products/${productId}/assets/consent-items.json`

// Stripe の metadata は1値500文字まで（SPEC §8.4）。超える文言は切って印を付ける。
const METADATA_VALUE_LIMIT = 500

// 1項目1キーで入れる。連結して1キーに詰めると、長い文言で上限に当たる。
// キー数の上限は50なので、他の項目と合わせても収まる範囲に留める。
const MAX_ITEMS = 10
const MAX_SUMMARY = 10

export class ConsentItemsError extends Error {}

/**
 * 同意セットの、ある言語の文言を読む。{ items, summary } を返す。
 * summary はセットによっては無い（無料版のセット等）。その場合は空の配列にする。
 * 読めない・形が違う場合は ConsentItemsError を投げる。
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
  const content = set[lang] ?? set.ja
  const items = content?.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new ConsentItemsError(`同意項目が空: ${consentSet}/${lang} in ${url.pathname}`)
  }
  const summary = Array.isArray(content.summary) ? content.summary : []

  return { items, summary }
}

function truncate(value) {
  const text = String(value ?? '')
  return text.length > METADATA_VALUE_LIMIT ? `${text.slice(0, METADATA_VALUE_LIMIT - 1)}…` : text
}

/** summary の1行を、metadata の1値にする。表示した見出しと本文をそのまま残す */
export function toSummaryText(row) {
  return `${row?.term ?? ''}: ${row?.detail ?? ''}`
}

/** 読み込んだ文言を Stripe の metadata の形にする。 */
export function toConsentMetadata({ items, summary }, lang) {
  const metadata = {
    consent_lang: lang,
    consent_item_count: String(items.length),
  }

  items.slice(0, MAX_ITEMS).forEach((item, index) => {
    metadata[`consent_item_${index + 1}`] = truncate(item?.label)
  })

  // 最終確認画面に何を出したかも、文言そのもので残す（SPEC §8.4 の原則6）
  if (summary.length > 0) {
    metadata.consent_summary_count = String(summary.length)
    summary.slice(0, MAX_SUMMARY).forEach((row, index) => {
      metadata[`consent_summary_${index + 1}`] = truncate(toSummaryText(row))
    })
  }

  return metadata
}

/** 表示言語。クライアントの申告を使うが、知らない値は日本語に寄せる。 */
export function normalizeLang(value) {
  return value === 'en' ? 'en' : 'ja'
}
