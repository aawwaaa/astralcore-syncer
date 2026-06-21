# Astralcore-Syncer

> 不到 50 行业务代码，实现一个实时协同编辑器。

`astralcore-syncer` 是一个**极轻量、可嵌入的分布式对象同步内核**。  
它把 WebSocket、序列化、RPC、广播、资源生命周期管理全部封装成透明抽象，让你像操作本地对象一样构建实时协同应用。

[![npm version](https://img.shields.io/npm/v/@aawwaaa/astralcore-syncer?style=flat-square)](https://www.npmjs.com/package/@aawwaaa/astralcore-syncer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square)](https://www.typescriptlang.org/)

---

## 快速开始：实时协同编辑器（完整代码）

### 效果展示

![效果展示](https://raw.githubusercontent.com/aawwaaa/astralcore-syncer/main/readme/demo.gif)

### 代码示例

```ts
// shared.ts
import { Resource } from "@aawwaaa/astralcore-syncer";

export class SharedDoc extends Resource {
  async resCreate(text) { this.content = text }
  resSave(client) { return { content: this.content } }
  async resLoad({ content }) { this.content = content }
  async modify(text) { this.content = text; this.resSync() }
}

export const SharedDocDef = Resource.define(SharedDoc, "shared-doc").invoke("modify");
```
```ts
// server.ts
import { ResourceEnvironment, resourceEnvironmentSetImpl } from "@aawwaaa/astralcore-syncer";
import { ServerMemoryResourceManager } from "@aawwaaa/astralcore-syncer/impl/server";
import { ServerWebsocketRemoteManager } from "@aawwaaa/astralcore-syncer/impl/server/remote-websocket";
import express from "express";
import expressWs from "express-ws";
import { SharedDocDef } from "./shared";

const remote = new ServerWebsocketRemoteManager();
const impl = new ResourceEnvironment(remote, new ServerMemoryResourceManager());
resourceEnvironmentSetImpl(() => impl);

// 创建默认文档，生命周期到服务器停止
const doc = await SharedDocDef.loadOrCreate("main", "Hello, world!");
doc.event.updater("sync", () => console.log("Doc updated:", doc.content));

// 挂载 WebSocket
const { app } = expressWs(express());
app.ws("/ws", (ws) => remote.handleWebSocket(ws));
app.listen(8000, () => console.log("Server on :8000"));
```
```ts
// client.ts
import { ResourceEnvironment, resourceEnvironmentSetImpl } from "@aawwaaa/astralcore-syncer";
import { ClientWebsocketRemoteManager } from "@aawwaaa/astralcore-syncer/impl/client";
import { ClientRemoteResourceManager } from "@aawwaaa/astralcore-syncer/impl/client";
import { SharedDocDef } from "./shared";

const remote = new ClientWebsocketRemoteManager("/ws").init();
resourceEnvironmentSetImpl(() => new ResourceEnvironment(remote, new ClientRemoteResourceManager(remote)));

using doc = await SharedDocDef.resolve("main");
const textarea = document.getElementById("edit");
textarea.addEventListener("input", () => doc.modify(textarea.value));
doc.event.updater("sync", () => (textarea.value = doc.content));
// HTML: <textarea id="edit" style="width:100%;height:200px;"></textarea>
```

**就这样。** 多开几个浏览器窗口试试——你的编辑器已经支持多端实时同步了。

---

## 📦 安装

```bash
npm install @aawwaaa/astralcore-syncer
```

---

## 核心概念

### Resource（资源）
任何需要跨端同步的对象都可以定义为 `Resource`。你只需实现三个生命周期方法：

| 方法 | 何时调用 | 用途 |
|------|----------|------|
| `resCreate(...args)` | 服务器首次创建 | 设置初始状态 |
| `resSave(client)` | 保存/广播时调用 | 返回序列化数据（`client=true` 给客户端，可裁剪） |
| `resLoad(data)` | 加载或收到同步时调用 | 用数据恢复状态 |

`Resource` 中包含一个 `EventBus` 实例 `event`, 可用于本地或RPC事件。

| 内置事件 | 时机 |
| `sync` | 资源被修改并广播后触发 |
| `remove` | 资源被删除时触发 |
* `event` 支持 `on`, `updater`(初始执行一次并订阅变化, 只支持无参), `off`, `emit` 方法。

### invoke & emit
- **`invoke("method")`**：把方法标记为远程可调用。客户端调用时自动 RPC 到服务器，服务器执行后结果广播给所有客户端。
- **`emit("event")`**：把自定义事件标记为可广播，任意端调用 `this.event.emit("event", ...)` 即可全端同步。

### 环境 (ResourceEnvironment)
一个单例，组合了 `RemoteManager`（通信）和 `ResourceManager`（持久化）。通过 `resourceEnvironmentSetImpl` 初始化，服务端和客户端分别注入自己的实现。

### 引用计数
* 如果你只需要全局单例，你可以忽视引用计数系统。
资源会被多个客户端和 RPC 参数持有。框架使用显式引用计数保证安全回收：
```ts
using doc = await SharedDocDef.resolve("main"); // 用 using 自动释放
// 或手动 doc.refRemove()
```
忘记释放会导致内存泄漏。
* `using` 需要 `typescript 5.2+` 且 `target` 为 `esnext`，也可用 `try/finally` + `doc.refRemove()` 替代。

---

## 扩展点（按需组合）

框架只在核心同步上锁定，以下部分全部可替换：

| 扩展点 | 接口 | 示例 |
|--------|------|------|
| **传输层** | `RemoteManager` | WebRTC、gRPC、Web Worker |
| **持久化** | `ResourceManager` | 替换内存为 MongoDB、PostgreSQL、S3 |
| **自定义序列化** | `SpecialObjectDefinition` | 传输 `Date`、`Buffer`、三维向量等特殊对象 |
| **鉴权** | `callerExt` + `getCaller()` | 在连接时传入用户信息，方法内获取调用者身份 |
| **冲突策略** | 在 `modify` 等方法内实现 | 最后写入胜出、CAS 版本检查、CRDT 算法均可组合 |
| **离线支持** | 包装客户端 RPC 层 | 实现本地操作队列与重放 |

> 这让 `astralcore-syncer` 成为一个**内核**，而非全功能平台。你可以自由嫁接任何生态工具（Yjs、JSON Patch、OT 库等）。

---

## 与同类方案对比

| 特性 | astralcore-syncer | Meteor | Firebase | ShareDB | Yjs |
|------|-------------------|--------|----------|---------|-----|
| **抽象层级** | 对象方法 + 事件 | Publication/Sub | 查询订阅 | OT 文档 | CRDT 结构 |
| **学习曲线** | 低（懂类即可） | 高（全栈平台） | 中（平台规则） | 高（OT 概念） | 中（CRDT 思维） |
| **自托管** | ✅ 纯 Node.js | ✅ (重) | ❌ 有限 | ✅ | ✅ |
| **冲突解决** | 留给开发者 | 乐观锁 | 安全规则 | 强制 OT | 强制 CRDT |
| **适用场景** | 小型通用协同 | 大型实时应用 | 移动/网页应用 | 文档协作 | 离线优先文档 |

---

## FAQ

<details>
<summary><strong>生产环境能用吗？</strong></summary>
可以，但需要你自己补充鉴权、冲突策略和持久化后端。项目本身被设计为稳定内核，但缺失部分由你组合。
</details>

<details>
<summary><strong>为什么一定要手动释放引用？</strong></summary>
分布式场景下，一个资源可能被多个客户端和回调同时引用，自动 GC 无法判断。通过显式引用计数，框架保证只在无人使用时安全卸载，避免内存泄漏。推荐使用 `using` 语法。
</details>

<details>
<summary><strong>支持水平扩展吗？</strong></summary>
内置的 `ServerMemoryResourceManager` 不能跨进程。你可以实现一个基于 Redis 或消息队列的 `RemoteManager` 和 `ResourceManager` 来扩展。
</details>

<details>
<summary><strong>可以不用 WebSocket 吗？</strong></summary>
完全可以。实现 `RemoteManager` 接口，你可以换成 WebRTC DataChannel、MQTT、甚至 HTTP 轮询。
</details>

---

## 示例项目
- [简易共享文档](https://github.com/aawwaaa/astralcore-syncer/tree/main/examples/shareddoc)

---

## 贡献
欢迎提交 PR！请先打开 Issue 讨论你的想法，或直接提交 Draft PR。

---

## 许可证
MIT © aawwaaa

---

<p align="center">
  <sub>less than 1000 lines of core. unlimited real-time possibilities.</sub>
</p>