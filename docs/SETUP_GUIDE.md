
# Cursor Autopilot - SETUP GUIDE

## 1. Overview

The Cursor Autopilot allows you to remotely control your Cursor agent. It captures chat summaries and next steps from Cursor, pushes them to your chosen communication channel (e.g., Telegram, Email, Feishu), and allows you to reply to continue the building process, or provide new instructions. This enables continuous coding and guidance from anywhere, without cloud dependencies.

## 2. Key Features

-   **Remote Control**: Guide your Cursor AI from external communication channels.
-   **Multi-channel Support**: Supports Microsoft Teams (Graph), Telegram, Email, and Feishu, with easy extensibility.
-   **Seamless Integration**: Automatically captures Cursor chat summaries and injects replies back into Cursor.
-   **Robust Message Delivery**: Employs a multi-layer fallback mechanism to ensure messages are sent successfully.

## 3. Setup Guide

### 3.1. Prerequisites

-   Node.js (>= 18 LTS)
-   VS Code or Cursor (= 1.99 / 2025.4)
-   `yo`, `generator-code`, `vsce` (install via `npm i -g yo generator-code vsce`)
-   A mail account (Gmail/QQ/Outlook) or a Telegram Bot token + chat ID, or Feishu App ID + App Secret.

### 3.2. Installation

1.  **Clone the repository and install dependencies:**
    ```bash
    git clone https://github.com/heyzgj/cursor-autopilot
    cd cursor-autopilot
    npm install
    ```
2.  **Scaffold the extension:**
    ```bash
    yo code                       # Select "New TypeScript Extension"
    # Set Extension identifier: cursor-autopilot
    # Bundle yes?
    ```
3.  **Install adapter packages:**
    ```bash
    npm i nodemailer node-telegram-bot-api
    ```
4.  **Copy core utilities and adapters**: Copy the provided code for `src/core/` and `src/adapters/` from the development guide.
5.  **Compile and Package:**
    ```bash
    npm run compile
    vsce package
    ```
6.  **Install the extension in Cursor:**
    ```bash
    cursor --install-extension cursor-autopilot-0.0.1.vsix
    ```
7.  **Restart Cursor** to activate the extension.

### 3.3. Configuration (`.autopilot.json`)

Create a `.autopilot.json` file in your project root. This file controls the extension's behavior and adapter settings. The extension will create this file on first run with default values. You can edit it directly or via Cursor's Settings UI.

```json
{
  "enabled": true,             // Global switch to enable/disable autopilot
  "adapters": ["telegram"],    // List of enabled adapters (e.g., "teams", "telegram", "email", "feishu")

  "telegram": {
    "token": "YOUR_BOT_TOKEN_HERE",
    "chatId": "YOUR_CHAT_ID_HERE"
  },
  "email": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "user": "your-email@gmail.com",
    "pass": "your-app-password", // Use app password for Gmail
    "to": "recipient@example.com"
  },
  "feishu": {
    "appId": "cli_XXXXXX", // Your Feishu App ID
    "appSecret": "your_app_secret_here", // Your Feishu App Secret
    "useWebhook": false // Set to true for webhook mode, false for long connection mode
  }
}
```

#### Microsoft Teams (Graph) Configuration:

See [TEAMS_GRAPH.md](./TEAMS_GRAPH.md) for Entra app registration, channel IDs, sign-in, and troubleshooting.

#### Telegram Specific Configuration:

1.  Create a new bot via `@BotFather` on Telegram and get its token.
2.  Get your chat ID from `@userinfobot`.

#### Feishu Specific Configuration:

