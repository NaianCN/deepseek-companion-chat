import { Tokenizer } from '@huggingface/tokenizers'
import data from './deepseek/tokenizer.json' with { type: 'json' }

const tokenizer = new Tokenizer(data, {})

export const officialCount = (text: string) =>
  tokenizer.encode(text, { add_special_tokens: false }).ids.length
