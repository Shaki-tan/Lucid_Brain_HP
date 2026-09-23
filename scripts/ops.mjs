// 構築・設定・確認を CLI で行う（SPEC §7.6）。デプロイの本線は GitHub 連携のビルドであり、ここではない（SPEC §7.7）。
//
//   node scripts/ops.mjs status                        何が済んでいて何が残っているか
//   node scripts/ops.mjs setup                         初回構築を順に行う。済んでいる段は飛ばす
//   node scripts/ops.mjs upload <product> <plan> <file>  exe を R2 に置く（版の控え → latest）
//   node scripts/ops.mjs restore <product> <plan> <version>  latest を控えの版に戻す
//   node scripts/ops.mjs stripe                        Stripe の商品・価格・Webhook を揃え、secret を入れる
//   node scripts/ops.mjs secret <NAME>                 secret を1つ入れ直す
//   node scripts/ops.mjs smoke                         デプロイ済みのサイトにスモークを流す
//   node scripts/ops.mjs logs                          構造化ログを流し見る（wrangler tail）
//   node scripts/ops.mjs check                         デプロイ前の検査だけを回す
//   node scripts/ops.mjs ci                            検査 → デプロイ。GitHub 連携のビルドが呼ぶ
//   node scripts/ops.mjs deploy                        手元からデプロイする。ビルドが止まったときの予備
//
// どのコマンドにも --env staging を付けるとテスト環境（develop）が対象になる。付けなければ本番（main）。
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
import {
  isBehindAccess,
  listPaidPlans,
  listReleasePlans,
  readAllConfigs,
  readConfig,
  REQUIRED_SECRETS,
  toDeployBranch,
} from './ops/config.mjs'
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

// 対象の環境。main() が --env を読んで決める
let site = null

// wrangler に環境を渡す。本番も --env= と明示する。
// env を定義した設定で何も渡さないと、wrangler が「どの環境か」を警告するため
const envArgs = () => (site.envName ? ['--env', site.envName] : ['--env='])
const envLabel = () => (site.envName ? `テスト環境（${site.envName}）` : '本番')
const opsCommand = (command) => `node scripts/ops.mjs ${command}${site.envName ? ` --env ${site.envName}` : ''}`

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

async function isWorkerDeployed() {
  return (await wrangler(['deployments', 'list', ...envArgs(), '--json'], { mode: 'capture' })).code === 0
}

// Worker が無ければ null
async function listSecretNames() {
  const { code, stdout } = await wrangler(['secret', 'list', ...envArgs(), '--format', 'json'], { mode: 'capture' })
  if (code !== 0) return null
  const json = stdout.slice(stdout.indexOf('['), stdout.lastIndexOf(']') + 1)
  return JSON.parse(json).map((entry) => entry.name)
}

// 値は標準入力で渡す。引数に載せるとプロセス一覧とシェル履歴に残る
async function putSecret(name, value) {
  const { code, stdout, stderr } = await wrangler(['secret', 'put', name, ...envArgs()], {
    mode: 'capture',
    input: value,
  })
  if (code !== 0) {
    console.error(stdout + stderr)
    throw new OpsError(`secret ${name} を入れられなかった`)
  }
  ok(`secret ${name} を入れた（${site.workerName}）`)
}

// ---------- 配布ファイル ----------

function resolveReleasePlan(productId, planId) {
  const resolved = resolvePlan(productId, planId)
  if (!resolved?.plan.releaseFile) {
    throw new OpsError(`${productId}:${planId} は products.js に無いか、releaseFile を持たない`)
  }
  return resolved.plan
}

