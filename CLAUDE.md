@AGENTS.md

# CLAUDE.md — Plataforma Growth Hub (AMS + CRM Lagos)

> **INSTRUÇÃO PARA O CLAUDE:** Mantenha este arquivo atualizado. Sempre que concluir uma fase, implementar um módulo novo, ou alterar a arquitetura, atualize as seções relevantes abaixo. Este arquivo é a fonte de verdade sobre o estado atual do projeto para qualquer nova conversa.

---

## Diretrizes de Comportamento

### Reduzir verbosidade
- Be concise. Avoid unnecessary explanations unless asked.
- Don't summarize what you just did after completing a task.
- Skip preambles and affirmations ("Sure!", "Great question", etc).

### Controle de leitura de arquivos
- Don't read files you haven't been explicitly asked to read.
- Read only the specific sections needed, not entire files.
- Don't re-read files already in context.

### Controle de planejamento
- Don't create plans or outlines unless explicitly asked.
- Prefer direct action over planning when the task is clear.

### Compactação proativa
- When context grows large, suggest compacting before continuing.

---

## Estado Atual do Projeto

**Data da última atualização:** 2026-04-13

**Fase atual:** Fase 1 concluída — Sistema multi-tenant ready. Fase 2 (schema unificado) não iniciada.

### O que já existe (sistema_gh importado)

| Módulo | Status | Localização |
|--------|--------|-------------|
| Auth (better-auth + Google OAuth) | Funcionando | `src/lib/auth.ts` |
| Dashboard principal | Funcionando | `src/app/(dashboard)/page.tsx` |
| Pipeline / Leads (AMS) | Funcionando | `src/app/(dashboard)/pipeline/` |
| CRM / WhatsApp (AMS) | Funcionando | `src/app/(dashboard)/crm/` |
| Contratos | Funcionando | `src/app/(dashboard)/contratos/` |
| Financeiro | Funcionando | `src/app/(dashboard)/financeiro/` |
| Clientes | Funcionando | `src/app/(dashboard)/clientes/` |
| SDR | Funcionando | `src/app/(dashboard)/sdr/` |
| Kanban (tarefas internas) | Funcionando | `src/app/(dashboard)/kanban/` |
| Blog | Funcionando | `src/app/(dashboard)/blog/` |
| Admin | Existe | `src/app/(dashboard)/admin/` |
| Agenda / Calendário | Existe | `src/app/(dashboard)/agenda/` |
| Notificações | Existe | `src/app/(dashboard)/notificacoes/` |
| Configurações | Existe | `src/app/(dashboard)/configuracoes/` |

### O que ainda NÃO existe (a implementar na fusão)

- [ ] Multi-tenancy (`tenant_id` em todas as tabelas)
- [ ] Tabela `tenant` no schema
- [ ] Middleware universal de tenant isolation (`lib/tenant.ts`)
- [ ] Sidebar dinâmica por contexto (AMS vs CRM Lagos)
- [ ] Pipeline multi-tenant (múltiplos funis por tenant)
- [ ] WhatsApp roteamento por tenant (Uazapi multi-tenant)
- [ ] Automações / follow-ups (CRM Lagos)
- [ ] Painel superadmin (gestão de tenants)
- [ ] Onboarding de tenant Lagos

---

## Stack

- **Framework:** Next.js 15 (App Router) + shadcn/ui + Tailwind CSS 4
- **Banco:** Drizzle ORM + Neon PostgreSQL
- **Auth:** better-auth (Google OAuth) + roles customizados
- **WhatsApp:** Uazapi (SaaS)
- **Deploy:** Cloudflare Workers (OpenNext) + Queues + Cron Triggers
- **Package manager:** pnpm

### Comandos úteis

```bash
npx pnpm dev          # dev server → http://localhost:3000
npx pnpm build        # build produção
npx pnpm db:push      # push schema para Neon
npx pnpm db:studio    # Drizzle Studio
```

---

## Arquitetura

### Estrutura de pastas

