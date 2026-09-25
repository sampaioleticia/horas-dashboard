# Horas da semana — dashboard do Notion

Painel com duas abas:
- **Resumo**: total de horas somadas por pessoa na semana atual (sábado passado até sexta-feira).
- **Por tag**: gráfico de rosca por pessoa, mostrando as horas dela dividida por tag.

Lê os dados direto do seu banco do Notion via API, sem precisar exportar nada manualmente.

## 1. Criar a integração no Notion

1. Acesse https://www.notion.so/my-integrations e clique em **New integration**.
2. Dê um nome (ex: "Dashboard Horas"), associe ao seu workspace e salve.
3. Copie o **Internal Integration Secret** — isso vai virar `NOTION_TOKEN`.
4. Abra o banco de dados com os registros de horas no Notion, clique em `···` no canto
   superior direito → **Connections** → conecte a integração que você acabou de criar.
   (Sem esse passo a API retorna "not found" mesmo com o token certo.)

## 2. Pegar o ID do banco de dados

Abra o banco como página inteira no navegador. A URL será algo como:

```
https://www.notion.so/seuworkspace/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d?v=...
```

O `NOTION_DATABASE_ID` é o trecho de 32 caracteres antes do `?v=`.

## 3. Conferir os nomes das propriedades

O código já assume os nomes vistos nas suas imagens:

| Propriedade | Nome padrão | Tipo esperado |
|---|---|---|
| Pessoa | `Pessoa` | Pessoa (people) |
| Tag | `Tag` | Seleção (select) |
| Tempo | `Tempo` | Número ou fórmula numérica, **em horas** |
| Início | `Início` | Data |

Se algum nome for diferente no seu banco, ajuste as variáveis `PROP_*` no passo 4 —
não precisa mexer no código.

**Importante**: se `Tempo` guardar o valor em minutos (não horas), me avise para eu
ajustar a conversão no `api/dados.js` — hoje ele assume horas.

## 4. Subir para o GitHub

```bash
cd horas-dashboard
git init
git add .
git commit -m "Dashboard de horas"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/horas-dashboard.git
git push -u origin main
```

## 5. Publicar na Vercel

1. Em https://vercel.com, clique em **Add New → Project** e importe o repositório do GitHub.
2. Antes do deploy, abra **Environment Variables** e adicione:
   - `NOTION_TOKEN` = o secret copiado no passo 1
   - `NOTION_DATABASE_ID` = o ID do passo 2
   - (opcional) `PROP_PESSOA`, `PROP_TAG`, `PROP_TEMPO`, `PROP_INICIO`, caso os nomes sejam diferentes
3. Clique em **Deploy**. Não precisa configurar build command nem output directory —
   a Vercel detecta o `/api` e serve `/public` automaticamente.
4. A cada `git push`, a Vercel republica sozinha.

## Cores por pessoa

Já configuradas em `api/dados.js` (objeto `CORES`):

- Leticia Capitani → roxo `#9b87f5`
- Ana → azul `#5b9bd5`
- Ana Beatriz Eckert → rosa `#e879a6`
- Giovanna Cabral → verde `#52b8a3`

Se algum nome de pessoa no Notion for escrito diferente, ajuste as chaves desse objeto
para bater exatamente com o nome que aparece na propriedade "Pessoa".

## O que talvez precise ajustar depois de ver os dados reais

- Se "Pessoa" puder ter mais de uma pessoa selecionada por registro, hoje o código só
  conta a primeira pessoa da lista.
- A semana é calculada no fuso de São Paulo (sábado 00:00 até a sexta seguinte 23:59).
- O gráfico de rosca usa variações de tom da cor da pessoa para cada tag (não cores fixas
  por tag) — se preferir cores fixas por tag, é só avisar.
