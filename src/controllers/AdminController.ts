import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CompanionService } from '../services/companionService.js';
import type { DiagnosticService } from '../services/diagnosticService.js';
import { BaseController } from './BaseController.js';

const userParamsSchema = z.object({
  userId: z.string().trim().min(1).max(128),
});

const previewSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(8_000),
});

export class AdminController extends BaseController {
  constructor(
    private readonly companionService: CompanionService,
    private readonly diagnosticService: DiagnosticService,
  ) {
    super();
  }

  async page(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await reply.type('text/html; charset=utf-8').send(adminHtml);
  }

  async state(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { userId } = userParamsSchema.parse(request.params);
    await this.sendSuccess(reply, await this.companionService.state(userId));
  }

  async preview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const input = previewSchema.parse(request.body);
    await this.sendSuccess(reply, await this.diagnosticService.preview(input.userId, input.text));
  }

  async deleteUserData(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { userId } = userParamsSchema.parse(request.params);
    await this.companionService.deleteUserData(userId);
    await this.sendNoContent(reply);
  }
}

const adminHtml = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>伴侣机器人管理台</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background:#f4f3ef; color:#252525; }
    body { margin:0; padding:32px; }
    main { max-width:960px; margin:auto; }
    h1 { margin:0 0 8px; }
    .notice { border-left:4px solid #555; padding:10px 14px; background:#fff; margin:16px 0 24px; }
    section { background:#fff; border:1px solid #d7d4cc; padding:20px; margin:16px 0; }
    label { display:block; margin:10px 0 4px; font-weight:600; }
    input, textarea, button { font:inherit; }
    input, textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #aaa; }
    textarea { min-height:100px; }
    button { margin-top:12px; padding:9px 16px; border:1px solid #222; background:#222; color:white; cursor:pointer; }
    button.danger { background:#fff; color:#a11; border-color:#a11; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; background:#f4f3ef; padding:14px; min-height:60px; }
  </style>
</head>
<body><main>
  <h1>伴侣机器人管理台</h1>
  <p class="notice">这里展示的记忆和关系状态属于敏感数据。不要将管理令牌或页面开放到公网。</p>
  <section>
    <h2>用户状态</h2>
    <label for="token">Admin Token</label><input id="token" type="password" />
    <label for="user">User ID</label><input id="user" value="demo-user" />
    <button id="load">加载状态</button><button class="danger" id="delete">删除用户数据</button>
    <pre id="state"></pre>
  </section>
  <section>
    <h2>模型上下文诊断</h2>
    <label for="text">假设用户消息</label><textarea id="text">今天面试有点紧张</textarea>
    <button id="preview">生成诊断预览</button>
    <pre id="diagnostic"></pre>
  </section>
<script>
const headers=()=>{const token=document.querySelector('#token').value;return {...(token?{'x-admin-token':token}:{}),'content-type':'application/json'}};
const user=()=>encodeURIComponent(document.querySelector('#user').value);
const render=async(r,id)=>{document.querySelector(id).textContent=r.status===204?'已删除':JSON.stringify(await r.json(),null,2)};
document.querySelector('#load').onclick=()=>fetch('/admin/api/users/'+user()+'/state',{headers:headers()}).then(r=>render(r,'#state'));
document.querySelector('#delete').onclick=()=>fetch('/admin/api/users/'+user()+'/data',{method:'DELETE',headers:headers()}).then(r=>render(r,'#state'));
document.querySelector('#preview').onclick=()=>fetch('/admin/api/diagnostics/preview',{method:'POST',headers:headers(),body:JSON.stringify({userId:document.querySelector('#user').value,text:document.querySelector('#text').value})}).then(r=>render(r,'#diagnostic'));
</script>
</main></body></html>`;

