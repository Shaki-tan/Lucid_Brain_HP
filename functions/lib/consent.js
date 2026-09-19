// 同意項目の文言を、配信中のアセットから読む（SPEC §8.3 / §8.4）。
//
// 文言の出どころは public/products/<slug>/assets/consent-items.json だけである。
// ブラウザのダイアログもこの同じファイルを読んで表示する。
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

export class ConsentItemsError extends Error {}

/**
 * 同意項目を読む。読めない・形が違う場合は ConsentItemsError を投げる。
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
  const items = Array.isArray(set[lang]) ? set[lang] : set.ja
  if (!Array.isArray(items) || items.length === 0) {
    throw new ConsentItemsError(`同意項目が空: ${consentSet}/${lang} in ${url.pathname}`)
  }

  return items
}

/** 読み込んだ項目を Stripe の metadata の形にする。 */
export function toConsentMetadata(items, lang) {
  const metadata = {
    consent_lang: lang,
    consent_item_count: String(items.length),
  }

  items.slice(0, MAX_ITEMS).forEach((item, index) => {
    const label = String(item?.label ?? '')
    metadata[`consent_item_${index + 1}`] =
      label.length > METADATA_VALUE_LIMIT ? `${label.slice(0, METADATA_VALUE_LIMIT - 1)}…` : label
  })

  return metadata
}

/** 表示言語。クライアントの申告を使うが、知らない値は日本語に寄せる。 */
export function normalizeLang(value) {
  return value === 'en' ? 'en' : 'ja'
}
