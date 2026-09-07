# Jarbas — gestor financeiro no WhatsApp

## V1 implementada

- Registra despesas e receitas por linguagem natural.
- Detecta categorias básicas automaticamente.
- Consulta despesas do mês e saldo.
- Cria confirmação pendente para comandos de transferência (o Jarbas não movimenta dinheiro).
- Usa a integração existente `meta_integrations` para identificar a empresa pelo `phone_number_id`.
- Endpoint: `supabase/functions/jarbas-whatsapp`.

## Variáveis da Edge Function

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_VERIFY_TOKEN`
- `OPENAI_API_KEY` (opcional na V1; ativa fallback conversacional)
- `OPENAI_MODEL` (opcional; padrão `gpt-4o-mini`)
- `WHATSAPP_GRAPH_VERSION` (opcional; padrão `v23.0`)

## Webhook Meta

Configure o callback do WhatsApp para a URL da função e use o mesmo `META_VERIFY_TOKEN` na Meta e na Edge Function.

A função aceita o desafio GET da Meta e recebe mensagens POST do WhatsApp Cloud API.

## Próxima etapa

1. Testar uma mensagem real no número conectado à Meta.
2. Adicionar parcelamento, contas a pagar/receber e limites mensais.
3. Criar a tela financeira do Jarbas dentro do SaaS.
4. Adicionar confirmação para ações sensíveis e auditoria.
