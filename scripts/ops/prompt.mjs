// 対話入力。依存を入れないため、伏字入力も標準ライブラリだけで組む。

import { createInterface } from 'node:readline/promises'

export async function ask(question, defaultValue = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  const answer = (await rl.question(`${question}${suffix}: `)).trim()
  rl.close()
  return answer || defaultValue
}

export async function confirm(question, isDefaultYes = false) {
  const answer = (await ask(`${question} ${isDefaultYes ? '[Y/n]' : '[y/N]'}`)).toLowerCase()
  if (answer === '') return isDefaultYes
  return answer === 'y' || answer === 'yes'
}

// 入力を画面に出さない。キーは端末のスクロールバックにも残したくないため。
// 端末でないとき（パイプで渡されたとき）は1行をそのまま読む。
export function askSecret(question) {
  const { stdin, stdout } = process
  if (!stdin.isTTY) return ask(question)

  return new Promise((resolve) => {
    stdout.write(`${question}（入力は表示されない）: `)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''

    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      stdout.write('\n')
    }

    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          finish()
          resolve(value.trim())
          return
        }
        if (c === '\u0003') {
          finish()
          process.exit(130)
        }
        if (c === '\u0008' || c === '\u007f') {
          value = value.slice(0, -1)
        } else {
          value += c
        }
      }
    }
    stdin.on('data', onData)
  })
}