```
src/
├── app/
│   ├── (auth)/           # Login
│   ├── (dashboard)/      # Área autenticada
│   │   ├── layout.tsx    # Sidebar + layout principal
│   │   ├── page.tsx      # Dashboard
│   │   ├── pipeline/     # Funil de leads
│   │   ├── crm/          # Inbox WhatsApp
│   │   ├── contratos/    # AMS only
│   │   ├── financeiro/   # AMS only
│   │   ├── clientes/     # AMS only
│   │   ├── sdr/          # AMS only
│   │   ├── kanban/       # AMS only (tarefas internas)
│   │   ├── blog/         # AMS only
│   │   ├── admin/        # Superadmin (gestão de tenants)
│   │   ├── agenda/       # Calendário
│   │   ├── configuracoes/
│   │   └── notificacoes/
│   └── api/
├── components/
│   └── ui/               # shadcn/ui
├── lib/
│   ├── auth.ts           # better-auth config
│   ├── auth-client.ts
│   ├── permissions.ts    # RBAC
│   ├── google-calendar.ts
│   ├── db/
│   │   ├── index.ts      # Drizzle client
│   │   ├── schema/       # Um arquivo por domínio
│   │   │   ├── users.ts
│   │   │   ├── pipeline.ts
│   │   │   ├── crm.ts
│   │   │   ├── contracts.ts
│   │   │   ├── financial.ts
│   │   │   ├── kanban.ts
│   │   │   ├── blog.ts
│   │   │   ├── clients.ts
│   │   │   ├── sdr.ts
│   │   │   ├── settings.ts
│   │   │   └── notifications.ts
│   │   ├── seed.ts
│   │   └── wipe.ts
└── types/
```

### Schema atual (pré-fusão)

O schema ainda **não tem `tenant_id`**. A tabela `user` tem roles: `partner`, `manager`, `operational`. Não existe tabela `tenant`.

### Schema alvo (pós-fusão)

- Toda tabela ganha `tenant_id UUID REFERENCES tenant(id)`
- GH = tenant especial com `is_platform_owner = true`
- Roles expandidos: `superadmin`, `admin`, `operator` + os roles AMS existentes

---

## Plano de Fusão — 5 Fases

| Fase | Status | Descrição |
|------|--------|-----------|
| 1. Multi-tenant ready | ⏳ Não iniciada | Adicionar `tenant_id`, middleware, sidebar dinâmica |
| 2. Schema unificado | ⏳ Não iniciada | Fundir schemas AMS + CRM Lagos |
| 3. CRM core | ⏳ Não iniciada | Pipeline multi-tenant, WhatsApp, automações, tarefas, calendário |
| 4. Admin + onboarding | ⏳ Não iniciada | Painel superadmin, fluxo de onboarding |
| 5. Polish + deploy | ⏳ Não iniciada | Produção, testes E2E |

> Plano detalhado completo em [plano-fusao-ams-crm-lagos.md](plano-fusao-ams-crm-lagos.md)

---

## Regras Absolutas

1. **TODA query ao banco DEVE incluir `tenant_id` no WHERE** (após Fase 1).
2. **NUNCA retornar tokens Uazapi em responses de API.**
3. **NUNCA criar endpoint sem auth ou webhook validation.**
4. **NUNCA usar string concatenation em queries** — Drizzle ORM sempre.
5. **NUNCA usar:** BullMQ, Redis, WebSocket, Prisma, NextAuth, ou Vercel.
6. **NUNCA fazer commit ou push sem aprovação explícita do usuário.**
7. **Todo código domain-specific vai em `src/` dentro do módulo correto** — nunca criar pastas globais fora da estrutura estabelecida.

---

## Convenções de Código

- Schemas em `src/lib/db/schema/` (um arquivo por domínio)
- Componentes em `src/components/{domínio}/`
- API routes em `src/app/api/`
- `getTenantId()` de `lib/tenant.ts` em toda server action e API route (após criação)
- Erros: mensagem genérica pro client, detalhes no log
- Sem `console.log` em produção — structured logging

---

## Multi-tenancy (modelo alvo)

- **Shared database** — `tenant_id` em todas as tabelas
- **GH** = tenant especial (`is_platform_owner = true`)
- **Tenants Lagos** = clientes normais
- **Superadmin** opera cross-tenant via `X-Tenant-Override` header
- Middleware valida tenant em toda request autenticada

### Módulos por contexto

| Módulo | Quem acessa |
|--------|-------------|
| Pipeline, Chat, Tarefas, Calendário, Dashboard | Todos os tenants |
| Automações | Admin+ de qualquer tenant |
| Contratos, Financeiro, Clientes, SDR, Kanban interno, Blog | Apenas tenant GH (`is_platform_owner`) |
| Admin panel (gestão de tenants) | Apenas `superadmin` |
| Settings | Admin+ do tenant |

---

## Contexto do Projeto

Este é a **Plataforma Growth Hub** — fusão do AMS (Agency Management System interno da GH) com o CRM Lagos (produto SaaS multi-tenant para clientes da Lagos Assessoria). O objetivo é uma plataforma única com dois modos de operação, onde a GH vira o "tenant 0".

Repositório de origem do sistema base: `https://github.com/GrowthHubD/sistema_gh`
