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

// Cores por pessoa (pode sobrescrever via env se quiser)
const CORES = {
  'Leticia Capitani': '#9b87f5',
  'Ana': '#5b9bd5',
  'Ana Beatriz Eckert': '#e879a6',
  'Giovanna Cabral': '#52b8a3',
};
const COR_PADRAO = '#8a8a88';

function corPara(nome) {
  if (CORES[nome]) return CORES[nome];
  const chave = Object.keys(CORES).find(
    (k) => nome && (nome.includes(k.split(' ')[0]) || k.includes(nome))
  );
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

module.exports = async (req, res) => {
  try {
    if (!NOTION_TOKEN || !DATABASE_ID) {
      res.status(500).json({ error: 'Configure NOTION_TOKEN e NOTION_DATABASE_ID nas variáveis de ambiente.' });
      return;
    }

    const { inicio, fimExclusivo } = intervaloDaSemana();
    const paginas = await consultarNotion(inicio.toISOString(), fimExclusivo.toISOString());

    const porPessoa = {}; // { nome: { total, cor, tags: { tag: horas } } }

    for (const pagina of paginas) {
      const props = pagina.properties;
      const nome = extrairTexto(props[PROP_PESSOA]) || 'Sem pessoa';
      const tag = extrairTexto(props[PROP_TAG]) || 'Sem tag';
      const horas = extrairNumero(props[PROP_TEMPO]);

      if (!porPessoa[nome]) {
        porPessoa[nome] = { total: 0, cor: corPara(nome), tags: {} };
      }
      porPessoa[nome].total += horas;
      porPessoa[nome].tags[tag] = (porPessoa[nome].tags[tag] || 0) + horas;
    }

    res.status(200).json({
      semana: {
        inicio: inicio.toISOString().slice(0, 10),
        fim: new Date(fimExclusivo.getTime() - 86400000).toISOString().slice(0, 10),
      },
      pessoas: porPessoa,
      totalEntradas: paginas.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
