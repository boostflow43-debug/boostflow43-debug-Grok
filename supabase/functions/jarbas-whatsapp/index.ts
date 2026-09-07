import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const GRAPH_VERSION = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v23.0';
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sbHeaders = (key: string) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
});

function money(text: string): number | null {
  const match = text.match(/(?:r\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/i);
  if (!match) return null;
  let raw = match[1];
  if (raw.includes('.') && raw.includes(',')) raw = raw.replaceAll('.', '').replace(',', '.');
  else if (raw.includes(',')) raw = raw.replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) raw = raw.replaceAll('.', '');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
}

function category(text: string, type: 'despesa' | 'receita') {
  const t = text.toLowerCase();
  if (type === 'receita') {
    if (/sal[aá]rio/.test(t)) return 'Salário';
    if (/venda|vendi/.test(t)) return 'Vendas';
    if (/servi[cç]o/.test(t)) return 'Serviços';
    return 'Outras receitas';
  }
  if (/mercado|supermercado|comida|almo[cç]o|jantar|restaurante|lanche/.test(t)) return 'Alimentação';
  if (/aluguel|condom[ií]nio|moradia|casa/.test(t)) return 'Moradia';
  if (/gasolina|combust[ií]vel|uber|99|transporte|passagem/.test(t)) return 'Transporte';
  if (/m[eé]dico|farm[aá]cia|sa[uú]de|rem[eé]dio/.test(t)) return 'Saúde';
  if (/curso|escola|faculdade|educa[cç][aã]o/.test(t)) return 'Educação';
  if (/cinema|viagem|bar|festa|lazer/.test(t)) return 'Lazer';
  if (/netflix|spotify|assinatura|software/.test(t)) return 'Assinaturas';
  if (/imposto|tributo|taxa/.test(t)) return 'Impostos';
  if (/empresa|estoque|material|fornecedor|operacional/.test(t)) return 'Operacional';
  return 'Outros';
}

function movementDate(text: string) {
  const date = new Date();
  if (/ontem/i.test(text)) date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function integration(supabaseUrl: string, key: string, phoneNumberId: string) {
  const url = `${supabaseUrl}/rest/v1/meta_integrations?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&platform=eq.whatsapp&status=eq.active&select=empresa_id,phone_number_id,access_token&limit=1`;
  const response = await fetch(url, { headers: sbHeaders(key) });
  if (!response.ok) throw new Error(`Meta integration lookup failed: ${response.status}`);
  return (await response.json())?.[0] || null;
}

async function getCategoryId(supabaseUrl: string, key: string, empresaId: string, name: string, type: string) {
  const url = `${supabaseUrl}/rest/v1/jarbas_finance_categories?empresa_id=eq.${empresaId}&nome=eq.${encodeURIComponent(name)}&tipo=eq.${type}&select=id&limit=1`;
  const response = await fetch(url, { headers: sbHeaders(key) });
  if (!response.ok) throw new Error('Category lookup failed');
  return (await response.json())?.[0]?.id || null;
}

async function insertTransaction(supabaseUrl: string, key: string, args: { empresaId: string; phone: string; type: 'despesa' | 'receita'; value: number; text: string }) {
  const categoryName = category(args.text, args.type);
  const categoryId = await getCategoryId(supabaseUrl, key, args.empresaId, categoryName, args.type);
  const response = await fetch(`${supabaseUrl}/rest/v1/jarbas_finance_transactions`, {
    method: 'POST',
    headers: { ...sbHeaders(key), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: args.empresaId,
      telefone_origem: args.phone,
      tipo: args.type,
      valor: args.value,
      categoria_id: categoryId,
      descricao: args.text,
      data_movimento: movementDate(args.text),
      origem: 'jarbas',
      metadata: { parser: 'jarbas-v1' },
    }),
  });
  if (!response.ok) throw new Error(`Transaction insert failed: ${await response.text()}`);
  return categoryName;
}

async function summary(supabaseUrl: string, key: string, empresaId: string) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const url = `${supabaseUrl}/rest/v1/jarbas_finance_transactions?empresa_id=eq.${empresaId}&status=eq.confirmado&data_movimento=gte.${start}&data_movimento=lte.${end}&select=tipo,valor`;
  const response = await fetch(url, { headers: sbHeaders(key) });
  if (!response.ok) throw new Error('Financial summary failed');
  const rows = await response.json();
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row.tipo === 'receita') income += Number(row.valor);
    if (row.tipo === 'despesa') expense += Number(row.valor);
  }
  return { income, expense, balance: income - expense };
}

