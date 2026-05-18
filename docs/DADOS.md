# Como subir novos dados no Atlas

Este projeto usa um catálogo simples em `app.js` para manter análises, dropdowns, legenda e fonte seguindo o mesmo padrão.

## 1. Cadastre a fonte

Adicione uma entrada em `DATA_SOURCE_CATALOG`.

```js
novaFonte: {
  label: "Nome completo do dado",
  shortLabel: "Nome curto",
  provider: "Órgão, API, banco ou arquivo",
  type: "api", // api, db, json, manual ou computed
  provenance: "real", // real, estimado, simulado, curado, compilado ou misto
  freshness: "Ano/base de atualização",
  url: "https://...",
  quality: "Oficial",
  fields: ["campo usado 1", "campo usado 2"],
  methodology: "Como a consulta, merge, filtro ou cálculo foi feito.",
  limitations: ["Limitação conhecida ou risco de interpretação."],
  updatePolicy: "Quando e como atualizar esta fonte.",
  upstreamLabel: "Fonte original A + Fonte original B",
  upstreamSources: [
    { label: "Fonte original A", url: "https://...", fields: "campos usados", usage: "como entrou no dado final" }
  ],
  note: "Como o dado foi obtido ou calculado."
}
```

Se a fonte vier de outro domínio na nuvem, inclua o domínio em `connect-src` no CSP do `index.html`. Se vier de JSON local, coloque o arquivo em `data/`.

Para JSON local, use `provider` para o caminho do arquivo que o site carrega e use `upstreamLabel`/`upstreamSources` para dizer de onde o JSON foi montado originalmente. Exemplo atual:

```js
localWorldJson: {
  provider: "data/world_data.geojson",
  type: "json",
  provenance: "compilado",
  upstreamLabel: "datasets/geo-countries + RestCountries + World Bank",
  upstreamSources: [
    { label: "datasets/geo-countries", fields: "geometria e códigos ISO" },
    { label: "RestCountries", fields: "população, área, região e nomes em português" },
    { label: "World Bank API", fields: "PIB nominal em US$" }
  ]
}
```

## Checklist de qualidade da fonte

Antes de marcar um dado como `real`, confira se a fonte tem:

- `url` apontando para a página, API, documentação ou arquivo auditável;
- `fields` dizendo exatamente quais campos foram usados;
- `methodology` explicando filtro, agregação, conversão de unidade e merge;
- `limitations` deixando claro defasagem, projeção, cobertura parcial ou risco de interpretação;
- `updatePolicy` explicando como manter o dado atual;
- `upstreamSources`, quando o dado local foi compilado a partir de outras fontes.

Se algum desses itens faltar, prefira `provenance: "estimado"`, `"curado"`, `"compilado"` ou `"misto"` em vez de `"real"`.

Na interface, o botão `i` ao lado da fonte abre os detalhes e links de auditoria cadastrados nesses campos.

## 2. Coloque o dado em uma análise

Cada análise fica em `ANALYSIS_CATALOG`. Para adicionar uma opção ao dropdown de PIB, por exemplo, inclua uma nova métrica em `ANALYSIS_CATALOG.gdp.metrics`:

```js
growth: {
  label: "Crescimento",
  metric: "Crescimento do PIB",
  sourceIds: ["gdpIbge"]
}
```

Depois ajuste as funções que calculam a cor, bolha, cards e ranking para saber ler essa métrica:

- `analysisMetricExpression()`
- `territoryHeatColorExpression()`
- `territoryBubbleRadiusExpression()`
- `gdpCards()`, se precisar aparecer nos cards
- `stateChartConfig()` e `cityChartConfig()`, se precisar aparecer no ranking

Para o dropdown do Globo, use `WORLD_METRIC_CATALOG` e ajuste `window.updateWorldLayerColor()` para pintar o mapa com a nova propriedade.

## 3. Crie uma nova análise

Adicione uma entrada em `ANALYSIS_CATALOG`:

```js
saude: {
  label: "Saúde",
  caption: "Saúde",
  icon: "activity",
  group: "primary",
  title: "Indicadores de saúde",
  defaultMetric: "leitos",
  sourceIds: ["novaFonte"],
  note: "O que esta camada mostra e como interpretar.",
  metrics: {
    leitos: { label: "Leitos", metric: "Leitos por habitante", sourceIds: ["novaFonte"] }
  }
}
```

O botão aparece automaticamente no grupo definido por `group`: `primary` para Análise ou `explore` para Exploração.

## 4. Identifique a procedência

Toda métrica deve apontar para `sourceIds`. A interface usa isso para mostrar:

- chip de fonte no mapa;
- rodapé da legenda;
- nota em "Dados gerais";
- se o dado é real, estimado, simulado, curado, compilado ou misto.

Evite colocar um dado como `real` se ele foi projetado, calculado localmente ou digitado manualmente. Use `estimado`, `simulado`, `curado` ou `misto` conforme o caso.

## 5. Tipos de origem suportados

- `api`: dados carregados via `fetchJson`, como SIDRA/IBGE.
- `json`: arquivo local em `data/`.
- `db`: dado vindo de endpoint próprio que consulta banco. Exponha como API HTTP e cadastre a URL.
- `manual`: dado curado no código ou em JSON.
- `computed`: dado calculado no navegador a partir de outros dados.

O padrão recomendado é: buscar ou carregar o dado, normalizar para propriedades do território (`feature.properties`) e deixar mapa, cards e ranking lerem sempre essas propriedades.
