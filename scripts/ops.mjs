// 本番の構築・デプロイ・設定を CLI で行う（SPEC §7.6）。
//
//   node scripts/ops.mjs status                        何が済んでいて何が残っているか
//   node scripts/ops.mjs setup                         初回構築を順に行う。済んでいる段は飛ばす
//   node scripts/ops.mjs deploy                        検査 → デプロイ → スモーク
//   node scripts/ops.mjs upload <product> <plan> <file>  exe を R2 に置く（版の控え → latest）
//   node scripts/ops.mjs restore <product> <plan> <version>  latest を控えの版に戻す
//   node scripts/ops.mjs stripe                        Stripe の商品・価格・Webhook を揃え、secret を入れる
//   node scripts/ops.mjs secret <NAME>                 secret を1つ入れ直す
//   node scripts/ops.mjs smoke                         デプロイ済みのサイトにスモークを流す
//   node scripts/ops.mjs logs                          本番の構造化ログを流し見る（wrangler tail）
//
// Cloudflare は wrangler（npx で版を固定）、Stripe は REST API を直接呼ぶ。依存を持たない（SPEC §1.2）。
// Stripe のキーは環境変数 STRIPE_API_KEY か、その場の伏字入力で渡す。どこにも保存しない。
//
// どのコマンドも、何度流しても同じ状態に収束する。済んでいるものは作り直さない。
// 状態の定義元はリポジトリ（wrangler.jsonc / products.js / webhook.js）であり、
// ダッシュボードで作ったものに合わせるのではなく、リポジトリの記述に向こうを合わせる（SPEC §1.2）。

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { resolvePlan } from '../functions/lib/products.js'
import { parseReleaseVersion, toLatestKey, toReleaseFileName, toVersionKey } from '../functions/lib/releases.js'
import { STRIPE_API_VERSION, toPriceKey } from '../functions/lib/stripe.js'
import { WEBHOOK_EVENTS } from '../functions/api/webhook.js'
import { listPaidPlans, listReleasePlans, readConfig, REQUIRED_SECRETS, writeBaseUrl } from './ops/config.mjs'
import { ask, askSecret, confirm } from './ops/prompt.mjs'
import { findBash, probeR2Object, run, wrangler, WRANGLER } from './ops/shell.mjs'
import {
  createStripeClient,
  createWebhookEndpoint,
  ensurePrice,
  ensureProduct,
  getKeyMode,
  listWebhookEndpoints,
  StripeApiError,
} from './ops/stripe.mjs'

// 購入者の大半は日本にいる（SPEC §7.2）。作成時にしか指定できない
const R2_LOCATION = 'apac'

class OpsError extends Error {}

const heading = (text) => console.log(`\n== ${text} ==`)
const ok = (text) => console.log(`OK  ${text}`)
const ng = (text) => console.log(`NG  ${text}`)
const todo = (text) => console.log(`--  ${text}`)

// ---------- Cloudflare ----------

async function isLoggedIn() {
  const { code, stdout } = await wrangler(['whoami'], { mode: 'capture' })
  return code === 0 && !/not authenticated/i.test(stdout)
}

async function ensureLogin() {
  if (await isLoggedIn()) return ok('Cloudflare にログイン済み')
  todo('Cloudflare にログインする。ブラウザが開く')
  await wrangler(['login'])
  if (!(await isLoggedIn())) throw new OpsError('ログインできなかった')
  ok('Cloudflare にログインした')
}

async function hasBucket(name) {
  return (await wrangler(['r2', 'bucket', 'info', name], { mode: 'capture' })).code === 0
}

async function ensureBucket(name) {
  if (await hasBucket(name)) return ok(`R2 バケット ${name} は在る`)
  const { code, stdout, stderr } = await wrangler(['r2', 'bucket', 'create', name, '--location', R2_LOCATION], {
    mode: 'capture',
  })
  if (code !== 0) {
    console.error(stdout + stderr)
    throw new OpsError(
      'R2 バケットを作れなかった。新しいアカウントでは、先にダッシュボードの「R2」で利用を開始する必要がある（無料枠でも支払い方法の登録が要る）',
    )
  }
  ok(`R2 バケット ${name} を作った（${R2_LOCATION}）`)
}

async function isWorkerDeployed(name) {
  return (await wrangler(['deployments', 'list', '--name', name, '--json'], { mode: 'capture' })).code === 0
}

