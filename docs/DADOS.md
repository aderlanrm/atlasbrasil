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

## Fonte alternativa para o mesmo dado

Quando houver mais de uma fonte para a mesma métrica, use `sourceOptions` dentro da análise. Isso cria um seletor padrão de fonte na legenda e mantém a explicação da diferença junto do botão `i`.

```js
idh: {
  label: "IDH",
  sourceOptions: [
    {
      id: "undp",
      label: "UNDP/HDR",
      scope: ["world"],
      sourceIds: ["hdiGlobalUndp"],
      difference: "Fonte primária oficial do Human Development Report."
    },
    {
      id: "owid",
      label: "Our World in Data",
      scope: ["world"],
      sourceIds: ["hdiGlobalOwid"],
      difference: "Redistribuição do OWID com processamento menor; a fonte original citada continua sendo UNDP/HDR."
    }
  ]
}
```

Regras:

- Use `sourceOptions` somente quando as fontes medem essencialmente o mesmo dado no mesmo escopo.
- Use `scope` para evitar mostrar uma fonte onde ela não se aplica. Exemplo: OWID vale para IDH global, mas não para IDHM municipal/estadual brasileiro.
- Escreva `difference` em linguagem simples: fonte primária, redistribuição, projeção, cobertura, ano, metodologia ou limitação relevante.
- Cada opção deve apontar para `sourceIds`; cada fonte continua precisando de URL, campos, metodologia e limitações.

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

## Exemplo: dados de IDH/IDHM

A aba `IDH` usa três fontes cadastradas:

- `hdiGlobalUndp`: IDH global real/oficial do UNDP Human Development Report. O app carrega `data/hdi_global.json`, gerado a partir do CSV oficial `HDR25_Composite_indices_complete_time_series.csv`. Campos usados: `iso3`, `country`, `hdi_1990` a `hdi_2023` e `hdi_rank_2023`.
- `hdiGlobalOwid`: IDH global via Our World in Data. O app carrega `data/hdi_owid.json`, gerado a partir de `human-development-index.csv` e `human-development-index.metadata.json`. O OWID cita UNDP Human Development Report 2025 como fonte original e aplica processamento menor.
- `idhmPnudBrazil`: IDHM real/oficial do Painel IDHM/PNUD Brasil, IPEA, FJP e IBGE/PNAD Contínua. O app carrega `data/idhm_brazil.json`, gerado a partir de `data/idhm_pnud_brazil.xlsx`. Campos usados: `ANO`, `AGREGACAO`, `CODIGO`, `NOME`, `IDHM`, `IDHM_L`, `IDHM_E`, `IDHM_R`, `IDHMAD`, `ESPVIDA`, `RDPC` e `GINI`.
- `idhmCityProxy`: proxy calculado. Como a planilha anual carregada cobre Brasil e UFs, mas não municípios, as cidades recebem temporariamente o IDHM da UF. Isso aparece na fonte e nos cards como `proxy UF`; não trate como IDHM municipal real.

No escopo `Globo`, a análise IDH declara `sourceOptions` para permitir alternar entre `UNDP/HDR` e `Our World in Data`. A diferença aparece abaixo da fonte e nos detalhes do botão `i`.

Para atualizar o IDH global:

1. Baixe o CSV mais recente no HDR Data Center do UNDP.
2. Substitua ou mantenha o bruto em `data/`.
3. Regenere `data/hdi_global.json` mantendo `latestYear`, `years` e `countries[ISO3].history`.
4. Confira se os códigos ISO3 batem com `data/world_data.geojson`.
5. Atualize `DATA_SOURCE_CATALOG.hdiGlobalUndp.freshness`, `url`, `fields`, `methodology` e `limitations`.

Para atualizar a versão OWID do IDH global:

1. Baixe `https://ourworldindata.org/grapher/human-development-index.csv`.
2. Baixe `https://ourworldindata.org/grapher/human-development-index.metadata.json`.
3. Regenere `data/hdi_owid.json` mantendo `latestYear`, `years`, `countries[ISO3].history` e região OWID.
4. Atualize `DATA_SOURCE_CATALOG.hdiGlobalOwid`, especialmente `freshness`, `methodology`, `limitations` e metadados de atualização.

Para atualizar o IDHM do Brasil:

1. Baixe a planilha mais recente no Painel IDHM/PNUD Brasil.
2. Substitua `data/idhm_pnud_brazil.xlsx`.
3. Regenere `data/idhm_brazil.json` com `latestYear`, `years`, `brazil.history` e `states[CODIGO].history`.
4. Confira uma UF manualmente, comparando ano, `IDHM`, `IDHM_L`, `IDHM_E` e `IDHM_R` com a planilha.
5. Atualize `DATA_SOURCE_CATALOG.idhmPnudBrazil`.

Para trocar o proxy de cidades por IDHM municipal real:

1. Integre uma base municipal auditável, preferencialmente Atlas Brasil/PNUD/IPEA/FJP para anos censitários.
2. Crie um JSON municipal por código IBGE de 7 dígitos, por exemplo `data/idhm_municipios.json`.
3. Cadastre uma nova fonte, por exemplo `idhmMunicipalAtlas`, com `provenance: "real"`, URL pública, campos, metodologia e limitações.
4. Ajuste `cityMapProperties()` para ler o IDHM municipal real antes de cair no proxy da UF.
5. Remova `idhmCityProxy` dos `sourceIds` quando a cidade tiver dado municipal real.

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
