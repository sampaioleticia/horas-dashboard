// Vercel Serverless Function
// GET /api/dados
// Lê o banco de dados do Notion, filtra as entradas da semana atual
// (sábado passado até sexta da semana atual) e devolve os totais
// de horas por pessoa e por pessoa+tag.

const NOTION_VERSION = '2022-06-28';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Nomes das propriedades no seu banco do Notion.
// Ajuste aqui caso os nomes sejam diferentes.
const PROP_PESSOA = process.env.PROP_PESSOA || 'Pessoa';
const PROP_TAG = process.env.PROP_TAG || 'Tag';
const PROP_TEMPO = process.env.PROP_TEMPO || 'Tempo';
const PROP_INICIO = process.env.PROP_INICIO || 'Início';

// Propriedades numéricas usadas para somar o tempo de cada linha.
// "Tempo" costuma ser uma fórmula de TEXTO (ex: "10 h e 3 min"), então
// somamos direto pelas colunas numéricas que geram esse texto.
const PROP_HORA_TOTAL = process.env.PROP_HORA_TOTAL || 'Hora Total';
const PROP_MINUTOS_TOTAIS = process.env.PROP_MINUTOS_TOTAIS || 'Minutos Totais';

// Fallback: quando Hora Total / Minutos Totais estiverem vazios,
// soma da mesma forma usando Hora Registro / Minuto Registro.
const PROP_HORA_REGISTRO = process.env.PROP_HORA_REGISTRO || 'Hora Registro';
const PROP_MINUTO_REGISTRO = process.env.PROP_MINUTO_REGISTRO || 'Minuto Registro';

// Cores por pessoa (pode sobrescrever via env se quiser)
const CORES = {
  'Leticia Capitani': '#9b87f5',
  'Ana': '#5b9bd5',
  'Ana Elisa': '#5b9bd5',
  'Ana Beatriz Eckert': '#e879a6',
  'Ana Beatriz': '#e879a6',
  'Giovanna Cabral': '#52b8a3',
  'Giovanna': '#52b8a3',
};
const COR_PADRAO = '#8a8a88';

function corPara(nome) {
  if (!nome) return COR_PADRAO;
  if (CORES[nome]) return CORES[nome];

  // Correspondência parcial, mas priorizando a chave MAIS ESPECÍFICA
  // (mais longa) primeiro, para "Ana Beatriz Eckert" não cair em "Ana".
  const chaves = Object.keys(CORES).sort((a, b) => b.length - a.length);
  const chave = chaves.find((k) => nome.includes(k) || k.includes(nome));
  return chave ? CORES[chave] : COR_PADRAO;
}

// Calcula o intervalo sábado -> sexta (semana "de trabalho") no fuso de São Paulo
function intervaloDaSemana() {
  const agoraSP = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );
  const diaSemana = agoraSP.getDay(); // 0 = domingo, 6 = sábado
  // distância até o sábado mais recente (hoje incluso se hoje for sábado)
  const diasDesdeSabado = (diaSemana + 1) % 7;
  const sabado = new Date(agoraSP);
  sabado.setHours(0, 0, 0, 0);
  sabado.setDate(sabado.getDate() - diasDesdeSabado);

  const proximoSabado = new Date(sabado);
  proximoSabado.setDate(sabado.getDate() + 7);

  return { inicio: sabado, fimExclusivo: proximoSabado };
}

async function consultarNotion(filtroInicioISO, filtroFimISO) {
  let resultados = [];
  let cursor = undefined;

  do {
    const resp = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start_cursor: cursor,
          filter: {
            and: [
              {
                property: PROP_INICIO,
                date: { on_or_after: filtroInicioISO },
              },
              {
                property: PROP_INICIO,
                date: { before: filtroFimISO },
              },
            ],
          },
        }),
      }
    );

    if (!resp.ok) {
      const texto = await resp.text();
      throw new Error(`Notion API ${resp.status}: ${texto}`);
    }

    const dados = await resp.json();
    resultados = resultados.concat(dados.results);
    cursor = dados.has_more ? dados.next_cursor : undefined;
  } while (cursor);

  return resultados;
}

function extrairTexto(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'select':
      return prop.select ? prop.select.name : null;
    case 'people':
      return prop.people && prop.people.length ? prop.people[0].name : null;
    case 'title':
      return prop.title && prop.title.length ? prop.title.map((t) => t.plain_text).join('') : null;
    case 'rich_text':
      return prop.rich_text && prop.rich_text.length
        ? prop.rich_text.map((t) => t.plain_text).join('')
        : null;
    case 'formula':
      if (prop.formula.type === 'string') return prop.formula.string;
      return null;
    default:
      return null;
  }
}

function extrairNumero(prop) {
  if (!prop) return 0;
  if (prop.type === 'number') return prop.number || 0;
  if (prop.type === 'formula' && prop.formula.type === 'number') return prop.formula.number || 0;
  if (prop.type === 'rollup' && prop.rollup.type === 'number') return prop.rollup.number || 0;
  return 0;
}

