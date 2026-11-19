import { useEffect, useState } from 'react'
import type { CreateMessageRequest } from '../../services/api/types.js'

type Count = (text: string) => number
let countTokens: Count | undefined
let pending: Promise<void> | undefined
const tokenCache = new Map<string, number>()

export const loadTokenizer = () => {
  pending ??= import('./tokenizer.js')
    .then(({ officialCount }) => {
      countTokens = officialCount
    })
    .catch(() => {})
  return pending
}

export const tokenizerAvailable = () => countTokens !== undefined

export const estimateText = (text: string): number => {
  if (!text) {
    return 0
  }
  if (countTokens) {
    const cached = tokenCache.get(text)
    if (cached !== undefined) {
      return cached
    }
    const tokens = countTokens(text)
    if (text.length <= 16_000) {
      if (tokenCache.size >= 384) {
        const oldest = tokenCache.keys().next().value
        if (oldest !== undefined) {
          tokenCache.delete(oldest)
        }
      }
      tokenCache.set(text, tokens)
    }
    return tokens
  }
  // 离线资源加载失败时保守估计，界面同时标明回退状态。
  const characters = Array.from(text)
  const nonAscii = characters.filter((value) => value.charCodeAt(0) > 127).length
  return Math.ceil(nonAscii + (characters.length - nonAscii) / 3)
}

export const estimateRequest = (request: CreateMessageRequest) => {
  let input = estimateText(request.system) + estimateText(JSON.stringify(request.tools)) + 8
  let external = false
  for (const message of request.messages) {
    input += 5
    if (typeof message.content === 'string') {
      input += estimateText(message.content)
      continue
    }
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          input += estimateText(block.text)
          break
        case 'thinking':
          input += estimateText(block.thinking)
          break
        case 'image':
        case 'document':
          // 文件 ID 可计数，服务端展开内容不可见。图像和文档分别预留估算量。
          input += estimateText(JSON.stringify(block)) + (block.type === 'image' ? 1024 : 2048)
          external = true
          break
        default:
          input += estimateText(JSON.stringify(block))
          if (block.type === 'web_fetch_tool_result') {
            input += 2048
            external = true
          }
      }
    }
  }
  return { input, external }
}

export const budgetStatus = (tokens: number, budget: number) =>
  tokens >= budget ? 'limit' : tokens >= budget * 0.8 ? 'near' : 'within'

export const useTokenizerReady = () => {
  const [available, setAvailable] = useState(tokenizerAvailable)
  useEffect(() => {
    void loadTokenizer().then(() => setAvailable(tokenizerAvailable()))
  }, [])
  return available
}