async function aiReply(text: string) {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return null;
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
      input: [
        { role: 'system', content: 'Você é Jarbas, gestor financeiro do SaaS. Responda em português do Brasil, seja objetivo e nunca invente números. Não faça transferências bancárias; apenas registre e consulte lançamentos.' },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.output_text || null;
}

async function sendWhatsApp(phoneNumberId: string, accessToken: string, to: string, text: string) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
  if (!response.ok) throw new Error(`Meta send failed: ${await response.text()}`);
}

async function handleText(supabaseUrl: string, key: string, empresaId: string, phone: string, text: string) {
  const normalized = text.trim().toLowerCase();

  if (/^(oi|ol[aá]|bom dia|boa tarde|boa noite|menu|ajuda)\b/.test(normalized)) {
    return 'Olá! Eu sou o Jarbas 🤖💰\n\nPosso registrar gastos e receitas e consultar seu financeiro.\n\nExemplos:\n• Gastei R$ 87,50 no supermercado\n• Recebi R$ 2.000 de vendas\n• Quanto gastei esse mês?\n• Qual meu saldo?';
  }

  if (/quanto\s+(gastei|foram os gastos)|total de despesas|despesas deste mês|despesas desse mês/.test(normalized)) {
    const s = await summary(supabaseUrl, key, empresaId);
    return `📊 Financeiro do mês\n\nReceitas: R$ ${s.income.toFixed(2)}\nDespesas: R$ ${s.expense.toFixed(2)}\nSaldo: R$ ${s.balance.toFixed(2)}`;
  }

  if (/saldo|quanto tenho|como está meu financeiro/.test(normalized)) {
    const s = await summary(supabaseUrl, key, empresaId);
    return `💰 Seu saldo do mês\n\nReceitas: R$ ${s.income.toFixed(2)}\nDespesas: R$ ${s.expense.toFixed(2)}\nSaldo: R$ ${s.balance.toFixed(2)}`;
  }

  const isIncome = /\b(recebi|recebemos|entrou|entrada|vendi|venda)\b/.test(normalized);
  const isExpense = /\b(gastei|gasto|paguei|pagamento|comprei|compra|despesa)\b/.test(normalized);
  const value = money(normalized);

  if ((isIncome || isExpense) && value) {
    const type = isIncome ? 'receita' : 'despesa';
    const categoryName = await insertTransaction(supabaseUrl, key, { empresaId, phone, type, value, text });
    return `Registrado com sucesso! ✅\n\n${type === 'receita' ? 'Receita' : 'Despesa'}: R$ ${value.toFixed(2)}\nCategoria: ${categoryName}\nData: ${movementDate(normalized)}`;
  }

  if (/transferência|transferir/.test(normalized) && value) {
    const response = await fetch(`${supabaseUrl}/rest/v1/jarbas_pending_actions`, {
      method: 'POST',
      headers: { ...sbHeaders(key), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ empresa_id: empresaId, telefone: phone, acao: 'registrar_transferencia', payload: { valor: value, texto_original: text } }),
    });
    if (!response.ok) throw new Error('Could not create pending action');
    return `⚠️ Confirma o registro da transferência de R$ ${value.toFixed(2)}?\n\nResponda CONFIRMAR ou CANCELAR.`;
  }

  return await aiReply(text) || 'Ainda não entendi. Tente: “Gastei R$ 50 no combustível” ou “Quanto gastei esse mês?”';
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === Deno.env.get('META_VERIFY_TOKEN') && challenge) return new Response(challenge, { status: 200 });
      return json({ ok: false, error: 'verification_failed' }, 403);
    }

    if (req.method !== 'POST') return json({ ok: true });
    const body = await req.json();
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId || !message || message.type !== 'text') return json({ ok: true, ignored: true });

    const phone = String(message.from || '').replace(/\D/g, '');
    const text = message.text?.body || '';
    const supabaseUrl = env('SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    const meta = await integration(supabaseUrl, key, phoneNumberId);
    if (!meta) return json({ ok: true, ignored: true, reason: 'integration_not_found' });

    const reply = await handleText(supabaseUrl, key, meta.empresa_id, phone, text);
    await sendWhatsApp(phoneNumberId, meta.access_token, phone, reply);
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