// Worker が無ければ null
async function listSecretNames(workerName) {
  const { code, stdout } = await wrangler(['secret', 'list', '--name', workerName, '--format', 'json'], {
    mode: 'capture',
  })
  if (code !== 0) return null
  const json = stdout.slice(stdout.indexOf('['), stdout.lastIndexOf(']') + 1)
  return JSON.parse(json).map((entry) => entry.name)
}

// 値は標準入力で渡す。引数に載せるとプロセス一覧とシェル履歴に残る
async function putSecret(workerName, name, value) {
  const { code, stdout, stderr } = await wrangler(['secret', 'put', name, '--name', workerName], {
    mode: 'capture',
    input: value,
  })
  if (code !== 0) {
    console.error(stdout + stderr)
    throw new OpsError(`secret ${name} を入れられなかった`)
  }
  ok(`secret ${name} を入れた`)
}

function resolveReleasePlan(productId, planId) {
  const resolved = resolvePlan(productId, planId)
  if (!resolved?.plan.releaseFile) {
    throw new OpsError(`${productId}:${planId} は products.js に無いか、releaseFile を持たない`)
  }
  return resolved.plan
}

// 購入者が受け取るファイル名（版つき）をオブジェクトに持たせる。Worker はこれをそのまま返す（SPEC §8.5）
async function putObject(bucketName, key, path, fileName) {
  const target = `${bucketName}/${key}`
  const args = ['r2', 'object', 'put', target, '--file', path, '--remote']
  args.push('--content-type', 'application/octet-stream')
  args.push('--content-disposition', `attachment; filename=${fileName}`)
  const { code, stdout, stderr } = await wrangler(args, { mode: 'capture' })
  if (code !== 0) {
    console.error(stdout + stderr)
    throw new OpsError(`r2://${target} に置けなかった`)
  }
  ok(`r2://${target}`)
}

// 版の控え → latest の順に置く。latest を上書きする前に、その版が必ず控えに残っている状態にするため。
// 控えは上書きしない。同じ版番号で中身を差し替えると、配った版と控えが食い違うため。
async function uploadRelease(bucketName, productId, planId, file, { isOverwriteAllowed = false } = {}) {
  const plan = resolveReleasePlan(productId, planId)
  const path = resolve(file)
  if (!existsSync(path)) throw new OpsError(`ファイルが無い: ${path}`)

  // ファイル名から版を読む。型に合わなければ止める（無料版と有償版の取り違えもここで止まる）
  const version = parseReleaseVersion(plan, basename(path))
  if (!version) throw new OpsError(`ファイル名が ${plan.releaseFile} の形ではない: ${basename(path)}`)

  const versionKey = toVersionKey(productId, plan, version)
  if ((await probeR2Object(bucketName, versionKey)) && !isOverwriteAllowed) {
    throw new OpsError(`${version} は既に控えにある（${versionKey}）。版番号を上げる（--overwrite で強行できる）`)
  }
  const fileName = toReleaseFileName(plan, version)
  await putObject(bucketName, versionKey, path, fileName)
  await putObject(bucketName, toLatestKey(productId, plan), path, fileName)
  ok(`${productId}:${planId} を ${version} にした`)
}