// 購入者が受け取るファイル名（版つき）をオブジェクトに持たせる。Worker はこれをそのまま返す（SPEC §8.5）
async function putObject(key, path, fileName) {
  const target = `${site.bucketName}/${key}`
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
async function uploadRelease(productId, planId, file, { isOverwriteAllowed = false } = {}) {
  const plan = resolveReleasePlan(productId, planId)
  const path = resolve(file)
  if (!existsSync(path)) throw new OpsError(`ファイルが無い: ${path}`)

  // ファイル名から版を読む。型に合わなければ止める（無料版と有償版の取り違えもここで止まる）
  const version = parseReleaseVersion(plan, basename(path))
  if (!version) throw new OpsError(`ファイル名が ${plan.releaseFile} の形ではない: ${basename(path)}`)

  const versionKey = toVersionKey(productId, plan, version)
  if ((await probeR2Object(site.bucketName, versionKey)) && !isOverwriteAllowed) {
    throw new OpsError(`${version} は既に控えにある（${versionKey}）。版番号を上げる（--overwrite で強行できる）`)
  }
  const fileName = toReleaseFileName(plan, version)
  await putObject(versionKey, path, fileName)
  await putObject(toLatestKey(productId, plan), path, fileName)
  ok(`${envLabel()}の ${productId}:${planId} を ${version} にした`)
}

// latest を控えの版に戻す。wrangler に R2 内のコピーが無いため、一度手元に落として置き直す
async function restoreRelease(productId, planId, version) {
  const plan = resolveReleasePlan(productId, planId)
  const versionKey = toVersionKey(productId, plan, version)
  const dir = await mkdtemp(join(tmpdir(), 'ops-restore-'))
  try {
    const path = join(dir, toReleaseFileName(plan, version))
    const args = ['r2', 'object', 'get', `${site.bucketName}/${versionKey}`, '--file', path, '--remote']
    const { code } = await wrangler(args, { mode: 'capture' })
    if (code !== 0 || !existsSync(path)) throw new OpsError(`控えが無い: ${versionKey}`)
    await putObject(toLatestKey(productId, plan), path, toReleaseFileName(plan, version))
    ok(`${envLabel()}の ${productId}:${planId} の latest を ${version} に戻した`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------- 検査・デプロイ ----------

// デプロイを止める検査。placeholders はいまは落ちるのが正しいため、止めずに知らせる（README §6）
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
      throw new OpsError(`${file} が落ちた。直してからデプロイする`)
    }
    ok(file)
  }
  const placeholders = await runTest('tests/check-placeholders.sh', 'capture')
  if (placeholders.code === 0) ok('tests/check-placeholders.sh')
  else todo('tests/check-placeholders.sh: プレースホルダが残っている。公開前に0件にする（デプロイは止めない）')
}

async function gitOutput(args) {
  return (await run('git', args, { mode: 'capture' })).stdout.trim()
}

// wrangler deploy を呼ぶ。版のメッセージにコミットのハッシュを入れ、どの版が出ているかを辿れるようにする
async function runWranglerDeploy(message) {
  heading(`デプロイ（${envLabel()}: ${site.workerName}）`)
  const { code } = await wrangler(['deploy', ...envArgs(), '--message', message])
  if (code !== 0) {
    throw new OpsError(
      'デプロイに失敗した。初回なら、ドメインがこのアカウントのゾーンとして有効になっているか、' +
        '同じホスト名の DNS レコードが残っていないか（あると割り当てられない）を見る',
    )
  }
  ok(`デプロイした（${message}）`)
}

// GitHub 連携のビルドから呼ぶ。対話をせず、検査に落ちたらデプロイしない（SPEC §7.7）
async function ci() {
  await runChecks()
  await runWranglerDeploy(await gitOutput(['rev-parse', '--short', 'HEAD']))
}

// 手元からのデプロイ。本線はビルドなので予備として残す。初回構築（setup）もこれで Worker を作る
async function deploy({ isDirtyAllowed = false, isCheckSkipped = false } = {}) {
  // 別の環境のコードを出さない。develop の作業中に本番へ出す事故を防ぐ
  const branch = await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'])
  const expectedBranch = toDeployBranch(site.envName)
  if (branch !== expectedBranch) {
    throw new OpsError(`${envLabel()}は ${expectedBranch} から出す。いまは ${branch} にいる`)
  }
  const isDirty = (await gitOutput(['status', '--porcelain'])) !== ''
  // 配信物は git に残っているものと一致させる。どの版が出ているかを後から辿れるようにするため（SPEC §1.2）
  if (isDirty && !isDirtyAllowed) {
    throw new OpsError('コミットされていない変更がある。コミットしてからデプロイする（--allow-dirty で強行できる）')
  }
  if (!isCheckSkipped) await runChecks()

  const hash = await gitOutput(['rev-parse', '--short', 'HEAD'])
  await runWranglerDeploy(isDirty ? `${hash}-dirty` : hash)
  await smoke(site.baseUrl)
}

// Access の内側にある環境（テスト環境と、公開前の本番）は、サービストークンを渡さないとスモークが入れない（SPEC §7.7）
async function smoke(baseUrl) {
  heading(`スモーク（${baseUrl}）`)
  if (isBehindAccess(site.envName) && !(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)) {
    todo(`${envLabel()}は Access の内側にある。環境変数 CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET にサービストークンを入れて流す`)
    return
  }
  const { code } = await run(requireBash(), ['tests/smoke.sh', baseUrl])
  if (code !== 0) {
    ng(`スモークに失敗がある。直前の版に戻すなら npx ${WRANGLER} rollback ${envArgs().join(' ')}`)
    process.exitCode = 1
  }
}

// Access が掛かっているか、Webhook だけは素通りするかを外から見る
async function checkAccess(baseUrl) {
  try {
    const top = await fetch(baseUrl, { redirect: 'manual' })
    const location = top.headers.get('location') ?? ''
    if (top.status === 200) ng(`${baseUrl} に Access が掛かっていない。誰でも見られる`)
    else if (location.includes('cloudflareaccess.com') || top.status === 401 || top.status === 403) {
      ok(`${baseUrl} は Access の内側にある`)
    } else ng(`${baseUrl} → ${top.status}（想定外）`)

    // GET は Worker まで届けば 405 になる。Access に止められると 302 / 403 になる
    const webhook = await fetch(`${baseUrl}/api/webhook`, { redirect: 'manual' })
    if (webhook.status === 405) ok('/api/webhook は Access を素通りする（Stripe から届く）')
    else ng(`/api/webhook が ${webhook.status}。Access の素通し設定が無いと Stripe の通知が届かない`)
  } catch (cause) {
    ng(`${baseUrl} に届かない（${cause.cause?.code ?? cause.message}）`)
  }
}

// www 付きのホストが、www なしの同じパスへ 301 で転送されるかを見る（SPEC §3）。
// 転送はダッシュボードのリダイレクトルールが Access より手前で行うので、公開前でも外から確かめられる。
// 静的ファイルのパスで確かめる。Worker を通らないパスで効いていることが肝心なため
async function checkWwwRedirect() {
  const baseHost = new URL(site.baseUrl).host
  for (const host of site.hosts.filter((item) => item === `www.${baseHost}`)) {
    const path = '/legal/terms?check=1'
    try {
      const res = await fetch(`https://${host}${path}`, { redirect: 'manual' })
      const location = res.headers.get('location')
      if (res.status === 301 && location === `${site.baseUrl}${path}`) ok(`${host} → ${site.baseUrl} へ 301`)
      else ng(`${host}${path} → ${res.status} ${location ?? ''}（${site.baseUrl}${path} への 301 を期待。リダイレクトルールを見る）`)
    } catch (cause) {
      ng(`${host} に届かない（${cause.cause?.code ?? cause.message}）`)
    }
  }
}

// ---------- Stripe ----------

async function getStripeKey() {
  const key = process.env.STRIPE_API_KEY || (await askSecret('Stripe のシークレットキー（sk_test_... / sk_live_...）'))
  const mode = getKeyMode(key)
  if (!mode) throw new OpsError('Stripe のキーの形ではない（sk_ / rk_ で始まり、test / live を含む）')
  // テスト環境で実際の課金が起きないようにする
  if (site.envName && mode === 'live') throw new OpsError('テスト環境には本番モードのキーを入れない')
  return { key, mode }
}

function isSameSet(a, b) {
  return a.length === b.length && a.every((item) => b.includes(item))
}

async function setupStripe({ isWebhookRotated = false } = {}) {
  const { baseUrl } = site
  if (!baseUrl) throw new OpsError('wrangler.jsonc の SITE_BASE_URL が空。routes と同じURLを書く')
  const secretNames = await listSecretNames()
  if (!secretNames) throw new OpsError(`Worker ${site.workerName} がまだ無い。先に ${opsCommand('deploy')} する`)

  const { key, mode } = await getStripeKey()
  heading(`Stripe（${mode === 'live' ? '本番モード' : 'テストモード'} → ${envLabel()}）`)
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
  // 本番とテスト環境は Stripe のテストモードを共有しうる。他の環境の宛先は正当なので知らせない
  const knownUrls = readAllConfigs()
    .filter((config) => config.baseUrl)
    .map((config) => `${config.baseUrl}/api/webhook`)
  for (const endpoint of endpoints) {
    if (endpoint !== current && !knownUrls.includes(endpoint.url) && endpoint.url.endsWith('/api/webhook')) {
      todo(`どの環境のものでもない Webhook が残っている: ${endpoint.url}（${endpoint.id}）。不要ならダッシュボードで消す`)
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

  heading(`secret（${site.workerName}）`)
  for (const [name, value] of secrets) await putSecret(name, value)

  heading('Stripe ダッシュボードで行うこと（API では設定できない）')
  todo('設定 → 公開情報: 事業者名・明細書表記・サポート連絡先')
  todo('設定 → カスタマーへのメール → 支払い成功: 有効にする（checkout.js が発行する請求書をメールで届けるため）')
  if (mode === 'test') todo('テスト購入: カード 4242 4242 4242 4242 / 期限は未来の任意 / CVC 任意（SPEC §7.5 チェックリスト3・4）')
  else todo('本番の購入を1回通し、返金まで試す')
}

// ---------- コマンド ----------

async function status() {
  const remaining = []
  const addRemaining = (command) => {
    if (!remaining.includes(command)) remaining.push(command)
  }

  heading(`リポジトリの設定（${envLabel()}）`)
  console.log(`Worker        ${site.workerName}`)
  console.log(`ブランチ      ${toDeployBranch(site.envName)}`)
  console.log(`R2 バケット   ${site.bucketName}`)
  console.log(`SITE_BASE_URL ${site.baseUrl || '（空）'}`)
  console.log(`Access        ${isBehindAccess(site.envName) ? '内側に置く' : '公開（IS_LAUNCHED）'}`)
  console.log(`wrangler      ${WRANGLER}`)

  heading('Cloudflare')
  if (!(await isLoggedIn())) {
    ng('ログインしていない')
    addRemaining('setup')
  } else {
    ok('ログイン済み')
    if (await hasBucket(site.bucketName)) {
      ok(`R2 バケット ${site.bucketName}`)
      for (const { productId, planId, plan } of listReleasePlans()) {
        const key = toLatestKey(productId, plan)
        if (await probeR2Object(site.bucketName, key)) ok(`R2 ${key}`)
        else {
          ng(`R2 ${key} が無い`)
          addRemaining(`upload ${productId} ${planId} <${plan.releaseFile}>`)
        }
      }
    } else {
      ng(`R2 バケット ${site.bucketName} が無い`)
      addRemaining('setup')
    }

    const secretNames = await listSecretNames()
    if (!secretNames) {
      ng(`Worker ${site.workerName} がまだ無い`)
      addRemaining('setup')
    } else {
      ok(`Worker ${site.workerName}`)
      for (const name of REQUIRED_SECRETS) {
        if (secretNames.includes(name)) ok(`secret ${name}`)
        else {
          ng(`secret ${name} が無い`)
          addRemaining('stripe')
        }
      }
    }
  }

  if (site.baseUrl) {
    heading('サイト')
    if (isBehindAccess(site.envName)) await checkAccess(site.baseUrl)
    else {
      try {
        const res = await fetch(site.baseUrl, { redirect: 'manual' })
        if (res.status === 200) ok(`${site.baseUrl} → 200`)
        else ng(`${site.baseUrl} → ${res.status}`)
      } catch (cause) {
        ng(`${site.baseUrl} に届かない（${cause.cause?.code ?? cause.message}）`)
      }
    }
    await checkWwwRedirect()
  } else {
    addRemaining('setup')
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
        addRemaining('stripe')
      } else if (price.unit_amount !== plan.unitAmount || price.currency !== plan.currency) {
        ng(`価格 ${lookupKey} が products.js と違う（Stripe ${price.unit_amount} / products.js ${plan.unitAmount}）`)
        addRemaining('stripe')
      } else {
        ok(`価格 ${lookupKey}: ${price.id}（${price.unit_amount} ${price.currency.toUpperCase()}）`)
      }
    }
    if (site.baseUrl) {
      const webhookUrl = `${site.baseUrl}/api/webhook`
      const endpoint = (await listWebhookEndpoints(client)).find((item) => item.url === webhookUrl)
      if (!endpoint) {
        ng(`Webhook ${webhookUrl} が無い`)
        addRemaining('stripe')
      } else if (endpoint.api_version !== STRIPE_API_VERSION || !isSameSet(endpoint.enabled_events, WEBHOOK_EVENTS)) {
        ng(`Webhook ${webhookUrl} の api_version かイベントがリポジトリと違う`)
        addRemaining('stripe')
      } else {
        ok(`Webhook ${webhookUrl}（${endpoint.status}）`)
      }
    }
  }

  heading('残っている作業')
  if (remaining.length === 0) ok('無し。公開前の項目は README §9 を見る')
  else remaining.forEach((command) => todo(opsCommand(command)))
}

async function setup() {
  heading(`0. 対象: ${envLabel()}（${site.workerName} / ${toDeployBranch(site.envName)} ブランチ）`)

  heading('1. Cloudflare ログイン')
  await ensureLogin()

  heading('2. R2 バケット')
  await ensureBucket(site.bucketName)

  heading('3. 配布する exe')
  for (const { productId, planId, plan } of listReleasePlans()) {
    const key = toLatestKey(productId, plan)
    if (await probeR2Object(site.bucketName, key)) {
      ok(`${key} は在る`)
      continue
    }
    const file = await ask(`${productId}:${planId} の exe のパス（${plan.releaseFile}。空 Enter で後回し）`)
    if (file) await uploadRelease(productId, planId, file)
    else todo(`後で: ${opsCommand(`upload ${productId} ${planId} <${plan.releaseFile}>`)}`)
  }

  heading('4. Worker を作る（初回デプロイ）')
  if (await isWorkerDeployed()) {
    ok(`${site.workerName} は在る。以降のデプロイは push で行う`)
  } else {
    // Access はホスト名に掛けるので、Worker より先に作れる。先に作れば一度も外に見えない（SPEC §7.7）
    const host = new URL(site.baseUrl).host
    const question = `${host} に Access のアプリケーション（/api/webhook の Bypass を含む）を作ったか`
    if (isBehindAccess(site.envName) && !(await confirm(question))) {
      throw new OpsError(`先に ${host} に Access を掛ける。デプロイした瞬間から Access の内側に置くため（SPEC §7.7）`)
    }
    await deploy()
  }

  heading('5. Stripe')
  await setupStripe()

  heading('終わり。続けてダッシュボードで行うこと')
  todo(`${site.workerName} → 設定 → ビルド で GitHub をつなぐ（SPEC §7.7 の表のとおりに設定する）`)
  todo(`${opsCommand('status')} で全体を確認する`)
}

async function putSecretCommand(name) {
  if (!name) throw new OpsError('使い方: node scripts/ops.mjs secret <NAME>')
  if (!REQUIRED_SECRETS.includes(name) && !(await confirm(`${name} は Worker が読む secret ではない。入れますか`))) {
    return
  }
  const value = await askSecret(`${name} の値（${site.workerName}）`)
  if (!value) throw new OpsError('値が空')
  await putSecret(name, value)
}

const HELP = `使い方: node scripts/ops.mjs <command> [--env staging]

  --env staging を付けるとテスト環境（develop / lucid-brain-site-staging）が対象。付けなければ本番（main）

  status                          何が済んでいて何が残っているか（STRIPE_API_KEY を渡すと Stripe も見る）
  setup                           初回構築。ログイン → R2 → exe → Worker 作成 → Stripe を順に。済んだ段は飛ばす
  upload <product> <plan> <file> [--overwrite]
                                  exe を版の控え → latest の順に置く。版はファイル名から読む
                                  （例: upload pawgress paid ./Pawgress-Windows-1.0.1-Setup.exe）
  restore <product> <plan> <version>
                                  latest を控えの版に戻す（例: restore pawgress paid 1.0.0）
  stripe [--rotate-webhook]       Stripe の商品・価格・Webhook を products.js / webhook.js に合わせ、secret を入れる
  secret <NAME>                   secret を1つ入れ直す（伏字入力）
  smoke                           SITE_BASE_URL にスモークを流す（テスト環境は CF_ACCESS_CLIENT_ID / _SECRET が要る）
  logs                            ログを流し見る（wrangler tail）
  check                           デプロイ前の検査だけを回す
  ci                              検査 → デプロイ。GitHub 連携のビルドのデプロイコマンドに書く
  deploy [--allow-dirty] [--skip-checks]
                                  手元からデプロイする（予備）。ブランチが環境と合わなければ止まる

Stripe のキーは環境変数 STRIPE_API_KEY か、実行時の伏字入力で渡す。保存しない。`

// --env <name> を取り出す。残りはフラグと位置引数に分ける
function parseArgs(argv) {
  const args = [...argv]
  let envName = null
  const at = args.indexOf('--env')
  if (at >= 0) {
    envName = args[at + 1] ?? null
    if (!envName) throw new OpsError('--env の後に環境名を書く（例: --env staging）')
    args.splice(at, 2)
  }
  const [command = 'help', ...rest] = args
  return {
    envName,
    command,
    flags: new Set(rest.filter((arg) => arg.startsWith('--'))),
    positionals: rest.filter((arg) => !arg.startsWith('--')),
  }
}

async function main() {
  const { envName, command, flags, positionals } = parseArgs(process.argv.slice(2))
  if (['help', '--help', '-h'].includes(command)) return console.log(HELP)
  try {
    site = readConfig(envName)
  } catch (cause) {
    throw new OpsError(cause.message)
  }

  switch (command) {
    case 'status':
      return status()
    case 'setup':
      return setup()
    case 'upload': {
      const [productId, planId, file] = positionals
      if (!file) throw new OpsError('使い方: node scripts/ops.mjs upload <product> <plan> <file>')
      return uploadRelease(productId, planId, file, { isOverwriteAllowed: flags.has('--overwrite') })
    }
    case 'restore': {
      const [productId, planId, version] = positionals
      if (!version) throw new OpsError('使い方: node scripts/ops.mjs restore <product> <plan> <version>')
      return restoreRelease(productId, planId, version)
    }
    case 'stripe':
      return setupStripe({ isWebhookRotated: flags.has('--rotate-webhook') })
    case 'secret':
      return putSecretCommand(positionals[0])
    case 'smoke':
      if (!site.baseUrl) throw new OpsError('wrangler.jsonc の SITE_BASE_URL が空')
      return smoke(site.baseUrl)
    case 'logs':
      return wrangler(['tail', ...envArgs(), '--format', 'pretty'])
    case 'check':
      return runChecks()
    case 'ci':
      return ci()
    case 'deploy':
      return deploy({ isDirtyAllowed: flags.has('--allow-dirty'), isCheckSkipped: flags.has('--skip-checks') })
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
