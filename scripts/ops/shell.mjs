// 外部コマンドの起動。wrangler はリポジトリの依存に入れず、npx で版を固定して呼ぶ（README §4）。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { REPO } from './config.mjs'

// npx は版を指定しないと毎回最新を取りに行き、放置しているあいだに挙動が変わる（SPEC §1.2）。
// 上げるときはこの1行だけを書き換える。
export const WRANGLER = 'wrangler@4.136.1'

const IS_WINDOWS = process.platform === 'win32'

// Windows の npx は .cmd であり、シェル経由でしか起動できない。引数は cmd.exe 向けに引用する。
function quoteForCmd(arg) {
  if (/^[\w@./:=,+-]+$/.test(arg)) return arg
  if (/["%]/.test(arg)) throw new Error(`コマンド引数に " と % は使えない: ${arg}`)
  return `"${arg}"`
}

function spawnCommand(command, args, stdio) {
  if (IS_WINDOWS && command === 'npx') {
    return spawn(['npx', ...args.map(quoteForCmd)].join(' '), { cwd: REPO, shell: true, stdio })
  }
  return spawn(command, args, { cwd: REPO, stdio })
}

// mode
//   inherit  入出力をそのまま端末につなぐ（対話が要るコマンド）
//   capture  出力を溜めるだけで表示しない
//   tee      出力を表示しつつ溜める（デプロイ結果から URL を拾うとき）
// input を渡すと標準入力に書いて閉じる（secret put）
export function run(command, args, { mode = 'inherit', input = null } = {}) {
  const isPiped = mode !== 'inherit'
  const stdio = [input === null ? 'inherit' : 'pipe', isPiped ? 'pipe' : 'inherit', isPiped ? 'pipe' : 'inherit']

  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, stdio)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      if (mode === 'tee') process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      if (mode === 'tee') process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    if (input !== null) child.stdin.end(input)
  })
}

export function wrangler(args, options) {
  return run('npx', ['--yes', WRANGLER, ...args], options)
}

// R2 のオブジェクトが在るかを見る。wrangler に HEAD 相当が無いため、
// 取得を始めて最初のデータが届いた時点で打ち切る。exe を丸ごと落とさないため。
export function probeR2Object(bucket, key) {
  return new Promise((resolve) => {
    const args = ['--yes', WRANGLER, 'r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--pipe']
    const child = spawnCommand('npx', args, ['ignore', 'pipe', 'pipe'])
    let isSettled = false
    child.stdout.once('data', () => {
      isSettled = true
      child.stdout.destroy()
      child.kill()
      resolve(true)
    })
    child.on('close', () => {
      if (!isSettled) resolve(false)
    })
  })
}

// tests/*.sh を回す bash。Windows では PATH に無いことが多いため Git for Windows の同梱品を探す。
export function findBash() {
  if (!IS_WINDOWS) return 'bash'
  const candidates = [
    process.env.BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
}