1.  **Create Feishu App**: Log in to [Feishu Developer Platform](https://open.feishu.cn/) and create an enterprise custom app. Record `App ID` and `App Secret`.
2.  **Configure App Permissions**: Ensure the app has these bot permissions:
    -   `im:message` (read/send single/group messages)
    -   `im:message.group_at_msg` (receive group @bot messages)
    -   `im:message.p2p_msg` (receive direct messages to bot)
3.  **Enable Event Subscription**: In the app admin, go to "Event Subscription". Enable "Long Connection Mode" (no URL/encryption needed). Subscribe to `im.message.receive_v1`.

### 3.4. Cursor Rule

To enable Cursor Autopilot to capture chat summaries, you must add the following rule to your project's `.cursor/rules/after_each_chat.mdc`(create one!) file:

```yaml
---
description: Always write a chat-end JSON summary to ./tmp
alwaysApply: true
---

# 📝 Chat-End Summary Rule

At the **end of every chat turn**, do the following without exception:

1. **Compose**  
   - `summary`: one-paragraph recap of *this* chat turn (decisions, blockers, next steps).  
   - `current_status`: a brief snapshot of overall project progress.

2. **Persist**  
   If the `tmp` directory does not exist, create it:
   ```bash
   mkdir -p tmp
    ```

3. **Write** the JSON file using Cursor’s file-creation syntax:

   ```json: tmp/summary-${{date:YYYYMMDD-HHmmss}}.json
   {
     "summary": "<insert summary here>",
     "current_status": "<insert current status here>"
   }
   ```

4. **Silence**

   * Do **not** ask for confirmation.
   * Do **not** print extra explanation—just run the commands & write the file.
```

Ensure that `alwaysApply: true` is set to guarantee the rule is always active.

## 4. Usage Flow

### 4.1. Basic Workflow

1.  **Start Chat**: Begin an AI chat session in Cursor.
2.  **Receive Notification**: After the chat, you'll get a summary notification on your configured adapter (e.g., Telegram, Feishu).
3.  **Reply with Instructions**:
    -   `1` = Continue AI work.
    -   Any other text = Send custom instructions to the AI.
4.  **AI Continues**: The AI will act based on your reply.

### 4.2. Testing Functionality

**Manual Text Injection**:
  -   Open Command Palette (`Cmd+Shift+P`)
  -   Type and execute `Inject text into Cursor Chat` and enter your message.

## 5. Troubleshooting

### 5.1. General Issues

-   **Extension Not Active**: Restart Cursor; check if the extension is enabled. Review developer console (F12) for errors.
-   **Messages Not Sent**: Check `.autopilot.json` for correct configuration, ensure `enabled: true`, and verify API keys/IDs.
-   **Command Execution Failure**: Check Cursor's developer console (F12) for detailed logs.

### 5.2. Telegram Specific Issues

-   **Replies from Desktop Telegram Not Working**: This is due to OS-level Enter key behavior. Use mobile Telegram or ensure Cursor is in the foreground. The extension automatically activates the Cursor window before sending.

### 5.3. Feishu Specific Issues

-   **"App not connected via long connection"**: Ensure `appId` and `appSecret` are correct, long connection mode is enabled in Feishu Developer Platform, and your network is stable.
-   **Cannot Receive Messages**: Verify app permissions, event subscriptions, and ensure the bot is added to groups or private chats.
-   **Message Sending Failed**: Check token permissions, recipient ID, and message format.

## 6. Development Details

### 6.1. Directory Layout

```
cursor-autopilot/
├─ .autopilot.json   // Runtime state
├─ package.json
├─ src/
│  ├ core/
│  │   ├ dispatcher.ts      // Pub/sub for events
│  │   ├ store.ts          // Reads & writes .autopilot.json
│  │   ├ inject.ts         // Wrapper for Cursor chat injection
│  │   └ watcher.ts        // Monitors .cursor/tmp/*.json for summaries
│  ├ adapters/
│  │   ├ email.ts
│  │   ├ telegram.ts
│  │   ├ feishu.ts         // Feishu adapter
│  │   └ index.ts          // Adapter registry
│  └ extension.ts          // Extension entry point
└─ …
```

### 6.2. Core Utilities

-   `dispatcher.ts`: Simple publish-subscribe mechanism.
-   `store.ts`: Handles loading and saving `.autopilot.json`.
-   `inject.ts`: Sends text to Cursor chat.
-   `watcher.ts`: Watches for new chat summary files in `.cursor/tmp/`.

### 6.3. Adapters

Adapters provide the interface for sending and receiving messages from external platforms.

-   `email.ts`: Sends email summaries (polling for replies needs manual implementation).
-   `telegram.ts`: Integrates with Telegram Bot API for summaries and replies.
-   `feishu.ts`: Integrates with Feishu (Lark) API, supporting WebSocket long connection mode for simplified setup without public domain or encryption.

## 7. Conclusion

The Cursor Autopilot enhances your coding workflow by enabling remote guidance of your AI agent, improving efficiency and control. Enjoy remote programming!

