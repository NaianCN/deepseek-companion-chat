# DeepSeek Companion Chat

English | [简体中文](README.zh-CN.md)

A local persona chat client based on the [official DeepSeek chat demo](https://github.com/deepseek-ai/chat-demo). The browser connects directly to the DeepSeek API. Create personas, chat with each one across multiple conversations, and follow daily interaction streaks.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
pnpm install
pnpm dev
```

Run these commands from the project directory, then open [http://localhost:8090](http://localhost:8090). Enter your DeepSeek API key under **Settings → Data**. If your environment restricts file watching, run `WATCHPACK_POLLING=1000 pnpm dev`.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

Create or edit personas under **Settings → General → Manage personas**. The sidebar dropdown opens the oldest chat you’ve kept with that persona. Choose a persona in the message composer before sending a new chat, or change the persona for an existing conversation there. The sidebar only shows chats for the selected persona. Choose **Default** to see unbound chats. Starting a chat from a persona’s sidebar keeps that persona selected.

A new message with a complete reply counts as one day in the persona’s time zone. A spark lights after three consecutive days, then levels up at 7, 14, 30, and 100 days. Higher levels add more small stars, which twinkle when the spark lights for the day or levels up. After missing exactly one day, start chatting the next day and keep it up for three days to recover the spark. Each streak can recover once. The skipped day stays unlit on the calendar.

## Token budget and context

The draft token estimate updates as you type, just to the left of the input-budget ring. Open the ring for the next request’s estimated input and the conversation’s cumulative API usage. Estimates use DeepSeek’s official V4.1 Flash tokenizer. You can also see API usage for individual replies. The default input budget is 8,000 tokens, with a separate 8,192-token output limit. At 80% of the input budget, the app suggests reviewing the context. At the limit, you can pause sending or show a warning.

From the composer ring, choose **Manage chat memory** to pick, edit, and confirm memories, explicitly request AI suggestions, preview summary savings, and switch summary versions. Summaries apply to matching branches. The original message tree remains available.

Use **Settings → General → Manage personas → Persona memory** for memories shared by all chats with one persona. A chat memory becomes shared only when you explicitly add it to persona memory. The original chat entry remains available.

The sidebar shows the DeepSeek account balance and estimated local spending over the last 1, 7, or 30 days. Model and TTS spending are shown separately.

## Data and storage

API keys and settings reside in localStorage. Chats, personas, original attachments, and sparks reside in IndexedDB, scoped to the browser profile and site origin. Persona instructions and conversation context are sent to the configured API when generating replies.

- **DeepSeek history import and export.** Import from an extracted v3 export folder, its original ZIP, or a ZIP containing the folder. Import adds chats and skips existing chat IDs. The confirmation can bind new chats to a persona. Export includes the message tree and locally available original images. Other attachments are exported as metadata.
- **Full Companion backup.** Includes personas, avatars, chat links, interaction events, messages and branches, local originals, persona memories, chat memories, summary versions, and request usage. A confirmed restore replaces this data and clears drafts. Both exports omit the API key and browser settings.
- **Delete all chats.** Clears chats, links, attachments, and drafts while preserving personas and sparks.

On the same site, IndexedDB upgrades in place from v11 or v12 to v13 and keeps existing chats and attachments. If an older tab blocks the upgrade, close it and reload. Close other tabs on the same site before restoring a full backup.

## Development

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Start the development server                      |
| `pnpm build`        | Build into `dist/`                                |
| `pnpm type`         | Run TypeScript type checks                        |
| `pnpm lint`         | Lint with oxlint                                  |
| `pnpm test`         | Run data and business logic tests                 |
| `pnpm test:browser` | Run Chromium tests with mocked DeepSeek responses |
| `pnpm format`       | Format with oxfmt                                 |

Install Chromium with `pnpm exec playwright install chromium` before running the browser suite.

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  features/            Personas, sparks, context management, and full backups
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