// Tenta ler o texto do tipo "10 h e 3 min", "5 h" ou "45 min" e
// converter para horas decimais. Usado só como último recurso, caso
// as colunas numéricas (Hora Total / Minutos Totais) não existam.
function parseTempoTexto(texto) {
  if (!texto) return 0;
  const horasMatch = texto.match(/(\d+)\s*h/i);
  const minutosMatch = texto.match(/(\d+)\s*min/i);
  const horas = horasMatch ? parseInt(horasMatch[1], 10) : 0;
  const minutos = minutosMatch ? parseInt(minutosMatch[1], 10) : 0;
  return horas + minutos / 60;
}

// Soma o tempo de uma linha em horas decimais. Prioridade:
// 1) Hora Total + Minutos Totais (numéricas, mais confiável)
// 2) Hora Registro + Minuto Registro (mesmo cálculo, usado quando as
//    colunas acima estiverem vazias nessa linha)
// 3) Texto de "Tempo" (último fallback, caso nenhuma das colunas acima exista)
function valorPreenchido(prop) {
  if (!prop) return false;
  if (prop.type === 'number') return prop.number !== null && prop.number !== undefined;
  if (prop.type === 'formula' && prop.formula.type === 'number') {
    return prop.formula.number !== null && prop.formula.number !== undefined;
  }
  if (prop.type === 'rollup' && prop.rollup.type === 'number') {
    return prop.rollup.number !== null && prop.rollup.number !== undefined;
  }
  return false;
}

function extrairHorasDaLinha(props) {
  const horaTotalProp = props[PROP_HORA_TOTAL];
  const minutosTotaisProp = props[PROP_MINUTOS_TOTAIS];

  if (valorPreenchido(horaTotalProp) || valorPreenchido(minutosTotaisProp)) {
    return extrairNumero(horaTotalProp) + extrairNumero(minutosTotaisProp) / 60;
  }

  const horaRegistroProp = props[PROP_HORA_REGISTRO];
  const minutoRegistroProp = props[PROP_MINUTO_REGISTRO];

  if (valorPreenchido(horaRegistroProp) || valorPreenchido(minutoRegistroProp)) {
    return extrairNumero(horaRegistroProp) + extrairNumero(minutoRegistroProp) / 60;
  }

  const textoTempo = extrairTexto(props[PROP_TEMPO]);
  return parseTempoTexto(textoTempo);
}

// Cache curtinho em memória: com o painel atualizando a cada 1s (e talvez
// várias abas abertas), isso evita estourar o limite do Notion (~3 req/s).
const CACHE_MS = 1000;
let cache = { quando: 0, corpo: null };
let emAndamento = null; // compartilha a mesma consulta entre chamadas simultâneas

module.exports = async (req, res) => {
  try {
    if (!NOTION_TOKEN || !DATABASE_ID) {
      res.status(500).json({ error: 'Configure NOTION_TOKEN e NOTION_DATABASE_ID nas variáveis de ambiente.' });
      return;
    }

    // Deixa a CDN da Vercel segurar a resposta por 1s e servir a antiga
    // enquanto busca a nova — várias pessoas olhando = 1 consulta por segundo.
    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=5');

    if (cache.corpo && Date.now() - cache.quando < CACHE_MS) {
      res.status(200).json(cache.corpo);
      return;
    }

    if (!emAndamento) {
      emAndamento = montarResposta().finally(() => { emAndamento = null; });
    }
    const corpo = await emAndamento;
    cache = { quando: Date.now(), corpo };
    res.status(200).json(corpo);
  } catch (err) {
    // Se o Notion recusar (ex: 429 por excesso de chamadas), devolve o último dado bom
    if (cache.corpo) {
      res.status(200).json(cache.corpo);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: err.message });
  }
};

async function montarResposta() {
    const { inicio, fimExclusivo } = intervaloDaSemana();
    const paginas = await consultarNotion(inicio.toISOString(), fimExclusivo.toISOString());

    const porPessoa = {}; // { nome: { total, cor, tags: { tag: horas } } }

    for (const pagina of paginas) {
      const props = pagina.properties;
      const nome = extrairTexto(props[PROP_PESSOA]) || 'Sem pessoa';
      const tag = extrairTexto(props[PROP_TAG]) || 'Sem tag';
      const horas = extrairHorasDaLinha(props);

      if (!porPessoa[nome]) {
        porPessoa[nome] = { total: 0, cor: corPara(nome), tags: {} };
      }
      porPessoa[nome].total += horas;
      porPessoa[nome].tags[tag] = (porPessoa[nome].tags[tag] || 0) + horas;
    }

    return {
      semana: {
        inicio: inicio.toISOString().slice(0, 10),
        fim: new Date(fimExclusivo.getTime() - 86400000).toISOString().slice(0, 10),
      },
      pessoas: porPessoa,
      totalEntradas: paginas.length,
    };
}