// latest を控えの版に戻す。wrangler に R2 内のコピーが無いため、一度手元に落として置き直す
async function restoreRelease(bucketName, productId, planId, version) {
  const plan = resolveReleasePlan(productId, planId)
  const versionKey = toVersionKey(productId, plan, version)
  const dir = await mkdtemp(join(tmpdir(), 'ops-restore-'))
  try {
    const path = join(dir, toReleaseFileName(plan, version))
    const args = ['r2', 'object', 'get', `${bucketName}/${versionKey}`, '--file', path, '--remote']
    const { code } = await wrangler(args, { mode: 'capture' })
    if (code !== 0 || !existsSync(path)) throw new OpsError(`控えが無い: ${versionKey}`)
    await putObject(bucketName, toLatestKey(productId, plan), path, toReleaseFileName(plan, version))
    ok(`${productId}:${planId} の latest を ${version} に戻した`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------- 検査・デプロイ ----------

// デプロイを止める検査。placeholders はいまは落ちるのが正しいため、止めずに件数だけ知らせる（README §6）
const BLOCKING_CHECKS = [
  'tests/check-links.sh',
  'tests/check-meta.sh',
  'tests/check-i18n.mjs',
  'tests/check-consent.mjs',
  'tests/check-glyphs.mjs',
]

function requireBash() {
  const bash = findBash()
  if (!bash) throw new OpsError('bash が見つからない。Git for Windows を入れるか、環境変数 BASH_PATH で場所を指す')
  return bash
}

async function runTest(file, mode) {
  const command = file.endsWith('.sh') ? requireBash() : process.execPath
  return run(command, [file], { mode })
}

async function runChecks() {
  heading('検査')
  for (const file of BLOCKING_CHECKS) {
    const { code, stdout, stderr } = await runTest(file, 'capture')
    if (code !== 0) {
      console.log(stdout + stderr)
      throw new OpsError(`${file} が落ちた。直してからデプロイする（--skip-checks で飛ばせる）`)
    }
    ok(file)
  }
  const placeholders = await runTest('tests/check-placeholders.sh', 'capture')
  if (placeholders.code === 0) ok('tests/check-placeholders.sh')
  else todo('tests/check-placeholders.sh: プレースホルダが残っている。公開前に0件にする（デプロイは止めない）')
}

async function deploy({ isDirtyAllowed = false, isCheckSkipped = false } = {}) {
  const { stdout: porcelain } = await run('git', ['status', '--porcelain'], { mode: 'capture' })
  const isDirty = porcelain.trim() !== ''
  // 配信物は git に残っているものと一致させる。どの版が出ているかを後から辿れるようにするため（SPEC §1.2）
  if (isDirty && !isDirtyAllowed) {
    throw new OpsError('コミットされていない変更がある。コミットしてからデプロイする（--allow-dirty で強行できる）')
  }
  if (!isCheckSkipped) await runChecks()

  heading('デプロイ')
  const hash = (await run('git', ['rev-parse', '--short', 'HEAD'], { mode: 'capture' })).stdout.trim()
  const message = isDirty ? `${hash}-dirty` : hash
  const result = await wrangler(['deploy', '--message', message], { mode: 'tee' })
  if (result.code !== 0) {
    throw new OpsError(
      'デプロイに失敗した。初回で workers.dev のサブドメインが未登録なら、ダッシュボードの Workers & Pages で登録してから再実行する',
    )
  }
  ok(`デプロイした（${message}）`)

  const deployedUrl = /https:\/\/[\w.-]+\.workers\.dev/.exec(result.stdout)?.[0] ?? null
  let { baseUrl } = readConfig()
  if (!baseUrl && deployedUrl) {
    todo(`公開URLは ${deployedUrl}`)
    if (await confirm('wrangler.jsonc の SITE_BASE_URL に書き込みますか', true)) {
      writeBaseUrl(deployedUrl)
      baseUrl = deployedUrl
      ok('SITE_BASE_URL を書き込んだ。コミットしておく（次のデプロイで Worker にも入る。それまでは origin で代替されるので動作は同じ）')
    }
  }
  const target = baseUrl || deployedUrl
  if (!target) return todo('公開URLが分からないためスモークを飛ばした')
  await smoke(target)
}

async function smoke(baseUrl) {
  heading(`スモーク（${baseUrl}）`)
  const { code } = await run(requireBash(), ['tests/smoke.sh', baseUrl])
  if (code !== 0) {
    ng(`スモークに失敗がある。直前の版に戻すなら npx ${WRANGLER} rollback`)
    process.exitCode = 1
  }
}

// ---------- Stripe ----------

async function getStripeKey() {
  const key = process.env.STRIPE_API_KEY || (await askSecret('Stripe のシークレットキー（sk_test_... / sk_live_...）'))
  const mode = getKeyMode(key)
  if (!mode) throw new OpsError('Stripe のキーの形ではない（sk_ / rk_ で始まり、test / live を含む）')
  return { key, mode }
}

function isSameSet(a, b) {
  return a.length === b.length && a.every((item) => b.includes(item))
}

async function setupStripe({ isWebhookRotated = false } = {}) {
  const { workerName, baseUrl } = readConfig()
  if (!baseUrl) throw new OpsError('wrangler.jsonc の SITE_BASE_URL が空。先に deploy して公開URLを決める')
  const secretNames = await listSecretNames(workerName)
  if (!secretNames) throw new OpsError(`Worker ${workerName} がまだ無い。先に deploy する`)

  const { key, mode } = await getStripeKey()
  heading(`Stripe（${mode === 'live' ? '本番モード' : 'テストモード'}）`)
  if (mode === 'live' && !(await confirm('本番モードのキーです。実際に課金される設定を作ります。続けますか'))) return
  const client = createStripeClient(key)
  // Worker に入れる secret。最後にまとめて入れる
  const secrets = new Map()

  // 価格IDは全プランぶんを毎回組み直して1つの secret に入れる。消したプランは自然に消える
  const prices = {}
  const doneProducts = new Set()
  for (const { productId, planId, product, plan } of listPaidPlans()) {
    if (!doneProducts.has(productId)) {
      const { action } = await ensureProduct(client, productId, product.displayName)
      ok(`商品 ${productId}: ${action}`)
      doneProducts.add(productId)
    }
    const { price, action } = await ensurePrice(client, { productId, planId, plan })
    const priceKey = toPriceKey(productId, planId)
    ok(`価格 ${priceKey}: ${price.id}（${price.unit_amount} ${price.currency.toUpperCase()}）${action}`)
    prices[priceKey] = price.id
  }
  secrets.set('STRIPE_PRICES', JSON.stringify(prices))

  // Webhook。署名シークレットは作成時にしか返らないため、Worker 側に無ければ作り直して取り直す
  const webhookUrl = `${baseUrl}/api/webhook`
  const endpoints = await listWebhookEndpoints(client)
  const current = endpoints.find((endpoint) => endpoint.url === webhookUrl) ?? null
  let shouldCreate = !current
  if (current) {
    if (current.api_version !== STRIPE_API_VERSION) {
      todo(`Webhook の api_version が ${current.api_version}。${STRIPE_API_VERSION} で作り直す`)
      shouldCreate = true
    } else if (!secretNames.includes('STRIPE_WEBHOOK_SECRET') || isWebhookRotated) {
      todo('Webhook の署名シークレットを取り直すため作り直す')
      shouldCreate = true
    } else if (!isSameSet(current.enabled_events, WEBHOOK_EVENTS)) {
      await client.post(`/webhook_endpoints/${current.id}`, { enabled_events: WEBHOOK_EVENTS })
      ok(`Webhook ${webhookUrl}: イベントを webhook.js に合わせた`)
    } else {
      ok(`Webhook ${webhookUrl}: そのまま`)
    }
  }
  if (shouldCreate) {
    // 先に作ってから古いものを消す。作成に失敗したとき受け口が無くならないように
    const created = await createWebhookEndpoint(client, webhookUrl, WEBHOOK_EVENTS)
    if (current) await client.del(`/webhook_endpoints/${current.id}`)
    secrets.set('STRIPE_WEBHOOK_SECRET', created.secret)
    ok(`Webhook ${webhookUrl}: 作成（${created.id}）`)
  }
  for (const endpoint of endpoints) {
    if (endpoint !== current && endpoint.url.endsWith('/api/webhook')) {
      todo(`別の宛先の Webhook が残っている: ${endpoint.url}（${endpoint.id}）。不要ならダッシュボードで消す`)
    }
  }

  // Worker が決済時に使うキー。このモードで Webhook を初めて作ったなら、モードを切り替えた可能性が高い
  const hasRuntimeKey = secretNames.includes('STRIPE_SECRET_KEY')
  const shouldPutKey =
    !hasRuntimeKey ||
    (await confirm('Worker の STRIPE_SECRET_KEY を入れ直しますか（テスト⇔本番を切り替えたときは必ず y）', !current))
  if (shouldPutKey) {
    const runtimeKey = (await askSecret('Worker に入れるキー。空 Enter で上と同じキーを使う')) || key
    if (getKeyMode(runtimeKey) !== mode) throw new OpsError('上のキーとモード（test / live）が違う')
    secrets.set('STRIPE_SECRET_KEY', runtimeKey)
  }

  heading('secret')
  for (const [name, value] of secrets) await putSecret(workerName, name, value)

  heading('Stripe ダッシュボードで行うこと（API では設定できない）')
  todo('設定 → 公開情報: 事業者名・明細書表記・サポート連絡先')
  todo('設定 → カスタマーへのメール → 支払い成功: 有効にする（checkout.js が発行する請求書をメールで届けるため）')
  if (mode === 'test') todo('テスト購入: カード 4242 4242 4242 4242 / 期限は未来の任意 / CVC 任意（SPEC §7.5 チェックリスト3・4）')
  else todo('本番の購入を1回通し、返金まで試す')
}

// ---------- コマンド ----------

async function status() {
  const config = readConfig()
  const remaining = []

  heading('リポジトリの設定')
  console.log(`Worker        ${config.workerName}`)
  console.log(`R2 バケット   ${config.bucketName}`)
  console.log(`SITE_BASE_URL ${config.baseUrl || '（空）'}`)
  console.log(`wrangler      ${WRANGLER}`)
  if (!config.baseUrl) remaining.push('deploy して SITE_BASE_URL を決める')

  heading('Cloudflare')
  if (!(await isLoggedIn())) {
    ng('ログインしていない')
    remaining.unshift('setup（ログインから始まる）')
  } else {
    ok('ログイン済み')
    if (await hasBucket(config.bucketName)) {
      ok(`R2 バケット ${config.bucketName}`)
      for (const { productId, planId, plan } of listReleasePlans()) {
        const key = toLatestKey(productId, plan)
        if (await probeR2Object(config.bucketName, key)) ok(`R2 ${key}`)
        else {
          ng(`R2 ${key} が無い`)
          remaining.push(`upload ${productId} ${planId} <${plan.releaseFile}>`)
        }
      }
    } else {
      ng(`R2 バケット ${config.bucketName} が無い`)
      remaining.push('setup（R2 バケットを作る）')
    }

    const secretNames = await listSecretNames(config.workerName)
    if (!secretNames) {
      ng(`Worker ${config.workerName} がまだ無い`)
      remaining.push('deploy')
    } else {
      ok(`Worker ${config.workerName}`)
      for (const name of REQUIRED_SECRETS) {
        if (secretNames.includes(name)) ok(`secret ${name}`)
        else {
          ng(`secret ${name} が無い`)
          if (!remaining.includes('stripe')) remaining.push('stripe')
        }
      }
    }
  }

  if (config.baseUrl) {
    heading('サイト')
    try {
      const res = await fetch(config.baseUrl, { redirect: 'manual' })
      if (res.status === 200) ok(`${config.baseUrl} → 200`)
      else ng(`${config.baseUrl} → ${res.status}`)
    } catch (cause) {
      ng(`${config.baseUrl} に届かない（${cause.cause?.code ?? cause.message}）`)
    }
  }

  heading('Stripe')
  if (!process.env.STRIPE_API_KEY) {
    todo('環境変数 STRIPE_API_KEY を渡すと、商品・価格・Webhook も確認する')
  } else {
    const { key, mode } = await getStripeKey()
    console.log(`モード        ${mode}`)
    const client = createStripeClient(key)
    for (const { productId, planId, plan } of listPaidPlans()) {
      const lookupKey = toPriceKey(productId, planId)
      const { data } = await client.get('/prices', { lookup_keys: [lookupKey], active: true })
      const price = data[0]
      if (!price) {
        ng(`価格 ${lookupKey} が無い`)
        if (!remaining.includes('stripe')) remaining.push('stripe')
      } else if (price.unit_amount !== plan.unitAmount || price.currency !== plan.currency) {
        ng(`価格 ${lookupKey} が products.js と違う（Stripe ${price.unit_amount} / products.js ${plan.unitAmount}）`)
        if (!remaining.includes('stripe')) remaining.push('stripe')
      } else {
        ok(`価格 ${lookupKey}: ${price.id}（${price.unit_amount} ${price.currency.toUpperCase()}）`)
      }
    }
    if (config.baseUrl) {
      const webhookUrl = `${config.baseUrl}/api/webhook`
      const endpoint = (await listWebhookEndpoints(client)).find((item) => item.url === webhookUrl)
      if (!endpoint) {
        ng(`Webhook ${webhookUrl} が無い`)
        if (!remaining.includes('stripe')) remaining.push('stripe')
      } else if (endpoint.api_version !== STRIPE_API_VERSION || !isSameSet(endpoint.enabled_events, WEBHOOK_EVENTS)) {
        ng(`Webhook ${webhookUrl} の api_version かイベントがリポジトリと違う`)
        if (!remaining.includes('stripe')) remaining.push('stripe')
      } else {
        ok(`Webhook ${webhookUrl}（${endpoint.status}）`)
      }
    }
  }

  heading('残っている作業')
  if (remaining.length === 0) ok('無し。公開前の項目は README §9 を見る')
  else remaining.forEach((item) => todo(`node scripts/ops.mjs ${item}`))
}

async function setup() {
  const config = readConfig()

  heading('1. Cloudflare ログイン')
  await ensureLogin()

  heading('2. R2 バケット')
  await ensureBucket(config.bucketName)

  heading('3. 配布する exe')
  for (const { productId, planId, plan } of listReleasePlans()) {
    const key = toLatestKey(productId, plan)
    if (await probeR2Object(config.bucketName, key)) {
      ok(`${key} は在る`)
      continue
    }
    const file = await ask(`${productId}:${planId} の exe のパス（${plan.releaseFile}。空 Enter で後回し）`)
    if (file) await uploadRelease(config.bucketName, productId, planId, file)
    else todo(`後で: node scripts/ops.mjs upload ${productId} ${planId} <${plan.releaseFile}>`)
  }

  heading('4. デプロイ')
  if (!(await isWorkerDeployed(config.workerName)) || (await confirm('デプロイ済み。もう一度デプロイしますか'))) {
    await deploy()
  } else {
    ok('デプロイ済み')
  }

  heading('5. Stripe')
  await setupStripe()

  heading('終わり')
  todo('node scripts/ops.mjs status で全体を確認する')
  todo('公開前に潰す項目は README §9 にある')
}

async function putSecretCommand(name) {
  if (!name) throw new OpsError('使い方: node scripts/ops.mjs secret <NAME>')
  const { workerName } = readConfig()
  if (!REQUIRED_SECRETS.includes(name) &&!(await confirm(`${name} は Worker が読む secret ではない。入れますか`))) {
    return
  }
  const value = await askSecret(`${name} の値`)
  if (!value) throw new OpsError('値が空')
  await putSecret(workerName, name, value)
}

const HELP = `使い方: node scripts/ops.mjs <command>

  status                          何が済んでいて何が残っているか（STRIPE_API_KEY を渡すと Stripe も見る）
  setup                           初回構築。ログイン → R2 → exe → デプロイ → Stripe を順に。済んだ段は飛ばす
  deploy [--allow-dirty] [--skip-checks]
                                  検査 → デプロイ → スモーク
  upload <product> <plan> <file> [--overwrite]
                                  exe を版の控え → latest の順に置く。版はファイル名から読む
                                  （例: upload pawgress paid ./Pawgress-Windows-1.0.1-Setup.exe）
  restore <product> <plan> <version>
                                  latest を控えの版に戻す（例: restore pawgress paid 1.0.0）
  stripe [--rotate-webhook]       Stripe の商品・価格・Webhook を products.js / webhook.js に合わせ、secret を入れる
  secret <NAME>                   secret を1つ入れ直す（伏字入力）
  smoke                           SITE_BASE_URL にスモークを流す
  logs                            本番のログを流し見る（wrangler tail）

Stripe のキーは環境変数 STRIPE_API_KEY か、実行時の伏字入力で渡す。保存しない。`

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2)
  const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
  const positionals = rest.filter((arg) => !arg.startsWith('--'))

  switch (command) {
    case 'status':
      return status()
    case 'setup':
      return setup()
    case 'deploy':
      return deploy({ isDirtyAllowed: flags.has('--allow-dirty'), isCheckSkipped: flags.has('--skip-checks') })
    case 'upload': {
      const [productId, planId, file] = positionals
      if (!file) throw new OpsError('使い方: node scripts/ops.mjs upload <product> <plan> <file>')
      return uploadRelease(readConfig().bucketName, productId, planId, file, {
        isOverwriteAllowed: flags.has('--overwrite'),
      })
    }
    case 'restore': {
      const [productId, planId, version] = positionals
      if (!version) throw new OpsError('使い方: node scripts/ops.mjs restore <product> <plan> <version>')
      return restoreRelease(readConfig().bucketName, productId, planId, version)
    }
    case 'stripe':
      return setupStripe({ isWebhookRotated: flags.has('--rotate-webhook') })
    case 'secret':
      return putSecretCommand(positionals[0])
    case 'smoke': {
      const { baseUrl } = readConfig()
      if (!baseUrl) throw new OpsError('wrangler.jsonc の SITE_BASE_URL が空')
      return smoke(baseUrl)
    }
    case 'logs':
      return wrangler(['tail', '--format', 'pretty'])
    case 'help':
    case '--help':
    case '-h':
      return console.log(HELP)
    default:
      console.log(HELP)
      throw new OpsError(`知らないコマンド: ${command}`)
  }
}

main().catch((error) => {
  if (!(error instanceof OpsError || error instanceof StripeApiError)) throw error
  console.error(`\n中断: ${error.message}`)
  process.exitCode = 1
})
