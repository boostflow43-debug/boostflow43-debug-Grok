create table if not exists public.jarbas_finance_categories (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('despesa','receita')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome, tipo)
);

create table if not exists public.jarbas_finance_transactions (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid null,
  telefone_origem text null,
  tipo text not null check (tipo in ('despesa','receita','transferencia')),
  valor numeric(14,2) not null check (valor > 0),
  categoria_id uuid null references public.jarbas_finance_categories(id) on delete set null,
  descricao text not null,
  data_movimento date not null default current_date,
  forma_pagamento text null,
  status text not null default 'confirmado' check (status in ('pendente','confirmado','cancelado')),
  recorrente boolean not null default false,
  parcelas_total integer null check (parcelas_total is null or parcelas_total > 0),
  parcela_atual integer null check (parcela_atual is null or parcela_atual > 0),
  origem text not null default 'jarbas',
  metadata jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.jarbas_finance_budgets (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  categoria_id uuid null references public.jarbas_finance_categories(id) on delete cascade,
  limite_mensal numeric(14,2) not null check (limite_mensal > 0),
  mes_referencia date not null,
  criado_em timestamptz not null default now(),
  unique (empresa_id, categoria_id, mes_referencia)
);

create table if not exists public.jarbas_conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  telefone text not null,
  usuario_id uuid null,
  contexto jsonb not null default '{}'::jsonb,
  ultimo_mensagem_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, telefone)
);

create table if not exists public.jarbas_pending_actions (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  telefone text not null,
  usuario_id uuid null,
  acao text not null,
  payload jsonb not null,
  status text not null default 'pendente' check (status in ('pendente','confirmado','cancelado','expirado')),
  expira_em timestamptz not null default (now() + interval '10 minutes'),
  criado_em timestamptz not null default now(),
  executado_em timestamptz null
);

create index if not exists idx_jarbas_transactions_empresa_data on public.jarbas_finance_transactions (empresa_id, data_movimento desc);
create index if not exists idx_jarbas_transactions_empresa_tipo on public.jarbas_finance_transactions (empresa_id, tipo, data_movimento desc);
create index if not exists idx_jarbas_conversas_empresa_telefone on public.jarbas_conversas (empresa_id, telefone);
create index if not exists idx_jarbas_pending_empresa_status on public.jarbas_pending_actions (empresa_id, status, expira_em);

alter table public.jarbas_finance_categories enable row level security;
alter table public.jarbas_finance_transactions enable row level security;
alter table public.jarbas_finance_budgets enable row level security;
alter table public.jarbas_conversas enable row level security;
alter table public.jarbas_pending_actions enable row level security;

create policy "jarbas categories members select" on public.jarbas_finance_categories for select to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_categories.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas categories members write" on public.jarbas_finance_categories for all to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_categories.empresa_id and ue.usuario_id = (select auth.uid()))) with check (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_categories.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas transactions members select" on public.jarbas_finance_transactions for select to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_transactions.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas transactions members write" on public.jarbas_finance_transactions for all to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_transactions.empresa_id and ue.usuario_id = (select auth.uid()))) with check (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_transactions.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas budgets members select" on public.jarbas_finance_budgets for select to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_budgets.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas budgets members write" on public.jarbas_finance_budgets for all to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_budgets.empresa_id and ue.usuario_id = (select auth.uid()))) with check (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_finance_budgets.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas conversations members select" on public.jarbas_conversas for select to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_conversas.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas conversations members write" on public.jarbas_conversas for all to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_conversas.empresa_id and ue.usuario_id = (select auth.uid()))) with check (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_conversas.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas pending members select" on public.jarbas_pending_actions for select to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_pending_actions.empresa_id and ue.usuario_id = (select auth.uid())));
create policy "jarbas pending members write" on public.jarbas_pending_actions for all to authenticated using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_pending_actions.empresa_id and ue.usuario_id = (select auth.uid()))) with check (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = jarbas_pending_actions.empresa_id and ue.usuario_id = (select auth.uid())));

insert into public.jarbas_finance_categories (empresa_id, nome, tipo)
select e.id, c.nome, c.tipo
from public.empresas e
cross join (values
  ('Alimentação','despesa'),('Moradia','despesa'),('Transporte','despesa'),('Saúde','despesa'),('Educação','despesa'),('Lazer','despesa'),('Assinaturas','despesa'),('Impostos','despesa'),('Operacional','despesa'),('Outros','despesa'),('Vendas','receita'),('Serviços','receita'),('Salário','receita'),('Outras receitas','receita')
) c(nome,tipo)
on conflict (empresa_id, nome, tipo) do nothing;
